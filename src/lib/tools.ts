export type ToolCategory = 'developer' | 'cryptography' | 'privacy';

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

  // ── Cryptography ───────────────────────────────────────
  { slug: 'aes-words',    i18nPrefix: 'tools.aesWords',      navLabelKey: 'nav.tool.aesWords',      category: 'cryptography' },
  { slug: 'enigma',       i18nPrefix: 'tools.enigma',        navLabelKey: 'nav.tool.enigma',        category: 'cryptography' },
  { slug: 'caesar',       i18nPrefix: 'tools.caesar',        navLabelKey: 'nav.tool.caesar',        category: 'cryptography' },
  { slug: 'vigenere',     i18nPrefix: 'tools.vigenere',      navLabelKey: 'nav.tool.vigenere',      category: 'cryptography' },
  { slug: 'morse',        i18nPrefix: 'tools.morse',         navLabelKey: 'nav.tool.morse',         category: 'cryptography' },
  { slug: 'time-capsule', i18nPrefix: 'tools.timeCapsule',   navLabelKey: 'nav.tool.timeCapsule',   category: 'cryptography' },

  // ── Privacy ────────────────────────────────────────────
  { slug: 'steganography',  i18nPrefix: 'tools.steganography',  navLabelKey: 'nav.tool.steganography',  category: 'privacy' },
  { slug: 'photo-cipher',  i18nPrefix: 'tools.photoCipher',    navLabelKey: 'nav.tool.photoCipher',    category: 'privacy' },
  { slug: 'exif-scrub',     i18nPrefix: 'tools.exifScrub',      navLabelKey: 'nav.tool.exifScrub',      category: 'privacy' },
  { slug: 'encrypt-tunnel', i18nPrefix: 'tools.encryptTunnel',  navLabelKey: 'nav.tool.encryptTunnel',  category: 'privacy' },
  { slug: 'anon-upload',    i18nPrefix: 'tools.anonUpload',     navLabelKey: 'nav.tool.anonUpload',     category: 'privacy' },
  { slug: 'watermark',      i18nPrefix: 'tools.watermark',      navLabelKey: 'nav.tool.watermark',      category: 'privacy' },
  { slug: 'qr-gen',         i18nPrefix: 'tools.qrGen',          navLabelKey: 'nav.tool.qrGen',          category: 'privacy' },
  { slug: 'pdf-redact',     i18nPrefix: 'tools.pdfRedact',      navLabelKey: 'nav.tool.pdfRedact',      category: 'privacy' },
  { slug: 'pdf-unlock',     i18nPrefix: 'tools.pdfUnlock',      navLabelKey: 'nav.tool.pdfUnlock',      category: 'privacy' },
];

export const categoryI18nKeys: Record<ToolCategory, string> = {
  developer: 'nav.developer',
  cryptography: 'nav.cryptography',
  privacy: 'nav.privacy',
};

export function getNavCategories(t: (dict: Record<string, string>, key: string) => string, dict: Record<string, string>) {
  const categories: ToolCategory[] = ['developer', 'cryptography', 'privacy'];

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
