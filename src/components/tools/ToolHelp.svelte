<script lang="ts">
  import { t } from '../../lib/t';

  export let dict: Record<string, string>;
  export let prefix: string;
  /** Ordered help section suffixes under `${prefix}.help.<section>`. Missing keys are skipped. */
  export let sections: string[] = ['what', 'safe', 'watchOut'];

  $: items = sections
    .map((section) => {
      const body = dict[`${prefix}.help.${section}`];
      if (!body) return null;
      return { section, label: t(dict, `tools.help.${section}`), body };
    })
    .filter(Boolean) as { section: string; label: string; body: string }[];

  let dialogEl: HTMLDialogElement;

  function onBackdropClick(e: MouseEvent) {
    if (e.target === dialogEl) dialogEl.close();
  }
</script>

<button type="button" class="help-trigger" aria-label={t(dict, 'tools.help.open')} on:click={() => dialogEl?.showModal()}>?</button>

<dialog class="dialog" aria-labelledby="tool-help-title" bind:this={dialogEl} on:click={onBackdropClick}>
  <div class="dialog__panel">
    <div class="dialog__head">
      <h2 id="tool-help-title" class="dialog__title">{t(dict, 'tools.help.title')}</h2>
      <button type="button" class="btn-ghost btn-sm btn-icon" aria-label={t(dict, 'tools.help.close')} on:click={() => dialogEl.close()}>
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
    </div>
    <div class="dialog__body">
      {#each items as item}
        <section>
          <h3>{item.label}</h3>
          <p>{item.body}</p>
        </section>
      {/each}
    </div>
  </div>
</dialog>
