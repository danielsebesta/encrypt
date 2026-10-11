<script lang="ts">
  import { generateToken } from '../../lib/ids';
  import { onMount } from 'svelte';
  import { t } from '../../lib/t';
  import CopyButton from '../CopyButton.svelte';

  export let locale = 'en';
  export let dict: Record<string, string>;

  let length = 32;
  let type: 'hex' | 'base64' | 'url-safe' = 'hex';
  let result = '';
  let valid = true;

  function refresh() {
    const n = Number(length);
    valid = Number.isInteger(n) && n >= 8 && n <= 128;
    if (!valid) return;
    result = generateToken(n, type);
  }

  onMount(refresh);
</script>

<div class="stack">
  <div class="grid gap-4 sm:grid-cols-2">
    <div class="field">
      <label class="label" for="token-length">{t(dict, 'tools.token.entropyLength')}</label>
      <input id="token-length" type="number" inputmode="numeric" bind:value={length} on:input={refresh} min="8" max="128" class="input" aria-describedby="token-length-hint" aria-invalid={valid ? undefined : 'true'} />
      <p id="token-length-hint" class="hint" class:text-danger={!valid}>{t(dict, 'tools.token.lengthRange')}</p>
    </div>
    <div class="field">
      <label class="label" for="token-type">{t(dict, 'tools.token.encoding')}</label>
      <select id="token-type" bind:value={type} on:change={refresh} class="input">
        <option value="hex">{t(dict, 'tools.token.hex')}</option>
        <option value="base64">{t(dict, 'tools.token.base64Enc')}</option>
        <option value="url-safe">{t(dict, 'tools.token.urlSafe')}</option>
      </select>
    </div>
  </div>

  <div class="field">
    <div class="output-head">
      <span class="label" id="token-label">{t(dict, 'tools.token.generatedToken')}</span>
      <CopyButton text={result} label={t(dict, 'common.copy')} copiedLabel={t(dict, 'common.copied')} />
    </div>
    <output class="output output--ok" aria-labelledby="token-label" aria-live="polite">{result}</output>
  </div>

  <button type="button" class="btn w-full" on:click={refresh}>{t(dict, 'tools.token.refreshToken')}</button>
</div>
