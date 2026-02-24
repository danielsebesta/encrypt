<script lang="ts">
  import { analyzePassword, checkLeak } from '../../lib/crypto';

  let passwordInput = '';
  let strengthResult: any = null;
  let leakCount: number | null = null;
  let checkingLeak = false;

  $: if (passwordInput) {
    strengthResult = analyzePassword(passwordInput);
  } else {
    strengthResult = null;
    leakCount = null;
  }

  async function handleCheckLeak() {
    if (!passwordInput) return;
    checkingLeak = true;
    try {
      leakCount = await checkLeak(passwordInput);
    } catch (e) {
      console.error(e);
    } finally {
      checkingLeak = false;
    }
  }
</script>

<div class="space-y-8 animate-in fade-in duration-500">
  <div class="grid gap-4">
    <div class="grid gap-1.5">
      <label for="pass-input" class="text-xs text-zinc-500 font-bold uppercase tracking-wider">Password / Passphrase</label>
      <input 
        id="pass-input"
        type="text" 
        bind:value={passwordInput} 
        placeholder="Type a password to analyze..." 
        class="input font-mono"
      />
    </div>

    {#if strengthResult}
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 py-8 border-y border-zinc-100 dark:border-zinc-800">
        <div class="text-center">
          <div class="text-[10px] uppercase text-zinc-400 mb-1 font-bold">Score</div>
          <div class="text-3xl font-bold {strengthResult.score > 2 ? 'text-emerald-500' : 'text-amber-500'}">
            {strengthResult.score}<span class="text-lg opacity-30">/4</span>
          </div>
        </div>
        <div class="text-center">
          <div class="text-[10px] uppercase text-zinc-400 mb-1 font-bold">Entropy</div>
          <div class="text-3xl font-bold text-zinc-800 dark:text-zinc-100">{Math.round(strengthResult.guesses_log10 * 3.32)}<span class="text-lg opacity-30"> bits</span></div>
        </div>
        <div class="text-center col-span-2">
          <div class="text-[10px] uppercase text-zinc-400 mb-1 font-bold">Crack time (Off-line)</div>
          <div class="text-lg font-bold text-zinc-700 dark:text-zinc-300">{strengthResult.crack_times_display.offline_slow_hashing_1e4_per_second}</div>
        </div>
      </div>
      
      {#if strengthResult.feedback.warning || strengthResult.feedback.suggestions.length > 0}
        <div class="p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 rounded-xl text-xs space-y-2">
          {#if strengthResult.feedback.warning}
            <p class="text-amber-700 dark:text-amber-400 font-bold">⚠️ {strengthResult.feedback.warning}</p>
          {/if}
          {#each strengthResult.feedback.suggestions as suggestion}
            <p class="text-amber-600 dark:text-amber-500 flex gap-2"><span>•</span> {suggestion}</p>
          {/each}
        </div>
      {/if}
    {/if}

    <button 
      on:click={handleCheckLeak} 
      disabled={checkingLeak || !passwordInput}
      class="btn w-full py-4 text-base"
    >
      {#if checkingLeak}
        <span class="animate-pulse">Checking global breach databases...</span>
      {:else}
        Check for Breaches (k-Anonymity)
      {/if}
    </button>

    {#if leakCount !== null}
        <div class="p-6 rounded-2xl text-center border-2 {leakCount > 0 ? 'bg-red-50 border-red-100 text-red-600 dark:bg-red-950/20 dark:border-red-900/50' : 'bg-emerald-50 border-emerald-100 text-emerald-600 dark:bg-emerald-950/20 dark:border-emerald-900/50'} transition-all animate-in zoom-in-95 duration-300">
            {#if leakCount > 0}
                <div class="text-xl font-black mb-1">FOUND IN BREACHES</div>
                <div class="text-sm opacity-80 font-medium">This password appeared in <span class="underline decoration-2">{leakCount.toLocaleString()}</span> known data leaks.</div>
            {:else}
                <div class="text-xl font-black mb-1">NO BREACHES FOUND</div>
                <div class="text-sm opacity-80 font-medium">Your password was not found in any known public data breaches.</div>
            {/if}
        </div>
    {/if}
  </div>
</div>
