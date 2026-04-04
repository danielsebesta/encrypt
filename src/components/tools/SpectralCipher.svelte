<script lang="ts">
  import { encrypt, decrypt as decryptBytes } from '../../lib/crypto';
  import { getTranslations, t } from '../../lib/i18n';

  export let locale = 'en';
  $: dict = getTranslations(locale);

  import { onMount } from 'svelte';

  let mode: 'encode' | 'decode' = 'encode';
  let imageFile: File | null = null;
  let imageUrl: string | null = null;
  let carrierBuffer: ArrayBuffer | null = null;
  let carrierName = 'encrypt-carrier.wav';
  let carrierLoaded = false;
  let audioFile: File | null = null;
  let audioFileName = '';
  let password = '';
  let imageStrength = 0.15;
  let status = '';
  let processing = false;

  let imageInput: HTMLInputElement;
  let audioInput: HTMLInputElement;
  let offscreenCanvas: HTMLCanvasElement;
  let spectrogramCanvas: HTMLCanvasElement;

  onMount(async () => {
    try {
      const res = await fetch('/encrypt-carrier.wav');
      if (res.ok) {
        carrierBuffer = await res.arrayBuffer();
        carrierLoaded = true;
      }
    } catch {}
  });

  let wavBlobUrl: string | null = null;
  let extractedImageUrl: string | null = null;

  const FFT_SIZE = 2048;
  const HOP_SIZE = FFT_SIZE; // no overlap = each column is independent = sharper image
  const SAMPLE_RATE = 44100;
  const MIN_FREQ = 300;
  const MAX_FREQ = 14000;
  const IMG_HEIGHT = 512;
  const DEFAULT_WIDTH = 512;

  // ── FFT (radix-2 Cooley-Tukey) ──
  function fft(re: Float64Array, im: Float64Array) {
    const n = re.length;
    if (n <= 1) return;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const angle = -2 * Math.PI / len;
      const wRe = Math.cos(angle), wIm = Math.sin(angle);
      for (let i = 0; i < n; i += len) {
        let curRe = 1, curIm = 0;
        for (let j = 0; j < half; j++) {
          const a = i + j, b = a + half;
          const tRe = curRe * re[b] - curIm * im[b];
          const tIm = curRe * im[b] + curIm * re[b];
          re[b] = re[a] - tRe; im[b] = im[a] - tIm;
          re[a] += tRe; im[a] += tIm;
          const newCurRe = curRe * wRe - curIm * wIm;
          curIm = curRe * wIm + curIm * wRe;
          curRe = newCurRe;
        }
      }
    }
  }

  function ifft(re: Float64Array, im: Float64Array) {
    const n = re.length;
    for (let i = 0; i < n; i++) im[i] = -im[i];
    fft(re, im);
    for (let i = 0; i < n; i++) { re[i] /= n; im[i] = -im[i] / n; }
  }

  // ── Hanning window ──
  function hann(i: number, n: number): number {
    return 0.5 * (1 - Math.cos(2 * Math.PI * i / n));
  }

  // ── WAV encode/decode ──
  function encodeWav(samples: Float32Array, sr: number): Blob {
    const len = samples.length;
    const buf = new ArrayBuffer(44 + len * 2);
    const view = new DataView(buf);
    const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    writeStr(0, 'RIFF'); view.setUint32(4, 36 + len * 2, true); writeStr(8, 'WAVE');
    writeStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); view.setUint32(24, sr, true);
    view.setUint32(28, sr * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    writeStr(36, 'data'); view.setUint32(40, len * 2, true);
    for (let i = 0; i < len; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  function decodeWav(buffer: ArrayBuffer): { samples: Float32Array; sampleRate: number } {
    const view = new DataView(buffer);
    const channels = view.getUint16(22, true);
    const sr = view.getUint32(24, true);
    const bitsPerSample = view.getUint16(34, true);
    let dataOffset = 36;
    while (dataOffset < buffer.byteLength - 8) {
      const chunkId = String.fromCharCode(view.getUint8(dataOffset), view.getUint8(dataOffset + 1), view.getUint8(dataOffset + 2), view.getUint8(dataOffset + 3));
      const chunkSize = view.getUint32(dataOffset + 4, true);
      if (chunkId === 'data') { dataOffset += 8; break; }
      dataOffset += 8 + chunkSize;
    }
    const bytesPerSample = bitsPerSample / 8;
    const totalSamples = (buffer.byteLength - dataOffset) / bytesPerSample;
    const framesCount = Math.floor(totalSamples / channels);

    // Read all channels then mix to mono
    const samples = new Float32Array(framesCount);
    for (let f = 0; f < framesCount; f++) {
      let sum = 0;
      for (let ch = 0; ch < channels; ch++) {
        const idx = dataOffset + (f * channels + ch) * bytesPerSample;
        if (bitsPerSample === 16) {
          sum += view.getInt16(idx, true) / 32768;
        } else {
          sum += (view.getUint8(idx) - 128) / 128;
        }
      }
      samples[f] = sum / channels;
    }
    return { samples, sampleRate: sr };
  }

  // ── Frequency bin mapping ──
  function freqToBin(freq: number): number {
    return Math.round(freq * FFT_SIZE / SAMPLE_RATE);
  }

  // ── Image → Audio (encode) ──
  async function encodeImage() {
    if (!imageUrl) { status = t(dict, 'tools.spectralCipher.pleaseProvide'); return; }
    processing = true;
    status = t(dict, 'tools.spectralCipher.encoding');

    await new Promise(r => setTimeout(r, 0));

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = async () => {
      try {
        const ctx = offscreenCanvas.getContext('2d')!;
        const w = DEFAULT_WIDTH;
        const h = IMG_HEIGHT;
        offscreenCanvas.width = w;
        offscreenCanvas.height = h;
        ctx.drawImage(img, 0, 0, w, h);
        const imgData = ctx.getImageData(0, 0, w, h);

        // Convert to grayscale
        let grayscale = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) {
          const r = imgData.data[i * 4], g = imgData.data[i * 4 + 1], b = imgData.data[i * 4 + 2];
          grayscale[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        }

        // Optional encryption
        if (password.trim()) {
          const header = new Uint8Array(8);
          header[0] = 0x53; header[1] = 0x50; header[2] = 0x43; header[3] = 0x52; // 'SPCR'
          header[4] = (w >> 8) & 0xff; header[5] = w & 0xff;
          header[6] = (h >> 8) & 0xff; header[7] = h & 0xff;
          const payload = new Uint8Array(8 + grayscale.length);
          payload.set(header);
          payload.set(grayscale, 8);
          const plainStr = String.fromCharCode(...payload);
          const encrypted = await encrypt(plainStr, password.trim());
          // Reshape encrypted bytes to w*h, padding/truncating
          grayscale = new Uint8Array(w * h);
          for (let i = 0; i < w * h; i++) {
            grayscale[i] = i < encrypted.length ? encrypted[i] : 0;
          }
        }

        // Spectral encoding: for each column, build frequency frame and IFFT
        const minBin = freqToBin(MIN_FREQ);
        const maxBin = freqToBin(MAX_FREQ);
        const usableBins = maxBin - minBin;
        const totalSamples = w * HOP_SIZE + FFT_SIZE;
        const audio = new Float32Array(totalSamples);

        for (let col = 0; col < w; col++) {
          const re = new Float64Array(FFT_SIZE);
          const im = new Float64Array(FFT_SIZE);

          for (let row = 0; row < h; row++) {
            const bin = minBin + Math.round(row * usableBins / h);
            if (bin >= FFT_SIZE / 2) continue;
            const amplitude = grayscale[(h - 1 - row) * w + col] / 255;
            // Zero phase (pure cosine) — produces cleanest spectrogram
            re[bin] = amplitude;
            im[bin] = 0;
            if (bin > 0 && bin < FFT_SIZE / 2) {
              re[FFT_SIZE - bin] = amplitude;
              im[FFT_SIZE - bin] = 0;
            }
          }

          ifft(re, im);

          const offset = col * HOP_SIZE;
          for (let i = 0; i < FFT_SIZE; i++) {
            audio[offset + i] += re[i];
          }

          // Yield every 64 columns
          if (col % 64 === 0) await new Promise(r => setTimeout(r, 0));
        }

        // Normalize the image signal
        let maxAmp = 0;
        for (let i = 0; i < audio.length; i++) maxAmp = Math.max(maxAmp, Math.abs(audio[i]));
        if (maxAmp > 0) for (let i = 0; i < audio.length; i++) audio[i] /= maxAmp;

        // Mix with carrier audio
        let finalAudio = audio;
        let finalRate = SAMPLE_RATE;
        if (carrierBuffer) {
          const carrier = decodeWav(carrierBuffer.slice(0));
          finalRate = carrier.sampleRate;

          // Resample image audio if sample rates differ
          let imageSignal = audio;
          if (carrier.sampleRate !== SAMPLE_RATE) {
            const ratio = carrier.sampleRate / SAMPLE_RATE;
            const newLen = Math.round(audio.length * ratio);
            imageSignal = new Float32Array(newLen);
            for (let i = 0; i < newLen; i++) {
              const srcIdx = i / ratio;
              const lo = Math.floor(srcIdx);
              const hi = Math.min(lo + 1, audio.length - 1);
              const frac = srcIdx - lo;
              imageSignal[i] = audio[lo] * (1 - frac) + audio[hi] * frac;
            }
          }

          const outLen = Math.max(carrier.samples.length, imageSignal.length);
          finalAudio = new Float32Array(outLen);
          for (let i = 0; i < outLen; i++) {
            const c = i < carrier.samples.length ? carrier.samples[i] : 0;
            const s = i < imageSignal.length ? imageSignal[i] * imageStrength : 0;
            finalAudio[i] = c + s;
          }

          // Normalize mixed output
          let mixMax = 0;
          for (let i = 0; i < finalAudio.length; i++) mixMax = Math.max(mixMax, Math.abs(finalAudio[i]));
          if (mixMax > 1) for (let i = 0; i < finalAudio.length; i++) finalAudio[i] /= mixMax;
        }

        // Generate WAV
        const wavBlob = encodeWav(finalAudio, finalRate);
        if (wavBlobUrl) URL.revokeObjectURL(wavBlobUrl);
        wavBlobUrl = URL.createObjectURL(wavBlob);

        // Render spectrogram preview
        renderSpectrogram(finalAudio, finalRate);

        status = t(dict, 'tools.spectralCipher.encoded');
        processing = false;
      } catch (e) {
        status = t(dict, 'tools.spectralCipher.encryptionFailed');
        processing = false;
      }
    };
    img.src = imageUrl;
  }

  // ── Audio → Image (decode) ──
  async function decodeAudio() {
    if (!audioFile) { status = t(dict, 'tools.spectralCipher.pleaseProvideAudio'); return; }
    processing = true;
    status = t(dict, 'tools.spectralCipher.decoding');

    await new Promise(r => setTimeout(r, 0));

    try {
      const buffer = await audioFile.arrayBuffer();
      const { samples, sampleRate } = decodeWav(buffer);

      // STFT
      const minBin = freqToBin(MIN_FREQ);
      const maxBin = freqToBin(MAX_FREQ);
      const usableBins = maxBin - minBin;
      const numFrames = Math.floor((samples.length - FFT_SIZE) / HOP_SIZE) + 1;
      const imgW = numFrames;
      const imgH = IMG_HEIGHT;

      // First pass: compute all magnitudes and find max
      const mags = new Float32Array(imgW * imgH);
      let maxMag = 0;

      for (let col = 0; col < numFrames; col++) {
        const re = new Float64Array(FFT_SIZE);
        const im = new Float64Array(FFT_SIZE);

        for (let i = 0; i < FFT_SIZE; i++) {
          const idx = col * HOP_SIZE + i;
          re[i] = idx < samples.length ? samples[idx] : 0;
          im[i] = 0;
        }

        fft(re, im);

        for (let row = 0; row < imgH; row++) {
          const bin = minBin + Math.round(row * usableBins / imgH);
          if (bin >= FFT_SIZE / 2) continue;
          const mag = Math.sqrt(re[bin] * re[bin] + im[bin] * im[bin]);
          const idx = (imgH - 1 - row) * imgW + col;
          mags[idx] = mag;
          if (mag > maxMag) maxMag = mag;
        }

        if (col % 64 === 0) await new Promise(r => setTimeout(r, 0));
      }

      // Second pass: normalize to 0-255
      const pixels = new Uint8Array(imgW * imgH);
      if (maxMag > 0) {
        for (let i = 0; i < mags.length; i++) {
          pixels[i] = Math.min(255, Math.round((mags[i] / maxMag) * 255));
        }
      }

      // Optional decryption
      if (password.trim()) {
        try {
          // Collect non-zero trailing length
          let encLen = imgW * imgH;
          while (encLen > 0 && pixels[encLen - 1] === 0) encLen--;
          const encBytes = new Uint8Array(pixels.buffer, 0, encLen);
          const decrypted = await decryptBytes(encBytes, password.trim());
          const decStr = typeof decrypted === 'string' ? decrypted : new TextDecoder().decode(decrypted as any);
          const decData = new Uint8Array(decStr.length);
          for (let i = 0; i < decStr.length; i++) decData[i] = decStr.charCodeAt(i);

          if (decData[0] === 0x53 && decData[1] === 0x50 && decData[2] === 0x43 && decData[3] === 0x52) {
            const origW = (decData[4] << 8) | decData[5];
            const origH = (decData[6] << 8) | decData[7];
            renderExtractedImage(decData.slice(8), origW, origH);
            status = t(dict, 'tools.spectralCipher.decoded');
            processing = false;
            return;
          }
        } catch {
          status = t(dict, 'tools.spectralCipher.decryptFailed');
          processing = false;
          return;
        }
      }

      // Render raw spectrogram as image
      renderExtractedImage(pixels, imgW, imgH);
      renderSpectrogram(samples instanceof Float32Array ? samples : new Float32Array(samples), sampleRate);
      status = t(dict, 'tools.spectralCipher.decoded');
      processing = false;
    } catch (e) {
      status = t(dict, 'tools.spectralCipher.decodeFailed');
      processing = false;
    }
  }

  function renderSpectrogram(samples: Float32Array, sr: number) {
    if (!spectrogramCanvas) return;
    const ctx = spectrogramCanvas.getContext('2d')!;
    const minBin = freqToBin(MIN_FREQ);
    const maxBin = freqToBin(MAX_FREQ);
    const usableBins = maxBin - minBin;
    const numFrames = Math.floor((samples.length - FFT_SIZE) / HOP_SIZE) + 1;

    spectrogramCanvas.width = Math.min(numFrames, 800);
    spectrogramCanvas.height = 300;
    const scaleX = spectrogramCanvas.width / numFrames;
    const scaleY = spectrogramCanvas.height / usableBins;

    // Two-pass: collect magnitudes, then normalize
    const magGrid: number[][] = [];
    let maxMag = 0;
    for (let col = 0; col < numFrames; col++) {
      const re = new Float64Array(FFT_SIZE);
      const im = new Float64Array(FFT_SIZE);
      for (let i = 0; i < FFT_SIZE; i++) {
        const idx = col * HOP_SIZE + i;
        re[i] = idx < samples.length ? samples[idx] : 0;
      }
      fft(re, im);
      const colMags: number[] = [];
      for (let b = 0; b < usableBins; b++) {
        const bin = minBin + b;
        const mag = Math.sqrt(re[bin] * re[bin] + im[bin] * im[bin]);
        colMags.push(mag);
        if (mag > maxMag) maxMag = mag;
      }
      magGrid.push(colMags);
    }

    const imgData = ctx.createImageData(spectrogramCanvas.width, spectrogramCanvas.height);
    for (let col = 0; col < numFrames; col++) {
      const px = Math.floor(col * scaleX);
      if (px >= spectrogramCanvas.width) continue;
      for (let b = 0; b < usableBins; b++) {
        const val = maxMag > 0 ? Math.min(255, Math.round((magGrid[col][b] / maxMag) * 255)) : 0;
        const py = spectrogramCanvas.height - 1 - Math.floor(b * scaleY);
        if (py < 0 || py >= spectrogramCanvas.height) continue;
        const idx = (py * spectrogramCanvas.width + px) * 4;
        imgData.data[idx] = Math.round(val * 0.15);
        imgData.data[idx + 1] = val;
        imgData.data[idx + 2] = Math.round(val * 0.4);
        imgData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  function renderExtractedImage(pixels: Uint8Array, w: number, h: number) {
    if (!spectrogramCanvas) return;
    const ctx = spectrogramCanvas.getContext('2d')!;
    spectrogramCanvas.width = w;
    spectrogramCanvas.height = h;
    const imgData = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const v = pixels[i] || 0;
      imgData.data[i * 4] = v;
      imgData.data[i * 4 + 1] = v;
      imgData.data[i * 4 + 2] = v;
      imgData.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    extractedImageUrl = spectrogramCanvas.toDataURL('image/png');
  }

  function handleImageFile(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files?.[0]) {
      imageFile = target.files[0];
      imageUrl = URL.createObjectURL(imageFile);
      wavBlobUrl = null;
      status = '';
    }
  }


  function handleAudioFile(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files?.[0]) {
      audioFile = target.files[0];
      audioFileName = audioFile.name;
      extractedImageUrl = null;
      status = '';
    }
  }

  function downloadWav() {
    if (!wavBlobUrl) return;
    const a = document.createElement('a');
    a.href = wavBlobUrl;
    a.download = 'spectral-cipher.wav';
    a.click();
  }

  function downloadImage() {
    if (!extractedImageUrl) return;
    const a = document.createElement('a');
    a.href = extractedImageUrl;
    a.download = 'spectral-extracted.png';
    a.click();
  }
</script>

<div class="space-y-6">
  <div class="tab-bar">
    <button on:click={() => mode = 'encode'} class="tab-btn {mode === 'encode' ? 'tab-btn-active' : ''}">
      {t(dict, 'tools.spectralCipher.encode')}
    </button>
    <button on:click={() => mode = 'decode'} class="tab-btn {mode === 'decode' ? 'tab-btn-active' : ''}">
      {t(dict, 'tools.spectralCipher.decode')}
    </button>
  </div>

  <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
    <div class="space-y-4">
      {#if mode === 'encode'}
        <input bind:this={imageInput} type="file" accept="image/*" on:change={handleImageFile} class="hidden" />
        <button type="button" on:click={() => imageInput?.click()}
          class="w-full border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl p-8 text-center bg-white dark:bg-zinc-900/40 hover:border-emerald-400 dark:hover:border-emerald-500/50 transition-colors cursor-pointer group aspect-video flex flex-col items-center justify-center overflow-hidden">
          {#if imageUrl}
            <img src={imageUrl} alt="Preview" class="max-h-full max-w-full object-contain" />
          {:else}
            <div class="space-y-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mx-auto text-zinc-400 group-hover:text-emerald-500 transition-colors"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
              <div class="text-sm text-zinc-500 group-hover:text-emerald-500 transition-colors">
                {t(dict, 'tools.spectralCipher.sourceImage')}
              </div>
            </div>
          {/if}
        </button>
      {:else}
        <input bind:this={audioInput} type="file" accept=".wav,audio/wav" on:change={handleAudioFile} class="hidden" />
        <button type="button" on:click={() => audioInput?.click()}
          class="w-full border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl p-8 text-center bg-white dark:bg-zinc-900/40 hover:border-emerald-400 dark:hover:border-emerald-500/50 transition-colors cursor-pointer group aspect-video flex flex-col items-center justify-center overflow-hidden">
          {#if audioFileName}
            <div class="space-y-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mx-auto text-emerald-500"><path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/></svg>
              <div class="text-sm text-emerald-500 font-medium">{audioFileName}</div>
            </div>
          {:else}
            <div class="space-y-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mx-auto text-zinc-400 group-hover:text-emerald-500 transition-colors"><path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/></svg>
              <div class="text-sm text-zinc-500 group-hover:text-emerald-500 transition-colors">
                {t(dict, 'tools.spectralCipher.sourceAudio')}
              </div>
              <div class="text-xs text-zinc-400 dark:text-zinc-600 italic">.wav</div>
            </div>
          {/if}
        </button>
      {/if}

      <canvas bind:this={spectrogramCanvas} class="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 {wavBlobUrl || extractedImageUrl ? '' : 'hidden'}" style="image-rendering: pixelated;"></canvas>

      {#if status}
        <div class="text-xs text-emerald-600 dark:text-emerald-400/80 italic">{status}</div>
      {/if}
    </div>

    <div class="space-y-4">
      <div class="grid gap-4">
        <div class="grid gap-1.5">
          <label class="label">{t(dict, 'tools.spectralCipher.password')}</label>
          <input type="password" bind:value={password}
            placeholder={mode === 'encode' ? t(dict, 'tools.spectralCipher.encPasswordPlaceholder') : t(dict, 'tools.spectralCipher.decPasswordPlaceholder')}
            class="input" autocomplete="off" data-lpignore="true" data-1p-ignore data-bwignore="true" />
          <p class="text-[10px] text-zinc-400 dark:text-zinc-500">{t(dict, 'tools.spectralCipher.passwordHint')}</p>
        </div>

        {#if mode === 'encode'}
          {#if carrierLoaded}
            <div class="grid gap-1.5">
              <label class="label">{t(dict, 'tools.spectralCipher.imageStrength')} — {Math.round(imageStrength * 100)}%</label>
              <input type="range" min="0.02" max="0.5" step="0.01" bind:value={imageStrength} class="w-full accent-emerald-500" />
              <p class="text-[10px] text-zinc-400 dark:text-zinc-500">{t(dict, 'tools.spectralCipher.strengthHint')}</p>
            </div>
          {/if}

          <button on:click={encodeImage} class="btn w-full" disabled={processing || !imageUrl}>
            {#if processing}
              <svg class="animate-spin inline-block mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
            {/if}
            {t(dict, 'tools.spectralCipher.encodeButton')}
          </button>
          {#if wavBlobUrl}
            <audio src={wavBlobUrl} controls class="w-full"></audio>
            <button on:click={downloadWav} class="btn-outline w-full">
              {t(dict, 'tools.spectralCipher.downloadWav')}
            </button>
          {/if}
        {:else}
          <button on:click={decodeAudio} class="btn-outline w-full" disabled={processing || !audioFile}>
            {#if processing}
              <svg class="animate-spin inline-block mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
            {/if}
            {t(dict, 'tools.spectralCipher.decodeButton')}
          </button>
          {#if extractedImageUrl}
            <button on:click={downloadImage} class="btn-outline w-full">
              {t(dict, 'tools.spectralCipher.downloadImage')}
            </button>
          {/if}
        {/if}
      </div>
    </div>
  </div>

  <canvas bind:this={offscreenCanvas} class="hidden"></canvas>
</div>
