<script lang="ts">
  import { encrypt, decrypt as decryptMsg } from '../../lib/aesGcm';
  import { t } from '../../lib/t';
  import CopyButton from '../CopyButton.svelte';

  export let locale = 'en';
  export let dict: Record<string, string>;

  const BLOCK = 8;
  const DELTA = 24;
  const REP = 7;
  const MAGIC = 'PCP2';
  const PUBLIC_SEED = 0x50435032;
  const HEADER_SIZE = 8;
  const CRYPTO_OVERHEAD = 52;
  const MAX_FILE = 10 * 1024 * 1024;
  const MIN_DIM = 800;
  const MAX_DIM = 2048;

  let imageUrl: string | null = null;
  let message = '';
  let password = '';
  let fileInput: HTMLInputElement;
  let status = '';
  let mode: 'encode' | 'decode' = 'encode';
  let decodedMessage = '';
  let encodedImageUrl: string | null = null;
  let capacity = 0;
  let processing = false;
  let imgW = 0;
  let imgH = 0;

  function triggerFileSelect() { fileInput?.click(); }

  function xorshift32(seed: number) {
    let s = seed || 1;
    return () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return s >>> 0; };
  }

  async function getSeed(pw: string): Promise<number> {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw));
    return new DataView(hash).getUint32(0) || 1;
  }

  function shuffledOrder(count: number, seed: number): number[] {
    const arr = Array.from({ length: count }, (_, i) => i);
    const rng = xorshift32(seed);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = rng() % (i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function blockLuminance(d: Uint8ClampedArray, bx: number, by: number, w: number): number {
    let sum = 0;
    for (let dy = 0; dy < BLOCK; dy++)
      for (let dx = 0; dx < BLOCK; dx++) {
        const i = ((by * BLOCK + dy) * w + bx * BLOCK + dx) * 4;
        sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      }
    return sum / (BLOCK * BLOCK);
  }

  function qimEmbed(d: Uint8ClampedArray, bx: number, by: number, w: number, bit: number) {
    const L = blockLuminance(d, bx, by, w);
    let q = Math.round(L / DELTA);
    if ((q & 1) !== bit) {
      const up = q + 1, dn = q - 1;
      q = Math.abs(up * DELTA - L) <= Math.abs(dn * DELTA - L) ? up : dn;
    }
    const adj = q * DELTA - L;
    for (let dy = 0; dy < BLOCK; dy++)
      for (let dx = 0; dx < BLOCK; dx++) {
        const i = ((by * BLOCK + dy) * w + bx * BLOCK + dx) * 4;
        d[i]     = Math.max(0, Math.min(255, Math.round(d[i] + adj)));
        d[i + 1] = Math.max(0, Math.min(255, Math.round(d[i + 1] + adj)));
        d[i + 2] = Math.max(0, Math.min(255, Math.round(d[i + 2] + adj)));
      }
  }

  function qimExtract(d: Uint8ClampedArray, bx: number, by: number, w: number): number {
    return Math.round(blockLuminance(d, bx, by, w) / DELTA) & 1;
  }

  function bytesToBits(bytes: Uint8Array): number[] {
    const bits: number[] = [];
    for (const b of bytes) for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
    return bits;
  }

  function bitsToBytes(bits: number[]): Uint8Array {
    const out = new Uint8Array(Math.ceil(bits.length / 8));
    for (let i = 0; i < bits.length; i++) out[i >> 3] |= (bits[i] & 1) << (7 - (i & 7));
    return out;
  }

  function maxChars(w: number, h: number): number {
    const total = Math.floor(w / BLOCK) * Math.floor(h / BLOCK);
    return Math.max(0, Math.floor(total / (8 * REP)) - HEADER_SIZE - CRYPTO_OVERHEAD);
  }

  function normalizeToCanvas(img: HTMLImageElement, forEncode: boolean): HTMLCanvasElement {
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (forEncode) {
      if (w < MIN_DIM || h < MIN_DIM) {
        const scale = Math.max(MIN_DIM / w, MIN_DIM / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      if (w > MAX_DIM || h > MAX_DIM) {
        const scale = Math.min(MAX_DIM / w, MAX_DIM / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
    }
    if (!forEncode && (w > MAX_DIM || h > MAX_DIM)) throw new Error('Image dimensions too large');
    w = Math.floor(w / BLOCK) * BLOCK;
    h = Math.floor(h / BLOCK) * BLOCK;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return c;
  }

  function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image failed to load'));
      img.src = src;
    });
  }

  async function handleImageFile(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    if (f.size > MAX_FILE) {
      status = t(dict, 'tools.photoCipher.imageTooLarge');
      imageUrl = null; encodedImageUrl = null; decodedMessage = ''; capacity = 0;
      return;
    }
    encodedImageUrl = null; decodedMessage = '';
    try {
      const blobUrl = URL.createObjectURL(f);
      const img = await loadImage(blobUrl);
      URL.revokeObjectURL(blobUrl);
      const norm = normalizeToCanvas(img, mode === 'encode');
      imgW = norm.width;
      imgH = norm.height;
      imageUrl = norm.toDataURL('image/png');
      capacity = maxChars(imgW, imgH);
      status = t(dict, 'tools.photoCipher.imageLoaded')
        .replace('{w}', String(imgW))
        .replace('{h}', String(imgH))
        .replace('{chars}', String(capacity));
    } catch {
      status = t(dict, 'tools.photoCipher.imageLoadFailed');
      imageUrl = null; capacity = 0;
    }
  }

  async function encode() {
    if (!imageUrl || !message || !password) {
      status = t(dict, 'tools.photoCipher.pleaseProvide'); return;
    }
    processing = true;
    try {
      const img = await loadImage(imageUrl);
      const norm = normalizeToCanvas(img, true);
      const ctx = norm.getContext('2d')!;
      const imageData = ctx.getImageData(0, 0, norm.width, norm.height);
      const px = imageData.data;
      const bx = norm.width / BLOCK;
      const by = norm.height / BLOCK;
      const total = bx * by;

      status = t(dict, 'tools.photoCipher.encrypting');
      let cipher: Uint8Array;
      try { cipher = await encrypt(message, password); }
      catch { status = t(dict, 'tools.photoCipher.encryptionFailed'); processing = false; return; }

      const magic = new TextEncoder().encode(MAGIC);
      const len = cipher.length;
      const payload = new Uint8Array(HEADER_SIZE + len);
      payload.set(magic, 0);
      payload[4] = (len >> 24) & 0xff;
      payload[5] = (len >> 16) & 0xff;
      payload[6] = (len >> 8) & 0xff;
      payload[7] = len & 0xff;
      payload.set(cipher, HEADER_SIZE);

      const bits = bytesToBits(payload);
      const expanded: number[] = [];
      for (const b of bits) for (let r = 0; r < REP; r++) expanded.push(b);

      if (expanded.length > total) {
        status = t(dict, 'tools.photoCipher.messageTooLong'); processing = false; return;
      }

      status = t(dict, 'tools.photoCipher.embedding');
      const seed = PUBLIC_SEED;
      const order = shuffledOrder(total, seed);

      await new Promise(r => setTimeout(r, 0));
      for (let i = 0; i < expanded.length; i++) {
        const idx = order[i];
        qimEmbed(px, idx % bx, Math.floor(idx / bx), norm.width, expanded[i]);
      }

      ctx.putImageData(imageData, 0, 0);
      encodedImageUrl = norm.toDataURL('image/png');
      status = t(dict, 'tools.photoCipher.messageHidden');
    } catch { status = t(dict, 'tools.photoCipher.encryptionFailed'); }
    processing = false;
  }

  function downloadEncoded() {
    if (!encodedImageUrl) return;
    const a = document.createElement('a');
    a.download = 'photo-cipher.png';
    a.href = encodedImageUrl;
    a.click();
  }

  async function decode() {
    if (!imageUrl || !password) {
      status = t(dict, 'tools.photoCipher.pleaseProvideImage'); return;
    }
    processing = true;
    try {
      const img = await loadImage(imageUrl);
      const norm = normalizeToCanvas(img, false);
      const ctx = norm.getContext('2d')!;
      const imageData = ctx.getImageData(0, 0, norm.width, norm.height);
      const px = imageData.data;
      const bxCount = norm.width / BLOCK;
      const byCount = norm.height / BLOCK;
      const total = bxCount * byCount;

      if (total < HEADER_SIZE * 8 * REP) {
        status = t(dict, 'tools.photoCipher.imageTooSmall'); processing = false; return;
      }

      status = t(dict, 'tools.photoCipher.extracting');
      function extract(seed: number): number[] {
        const order = shuffledOrder(total, seed);
        const data: number[] = [];
        for (let i = 0; i < Math.floor(total / REP); i++) {
          let ones = 0;
          for (let r = 0; r < REP; r++) {
            const idx = order[i * REP + r];
            ones += qimExtract(px, idx % bxCount, Math.floor(idx / bxCount), norm.width);
          }
          data.push(ones > REP / 2 ? 1 : 0);
        }
        return data;
      }
      // New files use a public layout; password guesses must pass AES-GCM's KDF.
      let data = extract(PUBLIC_SEED);
      if (new TextDecoder().decode(bitsToBytes(data.slice(0, 32))) !== MAGIC) {
        data = extract(await getSeed(password));
        if (new TextDecoder().decode(bitsToBytes(data.slice(0, 32))) !== 'PCPH') {
          status = t(dict, 'tools.photoCipher.noHiddenMessage'); processing = false; return;
        }
      }

      const lenBytes = bitsToBytes(data.slice(32, 64));
      const payloadLen = (lenBytes[0] << 24) | (lenBytes[1] << 16) | (lenBytes[2] << 8) | lenBytes[3];
      if (payloadLen <= 0 || 64 + payloadLen * 8 > data.length) {
        status = t(dict, 'tools.photoCipher.corrupted'); processing = false; return;
      }

      const cipherBytes = bitsToBytes(data.slice(64, 64 + payloadLen * 8));
      status = t(dict, 'tools.photoCipher.decrypting');
      decodedMessage = await decryptMsg(cipherBytes, password);
      status = t(dict, 'tools.photoCipher.decryptSuccess');
    } catch {
      status = t(dict, 'tools.photoCipher.decryptFailed');
      decodedMessage = '';
    }
    processing = false;
  }
</script>
<div class="stack">
  <div class="tabs" role="tablist" aria-label={t(dict, 'tools.photoCipher.h1')}>
    <button type="button" role="tab" class="tab" aria-selected={mode === 'encode'} aria-controls="photo-panel" on:click={() => mode = 'encode'}>{t(dict, 'tools.photoCipher.encode')}</button>
    <button type="button" role="tab" class="tab" aria-selected={mode === 'decode'} aria-controls="photo-panel" on:click={() => mode = 'decode'}>{t(dict, 'tools.photoCipher.decode')}</button>
  </div>

  <div id="photo-panel" role="tabpanel" class="grid gap-6 md:grid-cols-2">
    <div class="stack">
      <div class="field">
        <span class="label">{t(dict, 'tools.photoCipher.sourceImage')}</span>
        <label class="dropzone aspect-video" class:dropzone--active={!!imageUrl} for="photo-file">
          {#if encodedImageUrl}
            <img src={encodedImageUrl} alt={t(dict, 'tools.photoCipher.encodedAlt')} />
          {:else if imageUrl}
            <img src={imageUrl} alt={t(dict, 'tools.photoCipher.previewAlt')} />
          {:else}
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
            <span class="dropzone__title">{t(dict, 'tools.photoCipher.sourceImage')}</span>
            <span>{t(dict, 'tools.photoCipher.anyFormat')}</span>
          {/if}
          <input id="photo-file" bind:this={fileInput} type="file" accept="image/*" on:change={handleImageFile} class="sr-only" />
        </label>
        <p class="hint">{t(dict, 'tools.photoCipher.robustBadge')}</p>
      </div>
      {#if capacity > 0 && mode === 'encode'}
        <p class="hint">{t(dict, 'tools.photoCipher.capacityLabel')} <span class="font-mono text-text">~{capacity}</span> {t(dict, 'tools.photoCipher.chars')}</p>
      {/if}
      {#if status}
        <p class="status" role="status">{status}</p>
      {/if}
    </div>

    <div class="stack">
      {#if mode === 'encode'}
        <div class="field">
          <label class="label" for="photo-message">{t(dict, 'tools.photoCipher.secretMessage')}</label>
          <textarea id="photo-message" bind:value={message} placeholder={t(dict, 'tools.photoCipher.messagePlaceholder')} class="input" spellcheck="false" autocomplete="off" autocapitalize="off"></textarea>
        </div>
        <div class="field">
          <label class="label" for="photo-password">{t(dict, 'tools.photoCipher.securityPassword')}</label>
          <input id="photo-password" type="password" bind:value={password} placeholder={t(dict, 'tools.photoCipher.encPasswordPlaceholder')} class="input" autocomplete="new-password" spellcheck="false" autocapitalize="off" data-lpignore="true" data-1p-ignore />
        </div>
        <button type="button" on:click={encode} class="btn w-full" disabled={processing}>
          {processing ? t(dict, 'tools.photoCipher.embedding') : t(dict, 'tools.photoCipher.burnIntoPixels')}
        </button>
        {#if encodedImageUrl}
          <button type="button" on:click={downloadEncoded} class="btn-secondary w-full">{t(dict, 'tools.photoCipher.downloadEncoded')}</button>
        {/if}
      {:else}
        <div class="field">
          <label class="label" for="photo-password">{t(dict, 'tools.photoCipher.securityPassword')}</label>
          <input id="photo-password" type="password" bind:value={password} placeholder={t(dict, 'tools.photoCipher.decPasswordPlaceholder')} class="input" autocomplete="current-password" spellcheck="false" autocapitalize="off" data-lpignore="true" data-1p-ignore />
        </div>
        <button type="button" on:click={decode} class="btn w-full" disabled={processing}>
          {processing ? t(dict, 'tools.photoCipher.extracting') : t(dict, 'tools.photoCipher.extractFromPixels')}
        </button>
        {#if decodedMessage}
          <div class="field">
            <div class="output-head">
              <span class="label" id="photo-out-label">{t(dict, 'tools.photoCipher.foundMessage')}</span>
              <CopyButton text={decodedMessage} label={t(dict, 'common.copy')} copiedLabel={t(dict, 'common.copied')} />
            </div>
            <output class="output output--ok min-h-32 break-words" aria-labelledby="photo-out-label" aria-live="polite">{decodedMessage}</output>
          </div>
        {/if}
      {/if}
    </div>
  </div>
</div>
