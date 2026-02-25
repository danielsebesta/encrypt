<script lang="ts">
  import dictionary from '../lib/dictionary.json';
  import { getTranslations, t } from '../lib/i18n';
  export let locale = 'en';
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
  $: dict = getTranslations(locale);
  function getStrengthColor(bits: number) {
    if (bits === 0) return 'bg-zinc-200 dark:bg-zinc-800';
    if (bits < 40) return 'bg-red-500';
    if (bits < 80) return 'bg-yellow-500';
    return 'bg-emerald-500';
  }
  function getStrengthLabel(bits: number) {
    if (bits === 0) return t(dict, 'tools.passwordEntropy.waiting');
    if (bits < 40) return t(dict, 'tools.passwordEntropy.weak');
    if (bits < 60) return t(dict, 'tools.passwordEntropy.moderate');
    if (bits < 100) return t(dict, 'tools.passwordEntropy.strong');
    return t(dict, 'tools.passwordEntropy.veryStrong');
  }

  function getBarWidthClass(bits: number) {
    if (bits <= 0) return 'w-0';
    if (bits < 20) return 'w-1/5';
    if (bits < 40) return 'w-2/5';
    if (bits < 60) return 'w-3/5';
    if (bits < 80) return 'w-4/5';
    return 'w-full';
  }
</script>

<div class="form grid grid-cols-1 md:grid-cols-2 gap-8">
  <div class="space-y-5">
    <div>
      <h3 class="text-xs text-zinc-500 dark:text-zinc-400 mb-3">{t(dict, 'tools.passwordEntropy.entropyAnalyzer')}</h3>
      <div class="space-y-4">
        <input
          type="text"
          bind:value={password}
          placeholder={t(dict, 'tools.passwordEntropy.testPlaceholder')}
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
              class={`h-full rounded-full transition-all duration-500 ${getStrengthColor(entropy)} ${getBarWidthClass(entropy)}`}
            ></div>
          </div>
        </div>
        <p class="text-xs text-zinc-400 dark:text-zinc-500 leading-relaxed italic border-l-2 border-zinc-200 dark:border-zinc-800 pl-3">
          {t(dict, 'tools.passwordEntropy.entropyNote')}
        </p>
      </div>
    </div>
  </div>
  <div class="space-y-5">
    <div>
      <h3 class="text-xs text-zinc-500 dark:text-zinc-400 mb-3">{t(dict, 'tools.passwordEntropy.dicewareGenerator')}</h3>
      <div class="space-y-5 p-5 border border-zinc-200 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-900/40">
        <div class="flex items-center justify-between">
          <label class="text-xs text-zinc-500 dark:text-zinc-400">{t(dict, 'tools.passwordEntropy.wordCount')} {wordCount}</label>
          <input type="range" min="3" max="10" bind:value={wordCount} class="accent-emerald-500 h-1" />
        </div>
        <button
          on:click={generateDiceware}
          class="btn-outline w-full"
        >
          {t(dict, 'tools.passwordEntropy.generatePhrase')}
        </button>
        {#if generatedPassword}
          <div class="space-y-2">
            <div class="p-3.5 bg-white dark:bg-zinc-950 border border-emerald-200 dark:border-emerald-900/30 rounded-lg text-emerald-700 dark:text-emerald-400 font-mono text-sm break-words select-all text-center">
              {generatedPassword}
            </div>
            <div class="text-xs text-zinc-400 dark:text-zinc-600 text-center">
              {t(dict, 'tools.passwordEntropy.entropyPerWord').replace('{total}', String(wordCount * 14))}
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>
