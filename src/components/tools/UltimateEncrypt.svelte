<script lang="ts">
  import { generatePassphrase } from "../../lib/passphrase";
  import { onMount, onDestroy } from 'svelte';
  import { encrypt, decrypt } from '../../lib/aesGcm';
  import { encryptData } from '../../lib/ghost/crypto';
  import { sendWithUploadPass, uploadFirstParty } from '../../lib/firstPartyUpload';
  import { MAX_UPLOAD_BYTES, FIRST_PARTY_ENVELOPE_LIMIT, SEND_ENVELOPE_LIMIT } from '../../lib/httpLimits';
  import CopyButton from '../CopyButton.svelte';
  import ProgressPulse from '../ProgressPulse.svelte';
  import { t } from '../../lib/t';
  import PassphraseField from '../PassphraseField.svelte';
  import WizardProgress from '../WizardProgress.svelte';
  import PasswordChecklist from '../PasswordChecklist.svelte';
  import { checkRoomPassword } from '../../lib/chatRoomSettings';
  import { tick } from 'svelte';
  import ShareOptions from '../share/ShareOptions.svelte';
  import ShareLinkFacts from '../share/ShareLinkFacts.svelte';
  import { DEFAULT_RETENTION, retentionForUnlock, type Retention } from '../../lib/retention';
  import { formatShareFragment } from '../../lib/shareLink';
  import { lockTimeSecret, roundTime, type TimeLock } from '../../lib/timelock';

  export let locale = 'en';
  export let dict: Record<string, string>;
  export let resultArt = true;

  type Step = 'input' | 'password' | 'confirm' | 'fallback' | 'processing' | 'result';
  type DeliveryMode = 'auto' | 'link' | 'ghost';

  let step: Step = 'input';

  let textInput = '';
  let file: File | null = null;
  let password = '';
  let timelockDate = '';
  let showQr = false;

  let resultUrl = '';
  let shortUrl = '';
  let stegoImageUrl = '';
  let stegoImageBlob: Blob | null = null;
  let localFileUrl = '';
  let localFileName = '';
  let error = '';
  let resultPassword = '';

  let pendingUploadBytes: Uint8Array | null = null;
  let pendingUploadFilename = '';
  let pendingPayloadPassword = '';
  let pendingUsedStego = false;
  let pendingHosts: HostInfo[] = [];
  let showManualTransferHelp = false;
  let sendButtonEl: HTMLButtonElement | undefined;
  let sendInstance: { host: string; country?: string } | null = null;
  let failedSendHosts: string[] = [];
  let resultHasTemporaryUpload = false;
  let progressTitle = '';
  let progressDetail = '';
  let debugLog: string[] = [];
  let qrSvg = '';
  let shortenableUrl = '';
  let shortening = false;
  let shortenFailed = false;

  let retention: Retention = DEFAULT_RETENTION;
  let burn = false;
  let resultExpires: number | undefined;
  let resultBurn = false;
  let unlockAt = '';
  let pendingLock: { secret: Uint8Array; lock: TimeLock } | null = null;
  let resultUnlock: number | undefined;
  $: unlockMs = unlockAt && Number.isFinite(new Date(unlockAt).getTime()) ? new Date(unlockAt).getTime() : null;
  $: effectiveRetention = retentionForUnlock(retention, unlockMs);
  // Send instances keep files on their own terms, so only shares with the default settings may fall back to them.
  $: sendAllowed = retention === DEFAULT_RETENTION && !burn && !unlockAt;

  const INLINE_LIMIT = 10 * 1024;
  const MAX_FILE = MAX_UPLOAD_BYTES;
  const STEGO_THRESHOLD = 500 * 1024;

  interface HostInfo { id: string; name: string; maxBytes: number; }

  const FIRST_PARTY_HOST: HostInfo = { id: 'eclk', name: 'encrypt.click upload', maxBytes: FIRST_PARTY_ENVELOPE_LIMIT };

  const SEND_HOST: HostInfo = { id: 'nologsend', name: 'Send network (E2E encrypted)', maxBytes: SEND_ENVELOPE_LIMIT };

  $: totalFileSize = files.reduce((s, f) => s + f.size, 0);
  $: payloadSize = files.length > 0 ? totalFileSize : new TextEncoder().encode(textInput.trim()).byteLength;
  $: isLarge = payloadSize > INLINE_LIMIT;
  $: isHuge = payloadSize > MAX_FILE;
  $: deliveryMode = isHuge ? 'local' : isLarge ? 'ghost' : 'link';
  $: shareUrl = shortUrl || resultUrl;
  $: if (step === 'result' && shareUrl) {
    void generateQr(shareUrl);
  }



  // The real name travels inside the encrypted metadata; the file a user hands to a third-party host should not reveal it.
  function neutralEncName(): string {
    const tag = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('');
    return `encrypted-${tag}.enc`;
  }

  let passwordRevealed = false;
  let resultPasswordVisible = false;

  function useGeneratedPassphrase() {
    password = generatePassphrase();
    passwordRevealed = true;
  }

  let textFocused = false;
  let dragging = false;
  let dropZoneEl: HTMLElement;
  let fileInputEl: HTMLInputElement;
  let files: File[] = [];

  $: file = files.length === 1 && !needsZip ? files[0] : null;
  $: needsZip = files.length > 1;
  $: zipName = needsZip ? (files[0]?.webkitRelativePath?.split('/')[0] || 'files') + '.zip' : '';

  function addFiles(incoming: FileList | File[]) {
    const arr = Array.from(incoming);
    if (arr.length === 0) return;
    files = arr;
    textInput = '';
  }

  function handleFileChange(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files) addFiles(target.files);
  }

  function clearFile() {
    files = [];
    if (fileInputEl) fileInputEl.value = '';
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    dragging = true;
  }

  function handleDragLeave() {
    dragging = false;
  }

  function handlePaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const pasted: File[] = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) pasted.push(f);
      }
    }
    if (pasted.length > 0) {
      e.preventDefault();
      addFiles(pasted);
    }
  }

  // Minimal ZIP creator (store only, no compression - we encrypt after anyway)
  async function buildZip(entries: File[]): Promise<Uint8Array> {
    const enc = new TextEncoder();
    const centralHeaders: Uint8Array[] = [];
    const localParts: Uint8Array[] = [];
    let offset = 0;

    for (const f of entries) {
      const name = enc.encode(f.webkitRelativePath || f.name);
      const data = new Uint8Array(await f.arrayBuffer());
      const d = new Date(f.lastModified);
      const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
      const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
      const crc = crc32(data);
      // Local file header
      const local = new Uint8Array(30 + name.length + data.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(8, 0, true);
      lv.setUint16(10, dosTime, true);
      lv.setUint16(12, dosDate, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true);
      local.set(name, 30);
      local.set(data, 30 + name.length);
      localParts.push(local);
      // Central directory header
      const ch = new Uint8Array(46 + name.length);
      const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      ch.set(name, 46);
      centralHeaders.push(ch);

      offset += local.length;
    }

    const cdSize = centralHeaders.reduce((s, h) => s + h.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);

    const total = offset + cdSize + 22;
    const zip = new Uint8Array(total);
    let pos = 0;
    for (const p of localParts) { zip.set(p, pos); pos += p.length; }
    for (const h of centralHeaders) { zip.set(h, pos); pos += h.length; }
    zip.set(eocd, pos);
    return zip;
  }

  function crc32(data: Uint8Array): number {
    let crc = ~0;
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i];
      for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
    return (~crc) >>> 0;
  }

  function setProgress(title: string, detail = '') {
    progressTitle = title;
    progressDetail = detail;
  }

  function pushDebug(message: string) {
    const line = `[${new Date().toLocaleTimeString('en-GB', { hour12: false })}] ${message}`;
    debugLog = [...debugLog, line];
  }

  function base64UrlEncode(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function buildReceiveUrls(fragment: string) {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://encrypt.click';
    return {
      direct: `${origin}/u/#${fragment}`,
      shortenable: `${origin}/u/?p=${encodeURIComponent(fragment)}`,
    };
  }

  async function gzipBytes(input: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([input]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function generateQr(url: string) {
    try {
      const { default: QRCode } = await import('qrcode');
      qrSvg = await QRCode.toString(url, {
        type: 'svg',
        errorCorrectionLevel: 'H',
        margin: 1,
        width: 320,
        color: {
          dark: '#105f3f',
          light: '#ffffff',
        },
      });
    } catch (e: any) {
      pushDebug(`QR generation failed: ${e?.message || 'unknown error'}`);
      qrSvg = '';
    }
  }

  $: passwordChecks = checkRoomPassword(password, '');
  $: passwordRules = [
    { ok: passwordChecks.length, label: t(dict, 'common.passwordRuleLength') },
    { ok: passwordChecks.variety, label: t(dict, 'common.passwordRuleVariety') },
    { ok: passwordChecks.strength, label: t(dict, 'common.passwordRuleStrength') },
  ];
  $: wizardStep = step === 'input' ? 1 : step === 'password' || step === 'confirm' || step === 'fallback' || step === 'processing' ? 2 : 3;
  $: wizardLabel = t(dict, 'common.wizardStep').replace('{current}', String(wizardStep)).replace('{total}', '3');

  async function goToPassword() {
    error = '';
    if (files.length === 0 && !textInput.trim()) {
      error = t(dict, 'tools.ultimateEncrypt.errorEnterMessageOrFile');
      return;
    }
    step = 'password';
    await tick();
    document.getElementById('ue-pass')?.focus();
  }

  async function handleEncrypt() {
    error = '';
    resultUrl = '';
    shortUrl = '';
    stegoImageUrl = '';
    stegoImageBlob = null;
    showManualTransferHelp = false;
    resultHasTemporaryUpload = false;
    sendInstance = null;
    failedSendHosts = [];
    setProgress('', '');
    debugLog = [];

    const trimmed = textInput.trim();
    pushDebug(`Start encrypt: mode=${deliveryMode}, file=${file ? file.name : 'none'}, payloadSize=${payloadSize} bytes`);
    if (files.length === 0 && !trimmed) {
      error = t(dict, 'tools.ultimateEncrypt.errorEnterMessageOrFile');
      pushDebug('Validation failed: empty input');
      return;
    }
    if (!password) {
      error = t(dict, 'tools.ultimateEncrypt.errorPasswordRequired');
      pushDebug('Validation failed: missing password');
      return;
    }
    if (!passwordChecks.length || !passwordChecks.variety || !passwordChecks.strength) {
      error = t(dict, 'common.passwordWeak');
      pushDebug('Validation failed: weak password');
      return;
    }
    const locking = deliveryMode !== 'local' && unlockAt !== '';
    if (locking && (unlockMs === null || unlockMs <= Date.now() + 5000)) {
      error = t(dict, 'tools.ultimateEncrypt.options.unlockPast');
      return;
    }
    if (locking && deliveryMode === 'ghost' && !retentionForUnlock(retention, unlockMs)) {
      error = t(dict, 'tools.ultimateEncrypt.options.unlockTooFar');
      return;
    }

    step = 'processing';

    try {
      pendingLock = null;
      if (locking && unlockMs !== null) {
        setProgress(t(dict, 'tools.ultimateEncrypt.progressLockingTitle'), t(dict, 'tools.ultimateEncrypt.progressLockingDetail'));
        pendingLock = await lockTimeSecret(unlockMs).catch(() => { throw new Error(t(dict, 'tools.ultimateEncrypt.options.lockFailed')); });
        pushDebug(`Time lock set to drand round ${pendingLock.lock.round}`);
      }
      if (deliveryMode === 'local') {
        await encryptLocal();
        showManualTransferHelp = true;
        step = 'confirm';
      } else if (deliveryMode === 'link') {
        await encryptInline();
        step = 'result';
      } else {
        await encryptGhostPrepare();
        await uploadGhost(firstPartyHosts());
      }
    } catch (e: any) {
      error = e?.message || t(dict, 'tools.ultimateEncrypt.errorEncryptionFailed');
      pushDebug(`Encrypt failed: ${error}`);
      step = 'password';
    }
  }

  const firstPartyHosts = () => pendingHosts.filter(h => h.id === 'eclk');
  const sendHosts = () => pendingHosts.filter(h => h.id === 'nologsend');

  // Send is run by third parties, so it is only used after the sender agrees to a specific instance.
  async function uploadGhost(hosts: HostInfo[]) {
    try {
      await encryptGhostUpload(hosts);
      showManualTransferHelp = false;
      step = 'result';
      return;
    } catch (e: any) {
      error = e?.message || t(dict, 'tools.ultimateEncrypt.errorEncryptionFailed');
      pushDebug(`Upload failed: ${error}`);
    }

    const failedHost = hosts.some(h => h.id === 'nologsend') ? sendInstance?.host : undefined;
    if (failedHost) failedSendHosts = [...failedSendHosts, failedHost];
    if (sendAllowed && sendHosts().length > 0 && await pickSendInstance()) {
      error = failedHost ? t(dict, 'tools.ultimateEncrypt.fallback.failed').replace('{host}', failedHost) : '';
      step = 'fallback';
      await tick();
      sendButtonEl?.focus();
      return;
    }
    showManualTransferHelp = true;
    step = 'confirm';
  }

  async function pickSendInstance(): Promise<boolean> {
    sendInstance = null;
    try {
      const params = new URLSearchParams({ size: String(pendingUploadBytes?.length ?? 0), exclude: failedSendHosts.join(',') });
      const res = await fetch(`/api/ghost/upload?${params}`);
      const data = await res.json().catch(() => null) as any;
      if (res.ok && typeof data?.instance?.host === 'string') {
        sendInstance = { host: data.instance.host, country: data.instance.country };
        pushDebug(`Offering Send instance ${sendInstance.host}`);
        return true;
      }
      pushDebug(`No Send instance available: ${data?.error || `HTTP ${res.status}`}`);
    } catch {
      pushDebug('Send instance lookup failed');
    }
    return false;
  }

  function countryName(code?: string): string {
    if (!code) return '';
    try {
      return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
    } catch {
      return code;
    }
  }

  $: fallbackBody = t(dict, 'tools.ultimateEncrypt.fallback.body').split('{server}');

  async function confirmUpload() {
    step = 'processing';
    error = '';
    await uploadGhost(firstPartyHosts());
  }

  async function uploadToSend() {
    step = 'processing';
    error = '';
    await uploadGhost(sendHosts());
  }

  async function resolvePayload(): Promise<{ buffer: Uint8Array; filename: string }> {
    if (needsZip) {
      pushDebug(`Zipping ${files.length} files client-side...`);
      setProgress(t(dict, 'tools.ultimateEncrypt.progressPreparingTitle'), t(dict, 'tools.ultimateEncrypt.progressZipDetail'));
      const buffer = await buildZip(files);
      const filename = zipName;
      pushDebug(`ZIP created: ${filename} (${buffer.byteLength} bytes)`);
      return { buffer, filename };
    }
    if (files.length === 1) {
      const f = files[0];
      const buffer = new Uint8Array(await f.arrayBuffer());
      return { buffer, filename: f.name };
    }
    return { buffer: new TextEncoder().encode(textInput.trim()), filename: 'message.txt' };
  }

  async function encryptLocal() {
    if (files.length === 0) throw new Error(t(dict, 'tools.ultimateEncrypt.errorNoFileSelected'));
    const encryptionPassword = password;
    const { buffer, filename } = await resolvePayload();
    setProgress(t(dict, 'tools.ultimateEncrypt.progressEncryptingTitle'), t(dict, 'tools.ultimateEncrypt.progressEncryptingDetail'));
    pushDebug(`Local encrypt: ${filename} (${buffer.byteLength} bytes)`);

    const encrypted = await encryptData(buffer, encryptionPassword, filename);
    pushDebug(`Encrypted to ${encrypted.byteLength} bytes`);

    const blob = new Blob([encrypted], { type: 'application/octet-stream' });
    localFileName = neutralEncName();
    if (localFileUrl) URL.revokeObjectURL(localFileUrl);
    localFileUrl = URL.createObjectURL(blob);

    pendingHosts = [];
    pendingUploadBytes = null;
    pendingPayloadPassword = '';
    resultPassword = encryptionPassword;
    resultHasTemporaryUpload = false;
    pushDebug(`Local encrypted file ready for download`);
  }

  async function encryptInline() {
    const encryptionPassword = password;
    setProgress(t(dict, 'tools.ultimateEncrypt.progressPreparingTitle'), t(dict, 'tools.ultimateEncrypt.progressPreparingDetail'));
    let payload: any;
    if (files.length > 0) {
      const { buffer: bytes, filename } = await resolvePayload();
      const b64 = btoa(String.fromCharCode(...bytes));
      payload = { v: 1, mode: 'inline', kind: 'file', name: filename, type: 'application/octet-stream', data: b64 };
      pushDebug(`Inline payload prepared for ${filename} (${bytes.byteLength} bytes)`);
    } else {
      payload = { v: 1, mode: 'inline', kind: 'text', text: textInput.trim() };
      pushDebug(`Inline payload prepared for text (${textInput.trim().length} chars)`);
    }

    setProgress(t(dict, 'tools.ultimateEncrypt.progressEncryptingTitle'), t(dict, 'tools.ultimateEncrypt.progressEncryptingDetail'));
    const json = JSON.stringify(payload);
    const jsonBytes = new TextEncoder().encode(json);
    const compressed = await gzipBytes(jsonBytes);
    const compressedB64 = bytesToBase64(compressed);
    pushDebug(`Inline payload compressed from ${jsonBytes.byteLength} to ${compressed.byteLength} bytes`);
    const encrypted = await encrypt(compressedB64, encryptionPassword, undefined, pendingLock?.secret);
    const encoded = base64UrlEncode(encrypted);
    pushDebug(`Inline payload encrypted (${encrypted.byteLength} bytes, encoded length ${encoded.length})`);

    const urls = buildReceiveUrls(formatShareFragment({ payload: encoded, lock: pendingLock?.lock }));
    resultUrl = urls.direct;
    resultPassword = encryptionPassword;
    shortenableUrl = urls.shortenable;
    resultHasTemporaryUpload = false;
    resultExpires = undefined;
    resultBurn = false;
    resultUnlock = pendingLock ? roundTime(pendingLock.lock.round) : undefined;
  }

  async function encryptGhostPrepare() {
    const encryptionPassword = password;
    setProgress(t(dict, 'tools.ultimateEncrypt.progressReadingTitle'), t(dict, 'tools.ultimateEncrypt.progressReadingDetail'));
    const { buffer, filename } = files.length > 0
      ? await resolvePayload()
      : { buffer: new TextEncoder().encode(textInput.trim()), filename: 'message.txt' };
    pushDebug(`Read payload ${filename} (${buffer.byteLength} bytes)`);

    setProgress(t(dict, 'tools.ultimateEncrypt.progressEncryptingTitle'), t(dict, 'tools.ultimateEncrypt.progressEncryptingUploadDetail'));
    const encrypted = await encryptData(buffer, encryptionPassword, filename, pendingLock?.secret);
    pushDebug(`Encrypted (${encrypted.byteLength} bytes)`);

    let usedStego = false;
    if (encrypted.length <= STEGO_THRESHOLD) {
      const { createStegoImage } = await import('../../lib/ghost/steganography');
      pendingUploadBytes = await createStegoImage(encrypted);
      pendingUploadFilename = 'ghost.png';
      usedStego = true;
    } else {
      pendingUploadBytes = encrypted;
      pendingUploadFilename = 'ghost.bin';
    }
    pendingUsedStego = usedStego;
    pendingPayloadPassword = encryptionPassword;
    resultPassword = encryptionPassword;

    // A time-locked file opens only through its link, so there is no copy to hand over by other means.
    if (localFileUrl) URL.revokeObjectURL(localFileUrl);
    localFileUrl = '';
    if (!pendingLock) {
      localFileName = neutralEncName();
      localFileUrl = URL.createObjectURL(new Blob([encrypted], { type: 'application/octet-stream' }));
    }

    const firstPartyEligible = pendingUploadBytes!.length <= FIRST_PARTY_HOST.maxBytes ? [FIRST_PARTY_HOST] : [];
    const sendEligible = pendingUploadBytes!.length <= SEND_HOST.maxBytes ? [SEND_HOST] : [];
    pendingHosts = [...firstPartyEligible, ...sendEligible];
    pushDebug(`Encrypted file ready. Hosts: ${pendingHosts.map(h => h.name).join(', ')}`);
  }

  async function encryptGhostUpload(hosts: HostInfo[]) {
    if (!pendingUploadBytes) throw new Error(t(dict, 'tools.ultimateEncrypt.errorNoEncryptedData'));
    const uploadBytes = pendingUploadBytes;
    const uploadFilename = pendingUploadFilename;
    const usedStego = pendingUsedStego;
    const encryptionPassword = pendingPayloadPassword || password;

    setProgress(t(dict, 'tools.ultimateEncrypt.progressSendingTitle'), t(dict, 'tools.ultimateEncrypt.progressSendingDetail'));
    const uploadUrls: string[] = [];
    let expires: number | undefined;
    let burned = false;

    async function tryUploadHost(host: HostInfo): Promise<string | null> {
      try {
        pushDebug(`Uploading to ${host.name}`);
        if (host.id === 'eclk') {
          const kept = pendingLock ? retentionForUnlock(retention, roundTime(pendingLock.lock.round)) ?? retention : retention;
          const uploaded = await uploadFirstParty(uploadBytes, dict, { retention: kept, burn });
          if (!uploaded) pushDebug('encrypt.click upload failed');
          if (uploaded?.expires) expires = Math.floor(uploaded.expires / 1000);
          burned = uploaded?.burn ?? false;
          return uploaded?.url ?? null;
        }

        const { prepareSendUpload } = await import('../../lib/nologSend');
        const prepared = await prepareSendUpload(uploadBytes, uploadFilename, uploadFilename.endsWith('.png') ? 'image/png' : 'application/octet-stream');
        const res = await sendWithUploadPass('/api/ghost/upload', {
          method: 'POST',
          body: prepared.encryptedBytes,
          headers: {
            'X-Send-Metadata': prepared.metadataB64,
            'X-Send-Auth': prepared.authHeader,
            ...(sendInstance ? { 'X-Send-Instance': sendInstance.host } : {}),
          },
        }, dict);
        const data = await res.json().catch(() => null) as any;
        const result = data?.results?.[0];
        if (!res.ok || !result?.url) {
          pushDebug(`Send network failed: ${result?.details?.join('; ') || data?.error || `HTTP ${res.status}`}`);
          return null;
        }
        return `${result.url}#${prepared.secretB64}`;
      } catch { return null; }
    }

    for (const host of hosts) {
      const url = await tryUploadHost(host);
      if (url) { uploadUrls.push(url); break; }
    }

    if (uploadUrls.length === 0) {
      throw new Error(t(dict, 'tools.ultimateEncrypt.errorAllUploadHostsFailed'));
    }

    const ghostPayload = { v: 1, mode: 'ghost', urls: uploadUrls, stego: usedStego };

    setProgress(t(dict, 'tools.ultimateEncrypt.progressLinkTitle'), t(dict, 'tools.ultimateEncrypt.progressFinalLinkDetail'));
    const payloadJson = JSON.stringify(ghostPayload);
    const payloadBytes = new TextEncoder().encode(payloadJson);
    const compressed = await gzipBytes(payloadBytes);
    const compressedB64 = bytesToBase64(compressed);
    const encPayload = await encrypt(compressedB64, encryptionPassword, undefined, pendingLock?.secret);
    const encoded = base64UrlEncode(encPayload);

    const urls = buildReceiveUrls(formatShareFragment({ payload: encoded, expires, burn: burned, lock: pendingLock?.lock }));
    resultUrl = urls.direct;
    resultPassword = encryptionPassword;
    shortenableUrl = urls.shortenable;
    resultHasTemporaryUpload = true;
    resultExpires = expires;
    resultBurn = burned;
    resultUnlock = pendingLock ? roundTime(pendingLock.lock.round) : undefined;

    pendingUploadBytes = null;
    pendingPayloadPassword = '';
  }

  async function wrapInStego(url: string) {
    setProgress(t(dict, 'tools.ultimateEncrypt.progressCoverImageTitle'), t(dict, 'tools.ultimateEncrypt.progressCoverImageDetail'));
    const urlBytes = new TextEncoder().encode(url);
    const { createStegoImage } = await import('../../lib/ghost/steganography');
    const stegoBytes = await createStegoImage(urlBytes);
    pushDebug(`Generated downloadable PNG wrapper (${stegoBytes.byteLength} bytes)`);
    stegoImageBlob = new Blob([stegoBytes], { type: 'image/png' });
    stegoImageUrl = URL.createObjectURL(stegoImageBlob);
  }

  // Only on request: a short link keeps the encrypted payload on the shortening service, the full link keeps it nowhere.
  async function shortenLink(): Promise<void> {
    const url = shortenableUrl;
    if (!url || shortening) return;
    shortening = true;
    shortenFailed = false;
    await requestShortUrl(url);
    shortening = false;
    shortenFailed = !shortUrl;
  }

  async function requestShortUrl(url: string): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      try {
        const res = await fetch('/api/shorten', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
          signal: controller.signal,
        });
        const data = await res.json().catch(() => null);
        pushDebug(`Shortener: HTTP ${res.status}`);
        if (res.ok && typeof data?.shorturl === 'string') {
          shortUrl = data.shorturl;
          return;
        }
      } catch (e: any) {
        pushDebug(`Shortener: ${e?.name === 'AbortError' ? 'timeout' : e?.message || 'failed'}`);
      } finally {
        clearTimeout(timer);
      }
    }
  }

  function downloadStego() {
    if (!stegoImageUrl) return;
    const a = document.createElement('a');
    a.href = stegoImageUrl;
    a.download = 'secret.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function reset() {
    step = 'input';
    resultPasswordVisible = false;
    textInput = '';
    files = [];
    useGeneratedPassphrase();
    timelockDate = '';
    resultUrl = '';
    shortUrl = '';
    shortenableUrl = '';
    shortenFailed = false;
    error = '';
    resultPassword = '';
    pendingPayloadPassword = '';
    showQr = false;
    showManualTransferHelp = false;
    resultHasTemporaryUpload = false;
    retention = DEFAULT_RETENTION;
    burn = false;
    resultExpires = undefined;
    resultBurn = false;
    unlockAt = '';
    pendingLock = null;
    resultUnlock = undefined;
    setProgress('', '');
    if (stegoImageUrl) URL.revokeObjectURL(stegoImageUrl);
    stegoImageUrl = '';
    stegoImageBlob = null;
    if (localFileUrl) URL.revokeObjectURL(localFileUrl);
    localFileUrl = '';
    localFileName = '';
    qrSvg = '';
    debugLog = [];
  }

  onMount(useGeneratedPassphrase);

  function ueBeforeUnload(e: BeforeUnloadEvent) {
    e.preventDefault();
    e.returnValue = '';
  }

  $: if (typeof window !== 'undefined') {
    if (step === 'processing') window.addEventListener('beforeunload', ueBeforeUnload);
    else window.removeEventListener('beforeunload', ueBeforeUnload);
  }

  onDestroy(() => {
    if (typeof window !== 'undefined') window.removeEventListener('beforeunload', ueBeforeUnload);
  });
</script>
<div class="stack text-left">
  <WizardProgress step={wizardStep} total={3} label={wizardLabel} />
  {#if step === 'input'}
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="stack" on:paste={handlePaste}>
      <p class="hint">{t(dict, 'tools.ultimateEncrypt.transferClaim')}</p>

      <div class="grid gap-4 md:grid-cols-2">
        <div class="field">
          <label class="label" for="ue-text">{t(dict, 'tools.ultimateEncrypt.messageLabel')}</label>
          <textarea
            id="ue-text"
            class="input"
            bind:value={textInput}
            placeholder={t(dict, 'tools.ultimateEncrypt.messagePlaceholder')}
            spellcheck="false"
            autocomplete="off"
            autocapitalize="off"
            disabled={files.length > 0}
          ></textarea>
        </div>

        <div class="field">
          <span class="label" id="ue-file-label">{t(dict, 'tools.ultimateEncrypt.fileLabel')}</span>
          {#if files.length > 0}
            <div class="dropzone dropzone--active" aria-labelledby="ue-file-label">
              <span class="dropzone__title max-w-full truncate">{files.length === 1 ? files[0].name : `${files.length} ${t(dict, 'tools.ultimateEncrypt.confirm.files')}`}</span>
              <span>{#if files.length > 1}{t(dict, 'tools.ultimateEncrypt.confirm.autoZipped')} · {/if}{totalFileSize < 1024 * 1024 ? `${(totalFileSize / 1024).toFixed(1)} KB` : `${(totalFileSize / (1024 * 1024)).toFixed(1)} MB`}</span>
              <button type="button" class="btn-ghost btn-sm" on:click={clearFile}>{t(dict, 'tools.ultimateEncrypt.remove')}</button>
            </div>
          {:else}
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <label
              class="dropzone"
              class:dropzone--dragging={dragging}
              for="ue-file"
              bind:this={dropZoneEl}
              on:drop={handleDrop}
              on:dragover={handleDragOver}
              on:dragleave={handleDragLeave}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <span class="dropzone__title">{t(dict, 'tools.ultimateEncrypt.confirm.dropPasteClick')}</span>
              <input id="ue-file" type="file" multiple class="sr-only" bind:this={fileInputEl} on:change={handleFileChange} />
            </label>
          {/if}
        </div>
      </div>

      {#if error}
        <p class="status status--error" role="alert">{error}</p>
      {/if}

      <button class="btn w-full" type="button" on:click={goToPassword} disabled={(!textInput.trim() && files.length === 0)}>
        {t(dict, 'common.continue')}
      </button>
      {#if !textInput.trim() && files.length === 0}
        <p class="hint text-center">{t(dict, 'tools.ultimateEncrypt.errorEnterMessageOrFile')}</p>
      {/if}
    </div>

  {:else if step === 'password'}
    <form class="stack" method="dialog" on:submit|preventDefault={handleEncrypt}>
      <div class="field">
        <label class="label" for="ue-pass">{t(dict, 'tools.ultimateEncrypt.passwordLabel')}</label>
        <PassphraseField {dict} id="ue-pass" bind:value={password} placeholder={t(dict, 'tools.ultimateEncrypt.passwordPlaceholder')} describedby="ue-pass-rules ue-pass-hint" invalid={!!error} generate={() => { error = ''; return generatePassphrase(); }} bind:revealed={passwordRevealed} />
        <PasswordChecklist id="ue-pass-rules" label={t(dict, 'common.passwordRules')} rules={passwordRules} />
        <p id="ue-pass-hint" class="hint">{t(dict, 'tools.ultimateEncrypt.passwordHint')}</p>
      </div>

      <ShareOptions {dict} mode={deliveryMode} bind:retention bind:burn bind:unlockAt {effectiveRetention} />

      {#if error}
        <p class="status status--error" role="alert">{error}</p>
      {/if}

      <div class="wizard-actions">
        <button class="btn-secondary" type="button" on:click={() => { error = ''; step = 'input'; }}>{t(dict, 'common.back')}</button>
        <button class="btn" type="submit">{t(dict, 'tools.ultimateEncrypt.encryptAndShare')}</button>
      </div>
    </form>

  {:else if step === 'confirm'}
    <div class="stack">
      <div class="status status--warn">
        <div>
          <p class="status__title">{t(dict, 'tools.ultimateEncrypt.confirm.title')}</p>
          <p>{t(dict, 'tools.ultimateEncrypt.confirm.subtitle')}</p>
        </div>
      </div>
      <p class="hint">{t(dict, 'tools.ultimateEncrypt.confirm.storageGuarantee')}</p>
      {#if error}
        <p class="status status--error" role="alert">{error}</p>
      {/if}
      {#if localFileUrl}
        <a href={localFileUrl} download={localFileName} class="btn w-full">{t(dict, 'tools.ultimateEncrypt.confirm.downloadBtn')} · {localFileName}</a>
        <div class="hint grid gap-1.5">
          <p>{t(dict, 'tools.ultimateEncrypt.confirm.manualUploadHint')}</p>
          <p class="actions gap-x-4">
            <a href="https://github.com/timvisee/send-instances/blob/master/README.md#instances" target="_blank" rel="noopener noreferrer" class="text-accent underline underline-offset-2">Send instances</a>
            <a href="https://swisstransfer.com" target="_blank" rel="noopener noreferrer" class="text-accent underline underline-offset-2">SwissTransfer</a>
          </p>
          <p>{t(dict, 'tools.ultimateEncrypt.confirm.recipientDecrypts')} <a href="/u" class="text-accent underline underline-offset-2">encrypt.click/u</a></p>
        </div>
      {/if}
      <div class="actions">
        {#if showManualTransferHelp && pendingHosts.length > 0}
          <button class="btn-secondary" type="button" on:click={confirmUpload}>{t(dict, 'tools.ultimateEncrypt.confirm.retryUploadBtn')}</button>
        {/if}
        <button type="button" class="btn-ghost" on:click={() => step = 'password'}>{t(dict, 'tools.ultimateEncrypt.confirm.back')}</button>
      </div>
    </div>

  {:else if step === 'fallback'}
    <div class="stack">
      <div class="status status--warn">
        <div>
          <p class="status__title">{t(dict, 'tools.ultimateEncrypt.fallback.title')}</p>
          <p>{fallbackBody[0]}{#if sendInstance}<a href="https://{sendInstance.host}" target="_blank" rel="noopener noreferrer" class="font-semibold underline underline-offset-2">{sendInstance.host}</a>{#if sendInstance.country}{' '}({countryName(sendInstance.country)}){/if}{/if}{fallbackBody[1] ?? ''}</p>
        </div>
      </div>
      {#if error}
        <p class="status status--error" role="alert">{error}</p>
      {/if}
      <p class="hint">{t(dict, 'tools.ultimateEncrypt.fallback.availability')}</p>
      <div class="actions">
        <button class="btn" type="button" bind:this={sendButtonEl} on:click={uploadToSend}>{t(dict, 'tools.ultimateEncrypt.fallback.uploadBtn')}</button>
        {#if localFileUrl}
          <a href={localFileUrl} download={localFileName} class="btn-secondary max-w-full truncate">{t(dict, 'tools.ultimateEncrypt.confirm.downloadBtn')} · {localFileName}</a>
        {/if}
        <button type="button" class="btn-ghost" on:click={() => step = 'password'}>{t(dict, 'tools.ultimateEncrypt.fallback.cancelBtn')}</button>
      </div>
    </div>

  {:else if step === 'processing'}
    <div class="stack">
      <ProgressPulse title={progressTitle || t(dict, 'tools.ultimateEncrypt.progressDefaultTitle')} detail={progressDetail || t(dict, 'tools.ultimateEncrypt.progressDefaultDetail')} />
      {#if error}
        <p class="status status--error" role="alert">{error}</p>
      {/if}
    </div>

  {:else if step === 'result'}
    <div class="stack" role="status">
      {#if resultArt}<img src="/encrypt_send.svg" alt="" width="236" height="293" class="state-art" decoding="async" />{/if}
      {#if resultUrl || shortUrl}
        <div class="field">
          <div class="output-head">
            <label class="label" for="ue-result-link">{shortUrl ? t(dict, 'tools.ultimateEncrypt.shareThisLink') : t(dict, 'tools.ultimateEncrypt.encryptedLink')}</label>
            <div class="flex items-center gap-1">
              {#if qrSvg && shareUrl}
                <button type="button" class="btn-ghost btn-sm" aria-pressed={showQr} on:click={() => showQr = !showQr}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h6v6H4z"/><path d="M14 4h6v6h-6z"/><path d="M4 14h6v6H4z"/><path d="M14 14h2"/><path d="M18 14h2v2"/><path d="M14 18h2v2h-2z"/><path d="M18 18h2v2h-2z"/></svg>
                  QR
                </button>
              {/if}
              <CopyButton text={shortUrl || resultUrl} label={t(dict, 'common.copy')} copiedLabel={t(dict, 'common.copied')} />
            </div>
          </div>
          <input id="ue-result-link" class="input input--mono" type="text" readonly value={shortUrl || resultUrl} />
          <ShareLinkFacts {dict} {locale} expires={resultExpires} burn={resultBurn} unlock={resultUnlock} />
          {#if resultHasTemporaryUpload}
            <p class="hint">{t(dict, 'tools.ultimateEncrypt.result.storageNote')}</p>
          {/if}
          {#if showQr && qrSvg && shareUrl}
            <div class="ue-qr" role="img" aria-label={t(dict, 'tools.ultimateEncrypt.qrAlt')}>{@html qrSvg}</div>
          {/if}
          {#if shortenableUrl && !shortUrl}
            <div class="flex flex-wrap items-center gap-2">
              <button type="button" class="btn-secondary btn-sm" disabled={shortening} on:click={shortenLink}>
                {shortening ? t(dict, 'tools.ultimateEncrypt.shortening') : t(dict, 'tools.ultimateEncrypt.shortenLink')}
              </button>
            </div>
            <p class="hint">{t(dict, 'tools.ultimateEncrypt.shortenHint')}</p>
            {#if shortenFailed}
              <p class="status status--error" role="alert">{t(dict, 'tools.ultimateEncrypt.shortenFailed')}</p>
            {/if}
          {/if}
          {#if shortUrl}
            <details class="more">
              <summary>{t(dict, 'tools.ultimateEncrypt.fullLink')}</summary>
              <div class="more__body">
                <div class="flex items-center gap-2">
                  <input class="input input--mono text-sm" type="text" readonly value={resultUrl} aria-label={t(dict, 'tools.ultimateEncrypt.encryptedLink')} />
                  <CopyButton text={resultUrl} label={t(dict, 'common.copy')} copiedLabel={t(dict, 'common.copied')} />
                </div>
              </div>
            </details>
          {/if}
        </div>
      {/if}

      <div class="field">
        <div class="output-head">
          <label class="label" for="ue-result-pass">{t(dict, 'tools.ultimateEncrypt.passwordLabel')}</label>
          <CopyButton text={resultPassword || password} label={t(dict, 'common.copy')} copiedLabel={t(dict, 'common.copied')} />
        </div>
        <div class="passphrase">
          <input id="ue-result-pass" class="input" type={resultPasswordVisible ? 'text' : 'password'} readonly value={resultPassword || password} />
          <button
            type="button"
            class="btn-ghost btn-sm btn-icon"
            on:click={() => { resultPasswordVisible = !resultPasswordVisible; }}
            aria-label={t(dict, 'common.showPassword')}
            aria-pressed={resultPasswordVisible}
            aria-controls="ue-result-pass"
            title={t(dict, resultPasswordVisible ? 'common.hidePassword' : 'common.showPassword')}
          >
            {#if resultPasswordVisible}
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="M14.08 14.16a3 3 0 0 1-4.24-4.24"/><path d="m2 2 20 20"/></svg>
            {:else}
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/></svg>
            {/if}
          </button>
        </div>
        <p class="status status--warn">{t(dict, 'tools.ultimateEncrypt.passwordWarning')}</p>
      </div>

      {#if stegoImageUrl}
        <div class="field">
          <span class="label">{t(dict, 'tools.ultimateEncrypt.steganographyImage')}</span>
          <p class="hint">{t(dict, 'tools.ultimateEncrypt.steganographyHelp')}</p>
          <div class="flex items-center gap-3">
            <img src={stegoImageUrl} alt="" class="h-16 w-16 rounded-lg border border-line-soft object-cover" />
            <button type="button" class="btn-secondary btn-sm" on:click={downloadStego}>{t(dict, 'tools.ultimateEncrypt.downloadImage')}</button>
          </div>
        </div>
      {/if}

      <button type="button" class="btn-secondary w-full" on:click={reset}>{t(dict, 'tools.ultimateEncrypt.encryptAnother')}</button>
    </div>
  {/if}
</div>
