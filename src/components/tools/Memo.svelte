<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import PartySocket from 'partysocket';
  import * as Y from 'yjs';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import Collaboration from '@tiptap/extension-collaboration';
  import { TextStyle, Color, FontFamily, FontSize } from '@tiptap/extension-text-style';
  import Highlight from '@tiptap/extension-highlight';
  import TextAlign from '@tiptap/extension-text-align';
  import Underline from '@tiptap/extension-underline';
  import Link from '@tiptap/extension-link';
  import TiptapToolbar from './TiptapToolbar.svelte';
  import {
    deriveKeyFromPassword, encryptMessage, decryptMessage,
    encryptBytes, decryptBytes,
    generateIdentity, nameToGradient,
  } from '../../lib/memoCrypto';
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
  let yfragment: Y.XmlFragment;
  let undoMgr: Y.UndoManager | null = null;
  let editor: Editor | null = null;
  let editorEl: HTMLDivElement;
  let pageHidden = false;
  let heartbeatInterval: ReturnType<typeof setInterval> | undefined;

  // Force a Svelte rerender when editor selection / format state changes,
  // so toolbar buttons reflect the active marks.
  let selectionVersion = 0;

  let pendingUpdates: Uint8Array[] = [];
  let updateFlushTimer: ReturnType<typeof setTimeout> | null = null;
  const UPDATE_BATCH_MS = 150;

  const FONT_FAMILIES = [
    { label: 'Default', value: '' },
    { label: 'Arial', value: 'Arial, sans-serif' },
    { label: 'Helvetica', value: 'Helvetica, sans-serif' },
    { label: 'Inter', value: 'Inter, sans-serif' },
    { label: 'Roboto', value: 'Roboto, sans-serif' },
    { label: 'Times New Roman', value: '"Times New Roman", serif' },
    { label: 'Georgia', value: 'Georgia, serif' },
    { label: 'Courier New', value: '"Courier New", monospace' },
    { label: 'Fira Code', value: '"Fira Code", monospace' },
    { label: 'Verdana', value: 'Verdana, sans-serif' },
  ];
  const FONT_SIZES = ['10px','11px','12px','13px','14px','16px','18px','20px','24px','28px','32px','36px','48px'];
  const TEXT_COLORS = ['#0a0a0a','#404040','#737373','#dc2626','#ea580c','#ca8a04','#16a34a','#0891b2','#2563eb','#7c3aed','#db2777'];
  const HIGHLIGHT_COLORS = ['#fef08a','#fed7aa','#fecaca','#bbf7d0','#bae6fd','#ddd6fe','#fbcfe8','#e7e5e4'];

  function getInitials(name: string): string {
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }
  function genId(): string {
    const arr = crypto.getRandomValues(new Uint8Array(8));
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  }

  async function initRoom() {
    if (typeof window === 'undefined') return;
    const stored = sessionStorage.getItem('memo-password');
    const sharePass = sessionStorage.getItem('memo-share-password');
    if (sharePass) { sharePassword = sharePass; sessionStorage.removeItem('memo-share-password'); }
    if (stored) {
      sessionStorage.removeItem('memo-password');
      passwordInput = stored;
      await enterWithPassword(stored);
    } else {
      needsPassword = true;
    }
  }
  async function submitPassword() {
    passwordError = '';
    if (!passwordInput.trim()) { passwordError = t(dict, 'memo.errorEnterPassword'); return; }
    await enterWithPassword(passwordInput.trim());
  }
  async function enterWithPassword(pwd: string) {
    try {
      cryptoKey = await deriveKeyFromPassword(pwd, roomId);
      needsPassword = false;
      setupYjs();
      connectWs();
    } catch {
      passwordError = t(dict, 'memo.errorDeriveKey');
      needsPassword = true;
    }
  }

  function flushPendingUpdates() {
    updateFlushTimer = null;
    if (pendingUpdates.length === 0 || !cryptoKey || !ws || !verified) {
      pendingUpdates = []; return;
    }
    const merged = pendingUpdates.length === 1 ? pendingUpdates[0] : Y.mergeUpdates(pendingUpdates);
    pendingUpdates = [];
    sendDocUpdate(merged);
  }

  function setupYjs() {
    ydoc = new Y.Doc();
    yfragment = ydoc.getXmlFragment('memo');
    undoMgr = new Y.UndoManager(yfragment);
    ydoc.on('update', (update: Uint8Array, origin: any) => {
      if (origin === 'remote') return;
      if (!cryptoKey || !ws || !verified) return;
      pendingUpdates.push(update);
      if (!updateFlushTimer) updateFlushTimer = setTimeout(flushPendingUpdates, UPDATE_BATCH_MS);
    });
  }

  function mountEditor() {
    if (!editorEl || editor || !ydoc || !yfragment) return;
    editor = new Editor({
      element: editorEl,
      extensions: [
        StarterKit.configure({ history: false }),
        Underline,
        TextStyle,
        Color,
        FontFamily,
        FontSize,
        Highlight.configure({ multicolor: true }),
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { class: 'memo-link', rel: 'noopener noreferrer', target: '_blank' } }),
        Collaboration.configure({ document: ydoc, fragment: yfragment }),
      ],
      editorProps: {
        attributes: {
          class: 'memo-prose',
          spellcheck: 'true',
          'data-1p-ignore': '',
        },
      },
      onSelectionUpdate: () => { selectionVersion++; },
      onTransaction: () => { selectionVersion++; },
    });
  }

  $: if (verified && editorEl && !editor && yfragment) mountEditor();

  // ---- editor helpers (toolbar uses these) ----
  function isActive(name: string, attrs?: any) {
    selectionVersion; // dependency
    return !!(editor && editor.isActive(name, attrs));
  }
  function getAttr(name: string, attr: string) {
    selectionVersion;
    return editor?.getAttributes(name)?.[attr] ?? '';
  }

  function tbUndo() { undoMgr?.undo(); }
  function tbRedo() { undoMgr?.redo(); }
  function tbToggleBold() { editor?.chain().focus().toggleBold().run(); }
  function tbToggleItalic() { editor?.chain().focus().toggleItalic().run(); }
  function tbToggleUnderline() { editor?.chain().focus().toggleUnderline().run(); }
  function tbToggleStrike() { editor?.chain().focus().toggleStrike().run(); }
  function tbToggleCode() { editor?.chain().focus().toggleCode().run(); }
  function tbToggleBulletList() { editor?.chain().focus().toggleBulletList().run(); }
  function tbToggleOrderedList() { editor?.chain().focus().toggleOrderedList().run(); }
  function tbToggleQuote() { editor?.chain().focus().toggleBlockquote().run(); }
  function tbToggleCodeBlock() { editor?.chain().focus().toggleCodeBlock().run(); }
  function tbHr() { editor?.chain().focus().setHorizontalRule().run(); }
  function tbAlign(value: 'left'|'center'|'right'|'justify') {
    editor?.chain().focus().setTextAlign(value).run();
  }
  function tbHeading(level: '0'|'1'|'2'|'3') {
    if (!editor) return;
    if (level === '0') editor.chain().focus().setParagraph().run();
    else editor.chain().focus().toggleHeading({ level: parseInt(level, 10) as 1 | 2 | 3 }).run();
  }
  function tbFontFamily(value: string) {
    if (!editor) return;
    if (!value) editor.chain().focus().unsetFontFamily().run();
    else editor.chain().focus().setFontFamily(value).run();
  }
  function tbFontSize(value: string) {
    if (!editor) return;
    if (!value) (editor.chain() as any).focus().unsetFontSize().run();
    else (editor.chain() as any).focus().setFontSize(value).run();
  }
  function tbColor(value: string) {
    if (!value) editor?.chain().focus().unsetColor().run();
    else editor?.chain().focus().setColor(value).run();
  }
  function tbHighlight(value: string) {
    if (!editor) return;
    if (!value) editor.chain().focus().unsetHighlight().run();
    else editor.chain().focus().toggleHighlight({ color: value }).run();
  }
  function tbLink() {
    const url = window.prompt(t(dict, 'memo.linkPrompt'));
    if (url === null) return;
    if (url === '') {
      editor?.chain().focus().unsetLink().run();
      return;
    }
    editor?.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }
  function tbClearFormatting() {
    editor?.chain().focus().clearNodes().unsetAllMarks().run();
  }

  function activeHeading(): string {
    if (isActive('heading', { level: 1 })) return '1';
    if (isActive('heading', { level: 2 })) return '2';
    if (isActive('heading', { level: 3 })) return '3';
    return '0';
  }

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
      host: partyHost, room: roomId, party: 'memo',
      minReconnectionDelay: 500, maxReconnectionDelay: 8000,
      reconnectionDelayGrowFactor: 1.4, connectionTimeout: 8000, maxRetries: Infinity,
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
      // network/upgrade issue, not a password issue. PartySocket retries.
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
    if (data.type === 'peer-leave') { onlineUsers = onlineUsers.filter(u => u.id !== data.id); return; }
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
    try { await navigator.clipboard.writeText(window.location.href); shareCopiedLink = true; setTimeout(() => { shareCopiedLink = false; }, 1500); } catch {}
  }
  async function copySharePassword() {
    try { await navigator.clipboard.writeText(sharePassword); shareCopiedPass = true; setTimeout(() => { shareCopiedPass = false; }, 1500); } catch {}
  }

  function handleVisibility() {
    if (typeof document === 'undefined') return;
    pageHidden = document.hidden;
  }
  function beforeUnloadHandler(e: BeforeUnloadEvent) { e.preventDefault(); e.returnValue = ''; }
  function handleKeydown(e: KeyboardEvent) {
    // Yjs UndoManager — Tiptap's history is disabled because Collaboration owns the doc.
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault(); undoMgr?.undo();
    } else if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault(); undoMgr?.redo();
    }
  }
  $: if (typeof window !== 'undefined') {
    if (verified) window.addEventListener('beforeunload', beforeUnloadHandler);
    else window.removeEventListener('beforeunload', beforeUnloadHandler);
  }

  onMount(() => {
    initRoom();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', handleVisibility);
    if (typeof window !== 'undefined') window.addEventListener('keydown', handleKeydown);
  });

  onDestroy(() => {
    editor?.destroy();
    ws?.close();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', handleVisibility);
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', beforeUnloadHandler);
      window.removeEventListener('keydown', handleKeydown);
    }
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    ydoc?.destroy();
  });
</script>

<div class="memo-container">
  {#if wrongPassword}
    <div class="memo-center">
      <div class="space-y-4 max-w-xs w-full text-center">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mx-auto text-red-500"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <p class="text-sm font-medium text-red-500">{t(dict, 'memo.wrongPassword')}</p>
        <p class="text-xs text-zinc-400 dark:text-zinc-500 leading-relaxed">{t(dict, 'memo.wrongPasswordDetail')}</p>
        <button class="btn-outline w-full text-xs" on:click={() => { wrongPassword = false; needsPassword = true; passwordInput = ''; }}>{t(dict, 'memo.tryAgain')}</button>
      </div>
    </div>
  {:else if needsPassword}
    <div class="memo-center">
      <div class="space-y-4 max-w-xs w-full">
        <div class="text-center space-y-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mx-auto text-emerald-500"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <p class="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t(dict, 'memo.roomRequiresPassword')}</p>
          <p class="text-[10px] text-zinc-400 dark:text-zinc-500 leading-relaxed">{t(dict, 'memo.roomPasswordHint')}</p>
        </div>
        <input
          type="password" class="input w-full"
          placeholder={t(dict, 'memo.roomPasswordPlaceholder')}
          bind:value={passwordInput}
          on:keydown={(e) => e.key === 'Enter' && submitPassword()}
          autocomplete="off" data-lpignore="true" data-1p-ignore data-bwignore="true"
        />
        {#if passwordError}<p class="text-xs text-red-500">{passwordError}</p>{/if}
        <button class="btn w-full" on:click={submitPassword}>{t(dict, 'memo.enterRoom')}</button>
      </div>
    </div>
  {:else if verifying}
    <div class="memo-center">
      <div class="text-center space-y-2">
        <svg class="animate-spin mx-auto h-6 w-6 text-emerald-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
        <p class="text-xs text-zinc-400">{serverPresence > 1 ? t(dict, 'memo.verifyingPassword') : t(dict, 'memo.verifyingAlone')}</p>
      </div>
    </div>
  {:else}
    <div class="memo-header">
      <div class="flex items-center gap-2">
        <span class="memo-status" class:memo-status--connected={connected}></span>
        <div class="flex items-center -space-x-1.5">
          <div class="memo-avatar memo-avatar--sm" style="background: {nameToGradient(identity.name)}" title={identity.name}>{myInitials}</div>
          {#each onlineUsers as user}
            <div class="memo-avatar memo-avatar--sm" style="background: {nameToGradient(user.name)}" title={user.name}>{user.initials}</div>
          {/each}
        </div>
      </div>
      <div class="text-[10px] text-zinc-400 dark:text-zinc-500">{t(dict, 'memo.headerHint')}</div>
    </div>

    {#if sharePassword && !shareDismissed}
      <div class="memo-share-banner">
        <div class="flex items-center justify-between mb-2">
          <span class="text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">{t(dict, 'memo.sharePasswordWarning')}</span>
          <button class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors" on:click={() => { shareDismissed = true; }} aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="flex items-center gap-1.5 mb-1.5">
          <span class="text-[10px] text-zinc-400 w-8 shrink-0">{t(dict, 'memo.roomLink')}</span>
          <code class="memo-share-value">{typeof window !== 'undefined' ? window.location.href : ''}</code>
          <button class="memo-share-copy" on:click={copyShareLink} aria-label="Copy link">
            {#if shareCopiedLink}
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-500"><polyline points="20 6 9 17 4 12"/></svg>
            {:else}
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            {/if}
          </button>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="text-[10px] text-zinc-400 w-8 shrink-0">{t(dict, 'memo.password')}</span>
          <code class="memo-share-value">{sharePassword}</code>
          <button class="memo-share-copy" on:click={copySharePassword} aria-label="Copy password">
            {#if shareCopiedPass}
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-500"><polyline points="20 6 9 17 4 12"/></svg>
            {:else}
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            {/if}
          </button>
        </div>
      </div>
    {/if}

    <TiptapToolbar editor={editor} undoMgr={undoMgr} dict={dict} {selectionVersion} />

    <div class="memo-editor-wrap">
      <div bind:this={editorEl} class="memo-editor"></div>
    </div>
  {/if}
</div>

<style>
  .memo-container {
    display: flex; flex-direction: column;
    min-height: 70vh;
    border-radius: 1rem;
    overflow: hidden;
    border: 1px solid rgba(228, 228, 231, 0.6);
    background: rgba(255, 255, 255, 0.6);
    backdrop-filter: blur(12px);
  }
  :global(.dark) .memo-container {
    border-color: rgba(39, 39, 42, 0.5);
    background: rgba(9, 9, 11, 0.6);
  }
  .memo-center { flex: 1; display: flex; align-items: center; justify-content: center; padding: 2rem; min-height: 60vh; }
  .memo-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0.6rem 1rem;
    border-bottom: 1px solid rgba(228, 228, 231, 0.5);
  }
  :global(.dark) .memo-header { border-color: rgba(39, 39, 42, 0.4); }
  .memo-status {
    width: 8px; height: 8px; border-radius: 9999px;
    background: rgb(245, 158, 11);
    animation: memo-pulse 1.2s ease-in-out infinite;
  }
  .memo-status--connected {
    background: rgb(16, 185, 129);
    box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.2);
    animation: none;
  }
  @keyframes memo-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
  .memo-avatar {
    width: 24px; height: 24px; border-radius: 9999px;
    display: flex; align-items: center; justify-content: center;
    font-size: 9px; font-weight: 800; color: white;
    flex-shrink: 0; letter-spacing: 0.02em;
    box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  }

  .memo-share-banner {
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid rgba(16, 185, 129, 0.15);
    background: rgba(16, 185, 129, 0.04);
  }
  :global(.dark) .memo-share-banner { background: rgba(16, 185, 129, 0.06); border-color: rgba(16, 185, 129, 0.1); }
  .memo-share-value {
    flex: 1; min-width: 0;
    font-size: 12px; font-family: 'fira-code', monospace;
    color: rgb(63, 63, 70); background: rgba(244, 244, 245, 0.8);
    padding: 4px 8px; border-radius: 6px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  :global(.dark) .memo-share-value { color: rgb(212, 212, 216); background: rgba(39, 39, 42, 0.6); }
  .memo-share-copy { flex-shrink: 0; padding: 2px; color: rgb(161, 161, 170); transition: color 0.15s; }
  .memo-share-copy:hover { color: rgb(16, 185, 129); }

  /* === TOOLBAR === */
  .memo-toolbar {
    display: flex; align-items: center; gap: 0.25rem;
    padding: 0.4rem 0.75rem;
    border-bottom: 1px solid rgba(228, 228, 231, 0.5);
    background: rgba(244, 244, 245, 0.5);
    flex-wrap: wrap;
  }
  :global(.dark) .memo-toolbar {
    border-bottom-color: rgba(39, 39, 42, 0.4);
    background: rgba(24, 24, 27, 0.4);
  }
  .mt-btn {
    min-width: 28px; height: 28px; padding: 0 6px;
    border-radius: 0.4rem;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 600;
    color: rgb(82, 82, 91);
    transition: background 0.12s, color 0.12s;
    position: relative;
  }
  :global(.dark) .mt-btn { color: rgb(212, 212, 216); }
  .mt-btn:hover { background: rgba(16, 185, 129, 0.1); color: rgb(16, 185, 129); }
  .mt-btn--active { background: rgba(16, 185, 129, 0.16); color: rgb(16, 185, 129); }
  .mt-divider {
    width: 1px; height: 18px;
    background: rgba(228, 228, 231, 0.7);
    margin: 0 0.2rem;
  }
  :global(.dark) .mt-divider { background: rgba(63, 63, 70, 0.5); }
  .mt-select {
    height: 28px;
    padding: 0 0.4rem;
    border-radius: 0.4rem;
    background: white;
    color: rgb(63, 63, 70);
    border: 1px solid rgba(228, 228, 231, 0.7);
    font-size: 12px;
    cursor: pointer;
    max-width: 130px;
  }
  .mt-select--wide { max-width: 160px; }
  :global(.dark) .mt-select {
    background: rgb(39, 39, 42);
    color: rgb(212, 212, 216);
    border-color: rgba(63, 63, 70, 0.6);
  }
  .mt-color-icon { font-weight: 800; line-height: 1; font-size: 13px; }
  .mt-color-bar { display: block; width: 16px; height: 3px; border-radius: 1px; margin-left: 3px; }

  /* Color popovers */
  .mt-popover { position: relative; }
  .mt-popover .mt-pop {
    position: absolute;
    top: calc(100% + 4px); left: 0;
    background: white;
    border: 1px solid rgba(228, 228, 231, 0.7);
    border-radius: 0.5rem;
    padding: 0.5rem;
    box-shadow: 0 6px 20px rgba(0,0,0,0.08);
    opacity: 0; transform: translateY(-4px);
    pointer-events: none;
    transition: opacity 0.15s, transform 0.15s;
    z-index: 30;
    min-width: 180px;
  }
  :global(.dark) .mt-popover .mt-pop {
    background: rgb(39, 39, 42);
    border-color: rgba(63, 63, 70, 0.6);
  }
  .mt-popover:hover .mt-pop,
  .mt-popover:focus-within .mt-pop {
    opacity: 1; transform: translateY(0);
    pointer-events: auto;
  }
  .mt-pop-grid {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 4px;
  }
  .mt-color-cell {
    width: 18px; height: 18px;
    border-radius: 4px;
    border: 1px solid rgba(0,0,0,0.1);
    transition: transform 0.1s;
  }
  .mt-color-cell:hover { transform: scale(1.15); }
  .mt-pop-clear {
    margin-top: 6px;
    width: 100%;
    padding: 4px;
    font-size: 11px; font-weight: 600;
    color: rgb(113, 113, 122);
    border-top: 1px solid rgba(228, 228, 231, 0.6);
    padding-top: 6px;
  }
  :global(.dark) .mt-pop-clear { border-top-color: rgba(63, 63, 70, 0.5); color: rgb(161, 161, 170); }
  .mt-pop-clear:hover { color: rgb(16, 185, 129); }

  /* === EDITOR === */
  .memo-editor-wrap {
    flex: 1;
    padding: 1.5rem 2rem;
    overflow-y: auto;
    background: #ffffff;
  }
  :global(.dark) .memo-editor-wrap { background: rgb(24, 24, 27); }
  .memo-editor {
    max-width: 740px;
    margin: 0 auto;
    min-height: 50vh;
  }
  :global(.memo-prose) {
    outline: none;
    font-size: 16px;
    line-height: 1.65;
    color: rgb(24, 24, 27);
  }
  :global(.dark) :global(.memo-prose) { color: rgb(228, 228, 231); }
  :global(.memo-prose h1) { font-size: 1.875rem; font-weight: 800; margin: 1.5rem 0 1rem; }
  :global(.memo-prose h2) { font-size: 1.5rem; font-weight: 700; margin: 1.5rem 0 0.75rem; }
  :global(.memo-prose h3) { font-size: 1.25rem; font-weight: 700; margin: 1.25rem 0 0.5rem; }
  :global(.memo-prose p) { margin: 0.5rem 0; }
  :global(.memo-prose ul), :global(.memo-prose ol) { margin: 0.5rem 0 0.5rem 1.5rem; }
  :global(.memo-prose ul) { list-style: disc; }
  :global(.memo-prose ol) { list-style: decimal; }
  :global(.memo-prose li) { margin: 0.25rem 0; }
  :global(.memo-prose code) {
    font-family: 'fira-code', monospace; font-size: 0.875em;
    background: rgba(16, 185, 129, 0.08); border-radius: 4px;
    padding: 2px 5px;
  }
  :global(.dark) :global(.memo-prose code) { background: rgba(16, 185, 129, 0.12); }
  :global(.memo-prose pre) {
    font-family: 'fira-code', monospace; font-size: 0.875em;
    background: rgba(0, 0, 0, 0.04); border-radius: 8px;
    padding: 0.75rem 1rem; margin: 0.75rem 0;
    overflow-x: auto;
  }
  :global(.dark) :global(.memo-prose pre) { background: rgba(255, 255, 255, 0.05); }
  :global(.memo-prose blockquote) {
    border-left: 3px solid rgba(16, 185, 129, 0.4);
    padding-left: 0.75rem;
    margin: 0.5rem 0;
    color: rgb(113, 113, 122);
  }
  :global(.memo-prose strong) { font-weight: 700; }
  :global(.memo-prose em) { font-style: italic; }
  :global(.memo-prose u) { text-decoration: underline; }
  :global(.memo-prose s) { text-decoration: line-through; opacity: 0.6; }
  :global(.memo-prose hr) {
    border: none;
    border-top: 1px solid rgba(228, 228, 231, 0.7);
    margin: 1.5rem 0;
  }
  :global(.dark) :global(.memo-prose hr) { border-top-color: rgba(63, 63, 70, 0.5); }
  :global(.memo-prose mark) {
    background-color: rgba(254, 240, 138, 0.6);
    padding: 0 2px;
    border-radius: 2px;
  }
  :global(.memo-link) {
    color: rgb(16, 185, 129);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
</style>
