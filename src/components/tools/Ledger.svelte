<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import PartySocket from 'partysocket';
  import * as Y from 'yjs';
  import {
    deriveKeyFromPassword, encryptMessage, decryptMessage,
    encryptBytes, decryptBytes,
    generateIdentity, nameToGradient,
  } from '../../lib/ledgerCrypto';
  import { getTranslations, t } from '../../lib/i18n';

  export let locale = 'en';
  export let roomId = '';
  export let partyHost = 'encrypt-chat.danielsebesta.partykit.dev';

  $: dict = getTranslations(locale);

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
  let onlineUsers: { id: string; name: string; initials: string; color: string }[] = [];

  let sharePassword = '';
  let shareCopiedLink = false;
  let shareCopiedPass = false;
  let shareDismissed = false;

  let ydoc: Y.Doc;
  let yworkbook: Y.Map<string>;
  let spreadsheet: any = null;
  let sheetEl: HTMLDivElement;
  let pageHidden = false;
  let heartbeatInterval: ReturnType<typeof setInterval> | undefined;

  let lastSerialized = '';
  let applyingRemote = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const SAVE_DEBOUNCE_MS = 400;

  let pendingUpdates: Uint8Array[] = [];
  let updateFlushTimer: ReturnType<typeof setTimeout> | null = null;
  const UPDATE_BATCH_MS = 200;

  function getInitials(name: string): string {
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }
  function genId(): string {
    const arr = crypto.getRandomValues(new Uint8Array(8));
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  }

  async function initRoom() {
    if (typeof window === 'undefined') return;
    const stored = sessionStorage.getItem('ledger-password');
    const sharePass = sessionStorage.getItem('ledger-share-password');
    if (sharePass) {
      sharePassword = sharePass;
      sessionStorage.removeItem('ledger-share-password');
    }
    if (stored) {
      sessionStorage.removeItem('ledger-password');
      passwordInput = stored;
      await enterWithPassword(stored);
    } else {
      needsPassword = true;
    }
  }

  async function submitPassword() {
    passwordError = '';
    if (!passwordInput.trim()) { passwordError = t(dict, 'ledger.errorEnterPassword'); return; }
    await enterWithPassword(passwordInput.trim());
  }

  async function enterWithPassword(pwd: string) {
    try {
      cryptoKey = await deriveKeyFromPassword(pwd, roomId);
      needsPassword = false;
      setupYjs();
      connectWs();
    } catch {
      passwordError = t(dict, 'ledger.errorDeriveKey');
      needsPassword = true;
    }
  }

  function flushPendingUpdates() {
    updateFlushTimer = null;
    if (pendingUpdates.length === 0 || !cryptoKey || !ws || !verified) {
      pendingUpdates = [];
      return;
    }
    const merged = pendingUpdates.length === 1 ? pendingUpdates[0] : Y.mergeUpdates(pendingUpdates);
    pendingUpdates = [];
    sendDocUpdate(merged);
  }

  function setupYjs() {
    ydoc = new Y.Doc();
    yworkbook = ydoc.getMap('workbook');
    ydoc.on('update', (update: Uint8Array, origin: any) => {
      if (origin === 'remote') return;
      if (!cryptoKey || !ws || !verified) return;
      pendingUpdates.push(update);
      if (!updateFlushTimer) {
        updateFlushTimer = setTimeout(flushPendingUpdates, UPDATE_BATCH_MS);
      }
    });
    yworkbook.observe(() => {
      if (!spreadsheet) return;
      const incoming = yworkbook.get('data');
      if (!incoming || incoming === lastSerialized) return;
      try {
        applyingRemote = true;
        const parsed = JSON.parse(incoming);
        spreadsheet.loadData(parsed);
        lastSerialized = incoming;
      } catch {} finally {
        applyingRemote = false;
      }
    });
  }

  async function mountSpreadsheet() {
    if (!sheetEl || spreadsheet) return;
    const mod = await import('x-data-spreadsheet');
    await import('x-data-spreadsheet/dist/xspreadsheet.css');
    const Spreadsheet = (mod as any).default || (mod as any);

    spreadsheet = new Spreadsheet(sheetEl, {
      mode: 'edit',
      showToolbar: true,
      showGrid: true,
      showContextmenu: true,
      view: { height: () => sheetEl.clientHeight, width: () => sheetEl.clientWidth },
      row: { len: 100, height: 25 },
      col: { len: 26, width: 100, indexWidth: 60, minWidth: 60 },
    });

    const initial = yworkbook.get('data');
    if (initial) {
      try {
        applyingRemote = true;
        spreadsheet.loadData(JSON.parse(initial));
        lastSerialized = initial;
      } catch {} finally {
        applyingRemote = false;
      }
    }

    spreadsheet.change((data: any) => {
      if (applyingRemote) return;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const json = JSON.stringify(data);
        if (json === lastSerialized) return;
        lastSerialized = json;
        yworkbook.set('data', json);
      }, SAVE_DEBOUNCE_MS);
    });

    window.addEventListener('resize', () => {
      try { (spreadsheet as any).reRender(); } catch {}
    });
  }

  $: if (verified && sheetEl && !spreadsheet) mountSpreadsheet();

  async function sendDocUpdate(update: Uint8Array) {
    if (!cryptoKey || !ws) return;
    try {
      const payload = await encryptBytes(cryptoKey, update);
      ws.send(JSON.stringify({ type: 'envelope', kind: 'doc', payload, id: genId() }));
    } catch {}
  }

  function connectWs() {
    verifying = true;
    wrongPassword = false;
    ws = new PartySocket({
      host: partyHost,
      room: roomId,
      party: 'ledger',
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
    ws.addEventListener('close', () => { connected = false; });
    ws.addEventListener('error', () => {
      // WS error means TCP/upgrade/network problem — NOT a password issue.
      // Let PartySocket retry; the 4 s init-handler timeout (after presence > 1)
      // is the authoritative wrong-password signal.
    });
    ws.addEventListener('message', handleServerMessage);

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
      serverPresence = data.presence;
      if (verifying && serverPresence <= 1) { verified = true; verifying = false; }
      else if (verifying && serverPresence > 1) {
        setTimeout(() => {
          if (verifying && !verified) { wrongPassword = true; verifying = false; ws?.close(); }
        }, 4000);
      }
      return;
    }
    if (data.type === 'presence') { serverPresence = data.count; return; }
    if (data.type === 'peer-leave') {
      onlineUsers = onlineUsers.filter(u => u.id !== data.id);
      return;
    }
    if (data.type !== 'envelope') return;
    if (!cryptoKey) return;

    try {
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
          const ack = await encryptMessage(cryptoKey,
            JSON.stringify({ type: 'verify-ack', sender: identity.name, color: identity.color }));
          ws.send(JSON.stringify({ type: 'envelope', kind: 'verify-ack', payload: ack, id: 'vack-' + genId() }));
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
    } catch {}
  }

  function addOnlineUser(id: string, name: string, color: string) {
    if (!onlineUsers.find(u => u.name === name)) {
      onlineUsers = [...onlineUsers, { id: id || name, name, initials: getInitials(name), color }];
    }
  }

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

  function handleVisibility() {
    if (typeof document === 'undefined') return;
    pageHidden = document.hidden;
  }
  function beforeUnloadHandler(e: BeforeUnloadEvent) {
    e.preventDefault();
    e.returnValue = '';
  }
  $: if (typeof window !== 'undefined') {
    if (verified) window.addEventListener('beforeunload', beforeUnloadHandler);
    else window.removeEventListener('beforeunload', beforeUnloadHandler);
  }

  async function exportXlsx() {
    if (!spreadsheet) return;
    try {
      const XLSX: any = await import('xlsx');
      const data = spreadsheet.getData();
      const wb = XLSX.utils.book_new();
      const sheets = Array.isArray(data) ? data : [data];
      for (const sheet of sheets) {
        const rows: any[][] = [];
        const cells = sheet?.rows ?? {};
        for (const ri in cells) {
          const row: any[] = [];
          const rowCells = cells[ri]?.cells ?? {};
          for (const ci in rowCells) {
            row[+ci] = rowCells[ci]?.text ?? '';
          }
          rows[+ri] = row;
        }
        const ws = XLSX.utils.aoa_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, sheet?.name || 'Sheet');
      }
      XLSX.writeFile(wb, `ledger-${roomId}.xlsx`);
    } catch (e) {
      console.error('xlsx export failed', e);
    }
  }

  onMount(() => {
    initRoom();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', handleVisibility);
  });

  onDestroy(() => {
    try { (spreadsheet as any)?.destroy?.(); } catch {}
    ws?.close();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', handleVisibility);
    if (typeof window !== 'undefined') window.removeEventListener('beforeunload', beforeUnloadHandler);
    if (saveTimer) clearTimeout(saveTimer);
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    ydoc?.destroy();
  });
</script>

<div class="ledger-container">
  {#if wrongPassword}
    <div class="ledger-center">
      <div class="space-y-4 max-w-xs w-full text-center">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mx-auto text-red-500"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <p class="text-sm font-medium text-red-500">{t(dict, 'ledger.wrongPassword')}</p>
        <p class="text-xs text-zinc-400 dark:text-zinc-500 leading-relaxed">{t(dict, 'ledger.wrongPasswordDetail')}</p>
        <button class="btn-outline w-full text-xs" on:click={() => { wrongPassword = false; needsPassword = true; passwordInput = ''; }}>{t(dict, 'ledger.tryAgain')}</button>
      </div>
    </div>
  {:else if needsPassword}
    <div class="ledger-center">
      <div class="space-y-4 max-w-xs w-full">
        <div class="text-center space-y-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mx-auto text-emerald-500"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <p class="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t(dict, 'ledger.roomRequiresPassword')}</p>
          <p class="text-[10px] text-zinc-400 dark:text-zinc-500 leading-relaxed">{t(dict, 'ledger.roomPasswordHint')}</p>
        </div>
        <input
          type="password"
          class="input w-full"
          placeholder={t(dict, 'ledger.roomPasswordPlaceholder')}
          bind:value={passwordInput}
          on:keydown={(e) => e.key === 'Enter' && submitPassword()}
          autocomplete="off"
          data-lpignore="true"
          data-1p-ignore
          data-bwignore="true"
        />
        {#if passwordError}<p class="text-xs text-red-500">{passwordError}</p>{/if}
        <button class="btn w-full" on:click={submitPassword}>{t(dict, 'ledger.enterRoom')}</button>
      </div>
    </div>
  {:else if verifying}
    <div class="ledger-center">
      <div class="text-center space-y-2">
        <svg class="animate-spin mx-auto h-6 w-6 text-emerald-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
        <p class="text-xs text-zinc-400">{serverPresence > 1 ? t(dict, 'ledger.verifyingPassword') : t(dict, 'ledger.verifyingAlone')}</p>
      </div>
    </div>
  {:else}
    <div class="ledger-header">
      <div class="flex items-center gap-2">
        <span class="ledger-status" class:ledger-status--connected={connected}></span>
        <div class="flex items-center -space-x-1.5">
          <div class="ledger-avatar ledger-avatar--sm" style="background: {nameToGradient(identity.name)}" title={identity.name}>{myInitials}</div>
          {#each onlineUsers as user}
            <div class="ledger-avatar ledger-avatar--sm" style="background: {nameToGradient(user.name)}" title={user.name}>{user.initials}</div>
          {/each}
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button class="ledger-btn-tiny" on:click={exportXlsx} title={t(dict, 'ledger.exportXlsx')}>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          .xlsx
        </button>
      </div>
    </div>

    {#if sharePassword && !shareDismissed}
      <div class="ledger-share-banner">
        <div class="flex items-center justify-between mb-2">
          <span class="text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">{t(dict, 'ledger.sharePasswordWarning')}</span>
          <button class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors" on:click={() => { shareDismissed = true; }} aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="flex items-center gap-1.5 mb-1.5">
          <span class="text-[10px] text-zinc-400 w-8 shrink-0">{t(dict, 'ledger.roomLink')}</span>
          <code class="ledger-share-value">{typeof window !== 'undefined' ? window.location.href : ''}</code>
          <button class="ledger-share-copy" on:click={copyShareLink} aria-label="Copy link">
            {#if shareCopiedLink}
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-500"><polyline points="20 6 9 17 4 12"/></svg>
            {:else}
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            {/if}
          </button>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="text-[10px] text-zinc-400 w-8 shrink-0">{t(dict, 'ledger.password')}</span>
          <code class="ledger-share-value">{sharePassword}</code>
          <button class="ledger-share-copy" on:click={copySharePassword} aria-label="Copy password">
            {#if shareCopiedPass}
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-500"><polyline points="20 6 9 17 4 12"/></svg>
            {:else}
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            {/if}
          </button>
        </div>
      </div>
    {/if}

    <div class="ledger-sheet" bind:this={sheetEl}></div>
  {/if}
</div>

<style>
  .ledger-container {
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
  :global(.dark) .ledger-container {
    border-color: rgba(39, 39, 42, 0.5);
    background: rgba(9, 9, 11, 0.6);
  }
  .ledger-center {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    min-height: 60vh;
  }
  .ledger-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.6rem 1rem;
    border-bottom: 1px solid rgba(228, 228, 231, 0.5);
    background: rgba(255,255,255,0.4);
  }
  :global(.dark) .ledger-header { border-color: rgba(39, 39, 42, 0.4); background: rgba(24,24,27,0.4); }
  .ledger-status {
    width: 8px; height: 8px; border-radius: 9999px;
    background: rgb(245, 158, 11);
    animation: ledger-pulse 1.2s ease-in-out infinite;
  }
  .ledger-status--connected {
    background: rgb(16, 185, 129);
    box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.2);
    animation: none;
  }
  @keyframes ledger-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  .ledger-avatar {
    width: 24px; height: 24px; border-radius: 9999px;
    display: flex; align-items: center; justify-content: center;
    font-size: 9px; font-weight: 800; color: white;
    flex-shrink: 0; letter-spacing: 0.02em;
    box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  }
  .ledger-btn-tiny {
    display: inline-flex; align-items: center; gap: 0.3rem;
    padding: 0.25rem 0.55rem;
    font-size: 11px; font-weight: 600;
    color: rgb(82, 82, 91);
    border-radius: 0.4rem;
    transition: background 0.15s, color 0.15s;
  }
  :global(.dark) .ledger-btn-tiny { color: rgb(212, 212, 216); }
  .ledger-btn-tiny:hover {
    background: rgba(16, 185, 129, 0.1);
    color: rgb(16, 185, 129);
  }
  .ledger-share-banner {
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid rgba(16, 185, 129, 0.15);
    background: rgba(16, 185, 129, 0.04);
  }
  :global(.dark) .ledger-share-banner {
    background: rgba(16, 185, 129, 0.06);
    border-color: rgba(16, 185, 129, 0.1);
  }
  .ledger-share-value {
    flex: 1; min-width: 0;
    font-size: 12px; font-family: 'fira-code', monospace;
    color: rgb(63, 63, 70); background: rgba(244, 244, 245, 0.8);
    padding: 4px 8px; border-radius: 6px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  :global(.dark) .ledger-share-value {
    color: rgb(212, 212, 216);
    background: rgba(39, 39, 42, 0.6);
  }
  .ledger-share-copy {
    flex-shrink: 0; padding: 2px;
    color: rgb(161, 161, 170); transition: color 0.15s;
  }
  .ledger-share-copy:hover { color: rgb(16, 185, 129); }
  .ledger-sheet {
    flex: 1;
    overflow: hidden;
    background: white;
    position: relative;
    /* x-spreadsheet renders to <canvas> with sprite-based icons that don't
       respect CSS color. Trying to dark-theme it produces broken contrast
       (black icons on dark, light text on light overlay, etc.). Like Excel
       and Apple Numbers, the spreadsheet surface stays light regardless of
       the rest of the page theme. The light island is wrapped in our dark
       container, so the boundary is intentional. */
    color-scheme: light;
  }
</style>
