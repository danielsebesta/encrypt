import type { IconName } from './iconManifest';
import { t } from './t';
import { chatIcon, decryptIcon, sendIcon, tools, whiteboardIcon } from './tools';

export type CommandItem = {
  id: string;
  label: string;
  href: string;
  icon: IconName;
};

const pages: { id: string; path: string; labelKey: string; icon: IconName }[] = [
  { id: 'share', path: '/share', labelKey: 'nav.send', icon: sendIcon },
  { id: 'decrypt', path: '/u', labelKey: 'nav.decrypt', icon: decryptIcon },
  { id: 'chat', path: '/chat', labelKey: 'nav.chat', icon: chatIcon },
  { id: 'whiteboard', path: '/whiteboard', labelKey: 'nav.whiteboard', icon: whiteboardIcon },
  { id: 'security', path: '/security', labelKey: 'security.h1', icon: 'shield' },
  { id: 'install', path: '/install', labelKey: 'install.h1', icon: 'smartphone' },
  { id: 'licenses', path: '/licenses', labelKey: 'licenses.h1', icon: 'file-text' },
];

/** Case-insensitive substring match, or every query word as a prefix of a label word. */
export function commandItemMatches(label: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = label.toLowerCase();
  if (hay.includes(q)) return true;
  const words = hay.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const parts = q.split(/\s+/).filter(Boolean);
  return parts.every((part) => words.some((word) => word.startsWith(part)));
}

/** Navigable pages for the command palette. Saved rooms are never included. */
export function buildCommandItems(localePrefix: string, dict: Record<string, string>): CommandItem[] {
  const items: CommandItem[] = pages.map((page) => ({
    id: page.id,
    label: t(dict, page.labelKey),
    href: `${localePrefix}${page.path}`,
    icon: page.icon,
  }));

  for (const tool of tools) {
    items.push({
      id: tool.slug,
      label: t(dict, tool.navLabelKey),
      href: `${localePrefix}/experiments/${tool.slug}`,
      icon: tool.icon,
    });
  }

  return items;
}
