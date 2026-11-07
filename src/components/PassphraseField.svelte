<script lang="ts">
  import { t } from '../lib/t';
  import { LUCIDE } from '../lib/lucideIcons';
  import { copyText } from '../lib/clipboard';

  export let dict: Record<string, string>;
  export let id: string;
  export let value = '';
  export let placeholder = '';
  export let describedby: string | undefined = undefined;
  export let invalid = false;
  export let generate: () => string;

  export let revealed = false;

  // A generated passphrase is shown so it can be read out; editing it hides it unless the eye was used.
  let shownByUser = false;
  let copied = false;
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  function useGenerated() {
    value = generate();
    revealed = true;
    shownByUser = false;
  }

  function hideWhileEditing() {
    if (!shownByUser) revealed = false;
  }

  async function copyValue() {
    if (!value) return;
    copied = await copyText(value);
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => { copied = false; }, 1500);
  }
</script>

<div class="passphrase">
  <input
    {id}
    class="input"
    type={revealed ? 'text' : 'password'}
    bind:value
    on:input
    on:input={hideWhileEditing}
    {placeholder}
    autocomplete="off"
    autocapitalize="off"
    spellcheck="false"
    data-lpignore="true"
    data-1p-ignore
    data-bwignore="true"
    aria-describedby={describedby}
    aria-invalid={invalid ? 'true' : undefined}
  />
  <button
    type="button"
    class="btn-ghost btn-sm btn-icon"
    on:click={() => { revealed = !revealed; shownByUser = revealed; }}
    aria-label={t(dict, 'common.showPassword')}
    aria-pressed={revealed}
    aria-controls={id}
    title={t(dict, revealed ? 'common.hidePassword' : 'common.showPassword')}
  >
    {#if revealed}
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['eye-off']}</svg>
    {:else}
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['eye']}</svg>
    {/if}
  </button>
  <button
    type="button"
    class="btn-ghost btn-sm btn-icon"
    disabled={!value}
    on:click={copyValue}
    aria-label={t(dict, copied ? 'common.copied' : 'common.copy')}
    title={t(dict, copied ? 'common.copied' : 'common.copy')}
  >
    {#if copied}
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['check']}</svg>
    {:else}
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['copy']}</svg>
    {/if}
  </button>
  <button
    type="button"
    class="btn-ghost btn-sm btn-icon"
    on:click={useGenerated}
    aria-label={t(dict, 'common.generatePassphrase')}
    title={t(dict, 'common.generatePassphrase')}
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['dices']}</svg>
  </button>
</div>
