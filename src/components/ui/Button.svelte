<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
  import Icon from '../Icon.svelte';
  import type { IconName } from '../../lib/iconManifest';
  import { buttonClass, type ButtonSize, type ButtonVariant } from './button';

  type Shared = {
    variant?: ButtonVariant;
    size?: ButtonSize;
    block?: boolean;
    icon?: IconName;
    iconEnd?: IconName;
    /** Accessible name. Required for icon-only buttons, where it also becomes the tooltip. */
    label?: string;
    busy?: boolean;
    pressed?: boolean;
    class?: string;
    children?: Snippet;
  };

  type Props = Shared &
    (({ href: string } & Omit<HTMLAnchorAttributes, keyof Shared>) | ({ href?: undefined } & Omit<HTMLButtonAttributes, keyof Shared>));

  let {
    variant = 'primary',
    size = 'md',
    block = false,
    icon,
    iconEnd,
    label,
    busy = false,
    pressed,
    class: className = '',
    children,
    href,
    disabled = false,
    type = 'button',
    onclick,
    ...rest
  }: Props & { disabled?: boolean | null; type?: 'button' | 'submit' | 'reset' | null } = $props();

  const iconOnly = $derived(!children);
  const cls = $derived(buttonClass({ variant, size, icon: iconOnly, block, class: className }));
  const ariaDisabled = $derived((rest as HTMLButtonAttributes)['aria-disabled']);
  const inert = $derived(Boolean(disabled) || busy || ariaDisabled === true || ariaDisabled === 'true');

  $effect(() => {
    if (iconOnly && !label) console.error('Button: icon-only buttons need a label');
  });

  function guard(event: MouseEvent) {
    if (inert) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    (onclick as ((e: MouseEvent) => void) | undefined)?.(event);
  }
</script>

{#snippet content()}
  {#if icon}<Icon name={icon} size={iconOnly && size === 'md' ? 20 : 16} />{/if}
  {#if children}{@render children()}{/if}
  {#if iconEnd}<Icon name={iconEnd} />{/if}
{/snippet}

{#if href !== undefined}
  <a
    {...rest as HTMLAnchorAttributes}
    class={cls}
    href={disabled ? undefined : href}
    role={disabled ? 'link' : (rest as HTMLAnchorAttributes).role}
    aria-label={iconOnly ? label : (rest as HTMLAnchorAttributes)['aria-label']}
    title={iconOnly ? label : (rest as HTMLAnchorAttributes).title}
    aria-disabled={disabled || ariaDisabled || undefined}
    aria-busy={busy || undefined}
    onclick={guard}
  >{@render content()}</a>
{:else}
  <button
    {...rest as HTMLButtonAttributes}
    {type}
    class={cls}
    disabled={disabled && !busy ? true : undefined}
    aria-label={iconOnly ? label : (rest as HTMLButtonAttributes)['aria-label']}
    title={iconOnly ? label : (rest as HTMLButtonAttributes).title}
    aria-pressed={pressed === undefined ? undefined : pressed}
    aria-busy={busy || undefined}
    aria-disabled={busy || ariaDisabled || undefined}
    onclick={guard}
  >{@render content()}</button>
{/if}
