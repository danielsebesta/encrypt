export type ToolCategory = 'developer' | 'privacy';

export type ToolDefinition = {
  slug: string;
  i18nPrefix: string;
  navLabelKey: string;
  category: ToolCategory;
  icon: string;
};

// Lucide SVG inner content (24x24 viewBox, stroke-based)
const icons = {
  // Categories
  developer: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  privacy: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  // Tools
  fingerprint: '<path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/><path d="M14 13.12c0 2.38 0 6.38-1 8.88"/><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/><path d="M2 12a10 10 0 0 1 18-6"/><path d="M2 16h.01"/><path d="M21.8 16c.2-2 .131-5.354 0-6"/><path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/><path d="M8.65 22c.21-.66.45-1.32.57-2"/><path d="M9 6.8a6 6 0 0 1 9 5.2c0 .47 0 1.17-.02 2"/>',
  key: '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
  hash: '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
  shieldCheck: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  keyRound: '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  fileKey: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><circle cx="10" cy="16" r="2"/><path d="m16 10-4.5 4.5"/><path d="m15 11 1 1"/>',
  binary: '<rect x="14" y="14" width="4" height="6" rx="2"/><rect x="6" y="4" width="4" height="6" rx="2"/><path d="M6 20h4"/><path d="M14 10h4"/><path d="M6 14h2v6"/><path d="M14 4h2v6"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  ghost: '<path d="M9 10h.01"/><path d="M15 10h.01"/><path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z"/>',
  drop: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
} as const;

export const tools: ToolDefinition[] = [
  // ── Developer ──────────────────────────────────────────
  { slug: 'uuid-ulid',    i18nPrefix: 'tools.uuidUlid',     navLabelKey: 'nav.tool.uuidUlid',     category: 'developer', icon: icons.fingerprint },
  { slug: 'token',        i18nPrefix: 'tools.token',         navLabelKey: 'nav.tool.token',         category: 'developer', icon: icons.key },
  { slug: 'bcrypt',       i18nPrefix: 'tools.bcrypt',        navLabelKey: 'nav.tool.bcrypt',        category: 'developer', icon: icons.hash },
  { slug: 'hmac',         i18nPrefix: 'tools.hmac',          navLabelKey: 'nav.tool.hmac',          category: 'developer', icon: icons.shieldCheck },
  { slug: 'rsa',          i18nPrefix: 'tools.rsa',           navLabelKey: 'nav.tool.rsa',           category: 'developer', icon: icons.keyRound },
  { slug: 'ssh-keys',     i18nPrefix: 'tools.sshKeys',       navLabelKey: 'nav.tool.sshKeys',       category: 'developer', icon: icons.terminal },
  { slug: 'pgp-keys',     i18nPrefix: 'tools.pgpKeys',       navLabelKey: 'nav.tool.pgpKeys',       category: 'developer', icon: icons.mail },
  { slug: 'jwt',          i18nPrefix: 'tools.jwt',           navLabelKey: 'nav.tool.jwt',           category: 'developer', icon: icons.fileKey },
  { slug: 'base64',       i18nPrefix: 'tools.base64',        navLabelKey: 'nav.tool.base64',        category: 'developer', icon: icons.binary },
  { slug: 'bip39',        i18nPrefix: 'tools.bip39',         navLabelKey: 'nav.tool.bip39',         category: 'developer', icon: icons.wallet },

  // ── Privacy ────────────────────────────────────────────
  { slug: 'aes-words',    i18nPrefix: 'tools.aesWords',      navLabelKey: 'nav.tool.aesWords',      category: 'privacy', icon: icons.lock },
  { slug: 'time-capsule', i18nPrefix: 'tools.timeCapsule',   navLabelKey: 'nav.tool.timeCapsule',   category: 'privacy', icon: icons.clock },
  { slug: 'steganography',  i18nPrefix: 'tools.steganography',  navLabelKey: 'nav.tool.steganography',  category: 'privacy', icon: icons.image },
  { slug: 'photo-cipher',  i18nPrefix: 'tools.photoCipher',    navLabelKey: 'nav.tool.photoCipher',    category: 'privacy', icon: icons.camera },
  { slug: 'ghost-drop',     i18nPrefix: 'tools.ghostDrop',      navLabelKey: 'nav.tool.ghostDrop',      category: 'privacy', icon: icons.ghost },
];

export const categoryI18nKeys: Record<ToolCategory, string> = {
  developer: 'nav.developer',
  privacy: 'nav.privacy',
};

export const categoryIcons: Record<ToolCategory, string> = {
  developer: icons.developer,
  privacy: icons.privacy,
};

export const chatIcon = icons.chat;
export const deadDropIcon = icons.drop;

export function getNavCategories(t: (dict: Record<string, string>, key: string) => string, dict: Record<string, string>) {
  const categories: ToolCategory[] = ['developer', 'privacy'];

  return categories.map(cat => ({
    name: t(dict, categoryI18nKeys[cat]),
    icon: categoryIcons[cat],
    tools: tools
      .filter(tool => tool.category === cat)
      .map(tool => ({
        label: t(dict, tool.navLabelKey),
        href: `/tools/${tool.slug}`,
        icon: tool.icon,
      })),
  }));
}
