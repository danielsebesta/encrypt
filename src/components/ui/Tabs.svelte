<script lang="ts" generics="T extends string">
  import { tick, type Snippet } from 'svelte';
  import Icon from '../Icon.svelte';
  import type { IconName } from '../../lib/iconManifest';

  interface Item {
    id: T;
    label: string;
    icon?: IconName;
  }

  interface Props {
    items: Item[];
    value: T;
    label: string;
    idBase?: string;
    variant?: 'line' | 'segmented';
    class?: string;
    panelClass?: string;
    onchange?: (value: T) => void;
    children?: Snippet<[T]>;
    panel?: Snippet<[T]>;
  }

  let {
    items,
    value = $bindable(),
    label,
    idBase,
    variant = 'line',
    class: className = '',
    panelClass = 'stack',
    onchange,
    children,
    panel,
  }: Props = $props();

  const autoId = $props.id();
  const base = $derived(idBase ?? `tabs-${autoId}`);
  const tabId = (id: T) => `${base}-tab-${id}`;
  const panelId = (id: T) => (panel ? `${base}-panel-${id}` : `${base}-panel`);

  let visited = $state<Partial<Record<T, boolean>>>({ [value]: true } as Partial<Record<T, boolean>>);
  $effect.pre(() => {
    if (!visited[value]) visited[value] = true;
  });

  let list = $state<HTMLElement>();
  let glide = $state(false);

  function select(id: T, focus = false) {
    if (id !== value) {
      value = id;
      onchange?.(id);
    }
    if (focus) document.getElementById(tabId(id))?.focus();
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const current = event.target instanceof HTMLElement ? event.target.closest('[role="tab"]') : null;
    const index = Math.max(0, items.findIndex((item) => (current ? tabId(item.id) === current.id : item.id === value)));
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault();
    select(items[next].id, true);
  }

  function place() {
    if (!list) return;
    const tab = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!tab || !tab.offsetWidth) return;
    list.style.setProperty('--tabs-x', `${tab.offsetLeft}px`);
    list.style.setProperty('--tabs-y', `${tab.offsetTop}px`);
    list.style.setProperty('--tabs-w', `${tab.offsetWidth}px`);
    list.style.setProperty('--tabs-h', `${tab.offsetHeight}px`);
  }

  $effect(() => {
    if (variant !== 'segmented' || !list) return;
    const observer = new ResizeObserver(place);
    observer.observe(list);
    place();
    const frame = requestAnimationFrame(() => { glide = true; });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  });

  $effect(() => {
    if (variant === 'segmented' && value !== undefined) tick().then(place);
  });
</script>

<div
  bind:this={list}
  class="tabs {className}"
  class:tabs--slide={variant === 'segmented'}
  class:tabs--glide={glide}
  role="tablist"
  aria-label={label}
>
  {#if variant === 'segmented'}<span class="tabs__thumb" aria-hidden="true"></span>{/if}
  {#each items as item (item.id)}
    <button
      type="button"
      role="tab"
      class="tab"
      id={tabId(item.id)}
      aria-selected={value === item.id}
      aria-controls={panelId(item.id)}
      tabindex={value === item.id ? 0 : -1}
      onclick={() => select(item.id)}
      {onkeydown}
    >
      {#if item.icon}<Icon name={item.icon} />{/if}
      <span>{item.label}</span>
    </button>
  {/each}
</div>

{#if panel}
  {#each items as item (item.id)}
    <div id={panelId(item.id)} role="tabpanel" aria-labelledby={tabId(item.id)} class={panelClass} hidden={value !== item.id}>
      {#if visited[item.id]}{@render panel(item.id)}{/if}
    </div>
  {/each}
{:else if children}
  <div id={panelId(value)} role="tabpanel" aria-labelledby={tabId(value)} class={panelClass}>
    {@render children(value)}
  </div>
{/if}
