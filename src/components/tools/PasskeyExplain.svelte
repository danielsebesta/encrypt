<script lang="ts">
  import { t } from '../../lib/t';
  import Icon from '../Icon.svelte';
  import type { IconName } from '../../lib/iconManifest';

  let { dict, collapsible = false }: { dict: Record<string, string>; collapsible?: boolean } = $props();

  const ITEMS: { title: string; body: string; icon: IconName }[] = [
    { title: 'rooms.passkeyExplain.tab1', body: 'rooms.passkeyExplain.body1', icon: 'fingerprint-pattern' },
    { title: 'rooms.passkeyExplain.tab2', body: 'rooms.passkeyExplain.body2', icon: 'lock' },
    { title: 'rooms.passkeyExplain.tab3', body: 'rooms.passkeyExplain.body3', icon: 'shield' },
  ];
</script>

{#snippet content()}
  <ul class="passkey-explain__list">
    {#each ITEMS as item}
      <li class="passkey-explain__item">
        <span class="passkey-explain__icon" aria-hidden="true">
          <Icon name={item.icon} />
        </span>
        <div class="passkey-explain__text">
          <p class="passkey-explain__title">{t(dict, item.title)}</p>
          <p class="passkey-explain__body">{t(dict, item.body)}</p>
        </div>
      </li>
    {/each}
  </ul>
  <p class="passkey-explain__tip">{t(dict, 'rooms.passkeyExplain.tip')}</p>
{/snippet}

{#if collapsible}
  <details class="more passkey-explain">
    <summary>{t(dict, 'rooms.passkeyExplain.title')}</summary>
    <div class="more__body passkey-explain__body-wrap">
      {@render content()}
    </div>
  </details>
{:else}
  <section class="passkey-explain" aria-labelledby="passkey-explain-title">
    <h3 id="passkey-explain-title" class="label">{t(dict, 'rooms.passkeyExplain.title')}</h3>
    {@render content()}
  </section>
{/if}

<style>
  section.passkey-explain {
    display: grid;
    gap: 0.75rem;
  }
  .passkey-explain__body-wrap {
    margin-top: 0.25rem;
    gap: 0.75rem;
  }
  .passkey-explain__list {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
    border: 1px solid var(--line-soft);
    border-radius: 8px;
  }
  .passkey-explain__item {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: start;
    gap: 0.75rem;
    padding: 0.75rem 0.875rem;
  }
  .passkey-explain__item + .passkey-explain__item {
    border-top: 1px solid var(--line-soft);
  }
  .passkey-explain__icon {
    display: grid;
    place-items: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 6px;
    color: var(--accent-strong);
    background: var(--accent-weak);
  }
  .passkey-explain__text {
    display: grid;
    gap: 0.125rem;
    min-width: 0;
  }
  .passkey-explain__title {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
    line-height: 1.75rem;
    color: var(--text);
  }
  .passkey-explain__body {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--muted);
  }
  .passkey-explain__tip {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--muted);
  }
</style>
