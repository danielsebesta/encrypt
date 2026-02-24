<script lang="ts">
  import { decodeJWT } from '../../lib/crypto';

  let input = '';
  let result: any = null;

  function handleInput() {
    if (!input) {
        result = null;
        return;
    }
    try {
      result = decodeJWT(input);
    } catch (e) {
      result = { error: 'Invalid JWT structure' };
    }
  }
</script>

<div class="space-y-6 animate-in fade-in duration-500 text-left">
    <div class="grid gap-2">
        <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider">Encoded Token</label>
        <textarea 
            bind:value={input} 
            on:input={handleInput} 
            placeholder="eyJhbGciOiJIUzI1NiIsInR5..." 
            class="input min-h-[120px] font-mono text-xs leading-relaxed"
        ></textarea>
    </div>

    {#if result}
        <div class="grid gap-6 animate-in slide-in-from-bottom-2">
            {#if result.error}
                <div class="p-4 bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/50 rounded-xl text-red-600 text-xs font-bold uppercase tracking-widest text-center">
                    {result.error}
                </div>
            {:else}
                <div class="space-y-4">
                    <div class="grid md:grid-cols-2 gap-4">
                        <div class="space-y-2">
                            <h4 class="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em] px-1">Header</h4>
                            <div class="p-4 bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-xl overflow-auto shadow-inner">
                                <pre class="text-[10px] text-pink-600 dark:text-pink-400 font-mono">{JSON.stringify(result.header, null, 2)}</pre>
                            </div>
                        </div>
                        <div class="space-y-2">
                            <h4 class="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em] px-1">Payload</h4>
                            <div class="p-4 bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-xl overflow-auto shadow-inner">
                                <pre class="text-[10px] text-purple-600 dark:text-purple-400 font-mono">{JSON.stringify(result.payload, null, 2)}</pre>
                            </div>
                        </div>
                    </div>
                    
                    <div class="p-4 bg-emerald-50/30 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/50 rounded-xl">
                        <div class="text-[9px] font-black text-emerald-800 dark:text-emerald-500 uppercase tracking-widest mb-2 px-1">Signature Verification Status</div>
                        <div class="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-xs">
                             <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                             DECODED LOCALLY (No server validation)
                        </div>
                    </div>
                </div>
            {/if}
        </div>
    {/if}
</div>
