<script lang="ts">
  import { readLimited } from '../../lib/httpLimits';
  import { onMount } from 'svelte';
  import { decrypt } from '../../lib/aesGcm';
  import { decryptData } from '../../lib/ghost/crypto';
  import { extractStego } from '../../lib/ghost/steganography';
  import { decryptSendBlob, ghostFetch, isSendUrl } from '../../lib/nologSend';
  import CopyButton from '../CopyButton.svelte';
  import QrScanner from '../QrScanner.svelte';
  import ProgressPulse from '../ProgressPulse.svelte';
  import { t } from '../../lib/t';
  import ShareLinkFacts from '../share/ShareLinkFacts.svelte';
  import { isCapsuleFragment, parseShareFragment, type ShareLink } from '../../lib/shareLink';
  import { roundTime, unlockTimeSecret } from '../../lib/timelock';

  class Notice extends Error {}

  export let locale = 'en';
  export let dict: Record<string, string>;

  let password = '';
  let error = '';
  let loading = false;
  let progressTitle = '';
  let progressDetail = '';
  let debugLog: string[] = [];

  let hashPayload = '';
  let hasHash = false;
  $: shareLink = hashPayload ? parseShareFragment(hashPayload) : null;
  $: unlockTime = shareLink?.lock ? roundTime(shareLink.lock.round) : undefined;

  function lockedMessage(unlock: number): string {
    let time: string;
    try { time = new Date(unlock).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }); } catch { time = new Date(unlock).toLocaleString(); }
    return t(dict, 'shareLink.lockedUntil').replace('{time}', time);
  }

  let openedText = '';
  let openedFileName = '';
  let openedFileUrl = '';
  let openedFileMime = '';
  let openedCodeHtml = '';
  let openedCodeLanguage = '';
  let openedCsvRows: string[][] = [];
  let openedZipEntries: { name: string; size: number; compressed: number; isDir: boolean }[] = [];
  let openedEnvEntries: { key: string; value: string; visible: boolean; isComment: boolean }[] = [];

  type ZipTreeNode = { label: string; depth: number; isDir: boolean; size: number };
  $: zipTree = buildZipTree(openedZipEntries);

  function buildZipTree(entries: typeof openedZipEntries): ZipTreeNode[] {
    const seenDirs = new Set<string>();
    const nodes: ZipTreeNode[] = [];
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
    for (const e of sorted) {
      const parts = e.name.replace(/\/$/, '').split('/');
      for (let i = 1; i < parts.length; i++) {
        const dir = parts.slice(0, i).join('/');
        if (!seenDirs.has(dir)) {
          seenDirs.add(dir);
          nodes.push({ label: parts[i - 1], depth: i - 1, isDir: true, size: 0 });
        }
      }
      if (!e.isDir) {
        nodes.push({ label: parts[parts.length - 1], depth: parts.length - 1, isDir: false, size: e.size });
      } else {
        const dir = e.name.replace(/\/$/, '');
        if (!seenDirs.has(dir)) {
          seenDirs.add(dir);
          nodes.push({ label: parts[parts.length - 1], depth: parts.length - 1, isDir: true, size: 0 });
        }
      }
    }
    return nodes;
  }
  let previewTruncated = false;

  type PreviewType = 'none' | 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'code' | 'csv' | 'zip' | 'env';
  let previewType: PreviewType = 'none';

  const TEXT_PREVIEW_LIMIT = 200_000;
  const CSV_ROW_LIMIT = 40;
  const CSV_COL_LIMIT = 12;

  function mimeFromName(name: string): string {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    const map: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon',
      mp4: 'video/mp4', webm: 'video/webm', ogg: 'video/ogg', mov: 'video/quicktime',
      mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', aac: 'audio/aac',
      m4a: 'audio/mp4', opus: 'audio/opus',
      pdf: 'application/pdf',
    };
    return map[ext] || 'application/octet-stream';
  }

  function detectPreview(mime: string, name: string): PreviewType {
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime === 'application/pdf') return 'pdf';
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'zip' || ext === 'cbz' || mime === 'application/zip') return 'zip';
    return 'none';
  }

  function parseZipDirectory(bytes: Uint8Array): typeof openedZipEntries {
    const entries: typeof openedZipEntries = [];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // Find End of Central Directory (scan last 64KB max)
    let eocdOffset = -1;
    const searchStart = Math.max(0, bytes.length - 65557);
    for (let i = bytes.length - 22; i >= searchStart; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break; }
    }
    if (eocdOffset === -1) return entries;

    const cdOffset = view.getUint32(eocdOffset + 16, true);
    const cdCount = view.getUint16(eocdOffset + 10, true);
    let pos = cdOffset;

    for (let i = 0; i < cdCount && pos + 46 <= bytes.length; i++) {
      if (view.getUint32(pos, true) !== 0x02014b50) break;
      const compressed = view.getUint32(pos + 20, true);
      const size = view.getUint32(pos + 24, true);
      const nameLen = view.getUint16(pos + 28, true);
      const extraLen = view.getUint16(pos + 30, true);
      const commentLen = view.getUint16(pos + 32, true);
      const name = new TextDecoder().decode(bytes.slice(pos + 46, pos + 46 + nameLen));
      const isDir = name.endsWith('/');
      entries.push({ name, size, compressed, isDir });
      pos += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  function extensionFromName(name: string): string {
    const lower = name.toLowerCase();
    if (lower === 'dockerfile') return 'dockerfile';
    if (lower === '.gitignore') return 'gitignore';
    if (lower === '.env') return 'env';
    if (lower.endsWith('.d.ts')) return 'ts';
    return lower.split('.').pop() ?? '';
  }

  const codeLanguageMap: Record<string, string> = {
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    ts: 'typescript',
    jsx: 'jsx',
    tsx: 'tsx',
    py: 'python',
    php: 'php',
    html: 'html',
    htm: 'html',
    xml: 'xml',
    svg: 'xml',
    json: 'json',
    css: 'css',
    scss: 'css',
    sass: 'css',
    less: 'css',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    sql: 'sql',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'toml',
    ini: 'ini',
    conf: 'ini',
    env: 'ini',
    md: 'markdown',
    java: 'java',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',
    cc: 'cpp',
    cs: 'csharp',
    go: 'go',
    rs: 'rust',
    rb: 'ruby',
    ps1: 'powershell',
    bat: 'batch',
    cmd: 'batch',
    dockerfile: 'dockerfile',
    gitignore: 'text',
    properties: 'ini',
    cfg: 'ini',
    tsv: 'csv',
    txt: 'text',
  };

  const codeExtensions = new Set(Object.keys(codeLanguageMap));
  const plainTextExtensions = new Set(['txt', 'log', 'md', 'rst', 'gitignore']);

  function isProbablyText(bytes: Uint8Array): boolean {
    const sample = bytes.slice(0, Math.min(bytes.length, 2000));
    let suspicious = 0;
    for (const byte of sample) {
      if (byte === 9 || byte === 10 || byte === 13) continue;
      if (byte < 32) suspicious++;
    }
    return suspicious < sample.length * 0.05;
  }

  function escapeHtml(input: string): string {
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function tokenizeAndHighlight(text: string, language: string): string {
    const patterns: Record<string, RegExp> = {
      markup: /<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*?>|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
      json: /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|\btrue\b|\bfalse\b|\bnull\b|-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/gi,
      python: /#[^\n]*|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:False|None|True|and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|if|import|in|is|lambda|not|or|pass|raise|return|try|while|with|yield)\b|\b\d+(?:\.\d+)?\b/g,
      php: /\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:abstract|array|as|break|case|catch|class|const|continue|declare|default|do|echo|else|elseif|extends|final|for|foreach|function|if|implements|include|instanceof|interface|namespace|new|private|protected|public|require|return|static|switch|throw|trait|try|use|var|while)\b|\$\w+|\b\d+(?:\.\d+)?\b/g,
      sql: /--[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:select|from|where|join|left|right|inner|outer|insert|into|update|delete|create|alter|drop|table|index|order|group|by|having|limit|offset|and|or|not|null|values|set|as|on|union|distinct)\b|\b\d+(?:\.\d+)?\b/gi,
      css: /\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|s|ms)?\b|(?<=^|[;{}]\s*)[.#]?[A-Za-z_-][\w-]*(?=\s*\{)|(?<=[{;]\s*)[A-Za-z-]+(?=\s*:)/gm,
      bash: /#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:if|then|else|elif|fi|for|do|done|case|esac|while|function|in|echo|export|local|readonly)\b|\$\w+|\b\d+(?:\.\d+)?\b/g,
      general: /\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:async|await|break|case|catch|class|const|continue|default|delete|do|else|enum|export|extends|false|finally|for|from|function|if|implements|import|in|interface|let|new|null|private|protected|public|return|static|super|switch|this|throw|true|try|type|typeof|var|void|while)\b|\b\d+(?:\.\d+)?\b/g,
    };

    const family =
      language === 'html' || language === 'xml' ? 'markup' :
      language === 'json' ? 'json' :
      language === 'python' ? 'python' :
      language === 'php' ? 'php' :
      language === 'sql' ? 'sql' :
      language === 'css' ? 'css' :
      language === 'bash' ? 'bash' :
      'general';

    const pattern = patterns[family];
    let out = '';
    let lastIndex = 0;

    for (const match of text.matchAll(pattern)) {
      const token = match[0];
      const index = match.index ?? 0;
      out += escapeHtml(text.slice(lastIndex, index));

      let cls = 'ud-code-token';
      if (token.startsWith('//') || token.startsWith('#') || token.startsWith('/*') || token.startsWith('--') || token.startsWith('<!--')) cls = 'ud-code-comment';
      else if (token.startsWith('"') || token.startsWith("'") || token.startsWith('`')) cls = 'ud-code-string';
      else if (family === 'markup' && (token.startsWith('<') || token.startsWith('</'))) cls = 'ud-code-tag';
      else if ((family === 'json' && /^(true|false|null)$/i.test(token)) || /^[A-Za-z_$]/.test(token)) cls = 'ud-code-keyword';
      else if (/^-?\d/.test(token) || /^#[0-9a-fA-F]{3,8}\b/.test(token)) cls = 'ud-code-number';

      out += `<span class="${cls}">${escapeHtml(token)}</span>`;
      lastIndex = index + token.length;
    }

    out += escapeHtml(text.slice(lastIndex));
    return out;
  }

  function parseDelimited(text: string, delimiter: ',' | '\t'): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];

      if (ch === '"') {
        if (inQuotes && next === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        row.push(cell);
        cell = '';
      } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
        if (ch === '\r' && next === '\n') i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += ch;
      }
    }

    if (cell.length || row.length) {
      row.push(cell);
      rows.push(row);
    }

    return rows.slice(0, CSV_ROW_LIMIT).map((r) => r.slice(0, CSV_COL_LIMIT));
  }

  function resetOpenResult() {
    openedText = '';
    openedFileName = '';
    openedFileMime = '';
    openedCodeHtml = '';
    openedCodeLanguage = '';
    openedCsvRows = [];
    openedZipEntries = [];
    openedEnvEntries = [];
    previewTruncated = false;
    previewType = 'none';
    if (openedFileUrl) {
      URL.revokeObjectURL(openedFileUrl);
      openedFileUrl = '';
    }
  }

  function prepareTextualPreview(bytes: Uint8Array, name: string): boolean {
    const ext = extensionFromName(name);
    const isTextFile = plainTextExtensions.has(ext) || codeExtensions.has(ext) || ext === 'csv' || isProbablyText(bytes);
    if (!isTextFile) return false;

    const rawText = new TextDecoder().decode(bytes);
    const normalized = rawText.replace(/\u0000/g, '');
    previewTruncated = normalized.length > TEXT_PREVIEW_LIMIT;
    const previewText = previewTruncated ? normalized.slice(0, TEXT_PREVIEW_LIMIT) : normalized;

    if (ext === 'csv' || ext === 'tsv') {
      openedCsvRows = parseDelimited(previewText, ext === 'tsv' ? '\t' : ',');
      previewType = 'csv';
      pushDebug(`Prepared ${ext.toUpperCase()} preview (${openedCsvRows.length} rows shown)`);
      return true;
    }

    if (ext === 'json') {
      try {
        const parsed = JSON.parse(normalized);
        const pretty = JSON.stringify(parsed, null, 2);
        openedCodeLanguage = 'json';
        openedCodeHtml = tokenizeAndHighlight(pretty.slice(0, TEXT_PREVIEW_LIMIT), 'json');
        previewTruncated = pretty.length > TEXT_PREVIEW_LIMIT;
        previewType = 'code';
        pushDebug(`Prepared JSON code preview (${pretty.length} chars)`);
        return true;
      } catch {
      }
    }

    if (ext === 'env' || name === '.env' || name.startsWith('.env.')) {
      openedEnvEntries = parseEnvFile(previewText);
      previewType = 'env';
      pushDebug(`Prepared .env preview (${openedEnvEntries.length} entries)`);
      return true;
    }

    if (codeExtensions.has(ext) && ext !== 'txt' && ext !== 'log' && ext !== 'gitignore') {
      openedCodeLanguage = codeLanguageMap[ext] || 'text';
      openedCodeHtml = tokenizeAndHighlight(previewText, openedCodeLanguage);
      previewType = 'code';
      pushDebug(`Prepared code preview (${openedCodeLanguage}, ${previewText.length} chars shown)`);
      return true;
    }

    openedText = previewText;
    previewType = 'text';
    pushDebug(`Prepared text preview (${previewText.length} chars shown)`);
    return true;
  }

  function parseEnvFile(text: string): typeof openedEnvEntries {
    return text.split('\n').map(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        return { key: trimmed, value: '', visible: true, isComment: true };
      }
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) {
        return { key: trimmed, value: '', visible: true, isComment: true };
      }
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      return { key, value, visible: false, isComment: false };
    }).filter(e => e.key !== '' || e.isComment);
  }

  function loadMedia(node: HTMLMediaElement, src: string) {
    node.src = src;
    node.load();
    return {
      update(newSrc: string) {
        node.src = newSrc;
        node.load();
      }
    };
  }

  let stegoFile: File | null = null;
  let encryptedFile: File | null = null;
  let manualMode = false;

  function setProgress(title: string, detail = '') {
    progressTitle = title;
    progressDetail = detail;
  }

  function pushDebug(message: string) {
    const line = `[${new Date().toLocaleTimeString('en-GB', { hour12: false })}] ${message}`;
    debugLog = [...debugLog, line];
  }

  function base64UrlDecode(input: string): Uint8Array {
    const b64 = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function gunzipBytes(input: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream('gzip'));
    return readLimited(new Response(stream), 64 * 1024 * 1024);
  }

  onMount(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash || '';
    if (isCapsuleFragment(hash.slice(1))) {
      window.location.replace(`${locale === 'en' ? '' : `/${locale}`}/tools/time-capsule${hash}`);
      return;
    }
    pushDebug(`Page opened: path=${window.location.pathname}, hashLength=${hash.length}, search=${window.location.search || '(empty)'}`);
    if (hash.length > 1) {
      hasHash = true;
      hashPayload = decodeURIComponent(hash.slice(1));
      pushDebug(`Hash payload detected (${hashPayload.length} chars)`);
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const queryPayload = params.get('p');
    if (queryPayload) {
      hasHash = true;
      hashPayload = decodeURIComponent(queryPayload);
      pushDebug(`Query payload detected (${hashPayload.length} chars), normalizing to hash`);
      history.replaceState(null, '', `${window.location.pathname}#${encodeURIComponent(queryPayload)}`);
      pushDebug(`URL normalized to hash on ${window.location.pathname}`);
    } else {
      pushDebug('No encrypted payload found in URL on initial load');
    }
  });

  function handleStegoFile(e: Event) {
    const target = e.target as HTMLInputElement;
    stegoFile = target.files?.[0] ?? null;
    if (stegoFile) encryptedFile = null;
  }

  function handleEncryptedFile(e: Event) {
    const target = e.target as HTMLInputElement;
    encryptedFile = target.files?.[0] ?? null;
    if (encryptedFile) stegoFile = null;
  }

  async function handleDecrypt() {
    error = '';
    resetOpenResult();
    setProgress('', '');
    debugLog = [];

    pushDebug(`Decrypt requested: hasHash=${hasHash}, hashLength=${hashPayload.length}, stegoFile=${stegoFile ? `${stegoFile.name} (${stegoFile.size} bytes)` : 'none'}`);
    if (!password) {
      error = t(dict, 'tools.ultimateDecrypt.errorPasswordRequired');
      pushDebug('Validation failed: missing password');
      return;
    }
    if (hasHash && unlockTime !== undefined && unlockTime > Date.now()) {
      error = lockedMessage(unlockTime);
      return;
    }

    loading = true;
    try {
      if (encryptedFile && !hasHash) {
        pushDebug('Using encrypted file as source');
        await decryptFromEncryptedFile();
      } else if (stegoFile && !hasHash) {
        pushDebug('Using stego image as source');
        await decryptFromStego();
      } else if (hashPayload) {
        pushDebug('Using URL payload as source');
        await decryptFromHash();
      } else {
        error = t(dict, 'tools.ultimateDecrypt.errorNoData');
        pushDebug('Validation failed: no payload source available');
      }
    } catch (e: any) {
      console.error('Decrypt error', e);
      error = e instanceof Notice ? e.message : t(dict, 'tools.ultimateDecrypt.errorDecryptFailed');
      pushDebug(`Decrypt failed: ${e?.message || 'unknown error'}`);
    } finally {
      loading = false;
    }
  }

  async function decryptFromStego() {
    setProgress(t(dict, 'tools.ultimateDecrypt.progressReadingTitle'), t(dict, 'tools.ultimateDecrypt.progressReadingDetail'));
    const buffer = new Uint8Array(await stegoFile!.arrayBuffer());
    pushDebug(`Stego image loaded (${buffer.byteLength} bytes)`);
    const extracted = await extractStego(buffer);
    if (!extracted) {
      pushDebug('Stego extraction returned no hidden data');
      throw new Error(t(dict, 'tools.ultimateDecrypt.errorNoHiddenData'));
    }
    pushDebug(`Stego extraction succeeded (${extracted.byteLength} bytes)`);

    const text = new TextDecoder().decode(extracted);

    if (text.startsWith('http')) {
      setProgress(t(dict, 'tools.ultimateDecrypt.progressFollowingTitle'), t(dict, 'tools.ultimateDecrypt.progressFollowingDetail'));
      const url = new URL(text);
      const innerHash = url.hash.slice(1);
      pushDebug(`Stego payload contained URL ${url.origin}${url.pathname}, hashLength=${innerHash.length}`);
      if (innerHash) {
        hashPayload = decodeURIComponent(innerHash);
        pushDebug(`Inner hash payload accepted (${hashPayload.length} chars)`);
        await decryptFromHash();
      } else {
        pushDebug('Stego URL had no encrypted hash payload');
        throw new Error(t(dict, 'tools.ultimateDecrypt.errorNoEncryptedPayload'));
      }
    } else {
      pushDebug('Stego payload was not a supported URL');
      throw new Error(t(dict, 'tools.ultimateDecrypt.errorUnexpectedStego'));
    }
  }

  async function decryptFromEncryptedFile() {
    setProgress(t(dict, 'tools.ultimateDecrypt.progressDecryptingTitle'), t(dict, 'tools.ultimateDecrypt.progressDecryptingDetail'));
    const buffer = new Uint8Array(await encryptedFile!.arrayBuffer());
    pushDebug(`Encrypted file loaded (${buffer.byteLength} bytes, name=${encryptedFile!.name})`);

    try {
      const { data: decryptedData, name } = await decryptData(buffer, password);
      pushDebug(`Decrypted successfully (${decryptedData.byteLength} bytes, original name=${name})`);
      presentFile(decryptedData, name);
      return;
    } catch (e: any) {
      pushDebug(`decryptData failed: ${e?.message || 'unknown'}, trying stego extraction...`);
    }

    try {
      const extracted = await extractStego(buffer);
      if (extracted) {
        pushDebug(`Stego extraction succeeded (${extracted.byteLength} bytes), decrypting inner payload...`);
        const { data: decryptedData, name } = await decryptData(extracted, password);
        pushDebug(`Inner payload decrypted (${decryptedData.byteLength} bytes, name=${name})`);
        presentFile(decryptedData, name);
        return;
      }
    } catch (e: any) {
      pushDebug(`Stego+decrypt failed: ${e?.message || 'unknown'}`);
    }

    throw new Error(t(dict, 'tools.ultimateDecrypt.errorDecryptFailed'));
  }

  async function decryptFromHash() {
    setProgress(t(dict, 'tools.ultimateDecrypt.progressDecryptingTitle'), t(dict, 'tools.ultimateDecrypt.progressDecryptingDetail'));
    pushDebug(`Decoding hash payload (${hashPayload.length} chars)`);
    const link: ShareLink | null = parseShareFragment(hashPayload);
    if (!link) throw new Error(t(dict, 'tools.ultimateDecrypt.errorUnsupportedVersion'));
    const bytes = base64UrlDecode(link.payload);
    let timeSecret: Uint8Array | undefined;
    if (link.lock) {
      const unlock = roundTime(link.lock.round);
      if (unlock > Date.now()) throw new Notice(lockedMessage(unlock));
      setProgress(t(dict, 'tools.ultimateDecrypt.progressBeaconTitle'), t(dict, 'tools.ultimateDecrypt.progressBeaconDetail'));
      try {
        timeSecret = await unlockTimeSecret(link.lock);
      } catch (e: any) {
        pushDebug(`Time lock failed: ${e?.message || 'unknown'}`);
        throw new Notice(t(dict, 'shareLink.beaconFailed'));
      }
      pushDebug(`Time lock for round ${link.lock.round} opened`);
    }
    pushDebug(`Decoded outer payload to ${bytes.byteLength} bytes`);
    const compressedB64 = await decrypt(bytes, password, timeSecret);
    pushDebug(`Outer payload decrypted to base64 string (${compressedB64.length} chars)`);
    const compressed = Uint8Array.from(atob(compressedB64), c => c.charCodeAt(0));
    pushDebug(`Outer payload base64-decoded to ${compressed.byteLength} bytes`);

    const decompressed = await gunzipBytes(compressed);
    pushDebug(`Outer payload gunzipped to ${decompressed.byteLength} bytes`);

    const data = JSON.parse(new TextDecoder().decode(decompressed)) as any;
    pushDebug(`Outer payload parsed: mode=${data.mode || 'unknown'}, version=${data.v ?? 'unknown'}`);

    if (data.v !== 1) {
      throw new Error(t(dict, 'tools.ultimateDecrypt.errorUnsupportedVersion'));
    }

    if (data.mode === 'inline') {
      await handleInlinePayload(data);
    } else if (data.mode === 'ghost') {
      await handleGhostPayload(data, timeSecret);
    } else {
      throw new Error(t(dict, 'tools.ultimateDecrypt.errorUnknownMode'));
    }
  }

  function presentFile(bytes: Uint8Array, name: string) {
    openedFileName = name;
    const mime = mimeFromName(name);
    openedFileMime = mime;
    previewType = detectPreview(mime, name);

    const copy = new Uint8Array(bytes);
    const blob = new Blob([copy], { type: mime });
    openedFileUrl = URL.createObjectURL(blob);

    if (previewType === 'zip') {
      openedZipEntries = parseZipDirectory(bytes);
      pushDebug(`ZIP archive: ${openedZipEntries.length} entries parsed`);
    } else if (previewType === 'none') {
      prepareTextualPreview(bytes, name);
    }

    pushDebug(`Prepared output file ${name} (${bytes.byteLength} bytes, mime=${mime}, preview=${previewType})`);
    setProgress(t(dict, 'tools.ultimateDecrypt.progressReadyTitle'), t(dict, 'tools.ultimateDecrypt.progressReadyFile'));
  }

  async function handleInlinePayload(data: any) {
    if (data.kind === 'text') {
      pushDebug(`Inline text payload opened (${(data.text || '').length} chars)`);
      setProgress(t(dict, 'tools.ultimateDecrypt.progressReadyTitle'), t(dict, 'tools.ultimateDecrypt.progressReadyText'));
      openedText = data.text || '';
    } else if (data.kind === 'file' && data.data) {
      const binary = atob(data.data);
      const buf = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
      pushDebug(`Inline file payload opened (${buf.byteLength} bytes, name=${data.name || 'download'})`);
      presentFile(buf, data.name || 'download');
    } else {
      throw new Error(t(dict, 'tools.ultimateDecrypt.errorUnsupportedInline'));
    }
  }

  async function handleGhostPayload(data: any, timeSecret?: Uint8Array) {
    const urls: string[] = Array.isArray(data.urls) ? data.urls.filter((url: unknown): url is string => typeof url === 'string') : [];
    const isStego: boolean = data.stego ?? false;
    pushDebug(`Ghost payload opened: urls=${urls.length}, stego=${isStego}`);

    if (urls.length === 0) throw new Error(t(dict, 'tools.ultimateDecrypt.errorNoDownloadUrls'));

    let lastErr = '';

    for (const url of urls) {
      try {
        setProgress(t(dict, 'tools.ultimateDecrypt.progressFetchingTitle'), t(dict, 'tools.ultimateDecrypt.progressFetchingDetail'));
        pushDebug(`Trying download source ${url}`);
        let fileBytes: Uint8Array;

        const res = await ghostFetch(url);
        pushDebug(`Proxy fetch response HTTP ${res.status} for ${url}`);
        if (!res.ok) {
          lastErr = t(dict, 'tools.ultimateDecrypt.errorFetchFailed');
          pushDebug(`Source failed before body read: ${lastErr}`);
          continue;
        }
        const rawBytes = new Uint8Array(await res.arrayBuffer());
        pushDebug(`Downloaded blob (${rawBytes.byteLength} bytes)`);

        if (res.headers.get('X-Send-Encrypted') === 'true' && isSendUrl(url)) {
          pushDebug('Decrypting Send ECE layer client-side...');
          fileBytes = await decryptSendBlob(rawBytes, url, pushDebug);
        } else {
          fileBytes = rawBytes;
        }

        setProgress(t(dict, 'tools.ultimateDecrypt.progressDownloadedTitle'), t(dict, 'tools.ultimateDecrypt.progressDownloadedDetail'));

        let encrypted: Uint8Array;
        if (isStego) {
          setProgress(t(dict, 'tools.ultimateDecrypt.progressExtractingTitle'), t(dict, 'tools.ultimateDecrypt.progressExtractingDetail'));
          const extracted = await extractStego(fileBytes);
          if (!extracted) {
            lastErr = t(dict, 'tools.ultimateDecrypt.errorNoHiddenData');
            pushDebug('Downloaded image had no hidden payload');
            continue;
          }
          encrypted = extracted;
          pushDebug(`Extracted encrypted payload from image (${encrypted.byteLength} bytes)`);
        } else {
          encrypted = fileBytes;
          pushDebug(`Using raw encrypted payload (${encrypted.byteLength} bytes)`);
        }

        const { data: decryptedData, name } = await decryptData(encrypted, password, timeSecret);
        pushDebug(`Inner payload decrypted successfully (${decryptedData.byteLength} bytes, name=${name})`);

        if (name.endsWith('.txt') && decryptedData.length < 100_000) {
          const text = new TextDecoder().decode(decryptedData);
          const isPrintable = !/[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 200));
          if (isPrintable) {
            openedText = text;
            pushDebug(`Printable text result detected (${text.length} chars)`);
            setProgress(t(dict, 'tools.ultimateDecrypt.progressReadyTitle'), t(dict, 'tools.ultimateDecrypt.progressReadyText'));
            return;
          }
        }

        presentFile(decryptedData, name);
        return;
      } catch (e: any) {
        lastErr = e?.message || t(dict, 'tools.ultimateDecrypt.errorDecryptFailed');
        pushDebug(`Source ${url} failed: ${lastErr}`);
      }
    }

    throw new Error(lastErr || t(dict, 'tools.ultimateDecrypt.errorAllSourcesFailed'));
  }

  function downloadFile() {
    if (!openedFileUrl || !openedFileName) return;
    const a = document.createElement('a');
    a.href = openedFileUrl;
    a.download = openedFileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
</script>
<div class="stack text-left">
  {#if hasHash}
    <p class="status status--ok">{t(dict, 'tools.ultimateDecrypt.payloadFound')}</p>
    {#if shareLink}
      <ShareLinkFacts {dict} {locale} expires={shareLink.expires} burn={shareLink.burn} unlock={unlockTime} />
    {/if}
  {:else}
    <p class="hint">
      {t(dict, 'tools.ultimateDecrypt.noPayloadIntro')} <code class="font-mono text-accent">/u#…</code> {t(dict, 'tools.ultimateDecrypt.noPayloadIntroRest')}
    </p>
    <div class="grid gap-3 sm:grid-cols-2">
      {#if encryptedFile}
        <div class="dropzone dropzone--active">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-accent" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          <span class="dropzone__title max-w-full truncate">{encryptedFile.name}</span>
          <span>{encryptedFile.size < 1024 * 1024 ? `${(encryptedFile.size / 1024).toFixed(1)} KB` : `${(encryptedFile.size / (1024 * 1024)).toFixed(1)} MB`}</span>
          <button type="button" class="btn-ghost btn-sm" on:click={() => encryptedFile = null}>{t(dict, 'tools.ultimateDecrypt.upload.remove')}</button>
        </div>
      {:else}
        <label class="dropzone" for="ud-enc">
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <span class="dropzone__title">{t(dict, 'tools.ultimateDecrypt.upload.encryptedFile')}</span>
          <span>{t(dict, 'tools.ultimateDecrypt.upload.encFileHint')}</span>
          <input id="ud-enc" type="file" class="sr-only" on:change={handleEncryptedFile} />
        </label>
      {/if}
      {#if stegoFile}
        <div class="dropzone dropzone--active">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-accent" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          <span class="dropzone__title max-w-full truncate">{stegoFile.name}</span>
          <button type="button" class="btn-ghost btn-sm" on:click={() => stegoFile = null}>{t(dict, 'tools.ultimateDecrypt.upload.remove')}</button>
        </div>
      {:else}
        <label class="dropzone" for="ud-stego">
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          <span class="dropzone__title">{t(dict, 'tools.ultimateDecrypt.upload.stegoImage')}</span>
          <span>{t(dict, 'tools.ultimateDecrypt.upload.stegoHint')}</span>
          <input id="ud-stego" type="file" accept="image/*" class="sr-only" on:change={handleStegoFile} />
        </label>
      {/if}
    </div>
    <QrScanner {dict} />
  {/if}

  <div class="field">
    <label class="label" for="ud-pass">{t(dict, 'tools.ultimateDecrypt.passwordLabel')}</label>
    <input
      id="ud-pass"
      type="password"
      class="input"
      bind:value={password}
      autocomplete="off"
      data-lpignore="true"
      data-1p-ignore
      data-bwignore="true"
      placeholder={t(dict, 'tools.ultimateDecrypt.passwordPlaceholder')}
      aria-invalid={error ? 'true' : undefined}
      on:keydown={(e) => {
        if (e.key === 'Enter' && !loading && (hasHash || stegoFile || encryptedFile)) {
          e.preventDefault();
          void handleDecrypt();
        }
      }}
    />
  </div>

  <button
    class="btn w-full"
    type="button"
    on:click={handleDecrypt}
    disabled={loading || (!hasHash && !stegoFile && !encryptedFile)}
  >
    {loading ? t(dict, 'tools.ultimateDecrypt.decrypting') : t(dict, 'tools.ultimateDecrypt.decrypt')}
  </button>

  {#if loading}
    <ProgressPulse title={progressTitle || t(dict, 'tools.ultimateDecrypt.progressDefaultTitle')} detail={progressDetail || t(dict, 'tools.ultimateDecrypt.progressDefaultDetail')} compact={true} />
  {/if}
  {#if error}
    <p class="status status--error" role="alert">{error}</p>
  {/if}

  {#if openedText}
    <div class="field" role="status">
      <div class="output-head">
        <span class="label">{t(dict, 'tools.ultimateDecrypt.decryptedMessage')}</span>
        <CopyButton text={openedText} label={t(dict, 'common.copy')} copiedLabel={t(dict, 'common.copied')} />
      </div>
      <div class="output output--ok">{openedText}</div>
      {#if previewTruncated}
        <p class="hint">{t(dict, 'tools.ultimateDecrypt.previewTruncated')}</p>
      {/if}
    </div>
  {/if}

  {#if openedFileName}
    <div class="stack" role="status">
      <p class="status status--ok">{t(dict, 'tools.ultimateDecrypt.fileDecrypted')} {openedFileName}</p>
      {#if previewType === 'image'}
        <img src={openedFileUrl} alt={openedFileName} class="max-w-full rounded-lg border border-line-soft" />
      {:else if previewType === 'video' && openedFileUrl}
        {#key openedFileUrl}
          <video controls class="max-w-full rounded-lg border border-line-soft" use:loadMedia={openedFileUrl}></video>
        {/key}
      {:else if previewType === 'audio' && openedFileUrl}
        {#key openedFileUrl}
          <audio controls class="w-full" use:loadMedia={openedFileUrl}></audio>
        {/key}
      {:else if previewType === 'pdf'}
        <iframe sandbox src={openedFileUrl} title={openedFileName} class="h-[70vh] w-full rounded-lg border border-line-soft"></iframe>
      {:else if previewType === 'zip' && zipTree.length > 0}
        <div class="ud-preview">
          <div class="ud-preview__head">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            <span>{openedZipEntries.filter(e => !e.isDir).length} {t(dict, 'tools.ultimateDecrypt.upload.files')}</span>
          </div>
          <div class="ud-preview__body font-mono text-sm">
            {#each zipTree as node}
              <div class="flex items-center gap-1.5 py-1 pr-3" style="padding-left: {12 + node.depth * 16}px">
                {#if node.isDir}
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" class="shrink-0 text-warn" aria-hidden="true"><path d="M2 6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z"/></svg>
                  <span class="font-bold text-text">{node.label}</span>
                {:else}
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-muted" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  <span class="flex-1 truncate text-text">{node.label}</span>
                  <span class="shrink-0 text-xs text-muted tabular-nums">{node.size < 1024 ? `${node.size} B` : node.size < 1048576 ? `${(node.size / 1024).toFixed(1)} KB` : `${(node.size / 1048576).toFixed(1)} MB`}</span>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {:else if previewType === 'env' && openedEnvEntries.length > 0}
        <div class="ud-preview">
          <div class="ud-preview__head">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-warn" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            <span>{t(dict, 'tools.ultimateDecrypt.upload.envHeader')}</span>
          </div>
          <div class="ud-preview__body font-mono text-sm">
            {#each openedEnvEntries as entry, i}
              {#if entry.isComment}
                <div class="px-4 py-1 text-muted">{entry.key}</div>
              {:else}
                <div class="flex items-center">
                  <span class="shrink-0 px-4 py-1.5 font-bold text-accent">{entry.key}</span>
                  <span class="text-muted">=</span>
                  {#if entry.visible}
                    <span class="flex-1 break-all px-2 py-1.5 text-text">{entry.value}</span>
                  {:else}
                    <span class="flex-1 px-2 py-1.5 text-muted">••••••••</span>
                  {/if}
                  <button
                    type="button"
                    class="btn-ghost btn-sm btn-icon shrink-0"
                    on:click={() => { openedEnvEntries[i].visible = !openedEnvEntries[i].visible; openedEnvEntries = openedEnvEntries; }}
                    aria-label={entry.visible ? t(dict, 'tools.ultimateDecrypt.hideSecret') : t(dict, 'tools.ultimateDecrypt.showSecret')}
                    aria-pressed={entry.visible}
                  >
                    {#if entry.visible}
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    {:else}
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    {/if}
                  </button>
                </div>
              {/if}
            {/each}
          </div>
        </div>
      {:else if previewType === 'csv'}
        <div class="ud-preview">
          <div class="ud-preview__body">
            <table class="min-w-full text-sm">
              <tbody>
                {#each openedCsvRows as row, rowIndex}
                  <tr class={rowIndex === 0 ? 'bg-surface-2 font-bold' : 'border-t border-line-soft'}>
                    {#each row as cell}
                      <td class="max-w-[240px] whitespace-pre-wrap break-words px-3 py-2 align-top font-mono text-text">{cell}</td>
                    {/each}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
        {#if previewTruncated}
          <p class="hint">{t(dict, 'tools.ultimateDecrypt.previewTruncated')}</p>
        {/if}
      {:else if previewType === 'code'}
        <div class="ud-preview">
          <div class="ud-preview__head justify-between">
            <span>{t(dict, 'tools.ultimateDecrypt.previewCode')}</span>
            <span class="font-mono">{openedCodeLanguage}</span>
          </div>
          <pre class="ud-preview__body m-0 whitespace-pre-wrap break-words p-4 font-mono text-sm leading-6 text-text"><code class="ud-code" data-language={openedCodeLanguage}>{@html openedCodeHtml}</code></pre>
        </div>
        {#if previewTruncated}
          <p class="hint">{t(dict, 'tools.ultimateDecrypt.previewTruncated')}</p>
        {/if}
      {:else if previewType === 'text'}
        <div class="output output--scroll max-h-[70vh]">{openedText}</div>
        {#if previewTruncated}
          <p class="hint">{t(dict, 'tools.ultimateDecrypt.previewTruncated')}</p>
        {/if}
      {/if}
      {#if openedFileUrl}
        <button type="button" class="btn-secondary" on:click={downloadFile}>
          {t(dict, 'tools.ultimateDecrypt.download')} {openedFileName}
        </button>
      {/if}
    </div>
  {/if}
</div>
