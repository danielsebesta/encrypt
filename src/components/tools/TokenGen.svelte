<script lang="ts">
  import { generateToken } from '../../lib/crypto';
  import { onMount } from 'svelte';
  import { getTranslations, t } from '../../lib/i18n';
  export let locale = 'en';
  $: dict = getTranslations(locale);
  let length = 32;
  let type: 'hex' | 'base64' | 'url-safe' = 'hex';
  let result = '';

  function refresh() {
    result = generateToken(length, type);
  }

  onMount(refresh);

  function copy() {
    navigator.clipboard.writeText(result);
  }
</script>

<div class="space-y-6 animate-in fade-in duration-500">
  <div class="grid gap-6">
    <div class="grid grid-cols-2 gap-4">
        <div class="grid gap-1.5">
            <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider">{t(dict, 'tools.token.entropyLength')}</label>
            <input type="number" bind:value={length} on:input={refresh} min="8" max="128" class="input" />
        </div>
        <div class="grid gap-1.5">
            <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider">{t(dict, 'tools.token.encoding')}</label>
            <select bind:value={type} on:change={refresh} class="input">
                <option value="hex">{t(dict, 'tools.token.hex')}</option>
                <option value="base64">{t(dict, 'tools.token.base64Enc')}</option>
                <option value="url-safe">{t(dict, 'tools.token.urlSafe')}</option>
            </select>
        </div>
    </div>

    <div class="grid gap-2">
      <div class="flex justify-between items-end">
        <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider">{t(dict, 'tools.token.generatedToken')}</label>
        <button on:click={copy} class="text-[10px] text-emerald-600 font-bold hover:underline">{t(dict, 'tools.token.copy')}</button>
      </div>
      <div class="p-6 bg-emerald-50/30 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/50 rounded-2xl font-mono text-lg break-all text-center text-emerald-700 dark:text-emerald-400">
        {result}
      </div>
    </div>

    <button on:click={refresh} class="btn-secondary w-full py-4 uppercase tracking-widest text-xs font-black">{t(dict, 'tools.token.refreshToken')}</button>
  </div>
</div>
