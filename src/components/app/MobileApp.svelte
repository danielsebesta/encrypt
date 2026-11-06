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
    Popover,
    MenuList,
    MenuListItem,
    Radio,
    Range,
  } from 'konsta/svelte';

  import { LUCIDE } from '../../lib/lucideIcons';
  import AppIcons, { type IconName } from './AppIcons.svelte';
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
    warmPasskeyRef,
    revealSecret,
    type VaultState,
    type RoomEntry,
  } from '../../lib/roomVault';
  import { forgetChatIdentity } from '../../lib/chatIdentity';
  import { loadNotifyPref, saveNotifyPref } from '../../lib/chatAttention';
  import { forgetLocalBoards, suppressLocalBoards, allowLocalBoards } from '../../lib/whiteboardLocalStore';
  import { forgetSharePasswords } from '../../lib/sharePasswordVault';
  import { identiconBackground } from '../../lib/identicon';
  import { passwordLongEnough, RETENTION_SECONDS, formatDuration, type ChatMode } from '../../lib/chatRoomSettings';
  import { genRoomPassphrase } from '../../lib/roomPassphrase';
  import { languages, locales, type Locale } from '../../lib/languages';
  import { t } from '../../lib/t';
  import { installSheetSwipe } from '../../lib/sheetSwipe';
  import { haptic, hapticsAvailable, hapticsNeedGestureEnd, installHapticGrant } from '../../lib/haptics';
  import { clearLock, enableLock, lockSupported, confirmPresence, prepareLockScreen, shouldLock, storedLock, unlock } from '../../lib/appLock';
  import { installViewportSync } from '../../lib/viewportSync';
  import { CURRENT_VERSION, isDevBuild, fetchLatestVersion, describeVersion, type AppVersion } from '../../lib/appVersion';
  import {
    applyTheme,
    loadThemeState,
    saveThemeState,
    DEFAULT_SEED,
    type AppPlatform,
    type AppAppearance,
    type AppScheme,
  } from '../../lib/appTheme';
  import {
    LOCK_TIMEOUT_OPTIONS,
    applyReduceMotion,
    clearAppCaches,
    loadDefaultRoomMode,
    loadHapticsMode,
    loadKeepAwake,
    loadLockTimeoutMs,
    loadReduceMotion,
    prefersReducedMotion,
    saveDefaultRoomMode,
    saveHapticsMode,
    saveKeepAwake,
    saveLockTimeoutMs,
    saveReduceMotion,
    type DefaultRoomMode,
    type HapticsMode,
    type LockTimeoutMs,
  } from '../../lib/appPrefs';
  import {
    appShotsEnabled,
    shotRooms,
  } from '../../lib/appStoreShots';

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
  let amoled = $state(false);
  let scheme = $state<AppScheme>('dark');
  let seed = $state<string>(DEFAULT_SEED);
  let hapticsMode = $state<HapticsMode>('all');
  let hapticsOk = $state(false);
  let reduceMotion = $state(false);
  let keepAwake = $state(true);
  let defaultRoomMode = $state<DefaultRoomMode>('live');
  let lockTimeoutMs = $state<LockTimeoutMs>(30_000);
  let notifPermission = $state<NotificationPermission | 'unsupported'>('unsupported');
  let clearingCache = $state(false);
  type PrefSheet = 'platform' | 'theme' | 'haptics' | 'lockTimeout' | 'roomMode' | null;
  let prefSheet = $state<PrefSheet>(null);
  let ready = $state(false);

  let isStandalone = $state(false);
  let deferredInstallPrompt = $state<BeforeInstallPromptEvent | null>(null);
  let showIosInstallSheet = $state(false);

  let rooms = $state<RoomEntry[]>([]);
  let shotsMode = $state(false);

  function withShots(url: string): string {
    if (!shotsMode) return url;
    return url.includes('shots=1') ? url : `${url}${url.includes('?') ? '&' : '?'}shots=1`;
  }
  let searchQuery = $state('');
  let chatFilter = $state<'all' | 'ttl' | 'pinned'>('all');
  let newRoomSheetOpen = $state(false);
  let joinRoomSheetOpen = $state(false);
  let langSheetOpen = $state(false);
  let prefSheetOpen = $derived(prefSheet !== null);
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
  let notifyEpoch = $state(0);
  let notifyIntent = $state<{ roomId: string; on: boolean } | null>(null);
  const notifyRooms = $derived.by(() => {
    void notifyEpoch;
    if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return new Set<string>();
    return new Set(rooms.filter((room) => room.kind !== 'whiteboard' && loadNotifyPref(localStorage, room.roomId)).map((room) => room.roomId));
  });
  let actionsAnchor = $state<HTMLElement | null>(null);
  let roomConn = $state<'connected' | 'connecting' | 'loading' | 'offline'>('connected');
  let roomCall = $state<(() => void) | undefined>(undefined);
  let roomHangup = $state<(() => void) | undefined>(undefined);
  let callRoom = $state<{ id: string; label: string } | null>(null);
  let roomMenu = $state<(() => void) | undefined>(undefined);
  let roomInfo = $state<(() => void) | undefined>(undefined);
  let roomCallState = $state<{ ready: boolean; joining: boolean; active: boolean }>({ ready: false, joining: false, active: false });
  let roomReconnect = $state<(() => void) | null>(null);
  let renameDialogOpen = $state(false);
  let renameValue = $state('');
  let renameInput = $state<HTMLInputElement | null>(null);
  let newPwInput = $state<HTMLInputElement | null>(null);
  let deleteDialogOpen = $state(false);
  let lpTimer: ReturnType<typeof setTimeout> | undefined;
  let lpFired = false;
  let lastRowFocus: HTMLElement | null = null;
  let lpX = 0;
  let lpY = 0;

  let newRoomName = $state('');
  let newRoomPassword = $state('');
  let newRoomKind = $state<'chat' | 'whiteboard'>('chat');
  let newRoomNameError = $state(false);
  let newRoomPwError = $state(false);
  let newRoomMode = $state<'live' | 'ttl'>('live');
  let retentionIndex = $state(RETENTION_SECONDS.indexOf(3600));
  let showNewPw = $state(false);
  let newPwShownByUser = $state(false);
  const retentionSeconds = $derived(RETENTION_SECONDS[retentionIndex] ?? 3600);
  const retentionLabel = $derived(t(dict, 'chat.retentionTtl').replace('{time}', formatDuration(retentionSeconds, locale)));
  let joinRoomId = $state('');
  let joinRoomPassword = $state('');
  let roomEnteredViaPush = $state(false);
  // A lightweight history entry kept while an overlay is open so the first
  // system-back press dismisses the overlay instead of leaving /app.
  let overlayGuard = $state(false);
  let scroller = $state<HTMLElement | null>(null);
  let hubScrolled = $state(false);
  const tabScroll: Record<TabId, number> = { chats: 0, files: 0, boards: 0, settings: 0 };
  let toastMessage = $state('');
  let toastOpen = $state(false);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  let openOverlays: Record<string, boolean> = {};
  let childOverlay = $state(false);
  let closeChildOverlay = $state<() => boolean>(() => false);
  let childGuardTimer: ReturnType<typeof setTimeout> | undefined;

  function labelSearchButtons(node: HTMLElement, labels: { cancel: string; clear: string }) {
    const apply = () => {
      for (const button of node.querySelectorAll<HTMLButtonElement>('.k-searchbar button')) {
        const label = button.parentElement?.classList.contains('k-searchbar') ? labels.cancel : labels.clear;
        if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
      }
    };
    const observer = new MutationObserver(apply);
    observer.observe(node, { childList: true, subtree: true });
    apply();
    return {
      update(next: { cancel: string; clear: string }) { labels = next; apply(); },
      destroy() { observer.disconnect(); },
    };
  }

  function segmentHitSlop(node: HTMLElement) {
    const onClick = (event: MouseEvent) => {
      if ((event.target as Element).closest('button')) return;
      const target = [...node.querySelectorAll<HTMLButtonElement>('button')].find((button) => {
        const rect = button.getBoundingClientRect();
        return event.clientX >= rect.left && event.clientX <= rect.right;
      });
      target?.click();
    };
    node.addEventListener('click', onClick);
    return { destroy() { node.removeEventListener('click', onClick); } };
  }

  function onChildOverlay(open: boolean) {
    if (open === childOverlay) return;
    childOverlay = open;
    clearTimeout(childGuardTimer);
    if (open) return;
    childGuardTimer = setTimeout(() => {
      if (!childOverlay && !Object.entries(openOverlays).some(([k, v]) => k !== 'child' && v)) consumeOverlayGuard();
    }, 60);
  }

  $effect(() => {
    const now: Record<string, boolean> = {
      newRoom: newRoomSheetOpen,
      join: joinRoomSheetOpen,
      lang: langSheetOpen,
      pref: prefSheetOpen,
      install: showIosInstallSheet,
      panic: panicDialogOpen,
      clearBoard: clearBoardDialogOpen,
      vaultExport: vaultExportOpen,
      vaultImport: vaultImportOpen,
      actions: actionsRoom !== null,
      rename: renameDialogOpen,
      del: deleteDialogOpen,
      child: childOverlay,
    };
    const opened = Object.keys(now).filter((key) => now[key] && !openOverlays[key]);
    if (!opened.length) {
      openOverlays = now;
      return;
    }
    pushOverlayGuard();
    const keep = opened[opened.length - 1];
    if (keep !== 'newRoom' && newRoomSheetOpen) closeNewRoomSheet(false);
    if (keep !== 'join' && joinRoomSheetOpen) closeJoinRoomSheet(false);
    if (keep !== 'lang') langSheetOpen = false;
    if (keep !== 'pref') prefSheet = null;
    if (keep !== 'install') showIosInstallSheet = false;
    if (keep !== 'panic') panicDialogOpen = false;
    if (keep !== 'clearBoard') clearBoardDialogOpen = false;
    if (keep !== 'vaultExport') vaultExportOpen = false;
    if (keep !== 'vaultImport') vaultImportOpen = false;
    if (keep !== 'actions') actionsRoom = null;
    if (keep !== 'rename') renameDialogOpen = false;
    if (keep !== 'del') deleteDialogOpen = false;
    if (keep !== 'child' && childOverlay) closeChildOverlay();
    openOverlays = { [keep]: true };
    toastOpen = false;
  });

  function showToast(message: string, feel: 'warning' | 'success' | false = 'warning') {
    toastMessage = message;
    toastOpen = true;
    if (feel) triggerHaptic(feel);
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
    if (appShotsEnabled()) {
      rooms = shotRooms().sort(compareRooms);
      if (activeRoomId && !activeRoomLabel) {
        activeRoomLabel = labelForRoom(activeRoomId, '', activeView === 'board' ? 'whiteboard' : 'chat');
      }
      return;
    }
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
      hubScrolled = (scroller?.scrollTop ?? 0) > 2;
    });
  }

  function boardSessionPassword(id: string): string {
    try {
      return sessionStorage.getItem(`wb-pw:${id}`) || sessionStorage.getItem('whiteboard-password') || '';
    } catch {
      return '';
    }
  }

  $effect(() => {
    if (roomCallState.active) {
      if (activeView === 'room' && activeRoomId && callRoom?.id !== activeRoomId) callRoom = { id: activeRoomId, label: activeRoomLabel };
    } else if (callRoom) {
      callRoom = null;
    }
  });
  let callBarBottom = $state(0);
  $effect(() => {
    if (!callRoom || activeView !== 'hub') return;
    const measure = () => {
      const bar = document.querySelector('.app-main-tabbar');
      callBarBottom = bar ? Math.max(0, window.innerHeight - bar.getBoundingClientRect().top) + 8 : 0;
    };
    const raf = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', measure); };
  });
  const mountedRoomId = $derived(activeView === 'room' ? activeRoomId : (callRoom?.id ?? ''));

  function enterRoom(id: string, kind: 'chat' | 'whiteboard' = 'chat', label = '', bump = true) {
    if (scroller) tabScroll[activeTab] = scroller.scrollTop;
    const keepCall = callRoom?.id === id && kind === 'chat';
    if (callRoom && !keepCall) {
      callRoom = null;
      roomCallState = { ready: false, joining: false, active: false };
    }
    if (!keepCall) {
      roomConn = 'loading';
      roomReconnect = null;
    }
    activeRoomId = id;
    activeRoomLabel = label;
    activeTab = tabForKind(kind);
    activeView = kind === 'whiteboard' ? 'board' : 'room';
    boardReturnRoom = null;
    roomEnteredViaPush = true;
    pushViewState({ view: activeView, roomId: id, kind, label }, withShots(`?room=${encodeURIComponent(id)}&kind=${kind}`));
    if (bump && !shotsMode) void touchRoom(kind, id).then(loadRooms).catch(() => {});
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
    roomConn = 'loading';
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
    notifyEpoch++;
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
    if (!callRoom) {
      roomConn = 'connected';
      roomReconnect = null;
    }
    boardReturnRoom = null;
    window.history.replaceState({ view: 'hub', tab: activeTab }, '', withShots(`?tab=${activeTab}`));
    loadRooms();
    restoreHubScroll();
  }

  function switchTab(tab: TabId) {
    if (tab === activeTab) {
      // Native behavior: re-tapping the active tab scrolls its content to top.
      scroller?.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      return;
    }
    if (scroller) tabScroll[activeTab] = scroller.scrollTop;
    activeTab = tab;
    searchQuery = '';
    chatFilter = 'all';
    window.history.replaceState({ view: 'hub', tab }, '', withShots(`?tab=${tab}`));
    restoreHubScroll();
  }

  function closeNewRoomSheet(popGuard = true) {
    newRoomSheetOpen = false;
    newRoomName = '';
    newRoomPassword = '';
    newRoomNameError = false;
    newRoomPwError = false;
    newRoomMode = defaultRoomMode;
    showNewPw = false;
    newPwShownByUser = false;
    retentionIndex = RETENTION_SECONDS.indexOf(3600);
    creatingRoom = false;
    if (popGuard) consumeOverlayGuard();
  }

  function openNewRoom(kind: 'chat' | 'whiteboard') {
    newRoomKind = kind;
    newRoomMode = defaultRoomMode;
    newRoomSheetOpen = true;
  }

  function closePrefSheet(popGuard = true) {
    prefSheet = null;
    if (popGuard) consumeOverlayGuard();
  }

  function openPrefSheet(kind: Exclude<PrefSheet, null>) {
    prefSheet = kind;
  }

  function applyAppTheme(next: { platform?: AppPlatform; appearance?: AppAppearance; amoled?: boolean }) {
    if (next.platform) platform = next.platform;
    if (next.appearance) appearance = next.appearance;
    if (next.amoled !== undefined) amoled = next.amoled;
    const state = { platform, appearance, seed, amoled };
    saveThemeState(state);
    scheme = applyTheme(state);
    triggerHaptic('medium');
  }

  function setHapticsMode(mode: HapticsMode) {
    hapticsMode = mode;
    saveHapticsMode(mode);
    if (mode !== 'off') triggerHaptic(mode === 'essential' ? 'medium' : 'light');
    closePrefSheet();
  }

  function setLockTimeout(ms: LockTimeoutMs) {
    lockTimeoutMs = ms;
    saveLockTimeoutMs(ms);
    triggerHaptic('light');
    closePrefSheet();
  }

  function setDefaultRoomMode(mode: DefaultRoomMode) {
    defaultRoomMode = mode;
    saveDefaultRoomMode(mode);
    triggerHaptic('light');
    closePrefSheet();
  }

  function designLabel(): string {
    return platform === 'ios' ? t(dict, 'app.settings.designIos') : t(dict, 'app.settings.designMaterial');
  }

  function themeLabel(): string {
    if (appearance === 'light') return t(dict, 'app.settings.themeLight');
    if (appearance === 'dark') return t(dict, 'app.settings.themeDark');
    return t(dict, 'app.settings.themeSystem');
  }

  function hapticsLabel(): string {
    if (hapticsMode === 'off') return t(dict, 'app.settings.hapticsOff');
    if (hapticsMode === 'essential') return t(dict, 'app.settings.hapticsEssential');
    return t(dict, 'app.settings.hapticsAll');
  }

  function dialogStack(...labels: string[]): string {
    return platform === 'ios' && labels.some((l) => l.length > 11) ? 'app-dialog--stack' : '';
  }

  function lockTimeoutText(ms: LockTimeoutMs): string {
    if (ms === 0) return t(dict, 'app.settings.lockTimeout.immediate');
    if (ms === 60_000) return t(dict, 'app.settings.lockTimeout.1m');
    if (ms === 300_000) return t(dict, 'app.settings.lockTimeout.5m');
    return t(dict, 'app.settings.lockTimeout.30s');
  }

  function lockTimeoutLabel(): string {
    return lockTimeoutText(lockTimeoutMs);
  }

  function prefSheetTitle(): string {
    if (prefSheet === 'platform') return t(dict, 'app.settings.design');
    if (prefSheet === 'theme') return t(dict, 'app.settings.theme');
    if (prefSheet === 'haptics') return t(dict, 'app.settings.haptics');
    if (prefSheet === 'lockTimeout') return t(dict, 'app.settings.lockTimeout');
    if (prefSheet === 'roomMode') return t(dict, 'app.settings.defaultRoomMode');
    return '';
  }

  function roomModeLabel(mode: DefaultRoomMode = defaultRoomMode): string {
    return mode === 'ttl' ? t(dict, 'chat.modeTtlTitle') : t(dict, 'chat.modeLiveTitle');
  }

  function notifLabel(): string {
    if (notifPermission === 'granted') return t(dict, 'app.settings.notificationsGranted');
    if (notifPermission === 'denied') return t(dict, 'app.settings.notificationsDenied');
    if (notifPermission === 'default') return t(dict, 'app.settings.notificationsDefault');
    return t(dict, 'app.settings.notificationsUnsupported');
  }

  function languageName(): string {
    return (languages as Record<string, { name: string }>)[locale]?.name ?? 'English';
  }

  const shareIcon = $derived<IconName>(platform === 'ios' ? 'share' : 'share-android');
  const moreIcon = $derived<IconName>(platform === 'ios' ? 'more-h' : 'more');

  const DAY_MS = 24 * 60 * 60 * 1000;
  // Messages-style row stamp: time today, "Yesterday", weekday this week, short date after.
  function rowStamp(ts: number | undefined): string {
    if (!ts || !Number.isFinite(ts)) return '';
    const now = new Date();
    const then = new Date(ts);
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    try {
      if (ts >= startToday) return then.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
      if (ts >= startToday - DAY_MS) {
        const word = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-1, 'day');
        return word.charAt(0).toLocaleUpperCase(locale) + word.slice(1);
      }
      if (ts >= startToday - 6 * DAY_MS) return then.toLocaleDateString(locale, { weekday: 'short' });
      return then.toLocaleDateString(locale, { day: 'numeric', month: 'numeric', year: '2-digit' });
    } catch {
      return '';
    }
  }

  function refreshNotifPermission() {
    if (typeof Notification === 'undefined') {
      notifPermission = 'unsupported';
      return;
    }
    notifPermission = Notification.permission;
  }

  async function handleNotificationSetting() {
    triggerHaptic('light');
    if (typeof Notification === 'undefined') {
      showToast(t(dict, 'app.settings.notificationsUnsupported'), 'warning');
      return;
    }
    if (Notification.permission === 'denied') {
      showToast(t(dict, 'chat.notifyDenied.app'), 'warning');
      return;
    }
    if (Notification.permission === 'granted') {
      showToast(t(dict, 'app.settings.notificationsGranted'), 'success');
      return;
    }
    const result = await Notification.requestPermission().catch(() => 'denied' as NotificationPermission);
    notifPermission = result;
    showToast(
      t(dict, result === 'granted' ? 'app.settings.notificationsGranted' : 'chat.notifyDenied.app'),
      result === 'granted' ? 'success' : 'warning',
    );
  }

  async function handleClearCache() {
    if (clearingCache) return;
    clearingCache = true;
    triggerHaptic('medium');
    const ok = await clearAppCaches();
    clearingCache = false;
    showToast(t(dict, ok ? 'app.settings.clearCacheDone' : 'app.settings.clearCacheError'), ok ? 'success' : 'warning');
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
    if (prefSheet) { closePrefSheet(); return; }
    if (showIosInstallSheet) { showIosInstallSheet = false; consumeOverlayGuard(); return; }
    if (panicDialogOpen) { panicDialogOpen = false; consumeOverlayGuard(); return; }
    if (vaultExportOpen) { vaultExportOpen = false; vaultExportPw = ''; consumeOverlayGuard(); return; }
    if (vaultImportOpen) { vaultImportOpen = false; vaultImportPw = ''; vaultImportError = ''; consumeOverlayGuard(); return; }
    if (clearBoardDialogOpen) { clearBoardDialogOpen = false; pendingClearBoard = null; consumeOverlayGuard(); return; }
    if (actionsRoom) { closeRowActions(); return; }
    if (renameDialogOpen) { renameDialogOpen = false; endRowInteraction(); consumeOverlayGuard(); return; }
    if (deleteDialogOpen) { deleteDialogOpen = false; endRowInteraction(); consumeOverlayGuard(); return; }
    if (childOverlay) closeChildOverlay();
  }

  /** Swallow the backdrop tap that Android/iOS synthesizes when the long-press finger lifts. */
  let ignoreActionsBackdrop = false;
  let actionsBackdropTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingActionsHaptic = false;

  function openRowActions(room: RoomEntry, fromLongPress = false) {
    lastRowFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    actionTarget = room;
    actionsRoom = room;
    if (fromLongPress) {
      // Finger is still down over the new backdrop — ignore dismiss until after lift.
      ignoreActionsBackdrop = true;
      clearTimeout(actionsBackdropTimer);
      actionsBackdropTimer = setTimeout(() => { ignoreActionsBackdrop = false; }, 450);
      if (hapticsNeedGestureEnd()) pendingActionsHaptic = true;
      else triggerHaptic('medium');
    } else {
      ignoreActionsBackdrop = false;
      triggerHaptic('medium');
    }
  }

  function endRowInteraction() {
    actionTarget = null;
    if (lastRowFocus?.isConnected) lastRowFocus.focus();
    lastRowFocus = null;
  }

  function closeRowActions() {
    actionsRoom = null;
    pendingActionsHaptic = false;
    ignoreActionsBackdrop = false;
    clearTimeout(actionsBackdropTimer);
    endRowInteraction();
    consumeOverlayGuard();
  }

  function onActionsBackdrop() {
    if (ignoreActionsBackdrop) return;
    closeRowActions();
  }

  let pressingId = $state('');

  function rowPressStart(room: RoomEntry) {
    lpFired = false;
    clearTimeout(lpTimer);
    pressingId = room.id;
    lpTimer = setTimeout(() => {
      lpFired = true;
      pressingId = '';
      openRowActions(room, true);
    }, 550);
  }

  function rowPressEnd() {
    clearTimeout(lpTimer);
    pressingId = '';
    // iOS: switch-tick grant arrives on touchend — buzz now so long-press feedback lands.
    if (pendingActionsHaptic) {
      pendingActionsHaptic = false;
      triggerHaptic('medium');
    }
  }

  async function shareRoom() {
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

  async function toggleRowNotify() {
    const target = actionTarget;
    actionsRoom = null;
    pendingActionsHaptic = false;
    ignoreActionsBackdrop = false;
    clearTimeout(actionsBackdropTimer);
    endRowInteraction();
    const fail = (message?: string) => {
      consumeOverlayGuard();
      if (message) showToast(message);
    };
    if (!target) return fail();
    const on = !notifyRooms.has(target.roomId);
    if (on) {
      if (!('Notification' in window)) return fail(t(dict, 'app.settings.notificationsUnsupported'));
      let permission = Notification.permission;
      if (permission === 'default') permission = await Notification.requestPermission().catch(() => 'denied' as NotificationPermission);
      if (permission !== 'granted') return fail(t(dict, 'chat.notifyDenied.app'));
      saveNotifyPref(localStorage, target.roomId, true);
    }
    notifyIntent = { roomId: target.roomId, on };
    notifyEpoch++;
    enterRoom(target.roomId, 'chat', target.label);
  }

  function notifyIntentDone(on: boolean) {
    notifyIntent = null;
    notifyEpoch++;
    showToast(t(dict, on ? 'app.row.notifyOnDone' : 'app.row.notifyOffDone'), on ? 'success' : false);
  }

  async function togglePin() {
    const target = actionTarget;
    closeRowActions();
    if (!target) return;
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
    void tick().then(() => { renameInput?.focus(); renameInput?.select(); });
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
      showToast(t(dict, 'app.row.removed'), false);
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
      if (chatFilter === 'ttl' && (!r.mode || r.mode === 'live')) return false;
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

  const canCreateRoom = $derived(Boolean(normalizeRoomId(newRoomName)) && passwordLongEnough(newRoomPassword.trim()));

  let creatingRoom = false;
  async function handleCreateRoom() {
    if (creatingRoom) return;
    const id = normalizeRoomId(newRoomName);
    const password = newRoomPassword.trim();
    if (!id) {
      newRoomNameError = true;
      triggerHaptic('warning');
      return;
    }
    if (!passwordLongEnough(password)) {
      newRoomPwError = true;
      triggerHaptic('warning');
      return;
    }
    creatingRoom = true;
    triggerHaptic('medium');
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
    const label = newRoomName.trim() || id;
    persistRoom(newRoomKind, id, label, true, mode);
    closeNewRoomSheet(false);
    enterRoom(id, newRoomKind, label, false);
    creatingRoom = false;
  }

  function generateNewRoomPassphrase() {
    newRoomPassword = genRoomPassphrase();
    showNewPw = true;
    newPwShownByUser = false;
    newRoomPwError = false;
    triggerHaptic('light');
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
  let checkingUpdate = $state(false);
  const updateAvailable = $derived(Boolean(latestVersion && !isDevBuild && latestVersion.commit !== CURRENT_VERSION.commit));

  async function checkForUpdate(manual = false) {
    if (checkingUpdate) return;
    if (manual) checkingUpdate = true;
    try {
      const latest = await fetchLatestVersion();
      if (!latest) {
        if (manual) showToast(t(dict, 'app.settings.updateCheckFailed'), 'warning');
        return;
      }
      latestVersion = latest;
      if (isDevBuild) {
        if (manual) showToast(t(dict, 'app.settings.upToDate'), 'success');
        return;
      }
      if (latest.commit === CURRENT_VERSION.commit) {
        if (manual) showToast(t(dict, 'app.settings.upToDate'), 'success');
        return;
      }
      if (dismissedUpdate !== latest.commit || manual) updateToastOpen = true;
    } finally {
      checkingUpdate = false;
    }
  }

  function dismissUpdateToast() {
    updateToastOpen = false;
    if (latestVersion) dismissedUpdate = latestVersion.commit;
  }

  let updating = false;
  async function updateApp() {
    if (updating) return;
    updating = true;
    updateToastOpen = false;
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
  // IDB), sealed whiteboard docs (board-local IDB), per-room trust tables /
  // mode / schedule / history / alias keys in localStorage, and password
  // handoffs + sealed scheduled drafts in sessionStorage.
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
  let unlockAbort: AbortController | null = null;

  /** Show the lock overlay and warm the passkey ref; never auto-prompt (needs a tap for WebAuthn). */
  function engageLock() {
    prepareLockScreen();
    locked = true;
    lockError = '';
    void warmPasskeyRef();
  }

  async function tryUnlock() {
    unlockAbort?.abort();
    const ac = new AbortController();
    unlockAbort = ac;
    lockBusy = true;
    lockError = '';
    try {
      const ok = await unlock({ signal: ac.signal });
      if (ac.signal.aborted) return;
      if (ok) {
        locked = false;
        triggerHaptic('success');
      } else {
        lockError = t(dict, 'app.lock.failed');
        triggerHaptic('warning');
      }
    } finally {
      if (unlockAbort === ac) {
        lockBusy = false;
        unlockAbort = null;
      }
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
    unlockAbort?.abort();
    unlockAbort = null;
    clearLock();
    lockEnabled = false;
    locked = false;
    lockBusy = false;
    lockError = '';
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
      suppressLocalBoards();
      // Broadcast first so sibling tabs and in-flight board saves see the flag
      // before IndexedDB deletes finish.
      try { localStorage.setItem(PANIC_FLAG, String(Date.now())); } catch {}
      await Promise.all([forgetEverything(), forgetChatIdentity(), forgetSharePasswords(), forgetLocalBoards()]);
      wipeLocalSecrets();
      // Drop the flag so later board saves are not permanently suppressed in this tab.
      try { localStorage.removeItem(PANIC_FLAG); } catch {}
      allowLocalBoards();
    } catch {
      ok = false;
    } finally {
      wiping = false;
    }
    rooms = [];
    showToast(t(dict, ok ? 'app.settings.wipeDone' : 'app.settings.wipeError'), false);
  }

  async function handleVaultExport() {
    if (vaultExportBusy || !vaultExportPw.trim()) return;
    vaultExportBusy = true;
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
    amoled = Boolean(state.amoled);
    seed = state.seed;
    scheme = applyTheme(state);
    if (appShotsEnabled()) {
      const q = new URLSearchParams(window.location.search);
      platform = q.get('platform') === 'material' ? 'material' : 'ios';
      appearance = q.get('scheme') === 'light' ? 'light' : 'dark';
      scheme = applyTheme({ platform, appearance, seed, amoled });
    }
    hapticsMode = loadHapticsMode();
    hapticsOk = hapticsAvailable();
    if (hapticsOk) installHapticGrant();
    reduceMotion = loadReduceMotion();
    applyReduceMotion(reduceMotion);
    keepAwake = loadKeepAwake();
    defaultRoomMode = loadDefaultRoomMode();
    lockTimeoutMs = loadLockTimeoutMs();
    refreshNotifPermission();
    ready = true;

    lockEnabled = storedLock() !== null;
    if (lockEnabled) engageLock();
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
      void checkForUpdate(false);
      if (lockEnabled && !locked && shouldLock(hiddenAt, Date.now(), lockTimeoutMs)) {
        engageLock();
      }
      hiddenAt = 0;
    };
    document.addEventListener('visibilitychange', onVisibility);
    void checkForUpdate(false);
    const updateTimer = setInterval(() => void checkForUpdate(false), 30 * 60_000);

    const onOffline = () => showToast(t(dict, 'app.offline'), false);
    const onOnline = () => showToast(t(dict, 'app.backOnline'), false);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);

    const onStorage = (e: StorageEvent) => {
      if (e.key === PANIC_FLAG && e.newValue) {
        suppressLocalBoards();
        wipeLocalSecrets();
        void forgetLocalBoards().finally(() => {
          try { localStorage.removeItem(PANIC_FLAG); } catch {}
          location.reload();
        });
      }
    };
    // Stale panic flag from an older wipe would silently block board-local saves forever.
    try {
      if (localStorage.getItem(PANIC_FLAG)) localStorage.removeItem(PANIC_FLAG);
    } catch {}
    window.addEventListener('storage', onStorage);

    const schemeQuery = window.matchMedia('(prefers-color-scheme: light)');
    const onScheme = () => {
      if (appearance === 'system') scheme = applyTheme({ platform, appearance, seed, amoled });
    };
    schemeQuery.addEventListener('change', onScheme);

    const params = new URLSearchParams(window.location.search);
    let roomParam = params.get('room');
    let kindParam = params.get('kind');
    let tabParam = params.get('tab');
    shotsMode = appShotsEnabled(window.location.search);
    if (shotsMode) {
      rooms = shotRooms().sort(compareRooms);
      if (!roomParam && !tabParam) tabParam = 'chats';
    }
    if (!shotsMode && !roomParam && !tabParam && !params.get('action')) {
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
      activeRoomLabel = labelForRoom(roomParam, roomParam, kind);
      activeView = kind === 'whiteboard' ? 'board' : 'room';
      activeTab = tabForKind(kind);
      window.history.replaceState({ view: 'hub', tab: activeTab }, '', withShots(`?tab=${activeTab}`));
      window.history.pushState({ view: activeView, roomId: roomParam, kind, label: activeRoomLabel }, '', withShots(`?room=${encodeURIComponent(roomParam)}&kind=${kind}`));
      roomEnteredViaPush = true;
      if (!shotsMode) persistRoom(kind, roomParam, roomParam);
    } else if (tabParam === 'files' || tabParam === 'boards' || tabParam === 'settings' || tabParam === 'chats') {
      activeTab = tabParam;
      if (roomParam) window.history.replaceState({ view: 'hub', tab: activeTab }, '', `?tab=${activeTab}`);
    } else if (roomParam) {
      window.history.replaceState({ view: 'hub', tab: 'chats' }, '', '?tab=chats');
    }
    if (!roomParam && params.get('action') === 'new') {
      openNewRoom(activeTab === 'boards' ? 'whiteboard' : 'chat');
      window.history.replaceState({ view: 'hub', tab: activeTab }, '', `?tab=${activeTab}`);
    }

    const handlePopState = (e: PopStateEvent) => {
      overlayGuard = false;
      newRoomSheetOpen = false;
      joinRoomSheetOpen = false;
      langSheetOpen = false;
      prefSheet = null;
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
      clearTimeout(childGuardTimer);
      if (childOverlay) closeChildOverlay();
      childOverlay = false;
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
    const onSwMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; roomId?: unknown } | null;
      if (data?.type !== 'encrypt-open-room' || typeof data.roomId !== 'string' || !validRoomId(data.roomId) || wiping) return;
      if (activeView === 'room' && activeRoomId === data.roomId) return;
      enterRoom(data.roomId, 'chat', labelForRoom(data.roomId, '', 'chat'));
    };
    navigator.serviceWorker?.addEventListener('message', onSwMessage);

    loadRooms();

    const removeSheetSwipe = installSheetSwipe();
    const removeViewportSync = installViewportSync();
    return () => {
      removeSheetSwipe();
      removeViewportSync();
      window.removeEventListener('keydown', onKeydown);
      window.removeEventListener('popstate', handlePopState);
      navigator.serviceWorker?.removeEventListener('message', onSwMessage);
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
    class={pressingId === room.id ? 'app-row-press' : actionsRoom?.id === room.id ? 'app-row-active' : ''}
    link
    chevronMaterial={false}
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
      actionsAnchor = e.currentTarget as HTMLElement;
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
      actionsAnchor = e.currentTarget as HTMLElement;
      lpFired = true;
      openRowActions(room, false);
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
      <span class="app-row-meta">
        {#if room.pinned}
          <span class="app-row-meta__icon"><AppIcons name="pin" size={13} strokeWidth={2.25} /></span>
          <span class="sr-only">{t(dict, 'app.filter.pinned')}</span>
        {/if}
        {#if room.kind !== 'whiteboard' && room.mode && room.mode !== 'live'}
          <span class="app-row-meta__icon"><AppIcons name="timer" size={13} strokeWidth={2.25} /></span>
        {/if}
        {#if notifyRooms.has(room.roomId)}
          <span class="app-row-meta__icon"><AppIcons name="bell" size={13} strokeWidth={2.25} /></span>
          <span class="sr-only">{t(dict, 'app.row.notifyOnDone')}</span>
        {/if}
        <span class="app-row-meta__time">{rowStamp(room.lastSeen)}</span>
      </span>
    {/snippet}
  </ListItem>
{/snippet}

{#snippet toastDismiss()}
  <button type="button" class="app-toast__close" tabindex={toastOpen ? 0 : -1} onclick={() => (toastOpen = false)} aria-label={t(dict, 'app.close')}>
    <AppIcons name="close" size={20} />
  </button>
{/snippet}

{#snippet sheetHeader(title: string, onClose: () => void, confirm?: { label: string; disabled: boolean; run: () => void })}
  {#if platform === 'ios'}
    <div class="app-sheet-bar">
      {#if confirm}
        <button type="button" class="app-sheet-bar__btn" onclick={onClose} aria-label={t(dict, 'app.cancel')}>
          <AppIcons name="close" size={19} strokeWidth={2.4} />
        </button>
      {:else}
        <span class="app-sheet-bar__btn app-sheet-bar__btn--spacer" aria-hidden="true"></span>
      {/if}
      <h3 class="app-sheet-bar__title">{title}</h3>
      {#if confirm}
        <button type="button" class="app-sheet-bar__btn app-sheet-bar__btn--confirm" onclick={confirm.run} disabled={confirm.disabled} aria-label={confirm.label}>
          <AppIcons name="check" size={20} strokeWidth={2.75} />
        </button>
      {:else}
        <button type="button" class="app-sheet-bar__btn" onclick={onClose} aria-label={t(dict, 'app.close')}>
          <AppIcons name="close" size={19} strokeWidth={2.4} />
        </button>
      {/if}
    </div>
  {:else}
    <h3 class="app-sheet-headline">{title}</h3>
  {/if}
{/snippet}

{#snippet choiceRow(title: string, selected: boolean, pick: () => void, text?: string)}
  {#if platform === 'material'}
    <ListItem link chevron={false} linkComponent="button" linkProps={{ type: 'button', role: 'radio', 'aria-checked': selected }} {title} {text} onClick={pick}>
      {#snippet media()}<span class="app-radio" class:app-radio--on={selected} aria-hidden="true"></span>{/snippet}
    </ListItem>
  {:else}
    <ListItem link chevron={false} linkComponent="button" linkProps={{ type: 'button', role: 'radio', 'aria-checked': selected }} {title} {text} onClick={pick}>
      {#snippet after()}
        {#if selected}<AppIcons name="check" size={20} class="text-[var(--app-tint)]" strokeWidth={2.75} />{/if}
      {/snippet}
    </ListItem>
  {/if}
{/snippet}

{#snippet settingIcon(name: IconName, tone: 'blue' | 'indigo' | 'teal' | 'pink' | 'green' | 'orange' | 'red' | 'gray')}
  {#if platform === 'ios'}
    <span class="app-icon-tile app-icon-tile--{tone}" aria-hidden="true"><AppIcons {name} size={17} strokeWidth={2.25} /></span>
  {:else}
    <span class="app-icon-plain" class:app-icon-plain--danger={tone === 'red' && name === 'trash'} aria-hidden="true"><AppIcons {name} size={24} strokeWidth={1.75} /></span>
  {/if}
{/snippet}

{#snippet hubTitle()}
  <span class="app-hub-label">{t(dict, `app.tab.${activeTab}`)}</span>
{/snippet}

{#snippet hubPlus()}
  <button
    type="button"
    class="w-11 h-11 flex items-center justify-center text-primary rounded-full"
    onclick={() => openNewRoom(activeTab === 'boards' ? 'whiteboard' : 'chat')}
    aria-label={t(dict, activeTab === 'boards' ? 'app.new.titleBoard' : 'app.new.titleChat')}
  >
    <AppIcons name="plus" size={22} />
  </button>
{/snippet}

{#snippet roomBar()}
  <Navbar
    class="app-room-bar {platform === 'material' ? 'app-bar ' : ''}z-40"
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
      {#if roomConn === 'offline'}
        <button
          type="button"
          class="app-conn-status app-conn-status--offline"
          onclick={() => roomReconnect?.()}
          aria-label={`${t(dict, 'app.offline')} — ${t(dict, 'app.room.reconnect')}`}
        >
          {t(dict, 'app.offline')}
        </button>
      {:else if roomConn === 'connecting' || roomConn === 'loading'}
        <button
          type="button"
          class="app-conn-status"
          onclick={() => {
            if (roomConn === 'connecting') roomReconnect?.();
          }}
          aria-label={roomConn === 'connecting'
            ? `${t(dict, 'chat.connecting')} — ${t(dict, 'app.room.reconnect')}`
            : t(dict, 'common.working')}
          disabled={roomConn === 'loading'}
        >
          <span class="app-spinner" aria-hidden="true"></span>
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
          aria-busy={roomCallState.joining}
        >
          {#if roomCallState.joining}<span class="app-spinner" aria-hidden="true"></span>{:else}<AppIcons name="call" size={20} />{/if}
        </button>
      {/if}
      <button
        type="button"
        class="app-nav-btn shrink-0 w-11 h-11 flex items-center justify-center text-primary rounded-full"
        onclick={shareRoom}
        aria-label={t(dict, 'common.shareLink')}
      >
        <AppIcons name={shareIcon} size={20} />
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
          <AppIcons name={moreIcon} size={20} />
        </button>
      {/if}
    {/snippet}
  </Navbar>
{/snippet}

{#snippet newRoomFab()}
  {#if platform === 'material' && (activeTab === 'chats' || activeTab === 'boards') && (visibleRooms.length > 0 || searchQuery.trim() || chatFilter !== 'all')}
    <Fab
      class="fixed right-4 z-40"
      style="bottom: calc(5.5rem + env(safe-area-inset-bottom, 0px))"
      text={t(dict, 'app.empty.new')}
      onClick={() => openNewRoom(activeTab === 'boards' ? 'whiteboard' : 'chat')}
    >
      {#snippet icon()}<AppIcons name="plus" size={20} />{/snippet}
    </Fab>
  {/if}
{/snippet}

<App theme={platform} dark={scheme === 'dark'} safeAreas={true}>
  <Page class="app-page-bg h-full flex flex-col overflow-hidden">
    {#if !ready}
      <div class="app-skel-hub" role="status" aria-live="polite" aria-label={t(dict, 'common.working')}>
        <span class="app-skel app-skel--title"></span>
        <span class="app-skel app-skel--search"></span>
        {#each [64, 52, 70, 46, 58] as width, i (i)}
          <div class="app-skel-row">
            <span class="app-skel app-skel--avatar"></span>
            <span class="app-skel-row__lines">
              <span class="app-skel app-skel--line" style="width: {width}%"></span>
              <span class="app-skel app-skel--line app-skel--sm" style="width: {width - 18}%"></span>
            </span>
          </div>
        {/each}
      </div>
    {:else if activeView === 'room'}
      {@render roomBar()}
    {:else if activeView === 'board'}
      {@render roomBar()}
      <div class="app-wb-wrapper">
        <Whiteboard
          roomId={activeRoomId}
          {locale}
          {dict}
          appMode={true}
          initialPassword={boardSessionPassword(activeRoomId)}
          onExitApp={leaveRoom}
          onConnStatus={(s) => (roomConn = s)}
          onHaptic={triggerHaptic}
          bind:requestReconnect={roomReconnect}
          onOverlayChange={onChildOverlay}
          bind:closeOverlay={closeChildOverlay}
          onClearRequest={(doClear) => {
            pendingClearBoard = doClear;
            clearBoardDialogOpen = true;
          }}
        />
      </div>
    {:else}
      {@const showPlus = platform === 'ios' && (activeTab === 'chats' || activeTab === 'boards')}
      <div class="flex-1 overflow-y-auto min-h-0 app-scroll" class:app-scroll--scrolled={hubScrolled} bind:this={scroller} onscroll={() => { hubScrolled = (scroller?.scrollTop ?? 0) > 2; }}>
        {#if showPlus}
          <Navbar large transparent class="app-hub-bar z-40">
            {#snippet title()}{@render hubTitle()}{/snippet}
            {#snippet right()}{@render hubPlus()}{/snippet}
          </Navbar>
        {:else if platform === 'ios'}
          <Navbar large transparent class="app-hub-bar z-40">
            {#snippet title()}{@render hubTitle()}{/snippet}
          </Navbar>
        {:else}
          <Navbar class="app-bar app-hub-bar z-40">
            {#snippet title()}{@render hubTitle()}{/snippet}
          </Navbar>
        {/if}

      {#if activeTab === 'chats' || activeTab === 'boards'}
        <div class="app-content px-4 pt-2 pb-1" use:labelSearchButtons={{ cancel: t(dict, 'app.cancel'), clear: t(dict, 'emoji.clearSearch') }}>
          <Searchbar
            class="mx-0! w-full!"
            bind:value={searchQuery}
            onClear={() => (searchQuery = '')}
            onDisable={() => (searchQuery = '')}
            disableButton={platform === 'ios'}
            placeholder={t(dict, 'app.search')}
          />
          {#if activeTab === 'chats'}
            <div class="app-filter-hit" use:segmentHitSlop>
              <Segmented strong rounded class="app-filter" colors={{ strongHighlightBgMaterial: 'bg-md-light-secondary-container dark:bg-md-dark-secondary-container' }}>
                {#each [['all', 'app.filter.all'], ['ttl', 'app.filter.ttl'], ['pinned', 'app.filter.pinned']] as [value, key] (value)}
                  <SegmentedButton active={chatFilter === value} aria-pressed={chatFilter === value} onClick={() => { chatFilter = value as typeof chatFilter; triggerHaptic('light'); }}>
                    <span class="app-seg">
                      {#if platform === 'material' && chatFilter === value}<AppIcons name="check" size={16} strokeWidth={2.5} />{/if}
                      {t(dict, key)}
                    </span>
                  </SegmentedButton>
                {/each}
              </Segmented>
            </div>
          {/if}
        </div>

        <div class="app-content">
          {#if visibleRooms.length > 0}
            <List strong inset dividersMaterial={false} class="app-group my-3!">
              {#each visibleRooms as room (room.id)}
                {@render roomRow(room)}
              {/each}
            </List>
          {:else if searchQuery.trim() || chatFilter !== 'all'}
            {@const filtered = !searchQuery.trim()}
            <div class="px-8 py-16 text-center flex flex-col items-center">
              <div class="w-16 h-16 rounded-full mb-4 flex items-center justify-center bg-[var(--app-fill)] text-[var(--app-label-3)]">
                <AppIcons name={filtered ? (chatFilter === 'pinned' ? 'pin' : 'timer') : 'search'} size={28} />
              </div>
              <p class="text-[17px] font-semibold text-[var(--app-label)]">
                {t(dict, filtered ? (chatFilter === 'pinned' ? 'app.empty.noPinned' : 'app.empty.noTtl') : 'app.empty.noResults')}
              </p>
              <p class="text-[14px] text-[var(--app-label-2)] mt-1 max-w-[260px]">
                {t(dict, filtered ? (chatFilter === 'pinned' ? 'app.empty.noPinnedHint' : 'app.empty.noTtlHint') : 'app.empty.noResultsHint')}
              </p>
              {#if filtered}
                <Button rounded tonal class="app-hit-btn px-5 w-auto! whitespace-nowrap mt-6" onClick={() => { chatFilter = 'all'; triggerHaptic('light'); }}>
                  {t(dict, 'app.filter.showAll')}
                </Button>
              {/if}
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
                <Button rounded class="app-hit-btn px-5 w-auto! whitespace-nowrap" onClick={() => openNewRoom(activeTab === 'boards' ? 'whiteboard' : 'chat')}>
                  <span class="app-btn-label"><AppIcons name="plus" size={16} />{t(dict, 'app.empty.new')}</span>
                </Button>
                {#if activeTab === 'chats'}
                  <Button rounded tonal class="app-hit-btn px-5 w-auto! whitespace-nowrap" onClick={() => { joinRoomSheetOpen = true; }}>
                    <span class="app-btn-label"><AppIcons name="join" size={16} />{t(dict, 'app.empty.join')}</span>
                  </Button>
                {/if}
              </div>
            </div>
          {/if}

          {#if visibleRooms.length > 0 && activeTab === 'chats'}
            <List strong inset dividersMaterial={false} class="app-group my-3!">
              <ListItem
                link
                chevronMaterial={false}
                linkComponent="button"
                linkProps={{ type: 'button' }}
                title={t(dict, 'app.join.row')}
                onClick={() => { joinRoomSheetOpen = true; }}
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
          {#if platform === 'material' && visibleRooms.length > 0}
            <div class="h-20" aria-hidden="true"></div>
          {/if}
        </div>
      {:else if activeTab === 'files'}
        <div class="app-upload-wrapper app-content">
          <UltimateEncrypt {locale} {dict} resultArt={false} appMode />
        </div>
      {:else if activeTab === 'settings'}
        {@const ios = platform === 'ios'}
        <div class="app-content app-settings">
          <BlockTitle>{t(dict, 'app.settings.appearance')}</BlockTitle>
          <List strong inset class="app-group">
            <ListItem
              link
              chevronMaterial={false}
              linkComponent="button"
              linkProps={{ type: 'button' }}
              title={t(dict, 'app.settings.design')}
              after={ios ? designLabel() : undefined}
              class="app-value-row"
              subtitle={ios ? undefined : designLabel()}
              onClick={() => openPrefSheet('platform')}
            >
              {#snippet media()}{@render settingIcon('smartphone', 'blue')}{/snippet}
            </ListItem>
            <ListItem
              link
              chevronMaterial={false}
              linkComponent="button"
              linkProps={{ type: 'button' }}
              title={t(dict, 'app.settings.theme')}
              after={ios ? themeLabel() : undefined}
              class="app-value-row"
              subtitle={ios ? undefined : themeLabel()}
              onClick={() => openPrefSheet('theme')}
            >
              {#snippet media()}{@render settingIcon(appearance === 'light' ? 'sun' : appearance === 'dark' ? 'moon' : 'monitor', 'indigo')}{/snippet}
            </ListItem>
            <ListItem title={t(dict, 'app.settings.amoled')} subtitle={t(dict, 'app.settings.amoledHint')}>
              {#snippet media()}{@render settingIcon('moon', 'gray')}{/snippet}
              {#snippet after()}
                <Toggle checked={amoled} aria-label={t(dict, 'app.settings.amoled')} onChange={() => applyAppTheme({ amoled: !amoled })} />
              {/snippet}
            </ListItem>
            <ListItem title={t(dict, 'app.settings.reduceMotion')} subtitle={t(dict, 'app.settings.reduceMotionHint')}>
              {#snippet media()}{@render settingIcon('eraser', 'teal')}{/snippet}
              {#snippet after()}
                <Toggle
                  checked={reduceMotion}
                  aria-label={t(dict, 'app.settings.reduceMotion')}
                  onChange={() => {
                    reduceMotion = !reduceMotion;
                    saveReduceMotion(reduceMotion);
                    applyReduceMotion(reduceMotion);
                    triggerHaptic('light');
                  }}
                />
              {/snippet}
            </ListItem>
            {#if hapticsOk}
              <ListItem
                link
                chevronMaterial={false}
                linkComponent="button"
                linkProps={{ type: 'button' }}
                title={t(dict, 'app.settings.haptics')}
                after={ios ? hapticsLabel() : undefined}
                class="app-value-row"
                subtitle={ios ? undefined : hapticsLabel()}
                onClick={() => openPrefSheet('haptics')}
              >
                {#snippet media()}{@render settingIcon('haptic', 'pink')}{/snippet}
              </ListItem>
            {/if}
          </List>

          <BlockTitle>{t(dict, 'app.settings.rooms')}</BlockTitle>
          <List strong inset class="app-group">
            <ListItem
              link
              chevronMaterial={false}
              linkComponent="button"
              linkProps={{ type: 'button' }}
              title={t(dict, 'app.settings.defaultRoomMode')}
              after={ios ? roomModeLabel() : undefined}
              class="app-value-row"
              subtitle={ios ? undefined : roomModeLabel()}
              onClick={() => openPrefSheet('roomMode')}
            >
              {#snippet media()}{@render settingIcon(defaultRoomMode === 'ttl' ? 'timer' : 'history', 'green')}{/snippet}
            </ListItem>
            <ListItem title={t(dict, 'app.settings.keepAwake')} subtitle={t(dict, 'app.settings.keepAwakeHint')}>
              {#snippet media()}{@render settingIcon('call', 'orange')}{/snippet}
              {#snippet after()}
                <Toggle
                  checked={keepAwake}
                  aria-label={t(dict, 'app.settings.keepAwake')}
                  onChange={() => {
                    keepAwake = !keepAwake;
                    saveKeepAwake(keepAwake);
                    triggerHaptic('light');
                  }}
                />
              {/snippet}
            </ListItem>
          </List>

          <BlockTitle>{t(dict, 'app.settings.app')}</BlockTitle>
          <List strong inset class="app-group">
            <ListItem
              link
              chevronMaterial={false}
              linkComponent="button"
              linkProps={{ type: 'button' }}
              title={t(dict, 'app.settings.language')}
              after={ios ? languageName() : undefined}
              class="app-value-row"
              subtitle={ios ? undefined : languageName()}
              onClick={() => { langSheetOpen = true; }}
            >
              {#snippet media()}{@render settingIcon('globe', 'blue')}{/snippet}
            </ListItem>
            {#if notifPermission !== 'unsupported'}
              <ListItem
                link
                linkComponent="button"
                linkProps={{ type: 'button' }}
                chevron={false}
                title={t(dict, 'app.settings.notifications')}
                subtitle={notifLabel()}
                onClick={() => void handleNotificationSetting()}
              >
                {#snippet media()}{@render settingIcon(notifPermission === 'granted' ? 'bell' : 'bell-off', 'red')}{/snippet}
              </ListItem>
            {/if}
            <ListItem
              title={t(dict, 'app.settings.version')}
              subtitle={shotsMode ? t(dict, 'app.settings.upToDate') : describeVersion(CURRENT_VERSION, locale)}
            >
              {#snippet media()}{@render settingIcon(updateAvailable ? 'update' : 'check', 'gray')}{/snippet}
              {#snippet after()}
                {#if !shotsMode && updateAvailable}
                  <Button small rounded tonal class="w-auto! px-3" disabled={updating} onClick={updateApp}>{t(dict, 'app.settings.update')}</Button>
                {:else if !shotsMode && latestVersion && !updateAvailable}
                  <span class="app-version-ok">{t(dict, 'app.settings.upToDate')}</span>
                {/if}
              {/snippet}
            </ListItem>
            {#if !shotsMode && !updateAvailable}
              <ListItem
                link
                linkComponent="button"
                linkProps={{ type: 'button', disabled: checkingUpdate || updating }}
                chevron={false}
                title={checkingUpdate ? t(dict, 'app.settings.checkingUpdates') : t(dict, 'app.settings.checkUpdates')}
                subtitle={t(dict, 'app.settings.checkUpdatesHint')}
                onClick={() => {
                  triggerHaptic('light');
                  void checkForUpdate(true);
                }}
              >
                {#snippet media()}{@render settingIcon('refresh', 'gray')}{/snippet}
                {#snippet after()}
                  {#if checkingUpdate}<span class="app-spinner" aria-hidden="true"></span>{/if}
                {/snippet}
              </ListItem>
            {/if}
            <ListItem
              link
              linkComponent="button"
              linkProps={{ type: 'button', disabled: clearingCache }}
              chevron={false}
              title={t(dict, 'app.settings.clearCache')}
              subtitle={t(dict, 'app.settings.clearCacheHint')}
              onClick={() => void handleClearCache()}
            >
              {#snippet media()}{@render settingIcon('database', 'gray')}{/snippet}
              {#snippet after()}
                {#if clearingCache}<span class="app-spinner" aria-hidden="true"></span>{/if}
              {/snippet}
            </ListItem>
          </List>

          <BlockTitle>{t(dict, 'app.settings.security')}</BlockTitle>
          <List strong inset class="app-group">
            <ListItem title={t(dict, 'app.settings.lock')} subtitle={t(dict, 'app.settings.lockHint')}>
              {#snippet media()}{@render settingIcon('lock', 'green')}{/snippet}
              {#snippet after()}
                {#if lockBusy}<span class="app-spinner me-3" aria-hidden="true"></span>{/if}
                {#key lockToggleKey}<Toggle checked={lockEnabled} aria-label={t(dict, 'app.settings.lock')} onChange={toggleLock} />{/key}
              {/snippet}
            </ListItem>
            {#if lockEnabled}
              <ListItem
                link
                chevronMaterial={false}
                linkComponent="button"
                linkProps={{ type: 'button' }}
                title={t(dict, 'app.settings.lockTimeout')}
                after={ios ? lockTimeoutLabel() : undefined}
                class="app-value-row"
                subtitle={ios ? undefined : lockTimeoutLabel()}
                onClick={() => openPrefSheet('lockTimeout')}
              >
                {#snippet media()}{@render settingIcon('timer', 'green')}{/snippet}
              </ListItem>
            {/if}
            <ListItem title={t(dict, 'app.settings.crypto')} subtitle={t(dict, 'app.settings.cryptoValue')}>
              {#snippet media()}{@render settingIcon('shield', 'gray')}{/snippet}
            </ListItem>
            <ListItem
              link
              linkComponent="button"
              linkProps={{ type: 'button' }}
              chevron={false}
              title={t(dict, 'app.backup.export')}
              subtitle={t(dict, 'app.backup.exportHint')}
              onClick={() => { vaultExportOpen = true; }}
            >
              {#snippet media()}{@render settingIcon(shareIcon, 'blue')}{/snippet}
            </ListItem>
            <ListItem
              link
              linkComponent="button"
              linkProps={{ type: 'button' }}
              chevron={false}
              title={t(dict, 'app.backup.import')}
              subtitle={t(dict, 'app.backup.importHint')}
              onClick={() => { vaultImportOpen = true; }}
            >
              {#snippet media()}{@render settingIcon('key', 'blue')}{/snippet}
            </ListItem>
          </List>

          <List strong inset class="app-group">
            <ListItem
              link
              linkComponent="button"
              linkProps={{ type: 'button' }}
              chevron={false}
              subtitle={t(dict, 'app.settings.wipeHint')}
              onClick={() => { panicDialogOpen = true; }}
            >
              {#snippet title()}
                <span class="app-danger-text">{t(dict, 'app.settings.wipe')}</span>
              {/snippet}
              {#snippet media()}{@render settingIcon('trash', 'red')}{/snippet}
            </ListItem>
          </List>
        </div>
      {/if}
      </div>

      {@render newRoomFab()}

      {#if callRoom}
        <div class="app-call-return" style={callBarBottom ? `bottom: ${callBarBottom}px` : undefined} role="group" aria-label={t(dict, 'chat.callInCall')}>
          <button type="button" class="app-call-return__main" onclick={() => { const r = callRoom; if (r) enterRoom(r.id, 'chat', r.label, false); }}>
            <span class="app-call-return__dot" aria-hidden="true"></span>
            <span class="app-call-return__text">
              <span class="app-call-return__title">{callRoom.label || callRoom.id}</span>
              <span class="app-call-return__sub">{t(dict, 'chat.callReturn')}</span>
            </span>
          </button>
          <button type="button" class="app-call-return__end" aria-label={t(dict, 'chat.callHangUp')} title={t(dict, 'chat.callHangUp')} onclick={() => roomHangup?.()}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['phone-off']}</svg>
          </button>
        </div>
      {/if}

      <Tabbar
        labels={true}
        icons={true}
        class={platform === 'ios'
          ? 'app-main-tabbar left-0 bottom-0 fixed z-40'
          : 'app-main-tabbar app-tabbar left-0 bottom-0 fixed z-40'}
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

    {#if ready && mountedRoomId}
      {#key mountedRoomId}
        <div class="app-room-wrapper" class:app-room-wrapper--hidden={activeView !== 'room'} inert={activeView !== 'room' || undefined}>
          <ChatRoom
            roomId={mountedRoomId}
            roomLabel={activeView === 'room' ? activeRoomLabel : (callRoom?.label ?? activeRoomLabel)}
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
            bind:requestHangup={roomHangup}
            bind:requestRoomMenu={roomMenu}
            bind:requestRoomInfo={roomInfo}
            bind:appCallState={roomCallState}
            onOverlayChange={onChildOverlay}
            bind:closeOverlay={closeChildOverlay}
            notifyIntent={notifyIntent?.roomId === mountedRoomId ? notifyIntent.on : null}
            onNotifyIntent={notifyIntentDone}
          />
        </div>
      {/key}
    {/if}

    <!-- NEW ROOM SHEET (kind locked to the tab that opened it) -->
    <Sheet
      opened={newRoomSheetOpen}
      inert={!newRoomSheetOpen}
      onBackdropClick={() => closeNewRoomSheet()}
      class="app-sheet app-sheet--tall pb-[env(safe-area-inset-bottom)]"
    >
      <div class="app-sheet__handle"></div>
      <div class="app-sheet-body">
        {@render sheetHeader(
          t(dict, newRoomKind === 'whiteboard' ? 'app.new.titleBoard' : 'app.new.titleChat'),
          () => closeNewRoomSheet(),
          { label: t(dict, 'app.new.open'), disabled: !canCreateRoom, run: handleCreateRoom },
        )}
        <List strong inset class="m-0! app-form">
          <ListInput
            type="text"
            placeholder={t(dict, newRoomKind === 'whiteboard' ? 'whiteboard.customRoomIdPlaceholder' : 'chat.customRoomIdPlaceholder')}
            bind:value={newRoomName}
            maxlength={64}
            autocomplete="off"
            autocapitalize="off"
            spellcheck={false}
            error={newRoomNameError ? t(dict, 'chat.roomNameRequired') : undefined}
            onInput={() => (newRoomNameError = false)}
            enterkeyhint="next"
            onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); newPwInput?.focus(); } }}
            aria-label={t(dict, 'app.new.name')}
          >
            {#snippet media()}
              <span class="text-[var(--app-label-3)]"><AppIcons name="hash" size={18} /></span>
            {/snippet}
          </ListInput>
          <ListInput
            class="app-pass-row"
            error={newRoomPwError || (newRoomPassword.length > 0 && !passwordLongEnough(newRoomPassword)) ? t(dict, 'app.new.passwordShort') : undefined}
            aria-label={t(dict, 'app.new.password')}
          >
            {#snippet media()}
              <span class="text-[var(--app-label-3)]"><AppIcons name="lock" size={18} /></span>
            {/snippet}
            {#snippet input()}
              <div class="app-passphrase" class:app-passphrase--invalid={newRoomPwError || (newRoomPassword.length > 0 && !passwordLongEnough(newRoomPassword))}>
                <input
                  bind:this={newPwInput}
                  class="app-passphrase__input"
                  enterkeyhint="go"
                  type={showNewPw ? 'text' : 'password'}
                  placeholder={t(dict, 'app.new.passwordPlaceholder')}
                  bind:value={newRoomPassword}
                  autocomplete="new-password"
                  autocapitalize="off"
                  spellcheck="false"
                  data-lpignore="true"
                  data-1p-ignore
                  data-bwignore="true"
                  aria-label={t(dict, 'app.new.password')}
                  aria-invalid={newRoomPwError || (newRoomPassword.length > 0 && !passwordLongEnough(newRoomPassword)) ? 'true' : undefined}
                  oninput={() => {
                    newRoomPwError = false;
                    if (!newPwShownByUser) showNewPw = false;
                  }}
                  onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') handleCreateRoom(); }}
                />
                <button
                  type="button"
                  class="app-passphrase__btn"
                  aria-label={t(dict, showNewPw ? 'common.hidePassword' : 'common.showPassword')}
                  aria-pressed={showNewPw}
                  title={t(dict, showNewPw ? 'common.hidePassword' : 'common.showPassword')}
                  onclick={() => {
                    showNewPw = !showNewPw;
                    newPwShownByUser = showNewPw;
                  }}
                >
                  <AppIcons name={showNewPw ? 'eye-off' : 'eye'} size={18} />
                </button>
                <button
                  type="button"
                  class="app-passphrase__btn"
                  aria-label={t(dict, 'common.generatePassphrase')}
                  title={t(dict, 'common.generatePassphrase')}
                  onclick={generateNewRoomPassphrase}
                >
                  <AppIcons name="dices" size={18} />
                </button>
              </div>
            {/snippet}
          </ListInput>
        </List>
        {#if newRoomKind === 'chat'}
          <List strong inset class="m-0! app-form">
            <ListItem label title={t(dict, 'chat.modeLiveTitle')} text={t(dict, 'chat.modeLiveHint')} onClick={() => { newRoomMode = 'live'; }}>
              {#snippet media()}
                <span class="text-[var(--app-tint)]"><AppIcons name="history" size={20} /></span>
              {/snippet}
              {#snippet after()}
                <Radio component="span" name="new-room-mode" checked={newRoomMode === 'live'} readonly />
              {/snippet}
            </ListItem>
            <ListItem label title={t(dict, 'chat.modeTtlTitle')} text={t(dict, 'chat.modeTtlHint')} onClick={() => { newRoomMode = 'ttl'; }}>
              {#snippet media()}
                <span class="text-[var(--app-tint)]"><AppIcons name="timer" size={20} /></span>
              {/snippet}
              {#snippet after()}
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
        {#if platform === 'material'}
          <Button large rounded class="w-full" disabled={!canCreateRoom} onClick={handleCreateRoom}>
            {t(dict, 'app.new.open')}
          </Button>
        {/if}
      </div>
    </Sheet>

    <!-- JOIN ROOM SHEET -->
    <Sheet
      opened={joinRoomSheetOpen}
      inert={!joinRoomSheetOpen}
      onBackdropClick={() => closeJoinRoomSheet()}
      class="app-sheet app-sheet--tall pb-[env(safe-area-inset-bottom)]"
    >
      <div class="app-sheet__handle"></div>
      <div class="app-sheet-body">
        {@render sheetHeader(t(dict, 'app.join.title'), () => closeJoinRoomSheet(), {
          label: t(dict, 'app.join.connect'),
          disabled: !joinRoomId.trim(),
          run: handleJoinRoom,
        })}
        <List strong inset class="m-0! app-form">
          <ListInput
            type="text"
            placeholder={t(dict, 'app.join.idPlaceholder')}
            bind:value={joinRoomId}
            autocapitalize="none"
            autocorrect="off"
            spellcheck={false}
            aria-label={t(dict, 'app.join.id')}
            enterkeyhint="next"
            onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); document.querySelector<HTMLInputElement>('.app-join-pw input')?.focus(); } }}
          >
            {#snippet media()}
              <span class="text-[var(--app-label-3)]"><AppIcons name="hash" size={18} /></span>
            {/snippet}
          </ListInput>
          <ListInput
            class="app-join-pw"
            type="password"
            placeholder={t(dict, 'app.join.passwordPlaceholder')}
            bind:value={joinRoomPassword}
            autocomplete="current-password"
            enterkeyhint="go"
            aria-label={t(dict, 'app.join.password')}
            onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' && joinRoomId.trim()) handleJoinRoom(); }}
          >
            {#snippet media()}
              <span class="text-[var(--app-label-3)]"><AppIcons name="lock" size={18} /></span>
            {/snippet}
          </ListInput>
        </List>
        {#if platform === 'material'}
          <Button large rounded class="w-full" disabled={!joinRoomId.trim()} onClick={handleJoinRoom}>
            {t(dict, 'app.join.connect')}
          </Button>
        {/if}
      </div>
    </Sheet>

    <!-- LANGUAGE SHEET -->
    <Sheet
      class="app-sheet pb-[env(safe-area-inset-bottom)]"
      opened={langSheetOpen}
      inert={!langSheetOpen}
      onBackdropClick={() => { langSheetOpen = false; consumeOverlayGuard(); }}
    >
      <div class="app-sheet__handle"></div>
      <div class="app-sheet-body app-sheet-body--list">
        {@render sheetHeader(t(dict, 'app.settings.language'), () => { langSheetOpen = false; consumeOverlayGuard(); })}
        <List strong inset class="app-group app-choices m-0!" role="radiogroup" aria-label={t(dict, 'app.settings.language')}>
          {#each locales as code (code)}
            {@render choiceRow(languages[code].name, code === locale, () => pickLanguage(code))}
          {/each}
        </List>
      </div>
    </Sheet>

    <!-- PREFERENCE SHEET -->
    <Sheet
      class="app-sheet pb-[env(safe-area-inset-bottom)]"
      opened={prefSheetOpen}
      inert={!prefSheetOpen}
      onBackdropClick={() => closePrefSheet()}
    >
      <div class="app-sheet__handle"></div>
      <div class="app-sheet-body app-sheet-body--list">
        {@render sheetHeader(prefSheetTitle(), () => closePrefSheet())}
        <List strong inset class="app-group app-choices m-0!" role="radiogroup" aria-label={prefSheetTitle()}>
          {#if prefSheet === 'platform'}
            {@render choiceRow(t(dict, 'app.settings.designIos'), platform === 'ios', () => { applyAppTheme({ platform: 'ios' }); closePrefSheet(); })}
            {@render choiceRow(t(dict, 'app.settings.designMaterial'), platform === 'material', () => { applyAppTheme({ platform: 'material' }); closePrefSheet(); })}
          {:else if prefSheet === 'theme'}
            {@render choiceRow(t(dict, 'app.settings.themeSystem'), appearance === 'system', () => { applyAppTheme({ appearance: 'system' }); closePrefSheet(); })}
            {@render choiceRow(t(dict, 'app.settings.themeLight'), appearance === 'light', () => { applyAppTheme({ appearance: 'light' }); closePrefSheet(); })}
            {@render choiceRow(t(dict, 'app.settings.themeDark'), appearance === 'dark', () => { applyAppTheme({ appearance: 'dark' }); closePrefSheet(); })}
          {:else if prefSheet === 'haptics'}
            {@render choiceRow(t(dict, 'app.settings.hapticsOff'), hapticsMode === 'off', () => setHapticsMode('off'))}
            {@render choiceRow(t(dict, 'app.settings.hapticsEssential'), hapticsMode === 'essential', () => setHapticsMode('essential'), t(dict, 'app.settings.hapticsHint'))}
            {@render choiceRow(t(dict, 'app.settings.hapticsAll'), hapticsMode === 'all', () => setHapticsMode('all'))}
          {:else if prefSheet === 'lockTimeout'}
            {#each LOCK_TIMEOUT_OPTIONS as ms (ms)}
              {@render choiceRow(lockTimeoutText(ms), lockTimeoutMs === ms, () => setLockTimeout(ms))}
            {/each}
          {:else if prefSheet === 'roomMode'}
            {@render choiceRow(roomModeLabel('live'), defaultRoomMode === 'live', () => setDefaultRoomMode('live'), t(dict, 'chat.modeLiveHint'))}
            {@render choiceRow(roomModeLabel('ttl'), defaultRoomMode === 'ttl', () => setDefaultRoomMode('ttl'), t(dict, 'chat.modeTtlHint'))}
          {/if}
        </List>
      </div>
    </Sheet>

    <!-- iOS INSTALL SHEET -->
    <Sheet
      opened={showIosInstallSheet}
      inert={!showIosInstallSheet}
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
          <ListItem title={t(dict, 'app.install.step1')}>
            {#snippet media()}
              <span class="text-[var(--app-tint)]"><AppIcons name="share" size={18} /></span>
            {/snippet}
          </ListItem>
          <ListItem title={t(dict, 'app.install.step2')}>
            {#snippet media()}
              <span class="text-[var(--app-tint)]"><AppIcons name="plus" size={18} /></span>
            {/snippet}
          </ListItem>
          <ListItem title={t(dict, 'app.install.step3')}>
            {#snippet media()}
              <span class="text-[var(--app-tint)]"><AppIcons name="home" size={18} /></span>
            {/snippet}
          </ListItem>
        </List>
        <Button large rounded tonal class="w-full" onClick={() => { showIosInstallSheet = false; consumeOverlayGuard(); }}>
          {t(dict, 'app.close')}
        </Button>
      </div>
    </Sheet>

    {#if updateToastOpen && !toastOpen}
      <div
        class="app-update-banner"
        class:app-update-banner--hub={activeView === 'hub'}
        role="status"
        aria-live="polite"
      >
        <div class="app-update-banner__icon" aria-hidden="true">
          <AppIcons name="update" size={22} />
        </div>
        <div class="app-update-banner__copy">
          <p class="app-update-banner__title">{t(dict, 'app.update.available')}</p>
          {#if latestVersion}
            <p class="app-update-banner__meta">{t(dict, 'app.settings.newVersion').replace('{version}', describeVersion(latestVersion, locale))}</p>
          {/if}
        </div>
        <div class="app-update-banner__actions">
          <button type="button" class="app-update-banner__later" onclick={dismissUpdateToast}>{t(dict, 'app.update.later')}</button>
          <button type="button" class="app-update-banner__now" disabled={updating} onclick={() => void updateApp()}>{t(dict, 'app.update.now')}</button>
        </div>
      </div>
    {/if}

    <Toast
      position="center"
      opened={toastOpen}
      role="status"
      aria-live="polite"
      class="app-toast"
      button={platform === 'material' ? toastDismiss : undefined}
      style="bottom: calc(env(safe-area-inset-bottom, 0px) + {activeView === 'hub' ? '6.5rem' : '4.75rem'})"
    >
      {#if platform === 'ios'}
        <button type="button" class="app-toast__pill" tabindex={toastOpen ? 0 : -1} onclick={() => (toastOpen = false)}>{toastMessage}</button>
      {:else}
        <span class="app-toast__text">{toastMessage}</span>
      {/if}
    </Toast>

    <!-- PANIC DIALOG -->
    <Dialog class={dialogStack(t(dict, 'app.cancel'), t(dict, 'app.settings.wipeConfirm'))} opened={panicDialogOpen} onBackdropClick={() => { panicDialogOpen = false; consumeOverlayGuard(); }}>
      {#snippet title()}{t(dict, 'app.settings.wipe')}{/snippet}
      {t(dict, 'app.settings.wipeBody')}
      {#snippet buttons()}
        <DialogButton class="app-dialog-cancel" onClick={() => { panicDialogOpen = false; consumeOverlayGuard(); }}>{t(dict, 'app.cancel')}</DialogButton>
        <DialogButton onClick={handlePanic} class="app-dialog-destructive">{t(dict, 'app.settings.wipeConfirm')}</DialogButton>
      {/snippet}
    </Dialog>

    <!-- VAULT EXPORT DIALOG -->
    <Dialog class={dialogStack(t(dict, 'app.cancel'), t(dict, 'app.backup.exportConfirm'))} opened={vaultExportOpen} onBackdropClick={() => { vaultExportOpen = false; consumeOverlayGuard(); }}>
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
        <DialogButton class="app-dialog-cancel" onClick={() => { vaultExportOpen = false; vaultExportPw = ''; consumeOverlayGuard(); }}>{t(dict, 'app.cancel')}</DialogButton>
        <DialogButton strong={platform === 'ios'} class="app-dialog-primary" onClick={handleVaultExport} disabled={vaultExportBusy || !vaultExportPw.trim()}>{t(dict, 'app.backup.exportConfirm')}</DialogButton>
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
        <DialogButton class="app-dialog-cancel" onClick={() => { vaultImportOpen = false; vaultImportPw = ''; vaultImportError = ''; consumeOverlayGuard(); }}>{t(dict, 'app.cancel')}</DialogButton>
      {/snippet}
    </Dialog>

    <!-- CLEAR BOARD DIALOG -->
    <Dialog class={dialogStack(t(dict, 'app.cancel'), t(dict, 'whiteboard.delete'))} opened={clearBoardDialogOpen} onBackdropClick={() => { clearBoardDialogOpen = false; consumeOverlayGuard(); }}>
      {#snippet title()}{t(dict, 'whiteboard.delete')}{/snippet}
      {t(dict, 'whiteboard.clearConfirm')}
      {#snippet buttons()}
        <DialogButton class="app-dialog-cancel" onClick={() => { clearBoardDialogOpen = false; consumeOverlayGuard(); }}>{t(dict, 'app.cancel')}</DialogButton>
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

    <!-- ROOM ROW CONTEXT MENU -->
    <Popover class="app-row-menu w-64!" opened={actionsRoom !== null} inert={actionsRoom === null} target={actionsAnchor ?? undefined} onBackdropClick={onActionsBackdrop}>
      <MenuList>
        {#each [
          { key: 'pin', title: t(dict, actionTarget?.pinned ? 'app.row.unpin' : 'app.row.pin'), icon: (actionTarget?.pinned ? 'pin-off' : 'pin') as IconName, run: togglePin, danger: false },
          ...(actionTarget && actionTarget.kind !== 'whiteboard' ? [{ key: 'notify', title: t(dict, notifyRooms.has(actionTarget.roomId) ? 'app.row.notifyOff' : 'app.row.notifyOn'), icon: (notifyRooms.has(actionTarget.roomId) ? 'bell-off' : 'bell') as IconName, run: toggleRowNotify, danger: false }] : []),
          { key: 'rename', title: t(dict, 'app.row.rename'), icon: 'pencil' as IconName, run: openRename, danger: false },
          { key: 'remove', title: t(dict, 'app.row.remove'), icon: 'trash' as IconName, run: openDelete, danger: true },
        ] as item (item.key)}
          {#if platform === 'ios'}
            <MenuListItem class={item.danger ? 'app-menu-danger' : ''} link chevron={false} linkComponent="button" linkProps={{ type: 'button' }} title={item.title} onClick={item.run}>
              {#snippet after()}<AppIcons name={item.icon} size={19} />{/snippet}
            </MenuListItem>
          {:else}
            <MenuListItem class={item.danger ? 'app-menu-danger' : ''} link chevron={false} linkComponent="button" linkProps={{ type: 'button' }} title={item.title} onClick={item.run}>
              {#snippet media()}<AppIcons name={item.icon} size={22} />{/snippet}
            </MenuListItem>
          {/if}
        {/each}
      </MenuList>
    </Popover>

    <!-- RENAME DIALOG -->
    <Dialog
      class={dialogStack(t(dict, 'app.cancel'), t(dict, 'app.save'))}
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
        bind:this={renameInput}
        maxlength="64"
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
          class="app-dialog-cancel"
          onClick={() => {
            renameDialogOpen = false;
            endRowInteraction();
            consumeOverlayGuard();
          }}
        >
          {t(dict, 'app.cancel')}
        </DialogButton>
        <DialogButton strong={platform === 'ios'} class="app-dialog-primary" onClick={saveRename}>{t(dict, 'app.save')}</DialogButton>
      {/snippet}
    </Dialog>

    <!-- DELETE ROOM DIALOG -->
    <Dialog
      class={dialogStack(t(dict, 'app.cancel'), t(dict, 'app.remove.confirm'))}
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
          class="app-dialog-cancel"
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
    <div class="app-lock" role="dialog" aria-modal="true" aria-label={t(dict, 'app.lock.title')}>
      <span class="app-state-glyph" aria-hidden="true"><AppIcons name="lock" size={28} /></span>
      <h1 class="app-lock__title">{t(dict, 'app.lock.title')}</h1>
      <p class="app-lock__hint">{t(dict, 'app.lock.hint')}</p>
      {#if lockError}<p class="app-lock__error" role="alert">{lockError}</p>{/if}
      <Button
        large
        rounded
        class="app-lock__btn"
        disabled={lockBusy}
        onClick={() => void tryUnlock()}
      >
        {#if lockBusy}<span class="app-spinner" aria-hidden="true"></span>{/if}
        {lockError ? t(dict, 'app.lock.retry') : t(dict, 'app.lock.unlock')}
      </Button>
    </div>
  {/if}
</App>
