<script lang="ts">
  import { PDFDocument } from 'pdf-lib';

  let file: File | null = null;
  let password = '';
  let unlockedUrl: string | null = null;
  let processing = false;
  let error = '';
  const MAX_BYTES = 5 * 1024 * 1024;

  async function handleUnlock() {
    if (!file || !password) return;
    if (file.size > MAX_BYTES) {
      error = 'PDF too large. Please keep under 5 MB.';
      return;
    }
    error = '';
    processing = true;
    try {
      const buffer = await file.arrayBuffer();
      const pdfDoc = await PDFDocument.load(buffer, { password });
      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      unlockedUrl = URL.createObjectURL(blob);
    } catch (e) {
      error = 'Failed to unlock PDF. Password might be incorrect or file is not encrypted.';
    } finally {
      processing = false;
    }
  }
</script>

<div class="space-y-6 animate-in fade-in duration-500">
  <div class="grid gap-6">
    <div class="grid gap-1.5">
        <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider">Locked PDF File</label>
        <input type="file" accept=".pdf" on:change={(e) => file = (e.currentTarget as HTMLInputElement).files?.[0] || null} class="input" />
    </div>

    <div class="grid gap-1.5">
        <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider">Owner/User Password</label>
        <input type="password" bind:value={password} placeholder="Enter decryption key..." class="input" />
    </div>

    <button on:click={handleUnlock} disabled={!file || !password || processing} class="btn w-full py-4 uppercase font-black tracking-widest text-xs">
        {processing ? 'Decrypting Document...' : 'Remove Protection'}
    </button>

    {#if error}
      <p class="text-xs text-red-500">{error}</p>
    {/if}

    {#if unlockedUrl}
       <div class="space-y-4 animate-in zoom-in-95">
            <div class="p-6 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/50 rounded-2xl text-center">
                <div class="text-emerald-600 dark:text-emerald-400 font-black mb-1 uppercase tracking-tighter text-xl italic">DECRYPTION SUCCESSFUL</div>
                <div class="text-[10px] text-emerald-800/60 dark:text-emerald-400/60 uppercase font-bold tracking-widest">Document is now unlocked and ready for download</div>
            </div>
            <a href={unlockedUrl} download="unlocked-document.pdf" class="btn-secondary w-full py-4 text-center block uppercase font-black tracking-widest text-xs">Download Unlocked PDF</a>
        </div>
    {/if}
  </div>
</div>
