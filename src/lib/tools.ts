import type { IconName } from './iconManifest';

export type ToolCategory = 'experiments';

export type ToolDefinition = {
  slug: string;
  i18nPrefix: string;
  navLabelKey: string;
  category: ToolCategory;
  icon: IconName;
};

const icons = {
  flask: 'flask-conical',
  chat: 'message-circle',
  clock: 'clock',
  image: 'image',
  camera: 'camera',
  audioWaveform: 'audio-waveform',
} as const satisfies Record<string, IconName>;

export const tools: ToolDefinition[] = [
  { slug: 'chat-cipher',  i18nPrefix: 'tools.chatCipher',    navLabelKey: 'nav.tool.chatCipher',    category: 'experiments', icon: icons.chat },
  { slug: 'time-capsule', i18nPrefix: 'tools.timeCapsule',   navLabelKey: 'nav.tool.timeCapsule',   category: 'experiments', icon: icons.clock },
  { slug: 'steganography',  i18nPrefix: 'tools.steganography',  navLabelKey: 'nav.tool.steganography',  category: 'experiments', icon: icons.image },
  { slug: 'photo-cipher',  i18nPrefix: 'tools.photoCipher',    navLabelKey: 'nav.tool.photoCipher',    category: 'experiments', icon: icons.camera },
  { slug: 'spectral-cipher', i18nPrefix: 'tools.spectralCipher', navLabelKey: 'nav.tool.spectralCipher', category: 'experiments', icon: icons.audioWaveform },
];

export const categoryI18nKeys: Record<ToolCategory, string> = {
  experiments: 'nav.experiments',
};

export const categoryIcons: Record<ToolCategory, IconName> = {
  experiments: icons.flask,
};

export const chatIcon = icons.chat;
export const sendIcon: IconName = 'upload';
export const decryptIcon: IconName = 'lock-keyhole-open';
export const whiteboardIcon: IconName = 'square-pen';

export function getNavCategories(t: (dict: Record<string, string>, key: string) => string, dict: Record<string, string>, localePrefix = '') {
  const categories: ToolCategory[] = ['experiments'];

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
