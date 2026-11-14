import type * as Kit from 'asciify-engine/kit';

export type KitModule = typeof Kit;
export type KitMaker<T extends { destroy(): void }> = (kit: KitModule, node: HTMLElement) => T | null | undefined;

export function kitAllowed(): boolean {
  return typeof window !== 'undefined' && !matchMedia('(prefers-reduced-data: reduce)').matches;
}

let kitPromise: Promise<KitModule> | null = null;
export function loadKit(): Promise<KitModule> {
  return (kitPromise ??= import('asciify-engine/kit'));
}

export function asciiKit<T extends { destroy(): void }>(node: HTMLElement, make: KitMaker<T>) {
  let handle: T | null = null;
  let gone = false;
  if (kitAllowed()) {
    loadKit().then((kit) => {
      if (gone) return;
      handle = make(kit, node) ?? null;
    }).catch(() => {});
  }
  return {
    destroy() {
      gone = true;
      handle?.destroy();
      handle = null;
    },
  };
}

let glChecked: boolean | null = null;
export function glAvailable(): boolean {
  if (glChecked !== null) return glChecked;
  try {
    glChecked = !!document.createElement('canvas').getContext('webgl2');
  } catch {
    glChecked = false;
  }
  return glChecked;
}
