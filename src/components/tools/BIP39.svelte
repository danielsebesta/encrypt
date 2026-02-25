<script lang="ts">
  import { generateMnemonic } from '../../lib/crypto';
  import { onMount } from 'svelte';
  import { getTranslations, t } from '../../lib/i18n';

  export let locale = 'en';
  $: dict = getTranslations(locale);

  let mnemonic = '';

  function refresh() {
    mnemonic = generateMnemonic();
  }

  onMount(refresh);

  function copy() {
    navigator.clipboard.writeText(mnemonic);
  }
</script>

<div class="space-y-6 animate-in fade-in duration-500">
  <div class="grid gap-8">
    <div class="grid gap-3">
        <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider text-center">{t(dict, 'tools.bip39.recoveryPhrase')}</label>
        <div class="grid grid-cols-3 md:grid-cols-4 gap-3">
            {#each mnemonic.split(' ') as word, i}
                <div class="p-3 bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/50 rounded-xl text-center">
                    <span class="text-[9px] text-emerald-600/50 block mb-0.5 font-bold uppercase">{i + 1}</span>
                    <span class="font-mono text-sm font-bold text-emerald-800 dark:text-emerald-400">{word}</span>
                </div>
            {/each}
        </div>
    </div>

    <div class="p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 rounded-xl flex gap-3 items-start">
        <span class="text-xl">⚠️</span>
        <div class="text-[10px] text-amber-800 dark:text-amber-500 font-medium leading-relaxed uppercase tracking-wider">
            {t(dict, 'tools.bip39.warning')}
        </div>
    </div>

    <div class="flex gap-3">
        <button on:click={refresh} class="btn flex-1 py-4 uppercase tracking-widest text-xs font-black">{t(dict, 'tools.bip39.generateNew')}</button>
        <button on:click={copy} class="btn-outline flex-1 py-4 uppercase tracking-widest text-xs font-black">{t(dict, 'tools.bip39.copyPhrase')}</button>
    </div>
  </div>
</div>
