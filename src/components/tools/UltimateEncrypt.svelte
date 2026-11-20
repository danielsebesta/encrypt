<script lang="ts">
  import { QR_COLORS } from '../../lib/qrColors';
  import Icon from '../Icon.svelte';
  import { generatePassphrase } from "../../lib/passphrase";
  import { onMount, onDestroy } from 'svelte';
  import { sealPassword } from '../../lib/passwordEnvelope';
  import { encryptData } from '../../lib/ghost/crypto';
  import { sendWithUploadPass, uploadFirstParty } from '../../lib/firstPartyUpload';
  import { MAX_SINGLE_UPLOAD_BYTES, FIRST_PARTY_ENVELOPE_LIMIT, SEND_ENVELOPE_LIMIT } from '../../lib/httpLimits';
  import {
    TransferMeter,
    formatTransferLine,
    transferRatio,
    type TransferSnapshot,
  } from '../../lib/transferProgress';
  import CopyButton from '../CopyButton.svelte';
  import ShareLinkButton from '../ShareLinkButton.svelte';
  import ProgressPulse from '../ProgressPulse.svelte';
  import { t } from '../../lib/t';
  import PassphraseField from '../PassphraseField.svelte';
  import PasswordChecklist from '../PasswordChecklist.svelte';
  import { checkRoomPassword } from '../../lib/chatRoomSettings';
  import { tick } from 'svelte';
  import { takeSharedContent } from '../../lib/shareTarget';
  import ShareOptions from '../share/ShareOptions.svelte';
  import ShareLinkFacts from '../share/ShareLinkFacts.svelte';
  import { DEFAULT_RETENTION, retentionForUnlock, type Retention } from '../../lib/retention';
  import { formatShareFragment } from '../../lib/shareLink';
  import { encodeShareDrop, shareDropFilename } from '../../lib/shareDrop';
  import { lockTimeSecret, roundTime, type TimeLock } from '../../lib/timelock';

  export let locale = 'en';
  export let dict: Record<string, string>;
  export let appMode = false;

  type Step = 'input' | 'confirm' | 'fallback' | 'processing' | 'result';
  type DeliveryMode = 'auto' | 'link' | 'ghost';

  let step: Step = 'input';

  let textInput = '';
  let file: File | null = null;
  let password = '';

  let resultUrl = '';
  let shortUrl = '';
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
  let transferSnap: TransferSnapshot | null = null;
  const transferMeter = new TransferMeter();
  let debugLog: string[] = [];
  let qrSvg = '';
  let shortenableUrl = '';
  let shortening = false;
  let shortenFailed = false;
  let qrOpen = false;

  let retention: Retention = DEFAULT_RETENTION;
  let burn = false;
  let deadMan = false;
  let resultExpires: number | undefined;
  let resultBurn = false;
  let unlockAt = '';
  let pendingLock: { secret: Uint8Array; lock: TimeLock } | null = null;
  let resultUnlock: number | undefined;
  let dropUrl = '';
  let dropName = '';
  let resultFragment = '';
  $: unlockMs = unlockAt && Number.isFinite(new Date(unlockAt).getTime()) ? new Date(unlockAt).getTime() : null;
  $: effectiveRetention = retentionForUnlock(retention, unlockMs);
  // Send instances keep files on their own terms, so only shares with the default settings may fall back to them.
  $: sendAllowed = retention === DEFAULT_RETENTION && !burn && !unlockAt;

  const INLINE_LIMIT = 10 * 1024;
  const MAX_FILE = MAX_SINGLE_UPLOAD_BYTES;
  const STEGO_THRESHOLD = 500 * 1024;

  interface HostInfo { id: string; name: string; maxBytes: number; }

  $: FIRST_PARTY_HOST = {
    id: 'eclk',
    name: t(dict, 'tools.ultimateEncrypt.firstPartyUpload'),
    maxBytes: FIRST_PARTY_ENVELOPE_LIMIT,
  } as HostInfo;

  const SEND_HOST: HostInfo = { id: 'nologsend', name: 'Send network (E2E encrypted)', maxBytes: SEND_ENVELOPE_LIMIT };

  $: totalFileSize = files.reduce((s, f) => s + f.size, 0);
  $: payloadSize = files.length > 0 ? totalFileSize : new TextEncoder().encode(textInput.trim()).byteLength;
  $: isLarge = payloadSize > INLINE_LIMIT;
  $: isHuge = payloadSize > MAX_FILE;
  // A link cannot forget itself, so a short message that must burn after reading is stored on the server instead.
  $: deliveryMode = (isHuge ? 'local' : isLarge || burn ? 'ghost' : 'link') as 'local' | 'ghost' | 'link';
  $: shareUrl = shortUrl || resultUrl;
  $: resultPass = resultPassword || password;
  // The blurb carries only the link — sharing link and password in one message defeats the point of sharing them separately.
  $: resultBlurb = shareUrl && resultPass
    ? t(dict, 'tools.ultimateEncrypt.result.blurb').replace('{link}', shareUrl)
    : '';
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

  let dragging = false;
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

  function formatSize(bytes: number): string {
    return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

  // Store-only ZIP: the archive is encrypted afterwards, so compression would gain nothing.
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
    if (!title) {
      transferSnap = null;
      transferMeter.reset();
    }
  }

  function showServerBusy() {
    progressDetail = t(dict, 'tools.ultimateEncrypt.serverBusy');
  }

  function onTransferProgress(loaded: number, total: number) {
    transferSnap = transferMeter.report(loaded, total);
  }

  $: transferLine = transferSnap ? formatTransferLine(dict, t, transferSnap) : '';
  $: transferBar = transferRatio(transferSnap);

  function pushDebug(message: string) {
    const line = `[${new Date().toLocaleTimeString('en-GB', { hour12: false })}] ${message}`;
    debugLog = [...debugLog, line];
  }

  function base64UrlEncode(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
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
        color: QR_COLORS,
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
  $: hasContent = files.length > 0 || textInput.trim().length > 0;
  $: reviewWhat = files.length === 1 ? files[0].name : files.length > 1 ? `${files.length} ${t(dict, 'tools.ultimateEncrypt.confirm.files')}` : t(dict, 'tools.ultimateEncrypt.review.message').replace('{count}', String(textInput.trim().length));
  $: reviewWhere = t(dict, deliveryMode === 'ghost' ? 'tools.ultimateEncrypt.review.whereGhost' : deliveryMode === 'link' ? 'tools.ultimateEncrypt.review.whereLink' : 'tools.ultimateEncrypt.review.whereLocal');

  let optionsOpen = false;
  let storageChecked = false;
  let burnUnavailable = false;
  $: if (optionsOpen && !storageChecked) void checkStorage();
  $: if (burnUnavailable) burn = false;

  async function checkStorage() {
    storageChecked = true;
    try {
      const res = await fetch('/upload/status', { cache: 'no-store' });
      const data = await res.json().catch(() => null) as { available?: unknown } | null;
      burnUnavailable = res.ok && data?.available === false;
    } catch {
      burnUnavailable = false;
    }
  }

  // Field errors appear after the first submit and then follow every edit; `error` holds only failures that belong to no field.
  let attempted = false;

  function passwordProblem(value: string, checks: typeof passwordChecks): string {
    if (!value) return t(dict, 'tools.ultimateEncrypt.errorPasswordRequired');
    if (!checks.length || !checks.variety || !checks.strength) return t(dict, 'common.passwordWeak');
    return '';
  }

  function unlockProblem(at: string, ms: number | null, mode: typeof deliveryMode, keep: Retention): string {
    if (mode === 'local' || !at) return '';
    if (ms === null || ms <= Date.now() + 5000) return t(dict, 'tools.ultimateEncrypt.options.unlockPast');
    if (mode === 'ghost' && !retentionForUnlock(keep, ms)) return t(dict, 'tools.ultimateEncrypt.options.unlockTooFar');
    return '';
  }

  $: passwordError = attempted ? passwordProblem(password, passwordChecks) : '';
  $: unlockError = attempted ? unlockProblem(unlockAt, unlockMs, deliveryMode, retention) : '';

  async function focusEncryptError() {
    const unlock = !passwordProblem(password, passwordChecks) && !!unlockProblem(unlockAt, unlockMs, deliveryMode, retention);
    if (unlock) optionsOpen = true;
    await tick();
    document.getElementById(unlock ? 'ue-unlock' : 'ue-pass')?.focus();
  }

  let orbDone = false;

  async function goToResult() {
    if (shortenableUrl && !shortUrl) {
      await requestShortUrl(shortenableUrl);
      shortenFailed = !shortUrl;
    }
    if (step === 'processing' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      orbDone = true;
      await new Promise((resolve) => setTimeout(resolve, 1300));
      orbDone = false;
    }
    step = 'result';
    await tick();
    const link = document.getElementById('ue-result-link') as HTMLInputElement | null;
    link?.focus();
    if (link) link.scrollLeft = 0;
  }

  async function handleEncrypt() {
    error = '';
    if (!hasContent) {
      error = t(dict, 'tools.ultimateEncrypt.errorEnterMessageOrFile');
      return;
    }
    error = '';
    resultUrl = '';
    shortUrl = '';
    showManualTransferHelp = false;
    resultHasTemporaryUpload = false;
    sendInstance = null;
    failedSendHosts = [];
    setProgress('', '');
    debugLog = [];

    pushDebug(`Start encrypt: mode=${deliveryMode}, file=${file ? file.name : 'none'}, payloadSize=${payloadSize} bytes`);
    attempted = true;
    if (passwordProblem(password, passwordChecks) || unlockProblem(unlockAt, unlockMs, deliveryMode, retention)) {
      pushDebug('Validation failed');
      await focusEncryptError();
      return;
    }
    const locking = deliveryMode !== 'local' && unlockAt !== '';

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
        await goToResult();
      } else {
        await encryptGhostPrepare();
        await uploadGhost(firstPartyHosts());
      }
    } catch (e: any) {
      error = e?.message || t(dict, 'tools.ultimateEncrypt.errorEncryptionFailed');
      pushDebug(`Encrypt failed: ${error}`);
      await holdError();
      step = 'input';
      await focusEncryptError();
    }
  }

  async function holdError() {
    if (step === 'processing' && !matchMedia('(prefers-reduced-motion: reduce)').matches) await new Promise((resolve) => setTimeout(resolve, 1400));
  }

  const firstPartyHosts = () => pendingHosts.filter(h => h.id === 'eclk');
  const sendHosts = () => pendingHosts.filter(h => h.id === 'nologsend');

  // Send is run by third parties, so it is only used after the sender agrees to a specific instance.
  async function uploadGhost(hosts: HostInfo[]) {
    try {
      await encryptGhostUpload(hosts);
      showManualTransferHelp = false;
      await goToResult();
      return;
    } catch (e: any) {
      error = e?.message || t(dict, 'tools.ultimateEncrypt.errorEncryptionFailed');
      pushDebug(`Upload failed: ${error}`);
      await holdError();
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
      payload = { v: 2, mode: 'inline', kind: 'file', name: filename, type: 'application/octet-stream', data: b64 };
      pushDebug(`Inline payload prepared for ${filename} (${bytes.byteLength} bytes)`);
    } else {
      payload = { v: 2, mode: 'inline', kind: 'text', text: textInput.trim() };
      pushDebug(`Inline payload prepared for text (${textInput.trim().length} chars)`);
    }

    setProgress(t(dict, 'tools.ultimateEncrypt.progressEncryptingTitle'), t(dict, 'tools.ultimateEncrypt.progressEncryptingDetail'));
    const json = JSON.stringify(payload);
    const jsonBytes = new TextEncoder().encode(json);
    const compressed = await gzipBytes(jsonBytes);
    pushDebug(`Inline payload compressed from ${jsonBytes.byteLength} to ${compressed.byteLength} bytes`);
    // The gzip bytes go into the envelope directly; the old v1 path wrapped them in a base64 string first, which
    // cost a third of the fragment for nothing. The receiver tells the layouts apart by the gzip magic.
    const encrypted = await sealPassword(compressed, encryptionPassword, { timeSecret: pendingLock?.secret });
    const encoded = base64UrlEncode(encrypted);
    pushDebug(`Inline payload encrypted (${encrypted.byteLength} bytes, encoded length ${encoded.length})`);

    const fragment = formatShareFragment({ payload: encoded, lock: pendingLock?.lock });
    const urls = buildReceiveUrls(fragment);
    resultUrl = urls.direct;
    resultPassword = encryptionPassword;
    shortenableUrl = urls.shortenable;
    resultHasTemporaryUpload = false;
    resultExpires = undefined;
    resultBurn = false;
    resultUnlock = pendingLock ? roundTime(pendingLock.lock.round) : undefined;
    setDropFromFragment(fragment);
  }

  async function encryptGhostPrepare() {
    const encryptionPassword = password;
    pendingUploadBytes = null;

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
      localFileUrl = URL.createObjectURL(new Blob([encrypted as BlobPart], { type: 'application/octet-stream' }));
    }

    const firstPartyEligible = pendingUploadBytes!.length <= FIRST_PARTY_HOST.maxBytes ? [FIRST_PARTY_HOST] : [];
    const sendEligible = pendingUploadBytes!.length <= SEND_HOST.maxBytes ? [SEND_HOST] : [];
    pendingHosts = [...firstPartyEligible, ...sendEligible];
    pushDebug(`Encrypted file ready. Hosts: ${pendingHosts.map(h => h.name).join(', ')}`);
  }

  async function encryptGhostUpload(hosts: HostInfo[]) {
    const encryptionPassword = pendingPayloadPassword || password;
    const usedStego = pendingUsedStego;
    transferMeter.reset();
    transferSnap = null;
    setProgress(t(dict, 'tools.ultimateEncrypt.progressSendingTitle'), t(dict, 'tools.ultimateEncrypt.progressSendingDetail'));
    const uploadUrls: string[] = [];
    let expires: number | undefined;
    let burned = false;
    const kept = pendingLock ? retentionForUnlock(retention, roundTime(pendingLock.lock.round)) ?? retention : retention;

    if (!pendingUploadBytes) throw new Error(t(dict, 'tools.ultimateEncrypt.errorNoEncryptedData'));
    const uploadBytes = pendingUploadBytes;
    const uploadFilename = pendingUploadFilename;

    async function tryUploadHost(host: HostInfo): Promise<string | null> {
      try {
        pushDebug(`Uploading to ${host.name}`);
        transferMeter.reset();
        if (host.id === 'eclk') {
          const uploaded = await uploadFirstParty(uploadBytes, dict, {
            retention: kept,
            burn,
            onProgress: onTransferProgress,
            onWait: showServerBusy,
          });
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
        }, dict, onTransferProgress, showServerBusy);
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
    pendingUploadBytes = null;

    const ghostPayload = { v: 2, mode: 'ghost', urls: uploadUrls, stego: usedStego };

    setProgress(t(dict, 'tools.ultimateEncrypt.progressLinkTitle'), t(dict, 'tools.ultimateEncrypt.progressFinalLinkDetail'));
    const payloadJson = JSON.stringify(ghostPayload);
    const payloadBytes = new TextEncoder().encode(payloadJson);
    const compressed = await gzipBytes(payloadBytes);
    const encPayload = await sealPassword(compressed, encryptionPassword, { timeSecret: pendingLock?.secret });
    const encoded = base64UrlEncode(encPayload);

    const fragment = formatShareFragment({ payload: encoded, expires, burn: burned, lock: pendingLock?.lock });
    const urls = buildReceiveUrls(fragment);
    resultUrl = urls.direct;
    resultPassword = encryptionPassword;
    shortenableUrl = urls.shortenable;
    resultHasTemporaryUpload = true;
    resultExpires = expires;
    resultBurn = burned;
    resultUnlock = pendingLock ? roundTime(pendingLock.lock.round) : undefined;
    setDropFromFragment(fragment);

    pendingPayloadPassword = '';
  }

  function setDropFromFragment(fragment: string) {
    resultFragment = fragment;
    if (dropUrl) URL.revokeObjectURL(dropUrl);
    dropUrl = '';
    dropName = '';
    try {
      const body = encodeShareDrop(fragment);
      dropName = shareDropFilename();
      dropUrl = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
    } catch {
      /* fragment too large or invalid — skip offline drop file */
    }
  }

  // Runs automatically before the result is shown; this retry only appears when that attempt failed.
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
        const data = (await res.json().catch(() => null)) as { shorturl?: unknown } | null;
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

  async function reset() {
    step = 'input';
    attempted = false;
    resultPasswordVisible = false;
    qrOpen = false;
    textInput = '';
    files = [];
    useGeneratedPassphrase();
    resultUrl = '';
    shortUrl = '';
    shortenableUrl = '';
    shortenFailed = false;
    error = '';
    resultPassword = '';
    pendingPayloadPassword = '';
    showManualTransferHelp = false;
    resultHasTemporaryUpload = false;
    retention = DEFAULT_RETENTION;
    burn = false;
    deadMan = false;
    resultExpires = undefined;
    resultBurn = false;
    unlockAt = '';
    pendingLock = null;
    resultUnlock = undefined;
    resultFragment = '';
    if (dropUrl) URL.revokeObjectURL(dropUrl);
    dropUrl = '';
    dropName = '';
    setProgress('', '');
    if (localFileUrl) URL.revokeObjectURL(localFileUrl);
    localFileUrl = '';
    localFileName = '';
    qrSvg = '';
    debugLog = [];
    await tick();
    document.getElementById('ue-text')?.focus();
  }

  onMount(() => {
    useGeneratedPassphrase();
    void takeSharedContent().then((shared) => {
      if (shared?.files.length) addFiles(shared.files);
      else if (shared) textInput = shared.text;
    });
  });

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
    transferMeter.dispose();
  });
</script>
<div class="stack text-left">
  {#if step === 'input'}
    <form class="stack" method="dialog" novalidate on:submit|preventDefault={handleEncrypt} on:paste={handlePaste}>
      <p class="hint">{t(dict, 'tools.ultimateEncrypt.transferClaim')}</p>

      <div class="grid gap-4 md:grid-cols-2">
        <div class="field field--fill">
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

        <div class="field field--fill">
          <span class="label" id="ue-file-label">{t(dict, 'tools.ultimateEncrypt.fileLabel')}</span>
          {#if files.length > 0}
            <div class="dropzone dropzone--active file-chip--enter" role="group" aria-labelledby="ue-file-label">
              <Icon name="circle-check-big" size={20} class="text-accent" />
              <span class="dropzone__title max-w-full truncate">{files.length === 1 ? files[0].name : `${files.length} ${t(dict, 'tools.ultimateEncrypt.confirm.files')}`}</span>
              <span class="font-mono tabular-nums">{#if files.length > 1}{t(dict, 'tools.ultimateEncrypt.confirm.autoZipped')} · {/if}{formatSize(totalFileSize)}</span>
              <button type="button" class="btn-ghost btn-sm" on:click={clearFile}>{t(dict, 'tools.ultimateEncrypt.remove')}</button>
            </div>
          {:else}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <label
              class="dropzone"
              class:dropzone--dragging={dragging}
              for="ue-file"
              on:drop={handleDrop}
              on:dragover={handleDragOver}
              on:dragleave={handleDragLeave}
            >
              {#if appMode}
                <span class="dropzone__icon"><Icon name="plus" size={20} /></span>
                <span class="dropzone__title">{t(dict, 'app.files.choose')}</span>
                <span class="dropzone__hint">{t(dict, 'app.files.chooseHint')}</span>
              {:else}
                <Icon name="upload" size={20} />
                <span class="dropzone__title">{t(dict, 'tools.ultimateEncrypt.confirm.dropPasteClick')}</span>
              {/if}
              <input id="ue-file" type="file" multiple class="sr-only" aria-labelledby="ue-file-label" bind:this={fileInputEl} on:change={handleFileChange} />
            </label>
          {/if}
        </div>
      </div>

      {#if hasContent}
        {#if isHuge}
          <div class="status status--warn">
            <div>
              <p class="status__title">{t(dict, 'tools.ultimateEncrypt.largeNotice.title')}</p>
              <p>{t(dict, 'tools.ultimateEncrypt.largeNotice.desc')}</p>
            </div>
          </div>
        {/if}
        <div class="field">
          <label class="label" for="ue-pass">{t(dict, 'tools.ultimateEncrypt.passwordLabel')}<span class="label__required" aria-hidden="true">*</span></label>
          <PassphraseField
            {dict}
            id="ue-pass"
            bind:value={password}
            bind:revealed={passwordRevealed}
            placeholder={t(dict, 'tools.ultimateEncrypt.passwordPlaceholder')}
            describedby={passwordError ? 'ue-pass-error ue-pass-rules ue-pass-hint' : 'ue-pass-rules ue-pass-hint'}
            invalid={!!passwordError}
            required
            generate={generatePassphrase}
          />
          {#if passwordError}
            <p id="ue-pass-error" class="field-error" role="alert">{passwordError}</p>
          {/if}
          <PasswordChecklist id="ue-pass-rules" label={t(dict, 'common.passwordRules')} rules={passwordRules} {dict} invalid={!!passwordError} />
          <p id="ue-pass-hint" class="hint">{t(dict, 'tools.ultimateEncrypt.passwordHint')}</p>
        </div>

        <details class="more" bind:open={optionsOpen}>
          <summary>{t(dict, 'tools.ultimateEncrypt.options.title')}</summary>
          <div class="more__body">
            <ShareOptions {dict} mode={deliveryMode} short={!isLarge} {burnUnavailable} {unlockError} bind:retention bind:burn bind:deadMan bind:unlockAt {effectiveRetention} />
          </div>
        </details>

        <dl class="review" aria-label={t(dict, 'tools.ultimateEncrypt.review.title')}>
          <div class="review__row">
            <dt>{t(dict, 'tools.ultimateEncrypt.review.sending')}</dt>
            <dd class:review__value={files.length === 1}>{reviewWhat}</dd>
          </div>
          <div class="review__row">
            <dt>{t(dict, 'tools.ultimateEncrypt.review.where')}</dt>
            <dd>{reviewWhere}</dd>
          </div>
          {#if deliveryMode === 'ghost'}
            <div class="review__row">
              <dt>{t(dict, 'tools.ultimateEncrypt.review.expires')}</dt>
              <dd>{t(dict, `tools.ultimateEncrypt.options.retention${effectiveRetention ?? retention}`)}</dd>
            </div>
          {/if}
        </dl>
      {/if}

      {#if error}
        <p class="status status--error" role="alert">{error}</p>
      {/if}

      <button class="btn btn-block" type="submit" disabled={!hasContent} aria-describedby={hasContent ? undefined : 'ue-empty-hint'}>{t(dict, 'tools.ultimateEncrypt.encryptAndShare')}</button>
      {#if !hasContent}
        <p id="ue-empty-hint" class="hint text-center">{t(dict, 'tools.ultimateEncrypt.errorEnterMessageOrFile')}</p>
      {/if}
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
        <div class="hint grid gap-1.5">
          <p>{t(dict, 'tools.ultimateEncrypt.confirm.manualUploadHint')}</p>
          <p class="flex flex-wrap gap-x-4 gap-y-1">
            <a href="https://github.com/timvisee/send-instances/blob/master/README.md#instances" target="_blank" rel="noopener noreferrer" class="text-accent underline">{t(dict, 'tools.ultimateEncrypt.confirm.sendInstances')}</a>
            <a href="https://swisstransfer.com" target="_blank" rel="noopener noreferrer" class="text-accent underline">{t(dict, 'tools.ultimateEncrypt.confirm.swissTransfer')}</a>
          </p>
          <p>{t(dict, 'tools.ultimateEncrypt.confirm.recipientDecrypts')} <a href="/u" class="text-accent underline">{t(dict, 'tools.ultimateEncrypt.confirm.decryptPath')}</a></p>
        </div>
      {/if}
      <div class="actions max-sm:flex-col max-sm:items-stretch">
        {#if localFileUrl}
          <a href={localFileUrl} download={localFileName} class="btn max-w-full min-w-0"><Icon name="download" /><span class="min-w-0 truncate">{t(dict, 'tools.ultimateEncrypt.confirm.downloadBtn')} · {localFileName}</span></a>
        {/if}
        {#if showManualTransferHelp && pendingHosts.length > 0}
          <button class="btn-secondary" type="button" on:click={confirmUpload}>{t(dict, 'tools.ultimateEncrypt.confirm.retryUploadBtn')}</button>
        {/if}
        <button type="button" class="btn-ghost" on:click={() => step = 'input'}>{t(dict, 'tools.ultimateEncrypt.confirm.back')}</button>
      </div>
    </div>

  {:else if step === 'fallback'}
    <div class="stack">
      <div class="status status--warn">
        <div>
          <p class="status__title">{t(dict, 'tools.ultimateEncrypt.fallback.title')}</p>
          <p>{fallbackBody[0]}{#if sendInstance}<a href="https://{sendInstance.host}" target="_blank" rel="noopener noreferrer" class="font-semibold underline">{sendInstance.host}</a>{#if sendInstance.country}{' '}({countryName(sendInstance.country)}){/if}{/if}{fallbackBody[1] ?? ''}</p>
        </div>
      </div>
      {#if error}
        <p class="status status--error" role="alert">{error}</p>
      {/if}
      <p class="hint">{t(dict, 'tools.ultimateEncrypt.fallback.availability')}</p>
      <div class="actions max-sm:flex-col max-sm:items-stretch">
        <button class="btn" type="button" bind:this={sendButtonEl} on:click={uploadToSend}>{t(dict, 'tools.ultimateEncrypt.fallback.uploadBtn')}</button>
        {#if localFileUrl}
          <a href={localFileUrl} download={localFileName} class="btn-secondary max-w-full min-w-0"><Icon name="download" /><span class="min-w-0 truncate">{t(dict, 'tools.ultimateEncrypt.confirm.downloadBtn')} · {localFileName}</span></a>
        {/if}
        <button type="button" class="btn-ghost" on:click={() => step = 'input'}>{t(dict, 'tools.ultimateEncrypt.fallback.cancelBtn')}</button>
      </div>
    </div>

  {:else if step === 'processing'}
    <div class="stack">
      <ProgressPulse
        title={progressTitle || t(dict, 'tools.ultimateEncrypt.progressDefaultTitle')}
        detail={progressDetail || t(dict, 'tools.ultimateEncrypt.progressDefaultDetail')}
        ratio={transferBar}
        transferLine={transferLine}
        state={error ? 'error' : orbDone ? 'success' : 'loading'}
      />
      {#if error}
        <p class="status status--error" role="alert">{error}</p>
      {/if}
    </div>

  {:else if step === 'result'}
    <div class="stack">
      <p class="ue-result__ready" role="status"><Icon name="check" size={20} />{t(dict, 'tools.ultimateEncrypt.result.readyTitle')}</p>

      {#if shareUrl}
        <div class="field">
          <div class="output-head">
            <label class="label" for="ue-result-link">{shortUrl ? t(dict, 'tools.ultimateEncrypt.shareThisLink') : t(dict, 'tools.ultimateEncrypt.encryptedLink')}</label>
            <CopyButton text={shareUrl} label={t(dict, 'common.copy')} copiedLabel={t(dict, 'common.copied')} errorLabel={t(dict, 'common.uploadChallenge.retry')} />
          </div>
          <input id="ue-result-link" class="input input--mono" type="text" readonly value={shareUrl} aria-describedby={resultHasTemporaryUpload ? 'ue-result-storage' : undefined} />
          {#if resultHasTemporaryUpload}
            <p id="ue-result-storage" class="hint">{t(dict, 'tools.ultimateEncrypt.result.storageNote')}</p>
          {/if}
        </div>
        <ShareLinkFacts {dict} {locale} expires={resultExpires} burn={resultBurn} unlock={resultUnlock} />
        {#if deadMan && resultUnlock}
          <p class="status status--warn">{t(dict, 'tools.ultimateEncrypt.options.deadManResult').replace('{time}', new Date(resultUnlock).toLocaleString(locale))}</p>
        {/if}
      {/if}

      <div class="field">
        <div class="output-head">
          <label class="label" for="ue-result-pass">{t(dict, 'tools.ultimateEncrypt.passwordLabel')}</label>
          <CopyButton text={resultPass} label={t(dict, 'common.copy')} copiedLabel={t(dict, 'common.copied')} errorLabel={t(dict, 'common.uploadChallenge.retry')} />
        </div>
        <div class="passphrase">
          <input id="ue-result-pass" class="input" type={resultPasswordVisible ? 'text' : 'password'} readonly value={resultPass} aria-describedby="ue-result-pass-note" />
          <button
            type="button"
            class="btn-ghost btn-sm btn-icon"
            on:click={() => { resultPasswordVisible = !resultPasswordVisible; }}
            aria-label={t(dict, 'common.showPassword')}
            aria-pressed={resultPasswordVisible}
            aria-controls="ue-result-pass"
            title={t(dict, resultPasswordVisible ? 'common.hidePassword' : 'common.showPassword')}
          >
            <Icon name={resultPasswordVisible ? 'eye-off' : 'eye'} />
          </button>
        </div>
        <p id="ue-result-pass-note" class="status status--warn">{t(dict, 'tools.ultimateEncrypt.passwordWarning')}</p>
      </div>

      <div class="actions max-sm:flex-col max-sm:items-stretch">
        <CopyButton
          text={resultBlurb}
          label={t(dict, 'tools.ultimateEncrypt.result.copyAll')}
          copiedLabel={t(dict, 'common.copied')}
          errorLabel={t(dict, 'common.uploadChallenge.retry')}
          variant="primary"
        />
        <ShareLinkButton url={shareUrl} label={t(dict, 'common.shareLink')} doneLabel={t(dict, 'common.shared')} errorLabel={t(dict, 'common.uploadChallenge.retry')} />
        {#if qrSvg && shareUrl}
          <button type="button" class="btn-secondary" aria-expanded={qrOpen} aria-controls="ue-qr" on:click={() => (qrOpen = !qrOpen)}>
            <Icon name="qr-code" />
            {qrOpen ? t(dict, 'tools.ultimateEncrypt.hideQr') : t(dict, 'tools.ultimateEncrypt.showQr')}
          </button>
        {/if}
        <button type="button" class="btn-ghost sm:ml-auto" on:click={reset}>{t(dict, 'tools.ultimateEncrypt.encryptAnother')}</button>
      </div>
      {#if qrOpen && qrSvg}
        <div class="ue-qr" id="ue-qr" role="img" aria-label={t(dict, 'tools.ultimateEncrypt.qrAlt')}>{@html qrSvg}</div>
      {/if}

      <details class="more">
        <summary>{t(dict, 'tools.ultimateEncrypt.result.moreTitle')}</summary>
        <div class="more__body">
          <div class="grid gap-2 text-sm leading-snug">
            <p class="font-semibold text-text">{t(dict, 'tools.ultimateEncrypt.result.tellTitle')}</p>
            <ol class="list-decimal space-y-1 pl-5 text-muted">
              <li>{t(dict, 'tools.ultimateEncrypt.result.tell.1')}</li>
              <li>{t(dict, 'tools.ultimateEncrypt.result.tell.2')}</li>
              <li>{t(dict, 'tools.ultimateEncrypt.result.tell.3')}</li>
            </ol>
          </div>
          {#if shortUrl}
            <div class="field">
              <div class="output-head">
                <label class="label" for="ue-result-full">{t(dict, 'tools.ultimateEncrypt.fullLink')}</label>
                <CopyButton text={resultUrl} label={t(dict, 'common.copy')} copiedLabel={t(dict, 'common.copied')} errorLabel={t(dict, 'common.uploadChallenge.retry')} />
              </div>
              <input id="ue-result-full" class="input input--mono" type="text" readonly value={resultUrl} />
            </div>
          {/if}
          {#if dropUrl}
            <div class="field">
              <a href={dropUrl} download={dropName} class="btn-secondary justify-self-start" aria-describedby="ue-drop-hint"><Icon name="download" />{t(dict, 'tools.ultimateEncrypt.offlineDropDownload')}</a>
              <p id="ue-drop-hint" class="hint">{t(dict, 'tools.ultimateEncrypt.offlineDropHint')}</p>
            </div>
          {/if}
          {#if shortenFailed && shortenableUrl && !shortUrl}
            <div class="field">
              <button type="button" class="btn-secondary justify-self-start" aria-busy={shortening} aria-describedby="ue-shorten-status" on:click={shortenLink}>{t(dict, 'tools.ultimateEncrypt.shortenLink')}</button>
              <p id="ue-shorten-status" class="hint" role="status">{shortening ? '' : t(dict, 'tools.ultimateEncrypt.shortenFailed')}</p>
            </div>
          {/if}
        </div>
      </details>
    </div>
  {/if}
</div>
