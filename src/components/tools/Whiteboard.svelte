<script lang="ts">
  import { roomCredentials, ReplayWindow } from "../../lib/roomAccess";
  import { loadAlias, newAlias, parseAlias, aliasWire, aliasKey, aliasName, aliasColor, aliasGradient, gradientFor, type Alias } from "../../lib/alias";
  import { onMount, onDestroy, tick } from 'svelte';
  import PartySocket from 'partysocket';
  import * as Y from 'yjs';
  import { Editor, Store, THEMES, COLOR_IDS, SIZE_IDS, DASH_IDS, FILL_IDS, GEO_IDS, FONTS } from '@quickdrawjs/core';
  import type { Diff, ShapeRecord, ScribbleStroke, ToolId, GeoId, Styles } from '@quickdrawjs/core';
  import '@quickdrawjs/core/quickdraw.css';
  import {
    deriveKeyFromPassword, encryptMessage, decryptMessage,
    encryptBytes, decryptBytes,
  } from '../../lib/whiteboardCrypto';
  import { validShapeRecord, sanitizeScribbles, validBoardChatItem, BOARD_CHAT_MAX_TEXT, BOARD_CHAT_KEEP, type BoardChatItem } from '../../lib/whiteboardRecords';
  import { parseMarkdown, revealSpoilers } from '../../lib/chatMarkdown';
  import { parseBurnSuffix } from '../../lib/chatRoomSettings';
  import { DOC_PART_BYTES, splitDocUpdate, DocPartAssembler } from '../../lib/whiteboardSync';
  import { t } from '../../lib/t';

  export let locale = 'en';
  export let roomId = '';
  export let partyHost = '';
  export let initialPassword = '';

  export let dict: Record<string, string>;

  let accessToken = "";
  let channelId = "";
  const replay = new ReplayWindow();

  const DOC_FLUSH_MS = 100;
  const CURSOR_SYNC_INTERVAL_MS = 100;
  const CURSOR_MIN_MOVE = 4;
  const HEARTBEAT_INTERVAL_MS = 45000;
  // The whiteboard relay closes sockets above 300 messages or 3 MB per 10 s; stay under that with headroom.
  const RATE_WINDOW_MS = 10000;
  const RATE_MAX_MESSAGES = 240;
  const RATE_MAX_BYTES = 2_400_000;
  const RATE_DOC_HEADROOM = 400_000;
  const RATE_OPTIONAL_SHARE = 0.6;
  const LOCAL_ORIGIN = 'local';

  // Quickdraw ships a warm paper look; use the site's neutral surfaces and a grey grid instead.
  THEMES.light.background = '#fafafa';
  THEMES.light.grid.dot = { minor: 'rgba(24, 24, 27, 0.18)', major: 'rgba(24, 24, 27, 0.32)' };
  THEMES.light.grid.line = { minor: 'rgba(24, 24, 27, 0.07)', major: 'rgba(24, 24, 27, 0.14)' };
  THEMES.dark.background = '#18181b';
  THEMES.dark.grid.dot = { minor: 'rgba(244, 244, 245, 0.14)', major: 'rgba(244, 244, 245, 0.26)' };
  THEMES.dark.grid.line = { minor: 'rgba(244, 244, 245, 0.05)', major: 'rgba(244, 244, 245, 0.1)' };

  const ICONS: Record<string, string> = {
    select: '<path d="M4.04 4.69a.5.5 0 0 1 .65-.65l16 6.5a.5.5 0 0 1-.06.95l-6.13 1.58a2 2 0 0 0-1.43 1.43l-1.58 6.13a.5.5 0 0 1-.95.06z"/>',
    hand: '<path d="M18 11V6a2 2 0 0 0-4 0"/><path d="M14 10V4a2 2 0 0 0-4 0v2"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
    draw: '<path d="M21.17 6.81a1 1 0 0 0-3.98-3.98L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/><path d="m15 5 4 4"/>',
    highlight: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
    eraser: '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
    laser: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="M2 12h3"/><path d="M19 12h3"/><path d="m4.9 4.9 2.1 2.1"/><path d="m17 17 2.1 2.1"/>',
    arrow: '<path d="M7 17 17 7"/><path d="M8 7h9v9"/>',
    line: '<path d="M5 19 19 5"/>',
    text: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
    note: '<path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z"/><path d="M15 3v4a2 2 0 0 0 2 2h4"/>',
    rectangle: '<rect x="3" y="5" width="18" height="14" rx="2"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="9.5" ry="7.5"/>',
    triangle: '<path d="M12 3.5 21.5 20h-19z"/>',
    diamond: '<path d="M12 2.5 21.5 12 12 21.5 2.5 12z"/>',
    hexagon: '<path d="M7.25 3.5h9.5L21.5 12l-4.75 8.5h-9.5L2.5 12z"/>',
    star: '<path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    duplicate: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"/>',
    front: '<path d="M5 3h14"/><path d="m18 13-6-6-6 6"/><path d="M12 7v14"/>',
    back: '<path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/>',
    zoomIn: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    zoomOut: '<path d="M5 12h14"/>',
    fit: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="7" width="10" height="10" rx="1"/>',
    menu: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    grid: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>',
    fullscreen: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
    exitFullscreen: '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    unlock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    'dash-draw': '<path d="M3 14c3-5 5 2 8-1.5s5-5 10-1"/>',
    'dash-solid': '<path d="M4 12h16"/>',
    'dash-dashed': '<path d="M4 12h3.5"/><path d="M10.25 12h3.5"/><path d="M16.5 12H20"/>',
    'dash-dotted': '<path d="M4 12h.01"/><path d="M8 12h.01"/><path d="M12 12h.01"/><path d="M16 12h.01"/><path d="M20 12h.01"/>',
    'fill-none': '<rect x="4" y="4" width="16" height="16" rx="3"/>',
    'fill-semi': '<rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor" fill-opacity=".3"/>',
    'fill-solid': '<rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor"/>',
    'fill-pattern': '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4.5 11.5 11.5 4.5"/><path d="M5 19 19 5"/><path d="m12.5 19.5 7-7"/>',
  };

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
  let myInitials = getInitials(identity.name);

  function senderInfo(p: any) {
    const al = parseAlias(p?.alias) ?? undefined;
    const raw = typeof p?.sender === 'string' ? p.sender : typeof p?.name === 'string' ? p.name : '';
    const name = al ? aliasName(dict, al) : (raw.trim() || t(dict, 'whiteboard.guest'));
    const color = al ? aliasColor(al) : (typeof p?.color === 'string' ? p.color : 'var(--accent)');
    return { name, color, alias: al, key: al ? aliasKey(al) : name };
  }

  let connected = false;
  let verified = false;
  let verifying = false;
  let wrongPassword = false;
  let needsPassword = false;
  let passwordInput = '';
  let passwordError = '';
  let serverPresence = 0;

  let onlineUsers: { id: string; name: string; initials: string; color: string; alias?: Alias }[] = [];
  let myConnId = '';

  let sharePassword = '';
  let shareCopiedLink = false;
  let shareCopiedPass = false;
  let shareDismissed = false;

  let ydoc: Y.Doc;
  let yrecords: Y.Map<ShapeRecord>;
  let ychat: Y.Array<BoardChatItem>;

  type ChatView = { id: string; html: string; name: string; color: string; mine: boolean; at: number; expiresAt?: number };
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
  let isFullscreen = false;
  let fullscreenSupported = false;
  let rootEl: HTMLDivElement;

  type Cursor = { id: string; x: number; y: number; name: string; color: string; alias?: Alias; lastSeen: number };
  let cursors: Cursor[] = [];
  const remoteScribbles = new Map<string, { list: ScribbleStroke[]; at: number }>();
  let lastCursorSent = 0;
  let lastCursorX = -1e9;
  let lastCursorY = -1e9;
  let lastPointer: { x: number; y: number } | null = null;
  let laserTimer: ReturnType<typeof setTimeout> | null = null;
  let pageHidden = false;

  let roomLocked = false;

  function getInitials(name: string): string {
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }

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
    if (stored) {
      sessionStorage.removeItem('whiteboard-password');
      passwordInput = stored;
      await enterWithPassword(stored);
    } else {
      needsPassword = true;
    }
  }

  async function submitPassword() {
    passwordError = '';
    if (!passwordInput.trim()) { passwordError = t(dict, 'whiteboard.errorEnterPassword'); return; }
    await enterWithPassword(passwordInput.trim());
  }

  async function enterWithPassword(pwd: string) {
    try {
      const access = await roomCredentials(pwd, roomId, 'whiteboard');
      accessToken = access.token; channelId = access.channel;
      cryptoKey = await deriveKeyFromPassword(pwd, roomId);
      needsPassword = false;
      setupYjs();
      connectWs();
    } catch {
      passwordError = t(dict, 'whiteboard.errorDeriveKey');
      needsPassword = true;
    }
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

  // Quickdraw edits land in the store on every pointer move; changed ids are written to Yjs in throttled batches.
  const dirty = new Set<string>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleFlush(delay = DOC_FLUSH_MS) {
    if (!flushTimer) flushTimer = setTimeout(flushToDoc, delay);
  }

  function flushToDoc() {
    flushTimer = null;
    if (!dirty.size || !ydoc) return;
    const use = rateUsage();
    if (use.count + 8 > RATE_MAX_MESSAGES || use.bytes + RATE_DOC_HEADROOM > RATE_MAX_BYTES) {
      scheduleFlush(500);
      return;
    }
    ydoc.transact(() => {
      for (const id of dirty) {
        const rec = store.get(id);
        if (rec && rec.typeName === 'shape') yrecords.set(id, rec);
        else if (yrecords.has(id)) yrecords.delete(id);
      }
    }, LOCAL_ORIGIN);
    dirty.clear();
  }

  function setupYjs() {
    ydoc = new Y.Doc();
    yrecords = ydoc.getMap('records');
    ychat = ydoc.getArray('chat');
    ychat.observe((event, tr) => {
      const before = chatSaved.length;
      chatSaved = ychat.toArray().filter(validBoardChatItem).map(toChatView);
      if (tr.origin !== LOCAL_ORIGIN && chatSaved.length > before) noteIncomingChat(chatSaved.length - before);
    });

    store.listen((diff: Diff) => {
      for (const id of Object.keys(diff.added)) dirty.add(id);
      for (const id of Object.keys(diff.updated)) dirty.add(id);
      for (const id of Object.keys(diff.removed)) dirty.add(id);
      scheduleFlush();
    }, { source: 'user' });

    yrecords.observe((event, tr) => {
      if (tr.origin === LOCAL_ORIGIN) return;
      const wasEmpty = store.size === 0;
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

    ydoc.on('update', (update: Uint8Array, origin: any) => {
      if (origin === 'remote') return;
      queueDocUpdate(update);
    });
  }

  // Doc messages go out in order and are paced to the relay's rate window, so a large board is split into parts instead of being dropped.
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

  async function sendDocEnvelope(kind: 'doc' | 'doc-part', bytes: Uint8Array, to?: string) {
    if (!cryptoKey) return;
    const payload = await encryptBytes(cryptoKey, bytes);
    const message = JSON.stringify(to
      ? { type: 'envelope-to', to, kind, payload, id: genId() }
      : { type: 'envelope', kind, payload, id: genId() });
    await waitForBudget(message.length);
    socketSend(message, true);
  }

  async function sendDocUpdate(update: Uint8Array, to?: string) {
    if (!cryptoKey || !ws || !verified) return;
    if (update.length <= DOC_PART_BYTES) {
      await sendDocEnvelope('doc', update, to);
      return;
    }
    const parts = splitDocUpdate(update);
    if (!parts) return;
    for (const part of parts) await sendDocEnvelope('doc-part', part, to);
  }

  function shouldAnswerSync(newcomer: string) {
    if (!myConnId) return true;
    return onlineUsers.every(u => u.id === newcomer || u.id >= myConnId);
  }

  let heartbeatInterval: ReturnType<typeof setInterval> | undefined;

  function connectWs() {
    verifying = true;
    wrongPassword = false;
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
      if (cryptoKey) {
        const verifyPayload = await encryptMessage(cryptoKey,
          JSON.stringify({ type: 'verify', sender: identity.name, color: identity.color, alias: aliasWire(alias) }));
        socketSend(JSON.stringify({ type: 'envelope', kind: 'verify', payload: verifyPayload, id: 'verify-' + genId() }), true);
      }
      if (rejoin && ydoc && (store.size || ychat.length)) queueDocUpdate(Y.encodeStateAsUpdate(ydoc));
    });

    ws.addEventListener('close', () => {
      connected = false;
    });

    ws.addEventListener('error', () => {
      // A socket error is a network problem, not a wrong password; the init timeout decides that.
    });

    ws.addEventListener('message', handleServerMessage);

    // Keepalive against idle timeouts on mobile and proxy paths; hidden tabs reconnect on return instead.
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
      if (pageHidden) return;
      socketSend(JSON.stringify({ type: 'ping', t: Date.now() }));
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
        verified = true;
        verifying = false;
      } else if (verifying && serverPresence > 1) {
        setTimeout(() => {
          if (verifying && !verified) {
            wrongPassword = true;
            verifying = false;
            ws?.close();
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
    if (!cryptoKey) return;
    if (typeof data.payload !== 'string' || data.payload.length > 720000) return;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data.payload));
    if (!replay.accept(Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join(''))) return;

    try {
      if (data.kind === 'cursor') {
        const text = await decryptMessage(cryptoKey, data.payload);
        const c = JSON.parse(text);
        if (verifying) { verified = true; verifying = false; }
        const from = typeof data.from === 'string' ? data.from : String(c?.id ?? '');
        if (Number.isFinite(c?.x) && Number.isFinite(c?.y)) {
          const who = senderInfo(c);
          upsertCursor(from, c.x, c.y, who.name, who.color, who.alias);
        }
        if ('laser' in c) {
          remoteScribbles.set(from, { list: sanitizeScribbles(c.laser), at: Date.now() });
          pushRemoteScribbles();
        }
        return;
      }

      if (data.kind === 'doc') {
        const update = await decryptBytes(cryptoKey, data.payload);
        Y.applyUpdate(ydoc, update, 'remote');
        if (verifying) { verified = true; verifying = false; }
        return;
      }

      if (data.kind === 'chat') {
        const item = JSON.parse(await decryptMessage(cryptoKey, data.payload));
        if (!validBoardChatItem(item) || !item.ttl || chatBurning.some((m) => m.id === item.id)) return;
        chatBurning = [...chatBurning, { ...toChatView(item), expiresAt: Date.now() + item.ttl * 1000 }];
        noteIncomingChat(1);
        return;
      }

      if (data.kind === 'doc-part') {
        const part = await decryptBytes(cryptoKey, data.payload);
        if (verifying) { verified = true; verifying = false; }
        const result = assembler.accept(String(data.from ?? ''), part);
        if (!result) return;
        syncProgress = result.update ? null : { received: result.received, total: result.total };
        if (result.update) Y.applyUpdate(ydoc, result.update, 'remote');
        return;
      }

      if (data.kind === 'verify') {
        const text = await decryptMessage(cryptoKey, data.payload);
        const parsed = JSON.parse(text);
        if (verifying) { verified = true; verifying = false; }
        addOnlineUser(data.from || senderInfo(parsed).key, senderInfo(parsed));
        if (verified && cryptoKey && ws) {
          const ack = await encryptMessage(cryptoKey,
            JSON.stringify({ type: 'verify-ack', sender: identity.name, color: identity.color, alias: aliasWire(alias) }));
          socketSend(JSON.stringify({ type: 'envelope', kind: 'verify-ack', payload: ack, id: 'vack-' + genId() }), true);
          if (typeof data.from === 'string' && (store.size || ychat.length) && shouldAnswerSync(data.from)) {
            flushToDoc();
            queueDocUpdate(Y.encodeStateAsUpdate(ydoc), data.from);
          }
        }
        return;
      }

      if (data.kind === 'verify-ack') {
        const text = await decryptMessage(cryptoKey, data.payload);
        const parsed = JSON.parse(text);
        if (verifying) { verified = true; verifying = false; }
        addOnlineUser(data.from || senderInfo(parsed).key, senderInfo(parsed));
        return;
      }
    } catch {
      // One failed decrypt may be a peer with a different password; the init timeout decides.
    }
  }

  function addOnlineUser(id: string, who: { name: string; color: string; alias?: Alias; key: string }) {
    if (!onlineUsers.find(u => u.id === id || u.name === who.name)) {
      onlineUsers = [...onlineUsers, { id: id || who.key, name: who.name, initials: getInitials(who.name), color: who.color, alias: who.alias }];
    }
  }

  function upsertCursor(id: string, x: number, y: number, name: string, color: string, cursorAlias?: Alias) {
    const now = Date.now();
    const idx = cursors.findIndex(c => c.id === id);
    if (idx >= 0) {
      cursors[idx] = { id, x, y, name, color, alias: cursorAlias, lastSeen: now };
      cursors = cursors;
    } else {
      cursors = [...cursors, { id, x, y, name, color, alias: cursorAlias, lastSeen: now }];
    }
  }

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
    if (!cryptoKey || !ws) return;
    try {
      const body: Record<string, unknown> = {
        id: identity.key, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10,
        name: identity.name, color: identity.color, alias: aliasWire(alias),
      };
      if (laser) body.laser = laser;
      const payload = await encryptMessage(cryptoKey, JSON.stringify(body));
      if (!socketSend(JSON.stringify({ type: 'envelope', kind: 'cursor', payload, id: 'c-' + genId() }))) return;
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

  // Quickdraw zooms by exp(-deltaY * 0.012), so one mouse-wheel notch (deltaY ~100) shrinks the view to a third.
  function onBoardWheel(e: WheelEvent) {
    if (!editor || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    e.stopPropagation();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
    const delta = Math.max(-50, Math.min(50, e.deltaY * unit));
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    editor.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-delta * 0.005));
  }

  function board(node: HTMLDivElement) {
    themeId = isDarkTheme() ? 'dark' : 'light';
    const ed = new Editor({ container: node, store, theme: themeId, grid: 'dots' });
    node.dataset.qdTheme = themeId;
    // Images would be relayed as data URLs that exceed the encrypted message limit.
    ed.importImageBlobs = async () => {};
    ed.pickImage = () => {};
    ed.setTool(tool);
    editor = ed;
    const offs = [
      ed.on('tool', syncUi),
      ed.on('styles', syncUi),
      ed.on('selection', syncUi),
      ed.on('history', syncUi),
      ed.on('grid', syncUi),
      ed.on('change', () => { shapeCount = store.size; syncUi(); }),
      ed.on('camera', () => { zoom = ed.camera.z; camTick++; }),
      ed.on('scribbles', onScribbles),
    ];
    node.addEventListener('pointermove', onBoardPointerMove);
    node.addEventListener('keydown', onBoardKeydown);
    node.addEventListener('drop', blockFileDrop);
    node.addEventListener('wheel', onBoardWheel, { capture: true, passive: false });
    shapeCount = store.size;
    syncUi();
    if (pendingFit || store.size) { pendingFit = false; ed.fitContent(); }
    return {
      destroy() {
        offs.forEach(off => off());
        node.removeEventListener('pointermove', onBoardPointerMove);
        node.removeEventListener('keydown', onBoardKeydown);
        node.removeEventListener('drop', blockFileDrop);
        node.removeEventListener('wheel', onBoardWheel, { capture: true });
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
    editor?.deleteSelection();
    focusBoard();
  }

  function clearAll() {
    menuOpen = false;
    if (!editor || !store.size) return;
    if (!confirm(t(dict, 'whiteboard.clearConfirm'))) return;
    editor.clearBoard();
    focusBoard();
  }

  function toggleGrid() {
    editor?.setGrid(gridOn ? 'none' : 'dots');
  }

  async function exportPng() {
    menuOpen = false;
    if (!editor) return;
    const blob = await editor.exportImage({ background: true, scale: 2 });
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `whiteboard-${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
    if (e.key === 'Escape' && chatOpen && (e.target as Element | null)?.closest?.('#wb-chat')) {
      chatOpen = false;
      document.getElementById('wb-chat-trigger')?.focus();
      return;
    }
    if (e.key !== 'Escape' || (!styleOpen && !menuOpen)) return;
    const trigger = styleOpen ? 'wb-style-trigger' : 'wb-menu-trigger';
    styleOpen = false;
    menuOpen = false;
    document.getElementById(trigger)?.focus();
  }

  function toChatView(item: BoardChatItem): ChatView {
    const who = senderInfo(item);
    return { id: item.id, html: parseMarkdown(item.text), name: who.name, color: who.color, mine: who.key === identity.key, at: item.at };
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
    if (!chatOpen) return;
    chatUnread = 0;
    await tick();
    if (chatListEl) chatListEl.scrollTop = chatListEl.scrollHeight;
    chatInputEl?.focus();
  }

  async function sendChat() {
    const raw = chatInput.trim().slice(0, BOARD_CHAT_MAX_TEXT);
    if (!raw || !ydoc || !cryptoKey) return;
    const burn = parseBurnSuffix(raw);
    const item: BoardChatItem = { id: genId(), text: burn ? burn.text : raw, alias: aliasWire(alias), at: Date.now() };
    chatInput = '';
    if (burn) {
      item.ttl = burn.ttl;
      chatBurning = [...chatBurning, { ...toChatView(item), expiresAt: Date.now() + burn.ttl * 1000 }];
      try {
        const payload = await encryptMessage(cryptoKey, JSON.stringify(item));
        socketSend(JSON.stringify({ type: 'envelope', kind: 'chat', payload, id: 'chat-' + genId() }), true);
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

  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      shareCopiedLink = true;
      setTimeout(() => { shareCopiedLink = false; }, 1500);
    } catch {}
  }

  async function copySharePassword() {
    try {
      await navigator.clipboard.writeText(sharePassword);
      shareCopiedPass = true;
      setTimeout(() => { shareCopiedPass = false; }, 1500);
    } catch {}
  }

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
  }

  let cursorCleanInterval: ReturnType<typeof setInterval>;
  let chatTimer: ReturnType<typeof setInterval>;
  let themeObserver: MutationObserver | null = null;

  onMount(() => {
    initRoom();
    fullscreenSupported = !!document.fullscreenEnabled;
    document.addEventListener('visibilitychange', handleVisibility);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    window.addEventListener('pointerdown', onWindowPointerDown, true);
    window.addEventListener('keydown', onWindowKeydown);
    themeObserver = new MutationObserver(() => {
      themeId = isDarkTheme() ? 'dark' : 'light';
      editor?.setTheme(themeId);
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
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
    ws?.close();
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', beforeUnloadHandler);
      window.removeEventListener('pointerdown', onWindowPointerDown, true);
      window.removeEventListener('keydown', onWindowKeydown);
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
    if (laserTimer) clearTimeout(laserTimer);
    ydoc?.destroy();
  });
</script>

<div class="wb-container" class:wb-container--fullscreen={isFullscreen} bind:this={rootEl}>
  {#if wrongPassword}
    <div class="wb-center">
      <div class="space-y-4 max-w-xs w-full text-center">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mx-auto text-danger" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <p class="status status--error" role="alert">{t(dict, 'whiteboard.wrongPassword')}</p>
        <p class="hint">{t(dict, 'whiteboard.wrongPasswordDetail')}</p>
        <button type="button" class="btn-secondary w-full" on:click={() => { wrongPassword = false; needsPassword = true; passwordInput = ''; }}>{t(dict, 'whiteboard.tryAgain')}</button>
      </div>
    </div>

  {:else if needsPassword}
    <div class="wb-center">
      <form class="space-y-4 max-w-xs w-full" on:submit|preventDefault={submitPassword}>
        <div class="text-center space-y-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mx-auto text-accent" aria-hidden="true">{@html ICONS.lock}</svg>
          <p class="text-base font-bold text-text">{t(dict, 'whiteboard.roomRequiresPassword')}</p>
          <p class="hint">{t(dict, 'whiteboard.roomPasswordHint')}</p>
        </div>
        <input
          type="password"
          class="input w-full"
          aria-label={t(dict, 'whiteboard.password')}
          placeholder={t(dict, 'whiteboard.roomPasswordPlaceholder')}
          bind:value={passwordInput}
          autocomplete="off"
          data-lpignore="true"
          data-1p-ignore
          data-bwignore="true"
        />
        {#if passwordError}
          <p class="status status--error" role="alert">{passwordError}</p>
        {/if}
        <button type="submit" class="btn w-full">{t(dict, 'whiteboard.enterRoom')}</button>
      </form>
    </div>

  {:else if verifying}
    <div class="wb-center">
      <p class="status status--busy" role="status">{serverPresence > 1 ? t(dict, 'whiteboard.verifyingPassword') : t(dict, 'whiteboard.verifyingAlone')}</p>
    </div>

  {:else}
    {#if sharePassword && !shareDismissed}
      <div class="wb-share-banner">
        <div class="flex items-center justify-between gap-2 mb-2">
          <span class="text-sm font-bold text-accent">{t(dict, 'whiteboard.sharePasswordWarning')}</span>
          <button type="button" class="btn-ghost btn-sm btn-icon" on:click={() => { shareDismissed = true; }} aria-label={t(dict, 'whiteboard.closeSharePanel')}>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html ICONS.close}</svg>
          </button>
        </div>
        <div class="flex items-center gap-1.5 mb-1.5">
          <span class="shrink-0 whitespace-nowrap text-sm text-muted">{t(dict, 'whiteboard.roomLink')}</span>
          <code class="wb-share-value">{typeof window !== 'undefined' ? window.location.href : ''}</code>
          <button type="button" class="btn-ghost btn-sm btn-icon" on:click={copyShareLink} aria-label={t(dict, 'whiteboard.copyRoomLink')}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class:text-accent={shareCopiedLink} aria-hidden="true">{@html shareCopiedLink ? ICONS.check : ICONS.copy}</svg>
          </button>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="shrink-0 whitespace-nowrap text-sm text-muted">{t(dict, 'whiteboard.password')}</span>
          <code class="wb-share-value">{sharePassword}</code>
          <button type="button" class="btn-ghost btn-sm btn-icon" on:click={copySharePassword} aria-label={t(dict, 'whiteboard.copyRoomPassword')}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class:text-accent={shareCopiedPass} aria-hidden="true">{@html shareCopiedPass ? ICONS.check : ICONS.copy}</svg>
          </button>
        </div>
      </div>
    {/if}

    <div class="wb-stage">
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
        {#if c.id !== myConnId && c.name !== identity.name}
          {@const s = toScreen(c.x, c.y, camTick)}
          <div class="wb-cursor" style="transform: translate({s.x}px, {s.y}px); --wb-peer: {c.color}" aria-hidden="true">
            <svg width="18" height="22" viewBox="0 0 18 22"><path d="M1 1v17l4.5-4 3 7 3-1.4-3-6.6H15z" fill="var(--wb-peer)" stroke="white" stroke-width="1.4" stroke-linejoin="round"/></svg>
            <span class="wb-cursor__name">{c.name}</span>
          </div>
        {/if}
      {/each}

      <div class="wb-bar wb-bar--start">
        <div class="wb-pill" role="group" aria-label={t(dict, 'whiteboard.history')}>
          <button type="button" class="wb-btn" on:click={() => store.undo()} disabled={!canUndo} aria-label={t(dict, 'whiteboard.undo')} title={t(dict, 'whiteboard.undo')}>
            <svg viewBox="0 0 24 24" aria-hidden="true">{@html ICONS.undo}</svg>
          </button>
          <button type="button" class="wb-btn" on:click={() => store.redo()} disabled={!canRedo} aria-label={t(dict, 'whiteboard.redo')} title={t(dict, 'whiteboard.redo')}>
            <svg viewBox="0 0 24 24" aria-hidden="true">{@html ICONS.redo}</svg>
          </button>
        </div>
        <div class="wb-pill wb-zoom" role="group" aria-label={t(dict, 'whiteboard.zoom')}>
          <button type="button" class="wb-btn" on:click={() => zoomBy(0.8)} aria-label={t(dict, 'whiteboard.zoomOut')} title={t(dict, 'whiteboard.zoomOut')}>
            <svg viewBox="0 0 24 24" aria-hidden="true">{@html ICONS.zoomOut}</svg>
          </button>
          <button type="button" class="wb-btn wb-btn--text" on:click={zoomReset} aria-label={`${t(dict, 'whiteboard.zoomReset')} (${zoomLabel})`} title={t(dict, 'whiteboard.zoomReset')}>{zoomLabel}</button>
          <button type="button" class="wb-btn" on:click={() => zoomBy(1.25)} aria-label={t(dict, 'whiteboard.zoomIn')} title={t(dict, 'whiteboard.zoomIn')}>
            <svg viewBox="0 0 24 24" aria-hidden="true">{@html ICONS.zoomIn}</svg>
          </button>
          <button type="button" class="wb-btn" on:click={zoomFit} aria-label={t(dict, 'whiteboard.zoomFit')} title={`${t(dict, 'whiteboard.zoomFit')} (Shift+1)`}>
            <svg viewBox="0 0 24 24" aria-hidden="true">{@html ICONS.fit}</svg>
          </button>
        </div>
        {#if selectionSize > 0}
          <div class="wb-pill" role="group" aria-label={t(dict, 'whiteboard.selectionActions')}>
            <button type="button" class="wb-btn" on:click={() => editor?.duplicateSelection()} aria-label={t(dict, 'whiteboard.duplicate')} title={`${t(dict, 'whiteboard.duplicate')} (Ctrl+D)`}>
              <svg viewBox="0 0 24 24" aria-hidden="true">{@html ICONS.duplicate}</svg>
            </button>
            <button type="button" class="wb-btn" on:click={() => editor?.bringToFront()} aria-label={t(dict, 'whiteboard.bringToFront')} title={`${t(dict, 'whiteboard.bringToFront')} (])`}>
              <svg viewBox="0 0 24 24" aria-hidden="true">{@html ICONS.front}</svg>
            </button>
            <button type="button" class="wb-btn" on:click={() => editor?.sendToBack()} aria-label={t(dict, 'whiteboard.sendToBack')} title={`${t(dict, 'whiteboard.sendToBack')} ([)`}>
              <svg viewBox="0 0 24 24" aria-hidden="true">{@html ICONS.back}</svg>
            </button>
            <button type="button" class="wb-btn wb-btn--danger" on:click={deleteSelected} aria-label={t(dict, 'whiteboard.delete')} title={`${t(dict, 'whiteboard.delete')} (Del)`}>
              <svg viewBox="0 0 24 24" aria-hidden="true">{@html ICONS.trash}</svg>
            </button>
          </div>
        {/if}
      </div>

      <div class="wb-bar wb-bar--end">
        <button
          id="wb-chat-trigger"
          type="button"
          class="wb-pill wb-btn wb-btn--solo wb-chat-trigger"
          aria-expanded={chatOpen}
          aria-controls="wb-chat"
          aria-label={chatUnread ? `${t(dict, 'whiteboard.chat')} (${t(dict, 'whiteboard.chatUnread').replace('{n}', String(chatUnread))})` : t(dict, 'whiteboard.chat')}
          title={t(dict, 'whiteboard.chat')}
          on:click={toggleChat}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">{@html ICONS.chat}</svg>
          {#if chatUnread}<span class="wb-chat-badge" aria-hidden="true">{chatUnread > 9 ? '9+' : chatUnread}</span>{/if}
        </button>
        <div class="wb-pop" data-wb-style>
          <button
            id="wb-style-trigger"
            type="button"
            class="wb-pill wb-btn wb-btn--solo"
            aria-expanded={styleOpen}
            aria-controls="wb-style-panel"
            aria-label={t(dict, 'whiteboard.style')}
            title={t(dict, 'whiteboard.style')}
            on:click={() => { styleOpen = !styleOpen; menuOpen = false; }}
          >
            <span class="wb-swatch" style="background: {swatch}"></span>
          </button>
          <div id="wb-style-panel" class="menu menu--end wb-panel" class:menu--open={styleOpen}>
            <fieldset class="wb-field">
              <legend class="wb-legend">{t(dict, 'whiteboard.color')}</legend>
              <div class="wb-colors">
                {#each COLOR_IDS as c}
                  <button
                    type="button"
                    class="wb-color"
                    aria-pressed={activeColor === c}
                    aria-label={t(dict, `whiteboard.colors.${c}`)}
                    title={t(dict, `whiteboard.colors.${c}`)}
                    style="--wb-swatch: {THEMES[themeId].colors[c].stroke}"
                    on:click={() => setStyle('color', c)}
                  ></button>
                {/each}
              </div>
            </fieldset>
            <fieldset class="wb-field">
              <legend class="wb-legend">{t(dict, 'whiteboard.size')}</legend>
              <div class="wb-seg">
                {#each SIZE_IDS as s, i}
                  <button type="button" class="wb-btn" aria-pressed={styles.size === s} aria-label={t(dict, `whiteboard.sizes.${s}`)} title={t(dict, `whiteboard.sizes.${s}`)} on:click={() => setStyle('size', s)}>
                    <span class="wb-dot" style="--wb-dot: {5 + i * 3}px"></span>
                  </button>
                {/each}
              </div>
            </fieldset>
            <fieldset class="wb-field">
              <legend class="wb-legend">{t(dict, 'whiteboard.dash')}</legend>
              <div class="wb-seg">
                {#each DASH_IDS as d}
                  <button type="button" class="wb-btn" aria-pressed={styles.dash === d} aria-label={t(dict, `whiteboard.dashes.${d}`)} title={t(dict, `whiteboard.dashes.${d}`)} on:click={() => setStyle('dash', d)}>
                    <svg viewBox="0 0 24 24" aria-hidden="true" class:wb-svg-bold={d === 'dotted'}>{@html ICONS[`dash-${d}`]}</svg>
                  </button>
                {/each}
              </div>
            </fieldset>
            <fieldset class="wb-field">
              <legend class="wb-legend">{t(dict, 'whiteboard.fill')}</legend>
              <div class="wb-seg">
                {#each FILL_IDS as f}
                  <button type="button" class="wb-btn" aria-pressed={styles.fill === f} aria-label={t(dict, `whiteboard.fills.${f}`)} title={t(dict, `whiteboard.fills.${f}`)} on:click={() => setStyle('fill', f)}>
                    <svg viewBox="0 0 24 24" aria-hidden="true">{@html ICONS[`fill-${f}`]}</svg>
                  </button>
                {/each}
              </div>
            </fieldset>
            <fieldset class="wb-field">
              <legend class="wb-legend">{t(dict, 'whiteboard.font')}</legend>
              <div class="wb-seg">
                {#each Object.keys(FONTS) as f}
                  <button type="button" class="wb-btn wb-btn--font" aria-pressed={styles.font === f} aria-label={t(dict, `whiteboard.fonts.${f}`)} title={t(dict, `whiteboard.fonts.${f}`)} style="font-family: {FONTS[f as keyof typeof FONTS]}" on:click={() => setStyle('font', f as Styles['font'])}>Aa</button>
                {/each}
              </div>
            </fieldset>
          </div>
        </div>

        <div class="wb-pop" data-wb-menu>
          <button
            id="wb-menu-trigger"
            type="button"
            class="wb-pill wb-btn wb-btn--solo"
            aria-expanded={menuOpen}
            aria-controls="wb-menu"
            aria-label={t(dict, 'whiteboard.menu')}
            title={t(dict, 'whiteboard.menu')}
            on:click={() => { menuOpen = !menuOpen; styleOpen = false; }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">{@html ICONS.menu}</svg>
          </button>
          <div id="wb-menu" class="menu menu--end" class:menu--open={menuOpen}>
            <button type="button" class="menu__item" on:click={exportPng} disabled={shapeCount === 0}>
              <svg class="wb-menu-icon" viewBox="0 0 24 24" aria-hidden="true">{@html ICONS.download}</svg>{t(dict, 'whiteboard.exportPng')}
            </button>
            <button type="button" class="menu__item" on:click={zoomFit} disabled={shapeCount === 0}>
              <svg class="wb-menu-icon" viewBox="0 0 24 24" aria-hidden="true">{@html ICONS.fit}</svg>{t(dict, 'whiteboard.zoomFit')}
            </button>
            <button type="button" class="menu__item" role="switch" aria-checked={gridOn} on:click={toggleGrid}>
              <svg class="wb-menu-icon" viewBox="0 0 24 24" aria-hidden="true">{@html ICONS.grid}</svg>{t(dict, 'whiteboard.grid')}
              {#if gridOn}<svg class="wb-menu-icon wb-menu-check" viewBox="0 0 24 24" aria-hidden="true">{@html ICONS.check}</svg>{/if}
            </button>
            {#if fullscreenSupported}
              <button type="button" class="menu__item" on:click={toggleFullscreen}>
                <svg class="wb-menu-icon" viewBox="0 0 24 24" aria-hidden="true">{@html isFullscreen ? ICONS.exitFullscreen : ICONS.fullscreen}</svg>{t(dict, isFullscreen ? 'whiteboard.exitFullscreen' : 'whiteboard.fullscreen')}
              </button>
            {/if}
            <button type="button" class="menu__item wb-menu-danger" on:click={clearAll} disabled={shapeCount === 0}>
              <svg class="wb-menu-icon" viewBox="0 0 24 24" aria-hidden="true">{@html ICONS.trash}</svg>{t(dict, 'whiteboard.clear')}
            </button>
          </div>
        </div>
      </div>

      {#if chatOpen}
        <section id="wb-chat" class="wb-chat" aria-label={t(dict, 'whiteboard.chat')}>
          <header class="wb-chat__head">
            <h2 class="wb-chat__title">{t(dict, 'whiteboard.chat')}</h2>
            <button type="button" class="wb-btn" on:click={toggleChat} aria-label={t(dict, 'whiteboard.chatClose')} title={t(dict, 'whiteboard.chatClose')}>
              <svg viewBox="0 0 24 24" aria-hidden="true">{@html ICONS.close}</svg>
            </button>
          </header>
          <ol class="wb-chat__list" bind:this={chatListEl} use:revealSpoilers aria-live="polite">
            {#each chatView as m (m.id)}
              <li class="wb-chat__msg" class:wb-chat__msg--mine={m.mine}>
                <span class="wb-chat__name" style="color: {m.color}">{m.name}</span>
                <span class="wb-chat__text">{@html m.html}</span>
                {#if m.expiresAt}
                  <span class="wb-chat__timer" title={t(dict, 'whiteboard.chatDisappears')}>{Math.max(0, Math.ceil((m.expiresAt - chatNow) / 1000))} s</span>
                {/if}
              </li>
            {:else}
              <li class="wb-chat__empty">{t(dict, 'whiteboard.chatEmpty')}</li>
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
              data-lpignore="true"
              data-1p-ignore
            />
            <button type="submit" class="wb-btn" disabled={!chatInput.trim() || !connected} aria-label={t(dict, 'whiteboard.chatSend')} title={t(dict, 'whiteboard.chatSend')}>
              <svg viewBox="0 0 24 24" aria-hidden="true">{@html ICONS.send}</svg>
            </button>
          </form>
        </section>
      {/if}

      <div class="wb-dock-wrap">
        {#if tool === 'geo'}
          <div class="wb-pill wb-geo" role="group" aria-label={t(dict, 'whiteboard.geoKinds')}>
            {#each GEO_IDS as g}
              {@const label = t(dict, `whiteboard.geo.${g}`)}
              <button type="button" class="wb-btn" aria-pressed={geoKind === g} aria-label={label} title={GEO_KEYS[g] ? `${label} (${GEO_KEYS[g]})` : label} on:click={() => pickGeo(g)}>
                <svg viewBox="0 0 24 24" aria-hidden="true">{@html ICONS[g]}</svg>
              </button>
            {/each}
          </div>
        {/if}
        <div class="wb-pill wb-dock" role="toolbar" aria-label={t(dict, 'whiteboard.toolbar')} aria-orientation="horizontal">
          {#each TOOLS as item}
            {@const label = t(dict, `whiteboard.tool.${item.id}`)}
            <button
              type="button"
              class="wb-btn wb-tool"
              aria-pressed={tool === item.id}
              aria-label={label}
              title={`${label} (${item.key})`}
              aria-keyshortcuts={item.key}
              on:click={() => pickTool(item.id)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">{@html ICONS[item.id === 'geo' ? geoKind : item.id]}</svg>
            </button>
          {/each}
        </div>
      </div>
    </div>

    <div class="wb-footer">
      <div class="flex items-center gap-2 min-w-0">
        <span class="wb-status" class:wb-status--connected={connected} aria-hidden="true"></span>
        <span class="sr-only" aria-live="polite">{connected ? t(dict, 'whiteboard.connected') : t(dict, 'whiteboard.connecting')}</span>
        <div class="flex items-center -space-x-1.5">
          <div class="wb-avatar" style="background: {aliasGradient(alias)}" title={identity.name}>{myInitials}</div>
          {#each onlineUsers as user (user.id)}
            <div class="wb-avatar" style="background: {gradientFor(user.alias, user.name)}" title={user.name}>{user.initials}</div>
          {/each}
        </div>
        <span class="wb-counter">{shapeCount} {t(dict, 'whiteboard.shapes')}</span>
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
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html roomLocked ? ICONS.lock : ICONS.unlock}</svg>
        <span class="wb-lock__text">{t(dict, roomLocked ? 'whiteboard.locked' : 'whiteboard.lock')}</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .wb-container {
    display: flex;
    flex-direction: column;
    height: min(82dvh, 880px);
    min-height: 420px;
    border-radius: 0.75rem;
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
    background: #fafafa;
  }
  .wb-board:global([data-qd-theme='dark']) {
    background: #18181b;
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
  .wb-bar--start { left: 0.5rem; right: 9.5rem; }
  .wb-bar--end { right: 0.5rem; z-index: 3; }

  .wb-pill {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    border-radius: 0.625rem;
    background: var(--bg);
    border: 1px solid var(--line-soft);
    box-shadow: var(--shadow-float);
    pointer-events: auto;
  }

  .wb-btn {
    width: 36px;
    height: 36px;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.5rem;
    color: var(--muted);
    transition: background-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
  }
  .wb-btn svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .wb-btn svg.wb-svg-bold { stroke-width: 3; }
  .wb-btn:not(:disabled):hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .wb-btn[aria-pressed="true"] {
    background: var(--accent-weak);
    color: var(--accent-strong);
  }
  .wb-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .wb-btn--danger:not(:disabled):hover { color: var(--danger); background: var(--danger-weak); }
  .wb-btn--text {
    width: auto;
    min-width: 3.25rem;
    padding: 0 0.375rem;
    font-size: 0.75rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .wb-btn--font { font-size: 0.95rem; }
  .wb-btn--solo {
    width: 44px;
    height: 44px;
  }

  .wb-swatch {
    width: 20px;
    height: 20px;
    border-radius: 9999px;
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.15);
  }

  .wb-pop { position: relative; pointer-events: auto; }

  .wb-panel {
    width: 15.5rem;
    min-width: 0;
    max-height: min(70dvh, 28rem);
    overflow-y: auto;
    gap: 0.5rem;
    padding: 0.625rem;
  }

  .wb-field {
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
  }
  .wb-legend {
    padding: 0;
    margin-bottom: 0.25rem;
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--muted);
  }
  .wb-colors {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 4px;
  }
  .wb-color {
    height: 32px;
    border-radius: 0.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color var(--duration-fast) var(--ease-out);
  }
  .wb-color::before {
    content: '';
    width: 20px;
    height: 20px;
    border-radius: 9999px;
    background: var(--wb-swatch);
  }
  .wb-color:hover { background: var(--surface-2); }
  .wb-color[aria-pressed="true"] { box-shadow: inset 0 0 0 2px var(--accent); }
  .wb-seg {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 2px;
  }
  .wb-seg .wb-btn { width: 100%; }
  .wb-dot {
    width: var(--wb-dot);
    height: var(--wb-dot);
    border-radius: 9999px;
    background: currentColor;
  }

  .menu__item:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .wb-menu-icon {
    width: 16px;
    height: 16px;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .wb-menu-check { margin-left: auto; color: var(--accent); }
  .wb-menu-danger:not(:disabled):hover { color: var(--danger); }

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
  .wb-dock {
    flex-wrap: wrap;
    justify-content: center;
    max-width: 100%;
  }
  .wb-geo { flex-wrap: wrap; justify-content: center; }

  .wb-cursor {
    position: absolute;
    left: 0;
    top: 0;
    display: flex;
    align-items: flex-start;
    gap: 2px;
    pointer-events: none;
    z-index: 1;
    transition: transform 100ms linear;
    will-change: transform;
  }
  .wb-cursor__name {
    margin-top: 14px;
    padding: 1px 6px;
    border-radius: 9999px;
    background: var(--wb-peer);
    color: #fff;
    font-size: 0.75rem;
    font-weight: 700;
    white-space: nowrap;
  }
  @media (prefers-reduced-motion: reduce) {
    .wb-cursor { transition: none; }
  }

  .wb-chat-trigger { position: relative; }
  .wb-chat-trigger[aria-expanded="true"] {
    background: var(--accent-weak);
    color: var(--accent-strong);
  }
  .wb-chat-badge {
    position: absolute;
    top: -4px;
    right: -4px;
    min-width: 18px;
    height: 18px;
    padding: 0 4px;
    border-radius: 999px;
    background: var(--danger);
    color: #fff;
    font-size: 0.6875rem;
    font-weight: 800;
    line-height: 18px;
    text-align: center;
  }
  .wb-chat {
    position: absolute;
    top: 3.75rem;
    right: 0.5rem;
    bottom: 4.5rem;
    width: min(20rem, calc(100% - 1rem));
    display: flex;
    flex-direction: column;
    border-radius: 0.75rem;
    border: 1px solid var(--line-soft);
    background: var(--bg);
    box-shadow: var(--shadow-float);
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
    font-weight: 800;
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
    border-radius: 0.75rem;
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
    font-size: 0.75rem;
    font-weight: 800;
  }
  .wb-chat__timer {
    justify-self: end;
    font-size: 0.6875rem;
    font-weight: 700;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .wb-chat__empty {
    margin: auto 0;
    text-align: center;
    font-size: 0.8125rem;
    color: var(--muted);
  }
  .wb-chat__text :global(.chat-code-inline),
  .wb-chat__text :global(.chat-code-block) {
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    background: var(--surface);
    border-radius: 4px;
    padding: 1px 4px;
  }
  .wb-chat__text :global(.chat-code-block) {
    display: block;
    padding: 6px 8px;
    white-space: pre-wrap;
  }
  .wb-chat__text :global(del) { opacity: 0.6; }
  .wb-chat__text :global(.chat-spoiler) {
    background: var(--muted);
    color: transparent;
    border-radius: 3px;
    padding: 0 3px;
    cursor: pointer;
  }
  .wb-chat__text :global(.chat-spoiler.revealed) {
    background: transparent;
    color: inherit;
  }
  .wb-chat__text :global(.chat-quote) {
    display: block;
    border-left: 3px solid var(--accent-line);
    padding-left: 6px;
    color: var(--muted);
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
    min-height: 2.5rem;
  }

  @container (max-width: 560px) {
    .wb-zoom { display: none; }
    .wb-btn { width: 34px; height: 34px; }
    .wb-chat { bottom: 7rem; }
  }

  .wb-share-banner {
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--accent-line);
    background: var(--accent-weak);
  }
  .wb-share-value {
    flex: 1;
    min-width: 0;
    font-size: 0.75rem;
    font-family: var(--font-mono);
    color: var(--text);
    background: var(--bg);
    padding: 4px 8px;
    border-radius: 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  .wb-status {
    width: 8px;
    height: 8px;
    flex: none;
    border-radius: 9999px;
    background: var(--warn);
    animation: wb-pulse 1.2s ease-in-out infinite;
  }
  .wb-status--connected {
    background: var(--accent);
    animation: none;
  }
  @keyframes wb-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  @media (prefers-reduced-motion: reduce) {
    .wb-status { animation: none; }
  }

  .wb-avatar {
    width: 24px;
    height: 24px;
    border-radius: 9999px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.6875rem;
    font-weight: 800;
    color: white;
    flex-shrink: 0;
    box-shadow: 0 0 0 2px var(--surface);
  }

  .wb-counter {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .wb-lock[aria-pressed="true"] { color: var(--accent-strong); }
  @media (max-width: 479px) {
    .wb-lock { width: 2.25rem; padding: 0; }
    .wb-lock__text {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  }
</style>
