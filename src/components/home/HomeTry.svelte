<script lang="ts">
  import { t } from '../../lib/t';
  import UltimateEncrypt from '../tools/UltimateEncrypt.svelte';
  import { onMount } from 'svelte';
  import Icon from '../Icon.svelte';
  import { sendIcon, chatIcon, whiteboardIcon } from '../../lib/tools';
  import type { IconName } from '../../lib/iconManifest';

  export let locale = 'en';
  export let dict: Record<string, string>;

  type Tab = 'send' | 'chat' | 'whiteboard';

  const tabs: { id: Tab; label: string; text: string; icon: IconName }[] = [
    { id: 'send', label: 'landing.try.tab.send', text: 'landing.paths.share.text', icon: sendIcon },
    { id: 'chat', label: 'landing.try.tab.chat', text: 'landing.paths.chat.text', icon: chatIcon },
    { id: 'whiteboard', label: 'landing.try.tab.whiteboard', text: 'landing.paths.whiteboard.text', icon: whiteboardIcon },
  ];

  const loaders: Record<Exclude<Tab, 'send'>, () => Promise<{ default: any }>> = {
    chat: () => import('../tools/ChatCreate.svelte'),
    whiteboard: () => import('../tools/WhiteboardCreate.svelte'),
  };

  let active: Tab = 'send';
  let visited: Record<Tab, boolean> = { send: true, chat: false, whiteboard: false };
  let tablist: HTMLElement;

  function placeIndicator() {
    const current = tablist?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!current) return;
    tablist.style.setProperty('--tab-x', `${current.offsetLeft}px`);
    tablist.style.setProperty('--tab-w', `${current.offsetWidth}px`);
  }

  function select(tab: Tab) {
    active = tab;
    visited[tab] = true;
    requestAnimationFrame(placeIndicator);
  }

  onMount(() => {
    placeIndicator();
    const observer = new ResizeObserver(placeIndicator);
    observer.observe(tablist);
    document.fonts?.ready.then(placeIndicator);
    return () => observer.disconnect();
  });

  function onKey(event: KeyboardEvent) {
    const index = tabs.findIndex((x) => x.id === active);
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    const next = tabs[nextIndex].id;
    select(next);
    document.getElementById(`home-tab-${next}`)?.focus();
  }
</script>

<div class="stack">
  <div class="tabs tabs--slide" bind:this={tablist} role="tablist" tabindex="-1" aria-label={t(dict, 'landing.try.label')} on:keydown={onKey}>
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
        <Icon name={tab.icon} />
        <span>{t(dict, tab.label)}</span>
      </button>
    {/each}
    <span class="tabs__indicator" aria-hidden="true"></span>
  </div>

  {#each tabs as tab}
    <div id={`home-panel-${tab.id}`} role="tabpanel" aria-labelledby={`home-tab-${tab.id}`} class="stack" hidden={active !== tab.id}>
      <p class="hint">{t(dict, tab.text)}</p>
      {#if tab.id === 'send'}
        <UltimateEncrypt {locale} {dict} />
      {:else if visited[tab.id]}
        {#await loaders[tab.id]() then mod}
          <svelte:component this={mod.default} {locale} {dict} />
        {/await}
      {/if}
    </div>
  {/each}
</div>
