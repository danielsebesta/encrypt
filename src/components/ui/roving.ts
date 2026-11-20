export interface RovingOptions {
  /** Lay the items out as a grid with this many columns: ArrowUp/ArrowDown then move by a row. */
  columns?: number;
  /** Items taking part, matched inside the node. */
  selector?: string;
}

const CURRENT = '[aria-pressed="true"], [aria-checked="true"], [aria-current="true"]';

/**
 * Roving tabindex for a group of buttons (`role="toolbar"`, a swatch grid, a segmented set): one Tab stop,
 * ArrowLeft/ArrowRight (and ArrowUp/ArrowDown without `columns`) wrap, Home and End jump to the ends.
 * The tab stop is the focused item, else the pressed/checked/current one, else the last focused, else the first.
 */
export function roving(node: HTMLElement, options: RovingOptions = {}) {
  let opts = options;
  let last: HTMLElement | null = null;

  const items = () =>
    [...node.querySelectorAll<HTMLElement>(opts.selector ?? 'button')].filter((el) => !el.matches(':disabled, [aria-disabled="true"]'));

  function sync() {
    const list = items();
    const focused = list.find((el) => el.contains(document.activeElement));
    const current = focused ?? list.find((el) => el.matches(CURRENT)) ?? (last && list.includes(last) ? last : null) ?? list[0];
    for (const el of list) el.tabIndex = el === current ? 0 : -1;
  }

  function onfocusin(event: FocusEvent) {
    const el = items().find((item) => item.contains(event.target as Node));
    if (el) {
      last = el;
      sync();
    }
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const list = items();
    const at = list.findIndex((el) => el.contains(document.activeElement));
    if (at < 0) return;
    const cols = opts.columns ?? 0;
    let next: number;
    if (event.key === 'ArrowRight' || (event.key === 'ArrowDown' && !cols)) next = (at + 1) % list.length;
    else if (event.key === 'ArrowLeft' || (event.key === 'ArrowUp' && !cols)) next = (at - 1 + list.length) % list.length;
    else if (event.key === 'ArrowDown') next = at + cols < list.length ? at + cols : at;
    else if (event.key === 'ArrowUp') next = at - cols >= 0 ? at - cols : at;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = list.length - 1;
    else return;
    event.preventDefault();
    list[next]?.focus();
  }

  node.addEventListener('focusin', onfocusin);
  node.addEventListener('keydown', onkeydown);
  const observer = new MutationObserver(sync);
  observer.observe(node, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['aria-pressed', 'aria-checked', 'aria-current', 'aria-disabled', 'disabled'],
  });
  sync();

  return {
    update(next: RovingOptions = {}) {
      opts = next;
      sync();
    },
    destroy() {
      node.removeEventListener('focusin', onfocusin);
      node.removeEventListener('keydown', onkeydown);
      observer.disconnect();
    },
  };
}
