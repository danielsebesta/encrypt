export type ToolCategory = 'developer' | 'privacy';

export type ToolDefinition = {
  slug: string;
  i18nPrefix: string;
  navLabelKey: string;
  category: ToolCategory;
};

export const tools: ToolDefinition[] = [
  // ── Developer ──────────────────────────────────────────
  { slug: 'uuid-ulid',    i18nPrefix: 'tools.uuidUlid',     navLabelKey: 'nav.tool.uuidUlid',     category: 'developer' },
  { slug: 'token',        i18nPrefix: 'tools.token',         navLabelKey: 'nav.tool.token',         category: 'developer' },
  { slug: 'bcrypt',       i18nPrefix: 'tools.bcrypt',        navLabelKey: 'nav.tool.bcrypt',        category: 'developer' },
  { slug: 'hmac',         i18nPrefix: 'tools.hmac',          navLabelKey: 'nav.tool.hmac',          category: 'developer' },
  { slug: 'rsa',          i18nPrefix: 'tools.rsa',           navLabelKey: 'nav.tool.rsa',           category: 'developer' },
  { slug: 'ssh-keys',     i18nPrefix: 'tools.sshKeys',       navLabelKey: 'nav.tool.sshKeys',       category: 'developer' },
  { slug: 'pgp-keys',     i18nPrefix: 'tools.pgpKeys',       navLabelKey: 'nav.tool.pgpKeys',       category: 'developer' },
  { slug: 'jwt',          i18nPrefix: 'tools.jwt',           navLabelKey: 'nav.tool.jwt',           category: 'developer' },
  { slug: 'base64',       i18nPrefix: 'tools.base64',        navLabelKey: 'nav.tool.base64',        category: 'developer' },
  { slug: 'bip39',        i18nPrefix: 'tools.bip39',         navLabelKey: 'nav.tool.bip39',         category: 'developer' },

  // ── Privacy ────────────────────────────────────────────
  { slug: 'aes-words',    i18nPrefix: 'tools.aesWords',      navLabelKey: 'nav.tool.aesWords',      category: 'privacy' },
  { slug: 'time-capsule', i18nPrefix: 'tools.timeCapsule',   navLabelKey: 'nav.tool.timeCapsule',   category: 'privacy' },
  { slug: 'steganography',  i18nPrefix: 'tools.steganography',  navLabelKey: 'nav.tool.steganography',  category: 'privacy' },
  { slug: 'photo-cipher',  i18nPrefix: 'tools.photoCipher',    navLabelKey: 'nav.tool.photoCipher',    category: 'privacy' },
  { slug: 'ghost-drop',     i18nPrefix: 'tools.ghostDrop',      navLabelKey: 'nav.tool.ghostDrop',      category: 'privacy' },
];

export const categoryI18nKeys: Record<ToolCategory, string> = {
  developer: 'nav.developer',
  privacy: 'nav.privacy',
};

export function getNavCategories(t: (dict: Record<string, string>, key: string) => string, dict: Record<string, string>) {
  const categories: ToolCategory[] = ['developer', 'privacy'];

  return categories.map(cat => ({
    name: t(dict, categoryI18nKeys[cat]),
    tools: tools
      .filter(tool => tool.category === cat)
      .map(tool => ({
        label: t(dict, tool.navLabelKey),
        href: `/tools/${tool.slug}`,
      })),
  }));
}
