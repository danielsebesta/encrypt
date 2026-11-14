<script lang="ts">
  import { t } from '../../lib/t';
  import UltimateEncrypt from '../tools/UltimateEncrypt.svelte';
  import { asciiKit, glAvailable, type KitModule } from '../../lib/asciiKit';
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
  let handle: { select(index: number, focus?: boolean): void; destroy(): void } | null = null;

  function choose(index: number) {
    const tab = tabs[index].id;
    active = tab;
    visited[tab] = true;
    try { handle?.select(index); } catch {}
  }

  const mountTabs = (kit: KitModule, node: HTMLElement) => {
    if (!glAvailable()) return null;
    const made = kit.tabs(node, { panels: 'none', manage: false });
    handle = made;
    let tries = 0;
    const probe = () => {
      if (!handle) return;
      if (node.style.getPropertyValue('--tabs-w')) glide = true;
      else if (tries++ < 30) requestAnimationFrame(probe);
    };
    requestAnimationFrame(probe);
    return { destroy() { glide = false; handle = null; made.destroy(); } };
  };

  function onKey(event: KeyboardEvent) {
    const index = tabs.findIndex((x) => x.id === active);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    choose(next);
    document.getElementById(`home-tab-${tabs[next].id}`)?.focus();
  }
</script>

<div class="stack">
  <div class="tabs tabs--slide" class:tabs--kit={glide} role="tablist" tabindex="-1" aria-label={t(dict, 'landing.try.label')} on:keydown={onKey} use:asciiKit={mountTabs}>
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
