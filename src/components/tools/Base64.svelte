<script lang="ts">
  import { base64Encode, base64Decode } from '../../lib/crypto';
  import { getTranslations, t } from '../../lib/i18n';

  export let locale = 'en';
  $: dict = getTranslations(locale);

  let input = '';
  let output = '';
  let mode: 'encode' | 'decode' = 'encode';

  function handleProcess() {
    if (!input) {
        output = '';
        return;
    }
    try {
        output = mode === 'encode' ? base64Encode(input) : base64Decode(input);
    } catch (e) {
        output = mode === 'encode' ? t(dict, 'tools.base64.errorInvalidEncode') : t(dict, 'tools.base64.errorInvalid');
    }
  }

  $: if (input || mode) handleProcess();

  function copy() {
    navigator.clipboard.writeText(output);
  }
</script>

<div class="space-y-6 animate-in fade-in duration-500">
  <div class="flex p-1 bg-zinc-100 dark:bg-zinc-900 rounded-lg">
    <button on:click={() => mode = 'encode'} class="flex-1 py-2 text-xs font-bold rounded-md transition-all {mode === 'encode' ? 'bg-white dark:bg-zinc-800 text-emerald-500 shadow-sm' : 'text-zinc-500'}">{t(dict, 'tools.base64.encode')}</button>
    <button on:click={() => mode = 'decode'} class="flex-1 py-2 text-xs font-bold rounded-md transition-all {mode === 'decode' ? 'bg-white dark:bg-zinc-800 text-emerald-500 shadow-sm' : 'text-zinc-500'}">{t(dict, 'tools.base64.decode')}</button>
  </div>

  <div class="grid gap-6">
    <div class="grid gap-1.5">
        <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider">{t(dict, 'tools.base64.inputText')}</label>
        <textarea bind:value={input} placeholder={mode === 'encode' ? t(dict, 'tools.base64.encodePlaceholder') : t(dict, 'tools.base64.decodePlaceholder')} class="input min-h-[120px] font-mono text-sm"></textarea>
    </div>

    <div class="grid gap-2">
      <div class="flex justify-between items-end">
        <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider">{t(dict, 'tools.base64.outputResult')}</label>
        <button on:click={copy} class="text-[10px] text-emerald-600 font-bold hover:underline">{t(dict, 'tools.base64.copy')}</button>
      </div>
      <div class="p-6 bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-2xl font-mono text-sm break-all min-h-[120px] text-zinc-800 dark:text-zinc-200">
        {output}
      </div>
    </div>
  </div>
</div>
