<script lang="ts">
  import { onMount } from 'svelte';
  import Button from '../ui/Button.svelte';
  import Field from '../ui/Field.svelte';
  import Tabs from '../ui/Tabs.svelte';
  import { focusFirstInvalid } from '../../lib/focusInvalid';
  import { t } from '../../lib/t';
  import Icon from '../Icon.svelte';
  import { dropFiles } from './dropFiles';
  import ToolStatus from './ToolStatus.svelte';

  export let dict: Record<string, string>;

  let mode: 'encode' | 'decode' = 'encode';
  let imageUrl: string | null = null;
  let carrierBuffer: ArrayBuffer | null = null;
  let carrierLoaded = false;
  let audioFile: File | null = null;
  let audioFileName = '';
  let imageStrength = 1.0;
  let status = '';
  let statusTone: 'info' | 'ok' | 'error' = 'info';
  let processing = false;
  let attempted = false;
  let panelEl: HTMLElement;

  $: sourceError = attempted && !(mode === 'encode' ? imageUrl : audioFile) ? t(dict, 'common.fieldRequired') : '';

  function say(text: string, tone: 'info' | 'ok' | 'error' = 'info') {
    status = text;
    statusTone = tone;
  }

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
  const HOP_SIZE = FFT_SIZE;
  const SAMPLE_RATE = 44100;
  const MIN_FREQ = 300;
  const MAX_FREQ = 14000;
  const IMG_HEIGHT = 512;
  const DEFAULT_WIDTH = 512;

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

  function freqToBin(freq: number): number {
    return Math.round(freq * FFT_SIZE / SAMPLE_RATE);
  }

  async function encodeImage() {
    attempted = true;
    if (!imageUrl) { void focusFirstInvalid(panelEl); return; }
    processing = true;
    say(t(dict, 'tools.spectralCipher.encoding'));

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

        let grayscale = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) {
          const r = imgData.data[i * 4], g = imgData.data[i * 4 + 1], b = imgData.data[i * 4 + 2];
          grayscale[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        }

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

          if (col % 64 === 0) await new Promise(r => setTimeout(r, 0));
        }

        let maxAmp = 0;
        for (let i = 0; i < audio.length; i++) maxAmp = Math.max(maxAmp, Math.abs(audio[i]));
        if (maxAmp > 0) for (let i = 0; i < audio.length; i++) audio[i] /= maxAmp;

        let finalAudio = audio;
        let finalRate = SAMPLE_RATE;
        if (carrierBuffer) {
          const carrier = decodeWav(carrierBuffer.slice(0));
          finalRate = carrier.sampleRate;

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

          const carrierGain = 1 - imageStrength * 0.7;
          const imageGain = imageStrength * 3;

          const outLen = Math.max(carrier.samples.length, imageSignal.length);
          finalAudio = new Float32Array(outLen);
          for (let i = 0; i < outLen; i++) {
            const c = i < carrier.samples.length ? carrier.samples[i] * carrierGain : 0;
            const s = i < imageSignal.length ? imageSignal[i] * imageGain : 0;
            finalAudio[i] = c + s;
          }

          let mixMax = 0;
          for (let i = 0; i < finalAudio.length; i++) mixMax = Math.max(mixMax, Math.abs(finalAudio[i]));
          if (mixMax > 1) for (let i = 0; i < finalAudio.length; i++) finalAudio[i] /= mixMax;
        }

        const wavBlob = encodeWav(finalAudio, finalRate);
        if (wavBlobUrl) URL.revokeObjectURL(wavBlobUrl);
        wavBlobUrl = URL.createObjectURL(wavBlob);

        renderSpectrogram(finalAudio, finalRate);

        say(t(dict, 'tools.spectralCipher.encoded'), 'ok');
        processing = false;
      } catch (e) {
        say(t(dict, 'tools.spectralCipher.encryptionFailed'), 'error');
        processing = false;
      }
    };
    img.onerror = () => {
      say(t(dict, 'tools.spectralCipher.encryptionFailed'), 'error');
      processing = false;
    };
    img.src = imageUrl;
  }

  function computeSTFT(samples: Float32Array, numFrames: number, minBin: number, usableBins: number, imgH: number, imgW: number): Float32Array {
    const mags = new Float32Array(imgW * imgH);
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
        mags[(imgH - 1 - row) * imgW + col] = Math.sqrt(re[bin] * re[bin] + im[bin] * im[bin]);
      }
    }
    return mags;
  }

  async function decodeAudio() {
    attempted = true;
    if (!audioFile) { void focusFirstInvalid(panelEl); return; }
    processing = true;
    say(t(dict, 'tools.spectralCipher.decoding'));

    await new Promise(r => setTimeout(r, 0));

    try {
      const buffer = await audioFile.arrayBuffer();
      const { samples, sampleRate } = decodeWav(buffer);

      const minBin = freqToBin(MIN_FREQ);
      const maxBin = freqToBin(MAX_FREQ);
      const usableBins = maxBin - minBin;
      const numFrames = Math.floor((samples.length - FFT_SIZE) / HOP_SIZE) + 1;
      const imgW = numFrames;
      const imgH = IMG_HEIGHT;

      const mixedMags = computeSTFT(samples, numFrames, minBin, usableBins, imgH, imgW);

      let mags = mixedMags;
      if (carrierBuffer) {
        const carrier = decodeWav(carrierBuffer.slice(0));
        const carrierFrames = Math.floor((carrier.samples.length - FFT_SIZE) / HOP_SIZE) + 1;
        const carrierW = Math.min(carrierFrames, imgW);
        const carrierMags = computeSTFT(carrier.samples, carrierW, minBin, usableBins, imgH, carrierW);

        mags = new Float32Array(imgW * imgH);
        for (let col = 0; col < imgW; col++) {
          for (let row = 0; row < imgH; row++) {
            const idx = row * imgW + col;
            const mixed = mixedMags[idx];
            const carr = col < carrierW ? carrierMags[row * carrierW + col] : 0;
            mags[idx] = Math.max(0, mixed - carr);
          }
        }
      }

      let maxMag = 0;
      for (let i = 0; i < mags.length; i++) if (mags[i] > maxMag) maxMag = mags[i];

      const pixels = new Uint8Array(imgW * imgH);
      if (maxMag > 0) {
        for (let i = 0; i < mags.length; i++) {
          pixels[i] = Math.min(255, Math.round((mags[i] / maxMag) * 255));
        }
      }

      renderExtractedImage(pixels, imgW, imgH);
      renderSpectrogram(samples instanceof Float32Array ? samples : new Float32Array(samples), sampleRate);
      say(t(dict, 'tools.spectralCipher.decoded'), 'ok');
      processing = false;
    } catch (e) {
      say(t(dict, 'tools.spectralCipher.decodeFailed'), 'error');
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
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageUrl = URL.createObjectURL(target.files[0]);
      wavBlobUrl = null;
      status = '';
    }
  }

  function setMode(next: 'encode' | 'decode') {
    mode = next;
    status = '';
    attempted = false;
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
<div class="stack" bind:this={panelEl}>
  <Tabs items={[{ id: 'encode', label: t(dict, 'tools.spectralCipher.encode') }, { id: 'decode', label: t(dict, 'tools.spectralCipher.decode') }]} value={mode} label={t(dict, 'tools.spectralCipher.h1')} idBase="spectral" panelClass="grid items-start gap-6 md:grid-cols-2" onchange={setMode}>
    <div class="stack">
      {#if mode === 'encode'}
        <Field label={t(dict, 'tools.spectralCipher.sourceImage')} error={sourceError} required>
          {#snippet children(control)}
            <div class="dropzone aspect-video" use:dropFiles class:dropzone--active={!!imageUrl}>
              {#if imageUrl}
                <img src={imageUrl} alt={t(dict, 'tools.spectralCipher.previewAlt')} />
              {:else}
                <Icon name="image" size={20} />
                <span class="dropzone__title">{t(dict, 'common.dropOrChoose')}</span>
              {/if}
              <input {...control} type="file" accept="image/*" on:change={handleImageFile} class="sr-only" />
              <label class="absolute inset-0 cursor-pointer" for={control.id} aria-hidden="true"></label>
            </div>
          {/snippet}
        </Field>
      {:else}
        <Field label={t(dict, 'tools.spectralCipher.sourceAudio')} error={sourceError} required>
          {#snippet children(control)}
            <div class="dropzone aspect-video" use:dropFiles class:dropzone--active={!!audioFileName}>
              <Icon name="audio-lines" size={20} />
              {#if audioFileName}
                <span class="dropzone__title max-w-full truncate">{audioFileName}</span>
              {:else}
                <span class="dropzone__title">{t(dict, 'common.dropOrChoose')}</span>
                <span>.wav</span>
              {/if}
              <input {...control} type="file" accept=".wav,audio/wav" on:change={handleAudioFile} class="sr-only" />
              <label class="absolute inset-0 cursor-pointer" for={control.id} aria-hidden="true"></label>
            </div>
          {/snippet}
        </Field>
      {/if}
      <canvas bind:this={spectrogramCanvas} class="w-full rounded-lg border border-line-soft {wavBlobUrl || extractedImageUrl ? '' : 'hidden'}" style="image-rendering: pixelated" aria-hidden="true"></canvas>
      {#if status}
        <ToolStatus tone={processing ? 'busy' : statusTone}>{status}</ToolStatus>
      {/if}
    </div>

    <form class="stack" novalidate on:submit|preventDefault={mode === 'encode' ? encodeImage : decodeAudio}>
      {#if mode === 'encode'}
        {#if carrierLoaded}
          <Field id="spectral-strength" label={t(dict, 'tools.spectralCipher.imageStrength')} hint={t(dict, 'tools.spectralCipher.strengthHint')}>
            {#snippet aside()}
              <output class="font-mono text-sm tabular-nums text-text" for="spectral-strength">{Math.round(imageStrength * 100)}%</output>
            {/snippet}
            {#snippet children(control)}
              <input {...control} type="range" min="0.1" max="1" step="0.05" aria-valuetext={`${Math.round(imageStrength * 100)}%`} bind:value={imageStrength} />
            {/snippet}
          </Field>
        {/if}
        <Button type="submit" block busy={processing}>{t(dict, 'tools.spectralCipher.encodeButton')}</Button>
        {#if wavBlobUrl}
          <audio src={wavBlobUrl} controls class="w-full"></audio>
          <Button variant="secondary" block icon="download" onclick={downloadWav}>{t(dict, 'tools.spectralCipher.downloadWav')}</Button>
        {/if}
      {:else}
        <Button type="submit" block busy={processing}>{t(dict, 'tools.spectralCipher.decodeButton')}</Button>
        {#if extractedImageUrl}
          <Button variant="secondary" block icon="download" onclick={downloadImage}>{t(dict, 'tools.spectralCipher.downloadImage')}</Button>
        {/if}
      {/if}
    </form>
  </Tabs>
  <canvas bind:this={offscreenCanvas} class="hidden"></canvas>
</div>
