<script lang="ts">
  import { t } from '../../lib/t';

  let { dict }: { dict: Record<string, string> } = $props();

  const STEPS = [
    { tab: 'rooms.passkeyExplain.tab1', body: 'rooms.passkeyExplain.body1', icon: 'finger' },
    { tab: 'rooms.passkeyExplain.tab2', body: 'rooms.passkeyExplain.body2', icon: 'lock' },
    { tab: 'rooms.passkeyExplain.tab3', body: 'rooms.passkeyExplain.body3', icon: 'shield' },
  ] as const;

  let step = $state(0);
</script>

<section class="passkey-explain" aria-labelledby="passkey-explain-title">
  <h3 id="passkey-explain-title" class="label">{t(dict, 'rooms.passkeyExplain.title')}</h3>
  <div class="choice-list" role="tablist" aria-label={t(dict, 'rooms.passkeyExplain.title')}>
    {#each STEPS as item, i}
      <button
        type="button"
        class="choice"
        class:choice--active={step === i}
        role="tab"
        id="passkey-tab-{i}"
        aria-selected={step === i}
        aria-controls="passkey-panel"
        tabindex={step === i ? 0 : -1}
        onclick={() => { step = i; }}
        onkeydown={(event) => {
          if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            event.preventDefault();
            step = (step + 1) % STEPS.length;
            document.getElementById(`passkey-tab-${step}`)?.focus();
          } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
            event.preventDefault();
            step = (step - 1 + STEPS.length) % STEPS.length;
            document.getElementById(`passkey-tab-${step}`)?.focus();
          }
        }}
      >
        <span class="passkey-explain__icon" aria-hidden="true">
          {#if item.icon === 'finger'}
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 10v12"/><path d="M12 2a4 4 0 0 0-4 4v8"/><path d="M16 6a4 4 0 0 1 0 8"/><path d="M8 14a4 4 0 0 0 8 0"/></svg>
          {:else if item.icon === 'lock'}
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          {:else}
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/></svg>
          {/if}
        </span>
        <span class="choice__title">{t(dict, item.tab)}</span>
      </button>
    {/each}
  </div>
  <div
    id="passkey-panel"
    class="passkey-explain__panel"
    role="tabpanel"
    aria-labelledby="passkey-tab-{step}"
  >
    <p class="hint">{t(dict, STEPS[step].body)}</p>
  </div>
  <p class="hint passkey-explain__tip">{t(dict, 'rooms.passkeyExplain.tip')}</p>
</section>

<style>
  .passkey-explain {
    display: grid;
    gap: 0.75rem;
  }
  .passkey-explain .choice {
    align-items: center;
    padding-block: 0.65rem;
  }
  .passkey-explain__icon {
    display: grid;
    place-items: center;
    width: 1.75rem;
    height: 1.75rem;
    flex-shrink: 0;
    border-radius: 0.5rem;
    color: var(--accent);
    background: var(--accent-weak);
  }
  .passkey-explain__panel {
    border-radius: 0.75rem;
    border: 1px solid var(--line-soft);
    background: var(--bg);
    padding: 0.85rem 1rem;
    animation: passkey-panel-in var(--duration-fast) var(--ease-out);
  }
  .passkey-explain__tip {
    margin: 0;
  }
  @keyframes passkey-panel-in {
    from {
      opacity: 0;
      transform: translateY(0.25rem);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .passkey-explain__panel {
      animation: none;
    }
  }
</style>
