<script lang="ts">
  import ExifReader from 'exifreader';

  let file: File | null = null;
  let exifData: any = null;
  let scrubbedImageUrl: string | null = null;
  let processing = false;

  async function handleFile(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files?.[0]) {
      processing = true;
      file = target.files[0];
      try {
        const tags = await ExifReader.load(file);
        exifData = tags;
        
        const img = new Image();
        img.src = URL.createObjectURL(file);
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0);
          scrubbedImageUrl = canvas.toDataURL('image/jpeg', 0.9);
          processing = false;
        };
      } catch (e) {
        console.error(e);
        processing = false;
      }
    }
  }
</script>

<div class="space-y-8 animate-in fade-in duration-500">
  <div class="border-4 border-dashed border-zinc-50 dark:border-zinc-900 p-12 text-center rounded-3xl relative group bg-zinc-50/10 hover:bg-emerald-50/5 hover:border-emerald-500/20 transition-all">
      <input type="file" accept="image/*" on:change={handleFile} class="absolute inset-0 opacity-0 cursor-pointer z-10" />
      <div class="space-y-4">
          <div class="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          </div>
          <div>
              <p class="text-base font-bold text-zinc-800 dark:text-zinc-200">Drop image to strip metadata</p>
              <p class="text-xs text-zinc-500 mt-1 uppercase tracking-widest">GPS, Camera Model, Timestamps will be removed</p>
          </div>
      </div>
  </div>

  {#if processing}
      <div class="text-center py-4">
          <span class="text-xs font-bold text-emerald-500 animate-pulse uppercase tracking-[0.2em]">Redrawing to clean canvas...</span>
      </div>
  {/if}

  {#if exifData || scrubbedImageUrl}
      <div class="grid md:grid-cols-2 gap-8 items-start">
          {#if exifData}
              <div class="space-y-4">
                  <h4 class="text-[10px] font-black uppercase text-zinc-400 tracking-widest px-1">Detected Meta-Tags</h4>
                  <div class="bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 p-4 rounded-2xl font-mono text-[10px] max-h-64 overflow-auto shadow-inner">
                      {#each Object.entries(exifData) as [key, val]}
                          {#if typeof (val as any).description === 'string'}
                              <div class="flex justify-between border-b border-zinc-100/50 dark:border-zinc-800/50 py-1.5 px-1 last:border-0 hover:bg-zinc-100/50 dark:hover:bg-zinc-800/30 transition-colors">
                                  <span class="text-zinc-400 font-bold">{key}</span>
                                  <span class="text-zinc-700 dark:text-zinc-300">{(val as any).description}</span>
                              </div>
                          {/if}
                      {/each}
                  </div>
              </div>
          {/if}
          
          {#if scrubbedImageUrl}
              <div class="space-y-4 animate-in slide-in-from-right-4">
                  <h4 class="text-[10px] font-black uppercase text-emerald-500 tracking-widest px-1">Privacy-Safe Result</h4>
                  <div class="relative group rounded-2xl overflow-hidden shadow-2xl border border-zinc-200 dark:border-zinc-800">
                      <img src={scrubbedImageUrl} alt="Scrubbed" class="w-full h-auto" />
                      <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                          <a href={scrubbedImageUrl} download="scrubbed.jpg" class="btn scale-90 group-hover:scale-100 transition-transform">Download JPEG</a>
                      </div>
                  </div>
                  <p class="text-[9px] text-zinc-400 text-center italic uppercase">New file generated without original metadata headers</p>
              </div>
          {/if}
      </div>
  {/if}
</div>
