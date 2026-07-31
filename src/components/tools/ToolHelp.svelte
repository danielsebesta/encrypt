<script lang="ts">
  import { t } from '../../lib/t';

  export let dict: Record<string, string>;
  export let prefix: string;
  /** Ordered help section suffixes under `${prefix}.help.<section>`. Missing keys are skipped. */
  export let sections: string[] = ['what', 'safe', 'watchOut'];

  $: items = sections
    .map((section) => {
      const bodyKey = `${prefix}.help.${section}`;
      const body = dict[bodyKey];
      if (!body) return null;
      return {
        section,
        label: t(dict, `tools.help.${section}`),
        body,
      };
    })
    .filter(Boolean) as { section: string; label: string; body: string }[];

  let dialogEl: HTMLDialogElement;

  function open() {
    dialogEl?.showModal();
  }

  function close() {
    dialogEl?.close();
  }

  function onBackdropClick(e: MouseEvent) {
    if (e.target === dialogEl) close();
  }
</script>

<button
  type="button"
  class="tool-help-trigger"
  aria-label={t(dict, 'tools.help.open')}
  on:click={open}
>?</button>

<dialog
  class="tool-help-dialog"
  aria-labelledby="tool-help-title"
  bind:this={dialogEl}
  on:click={onBackdropClick}
>
  <div class="tool-help-panel">
    <div class="tool-help-header">
      <h2 id="tool-help-title" class="tool-help-title">{t(dict, 'tools.help.title')}</h2>
      <button type="button" class="tool-help-close" aria-label={t(dict, 'tools.help.close')} on:click={close}>×</button>
    </div>
    <div class="tool-help-body">
      {#each items as item}
        <section>
          <h3>{item.label}</h3>
          <p>{item.body}</p>
        </section>
      {/each}
    </div>
  </div>
</dialog>

<style>
  .tool-help-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.35rem;
    height: 1.35rem;
    margin-left: 0.35rem;
    vertical-align: middle;
    border-radius: 9999px;
    border: 1px solid rgb(228 228 231);
    background: transparent;
    color: rgb(113 113 122);
    font-size: 0.75rem;
    font-weight: 700;
    line-height: 1;
    cursor: pointer;
  }

  :global(.dark) .tool-help-trigger {
    border-color: rgb(63 63 70);
    color: rgb(161 161 170);
  }

  .tool-help-trigger:hover {
    color: rgb(5 150 105);
    border-color: rgb(167 243 208);
  }

  .tool-help-dialog {
    padding: 0;
    border: none;
    background: transparent;
    max-width: min(28rem, calc(100vw - 2rem));
  }

  .tool-help-dialog::backdrop {
    background: rgba(24, 24, 27, 0.45);
  }

  .tool-help-panel {
    border-radius: 1rem;
    border: 1px solid rgb(228 228 231);
    background: white;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.12);
    overflow: hidden;
  }

  :global(.dark) .tool-help-panel {
    border-color: rgb(39 39 42);
    background: rgb(24 24 27);
  }

  .tool-help-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.9rem 1rem;
    border-bottom: 1px solid rgb(244 244 245);
  }

  :global(.dark) .tool-help-header {
    border-bottom-color: rgb(39 39 42);
  }

  .tool-help-title {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 700;
    color: rgb(24 24 27);
  }

  :global(.dark) .tool-help-title {
    color: rgb(244 244 245);
  }

  .tool-help-close {
    border: none;
    background: transparent;
    color: rgb(113 113 122);
    font-size: 1.25rem;
    line-height: 1;
    cursor: pointer;
    padding: 0.15rem 0.35rem;
  }

  .tool-help-body {
    padding: 1rem;
    display: grid;
    gap: 0.9rem;
  }

  .tool-help-body h3 {
    margin: 0 0 0.25rem;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgb(16 185 129);
  }

  .tool-help-body p {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.5;
    color: rgb(82 82 91);
  }

  :global(.dark) .tool-help-body p {
    color: rgb(161 161 170);
  }
</style>
