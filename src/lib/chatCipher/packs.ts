/** Language packs for Chat cipher: where to download, how to know they are ready offline. */

import generated from './packs.generated.json';

export type ChatLanguage = 'cs' | 'en';

export type PackDtype = 'q8' | 'q4f16';

export interface PackFile {
  path: string;
  sha256: string;
  bytes: number;
}

export interface PackManifest {
  id: ChatLanguage;
  version: string;
  label: string;
  base: string;
  files: PackFile[];
  bundled?: boolean;
  engine: 'table' | 'onnx';
  /** transformers.js dtype for this pack's ONNX files */
  dtype?: PackDtype;
}

/** Packs are served only from this origin. Never Hugging Face from the browser. */
export const PACKS: Record<ChatLanguage, PackManifest> = {
  cs: {
    id: 'cs',
    version: '1',
    label: 'Czech · Kecal',
    base: '/models/chat-cipher/cs/1/',
    engine: 'onnx',
    dtype: 'q8',
    files: (generated as { cs: PackFile[] }).cs ?? [],
  },
  en: {
    id: 'en',
    version: '2',
    label: 'English · Falcon-H1-Tiny',
    base: '/models/chat-cipher/en/2/',
    engine: 'onnx',
    dtype: 'q4f16',
    files: (generated as { en: PackFile[] }).en ?? [],
  },
};

export function packTotalBytes(pack: PackManifest): number {
  return pack.files.reduce((sum, f) => sum + (f.bytes || 0), 0);
}

export function cacheName(pack: PackManifest): string {
  return `chat-cipher-${pack.id}-v${pack.version}`;
}
