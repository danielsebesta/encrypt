<script lang="ts">
  import { PDFDocument } from 'pdf-lib';
  import { getTranslations, t } from '../../lib/i18n';

  export let locale = 'en';
  $: dict = getTranslations(locale);

  let file: File | null = null;
  let password = '';
  let unlockedUrl: string | null = null;
  let processing = false;
  let error = '';
  const MAX_BYTES = 5 * 1024 * 1024;

  async function handleUnlock() {
    if (!file || !password) return;
    if (file.size > MAX_BYTES) {
      error = t(dict, 'tools.pdfUnlock.pdfTooLarge');
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
      error = t(dict, 'tools.pdfUnlock.failedToUnlock');
    } finally {
      processing = false;
    }
  }
</script>

<div class="space-y-6 animate-in fade-in duration-500">
  <div class="grid gap-6">
    <div class="grid gap-1.5">
        <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider">{t(dict, 'tools.pdfUnlock.lockedPdf')}</label>
        <input type="file" accept=".pdf" on:change={(e) => file = (e.currentTarget as HTMLInputElement).files?.[0] || null} class="input" />
    </div>

    <div class="grid gap-1.5">
        <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider">{t(dict, 'tools.pdfUnlock.ownerPassword')}</label>
        <input type="password" bind:value={password} placeholder={t(dict, 'tools.pdfUnlock.decryptionPlaceholder')} class="input" />
    </div>

    <button on:click={handleUnlock} disabled={!file || !password || processing} class="btn w-full py-4 uppercase font-black tracking-widest text-xs">
        {processing ? t(dict, 'tools.pdfUnlock.decryptingDoc') : t(dict, 'tools.pdfUnlock.removeProtection')}
    </button>

    {#if error}
      <p class="text-xs text-red-500">{error}</p>
    {/if}

    {#if unlockedUrl}
       <div class="space-y-4 animate-in zoom-in-95">
            <div class="p-6 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/50 rounded-2xl text-center">
                <div class="text-emerald-600 dark:text-emerald-400 font-black mb-1 uppercase tracking-tighter text-xl italic">{t(dict, 'tools.pdfUnlock.decryptionSuccessful')}</div>
                <div class="text-[10px] text-emerald-800/60 dark:text-emerald-400/60 uppercase font-bold tracking-widest">{t(dict, 'tools.pdfUnlock.docUnlocked')}</div>
            </div>
            <a href={unlockedUrl} download="unlocked-document.pdf" class="btn-secondary w-full py-4 text-center block uppercase font-black tracking-widest text-xs">{t(dict, 'tools.pdfUnlock.downloadUnlocked')}</a>
        </div>
    {/if}
  </div>
</div>
