<script lang="ts">
  import { ListItem, MenuList, MenuListItem, Popover } from 'konsta/svelte';
  import { syncAnswerDelay } from '../../lib/whiteboardSyncElection';
  import { ReplayWindow, safeColor } from "../../lib/roomAccess";
  import { loadAlias, newAlias, parseAlias, aliasWire, aliasKey, aliasName, aliasColor, aliasGradient, gradientFor, type Alias } from "../../lib/alias";
  import { onMount, onDestroy, tick } from 'svelte';
  import PartySocket from 'partysocket';
  import * as Y from 'yjs';
  import { Editor, Store, THEMES, COLOR_IDS, SIZE_IDS, DASH_IDS, FILL_IDS, GEO_IDS, FONTS } from '@quickdrawjs/core';
  import type { Diff, ShapeRecord, AssetRecord, ScribbleStroke, ToolId, GeoId, Styles } from '@quickdrawjs/core';
  import '@quickdrawjs/core/quickdraw.css';
  import { deriveBoardAccess, boardLocalKey, sealLocalBoard, openLocalBoard, bytesToB64, b64ToBytes } from '../../lib/whiteboardCrypto';
  import { validShapeRecord, validAssetRecord, assetBytes, sanitizeScribbles, validBoardChatItem, BOARD_CHAT_MAX_TEXT, BOARD_CHAT_KEEP, BOARD_ASSET_BYTES, type BoardAsset, type BoardChatItem, type UnsignedBoardChatItem } from '../../lib/whiteboardRecords';
  import { encodeBoardImage } from '../../lib/whiteboardImages';
  import { sealEnvelope, openEnvelope, signBoardItem, verifyBoardItem, ConnectionKeys, BoardTrust, type WhiteboardKind, type BoardMember } from '../../lib/whiteboardProtocol';
  import { safetyNumber, keyCode, type SigningIdentity } from '../../lib/chatCrypto';
  import { loadRoomIdentity, loadTrustTable, saveTrustTable } from '../../lib/chatIdentity';
  import { parseMarkdown, revealSpoilers } from '../../lib/chatMarkdown';
  import { parseBurnSuffix, passwordLongEnough } from '../../lib/chatRoomSettings';
  import { DOC_PART_BYTES, splitDocUpdate, DocPartAssembler, encodeBoardBackup, parseBoardBackup, BOARD_BACKUP_MAX_BYTES } from '../../lib/whiteboardSync';
  import { encodeEncryptedBoardBackup, decodeEncryptedBoardBackup } from '../../lib/whiteboardBackupCrypto';
  import { loadLocalBoard, saveLocalBoard, clearLocalBoard } from '../../lib/whiteboardLocalStore';
  import { t } from '../../lib/t';
  import type { IconName } from '../../lib/iconManifest';
  import SaveRoomButton from './SaveRoomButton.svelte';
  import RoomInviteCard from './RoomInviteCard.svelte';
  import { takeRoomKeyFromHash } from '../../lib/roomLinkKey';
  import Icon from '../Icon.svelte';
  import Modal from '../Modal.svelte';
  import Field from '../ui/Field.svelte';
  import PasswordChecklist from '../PasswordChecklist.svelte';
  import { menu } from '../ui/menu';
  import { roving } from '../ui/roving';
  import { focusFirstInvalid } from '../../lib/focusInvalid';
  import ToolStatus from './ToolStatus.svelte';

  export let locale = 'en';
  export let roomId = '';
  export let partyHost = '';
  export let initialPassword = '';
  export let appMode = false;
  export let onExitApp: (() => void) | undefined = undefined;
  export let onPasswordAccepted: ((password: string) => void) | undefined = undefined;
  export let onClearRequest: ((doClear: () => void) => void) | undefined = undefined;
  export let onConnStatus: ((status: 'connected' | 'connecting' | 'loading' | 'offline') => void) | undefined = undefined;
  export let onHaptic: ((type: 'light' | 'medium' | 'success' | 'warning') => void) | undefined = undefined;
  export let requestReconnect = () => {};
  export let onOverlayChange: ((open: boolean) => void) | undefined = undefined;
  export let closeOverlay: () => boolean = () => false;

  export let dict: Record<string, string>;

  let accessToken = "";
  let channelId = "";
  const replay = new ReplayWindow();

  const DOC_FLUSH_MS = 100;
  const CURSOR_SYNC_INTERVAL_MS = 160;
  const CURSOR_MIN_MOVE = 4;
  const HEARTBEAT_INTERVAL_MS = 45000;
  // The whiteboard relay closes sockets above 300 messages or 3 MB per 10 s; stay under that with headroom.
  const RATE_WINDOW_MS = 10000;
  const RATE_MAX_MESSAGES = 240;
  const RATE_MAX_BYTES = 2_400_000;
  const RATE_DOC_HEADROOM = 400_000;
  const RATE_OPTIONAL_SHARE = 0.6;
  const LOCAL_ORIGIN = 'local';
  const IMPORT_ORIGIN = 'import';
  const RESTORE_ORIGIN = 'local-restore';
  const LOCAL_PERSIST_MS = 800;
  const NOTICE_MS = 6000;

  const TOOL_ICONS: Record<Exclude<ToolId, 'geo'>, IconName> = {
    select: 'mouse-pointer-2',
    hand: 'hand',
    draw: 'pencil',
    highlight: 'highlighter',
    eraser: 'eraser',
    laser: 'laser',
    arrow: 'arrow-up-right',
    line: 'slash',
    text: 'type',
    note: 'sticky-note',
  };
  const GEO_ICONS: Partial<Record<GeoId, IconName>> = {
    rectangle: 'square',
    ellipse: 'circle',
    star: 'star',
    diamond: 'diamond',
    hexagon: 'hexagon',
    triangle: 'triangle',
    cloud: 'cloud',
  };
  const DASH_ICONS: Record<(typeof DASH_IDS)[number], IconName> = { draw: 'spline', solid: 'minus', dashed: 'minus', dotted: 'minus' };
  const FILL_ICONS: Record<(typeof FILL_IDS)[number], IconName> = { none: 'square', semi: 'square', solid: 'square', pattern: 'square-dashed' };

  const TOOLS: { id: ToolId; key: string }[] = [
    { id: 'select', key: 'V' },
    { id: 'hand', key: 'H' },
    { id: 'draw', key: 'D' },
    { id: 'highlight', key: 'I' },
    { id: 'eraser', key: 'E' },
    { id: 'laser', key: 'K' },
    { id: 'arrow', key: 'A' },
    { id: 'line', key: 'L' },
    { id: 'geo', key: 'G' },
    { id: 'text', key: 'T' },
    { id: 'note', key: 'N' },
  ];
  const GEO_KEYS: Partial<Record<GeoId, string>> = { rectangle: 'R', ellipse: 'O' };

  let ws: PartySocket | null = null;
  let cryptoKey: CryptoKey | null = null;
  const alias: Alias = typeof localStorage === 'undefined' ? newAlias() : loadAlias(roomId);
  const identity = { name: aliasName(dict, alias), color: aliasColor(alias), key: aliasKey(alias) };

  // Every payload is signed, so a sender is named only by a validated alias; free-form names and colors would let a member pass as someone else.
  function senderInfo(p: any) {
    const al = parseAlias(p?.alias) ?? undefined;
    const name = al ? aliasName(dict, al) : t(dict, 'whiteboard.guest');
    return { name, color: al ? aliasColor(al) : safeColor(undefined), alias: al, key: al ? aliasKey(al) : 'guest' };
  }

  let boardKey: SigningIdentity | null = null;
  let myPk = '';
  let myKeyCode = '';
  let trust: BoardTrust | null = null;
  const connectionKeys = new ConnectionKeys();
  let memberList: BoardMember[] = [];
  let memberCodes: Record<string, { code: string; safety: string }> = {};
  let peopleOpen = false;
  let canCreate = false;
  let boardMissing = false;
  let roomFull = false;
  let localKey: CryptoKey | null = null;
  let localRestored = false;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let persistEpoch = 0;

  let connected = false;
  let netOffline = false;
  let lastConnStatus = '';
  function reportConn() {
    const st = netOffline
      ? 'offline'
      : connected || needsPassword
        ? 'connected'
        : (cryptoKey && !verifying)
          ? 'connecting'
          : 'loading';
    if (st !== lastConnStatus) { lastConnStatus = st; onConnStatus?.(st); }
  }
  $: if (connected !== undefined || netOffline !== undefined || cryptoKey || needsPassword || verifying) reportConn();
  requestReconnect = () => {
    try { ws?.reconnect(); } catch {}
  };
  const onNetChange = () => {
    const was = netOffline;
    netOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    if (was && !netOffline) try { ws?.reconnect(); } catch {}
    reportConn();
  };
  let verified = false;
  let verifying = false;
  let needsPassword = false;
  let passwordInput = '';
  let passwordError = '';
  $: if (passwordError === t(dict, 'whiteboard.errorEnterPassword') && passwordInput.trim()) passwordError = '';
  let passwordEl: HTMLInputElement | undefined;
  let serverPresence = 0;

  let onlineUsers: { id: string; name: string; color: string; alias?: Alias; pk: string; warn: boolean }[] = [];
  let myConnId = '';

  let sharePassword = '';
  let shareDismissed = false;
  let shareOpen = true;
  let backupOpen = false;
  let clearConfirmOpen = false;
  let pendingClear: (() => void) | null = null;
  let clearConfirmed = false;
  let backupMode: 'export' | 'import' = 'export';
  let backupPassword = '';
  let backupPasswordConfirm = '';
  let backupError = '';
  let backupAttempted = false;
  let backupWrongPassword = false;
  $: backupPasswordError = !backupAttempted ? '' : !backupPassword.trim() ? t(dict, 'whiteboard.encryptedPasswordRequired') : backupWrongPassword ? t(dict, 'whiteboard.encryptedWrongPassword') : '';
  $: backupConfirmError = backupAttempted && backupMode === 'export' && backupPassword.trim() !== backupPasswordConfirm.trim() ? t(dict, 'whiteboard.encryptedPasswordMismatch') : '';
  $: backupRules = [{ ok: !!backupPasswordConfirm.trim() && backupPassword.trim() === backupPasswordConfirm.trim(), label: t(dict, 'common.passwordRuleMatch') }];
  let backupFieldsEl: HTMLElement | undefined;
  let backupBusy = false;
  let pendingEncryptedImport = '';
  let encryptedImportInput: HTMLInputElement;

  let ydoc: Y.Doc;
  let yrecords: Y.Map<ShapeRecord>;
  let yassets: Y.Map<BoardAsset>;
  let ychat: Y.Array<BoardChatItem>;

  type ChatView = { id: string; html: string; name: string; color: string; mine: boolean; at: number; expiresAt?: number; pk: string; warn: boolean };
  let chatOpen = false;
  let chatInput = '';
  let chatSaved: ChatView[] = [];
  let chatBurning: ChatView[] = [];
  let chatUnread = 0;
  let chatNow = Date.now();
  let chatListEl: HTMLElement;
  let chatInputEl: HTMLInputElement;
  const store = new Store();
  let editor: Editor | null = null;
  let pendingFit = false;

  let tool: ToolId = 'draw';
  let geoKind: GeoId = 'rectangle';
  let styles: Partial<Record<keyof Styles, string | null>> = {};
  let selectionSize = 0;
  let canUndo = false;
  let canRedo = false;
  let zoom = 1;
  let camTick = 0;
  let gridOn = true;
  let shapeCount = 0;
  let themeId: 'light' | 'dark' = 'light';
  let styleOpen = false;
  let menuOpen = false;
  $: if (appMode) onOverlayChange?.(menuOpen || styleOpen);
  closeOverlay = () => {
    if (menuOpen) { menuOpen = false; return true; }
    if (styleOpen) { styleOpen = false; return true; }
    return false;
  };
  let wbMenuEl: HTMLButtonElement | undefined = undefined;
  let isFullscreen = false;
  let fullscreenSupported = false;
  let rootEl: HTMLDivElement;
  let importInput: HTMLInputElement;
  let imageInput: HTMLInputElement;
  let notice: { text: string; error: boolean } | null = null;
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;

  type Cursor = { id: string; x: number; y: number; name: string; color: string; alias?: Alias; pk: string; warn: boolean; lastSeen: number };
  let cursors: Cursor[] = [];
  const remoteScribbles = new Map<string, { list: ScribbleStroke[]; at: number }>();
  let lastCursorSent = 0;
  let lastCursorX = -1e9;
  let lastCursorY = -1e9;
  let lastPointer: { x: number; y: number } | null = null;
  let laserTimer: ReturnType<typeof setTimeout> | null = null;
  let pageHidden = false;

  let roomLocked = false;

  function genId(): string {
    const arr = crypto.getRandomValues(new Uint8Array(8));
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  }

  async function initRoom() {
    if (typeof window === 'undefined') return;
    if (initialPassword.trim()) {
      passwordInput = initialPassword.trim();
      await enterWithPassword(initialPassword.trim());
      return;
    }
    const stored = sessionStorage.getItem('whiteboard-password');
    const sharePass = sessionStorage.getItem('whiteboard-share-password');
    if (sharePass) {
      sharePassword = sharePass;
      sessionStorage.removeItem('whiteboard-share-password');
    }
    const remembered = stored || takeRoomKeyFromHash() || sessionStorage.getItem(`wb-pw:${roomId}`);
    if (stored) sessionStorage.removeItem('whiteboard-password');
    if (remembered) {
      passwordInput = remembered;
      await enterWithPassword(remembered);
    } else {
      needsPassword = true;
    }
  }

  async function submitPassword() {
    passwordError = '';
    if (!passwordInput.trim()) {
      passwordError = t(dict, 'whiteboard.errorEnterPassword');
      await tick();
      passwordEl?.focus();
      return;
    }
    await enterWithPassword(passwordInput.trim());
  }

  async function setupIdentity() {
    if (boardKey) return;
    boardKey = await loadRoomIdentity(`whiteboard:${roomId}`);
    myPk = boardKey.publicKey;
    const trustRoom = `whiteboard:${roomId}`;
    trust = new BoardTrust(loadTrustTable(trustRoom), { pk: myPk, key: identity.key, name: identity.name }, (table) => saveTrustTable(trustRoom, table), onTrustChange);
    myKeyCode = await keyCode(myPk);
  }

  let acceptedPassword = '';
  let reportedPassword = '';
  let passwordConfirmed = false;
  $: if (verified && passwordConfirmed && acceptedPassword && acceptedPassword !== reportedPassword) {
    reportedPassword = acceptedPassword;
    onPasswordAccepted?.(acceptedPassword);
  }

  async function enterWithPassword(pwd: string) {
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
    persistEpoch++;
    try {
      const access = await deriveBoardAccess(pwd, roomId);
      accessToken = access.token; channelId = access.channel;
      cryptoKey = access.key;
      localKey = await boardLocalKey(access.key);
      await setupIdentity();
      canCreate = passwordLongEnough(pwd);
      boardMissing = false;
      needsPassword = false;
      acceptedPassword = pwd;
      try { sessionStorage.setItem(`wb-pw:${roomId}`, pwd); } catch {}
      localRestored = false;
      setupYjs();
      await restoreLocalBoard();
      connectWs();
    } catch {
      passwordError = t(dict, 'whiteboard.errorDeriveKey');
      needsPassword = true;
    }
  }

  function boardHasContent(): boolean {
    return !!(ydoc && (store.size || ychat?.length));
  }

  async function restoreLocalBoard() {
    if (!localKey || !channelId || !ydoc || localRestored) return;
    localRestored = true;
    const record = await loadLocalBoard(channelId);
    if (!record) return;
    const update = await openLocalBoard(localKey, channelId, record.sealed);
    if (!update || update.length > BOARD_BACKUP_MAX_BYTES) return;
    try {
      Y.applyUpdate(ydoc, update, RESTORE_ORIGIN);
      if (boardHasContent()) pendingFit = true;
    } catch {}
  }

  let persistingLocal = false;
  let persistAgain = false;

  function scheduleLocalPersist() {
    if (!localKey || !channelId || !ydoc) return;
    if (persistingLocal) {
      persistAgain = true;
      return;
    }
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => { void persistLocalBoard(); }, LOCAL_PERSIST_MS);
  }

  /** Snapshot bytes for IDB. Never deletes an existing snapshot — empty boards just skip the write (explicit clear calls clearLocalBoard). */
  function captureLocalUpdate(): Uint8Array | null {
    if (!localKey || !channelId || !ydoc) return null;
    flushToDoc(true);
    if (!boardHasContent()) return null;
    const update = Y.encodeStateAsUpdate(ydoc);
    if (!update.length || update.length > BOARD_BACKUP_MAX_BYTES) return null;
    return update;
  }

  async function persistLocalBoard() {
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
    if (persistingLocal || !localKey || !channelId || !ydoc) return;
    const epoch = ++persistEpoch;
    const key = localKey;
    const channel = channelId;
    const update = captureLocalUpdate();
    if (!update) return;
    persistingLocal = true;
    persistAgain = false;
    try {
      const sealed = await sealLocalBoard(key, channel, update);
      if (epoch !== persistEpoch) return;
      await saveLocalBoard(channel, sealed);
    } catch {
    } finally {
      persistingLocal = false;
      if (persistAgain) {
        persistAgain = false;
        scheduleLocalPersist();
      }
    }
  }

  /** Sync encode before teardown so leave/Back cannot race ydoc.destroy() or wipe IDB. */
  function flushLocalBoardOnLeave() {
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
    persistEpoch++;
    try {
      const key = localKey;
      const channel = channelId;
      const update = captureLocalUpdate();
      if (!key || !channel || !update) return;
      void sealLocalBoard(key, channel, update).then((sealed) => saveLocalBoard(channel, sealed));
    } catch {}
  }

  const sentLog: { at: number; bytes: number }[] = [];

  function rateUsage() {
    const cutoff = Date.now() - RATE_WINDOW_MS;
    while (sentLog.length && sentLog[0].at < cutoff) sentLog.shift();
    let bytes = 0;
    for (const s of sentLog) bytes += s.bytes;
    return { count: sentLog.length, bytes };
  }

  function socketSend(message: string, essential = false): boolean {
    if (!ws || ws.readyState !== 1) return false;
    if (!essential) {
      const use = rateUsage();
      if (use.count + 1 > RATE_MAX_MESSAGES * RATE_OPTIONAL_SHARE || use.bytes + message.length > RATE_MAX_BYTES * RATE_OPTIONAL_SHARE) return false;
    }
    sentLog.push({ at: Date.now(), bytes: message.length });
    try { ws.send(message); return true; } catch { return false; }
  }

  const dirty = new Set<string>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleFlush(delay = DOC_FLUSH_MS) {
    if (!flushTimer) flushTimer = setTimeout(flushToDoc, delay);
  }

  function flushToDoc(force = false) {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (!dirty.size || !ydoc) return;
    const use = rateUsage();
    if (!force && (use.count + 8 > RATE_MAX_MESSAGES || use.bytes + RATE_DOC_HEADROOM > RATE_MAX_BYTES)) {
      scheduleFlush(500);
      return;
    }
    const refused = new Set<string>();
    ydoc.transact(() => {
      for (const id of dirty) {
        const rec = store.get(id);
        if (rec && rec.typeName === 'shape') {
          if (rec.type === 'image' && !shareAsset(rec.props.assetId, refused)) continue;
          yrecords.set(id, rec);
        } else if (!rec) {
          const old = yrecords.get(id);
          if (old) {
            yrecords.delete(id);
            if (old.type === 'image') releaseAsset(old.props.assetId);
          } else if (yassets.has(id)) {
            yassets.delete(id);
          }
        }
      }
    }, LOCAL_ORIGIN);
    dirty.clear();
    if (refused.size) dropRefusedImages(refused);
  }

  function boardAssetBytes(): number {
    let total = 0;
    for (const a of yassets.values()) total += assetBytes(a.data);
    return total;
  }

  function toAssetRecord(id: string, a: BoardAsset): AssetRecord {
    return { id, typeName: 'asset', src: `data:${a.mime};base64,${a.data}`, w: a.width, h: a.height };
  }

  function fromAssetRecord(rec: AssetRecord): BoardAsset | null {
    const match = /^data:(image\/[a-z]+);base64,(.+)$/.exec(rec.src);
    return match ? { mime: match[1], width: rec.w, height: rec.h, data: match[2] } : null;
  }

  function shareAsset(assetId: unknown, refused: Set<string>): boolean {
    if (typeof assetId !== 'string' || refused.has(assetId)) return false;
    if (yassets.has(assetId)) return true;
    const rec = store.asset(assetId);
    if (!rec) return true;
    const asset = fromAssetRecord(rec);
    if (!asset || !validAssetRecord(asset, assetId) || boardAssetBytes() + assetBytes(asset.data) > BOARD_ASSET_BYTES) {
      refused.add(assetId);
      return false;
    }
    yassets.set(assetId, asset);
    return true;
  }

  function releaseAsset(assetId: unknown) {
    if (typeof assetId !== 'string' || !yassets.has(assetId)) return;
    for (const r of yrecords.values()) if (r.type === 'image' && r.props.assetId === assetId) return;
    yassets.delete(assetId);
  }

  function boardFullNotice() {
    showNotice(t(dict, 'whiteboard.imageBoardFull').replace('{size}', String(BOARD_ASSET_BYTES / 1024 / 1024)));
  }

  function dropRefusedImages(refused: Set<string>) {
    const ids = store.shapes().filter((s) => s.type === 'image' && refused.has(s.props.assetId)).map((s) => s.id);
    store.remove([...ids, ...refused], 'remote');
    boardFullNotice();
  }

  async function insertImages(blobs: Blob[], at?: { x: number; y: number }) {
    const images = blobs.filter((b) => b.type.startsWith('image/'));
    if (!editor || !ydoc || !images.length) return;
    const placed: string[] = [];
    for (const blob of images) {
      let asset: BoardAsset;
      try {
        asset = await encodeBoardImage(blob);
      } catch {
        showNotice(t(dict, 'whiteboard.imageUnreadable'));
        continue;
      }
      if (!editor) return;
      if (boardAssetBytes() + assetBytes(asset.data) > BOARD_ASSET_BYTES) {
        boardFullNotice();
        break;
      }
      const vp = editor.viewportPageBounds();
      const scale = Math.min(1, (vp.w * 0.6) / asset.width, (vp.h * 0.6) / asset.height);
      const w = Math.max(8, asset.width * scale);
      const h = Math.max(8, asset.height * scale);
      const cx = at ? at.x : vp.x + vp.w / 2;
      const cy = at ? at.y : vp.y + vp.h / 2;
      const stamp = genId();
      const assetId = `asset:${stamp}`;
      const shapeId = `shape:${stamp}`;
      store.transact(() => {
        store.put(toAssetRecord(assetId, asset));
        store.put({ id: shapeId, typeName: 'shape', type: 'image', x: cx - w / 2, y: cy - h / 2, rot: 0, z: store.maxZ() + 1, props: { w, h, assetId } });
      });
      flushToDoc(true);
      if (store.get(shapeId)) placed.push(shapeId);
      if (at) at = { x: at.x + 24, y: at.y + 24 };
    }
    if (placed.length && editor) {
      editor.setTool('select');
      editor.setSelection(placed);
    }
  }

  function chooseImage() {
    imageInput?.click();
  }

  function onImagePicked() {
    const files = imageInput?.files ? [...imageInput.files] : [];
    if (imageInput) imageInput.value = '';
    void insertImages(files);
  }

  function setupYjs() {
    ydoc = new Y.Doc();
    yrecords = ydoc.getMap('records');
    yassets = ydoc.getMap('assets');
    ychat = ydoc.getArray('chat');
    ychat.observe((_event, tr) => {
      void refreshSavedChat(tr.origin !== LOCAL_ORIGIN && tr.origin !== RESTORE_ORIGIN);
    });

    store.listen((diff: Diff) => {
      for (const id of Object.keys(diff.added)) dirty.add(id);
      for (const id of Object.keys(diff.updated)) dirty.add(id);
      for (const id of Object.keys(diff.removed)) dirty.add(id);
      scheduleFlush();
    }, { source: 'user' });

    yrecords.observe((event, tr) => {
      if (tr.origin === LOCAL_ORIGIN) return;
      const wasEmpty = store.shapes().length === 0;
      const diff: Diff = { added: {}, removed: {}, updated: {} };
      event.changes.keys.forEach((change, key) => {
        if (change.action === 'delete') {
          const cur = store.get(key);
          if (cur) diff.removed[key] = cur;
          return;
        }
        const rec = yrecords.get(key);
        if (validShapeRecord(rec, key)) diff.added[key] = rec;
      });
      store.applyDiff(diff, 'remote');
      if (wasEmpty && Object.keys(diff.added).length) {
        if (editor) editor.fitContent({ animate: 200 });
        else pendingFit = true;
      }
    });

    yassets.observe((event, tr) => {
      if (tr.origin === LOCAL_ORIGIN) return;
      const diff: Diff = { added: {}, removed: {}, updated: {} };
      event.changes.keys.forEach((change, key) => {
        if (change.action === 'delete') {
          const cur = store.asset(key);
          if (cur && !store.shapes().some((s) => s.type === 'image' && s.props.assetId === key)) diff.removed[key] = cur;
          return;
        }
        const asset = yassets.get(key);
        if (!store.asset(key) && validAssetRecord(asset, key)) diff.added[key] = toAssetRecord(key, asset);
      });
      store.applyDiff(diff, 'remote');
    });

    ydoc.on('update', (update: Uint8Array, origin: any) => {
      if (origin !== 'remote' && origin !== RESTORE_ORIGIN) queueDocUpdate(update);
      if (origin !== RESTORE_ORIGIN) scheduleLocalPersist();
    });
  }

  let docQueue: Promise<void> = Promise.resolve();
  const assembler = new DocPartAssembler();
  let syncProgress: { received: number; total: number } | null = null;

  function queueDocUpdate(update: Uint8Array, to?: string) {
    docQueue = docQueue.then(() => sendDocUpdate(update, to)).catch(() => {});
  }

  async function waitForBudget(bytes: number) {
    for (;;) {
      if (!ws) return;
      const use = rateUsage();
      if (use.count + 1 <= RATE_MAX_MESSAGES && use.bytes + bytes <= RATE_MAX_BYTES) return;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }

  function seal(kind: WhiteboardKind, body: Record<string, unknown>): Promise<string> | null {
    return cryptoKey && boardKey ? sealEnvelope(cryptoKey, boardKey, kind, body, channelId) : null;
  }

  // Parts are stamped only once the rate budget allows sending them, so a long sync never goes out with a stale stamp.
  async function sendDocEnvelope(kind: 'doc' | 'doc-part', bytes: Uint8Array, to?: string, id = genId()) {
    await waitForBudget(Math.ceil(bytes.length * 16 / 9) + 1024);
    const payload = await seal(kind, { data: bytesToB64(bytes) });
    if (!payload) return;
    const message = JSON.stringify(to
      ? { type: 'envelope-to', to, kind, payload, id }
      : { type: 'envelope', kind, payload, id });
    socketSend(message, true);
  }

  function docParts(update: Uint8Array): Uint8Array[] | null {
    return update.length <= DOC_PART_BYTES ? [update] : splitDocUpdate(update);
  }

  async function sendDocUpdate(update: Uint8Array, to?: string) {
    if (!cryptoKey || !ws || !verified) return;
    const parts = docParts(update);
    if (!parts) return;
    const kind = parts.length === 1 ? 'doc' : 'doc-part';
    for (const part of parts) await sendDocEnvelope(kind, part, to);
  }

  function roomLink(): string {
    if (typeof window === 'undefined') return '';
    return location.href;
  }

  function scheduleSyncAnswer(newcomer: string) {
    const delay = syncAnswerDelay(myConnId, newcomer, onlineUsers.map(u => u.id), !!(store.size || ychat.length));
    if (delay === null) return;
    const send = () => {
      if (!ws || !verified || !ydoc) return;
      flushToDoc();
      queueDocUpdate(Y.encodeStateAsUpdate(ydoc), newcomer);
    };
    if (delay === 0) send();
    else setTimeout(send, delay);
  }

  let heartbeatInterval: ReturnType<typeof setInterval> | undefined;

  function connectWs() {
    verifying = true;
    ws = new PartySocket({
      host: partyHost || window.location.host,
      room: channelId,
      party: 'whiteboard',
      minReconnectionDelay: 500,
      maxReconnectionDelay: 8000,
      reconnectionDelayGrowFactor: 1.4,
      connectionTimeout: 8000,
      maxRetries: Infinity,
    });

    ws.addEventListener('open', async () => {
      connected = true;
      const rejoin = verified;
      socketSend(JSON.stringify({ type: 'join', token: accessToken }), true);
      const verifyPayload = await seal('verify', { alias: aliasWire(alias) });
      if (verifyPayload) socketSend(JSON.stringify({ type: 'envelope', kind: 'verify', payload: verifyPayload, id: 'verify-' + genId() }), true);
      if (rejoin && ydoc && (store.size || ychat.length)) queueDocUpdate(Y.encodeStateAsUpdate(ydoc));
    });

    ws.addEventListener('close', (event) => {
      if (event.code === 4008 && event.reason === 'ROOM_FULL') {
        roomFull = true;
        verifying = false;
        try { ws?.close(); } catch {}
      }
      connected = false;
    });

    ws.addEventListener('error', () => {});

    ws.addEventListener('message', handleServerMessage);

    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
      if (pageHidden) return;
      socketSend('{"type":"ping"}');
    }, HEARTBEAT_INTERVAL_MS);
  }

  async function handleServerMessage(event: MessageEvent) {
    let data: any;
    try { data = JSON.parse(event.data); } catch { return; }

    if (data.type === 'init') {
      myConnId = data.connId || '';
      serverPresence = data.presence;
      roomLocked = !!data.locked;
      if (verifying && serverPresence <= 1) {
        if (!canCreate && !boardHasContent()) {
          verifying = false;
          boardMissing = true;
          needsPassword = true;
          ws?.close();
          return;
        }
        if (sharePassword || boardHasContent()) passwordConfirmed = true;
        verified = true;
        verifying = false;
      } else if (verifying && serverPresence > 1) {
        setTimeout(() => {
          if (verifying && !verified) {
            verified = true;
            verifying = false;
          }
        }, 4000);
      }
      return;
    }
    if (data.type === 'presence') { serverPresence = data.count; return; }
    if (data.type === 'locked') { roomLocked = true; return; }
    if (data.type === 'unlocked') { roomLocked = false; return; }
    if (data.type === 'peer-leave') {
      onlineUsers = onlineUsers.filter(u => u.id !== data.id);
      cursors = cursors.filter(c => c.id !== data.id);
      assembler.drop(data.id);
      if (remoteScribbles.delete(data.id)) pushRemoteScribbles();
      return;
    }
    if (data.type !== 'envelope') return;
    if (!cryptoKey || !trust) return;
    if (typeof data.payload !== 'string' || data.payload.length > 720000 || typeof data.from !== 'string' || !data.from) return;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data.payload));
    if (!replay.accept(Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join(''))) return;

    const opened = await openEnvelope(cryptoKey, data.payload, data.kind, channelId);
    if (!opened || !replay.accept(opened.body._id as string) || !connectionKeys.bind(data.from, opened.signer)) return;
    const { body, signer } = opened;
    const from: string = data.from;
    passwordConfirmed = true;
    if (verifying) { verified = true; verifying = false; }

    try {
      if (data.kind === 'cursor') {
        const who = senderInfo(body);
        const warn = !trust.note(signer, who.key, who.name);
        if (Number.isFinite(body.x) && Number.isFinite(body.y)) upsertCursor(from, body.x as number, body.y as number, who, signer, warn);
        if ('laser' in body) {
          remoteScribbles.set(from, { list: sanitizeScribbles(body.laser), at: Date.now() });
          pushRemoteScribbles();
        }
        return;
      }

      if (data.kind === 'doc') {
        Y.applyUpdate(ydoc, b64ToBytes(body.data as string), 'remote');
        return;
      }

      if (data.kind === 'chat') {
        const item = body.item;
        if (!validBoardChatItem(item) || !item.ttl || item._pk !== signer || chatBurning.some((m) => m.id === item.id)) return;
        if (await verifyBoardItem(item, channelId) !== signer) return;
        chatBurning = [...chatBurning, { ...toChatView(item, signer), expiresAt: Date.now() + item.ttl * 1000 }];
        noteIncomingChat(1);
        return;
      }

      if (data.kind === 'doc-part') {
        const result = assembler.accept(from, b64ToBytes(body.data as string));
        if (!result) return;
        syncProgress = result.update ? null : { received: result.received, total: result.total };
        if (result.update) Y.applyUpdate(ydoc, result.update, 'remote');
        return;
      }

      if (data.kind === 'verify') {
        const who = senderInfo(body);
        addOnlineUser(from, who, signer, !trust.note(signer, who.key, who.name));
        if (verified && ws) {
          const ack = await seal('verify-ack', { alias: aliasWire(alias) });
          if (ack) socketSend(JSON.stringify({ type: 'envelope', kind: 'verify-ack', payload: ack, id: 'vack-' + genId() }), true);
          scheduleSyncAnswer(from);
        }
        return;
      }

      if (data.kind === 'verify-ack') {
        const who = senderInfo(body);
        addOnlineUser(from, who, signer, !trust.note(signer, who.key, who.name));
        return;
      }
    } catch {}
  }

  type Who = { name: string; color: string; alias?: Alias; key: string };

  function addOnlineUser(id: string, who: Who, pk: string, warn: boolean) {
    const user = { id, name: who.name, color: who.color, alias: who.alias, pk, warn };
    onlineUsers = [...onlineUsers.filter(u => u.id !== id && u.pk !== pk), user];
  }

  function upsertCursor(id: string, x: number, y: number, who: Who, pk: string, warn: boolean) {
    const next: Cursor = { id, x, y, name: who.name, color: who.color, alias: who.alias, pk, warn, lastSeen: Date.now() };
    const idx = cursors.findIndex(c => c.id === id);
    if (idx >= 0) {
      cursors[idx] = next;
      cursors = cursors;
    } else {
      cursors = [...cursors, next];
    }
  }

  function onTrustChange() {
    if (!trust) return;
    memberList = [...trust.members.values()];
    for (const m of memberList) {
      if (memberCodes[m.pk]) continue;
      memberCodes[m.pk] = { code: '', safety: '' };
      void Promise.all([keyCode(m.pk), safetyNumber(myPk, m.pk)]).then(([code, safety]) => {
        memberCodes = { ...memberCodes, [m.pk]: { code, safety } };
      });
    }
  }

  function trustMember(pk: string) {
    if (!trust?.accept(pk)) return;
    const clear = <T extends { pk: string; warn: boolean }>(list: T[]) => list.map((x) => x.pk === pk ? { ...x, warn: false } : x);
    chatSaved = clear(chatSaved);
    chatBurning = clear(chatBurning);
    cursors = clear(cursors);
    onlineUsers = clear(onlineUsers);
  }

  function memberAlias(member: BoardMember): Alias | undefined {
    return parseAlias(member.key.split('-').map(Number)) ?? undefined;
  }

  $: keyWarnings = memberList.filter((m) => !m.trusted).length;

  function pushRemoteScribbles() {
    if (!editor) return;
    const cutoff = Date.now() - 2500;
    const all: ScribbleStroke[] = [];
    for (const [id, entry] of remoteScribbles) {
      if (entry.at < cutoff) remoteScribbles.delete(id);
      else all.push(...entry.list);
    }
    editor.setRemoteScribbles(all);
  }

  function toggleLock() {
    socketSend(JSON.stringify({ type: roomLocked ? 'unlock' : 'lock' }), true);
  }

  function peersPresent() {
    return verified && !!cryptoKey && connected && serverPresence > 1 && !pageHidden;
  }

  async function sendCursor(x: number, y: number, laser?: ScribbleStroke[]) {
    if (!ws) return;
    try {
      const body: Record<string, unknown> = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, alias: aliasWire(alias) };
      if (laser) body.laser = laser;
      const payload = await seal('cursor', body);
      if (!payload || !socketSend(JSON.stringify({ type: 'envelope', kind: 'cursor', payload, id: 'c-' + genId() }))) return;
      lastCursorSent = Date.now();
      lastCursorX = x;
      lastCursorY = y;
    } catch {}
  }

  function onBoardPointerMove(e: PointerEvent) {
    if (!editor) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const p = editor.screenToPage(e.clientX - r.left, e.clientY - r.top);
    lastPointer = p;
    if (!peersPresent() || editor.tool === 'laser') return;
    if (Date.now() - lastCursorSent < CURSOR_SYNC_INTERVAL_MS) return;
    if (Math.hypot(p.x - lastCursorX, p.y - lastCursorY) * editor.camera.z < CURSOR_MIN_MOVE) return;
    sendCursor(p.x, p.y);
  }

  function onScribbles() {
    if (!editor || !peersPresent() || laserTimer) return;
    const wait = Math.max(0, CURSOR_SYNC_INTERVAL_MS - (Date.now() - lastCursorSent));
    laserTimer = setTimeout(() => {
      laserTimer = null;
      if (!editor) return;
      const p = lastPointer ?? { x: lastCursorX, y: lastCursorY };
      sendCursor(p.x, p.y, sanitizeScribbles(editor.getScribbles()));
    }, wait);
  }

  function isDarkTheme() {
    return document.documentElement.classList.contains('dark');
  }

  function cssColor(value: string): string {
    const probe = document.createElement('span');
    probe.style.cssText = `position: fixed; visibility: hidden; pointer-events: none; color: ${value}`;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  }

  function syncBoardTheme() {
    themeId = isDarkTheme() ? 'dark' : 'light';
    const theme = THEMES[themeId];
    const ink = (share: number) => cssColor(`color-mix(in srgb, var(--text) ${share}%, transparent)`);
    theme.background = cssColor(appMode ? 'var(--app-bg, var(--bg))' : 'var(--bg)');
    theme.grid.dot = { minor: ink(18), major: ink(32) };
    theme.grid.line = { minor: ink(7), major: ink(14) };
  }

  function stageHeight(node: HTMLElement) {
    const ro = new ResizeObserver(() => node.style.setProperty('--wb-stage-h', `${node.clientHeight}px`));
    ro.observe(node);
    return { destroy: () => ro.disconnect() };
  }

  function scrollEdges(node: HTMLElement) {
    const update = () => {
      node.classList.toggle('wb-track--right', node.scrollLeft + node.clientWidth < node.scrollWidth - 2);
      node.classList.toggle('wb-track--left', node.scrollLeft > 2);
    };
    node.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(node);
    update();
    return {
      destroy() {
        node.removeEventListener('scroll', update);
        ro.disconnect();
      },
    };
  }

  function syncUi() {
    if (!editor) return;
    tool = editor.tool;
    geoKind = editor.geoKind;
    styles = editor.currentStyles();
    selectionSize = editor.selection.size;
    canUndo = store.canUndo;
    canRedo = store.canRedo;
    gridOn = editor.grid !== 'none';
    zoom = editor.camera.z;
  }

  function onBoardKeydown(e: KeyboardEvent) {
    if (!editor || editor.editing || e.defaultPrevented) return;
    const meta = e.ctrlKey || e.metaKey;
    if (meta && e.key.toLowerCase() === 'y') { e.preventDefault(); store.redo(); return; }
    if (meta || e.altKey) return;
    if (!editor.selection.size && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const d = e.shiftKey ? 240 : 60;
      editor.pan(e.key === 'ArrowLeft' ? d : e.key === 'ArrowRight' ? -d : 0, e.key === 'ArrowUp' ? d : e.key === 'ArrowDown' ? -d : 0);
      return;
    }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1.25); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(0.8); }
  }

  function blockFileDrop(e: DragEvent) {
    if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
  }

  function onBoardWheel(e: WheelEvent) {
    if (!editor || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    e.stopPropagation();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
    const delta = Math.max(-50, Math.min(50, e.deltaY * unit));
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    editor.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-delta * 0.005));
  }

  function blockMiddleClick(e: MouseEvent) {
    if (e.button === 1) e.preventDefault();
  }

  function board(node: HTMLDivElement) {
    syncBoardTheme();
    const ed = new Editor({ container: node, store, theme: themeId, grid: 'dots' });
    node.dataset.qdTheme = themeId;
    ed.importImageBlobs = insertImages;
    ed.pickImage = chooseImage;
    ed.setTool(tool);
    editor = ed;
    const offs = [
      ed.on('tool', syncUi),
      ed.on('styles', syncUi),
      ed.on('selection', syncUi),
      ed.on('history', syncUi),
      ed.on('grid', syncUi),
      ed.on('change', () => { shapeCount = store.shapes().length; syncUi(); }),
      ed.on('camera', () => { zoom = ed.camera.z; camTick++; }),
      ed.on('scribbles', onScribbles),
    ];
    node.addEventListener('pointermove', onBoardPointerMove);
    node.addEventListener('keydown', onBoardKeydown);
    node.addEventListener('drop', blockFileDrop);
    node.addEventListener('wheel', onBoardWheel, { capture: true, passive: false });
    node.addEventListener('mousedown', blockMiddleClick);
    node.addEventListener('auxclick', blockMiddleClick);
    shapeCount = store.shapes().length;
    syncUi();
    if (pendingFit || store.size) { pendingFit = false; ed.fitContent(); }
    return {
      destroy() {
        offs.forEach(off => off());
        node.removeEventListener('pointermove', onBoardPointerMove);
        node.removeEventListener('keydown', onBoardKeydown);
        node.removeEventListener('drop', blockFileDrop);
        node.removeEventListener('wheel', onBoardWheel, { capture: true });
        node.removeEventListener('mousedown', blockMiddleClick);
        node.removeEventListener('auxclick', blockMiddleClick);
        ed.destroy();
        if (editor === ed) editor = null;
      },
    };
  }

  function pickTool(id: ToolId) {
    editor?.setTool(id);
    styleOpen = false;
  }

  function pickGeo(kind: GeoId) {
    if (!editor) return;
    editor.setGeoKind(kind);
    editor.setTool('geo');
  }

  function setStyle<K extends keyof Styles>(key: K, value: Styles[K]) {
    editor?.setStyle(key, value);
  }

  function zoomBy(mult: number) {
    if (!editor) return;
    const { w, h } = editor.viewSize();
    editor.zoomAt(w / 2, h / 2, mult, { animate: 140 });
  }

  function zoomReset() {
    if (!editor) return;
    const { w, h } = editor.viewSize();
    editor.zoomAt(w / 2, h / 2, 1 / editor.camera.z, { animate: 180 });
  }

  function zoomFit() {
    editor?.fitContent({ animate: 220 });
    menuOpen = false;
  }

  function focusBoard() {
    editor?.container.focus({ preventScroll: true });
  }

  function deleteSelected() {
    onHaptic?.('medium');
    editor?.deleteSelection();
    focusBoard();
  }

  function clearAll() {
    menuOpen = false;
    if (!editor || !store.size) return;
    const doClear = () => {
      onHaptic?.('medium');
      editor?.clearBoard();
      focusBoard();
      if (channelId) void clearLocalBoard(channelId);
    };
    if (appMode && onClearRequest) return onClearRequest(doClear);
    pendingClear = doClear;
    clearConfirmOpen = true;
  }

  function toggleGrid() {
    editor?.setGrid(gridOn ? 'none' : 'dots');
  }

  function saveFile(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function showNotice(text: string, error = true) {
    notice = { text, error };
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice = null; noticeTimer = null; }, NOTICE_MS);
  }

  async function exportPng() {
    menuOpen = false;
    if (!editor) return;
    const blob = await editor.exportImage({ background: true, scale: 2 });
    if (!blob) return;
    saveFile(blob, `whiteboard-${new Date().toISOString().slice(0, 10)}.png`);
  }

  function exportBoard() {
    menuOpen = false;
    if (!ydoc) return;
    flushToDoc();
    const name = roomId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'whiteboard';
    saveFile(new Blob([encodeBoardBackup(Y.encodeStateAsUpdate(ydoc))], { type: 'application/json' }), `${name}.board.json`);
  }

  function chooseImport() {
    menuOpen = false;
    importInput?.click();
  }

  function openBackupDialog(mode: 'export' | 'import') {
    backupMode = mode;
    backupPassword = '';
    backupPasswordConfirm = '';
    backupError = '';
    backupAttempted = false;
    backupWrongPassword = false;
    backupBusy = false;
    backupOpen = true;
  }

  function closeBackupDialog() {
    backupOpen = false;
    backupPassword = '';
    backupPasswordConfirm = '';
    backupError = '';
    backupAttempted = false;
    backupWrongPassword = false;
    backupBusy = false;
    pendingEncryptedImport = '';
    wbMenuEl?.focus();
  }

  function chooseEncryptedExport() {
    menuOpen = false;
    if (!ydoc || shapeCount === 0) return;
    openBackupDialog('export');
  }

  function chooseEncryptedImport() {
    menuOpen = false;
    encryptedImportInput?.click();
  }

  async function onEncryptedImportPicked() {
    const file = encryptedImportInput?.files?.[0];
    if (encryptedImportInput) encryptedImportInput.value = '';
    if (!file || !ydoc) return;
    const tooLarge = t(dict, 'whiteboard.importTooLarge').replace('{size}', String(BOARD_BACKUP_MAX_BYTES / 1024 / 1024));
    if (file.size > BOARD_BACKUP_MAX_BYTES * 3) { showNotice(tooLarge); return; }
    pendingEncryptedImport = await file.text();
    openBackupDialog('import');
  }

  async function applyBoardUpdate(update: Uint8Array) {
    if (!ydoc) return;
    const tooLarge = t(dict, 'whiteboard.importTooLarge').replace('{size}', String(BOARD_BACKUP_MAX_BYTES / 1024 / 1024));
    if (update.length > BOARD_BACKUP_MAX_BYTES) { showNotice(tooLarge); return; }
    const probe = new Y.Doc();
    let added = 0;
    try {
      Y.applyUpdate(probe, update);
      for (const [key, asset] of probe.getMap<BoardAsset>('assets')) {
        if (!yassets.has(key) && validAssetRecord(asset, key)) added += assetBytes(asset.data);
      }
    } catch {
      showNotice(t(dict, 'whiteboard.importInvalid'));
      return;
    } finally {
      probe.destroy();
    }
    if (boardAssetBytes() + added > BOARD_ASSET_BYTES) { boardFullNotice(); return; }
    flushToDoc(true);
    Y.applyUpdate(ydoc, update, IMPORT_ORIGIN);
    editor?.fitContent({ animate: 200 });
    showNotice(t(dict, 'whiteboard.importDone'), false);
  }

  async function importBoard() {
    const file = importInput?.files?.[0];
    if (importInput) importInput.value = '';
    if (!file || !ydoc) return;
    const tooLarge = t(dict, 'whiteboard.importTooLarge').replace('{size}', String(BOARD_BACKUP_MAX_BYTES / 1024 / 1024));
    if (file.size > BOARD_BACKUP_MAX_BYTES * 2) { showNotice(tooLarge); return; }
    const parsed = parseBoardBackup(await file.text());
    if ('error' in parsed) { showNotice(parsed.error === 'too-large' ? tooLarge : t(dict, 'whiteboard.importInvalid')); return; }
    await applyBoardUpdate(parsed.update);
  }

  async function confirmBackupPassword() {
    if (backupBusy) return;
    backupError = '';
    backupAttempted = true;
    backupWrongPassword = false;
    const password = backupPassword.trim();
    if (!password) {
      void focusFirstInvalid(backupFieldsEl);
      return;
    }
    if (backupMode === 'export') {
      if (password !== backupPasswordConfirm.trim()) {
        void focusFirstInvalid(backupFieldsEl);
        return;
      }
      if (!ydoc) return;
      backupBusy = true;
      try {
        flushToDoc();
        const name = roomId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'whiteboard';
        const text = await encodeEncryptedBoardBackup(Y.encodeStateAsUpdate(ydoc), password);
        saveFile(new Blob([text], { type: 'application/json' }), `${name}.board.sealed.json`);
        closeBackupDialog();
        showNotice(t(dict, 'whiteboard.encryptedExportDone'), false);
      } catch {
        backupError = t(dict, 'whiteboard.encryptedExportFailed');
      } finally {
        backupBusy = false;
      }
      return;
    }
    backupBusy = true;
    try {
      const update = await decodeEncryptedBoardBackup(pendingEncryptedImport, password);
      closeBackupDialog();
      await applyBoardUpdate(update);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message === 'too-large') {
        backupError = t(dict, 'whiteboard.importTooLarge').replace('{size}', String(BOARD_BACKUP_MAX_BYTES / 1024 / 1024));
      } else if (message === 'Wrong password') {
        backupWrongPassword = true;
        void focusFirstInvalid(backupFieldsEl);
      } else {
        backupError = t(dict, 'whiteboard.encryptedImportInvalid');
      }
    } finally {
      backupBusy = false;
    }
  }

  async function toggleFullscreen() {
    menuOpen = false;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await rootEl?.requestFullscreen();
    } catch {}
  }

  function onFullscreenChange() {
    isFullscreen = !!document.fullscreenElement && document.fullscreenElement === rootEl;
  }

  function onWindowPointerDown(e: PointerEvent) {
    const target = e.target as Element | null;
    if (styleOpen && !target?.closest('[data-wb-style]')) styleOpen = false;
    if (menuOpen && !target?.closest('[data-wb-menu]')) menuOpen = false;
  }

  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || backupOpen || clearConfirmOpen) return;
    if (chatOpen) {
      chatOpen = false;
      document.getElementById('wb-chat-trigger')?.focus();
      return;
    }
    if (peopleOpen) {
      peopleOpen = false;
      document.getElementById('wb-people-trigger')?.focus();
      return;
    }
    if (!styleOpen && !menuOpen) return;
    const trigger = styleOpen ? 'wb-style-trigger' : 'wb-menu-trigger';
    styleOpen = false;
    menuOpen = false;
    document.getElementById(trigger)?.focus();
  }

  function toChatView(item: BoardChatItem, signer: string): ChatView {
    const who = senderInfo(item);
    const mine = signer === myPk;
    const warn = !mine && !!trust && !trust.note(signer, who.key, who.name);
    return { id: item.id, html: parseMarkdown(item.text), name: who.name, color: who.color, mine, at: item.at, pk: signer, warn };
  }

  // Saved messages travel inside the shared document, relayed by whoever syncs it, so each one is checked against its author's own signature.
  const itemSigners = new Map<string, Promise<string | null>>();
  let chatRefresh = 0;
  let chatRemoteSeen = false;

  function itemSigner(item: BoardChatItem): Promise<string | null> {
    let signer = itemSigners.get(item._sig);
    if (!signer) {
      if (itemSigners.size > 2000) itemSigners.clear();
      signer = verifyBoardItem(item, channelId);
      itemSigners.set(item._sig, signer);
    }
    return signer;
  }

  async function refreshSavedChat(remote: boolean) {
    const run = ++chatRefresh;
    chatRemoteSeen ||= remote;
    const items = ychat.toArray().filter(validBoardChatItem);
    const signers = await Promise.all(items.map(itemSigner));
    if (run !== chatRefresh) return;
    const before = chatSaved.length;
    const seen = new Set<string>();
    const next: ChatView[] = [];
    items.forEach((item, i) => {
      const signer = signers[i];
      if (!signer || seen.has(item.id)) return;
      seen.add(item.id);
      next.push(toChatView(item, signer));
    });
    chatSaved = next;
    if (chatRemoteSeen && next.length > before) noteIncomingChat(next.length - before);
    chatRemoteSeen = false;
  }

  async function noteIncomingChat(count: number) {
    if (!chatOpen) chatUnread += count;
    await tick();
    if (chatListEl) chatListEl.scrollTop = chatListEl.scrollHeight;
  }

  async function toggleChat() {
    chatOpen = !chatOpen;
    styleOpen = false;
    menuOpen = false;
    peopleOpen = false;
    if (!chatOpen) return;
    chatUnread = 0;
    await tick();
    if (chatListEl) chatListEl.scrollTop = chatListEl.scrollHeight;
    chatInputEl?.focus();
  }

  async function togglePeople() {
    peopleOpen = !peopleOpen;
    chatOpen = false;
    styleOpen = false;
    menuOpen = false;
    if (!peopleOpen) return;
    await tick();
    document.getElementById('wb-people')?.querySelector<HTMLElement>('button')?.focus();
  }

  async function sendChat() {
    const raw = chatInput.trim().slice(0, BOARD_CHAT_MAX_TEXT);
    if (!raw || !ydoc || !boardKey) return;
    const burn = parseBurnSuffix(raw);
    const draft: UnsignedBoardChatItem = { id: genId(), text: burn ? burn.text : raw, alias: aliasWire(alias), at: Date.now() };
    if (burn) draft.ttl = burn.ttl;
    chatInput = '';
    let item: BoardChatItem;
    try { item = await signBoardItem(boardKey, draft, channelId); } catch { return; }
    if (burn) {
      chatBurning = [...chatBurning, { ...toChatView(item, myPk), expiresAt: Date.now() + burn.ttl * 1000 }];
      try {
        const payload = await seal('chat', { item });
        if (payload) socketSend(JSON.stringify({ type: 'envelope', kind: 'chat', payload, id: 'chat-' + genId() }), true);
      } catch {}
    } else {
      ydoc.transact(() => {
        ychat.push([item]);
        if (ychat.length > BOARD_CHAT_KEEP) ychat.delete(0, ychat.length - BOARD_CHAT_KEEP);
      }, LOCAL_ORIGIN);
    }
    await tick();
    if (chatListEl) chatListEl.scrollTop = chatListEl.scrollHeight;
  }

  $: chatView = [...chatSaved, ...chatBurning].sort((a, b) => a.at - b.at);

  function toScreen(x: number, y: number, _tick: number) {
    return editor ? editor.pageToScreen(x, y) : { x: -9999, y: -9999 };
  }

  $: activeColor = (styles.color ?? null) as string | null;
  $: swatch = THEMES[themeId].colors[(activeColor ?? 'black') as keyof typeof THEMES.light.colors].stroke;
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
  $: zoomLabel = percent.format(zoom);
  const seconds = new Intl.NumberFormat(locale, { style: 'unit', unit: 'second', unitDisplay: 'narrow' });

  function beforeUnloadHandler(e: BeforeUnloadEvent) {
    e.preventDefault();
    e.returnValue = '';
  }

  $: if (typeof window !== 'undefined') {
    if (verified) window.addEventListener('beforeunload', beforeUnloadHandler);
    else window.removeEventListener('beforeunload', beforeUnloadHandler);
  }

  function handleVisibility() {
    if (typeof document === 'undefined') return;
    pageHidden = document.hidden;
    if (pageHidden) void persistLocalBoard();
  }

  function handlePageHide() {
    void persistLocalBoard();
  }

  let cursorCleanInterval: ReturnType<typeof setInterval>;
  let chatTimer: ReturnType<typeof setInterval>;
  let themeObserver: MutationObserver | null = null;

  onMount(() => {
    initRoom();
    fullscreenSupported = !!document.fullscreenEnabled;
    document.addEventListener('visibilitychange', handleVisibility);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pointerdown', onWindowPointerDown, true);
    window.addEventListener('keydown', onWindowKeydown);
    window.addEventListener('online', onNetChange);
    window.addEventListener('offline', onNetChange);
    netOffline = !navigator.onLine;
    themeObserver = new MutationObserver(() => {
      syncBoardTheme();
      editor?.setTheme(themeId);
      editor?.requestRender();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-app-scheme', 'data-app-amoled'] });
    cursorCleanInterval = setInterval(() => {
      const cutoff = Date.now() - 4000;
      const before = cursors.length;
      cursors = cursors.filter(c => c.lastSeen > cutoff);
      if (cursors.length !== before) cursors = cursors;
    }, 2000);
    chatTimer = setInterval(() => {
      if (!chatBurning.length) return;
      chatNow = Date.now();
      const alive = chatBurning.filter((m) => (m.expiresAt ?? 0) > chatNow);
      if (alive.length !== chatBurning.length) chatBurning = alive;
    }, 500);
  });

  onDestroy(() => {
    flushLocalBoardOnLeave();
    ws?.close();
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', beforeUnloadHandler);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pointerdown', onWindowPointerDown, true);
      window.removeEventListener('keydown', onWindowKeydown);
      window.removeEventListener('online', onNetChange);
      window.removeEventListener('offline', onNetChange);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibility);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    }
    themeObserver?.disconnect();
    clearInterval(cursorCleanInterval);
    clearInterval(chatTimer);
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (flushTimer) clearTimeout(flushTimer);
    if (persistTimer) clearTimeout(persistTimer);
    if (laserTimer) clearTimeout(laserTimer);
    if (noticeTimer) clearTimeout(noticeTimer);
    ydoc?.destroy();
  });
</script>

<div class="wb-container" class:wb-container--fullscreen={isFullscreen} bind:this={rootEl}>
  {#if roomFull}
    <div class="wb-center">
      <div class="stack w-full max-w-xs text-center">
        {#if appMode}<span class="app-state-glyph" aria-hidden="true"><Icon name="users" size={20} /></span>{/if}
        <ToolStatus tone="error">{t(dict, 'whiteboard.roomFull')}</ToolStatus>
        <p class="hint">{t(dict, 'whiteboard.roomFullDetail')}</p>
        <button type="button" class="btn btn-block" on:click={() => { roomFull = false; verifying = true; try { ws?.reconnect(); } catch {} }}>{t(dict, 'whiteboard.roomFullRetry')}</button>
        {#if appMode}
          <button type="button" class="btn-secondary btn-block" on:click={() => onExitApp?.()}>{t(dict, 'common.back')}</button>
        {/if}
      </div>
    </div>

  {:else if needsPassword}
    <div class="wb-center">
      <form class="stack w-full max-w-xs" novalidate on:submit|preventDefault={submitPassword}>
        <div class="space-y-2 text-center">
          {#if appMode}<span class="app-state-glyph" aria-hidden="true"><Icon name="lock-keyhole" size={20} /></span>{/if}
          <h2 class="text-base font-bold text-text">{t(dict, 'whiteboard.roomRequiresPassword')}</h2>
          <p class="hint">{t(dict, 'whiteboard.roomPasswordHint')}</p>
        </div>
        {#if boardMissing}
          <ToolStatus tone="warn">{t(dict, 'whiteboard.boardMissing')}</ToolStatus>
          {#if appMode}
            <button type="button" class="btn-secondary btn-block" on:click={() => onExitApp?.()}>{t(dict, 'common.back')}</button>
          {:else}
            <a class="btn-secondary btn-block" href={`/whiteboard?name=${encodeURIComponent(roomId)}`}>{t(dict, 'whiteboard.boardMissingCreate')}</a>
          {/if}
        {/if}
        <Field label={t(dict, 'whiteboard.password')} hideLabel error={passwordError}>
          {#snippet children(control)}
            <input
              {...control}
              bind:this={passwordEl}
              type="password"
              class="input w-full"
              placeholder={t(dict, 'whiteboard.roomPasswordPlaceholder')}
              bind:value={passwordInput}
              autocomplete="off"
              data-lpignore="true"
              data-1p-ignore
              data-bwignore="true"
            />
          {/snippet}
        </Field>
        <button type="submit" class="btn btn-block">{t(dict, 'whiteboard.enterRoom')}</button>
      </form>
    </div>

  {:else if verifying}
    <div class="wb-center">
      <div class="space-y-2 text-center" role="status" aria-live="polite">
        <span class="spinner" aria-hidden="true"></span>
        <p class="hint">{serverPresence > 1 ? t(dict, 'whiteboard.verifyingPassword') : t(dict, 'whiteboard.verifyingAlone')}</p>
      </div>
    </div>

  {:else}
    {#if sharePassword && !shareDismissed}
      <div class="wb-share-banner">
        <div class="wb-share-banner__bar">
          <button type="button" class="btn-ghost btn-sm" aria-expanded={shareOpen} aria-controls="wb-share-card" on:click={() => { shareOpen = !shareOpen; }}>
            <Icon name={shareOpen ? 'chevron-up' : 'chevron-down'} />{t(dict, 'chat.inviteCard.share')}
          </button>
          {#if !shareOpen}
            <button type="button" class="btn-ghost btn-icon btn-sm" on:click={() => { shareDismissed = true; }} aria-label={t(dict, 'chat.inviteCard.dismiss')} title={t(dict, 'chat.inviteCard.dismiss')}>
              <Icon name="x" />
            </button>
          {/if}
        </div>
        <div id="wb-share-card" hidden={!shareOpen}>
          <RoomInviteCard
            {dict}
            title={roomId}
            url={roomLink()}
            password={sharePassword}
            warning={t(dict, 'whiteboard.sharePasswordWarning')}
            onDismiss={() => { shareDismissed = true; }}
          />
        </div>
      </div>
    {/if}

    <div class="wb-stage" use:stageHeight>
      <div
        class="wb-board"
        use:board
        role="application"
        aria-label={t(dict, 'whiteboard.canvasLabel')}
        aria-describedby="wb-keyboard-help"
        aria-roledescription={t(dict, 'whiteboard.canvasRole')}
      ></div>
      <p id="wb-keyboard-help" class="sr-only">{t(dict, 'whiteboard.keyboardHelp')}</p>

      {#each cursors as c (c.id)}
        {#if c.id !== myConnId && c.pk !== myPk}
          {@const s = toScreen(c.x, c.y, camTick)}
          <div class="wb-cursor" style="transform: translate({s.x}px, {s.y}px); --wb-peer: {c.color}" aria-hidden="true">
            <svg width="18" height="22" viewBox="0 0 18 22"><path d="M1 1v17l4.5-4 3 7 3-1.4-3-6.6H15z" stroke-width="1.4" stroke-linejoin="round"/></svg>
            <span class="wb-cursor__name">{c.name}{#if c.warn}<Icon name="triangle-exclamation-point" class="wb-key-mark" />{/if}</span>
          </div>
        {/if}
      {/each}

      <div class="wb-bar wb-bar--start">
        <div class="wb-pill" role="toolbar" aria-label={t(dict, 'whiteboard.history')} use:roving>
          <button type="button" class="btn-ghost btn-icon wb-btn" on:click={() => store.undo()} disabled={!canUndo} aria-label={t(dict, 'whiteboard.undo')} title={`${t(dict, 'whiteboard.undo')} (Ctrl+Z)`}>
            <Icon name="undo-2" size={20} />
          </button>
          <button type="button" class="btn-ghost btn-icon wb-btn" on:click={() => store.redo()} disabled={!canRedo} aria-label={t(dict, 'whiteboard.redo')} title={`${t(dict, 'whiteboard.redo')} (Ctrl+Shift+Z)`}>
            <Icon name="redo-2" size={20} />
          </button>
        </div>
        <div class="wb-pill wb-zoom" role="toolbar" aria-label={t(dict, 'whiteboard.zoom')} use:roving>
          <button type="button" class="btn-ghost btn-icon wb-btn" on:click={() => zoomBy(0.8)} aria-label={t(dict, 'whiteboard.zoomOut')} title={t(dict, 'whiteboard.zoomOut')}>
            <Icon name="zoom-out" size={20} />
          </button>
          <button type="button" class="btn-ghost wb-btn wb-btn--text" on:click={zoomReset} aria-label={`${zoomLabel}, ${t(dict, 'whiteboard.zoomReset')}`} title={t(dict, 'whiteboard.zoomReset')}>{zoomLabel}</button>
          <button type="button" class="btn-ghost btn-icon wb-btn" on:click={() => zoomBy(1.25)} aria-label={t(dict, 'whiteboard.zoomIn')} title={t(dict, 'whiteboard.zoomIn')}>
            <Icon name="zoom-in" size={20} />
          </button>
          <button type="button" class="btn-ghost btn-icon wb-btn" on:click={zoomFit} aria-label={t(dict, 'whiteboard.zoomFit')} title={`${t(dict, 'whiteboard.zoomFit')} (Shift+1)`}>
            <Icon name="maximize" size={20} />
          </button>
        </div>
        {#if selectionSize > 0}
          <div class="wb-pill wb-selection" role="toolbar" aria-label={t(dict, 'whiteboard.selectionActions')} use:roving>
            <button type="button" class="btn-ghost btn-icon wb-btn" on:click={() => editor?.duplicateSelection()} aria-label={t(dict, 'whiteboard.duplicate')} title={`${t(dict, 'whiteboard.duplicate')} (Ctrl+D)`}>
              <Icon name="copy" size={20} />
            </button>
            <button type="button" class="btn-ghost btn-icon wb-btn" on:click={() => editor?.bringToFront()} aria-label={t(dict, 'whiteboard.bringToFront')} title={`${t(dict, 'whiteboard.bringToFront')} (])`}>
              <Icon name="bring-to-front" size={20} />
            </button>
            <button type="button" class="btn-ghost btn-icon wb-btn" on:click={() => editor?.sendToBack()} aria-label={t(dict, 'whiteboard.sendToBack')} title={`${t(dict, 'whiteboard.sendToBack')} ([)`}>
              <Icon name="send-to-back" size={20} />
            </button>
            <button type="button" class="btn-ghost btn-icon wb-btn text-danger" on:click={deleteSelected} aria-label={t(dict, 'whiteboard.delete')} title={`${t(dict, 'whiteboard.delete')} (Del)`}>
              <Icon name="trash" size={20} />
            </button>
          </div>
        {/if}
      </div>

      <div class="wb-bar wb-bar--end">
        <span class="wb-anchor">
        <button
          id="wb-chat-trigger"
          type="button"
          class="wb-pill btn-secondary btn-icon wb-btn wb-btn--solo wb-chat-trigger"
          aria-expanded={chatOpen}
          aria-controls="wb-chat"
          aria-label={chatUnread ? `${t(dict, 'whiteboard.chat')} (${t(dict, 'whiteboard.chatUnread').replace('{n}', String(chatUnread))})` : t(dict, 'whiteboard.chat')}
          title={t(dict, 'whiteboard.chat')}
          on:click={toggleChat}
        >
          <Icon name="message-square" size={20} />
        </button>
        {#if chatUnread}<span class="badge badge--danger wb-chat-badge" aria-hidden="true">{chatUnread > 9 ? '9+' : chatUnread}</span>{/if}
        </span>
        <div class="wb-pop" data-wb-style>
          <button
            id="wb-style-trigger"
            type="button"
            class="wb-pill btn-secondary btn-icon wb-btn wb-btn--solo"
            aria-expanded={styleOpen}
            aria-controls="wb-style-panel"
            aria-label={t(dict, 'whiteboard.style')}
            title={t(dict, 'whiteboard.style')}
            on:click={() => { styleOpen = !styleOpen; menuOpen = false; }}
          >
            <span class="wb-swatch" style="background: {swatch}"></span>
          </button>
          <div id="wb-style-panel" class="menu menu--end wb-menu-panel wb-panel" class:menu--open={styleOpen} role="group" aria-label={t(dict, 'whiteboard.style')}>
            <div class="wb-field" role="group" aria-labelledby="wb-color-label">
              <span id="wb-color-label" class="label wb-legend">{t(dict, 'whiteboard.color')}</span>
              <div class="wb-colors" use:roving={{ columns: 6 }}>
                {#each COLOR_IDS as c}
                  <button
                    type="button"
                    class="btn-ghost btn-icon wb-color"
                    aria-pressed={activeColor === c}
                    aria-label={t(dict, `whiteboard.colors.${c}`)}
                    title={t(dict, `whiteboard.colors.${c}`)}
                    style="--wb-swatch: {THEMES[themeId].colors[c].stroke}"
                    on:click={() => setStyle('color', c)}
                  ></button>
                {/each}
              </div>
            </div>
            <div class="wb-field" role="group" aria-labelledby="wb-size-label">
              <span id="wb-size-label" class="label wb-legend">{t(dict, 'whiteboard.size')}</span>
              <div class="wb-seg" use:roving>
                {#each SIZE_IDS as s, i}
                  <button type="button" class="btn-ghost btn-icon wb-btn" aria-pressed={styles.size === s} aria-label={t(dict, `whiteboard.sizes.${s}`)} title={t(dict, `whiteboard.sizes.${s}`)} on:click={() => setStyle('size', s)}>
                    <span class="wb-dot" style="--wb-dot: {5 + i * 3}px"></span>
                  </button>
                {/each}
              </div>
            </div>
            <div class="wb-field" role="group" aria-labelledby="wb-dash-label">
              <span id="wb-dash-label" class="label wb-legend">{t(dict, 'whiteboard.dash')}</span>
              <div class="wb-seg" use:roving>
                {#each DASH_IDS as d}
                  <button type="button" class="btn-ghost btn-icon wb-btn" aria-pressed={styles.dash === d} aria-label={t(dict, `whiteboard.dashes.${d}`)} title={t(dict, `whiteboard.dashes.${d}`)} on:click={() => setStyle('dash', d)}>
                    <Icon name={DASH_ICONS[d]} size={20} class="wb-dash-{d}" />
                  </button>
                {/each}
              </div>
            </div>
            <div class="wb-field" role="group" aria-labelledby="wb-fill-label">
              <span id="wb-fill-label" class="label wb-legend">{t(dict, 'whiteboard.fill')}</span>
              <div class="wb-seg" use:roving>
                {#each FILL_IDS as f}
                  <button type="button" class="btn-ghost btn-icon wb-btn" aria-pressed={styles.fill === f} aria-label={t(dict, `whiteboard.fills.${f}`)} title={t(dict, `whiteboard.fills.${f}`)} on:click={() => setStyle('fill', f)}>
                    <Icon name={FILL_ICONS[f]} size={20} class="wb-fill-{f}" />
                  </button>
                {/each}
              </div>
            </div>
            <div class="wb-field" role="group" aria-labelledby="wb-font-label">
              <span id="wb-font-label" class="label wb-legend">{t(dict, 'whiteboard.font')}</span>
              <div class="wb-seg" use:roving>
                {#each Object.keys(FONTS) as f}
                  <button type="button" class="btn-ghost btn-icon wb-btn" aria-pressed={styles.font === f} aria-label={t(dict, `whiteboard.fonts.${f}`)} title={t(dict, `whiteboard.fonts.${f}`)} style="font-family: {FONTS[f as keyof typeof FONTS]}" on:click={() => setStyle('font', f as Styles['font'])}>Aa</button>
                {/each}
              </div>
            </div>
          </div>
        </div>

        <div class="wb-pop" data-wb-menu>
          <button
            bind:this={wbMenuEl}
            id="wb-menu-trigger"
            type="button"
            class="wb-pill btn-secondary btn-icon wb-btn wb-btn--solo"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls="wb-menu"
            aria-label={t(dict, 'whiteboard.menu')}
            title={t(dict, 'whiteboard.menu')}
            on:click={() => { menuOpen = !menuOpen; styleOpen = false; }}
          >
            <Icon name="ellipsis-vertical" size={20} />
          </button>
          {#if appMode}
            <Popover id="wb-menu" opened={menuOpen} inert={!menuOpen} target={wbMenuEl} angle onBackdropClick={() => { menuOpen = false; }}>
              <MenuList>
                <MenuListItem link chevron={false} linkComponent="button" linkProps={{ type: 'button', disabled: shapeCount === 0 }} title={t(dict, 'whiteboard.exportPng')} onClick={exportPng}>
                  {#snippet media()}<Icon name="download" size={20} />{/snippet}
                </MenuListItem>
                <MenuListItem link chevron={false} linkComponent="button" linkProps={{ type: 'button', disabled: shapeCount === 0 }} title={t(dict, 'whiteboard.exportBoard')} onClick={exportBoard}>
                  {#snippet media()}<Icon name="save" size={20} />{/snippet}
                </MenuListItem>
                <MenuListItem link chevron={false} linkComponent="button" linkProps={{ type: 'button', disabled: shapeCount === 0 }} title={t(dict, 'whiteboard.exportEncrypted')} onClick={chooseEncryptedExport}>
                  {#snippet media()}<Icon name="save" size={20} />{/snippet}
                </MenuListItem>
                <MenuListItem link chevron={false} linkComponent="button" linkProps={{ type: 'button' }} title={t(dict, 'whiteboard.importBoard')} onClick={chooseImport}>
                  {#snippet media()}<Icon name="upload" size={20} />{/snippet}
                </MenuListItem>
                <MenuListItem link chevron={false} linkComponent="button" linkProps={{ type: 'button' }} title={t(dict, 'whiteboard.importEncrypted')} onClick={chooseEncryptedImport}>
                  {#snippet media()}<Icon name="upload" size={20} />{/snippet}
                </MenuListItem>
                <ListItem text={t(dict, 'whiteboard.backupHint')} />
                <div on:click={() => { menuOpen = false; }} role="presentation">
                  <SaveRoomButton {dict} kind="whiteboard" {roomId} mode="live" password={passwordInput} ready={verified} variant="konsta" />
                </div>
                <MenuListItem link chevron={false} linkComponent="button" linkProps={{ type: 'button', disabled: shapeCount === 0 }} title={t(dict, 'whiteboard.zoomFit')} onClick={zoomFit}>
                  {#snippet media()}<Icon name="maximize" size={20} />{/snippet}
                </MenuListItem>
                <MenuListItem link chevron={false} linkComponent="button" linkProps={{ type: 'button', role: 'menuitemcheckbox', 'aria-checked': gridOn }} title={t(dict, 'whiteboard.grid')} onClick={toggleGrid}>
                  {#snippet media()}<Icon name="grid-3x3" size={20} />{/snippet}
                  {#snippet after()}{#if gridOn}<Icon name="check" size={20} />{/if}{/snippet}
                </MenuListItem>
                {#if fullscreenSupported}
                  <MenuListItem link chevron={false} linkComponent="button" linkProps={{ type: 'button' }} title={t(dict, isFullscreen ? 'whiteboard.exitFullscreen' : 'whiteboard.fullscreen')} onClick={toggleFullscreen}>
                    {#snippet media()}<Icon name={isFullscreen ? 'minimize-2' : 'maximize-2'} size={20} />{/snippet}
                  </MenuListItem>
                {/if}
                <MenuListItem link chevron={false} linkComponent="button" linkProps={{ type: 'button', disabled: shapeCount === 0 }} title={t(dict, 'whiteboard.clear')} colors={{ menuListItemTextIos: 'text-ios-danger', menuListItemTextMaterial: 'text-md-light-error dark:text-md-dark-error' }} onClick={clearAll}>
                  {#snippet media()}<Icon name="trash" size={20} />{/snippet}
                </MenuListItem>
              </MenuList>
            </Popover>
          {:else}
            <div
              id="wb-menu"
              class="menu menu--end wb-menu-panel"
              class:menu--open={menuOpen}
              role="menu"
              tabindex="-1"
              aria-label={t(dict, 'whiteboard.menu')}
              use:menu={{ open: menuOpen, onclose: () => { menuOpen = false; }, trigger: wbMenuEl }}
            >
              <button type="button" class="menu__item" role="menuitem" on:click={exportPng} disabled={shapeCount === 0}>
                <Icon name="download" />{t(dict, 'whiteboard.exportPng')}
              </button>
              <button type="button" class="menu__item" role="menuitem" on:click={exportBoard} disabled={shapeCount === 0} aria-describedby="wb-backup-hint">
                <Icon name="save" />{t(dict, 'whiteboard.exportBoard')}
              </button>
              <button type="button" class="menu__item" role="menuitem" on:click={chooseEncryptedExport} disabled={shapeCount === 0} aria-describedby="wb-backup-hint">
                <Icon name="save" />{t(dict, 'whiteboard.exportEncrypted')}
              </button>
              <button type="button" class="menu__item" role="menuitem" on:click={chooseImport} aria-describedby="wb-backup-hint">
                <Icon name="upload" />{t(dict, 'whiteboard.importBoard')}
              </button>
              <button type="button" class="menu__item" role="menuitem" on:click={chooseEncryptedImport} aria-describedby="wb-backup-hint">
                <Icon name="upload" />{t(dict, 'whiteboard.importEncrypted')}
              </button>
              <p id="wb-backup-hint" class="hint wb-menu-hint" role="presentation">{t(dict, 'whiteboard.backupHint')}</p>
              <SaveRoomButton {dict} kind="whiteboard" {roomId} mode="live" password={passwordInput} ready={verified} variant="menu" />
              <button type="button" class="menu__item" role="menuitem" on:click={zoomFit} disabled={shapeCount === 0}>
                <Icon name="maximize" />{t(dict, 'whiteboard.zoomFit')}
              </button>
              <button type="button" class="menu__item" role="menuitemcheckbox" aria-checked={gridOn} on:click={toggleGrid}>
                <Icon name="grid-3x3" />{t(dict, 'whiteboard.grid')}
                {#if gridOn}<Icon name="check" class="wb-menu-check" />{/if}
              </button>
              {#if fullscreenSupported}
                <button type="button" class="menu__item" role="menuitem" on:click={toggleFullscreen}>
                  <Icon name={isFullscreen ? 'minimize-2' : 'maximize-2'} />{t(dict, isFullscreen ? 'whiteboard.exitFullscreen' : 'whiteboard.fullscreen')}
                </button>
              {/if}
              <button type="button" class="menu__item menu__item--danger" role="menuitem" on:click={clearAll} disabled={shapeCount === 0}>
                <Icon name="trash" />{t(dict, 'whiteboard.clear')}
              </button>
            </div>
          {/if}
        </div>
      </div>

      {#if chatOpen}
        <section id="wb-chat" class="wb-chat popover" aria-labelledby="wb-chat-title">
          <header class="wb-chat__head">
            <h2 id="wb-chat-title" class="wb-chat__title">{t(dict, 'whiteboard.chat')}</h2>
            <button type="button" class="btn-ghost btn-icon btn-sm wb-btn" on:click={toggleChat} aria-label={t(dict, 'whiteboard.chatClose')} title={t(dict, 'whiteboard.chatClose')}>
              <Icon name="x" size={16} />
            </button>
          </header>
          <ol class="wb-chat__list" bind:this={chatListEl} use:revealSpoilers aria-live="polite" aria-labelledby="wb-chat-title" tabindex="0">
            {#each chatView as m (m.id)}
              <li class="wb-chat__msg" class:wb-chat__msg--mine={m.mine}>
                <span class="wb-chat__name">
                  <span class="wb-chat__swatch" style="background: {m.color}" aria-hidden="true"></span>
                  {m.name}
                  {#if m.warn}<button type="button" class="btn-ghost btn-sm text-warn wb-key-btn" title={t(dict, 'whiteboard.keyNewHint')} aria-describedby="wb-key-hint-{m.id}" on:click={togglePeople}><Icon name="triangle-exclamation-point" />{t(dict, 'whiteboard.keyNew')}</button><span id="wb-key-hint-{m.id}" class="sr-only">{t(dict, 'whiteboard.keyNewHint')}</span>{/if}
                </span>
                <div class="wb-chat__text chat-md">{@html m.html}</div>
                {#if m.expiresAt}
                  <span class="sr-only">{t(dict, 'whiteboard.chatDisappears')}</span>
                  <span class="wb-chat__timer" title={t(dict, 'whiteboard.chatDisappears')} aria-hidden="true">{seconds.format(Math.max(0, Math.ceil((m.expiresAt - chatNow) / 1000)))}</span>
                {/if}
              </li>
            {:else}
              <li class="empty wb-chat__empty">{t(dict, 'whiteboard.chatEmpty')}</li>
            {/each}
          </ol>
          <form class="wb-chat__form" on:submit|preventDefault={sendChat}>
            <input
              bind:this={chatInputEl}
              bind:value={chatInput}
              class="input wb-chat__input"
              type="text"
              maxlength={BOARD_CHAT_MAX_TEXT}
              placeholder={t(dict, 'whiteboard.chatPlaceholder')}
              aria-label={t(dict, 'whiteboard.chatPlaceholder')}
              autocomplete="off"
              spellcheck="false"
              data-lpignore="true"
              data-1p-ignore
            />
            <button type="submit" class="btn-ghost btn-icon wb-btn" disabled={!chatInput.trim() || !connected} aria-label={t(dict, 'whiteboard.chatSend')} title={t(dict, 'whiteboard.chatSend')}>
              <Icon name="send" size={20} />
            </button>
          </form>
        </section>
      {/if}

      {#if peopleOpen}
        <section id="wb-people" class="wb-chat wb-people popover" aria-labelledby="wb-people-title">
          <header class="wb-chat__head">
            <h2 id="wb-people-title" class="wb-chat__title">{t(dict, 'whiteboard.people')}</h2>
            <button type="button" class="btn-ghost btn-icon btn-sm wb-btn" on:click={togglePeople} aria-label={t(dict, 'whiteboard.peopleClose')} title={t(dict, 'whiteboard.peopleClose')}>
              <Icon name="x" size={16} />
            </button>
          </header>
          <div class="wb-chat__list" role="group" aria-labelledby="wb-people-title" tabindex="0">
          <ul class="wb-people__list">
            <li class="wb-member">
              <span class="wb-avatar" style="background: {aliasGradient(alias, identity.name)}" aria-hidden="true"></span>
              <div class="min-w-0 flex-1">
                <p class="wb-member__name">{identity.name} <span class="text-muted">· {t(dict, 'whiteboard.you')}</span></p>
                <p class="wb-member__line"><span class="hint">{t(dict, 'whiteboard.keyCode')}</span><span class="wb-member__emoji">{myKeyCode}</span></p>
              </div>
            </li>
            {#each memberList as member (member.pk)}
              <li class="wb-member" class:wb-member--warn={!member.trusted}>
                <span class="wb-avatar" style="background: {gradientFor(memberAlias(member), member.name)}" aria-hidden="true"></span>
                <div class="min-w-0 flex-1">
                  <p class="wb-member__name">
                    {member.name}
                    {#if !member.trusted}<span class="badge badge--warn">{t(dict, 'whiteboard.keyNew')}</span>{/if}
                  </p>
                  <p class="wb-member__line"><span class="hint">{t(dict, 'whiteboard.keyCode')}</span><span class="wb-member__emoji">{memberCodes[member.pk]?.code ?? ''}</span></p>
                  <p class="wb-member__line"><span class="hint">{t(dict, 'whiteboard.safetyNumber')}</span><span class="wb-member__emoji wb-member__safety">{#each (memberCodes[member.pk]?.safety ?? '').split(' ') as group}<span>{group}</span>{/each}</span></p>
                  {#if !member.trusted}
                    <p class="hint">{t(dict, 'whiteboard.keyNewHint')}</p>
                    <button type="button" class="btn-secondary btn-sm" on:click={() => trustMember(member.pk)}>{t(dict, 'whiteboard.keyTrust')}</button>
                  {/if}
                </div>
              </li>
            {:else}
              <li class="empty wb-chat__empty">{t(dict, 'whiteboard.noPeopleYet')}</li>
            {/each}
          </ul>
          <p class="hint">{t(dict, 'whiteboard.safetyNumberHint')}</p>
          </div>
        </section>
      {/if}

      <input bind:this={imageInput} type="file" accept="image/*" multiple class="sr-only" tabindex="-1" aria-hidden="true" on:change={onImagePicked} />
      <input bind:this={importInput} type="file" accept="application/json,.json" class="sr-only" tabindex="-1" aria-hidden="true" on:change={importBoard} />
      <input bind:this={encryptedImportInput} type="file" accept="application/json,.json" class="sr-only" tabindex="-1" aria-hidden="true" on:change={onEncryptedImportPicked} />
      <Modal
        bind:open={backupOpen}
        {dict}
        icon="lock"
        title={t(dict, backupMode === 'export' ? 'whiteboard.exportEncrypted' : 'whiteboard.importEncrypted')}
        description={t(dict, 'whiteboard.passwordPrompt')}
        busy={backupBusy}
        onsubmit={confirmBackupPassword}
        onclose={closeBackupDialog}
      >
        <div class="stack" bind:this={backupFieldsEl}>
          <Field label={t(dict, 'whiteboard.password')} error={backupPasswordError} required>
            {#snippet children(control)}
              <input {...control} class="input" type="password" bind:value={backupPassword} on:input={() => (backupWrongPassword = false)} autocomplete={backupMode === 'export' ? 'new-password' : 'current-password'} spellcheck="false" disabled={backupBusy} />
            {/snippet}
          </Field>
          {#if backupMode === 'export'}
            <Field label={t(dict, 'whiteboard.passwordConfirm')} error={backupConfirmError} required>
              {#snippet children(control)}
                <input {...control} aria-describedby={[control['aria-describedby'], 'wb-backup-rules'].filter(Boolean).join(' ')} class="input" type="password" bind:value={backupPasswordConfirm} autocomplete="new-password" spellcheck="false" disabled={backupBusy} />
              {/snippet}
              {#snippet below()}
                <PasswordChecklist id="wb-backup-rules" label={t(dict, 'common.passwordRules')} rules={backupRules} {dict} invalid={!!backupConfirmError} />
              {/snippet}
            </Field>
          {/if}
          {#if backupError}
            <ToolStatus tone="error">{backupError}</ToolStatus>
          {/if}
        </div>
        {#snippet actions()}
          <button type="submit" class="btn" aria-busy={backupBusy} disabled={backupBusy}>{t(dict, backupMode === 'export' ? 'whiteboard.encryptedExportAction' : 'whiteboard.encryptedImportAction')}</button>
          <button type="button" class="btn-secondary" disabled={backupBusy} on:click={closeBackupDialog}>{t(dict, 'rooms.cancel')}</button>
        {/snippet}
      </Modal>
      <Modal
        bind:open={clearConfirmOpen}
        {dict}
        role="alertdialog"
        tone="danger"
        icon="trash"
        size="sm"
        title={t(dict, 'whiteboard.clearConfirm')}
        initialFocus=".modal__actions .btn-secondary"
        onsubmit={() => { clearConfirmed = true; clearConfirmOpen = false; }}
        onclose={() => { if (clearConfirmed) pendingClear?.(); clearConfirmed = false; pendingClear = null; }}
      >
        {#snippet actions()}
          <button type="submit" class="btn-danger">{t(dict, 'whiteboard.clear')}</button>
          <button type="button" class="btn-secondary" on:click={() => { clearConfirmOpen = false; }}>{t(dict, 'rooms.cancel')}</button>
        {/snippet}
      </Modal>
      {#if notice}
        <div class="wb-notice status" class:status--error={notice.error} class:status--ok={!notice.error} role={notice.error ? 'alert' : 'status'}>
          <span class="min-w-0 flex-1">{notice.text}</span>
          <button type="button" class="btn-ghost btn-icon btn-sm wb-btn" on:click={() => { notice = null; }} aria-label={t(dict, 'whiteboard.noticeClose')} title={t(dict, 'whiteboard.noticeClose')}>
            <Icon name="x" size={16} />
          </button>
        </div>
      {/if}

      <div class="wb-dock-wrap">
        {#if tool === 'geo'}
          <div class="wb-pill wb-geo" role="toolbar" aria-label={t(dict, 'whiteboard.geoKinds')}>
            <div class="wb-track" use:scrollEdges use:roving>
              {#each GEO_IDS as g}
                {@const label = t(dict, `whiteboard.geo.${g}`)}
                {@const geoIcon = GEO_ICONS[g]}
                {@const fallback = dict[`whiteboard.geo.${g}`] ?? ''}
                <button type="button" class="btn-ghost wb-btn" class:btn-icon={!!geoIcon} class:wb-btn--text={!geoIcon && !!fallback} aria-pressed={geoKind === g} aria-label={label} title={GEO_KEYS[g] ? `${label} (${GEO_KEYS[g]})` : label} on:click={() => pickGeo(g)}>
                  {#if geoIcon}
                    <Icon name={geoIcon} size={20} />
                  {:else if fallback}
                    <span>{fallback}</span>
                  {/if}
                </button>
              {/each}
            </div>
          </div>
        {/if}
        <div class="wb-pill wb-dock" role="toolbar" aria-label={t(dict, 'whiteboard.toolbar')}>
          <div class="wb-track" use:scrollEdges use:roving>
            {#each TOOLS as item}
              {@const label = t(dict, `whiteboard.tool.${item.id}`)}
              {@const icon = item.id === 'geo' ? GEO_ICONS[geoKind] : TOOL_ICONS[item.id]}
              <button
                type="button"
                class="btn-ghost btn-icon wb-btn wb-tool"
                aria-pressed={tool === item.id}
                aria-label={label}
                title={`${label} (${item.key})`}
                aria-keyshortcuts={item.key}
                on:click={() => pickTool(item.id)}
              >
                {#if icon}
                  <Icon name={icon} size={20} />
                {:else if dict[`whiteboard.geo.${geoKind}`]}
                  <span>{dict[`whiteboard.geo.${geoKind}`]}</span>
                {/if}
              </button>
            {/each}
            <button type="button" class="btn-ghost btn-icon wb-btn wb-tool" aria-label={t(dict, 'whiteboard.insertImage')} title={t(dict, 'whiteboard.insertImage')} on:click={chooseImage}>
              <Icon name="image" size={20} />
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="wb-footer">
      <div class="flex min-w-0 items-center gap-2">
        {#if !appMode}
          <span class={connected ? 'wb-link-dot' : 'spinner'} aria-hidden="true"></span>
          <span class="sr-only" aria-live="polite">{connected ? t(dict, 'whiteboard.connected') : cryptoKey ? t(dict, 'whiteboard.connecting') : t(dict, 'common.working')}</span>
        {/if}
        <button
          id="wb-people-trigger"
          type="button"
          class="btn-ghost btn-sm wb-people-trigger"
          aria-expanded={peopleOpen}
          aria-controls="wb-people"
          aria-label={keyWarnings ? `${t(dict, 'whiteboard.people')} (${t(dict, 'whiteboard.keyWarnings').replace('{n}', String(keyWarnings))})` : t(dict, 'whiteboard.people')}
          title={t(dict, 'whiteboard.people')}
          on:click={togglePeople}
        >
          <span class="flex items-center -space-x-1.5" aria-hidden="true">
            <span class="wb-avatar" style="background: {aliasGradient(alias, identity.name)}"></span>
            {#each onlineUsers as user (user.id)}
              <span class="wb-avatar" class:wb-avatar--warn={user.warn} style="background: {gradientFor(user.alias, user.name)}"></span>
            {/each}
          </span>
          {#if keyWarnings}<Icon name="triangle-exclamation-point" class="wb-key-mark" />{/if}
        </button>
        <span class="wb-counter">{t(dict, 'whiteboard.shapes')}: {shapeCount}</span>
        {#if syncProgress}
          <span class="wb-counter" role="status">{t(dict, 'whiteboard.syncing').replace('{received}', String(syncProgress.received)).replace('{total}', String(syncProgress.total))}</span>
        {/if}
      </div>
      <button
        type="button"
        class="btn-ghost btn-sm wb-lock"
        aria-pressed={roomLocked}
        title={t(dict, roomLocked ? 'whiteboard.unlockHint' : 'whiteboard.lockHint')}
        on:click={toggleLock}
      >
        <Icon name={roomLocked ? 'lock' : 'lock-open'} />
        <span class="wb-lock__text">{t(dict, 'whiteboard.lock')}</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .wb-container {
    display: flex;
    flex-direction: column;
    height: clamp(22rem, calc(100dvh - 8.5rem), 1300px);
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid var(--line-soft);
    background: var(--surface);
  }
  .wb-container--fullscreen {
    height: 100dvh;
    border-radius: 0;
    border: 0;
  }

  .wb-center {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem 1rem;
  }

  .wb-stage {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
    container-type: inline-size;
  }

  .wb-board {
    position: absolute;
    inset: 0;
    background: var(--bg);
  }
  :global(html[data-app-platform]) .wb-board {
    background: var(--app-bg);
  }
  .wb-board:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .wb-bar {
    position: absolute;
    top: 0.5rem;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 0.375rem;
    pointer-events: none;
    z-index: 2;
  }
  .wb-bar--start { left: 0.5rem; right: 10.5rem; }
  .wb-bar--end { right: 0.5rem; z-index: 3; }

  .wb-pill {
    box-shadow: var(--shadow-float);
    pointer-events: auto;
  }
  .wb-pill:not(.wb-btn--solo) {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    border-radius: 8px;
    background: var(--surface);
    border: 1px solid var(--line);
  }
  .wb-anchor {
    position: relative;
    pointer-events: auto;
  }

  .wb-btn :global(svg.wb-dash-dashed path) { stroke-dasharray: 5 3; }
  .wb-btn :global(svg.wb-dash-dotted path) { stroke-dasharray: 0.1 4; stroke-width: 3; }
  .wb-btn :global(svg.wb-fill-none path) { fill: none; stroke: currentColor; stroke-width: 2; stroke-linejoin: round; }
  .wb-btn :global(svg.wb-fill-semi path) { fill: currentColor; fill-opacity: 0.35; }
  .wb-btn :global(svg.wb-fill-solid path) { fill: currentColor; fill-opacity: 1; }
  .wb-btn--text {
    min-width: 3.25rem;
    padding-inline: 0.375rem;
    font-variant-numeric: tabular-nums;
  }

  .wb-swatch {
    width: 20px;
    height: 20px;
    box-sizing: border-box;
    border-radius: 50%;
    border: 1px solid var(--line);
  }

  .wb-pop { pointer-events: auto; }
  .wb-menu-panel {
    min-width: 16rem;
    max-width: calc(100cqw - 1rem);
    max-height: calc(var(--wb-stage-h, 70dvh) - 4.25rem);
    overflow-y: auto;
    overscroll-behavior: contain;
    text-align: left;
  }
  .wb-menu-panel :global(.menu__item .wb-menu-check) { margin-left: auto; color: var(--accent); }
  .wb-menu-hint {
    max-width: 15rem;
    padding: 0 0.75rem 0.375rem;
    font-size: 0.75rem;
  }

  .wb-panel {
    width: min(19rem, calc(100cqw - 1rem));
    min-width: 0;
    gap: 0.5rem;
    padding: 0.625rem;
  }
  .wb-field {
    min-width: 0;
  }
  .wb-legend {
    display: block;
    margin-bottom: 0.25rem;
  }
  .wb-colors {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 2px;
  }
  .wb-color {
    width: 100%;
    min-width: 0;
  }
  .wb-color::before {
    content: '';
    width: 1.25rem;
    height: 1.25rem;
    box-sizing: border-box;
    border-radius: 50%;
    border: 1px solid var(--line);
    background: var(--wb-swatch);
  }
  .wb-seg {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 2px;
  }
  .wb-seg .wb-btn { width: 100%; min-width: 0; }
  .wb-dot {
    width: var(--wb-dot);
    height: var(--wb-dot);
    border-radius: 50%;
    background: currentColor;
  }

  .wb-notice {
    position: absolute;
    left: 50%;
    top: 3.5rem;
    transform: translateX(-50%);
    width: min(26rem, calc(100% - 1rem));
    align-items: center;
    padding: 0.375rem 0.375rem 0.375rem 0.875rem;
    box-shadow: var(--shadow-float);
    z-index: 4;
  }

  .wb-dock-wrap {
    position: absolute;
    left: 0.5rem;
    right: 0.5rem;
    bottom: 0.5rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.375rem;
    pointer-events: none;
    z-index: 2;
  }
  .wb-dock,
  .wb-geo { max-width: 100%; }
  .wb-track {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    flex-wrap: wrap;
    justify-content: center;
  }
  :global(html[data-app-platform]) .wb-track {
    flex-wrap: nowrap;
    justify-content: flex-start;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    scroll-snap-type: x proximity;
  }
  :global(html[data-app-platform]) .wb-track::-webkit-scrollbar {
    display: none;
  }
  :global(html[data-app-platform]) .wb-track .wb-btn {
    scroll-snap-align: start;
  }

  .wb-cursor {
    position: absolute;
    left: 0;
    top: 0;
    display: flex;
    align-items: flex-start;
    gap: 2px;
    pointer-events: none;
    z-index: 1;
    transition: transform var(--duration-base) linear;
    will-change: transform;
  }
  .wb-cursor path {
    fill: var(--wb-peer);
    stroke: var(--bg);
  }
  .wb-cursor__name {
    margin-top: 14px;
    padding: 1px 6px 1px 9px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--bg);
    box-shadow: inset 3px 0 0 var(--wb-peer);
    color: var(--text);
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
  }
  @media (prefers-reduced-motion: reduce) {
    .wb-cursor { transition: none; }
  }

  .wb-chat-trigger[aria-expanded="true"] {
    --btn-fg: var(--accent-strong);
    border-color: var(--accent-line);
    background: var(--accent-weak);
  }
  .wb-chat-badge {
    position: absolute;
    top: -6px;
    right: -6px;
    pointer-events: none;
  }
  .wb-chat {
    position: absolute;
    top: 3.75rem;
    right: 0.5rem;
    bottom: 4.5rem;
    width: min(20rem, calc(100% - 1rem));
    display: flex;
    flex-direction: column;
    z-index: 4;
    overflow: hidden;
  }
  .wb-chat__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.25rem 0.25rem 0.25rem 0.75rem;
    border-bottom: 1px solid var(--line-soft);
  }
  .wb-chat__title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text);
  }
  .wb-chat__list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
  }
  .wb-chat__msg {
    max-width: 90%;
    align-self: flex-start;
    display: grid;
    gap: 0.125rem;
    padding: 0.375rem 0.625rem;
    border-radius: 8px;
    background: var(--surface-2);
    font-size: 0.875rem;
    line-height: 1.45;
    color: var(--text);
    word-break: break-word;
  }
  .wb-chat__msg--mine {
    align-self: flex-end;
    background: var(--accent-weak);
  }
  .wb-chat__name {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text);
  }
  .wb-chat__name .wb-key-btn { padding-inline: 0.5rem; }
  .wb-chat__swatch {
    width: 0.625rem;
    height: 0.625rem;
    flex: none;
    box-sizing: border-box;
    border-radius: 50%;
    border: 1px solid var(--line);
  }
  .wb-chat__timer {
    justify-self: end;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .wb-chat__empty {
    margin: auto 0;
    padding: 0;
  }
  :global(.wb-key-mark) {
    flex: none;
    margin-left: 4px;
    color: var(--warn);
    vertical-align: -3px;
  }
  .wb-chat.wb-people {
    top: auto;
    right: auto;
    left: 0.5rem;
    bottom: 0.5rem;
    max-height: calc(100% - 1rem);
  }
  .wb-member {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    font-size: 0.8125rem;
    color: var(--text);
  }
  .wb-member--warn {
    padding: 0.5rem;
    border-radius: 8px;
    background: var(--warn-weak);
  }
  .wb-member > div { display: grid; gap: 0.25rem; }
  .wb-member__name {
    font-weight: 600;
    word-break: break-word;
  }
  .wb-member__line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.375rem;
  }
  .wb-member__emoji {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.2rem;
    font-size: 1.1rem;
    line-height: 1.3;
    letter-spacing: 0.04em;
    color: var(--text);
  }
  .wb-member__safety {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .wb-member .btn-secondary { justify-self: start; }
  .wb-people__list {
    display: grid;
    gap: 0.5rem;
  }
  .wb-chat__form {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.5rem;
    border-top: 1px solid var(--line-soft);
  }
  .wb-chat__input {
    flex: 1;
    min-width: 0;
  }

  @container (max-width: 560px) {
    .wb-pill.wb-zoom { display: none; }
    .wb-chat { bottom: 7rem; }
  }

  @container (max-width: 374px) {
    .wb-selection {
      flex-wrap: wrap;
      max-width: 104px;
    }
  }

  .wb-share-banner {
    flex: none;
    max-height: min(60%, 24rem);
    overflow-y: auto;
    padding: 0.25rem 0.75rem;
    border-bottom: 1px solid var(--accent-line);
    background: var(--accent-weak);
  }
  @media (max-width: 399px), (max-height: 479px) {
    .wb-share-banner {
      max-height: min(60%, 16rem);
    }
  }
  @media (min-width: 400px) and (min-height: 480px) and (max-height: 720px) {
    .wb-share-banner {
      max-height: min(42%, 16rem);
    }
  }
  .wb-share-banner__bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .wb-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.25rem 0.5rem 0.25rem 0.85rem;
    border-top: 1px solid var(--line-soft);
    font-size: 0.75rem;
    color: var(--muted);
  }

  .wb-link-dot {
    width: 8px;
    height: 8px;
    flex: none;
    border-radius: 50%;
    background: var(--accent);
  }

  .wb-avatar {
    width: 24px;
    height: 24px;
    box-sizing: border-box;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    overflow: hidden;
    background-color: var(--surface-2);
    border: 2px solid var(--surface);
  }
  .wb-avatar--warn { border-color: var(--warn); }
  .wb-people-trigger {
    padding-block: 0;
    padding-inline: 0.25rem;
  }
  .wb-people-trigger[aria-expanded="true"] { background: var(--surface-2); }

  .wb-counter {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  @media (max-width: 479px) {
    .wb-lock { width: 2rem; padding: 0; }
    .wb-lock__text {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  }
  @media (max-width: 479px) and (pointer: coarse) {
    .wb-lock { width: 2.75rem; }
  }

  @media (forced-colors: active) {
    .wb-swatch,
    .wb-color::before,
    .wb-chat__swatch,
    .wb-avatar,
    .wb-dot,
    .wb-link-dot {
      forced-color-adjust: none;
    }
    .wb-chat-trigger[aria-expanded="true"],
    .wb-people-trigger[aria-expanded="true"] {
      forced-color-adjust: none;
      border-color: Highlight;
      background: Highlight;
      color: HighlightText;
    }
  }
</style>
