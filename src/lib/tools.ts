import type { IconName } from './iconManifest';

export type ToolCategory = 'tools';

export type ToolDefinition = {
  slug: string;
  i18nPrefix: string;
  navLabelKey: string;
  category: ToolCategory;
  icon: IconName;
};

const icons = {
  apps: 'apps',
  chat: 'message-circle',
  clock: 'clock',
  image: 'image',
  camera: 'camera',
  audioWaveform: 'audio-waveform',
} as const satisfies Record<string, IconName>;

export const tools: ToolDefinition[] = [
  { slug: 'chat-cipher',  i18nPrefix: 'tools.chatCipher',    navLabelKey: 'nav.tool.chatCipher',    category: 'tools', icon: icons.chat },
  { slug: 'time-capsule', i18nPrefix: 'tools.timeCapsule',   navLabelKey: 'nav.tool.timeCapsule',   category: 'tools', icon: icons.clock },
  { slug: 'steganography',  i18nPrefix: 'tools.steganography',  navLabelKey: 'nav.tool.steganography',  category: 'tools', icon: icons.image },
  { slug: 'photo-cipher',  i18nPrefix: 'tools.photoCipher',    navLabelKey: 'nav.tool.photoCipher',    category: 'tools', icon: icons.camera },
  { slug: 'image-in-sound', i18nPrefix: 'tools.imageInSound', navLabelKey: 'nav.tool.imageInSound', category: 'tools', icon: icons.audioWaveform },
];

export const categoryI18nKeys: Record<ToolCategory, string> = {
  tools: 'nav.tools',
};

export const categoryIcons: Record<ToolCategory, IconName> = {
  tools: icons.apps,
};

export const chatIcon = icons.chat;
export const sendIcon: IconName = 'upload';
export const decryptIcon: IconName = 'lock-keyhole-open';
export const whiteboardIcon: IconName = 'presentation';

export function getNavCategories(t: (dict: Record<string, string>, key: string) => string, dict: Record<string, string>) {
  const categories: ToolCategory[] = ['tools'];

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
