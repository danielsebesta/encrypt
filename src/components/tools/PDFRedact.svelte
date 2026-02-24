<script lang="ts">
  import { PDFDocument, rgb } from 'pdf-lib';

  let pdfFile: File | null = null;
  let redactedPdfUrl: string | null = null;
  let processing = false;

  async function handleRedact() {
    if (!pdfFile) return;
    processing = true;
    try {
      const buffer = await pdfFile.arrayBuffer();
      const pdfDoc = await PDFDocument.load(buffer);
      const pages = pdfDoc.getPages();
      
      // Basic redaction: Add a big black box over the first page as a demo
      const firstPage = pages[0];
      const { width, height } = firstPage.getSize();
      firstPage.drawRectangle({
        x: 50,
        y: height - 100,
        width: 200,
        height: 50,
        color: rgb(0, 0, 0),
      });

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      redactedPdfUrl = URL.createObjectURL(blob);
    } catch (e) {
      console.error(e);
    } finally {
      processing = false;
    }
  }
</script>

<div class="space-y-6 animate-in fade-in duration-500">
  <div class="bg-blue-50 dark:bg-blue-950/20 p-4 rounded-xl text-xs text-blue-700 dark:text-blue-400 border border-blue-100 dark:border-blue-900/50 flex gap-3">
        <span class="text-lg">ℹ️</span>
        <div>
            <strong>Manual Selection Coming:</strong> Currently applying a fixed redaction zone for demo. 
            Full coordinate selection will be available in the next update.
        </div>
  </div>

  <div class="grid gap-6">
    <div class="grid gap-1.5">
        <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider">Source PDF Document</label>
        <input type="file" accept=".pdf" on:change={(e) => pdfFile = (e.currentTarget as HTMLInputElement).files?.[0] || null} class="input" />
    </div>

    <button on:click={handleRedact} disabled={!pdfFile || processing} class="btn w-full py-4 uppercase font-black tracking-widest text-xs">
        {processing ? 'Processing Layers...' : 'Apply Redaction Protection'}
    </button>

    {#if redactedPdfUrl}
        <div class="space-y-4 animate-in zoom-in-95">
             <div class="aspect-[1/1.4] bg-zinc-100 dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 flex items-center justify-center overflow-hidden">
                <embed src={redactedPdfUrl} type="application/pdf" class="w-full h-full" />
             </div>
             <a href={redactedPdfUrl} download="redacted-document.pdf" class="btn-secondary w-full py-4 text-center block uppercase font-black tracking-widest text-xs">Download Redacted PDF</a>
        </div>
    {/if}
  </div>
</div>
