<script lang="ts">
  import { onMount } from 'svelte';
  import { decrypt } from '../../lib/crypto';
  import { decryptData } from '../../lib/ghost/crypto';
  import { extractStego } from '../../lib/ghost/steganography';
  import { decryptSendBlob, isSendUrl } from '../../lib/nologSend';
  import CopyButton from '../CopyButton.svelte';
  import ProgressPulse from '../ProgressPulse.svelte';
  import { getTranslations, t } from '../../lib/i18n';

  export let locale = 'en';
  $: dict = getTranslations(locale);

  let password = '';
  let error = '';
  let loading = false;
  let progressTitle = '';
  let progressDetail = '';
  let debugLog: string[] = [];

  let hashPayload = '';
  let hasHash = false;

  let openedText = '';
  let openedFileName = '';
  let openedFileUrl = '';
  let openedFileMime = '';
  let openedCodeHtml = '';
  let openedCodeLanguage = '';
  let openedCsvRows: string[][] = [];
  let previewTruncated = false;

  type PreviewType = 'none' | 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'code' | 'csv';
  let previewType: PreviewType = 'none';

  const TEXT_PREVIEW_LIMIT = 200_000;
  const CSV_ROW_LIMIT = 40;
  const CSV_COL_LIMIT = 12;

  function mimeFromName(name: string): string {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    const map: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
      mp4: 'video/mp4', webm: 'video/webm', ogg: 'video/ogg', mov: 'video/quicktime',
      mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', aac: 'audio/aac',
      m4a: 'audio/mp4', opus: 'audio/opus',
      pdf: 'application/pdf',
    };
    return map[ext] || 'application/octet-stream';
  }

  function detectPreview(mime: string): PreviewType {
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime === 'application/pdf') return 'pdf';
    return 'none';
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

  let stegoFile: File | null = null;
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
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  onMount(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash || '';
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

    loading = true;
    try {
      if (stegoFile && !hasHash) {
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
      error = t(dict, 'tools.ultimateDecrypt.errorDecryptFailed');
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

  async function decryptFromHash() {
    setProgress(t(dict, 'tools.ultimateDecrypt.progressDecryptingTitle'), t(dict, 'tools.ultimateDecrypt.progressDecryptingDetail'));
    pushDebug(`Decoding hash payload (${hashPayload.length} chars)`);
    const bytes = base64UrlDecode(hashPayload);
    pushDebug(`Decoded outer payload to ${bytes.byteLength} bytes`);
    const compressedB64 = await decrypt(bytes, password);
    pushDebug(`Outer payload decrypted to base64 string (${compressedB64.length} chars)`);
    const compressed = Uint8Array.from(atob(compressedB64), c => c.charCodeAt(0));
    pushDebug(`Outer payload base64-decoded to ${compressed.byteLength} bytes`);

    let json: string;
    try {
      const decompressed = await gunzipBytes(compressed);
      json = new TextDecoder().decode(decompressed);
      pushDebug(`Outer payload gunzipped to ${decompressed.byteLength} bytes`);
    } catch {
      json = compressedB64;
      pushDebug('Outer payload was not gzipped, using plaintext JSON fallback');
    }

    const data = JSON.parse(json) as any;
    pushDebug(`Outer payload parsed: mode=${data.mode || 'unknown'}, version=${data.v ?? 'unknown'}`);

    if (data.v !== 1) {
      throw new Error(t(dict, 'tools.ultimateDecrypt.errorUnsupportedVersion'));
    }

    if (data.mode === 'inline') {
      await handleInlinePayload(data);
    } else if (data.mode === 'ghost') {
      await handleGhostPayload(data);
    } else {
      throw new Error(t(dict, 'tools.ultimateDecrypt.errorUnknownMode'));
    }
  }

  function presentFile(bytes: Uint8Array, name: string) {
    openedFileName = name;
    const mime = mimeFromName(name);
    openedFileMime = mime;
    previewType = detectPreview(mime);

    if (previewType === 'none' && prepareTextualPreview(bytes, name)) {
      setProgress(t(dict, 'tools.ultimateDecrypt.progressReadyTitle'), t(dict, 'tools.ultimateDecrypt.progressReadyFile'));
      return;
    }

    const blob = new Blob([bytes], { type: mime });
    openedFileUrl = URL.createObjectURL(blob);
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

  async function handleGhostPayload(data: any) {
    const urls: string[] = data.urls || (data.url ? [data.url] : []);
    const isStego: boolean = data.stego ?? false;
    pushDebug(`Ghost payload opened: urls=${urls.length}, stego=${isStego}`);

    if (urls.length === 0) throw new Error(t(dict, 'tools.ultimateDecrypt.errorNoDownloadUrls'));

    let lastErr = '';

    for (const url of urls) {
      try {
        setProgress(t(dict, 'tools.ultimateDecrypt.progressFetchingTitle'), t(dict, 'tools.ultimateDecrypt.progressFetchingDetail'));
        pushDebug(`Trying download source ${url}`);
        let fileBytes: Uint8Array;

        const res = await fetch(`/api/ghost/fetch?url=${encodeURIComponent(url)}`);
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

        const { data: decryptedData, name } = await decryptData(encrypted, password);
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

<div class="space-y-6 text-left">
  {#if hasHash}
    <p class="text-sm text-zinc-500 dark:text-zinc-400">
      {t(dict, 'tools.ultimateDecrypt.payloadFound')}
    </p>
  {:else}
    <div class="space-y-4">
      <p class="text-sm text-zinc-500 dark:text-zinc-400">
        {t(dict, 'tools.ultimateDecrypt.noPayloadIntro')} <code class="text-emerald-500">/u#...</code> {t(dict, 'tools.ultimateDecrypt.noPayloadIntroRest')}
      </p>
      <div class="space-y-2">
        <label class="label block" for="ud-stego">{t(dict, 'tools.ultimateDecrypt.uploadStegoImage')}</label>
        <input id="ud-stego" type="file" accept="image/*" class="input cursor-pointer text-xs" on:change={handleStegoFile} />
      </div>
    </div>
  {/if}

  <div class="space-y-2">
    <label class="label block" for="ud-pass">{t(dict, 'tools.ultimateDecrypt.passwordLabel')}</label>
    <input
      id="ud-pass"
      type="password"
      class="input"
      bind:value={password}
      autocomplete="current-password"
      placeholder={t(dict, 'tools.ultimateDecrypt.passwordPlaceholder')}
      on:keydown={(e) => {
        if (e.key === 'Enter' && !loading && (hasHash || stegoFile)) {
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
    disabled={loading || (!hasHash && !stegoFile)}
  >
    {loading ? t(dict, 'tools.ultimateDecrypt.decrypting') : t(dict, 'tools.ultimateDecrypt.decrypt')}
  </button>

  {#if loading}
    <ProgressPulse title={progressTitle || t(dict, 'tools.ultimateDecrypt.progressDefaultTitle')} detail={progressDetail || t(dict, 'tools.ultimateDecrypt.progressDefaultDetail')} compact={true} />
  {/if}

  {#if error}
    <p class="text-xs text-red-500">{error}</p>
  {/if}

  {#if openedText}
    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <label class="label block">{t(dict, 'tools.ultimateDecrypt.decryptedMessage')}</label>
        <CopyButton text={openedText} label={t(dict, 'tools.ultimateDecrypt.copy')} />
      </div>
      <div class="result-box min-h-[80px] whitespace-pre-wrap">
        {openedText}
      </div>
      {#if previewTruncated}
        <p class="text-[11px] text-zinc-500 dark:text-zinc-400">{t(dict, 'tools.ultimateDecrypt.previewTruncated')}</p>
      {/if}
    </div>
  {/if}

  {#if openedFileName}
    <div class="space-y-3">
      <p class="text-xs text-emerald-500">{t(dict, 'tools.ultimateDecrypt.fileDecrypted')} {openedFileName}</p>

      {#if previewType === 'image'}
        <img src={openedFileUrl} alt={openedFileName} class="max-w-full rounded-xl border border-zinc-200 dark:border-zinc-800" />
      {:else if previewType === 'video'}
        {#key openedFileUrl}
          <video controls preload="metadata" class="max-w-full rounded-xl border border-zinc-200 dark:border-zinc-800">
            <source src={openedFileUrl} type={openedFileMime} />
            <track kind="captions" />
          </video>
        {/key}
      {:else if previewType === 'audio'}
        {#key openedFileUrl}
          <audio controls preload="metadata" class="w-full">
            <source src={openedFileUrl} type={openedFileMime} />
          </audio>
        {/key}
      {:else if previewType === 'pdf'}
        <iframe src={openedFileUrl} title={openedFileName} class="w-full h-[70vh] rounded-xl border border-zinc-200 dark:border-zinc-800"></iframe>
      {:else if previewType === 'csv'}
        <div class="overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/70">
          <table class="min-w-full text-xs">
            <tbody>
              {#each openedCsvRows as row, rowIndex}
                <tr class={rowIndex === 0 ? 'bg-zinc-50 dark:bg-zinc-900/80' : 'border-t border-zinc-200 dark:border-zinc-800'}>
                  {#each row as cell}
                    <td class="max-w-[240px] px-3 py-2 align-top font-mono whitespace-pre-wrap break-words text-zinc-700 dark:text-zinc-200">{cell}</td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        {#if previewTruncated}
          <p class="text-[11px] text-zinc-500 dark:text-zinc-400">{t(dict, 'tools.ultimateDecrypt.previewTruncated')}</p>
        {/if}
      {:else if previewType === 'code'}
        <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/70 overflow-auto">
          <div class="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 px-3 py-2 text-[10px] uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
            <span>{t(dict, 'tools.ultimateDecrypt.previewCode')}</span>
            <span>{openedCodeLanguage}</span>
          </div>
          <pre class="m-0 p-4 text-[12px] leading-6 font-mono whitespace-pre-wrap break-words text-zinc-800 dark:text-zinc-100"><code class="ud-code" data-language={openedCodeLanguage}>{@html openedCodeHtml}</code></pre>
        </div>
        {#if previewTruncated}
          <p class="text-[11px] text-zinc-500 dark:text-zinc-400">{t(dict, 'tools.ultimateDecrypt.previewTruncated')}</p>
        {/if}
      {:else if previewType === 'text'}
        <div class="result-box min-h-[160px] max-h-[70vh] overflow-auto whitespace-pre-wrap font-mono text-xs leading-6">
          {openedText}
        </div>
        {#if previewTruncated}
          <p class="text-[11px] text-zinc-500 dark:text-zinc-400">{t(dict, 'tools.ultimateDecrypt.previewTruncated')}</p>
        {/if}
      {/if}

      {#if openedFileUrl}
        <button type="button" class="btn-outline text-xs" on:click={downloadFile}>
          {t(dict, 'tools.ultimateDecrypt.download')} {openedFileName}
        </button>
      {/if}
    </div>
  {/if}

</div>
