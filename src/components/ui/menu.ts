export interface MenuOptions {
  open: boolean;
  onclose: () => void;
  /** The button that opens the menu; focus returns to it on close and clicks on it do not count as outside. */
  trigger?: HTMLElement | null;
  /** Item to focus when the menu opens: the first (default, `true`), the last, or none (`false`). */
  autofocus?: boolean | 'first' | 'last';
}

const ITEM = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';

function items(node: HTMLElement): HTMLElement[] {
  return [...node.querySelectorAll<HTMLElement>(ITEM)].filter(
    (el) => el.closest('[role="menu"]') === node && !el.matches(':disabled, [aria-disabled="true"]') && el.offsetParent !== null,
  );
}

/**
 * Keyboard and focus behaviour for a `role="menu"` element: Arrow keys, Home and End move between items,
 * Escape closes and returns focus to the trigger, Tab closes, a press outside closes.
 */
export function menu(node: HTMLElement, options: MenuOptions) {
  let opts = options;
  let wasOpen = false;

  function close(returnFocus: boolean) {
    opts.onclose();
    if (returnFocus) opts.trigger?.focus({ preventScroll: true });
  }

  function onkeydown(event: KeyboardEvent) {
    if (!opts.open) return;
    const list = items(node);
    const index = list.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    switch (event.key) {
      case 'ArrowDown':
        next = (index + 1) % list.length;
        break;
      case 'ArrowUp':
        next = (index - 1 + list.length) % list.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = list.length - 1;
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close(true);
        return;
      case 'Tab':
        close(false);
        return;
      default:
        return;
    }
    event.preventDefault();
    list[next]?.focus();
  }

  function onpointerdown(event: PointerEvent) {
    if (!opts.open) return;
    const target = event.target as Node;
    if (node.contains(target) || opts.trigger?.contains(target)) return;
    close(false);
  }

  function sync() {
    if (opts.open && !wasOpen && opts.autofocus !== false) {
      const last = opts.autofocus === 'last';
      queueMicrotask(() => {
        const list = items(node);
        list[last ? list.length - 1 : 0]?.focus();
      });
    }
    if (!opts.open && wasOpen && node.contains(document.activeElement)) opts.trigger?.focus({ preventScroll: true });
    wasOpen = opts.open;
  }

  node.addEventListener('keydown', onkeydown);
  document.addEventListener('pointerdown', onpointerdown, true);
  sync();

  return {
    update(next: MenuOptions) {
      opts = next;
      sync();
    },
    destroy() {
      node.removeEventListener('keydown', onkeydown);
      document.removeEventListener('pointerdown', onpointerdown, true);
    },
  };
}
