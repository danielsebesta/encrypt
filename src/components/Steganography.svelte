<script lang="ts">
  import { encrypt, decrypt as decryptMsg } from '../lib/crypto';

  let imageFile: File | null = null;
  let imageUrl: string | null = null;
  let message = '';
  let password = '';
  let canvas: HTMLCanvasElement;
  let status = '';
  let mode: 'encode' | 'decode' = 'encode';
  let decodedMessage = '';

  async function handleImageFile(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files[0]) {
      imageFile = target.files[0];
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

      // Encode Magic + Length (32 bits) + Encrypted Message
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

      // Check Magic
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

<div class="space-y-6">
  <div class="flex gap-4 border-b border-zinc-900 mb-6">
    <button 
      on:click={() => mode = 'encode'}
      class={`pb-2 px-4 uppercase text-[10px] font-bold tracking-widest transition-all ${mode === 'encode' ? 'text-emerald-500 border-b-2 border-emerald-500' : 'text-zinc-600 hover:text-zinc-400'}`}
    >
      Encode Message
    </button>
    <button 
      on:click={() => mode = 'decode'}
      class={`pb-2 px-4 uppercase text-[10px] font-bold tracking-widest transition-all ${mode === 'decode' ? 'text-emerald-500 border-b-2 border-emerald-500' : 'text-zinc-600 hover:text-zinc-400'}`}
    >
      Decode Message
    </button>
  </div>

  <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
    <div class="space-y-6">
      <div class="border-2 border-dashed border-zinc-800 p-8 text-center bg-zinc-950/50 hover:border-emerald-500/50 transition-colors relative group aspect-video flex flex-col items-center justify-center overflow-hidden">
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
            <div class="text-[10px] text-zinc-500 uppercase font-bold tracking-widest group-hover:text-emerald-500 transition-colors">
              Source Image
            </div>
            <div class="text-[9px] text-zinc-700 italic">PNG recommended for lossless encoding</div>
          </div>
        {/if}
      </div>

      {#if status}
        <div class="text-[10px] font-mono text-emerald-500/80 italic">
          > {status}
        </div>
      {/if}
    </div>

    <div class="space-y-6">
      {#if mode === 'encode'}
        <div class="space-y-4">
          <label class="text-zinc-600 uppercase font-bold text-[10px] block">Secret Message</label>
          <textarea
            bind:value={message}
            placeholder="Type your hidden message here..."
            class="w-full bg-zinc-950 border border-zinc-800 p-4 text-zinc-100 outline-none focus:border-emerald-500 font-mono text-sm min-h-[120px] resize-none"
            spellcheck="false"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
          ></textarea>

          <label class="text-zinc-600 uppercase font-bold text-[10px] block">Security Password</label>
          <input
            type="password"
            bind:value={password}
            placeholder="Required to encrypt bits..."
            class="w-full bg-zinc-950 border border-zinc-800 p-4 text-zinc-100 outline-none focus:border-emerald-500 font-mono text-sm"
            autocomplete="new-password"
            spellcheck="false"
            autocorrect="off"
            autocapitalize="off"
            data-lpignore="true"
            data-1p-ignore
          />

          <button 
            on:click={encode}
            class="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold uppercase text-[11px] tracking-widest transition-all shadow-lg shadow-emerald-900/20"
          >
            Inject into Pixels
          </button>
          {#if encodedImageUrl}
            <button 
              on:click={downloadEncoded}
              class="w-full py-4 border border-emerald-500 text-emerald-500 hover:bg-emerald-500/10 font-bold uppercase text-[11px] tracking-widest transition-all"
            >
              Download Encrypted Image
            </button>
          {/if}
        </div>
      {:else}
        <div class="space-y-4">
          <label class="text-zinc-600 uppercase font-bold text-[10px] block">Security Password</label>
          <input
            type="password"
            bind:value={password}
            placeholder="Password used for encoding..."
            class="w-full bg-zinc-950 border border-zinc-800 p-4 text-zinc-100 outline-none focus:border-emerald-500 font-mono text-sm"
            autocomplete="current-password"
            spellcheck="false"
            autocorrect="off"
            autocapitalize="off"
            data-lpignore="true"
            data-1p-ignore
          />

          <button 
            on:click={decode}
            class="w-full py-4 border border-zinc-800 hover:border-emerald-500 text-zinc-400 hover:text-emerald-400 font-bold uppercase text-[11px] tracking-widest transition-all"
          >
            Scan Pixels for Hidden Text
          </button>
          {#if decodedMessage}
            <div class="space-y-2">
              <label class="text-zinc-600 uppercase font-bold text-[10px] block">Found Message:</label>
              <div class="p-4 bg-zinc-950 border border-emerald-500/20 text-emerald-400 font-mono text-sm min-h-[120px] break-words">
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
