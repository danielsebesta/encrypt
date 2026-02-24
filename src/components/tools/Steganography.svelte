<script lang="ts">
  import { encrypt, decrypt as decryptMsg } from '../../lib/crypto';
  let imageFile: File | null = null;
  let imageUrl: string | null = null;
  let message = '';
  let password = '';
  let canvas: HTMLCanvasElement;
  let status = '';
  let mode: 'encode' | 'decode' = 'encode';
  let decodedMessage = '';
  const MAX_BYTES = 10 * 1024 * 1024;
  async function handleImageFile(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files[0]) {
      imageFile = target.files[0];
      if (imageFile.size > MAX_BYTES) {
        status = 'Image too large. Please keep under 10 MB.';
        imageUrl = null;
        encodedImageUrl = null;
        decodedMessage = '';
        return;
      }
      imageUrl = URL.createObjectURL(imageFile);
      encodedImageUrl = null;
      status = 'Image loaded.';
      decodedMessage = '';
    }
  }
  let encodedImageUrl: string | null = null;
  async function encode() {
    if (!canvas || !imageUrl || !message || !password) {
      status = 'Please provide an image, a message, and a password.';
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
        status = 'Encrypting message...';
        msgBytes = await encrypt(message, password);
      } catch (e) {
        status = 'Encryption failed.';
        return;
      }
      const magicBytes = new TextEncoder().encode(MAGIC);
      const length = msgBytes.length;
      const totalRequiredBits = (magicBytes.length + 4 + msgBytes.length) * 8;
      if (totalRequiredBits > data.length * 0.75) {
        status = 'Message too long for this image.';
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
      status = 'Message encrypted & hidden! Download below.';
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
      status = 'Please provide an image and the password.';
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
          status = 'No hidden message found (invalid signature).';
          return;
        }
        const lengthBytes = readBits(32);
        const lengthHeader = (lengthBytes[0] << 24) | (lengthBytes[1] << 16) | (lengthBytes[2] << 8) | lengthBytes[3];
        if (lengthHeader <= 0 || lengthHeader > (data.length / 8)) {
          status = 'Hidden message appears corrupted.';
          return;
        }
        const msgBytes = readBits(lengthHeader * 8);
        status = 'Decrypting hidden message...';
        decodedMessage = await decryptMsg(msgBytes, password);
        status = 'Message successfully decrypted!';
      } catch (e) {
        status = 'Failed to decrypt. Wrong password or corrupted bits.';
        decodedMessage = '';
      }
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
      Encode
    </button>
    <button
      on:click={() => mode = 'decode'}
      class={`pb-2.5 px-4 text-sm font-medium transition-colors ${mode === 'decode' ? 'text-emerald-600 dark:text-emerald-400 border-b-2 border-emerald-500' : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300'}`}
    >
      Decode
    </button>
  </div>

  <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
    <div class="space-y-4">
      <div class="border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl p-8 text-center bg-white dark:bg-zinc-900/40 hover:border-emerald-400 dark:hover:border-emerald-500/50 transition-colors relative group aspect-video flex flex-col items-center justify-center overflow-hidden">
        <input
          type="file"
          accept="image/*"
          on:change={handleImageFile}
          class="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
        />
        {#if encodedImageUrl}
          <img src={encodedImageUrl} alt="Encoded Result" class="max-h-full max-w-full object-contain" />
        {:else if imageUrl}
          <img src={imageUrl} alt="Preview" class="max-h-full max-w-full object-contain" />
        {:else}
          <div class="space-y-2 pointer-events-none">
            <div class="text-sm text-zinc-500 group-hover:text-emerald-500 transition-colors">
              Source image
            </div>
            <div class="text-xs text-zinc-400 dark:text-zinc-600 italic">PNG recommended for lossless encoding</div>
          </div>
        {/if}
      </div>
      {#if status}
        <div class="text-xs text-emerald-600 dark:text-emerald-400/80 italic">
          {status}
        </div>
      {/if}
    </div>

    <div class="space-y-4">
      {#if mode === 'encode'}
        <div class="grid gap-4">
          <div class="grid gap-1.5">
            <label class="text-xs text-zinc-500 dark:text-zinc-400">Secret message</label>
            <textarea
              bind:value={message}
              placeholder="Type your hidden message here..."
              class="input min-h-[120px] resize-none"
              spellcheck="false"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
            ></textarea>
          </div>
          <div class="grid gap-1.5">
            <label class="text-xs text-zinc-500 dark:text-zinc-400">Security password</label>
            <input
              type="password"
              bind:value={password}
              placeholder="Required to encrypt bits..."
              class="input"
              autocomplete="new-password"
              spellcheck="false"
              autocorrect="off"
              autocapitalize="off"
              data-lpignore="true"
              data-1p-ignore
            />
          </div>
          <button on:click={encode} class="btn w-full">
            Inject into pixels
          </button>
          {#if encodedImageUrl}
            <button on:click={downloadEncoded} class="btn-outline w-full">
              Download encrypted image
            </button>
          {/if}
        </div>
      {:else}
        <div class="grid gap-4">
          <div class="grid gap-1.5">
            <label class="text-xs text-zinc-500 dark:text-zinc-400">Security password</label>
            <input
              type="password"
              bind:value={password}
              placeholder="Password used for encoding..."
              class="input"
              autocomplete="current-password"
              spellcheck="false"
              autocorrect="off"
              autocapitalize="off"
              data-lpignore="true"
              data-1p-ignore
            />
          </div>
          <button on:click={decode} class="btn-outline w-full">
            Scan pixels for hidden text
          </button>
          {#if decodedMessage}
            <div class="grid gap-1.5">
              <label class="text-xs text-zinc-500 dark:text-zinc-400">Found message</label>
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
