<script lang="ts">
  import { vigenere } from '../../lib/crypto';
  import { getTranslations, t } from '../../lib/i18n';

  export let locale = 'en';
  $: dict = getTranslations(locale);

  let key = 'SECRET';
  let input = '';
  let output = '';
  let decrypt = false;
  $: output = vigenere(input, key, decrypt);
</script>

<div class="space-y-6 animate-in fade-in duration-500">
    <div class="grid gap-6">
        <div class="grid gap-1.5">
            <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider">{t(dict, 'tools.vigenere.secretKeyphrase')}</label>
            <input bind:value={key} class="input font-bold tracking-widest text-emerald-600 dark:text-emerald-400" placeholder={t(dict, 'tools.vigenere.keyPlaceholder')} />
        </div>

        <div class="flex p-1 bg-zinc-100 dark:bg-zinc-900 rounded-lg w-fit mx-auto">
            <button on:click={() => decrypt = false} class="px-6 py-2 text-xs font-bold rounded-md transition-all { !decrypt ? 'bg-white dark:bg-zinc-800 text-emerald-500 shadow-sm' : 'text-zinc-500'}">{t(dict, 'tools.vigenere.encrypt')}</button>
            <button on:click={() => decrypt = true} class="px-6 py-2 text-xs font-bold rounded-md transition-all { decrypt ? 'bg-white dark:bg-zinc-800 text-emerald-500 shadow-sm' : 'text-zinc-500'}">{t(dict, 'tools.vigenere.decrypt')}</button>
        </div>

        <div class="grid gap-1.5">
            <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider">{t(dict, 'tools.vigenere.inputText')}</label>
            <textarea bind:value={input} placeholder={t(dict, 'tools.vigenere.messagePlaceholder')} class="input h-32"></textarea>
        </div>

        <div class="grid gap-1.5">
            <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider">{t(dict, 'tools.vigenere.result')}</label>
            <div class="p-8 bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800 rounded-2xl text-2xl font-bold text-center text-zinc-800 dark:text-zinc-100 font-mono break-all shadow-inner">
                {output || '...'}
            </div>
        </div>
    </div>
</div>
