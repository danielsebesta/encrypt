<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { PDFDocument } from 'pdf-lib';

  let pdfjsLib: any = null;
  let pdfReady = false;

  type RedactionRect = {
    pageIndex: number;
    nx: number; // normalized [0,1] from left
    ny: number; // normalized [0,1] from top
    nw: number; // normalized width
    nh: number; // normalized height
  };

  let pdfFile: File | null = null;
  let redactedPdfUrl: string | null = null;
  let processing = false;
  let loadingPdf = false;
  let error = '';
  const MAX_BYTES = 5 * 1024 * 1024;

  let pageCount = 0;
  let redactions: RedactionRect[] = [];

  let isDragging = false;
  let dragPageIndex = -1;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragCurrentX = 0;
  let dragCurrentY = 0;

  async function onFileChange(e: Event) {
    const target = e.currentTarget as HTMLInputElement;
    const file = target.files && target.files[0] ? target.files[0] : null;
    pdfFile = file;
    redactedPdfUrl && URL.revokeObjectURL(redactedPdfUrl);
    redactedPdfUrl = null;
    redactions = [];
    pageCount = 0;
    if (pdfFile) {
      if (!pdfReady) {
        await initPdfJs();
      }
      void loadPdf();
    }
  }

  async function loadPdf() {
    if (!pdfFile || !pdfjsLib) return;
    if (pdfFile.size > MAX_BYTES) {
      error = 'PDF too large. Please keep under 5 MB.';
      return;
    }
    error = '';
    loadingPdf = true;
    try {
      const buffer = await pdfFile.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: buffer });
      const pdf = await loadingTask.promise;
      pageCount = pdf.numPages;
      await tick();

      const canvases = Array.from(
        document.querySelectorAll<HTMLCanvasElement>('[data-pdf-canvas="true"]')
      );

      const viewportWidth =
        typeof window !== 'undefined' ? Math.min(window.innerWidth - 64, 900) : 800;

      for (let i = 0; i < pageCount; i++) {
        const page = await pdf.getPage(i + 1);
        const viewport = page.getViewport({ scale: 1 });
        const baseScale = viewportWidth / viewport.width;
        const scale = Math.min(baseScale * 2, 3);
        const v = page.getViewport({ scale });

        const canvas = canvases[i];
        if (!canvas) continue;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;

        canvas.width = v.width;
        canvas.height = v.height;

        const cssWidth = viewportWidth;
        const cssHeight = (v.height / v.width) * cssWidth;
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;

        await page.render({
          canvasContext: ctx,
          viewport: v
        }).promise;
      }
    } catch (e) {
      console.error(e);
      error = 'Failed to load PDF preview.';
      pageCount = 0;
    } finally {
      loadingPdf = false;
    }
  }

  function startDrag(pageIndex: number, event: MouseEvent) {
    const target = event.currentTarget as HTMLDivElement;
    const rect = target.getBoundingClientRect();
    isDragging = true;
    dragPageIndex = pageIndex;
    dragStartX = event.clientX - rect.left;
    dragStartY = event.clientY - rect.top;
    dragCurrentX = dragStartX;
    dragCurrentY = dragStartY;
  }

  function moveDrag(event: MouseEvent) {
    if (!isDragging) return;
    const target = event.currentTarget as HTMLDivElement;
    const rect = target.getBoundingClientRect();
    dragCurrentX = event.clientX - rect.left;
    dragCurrentY = event.clientY - rect.top;
  }

  function endDrag() {
    if (!isDragging || dragPageIndex < 0) {
      isDragging = false;
      dragPageIndex = -1;
      return;
    }
    const pageIndex = dragPageIndex;
    isDragging = false;
    dragPageIndex = -1;

    const x1 = dragStartX;
    const y1 = dragStartY;
    const x2 = dragCurrentX;
    const y2 = dragCurrentY;

    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);

    if (width < 4 || height < 4) return;

    // Normalize to overlay size so we can map to any resolution
    const target = (event?.currentTarget || null) as HTMLDivElement | null;
    const overlay = target ?? document.querySelector<HTMLDivElement>(
      `[data-pdf-overlay="${pageIndex}"]`
    );
    if (!overlay) return;
    const { width: ow, height: oh } = overlay.getBoundingClientRect();
    if (!ow || !oh) return;

    const nx = x / ow;
    const ny = y / oh;
    const nw = width / ow;
    const nh = height / oh;

    redactions = [
      ...redactions,
      { pageIndex, nx, ny, nw, nh }
    ];
  }

  function clearRedactions() {
    redactions = [];
  }

  async function handleRedact() {
    if (!pdfFile || pageCount === 0) return;
    if (redactions.length === 0) {
      error = 'Draw at least one redaction box on a page.';
      return;
    }
    error = '';
    processing = true;
    redactedPdfUrl && URL.revokeObjectURL(redactedPdfUrl);
    redactedPdfUrl = null;

    try {
      const pdfDoc = await PDFDocument.create();

      const canvases = Array.from(
        document.querySelectorAll<HTMLCanvasElement>('[data-pdf-canvas="true"]')
      );

      for (let i = 0; i < pageCount; i++) {
        const baseCanvas = canvases[i];
        if (!baseCanvas) continue;

        const tmp = document.createElement('canvas');
        tmp.width = baseCanvas.width;
        tmp.height = baseCanvas.height;
        const ctx = tmp.getContext('2d');
        if (!ctx) continue;

        ctx.drawImage(baseCanvas, 0, 0);

        ctx.fillStyle = '#000';
        for (const r of redactions.filter((r) => r.pageIndex === i)) {
          const rx = r.nx * baseCanvas.width;
          const ry = r.ny * baseCanvas.height;
          const rw = r.nw * baseCanvas.width;
          const rh = r.nh * baseCanvas.height;
          ctx.fillRect(rx, ry, rw, rh);
        }

        const blob: Blob = await new Promise((resolve, reject) => {
          tmp.toBlob((b) => {
            if (b) resolve(b);
            else reject(new Error('Canvas export failed.'));
          }, 'image/png');
        });

        const pngBytes = await blob.arrayBuffer();
        const pngImage = await pdfDoc.embedPng(pngBytes);
        const { width, height } = pngImage.size();
        const page = pdfDoc.addPage([width, height]);
        page.drawImage(pngImage, {
          x: 0,
          y: 0,
          width,
          height
        });
      }

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      redactedPdfUrl = URL.createObjectURL(blob);
    } catch (e) {
      console.error('PDF redaction failed', e);
      error = 'Failed to process PDF. Try a smaller document or fewer pages, and make sure the file is a valid PDF.';
    } finally {
      processing = false;
    }
  }

  async function initPdfJs() {
    if (pdfReady) return;
    const [lib, worker] = await Promise.all([
      import('pdfjs-dist'),
      // @ts-ignore - worker bundling handled by Vite
      import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    ]);
    pdfjsLib = lib;
    (pdfjsLib as any).GlobalWorkerOptions.workerSrc = (worker as any).default;
    pdfReady = true;
  }

  onMount(async () => {
    await initPdfJs();
  });
</script>

<div class="space-y-6 animate-in fade-in duration-500">
  <div
    class="bg-blue-50 dark:bg-blue-950/20 p-4 rounded-xl text-xs text-blue-700 dark:text-blue-400 border border-blue-100 dark:border-blue-900/50 space-y-1"
  >
    <p class="font-semibold">
      All redaction happens locally in your browser. The PDF is rasterized page-by-page and rebuilt with black boxes
      burned into the pixels and metadata stripped.
    </p>
    <p>
      Upload a PDF, draw black rectangles over sensitive areas on each page, then download a new, fully rasterized
      copy.
    </p>
  </div>

  <div class="grid gap-6">
    <div class="grid gap-1.5">
      <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider" for="pdf-file">
        Source PDF Document
      </label>
      <input
        id="pdf-file"
        type="file"
        accept=".pdf"
        on:change={onFileChange}
        class="input"
      />
      <p class="text-[11px] text-zinc-400">
        Processed in-memory · Max size {Math.round(MAX_BYTES / (1024 * 1024))} MB · Large PDFs may be slow.
      </p>
    </div>

    {#if loadingPdf}
      <p class="text-xs text-zinc-500 dark:text-zinc-400">Rendering pages…</p>
    {/if}

    {#if pageCount > 0}
      <div class="space-y-3">
        <div class="flex items-center justify-between gap-2">
          <p class="text-xs text-zinc-500 dark:text-zinc-400">
            Click and drag to draw black boxes. Repeat on any page that needs redaction.
          </p>
          <button
            type="button"
            class="btn-outline text-[11px] px-3 py-1"
            on:click={clearRedactions}
          >
            Clear all boxes
          </button>
        </div>
        <div class="space-y-6 max-h-[420px] overflow-y-auto pr-1">
          {#each Array(pageCount) as _, pageIndex}
              <div class="space-y-1">
              <p class="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium">
                Page {pageIndex + 1}
              </p>
              <div class="relative inline-block rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-white dark:bg-zinc-900 max-w-full mx-auto">
                <canvas data-pdf-canvas="true" class="block" />
                <div
                  class="absolute inset-0 cursor-crosshair z-10"
                  data-pdf-overlay={pageIndex}
                  on:mousedown={(e) => startDrag(pageIndex, e)}
                  on:mousemove={moveDrag}
                  on:mouseup={endDrag}
                  on:mouseleave={endDrag}
                >
                  {#each redactions.filter((r) => r.pageIndex === pageIndex) as r}
                    <div
                      class="absolute bg-black/90"
                      style={`left:${r.nx * 100}%;top:${r.ny * 100}%;width:${r.nw * 100}%;height:${r.nh * 100}%;`}
                    />
                  {/each}

                  {#if isDragging && dragPageIndex === pageIndex}
                    <div
                      class="absolute border border-emerald-400 bg-emerald-400/20 pointer-events-none"
                      style={`left:${Math.min(dragStartX, dragCurrentX)}px;top:${Math.min(dragStartY, dragCurrentY)}px;width:${Math.abs(dragCurrentX - dragStartX)}px;height:${Math.abs(dragCurrentY - dragStartY)}px;`}
                    />
                  {/if}
                </div>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <button
      on:click={handleRedact}
      disabled={processing || !pdfFile || pageCount === 0}
      class="btn w-full py-4 uppercase font-black tracking-widest text-xs disabled:opacity-50"
    >
      {processing ? 'Rasterizing & Redacting…' : 'Redact & Download PDF'}
    </button>

    {#if error}
      <p class="text-xs text-red-500">{error}</p>
    {/if}

    {#if redactedPdfUrl}
      <div class="space-y-4 animate-in zoom-in-95">
        <div
          class="aspect-[1/1.4] bg-zinc-100 dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 flex items-center justify-center overflow-hidden"
        >
          <embed src={redactedPdfUrl} type="application/pdf" class="w-full h-full" />
        </div>
        <a
          href={redactedPdfUrl}
          download="redacted-document.pdf"
          class="btn-secondary w-full py-4 text-center block uppercase font-black tracking-widest text-xs"
        >
          Download Redacted PDF
        </a>
      </div>
    {/if}
  </div>
</div>
