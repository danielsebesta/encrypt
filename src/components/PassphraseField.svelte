<script lang="ts">
  import { t } from '../lib/t';
  import Icon from './Icon.svelte';
  import { copyText } from '../lib/clipboard';
  import { asciiKit, kitAllowed } from '../lib/asciiKit';

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

  let decoding = false;
  let decodeTimer: ReturnType<typeof setTimeout> | undefined;

  function useGenerated() {
    value = generate();
    revealed = true;
    shownByUser = false;
    clearTimeout(decodeTimer);
    decoding = false;
    if (kitAllowed() && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      decoding = true;
      decodeTimer = setTimeout(() => { decoding = false; }, 1000);
    }
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
  <div class="passphrase__field">
  <input
    {id}
    class="input"
    class:passphrase__input--decoding={decoding}
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
  {#if decoding}
    <span class="passphrase__decode" aria-hidden="true" use:asciiKit={(kit, node) => kit.decode(node, { duration: 800, scramble: true, settle: 'text', replayOnHover: false })}>{value}</span>
  {/if}
  </div>
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
      <Icon name="eye-off" />
    {:else}
      <Icon name="eye" />
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
      <Icon name="check" />
    {:else}
      <Icon name="copy" />
    {/if}
  </button>
  <button
    type="button"
    class="btn-ghost btn-sm btn-icon"
    on:click={useGenerated}
    aria-label={t(dict, 'common.generatePassphrase')}
    title={t(dict, 'common.generatePassphrase')}
  >
    <Icon name="dices" />
  </button>
</div>

<style>
  .passphrase__field { position: relative; flex: 1; min-width: 0; display: flex; }
  .passphrase__field :global(.input) { flex: 1; }
  .passphrase__input--decoding { color: transparent !important; -webkit-text-fill-color: transparent; }
  .passphrase__decode { position: absolute; inset: 0; display: flex; align-items: center; padding: 0 0.75rem; font-family: var(--font-mono, monospace); font-size: 1rem; color: var(--accent); white-space: nowrap; overflow: hidden; pointer-events: none; }
</style>
