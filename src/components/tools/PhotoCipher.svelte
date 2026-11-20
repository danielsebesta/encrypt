<script lang="ts">
  import Button from '../ui/Button.svelte';
  import Field from '../ui/Field.svelte';
  import Tabs from '../ui/Tabs.svelte';
  import { focusFirstInvalid } from '../../lib/focusInvalid';
  import { checkRoomPassword, passwordLongEnough } from '../../lib/chatRoomSettings';
  import { generatePassphrase } from '../../lib/passphrase';
  import { sealPassword, openPassword, stripFixedHeader, restoreFixedHeader } from '../../lib/passwordEnvelope';
  import { t } from '../../lib/t';
  import Icon from '../Icon.svelte';
  import PassphraseField from '../PassphraseField.svelte';
  import PasswordChecklist from '../PasswordChecklist.svelte';
  import ToolResult from './ToolResult.svelte';
  import ToolStatus from './ToolStatus.svelte';

  export let dict: Record<string, string>;

  const BLOCK = 8;
  const DELTA = 24;
  const REP = 7;
  const MAGIC = 'PCP2';
  const COMPACT_MAGIC = 'PCP3';
  const PUBLIC_SEED = 0x50435032;
  const HEADER_SIZE = 8;
  // A new seal also carries the ECP4 compact envelope with its fixed header stripped: 8 salt + 8 tag bytes survive
  // on top of the message, where the full password envelope spent 92, so the same photo carries several times more.
  const CIPHER_OVERHEAD = 16;
  const MAX_FILE = 10 * 1024 * 1024;
  const MIN_DIM = 800;
  const MAX_DIM = 2048;

  $: passwordChecks = checkRoomPassword(password, '');
  $: passwordRules = [
    { ok: passwordChecks.length, label: t(dict, 'common.passwordRuleLength') },
    { ok: passwordChecks.variety, label: t(dict, 'common.passwordRuleVariety') },
    { ok: passwordChecks.strength, label: t(dict, 'common.passwordRuleStrength') },
  ];
  $: multiEncode = mode === 'encode' && imageFiles.length > 1;
  $: passwordError = attempted && !password ? t(dict, 'common.fieldRequired') : attempted && mode === 'encode' && !passwordLongEnough(password) ? t(dict, 'common.passwordTooShort') : '';
  $: messageError = attempted && !message ? t(dict, 'common.fieldRequired') : '';
  $: imageError = attempted && !imageFiles.length ? t(dict, 'common.fieldRequired') : '';

  function say(text: string, tone: 'info' | 'ok' | 'warn' | 'error' = 'info') {
    status = text;
    statusTone = tone;
  }

  let imageFiles: File[] = [];
  let imageUrl: string | null = null;
  let message = '';
  let password = '';
  let fileInput: HTMLInputElement;
  let status = '';
  let statusTone: 'info' | 'ok' | 'warn' | 'error' = 'info';
  let attempted = false;
  let panelEl: HTMLElement;
  let mode: 'encode' | 'decode' = 'encode';
  let decodedMessage = '';
  let encodedImageUrl: string | null = null;
  let capacity = 0;
  let processing = false;
  let imgW = 0;
  let imgH = 0;

  function xorshift32(seed: number) {
    let s = seed || 1;
    return () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return s >>> 0; };
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

  function cipherCapacity(blocks: number): number {
    return Math.floor(blocks / (8 * REP)) - HEADER_SIZE;
  }

  function maxChars(w: number, h: number): number {
    return Math.max(0, cipherCapacity(Math.floor(w / BLOCK) * Math.floor(h / BLOCK)) - CIPHER_OVERHEAD);
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

  function loadImageFromFile(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Image failed to load'));
      };
      img.src = url;
    });
  }

  function setMode(next: 'encode' | 'decode') {
    if (mode === next) return;
    mode = next;
    imageFiles = [];
    imageUrl = null;
    encodedImageUrl = null;
    decodedMessage = '';
    capacity = 0;
    imgW = 0;
    imgH = 0;
    status = '';
    attempted = false;
    if (fileInput) fileInput.value = '';
  }

  async function handleImageFile(e: Event) {
    const picked = (e.target as HTMLInputElement).files
      ? Array.from((e.target as HTMLInputElement).files!)
      : [];
    imageFiles = [];
    imageUrl = null;
    encodedImageUrl = null;
    decodedMessage = '';
    capacity = 0;
    imgW = 0;
    imgH = 0;
    if (!picked.length) return;

    if (mode === 'decode') {
      const f = picked[0];
      if (f.size > MAX_FILE) {
        say(t(dict, 'tools.photoCipher.imageTooLarge'), 'error');
        return;
      }
      try {
        const img = await loadImageFromFile(f);
        const norm = normalizeToCanvas(img, false);
        imgW = norm.width;
        imgH = norm.height;
        imageUrl = norm.toDataURL('image/png');
        imageFiles = [f];
        capacity = maxChars(imgW, imgH);
        say(t(dict, 'tools.photoCipher.imageLoaded')
          .replace('{w}', String(imgW))
          .replace('{h}', String(imgH))
          .replace('{chars}', String(capacity)));
      } catch {
        say(t(dict, 'tools.photoCipher.imageLoadFailed'), 'error');
      }
      return;
    }

    const ok: File[] = [];
    let skipped = 0;
    for (const f of picked) {
      if (f.size > MAX_FILE) skipped++;
      else ok.push(f);
    }
    if (!ok.length) {
      say(t(dict, 'tools.photoCipher.imageTooLarge'), 'error');
      return;
    }
    try {
      const img = await loadImageFromFile(ok[0]);
      const norm = normalizeToCanvas(img, true);
      imgW = norm.width;
      imgH = norm.height;
      imageUrl = norm.toDataURL('image/png');
      imageFiles = ok;
      capacity = maxChars(imgW, imgH);
      const loaded = ok.length === 1
        ? t(dict, 'tools.photoCipher.imageLoaded')
          .replace('{w}', String(imgW))
          .replace('{h}', String(imgH))
          .replace('{chars}', String(capacity))
        : t(dict, 'tools.photoCipher.batchSelected').replace('{count}', String(ok.length));
      if (skipped) say(`${loaded} ${t(dict, 'tools.photoCipher.imageTooLarge')}`, 'warn');
      else say(loaded);
    } catch {
      say(t(dict, 'tools.photoCipher.imageLoadFailed'), 'error');
      imageFiles = [];
      capacity = 0;
    }
  }

  async function encodeOne(file: File): Promise<string> {
    const img = await loadImageFromFile(file);
    const norm = normalizeToCanvas(img, true);
    const ctx = norm.getContext('2d')!;
    const imageData = ctx.getImageData(0, 0, norm.width, norm.height);
    const px = imageData.data;
    const bx = norm.width / BLOCK;
    const by = norm.height / BLOCK;
    const total = bx * by;

    // The compact envelope, with its fixed header stripped the way the chat cipher does it: blocks are the budget,
    // and the 92-byte full envelope used to swallow what a photo could say.
    const cipher = await sealPassword(new TextEncoder().encode(message), password, { compact: true });
    const encoded = stripFixedHeader(cipher, true);
    const magic = new TextEncoder().encode(COMPACT_MAGIC);
    const len = encoded.length;
    const payload = new Uint8Array(HEADER_SIZE + len);
    payload.set(magic, 0);
    payload[4] = (len >> 24) & 0xff;
    payload[5] = (len >> 16) & 0xff;
    payload[6] = (len >> 8) & 0xff;
    payload[7] = len & 0xff;
    payload.set(encoded, HEADER_SIZE);

    const bits = bytesToBits(payload);
    const expanded: number[] = [];
    for (const b of bits) for (let r = 0; r < REP; r++) expanded.push(b);

    if (expanded.length > total) throw new Error('tooLong');

    const order = shuffledOrder(total, PUBLIC_SEED);
    await new Promise(r => setTimeout(r, 0));
    for (let i = 0; i < expanded.length; i++) {
      const idx = order[i];
      qimEmbed(px, idx % bx, Math.floor(idx / bx), norm.width, expanded[i]);
    }

    ctx.putImageData(imageData, 0, 0);
    return norm.toDataURL('image/png');
  }

  function downloadDataUrl(dataUrl: string, filename: string) {
    const a = document.createElement('a');
    a.download = filename;
    a.href = dataUrl;
    a.click();
  }

  function outName(file: File, index: number): string {
    const base = file.name.replace(/\.[^.]+$/, '') || 'photo-cipher';
    return imageFiles.length > 1 ? `${base}-cipher-${index + 1}.png` : `${base}-cipher.png`;
  }

  async function encode() {
    attempted = true;
    if (!imageFiles.length || !message || !password || !passwordLongEnough(password)) {
      void focusFirstInvalid(panelEl);
      return;
    }
    processing = true;
    encodedImageUrl = null;
    const total = imageFiles.length;
    let ok = 0;
    let failed = 0;
    for (let i = 0; i < total; i++) {
      say(t(dict, 'tools.photoCipher.batchProgress')
        .replace('{current}', String(i + 1))
        .replace('{total}', String(total)));
      try {
        const dataUrl = await encodeOne(imageFiles[i]);
        downloadDataUrl(dataUrl, outName(imageFiles[i], i));
        ok++;
        if (total === 1 || i === total - 1) encodedImageUrl = dataUrl;
      } catch (e) {
        failed++;
        if (total === 1) {
          const msg = (e as Error)?.message;
          say(msg === 'tooLong' || msg === 'Input too large'
            ? t(dict, 'tools.photoCipher.messageTooLong')
            : t(dict, 'tools.photoCipher.encryptionFailed'), 'error');
          processing = false;
          return;
        }
      }
      if (total > 1) await new Promise((r) => setTimeout(r, 120));
    }
    if (failed === 0) {
      say(total === 1
        ? t(dict, 'tools.photoCipher.messageHidden')
        : t(dict, 'tools.photoCipher.batchDone')
          .replace('{ok}', String(ok))
          .replace('{total}', String(total)), 'ok');
    } else {
      say(t(dict, 'tools.photoCipher.batchPartial')
        .replace('{ok}', String(ok))
        .replace('{total}', String(total))
        .replace('{failed}', String(failed)), 'warn');
    }
    processing = false;
  }

  function downloadEncoded() {
    if (!encodedImageUrl) return;
    const name = imageFiles[0] ? outName(imageFiles[0], 0) : 'photo-cipher.png';
    downloadDataUrl(encodedImageUrl, name);
  }

  async function decode() {
    attempted = true;
    if (!imageUrl || !password) {
      void focusFirstInvalid(panelEl);
      return;
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
        say(t(dict, 'tools.photoCipher.imageTooSmall'), 'error'); processing = false; return;
      }

      say(t(dict, 'tools.photoCipher.extracting'));
      // The layout is public; password guesses must pass the envelope's Argon2id.
      const order = shuffledOrder(total, PUBLIC_SEED);
      const data: number[] = [];
      for (let i = 0; i < Math.floor(total / REP); i++) {
        let ones = 0;
        for (let r = 0; r < REP; r++) {
          const idx = order[i * REP + r];
          ones += qimExtract(px, idx % bxCount, Math.floor(idx / bxCount), norm.width);
        }
        data.push(ones > REP / 2 ? 1 : 0);
      }
      const prefix = new TextDecoder().decode(bitsToBytes(data.slice(0, 32)));
      if (prefix !== MAGIC && prefix !== COMPACT_MAGIC) {
        say(t(dict, 'tools.photoCipher.noHiddenMessage'), 'error'); processing = false; return;
      }

      const lenBytes = bitsToBytes(data.slice(32, 64));
      const payloadLen = (lenBytes[0] << 24) | (lenBytes[1] << 16) | (lenBytes[2] << 8) | lenBytes[3];
      if (payloadLen <= 0 || 64 + payloadLen * 8 > data.length) {
        say(t(dict, 'tools.photoCipher.corrupted'), 'error'); processing = false; return;
      }

      const cipherBytes = bitsToBytes(data.slice(64, 64 + payloadLen * 8));
      say(t(dict, 'tools.photoCipher.decrypting'));
      if (prefix === COMPACT_MAGIC) {
        decodedMessage = new TextDecoder().decode(await openPassword(restoreFixedHeader(cipherBytes, true), password));
      } else {
        decodedMessage = new TextDecoder().decode(await openPassword(cipherBytes, password));
      }
      say(t(dict, 'tools.photoCipher.decryptSuccess'), 'ok');
    } catch {
      say(t(dict, 'tools.photoCipher.decryptFailed'), 'error');
      decodedMessage = '';
    }
    processing = false;
  }
</script>
<div class="stack" bind:this={panelEl}>
  <Tabs items={[{ id: 'encode', label: t(dict, 'tools.photoCipher.encode') }, { id: 'decode', label: t(dict, 'tools.photoCipher.decode') }]} value={mode} label={t(dict, 'tools.photoCipher.h1')} idBase="photo" panelClass="grid items-start gap-6 md:grid-cols-2" onchange={setMode}>
    <div class="stack">
      <Field label={t(dict, 'tools.photoCipher.sourceImage')} hint={t(dict, 'tools.photoCipher.robustBadge')} error={imageError} required>
        {#snippet children(control)}
          <div class="dropzone aspect-video" class:dropzone--active={!!imageUrl}>
            {#if encodedImageUrl && !multiEncode}
              <img src={encodedImageUrl} alt={t(dict, 'tools.photoCipher.encodedAlt')} />
            {:else if imageUrl}
              <img src={imageUrl} alt={t(dict, 'tools.photoCipher.previewAlt')} />
            {:else}
              <Icon name="camera" size={20} />
              <span class="dropzone__title">{t(dict, 'tools.photoCipher.sourceImage')}</span>
              <span>{mode === 'encode' ? t(dict, 'tools.photoCipher.batchHint') : t(dict, 'tools.photoCipher.anyFormat')}</span>
            {/if}
            <input {...control} bind:this={fileInput} type="file" accept="image/*" multiple={mode === 'encode'} on:change={handleImageFile} class="sr-only" />
            <label class="absolute inset-0 cursor-pointer" for={control.id} aria-hidden="true"></label>
          </div>
        {/snippet}
      </Field>
      {#if multiEncode}
        <p class="hint">{t(dict, 'tools.photoCipher.batchSelected').replace('{count}', String(imageFiles.length))}</p>
      {/if}
      {#if capacity > 0 && mode === 'encode' && !multiEncode}
        <p class="hint">{t(dict, 'tools.photoCipher.capacityLabel')} <span class="font-mono text-text">~{capacity}</span> {t(dict, 'tools.photoCipher.chars')}</p>
      {/if}
      {#if status}
        <ToolStatus tone={processing ? 'busy' : statusTone}>{status}</ToolStatus>
      {/if}
    </div>

    <form class="stack" novalidate on:submit|preventDefault={mode === 'encode' ? encode : decode}>
      {#if mode === 'encode'}
        <Field label={t(dict, 'tools.photoCipher.secretMessage')} error={messageError} required>
          {#snippet children(control)}
            <textarea {...control} bind:value={message} placeholder={t(dict, 'tools.photoCipher.messagePlaceholder')} class="input" spellcheck="false" autocomplete="off" autocapitalize="off"></textarea>
          {/snippet}
        </Field>
        <Field label={t(dict, 'tools.photoCipher.securityPassword')} error={passwordError} required>
          {#snippet children(control)}
            <PassphraseField {dict} id={control.id} bind:value={password} placeholder={t(dict, 'tools.photoCipher.encPasswordPlaceholder')} describedby={[control['aria-describedby'], 'photo-password-rules'].filter(Boolean).join(' ')} invalid={!!passwordError} generate={generatePassphrase} />
            <PasswordChecklist id="photo-password-rules" label={t(dict, 'common.passwordRules')} rules={passwordRules} {dict} />
          {/snippet}
        </Field>
        <Button type="submit" block busy={processing}>{t(dict, 'tools.photoCipher.burnIntoPixels')}</Button>
        {#if encodedImageUrl && !multiEncode}
          <Button variant="secondary" block icon="download" onclick={downloadEncoded}>{t(dict, 'tools.photoCipher.downloadEncoded')}</Button>
        {/if}
      {:else}
        <Field label={t(dict, 'tools.photoCipher.securityPassword')} error={passwordError} required>
          {#snippet children(control)}
            <input {...control} type="password" bind:value={password} placeholder={t(dict, 'tools.photoCipher.decPasswordPlaceholder')} class="input" autocomplete="current-password" spellcheck="false" autocapitalize="off" data-lpignore="true" data-1p-ignore />
          {/snippet}
        </Field>
        <Button type="submit" block busy={processing}>{t(dict, 'tools.photoCipher.extractFromPixels')}</Button>
        {#if decodedMessage}
          <ToolResult {dict} id="photo-out" label={t(dict, 'tools.photoCipher.foundMessage')} text={decodedMessage} prose class="min-h-32" />
        {/if}
      {/if}
    </form>
  </Tabs>
</div>
