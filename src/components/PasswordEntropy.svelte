<script lang="ts">
  import dictionary from '../lib/dictionary.json';
  let password = '';
  let generatedPassword = '';
  let wordCount = 6;
  function calculateEntropy(pwd: string): number {
    if (!pwd) return 0;
    let poolSize = 0;
    if (/[a-z]/.test(pwd)) poolSize += 26;
    if (/[A-Z]/.test(pwd)) poolSize += 26;
    if (/[0-9]/.test(pwd)) poolSize += 10;
    if (/[^a-zA-Z0-9]/.test(pwd)) poolSize += 32;
    if (/[ěščřžýáíéóúůťňď]/.test(pwd)) poolSize += 15;
    return Math.floor(pwd.length * Math.log2(poolSize || 1));
  }
  function generateDiceware() {
    const words: string[] = [];
    const randomValues = new Uint32Array(wordCount);
    crypto.getRandomValues(randomValues);
    for (let i = 0; i < wordCount; i++) {
      const index = randomValues[i] % dictionary.length;
      words.push(dictionary[index]);
    }
    generatedPassword = words.join('-');
  }
  $: entropy = calculateEntropy(password);
  function getStrengthColor(bits: number) {
    if (bits === 0) return 'bg-zinc-200 dark:bg-zinc-800';
    if (bits < 40) return 'bg-red-500';
    if (bits < 80) return 'bg-yellow-500';
    return 'bg-emerald-500';
  }
  function getStrengthLabel(bits: number) {
    if (bits === 0) return 'Waiting...';
    if (bits < 40) return 'Weak';
    if (bits < 60) return 'Moderate';
    if (bits < 100) return 'Strong';
    return 'Very strong';
  }
</script>

<div class="form grid grid-cols-1 md:grid-cols-2 gap-8">
  <div class="space-y-5">
    <div>
      <h3 class="text-xs text-zinc-500 dark:text-zinc-400 mb-3">Entropy analyzer</h3>
      <div class="space-y-4">
        <input
          type="text"
          bind:value={password}
          placeholder="Type a password to test..."
          class="input"
          autocomplete="off"
          spellcheck="false"
          autocorrect="off"
          autocapitalize="off"
          data-lpignore="true"
          data-1p-ignore
        />
        <div class="space-y-2">
          <div class="flex justify-between items-end">
            <span class="text-xs text-zinc-500 dark:text-zinc-400">{getStrengthLabel(entropy)}</span>
            <span class="text-sm font-mono text-emerald-600 dark:text-emerald-400 font-semibold">{entropy} bits</span>
          </div>
          <div class="h-1.5 bg-zinc-100 dark:bg-zinc-900 rounded-full overflow-hidden">
            <div
              class={`h-full rounded-full transition-all duration-500 ${getStrengthColor(entropy)}`}
              style={`width: ${Math.min(100, (entropy / 128) * 100)}%`}
            ></div>
          </div>
        </div>
        <p class="text-xs text-zinc-400 dark:text-zinc-500 leading-relaxed italic border-l-2 border-zinc-200 dark:border-zinc-800 pl-3">
          Entropy measures randomness. A password with &gt;80 bits is generally safe against brute-force attacks.
        </p>
      </div>
    </div>
  </div>
  <div class="space-y-5">
    <div>
      <h3 class="text-xs text-zinc-500 dark:text-zinc-400 mb-3">Diceware generator</h3>
      <div class="space-y-5 p-5 border border-zinc-200 dark:border-zinc-800 rounded-xl bg-white/50 dark:bg-zinc-900/30">
        <div class="flex items-center justify-between">
          <label class="text-xs text-zinc-500 dark:text-zinc-400">Word count: {wordCount}</label>
          <input type="range" min="3" max="10" bind:value={wordCount} class="accent-emerald-500 h-1" />
        </div>
        <button
          on:click={generateDiceware}
          class="btn-outline w-full"
        >
          Generate secret phrase
        </button>
        {#if generatedPassword}
          <div class="space-y-2">
            <div class="p-3.5 bg-white dark:bg-zinc-950 border border-emerald-200 dark:border-emerald-900/30 rounded-lg text-emerald-700 dark:text-emerald-400 font-mono text-sm break-words select-all text-center">
              {generatedPassword}
            </div>
            <div class="text-xs text-zinc-400 dark:text-zinc-600 text-center">
              Each word adds ~14 bits of entropy · Total: {wordCount * 14} bits
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>
