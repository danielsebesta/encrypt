<script lang="ts">
  import { t } from '../lib/t';

  export let dict: Record<string, string>;
  export let id: string;
  export let value = '';
  export let placeholder = '';
  export let describedby: string | undefined = undefined;
  export let invalid = false;
  export let generate: () => string;

  export let revealed = false;

  function useGenerated() {
    value = generate();
    revealed = true;
  }
</script>

<div class="passphrase">
  <input
    {id}
    class="input"
    type={revealed ? 'text' : 'password'}
    bind:value
    on:input
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
    on:click={() => { revealed = !revealed; }}
    aria-label={t(dict, 'common.showPassword')}
    aria-pressed={revealed}
    aria-controls={id}
    title={t(dict, revealed ? 'common.hidePassword' : 'common.showPassword')}
  >
    {#if revealed}
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="M14.08 14.16a3 3 0 0 1-4.24-4.24"/><path d="m2 2 20 20"/></svg>
    {:else}
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/></svg>
    {/if}
  </button>
  <button
    type="button"
    class="btn-ghost btn-sm btn-icon"
    on:click={useGenerated}
    aria-label={t(dict, 'common.generatePassphrase')}
    title={t(dict, 'common.generatePassphrase')}
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="12" height="12" x="2" y="10" rx="2" ry="2"/><path d="m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6"/><path d="M6 18h.01"/><path d="M10 14h.01"/><path d="M15 6h.01"/><path d="M18 9h.01"/></svg>
  </button>
</div>
