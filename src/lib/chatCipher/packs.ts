/** Model packs for Chat cipher: metadata, download layout, offline readiness. */

import generated from './packs.generated.json';

/** Stable pack ids. Add new models here; UI lists every entry in PACK_ORDER. */
export type PackId = 'cs' | 'en';

/** Alias used by encrypt/decrypt APIs (one pack ≈ one cover language today). */
export type ChatLanguage = PackId;

export type PackDtype = 'q8' | 'q4f16';

export interface PackFile {
  path: string;
  sha256: string;
  bytes: number;
}

export interface PackManifest {
  id: PackId;
  version: string;
  /** Short label for compact selects: "Kecal". */
  name: string;
  /** Full title: "Kecal · Czech chat LM". */
  label: string;
  /** BCP-47 language tag of the cover text. */
  language: string;
  /** Flag / language emoji shown in the picker. */
  flag: string;
  /** Human language name (English); UI may localize via tools.chatCipher.lang.*. */
  languageName: string;
  author: string;
  /** Where the browser downloads the pack from (always this origin). */
  source: string;
  /** Training / upstream credit for humans — never fetched from the browser. */
  upstream: string;
  architecture: string;
  /** Display string, e.g. "~40M". */
  parameters: string;
  layers: number;
  hiddenSize: number;
  /** Context window in tokens. */
  context: number;
  vocabSize: number;
  quantization: string;
  license: string;
  base: string;
  files: PackFile[];
  bundled?: boolean;
  engine: 'table' | 'onnx';
  /** transformers.js dtype for this pack's ONNX files */
  dtype?: PackDtype;
}

/** Display / download order in the model picker. */
export const PACK_ORDER: PackId[] = ['cs', 'en'];

/** Packs are served only from this origin. Never Hugging Face from the browser. */
export const PACKS: Record<PackId, PackManifest> = {
  cs: {
    id: 'cs',
    version: '2',
    name: 'Kecal Instant',
    label: 'Kecal Instant · Czech word table',
    language: 'cs',
    flag: '🇨🇿',
    languageName: 'Czech',
    author: 'encrypt.click',
    source: 'encrypt.click',
    upstream: 'Word statistics from Czech chats written by Mercury 3, GPT-6 Luna, Claude Haiku 5.5, DeepSeek, GLM-5.3 and others',
    architecture: '5-gram table',
    parameters: '592k entries',
    layers: 0,
    hiddenSize: 0,
    context: 4,
    vocabSize: 12_971,
    quantization: 'Arithmetic coding',
    license: 'MIT',
    base: '/chat-cipher/cs/2/',
    engine: 'table',
    bundled: true,
    files: (generated as { cs: PackFile[] }).cs ?? [],
  },
  en: {
    id: 'en',
    version: '2',
    name: 'Falcon-H1-Tiny',
    label: 'Falcon-H1-Tiny · English',
    language: 'en',
    flag: '🇬🇧',
    languageName: 'English',
    author: 'TII / Falcon',
    source: 'encrypt.click',
    upstream: 'tiiuae/Falcon-H1-Tiny (converted ONNX for this tool)',
    architecture: 'Falcon-H1',
    parameters: '~100M',
    layers: 24,
    hiddenSize: 512,
    context: 262_144,
    vocabSize: 32_768,
    quantization: 'ONNX q4f16',
    license: 'Falcon license · redistributed pack',
    base: '/models/chat-cipher/en/2/',
    engine: 'onnx',
    dtype: 'q4f16',
    files: (generated as { en: PackFile[] }).en ?? [],
  },
};

export function packList(): PackManifest[] {
  return PACK_ORDER.map(id => PACKS[id]);
}

export function packTotalBytes(pack: PackManifest): number {
  return pack.files.reduce((sum, f) => sum + (f.bytes || 0), 0);
}

export function cacheName(pack: PackManifest): string {
  return `chat-cipher-${pack.id}-v${pack.version}`;
}

export function isPackId(value: string): value is PackId {
  return value in PACKS;
}
