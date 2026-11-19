<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '../../lib/t';
  import UltimateEncrypt from '../tools/UltimateEncrypt.svelte';
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

  let glide = false;

  function choose(index: number) {
    const tab = tabs[index].id;
    active = tab;
    visited[tab] = true;
    document.getElementById(`home-tab-${tab}`)?.focus();
  }

  function slideThumb(node: HTMLElement) {
    let frame = 0;
    const place = () => {
      const tab = node.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      if (!tab || !tab.offsetWidth) return;
      node.style.setProperty('--tabs-x', `${tab.offsetLeft}px`);
      node.style.setProperty('--tabs-y', `${tab.offsetTop}px`);
      node.style.setProperty('--tabs-w', `${tab.offsetWidth}px`);
      node.style.setProperty('--tabs-h', `${tab.offsetHeight}px`);
      if (!glide) frame = requestAnimationFrame(() => { glide = true; });
    };
    const observer = new ResizeObserver(place);
    observer.observe(node);
    place();
    return {
      update() { tick().then(place); },
      destroy() { observer.disconnect(); cancelAnimationFrame(frame); },
    };
  }

  function onKey(event: KeyboardEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const focused = event.target instanceof HTMLElement ? event.target.closest('[role="tab"]') : null;
    const index = focused ? tabs.findIndex((x) => focused.id === `home-tab-${x.id}`) : tabs.findIndex((x) => x.id === active);
    if (index < 0) return;
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    choose(next);
  }
</script>

<div class="stack">
  <div class="tabs tabs--slide" class:tabs--glide={glide} role="tablist" tabindex="-1" aria-label={t(dict, 'landing.try.label')} on:keydown={onKey} use:slideThumb={active}>
    <span class="tabs__thumb" aria-hidden="true"></span>
    {#each tabs as tab}
      <button
        type="button"
        role="tab"
        class="tab"
        id={`home-tab-${tab.id}`}
        aria-selected={active === tab.id}
        aria-controls={`home-panel-${tab.id}`}
        tabindex={active === tab.id ? 0 : -1}
        on:click={() => choose(tabs.indexOf(tab))}
      >
        <Icon name={tab.icon} />
        <span>{t(dict, tab.label)}</span>
      </button>
    {/each}
  </div>

  {#each tabs as tab}
    <div id={`home-panel-${tab.id}`} role="tabpanel" tabindex="0" aria-labelledby={`home-tab-${tab.id}`} class="stack" hidden={active !== tab.id}>
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
