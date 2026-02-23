<script lang="ts">
  let file: File | null = null;
  let hash256 = '';
  let hash512 = '';
  let isLoading = false;
  let compareHash = '';
  let match: boolean | null = null;

  async function handleFileChange(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files[0]) {
      file = target.files[0];
      await calculateHashes();
    }
  }

  async function calculateHashes() {
    if (!file) return;
    isLoading = true;
    hash256 = '';
    hash512 = '';
    
    try {
      const buffer = await file.arrayBuffer();
      
      const digest256 = await crypto.subtle.digest('SHA-256', buffer);
      hash256 = Array.from(new Uint8Array(digest256))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      const digest512 = await crypto.subtle.digest('SHA-512', buffer);
      hash512 = Array.from(new Uint8Array(digest512))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    } catch (e) {
      console.error('Hashing failed', e);
    } finally {
      isLoading = false;
      checkMatch();
    }
  }

  function checkMatch() {
    if (!compareHash || (!hash256 && !hash512)) {
      match = null;
      return;
    }
    const cleanCompare = compareHash.trim().toLowerCase();
    match = cleanCompare === hash256 || cleanCompare === hash512;
  }

  $: if (compareHash) checkMatch();
</script>

<div class="space-y-6">
  <div class="grid grid-cols-1 gap-4">
    <div class="border-2 border-dashed border-zinc-800 p-8 text-center bg-zinc-950/50 hover:border-emerald-500/50 transition-colors relative group">
      <input 
        type="file" 
        on:change={handleFileChange}
        class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      />
      <div class="space-y-2 pointer-events-none">
        <div class="text-zinc-500 group-hover:text-emerald-500 transition-colors">
          {#if file}
            <span class="text-emerald-500 font-bold">{file.name}</span>
          {:else}
            Drop a file here or <span class="text-emerald-500 underline">browse</span>
          {/if}
        </div>
        <div class="text-[10px] text-zinc-600 uppercase font-bold tracking-widest">
          No data leaves your device
        </div>
      </div>
    </div>
  </div>

  {#if isLoading}
    <div class="animate-pulse text-emerald-500 font-mono text-sm italic">
      Calculating checksums...
    </div>
  {/if}

  {#if hash256}
    <div class="space-y-4 font-mono text-[11px] md:text-xs">
      <div class="space-y-1">
        <label class="text-zinc-600 uppercase font-bold text-[10px]">SHA-256</label>
        <div class="p-3 bg-zinc-950 border border-zinc-800 break-all text-zinc-300 select-all">
          {hash256}
        </div>
      </div>

      <div class="space-y-1">
        <label class="text-zinc-600 uppercase font-bold text-[10px]">SHA-512</label>
        <div class="p-3 bg-zinc-950 border border-zinc-800 break-all text-zinc-300 select-all">
          {hash512}
        </div>
      </div>

      <div class="pt-4 border-t border-zinc-900">
        <label for="compare" class="text-zinc-600 uppercase font-bold text-[10px] block mb-2">Compare with expected hash</label>
        <div class="relative">
          <input
            id="compare"
            type="text"
            bind:value={compareHash}
            placeholder="Paste hash here to verify..."
            class="w-full bg-zinc-950 border border-zinc-800 p-3 text-zinc-300 outline-none focus:border-emerald-500 transition-colors"
            spellcheck="false"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
          />
          {#if match !== null}
            <div class="absolute right-3 top-1/2 -translate-y-1/2 font-bold uppercase text-[10px]">
              {#if match}
                <span class="text-emerald-500 tracking-widest">✓ MATCH</span>
              {:else}
                <span class="text-red-500 tracking-widest">✗ MISMATCH</span>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>
