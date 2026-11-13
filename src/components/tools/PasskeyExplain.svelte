<script lang="ts">
  import { t } from '../../lib/t';
  import Icon from '../Icon.svelte';
  import type { IconName } from '../../lib/iconManifest';

  let { dict }: { dict: Record<string, string> } = $props();

  const ITEMS: { title: string; body: string; icon: IconName }[] = [
    { title: 'rooms.passkeyExplain.tab1', body: 'rooms.passkeyExplain.body1', icon: 'fingerprint-pattern' },
    { title: 'rooms.passkeyExplain.tab2', body: 'rooms.passkeyExplain.body2', icon: 'lock' },
    { title: 'rooms.passkeyExplain.tab3', body: 'rooms.passkeyExplain.body3', icon: 'shield' },
  ];
</script>

<section class="passkey-explain" aria-labelledby="passkey-explain-title">
  <h3 id="passkey-explain-title" class="label">{t(dict, 'rooms.passkeyExplain.title')}</h3>
  <ul class="passkey-explain__list">
    {#each ITEMS as item}
      <li class="passkey-explain__item">
        <span class="passkey-explain__icon" aria-hidden="true">
          <Icon name={item.icon} size={20} />
        </span>
        <div>
          <p class="passkey-explain__title">{t(dict, item.title)}</p>
          <p class="hint">{t(dict, item.body)}</p>
        </div>
      </li>
    {/each}
  </ul>
  <p class="hint">{t(dict, 'rooms.passkeyExplain.tip')}</p>
</section>

<style>
  .passkey-explain {
    display: grid;
    gap: 0.75rem;
  }
  .passkey-explain__list {
    display: grid;
    gap: 0.75rem;
  }
  @media (min-width: 40rem) {
    .passkey-explain__list {
      grid-template-columns: repeat(3, 1fr);
    }
  }
  .passkey-explain__item {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: start;
    gap: 0.75rem;
    border-radius: 0.75rem;
    border: 1px solid var(--line-soft);
    background: var(--bg);
    padding: 0.85rem;
  }
  @media (min-width: 40rem) {
    .passkey-explain__item {
      grid-template-columns: 1fr;
    }
  }
  .passkey-explain__icon {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border-radius: 0.5rem;
    color: var(--accent-strong);
    background: var(--accent-weak);
  }
  .passkey-explain__title {
    font-weight: 700;
    color: var(--text);
    margin-bottom: 0.15rem;
  }
</style>
