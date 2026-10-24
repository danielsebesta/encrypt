export type ToolCategory = 'privacy';

export type ToolDefinition = {
  slug: string;
  i18nPrefix: string;
  navLabelKey: string;
  category: ToolCategory;
  icon: string;
};

// Lucide SVG inner content (24x24 viewBox, stroke-based)
const icons = {
  privacy: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  audioWaveform: '<path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  venetianMask: '<path d="M18 11c-1.5 0-2.5.5-3.5 1.5C13.5 13.5 12.5 14 12 14s-1.5-.5-2.5-1.5C8.5 11.5 7.5 11 6 11a4 4 0 0 0-4 4 7 7 0 0 0 7 7 6 6 0 0 0 5-3 6 6 0 0 0 5 3 7 7 0 0 0 7-7 4 4 0 0 0-4-4z"/><path d="M2 15a3 3 0 0 0 2.5 2.95"/><path d="M22 15a3 3 0 0 1-2.5 2.95"/>',
} as const;

export const tools: ToolDefinition[] = [
  { slug: 'aes-words',    i18nPrefix: 'tools.aesWords',      navLabelKey: 'nav.tool.aesWords',      category: 'privacy', icon: icons.lock },
  { slug: 'time-capsule', i18nPrefix: 'tools.timeCapsule',   navLabelKey: 'nav.tool.timeCapsule',   category: 'privacy', icon: icons.clock },
  { slug: 'steganography',  i18nPrefix: 'tools.steganography',  navLabelKey: 'nav.tool.steganography',  category: 'privacy', icon: icons.image },
  { slug: 'photo-cipher',  i18nPrefix: 'tools.photoCipher',    navLabelKey: 'nav.tool.photoCipher',    category: 'privacy', icon: icons.camera },
  { slug: 'spectral-cipher', i18nPrefix: 'tools.spectralCipher', navLabelKey: 'nav.tool.spectralCipher', category: 'privacy', icon: icons.audioWaveform },
];

export const categoryI18nKeys: Record<ToolCategory, string> = {
  privacy: 'nav.privacy',
};

export const categoryIcons: Record<ToolCategory, string> = {
  privacy: icons.privacy,
};

export const chatIcon = icons.chat;
export const sendIcon = '<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>';
export const whiteboardIcon = '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>';

export function getNavCategories(t: (dict: Record<string, string>, key: string) => string, dict: Record<string, string>, localePrefix = '') {
  const categories: ToolCategory[] = ['privacy'];

  return categories.map(cat => ({
    name: t(dict, categoryI18nKeys[cat]),
    icon: categoryIcons[cat],
    tools: tools
      .filter(tool => tool.category === cat)
      .map(tool => ({
        label: t(dict, tool.navLabelKey),
        href: `${localePrefix}/tools/${tool.slug}`,
        icon: tool.icon,
      })),
  }));
}
