<script lang="ts">
  import Button from '../ui/Button.svelte';
  import Field from '../ui/Field.svelte';
  import Tabs from '../ui/Tabs.svelte';
  import { focusFirstInvalid } from '../../lib/focusInvalid';
  import { encrypt, decrypt as decryptMsg } from '../../lib/aesGcm';
  import { checkRoomPassword, passwordLongEnough } from '../../lib/chatRoomSettings';
  import { generatePassphrase } from '../../lib/passphrase';
  import { t } from '../../lib/t';
  import Icon from '../Icon.svelte';
  import PassphraseField from '../PassphraseField.svelte';
  import PasswordChecklist from '../PasswordChecklist.svelte';
  import ToolResult from './ToolResult.svelte';
  import ToolStatus from './ToolStatus.svelte';

  export let dict: Record<string, string>;

  let imageFiles: File[] = [];
  let imageUrl: string | null = null;
  let message = '';
  let password = '';
  let canvas: HTMLCanvasElement;
  let fileInput: HTMLInputElement;
  let status = '';
  let statusTone: 'info' | 'ok' | 'warn' | 'error' = 'info';
  let attempted = false;
  let panelEl: HTMLElement;
  let mode: 'encode' | 'decode' = 'encode';
  let decodedMessage = '';
  let encodedImageUrl: string | null = null;
  let processing = false;
  const MAX_BYTES = 10 * 1024 * 1024;
  const MAGIC = 'ECMD';

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

  function revokePreview() {
    if (imageUrl?.startsWith('blob:')) URL.revokeObjectURL(imageUrl);
  }

  function setMode(next: 'encode' | 'decode') {
    if (mode === next) return;
    mode = next;
    revokePreview();
    imageFiles = [];
    imageUrl = null;
    encodedImageUrl = null;
    decodedMessage = '';
    status = '';
    attempted = false;
    if (fileInput) fileInput.value = '';
  }

  function handleImageFile(e: Event) {
    const target = e.target as HTMLInputElement;
    const picked = target.files ? Array.from(target.files) : [];
    revokePreview();
    imageFiles = [];
    imageUrl = null;
    encodedImageUrl = null;
    decodedMessage = '';
    if (!picked.length) return;

    if (mode === 'decode') {
      const file = picked[0];
      if (file.size > MAX_BYTES) {
        say(t(dict, 'tools.steganography.imageTooLarge'), 'error');
        return;
      }
      imageFiles = [file];
      imageUrl = URL.createObjectURL(file);
      say(t(dict, 'tools.steganography.imageLoaded'));
      return;
    }

    const ok: File[] = [];
    let skipped = 0;
    for (const file of picked) {
      if (file.size > MAX_BYTES) skipped++;
      else ok.push(file);
    }
    if (!ok.length) {
      say(t(dict, 'tools.steganography.imageTooLarge'), 'error');
      return;
    }
    imageFiles = ok;
    imageUrl = URL.createObjectURL(ok[0]);
    const loaded = ok.length === 1
      ? t(dict, 'tools.steganography.imageLoaded')
      : t(dict, 'tools.steganography.batchSelected').replace('{count}', String(ok.length));
    if (skipped) say(`${loaded} ${t(dict, 'tools.steganography.imageTooLarge')}`, 'warn');
    else say(loaded);
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
        reject(new Error('load'));
      };
      img.src = url;
    });
  }

  async function encodeIntoDataUrl(img: HTMLImageElement): Promise<string> {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('ctx');
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const msgBytes = await encrypt(message, password, Math.floor(data.length * 0.75 / 8) - 8);
    const magicBytes = new TextEncoder().encode(MAGIC);
    const length = msgBytes.length;
    const totalRequiredBits = (magicBytes.length + 4 + msgBytes.length) * 8;
    if (totalRequiredBits > data.length * 0.75) throw new Error('tooLong');
    const fullData = new Uint8Array(magicBytes.length + 4 + msgBytes.length);
    fullData.set(magicBytes, 0);
    fullData[4] = (length >> 24) & 0xff;
    fullData[5] = (length >> 16) & 0xff;
    fullData[6] = (length >> 8) & 0xff;
    fullData[7] = length & 0xff;
    fullData.set(msgBytes, 8);
    let bitIdx = 0;
    for (let i = 0; i < fullData.length; i++) {
      for (let bit = 7; bit >= 0; bit--) {
        const pixelIdx = Math.floor(bitIdx / 3);
        const channelIdx = bitIdx % 3;
        const byteIdx = pixelIdx * 4 + channelIdx;
        const bitVal = (fullData[i] >> bit) & 1;
        data[byteIdx] = (data[byteIdx] & 0xfe) | bitVal;
        data[pixelIdx * 4 + 3] = 255;
        bitIdx++;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  }

  function downloadDataUrl(dataUrl: string, filename: string) {
    const link = document.createElement('a');
    link.download = filename;
    link.href = dataUrl;
    link.click();
  }

  function outName(file: File, index: number): string {
    const base = file.name.replace(/\.[^.]+$/, '') || 'secret-image';
    return imageFiles.length > 1 ? `${base}-secret-${index + 1}.png` : `${base}-secret.png`;
  }

  async function encode() {
    attempted = true;
    if (!canvas || !imageFiles.length || !message || !password || !passwordLongEnough(password)) {
      void focusFirstInvalid(panelEl);
      return;
    }
    processing = true;
    encodedImageUrl = null;
    const total = imageFiles.length;
    let ok = 0;
    let failed = 0;
    for (let i = 0; i < total; i++) {
      say(t(dict, 'tools.steganography.batchProgress')
        .replace('{current}', String(i + 1))
        .replace('{total}', String(total)));
      try {
        const img = await loadImageFromFile(imageFiles[i]);
        const dataUrl = await encodeIntoDataUrl(img);
        downloadDataUrl(dataUrl, outName(imageFiles[i], i));
        ok++;
        if (total === 1) encodedImageUrl = dataUrl;
        else if (i === total - 1) encodedImageUrl = dataUrl;
      } catch (e) {
        failed++;
        if (total === 1) {
          say((e as Error)?.message === 'tooLong'
            ? t(dict, 'tools.steganography.messageTooLong')
            : t(dict, 'tools.steganography.encryptionFailed'), 'error');
          processing = false;
          return;
        }
      }
      if (total > 1) await new Promise((r) => setTimeout(r, 120));
    }
    if (failed === 0) {
      say(total === 1
        ? t(dict, 'tools.steganography.messageHidden')
        : t(dict, 'tools.steganography.batchDone')
          .replace('{ok}', String(ok))
          .replace('{total}', String(total)), 'ok');
    } else {
      say(t(dict, 'tools.steganography.batchPartial')
        .replace('{ok}', String(ok))
        .replace('{total}', String(total))
        .replace('{failed}', String(failed)), 'warn');
    }
    processing = false;
  }

  function downloadEncoded() {
    if (!encodedImageUrl) return;
    const name = imageFiles[0] ? outName(imageFiles[0], 0) : 'secret-image.png';
    downloadDataUrl(encodedImageUrl, name);
  }

  function decode() {
    attempted = true;
    if (!canvas || !imageUrl || !password) {
      void focusFirstInvalid(panelEl);
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    decodedMessage = '';
    processing = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = async () => {
      try {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        let bitIdx = 0;
        function readBits(count: number): Uint8Array {
          const bytes = new Uint8Array(Math.ceil(count / 8));
          for (let i = 0; i < count; i++) {
            const pixelIdx = Math.floor(bitIdx / 3);
            const channelIdx = bitIdx % 3;
            const byteIdx = pixelIdx * 4 + channelIdx;
            const bitVal = data[byteIdx] & 1;
            const bytePos = Math.floor(i / 8);
            const bitPos = 7 - (i % 8);
            bytes[bytePos] |= (bitVal << bitPos);
            bitIdx++;
          }
          return bytes;
        }
        const extractedMagic = new TextDecoder().decode(readBits(32));
        if (extractedMagic !== MAGIC) {
          say(t(dict, 'tools.steganography.noHiddenMessage'), 'error');
          return;
        }
        const lengthBytes = readBits(32);
        const lengthHeader = (lengthBytes[0] << 24) | (lengthBytes[1] << 16) | (lengthBytes[2] << 8) | lengthBytes[3];
        if (lengthHeader <= 0 || lengthHeader > (data.length / 8)) {
          say(t(dict, 'tools.steganography.corrupted'), 'error');
          return;
        }
        const msgBytes = readBits(lengthHeader * 8);
        say(t(dict, 'tools.steganography.decryptingMessage'));
        decodedMessage = await decryptMsg(msgBytes, password);
        say(t(dict, 'tools.steganography.decryptSuccess'), 'ok');
      } catch (e) {
        say(t(dict, 'tools.steganography.decryptFailed'), 'error');
        decodedMessage = '';
      } finally {
        processing = false;
      }
    };
    img.onerror = () => {
      say(t(dict, 'tools.steganography.decryptFailed'), 'error');
      processing = false;
    };
    img.src = imageUrl;
  }
</script>
<div class="stack" bind:this={panelEl}>
  <Tabs items={[{ id: 'encode', label: t(dict, 'tools.steganography.encode') }, { id: 'decode', label: t(dict, 'tools.steganography.decode') }]} value={mode} label={t(dict, 'tools.steganography.h1')} idBase="stego" panelClass="grid items-start gap-6 md:grid-cols-2" onchange={setMode}>
    <div class="stack">
      <Field label={t(dict, 'tools.steganography.sourceImage')} error={imageError} required>
        {#snippet children(control)}
          <div class="dropzone aspect-video" class:dropzone--active={!!imageUrl}>
            {#if encodedImageUrl && !multiEncode}
              <img src={encodedImageUrl} alt={t(dict, 'tools.steganography.encodedResultAlt')} />
            {:else if imageUrl}
              <img src={imageUrl} alt={t(dict, 'tools.steganography.previewAlt')} />
            {:else}
              <Icon name="image" size={20} />
              <span class="dropzone__title">{t(dict, 'tools.steganography.sourceImage')}</span>
              <span>{mode === 'encode' ? t(dict, 'tools.steganography.batchHint') : t(dict, 'tools.steganography.pngRecommended')}</span>
            {/if}
            <input {...control} bind:this={fileInput} type="file" accept="image/*" multiple={mode === 'encode'} on:change={handleImageFile} class="sr-only" />
            <label class="absolute inset-0 cursor-pointer" for={control.id} aria-hidden="true"></label>
          </div>
        {/snippet}
      </Field>
      {#if multiEncode}
        <p class="hint">{t(dict, 'tools.steganography.batchSelected').replace('{count}', String(imageFiles.length))}</p>
      {/if}
      {#if status}
        <ToolStatus tone={processing ? 'busy' : statusTone}>{status}</ToolStatus>
      {/if}
    </div>

    <form class="stack" novalidate on:submit|preventDefault={mode === 'encode' ? encode : decode}>
      {#if mode === 'encode'}
        <Field label={t(dict, 'tools.steganography.secretMessage')} error={messageError} required>
          {#snippet children(control)}
            <textarea {...control} bind:value={message} placeholder={t(dict, 'tools.steganography.messagePlaceholder')} class="input" spellcheck="false" autocomplete="off" autocapitalize="off"></textarea>
          {/snippet}
        </Field>
        <Field label={t(dict, 'tools.steganography.securityPassword')} error={passwordError} required>
          {#snippet children(control)}
            <PassphraseField {dict} id={control.id} bind:value={password} placeholder={t(dict, 'tools.steganography.encPasswordPlaceholder')} describedby={[control['aria-describedby'], 'stego-password-rules'].filter(Boolean).join(' ')} invalid={!!passwordError} generate={generatePassphrase} />
            <PasswordChecklist id="stego-password-rules" label={t(dict, 'common.passwordRules')} rules={passwordRules} {dict} />
          {/snippet}
        </Field>
        <Button type="submit" block busy={processing}>{t(dict, 'tools.steganography.injectPixels')}</Button>
        {#if encodedImageUrl && !multiEncode}
          <Button variant="secondary" block icon="download" onclick={downloadEncoded}>{t(dict, 'tools.steganography.downloadEncrypted')}</Button>
        {/if}
      {:else}
        <Field label={t(dict, 'tools.steganography.securityPassword')} error={passwordError} required>
          {#snippet children(control)}
            <input {...control} type="password" bind:value={password} placeholder={t(dict, 'tools.steganography.decPasswordPlaceholder')} class="input" autocomplete="current-password" spellcheck="false" autocapitalize="off" data-lpignore="true" data-1p-ignore />
          {/snippet}
        </Field>
        <Button type="submit" block busy={processing}>{t(dict, 'tools.steganography.scanPixels')}</Button>
        {#if decodedMessage}
          <ToolResult {dict} id="stego-out" label={t(dict, 'tools.steganography.foundMessage')} text={decodedMessage} prose class="min-h-32" />
        {/if}
      {/if}
    </form>
  </Tabs>
  <canvas bind:this={canvas} class="hidden"></canvas>
</div>
