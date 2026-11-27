import { mount, unmount } from 'svelte';
import CallPip from './CallPip.svelte';

export type PipPerson = { name: string; bg: string; on: boolean };

export type PipView = {
  dict: Record<string, string>;
  stream: MediaStream | null;
  people: PipPerson[];
  label: string;
  micMuted: boolean;
  cameraOff: boolean;
  onmic: () => void;
  oncamera: () => void;
  onreturn: () => void;
  onend: () => void;
};

function adoptPage(target: Document) {
  for (const node of document.head.querySelectorAll('style, link[rel="stylesheet"]')) target.head.appendChild(node.cloneNode(true));
  const from = document.documentElement;
  const to = target.documentElement;
  to.className = from.className;
  for (const { name, value } of [...from.attributes]) {
    if (name === 'lang' || name === 'dir' || name === 'style' || name.startsWith('data-')) to.setAttribute(name, value);
  }
}

export function mountCallPip(win: Window, initial: PipView) {
  adoptPage(win.document);
  const view = $state(initial);
  const app = mount(CallPip, { target: win.document.body, props: { view } });
  return {
    update(next: Partial<PipView>) {
      Object.assign(view, next);
    },
    destroy() {
      void unmount(app);
    },
  };
}
