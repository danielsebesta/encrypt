<script lang="ts">
  import { encrypt, decrypt as decryptMsg } from '../../lib/crypto';
  import { getTranslations, t } from '../../lib/i18n';

  export let locale = 'en';
  $: dict = getTranslations(locale);

  const BLOCK = 8;
  const DELTA = 24;
  const REP = 7;
  const MAGIC = 'PCPH';
  const HEADER_SIZE = 8;
  const CRYPTO_OVERHEAD = 44;
  const MAX_FILE = 10 * 1024 * 1024;

  let imageUrl: string | null = null;
  let message = '';
  let password = '';
  let canvas: HTMLCanvasElement;
  let fileInput: HTMLInputElement;
  let status = '';
  let mode: 'encode' | 'decode' = 'encode';
  let decodedMessage = '';
  let encodedImageUrl: string | null = null;
  let capacity = 0;
  let processing = false;

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

  async function handleImageFile(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    if (f.size > MAX_FILE) {
      status = t(dict, 'tools.photoCipher.imageTooLarge');
      imageUrl = null; encodedImageUrl = null; decodedMessage = ''; capacity = 0;
      return;
    }
    imageUrl = URL.createObjectURL(f);
    encodedImageUrl = null; decodedMessage = '';
    const img = new Image();
    img.onload = () => {
      capacity = maxChars(img.width, img.height);
      status = t(dict, 'tools.photoCipher.imageLoaded').replace('{chars}', String(capacity));
    };
    img.src = imageUrl;
  }

  async function encode() {
    if (!canvas || !imageUrl || !message || !password) {
      status = t(dict, 'tools.photoCipher.pleaseProvide'); return;
    }
    processing = true;
    const ctx = canvas.getContext('2d');
    if (!ctx) { processing = false; return; }

    const img = new Image();
    img.onload = async () => {
      try {
        canvas.width = img.width; canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const px = imageData.data;
        const bx = Math.floor(canvas.width / BLOCK);
        const by = Math.floor(canvas.height / BLOCK);
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
        const seed = await getSeed(password);
        const order = shuffledOrder(total, seed);

        await new Promise(r => setTimeout(r, 0));
        for (let i = 0; i < expanded.length; i++) {
          const idx = order[i];
          qimEmbed(px, idx % bx, Math.floor(idx / bx), canvas.width, expanded[i]);
        }

        ctx.putImageData(imageData, 0, 0);
        encodedImageUrl = canvas.toDataURL('image/png');
        status = t(dict, 'tools.photoCipher.messageHidden');
      } catch { status = t(dict, 'tools.photoCipher.encryptionFailed'); }
      processing = false;
    };
    img.src = imageUrl;
  }

  function downloadEncoded() {
    if (!encodedImageUrl) return;
    const a = document.createElement('a');
    a.download = 'photo-cipher.png';
    a.href = encodedImageUrl;
    a.click();
  }

  async function decode() {
    if (!canvas || !imageUrl || !password) {
      status = t(dict, 'tools.photoCipher.pleaseProvideImage'); return;
    }
    processing = true;
    const ctx = canvas.getContext('2d');
    if (!ctx) { processing = false; return; }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = async () => {
      try {
        canvas.width = img.width; canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const px = imageData.data;
        const bxCount = Math.floor(canvas.width / BLOCK);
        const byCount = Math.floor(canvas.height / BLOCK);
        const total = bxCount * byCount;

        if (total < HEADER_SIZE * 8 * REP) {
          status = t(dict, 'tools.photoCipher.imageTooSmall'); processing = false; return;
        }

        status = t(dict, 'tools.photoCipher.extracting');
        const seed = await getSeed(password);
        const order = shuffledOrder(total, seed);

        await new Promise(r => setTimeout(r, 0));
        const raw: number[] = new Array(total);
        for (let i = 0; i < total; i++) {
          const idx = order[i];
          raw[i] = qimExtract(px, idx % bxCount, Math.floor(idx / bxCount), canvas.width);
        }

        const maxBits = Math.floor(total / REP);
        const data: number[] = new Array(maxBits);
        for (let i = 0; i < maxBits; i++) {
          let ones = 0;
          const base = i * REP;
          for (let r = 0; r < REP; r++) ones += raw[base + r];
          data[i] = ones > REP / 2 ? 1 : 0;
        }

        const magicBytes = bitsToBytes(data.slice(0, 32));
        if (new TextDecoder().decode(magicBytes) !== MAGIC) {
          status = t(dict, 'tools.photoCipher.noHiddenMessage'); processing = false; return;
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
    };
    img.src = imageUrl;
  }
</script>

<div class="form space-y-6">
  <div class="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
    <button
      on:click={() => mode = 'encode'}
      class={`pb-2.5 px-4 text-sm font-medium transition-colors ${mode === 'encode' ? 'text-emerald-600 dark:text-emerald-400 border-b-2 border-emerald-500' : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300'}`}
    >
      {t(dict, 'tools.photoCipher.encode')}
    </button>
    <button
      on:click={() => mode = 'decode'}
      class={`pb-2.5 px-4 text-sm font-medium transition-colors ${mode === 'decode' ? 'text-emerald-600 dark:text-emerald-400 border-b-2 border-emerald-500' : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300'}`}
    >
      {t(dict, 'tools.photoCipher.decode')}
    </button>
  </div>

  <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
    <div class="space-y-4">
      <input
        bind:this={fileInput}
        type="file"
        accept="image/*"
        on:change={handleImageFile}
        class="hidden"
      />
      <button
        type="button"
        on:click={triggerFileSelect}
        class="w-full border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl p-8 text-center bg-white dark:bg-zinc-900/40 hover:border-emerald-400 dark:hover:border-emerald-500/50 transition-colors cursor-pointer group aspect-video flex flex-col items-center justify-center overflow-hidden"
      >
        {#if encodedImageUrl}
          <img src={encodedImageUrl} alt="Encoded" class="max-h-full max-w-full object-contain" />
        {:else if imageUrl}
          <img src={imageUrl} alt="Preview" class="max-h-full max-w-full object-contain" />
        {:else}
          <div class="space-y-2">
            <div class="text-sm text-zinc-500 group-hover:text-emerald-500 transition-colors">
              {t(dict, 'tools.photoCipher.sourceImage')}
            </div>
            <div class="text-xs text-zinc-400 dark:text-zinc-600 italic">
              {t(dict, 'tools.photoCipher.anyFormat')}
            </div>
          </div>
        {/if}
      </button>

      {#if capacity > 0 && mode === 'encode'}
        <div class="flex items-center gap-2 text-xs">
          <span class="text-zinc-400">{t(dict, 'tools.photoCipher.capacityLabel')}</span>
          <span class="font-mono text-emerald-600 dark:text-emerald-400">~{capacity}</span>
          <span class="text-zinc-400">{t(dict, 'tools.photoCipher.chars')}</span>
        </div>
      {/if}

      {#if status}
        <div class="text-xs text-emerald-600 dark:text-emerald-400/80 italic">{status}</div>
      {/if}

      <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 text-[10px] font-medium text-emerald-700 dark:text-emerald-400 tracking-wide uppercase">
        {t(dict, 'tools.photoCipher.robustBadge')}
      </div>
    </div>

    <div class="space-y-4">
      {#if mode === 'encode'}
        <div class="grid gap-4">
          <div class="grid gap-1.5">
            <label class="text-xs text-zinc-500 dark:text-zinc-400">{t(dict, 'tools.photoCipher.secretMessage')}</label>
            <textarea
              bind:value={message}
              placeholder={t(dict, 'tools.photoCipher.messagePlaceholder')}
              class="input min-h-[120px] resize-none"
              spellcheck="false"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
            ></textarea>
          </div>
          <div class="grid gap-1.5">
            <label class="text-xs text-zinc-500 dark:text-zinc-400">{t(dict, 'tools.photoCipher.securityPassword')}</label>
            <input
              type="password"
              bind:value={password}
              placeholder={t(dict, 'tools.photoCipher.encPasswordPlaceholder')}
              class="input"
              autocomplete="new-password"
              spellcheck="false"
              autocorrect="off"
              autocapitalize="off"
              data-lpignore="true"
              data-1p-ignore
            />
          </div>
          <button on:click={encode} class="btn w-full" disabled={processing}>
            {processing ? t(dict, 'tools.photoCipher.embedding') : t(dict, 'tools.photoCipher.burnIntoPixels')}
          </button>
          {#if encodedImageUrl}
            <button on:click={downloadEncoded} class="btn-outline w-full">
              {t(dict, 'tools.photoCipher.downloadEncoded')}
            </button>
          {/if}
        </div>
      {:else}
        <div class="grid gap-4">
          <div class="grid gap-1.5">
            <label class="text-xs text-zinc-500 dark:text-zinc-400">{t(dict, 'tools.photoCipher.securityPassword')}</label>
            <input
              type="password"
              bind:value={password}
              placeholder={t(dict, 'tools.photoCipher.decPasswordPlaceholder')}
              class="input"
              autocomplete="current-password"
              spellcheck="false"
              autocorrect="off"
              autocapitalize="off"
              data-lpignore="true"
              data-1p-ignore
            />
          </div>
          <button on:click={decode} class="btn-outline w-full" disabled={processing}>
            {processing ? t(dict, 'tools.photoCipher.extracting') : t(dict, 'tools.photoCipher.extractFromPixels')}
          </button>
          {#if decodedMessage}
            <div class="grid gap-1.5">
              <label class="text-xs text-zinc-500 dark:text-zinc-400">{t(dict, 'tools.photoCipher.foundMessage')}</label>
              <div class="p-4 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/30 rounded-lg text-emerald-700 dark:text-emerald-400 font-mono text-sm min-h-[120px] break-words">
                {decodedMessage}
              </div>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <canvas bind:this={canvas} class="hidden"></canvas>
</div>
