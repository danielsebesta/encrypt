<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import PartySocket from 'partysocket';
  import * as Y from 'yjs';
  import { getStroke } from 'perfect-freehand';
  import {
    deriveKeyFromPassword, encryptMessage, decryptMessage,
    encryptBytes, decryptBytes,
    generateIdentity, nameToGradient,
  } from '../../lib/whiteboardCrypto';
  import { getTranslations, t } from '../../lib/i18n';

  export let locale = 'en';
  export let roomId = '';
  export let partyHost = 'encrypt-chat.danielsebesta.partykit.dev';

  $: dict = getTranslations(locale);

  type Tool = 'pen' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'text' | 'select' | 'eraser';

  type Shape = {
    id: string;
    type: Tool extends 'pen' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'text' ? Tool : never;
    color: string;
    thickness: number;
    by: string;
    points?: number[][];
    x?: number; y?: number; w?: number; h?: number;
    x1?: number; y1?: number; x2?: number; y2?: number;
    text?: string;
    fontSize?: number;
  };

  const COLORS = ['#0a0a0a','#ef4444','#f97316','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ec4899'];
  const THICKNESS = [1, 2, 4, 7, 12];
  const DRAW_SYNC_INTERVAL_MS = 150;
  const CURSOR_SYNC_INTERVAL_MS = 80;
  const CURSOR_MIN_MOVE_PX = 8;
  const HEARTBEAT_INTERVAL_MS = 45000;

  let ws: PartySocket | null = null;
  let cryptoKey: CryptoKey | null = null;
  let identity = generateIdentity(locale);
  let myInitials = getInitials(identity.name);

  let connected = false;
  let verified = false;
  let verifying = false;
  let wrongPassword = false;
  let needsPassword = false;
  let passwordInput = '';
  let passwordError = '';
  let serverPresence = 0;
  let lastWrongPasswordNotice = 0;

  let onlineUsers: { id: string; name: string; initials: string; color: string }[] = [];
  let myConnId = '';

  let sharePassword = '';
  let shareCopiedLink = false;
  let shareCopiedPass = false;
  let shareDismissed = false;

  // Yjs document
  let ydoc: Y.Doc;
  let yshapes: Y.Map<Shape>;
  let undoMgr: Y.UndoManager;
  let shapesVersion = 0;

  // Tooling state
  let tool: Tool = 'pen';
  let currentColor = COLORS[0];
  let currentThickness = THICKNESS[1];
  let isDrawing = false;
  let draftShape: Shape | null = null;
  let draftSynced = false;
  let lastDrawSyncMs = 0;
  let selectedId: string | null = null;
  let textInput: { x: number; y: number; value: string } | null = null;
  let svgEl: SVGSVGElement;
  let textInputEl: HTMLTextAreaElement | null = null;

  // Live cursors (ephemeral)
  type Cursor = { id: string; x: number; y: number; name: string; color: string; lastSeen: number };
  let cursors: Cursor[] = [];
  let lastCursorSent = 0;
  let lastCursorX = -9999;
  let lastCursorY = -9999;
  let pageHidden = false;

  let passwordUsed = '';

  function getInitials(name: string): string {
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }

  function genId(): string {
    const arr = crypto.getRandomValues(new Uint8Array(8));
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  }

  function isLightShade(hex: string): boolean {
    if (!hex || hex[0] !== '#') return false;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (r * 0.299 + g * 0.587 + b * 0.114) > 200;
  }

  async function initRoom() {
    if (typeof window === 'undefined') return;
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
      cryptoKey = await deriveKeyFromPassword(pwd, roomId);
      passwordUsed = pwd;
      needsPassword = false;
      setupYjs();
      connectWs();
    } catch {
      passwordError = t(dict, 'whiteboard.errorDeriveKey');
      needsPassword = true;
    }
  }

  let pendingUpdates: Uint8Array[] = [];
  let updateFlushTimer: ReturnType<typeof setTimeout> | null = null;
  const UPDATE_BATCH_MS = 150;

  function flushPendingUpdates() {
    updateFlushTimer = null;
    if (pendingUpdates.length === 0 || !cryptoKey || !ws || !verified) {
      pendingUpdates = [];
      return;
    }
    const merged = pendingUpdates.length === 1
      ? pendingUpdates[0]
      : Y.mergeUpdates(pendingUpdates);
    pendingUpdates = [];
    sendDocUpdate(merged);
  }

  function setupYjs() {
    ydoc = new Y.Doc();
    yshapes = ydoc.getMap('shapes');
    undoMgr = new Y.UndoManager(yshapes);

    yshapes.observeDeep(() => {
      shapesVersion++;
    });

    // Outgoing updates — batched in 50 ms windows. Yjs fires update events
    // many times per second during fast drawing; merging them into one
    // payload before the network roundtrip cuts DO requests dramatically.
    ydoc.on('update', (update: Uint8Array, origin: any) => {
      if (origin === 'remote') return;
      if (!cryptoKey || !ws || !verified) return;
      pendingUpdates.push(update);
      if (!updateFlushTimer) {
        updateFlushTimer = setTimeout(flushPendingUpdates, UPDATE_BATCH_MS);
      }
    });
  }

  async function sendDocUpdate(update: Uint8Array) {
    if (!cryptoKey || !ws) return;
    try {
      const payload = await encryptBytes(cryptoKey, update);
      ws.send(JSON.stringify({ type: 'envelope', kind: 'doc', payload, id: genId() }));
    } catch {}
  }

  let heartbeatInterval: ReturnType<typeof setInterval> | undefined;

  function connectWs() {
    verifying = true;
    wrongPassword = false;
    ws = new PartySocket({
      host: partyHost,
      room: roomId,
      party: 'whiteboard',
      minReconnectionDelay: 500,
      maxReconnectionDelay: 8000,
      reconnectionDelayGrowFactor: 1.4,
      connectionTimeout: 8000,
      maxRetries: Infinity,
    });

    ws.addEventListener('open', async () => {
      connected = true;
      if (cryptoKey) {
        const verifyPayload = await encryptMessage(cryptoKey,
          JSON.stringify({ type: 'verify', sender: identity.name, color: identity.color }));
        ws!.send(JSON.stringify({ type: 'envelope', kind: 'verify', payload: verifyPayload, id: 'verify-' + genId() }));
      }
    });

    ws.addEventListener('close', () => {
      connected = false;
    });

    ws.addEventListener('error', () => {
      // WS error means TCP/upgrade/network problem — NOT a password issue.
      // Let PartySocket retry; the 4 s init-handler timeout (after presence > 1)
      // is the authoritative wrong-password signal.
    });

    ws.addEventListener('message', handleServerMessage);

    // Application-level keepalive: defeats idle timeouts on mobile/proxy paths.
    // Server ignores type:'ping' (no envelope), so this is a cheap noop.
    // Skipped when tab is hidden — browser usually throttles timers anyway,
    // and reconnect on visibility change handles return-from-background.
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
      if (pageHidden) return;
      if (ws && ws.readyState === 1) {
        try { ws.send(JSON.stringify({ type: 'ping', t: Date.now() })); } catch {}
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  async function handleServerMessage(event: MessageEvent) {
    let data: any;
    try { data = JSON.parse(event.data); } catch { return; }

    if (data.type === 'init') {
      myConnId = data.connId || '';
      serverPresence = data.presence;
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
      return;
    }
    if (data.type !== 'envelope') return;
    if (!cryptoKey) return;

    try {
      if (data.kind === 'cursor') {
        const text = await decryptMessage(cryptoKey, data.payload);
        const c = JSON.parse(text);
        if (verifying) { verified = true; verifying = false; }
        upsertCursor(c.id, c.x, c.y, c.name, c.color);
        return;
      }

      if (data.kind === 'doc') {
        const update = await decryptBytes(cryptoKey, data.payload);
        Y.applyUpdate(ydoc, update, 'remote');
        if (verifying) { verified = true; verifying = false; }
        return;
      }

      if (data.kind === 'verify') {
        const text = await decryptMessage(cryptoKey, data.payload);
        const parsed = JSON.parse(text);
        if (verifying) { verified = true; verifying = false; }
        addOnlineUser(data.from || parsed.sender, parsed.sender, parsed.color);
        if (verified && cryptoKey && ws) {
          // verify-ack
          const ack = await encryptMessage(cryptoKey,
            JSON.stringify({ type: 'verify-ack', sender: identity.name, color: identity.color }));
          ws.send(JSON.stringify({ type: 'envelope', kind: 'verify-ack', payload: ack, id: 'vack-' + genId() }));
          // Send full state to new joiner
          const state = Y.encodeStateAsUpdate(ydoc);
          await sendDocUpdate(state);
        }
        return;
      }

      if (data.kind === 'verify-ack') {
        const text = await decryptMessage(cryptoKey, data.payload);
        const parsed = JSON.parse(text);
        if (verifying) { verified = true; verifying = false; }
        addOnlineUser(data.from || parsed.sender, parsed.sender, parsed.color);
        return;
      }
    } catch {
      // A failed decrypt only means THIS message wasn't from someone with
      // our password. Could be a peer in the same room with a different
      // password — don't conclude wrongPassword from a single fail. The
      // 4s init-handler timeout is the authoritative "no peer can hear me"
      // signal, and the auto-verify-on-decrypt above handles the success path.
      if (verified && Date.now() - lastWrongPasswordNotice > 10000) {
        lastWrongPasswordNotice = Date.now();
      }
    }
  }

  function addOnlineUser(id: string, name: string, color: string) {
    if (!onlineUsers.find(u => u.name === name)) {
      onlineUsers = [...onlineUsers, { id: id || name, name, initials: getInitials(name), color }];
    }
  }

  function upsertCursor(id: string, x: number, y: number, name: string, color: string) {
    const now = Date.now();
    const idx = cursors.findIndex(c => c.id === id);
    if (idx >= 0) {
      cursors[idx] = { id, x, y, name, color, lastSeen: now };
      cursors = cursors;
    } else {
      cursors = [...cursors, { id, x, y, name, color, lastSeen: now }];
    }
  }

  let cursorCleanInterval: ReturnType<typeof setInterval>;

  // Lock state
  let roomLocked = false;

  function toggleLock() {
    if (!ws) return;
    ws.send(JSON.stringify({ type: roomLocked ? 'unlock' : 'lock' }));
  }

  // ==== Drawing logic ====

  function getSvgPoint(e: PointerEvent): { x: number; y: number; pressure: number } {
    if (!svgEl) return { x: 0, y: 0, pressure: 0.5 };
    const pt = svgEl.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const ctm = svgEl.getScreenCTM();
    if (!ctm) return { x: 0, y: 0, pressure: 0.5 };
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y, pressure: e.pressure || 0.5 };
  }

  function pointerDown(e: PointerEvent) {
    if (!verified || roomLocked) return;
    if (e.button === 2) return; // right-click
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = getSvgPoint(e);

    if (tool === 'select' || tool === 'eraser') {
      const hit = hitTest(p.x, p.y);
      if (tool === 'eraser' && hit) {
        deleteShape(hit);
      } else {
        selectedId = hit;
      }
      return;
    }

    if (tool === 'text') {
      textInput = { x: p.x, y: p.y, value: '' };
      tick().then(() => textInputEl?.focus());
      return;
    }

    isDrawing = true;
    draftSynced = false;
    lastDrawSyncMs = 0;
    const id = genId();
    const base: Shape = {
      id, type: tool as any,
      color: currentColor, thickness: currentThickness,
      by: identity.name,
    };
    if (tool === 'pen') {
      base.points = [[p.x, p.y, p.pressure]];
    } else if (tool === 'rect' || tool === 'ellipse') {
      base.x = p.x; base.y = p.y; base.w = 0; base.h = 0;
    } else if (tool === 'line' || tool === 'arrow') {
      base.x1 = p.x; base.y1 = p.y; base.x2 = p.x; base.y2 = p.y;
    }
    draftShape = base;
  }

  function syncDraftToYjs() {
    if (!draftShape) return;
    const n = normalizeShape(draftShape);
    if (!n) return;
    yshapes.set(n.id, { ...n, points: n.points ? n.points.map(p => [...p]) : undefined });
    draftSynced = true;
    lastDrawSyncMs = Date.now();
  }

  function pointerMove(e: PointerEvent) {
    const p = getSvgPoint(e);

    const now = Date.now();
    // Cursor send: only when there's somebody to see it, only when we
    // actually moved, only when tab is in foreground, throttled to 20 Hz,
    // and skipped while we're drawing — the doc updates already convey
    // our position to peers as the stroke materializes.
    if (
      verified && cryptoKey && ws && connected
      && serverPresence > 1
      && !pageHidden
      && !isDrawing
      && now - lastCursorSent > CURSOR_SYNC_INTERVAL_MS
      && Math.hypot(p.x - lastCursorX, p.y - lastCursorY) > CURSOR_MIN_MOVE_PX
    ) {
      lastCursorSent = now;
      lastCursorX = p.x;
      lastCursorY = p.y;
      sendCursor(p.x, p.y);
    }

    if (!isDrawing || !draftShape) return;

    if (draftShape.type === 'pen') {
      draftShape.points = [...(draftShape.points || []), [p.x, p.y, p.pressure]];
      draftShape = draftShape;
    } else if (draftShape.type === 'rect' || draftShape.type === 'ellipse') {
      draftShape.w = p.x - (draftShape.x ?? 0);
      draftShape.h = p.y - (draftShape.y ?? 0);
      draftShape = draftShape;
    } else if (draftShape.type === 'line' || draftShape.type === 'arrow') {
      draftShape.x2 = p.x; draftShape.y2 = p.y;
      draftShape = draftShape;
    }

    if (verified && now - lastDrawSyncMs > DRAW_SYNC_INTERVAL_MS) {
      const significant = draftShape.type === 'pen'
        ? (draftShape.points?.length ?? 0) >= 2
        : draftShape.type === 'rect' || draftShape.type === 'ellipse'
          ? Math.abs(draftShape.w ?? 0) + Math.abs(draftShape.h ?? 0) > 6
          : draftShape.type === 'line' || draftShape.type === 'arrow'
            ? Math.hypot((draftShape.x2 ?? 0) - (draftShape.x1 ?? 0), (draftShape.y2 ?? 0) - (draftShape.y1 ?? 0)) > 6
            : false;
      if (significant) syncDraftToYjs();
    }
  }

  function pointerUp(e: PointerEvent) {
    if (!isDrawing || !draftShape) { isDrawing = false; return; }
    isDrawing = false;
    const local = draftShape;
    const wasSynced = draftSynced;
    draftShape = null;
    draftSynced = false;
    const final = normalizeShape(local);
    if (final) {
      yshapes.set(final.id, final);
    } else if (wasSynced && yshapes.has(local.id)) {
      yshapes.delete(local.id);
    }
  }

  function normalizeShape(s: Shape): Shape | null {
    if (s.type === 'pen') {
      if (!s.points || s.points.length < 2) return null;
      return s;
    }
    if (s.type === 'rect' || s.type === 'ellipse') {
      const x = (s.w ?? 0) < 0 ? (s.x ?? 0) + (s.w ?? 0) : (s.x ?? 0);
      const y = (s.h ?? 0) < 0 ? (s.y ?? 0) + (s.h ?? 0) : (s.y ?? 0);
      const w = Math.abs(s.w ?? 0);
      const h = Math.abs(s.h ?? 0);
      if (w < 2 && h < 2) return null;
      return { ...s, x, y, w, h };
    }
    if (s.type === 'line' || s.type === 'arrow') {
      const dx = (s.x2 ?? 0) - (s.x1 ?? 0);
      const dy = (s.y2 ?? 0) - (s.y1 ?? 0);
      if (dx * dx + dy * dy < 4) return null;
      return s;
    }
    return s;
  }

  async function sendCursor(x: number, y: number) {
    if (!cryptoKey || !ws) return;
    try {
      const payload = await encryptMessage(cryptoKey, JSON.stringify({
        id: identity.name, x, y, name: identity.name, color: identity.color,
      }));
      ws.send(JSON.stringify({ type: 'envelope', kind: 'cursor', payload, id: 'c-' + genId() }));
    } catch {}
  }

  function commitText() {
    if (!textInput) return;
    const v = textInput.value.trim();
    if (!v) { textInput = null; return; }
    const shape: Shape = {
      id: genId(), type: 'text',
      color: currentColor, thickness: currentThickness,
      by: identity.name,
      x: textInput.x, y: textInput.y, text: v,
      fontSize: 14 + currentThickness * 2,
    };
    yshapes.set(shape.id, shape);
    textInput = null;
  }

  function deleteShape(id: string) {
    if (yshapes.has(id)) yshapes.delete(id);
    if (selectedId === id) selectedId = null;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (textInput) return;
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undoMgr?.undo();
    } else if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      undoMgr?.redo();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
      e.preventDefault();
      deleteShape(selectedId);
    } else if (e.key === 'Escape') {
      selectedId = null;
      if (textInput) textInput = null;
    } else if (e.key === '1') tool = 'pen';
    else if (e.key === '2') tool = 'rect';
    else if (e.key === '3') tool = 'ellipse';
    else if (e.key === '4') tool = 'line';
    else if (e.key === '5') tool = 'arrow';
    else if (e.key === '6') tool = 'text';
    else if (e.key === '7') tool = 'select';
    else if (e.key === '8') tool = 'eraser';
  }

  function clearAll() {
    if (!verified || roomLocked) return;
    if (!confirm(t(dict, 'whiteboard.clearConfirm'))) return;
    ydoc.transact(() => {
      const ids = Array.from(yshapes.keys());
      for (const id of ids) yshapes.delete(id);
    });
  }

  function hitTest(x: number, y: number): string | null {
    const ids = Array.from(yshapes.keys()).reverse();
    for (const id of ids) {
      const s = yshapes.get(id);
      if (!s) continue;
      if (shapeContains(s, x, y)) return id;
    }
    return null;
  }

  function shapeContains(s: Shape, px: number, py: number): boolean {
    const tol = Math.max(8, s.thickness * 1.5);
    if (s.type === 'rect') {
      return px >= (s.x ?? 0) - tol && px <= (s.x ?? 0) + (s.w ?? 0) + tol
          && py >= (s.y ?? 0) - tol && py <= (s.y ?? 0) + (s.h ?? 0) + tol;
    }
    if (s.type === 'ellipse') {
      const rx = (s.w ?? 0) / 2;
      const ry = (s.h ?? 0) / 2;
      const cx = (s.x ?? 0) + rx;
      const cy = (s.y ?? 0) + ry;
      if (rx < 1 || ry < 1) return false;
      const dx = (px - cx) / (rx + tol);
      const dy = (py - cy) / (ry + tol);
      return dx * dx + dy * dy <= 1;
    }
    if (s.type === 'line' || s.type === 'arrow') {
      return distToSegment(px, py, s.x1 ?? 0, s.y1 ?? 0, s.x2 ?? 0, s.y2 ?? 0) <= tol;
    }
    if (s.type === 'pen' && s.points) {
      for (let i = 1; i < s.points.length; i++) {
        const a = s.points[i - 1], b = s.points[i];
        if (distToSegment(px, py, a[0], a[1], b[0], b[1]) <= tol) return true;
      }
      return false;
    }
    if (s.type === 'text') {
      const fs = s.fontSize ?? 16;
      const len = (s.text?.length ?? 1) * fs * 0.55;
      return px >= (s.x ?? 0) - tol && px <= (s.x ?? 0) + len + tol
          && py >= (s.y ?? 0) - fs - tol && py <= (s.y ?? 0) + tol;
    }
    return false;
  }

  function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1, dy = y2 - y1;
    const len = dx * dx + dy * dy;
    if (len === 0) return Math.hypot(px - x1, py - y1);
    const tC = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len));
    return Math.hypot(px - (x1 + tC * dx), py - (y1 + tC * dy));
  }

  function penPathD(points: number[][], thickness: number): string {
    const stroke = getStroke(points, {
      size: Math.max(2, thickness * 1.6),
      thinning: 0.55,
      smoothing: 0.5,
      streamline: 0.5,
    });
    if (!stroke.length) return '';
    const d: (string | number)[] = ['M', stroke[0][0], stroke[0][1], 'Q'];
    for (let i = 0; i < stroke.length; i++) {
      const [x0, y0] = stroke[i];
      const [x1, y1] = stroke[(i + 1) % stroke.length];
      d.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    }
    d.push('Z');
    return d.join(' ');
  }

  function arrowHeadPath(x1: number, y1: number, x2: number, y2: number, t: number): string {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const len = Math.max(8, t * 4);
    const a1 = angle - Math.PI / 6;
    const a2 = angle + Math.PI / 6;
    const hx1 = x2 - len * Math.cos(a1);
    const hy1 = y2 - len * Math.sin(a1);
    const hx2 = x2 - len * Math.cos(a2);
    const hy2 = y2 - len * Math.sin(a2);
    return `M ${x2} ${y2} L ${hx1} ${hy1} M ${x2} ${y2} L ${hx2} ${hy2}`;
  }

  $: allShapes = (shapesVersion, ydoc ? Array.from(yshapes.values()) : []);
  $: shapesArray = draftShape ? allShapes.filter(s => s.id !== draftShape!.id) : allShapes;

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

  onMount(() => {
    initRoom();
    window.addEventListener('keydown', handleKeydown);
    document.addEventListener('visibilitychange', handleVisibility);
    cursorCleanInterval = setInterval(() => {
      const cutoff = Date.now() - 4000;
      const before = cursors.length;
      cursors = cursors.filter(c => c.lastSeen > cutoff);
      if (cursors.length !== before) cursors = cursors;
    }, 2000);
  });

  onDestroy(() => {
    ws?.close();
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('beforeunload', beforeUnloadHandler);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibility);
    }
    clearInterval(cursorCleanInterval);
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (updateFlushTimer) clearTimeout(updateFlushTimer);
    ydoc?.destroy();
  });
</script>

<div class="wb-container">
  {#if wrongPassword}
    <div class="wb-center">
      <div class="space-y-4 max-w-xs w-full text-center">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mx-auto text-red-500"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <p class="text-sm font-medium text-red-500">{t(dict, 'whiteboard.wrongPassword')}</p>
        <p class="text-xs text-zinc-400 dark:text-zinc-500 leading-relaxed">{t(dict, 'whiteboard.wrongPasswordDetail')}</p>
        <button class="btn-outline w-full text-xs" on:click={() => { wrongPassword = false; needsPassword = true; passwordInput = ''; }}>{t(dict, 'whiteboard.tryAgain')}</button>
      </div>
    </div>

  {:else if needsPassword}
    <div class="wb-center">
      <div class="space-y-4 max-w-xs w-full">
        <div class="text-center space-y-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mx-auto text-emerald-500"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <p class="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t(dict, 'whiteboard.roomRequiresPassword')}</p>
          <p class="text-[10px] text-zinc-400 dark:text-zinc-500 leading-relaxed">{t(dict, 'whiteboard.roomPasswordHint')}</p>
        </div>
        <input
          type="password"
          class="input w-full"
          placeholder={t(dict, 'whiteboard.roomPasswordPlaceholder')}
          bind:value={passwordInput}
          on:keydown={(e) => e.key === 'Enter' && submitPassword()}
          autocomplete="off"
          data-lpignore="true"
          data-1p-ignore
          data-bwignore="true"
        />
        {#if passwordError}
          <p class="text-xs text-red-500">{passwordError}</p>
        {/if}
        <button class="btn w-full" on:click={submitPassword}>{t(dict, 'whiteboard.enterRoom')}</button>
      </div>
    </div>

  {:else if verifying}
    <div class="wb-center">
      <div class="text-center space-y-2">
        <svg class="animate-spin mx-auto h-6 w-6 text-emerald-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
        <p class="text-xs text-zinc-400">{serverPresence > 1 ? t(dict, 'whiteboard.verifyingPassword') : t(dict, 'whiteboard.verifyingAlone')}</p>
      </div>
    </div>

  {:else}
    <div class="wb-toolbar">
      <div class="wb-tools">
        {#each [
          { t: 'pen' as Tool, icon: 'M12 19l7-7 3 3-7 7-3-3z', label: t(dict, 'whiteboard.toolPen') },
          { t: 'rect' as Tool, icon: 'M3 5h18v14H3z', label: t(dict, 'whiteboard.toolRect') },
          { t: 'ellipse' as Tool, icon: 'M12 5a7 7 0 0 1 0 14 7 7 0 0 1 0-14z', label: t(dict, 'whiteboard.toolEllipse') },
          { t: 'line' as Tool, icon: 'M5 19L19 5', label: t(dict, 'whiteboard.toolLine') },
          { t: 'arrow' as Tool, icon: 'M5 19L19 5M19 5h-7M19 5v7', label: t(dict, 'whiteboard.toolArrow') },
          { t: 'text' as Tool, icon: 'M5 4v3h5.5v12h3V7H19V4H5z', label: t(dict, 'whiteboard.toolText') },
          { t: 'select' as Tool, icon: 'M3 3l7 18 2-9 9-2L3 3z', label: t(dict, 'whiteboard.toolSelect') },
          { t: 'eraser' as Tool, icon: 'M16 3l5 5L8 21H3v-5L16 3zM12 7l5 5', label: t(dict, 'whiteboard.toolEraser') },
        ] as item}
          <button
            class="wb-tool-btn"
            class:wb-tool-btn--active={tool === item.t}
            on:click={() => { tool = item.t; selectedId = null; }}
            title={item.label}
            aria-label={item.label}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d={item.icon} />
            </svg>
          </button>
        {/each}
      </div>

      <div class="wb-divider"></div>

      <div class="wb-colors">
        {#each COLORS as c}
          <button
            class="wb-color-btn"
            class:wb-color-btn--active={currentColor === c}
            style="background: {c}; {isLightShade(c) ? 'border-color: rgba(0,0,0,0.15);' : ''}"
            on:click={() => currentColor = c}
            aria-label={c}
          ></button>
        {/each}
        <label
          class="wb-color-btn wb-color-btn--custom"
          class:wb-color-btn--active={!COLORS.includes(currentColor)}
          style={!COLORS.includes(currentColor) ? `background: ${currentColor};` : ''}
          aria-label={t(dict, 'whiteboard.customColor')}
          title={t(dict, 'whiteboard.customColor')}
        >
          <input
            type="color"
            class="wb-color-input"
            bind:value={currentColor}
            aria-label={t(dict, 'whiteboard.customColor')}
          />
        </label>
      </div>

      <div class="wb-divider"></div>

      <div class="wb-thicks">
        {#each THICKNESS as th}
          <button
            class="wb-thick-btn"
            class:wb-thick-btn--active={currentThickness === th}
            on:click={() => currentThickness = th}
            aria-label={`${th}px`}
          >
            <span class="wb-thick-dot" style="width: {Math.min(th + 2, 14)}px; height: {Math.min(th + 2, 14)}px"></span>
          </button>
        {/each}
      </div>

      <div class="wb-spacer"></div>

      <button class="wb-icon-btn" on:click={() => undoMgr?.undo()} aria-label={t(dict, 'whiteboard.undo')} title={t(dict, 'whiteboard.undo')}>
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
      </button>
      <button class="wb-icon-btn" on:click={() => undoMgr?.redo()} aria-label={t(dict, 'whiteboard.redo')} title={t(dict, 'whiteboard.redo')}>
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/></svg>
      </button>
      <button class="wb-icon-btn" on:click={clearAll} aria-label={t(dict, 'whiteboard.clear')} title={t(dict, 'whiteboard.clear')}>
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      </button>
      <button class="wb-icon-btn" on:click={toggleLock} class:wb-icon-btn--active={roomLocked} aria-label={t(dict, 'whiteboard.lock')} title={t(dict, 'whiteboard.lock')}>
        {#if roomLocked}
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        {:else}
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
        {/if}
      </button>
    </div>

    {#if sharePassword && !shareDismissed}
      <div class="wb-share-banner">
        <div class="flex items-center justify-between mb-2">
          <span class="text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">{t(dict, 'whiteboard.sharePasswordWarning')}</span>
          <button class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors" on:click={() => { shareDismissed = true; }} aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="flex items-center gap-1.5 mb-1.5">
          <span class="text-[10px] text-zinc-400 w-8 shrink-0">{t(dict, 'whiteboard.roomLink')}</span>
          <code class="wb-share-value">{typeof window !== 'undefined' ? window.location.href : ''}</code>
          <button class="wb-share-copy" on:click={copyShareLink} aria-label="Copy link">
            {#if shareCopiedLink}
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-500"><polyline points="20 6 9 17 4 12"/></svg>
            {:else}
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            {/if}
          </button>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="text-[10px] text-zinc-400 w-8 shrink-0">{t(dict, 'whiteboard.password')}</span>
          <code class="wb-share-value">{sharePassword}</code>
          <button class="wb-share-copy" on:click={copySharePassword} aria-label="Copy password">
            {#if shareCopiedPass}
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-500"><polyline points="20 6 9 17 4 12"/></svg>
            {:else}
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            {/if}
          </button>
        </div>
      </div>
    {/if}

    <div class="wb-canvas-wrap">
      <svg
        bind:this={svgEl}
        class="wb-canvas"
        class:wb-canvas--locked={roomLocked}
        viewBox="0 0 1600 1000"
        preserveAspectRatio="xMidYMid meet"
        on:pointerdown={pointerDown}
        on:pointermove={pointerMove}
        on:pointerup={pointerUp}
        on:pointercancel={pointerUp}
        on:contextmenu|preventDefault
        role="application"
        aria-label="Whiteboard canvas"
      >
        {#each shapesArray as s (s.id)}
          {@const isSel = selectedId === s.id}
          {#if s.type === 'pen' && s.points}
            <path d={penPathD(s.points, s.thickness)} fill={s.color} stroke="none"/>
            {#if isSel}
              <path d={penPathD(s.points, s.thickness)} fill="none" stroke="rgb(16,185,129)" stroke-width="2" stroke-dasharray="6 4"/>
            {/if}
          {:else if s.type === 'rect'}
            {@const rx = (s.w ?? 0) < 0 ? (s.x ?? 0) + (s.w ?? 0) : (s.x ?? 0)}
            {@const ry = (s.h ?? 0) < 0 ? (s.y ?? 0) + (s.h ?? 0) : (s.y ?? 0)}
            {@const rw = Math.abs(s.w ?? 0)}
            {@const rh = Math.abs(s.h ?? 0)}
            <rect x={rx} y={ry} width={rw} height={rh} fill="none" stroke={s.color} stroke-width={s.thickness} stroke-linejoin="round"/>
            {#if isSel}
              <rect x={rx - 4} y={ry - 4} width={rw + 8} height={rh + 8} fill="none" stroke="rgb(16,185,129)" stroke-width="2" stroke-dasharray="6 4"/>
            {/if}
          {:else if s.type === 'ellipse'}
            <ellipse cx={(s.x ?? 0) + (s.w ?? 0) / 2} cy={(s.y ?? 0) + (s.h ?? 0) / 2} rx={Math.abs((s.w ?? 0) / 2)} ry={Math.abs((s.h ?? 0) / 2)} fill="none" stroke={s.color} stroke-width={s.thickness}/>
            {#if isSel}
              <ellipse cx={(s.x ?? 0) + (s.w ?? 0) / 2} cy={(s.y ?? 0) + (s.h ?? 0) / 2} rx={Math.abs((s.w ?? 0) / 2) + 4} ry={Math.abs((s.h ?? 0) / 2) + 4} fill="none" stroke="rgb(16,185,129)" stroke-width="2" stroke-dasharray="6 4"/>
            {/if}
          {:else if s.type === 'line'}
            <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} stroke-width={s.thickness} stroke-linecap="round"/>
            {#if isSel}
              <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="rgb(16,185,129)" stroke-width={(s.thickness ?? 2) + 4} stroke-dasharray="6 4" stroke-linecap="round" opacity="0.6"/>
            {/if}
          {:else if s.type === 'arrow'}
            <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} stroke-width={s.thickness} stroke-linecap="round"/>
            <path d={arrowHeadPath(s.x1 ?? 0, s.y1 ?? 0, s.x2 ?? 0, s.y2 ?? 0, s.thickness)} stroke={s.color} stroke-width={s.thickness} fill="none" stroke-linecap="round"/>
            {#if isSel}
              <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="rgb(16,185,129)" stroke-width={(s.thickness ?? 2) + 4} stroke-dasharray="6 4" stroke-linecap="round" opacity="0.6"/>
            {/if}
          {:else if s.type === 'text'}
            <text x={s.x} y={s.y} fill={s.color} font-size={s.fontSize} font-family="ui-sans-serif, system-ui, sans-serif" font-weight="500">{s.text}</text>
            {#if isSel}
              <rect x={(s.x ?? 0) - 4} y={(s.y ?? 0) - (s.fontSize ?? 16) - 2} width={(s.text?.length ?? 1) * (s.fontSize ?? 16) * 0.55 + 8} height={(s.fontSize ?? 16) + 8} fill="none" stroke="rgb(16,185,129)" stroke-width="2" stroke-dasharray="6 4"/>
            {/if}
          {/if}
        {/each}

        {#if draftShape}
          {@const s = draftShape}
          {#if s.type === 'pen' && s.points && s.points.length > 1}
            <path d={penPathD(s.points, s.thickness)} fill={s.color} stroke="none" opacity="0.85"/>
          {:else if s.type === 'rect'}
            <rect
              x={(s.w ?? 0) < 0 ? (s.x ?? 0) + (s.w ?? 0) : (s.x ?? 0)}
              y={(s.h ?? 0) < 0 ? (s.y ?? 0) + (s.h ?? 0) : (s.y ?? 0)}
              width={Math.abs(s.w ?? 0)} height={Math.abs(s.h ?? 0)}
              fill="none" stroke={s.color} stroke-width={s.thickness} opacity="0.85"/>
          {:else if s.type === 'ellipse'}
            <ellipse cx={(s.x ?? 0) + (s.w ?? 0) / 2} cy={(s.y ?? 0) + (s.h ?? 0) / 2} rx={Math.abs((s.w ?? 0) / 2)} ry={Math.abs((s.h ?? 0) / 2)} fill="none" stroke={s.color} stroke-width={s.thickness} opacity="0.85"/>
          {:else if s.type === 'line'}
            <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} stroke-width={s.thickness} stroke-linecap="round" opacity="0.85"/>
          {:else if s.type === 'arrow'}
            <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} stroke-width={s.thickness} stroke-linecap="round" opacity="0.85"/>
            <path d={arrowHeadPath(s.x1 ?? 0, s.y1 ?? 0, s.x2 ?? 0, s.y2 ?? 0, s.thickness)} stroke={s.color} stroke-width={s.thickness} fill="none" stroke-linecap="round" opacity="0.85"/>
          {/if}
        {/if}

        {#each cursors as c (c.id)}
          {#if c.name !== identity.name}
            <g transform="translate({c.x}, {c.y})" pointer-events="none">
              <path d="M0 0 L 0 18 L 5 14 L 8 21 L 11 19 L 8 13 L 14 13 Z" fill={c.color} stroke="white" stroke-width="1"/>
              <text x="14" y="10" font-size="11" font-family="ui-sans-serif, system-ui, sans-serif" font-weight="600" fill={c.color}>{c.name}</text>
            </g>
          {/if}
        {/each}
      </svg>

      {#if textInput}
        <div class="wb-text-overlay">
          <textarea
            bind:this={textInputEl}
            bind:value={textInput.value}
            on:keydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); } else if (e.key === 'Escape') { textInput = null; } }}
            on:blur={commitText}
            placeholder={t(dict, 'whiteboard.textPlaceholder')}
            class="wb-text-input"
            style="left: {textInput.x / 1600 * 100}%; top: {textInput.y / 1000 * 100}%; color: {currentColor};"
          ></textarea>
        </div>
      {/if}
    </div>

    <div class="wb-footer">
      <div class="flex items-center gap-2">
        <span class="wb-status" class:wb-status--connected={connected}></span>
        <div class="flex items-center -space-x-1.5">
          <div class="wb-avatar wb-avatar--sm" style="background: {nameToGradient(identity.name)}" title={identity.name}>{myInitials}</div>
          {#each onlineUsers as user}
            <div class="wb-avatar wb-avatar--sm" style="background: {nameToGradient(user.name)}" title={user.name}>{user.initials}</div>
          {/each}
        </div>
      </div>
      <span class="wb-counter">{allShapes.length} {t(dict, 'whiteboard.shapes')}</span>
    </div>
  {/if}
</div>

<style>
  .wb-container {
    display: flex;
    flex-direction: column;
    height: 80vh;
    max-height: 820px;
    border-radius: 1rem;
    overflow: hidden;
    border: 1px solid rgba(228, 228, 231, 0.6);
    background: rgba(255, 255, 255, 0.6);
    backdrop-filter: blur(12px);
  }
  :global(.dark) .wb-container {
    border-color: rgba(39, 39, 42, 0.5);
    background: rgba(9, 9, 11, 0.6);
  }

  .wb-center {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
  }

  .wb-toolbar {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid rgba(228, 228, 231, 0.5);
    flex-wrap: wrap;
  }
  :global(.dark) .wb-toolbar { border-color: rgba(39, 39, 42, 0.4); }

  .wb-tools, .wb-colors, .wb-thicks {
    display: flex;
    align-items: center;
    gap: 0.2rem;
  }

  .wb-tool-btn, .wb-icon-btn {
    width: 30px; height: 30px;
    border-radius: 0.4rem;
    display: flex; align-items: center; justify-content: center;
    color: rgb(82, 82, 91);
    transition: background 0.15s, color 0.15s;
  }
  :global(.dark) .wb-tool-btn, :global(.dark) .wb-icon-btn {
    color: rgb(212, 212, 216);
  }
  .wb-tool-btn:hover, .wb-icon-btn:hover {
    background: rgba(16, 185, 129, 0.08);
    color: rgb(16, 185, 129);
  }
  .wb-tool-btn--active, .wb-icon-btn--active {
    background: rgba(16, 185, 129, 0.14);
    color: rgb(16, 185, 129);
  }

  .wb-divider {
    width: 1px; height: 18px;
    background: rgba(228, 228, 231, 0.7);
    margin: 0 0.25rem;
  }
  :global(.dark) .wb-divider { background: rgba(63, 63, 70, 0.5); }

  .wb-color-btn {
    width: 20px; height: 20px;
    border-radius: 9999px;
    border: 2px solid transparent;
    transition: transform 0.1s, border-color 0.15s;
  }
  .wb-color-btn:hover { transform: scale(1.1); }
  .wb-color-btn--active {
    border-color: rgb(16, 185, 129);
    transform: scale(1.1);
  }
  .wb-color-btn--custom {
    background: conic-gradient(
      from 90deg,
      #ef4444, #f97316, #f59e0b, #facc15, #84cc16,
      #10b981, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444
    );
    position: relative;
    overflow: hidden;
    cursor: pointer;
  }
  .wb-color-input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
    border: 0;
    padding: 0;
  }

  .wb-thick-btn {
    width: 22px; height: 22px;
    border-radius: 0.35rem;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.15s;
  }
  .wb-thick-btn:hover { background: rgba(16, 185, 129, 0.08); }
  .wb-thick-btn--active { background: rgba(16, 185, 129, 0.14); }
  .wb-thick-dot {
    border-radius: 9999px;
    background: currentColor;
    color: rgb(82, 82, 91);
  }
  :global(.dark) .wb-thick-dot { color: rgb(212, 212, 216); }

  .wb-spacer { flex: 1; }

  .wb-canvas-wrap {
    flex: 1;
    position: relative;
    overflow: hidden;
    background:
      radial-gradient(circle at 20px 20px, rgba(0,0,0,0.06) 1.5px, transparent 1.5px) 0 0/40px 40px,
      #ffffff;
  }

  .wb-canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
    cursor: crosshair;
  }
  .wb-canvas--locked { cursor: not-allowed; }

  .wb-text-overlay {
    position: absolute; inset: 0;
    pointer-events: none;
  }
  .wb-text-input {
    position: absolute;
    transform: translate(0, -100%);
    pointer-events: auto;
    background: rgba(255, 255, 255, 0.95);
    border: 1px solid rgb(16, 185, 129);
    border-radius: 4px;
    padding: 4px 6px;
    font-size: 14px;
    font-family: ui-sans-serif, system-ui, sans-serif;
    min-width: 120px;
    min-height: 28px;
    resize: none;
    outline: none;
  }

  .wb-share-banner {
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid rgba(16, 185, 129, 0.15);
    background: rgba(16, 185, 129, 0.04);
  }
  :global(.dark) .wb-share-banner {
    background: rgba(16, 185, 129, 0.06);
    border-color: rgba(16, 185, 129, 0.1);
  }
  .wb-share-value {
    flex: 1; min-width: 0;
    font-size: 12px; font-family: 'fira-code', monospace;
    color: rgb(63, 63, 70); background: rgba(244, 244, 245, 0.8);
    padding: 4px 8px; border-radius: 6px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  :global(.dark) .wb-share-value {
    color: rgb(212, 212, 216);
    background: rgba(39, 39, 42, 0.6);
  }
  .wb-share-copy {
    flex-shrink: 0; padding: 2px;
    color: rgb(161, 161, 170); transition: color 0.15s;
  }
  .wb-share-copy:hover { color: rgb(16, 185, 129); }

  .wb-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.85rem;
    border-top: 1px solid rgba(228, 228, 231, 0.5);
    font-size: 11px;
    color: rgb(113, 113, 122);
  }
  :global(.dark) .wb-footer { border-color: rgba(39, 39, 42, 0.4); color: rgb(161, 161, 170); }

  .wb-status {
    width: 8px; height: 8px; border-radius: 9999px;
    background: rgb(245, 158, 11);
    animation: wb-pulse 1.2s ease-in-out infinite;
  }
  .wb-status--connected {
    background: rgb(16, 185, 129);
    box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.2);
    animation: none;
  }
  @keyframes wb-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .wb-avatar {
    width: 34px; height: 34px; border-radius: 9999px;
    display: flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 800; color: white;
    flex-shrink: 0; letter-spacing: 0.02em;
    box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  }
  .wb-avatar--sm {
    width: 24px; height: 24px; font-size: 9px;
  }

  .wb-counter {
    font-variant-numeric: tabular-nums;
  }
</style>
