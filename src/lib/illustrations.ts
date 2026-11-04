const files = import.meta.glob('../assets/illustrations/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const sources = Object.fromEntries(
  Object.entries(files).map(([path, svg]) => [path.slice(path.lastIndexOf('/') + 1, -4), svg]),
);

export type IllustrationName = 'chat' | 'chill' | 'hero' | 'lock' | 'magnify' | 'send' | 'shield' | 'whiteboard';

const fades: Partial<Record<IllustrationName, string>> = { hero: 'ill--fade-bl' };

export function illustration(name: IllustrationName, className = ''): string {
  const svg = sources[name];
  if (!svg) throw new Error(`Unknown illustration: ${name}`);
  return svg.replace('<svg ', `<svg class="${`ill ${fades[name] ?? ''} ${className}`.replace(/\s+/g, ' ').trim()}" aria-hidden="true" focusable="false" `);
}
