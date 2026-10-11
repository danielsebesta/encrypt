<script lang="ts">
  import { encrypt, decrypt as decryptMsg } from '../../lib/aesGcm';
  import { t } from '../../lib/t';
  import CopyButton from '../CopyButton.svelte';

  export let locale = 'en';
  export let dict: Record<string, string>;

  let imageFile: File | null = null;
  let imageUrl: string | null = null;
  let message = '';
  let password = '';
  let canvas: HTMLCanvasElement;
  let fileInput: HTMLInputElement;
  let status = '';
  let mode: 'encode' | 'decode' = 'encode';
  let decodedMessage = '';
  const MAX_BYTES = 10 * 1024 * 1024;

  function triggerFileSelect() {
    fileInput?.click();
  }

  async function handleImageFile(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files[0]) {
      imageFile = target.files[0];
      if (imageFile.size > MAX_BYTES) {
        status = t(dict, 'tools.steganography.imageTooLarge');
        imageUrl = null;
        encodedImageUrl = null;
        decodedMessage = '';
        return;
      }
      imageUrl = URL.createObjectURL(imageFile);
      encodedImageUrl = null;
      status = t(dict, 'tools.steganography.imageLoaded');
      decodedMessage = '';
    }
  }
  let encodedImageUrl: string | null = null;
  async function encode() {
    if (!canvas || !imageUrl || !message || !password) {
      status = t(dict, 'tools.steganography.pleaseProvide');
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.onload = async () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const MAGIC = 'ECMD';
      let msgBytes: Uint8Array;
      try {
        status = t(dict, 'tools.steganography.encryptingMessage');
        msgBytes = await encrypt(message, password);
      } catch (e) {
        status = t(dict, 'tools.steganography.encryptionFailed');
        return;
      }
      const magicBytes = new TextEncoder().encode(MAGIC);
      const length = msgBytes.length;
      const totalRequiredBits = (magicBytes.length + 4 + msgBytes.length) * 8;
      if (totalRequiredBits > data.length * 0.75) {
        status = t(dict, 'tools.steganography.messageTooLong');
        return;
      }
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
      encodedImageUrl = canvas.toDataURL('image/png');
      status = t(dict, 'tools.steganography.messageHidden');
    };
    img.src = imageUrl;
  }
  function downloadEncoded() {
    if (!encodedImageUrl) return;
    const link = document.createElement('a');
    link.download = 'secret-image.png';
    link.href = encodedImageUrl;
    link.click();
  }
  function decode() {
    if (!canvas || !imageUrl || !password) {
      status = t(dict, 'tools.steganography.pleaseProvideImage');
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = async () => {
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
      try {
        const extractedMagic = new TextDecoder().decode(readBits(32));
        if (extractedMagic !== 'ECMD') {
          status = t(dict, 'tools.steganography.noHiddenMessage');
          return;
        }
        const lengthBytes = readBits(32);
        const lengthHeader = (lengthBytes[0] << 24) | (lengthBytes[1] << 16) | (lengthBytes[2] << 8) | lengthBytes[3];
        if (lengthHeader <= 0 || lengthHeader > (data.length / 8)) {
          status = t(dict, 'tools.steganography.corrupted');
          return;
        }
        const msgBytes = readBits(lengthHeader * 8);
        status = t(dict, 'tools.steganography.decryptingMessage');
        decodedMessage = await decryptMsg(msgBytes, password);
        status = t(dict, 'tools.steganography.decryptSuccess');
      } catch (e) {
        status = t(dict, 'tools.steganography.decryptFailed');
        decodedMessage = '';
      }
    };
    img.src = imageUrl;
  }
</script>
<div class="stack">
  <div class="tabs" role="tablist" aria-label={t(dict, 'tools.steganography.h1')}>
    <button type="button" role="tab" class="tab" aria-selected={mode === 'encode'} aria-controls="stego-panel" on:click={() => mode = 'encode'}>{t(dict, 'tools.steganography.encode')}</button>
    <button type="button" role="tab" class="tab" aria-selected={mode === 'decode'} aria-controls="stego-panel" on:click={() => mode = 'decode'}>{t(dict, 'tools.steganography.decode')}</button>
  </div>

  <div id="stego-panel" role="tabpanel" class="grid gap-6 md:grid-cols-2">
    <div class="stack">
      <div class="field">
        <span class="label">{t(dict, 'tools.steganography.sourceImage')}</span>
        <label class="dropzone aspect-video" class:dropzone--active={!!imageUrl} for="stego-file">
          {#if encodedImageUrl}
            <img src={encodedImageUrl} alt={t(dict, 'tools.steganography.encodedResultAlt')} />
          {:else if imageUrl}
            <img src={imageUrl} alt={t(dict, 'tools.steganography.previewAlt')} />
          {:else}
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
            <span class="dropzone__title">{t(dict, 'tools.steganography.sourceImage')}</span>
            <span>{t(dict, 'tools.steganography.pngRecommended')}</span>
          {/if}
          <input id="stego-file" bind:this={fileInput} type="file" accept="image/*" on:change={handleImageFile} class="sr-only" />
        </label>
      </div>
      {#if status}
        <p class="status" role="status">{status}</p>
      {/if}
    </div>

    <div class="stack">
      {#if mode === 'encode'}
        <div class="field">
          <label class="label" for="stego-message">{t(dict, 'tools.steganography.secretMessage')}</label>
          <textarea id="stego-message" bind:value={message} placeholder={t(dict, 'tools.steganography.messagePlaceholder')} class="input" spellcheck="false" autocomplete="off" autocapitalize="off"></textarea>
        </div>
        <div class="field">
          <label class="label" for="stego-password">{t(dict, 'tools.steganography.securityPassword')}</label>
          <input id="stego-password" type="password" bind:value={password} placeholder={t(dict, 'tools.steganography.encPasswordPlaceholder')} class="input" autocomplete="new-password" spellcheck="false" autocapitalize="off" data-lpignore="true" data-1p-ignore />
        </div>
        <button type="button" on:click={encode} class="btn w-full">{t(dict, 'tools.steganography.injectPixels')}</button>
        {#if encodedImageUrl}
          <button type="button" on:click={downloadEncoded} class="btn-secondary w-full">{t(dict, 'tools.steganography.downloadEncrypted')}</button>
        {/if}
      {:else}
        <div class="field">
          <label class="label" for="stego-password">{t(dict, 'tools.steganography.securityPassword')}</label>
          <input id="stego-password" type="password" bind:value={password} placeholder={t(dict, 'tools.steganography.decPasswordPlaceholder')} class="input" autocomplete="current-password" spellcheck="false" autocapitalize="off" data-lpignore="true" data-1p-ignore />
        </div>
        <button type="button" on:click={decode} class="btn w-full">{t(dict, 'tools.steganography.scanPixels')}</button>
        {#if decodedMessage}
          <div class="field">
            <div class="output-head">
              <span class="label" id="stego-out-label">{t(dict, 'tools.steganography.foundMessage')}</span>
              <CopyButton text={decodedMessage} label={t(dict, 'common.copy')} copiedLabel={t(dict, 'common.copied')} />
            </div>
            <output class="output output--ok min-h-32 break-words" aria-labelledby="stego-out-label" aria-live="polite">{decodedMessage}</output>
          </div>
        {/if}
      {/if}
    </div>
  </div>
  <canvas bind:this={canvas} class="hidden"></canvas>
</div>
