<script lang="ts">
  import { t } from '../../lib/t';
  import UltimateEncrypt from '../tools/UltimateEncrypt.svelte';
  import { sendIcon, chatIcon } from '../../lib/tools';

  const penIcon = '<path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>';

  export let locale = 'en';
  export let dict: Record<string, string>;

  type Tab = 'send' | 'chat' | 'whiteboard';

  const tabs: { id: Tab; label: string; text: string; icon: string }[] = [
    { id: 'send', label: 'landing.try.tab.send', text: 'landing.paths.share.text', icon: sendIcon },
    { id: 'chat', label: 'landing.try.tab.chat', text: 'landing.paths.chat.text', icon: chatIcon },
    { id: 'whiteboard', label: 'landing.try.tab.whiteboard', text: 'landing.paths.whiteboard.text', icon: penIcon },
  ];

  const loaders: Record<Exclude<Tab, 'send'>, () => Promise<{ default: any }>> = {
    chat: () => import('../tools/ChatCreate.svelte'),
    whiteboard: () => import('../tools/WhiteboardCreate.svelte'),
  };

  let active: Tab = 'send';
  let visited: Record<Tab, boolean> = { send: true, chat: false, whiteboard: false };

  function select(tab: Tab) {
    active = tab;
    visited[tab] = true;
  }

  function onKey(event: KeyboardEvent) {
    const index = tabs.findIndex((x) => x.id === active);
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = tabs[(index + step + tabs.length) % tabs.length].id;
    select(next);
    document.getElementById(`home-tab-${next}`)?.focus();
  }
</script>

<div class="stack">
  <div class="tabs" role="tablist" tabindex="-1" aria-label={t(dict, 'landing.try.label')} on:keydown={onKey}>
    {#each tabs as tab}
      <button
        type="button"
        role="tab"
        class="tab"
        id={`home-tab-${tab.id}`}
        aria-selected={active === tab.id}
        aria-controls={`home-panel-${tab.id}`}
        tabindex={active === tab.id ? 0 : -1}
        on:click={() => select(tab.id)}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="shrink-0">{@html tab.icon}</svg>
        <span>{t(dict, tab.label)}</span>
      </button>
    {/each}
  </div>

  {#each tabs as tab}
    <div id={`home-panel-${tab.id}`} role="tabpanel" aria-labelledby={`home-tab-${tab.id}`} class="stack" hidden={active !== tab.id}>
      <p class="hint">{t(dict, tab.text)}</p>
      {#if tab.id === 'send'}
        <UltimateEncrypt {locale} {dict} resultArt={false} />
      {:else if visited[tab.id]}
        {#await loaders[tab.id]() then mod}
          <svelte:component this={mod.default} {locale} {dict} />
        {/await}
      {/if}
    </div>
  {/each}
</div>
