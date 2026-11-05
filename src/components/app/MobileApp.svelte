<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    App,
    Page,
    Navbar,
    NavbarBackLink,
    Tabbar,
    TabbarLink,
    ToolbarPane,
    Icon,
    BlockTitle,
    List,
    ListItem,
    ListInput,
    Button,
    Searchbar,
    Segmented,
    SegmentedButton,
    Sheet,
    Toggle,
    Dialog,
    DialogButton,
    Fab,
    Toast,
    Actions,
    ActionsGroup,
    ActionsLabel,
    ActionsButton,
    Radio,
    Range,
  } from 'konsta/svelte';

  import AppIcons from './AppIcons.svelte';
  import ChatRoom from '../tools/ChatRoom.svelte';
  import Whiteboard from '../tools/Whiteboard.svelte';
  import UltimateEncrypt from '../tools/UltimateEncrypt.svelte';

  import {
    listRooms,
    compareRooms,
    forgetEverything,
    getRoom,
    saveRoom,
    setRoomPinned,
    renameRoom,
    forgetRoom,
    touchRoom,
    validRoomId,
    encodeVaultBackup,
    decodeVaultBackup,
    importVaultRows,
    vaultState,
    unlockVault,
    revealSecret,
    type VaultState,
    type RoomEntry,
  } from '../../lib/roomVault';
  import { forgetChatIdentity } from '../../lib/chatIdentity';
  import { forgetSharePasswords } from '../../lib/sharePasswordVault';
  import { identiconBackground } from '../../lib/identicon';
  import { passwordLongEnough, RETENTION_SECONDS, formatDuration, type ChatMode } from '../../lib/chatRoomSettings';
  import { genRoomPassphrase } from '../../lib/roomPassphrase';
  import { languages, locales, type Locale } from '../../lib/languages';
  import { t } from '../../lib/t';
  import { installSheetSwipe } from '../../lib/sheetSwipe';
  import { haptic } from '../../lib/haptics';
  import { clearLock, enableLock, lockSupported, confirmPresence, shouldLock, storedLock, unlock } from '../../lib/appLock';
  import { installViewportSync } from '../../lib/viewportSync';
  import { CURRENT_VERSION, isDevBuild, fetchLatestVersion, describeVersion, type AppVersion } from '../../lib/appVersion';
  import {
    applyTheme,
    loadThemeState,
    DEFAULT_SEED,
    type AppPlatform,
    type AppAppearance,
    type AppScheme,
  } from '../../lib/appTheme';

  let { locale = 'en', dict = {} }: { locale?: string; dict?: Record<string, string> } = $props();

  type ViewState = 'hub' | 'room' | 'board';
  type TabId = 'chats' | 'files' | 'boards' | 'settings';

  // Chromium-only install event; not in the DOM lib yet.
  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  }

  let activeView = $state<ViewState>('hub');
  let activeRoomId = $state('');
  let activeRoomLabel = $state('');
  let activeTab = $state<TabId>('chats');
  let boardReturnRoom = $state<string | null>(null);

  let platform = $state<AppPlatform>('ios');
  let appearance = $state<AppAppearance>('system');
  let scheme = $state<AppScheme>('dark');
  let seed = $state<string>(DEFAULT_SEED);
  let haptics = $state(true);
  let ready = $state(false);

  let isStandalone = $state(false);
  let deferredInstallPrompt = $state<BeforeInstallPromptEvent | null>(null);
  let showIosInstallSheet = $state(false);

  let rooms = $state<RoomEntry[]>([]);
  let searchQuery = $state('');
  let chatFilter = $state<'all' | 'live' | 'pinned'>('all');
  let newRoomSheetOpen = $state(false);
  let joinRoomSheetOpen = $state(false);
  let langSheetOpen = $state(false);
  let panicDialogOpen = $state(false);
  let vaultExportOpen = $state(false);
  let vaultExportPw = $state('');
  let vaultExportBusy = $state(false);
  let vaultImportOpen = $state(false);
  let vaultImportPw = $state('');
  let vaultImportBusy = $state(false);
  let vaultImportError = $state('');
  let vaultImportInput: HTMLInputElement | null = null;
  let clearBoardDialogOpen = $state(false);
  let pendingClearBoard = $state<(() => void) | null>(null);
  let actionsRoom = $state<RoomEntry | null>(null);
  let actionTarget = $state<RoomEntry | null>(null);
  let roomConn = $state<'connected' | 'connecting' | 'offline'>('connected');
  let roomCall = $state<(() => void) | undefined>(undefined);
  let roomMenu = $state<(() => void) | undefined>(undefined);
  let roomInfo = $state<(() => void) | undefined>(undefined);
  let roomCallState = $state<{ ready: boolean; joining: boolean; active: boolean }>({ ready: false, joining: false, active: false });
  let roomReconnect = $state<(() => void) | null>(null);
  let renameDialogOpen = $state(false);
  let renameValue = $state('');
  let deleteDialogOpen = $state(false);
  let lpTimer: ReturnType<typeof setTimeout> | undefined;
  let lpFired = false;
  let lastRowFocus: HTMLElement | null = null;
  let lpX = 0;
  let lpY = 0;

  let newRoomName = $state('');
  let newRoomPassword = $state('');
  let newRoomKind = $state<'chat' | 'whiteboard'>('chat');
  let newRoomPwError = $state(false);
  let newRoomMode = $state<'live' | 'ttl'>('live');
  let retentionIndex = $state(RETENTION_SECONDS.indexOf(3600));
  let showNewPw = $state(false);
  const retentionSeconds = $derived(RETENTION_SECONDS[retentionIndex] ?? 3600);
  const retentionLabel = $derived(t(dict, 'chat.retentionTtl').replace('{time}', formatDuration(retentionSeconds, locale)));
  let joinRoomId = $state('');
  let joinRoomPassword = $state('');
  let roomEnteredViaPush = $state(false);
  // A lightweight history entry kept while an overlay is open so the first
  // system-back press dismisses the overlay instead of leaving /app.
  let overlayGuard = $state(false);
  let scroller = $state<HTMLElement | null>(null);
  const tabScroll: Record<TabId, number> = { chats: 0, files: 0, boards: 0, settings: 0 };
  let toastMessage = $state('');
  let toastOpen = $state(false);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  let openOverlays: Record<string, boolean> = {};

  $effect(() => {
    const now: Record<string, boolean> = {
      newRoom: newRoomSheetOpen,
      join: joinRoomSheetOpen,
      lang: langSheetOpen,
      install: showIosInstallSheet,
      panic: panicDialogOpen,
      clearBoard: clearBoardDialogOpen,
      vaultExport: vaultExportOpen,
      vaultImport: vaultImportOpen,
      actions: actionsRoom !== null,
      rename: renameDialogOpen,
      del: deleteDialogOpen,
    };
    const opened = Object.keys(now).filter((key) => now[key] && !openOverlays[key]);
    if (!opened.length) {
      openOverlays = now;
      return;
    }
    if (!Object.values(openOverlays).some(Boolean)) pushOverlayGuard();
    const keep = opened[opened.length - 1];
    if (keep !== 'newRoom' && newRoomSheetOpen) closeNewRoomSheet(false);
    if (keep !== 'join' && joinRoomSheetOpen) closeJoinRoomSheet(false);
    if (keep !== 'lang') langSheetOpen = false;
    if (keep !== 'install') showIosInstallSheet = false;
    if (keep !== 'panic') panicDialogOpen = false;
    if (keep !== 'clearBoard') clearBoardDialogOpen = false;
    if (keep !== 'vaultExport') vaultExportOpen = false;
    if (keep !== 'vaultImport') vaultImportOpen = false;
    if (keep !== 'actions') actionsRoom = null;
    if (keep !== 'rename') renameDialogOpen = false;
    if (keep !== 'del') deleteDialogOpen = false;
    openOverlays = { [keep]: true };
    toastOpen = false;
  });

  function showToast(message: string, haptic: 'warning' | 'success' = 'warning') {
    toastMessage = message;
    toastOpen = true;
    triggerHaptic(haptic);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastOpen = false), 5000);
  }

  function triggerHaptic(type: 'light' | 'medium' | 'success' | 'warning' = 'light') {
    haptic(type);
  }

  function pushOverlayGuard() {
    if (overlayGuard) return;
    overlayGuard = true;
    const entry =
      activeView === 'hub'
        ? { view: 'hub', tab: activeTab, overlay: true }
        : { view: activeView, roomId: activeRoomId, kind: activeView === 'board' ? 'whiteboard' : 'chat', label: activeRoomLabel, overlay: true };
    window.history.pushState(entry, '', window.location.href);
  }

  function consumeOverlayGuard() {
    if (!overlayGuard) return;
    overlayGuard = false;
    window.history.back();
  }

  function pushViewState(entry: Record<string, string | boolean>, url: string) {
    if (overlayGuard) {
      overlayGuard = false;
      window.history.replaceState(entry, '', url);
    } else {
      window.history.pushState(entry, '', url);
    }
  }

  async function loadRooms() {
    if (wiping) return;
    try {
      const stored = await listRooms();
      if (wiping) return;
      rooms = stored.sort(compareRooms);
      if (activeRoomId && !activeRoomLabel) {
        activeRoomLabel = labelForRoom(activeRoomId, '', activeView === 'board' ? 'whiteboard' : 'chat');
      }
    } catch {
      rooms = [];
    }
  }

  function tabForKind(kind: 'chat' | 'whiteboard'): TabId {
    return kind === 'whiteboard' ? 'boards' : 'chats';
  }

  function normalizeRoomId(raw: string): string {
    return raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function labelForRoom(id: string, fallback = '', kind?: 'chat' | 'whiteboard'): string {
    const match = (kind ? rooms.find((r) => r.roomId === id && r.kind === kind) : rooms.find((r) => r.roomId === id))?.label;
    return match || fallback;
  }

  function restoreHubScroll() {
    void tick().then(() => {
      if (scroller) scroller.scrollTop = tabScroll[activeTab];
    });
  }

  function enterRoom(id: string, kind: 'chat' | 'whiteboard' = 'chat', label = '', bump = true) {
    triggerHaptic('medium');
    if (scroller) tabScroll[activeTab] = scroller.scrollTop;
    roomConn = 'connecting';
    roomReconnect = null;
    activeRoomId = id;
    activeRoomLabel = label;
    activeTab = tabForKind(kind);
    activeView = kind === 'whiteboard' ? 'board' : 'room';
    boardReturnRoom = null;
    roomEnteredViaPush = true;
    pushViewState({ view: activeView, roomId: id, kind, label }, `?room=${encodeURIComponent(id)}&kind=${kind}`);
    if (bump) void touchRoom(kind, id).then(loadRooms).catch(() => {});
  }

  // A saved room opens with its passkey-sealed password and stored mode, so one that expired on the server is made again instead of showing a dead end.
  async function openSavedRoom(room: RoomEntry) {
    if (room.kind !== 'whiteboard') {
      try { sessionStorage.setItem('chat-room-config', JSON.stringify({ mode: room.mode, authMode: 'password', createdAt: Date.now(), v: 3 })); } catch {}
    }
    if (room.secret && (await unlockVault())) {
      const secret = await revealSecret(room);
      if (secret) {
        try {
          if (room.kind === 'whiteboard') {
            sessionStorage.setItem('whiteboard-password', secret.value);
            sessionStorage.setItem(`wb-pw:${room.roomId}`, secret.value);
          } else {
            sessionStorage.setItem('chat-password', secret.value);
            sessionStorage.setItem('chat-share-password', secret.value);
            sessionStorage.setItem(`chat-pw:${room.roomId}`, secret.value);
          }
        } catch {}
      }
    }
    enterRoom(room.roomId, room.kind, room.label);
  }

  async function savedRoomPassword(): Promise<string | null> {
    const room = await getRoom('chat', activeRoomId).catch(() => null);
    if (!room?.secret || !(await unlockVault())) return null;
    return (await revealSecret(room))?.value ?? null;
  }

  function openBoardInvite(roomId: string, password: string) {
    boardReturnRoom = activeView === 'room' ? activeRoomId : null;
    roomConn = 'connecting';
    roomReconnect = null;
    activeRoomId = roomId;
    activeRoomLabel = labelForRoom(roomId, '', 'whiteboard');
    activeView = 'board';
    roomEnteredViaPush = true;
    if (password) {
      try {
        sessionStorage.setItem('whiteboard-password', password);
        sessionStorage.setItem(`wb-pw:${roomId}`, password);
      } catch {}
    }
    persistRoom('whiteboard', roomId, roomId);
    pushViewState({ view: 'board', roomId, kind: 'whiteboard', label: activeRoomLabel }, `?room=${encodeURIComponent(roomId)}&kind=whiteboard`);
  }

  function leaveRoom() {
    triggerHaptic('light');
    if (roomEnteredViaPush) {
      roomEnteredViaPush = false;
      const skip = overlayGuard ? -2 : -1;
      overlayGuard = false;
      window.history.go(skip);
      return;
    }
    activeView = 'hub';
    activeRoomId = '';
    activeRoomLabel = '';
    roomConn = 'connected';
    roomReconnect = null;
    boardReturnRoom = null;
    window.history.replaceState({ view: 'hub', tab: activeTab }, '', `?tab=${activeTab}`);
    loadRooms();
    restoreHubScroll();
  }

  function switchTab(tab: TabId) {
    triggerHaptic('light');
    if (tab === activeTab) {
      // Native behavior: re-tapping the active tab scrolls its content to top.
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      scroller?.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
      return;
    }
    if (scroller) tabScroll[activeTab] = scroller.scrollTop;
    activeTab = tab;
    searchQuery = '';
    chatFilter = 'all';
    window.history.replaceState({ view: 'hub', tab }, '', `?tab=${tab}`);
    restoreHubScroll();
  }

  function closeNewRoomSheet(popGuard = true) {
    newRoomSheetOpen = false;
    newRoomName = '';
    newRoomPassword = '';
    newRoomPwError = false;
    newRoomMode = 'live';
    retentionIndex = RETENTION_SECONDS.indexOf(3600);
    showNewPw = false;
    creatingRoom = false;
    if (popGuard) consumeOverlayGuard();
  }

  function closeJoinRoomSheet(popGuard = true) {
    joinRoomSheetOpen = false;
    joinRoomId = '';
    joinRoomPassword = '';
    joiningRoom = false;
    if (popGuard) consumeOverlayGuard();
  }

  function closeTopOverlay() {
    if (newRoomSheetOpen) { closeNewRoomSheet(); return; }
    if (joinRoomSheetOpen) { closeJoinRoomSheet(); return; }
    if (langSheetOpen) { langSheetOpen = false; consumeOverlayGuard(); return; }
    if (showIosInstallSheet) { showIosInstallSheet = false; consumeOverlayGuard(); return; }
    if (panicDialogOpen) { panicDialogOpen = false; consumeOverlayGuard(); return; }
    if (vaultExportOpen) { vaultExportOpen = false; vaultExportPw = ''; consumeOverlayGuard(); return; }
    if (vaultImportOpen) { vaultImportOpen = false; vaultImportPw = ''; vaultImportError = ''; consumeOverlayGuard(); return; }
    if (clearBoardDialogOpen) { clearBoardDialogOpen = false; pendingClearBoard = null; consumeOverlayGuard(); return; }
    if (actionsRoom) { closeRowActions(); return; }
    if (renameDialogOpen) { renameDialogOpen = false; endRowInteraction(); consumeOverlayGuard(); return; }
    if (deleteDialogOpen) { deleteDialogOpen = false; endRowInteraction(); consumeOverlayGuard(); }
  }

  function openRowActions(room: RoomEntry) {
    triggerHaptic('medium');
    lastRowFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    actionTarget = room;
    actionsRoom = room;
  }

  function endRowInteraction() {
    actionTarget = null;
    if (lastRowFocus?.isConnected) lastRowFocus.focus();
    lastRowFocus = null;
  }

  function closeRowActions() {
    actionsRoom = null;
    endRowInteraction();
    consumeOverlayGuard();
  }

  let pressingId = $state('');

  function rowPressStart(room: RoomEntry) {
    lpFired = false;
    clearTimeout(lpTimer);
    pressingId = room.id;
    lpTimer = setTimeout(() => {
      lpFired = true;
      pressingId = '';
      triggerHaptic('medium');
      openRowActions(room);
    }, 550);
  }

  function rowPressEnd() {
    clearTimeout(lpTimer);
    pressingId = '';
  }

  async function shareRoom() {
    triggerHaptic('light');
    const url = window.location.href;
    const title = activeRoomLabel || activeRoomId;
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast(`${t(dict, 'common.shareLink')} — ${t(dict, 'common.copied')}`, 'success');
    } catch {
      showToast(t(dict, 'app.error'));
    }
  }

  async function togglePin() {
    const target = actionTarget;
    closeRowActions();
    if (!target) return;
    triggerHaptic('light');
    try {
      await setRoomPinned(target, !target.pinned);
    } catch {
      showToast(t(dict, 'app.error'));
    }
    await loadRooms();
  }

  function openRename() {
    const target = actionTarget;
    if (!target) {
      closeRowActions();
      return;
    }
    actionsRoom = null;
    renameValue = target.label || target.roomId;
    renameDialogOpen = true;
  }

  function openDelete() {
    if (!actionTarget) {
      closeRowActions();
      return;
    }
    actionsRoom = null;
    deleteDialogOpen = true;
  }

  async function saveRename() {
    const target = actionTarget;
    renameDialogOpen = false;
    consumeOverlayGuard();
    endRowInteraction();
    if (!target) return;
    triggerHaptic('light');
    try {
      await renameRoom(target, renameValue);
    } catch {
      showToast(t(dict, 'app.error'));
    }
    await loadRooms();
  }

  async function confirmDelete() {
    const target = actionTarget;
    deleteDialogOpen = false;
    consumeOverlayGuard();
    endRowInteraction();
    if (!target) return;
    triggerHaptic('warning');
    try {
      await forgetRoom(target);
      showToast(t(dict, 'app.row.removed'), 'success');
    } catch {
      showToast(t(dict, 'app.error'));
    }
    await loadRooms();
  }

  // Keep every in-app link inside /app: same-origin links to other pages and
  // external links open in a new browser view instead of navigating the PWA.
  function guardLinks(e: MouseEvent) {
    const anchor = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!anchor) return;
    if (anchor.hasAttribute('download') || anchor.target === '_blank') return;
    const raw = anchor.getAttribute('href') || '';
    if (!raw || raw.startsWith('#') || raw.startsWith('data:') || raw.startsWith('blob:')) return;
    let url: URL;
    try {
      url = new URL(raw, location.href);
    } catch {
      return;
    }
    const appPath = /^\/(en|cs|de|es|fr|sk|pl)?\/?app(\/|$)/;
    if (url.origin === location.origin && (appPath.test(url.pathname) || url.pathname.startsWith('/dl/'))) return;
    e.preventDefault();
    window.open(url.href, '_blank', 'noopener');
  }

  const chatRooms = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    return rooms.filter((r) => {
      if (r.kind === 'whiteboard') return false;
      if (chatFilter === 'pinned' && !r.pinned) return false;
      if (chatFilter === 'live' && r.mode !== 'live') return false;
      if (!q) return true;
      return (r.label || r.roomId).toLowerCase().includes(q) || r.roomId.toLowerCase().includes(q);
    });
  });

  const boardRooms = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    return rooms.filter((r) => {
      if (r.kind !== 'whiteboard') return false;
      if (chatFilter === 'pinned' && !r.pinned) return false;
      if (!q) return true;
      return (r.label || r.roomId).toLowerCase().includes(q) || r.roomId.toLowerCase().includes(q);
    });
  });

  const visibleRooms = $derived(activeTab === 'boards' ? boardRooms : chatRooms);

  const backLabel = $derived(activeView === 'board' && !boardReturnRoom ? t(dict, 'app.tab.boards') : t(dict, 'app.tab.chats'));

  function modeLabel(room: RoomEntry): string {
    if (room.kind === 'whiteboard') return t(dict, 'rooms.mode.board');
    return room.mode === 'live' ? t(dict, 'rooms.mode.live') : t(dict, 'rooms.mode.ttl');
  }

  let creatingRoom = false;
  async function handleCreateRoom() {
    if (creatingRoom) return;
    const password = newRoomPassword.trim();
    if (!passwordLongEnough(password)) {
      newRoomPwError = true;
      triggerHaptic('warning');
      return;
    }
    creatingRoom = true;
    triggerHaptic('medium');
    let id = normalizeRoomId(newRoomName);
    if (!id) id = `room-${Math.random().toString(36).slice(2, 8)}`;
    newRoomSheetOpen = false;
    const mode: ChatMode = newRoomKind === 'chat' && newRoomMode === 'ttl' ? `ttl-${retentionSeconds}` : 'live';
    try {
      if (newRoomKind === 'whiteboard') {
        sessionStorage.setItem('whiteboard-password', password);
        sessionStorage.setItem('whiteboard-share-password', password);
        sessionStorage.setItem(`wb-pw:${id}`, password);
      } else {
        sessionStorage.setItem('chat-password', password);
        sessionStorage.setItem('chat-room-config', JSON.stringify({ mode, authMode: 'password', createdAt: Date.now(), v: 3 }));
        sessionStorage.setItem('chat-share-password', password);
        sessionStorage.setItem(`chat-pw:${id}`, password);
      }
    } catch {}
    const label = newRoomName.trim();
    persistRoom(newRoomKind, id, label || id, Boolean(label), mode);
    closeNewRoomSheet(false);
    enterRoom(id, newRoomKind, label, false);
    creatingRoom = false;
  }

  // Existing entries keep their label, pin and any passkey-wrapped secret —
  // only touched (optionally renamed); fresh ones are stored without secret.
  function persistRoom(kind: 'chat' | 'whiteboard', roomId: string, label: string, rename = false, mode: ChatMode = 'live') {
    if (wiping || !validRoomId(roomId)) return;
    const epoch = wipeEpoch;
    void (async () => {
      try {
        const known = await getRoom(kind, roomId);
        if (wiping || wipeEpoch !== epoch) return;
        if (known) {
          if (rename && label) await renameRoom(known, label);
          await touchRoom(kind, roomId);
        } else {
          await saveRoom({ kind, roomId, mode, label }, null, { withSecret: false, passkeyName: '' });
        }
        if (!wiping && wipeEpoch === epoch) await loadRooms();
      } catch {}
    })();
  }

  let joiningRoom = false;
  function handleJoinRoom() {
    if (joiningRoom) return;
    triggerHaptic('medium');
    const id = normalizeRoomId(joinRoomId);
    if (!id) return;
    joiningRoom = true;
    if (joinRoomPassword) {
      try {
        sessionStorage.setItem(`chat-pw:${id}`, joinRoomPassword);
      } catch {}
    }
    closeJoinRoomSheet(false);
    persistRoom('chat', id, id);
    enterRoom(id, 'chat', labelForRoom(id, id, 'chat'), false);
    joiningRoom = false;
  }

  function pickLanguage(code: Locale) {
    triggerHaptic('light');
    langSheetOpen = false;
    overlayGuard = false;
    const target = code === 'en' ? '/app' : `/${code}/app`;
    // Retire the overlay-guard entry in place so Back after the reload lands
    // on the hub, not on a phantom overlay entry.
    window.history.replaceState({ view: 'hub', tab: activeTab }, '', window.location.href);
    window.location.href = `/_lang/${code}?to=${encodeURIComponent(target)}`;
  }

  let latestVersion = $state<AppVersion | null>(null);
  let updateToastOpen = $state(false);
  let dismissedUpdate = '';
  const updateAvailable = $derived(Boolean(latestVersion && !isDevBuild && latestVersion.commit !== CURRENT_VERSION.commit));

  async function checkForUpdate() {
    const latest = await fetchLatestVersion();
    if (!latest) return;
    latestVersion = latest;
    if (!isDevBuild && latest.commit !== CURRENT_VERSION.commit && dismissedUpdate !== latest.commit) updateToastOpen = true;
  }

  function dismissUpdateToast() {
    updateToastOpen = false;
    if (latestVersion) dismissedUpdate = latestVersion.commit;
  }

  let updating = false;
  async function updateApp() {
    if (updating) return;
    updating = true;
    triggerHaptic('medium');
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      await reg?.update().catch(() => {});
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith('encrypt-')).map((key) => caches.delete(key)));
    } catch {}
    const url = new URL('/app', window.location.origin);
    url.searchParams.set('v', String(Date.now()));
    window.location.replace(url.href);
  }

  let wiping = false;
  let wipeEpoch = 0;

  const LAST_VIEW_KEY = 'encrypt.click:chat-last-view';
  const LAST_VIEW_TTL_MS = 2 * 60 * 60 * 1000;

  function readLastView(): { room: string | null; kind: string | null; tab: string | null } | null {
    try {
      const raw = JSON.parse(localStorage.getItem(LAST_VIEW_KEY) ?? 'null');
      if (!raw || typeof raw.at !== 'number' || Date.now() - raw.at > LAST_VIEW_TTL_MS) return null;
      const room = typeof raw.room === 'string' && validRoomId(raw.room) ? raw.room : null;
      const kind = raw.kind === 'whiteboard' ? 'whiteboard' : 'chat';
      const tab = ['chats', 'boards', 'files', 'settings'].includes(raw.tab) ? (raw.tab as string) : null;
      return room || tab ? { room, kind: room ? kind : null, tab: room ? null : tab } : null;
    } catch {
      return null;
    }
  }

  function saveLastView() {
    if (!ready || wiping) return;
    const entry = activeView === 'hub' ? { tab: activeTab } : { room: activeRoomId, kind: activeView === 'board' ? 'whiteboard' : 'chat' };
    try { localStorage.setItem(LAST_VIEW_KEY, JSON.stringify({ ...entry, at: Date.now() })); } catch {}
  }

  $effect(saveLastView);

  // Room-scoped secrets outside the vault DB: signing identities (chat-identity
  // IDB), per-room trust tables / mode / schedule / history / alias keys in
  // localStorage, and password handoffs + sealed scheduled drafts in
  // sessionStorage.
  const WIPE_LS_PREFIXES = ['encrypt.click:chat-', 'encrypt.click:alias:', 'encrypt.click:nick:'];
  const WIPE_SS_PREFIXES = ['chat-pw:', 'wb-pw:', 'encrypt-click:once:', 'encrypt.click:chat-'];
  const WIPE_SS_KEYS = ['chat-password', 'chat-share-password', 'chat-room-config', 'whiteboard-password', 'whiteboard-share-password'];
  const PANIC_FLAG = 'encrypt.click:panic-wipe';

  let lockEnabled = $state(false);
  let lockAvailable = $state(false);
  let vaultKnown = $state<VaultState | null>(null);
  let locked = $state(false);
  let lockBusy = $state(false);
  let lockToggleKey = $state(0);
  let lockError = $state('');

  async function tryUnlock(silent = false) {
    if (lockBusy) return;
    lockBusy = true;
    lockError = '';
    const ok = await unlock();
    lockBusy = false;
    if (ok) {
      locked = false;
      triggerHaptic('success');
    } else if (!silent) {
      lockError = t(dict, 'app.lock.failed');
      triggerHaptic('warning');
    }
  }

  async function toggleLock() {
    if (lockBusy) {
      lockToggleKey++;
      return;
    }
    if (lockEnabled) {
      lockBusy = true;
      const ok = await confirmPresence();
      lockBusy = false;
      if (!ok) {
        lockToggleKey++;
        showToast(t(dict, 'app.lock.failed'), 'warning');
        return;
      }
      clearLock();
      lockEnabled = false;
      return;
    }
    if (!lockAvailable) {
      lockToggleKey++;
      showToast(t(dict, 'app.lock.unsupported'), 'warning');
      return;
    }
    lockBusy = true;
    const result = await enableLock('encrypt.click', vaultKnown);
    lockBusy = false;
    if (result.ok) {
      lockEnabled = true;
      triggerHaptic('success');
      void vaultState().then((v) => { vaultKnown = v; });
    } else {
      lockToggleKey++;
      showToast(`${t(dict, 'app.lock.enableFailed')} (${result.detail})`, 'warning');
    }
  }

  function wipeLocalSecrets() {
    clearLock();
    lockEnabled = false;
    locked = false;
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && WIPE_LS_PREFIXES.some((p) => key.startsWith(p))) localStorage.removeItem(key);
      }
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i);
        if (key && (WIPE_SS_KEYS.includes(key) || WIPE_SS_PREFIXES.some((p) => key.startsWith(p)))) sessionStorage.removeItem(key);
      }
    } catch {}
  }

  async function handlePanic() {
    if (wiping) return;
    wiping = true;
    wipeEpoch++;
    panicDialogOpen = false;
    consumeOverlayGuard();
    triggerHaptic('warning');
    let ok = true;
    try {
      await Promise.all([forgetEverything(), forgetChatIdentity(), forgetSharePasswords()]);
      wipeLocalSecrets();
      // Broadcast to other open /app tabs: they wipe their own sessionStorage
      // and reload to drop in-memory keys a storage sweep cannot reach.
      try { localStorage.setItem(PANIC_FLAG, String(Date.now())); } catch {}
    } catch {
      ok = false;
    } finally {
      wiping = false;
    }
    rooms = [];
    showToast(t(dict, ok ? 'app.settings.wipeDone' : 'app.settings.wipeError'), ok ? 'success' : 'warning');
  }

  async function handleVaultExport() {
    if (vaultExportBusy || !vaultExportPw.trim()) return;
    vaultExportBusy = true;
    triggerHaptic('light');
    try {
      const text = await encodeVaultBackup(vaultExportPw.trim());
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'encrypt-vault-backup.json';
      a.click();
      URL.revokeObjectURL(url);
      vaultExportOpen = false;
      vaultExportPw = '';
      consumeOverlayGuard();
      showToast(t(dict, 'app.backup.exportDone'), 'success');
    } catch {
      showToast(t(dict, 'app.backup.exportError'), 'warning');
    } finally {
      vaultExportBusy = false;
    }
  }

  async function handleVaultImportFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file || vaultImportBusy) return;
    vaultImportBusy = true;
    vaultImportError = '';
    triggerHaptic('light');
    try {
      const rows = await decodeVaultBackup(await file.text(), vaultImportPw.trim());
      const count = await importVaultRows(rows);
      await loadRooms();
      vaultImportOpen = false;
      vaultImportPw = '';
      if (vaultImportInput) vaultImportInput.value = '';
      consumeOverlayGuard();
      showToast(t(dict, count ? 'app.backup.importDone' : 'app.backup.importEmpty').replace('{n}', String(count)), count ? 'success' : 'warning');
    } catch {
      vaultImportError = t(dict, 'app.backup.importError');
    } finally {
      vaultImportBusy = false;
    }
  }

  onMount(() => {
    if ((window as Window & { __encryptAppRedirect?: boolean }).__encryptAppRedirect) return;
    const state = loadThemeState();
    platform = state.platform;
    appearance = state.appearance;
    seed = state.seed;
    scheme = applyTheme(state);
    try {
      haptics = localStorage.getItem('encrypt-app-haptics') !== '0';
    } catch {
      haptics = true;
    }
    ready = true;

    lockEnabled = storedLock() !== null;
    if (lockEnabled) {
      locked = true;
      void tryUnlock(true);
    }
    void lockSupported().then((ok) => { lockAvailable = ok; });
    void vaultState().then((v) => { vaultKnown = v; }).catch(() => {});

    isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

    const onInstallPrompt = (e: Event) => {
      e.preventDefault();
      deferredInstallPrompt = e as BeforeInstallPromptEvent;
    };
    window.addEventListener('beforeinstallprompt', onInstallPrompt);

    const onAppInstalled = () => {
      isStandalone = true;
      deferredInstallPrompt = null;
    };
    window.addEventListener('appinstalled', onAppInstalled);

    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        saveLastView();
        return;
      }
      loadRooms();
      void checkForUpdate();
      if (lockEnabled && !locked && shouldLock(hiddenAt, Date.now())) {
        locked = true;
        void tryUnlock(true);
      }
      hiddenAt = 0;
    };
    document.addEventListener('visibilitychange', onVisibility);
    void checkForUpdate();
    const updateTimer = setInterval(() => void checkForUpdate(), 30 * 60_000);

    const onOffline = () => showToast(t(dict, 'app.offline'));
    const onOnline = () => showToast(t(dict, 'app.backOnline'), 'success');
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);

    const onStorage = (e: StorageEvent) => {
      if (e.key === PANIC_FLAG && e.newValue) {
        wipeLocalSecrets();
        location.reload();
      }
    };
    window.addEventListener('storage', onStorage);

    const schemeQuery = window.matchMedia('(prefers-color-scheme: light)');
    const onScheme = () => {
      if (appearance === 'system') scheme = applyTheme({ platform, appearance, seed });
    };
    schemeQuery.addEventListener('change', onScheme);

    const params = new URLSearchParams(window.location.search);
    let roomParam = params.get('room');
    let kindParam = params.get('kind');
    let tabParam = params.get('tab');
    if (!roomParam && !tabParam && !params.get('action')) {
      const last = readLastView();
      if (last) {
        roomParam = last.room;
        kindParam = last.kind;
        tabParam = last.tab;
      }
    }

    if (roomParam && validRoomId(roomParam)) {
      const kind = kindParam === 'whiteboard' ? 'whiteboard' : 'chat';
      activeRoomId = roomParam;
      activeView = kind === 'whiteboard' ? 'board' : 'room';
      activeTab = tabForKind(kind);
      window.history.replaceState({ view: 'hub', tab: activeTab }, '', `?tab=${activeTab}`);
      window.history.pushState({ view: activeView, roomId: roomParam, kind, label: '' }, '', `?room=${encodeURIComponent(roomParam)}&kind=${kind}`);
      roomEnteredViaPush = true;
      persistRoom(kind, roomParam, roomParam);
    } else if (tabParam === 'files' || tabParam === 'boards' || tabParam === 'settings' || tabParam === 'chats') {
      activeTab = tabParam;
      if (roomParam) window.history.replaceState({ view: 'hub', tab: activeTab }, '', `?tab=${activeTab}`);
    } else if (roomParam) {
      window.history.replaceState({ view: 'hub', tab: 'chats' }, '', '?tab=chats');
    }
    if (!roomParam && params.get('action') === 'new') {
      newRoomKind = activeTab === 'boards' ? 'whiteboard' : 'chat';
      newRoomSheetOpen = true;
      window.history.replaceState({ view: 'hub', tab: activeTab }, '', `?tab=${activeTab}`);
    }

    const handlePopState = (e: PopStateEvent) => {
      overlayGuard = false;
      newRoomSheetOpen = false;
      joinRoomSheetOpen = false;
      langSheetOpen = false;
      showIosInstallSheet = false;
      panicDialogOpen = false;
      clearBoardDialogOpen = false;
      vaultExportOpen = false;
      vaultExportPw = '';
      vaultImportOpen = false;
      vaultImportPw = '';
      vaultImportError = '';
      actionsRoom = null;
      endRowInteraction();
      renameDialogOpen = false;
      deleteDialogOpen = false;
      openOverlays = {};
      const state = e.state as { view?: ViewState; roomId?: string; kind?: string; label?: string; tab?: TabId; overlay?: boolean } | null;
      if (state?.overlay) {
        // Landed on a stale overlay-guard entry (its overlay was already
        // force-closed above): disarm it so a second Back skips cleanly.
        window.history.replaceState({ ...state, overlay: false }, '', window.location.href);
      }
      if (state?.view === 'room' || state?.view === 'board') {
        activeView = state.view;
        activeRoomId = state.roomId || '';
        activeRoomLabel = labelForRoom(activeRoomId, state.label || '', state.kind === 'whiteboard' ? 'whiteboard' : 'chat');
        activeTab = tabForKind(state.kind === 'whiteboard' ? 'whiteboard' : 'chat');
        roomEnteredViaPush = true;
      } else if (state?.view === 'hub') {
        activeView = 'hub';
        activeRoomId = '';
        activeRoomLabel = '';
        if (state.tab === 'files' || state.tab === 'boards' || state.tab === 'settings' || state.tab === 'chats') {
          if (state.tab !== activeTab) { searchQuery = ''; chatFilter = 'all'; }
          activeTab = state.tab;
        }
        roomEnteredViaPush = false;
      } else {
        const p = new URLSearchParams(window.location.search);
        const r = p.get('room');
        if (r && validRoomId(r)) {
          activeRoomId = r;
          activeView = p.get('kind') === 'whiteboard' ? 'board' : 'room';
          activeRoomLabel = labelForRoom(r, '', p.get('kind') === 'whiteboard' ? 'whiteboard' : 'chat');
          activeTab = tabForKind(p.get('kind') === 'whiteboard' ? 'whiteboard' : 'chat');
        } else {
          activeView = 'hub';
          activeRoomId = '';
          activeRoomLabel = '';
          const tb = p.get('tab');
          if (tb === 'files' || tb === 'boards' || tb === 'settings' || tb === 'chats') {
            if (tb !== activeTab) { searchQuery = ''; chatFilter = 'all'; }
            activeTab = tb;
          }
        }
        roomEnteredViaPush = false;
      }
      boardReturnRoom = null;
      loadRooms();
      if (activeView === 'hub') restoreHubScroll();
    };
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && Object.values(openOverlays).some(Boolean)) closeTopOverlay();
    };
    window.addEventListener('keydown', onKeydown);
    window.addEventListener('popstate', handlePopState);
    document.addEventListener('click', guardLinks, true);

    loadRooms();

    const removeSheetSwipe = installSheetSwipe();
    const removeViewportSync = installViewportSync();
    return () => {
      removeSheetSwipe();
      removeViewportSync();
      window.removeEventListener('keydown', onKeydown);
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('beforeinstallprompt', onInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('click', guardLinks, true);
      schemeQuery.removeEventListener('change', onScheme);
      clearTimeout(toastTimer);
      clearTimeout(lpTimer);
      clearInterval(updateTimer);
    };
  });
</script>

{#snippet roomRow(room: RoomEntry)}
  <ListItem
    class={pressingId === room.id ? 'app-row-press' : ''}
    link
    linkComponent="button"
    linkProps={{ type: 'button' }}
    onClick={() => {
      if (lpFired) {
        lpFired = false;
        return;
      }
      void openSavedRoom(room);
    }}
    onpointerdown={(e: PointerEvent) => {
      lpX = e.clientX;
      lpY = e.clientY;
      rowPressStart(room);
    }}
    onpointerup={rowPressEnd}
    onpointercancel={rowPressEnd}
    onpointermove={(e: PointerEvent) => {
      if (Math.abs(e.clientX - lpX) > 10 || Math.abs(e.clientY - lpY) > 10) rowPressEnd();
    }}
    oncontextmenu={(e: MouseEvent) => {
      e.preventDefault();
      lpFired = true;
      openRowActions(room);
    }}
    title={room.label || room.roomId}
    subtitle={modeLabel(room)}
  >
    {#snippet media()}
      <div
        class="w-10 h-10 rounded-full shrink-0"
        style="background: {identiconBackground(room.roomId)}"
        aria-hidden="true"
      ></div>
    {/snippet}
    {#snippet after()}
      {#if room.pinned}
        <span class="text-[var(--app-label-3)]"><AppIcons name="pin" size={14} /></span>
        <span class="sr-only">{t(dict, 'app.filter.pinned')}</span>
      {/if}
      {#if room.mode === 'live' && room.kind !== 'whiteboard'}
        <span class="w-2 h-2 rounded-full bg-[var(--app-tint)]"></span>
        <span class="sr-only">{t(dict, 'app.filter.live')}</span>
      {/if}
    {/snippet}
  </ListItem>
{/snippet}

{#snippet hubTitle()}
  <span class="inline-flex items-center gap-2">
    <img src="/encryptclick_icon.svg" alt="" class="w-5 h-5 object-contain" />
    {t(dict, `app.tab.${activeTab}`)}
  </span>
{/snippet}

{#snippet hubPlus()}
  <button
    type="button"
    class="w-11 h-11 flex items-center justify-center text-primary rounded-full"
    onclick={() => {
      triggerHaptic('medium');
      newRoomKind = activeTab === 'boards' ? 'whiteboard' : 'chat';
      newRoomSheetOpen = true;
    }}
    aria-label={t(dict, 'app.new.title')}
  >
    <AppIcons name="plus" size={22} />
  </button>
{/snippet}

{#snippet roomBar()}
  <Navbar
    class="{platform === 'material' ? 'app-bar ' : ''}z-40"
    centerTitle={true}
    titleClass="app-room-title"
  >
    {#snippet left()}
      <NavbarBackLink component="button" type="button" text={backLabel} showText={false} iconOnly onClick={leaveRoom} aria-label={`${t(dict, 'common.back')}: ${backLabel}`} />
    {/snippet}
    {#snippet title()}
      {#if activeView === 'room'}
        <button
          type="button"
          class="app-nav-title block truncate w-full text-center"
          onclick={() => roomInfo?.()}
          aria-label={t(dict, 'chat.members')}
        >
          {activeRoomLabel || activeRoomId}
        </button>
      {:else}
        <span class="block truncate w-full text-center">{activeRoomLabel || activeRoomId}</span>
      {/if}
    {/snippet}
    {#snippet subtitle()}
      {#if roomConn === 'connecting' || roomConn === 'offline'}
        <button
          type="button"
          class="app-conn-pill {roomConn === 'connecting' ? 'app-conn-pill--connecting' : 'app-conn-pill--offline'}"
          onclick={() => {
            triggerHaptic('medium');
            roomReconnect?.();
          }}
          aria-label={`${t(dict, roomConn === 'offline' ? 'app.offline' : 'chat.connecting')} — ${t(dict, 'app.room.reconnect')}`}
        >
          {t(dict, roomConn === 'offline' ? 'app.offline' : 'chat.connecting')}
        </button>
      {:else}
        <span class="flex items-center justify-center gap-1 min-w-0 text-[var(--app-label-2)] leading-tight">
          <AppIcons name="lock" size={10} />
          <span class="truncate">{t(dict, 'app.room.encrypted')}</span>
        </span>
      {/if}
    {/snippet}
    {#snippet right()}
      {#if activeView === 'room'}
        <button
          type="button"
          class="app-nav-btn shrink-0 w-11 h-11 flex items-center justify-center text-primary rounded-full"
          onclick={() => roomCall?.()}
          aria-label={roomCallState.active ? t(dict, 'chat.callInProgress') : t(dict, 'chat.callStart')}
          disabled={!roomCallState.ready && !roomCallState.active}
        >
          <AppIcons name="call" size={20} />
        </button>
      {/if}
      <button
        type="button"
        class="app-nav-btn shrink-0 w-11 h-11 flex items-center justify-center text-primary rounded-full"
        onclick={shareRoom}
        aria-label={t(dict, 'common.shareLink')}
      >
        <AppIcons name="share" size={20} />
      </button>
      {#if activeView === 'room'}
        <button
          type="button"
          id="chat-room-menu-trigger"
          class="app-nav-btn shrink-0 w-11 h-11 flex items-center justify-center text-primary rounded-full"
          onclick={() => roomMenu?.()}
          aria-label={t(dict, 'chat.roomMenu')}
          aria-haspopup="menu"
        >
          <AppIcons name="more" size={20} />
        </button>
      {/if}
    {/snippet}
  </Navbar>
{/snippet}

{#snippet newRoomFab()}
  {#if platform === 'material' && (activeTab === 'chats' || activeTab === 'boards') && visibleRooms.length > 0}
    <Fab
      class="fixed right-4 z-40"
      style="bottom: calc(5.5rem + env(safe-area-inset-bottom, 0px))"
      text={t(dict, 'app.empty.new')}
      onClick={() => {
        triggerHaptic('medium');
        newRoomKind = activeTab === 'boards' ? 'whiteboard' : 'chat';
        newRoomSheetOpen = true;
      }}
    >
      {#snippet icon()}<AppIcons name="plus" size={20} />{/snippet}
    </Fab>
  {/if}
{/snippet}

<App theme={platform} dark={scheme === 'dark'} safeAreas={true}>
  <Page class="app-page-bg h-full flex flex-col overflow-hidden">
    {#if !ready}
      <div class="flex-1" style="background: var(--app-bg)"></div>
    {:else if activeView === 'room'}
      {@render roomBar()}
      <div class="app-room-wrapper">
        <ChatRoom
          roomId={activeRoomId}
          {locale}
          {dict}
          appMode={true}
          onOpenBoardApp={openBoardInvite}
          onExitApp={leaveRoom}
          onSavedPassword={savedRoomPassword}
          onNotice={showToast}
          onConnStatus={(s) => (roomConn = s)}
          bind:requestReconnect={roomReconnect}
          onShareApp={shareRoom}
          bind:requestCall={roomCall}
          bind:requestRoomMenu={roomMenu}
          bind:requestRoomInfo={roomInfo}
          bind:appCallState={roomCallState}
        />
      </div>
    {:else if activeView === 'board'}
      {@render roomBar()}
      <div class="app-wb-wrapper">
        <Whiteboard
          roomId={activeRoomId}
          {locale}
          {dict}
          appMode={true}
          onExitApp={leaveRoom}
          onConnStatus={(s) => (roomConn = s)}
          onHaptic={triggerHaptic}
          bind:requestReconnect={roomReconnect}
          onClearRequest={(doClear) => {
            pendingClearBoard = doClear;
            clearBoardDialogOpen = true;
          }}
        />
      </div>
    {:else}
      {@const showPlus = platform === 'ios' && (activeTab === 'chats' || activeTab === 'boards')}
      <div class="flex-1 overflow-y-auto min-h-0 app-scroll" bind:this={scroller}>
        {#if showPlus}
          <Navbar class="{platform === 'material' ? 'app-bar ' : ''}z-40">
            {#snippet title()}{@render hubTitle()}{/snippet}
            {#snippet right()}{@render hubPlus()}{/snippet}
          </Navbar>
        {:else}
          <Navbar class="{platform === 'material' ? 'app-bar ' : ''}z-40">
            {#snippet title()}{@render hubTitle()}{/snippet}
          </Navbar>
        {/if}

      {#if activeTab === 'chats' || activeTab === 'boards'}
        <div class="app-content px-4 pt-2 pb-1">
          <Searchbar
            class="mx-0! w-full!"
            bind:value={searchQuery}
            onClear={() => (searchQuery = '')}
            onDisable={() => (searchQuery = '')}
            disableButton={platform === 'ios'}
            placeholder={t(dict, 'app.search')}
          />
          {#if activeTab === 'chats'}
            <div class="mt-2">
              <Segmented strong rounded={platform === 'material'} colors={{ strongHighlightBgMaterial: 'bg-md-light-secondary-container dark:bg-md-dark-secondary-container' }}>
                <SegmentedButton active={chatFilter === 'all'} onClick={() => { triggerHaptic('light'); chatFilter = 'all'; }}>
                  {t(dict, 'app.filter.all')}
                </SegmentedButton>
                <SegmentedButton active={chatFilter === 'live'} onClick={() => { triggerHaptic('light'); chatFilter = 'live'; }}>
                  {t(dict, 'app.filter.live')}
                </SegmentedButton>
                <SegmentedButton active={chatFilter === 'pinned'} onClick={() => { triggerHaptic('light'); chatFilter = 'pinned'; }}>
                  {t(dict, 'app.filter.pinned')}
                </SegmentedButton>
              </Segmented>
            </div>
          {/if}
        </div>

        <div class="app-content">
          {#if visibleRooms.length > 0}
            <List strong inset dividersMaterial={false} class="my-3!">
              {#each visibleRooms as room (room.id)}
                {@render roomRow(room)}
              {/each}
            </List>
          {:else if searchQuery.trim() || chatFilter !== 'all'}
            <div class="px-8 py-16 text-center flex flex-col items-center">
              <p class="text-[17px] font-semibold text-[var(--app-label)]">
                {t(dict, 'app.empty.noResults')}
              </p>
            </div>
          {:else}
            <div class="px-8 py-16 text-center flex flex-col items-center">
              <div class="w-16 h-16 rounded-full mb-4 flex items-center justify-center bg-[var(--app-fill)] text-[var(--app-label-3)]">
                <AppIcons name={activeTab === 'boards' ? 'whiteboard' : 'chat'} size={30} />
              </div>
              <p class="text-[17px] font-semibold text-[var(--app-label)]">
                {t(dict, activeTab === 'boards' ? 'app.empty.boards' : 'app.empty.chats')}
              </p>
              <p class="text-[14px] text-[var(--app-label-2)] mt-1 mb-6 max-w-[240px]">
                {t(dict, activeTab === 'boards' ? 'app.empty.hintBoards' : 'app.empty.hint')}
              </p>
              <div class="flex flex-wrap gap-3 justify-center">
                <Button rounded class="min-h-10! px-5 w-auto! whitespace-nowrap" onClick={() => { triggerHaptic('medium'); newRoomKind = activeTab === 'boards' ? 'whiteboard' : 'chat'; newRoomSheetOpen = true; }}>
                  {t(dict, 'app.empty.new')}
                </Button>
                {#if activeTab === 'chats'}
                  <Button rounded tonal class="min-h-10! px-5 w-auto! whitespace-nowrap" onClick={() => { triggerHaptic('light'); joinRoomSheetOpen = true; }}>
                    {t(dict, 'app.empty.join')}
                  </Button>
                {/if}
              </div>
            </div>
          {/if}

          {#if visibleRooms.length > 0 && activeTab === 'chats'}
            <List strong inset dividersMaterial={false} class="my-3!">
              <ListItem
                link
                linkComponent="button"
                linkProps={{ type: 'button' }}
                title={t(dict, 'app.join.row')}
                onClick={() => { triggerHaptic('light'); joinRoomSheetOpen = true; }}
                colors={{ primaryTextIos: 'text-[var(--app-tint)]', primaryTextMaterial: 'text-[var(--app-tint)]' }}
              >
                {#snippet media()}
                  <span class="w-10 h-10 rounded-full flex items-center justify-center bg-[var(--app-tint-container)] text-[var(--app-on-tint-container)]">
                    <AppIcons name="key" size={17} />
                  </span>
                {/snippet}
              </ListItem>
            </List>
          {/if}
        </div>
      {:else if activeTab === 'files'}
        <div class="app-upload-wrapper app-content">
          <UltimateEncrypt {locale} {dict} resultArt={false} />
        </div>
      {:else if activeTab === 'settings'}
        <div class="app-content">
          <BlockTitle>{t(dict, 'app.settings.appearance')}</BlockTitle>
          <List strong inset>
            <ListItem title={t(dict, 'app.settings.haptics')}>
              {#snippet media()}
                <span class="text-[var(--app-tint)]"><AppIcons name="haptic" size={20} /></span>
              {/snippet}
              {#snippet after()}
                <Toggle
                  checked={haptics}
                  onChange={() => {
                    haptics = !haptics;
                    try { localStorage.setItem('encrypt-app-haptics', haptics ? '1' : '0'); } catch {}
                    if (haptics) triggerHaptic('medium');
                  }}
                />
              {/snippet}
            </ListItem>
            <ListItem title={t(dict, 'app.settings.lock')} subtitle={t(dict, 'app.settings.lockHint')}>
              {#snippet media()}
                <span class="text-[var(--app-tint)]"><AppIcons name="lock" size={20} /></span>
              {/snippet}
              {#snippet after()}
                {#key lockToggleKey}<Toggle checked={lockEnabled} onChange={toggleLock} />{/key}
              {/snippet}
            </ListItem>
            <ListItem
              link
              linkComponent="button"
              linkProps={{ type: 'button' }}
              title={t(dict, 'app.settings.language')}
              subtitle={(languages as Record<string, { name: string }>)[locale]?.name ?? 'English'}
              onClick={() => { triggerHaptic('light'); langSheetOpen = true; }}
            >
              {#snippet media()}
                <span class="text-[var(--app-tint)]"><AppIcons name="globe" size={20} /></span>
              {/snippet}
            </ListItem>
          </List>

          <BlockTitle>{t(dict, 'app.settings.app')}</BlockTitle>
          <List strong inset>
            <ListItem
              class="app-version-row"
              title={t(dict, 'app.settings.version')}
              subtitle={`${describeVersion(CURRENT_VERSION, locale)}\n${updateAvailable && latestVersion ? t(dict, 'app.settings.newVersion').replace('{version}', describeVersion(latestVersion, locale)) : latestVersion ? t(dict, 'app.settings.upToDate') : t(dict, 'app.settings.updateHint')}`}
            >
              {#snippet media()}
                <span class="text-[var(--app-tint)]"><AppIcons name="install" size={20} /></span>
              {/snippet}
              {#snippet after()}
                <Button small rounded tonal class="min-h-10!" disabled={updating} onClick={updateApp}>{t(dict, 'app.settings.update')}</Button>
              {/snippet}
            </ListItem>
          </List>

          <BlockTitle>{t(dict, 'app.settings.security')}</BlockTitle>
          <List strong inset>
            <ListItem title={t(dict, 'app.settings.crypto')} subtitle={t(dict, 'app.settings.cryptoValue')}>
              {#snippet media()}
                <span class="text-[var(--app-tint)]"><AppIcons name="shield" size={20} /></span>
              {/snippet}
            </ListItem>
            <ListItem
              link
              linkComponent="button"
              linkProps={{ type: 'button' }}
              chevron={false}
              title={t(dict, 'app.backup.export')}
              subtitle={t(dict, 'app.backup.exportHint')}
              onClick={() => { triggerHaptic('light'); vaultExportOpen = true; }}
            >
              {#snippet media()}
                <span class="text-[var(--app-tint)]"><AppIcons name="share" size={20} /></span>
              {/snippet}
            </ListItem>
            <ListItem
              link
              linkComponent="button"
              linkProps={{ type: 'button' }}
              chevron={false}
              title={t(dict, 'app.backup.import')}
              subtitle={t(dict, 'app.backup.importHint')}
              onClick={() => { triggerHaptic('light'); vaultImportOpen = true; }}
            >
              {#snippet media()}
                <span class="text-[var(--app-tint)]"><AppIcons name="key" size={20} /></span>
              {/snippet}
            </ListItem>
            <ListItem
              link
              linkComponent="button"
              linkProps={{ type: 'button' }}
              chevron={false}
              subtitle={t(dict, 'app.settings.wipeHint')}
              onClick={() => { triggerHaptic('warning'); panicDialogOpen = true; }}
            >
              {#snippet title()}
                <span class="app-danger-text">{t(dict, 'app.settings.wipe')}</span>
              {/snippet}
              {#snippet media()}
                <span class="text-[var(--app-error)]"><AppIcons name="trash" size={20} /></span>
              {/snippet}
            </ListItem>
          </List>
          <div class="h-6"></div>
        </div>
      {/if}
      </div>

      {@render newRoomFab()}

      <Tabbar
        labels={true}
        icons={true}
        class={platform === 'ios'
          ? 'left-0 bottom-0 fixed z-40'
          : 'app-tabbar left-0 bottom-0 fixed z-40'}
      >
        <ToolbarPane>
          <TabbarLink active={activeTab === 'chats'} component="button" linkProps={{ type: 'button' }} aria-current={activeTab === 'chats' ? 'page' : undefined} onclick={() => switchTab('chats')} label={t(dict, 'app.tab.chats')}>
            {#snippet icon()}
              <Icon>
                {#snippet ios()}<AppIcons name="chat" size={26} />{/snippet}
                {#snippet material()}<AppIcons name="chat" size={22} />{/snippet}
              </Icon>
            {/snippet}
          </TabbarLink>
          <TabbarLink active={activeTab === 'files'} component="button" linkProps={{ type: 'button' }} aria-current={activeTab === 'files' ? 'page' : undefined} onclick={() => switchTab('files')} label={t(dict, 'app.tab.files')}>
            {#snippet icon()}
              <Icon>
                {#snippet ios()}<AppIcons name="upload" size={26} />{/snippet}
                {#snippet material()}<AppIcons name="upload" size={22} />{/snippet}
              </Icon>
            {/snippet}
          </TabbarLink>
          <TabbarLink active={activeTab === 'boards'} component="button" linkProps={{ type: 'button' }} aria-current={activeTab === 'boards' ? 'page' : undefined} onclick={() => switchTab('boards')} label={t(dict, 'app.tab.boards')}>
            {#snippet icon()}
              <Icon>
                {#snippet ios()}<AppIcons name="whiteboard" size={26} />{/snippet}
                {#snippet material()}<AppIcons name="whiteboard" size={22} />{/snippet}
              </Icon>
            {/snippet}
          </TabbarLink>
          <TabbarLink active={activeTab === 'settings'} component="button" linkProps={{ type: 'button' }} aria-current={activeTab === 'settings' ? 'page' : undefined} onclick={() => switchTab('settings')} label={t(dict, 'app.tab.settings')}>
            {#snippet icon()}
              <Icon>
                {#snippet ios()}<AppIcons name="settings" size={26} />{/snippet}
                {#snippet material()}<AppIcons name="settings" size={22} />{/snippet}
              </Icon>
            {/snippet}
          </TabbarLink>
        </ToolbarPane>
      </Tabbar>
    {/if}

    <!-- NEW ROOM SHEET -->
    <Sheet
      opened={newRoomSheetOpen}
      onBackdropClick={() => closeNewRoomSheet()}
      class="app-sheet app-sheet--tall pb-[env(safe-area-inset-bottom)]"
    >
      <div class="app-sheet__handle"></div>
      <div class="px-5 pb-6 pt-3 space-y-4">
        <h3 class="text-[17px] font-semibold text-[var(--app-label)]">{t(dict, 'app.new.title')}</h3>
        <Segmented strong rounded={platform === 'material'} colors={{ strongHighlightBgMaterial: 'bg-md-light-secondary-container dark:bg-md-dark-secondary-container' }}>
          <SegmentedButton active={newRoomKind === 'chat'} onClick={() => { newRoomKind = 'chat'; triggerHaptic('light'); }}>
            {t(dict, 'app.new.kindChat')}
          </SegmentedButton>
          <SegmentedButton active={newRoomKind === 'whiteboard'} onClick={() => { newRoomKind = 'whiteboard'; triggerHaptic('light'); }}>
            {t(dict, 'app.new.kindBoard')}
          </SegmentedButton>
        </Segmented>
        <List strong inset class="m-0! app-form">
          <ListInput
            label={t(dict, 'app.new.name')}
            type="text"
            placeholder={t(dict, 'app.new.namePlaceholder')}
            bind:value={newRoomName}
            maxlength={64}
          />
          <ListInput
            label={t(dict, 'app.new.password')}
            type={showNewPw ? 'text' : 'password'}
            placeholder={t(dict, 'app.new.passwordPlaceholder')}
            bind:value={newRoomPassword}
            autocomplete="new-password"
            info={t(dict, 'chat.createDescription')}
            error={newRoomPwError || (newRoomPassword.length > 0 && !passwordLongEnough(newRoomPassword)) ? t(dict, 'app.new.passwordShort') : undefined}
            onInput={() => (newRoomPwError = false)}
            onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') handleCreateRoom(); }}
          />
        </List>
        <div class="flex">
          <Button small tonal rounded class="min-h-10!" onClick={() => { newRoomPassword = genRoomPassphrase(); showNewPw = true; newRoomPwError = false; triggerHaptic('light'); }}>
            {t(dict, 'common.generatePassphrase')}
          </Button>
        </div>
        {#if newRoomKind === 'chat'}
          <List strong inset class="m-0! app-form">
            <ListItem label title={t(dict, 'chat.modeLiveTitle')} text={t(dict, 'chat.modeLiveHint')} onClick={() => { newRoomMode = 'live'; triggerHaptic('light'); }}>
              {#snippet media()}
                <Radio component="span" name="new-room-mode" checked={newRoomMode === 'live'} readonly />
              {/snippet}
            </ListItem>
            <ListItem label title={t(dict, 'chat.modeTtlTitle')} text={t(dict, 'chat.modeTtlHint')} onClick={() => { newRoomMode = 'ttl'; triggerHaptic('light'); }}>
              {#snippet media()}
                <Radio component="span" name="new-room-mode" checked={newRoomMode === 'ttl'} readonly />
              {/snippet}
            </ListItem>
            {#if newRoomMode === 'ttl'}
              <ListItem>
                <div class="app-retention">
                  <div class="flex items-baseline justify-between gap-3">
                    <span class="text-[13px] text-[var(--app-label-2)]">{t(dict, 'chat.retention')}</span>
                    <span class="text-[15px] font-semibold text-[var(--app-label)] tabular-nums">{retentionLabel}</span>
                  </div>
                  <Range
                    min={0}
                    max={RETENTION_SECONDS.length - 1}
                    step={1}
                    bind:value={retentionIndex}
                    aria-label={t(dict, 'chat.retention')}
                  />
                  <div class="flex justify-between text-[11px] text-[var(--app-label-2)]">
                    <span>{formatDuration(RETENTION_SECONDS[0], locale, 'short')}</span>
                    <span>{formatDuration(RETENTION_SECONDS[RETENTION_SECONDS.length - 1], locale, 'short')}</span>
                  </div>
                </div>
              </ListItem>
            {/if}
          </List>
        {/if}
        <Button large rounded class="w-full" disabled={!passwordLongEnough(newRoomPassword.trim())} onClick={handleCreateRoom}>
          {t(dict, 'app.new.open')}
        </Button>
      </div>
    </Sheet>

    <!-- JOIN ROOM SHEET -->
    <Sheet
      opened={joinRoomSheetOpen}
      onBackdropClick={() => closeJoinRoomSheet()}
      class="app-sheet app-sheet--tall pb-[env(safe-area-inset-bottom)]"
    >
      <div class="app-sheet__handle"></div>
      <div class="px-5 pb-6 pt-3 space-y-4">
        <h3 class="text-[17px] font-semibold text-[var(--app-label)]">{t(dict, 'app.join.title')}</h3>
        <List strong inset class="m-0! app-form">
          <ListInput
            label={t(dict, 'app.join.id')}
            type="text"
            placeholder={t(dict, 'app.join.idPlaceholder')}
            bind:value={joinRoomId}
            autocapitalize="none"
            autocorrect="off"
            spellcheck={false}
            onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' && joinRoomId.trim()) handleJoinRoom(); }}
          />
          <ListInput
            label={t(dict, 'app.join.password')}
            type="password"
            placeholder={t(dict, 'app.join.passwordPlaceholder')}
            bind:value={joinRoomPassword}
            autocomplete="current-password"
            onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' && joinRoomId.trim()) handleJoinRoom(); }}
          />
        </List>
        <Button large rounded class="w-full" disabled={!joinRoomId.trim()} onClick={handleJoinRoom}>
          {t(dict, 'app.join.connect')}
        </Button>
      </div>
    </Sheet>

    <!-- LANGUAGE SHEET -->
    <Sheet
      class="app-sheet pb-[env(safe-area-inset-bottom)]"
      opened={langSheetOpen}
      onBackdropClick={() => { langSheetOpen = false; consumeOverlayGuard(); }}
    >
      <div class="app-sheet__handle"></div>
      <div class="px-4 pt-3 pb-2 flex items-center justify-between">
        <h3 class="text-[17px] font-semibold text-[var(--app-label)]">{t(dict, 'app.settings.language')}</h3>
        <Button clear small class="w-auto! min-h-10!" onClick={() => { langSheetOpen = false; consumeOverlayGuard(); }}>
          {t(dict, 'app.done')}
        </Button>
      </div>
      <List strong inset dividers class="my-0">
        {#each locales as code (code)}
          <ListItem
            link
            linkComponent="button"
            linkProps={{ type: 'button' }}
            title={languages[code].name}
            onClick={() => pickLanguage(code)}
          >
            {#snippet after()}
              {#if code === locale}
                <AppIcons name="check" size={18} class="text-[var(--app-tint)]" strokeWidth={2.5} />
              {/if}
            {/snippet}
          </ListItem>
        {/each}
      </List>
      <div class="pb-6"></div>
    </Sheet>

    <!-- iOS INSTALL SHEET -->
    <Sheet
      opened={showIosInstallSheet}
      onBackdropClick={() => { showIosInstallSheet = false; consumeOverlayGuard(); }}
      class="app-sheet pb-[env(safe-area-inset-bottom)]"
    >
      <div class="app-sheet__handle"></div>
      <div class="px-5 pb-6 pt-3 space-y-4">
        <div class="w-14 h-14 mx-auto rounded-[22%] bg-[var(--app-tint-container)] flex items-center justify-center text-[var(--app-on-tint-container)]">
          <AppIcons name="install" size={26} />
        </div>
        <h3 class="text-[17px] font-semibold text-[var(--app-label)] text-center">{t(dict, 'app.install.title')}</h3>
        <p class="text-[14px] text-[var(--app-label-2)]">{t(dict, 'app.install.hint')}</p>
        <List strong inset class="m-0! app-form">
          <ListItem title={t(dict, 'app.install.step1')} />
          <ListItem title={t(dict, 'app.install.step2')} />
          <ListItem title={t(dict, 'app.install.step3')} />
        </List>
        <Button large rounded tonal class="w-full" onClick={() => { showIosInstallSheet = false; consumeOverlayGuard(); }}>
          {t(dict, 'app.close')}
        </Button>
      </div>
    </Sheet>

    <Toast
      position="center"
      opened={updateToastOpen && !toastOpen}
      role="status"
      aria-live="polite"
      style="bottom: calc(env(safe-area-inset-bottom, 0px) + {activeView === 'hub' ? '6.5rem' : '4.75rem'})"
    >
      <span class="text-[15px]">{t(dict, 'app.update.available')}</span>
      {#snippet button()}
        <Button clear small onClick={updateApp}>{t(dict, 'app.update.now')}</Button>
        <Button clear small onClick={dismissUpdateToast}>{t(dict, 'app.close')}</Button>
      {/snippet}
    </Toast>

    <Toast
      position="center"
      opened={toastOpen}
      role="status"
      aria-live="polite"
      style="bottom: calc(env(safe-area-inset-bottom, 0px) + {activeView === 'hub' ? '6.5rem' : '4.75rem'})"
    >
      <span class="text-[15px]">{toastMessage}</span>
      {#snippet button()}
        <Button clear small onClick={() => (toastOpen = false)}>{t(dict, 'app.close')}</Button>
      {/snippet}
    </Toast>

    <!-- PANIC DIALOG -->
    <Dialog opened={panicDialogOpen} onBackdropClick={() => { panicDialogOpen = false; consumeOverlayGuard(); }}>
      {#snippet title()}{t(dict, 'app.settings.wipe')}{/snippet}
      {t(dict, 'app.settings.wipeBody')}
      {#snippet buttons()}
        <DialogButton onClick={() => { panicDialogOpen = false; consumeOverlayGuard(); }}>{t(dict, 'app.cancel')}</DialogButton>
        <DialogButton onClick={handlePanic} class="app-dialog-destructive">{t(dict, 'app.settings.wipeConfirm')}</DialogButton>
      {/snippet}
    </Dialog>

    <!-- VAULT EXPORT DIALOG -->
    <Dialog opened={vaultExportOpen} onBackdropClick={() => { vaultExportOpen = false; consumeOverlayGuard(); }}>
      {#snippet title()}{t(dict, 'app.backup.export')}{/snippet}
      <p class="m-0 mb-3 text-[14px] text-[var(--app-label-2)]">{t(dict, 'app.backup.exportBody')}</p>
      <input
        class="app-dialog-input"
        type="password"
        autocomplete="new-password"
        placeholder={t(dict, 'app.backup.passwordPlaceholder')}
        bind:value={vaultExportPw}
        aria-label={t(dict, 'app.backup.password')}
      />
      {#snippet buttons()}
        <DialogButton onClick={() => { vaultExportOpen = false; vaultExportPw = ''; consumeOverlayGuard(); }}>{t(dict, 'app.cancel')}</DialogButton>
        <DialogButton strong onClick={handleVaultExport} disabled={vaultExportBusy || !vaultExportPw.trim()}>{t(dict, 'app.backup.exportConfirm')}</DialogButton>
      {/snippet}
    </Dialog>

    <!-- VAULT IMPORT DIALOG -->
    <Dialog opened={vaultImportOpen} onBackdropClick={() => { vaultImportOpen = false; consumeOverlayGuard(); }}>
      {#snippet title()}{t(dict, 'app.backup.import')}{/snippet}
      <p class="m-0 mb-3 text-[14px] text-[var(--app-label-2)]">{t(dict, 'app.backup.importBody')}</p>
      <input
        class="app-dialog-input"
        type="password"
        autocomplete="off"
        placeholder={t(dict, 'app.backup.passwordPlaceholder')}
        bind:value={vaultImportPw}
        aria-label={t(dict, 'app.backup.password')}
      />
      <input
        bind:this={vaultImportInput}
        class="app-dialog-input mt-2"
        type="file"
        accept="application/json,.json"
        onchange={handleVaultImportFile}
        disabled={vaultImportBusy || !vaultImportPw.trim()}
        aria-label={t(dict, 'app.backup.chooseFile')}
      />
      {#if vaultImportError}
        <p class="m-0 mt-2 text-[13px] text-[var(--app-error)]" role="alert">{vaultImportError}</p>
      {/if}
      {#snippet buttons()}
        <DialogButton onClick={() => { vaultImportOpen = false; vaultImportPw = ''; vaultImportError = ''; consumeOverlayGuard(); }}>{t(dict, 'app.cancel')}</DialogButton>
      {/snippet}
    </Dialog>

    <!-- CLEAR BOARD DIALOG -->
    <Dialog opened={clearBoardDialogOpen} onBackdropClick={() => { clearBoardDialogOpen = false; consumeOverlayGuard(); }}>
      {#snippet title()}{t(dict, 'whiteboard.delete')}{/snippet}
      {t(dict, 'whiteboard.clearConfirm')}
      {#snippet buttons()}
        <DialogButton onClick={() => { clearBoardDialogOpen = false; consumeOverlayGuard(); }}>{t(dict, 'app.cancel')}</DialogButton>
        <DialogButton
          onClick={() => {
            clearBoardDialogOpen = false;
            consumeOverlayGuard();
            pendingClearBoard?.();
            pendingClearBoard = null;
            triggerHaptic('medium');
          }}
          class="app-dialog-destructive"
        >
          {t(dict, 'whiteboard.delete')}
        </DialogButton>
      {/snippet}
    </Dialog>

    <!-- ROOM ROW ACTIONS -->
    <Actions opened={actionsRoom !== null} onBackdropClick={closeRowActions}>
      <ActionsGroup>
        <ActionsLabel>{actionTarget?.label || actionTarget?.roomId || ''}</ActionsLabel>
        <ActionsButton onClick={togglePin}>
          {t(dict, actionTarget?.pinned ? 'app.row.unpin' : 'app.row.pin')}
        </ActionsButton>
        <ActionsButton onClick={openRename}>{t(dict, 'app.row.rename')}</ActionsButton>
        <ActionsButton
          onClick={openDelete}
          colors={{ textIos: 'text-[var(--app-error)]', textMaterial: 'text-[var(--app-error)]' }}
        >
          {t(dict, 'app.row.remove')}
        </ActionsButton>
      </ActionsGroup>
      <ActionsGroup>
        <ActionsButton bold onClick={closeRowActions}>{t(dict, 'app.cancel')}</ActionsButton>
      </ActionsGroup>
    </Actions>

    <!-- RENAME DIALOG -->
    <Dialog
      opened={renameDialogOpen}
      onBackdropClick={() => {
        renameDialogOpen = false;
        endRowInteraction();
        consumeOverlayGuard();
      }}
    >
      {#snippet title()}{t(dict, 'app.rename.title')}{/snippet}
      <input
        type="text"
        class="app-dialog-input"
        maxlength="64"
        autofocus
        enterkeyhint="done"
        aria-label={t(dict, 'app.rename.title')}
        value={renameValue}
        oninput={(e) => (renameValue = e.currentTarget.value)}
        onkeydown={(e: KeyboardEvent) => {
          if (e.key === 'Enter') saveRename();
        }}
      />
      {#snippet buttons()}
        <DialogButton
          onClick={() => {
            renameDialogOpen = false;
            endRowInteraction();
            consumeOverlayGuard();
          }}
        >
          {t(dict, 'app.cancel')}
        </DialogButton>
        <DialogButton strong onClick={saveRename}>{t(dict, 'app.save')}</DialogButton>
      {/snippet}
    </Dialog>

    <!-- DELETE ROOM DIALOG -->
    <Dialog
      opened={deleteDialogOpen}
      onBackdropClick={() => {
        deleteDialogOpen = false;
        endRowInteraction();
        consumeOverlayGuard();
      }}
    >
      {#snippet title()}{t(dict, 'app.remove.title')}{/snippet}
      {t(dict, 'app.remove.body')}
      {#snippet buttons()}
        <DialogButton
          onClick={() => {
            deleteDialogOpen = false;
            endRowInteraction();
            consumeOverlayGuard();
          }}
        >
          {t(dict, 'app.cancel')}
        </DialogButton>
        <DialogButton onClick={confirmDelete} class="app-dialog-destructive">{t(dict, 'app.remove.confirm')}</DialogButton>
      {/snippet}
    </Dialog>
  </Page>
  {#if locked}
    <div class="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-4 p-8 text-center bg-[var(--app-bg)]" role="dialog" aria-modal="true" aria-label={t(dict, 'app.lock.title')}>
      <span class="w-16 h-16 rounded-full flex items-center justify-center bg-[var(--app-tint-container)] text-[var(--app-on-tint-container)]">
        <AppIcons name="lock" size={28} />
      </span>
      <h1 class="text-xl font-semibold">{t(dict, 'app.lock.title')}</h1>
      <p class="text-sm opacity-70 max-w-xs">{t(dict, 'app.lock.hint')}</p>
      {#if lockError}<p class="text-sm text-[var(--app-danger,#e5484d)]" role="alert">{lockError}</p>{/if}
      <Button class="max-w-xs" disabled={lockBusy} onClick={() => tryUnlock()}>{t(dict, 'app.lock.unlock')}</Button>
    </div>
  {/if}
</App>
