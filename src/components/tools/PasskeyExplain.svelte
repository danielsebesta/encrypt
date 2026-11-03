<script lang="ts">
  import { t } from '../../lib/t';

  let { dict }: { dict: Record<string, string> } = $props();

  const ITEMS = [
    { title: 'rooms.passkeyExplain.tab1', body: 'rooms.passkeyExplain.body1', icon: '<path d="M12 10v12"/><path d="M12 2a4 4 0 0 0-4 4v8"/><path d="M16 6a4 4 0 0 1 0 8"/><path d="M8 14a4 4 0 0 0 8 0"/>' },
    { title: 'rooms.passkeyExplain.tab2', body: 'rooms.passkeyExplain.body2', icon: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>' },
    { title: 'rooms.passkeyExplain.tab3', body: 'rooms.passkeyExplain.body3', icon: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/>' },
  ];
</script>

<section class="passkey-explain" aria-labelledby="passkey-explain-title">
  <h3 id="passkey-explain-title" class="label">{t(dict, 'rooms.passkeyExplain.title')}</h3>
  <ul class="passkey-explain__list">
    {#each ITEMS as item}
      <li class="passkey-explain__item">
        <span class="passkey-explain__icon" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{@html item.icon}</svg>
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
