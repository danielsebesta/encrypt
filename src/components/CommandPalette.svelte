<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { t } from '../lib/t';
  import { buildCommandItems, commandItemMatches, type CommandItem } from '../lib/commandItems';
  import type { IconName } from '../lib/iconManifest';

  let { locale, dict }: { locale: string; dict: Record<string, string> } = $props();

  type ThemeEntry = { id: 'theme'; label: string; icon: IconName; kind: 'theme' };
  type Entry = CommandItem | ThemeEntry;

  const prefix = '';
  let dark = $state(false);
  let shortcut = $state('Ctrl K');
  let open = $state(false);
  let query = $state('');
  let active = $state(0);
  let dialogEl = $state<HTMLDialogElement | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);
  let returnFocus: HTMLElement | null = null;

  const themeEntry = $derived<ThemeEntry>({
    id: 'theme',
    label: t(dict, 'nav.toggleTheme'),
    icon: dark ? 'sun' : 'moon',
    kind: 'theme',
  });
  const entries = $derived<Entry[]>([...buildCommandItems(prefix, dict), themeEntry]);
  const filtered = $derived(entries.filter((entry) => commandItemMatches(entry.label, query)));
  const selected = $derived(filtered.length === 0 ? -1 : Math.min(active, filtered.length - 1));
  const activeId = $derived(selected >= 0 ? `palette-opt-${filtered[selected].id}` : undefined);

  function isLink(entry: Entry): entry is CommandItem {
    return 'href' in entry;
  }

  function openPalette() {
    if (!dialogEl || dialogEl.open) return;
    const current = document.activeElement;
    returnFocus = current instanceof HTMLElement && !dialogEl.contains(current) ? current : null;
    query = '';
    active = 0;
    dialogEl.showModal();
    open = true;
    inputEl?.focus();
  }

  function closePalette() {
    dialogEl?.close();
  }

  function onDialogClose() {
    open = false;
    query = '';
    active = 0;
    const back = returnFocus;
    returnFocus = null;
    if (back?.isConnected) back.focus();
  }

  function onDialogClick(event: MouseEvent) {
    if (event.target === dialogEl) dialogEl?.close();
  }

  function activate(entry: Entry) {
    if (isLink(entry)) {
      window.location.assign(entry.href);
      return;
    }
    const toggle = document.getElementById('theme-toggle');
    dialogEl?.close();
    toggle?.click();
  }

  function onLinkClick(event: MouseEvent, href: string) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    window.location.assign(href);
  }

  function onInputKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (selected < filtered.length - 1) active = selected + 1;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (selected > 0) active = selected - 1;
    } else if (event.key === 'Home') {
      event.preventDefault();
      active = 0;
    } else if (event.key === 'End') {
      event.preventDefault();
      active = Math.max(0, filtered.length - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const entry = filtered[selected];
      if (entry) activate(entry);
    }
  }

  function onTrigger() {
    if (dialogEl?.open) closePalette();
    else openPalette();
  }

  $effect(() => {
    if (!open || selected < 0) return;
    const id = filtered[selected]?.id;
    if (!id) return;
    document.getElementById(`palette-opt-${id}`)?.scrollIntoView({ block: 'nearest' });
  });

  onMount(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const platform = nav.userAgentData?.platform || navigator.platform || '';
    if (/mac/i.test(platform)) shortcut = '⌘K';

    const syncTheme = () => {
      dark = document.documentElement.classList.contains('dark');
    };
    syncTheme();
    const themeObserver = new MutationObserver(syncTheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      if (dialogEl?.open) closePalette();
      else openPalette();
    };
    window.addEventListener('keydown', onKey, true);

    return () => {
      themeObserver.disconnect();
      window.removeEventListener('keydown', onKey, true);
    };
  });
</script>

<button
  type="button"
  class="btn-ghost btn-sm palette__trigger"
  aria-label={t(dict, 'palette.open')}
  aria-keyshortcuts="Control+K"
  aria-expanded={open}
  aria-controls="command-palette"
  aria-haspopup="dialog"
  onclick={onTrigger}
>
  <Icon name="search" />
  <kbd class="palette__kbd" aria-hidden="true">{shortcut}</kbd>
</button>

<dialog
  id="command-palette"
  class="palette"
  aria-labelledby="command-palette-label"
  bind:this={dialogEl}
  onclose={onDialogClose}
  onclick={onDialogClick}
>
  <p id="command-palette-label" class="sr-only">{t(dict, 'palette.open')}</p>
  <div class="palette__search">
    <Icon name="search" />
    <input
      bind:this={inputEl}
      class="palette__input"
      role="combobox"
      type="text"
      placeholder={t(dict, 'palette.open')}
      aria-labelledby="command-palette-label"
      aria-autocomplete="list"
      aria-expanded={filtered.length > 0}
      aria-controls="command-palette-list"
      aria-activedescendant={activeId}
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      bind:value={query}
      oninput={() => (active = 0)}
      onkeydown={onInputKeydown}
    />
  </div>
  {#if filtered.length === 0}
    <p class="palette__empty" role="status">{t(dict, 'palette.empty')}</p>
  {/if}
  <ul id="command-palette-list" class="palette__list" role="listbox" hidden={filtered.length === 0}>
    {#each filtered as entry, index (entry.id)}
      <li role="presentation">
        {#if isLink(entry)}
          <a
            id="palette-opt-{entry.id}"
            class="palette__hit"
            class:palette__hit--active={index === selected}
            role="option"
            href={entry.href}
            aria-selected={index === selected}
            tabindex="-1"
            onmouseenter={() => (active = index)}
            onclick={(event) => onLinkClick(event, entry.href)}
          >
            <Icon name={entry.icon} />
            <span class="palette__label">{entry.label}</span>
          </a>
        {:else}
          <button
            id="palette-opt-{entry.id}"
            type="button"
            class="palette__hit"
            class:palette__hit--active={index === selected}
            role="option"
            aria-selected={index === selected}
            tabindex="-1"
            onmouseenter={() => (active = index)}
            onclick={() => activate(entry)}
          >
            <Icon name={entry.icon} />
            <span class="palette__label">{entry.label}</span>
          </button>
        {/if}
      </li>
    {/each}
  </ul>
</dialog>
