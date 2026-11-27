<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from '../Icon.svelte';
  import type { IconName } from '../../lib/iconManifest';
  import { buttonClass, type ButtonSize, type ButtonVariant } from './button';
  import { menu } from './menu';

  interface Props {
    label: string;
    icon?: IconName;
    text?: string;
    variant?: ButtonVariant;
    size?: ButtonSize;
    align?: 'start' | 'end';
    open?: boolean;
    class?: string;
    children: Snippet<[() => void]>;
  }

  let { label, icon = 'ellipsis-vertical', text, variant = 'ghost', size = 'sm', align = 'end', open = $bindable(false), class: className = '', children }: Props = $props();

  const autoId = $props.id();
  const menuId = `menu-${autoId}`;
  let trigger = $state<HTMLButtonElement>();
  let focusAt = $state<'first' | 'last'>('first');

  const close = () => { open = false; };

  function onkeydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    focusAt = event.key === 'ArrowUp' ? 'last' : 'first';
    if (!open) {
      open = true;
      return;
    }
    const list = [...(document.getElementById(menuId)?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? [])];
    (focusAt === 'last' ? list.at(-1) : list[0])?.focus();
  }
</script>

<div class="menu-anchor {className}">
  <button
    bind:this={trigger}
    type="button"
    class={buttonClass({ variant, size, icon: !text })}
    aria-label={text ? undefined : label}
    title={text ? undefined : label}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-controls={menuId}
    onclick={() => { focusAt = 'first'; open = !open; }}
    {onkeydown}
  >
    <Icon name={icon} size={!text && size === 'md' ? 20 : 16} />
    {#if text}<span>{text}</span>{/if}
  </button>
  <div
    id={menuId}
    class="menu"
    class:menu--open={open}
    class:menu--end={align === 'end'}
    role="menu"
    tabindex="-1"
    aria-label={label}
    use:menu={{ open, onclose: close, trigger, autofocus: focusAt }}
  >
    {@render children(close)}
  </div>
</div>
