<script lang="ts">
  import { List, ListItem, MenuList, MenuListItem, Popover, Sheet } from 'konsta/svelte';
  import { illustration } from '../../lib/illustrations';
  import { isContent, relayedContentOk, stampPayload, validPayload } from '../../lib/chatProtocol';
  import { padPayload, SIGNATURE_BYTES } from '../../lib/padding';
  import { loadRoomIdentity, loadTrustTable, saveTrustTable, forgetTrustTable, type TrustTable } from '../../lib/chatIdentity';
  import { ForwardSecrecySession, MAX_SYNC_ITEMS, PENDING, validEphemeralKey, type FsMember } from '../../lib/chatRatchet';
  let verificationChallenge = '';
  let roomIdentity: SigningIdentity | null = null;
  // Every payload is stamped and signed, so members can tell who in the room wrote it.
  async function signForRoom(payload: Record<string, unknown>, pad: boolean): Promise<string> {
    if (!roomIdentity) throw new Error('No room identity');
    const stamped = stampPayload(JSON.stringify(payload), channelId);
    return signPayload(roomIdentity, pad ? padPayload(stamped, SIGNATURE_BYTES) : stamped);
  }
  // Padding hides how long a payload is before it is sealed under the room key.
  const encryptMessage = async (key: CryptoKey, text: string) => sealMessage(key, await signForRoom(JSON.parse(text), true));
  import { randomIndex } from "../../lib/random";
  import { roomSecret, safeColor, ReplayWindow, type RoomSecret } from "../../lib/roomAccess";
  import { loadAlias, newAlias, parseAlias, aliasWire, aliasKey, aliasName, aliasColor, aliasGradient, gradientFor, parseNickname, nicknameKey, loadNickname, saveNickname, saveAlias, NICKNAME_RE, type Alias } from "../../lib/alias";
  let accessToken = "";
  let channelId = "";
  const replay = new ReplayWindow();
  import { onMount, onDestroy, tick as settled } from 'svelte';
  import PartySocket from 'partysocket';
  import {
    roomMessageKey,
    encryptMessage as sealMessage, decryptMessage, arrayToB64url,
    signPayload, verifyPayload, safetyNumber, keyCode,
    roomForwardSecret, forwardLocalKey, sealLocal, openLocal, type SigningIdentity,
  } from '../../lib/chatCrypto';
  import { encryptData, decryptData } from '../../lib/ghost/crypto';
  import { uploadFirstParty, sendWithUploadPass } from '../../lib/firstPartyUpload';
  import { prepareSendUpload } from '../../lib/nologSend';
  import { MAX_SINGLE_UPLOAD_BYTES, FIRST_PARTY_ENVELOPE_LIMIT, SEND_ENVELOPE_LIMIT } from '../../lib/httpLimits';
  import {
    TransferMeter,
    formatTransferLine,
    transferRatio,
    type TransferSnapshot,
  } from '../../lib/transferProgress';
  import { t } from '../../lib/t';
  import { LUCIDE } from '../../lib/lucideIcons';
  import { Message, Progressbar } from 'konsta/svelte';
  import ProgressPulse from '../ProgressPulse.svelte';
  import SaveRoomButton from './SaveRoomButton.svelte';
  import RoomInviteCard from './RoomInviteCard.svelte';
  import { normalizeChatMode, chatModeTtlSeconds, chatModeKeepsHistory, formatDuration, parseBurnSuffix, roomPasswordOk, configStamp, roomLookup, type ChatMode } from '../../lib/chatRoomSettings';
  import { parseMarkdown, plainSnippet, revealSpoilers } from '../../lib/chatMarkdown';
  import { ReactionBook, REACTION_EMOJI, validMessageRef, type ReactionEmoji } from '../../lib/chatReactions';
  import { longPress } from '../../lib/longPress';
  import { buildMicChain } from '../../lib/micChain';
  import { swipeReply } from '../../lib/swipeReply';
  import { NotificationBurst, loadNotifyPref, saveNotifyPref, titleWithUnread } from '../../lib/chatAttention';
  import {
    SCHEDULE_PRESETS,
    formatScheduleAt,
    readSealedDrafts,
    scheduleAt,
    validSendAt,
    writeSealedDrafts,
    type ScheduledDraft,
  } from '../../lib/chatSchedule';
  import ChatMessageActions from './ChatMessageActions.svelte';
  import ChatReactions from './ChatReactions.svelte';
  import ChatQuote from './ChatQuote.svelte';
  import ChatVoiceMessage from './ChatVoiceMessage.svelte';
  import ChatComposer from './ChatComposer.svelte';
  import ChatCall from './ChatCall.svelte';
  import { formatClock, validVoiceDuration, voiceFileName, voiceTypeOf, type VoiceRecording } from '../../lib/voiceMessage';
  import { buildChatHistoryExport, chatHistoryExportJson, chatHistoryFileName } from '../../lib/chatHistoryExport';
  import { MediaKeySchedule, createCallKeyPair, deriveWrapKey, isCallPublicKey, isMediaKeyId, mediaKeyContext, unwrapMediaKey, hideVoiceActivity, wrapMediaKey, type CallKeyPair } from '../../lib/callCrypto';
  import { createKemKeyPair, kemOpen, kemSeal, validKemCiphertext, validKemKey, type KemKeyPair, type KemSeal } from '../../lib/hybridKem';
  import { CallFrameEncryption, frameTransformMode } from '../../lib/callTransform';

  export let locale = 'en';
  export let roomId = '';
  export let partyHost = '';
  export let appMode = false;
  export let onOpenBoardApp: ((roomId: string, password: string) => void) | undefined = undefined;
  export let onExitApp: (() => void) | undefined = undefined;
  export let onNotice: ((message: string) => void) | undefined = undefined;
  export let onConnStatus: ((status: 'connected' | 'connecting' | 'offline') => void) | undefined = undefined;
  export let requestReconnect = () => {};
  export let requestCall: () => void = () => {};
  export let requestRoomMenu: () => void = () => {};
  export let requestRoomInfo: () => void = () => {};
  export let onShareApp: (() => void) | undefined = undefined;
  export let appCallState = { ready: false, joining: false, active: false };

  export let dict: Record<string, string>;

  type Message = {
    id: string;
    text: string;
    sender: string;
    initials: string;
    color: string;
    alias?: Alias;
    nick?: string;
    mine: boolean;
    time: number;
    ttl: number;
    remaining: number;
    file?: ChatFile;
    fileError?: boolean;
    preview?: { type: 'image' | 'text'; url?: string; text?: string; expanded?: boolean };
    revealed?: boolean;
    once?: boolean;
    whiteboard?: WhiteboardInvite;
    pk?: string;
    keyWarning?: boolean;
    signed?: string;
    replyTo?: string;
    pending?: boolean;
    failed?: boolean;
  };

  type ChatFile = { name: string; size: number; urls: string[]; key: string; voice?: true; duration?: number };

  type Member = {
    pk: string;
    key: string;
    name: string;
    initials: string;
    color: string;
    alias?: Alias;
    trusted: boolean;
    safety: string;
    code: string;
  };

  type ChatRoomMode = ChatMode;

  type RoomConfig = {
    mode: ChatRoomMode;
    authMode: 'password';
    createdAt: number;
    v?: 3;
  };

  type ChatPayload = {
    type?: string;
    id?: string;
    roomId?: string;
    password?: string;
    text?: string;
    alias?: [number, number, number];
    nick?: string;
    ttl?: number;
    file?: ChatFile;
    createdAt?: number;
    replyTo?: string;
    target?: string;
    emoji?: ReactionEmoji;
    remove?: true;
    once?: true;
    kind?: 'joined' | 'left' | 'renamed';
    name?: string;
    from?: string;
    to?: string;
  };

  type ServerEnvelope = {
    type: 'message';
    id?: string;
    payload: string;
    createdAt?: number;
    from?: string;
  };

  // Each entry holds the verified, signed plaintext sealed under the local key.
  type LocalHistoryEnvelope = { type: 'message'; id: string; v: 2; sealed: string; createdAt?: number };

  type Origin = 'local' | 'sync' | null;
  type ProcessContext = {
    fromHistory: boolean;
    origin: Origin;
    createdAt?: number;
    wire?: string;
    signed?: string;
    fsSender?: string;
    conn?: string;
  };
  type Signer = { id: string; ed: string };

  type WhiteboardInvite = {
    roomId: string;
    password: string;
    sender: string;
    color: string;
    alias?: Alias;
    createdAt: number;
  };

  type CallMode = 'audio' | 'video';

  type CallPeer = {
    id: string;
    name: string;
    initials: string;
    color: string;
    alias?: Alias;
    pc: RTCPeerConnection;
    audioTransceiver: RTCRtpTransceiver | null;
    videoTransceiver: RTCRtpTransceiver | null;
    audioSender: RTCRtpSender | null;
    videoSender: RTCRtpSender | null;
    stream: MediaStream | null;
    state: RTCPeerConnectionState;
    iceState: RTCIceConnectionState;
    muted: boolean;
    cameraOff: boolean;
    screenSharing: boolean;
    makingOffer: boolean;
    restartTimer?: ReturnType<typeof setTimeout>;
    restartAttempts: number;
    lastRestartAt: number;
    volume: number;
    audioMuted: boolean;
    audioLevel: number;
    speaking: boolean;
    mediaPub?: string;
    mediaKem?: string;
    sharedKeyId?: number;
    keyTicket: number;
  };

  type CallSignal = {
    type: 'call-signal';
    action: 'join' | 'presence' | 'offer' | 'answer' | 'ice' | 'leave' | 'media' | 'restart' | 'media-key' | 'media-key-request';
    callId: string;
    from: string;
    fromAlias?: [number, number, number];
    fromNick?: string;
    to?: string;
    mode?: CallMode;
    reply?: boolean;
    sdp?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
    audio?: boolean;
    video?: boolean;
    screen?: boolean;
    pub?: string;
    kem?: string;
    keyId?: number;
    wrapped?: string;
    e?: string;
  };

  type TurnConfig = {
    iceServers?: RTCIceServer[];
    turnReady?: boolean;
    ttl?: number;
    expiresAt?: number;
  };

  type ActiveCallNotice = {
    from: string;
    name: string;
    color: string;
    alias?: Alias;
  };

  type ServerQuality = 'unknown' | 'good' | 'fair' | 'poor' | 'offline';
  type RelayProvider = 'encrypt-1' | 'cloudflare' | 'metered' | 'turn' | 'unknown';

  type RelayRoute = {
    provider: RelayProvider;
    name: string;
    host: string;
    location: string;
    protocol: string;
  };

  type RelayStatsSnapshot = {
    rttMs: number | null;
    url: string;
    protocol: string;
    connected: boolean;
    pairState: string;
    nominated: boolean;
    localCandidateType: string;
    remoteCandidateType: string;
  };

  type CallDebugEvent = {
    time: number;
    label: string;
    data: Record<string, unknown>;
  };

  type CallFullscreenTarget = {
    source: 'local' | 'peer';
    peerId?: string;
  };

  type CallFullscreenMedia = {
    name: string;
    stream: MediaStream;
    isScreen: boolean;
  };

  type AudioLevelTarget = 'local' | 'peer';

  type AudioLevelMonitor = {
    context: AudioContext;
    analyser: AnalyserNode;
    source: MediaStreamAudioSourceNode;
    data: Uint8Array;
    frame: number;
    trackId: string;
    target: AudioLevelTarget;
    peerId?: string;
    speaking: boolean;
    lastUiAt: number;
  };

  let ws: PartySocket | null = null;
  let netOffline = false;
  let lightboxUrl: string | null = null;
  function openLightbox(url: string) {
    lightboxUrl = url;
    window.addEventListener('keydown', onLightboxKey);
  }
  function closeLightbox() {
    lightboxUrl = null;
    window.removeEventListener('keydown', onLightboxKey);
  }
  function onLightboxKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeLightbox();
    }
  }
  let lastConnStatus = '';
  function reportConn() {
    const st = netOffline ? 'offline' : connected ? 'connected' : 'connecting';
    if (st !== lastConnStatus) { lastConnStatus = st; onConnStatus?.(st); }
  }
  $: if (connected !== undefined || netOffline !== undefined) reportConn();
  requestReconnect = () => {
    try { ws?.reconnect(); } catch {}
  };
  requestCall = () => { closeHeaderMenu(); void startCall(); };
  requestRoomMenu = () => { headerMenuOpen = !headerMenuOpen; membersOpen = false; burnConfirmMsg = null; profileOpen = false; };
  requestRoomInfo = () => { membersOpen = !membersOpen; burnConfirmMsg = null; headerMenuOpen = false; };
  const onNetChange = () => {
    const was = netOffline;
    netOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    // Back online: reconnect right away instead of waiting out the backoff delay.
    if (was && !netOffline) try { ws?.reconnect(); } catch {}
    reportConn();
  };
  const isIosDevice = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const onPageHide = () => { try { ws?.close(1000, 'pagehide'); } catch {} };
  const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) try { ws?.reconnect(); } catch {} };
  const onViewportResize = () => { if (stickToBottom) scrollToBottom(true); };
  let cryptoKey: CryptoKey | null = null;
  let alias: Alias = typeof localStorage === 'undefined' ? newAlias() : loadAlias(roomId);
  let nickname: string | null = typeof localStorage === 'undefined' ? null : loadNickname(roomId);
  let identity = { name: nickname || aliasName(dict, alias), color: aliasColor(alias) };

  function myLabelKey(): string {
    return nickname ? nicknameKey(nickname) : aliasKey(alias);
  }

  // A sender is named only by a validated alias or nickname; free-form names and colors would let a member pass as someone else.
  function senderInfo(p: any) {
    const nick = parseNickname(p?.nick ?? p?.fromNick) ?? undefined;
    const al = parseAlias(p?.alias ?? p?.fromAlias) ?? undefined;
    const name = nick || (al ? aliasName(dict, al) : t(dict, 'chat.guest'));
    const color = al ? aliasColor(al) : safeColor(null);
    const key = nick ? nicknameKey(nick) : al ? aliasKey(al) : name;
    return { name, color, alias: al, nick, initials: getInitials(name), key };
  }
  let messages: Message[] = [];
  let inputText = '';
  let connected = false;
  let verified = false;
  let verifying = false;
  /* Once a room has verified this session, brief reconnect re-verification keeps the
     room view (and composer) mounted — sends queue into the outbox instead of
     swapping the whole screen for a spinner. */
  let everVerified = false;
  let checkingRoom = false;
  let needsPassword = false;
  let passwordInput = '';
  let passwordError = '';
  let typing: { sender: string; initials: string; color: string; alias?: Alias } | null = null;
  let typingTimeout: ReturnType<typeof setTimeout>;
  let blurred = false;
  let roomConfig: RoomConfig = { mode: 'live', authMode: 'password', createdAt: 0, v: 3 };
  let pendingRoomConfig: RoomConfig | null = null;
  let localHistoryKey = '';
  let localHistoryLoaded = false;
  const seenMessageIds = new Set<string>();
  let onlineUsers: { key: string; name: string; initials: string; color: string; alias?: Alias }[] = [];
  let uploading = false;
  let uploadSnap: TransferSnapshot | null = null;
  const uploadMeter = new TransferMeter();
  $: uploadLine = uploadSnap ? formatTransferLine(dict, t, uploadSnap) : '';
  $: uploadBar = transferRatio(uploadSnap);
  let fileError = '';
  $: if (appMode && onNotice && fileError) {
    onNotice(fileError);
    fileError = '';
  }
  let fileInputEl: HTMLInputElement | undefined;
  let sharePassword = '';
  let shareCopiedLink = false;
  let shareDismissed = false;
  let exportFlash = false;
  let exportFlashTimer: ReturnType<typeof setTimeout> | null = null;
  let clientId = '';
  let burnConfirmMsg: Message | null = null;
  let membersOpen = false;
  let headerMenuOpen = false;
  let appProfileOpen = false;
  let appProfileFormEl: HTMLElement | null = null;
  let unsupportedBrowser = false;
  let profileOpen = false;
  let profileEl: HTMLElement | null = null;
  let nickInput = '';
  let previewAlias: Alias = alias;
  let previewName = '';
  $: previewName = nickInput.trim() || aliasName(dict, alias);

  function rerollAvatar() {
    previewAlias = { ...alias, h: newAlias().h };
  }
  let nickError = '';
  let historyReady = false;
  let clock = Date.now();
  const FILE_LIFETIME_MS = 24 * 60 * 60 * 1000;
  let callStartedAt = 0;
  let callStartKnown = false;
  const callParticipants = new Set<string>();
  let myKeyCode = '';
  let trustTable: TrustTable = {};
  let trustRoom = roomId;
  let keyConfig: RoomConfig | null = null;
  let pendingSecret: RoomSecret | null = null;
  let roomMissing = false;
  let configChanged = false;
  const members = new Map<string, Member>();
  let memberList: Member[] = [];
  let mySignerId = '';
  let fsSession: ForwardSecrecySession | null = null;
  let localKey: CryptoKey | null = null;
  let lastPresenceCount = 0;
  let inbound: Promise<void> = Promise.resolve();
  let callSignals: Promise<void> = Promise.resolve();
  let wantTimer: ReturnType<typeof setTimeout> | undefined;
  let callActive = false;
  let callJoining = false;
  $: appCallState = { ready: connected && verified && !callJoining && !callActive, joining: callJoining, active: callActive };
  let callError = '';
  let activeCallNotice: ActiveCallNotice | null = null;
  let callNoticeDismissed = false;
  let localStream: MediaStream | null = null;
  let callPeers: CallPeer[] = [];
  let micMuted = true;
  let cameraOff = true;
  let screenSharing = false;
  let screenTrack: MediaStreamTrack | null = null;
  let callAudioMuted = false;
  let callVolume = 1;
  let callSettingsOpen = false;
  let callChatOpen = true;
  let callChatSeen = 0;
  let callChatUnread = false;
  let callDebugEnabled = false;
  let callDebugEvents: CallDebugEvent[] = [];
  let localAudioLevel = 0;
  let localSpeaking = false;
  const BLUR_WHEN_AWAY_STORAGE_KEY = 'chat-blur-when-away';
  let blurWhenAway = (() => {
    try { return localStorage.getItem(BLUR_WHEN_AWAY_STORAGE_KEY) !== '0'; } catch { return true; }
  })();
  let stickToBottom = true;
  /** Messages that arrived while the user was scrolled away from the bottom. */
  let belowCount = 0;
  /** About two to three bubbles: stay pinned here, leave the view alone farther up. */
  const NEAR_BOTTOM_PX = 180;
  let audioInputDevices: MediaDeviceInfo[] = [];
  let videoInputDevices: MediaDeviceInfo[] = [];
  let audioOutputDevices: MediaDeviceInfo[] = [];
  let selectedAudioInputId = '';
  let micProcessing: { context: AudioContext; raw: MediaStreamTrack } | null = null;
  let selectedVideoInputId = '';
  let selectedAudioOutputId = '';
  let canSelectAudioOutput = false;
  let serverLatencyMs: number | null = null;
  let serverQuality: ServerQuality = 'unknown';
  let lastServerPongAt = 0;
  let serverConnectStartedAt = 0;
  let iceServers: RTCIceServer[] = [];
  let iceServersFetchedAt = 0;
  let iceServersExpiresAt = 0;
  let iceServersLoading: Promise<RTCIceServer[]> | null = null;
  let relayRoute: RelayRoute = {
    provider: 'unknown',
    name: 'TURN',
    host: '',
    location: '',
    protocol: '',
  };
  let relayRttMs: number | null = null;
  let relayQuality: ServerQuality = 'unknown';
  let relayConnected = false;
  let cloudflareRelayColo = '';
  let cloudflareRelayCountry = '';
  let cloudflareRelayTraceFetchedAt = 0;
  let callFullscreenTarget: CallFullscreenTarget | null = null;
  let callFullscreenMedia: CallFullscreenMedia | null = null;
  let callFullscreenOverlayEl: HTMLDivElement | undefined;
  let callFullscreenNativeActive = false;
  let callMediaSessionHandlersActive = false;
  let composerMenuOpen = false;
  let voiceRecording = false;
  let onceEnabled = false;
  let scheduleMenuOpen = false;
  let scheduledDrafts: ScheduledDraft[] = [];
  const scheduleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let scheduledRestoredFor = '';
  const burnedIds = new Set<string>();
  let scheduleClock = Date.now();
  let safetyPrompt: Member | null = null;
  const safetyPromptSeen = new Set<string>();
  let inputEl: HTMLInputElement | HTMLTextAreaElement | undefined;
  const kmsgColors = {
    bubbleSentIos: 'bg-[var(--app-bubble-mine)] text-[var(--app-on-bubble-mine)]',
    bubbleSentMd: 'bg-[var(--app-bubble-mine)] text-[var(--app-on-bubble-mine)]',
    bubbleReceivedIos: 'bg-[var(--app-bubble)] text-[var(--app-on-bubble)]',
    bubbleReceivedMd: 'bg-[var(--app-bubble)] text-[var(--app-on-bubble)]',
  };
  let replyTarget: Message | null = null;
  let actionMenuFor: string | null = null;
  let sheetMsg: Message | undefined;
  $: if (appMode && actionMenuFor) sheetMsg = messageIndex.get(actionMenuFor) ?? sheetMsg;
  let openOverlays: Record<string, boolean> = {};
  $: syncOverlays({ header: headerMenuOpen, profile: profileOpen, composer: composerMenuOpen, action: actionMenuFor !== null, call: callSettingsOpen, members: membersOpen, invite: sharePassword !== null && !shareDismissed });
  $: if (!composerMenuOpen) scheduleMenuOpen = false;
  function syncOverlays(now: Record<string, boolean>) {
    const opened = Object.keys(now).filter((key) => now[key] && !openOverlays[key]);
    if (opened.length) {
      const keep = opened[opened.length - 1];
      if (keep !== 'header') headerMenuOpen = false;
      if (keep !== 'profile') profileOpen = false;
      if (keep !== 'composer') composerMenuOpen = false;
      if (keep !== 'action') actionMenuFor = null;
      if (keep !== 'call') callSettingsOpen = false;
      if (keep !== 'members') membersOpen = false;
      if (keep !== 'invite') shareDismissed = true;
      openOverlays = { [keep]: true };
    } else openOverlays = now;
  }
  function closeMenusOnOutside(event: PointerEvent) {
    const target = event.target as Element | null;
    if (composerMenuOpen && !target?.closest?.('.chat-attach-menu')) composerMenuOpen = false;
    if (actionMenuFor && !target?.closest?.('.msg-actions, .chat-msg-sheet')) actionMenuFor = null;
  }
  let highlightedId = '';
  let reactionTick = 0;
  const reactionBook = new ReactionBook();
  const reactionLog: { target: string; signed: string }[] = [];
  const REACTION_LOG_LIMIT = 500;
  const ONCE_TTL_SECONDS = 60;
  const ONCE_CLEAR_MS = 8_000;
  const SCHEDULE_RETRY_MS = 15_000;
  const SCHEDULE_EXPIRED_MS = 10 * 60_000;
  const onceClearTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let unread = 0;
  let baseTitle = '';
  let notifySupported = false;
  let notifyOn = false;
  let shownNotification: Notification | null = null;
  const notifyBurst = new NotificationBurst(showNotification);

  const MAX_FILE = MAX_SINGLE_UPLOAD_BYTES;
  const TEXT_AS_FILE_LIMIT = 2000;
  const MAX_SDP_CHARS = 96_000;
  const MAX_ICE_CANDIDATE_CHARS = 4096;
  const MAX_PENDING_ICE_PER_PEER = 64;
  const MAX_CALL_PEERS = 16;
  const ICE_DISCONNECT_GRACE_MS = 2000;
  const ICE_RESTART_RETRY_MS = [4000, 6000, 10000, 15000];
  const ICE_RESTART_DEDUPE_MS = 3000;
  const TURN_ROTATE_MARGIN_S = 600;
  const CAMERA_MAX_BITRATE = 1_200_000;
  const SCREEN_MAX_BITRATE = 2_500_000;
  const LOCAL_HISTORY_LIMIT = 1000;
  const LOCAL_HISTORY_PREFIX = 'encrypt.click:chat-history:v3:';
  const MODE_PREFIX = 'encrypt.click:chat-mode:';
  const CALL_DEBUG_STORAGE_KEY = 'encrypt.click:call-debug';
  const CALL_ID = `call:${roomId}`;
  const callPeerMap = new Map<string, CallPeer>();
  const pendingIce = new Map<string, RTCIceCandidateInit[]>();
  const MEDIA_KEY_ROTATE_DEBOUNCE_MS = 250;
  const MEDIA_KEY_REQUEST_MS = 2000;
  let frameCrypto: CallFrameEncryption | null = null;
  let callKeyPair: CallKeyPair | null = null;
  let callKem: KemKeyPair | null = null;
  let mediaKeys: MediaKeySchedule | null = null;
  let mediaKeyRotateTimer: ReturnType<typeof setTimeout> | undefined;
  const mediaKeySenders = new Set<string>();
  const mediaKeyRequestedAt = new Map<string, number>();
  const mediaKeySharedAt = new Map<string, number>();
  let lastRelayDebugKey = '';
  let localAudioMonitor: AudioLevelMonitor | null = null;
  const peerAudioMonitors = new Map<string, AudioLevelMonitor>();
  let relayStatsInterval: ReturnType<typeof setInterval> | undefined;
  let tickInterval: ReturnType<typeof setInterval>;
  let messagesEl: HTMLElement;

  $: myInitials = getInitials(identity.name);
  $: messageIndex = new Map(messages.map((msg) => [msg.id, msg]));

  function getInitials(name: string): string {
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }

  // The message list re-renders on every timer tick, so each message keeps its parsed HTML until its text changes.
  const markdownCache = new WeakMap<Message, { text: string; html: string }>();

  function messageHtml(msg: Message): string {
    const hit = markdownCache.get(msg);
    if (hit && hit.text === msg.text) return hit.html;
    const html = parseMarkdown(msg.text);
    markdownCache.set(msg, { text: msg.text, html });
    return html;
  }

  function distanceFromBottom(): number {
    if (!messagesEl) return 0;
    return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
  }

  // Off-screen bubbles skip rendering and only get their real height once scrolled into view, so the bottom keeps
  // moving. Keep pinning until the height and the distance to the bottom stop changing, and let the user cancel by touching the list.
  // Background tabs pause requestAnimationFrame, so pin once right after the DOM update too.
  let pinning = false;

  function scrollToBottom(force = false) {
    if (!force && !stickToBottom) return;
    stickToBottom = true;
    belowCount = 0;
    pinning = true;
    void settled().then(() => {
      if (messagesEl && pinning) messagesEl.scrollTop = messagesEl.scrollHeight;
    });
    let last = -1;
    let stable = 0;
    let frames = 0;
    const step = () => {
      if (!messagesEl || !pinning) return;
      const height = messagesEl.scrollHeight;
      messagesEl.scrollTop = height;
      stable = height === last && distanceFromBottom() <= 1 ? stable + 1 : 0;
      last = height;
      if (stable >= 3 || ++frames > 60) {
        pinning = false;
        updateStickToBottom();
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    setTimeout(() => { if (pinning) { pinning = false; updateStickToBottom(); } }, 1500);
  }

  function cancelPin() {
    pinning = false;
  }

  function updateStickToBottom() {
    if (!messagesEl || pinning) return;
    const near = distanceFromBottom() <= NEAR_BOTTOM_PX;
    stickToBottom = near;
    if (near) belowCount = 0;
  }

  function noteMessagesBelow(count = 1) {
    if (stickToBottom || count < 1) return;
    belowCount += count;
  }

  function jumpToLatest() {
    belowCount = 0;
    scrollToBottom(true);
  }

  /** Own messages always follow; others only when near the bottom, otherwise show the jump chip. */
  function followIncoming(mine: boolean) {
    if (mine || stickToBottom) scrollToBottom(mine);
    else noteMessagesBelow();
  }

  function supportsAudioOutputSelection(): boolean {
    if (typeof HTMLMediaElement === 'undefined') return false;
    return 'setSinkId' in HTMLMediaElement.prototype;
  }

  function preventMediaContextMenu(event: MouseEvent) {
    event.preventDefault();
  }

  function mediaElementHasLiveStream(node: HTMLMediaElement): boolean {
    const stream = node.srcObject instanceof MediaStream ? node.srcObject : null;
    return Boolean(stream?.getTracks().some((track) => track.readyState === 'live'));
  }

  function ensureMediaElementPlaying(node: HTMLMediaElement) {
    if (!mediaElementHasLiveStream(node) || !node.paused) return;
    void node.play().catch(() => {});
  }

  function keepCallMediaPlaying(event?: Event) {
    const node = event?.currentTarget as HTMLMediaElement | undefined;
    if (node && callActive) {
      requestAnimationFrame(() => ensureMediaElementPlaying(node));
      return;
    }
    resumeVisibleCallMedia();
  }

  function resumeVisibleCallMedia() {
    if (typeof document === 'undefined') return;
    const mediaNodes = document.querySelectorAll<HTMLMediaElement>('.call__video, .chat-call-fullscreen__video, .call__tile audio');
    mediaNodes.forEach((node) => ensureMediaElementPlaying(node));
  }

  const callMediaSessionActions = ['play', 'pause', 'stop', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack'] as const;

  let callWakeLock: WakeLockSentinel | null = null;

  async function holdCallWakeLock(enabled: boolean) {
    if (!enabled) {
      const lock = callWakeLock;
      callWakeLock = null;
      await lock?.release().catch(() => {});
      return;
    }
    if (callWakeLock || document.visibilityState !== 'visible') return;
    try {
      callWakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
      callWakeLock?.addEventListener('release', () => { callWakeLock = null; });
    } catch {}
  }

  function setCallMediaSessionHandlers(enabled: boolean) {
    void holdCallWakeLock(enabled);
    const mediaSession = typeof navigator !== 'undefined' ? (navigator as Navigator & { mediaSession?: MediaSession }).mediaSession : undefined;
    if (!mediaSession?.setActionHandler) return;

    for (const action of callMediaSessionActions) {
      try {
        mediaSession.setActionHandler(action, enabled ? () => keepCallMediaPlaying() : null);
      } catch {}
    }

    try {
      mediaSession.playbackState = enabled ? 'playing' : 'none';
    } catch {}
  }

  function closeCallSettingsOnOutside(event: PointerEvent) {
    if (!callSettingsOpen) return;
    const target = event.target as Element | null;
    if (target?.closest('#chat-call-settings, [data-call-settings-trigger]')) return;
    callSettingsOpen = false;
  }

  function closeCallSettingsOnEscape(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !callSettingsOpen) return;
    callSettingsOpen = false;
    document.querySelector<HTMLElement>('[data-call-settings-trigger]')?.focus();
  }

  function syncCallPeers() {
    callPeers = Array.from(callPeerMap.values());
  }

  function getAudioContextConstructor(): typeof AudioContext | null {
    if (typeof window === 'undefined') return null;
    return window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext || null;
  }

  function getStreamAudioTrack(stream: MediaStream | null | undefined): MediaStreamTrack | null {
    return stream?.getAudioTracks().find((track) => track.readyState === 'live') ?? null;
  }

  function stopAudioLevelMonitor(monitor: AudioLevelMonitor | null | undefined) {
    if (!monitor) return;
    cancelAnimationFrame(monitor.frame);
    try { monitor.source.disconnect(); } catch {}
    void monitor.context.close().catch(() => {});
  }

  function stopLocalAudioMonitor() {
    stopAudioLevelMonitor(localAudioMonitor);
    localAudioMonitor = null;
    localAudioLevel = 0;
    localSpeaking = false;
  }

  function stopPeerAudioMonitor(peerId: string) {
    stopAudioLevelMonitor(peerAudioMonitors.get(peerId));
    peerAudioMonitors.delete(peerId);
    const peer = callPeerMap.get(peerId);
    if (peer) {
      peer.audioLevel = 0;
      peer.speaking = false;
      syncCallPeers();
    }
  }

  function stopAllAudioMonitors() {
    stopLocalAudioMonitor();
    for (const peerId of Array.from(peerAudioMonitors.keys())) stopPeerAudioMonitor(peerId);
  }

  function calculateAudioLevel(data: Uint8Array): number {
    let sum = 0;
    for (const sample of data) {
      const centered = (sample - 128) / 128;
      sum += centered * centered;
    }
    return Math.min(1, Math.sqrt(sum / data.length) * 3.4);
  }

  function createAudioLevelMonitor(stream: MediaStream, target: AudioLevelTarget, peerId?: string): AudioLevelMonitor | null {
    const track = getStreamAudioTrack(stream);
    const AudioContextCtor = getAudioContextConstructor();
    if (!track || !AudioContextCtor) return null;

    try {
      const context = new AudioContextCtor();
      const source = context.createMediaStreamSource(new MediaStream([track]));
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const monitor: AudioLevelMonitor = {
        context,
        analyser,
        source,
        data,
        frame: 0,
        trackId: track.id,
        target,
        peerId,
        speaking: false,
        lastUiAt: 0,
      };
      monitor.frame = requestAnimationFrame(() => tickAudioLevel(monitor));
      return monitor;
    } catch {
      return null;
    }
  }

  function tickAudioLevel(monitor: AudioLevelMonitor) {
    monitor.analyser.getByteTimeDomainData(monitor.data);
    const level = calculateAudioLevel(monitor.data);
    const speaking = level > 0.12;
    const now = performance.now();
    const shouldUpdate = now - monitor.lastUiAt > 90 || speaking !== monitor.speaking || level === 0;
    monitor.speaking = speaking;

    if (shouldUpdate) {
      monitor.lastUiAt = now;
      if (monitor.target === 'local') {
        localAudioLevel = level;
        localSpeaking = speaking;
      } else if (monitor.peerId) {
        const peer = callPeerMap.get(monitor.peerId);
        if (peer) {
          peer.audioLevel = level;
          peer.speaking = speaking;
          syncCallPeers();
        }
      }
    }

    monitor.frame = requestAnimationFrame(() => tickAudioLevel(monitor));
  }

  function startLocalAudioMonitor() {
    if (!localStream) return;
    const track = getStreamAudioTrack(localStream);
    if (!track) {
      stopLocalAudioMonitor();
      return;
    }
    if (localAudioMonitor?.trackId === track.id) return;
    stopLocalAudioMonitor();
    localAudioMonitor = createAudioLevelMonitor(localStream, 'local');
  }

  function startPeerAudioMonitor(peer: CallPeer) {
    const track = getStreamAudioTrack(peer.stream);
    if (!peer.stream || !track) {
      stopPeerAudioMonitor(peer.id);
      return;
    }
    const current = peerAudioMonitors.get(peer.id);
    if (current?.trackId === track.id) return;
    stopPeerAudioMonitor(peer.id);
    const monitor = createAudioLevelMonitor(peer.stream, 'peer', peer.id);
    if (monitor) peerAudioMonitors.set(peer.id, monitor);
  }

  function hasTurnCredentials(servers: RTCIceServer[]): boolean {
    return servers.some((server) => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      return Boolean(server.username && server.credential && urls.some((url) => /^turns?:/i.test(String(url))));
    });
  }

  function getTurnUrls(servers: RTCIceServer[]): string[] {
    return servers.flatMap((server) => Array.isArray(server.urls) ? server.urls : [server.urls])
      .map((url) => String(url || ''))
      .filter((url) => /^turns?:/i.test(url));
  }

  function getTurnHost(url: string): string {
    const withoutScheme = url.replace(/^(turns?|stuns?):/i, '').split('?')[0];
    const withoutUser = withoutScheme.split('@').pop() || withoutScheme;
    return withoutUser.replace(/^\[/, '').split(']')[0].split(':')[0] || withoutUser;
  }

  function getTurnTransport(url: string): string {
    const transport = url.match(/[?&]transport=([^&]+)/i)?.[1];
    if (transport) return transport.toUpperCase();
    return url.startsWith('turns:') ? 'TLS' : '';
  }

  function getRelayProvider(url: string): RelayProvider {
    const host = getTurnHost(url).toLowerCase();
    if (host.includes('cloudflare.com')) return 'cloudflare';
    const site = typeof location === 'undefined' ? '' : location.hostname.replace(/^www\./, '');
    if (site && (host === site || host.endsWith(`.${site}`))) return 'encrypt-1';
    if (host.includes('metered.ca') || host.includes('metered.live')) return 'metered';
    return host ? 'turn' : 'unknown';
  }

  function getCallDebugEnabledFromStorage(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('callDebug') === '1' || params.get('debug') === 'call') return true;
      return window.localStorage?.getItem(CALL_DEBUG_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  function shortPeerId(id: string): string {
    return id ? id.slice(0, 8) : '';
  }

  function callDebug(label: string, data: Record<string, unknown> = {}) {
    if (!callDebugEnabled) return;
    const event: CallDebugEvent = { time: Date.now(), label, data };
    callDebugEvents = [event, ...callDebugEvents].slice(0, 40);
    if (typeof window !== 'undefined') {
      (window as Window & { __encryptCallDebug?: CallDebugEvent[] }).__encryptCallDebug = callDebugEvents;
    }
    console.debug('[encrypt.call]', label, data);
  }

  function describeIceServersForDebug(servers: RTCIceServer[] | undefined): Record<string, unknown>[] {
    return (servers ?? []).map((server, index) => {
      const urls = (Array.isArray(server.urls) ? server.urls : [server.urls])
        .map((url) => String(url || ''))
        .filter(Boolean);
      const primaryUrl = urls.find((url) => /^turns?:/i.test(url)) || urls[0] || '';
      const transports = Array.from(new Set(urls.map((url) => getTurnTransport(url)).filter(Boolean)));
      return {
        index,
        provider: getRelayProvider(primaryUrl),
        host: primaryUrl ? getTurnHost(primaryUrl) : '',
        urlCount: urls.length,
        hasTurn: urls.some((url) => /^turns?:/i.test(url)),
        transports,
        hasAuth: Boolean(server.username && server.credential),
      };
    });
  }

  function describeCandidateForDebug(candidate: RTCIceCandidate): Record<string, unknown> {
    const candidateWithUrl = candidate as RTCIceCandidate & { url?: string; relayProtocol?: string };
    return {
      type: candidate.type || '',
      protocol: candidate.protocol || '',
      relayProtocol: candidateWithUrl.relayProtocol || '',
      host: candidateWithUrl.url ? getTurnHost(candidateWithUrl.url) : '',
    };
  }

  function getCloudflareRelayLocation(): string {
    if (cloudflareRelayColo) {
      return cloudflareRelayCountry ? `${cloudflareRelayColo}-${cloudflareRelayCountry}` : cloudflareRelayColo;
    }
    return t(dict, 'chat.callRelayNearestEdge');
  }

  function describeRelayRoute(servers: RTCIceServer[], activeUrl = '', activeProtocol = ''): RelayRoute {
    const turnUrls = getTurnUrls(servers);
    const selectedUrl = activeUrl || turnUrls[0] || '';
    const provider = getRelayProvider(selectedUrl);
    const host = selectedUrl ? getTurnHost(selectedUrl) : '';
    const protocol = activeProtocol || (selectedUrl ? getTurnTransport(selectedUrl) : '');

    if (provider === 'cloudflare') {
      return {
        provider,
        name: 'Cloudflare',
        host,
        location: getCloudflareRelayLocation(),
        protocol,
      };
    }
    if (provider === 'encrypt-1') {
      return {
        provider,
        name: 'encrypt-1',
        host,
        location: 'AMS-NL',
        protocol,
      };
    }
    if (provider === 'metered') {
      return {
        provider,
        name: 'Metered',
        host,
        location: '',
        protocol,
      };
    }

    return {
      provider,
      name: host || 'TURN',
      host,
      location: '',
      protocol,
    };
  }

  function updateRelayRoute(activeUrl = '', activeProtocol = '') {
    relayRoute = describeRelayRoute(iceServers, activeUrl, activeProtocol);
  }

  function updateRelayQuality() {
    if (!callActive) {
      relayQuality = 'offline';
      return;
    }
    if (!callPeers.length || relayRttMs === null) {
      relayQuality = 'unknown';
      return;
    }
    if (relayRttMs <= 120) {
      relayQuality = 'good';
    } else if (relayRttMs <= 300) {
      relayQuality = 'fair';
    } else {
      relayQuality = 'poor';
    }
  }

  function getRelayStatusLabel(): string {
    const location = relayRoute.location ? ` ${relayRoute.location}` : '';
    const rtt = relayRttMs !== null
      ? `${relayRttMs} ms`
      : (relayConnected ? t(dict, 'chat.callRelayConnected') : t(dict, 'chat.callRelayWaiting'));
    return `${relayRoute.name}${location} · ${rtt}`;
  }

  function getRelayTitle(): string {
    const parts = [
      `${t(dict, 'chat.callRelay')}: ${relayRoute.name}`,
      relayRoute.location ? `${t(dict, 'chat.callRelayLocation')}: ${relayRoute.location}` : '',
      relayRoute.host ? `${t(dict, 'chat.callRelayHost')}: ${relayRoute.host}` : '',
      relayRoute.protocol ? `${t(dict, 'chat.callRelayTransport')}: ${relayRoute.protocol}` : '',
      relayConnected && relayRttMs === null ? t(dict, 'chat.callRelayConnectedNoRtt') : '',
      relayRttMs !== null ? `${t(dict, 'chat.callRelayRtt')}: ${relayRttMs} ms` : '',
    ].filter(Boolean);
    return parts.join(' · ');
  }

  async function refreshCloudflareRelayTrace() {
    if (typeof window === 'undefined' || !iceServers.length) return;
    if (describeRelayRoute(iceServers).provider !== 'cloudflare') return;
    if (cloudflareRelayTraceFetchedAt && Date.now() - cloudflareRelayTraceFetchedAt < 5 * 60 * 1000) return;
    cloudflareRelayTraceFetchedAt = Date.now();

    try {
      const res = await fetch('/cdn-cgi/trace', { cache: 'no-store' });
      if (!res.ok) {
        callDebug('cloudflare trace failed', { status: res.status });
        return;
      }
      const values = new Map<string, string>();
      for (const line of (await res.text()).split('\n')) {
        const index = line.indexOf('=');
        if (index <= 0) continue;
        values.set(line.slice(0, index), line.slice(index + 1).trim());
      }
      cloudflareRelayColo = values.get('colo') || cloudflareRelayColo;
      cloudflareRelayCountry = values.get('loc') || cloudflareRelayCountry;
      callDebug('cloudflare trace', {
        colo: cloudflareRelayColo,
        country: cloudflareRelayCountry,
        note: 'HTTP edge approximation, not guaranteed TURN edge',
      });
      updateRelayRoute();
    } catch (error) {
      callDebug('cloudflare trace error', { error: error instanceof Error ? error.message : 'unknown' });
    }
  }

  function getStatsRecord(stats: RTCStatsReport, id: unknown): (RTCStats & Record<string, unknown>) | null {
    return typeof id === 'string' ? (stats.get(id) as (RTCStats & Record<string, unknown>) | undefined) ?? null : null;
  }

  function findSelectedCandidatePair(stats: RTCStatsReport): (RTCStats & Record<string, unknown>) | null {
    for (const report of stats.values()) {
      const item = report as RTCStats & Record<string, unknown>;
      if (item.type !== 'transport') continue;
      const pair = getStatsRecord(stats, item.selectedCandidatePairId);
      if (pair) return pair;
    }

    let fallback: (RTCStats & Record<string, unknown>) | null = null;
    for (const report of stats.values()) {
      const item = report as RTCStats & Record<string, unknown>;
      if (item.type !== 'candidate-pair') continue;
      if (item.selected === true) return item;
      if (item.state === 'succeeded' && item.nominated === true) fallback = item;
    }
    return fallback;
  }

  async function readPeerRelayStats(peer: CallPeer): Promise<RelayStatsSnapshot | null> {
    if (peer.pc.connectionState === 'closed' || peer.pc.connectionState === 'failed') return null;

    const stats = await peer.pc.getStats();
    const pair = findSelectedCandidatePair(stats);
    if (!pair) return null;

    const local = getStatsRecord(stats, pair.localCandidateId);
    const remote = getStatsRecord(stats, pair.remoteCandidateId);
    const url = String(local?.url || remote?.url || '');
    const protocol = String(local?.relayProtocol || local?.protocol || remote?.relayProtocol || remote?.protocol || '');
    const pairState = String(pair.state || '');
    const nominated = pair.nominated === true;
    const connected = pair.state === 'succeeded'
      || pair.nominated === true
      || peer.pc.connectionState === 'connected'
      || peer.pc.iceConnectionState === 'connected'
      || peer.pc.iceConnectionState === 'completed';
    const rttSeconds = typeof pair.currentRoundTripTime === 'number'
      ? pair.currentRoundTripTime
      : (typeof pair.totalRoundTripTime === 'number' && typeof pair.responsesReceived === 'number' && pair.responsesReceived > 0
        ? pair.totalRoundTripTime / pair.responsesReceived
        : null);

    return {
      rttMs: rttSeconds !== null && Number.isFinite(rttSeconds) ? Math.max(0, Math.round(rttSeconds * 1000)) : null,
      url,
      protocol: protocol ? protocol.toUpperCase() : '',
      connected,
      pairState,
      nominated,
      localCandidateType: String(local?.candidateType || ''),
      remoteCandidateType: String(remote?.candidateType || ''),
    };
  }

  async function refreshRelayStats() {
    if (!callActive) return;
    const snapshots = await Promise.all(Array.from(callPeerMap.values()).map((peer) => readPeerRelayStats(peer).catch(() => null)));
    const valid = snapshots.filter((item): item is RelayStatsSnapshot => Boolean(item));
    const rtts = valid.map((item) => item.rttMs).filter((value): value is number => typeof value === 'number');
    relayRttMs = rtts.length ? Math.round(rtts.reduce((sum, value) => sum + value, 0) / rtts.length) : null;
    relayConnected = valid.some((item) => item.connected);
    const routeSnapshot = valid.find((item) => item.url);
    updateRelayRoute(routeSnapshot?.url || '', routeSnapshot?.protocol || '');
    updateRelayQuality();
    const debugKey = JSON.stringify({
      peers: callPeerMap.size,
      valid: valid.length,
      connected: relayConnected,
      rttMs: relayRttMs,
      provider: relayRoute.provider,
      host: relayRoute.host,
      protocol: relayRoute.protocol,
      states: valid.map((item) => `${item.pairState}:${item.nominated}:${item.localCandidateType}:${item.remoteCandidateType}`),
    });
    if (debugKey !== lastRelayDebugKey) {
      lastRelayDebugKey = debugKey;
      callDebug('relay stats', {
        peers: callPeerMap.size,
        selectedPairs: valid.length,
        connected: relayConnected,
        rttMs: relayRttMs,
        route: relayRoute,
        snapshots: valid.map((item) => ({
          rttMs: item.rttMs,
          connected: item.connected,
          pairState: item.pairState,
          nominated: item.nominated,
          localCandidateType: item.localCandidateType,
          remoteCandidateType: item.remoteCandidateType,
          host: item.url ? getTurnHost(item.url) : '',
          protocol: item.protocol,
        })),
      });
    }
  }

  function startRelayStatsMonitor() {
    if (relayStatsInterval) clearInterval(relayStatsInterval);
    relayStatsInterval = setInterval(() => {
      if (callActive && Date.now() >= iceServersExpiresAt) void rotateCallCredentials();
      if (typeof document !== 'undefined' && document.hidden) return;
      void refreshRelayStats();
    }, 2500);
    void refreshRelayStats();
  }

  function stopRelayStatsMonitor() {
    if (relayStatsInterval) clearInterval(relayStatsInterval);
    relayStatsInterval = undefined;
    relayRttMs = null;
    relayConnected = false;
    relayQuality = 'unknown';
    lastRelayDebugKey = '';
  }

  function isSupportedSdpType(type: unknown): type is RTCSdpType {
    return type === 'offer' || type === 'answer' || type === 'pranswer' || type === 'rollback';
  }

  function isRelayCandidateString(candidate: unknown): candidate is string {
    return typeof candidate === 'string'
      && candidate.length > 0
      && candidate.length <= MAX_ICE_CANDIDATE_CHARS
      && / typ relay(?: |$)/.test(candidate);
  }

  function sanitizeRelayDescription(description: RTCSessionDescription | RTCSessionDescriptionInit | null | undefined): RTCSessionDescriptionInit | undefined {
    if (!description?.type) return undefined;
    if (!isSupportedSdpType(description.type)) return undefined;
    if (!description.sdp) return description.type === 'rollback' ? { type: description.type } : undefined;
    if (description.sdp.length > MAX_SDP_CHARS) return undefined;
    const lines = description.sdp.split(/\r?\n/).filter((line) => {
      if (!line.startsWith('a=candidate:')) return true;
      return isRelayCandidateString(line);
    }).map((line) => line.startsWith('a=candidate:') ? withoutRelatedAddress(line) : line);
    return { type: description.type, sdp: lines.join('\r\n') };
  }

  // A relay candidate may still name the host address it was allocated from; the peer only needs the relay address.
  function withoutRelatedAddress(candidate: string): string {
    return candidate.replace(/ raddr \S+ rport \d+/, ' raddr 0.0.0.0 rport 0');
  }

  function isRelayCandidate(candidate: RTCIceCandidate): boolean {
    return isRelayCandidateString(candidate.candidate);
  }

  function isRelayCandidateInit(candidate: RTCIceCandidateInit | undefined): candidate is RTCIceCandidateInit {
    return Boolean(candidate && isRelayCandidateString(candidate.candidate));
  }

  async function loadIceServers(force = false): Promise<RTCIceServer[]> {
    if (!force && iceServers.length && Date.now() < iceServersExpiresAt) return iceServers;
    if (iceServersLoading) return iceServersLoading;
    iceServersLoading = fetchIceServers().finally(() => { iceServersLoading = null; });
    return iceServersLoading;
  }

  async function fetchIceServers(): Promise<RTCIceServer[]> {
    try {
      const grant = await new Promise<string>((resolve, reject) => {
        if (!ws || ws.readyState !== 1) { reject(new Error('Not connected')); return; }
        const socket = ws;
        const timer = setTimeout(() => { socket.removeEventListener('message', listener); reject(new Error('TURN authorization unavailable')); }, 4000);
        const listener = (event: MessageEvent) => {
          try { const data = JSON.parse(event.data); if (data.type !== 'turn-grant' || typeof data.token !== 'string') return;
            clearTimeout(timer); socket.removeEventListener('message', listener); resolve(data.token);
          } catch {}
        };
        socket.addEventListener('message', listener);
        socket.send(JSON.stringify({ type: 'turn-grant' }));
      });
      const res = await fetch('/api/turn', { cache: 'no-store', headers: { Authorization: `Bearer ${grant}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as TurnConfig;
      if (!data.turnReady || !Array.isArray(data.iceServers) || !hasTurnCredentials(data.iceServers)) {
        throw new Error(t(dict, 'chat.callTurnRequired'));
      }
      iceServers = data.iceServers;
      iceServersFetchedAt = Date.now();
      iceServersExpiresAt = iceServersFetchedAt + Math.max(30, (data.ttl ?? 300) - TURN_ROTATE_MARGIN_S) * 1000;
      callDebug('turn config loaded', {
        turnReady: data.turnReady,
        ttl: data.ttl ?? null,
        expiresAt: data.expiresAt ?? null,
        servers: describeIceServersForDebug(data.iceServers),
      });
      updateRelayRoute();
      void refreshCloudflareRelayTrace();
    } catch (error) {
      callDebug('turn config error', { error: error instanceof Error ? error.message : 'unknown' });
      iceServers = [];
      iceServersFetchedAt = Date.now();
      iceServersExpiresAt = Date.now() + 30_000;
      updateRelayRoute();
      throw new Error(t(dict, 'chat.callTurnRequired'));
    }

    return iceServers;
  }

  async function sendEncryptedControl(payload: Record<string, unknown>) {
    if (!cryptoKey || !ws || ws.readyState !== 1) return;
    const encrypted = await encryptMessage(cryptoKey, JSON.stringify(payload));
    ws.send(JSON.stringify({ type: 'message', payload: encrypted, id: genId() }));
  }

  async function sendCallSignal(partial: Partial<CallSignal>) {
    if (!clientId) return;
    const signal: CallSignal = {
      type: 'call-signal',
      action: partial.action ?? 'media',
      callId: CALL_ID,
      from: clientId,
      fromAlias: aliasWire(alias),
      fromNick: nickname || undefined,
      mode: 'audio',
      audio: !micMuted,
      video: screenSharing || !cameraOff,
      screen: screenSharing,
      ...(callKeyPair ? { pub: callKeyPair.publicKey } : {}),
      ...(callKem && !partial.candidate ? { kem: callKem.publicKey } : {}),
      ...partial,
    };
    callDebug('call signal out', {
      action: signal.action,
      to: signal.to ? shortPeerId(signal.to) : '',
      hasSdp: Boolean(signal.sdp),
      hasCandidate: Boolean(signal.candidate),
      audio: signal.audio,
      video: signal.video,
      screen: signal.screen,
    });
    await sendEncryptedControl(signal as unknown as Record<string, unknown>);
  }

  // Media keys travel inside the room channel and are sealed again for one recipient, so room members outside the call,
  // or who have left it, cannot unwrap them.
  function notePeerMediaKeys(peer: CallPeer, signal: CallSignal): boolean {
    const { pub, kem } = signal;
    if (!pub || !validKemKey(kem) || (peer.mediaPub === pub && peer.mediaKem === kem)) return false;
    if (peer.mediaPub) frameCrypto?.dropPeer(peer.id);
    peer.mediaPub = pub;
    peer.mediaKem = kem;
    peer.sharedKeyId = undefined;
    return true;
  }

  async function shareMediaKey(peerId: string) {
    const peer = callPeerMap.get(peerId);
    const key = peer ? mediaKeys?.keyFor(peer.keyTicket) : null;
    if (!callActive || !callKeyPair || !peer?.mediaPub || !peer.mediaKem || !key) return;
    const raw = key.raw.slice();
    let seal: KemSeal | null = null;
    try {
      seal = kemSeal(peer.mediaKem);
      const wrapped = await wrapMediaKey(await deriveWrapKey(callKeyPair, peer.mediaPub, seal.secret), raw, mediaKeyContext(CALL_ID, clientId, peerId, key.id));
      if (callPeerMap.get(peerId) !== peer) return;
      peer.sharedKeyId = key.id;
      if (mediaKeys?.latest === key) mediaKeys.markShared();
      await sendCallSignal({ action: 'media-key', to: peerId, keyId: key.id, wrapped, e: seal.ciphertext });
      callDebug('media key out', { peer: shortPeerId(peerId), keyId: key.id });
    } catch {
    } finally {
      raw.fill(0);
      seal?.secret.fill(0);
    }
  }

  async function acceptMediaKey(signal: CallSignal) {
    const target = frameCrypto;
    if (!target || !callKeyPair || !callKem || !isMediaKeyId(signal.keyId) || !isCallPublicKey(signal.pub) || !validKemCiphertext(signal.e)) return;
    if (!mediaKeySenders.has(signal.from) && mediaKeySenders.size >= MAX_CALL_PEERS) return;
    let secret: Uint8Array | null = null;
    try {
      secret = kemOpen(callKem.secretKey, signal.e);
      const raw = await unwrapMediaKey(await deriveWrapKey(callKeyPair, signal.pub, secret), signal.wrapped, mediaKeyContext(CALL_ID, signal.from, clientId, signal.keyId));
      if (!raw) return;
      if (frameCrypto !== target) {
        raw.fill(0);
        return;
      }
      mediaKeySenders.add(signal.from);
      target.setReceiveKey(signal.from, signal.keyId, raw);
      callDebug('media key in', { peer: shortPeerId(signal.from), keyId: signal.keyId });
    } catch {
    } finally {
      secret?.fill(0);
    }
  }

  function requestMediaKey(peerId: string) {
    if (!callActive || !callPeerMap.has(peerId)) return;
    const now = Date.now();
    if (now - (mediaKeyRequestedAt.get(peerId) ?? 0) < MEDIA_KEY_REQUEST_MS) return;
    mediaKeyRequestedAt.set(peerId, now);
    void sendCallSignal({ action: 'media-key-request', to: peerId });
  }

  // Whoever stays after someone leaves moves to a fresh key, so the one who left cannot read what follows, and a newcomer
  // gets only a key made after it joined, so it cannot read what came before.
  function scheduleMediaKeyRotation() {
    if (!callActive || mediaKeyRotateTimer) return;
    mediaKeyRotateTimer = setTimeout(() => {
      mediaKeyRotateTimer = undefined;
      if (!callActive || !mediaKeys) return;
      const key = mediaKeys.rotate();
      if (callPeerMap.size) mediaKeys.markShared();
      callDebug('media key rotated', { keyId: key.id, peers: callPeerMap.size });
      for (const peer of callPeerMap.values()) void shareMediaKey(peer.id);
    }, MEDIA_KEY_ROTATE_DEBOUNCE_MS);
  }

  function failCallEncryption() {
    if (!callActive) return;
    void endCall(true).then(() => { callError = t(dict, 'chat.callE2eeFailed'); });
  }

  function updateServerQuality() {
    if (!connected) {
      serverQuality = 'offline';
      return;
    }
    if (serverLatencyMs === null || !lastServerPongAt) {
      serverQuality = 'unknown';
      return;
    }
    if (Date.now() - lastServerPongAt > 45000) {
      serverQuality = 'poor';
      return;
    }
    if (serverLatencyMs <= 150) {
      serverQuality = 'good';
    } else if (serverLatencyMs <= 350) {
      serverQuality = 'fair';
    } else {
      serverQuality = 'poor';
    }
  }

  function getServerQualityLabel(quality: ServerQuality): string {
    switch (quality) {
      case 'good': return t(dict, 'chat.serverQualityGood');
      case 'fair': return t(dict, 'chat.serverQualityFair');
      case 'poor': return t(dict, 'chat.serverQualityPoor');
      case 'offline': return t(dict, 'chat.serverQualityOffline');
      default: return t(dict, 'chat.serverQualityUnknown');
    }
  }

  function recordServerLatencySample(startedAt: number) {
    if (!startedAt) return;
    serverLatencyMs = Math.max(0, Date.now() - startedAt);
    lastServerPongAt = Date.now();
    updateServerQuality();
  }

  function sendServerPing() {
    if (!ws || ws.readyState !== 1) {
      updateServerQuality();
      return;
    }
    try {
      ws.send(JSON.stringify({ type: 'ping', t: Date.now() }));
    } catch {
      serverQuality = 'poor';
    }
    updateServerQuality();
  }

  function getRoomTtlSeconds(): number {
    return chatModeTtlSeconds(roomConfig.mode);
  }

  function shouldKeepParticipantHistory(): boolean {
    return chatModeKeepsHistory(roomConfig.mode);
  }

  function genId(): string {
    const arr = crypto.getRandomValues(new Uint8Array(8));
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  }

  function genAutoPassword(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    for (;;) {
      const chars = Array.from({ length: 20 }, () => alphabet[randomIndex(alphabet.length)]);
      const password = [0, 5, 10, 15].map(i => chars.slice(i, i + 5).join('')).join('-');
      if (roomPasswordOk(password, '')) return password;
    }
  }

  function genWhiteboardRoomId(): string {
    return `chat-${genId()}${genId()}`;
  }

  function getLocalePrefix(): string {
    return locale && locale !== 'en' ? `/${locale}` : '';
  }

  // Password rooms are format version 3; anything else the server reports does not count.
  function normalizeRoomConfig(input: unknown): RoomConfig | null {
    if (!input || typeof input !== 'object') return null;
    const value = input as Partial<RoomConfig>;
    const createdAt = typeof value.createdAt === 'number' ? value.createdAt : Date.now();
    if (value.authMode !== 'password' || value.v !== 3) return null;
    return { mode: normalizeChatMode(value.mode), authMode: 'password', createdAt, v: 3 };
  }

  // Once the key is derived the settings it was made for are final; later server reports can only match them.
  function applyRoomConfig(input: unknown): RoomConfig | null {
    const normalized = normalizeRoomConfig(input);
    if (keyConfig) {
      if (normalized && !sameConfig(normalized, keyConfig)) handleConfigMismatch();
      return keyConfig;
    }
    if (normalized) roomConfig = normalized;
    return normalized;
  }

  function getRoomModeLabel(): string {
    const ttl = getRoomTtlSeconds();
    if (ttl) return t(dict, 'chat.chip.modeDisappearing').replace('{time}', formatDuration(ttl, locale, 'short'));
    return t(dict, 'chat.modeLabelLive');
  }

  function bytesToB64url(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  async function sha256B64url(input: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return bytesToB64url(new Uint8Array(digest));
  }

  function readLocalHistory(): LocalHistoryEnvelope[] {
    if (!localHistoryKey || typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem(localHistoryKey);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item): item is LocalHistoryEnvelope =>
          item?.type === 'message' && typeof item.id === 'string' && item.v === 2 && typeof item.sealed === 'string'
        )
        .slice(-LOCAL_HISTORY_LIMIT);
    } catch {
      return [];
    }
  }

  function writeLocalHistory(items: LocalHistoryEnvelope[]) {
    if (!localHistoryKey || typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(localHistoryKey, JSON.stringify(items.slice(-LOCAL_HISTORY_LIMIT)));
    } catch {}
  }

  async function storeLocalSigned(id: string, signed: string, createdAt: number) {
    if (!shouldKeepParticipantHistory() || !localHistoryKey || !localKey || !id || !signed) return;
    const sealed = await sealLocal(localKey, id, signed);
    const items = readLocalHistory();
    if (items.some((item) => item.id === id)) return;
    items.push({ type: 'message', id, v: 2, sealed, createdAt });
    writeLocalHistory(items);
  }

  function clearLocalHistory() {
    if (!localHistoryKey) return;
    try {
      localStorage.removeItem(localHistoryKey);
    } catch {}
  }

  async function restoreLocalHistory() {
    if (localHistoryLoaded || !cryptoKey || !localKey || !shouldKeepParticipantHistory()) return;
    localHistoryLoaded = true;
    const items = readLocalHistory();
    if (!items.length) return;
    for (const item of [...items].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))) {
      const text = await openLocal(localKey, item.id, item.sealed);
      if (!text) continue;
      try {
        await processSigned(JSON.parse(text), { fromHistory: true, origin: 'local', signed: text, createdAt: item.createdAt });
      } catch {}
    }
    scrollToBottom(true);
  }

  function getWhiteboardUrl(invite: WhiteboardInvite): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://encrypt.click';
    return `${origin}${getLocalePrefix()}/whiteboard/${encodeURIComponent(invite.roomId)}`;
  }

  function normalizeWhiteboardInvite(parsed: any): WhiteboardInvite | null {
    if (!parsed || typeof parsed.roomId !== 'string' || typeof parsed.password !== 'string') return null;
    if (!parsed.roomId.trim() || !parsed.password.trim()) return null;
    const who = senderInfo(parsed);
    return {
      roomId: parsed.roomId,
      password: parsed.password,
      sender: who.name,
      color: who.color,
      alias: who.alias,
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
    };
  }

  function addWhiteboardInviteMessage(invite: WhiteboardInvite, id: string, mine: boolean) {
    const ttl = roomConfig.mode === 'live' ? 0 : Math.max(getRoomTtlSeconds() || 300, 300);
    messages = [...messages, {
      id,
      text: '',
      sender: invite.sender,
      initials: getInitials(invite.sender),
      alias: invite.alias,
      color: invite.color,
      mine,
      time: Date.now(),
      ttl,
      remaining: ttl,
      whiteboard: invite,
      revealed: true,
    }];
    followIncoming(mine);
  }

  async function createWhiteboardInvite() {
    if (!cryptoKey || !ws || !connected || !verified) return;
    composerMenuOpen = false;
    const child = appMode ? null : window.open('about:blank', '_blank');

    const invite: WhiteboardInvite = {
      roomId: genWhiteboardRoomId(),
      password: genAutoPassword(),
      sender: identity.name,
      color: identity.color,
      alias,
      createdAt: Date.now(),
    };
    const msgId = genId();
    const payload: ChatPayload = {
      type: 'whiteboard-invite',
      id: msgId,
      roomId: invite.roomId,
      password: invite.password,
      alias: aliasWire(alias), nick: nickname || undefined,
      createdAt: invite.createdAt,
    };
    await sendContent(payload, invite.createdAt);
    addWhiteboardInviteMessage(invite, msgId, true);
    openWhiteboardNewTab(invite, child);
  }

  /**
   * Seals and sends one content payload. With forward secrecy on, the signed payload travels inside the sender's chain;
   * otherwise it is only signed, padded and sealed under the room key.
   */
  async function sendContent(payload: ChatPayload, createdAt: number): Promise<{ signed: string }> {
    const { signed, wire } = await buildContent(payload);
    transmit(wire, payload.id!, createdAt);
    return { signed };
  }

  async function buildContent(payload: ChatPayload): Promise<{ signed: string; wire: string }> {
    if (fsSession) {
      const signed = await signForRoom(payload, false);
      return { signed, wire: await encryptMessage(cryptoKey!, JSON.stringify(await fsSession.seal(signed))) };
    }
    const signed = await signForRoom(payload, true);
    return { signed, wire: await sealMessage(cryptoKey!, signed) };
  }

  function transmit(wire: string, id: string, createdAt: number): boolean {
    if (netOffline || !ws || ws.readyState !== 1 || !joinedRoom) return false;
    try {
      ws.send(JSON.stringify({ type: 'message', payload: wire, id, createdAt }));
      return true;
    } catch {
      return false;
    }
  }

  /* Outbox: payloads that could not reach the relay stay queued with their
     pending bubble and flush on the next joined socket. The wire bytes are
     rebuilt at flush time so forward-secrecy seals always match the live
     session, and dedup on receivers (replay window + seenMessageIds) makes a
     retransmitted id a no-op — never a duplicate. */
  let outbox: ChatPayload[] = [];
  let outboxFlush = false;

  async function flushOutbox() {
    if (outboxFlush || (!outbox.length && !fileOutbox.length)) return;
    if (!cryptoKey || !ws || ws.readyState !== 1 || !joinedRoom) return;
    if (roomConfig.mode === 'live' && !fsSession) return;
    outboxFlush = true;
    try {
      const pendingItems = outbox;
      outbox = [];
      const requeue: ChatPayload[] = [];
      for (const payload of pendingItems) {
        const msgId = payload.id!;
        const createdAt = typeof payload.createdAt === 'number' ? payload.createdAt : Date.now();
        try {
          const { signed, wire } = await buildContent(payload);
          if (!transmit(wire, msgId, createdAt)) { requeue.push(payload); continue; }
          if (!payload.once && !payload.ttl) void storeLocalSigned(msgId, signed, createdAt).catch(() => {});
          messages = messages.map((m) => (m.id === msgId ? { ...m, pending: false, failed: false, signed } : m));
        } catch {
          requeue.push(payload);
        }
      }
      if (requeue.length) outbox = [...requeue, ...outbox];

      const files = fileOutbox;
      fileOutbox = [];
      for (const item of files) {
        if (netOffline || !ws || ws.readyState !== 1 || !joinedRoom) { fileOutbox = [item, ...fileOutbox]; continue; }
        try {
          await sendFile(item.file, item.voiceSeconds, item.msgId);
        } catch {
          fileOutbox = [...fileOutbox, item];
        }
      }
    } finally {
      outboxFlush = false;
    }
  }

  type FileOutboxItem = { msgId: string; file: File; voiceSeconds?: number };
  let fileOutbox: FileOutboxItem[] = [];

  // A file picked while offline renders as a pending bubble right away; the
  // bytes upload when the room is joined again and the bubble swaps in place.
  function queueFileMessage(file: File, voiceSeconds?: number) {
    const msgId = genId();
    const createdAt = Date.now();
    fileOutbox = [...fileOutbox, { msgId, file, voiceSeconds }];
    seenMessageIds.add(msgId);
    const once = onceEnabled;
    let fileTtl = roomConfig.mode === 'live' ? 0 : getRoomTtlSeconds();
    if (once) fileTtl = fileTtl > 0 ? Math.min(fileTtl, ONCE_TTL_SECONDS) : ONCE_TTL_SECONDS;
    const voiceMeta = voiceSeconds === undefined ? {} : { voice: true as const, duration: voiceSeconds };
    messages = [...messages, {
      id: msgId, text: '', sender: identity.name, initials: myInitials, alias, nick: nickname || undefined,
      color: identity.color, mine: true, time: createdAt,
      ttl: fileTtl, remaining: fileTtl,
      file: { name: file.name, size: file.size, urls: [], key: '', ...voiceMeta },
      once, revealed: true, pk: mySignerId, pending: true,
    }];
    onceEnabled = false;
    scrollToBottom(true);
    if (netOffline) onNotice?.(t(dict, 'chat.offlineSend'));
  }

  function retryQueued(msg: Message) {
    if (!msg.failed) return;
    messages = messages.map((m) => (m.id === msg.id ? { ...m, failed: false, pending: true } : m));
    void flushOutbox();
  }

  // The ephemeral forward secrecy keys travel inside the signed room channel so others know which senders they can grant to.
  function presenceFields(): Record<string, unknown> {
    return {
      alias: aliasWire(alias), nick: nickname || undefined, clientId,
      ...(fsSession ? { fs: fsSession.publicKey, kem: fsSession.kemPublicKey } : {}),
    };
  }

  async function sendPresence(want: string[] = []) {
    await sendEncryptedControl({ type: 'presence', ...presenceFields(), ...(want.length ? { want: want.slice(0, 64) } : {}) });
  }

  function scheduleWant() {
    if (wantTimer) return;
    wantTimer = setTimeout(() => {
      wantTimer = undefined;
      const want = fsSession?.wanted() ?? [];
      if (want.length) void sendPresence(want);
    }, 1500);
  }

  // After someone leaves, everyone still here answers with a presence: that is the roll call for the new sender chains.
  async function onMemberLeft(gone?: string) {
    if (gone) clientDeparted(gone);
    if (fsSession) await fsSession.memberLeft(gone);
    if (fsSession) await sendPresence();
  }

  function fsMember(parsed: any, signer: string): FsMember | null {
    return validEphemeralKey(parsed.fs) && validKemKey(parsed.kem) && typeof parsed.clientId === 'string' ? { clientId: parsed.clientId, pk: signer, pub: parsed.fs, kem: parsed.kem } : null;
  }

  // Messages kept here are signed plaintext, and a newcomer gets them sealed for it alone under a fresh pairwise key:
  // the signatures still verify, but nothing that crossed the relay earlier becomes readable with that newcomer's keys.
  const SYNC_BATCH_CHARS = 300_000;

  async function sendLiveHistorySync(member: FsMember) {
    if (roomConfig.mode !== 'live' || !fsSession) return;
    const shared = messages
      .filter((msg) => !msg.whiteboard && !msg.ttl && msg.pk && msg.signed && (msg.text || msg.file))
      .slice(-200);
    const ids = new Set(shared.map((msg) => msg.id));
    const items = [...shared.map((msg) => msg.signed!), ...reactionLog.filter((entry) => ids.has(entry.target)).map((entry) => entry.signed)];
    let batch: string[] = [];
    let chars = 0;
    for (const item of items) {
      if (batch.length && (chars + item.length > SYNC_BATCH_CHARS || batch.length >= MAX_SYNC_ITEMS)) {
        await sendEncryptedControl(await fsSession.sealSync(member, batch));
        batch = [];
        chars = 0;
      }
      batch.push(item);
      chars += item.length;
    }
    if (batch.length) await sendEncryptedControl(await fsSession.sealSync(member, batch));
  }

  async function applyLiveHistorySync(items: string[]) {
    if (roomConfig.mode !== 'live') return;
    const before = messages.length;
    for (const text of items) {
      if (text.length > SYNC_BATCH_CHARS) continue;
      try {
        const value = JSON.parse(text);
        if ((value?.type !== 'chat-message' && value?.type !== 'reaction' && value?.type !== 'member-event') || value.ttl) continue;
        await processSigned(value, { fromHistory: true, origin: 'sync', signed: text });
      } catch {}
    }
    if (messages.length !== before) {
      messages = [...messages].sort((a, b) => a.time - b.time);
      scrollToBottom();
    }
  }

  function openWhiteboardNewTab(invite: WhiteboardInvite, opened?: Window | null) {
    composerMenuOpen = false;
    if (appMode && onOpenBoardApp) {
      try {
        sessionStorage.setItem('whiteboard-password', invite.password);
      } catch {}
      onOpenBoardApp(invite.roomId, invite.password);
      return;
    }
    const url = getWhiteboardUrl(invite);
    const child = opened !== undefined ? opened : typeof window !== 'undefined' ? window.open('about:blank', '_blank') : null;
    if (child) {
      try {
        child.sessionStorage.setItem('whiteboard-password', invite.password);
        child.location.href = url;
        return;
      } catch {
        child.close();
      }
    }
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('whiteboard-password', invite.password);
      window.location.href = url;
    }
  }

  function chooseFileUpload() {
    composerMenuOpen = false;
    fileInputEl?.click();
  }

  async function initChat() {
    if (typeof window === 'undefined') return;
    checkingRoom = true;
    const storedConfig = sessionStorage.getItem('chat-room-config');
    if (storedConfig) {
      sessionStorage.removeItem('chat-room-config');
      try {
        pendingRoomConfig = normalizeRoomConfig(JSON.parse(storedConfig));
        if (pendingRoomConfig) roomConfig = pendingRoomConfig;
      } catch {}
    }
    const sharePass = sessionStorage.getItem('chat-share-password');
    if (sharePass) {
      sharePassword = sharePass;
      sessionStorage.removeItem('chat-share-password');
    }
    const stored = sessionStorage.getItem('chat-password');
    const remembered = stored || sessionStorage.getItem(`chat-pw:${roomId}`);
    if (stored) sessionStorage.removeItem('chat-password');
    if (remembered) {
      passwordInput = remembered;
      await enterWithPassword(remembered);
    } else {
      checkingRoom = false; needsPassword = true;
    }
  }

  $: shareUrl = typeof window === 'undefined' ? '' : appMode
    ? `${location.origin}${getLocalePrefix()}/app?room=${encodeURIComponent(roomId)}`
    : `${location.origin}${location.pathname}`;

  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      shareCopiedLink = true;
      setTimeout(() => { shareCopiedLink = false; }, 1500);
    } catch {}
  }

  async function submitPassword() {
    passwordError = '';
    if (!passwordInput.trim()) { passwordError = t(dict, 'chat.errorEnterPassword'); return; }
    await enterWithPassword(passwordInput.trim());
  }

  function retryPasswordEntry() {
    clearVerificationTimeout();
    needsPassword = false;
    checkingRoom = true;
    passwordInput = '';
    try { sessionStorage.removeItem(`chat-pw:${roomId}`); } catch {}
    pendingSecret = null;
    cryptoKey = null;
    dropForwardSecrecy();
    keyConfig = null;
    roomMissing = false;
    verified = false;
    verifying = false;
    joinedRoom = false;
    ws?.close();
    ws = null;
    everVerified = false;
    checkingRoom = false; needsPassword = true;
  }

  function clearVerificationTimeout() {
    if (!verificationTimeout) return;
    clearTimeout(verificationTimeout);
    verificationTimeout = undefined;
  }

  function markVerified() {
    clearVerificationTimeout();
    verified = true;
    everVerified = true;
    verifying = false;
    offerPendingSafetyCompares();
  }

  function startPasswordVerification(activePeerCount: number) {
    clearVerificationTimeout();
    verifying = true;
    verified = false;

    if (activePeerCount <= 0) {
      markVerified();
      return;
    }

    // Same name + different password is already another channel. If peers on
    // this channel do not ack in time, enter anyway; undecryptable traffic is dropped.
    verificationTimeout = setTimeout(() => {
      if (verifying && !verified) markVerified();
    }, 4000);
  }

  async function announceJoined(activePeerCount?: number) {
    if (!cryptoKey || !ws || ws.readyState !== 1) return;

    joinedRoom = true;
    ws.send(JSON.stringify({ type: 'join', token: accessToken, config: pendingRoomConfig || roomConfig }));

    // An empty room shows its own notice only after peers had a moment to hand their local copies over.
    historyReady = serverPresence <= 1;
    if (!historyReady) setTimeout(() => { historyReady = true; }, 1500);

    if (typeof activePeerCount === 'number') {
      startPasswordVerification(activePeerCount);
    } else {
      verifying = true;
      verified = false;
    }

    verificationChallenge = crypto.randomUUID();
    const verifyPayload = await encryptMessage(cryptoKey, JSON.stringify({ type: 'verify', challenge: verificationChallenge, ...presenceFields() }));
    ws.send(JSON.stringify({ type: 'message', payload: verifyPayload, id: genId() }));
  }

  async function enterWithPassword(pwd: string) {
    try {
      const secret = await roomSecret(pwd, roomId, 'chat');
      accessToken = secret.token; channelId = secret.channel;
      if (!(await setupIdentity(`chat:${channelId}`))) return;
      pendingSecret = secret;
      needsPassword = false;
      try { sessionStorage.setItem(`chat-pw:${roomId}`, pwd); } catch {}
      checkingRoom = true;
      if (pendingRoomConfig) {
        roomConfig = pendingRoomConfig;
        await unlockRoom(pendingRoomConfig);
        return;
      }
      // Everyone but the creator learns the room mode from the server first, because the key depends on it.
      ws?.close();
      ws = null;
      connectWs();
    } catch {
      passwordError = t(dict, 'chat.errorDeriveKey');
      checkingRoom = false;
      needsPassword = true;
    }
  }

  function sameConfig(a: RoomConfig, b: RoomConfig): boolean {
    return a.mode === b.mode && a.v === b.v;
  }

  function rememberedMode(): string | null {
    try { return localStorage.getItem(`${MODE_PREFIX}${channelId}`); } catch { return null; }
  }

  // Rooms are only ever created through the create form, with its password rules and an explicit mode.
  async function openWithConfig(config: RoomConfig | null) {
    if (!pendingSecret || cryptoKey) return;
    const next = roomLookup(config, rememberedMode());
    if (next === 'missing') {
      pendingSecret = null;
      roomMissing = true;
      checkingRoom = false;
      ws?.close();
      ws = null;
    } else if (next === 'mismatch') {
      handleConfigMismatch();
    } else if (config) {
      await unlockRoom(config);
    }
  }

  async function unlockRoom(config: RoomConfig) {
    const secret = pendingSecret;
    if (!secret) return;
    pendingSecret = null;
    keyConfig = config;
    roomConfig = config;
    cryptoKey = await roomMessageKey(secret.base, config.mode);
    const fsSecret = await roomForwardSecret(secret.base, config.mode);
    localKey = await forwardLocalKey(fsSecret);
    fsSession?.destroy();
    fsSession = await ForwardSecrecySession.create({
      channel: channelId,
      self: { pk: roomIdentity!.publicKey, clientId },
      secret: fsSecret,
      send: (payload) => sendEncryptedControl(payload),
    });
    fsSecret.fill(0);
    try { localStorage.setItem(`${MODE_PREFIX}${channelId}`, configStamp(config)); } catch {}
    localHistoryKey = `${LOCAL_HISTORY_PREFIX}${roomId}:${channelId}`;
    localHistoryLoaded = false;
    needsPassword = false;
    checkingRoom = false;
    await restoreLocalHistory();
    void restoreScheduledDrafts();
    if (ws && ws.readyState === 1) {
      await announceJoined(serverPresence);
    } else if (!ws) {
      connectWs();
    }
  }

  function dropForwardSecrecy() {
    fsSession?.destroy();
    fsSession = null;
    localKey = null;
    clearTimeout(wantTimer);
    wantTimer = undefined;
  }

  // A server that reports different settings than the key was made for is either lying or serving another room.
  function handleConfigMismatch() {
    configChanged = true;
    pendingSecret = null;
    checkingRoom = false;
    verifying = false;
    dropForwardSecrecy();
    cleanupCall();
    ws?.close();
    ws = null;
  }

  async function setupIdentity(room: string): Promise<boolean> {
    try {
      roomIdentity = await loadRoomIdentity(room);
    } catch {
      checkingRoom = false;
      unsupportedBrowser = true;
      return false;
    }
    mySignerId = roomIdentity.publicKey;
    trustRoom = room;
    trustTable = loadTrustTable(trustRoom);
    const mine = myLabelKey();
    if (!trustTable[mine]?.includes(mySignerId)) {
      trustTable[mine] = [...(trustTable[mine] || []), mySignerId];
      saveTrustTable(trustRoom, trustTable);
    }
    myKeyCode = await keyCode(mySignerId);
    return true;
  }

  function askForPassword() {
    if (cryptoKey) return;
    checkingRoom = false;
    verifying = false;
    needsPassword = true;
  }

  let serverPresence = 0;
  let joinedRoom = false;

  let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
  let verificationTimeout: ReturnType<typeof setTimeout> | undefined;

  function connectWs() {
    verifying = true;
    serverConnectStartedAt = Date.now();
    ws = new PartySocket({
      host: partyHost || window.location.host,
      party: 'main',
      room: channelId,
      minReconnectionDelay: 500,
      maxReconnectionDelay: 8000,
      reconnectionDelayGrowFactor: 1.4,
      connectionTimeout: 8000,
      maxRetries: Infinity,
    });
    let opened = false;
    ws.addEventListener('open', async () => {
      connected = true;
      recordServerLatencySample(serverConnectStartedAt);
      if (opened) await fsSession?.reconnected();
      opened = true;
      if (cryptoKey) await announceJoined();
      sendServerPing();
      restartDisconnectedPeers();
      void flushOutbox();
    });
    ws.addEventListener('close', () => {
      connected = false;
      joinedRoom = false;
      serverLatencyMs = null;
      serverConnectStartedAt = 0;
      updateServerQuality();
    });
    ws.addEventListener('error', () => {
      // A socket error is a network problem, not a wrong password; the handshake timeout decides that.
    });
    // Messages are handled one at a time in arrival order: a chain key has to be in place before the messages sealed with it.
    ws.addEventListener('message', (event) => {
      inbound = inbound.then(() => handleServerMessage(event)).catch(() => {});
    });

    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      sendServerPing();
    }, 10000);
  }

  async function handleServerMessage(event: MessageEvent) {
    let data: any;
    try { data = JSON.parse(event.data); } catch { return; }

    if (data.type === 'init') {
      serverPresence = typeof data.presence === 'number' ? data.presence : 0;
      lastPresenceCount = serverPresence;
      const config = applyRoomConfig(data.config);
      if (!cryptoKey && pendingSecret) {
        await openWithConfig(config);
        return;
      }
      if (!cryptoKey) {
        askForPassword();
        return;
      }
      // The server reports only people who are already inside the chat. When
      // that count is zero, there is nobody online to validate this password.
      if (verifying) {
        startPasswordVerification(serverPresence);
      }
      return;
    }
    if (data.type === 'room-config') {
      const config = applyRoomConfig(data.config);
      if (!cryptoKey && pendingSecret && config) await openWithConfig(config);
      else if (!cryptoKey && config) askForPassword();
      return;
    }
    if (data.type === 'pong') {
      if (typeof data.t === 'number') {
        serverLatencyMs = Math.max(0, Date.now() - data.t);
        lastServerPongAt = Date.now();
      }
      updateServerQuality();
      return;
    }
    if (data.type === 'presence') {
      serverPresence = typeof data.count === 'number' ? data.count : 0;
      const left = serverPresence < lastPresenceCount;
      lastPresenceCount = serverPresence;
      const gone = typeof data.left === 'string' ? departedClient(data.left) : undefined;
      if (cryptoKey && joinedRoom && verifying && !verified && serverPresence <= 1) {
        markVerified();
      }
      if (left && verified) await onMemberLeft(gone);
      return;
    }
    if (data.type !== 'message') return;
    await processServerEnvelope(data as ServerEnvelope);
  }

  // origin 'local' is this browser's own stored copy, 'sync' is history a peer handed over in a live room.
  async function processServerEnvelope(data: ServerEnvelope, fromHistory = false, origin: Origin = null): Promise<boolean> {
    if (!cryptoKey) return false;
    let plaintext: string;
    let parsed: any;
    try {
      plaintext = await decryptMessage(cryptoKey, data.payload);
      parsed = JSON.parse(plaintext);
    } catch {
      // Undecryptable traffic stays invisible; a different password is already another channel.
      return false;
    }
    try {
      const conn = !fromHistory && typeof data.from === 'string' ? data.from : undefined;
      return await processSigned(parsed, { fromHistory, origin, createdAt: data.createdAt, wire: data.payload, signed: plaintext, conn });
    } catch {
      return false;
    }
  }

  async function authenticate(parsed: any): Promise<Signer | null> {
    const ed = await verifyPayload(parsed);
    return ed ? { id: ed, ed } : null;
  }

  // The inner payload must be signed by the same member whose chain sealed it.
  async function openForwardSecret(sender: string, outer: unknown): Promise<boolean> {
    if (!fsSession) return true;
    const inner = await fsSession.open(sender, outer);
    if (inner === PENDING) scheduleWant();
    if (typeof inner !== 'string') return true;
    try {
      return await processSigned(JSON.parse(inner), { fromHistory: false, origin: null, signed: inner, fsSender: sender });
    } catch {
      return false;
    }
  }

  async function processSigned(parsed: any, ctx: ProcessContext): Promise<boolean> {
    const { fromHistory, origin } = ctx;
    if (!validPayload(parsed, channelId, fromHistory)) return false;
    // Every payload is signed; anything that fails the Ed25519 check is dropped.
    const auth = await authenticate(parsed);
    if (!auth) return false;
    const signer = auth.id;
    if (ctx.fsSender !== undefined && signer !== ctx.fsSender) return false;
    if (ctx.conn && typeof parsed.clientId === 'string' && bindClient(parsed.clientId, signer)) noteConnection(ctx.conn, parsed.clientId);
    const content = isContent(parsed);
    if (ctx.fsSender !== undefined && !content) return false;
    if (origin === null && !relayedContentOk(parsed, Boolean(fsSession), ctx.fsSender !== undefined)) return false;
    if (!replay.accept(parsed._id)) return true;
    if (ctx.wire && !replay.accept(await sha256B64url(ctx.wire))) return true;
    if (typeof parsed.id === 'string' && seenMessageIds.has(parsed.id)) return true;
    if (typeof parsed.id === 'string') seenMessageIds.add(parsed.id);

    if (parsed.type === 'fs') {
      if (fromHistory) return true;
      return openForwardSecret(signer, parsed);
    }

    if (parsed.type === 'fs-key') {
      if (fromHistory || !fsSession || !bindClient(parsed.clientId, signer)) return true;
      const released = await fsSession.acceptGrant(signer, parsed);
      const member = fsMember(parsed, signer);
      if (member) await fsSession.memberSeen(member);
      for (const item of released) await openForwardSecret(item.sender, item.outer);
      return true;
    }

    if (parsed.type === 'presence') {
      if (fromHistory || !bindClient(parsed.clientId, signer)) return true;
      const who = senderInfo(parsed);
      addOnlineUser(who);
      noteMember(signer, who);
      clientArrived(signer, parsed.clientId);
      const member = fsMember(parsed, signer);
      if (fsSession && member) {
        if (Array.isArray(parsed.want) && parsed.want.includes(roomIdentity?.publicKey)) await fsSession.memberWants(member);
        else await fsSession.memberSeen(member);
      }
      return true;
    }

    if (parsed.type === 'typing') {
      if (fromHistory) return true;
      const who = senderInfo(parsed);
      typing = { sender: who.name, initials: who.initials, color: who.color, alias: who.alias };
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => { typing = null; }, 3000);
      return true;
    }

    if (parsed.type === 'verify') {
      if (fromHistory) return true;
      if (cryptoKey && ws && typeof parsed.challenge === 'string') {
        const ack = await encryptMessage(cryptoKey, JSON.stringify({ type: 'verify-ack', challenge: parsed.challenge, ...presenceFields() }));
        ws.send(JSON.stringify({ type: 'message', payload: ack, id: genId() }));
      }
      if (!bindClient(parsed.clientId, signer)) return true;
      if (callActive) void sendCallSignal({ action: 'presence' });
      const joiner = senderInfo(parsed);
      addOnlineUser(joiner);
      noteMember(signer, joiner);
      const member = fsMember(parsed, signer);
      if (fsSession && member) {
        await fsSession.memberJoined(member);
        void sendLiveHistorySync(member);
      }
      clientArrived(signer, parsed.clientId);
      return true;
    }

    if (parsed.type === 'rename') {
      const who = senderInfo(parsed);
      const claimed = typeof parsed.prev === 'string' ? parsed.prev : '';
      const prev = trustTable[claimed]?.includes(signer) ? claimed : '';
      const before = onlineUsers.find((u) => u.key === prev);
      const priorName = before?.name ?? members.get(signer)?.name;
      if (!fromHistory) onlineUsers = [...onlineUsers.filter((u) => u.key !== prev && u.key !== who.key), who];
      noteMember(signer, who);
      if (!fromHistory) messages = messages.map((m) => (m.pk === signer && !m.mine ? { ...m, sender: who.name, initials: who.initials, color: who.color, alias: who.alias, nick: who.nick } : m));
      return true;
    }

    if (parsed.type === 'verify-ack') {
      if (fromHistory) return true;
      if (!bindClient(parsed.clientId, signer)) return true;
      const acker = senderInfo(parsed);
      const member = fsMember(parsed, signer);
      if (fsSession && member) await fsSession.memberSeen(member, parsed.challenge === verificationChallenge);
      if (parsed.challenge !== verificationChallenge) return true;
      if (verifying) markVerified();
      addOnlineUser(acker);
      noteMember(signer, acker);
      clientArrived(signer, parsed.clientId);
      return true;
    }

    if (parsed.type === 'chat-sync') {
      if (fromHistory || !fsSession || !bindClient(parsed.clientId, signer)) return true;
      const items = await fsSession.openSync(signer, parsed);
      if (items) await applyLiveHistorySync(items);
      return true;
    }

    if (parsed.type === 'whiteboard-invite') {
      if (fromHistory) return true;
      const id = parsed.id || `whiteboard-${genId()}`;
      const invite = normalizeWhiteboardInvite(parsed);
      if (!invite) return true;
      addWhiteboardInviteMessage(invite, id, false);
      return true;
    }

    if (parsed.type === 'call-signal') {
      if (fromHistory) return true;
      if (!bindClient(parsed.from, signer) || !noteMember(signer, senderInfo(parsed))) return true;
      // Call signals keep their own order without holding up the chat while a call is being negotiated.
      callSignals = callSignals.then(() => handleCallSignal(parsed as CallSignal)).catch(() => {});
      return true;
    }

    if (!content) return true;

    const id = parsed.id || genId();
    const ttl = parsed.ttl || 0;
    const who = senderInfo(parsed);
    const mine = Boolean(roomIdentity && auth.ed === roomIdentity.publicKey);
    const trusted = mine || noteMember(signer, who);
    const keep = !fromHistory || origin === 'sync';
    if (parsed.type === 'reaction') {
      applyReaction(id, parsed, signer, who.name, ctx.signed);
      if (!ttl && ctx.signed && origin !== 'local' && keep) {
        void storeLocalSigned(id, ctx.signed, typeof ctx.createdAt === 'number' ? ctx.createdAt : parsed._sentAt).catch(() => {});
      }
      return true;
    }
    if (parsed.type === 'member-event') {
      applyMemberEvent(id, parsed, signer, who.name, ctx.signed);
      if (!ttl && ctx.signed && origin !== 'local' && keep) {
        void storeLocalSigned(id, ctx.signed, typeof ctx.createdAt === 'number' ? ctx.createdAt : parsed._sentAt).catch(() => {});
      }
      if (!fromHistory) followIncoming(false);
      return true;
    }
    if (parsed.type === 'message-burn') {
      if (!validMessageRef(parsed.target)) return true;
      const targetMsg = messages.find((m) => m.id === parsed.target);
      // Burn-for-everyone is honored only from the author; a view-once message may be consumed by whoever opens it.
      if (targetMsg && !targetMsg.once && targetMsg.pk !== signer) return true;
      removeBurnedMessage(parsed.target);
      return true;
    }
    if (typeof parsed.id === 'string' && burnedIds.has(parsed.id)) return true;
    const once = parsed.once === true;
    const msg: Message = {
      id,
      text: parsed.text || '',
      sender: who.name,
      initials: who.initials,
      alias: who.alias,
      nick: who.nick,
      color: who.color,
      mine,
      time: parsed.createdAt || Date.now(),
      ttl,
      remaining: ttl,
      file: parsed.file ? {
        name: parsed.file.name, size: parsed.file.size, urls: parsed.file.urls, key: parsed.file.key,
        ...(parsed.file.voice === true && validVoiceDuration(parsed.file.duration) ? { voice: true as const, duration: parsed.file.duration } : {}),
      } : undefined,
      once,
      revealed: mine || !once,
      pk: signer,
      keyWarning: !trusted,
      ...(ctx.signed ? { signed: ctx.signed } : {}),
      ...(validMessageRef(parsed.replyTo) ? { replyTo: parsed.replyTo } : {}),
    };
    seenMessageIds.add(id);
    messages = [...messages, msg];
    typing = null;
    if (!fromHistory) followIncoming(mine);
    if (!ttl && ctx.signed && origin !== 'local' && keep) {
      void storeLocalSigned(id, ctx.signed, typeof ctx.createdAt === 'number' ? ctx.createdAt : msg.time).catch(() => {});
    }

    if (msg.file && msg.revealed) autoPreview(msg);

    if (!fromHistory && !mine) noteUnread();
    return true;
  }

  // A hidden tab counts what arrived in its title and app badge; a notification, when turned on, says only that something did.
  function noteUnread() {
    if (!document.hidden && document.hasFocus()) return;
    unread++;
    document.title = titleWithUnread(baseTitle, unread);
    navigator.setAppBadge?.(unread).catch(() => {});
    if (notifyOn && document.hidden) notifyBurst.note();
  }

  function clearUnread() {
    notifyBurst.cancel();
    shownNotification?.close();
    shownNotification = null;
    if (!unread) return;
    unread = 0;
    document.title = baseTitle;
    navigator.clearAppBadge?.().catch(() => {});
  }

  function showNotification() {
    if (!notifyOn || !document.hidden || !unread || Notification.permission !== 'granted') return;
    try {
      shownNotification?.close();
      const notification = new Notification(t(dict, 'chat.notifyTitle'), { body: t(dict, 'chat.notifyBody'), tag: 'encrypt.click-chat' });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
      shownNotification = notification;
    } catch {}
  }

  async function toggleNotifications() {
    if (notifyOn) {
      notifyOn = false;
      notifyBurst.reset();
      saveNotifyPref(localStorage, roomId, false);
      return;
    }
    if (!notifySupported) return;
    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission().catch(() => 'denied' as NotificationPermission);
    if (permission !== 'granted') {
      fileError = t(dict, 'chat.notifyDenied');
      return;
    }
    notifyOn = true;
    saveNotifyPref(localStorage, roomId, true);
  }

  /** Sends `text` as a chat message without touching the composer input, so scheduled drafts and typed text never collide. */
  async function sendChatMessage(text: string, opts: { once?: boolean; replyTo?: string } = {}): Promise<boolean> {
    const trimmed = text.trim();
    if (!trimmed || !cryptoKey || !ws) return false;

    const burn = parseBurnSuffix(trimmed);
    const once = opts.once === true;
    let finalTtl = burn ? burn.ttl : roomConfig.mode === 'live' ? 0 : getRoomTtlSeconds();
    if (once) finalTtl = finalTtl > 0 ? Math.min(finalTtl, ONCE_TTL_SECONDS) : ONCE_TTL_SECONDS;
    const body = burn ? burn.text : trimmed;
    const msgId = genId();
    const createdAt = Date.now();
    const replyTo = opts.replyTo;
    const keep = !once && !finalTtl;

    const payload: ChatPayload = {
      type: 'chat-message',
      id: msgId,
      text: body,
      alias: aliasWire(alias), nick: nickname || undefined,
      ttl: finalTtl,
      createdAt,
      ...(once ? { once: true as const } : {}),
      ...(replyTo ? { replyTo } : {}),
    };

    let built: { signed: string; wire: string };
    try {
      built = await buildContent(payload);
    } catch {
      fileError = t(dict, 'chat.sendFailed');
      return false;
    }
    const delivered = transmit(built.wire, msgId, createdAt);
    if (!delivered) {
      outbox = [...outbox, payload];
      if (netOffline) onNotice?.(t(dict, 'chat.offlineSend'));
    } else if (keep) {
      void storeLocalSigned(msgId, built.signed, createdAt).catch(() => {});
    }
    seenMessageIds.add(msgId);

    messages = [...messages, {
      id: msgId, text: body, sender: identity.name, initials: myInitials, alias, nick: nickname || undefined,
      color: identity.color, mine: true, time: createdAt,
      ttl: finalTtl, remaining: finalTtl,
      once, revealed: true, pk: mySignerId, signed: delivered ? built.signed : undefined,
      pending: !delivered,
      ...(replyTo ? { replyTo } : {}),
    }];
    return true;
  }

  let sendInFlight = false;
  async function sendMessage() {
    const text = inputText.trim();
    if (!text || sendInFlight) return;
    sendInFlight = true;
    try {
      const once = onceEnabled;
      const replyTo = replyTarget?.id;
      if (!(await sendChatMessage(text, { once, replyTo }))) return;
      inputText = '';
      replyTarget = null;
      onceEnabled = false;
      scrollToBottom(true);
    } finally {
      sendInFlight = false;
    }
  }

  function clearOnceTimer(id: string) {
    const timer = onceClearTimers.get(id);
    if (!timer) return;
    clearTimeout(timer);
    onceClearTimers.delete(id);
  }

  function forgetLocalMessage(id: string) {
    if (!localHistoryKey) return;
    const items = readLocalHistory().filter((item) => item.id !== id);
    writeLocalHistory(items);
  }

  function removeBurnedMessage(id: string) {
    clearOnceTimer(id);
    burnedIds.add(id);
    if (burnedIds.size > 5000) burnedIds.delete(burnedIds.values().next().value!);
    forgetLocalMessage(id);
    if (burnConfirmMsg?.id === id) burnConfirmMsg = null;
    if (!messages.some((msg) => msg.id === id)) return;
    reactionBook.forget(id);
    messages = messages.filter((msg) => msg.id !== id);
  }

  async function sendMessageBurn(target: string) {
    if (!cryptoKey || !ws || !connected) return;
    const id = genId();
    const createdAt = Date.now();
    const payload: ChatPayload = {
      type: 'message-burn',
      id,
      target,
      alias: aliasWire(alias),
      nick: nickname || undefined,
      ttl: ONCE_TTL_SECONDS,
      createdAt,
    };
    try {
      await sendContent(payload, createdAt);
    } catch {
      fileError = t(dict, 'chat.sendFailed');
      return;
    }
    seenMessageIds.add(id);
  }

  async function revealOnce(msg: Message) {
    if (!msg.once || msg.mine || msg.revealed) return;
    msg.revealed = true;
    messages = messages;
    await sendMessageBurn(msg.id);
    clearOnceTimer(msg.id);
    onceClearTimers.set(msg.id, setTimeout(() => {
      onceClearTimers.delete(msg.id);
      removeBurnedMessage(msg.id);
    }, ONCE_CLEAR_MS));
  }

  function burnOwnMessage(msg: Message) {
    if (!msg.mine || msg.whiteboard || !connected) return;
    actionMenuFor = null;
    burnConfirmMsg = msg;
  }

  async function confirmBurnOwnMessage() {
    const msg = burnConfirmMsg;
    burnConfirmMsg = null;
    if (!msg || !msg.mine || msg.whiteboard || !connected) return;
    await sendMessageBurn(msg.id);
    removeBurnedMessage(msg.id);
  }

  function clearScheduleTimer(id: string) {
    const timer = scheduleTimers.get(id);
    if (!timer) return;
    clearTimeout(timer);
    scheduleTimers.delete(id);
  }

  async function persistScheduledDrafts() {
    if (typeof sessionStorage === 'undefined' || !channelId || !cryptoKey) return;
    const key = cryptoKey;
    await writeSealedDrafts(sessionStorage, roomId, channelId, scheduledDrafts, (text) => sealMessage(key, text));
  }

  async function restoreScheduledDrafts() {
    if (typeof sessionStorage === 'undefined' || !channelId || !cryptoKey) return;
    if (scheduledRestoredFor === channelId) return;
    scheduledRestoredFor = channelId;
    const key = cryptoKey;
    const drafts = await readSealedDrafts(sessionStorage, roomId, channelId, (data) => decryptMessage(key, data).catch(() => null));
    for (const timer of scheduleTimers.values()) clearTimeout(timer);
    scheduleTimers.clear();
    scheduledDrafts = drafts;
    for (const draft of drafts) armScheduled(draft);
    void persistScheduledDrafts();
  }

  function cancelScheduled(id: string) {
    clearScheduleTimer(id);
    scheduledDrafts = scheduledDrafts.filter((draft) => draft.id !== id);
    void persistScheduledDrafts();
  }

  function armScheduled(draft: ScheduledDraft) {
    clearScheduleTimer(draft.id);
    const delay = Math.max(0, draft.sendAt - Date.now());
    scheduleTimers.set(draft.id, setTimeout(() => { void flushScheduled(draft.id); }, delay));
  }

  // A due draft retries until it sends or is ten minutes overdue; it never borrows the composer input,
  // so whatever the member is typing survives, and nothing is dropped silently while the room is offline.
  async function flushScheduled(id: string) {
    const draft = scheduledDrafts.find((item) => item.id === id);
    clearScheduleTimer(id);
    if (!draft) return;
    if (Date.now() - draft.sendAt > SCHEDULE_EXPIRED_MS) {
      scheduledDrafts = scheduledDrafts.filter((item) => item.id !== id);
      void persistScheduledDrafts();
      fileError = t(dict, 'chat.scheduleFailed');
      return;
    }
    if (connected && cryptoKey && ws) {
      scheduledDrafts = scheduledDrafts.filter((item) => item.id !== id);
      if (await sendChatMessage(draft.text, { once: draft.once, replyTo: draft.replyTo })) {
        void persistScheduledDrafts();
        return;
      }
      scheduledDrafts = [...scheduledDrafts, draft];
    }
    scheduleTimers.set(id, setTimeout(() => { void flushScheduled(id); }, SCHEDULE_RETRY_MS));
    void persistScheduledDrafts();
  }

  function queueScheduled(offsetMs: number) {
    const text = inputText.trim();
    if (!text || !connected) return;
    const sendAt = scheduleAt(offsetMs);
    if (!validSendAt(sendAt)) return;
    const draft: ScheduledDraft = {
      id: genId(),
      text,
      sendAt,
      once: onceEnabled,
      ...(replyTarget ? { replyTo: replyTarget.id } : {}),
    };
    scheduledDrafts = [...scheduledDrafts, draft].sort((a, b) => a.sendAt - b.sendAt);
    armScheduled(draft);
    void persistScheduledDrafts();
    inputText = '';
    onceEnabled = false;
    replyTarget = null;
    scheduleMenuOpen = false;
  }

  // Replies and reactions travel inside the signed, encrypted payload like any message, so the relay cannot tell them apart.
  function applyReaction(id: string, parsed: any, reactor: string, name: string, signed?: string) {
    const changed = reactionBook.apply({ id, target: parsed.target, emoji: parsed.emoji, remove: parsed.remove === true, reactor, name, at: parsed._sentAt });
    if (signed && !parsed.ttl) {
      reactionLog.push({ target: parsed.target, signed });
      if (reactionLog.length > REACTION_LOG_LIMIT) reactionLog.shift();
    }
    if (changed) reactionTick++;
  }

  function myReactions(target: string, _tick: number): ReactionEmoji[] {
    return REACTION_EMOJI.filter((emoji) => reactionBook.has(target, emoji, mySignerId));
  }

  async function toggleReaction(target: Message, emoji: ReactionEmoji) {
    if (!cryptoKey || !ws || !connected) return;
    const remove = reactionBook.has(target.id, emoji, mySignerId);
    const ttl = roomConfig.mode === 'live' ? 0 : getRoomTtlSeconds();
    const id = genId();
    const createdAt = Date.now();
    const payload: ChatPayload = {
      type: 'reaction', id, target: target.id, emoji, ...(remove ? { remove: true as const } : {}),
      alias: aliasWire(alias), nick: nickname || undefined, ttl, createdAt,
    };
    let signed: string;
    try {
      ({ signed } = await sendContent(payload, createdAt));
    } catch {
      fileError = t(dict, 'chat.sendFailed');
      return;
    }
    seenMessageIds.add(id);
    if (!ttl) void storeLocalSigned(id, signed, createdAt).catch(() => {});
    applyReaction(id, JSON.parse(signed), mySignerId, identity.name, signed);
  }

  async function copyMessageText(msg: Message) {
    actionMenuFor = null;
    try {
      await navigator.clipboard.writeText(msg.text);
      onNotice?.(t(dict, 'common.copied'));
    } catch {}
  }

  function startReply(msg: Message) {
    replyTarget = msg;
    actionMenuFor = null;
    void settled().then(() => inputEl?.focus());
  }

  function quoteOf(id: string | undefined, index: Map<string, Message>): { name: string; color: string; text: string } {
    const target = id ? index.get(id) : undefined;
    if (!target) return { name: '', color: '', text: t(dict, 'chat.replyUnavailable') };
    const text = target.once && !target.mine && !target.revealed ? t(dict, 'chat.onceBadge')
      : target.text ? plainSnippet(target.text)
      : target.file?.voice ? `${t(dict, 'chat.voiceMessage')} · ${formatClock(target.file.duration ?? 0)}`
      : target.file ? target.file.name
      : target.whiteboard ? t(dict, 'chat.whiteboardTitle')
      : '';
    return { name: target.sender, color: target.mine ? 'var(--accent)' : safeColor(target.color), text };
  }

  function jumpTo(id: string | undefined) {
    if (!id || !messageIndex.has(id)) return;
    const el = document.getElementById(`chat-msg-${id}`);
    if (!el) return;
    pinning = false;
    stickToBottom = false;
    el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    highlightedId = id;
    setTimeout(() => { if (highlightedId === id) highlightedId = ''; }, 1600);
  }

  async function handleSend() {
    if (!cryptoKey || !ws) return;
    const text = inputText.trim();
    if (!text) return;

    if (text.length > TEXT_AS_FILE_LIMIT) {
      const blob = new Blob([text], { type: 'text/plain' });
      const file = new File([blob], 'message.txt', { type: 'text/plain' });
      await sendFile(file);
      inputText = '';
      return;
    }

    await sendMessage();
  }

  function handleFileSelect(e: Event) {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    target.value = '';
    if (!file) return;
    void queueFile(file);
  }

  function pastedFileName(file: File): string {
    if (file.name && file.name !== 'image.png') return file.name;
    const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
    const stamp = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
    return `${stamp}.${ext}`;
  }

  function handlePaste(e: ClipboardEvent) {
    if (!cryptoKey || !connected || uploading) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, [contenteditable]') && !(target.classList.contains('chat-input-field') || target.id === 'chat-messagebar-input')) return;
    const file = Array.from(e.clipboardData?.files ?? [])[0];
    if (!file) return;
    e.preventDefault();
    void queueFile(new File([file], pastedFileName(file), { type: file.type }));
  }

  let dragDepth = 0;

  function draggingFiles(e: DragEvent): boolean {
    return Boolean(cryptoKey && connected && !uploading && e.dataTransfer?.types.includes('Files'));
  }

  function handleDragEnter(e: DragEvent) {
    if (!draggingFiles(e)) return;
    e.preventDefault();
    dragDepth++;
  }

  function handleDragOver(e: DragEvent) {
    if (!draggingFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }

  function handleDragLeave() {
    dragDepth = Math.max(0, dragDepth - 1);
  }

  async function handleDrop(e: DragEvent) {
    dragDepth = 0;
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (!files.length || !draggingFiles(e)) return;
    e.preventDefault();
    for (const file of files) await queueFile(file);
  }

  async function queueFile(file: File) {
    if (file.size > MAX_FILE) {
      fileError = t(dict, 'chat.fileTooLarge').replace('{max}', String(MAX_FILE / (1024 * 1024)));
      return;
    }
    await sendFile(file);
  }

  async function sendVoice(recording: VoiceRecording) {
    const file = new File([recording.blob], voiceFileName(recording.type, new Date()), { type: recording.type });
    if (file.size > MAX_FILE) {
      fileError = t(dict, 'chat.fileTooLarge').replace('{max}', String(MAX_FILE / (1024 * 1024)));
      return;
    }
    await sendFile(file, recording.seconds);
  }

  async function sendFile(file: File, voiceSeconds?: number, queueId?: string) {
    if (!cryptoKey || uploading) return;
    if (!queueId && (netOffline || !ws || ws.readyState !== 1)) {
      queueFileMessage(file, voiceSeconds);
      return;
    }
    if (!ws) return;
    uploading = true;
    fileError = '';
    uploadMeter.reset();
    uploadSnap = null;

    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      // Each file gets a random key that travels only inside the message, so it is exactly as protected as the message itself.
      const fileKey = arrayToB64url(crypto.getRandomValues(new Uint8Array(32)));
      const encrypted = await encryptData(buffer, fileKey, file.name);

      // First-party R2 upload first; Send is the fallback.
      const uploadUrls: string[] = [];
      const onProgress = (loaded: number, total: number) => {
        uploadSnap = uploadMeter.report(loaded, total);
      };

      async function tryHost(svc: string, body: Uint8Array, headers: Record<string, string> = {}): Promise<string | null> {
        try {
          uploadMeter.reset();
          if (svc === 'eclk') {
            const uploaded = await uploadFirstParty(body, dict, { onProgress });
            return uploaded?.url ?? null;
          }

          const res = await sendWithUploadPass('/api/ghost/upload', { method: 'POST', body, headers }, dict, onProgress);
          if (!res.ok) return null;
          const data = await res.json();
          return data?.results?.[0]?.url || null;
        } catch { return null; }
      }

      const firstPartyUrl = encrypted.length <= FIRST_PARTY_ENVELOPE_LIMIT ? await tryHost('eclk', encrypted) : null;
      if (firstPartyUrl) uploadUrls.push(firstPartyUrl);

      if (uploadUrls.length === 0 && encrypted.length <= SEND_ENVELOPE_LIMIT) try {
        const prepared = await prepareSendUpload(encrypted, 'ghost.bin', 'application/octet-stream');
        const sendUrl = await tryHost('nologsend', prepared.encryptedBytes, {
          'X-Send-Metadata': prepared.metadataB64,
          'X-Send-Auth': prepared.authHeader,
          'X-Send-Region': 'eu',
        });
        if (sendUrl) uploadUrls.push(`${sendUrl}#${prepared.secretB64}`);
      } catch {}

      if (uploadUrls.length === 0) {
        if (queueId) {
          fileOutbox = [...fileOutbox, { msgId: queueId, file, voiceSeconds }];
          messages = messages.map((m) => (m.id === queueId ? { ...m, pending: false, failed: true } : m));
        } else {
          fileError = t(dict, 'chat.fileUploadFailed');
        }
        return;
      }

      const once = onceEnabled;
      let fileTtl = roomConfig.mode === 'live' ? 0 : getRoomTtlSeconds();
      if (once) fileTtl = fileTtl > 0 ? Math.min(fileTtl, ONCE_TTL_SECONDS) : ONCE_TTL_SECONDS;
      const keep = !once && !fileTtl;
      const voiceMeta = voiceSeconds === undefined ? {} : { voice: true as const, duration: voiceSeconds };
      const msgId = queueId ?? genId();
      const createdAt = Date.now();
      const payload: ChatPayload = {
        type: 'chat-message',
        id: msgId,
        text: '',
        alias: aliasWire(alias), nick: nickname || undefined,
        ttl: fileTtl,
        createdAt,
        ...(once ? { once: true as const } : {}),
        file: { name: file.name, size: file.size, urls: uploadUrls, key: fileKey, ...voiceMeta },
      };

      let signed: string;
      try {
        const built = await buildContent(payload);
        signed = built.signed;
        if (!transmit(built.wire, msgId, createdAt)) throw new Error('send');
      } catch {
        if (queueId) {
          fileOutbox = [...fileOutbox, { msgId: queueId, file, voiceSeconds }];
          messages = messages.map((m) => (m.id === queueId ? { ...m, pending: false, failed: true } : m));
        } else {
          fileError = t(dict, 'chat.sendFailed');
        }
        return;
      }
      if (keep) void storeLocalSigned(msgId, signed, createdAt).catch(() => {});
      seenMessageIds.add(msgId);

      const ownMsg: Message = {
        id: msgId, text: '', sender: identity.name, initials: myInitials, alias, nick: nickname || undefined,
        color: identity.color, mine: true, time: createdAt,
        ttl: fileTtl, remaining: fileTtl,
        file: { name: file.name, size: file.size, urls: uploadUrls, key: fileKey, ...voiceMeta },
        once, revealed: true, pk: mySignerId, signed,
      };
      if (queueId) {
        messages = messages.map((m) => (m.id === queueId ? ownMsg : m));
        autoPreview(ownMsg);
      } else {
        messages = [...messages, ownMsg];
        onceEnabled = false;
        scrollToBottom(true);
        autoPreview(ownMsg);
      }
    } finally {
      uploading = false;
      uploadSnap = null;
      uploadMeter.reset();
    }
  }

  async function fetchChatFile(msg: Message): Promise<Uint8Array | null> {
    if (!msg.file || fileGone(msg)) return null;
    const { isSendUrl, decryptSendBlob, ghostFetch } = await import('../../lib/nologSend');
    for (const fileUrl of msg.file.urls) {
      try {
        const res = await ghostFetch(fileUrl);
        if (!res.ok) continue;
        let bytes = new Uint8Array(await res.arrayBuffer());
        if (isSendUrl(fileUrl)) bytes = await decryptSendBlob(bytes, fileUrl);
        return (await decryptData(bytes, msg.file.key)).data;
      } catch { continue; }
    }
    return null;
  }

  async function loadVoice(msg: Message): Promise<Blob | null> {
    const data = await fetchChatFile(msg);
    if (!data || !msg.file) return null;
    return new Blob([data as BlobPart], { type: voiceTypeOf(msg.file.name) });
  }

  async function downloadChatFile(msg: Message) {
    if (!msg.file) return;
    if (fileGone(msg)) {
      msg.fileError = true;
      messages = messages;
      return;
    }
    const { isSendUrl, decryptSendBlob, ghostFetch } = await import('../../lib/nologSend');

    for (const fileUrl of msg.file.urls) {
      try {
        const res = await ghostFetch(fileUrl);
        if (!res.ok) continue;
        let bytes = new Uint8Array(await res.arrayBuffer());

        if (isSendUrl(fileUrl)) {
          bytes = await decryptSendBlob(bytes, fileUrl);
        }

        const { data, name } = await decryptData(bytes, msg.file.key);
        const blob = new Blob([data], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = msg.file!.name || name;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
        return;
      } catch { continue; }
    }
    msg.fileError = true;
    messages = messages;
  }

  let typingSent = 0;
  async function handleTyping() {
    if (!ws || !connected || !cryptoKey) return;
    // No one to show the indicator to - skip the send, save a request.
    if (serverPresence <= 1) return;
    const now = Date.now();
    if (now - typingSent > 3000) {
      // Send typing indicator as encrypted message (no leaking to wrong-password users)
      const payload = await encryptMessage(cryptoKey, JSON.stringify({ type: 'typing', alias: aliasWire(alias), nick: nickname || undefined }));
      ws.send(JSON.stringify({ type: 'message', payload, id: genId() }));
      typingSent = now;
    }
  }

  function getCallVideoStream(track: MediaStreamTrack | null): MediaStream | null {
    if (!track) return null;
    if (localStream?.getVideoTracks().some((localTrack) => localTrack.id === track.id)) return localStream;
    return new MediaStream([track]);
  }

  function addCallTransceiver(pc: RTCPeerConnection, kind: 'audio' | 'video', track: MediaStreamTrack | null, stream: MediaStream | null): RTCRtpTransceiver | null {
    if (!pc.addTransceiver) return null;
    const init: RTCRtpTransceiverInit = {
      direction: track ? 'sendrecv' : 'recvonly',
    };
    if (track && stream) init.streams = [stream];

    try {
      return pc.addTransceiver(track ?? kind, init);
    } catch {
      return null;
    }
  }

  function setCallTransceiverDirection(transceiver: RTCRtpTransceiver | null, sending: boolean): boolean {
    if (!transceiver || transceiver.stopped) return false;
    const nextDirection: RTCRtpTransceiverDirection = sending ? 'sendrecv' : 'recvonly';
    if (transceiver.direction === nextDirection) return false;
    try {
      transceiver.direction = nextDirection;
      return true;
    } catch {
      return false;
    }
  }

  function ensureCallPeer(peerId: string, name: string, color: string, peerAlias?: Alias): CallPeer {
    let peer = callPeerMap.get(peerId);
    if (peer) {
      peer.name = name || peer.name;
      peer.color = color || peer.color;
      peer.alias = peerAlias ?? peer.alias;
      peer.initials = getInitials(peer.name);
      syncCallPeers();
      return peer;
    }

    const pc = new RTCPeerConnection({
      iceServers,
      iceTransportPolicy: 'relay',
      bundlePolicy: 'max-bundle',
      ...frameCrypto?.peerConfig(),
    });

    const audioTrack = getCurrentOutgoingAudioTrack();
    const videoTrack = getCurrentOutgoingVideoTrack();
    const addedAudio = addCallTransceiver(pc, 'audio', audioTrack, audioTrack ? localStream : null);
    const addedVideo = addCallTransceiver(pc, 'video', videoTrack, getCallVideoStream(videoTrack));
    frameCrypto?.secure(pc, peerId);
    const audioTransceiver = frameCrypto?.guard(addedAudio) ?? null;
    const videoTransceiver = frameCrypto?.guard(addedVideo) ?? null;

    peer = {
      id: peerId,
      name: name || t(dict, 'chat.guest'),
      initials: getInitials(name || t(dict, 'chat.guest')),
      alias: peerAlias,
      color: color || 'var(--accent)',
      pc,
      audioTransceiver,
      videoTransceiver,
      audioSender: audioTransceiver?.sender ?? null,
      videoSender: videoTransceiver?.sender ?? null,
      stream: null,
      state: pc.connectionState,
      iceState: pc.iceConnectionState,
      muted: false,
      cameraOff: false,
      screenSharing: false,
      makingOffer: false,
      restartAttempts: 0,
      lastRestartAt: 0,
      volume: 1,
      audioMuted: false,
      audioLevel: 0,
      speaking: false,
      keyTicket: 0,
    };
    const admission = mediaKeys?.admit();
    if (admission) peer.keyTicket = admission.ticket;
    callPeerMap.set(peerId, peer);
    if (admission?.rotate) scheduleMediaKeyRotation();
    callDebug('peer created', {
      peer: shortPeerId(peerId),
      connectionState: pc.connectionState,
      iceConnectionState: pc.iceConnectionState,
      iceServers: describeIceServersForDebug(iceServers),
    });

    pc.ontrack = (event) => {
      frameCrypto?.secure(pc, peerId);
      const current = callPeerMap.get(peerId);
      if (!current) return;
      const stream = current.stream ?? new MediaStream();
      const incomingTracks = event.streams[0]?.getTracks().length ? event.streams[0].getTracks() : [event.track];
      for (const track of incomingTracks) {
        if (!stream.getTracks().some((existing) => existing.id === track.id)) {
          stream.addTrack(track);
          if (track.kind === 'audio') {
            track.addEventListener('ended', () => {
              const latest = callPeerMap.get(peerId);
              if (!latest?.stream) return;
              latest.stream.removeTrack(track);
              startPeerAudioMonitor(latest);
              syncCallPeers();
            }, { once: true });
          }
        }
      }
      current.stream = stream;
      callDebug('peer track', {
        peer: shortPeerId(peerId),
        kind: event.track.kind,
        readyState: event.track.readyState,
        streamTracks: stream.getTracks().map((track) => track.kind),
      });
      startPeerAudioMonitor(current);
      syncCallPeers();
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      if (!isRelayCandidate(event.candidate)) return;
      callDebug('relay candidate out', {
        peer: shortPeerId(peerId),
        candidate: describeCandidateForDebug(event.candidate),
      });
      const candidate = event.candidate.toJSON();
      void sendCallSignal({
        action: 'ice',
        to: peerId,
        candidate: { ...candidate, candidate: withoutRelatedAddress(candidate.candidate ?? '') },
      });
    };

    pc.onconnectionstatechange = () => {
      const current = callPeerMap.get(peerId);
      if (!current) return;
      current.state = pc.connectionState;
      if (pc.connectionState === 'connected') void tunePeerSenders(current);
      callDebug('peer connection state', {
        peer: shortPeerId(peerId),
        connectionState: pc.connectionState,
        iceConnectionState: pc.iceConnectionState,
        signalingState: pc.signalingState,
      });
      syncCallPeers();
      void refreshRelayStats();
    };

    pc.oniceconnectionstatechange = () => {
      const current = callPeerMap.get(peerId);
      if (!current) return;
      current.iceState = pc.iceConnectionState;
      callDebug('peer ice state', {
        peer: shortPeerId(peerId),
        connectionState: pc.connectionState,
        iceConnectionState: pc.iceConnectionState,
        signalingState: pc.signalingState,
      });
      if (peerMediaConnected(pc)) {
        clearPeerRestart(current);
        current.restartAttempts = 0;
      } else if (pc.iceConnectionState === 'failed') {
        clearPeerRestart(current);
        schedulePeerRestart(peerId, 0);
      } else if (pc.iceConnectionState === 'disconnected') {
        schedulePeerRestart(peerId, isCallOfferer(peerId) ? ICE_DISCONNECT_GRACE_MS : ICE_DISCONNECT_GRACE_MS * 2);
      }
      syncCallPeers();
      void refreshRelayStats();
    };

    syncCallPeers();
    void refreshRelayStats();
    return peer;
  }

  function removeCallPeer(peerId: string) {
    frameCrypto?.dropPeer(peerId);
    mediaKeySenders.delete(peerId);
    mediaKeyRequestedAt.delete(peerId);
    mediaKeySharedAt.delete(peerId);
    const peer = callPeerMap.get(peerId);
    if (!peer) return;
    clearPeerRestart(peer);
    peer.pc.close();
    callPeerMap.delete(peerId);
    pendingIce.delete(peerId);
    stopPeerAudioMonitor(peerId);
    scheduleMediaKeyRotation();
    syncCallPeers();
    void refreshRelayStats();
  }

  async function flushPendingIce(peerId: string) {
    const peer = callPeerMap.get(peerId);
    const queue = pendingIce.get(peerId);
    if (!peer || !queue?.length || !peer.pc.remoteDescription) return;
    pendingIce.delete(peerId);
    callDebug('relay candidate queue flush', {
      peer: shortPeerId(peerId),
      count: queue.length,
    });
    for (const candidate of queue) {
      try { await peer.pc.addIceCandidate(candidate); } catch {}
    }
  }

  function waitForStableSignaling(pc: RTCPeerConnection, timeoutMs = 5000): Promise<boolean> {
    if (pc.signalingState === 'stable') return Promise.resolve(true);

    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        pc.removeEventListener('signalingstatechange', handleState);
        resolve(false);
      }, timeoutMs);

      function handleState() {
        if (pc.signalingState !== 'stable') return;
        window.clearTimeout(timeout);
        pc.removeEventListener('signalingstatechange', handleState);
        resolve(true);
      }

      pc.addEventListener('signalingstatechange', handleState);
    });
  }

  function isCallOfferer(peerId: string): boolean {
    return clientId < peerId;
  }

  function peerMediaConnected(pc: RTCPeerConnection): boolean {
    return pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed';
  }

  function clearPeerRestart(peer: CallPeer) {
    if (peer.restartTimer) clearTimeout(peer.restartTimer);
    peer.restartTimer = undefined;
  }

  function schedulePeerRestart(peerId: string, delayMs: number) {
    const peer = callPeerMap.get(peerId);
    if (!peer || peer.restartTimer) return;
    peer.restartTimer = setTimeout(() => {
      const current = callPeerMap.get(peerId);
      if (!current) return;
      current.restartTimer = undefined;
      if (!callActive || current.pc.connectionState === 'closed' || peerMediaConnected(current.pc)) return;
      void restartPeerIce(current);
    }, delayMs);
  }

  // TURN refuses to refresh an allocation once its credential has expired, so a running call moves every peer to
  // fresh credentials ahead of time; an ICE restart keeps media on the old path until the new one is ready.
  let rotatingCredentials = false;
  async function rotateCallCredentials() {
    if (rotatingCredentials) return;
    rotatingCredentials = true;
    try {
      const servers = await loadIceServers();
      if (!callActive || !servers.length) return;
      for (const peer of callPeerMap.values()) {
        peer.pc.setConfiguration({ ...peer.pc.getConfiguration(), iceServers: servers, ...frameCrypto?.peerConfig() });
        if (isCallOfferer(peer.id)) await createAndSendOffer(peer, false, true);
        else await sendCallSignal({ action: 'restart', to: peer.id });
      }
      callDebug('turn credentials rotated', { peers: callPeerMap.size });
    } catch {
    } finally {
      rotatingCredentials = false;
    }
  }

  async function applyFreshIceServers(peer: CallPeer) {
    try {
      const servers = await loadIceServers();
      if (callPeerMap.get(peer.id) !== peer || !servers.length) return;
      peer.pc.setConfiguration({ ...peer.pc.getConfiguration(), iceServers: servers, ...frameCrypto?.peerConfig() });
    } catch {}
  }

  async function restartPeerIce(peer: CallPeer) {
    const attempt = peer.restartAttempts++;
    callDebug('ice restart', {
      peer: shortPeerId(peer.id),
      attempt,
      offerer: isCallOfferer(peer.id),
      iceConnectionState: peer.pc.iceConnectionState,
      signalingState: peer.pc.signalingState,
    });
    schedulePeerRestart(peer.id, ICE_RESTART_RETRY_MS[Math.min(attempt, ICE_RESTART_RETRY_MS.length - 1)]);
    await applyFreshIceServers(peer);
    if (callPeerMap.get(peer.id) !== peer || !ws || ws.readyState !== 1) return;
    if (isCallOfferer(peer.id)) {
      await createAndSendOffer(peer, false, true);
    } else {
      await sendCallSignal({ action: 'restart', to: peer.id });
    }
  }

  function restartDisconnectedPeers() {
    if (!callActive) return;
    for (const peer of callPeerMap.values()) {
      if (peerMediaConnected(peer.pc) || peer.pc.iceConnectionState === 'new') continue;
      clearPeerRestart(peer);
      schedulePeerRestart(peer.id, 500);
    }
  }

  async function createAndSendOffer(peer: CallPeer, waitForStable = false, iceRestart = false) {
    if (peer.makingOffer) return;
    if (peer.pc.signalingState !== 'stable') {
      if (iceRestart && peer.pc.signalingState === 'have-local-offer') {
        await peer.pc.setLocalDescription({ type: 'rollback' } as RTCSessionDescriptionInit).catch(() => {});
      } else if (!waitForStable || !(await waitForStableSignaling(peer.pc))) return;
    }
    if (iceRestart) peer.lastRestartAt = Date.now();
    peer.makingOffer = true;
    try {
      frameCrypto?.secure(peer.pc, peer.id);
      const offer = await peer.pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
      await peer.pc.setLocalDescription(offer);
      const sdp = sanitizeRelayDescription(peer.pc.localDescription);
      if (!sdp) throw new Error(t(dict, 'chat.callConnectionFailed'));
      await sendCallSignal({
        action: 'offer',
        to: peer.id,
        sdp,
      });
    } catch (e: any) {
      if (!iceRestart) callError = e?.message || t(dict, 'chat.callConnectionFailed');
    } finally {
      peer.makingOffer = false;
      syncCallPeers();
    }
  }

  async function answerOffer(signal: CallSignal) {
    if (!signal.sdp) return;
    const remoteSdp = sanitizeRelayDescription(signal.sdp);
    if (!remoteSdp) return;
    const peer = ensureCallPeer(signal.from, senderInfo(signal).name, senderInfo(signal).color, senderInfo(signal).alias);
    notePeerMediaKeys(peer, signal);
    try {
      if (peer.pc.signalingState !== 'stable') {
        await peer.pc.setLocalDescription({ type: 'rollback' } as RTCSessionDescriptionInit).catch(() => {});
      }
      await peer.pc.setRemoteDescription(hideVoiceActivity(remoteSdp));
      frameCrypto?.secure(peer.pc, peer.id);
      await flushPendingIce(signal.from);
      await applyPeerOutgoingTracks(peer);
      if (peer.sharedKeyId !== mediaKeys?.latest?.id) await shareMediaKey(peer.id);
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      const sdp = sanitizeRelayDescription(peer.pc.localDescription);
      if (!sdp) throw new Error(t(dict, 'chat.callConnectionFailed'));
      await sendCallSignal({
        action: 'answer',
        to: signal.from,
        sdp,
      });
    } catch (e: any) {
      callError = e?.message || t(dict, 'chat.callConnectionFailed');
    }
  }

  async function handleAnswer(signal: CallSignal) {
    if (!signal.sdp) return;
    const remoteSdp = sanitizeRelayDescription(signal.sdp);
    if (!remoteSdp) return;
    const peer = callPeerMap.get(signal.from);
    if (!peer || peer.pc.signalingState !== 'have-local-offer') return;
    try {
      await peer.pc.setRemoteDescription(hideVoiceActivity(remoteSdp));
      frameCrypto?.secure(peer.pc, peer.id);
      await flushPendingIce(signal.from);
    } catch (e: any) {
      callError = e?.message || t(dict, 'chat.callConnectionFailed');
    }
  }

  async function handleIce(signal: CallSignal) {
    if (!isRelayCandidateInit(signal.candidate)) return;
    const peer = callPeerMap.get(signal.from);
    if (!peer || !peer.pc.remoteDescription) {
      const queue = pendingIce.get(signal.from) ?? [];
      if (queue.length >= MAX_PENDING_ICE_PER_PEER) return;
      queue.push(signal.candidate);
      pendingIce.set(signal.from, queue);
      callDebug('relay candidate queued', {
        peer: shortPeerId(signal.from),
        count: queue.length,
        sdpMid: signal.candidate.sdpMid || '',
        sdpMLineIndex: signal.candidate.sdpMLineIndex ?? null,
      });
      return;
    }
    try {
      await peer.pc.addIceCandidate(signal.candidate);
      callDebug('relay candidate added', {
        peer: shortPeerId(signal.from),
        sdpMid: signal.candidate.sdpMid || '',
        sdpMLineIndex: signal.candidate.sdpMLineIndex ?? null,
      });
    } catch (error) {
      callDebug('relay candidate add failed', {
        peer: shortPeerId(signal.from),
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  async function handleCallSignal(signal: CallSignal) {
    if (!signal || signal.from === clientId || signal.callId !== CALL_ID) return;
    if (signal.to && signal.to !== clientId) return;
    if (!isCallPublicKey(signal.pub)) return;
    callDebug('call signal in', {
      action: signal.action,
      from: shortPeerId(signal.from),
      toMe: signal.to === clientId,
      hasSdp: Boolean(signal.sdp),
      hasCandidate: Boolean(signal.candidate),
      audio: signal.audio,
      video: signal.video,
      screen: signal.screen,
    });

    const showActiveCallNotice = () => {
      if (callActive || callNoticeDismissed) return;
      activeCallNotice = {
        from: signal.from,
        name: senderInfo(signal).name,
        color: senderInfo(signal).color,
        alias: senderInfo(signal).alias,
      };
    };

    if (signal.action === 'presence') {
      noteCallParticipant(signal.from, senderInfo(signal).name, false);
      showActiveCallNotice();
      return;
    }

    if (signal.action === 'join') {
      noteCallParticipant(signal.from, senderInfo(signal).name, !signal.reply);
      if (!callActive) {
        showActiveCallNotice();
        return;
      }
      if (!callPeerMap.has(signal.from) && callPeerMap.size >= MAX_CALL_PEERS) return;

      const peer = ensureCallPeer(signal.from, senderInfo(signal).name, senderInfo(signal).color, senderInfo(signal).alias);
      notePeerMediaKeys(peer, signal);
      peer.muted = signal.audio === false;
      peer.cameraOff = signal.video === false;
      peer.screenSharing = signal.screen === true;
      syncCallPeers();

      if (!signal.reply && clientId > signal.from) {
        await sendCallSignal({ action: 'join', to: signal.from, reply: true });
      }
      await shareMediaKey(peer.id);
      if (clientId < signal.from) await createAndSendOffer(peer);
      return;
    }

    if (signal.action === 'leave') {
      if (callActive) removeCallPeer(signal.from);
      dropCallParticipant(signal.from);
      if (activeCallNotice?.from === signal.from) activeCallNotice = null;
      return;
    }

    if (!callActive) {
      if (signal.action === 'offer') showActiveCallNotice();
      return;
    }

    if (!callPeerMap.has(signal.from) && callPeerMap.size >= MAX_CALL_PEERS) return;

    const known = callPeerMap.get(signal.from);
    if (known && signal.action !== 'offer' && notePeerMediaKeys(known, signal)) void shareMediaKey(known.id);

    if (signal.action === 'media-key') {
      await acceptMediaKey(signal);
      return;
    }

    if (signal.action === 'media-key-request') {
      const now = Date.now();
      if (!known || now - (mediaKeySharedAt.get(signal.from) ?? 0) < MEDIA_KEY_REQUEST_MS / 2) return;
      mediaKeySharedAt.set(signal.from, now);
      await shareMediaKey(signal.from);
      return;
    }

    if (signal.action === 'offer') {
      await answerOffer(signal);
      return;
    }

    if (signal.action === 'answer') {
      await handleAnswer(signal);
      return;
    }

    if (signal.action === 'ice') {
      await handleIce(signal);
      return;
    }

    if (signal.action === 'restart') {
      const peer = callPeerMap.get(signal.from);
      if (!peer || !isCallOfferer(peer.id)) return;
      if (Date.now() - peer.lastRestartAt < ICE_RESTART_DEDUPE_MS) return;
      await applyFreshIceServers(peer);
      await createAndSendOffer(peer, false, true);
      return;
    }

    if (signal.action === 'media') {
      const peer = callPeerMap.get(signal.from);
      if (!peer) return;
      peer.muted = signal.audio === false;
      peer.cameraOff = signal.video === false;
      peer.screenSharing = signal.screen === true;
      syncCallPeers();
    }
  }

  function applyLocalMediaState() {
    if (!localStream) return;
    for (const track of localStream.getAudioTracks()) track.enabled = !micMuted;
    for (const track of localStream.getVideoTracks()) track.enabled = !cameraOff;
  }

  function getAudioConstraints(): MediaTrackConstraints {
    return {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      ...(selectedAudioInputId ? { deviceId: { exact: selectedAudioInputId } } : {}),
    };
  }

  function getVideoConstraints(): MediaTrackConstraints {
    return {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      facingMode: 'user',
      ...(selectedVideoInputId ? { deviceId: { exact: selectedVideoInputId } } : {}),
    };
  }

  async function refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      canSelectAudioOutput = supportsAudioOutputSelection();
      const devices = await navigator.mediaDevices.enumerateDevices();
      audioInputDevices = devices.filter((device) => device.kind === 'audioinput');
      videoInputDevices = devices.filter((device) => device.kind === 'videoinput');
      audioOutputDevices = canSelectAudioOutput ? devices.filter((device) => device.kind === 'audiooutput') : [];

      if (selectedAudioInputId && !audioInputDevices.some((device) => device.deviceId === selectedAudioInputId)) {
        selectedAudioInputId = '';
      }
      if (selectedVideoInputId && !videoInputDevices.some((device) => device.deviceId === selectedVideoInputId)) {
        selectedVideoInputId = '';
      }
      if (selectedAudioOutputId && !audioOutputDevices.some((device) => device.deviceId === selectedAudioOutputId)) {
        selectedAudioOutputId = '';
      }
    } catch {}
  }

  function ensureLocalStream(): MediaStream {
    if (!localStream) localStream = new MediaStream();
    return localStream;
  }

  function touchLocalStream() {
    localStream = localStream;
  }

  function processMicTrack(raw: MediaStreamTrack): MediaStreamTrack {
    const chain = buildMicChain(raw);
    if (!chain) return raw;
    micProcessing = { context: chain.context, raw };
    return chain.track;
  }

  function stopMicProcessing() {
    if (!micProcessing) return;
    micProcessing.raw.onended = null;
    if (micProcessing.raw.readyState !== 'ended') micProcessing.raw.stop();
    void micProcessing.context.close().catch(() => {});
    micProcessing = null;
  }

  function stopLocalTracks(kind: 'audio' | 'video') {
    if (!localStream) return;
    const tracks = kind === 'audio' ? localStream.getAudioTracks() : localStream.getVideoTracks();
    if (kind === 'audio') {
      stopLocalAudioMonitor();
      stopMicProcessing();
    }
    for (const track of tracks) {
      track.onended = null;
      localStream.removeTrack(track);
      if (track.readyState !== 'ended') track.stop();
    }
    touchLocalStream();
  }

  function getCurrentOutgoingAudioTrack(): MediaStreamTrack | null {
    if (micMuted) return null;
    return localStream?.getAudioTracks()[0] ?? null;
  }

  // A sender that cannot take the frame transform never gets a track, so no frame leaves unencrypted.
  function addSecuredTrack(peer: CallPeer, track: MediaStreamTrack, stream: MediaStream): RTCRtpSender | null {
    const sender = peer.pc.addTrack(track, stream);
    if (frameCrypto?.attachSender(sender, track.kind === 'video' ? 'video' : 'audio')) return sender;
    try { peer.pc.removeTrack(sender); } catch {}
    return null;
  }

  async function applyPeerOutgoingTracks(peer: CallPeer): Promise<boolean> {
    const audioTrack = getCurrentOutgoingAudioTrack();
    const videoTrack = getCurrentOutgoingVideoTrack();
    let needsOffer = false;

    needsOffer = setCallTransceiverDirection(peer.audioTransceiver, Boolean(audioTrack)) || needsOffer;
    if (peer.audioSender) {
      await peer.audioSender.replaceTrack(audioTrack);
    } else if (peer.audioTransceiver) {
      peer.audioSender = peer.audioTransceiver.sender;
      await peer.audioSender.replaceTrack(audioTrack);
    } else if (audioTrack && localStream) {
      peer.audioSender = addSecuredTrack(peer, audioTrack, localStream);
      needsOffer = Boolean(peer.audioSender) || needsOffer;
    }

    needsOffer = setCallTransceiverDirection(peer.videoTransceiver, Boolean(videoTrack)) || needsOffer;
    const videoStream = getCallVideoStream(videoTrack);
    if (peer.videoSender) {
      await peer.videoSender.replaceTrack(videoTrack);
    } else if (peer.videoTransceiver) {
      peer.videoSender = peer.videoTransceiver.sender;
      await peer.videoSender.replaceTrack(videoTrack);
    } else if (videoTrack && videoStream) {
      peer.videoSender = addSecuredTrack(peer, videoTrack, videoStream);
      needsOffer = Boolean(peer.videoSender) || needsOffer;
    }

    return needsOffer;
  }

  async function setOutgoingAudioTrack(track: MediaStreamTrack | null) {
    const renegotiations: Promise<void>[] = [];
    const stream = track ? ensureLocalStream() : localStream;

    for (const peer of callPeerMap.values()) {
      const needsOffer = setCallTransceiverDirection(peer.audioTransceiver, Boolean(track));

      if (peer.audioSender) {
        await peer.audioSender.replaceTrack(track);
      } else if (peer.audioTransceiver) {
        peer.audioSender = peer.audioTransceiver.sender;
        await peer.audioSender.replaceTrack(track);
      } else if (track && stream) {
        peer.audioSender = addSecuredTrack(peer, track, stream);
        if (peer.audioSender) renegotiations.push(createAndSendOffer(peer, true));
      }

      if (needsOffer) renegotiations.push(createAndSendOffer(peer, true));
    }

    await Promise.all(renegotiations);
    await Promise.all([...callPeerMap.values()].map(tunePeerSenders));
  }

  async function setOutgoingVideoTrack(track: MediaStreamTrack | null) {
    const renegotiations: Promise<void>[] = [];
    const stream = getCallVideoStream(track);

    for (const peer of callPeerMap.values()) {
      const needsOffer = setCallTransceiverDirection(peer.videoTransceiver, Boolean(track));

      if (peer.videoSender) {
        await peer.videoSender.replaceTrack(track);
      } else if (peer.videoTransceiver) {
        peer.videoSender = peer.videoTransceiver.sender;
        await peer.videoSender.replaceTrack(track);
      } else if (track && stream) {
        peer.videoSender = addSecuredTrack(peer, track, stream);
        if (peer.videoSender) renegotiations.push(createAndSendOffer(peer, true));
      }

      if (needsOffer) renegotiations.push(createAndSendOffer(peer, true));
    }

    await Promise.all(renegotiations);
    await Promise.all([...callPeerMap.values()].map(tunePeerSenders));
  }

  async function tuneSender(sender: RTCRtpSender | null, kind: 'audio' | 'video') {
    if (!sender?.track) return;
    try {
      const params = sender.getParameters();
      if (!params.encodings?.length) return;
      const screen = kind === 'video' && sender.track === screenTrack;
      for (const encoding of params.encodings) {
        encoding.priority = kind === 'audio' ? 'high' : 'low';
        encoding.networkPriority = kind === 'audio' ? 'high' : 'low';
        if (kind === 'video') {
          encoding.maxBitrate = screen ? SCREEN_MAX_BITRATE : CAMERA_MAX_BITRATE;
          if (screen) encoding.maxFramerate = 15;
        }
      }
      if (kind === 'video') {
        (params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference = screen ? 'maintain-resolution' : 'balanced';
      }
      await sender.setParameters(params);
    } catch {}
  }

  async function tunePeerSenders(peer: CallPeer) {
    await tuneSender(peer.audioSender, 'audio');
    await tuneSender(peer.videoSender, 'video');
  }

  function getCurrentOutgoingVideoTrack(): MediaStreamTrack | null {
    if (screenTrack) return screenTrack;
    if (cameraOff) return null;
    return localStream?.getVideoTracks()[0] ?? null;
  }

  async function syncOutgoingVideoTrack() {
    await setOutgoingVideoTrack(getCurrentOutgoingVideoTrack());
  }

  async function startCall() {
    if (callActive || callJoining || !connected || !verified) return;
    if (typeof RTCPeerConnection === 'undefined') {
      callError = t(dict, 'chat.callUnsupported');
      return;
    }
    const transformMode = frameTransformMode();
    if (!transformMode) {
      callError = t(dict, 'chat.callE2eeUnsupported');
      return;
    }

    callJoining = true;
    callError = '';
    activeCallNotice = null;
    callNoticeDismissed = false;
    callSettingsOpen = false;
    callDebug('call start requested', {
      connected,
      verified,
      serverLatencyMs,
      serverQuality,
    });

    try {
      await loadIceServers(true);
      try {
        callKeyPair = await createCallKeyPair();
        callKem = createKemKeyPair();
        frameCrypto = new CallFrameEncryption(transformMode, { onMissingKey: requestMediaKey, onError: failCallEncryption });
      } catch {
        throw new Error(t(dict, 'chat.callE2eeFailed'));
      }
      mediaKeys = new MediaKeySchedule((key) => frameCrypto?.setSendKey(key));
      mediaKeys.start();
      localStream = new MediaStream();
      micMuted = true;
      cameraOff = true;
      callAudioMuted = false;
      callActive = true;
      updateRelayQuality();
      startRelayStatsMonitor();
      await refreshDevices();
      callDebug('call started', {
        frameTransform: transformMode,
        audioInputs: audioInputDevices.length,
        videoInputs: videoInputDevices.length,
        audioOutputs: audioOutputDevices.length,
      });
      await sendCallSignal({ action: 'join', reply: false });
      noteCallParticipant(clientId, identity.name, true);
    } catch (e: any) {
      callError = e?.message || t(dict, 'chat.callStartFailed');
      callDebug('call start failed', { error: callError });
      cleanupCall(false);
    } finally {
      callJoining = false;
    }
  }

  async function joinActiveCall() {
    activeCallNotice = null;
    callNoticeDismissed = false;
    await startCall();
  }

  function cleanupCall(clearError = true) {
    callDebug('call cleanup', {
      clearError,
      peers: callPeerMap.size,
      active: callActive,
      relayConnected,
      relayRttMs,
    });
    closeCallFullscreen(false);
    if (callParticipants.has(clientId)) {
      for (const id of [...callParticipants]) if (id !== clientId && !callPeerMap.has(id)) callParticipants.delete(id);
      dropCallParticipant(clientId);
    }
    for (const peer of callPeerMap.values()) {
      clearPeerRestart(peer);
      peer.pc.close();
    }
    callPeerMap.clear();
    pendingIce.clear();
    clearTimeout(mediaKeyRotateTimer);
    mediaKeyRotateTimer = undefined;
    mediaKeys?.wipe();
    mediaKeys = null;
    frameCrypto?.close();
    frameCrypto = null;
    callKeyPair = null;
    callKem?.secretKey.fill(0);
    callKem = null;
    mediaKeySenders.clear();
    mediaKeyRequestedAt.clear();
    mediaKeySharedAt.clear();
    callPeers = [];
    stopAllAudioMonitors();
    stopRelayStatsMonitor();
    if (localStream) {
      for (const track of localStream.getTracks()) track.stop();
    }
    stopMicProcessing();
    if (screenTrack) {
      screenTrack.onended = null;
      screenTrack.stop();
    }
    localStream = null;
    screenTrack = null;
    callActive = false;
    callJoining = false;
    activeCallNotice = null;
    callNoticeDismissed = false;
    micMuted = true;
    cameraOff = true;
    screenSharing = false;
    callAudioMuted = false;
    callSettingsOpen = false;
    updateRelayQuality();
    if (clearError) callError = '';
  }

  async function endCall(notify = true) {
    const shouldNotify = notify && callActive;
    callDebug('call end requested', { notify, shouldNotify });
    if (shouldNotify) await sendCallSignal({ action: 'leave' }).catch(() => {});
    cleanupCall();
  }

  async function toggleMic() {
    await setMicMuted(!micMuted);
  }

  async function setMicMuted(nextMuted: boolean) {
    if (!callActive || callJoining) return;

    if (nextMuted) {
      micMuted = true;
      stopLocalTracks('audio');
      await setOutgoingAudioTrack(null);
      await sendCallSignal({ action: 'media' });
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      callError = t(dict, 'chat.callUnsupported');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: getAudioConstraints(), video: false });
      const raw = stream.getAudioTracks()[0];
      if (!raw) throw new Error(t(dict, 'chat.callMicrophoneStartFailed'));

      stopLocalTracks('audio');
      const track = processMicTrack(raw);
      ensureLocalStream().addTrack(track);
      touchLocalStream();
      micMuted = false;
      callError = '';

      const deviceId = raw.getSettings().deviceId;
      if (deviceId) selectedAudioInputId = deviceId;
      raw.onended = () => {
        micMuted = true;
        stopLocalTracks('audio');
        void setOutgoingAudioTrack(null).then(() => sendCallSignal({ action: 'media' }));
      };

      applyLocalMediaState();
      startLocalAudioMonitor();
      await refreshDevices();
      await setOutgoingAudioTrack(track);
      await sendCallSignal({ action: 'media' });
    } catch (e: any) {
      micMuted = true;
      callError = e?.name === 'NotAllowedError'
        ? t(dict, 'chat.callMicrophonePermissionDenied')
        : (e?.message || t(dict, 'chat.callMicrophoneStartFailed'));
    }
  }

  async function handleAudioInputChange() {
    if (!micMuted) await setMicMuted(false);
  }

  async function handleVideoInputChange() {
    if (!cameraOff) await setCameraOff(false);
  }

  async function toggleCamera() {
    await setCameraOff(!cameraOff);
  }

  async function setCameraOff(nextOff: boolean) {
    if (!callActive || callJoining) return;

    if (nextOff) {
      cameraOff = true;
      stopLocalTracks('video');
      if (!screenSharing) await syncOutgoingVideoTrack();
      await sendCallSignal({ action: 'media' });
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      callError = t(dict, 'chat.callUnsupported');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: getVideoConstraints() });
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error(t(dict, 'chat.callCameraStartFailed'));

      stopLocalTracks('video');
      ensureLocalStream().addTrack(track);
      touchLocalStream();
      cameraOff = false;
      callError = '';

      const deviceId = track.getSettings().deviceId;
      if (deviceId) selectedVideoInputId = deviceId;
      track.onended = () => {
        cameraOff = true;
        void syncOutgoingVideoTrack().then(() => sendCallSignal({ action: 'media' }));
      };

      applyLocalMediaState();
      await refreshDevices();
      if (!screenSharing) await syncOutgoingVideoTrack();
      await sendCallSignal({ action: 'media' });
    } catch (e: any) {
      cameraOff = true;
      callError = e?.name === 'NotAllowedError'
        ? t(dict, 'chat.callCameraPermissionDenied')
        : (e?.message || t(dict, 'chat.callCameraStartFailed'));
    }
  }

  async function setCallAudioMuted(nextMuted: boolean) {
    callAudioMuted = nextMuted;
  }

  function setBlurWhenAway(nextBlur: boolean) {
    blurWhenAway = nextBlur;
    try { localStorage.setItem(BLUR_WHEN_AWAY_STORAGE_KEY, nextBlur ? '1' : '0'); } catch {}
  }

  async function setCallVolume(value: number | string) {
    const next = Number(value);
    if (!Number.isFinite(next)) return;
    callVolume = Math.max(0, Math.min(1, next));
    if (callVolume > 0 && callAudioMuted) callAudioMuted = false;
  }

  function setPeerVolume(peerId: string, value: number | string) {
    const peer = callPeerMap.get(peerId);
    const next = Number(value);
    if (!peer || !Number.isFinite(next)) return;
    peer.volume = Math.max(0, Math.min(1, next));
    if (peer.volume > 0 && peer.audioMuted) peer.audioMuted = false;
    syncCallPeers();
  }

  function setPeerAudioMuted(peerId: string, nextMuted: boolean) {
    const peer = callPeerMap.get(peerId);
    if (!peer) return;
    peer.audioMuted = nextMuted;
    syncCallPeers();
  }

  function handleAudioOutputChange() {
    resumeVisibleCallMedia();
  }

  async function refreshCallDevices() {
    await refreshDevices();
  }

  async function startScreenShare() {
    if (!callActive || callJoining) return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      callError = t(dict, 'chat.callScreenUnsupported');
      return;
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 30 } },
        audio: false,
      });
      const track = displayStream.getVideoTracks()[0];
      if (!track) throw new Error(t(dict, 'chat.callScreenStartFailed'));

      if (screenTrack) await stopScreenShare(false);

      if ('contentHint' in track) track.contentHint = 'detail';
      screenTrack = track;
      screenSharing = true;
      callError = '';

      track.onended = () => {
        void stopScreenShare();
      };

      await syncOutgoingVideoTrack();
      await sendCallSignal({ action: 'media' });
    } catch (e: any) {
      screenSharing = false;
      screenTrack = null;
      callError = e?.name === 'NotAllowedError'
        ? t(dict, 'chat.callScreenPermissionDenied')
        : (e?.message || t(dict, 'chat.callScreenStartFailed'));
    }
  }

  async function stopScreenShare(notify = true) {
    const track = screenTrack;
    if (!track && !screenSharing) return;

    screenSharing = false;
    screenTrack = null;

    if (track) {
      track.onended = null;
      if (track.readyState !== 'ended') track.stop();
    }

    await syncOutgoingVideoTrack();

    if (notify) await sendCallSignal({ action: 'media' });
  }

  function getCallFullscreenMedia(target: CallFullscreenTarget | null): CallFullscreenMedia | null {
    if (!target) return null;

    if (target.source === 'local') {
      if (!localDisplayStream || !localHasVisibleVideo) return null;
      return {
        name: screenSharing ? t(dict, 'chat.callScreenSharing') : t(dict, 'chat.callYou'),
        stream: localDisplayStream,
        isScreen: screenSharing,
      };
    }

    const peer = target.peerId ? callPeerMap.get(target.peerId) : null;
    if (!peer?.stream || !peer.stream.getVideoTracks().length || (!peer.screenSharing && peer.cameraOff)) return null;
    return {
      name: peer.name,
      stream: peer.stream,
      isScreen: peer.screenSharing,
    };
  }

  function getNativeFullscreenElement(): Element | null {
    if (typeof document === 'undefined') return null;
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
    };
    return document.fullscreenElement || doc.webkitFullscreenElement || null;
  }

  async function requestNativeFullscreen(node: HTMLElement) {
    const fullscreenNode = node as HTMLElement & {
      webkitRequestFullscreen?: () => void;
    };

    try {
      if (node.requestFullscreen) {
        await node.requestFullscreen({ navigationUI: 'hide' } as FullscreenOptions);
        callFullscreenNativeActive = true;
        return;
      }
      if (fullscreenNode.webkitRequestFullscreen) {
        fullscreenNode.webkitRequestFullscreen();
        callFullscreenNativeActive = true;
      }
    } catch {
      callFullscreenNativeActive = false;
    }
  }

  async function exitNativeFullscreen() {
    if (typeof document === 'undefined') return;
    const doc = document as Document & {
      webkitExitFullscreen?: () => void;
    };

    try {
      if (document.exitFullscreen && document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (doc.webkitExitFullscreen && doc.webkitFullscreenElement) {
        doc.webkitExitFullscreen();
      }
    } catch {}
  }

  function openCallFullscreen(target: CallFullscreenTarget) {
    callFullscreenTarget = target;
    requestAnimationFrame(() => {
      callFullscreenOverlayEl?.focus();
      if (callFullscreenOverlayEl) void requestNativeFullscreen(callFullscreenOverlayEl);
    });
  }

  function closeCallFullscreen(exitNative = true) {
    const shouldExitNative = exitNative && callFullscreenNativeActive && Boolean(getNativeFullscreenElement());
    callFullscreenTarget = null;
    callFullscreenMedia = null;
    callFullscreenNativeActive = false;
    if (shouldExitNative) void exitNativeFullscreen();
  }

  function handleCallFullscreenKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && composerMenuOpen) {
      composerMenuOpen = false;
      return;
    }
    if (event.key === 'Escape' && callFullscreenTarget) closeCallFullscreen();
  }

  function handleNativeFullscreenChange() {
    if (!callFullscreenNativeActive || getNativeFullscreenElement()) return;
    callFullscreenNativeActive = false;
    if (callFullscreenTarget) closeCallFullscreen(false);
  }

  function handleVisibility() {
    if (typeof document === 'undefined') return;
    if (isIosDevice()) {
      if (document.hidden) { if (!callActive) try { ws?.close(1000, 'hidden'); } catch {} }
      else { try { ws?.reconnect(); } catch {} }
    }
    blurred = document.hidden || !document.hasFocus();
    if (callActive && !document.hidden) void holdCallWakeLock(true);
    if (!blurred) {
      clearUnread();
      sendServerPing();
      scrollToBottom();
    }
  }

  const IMAGE_EXTS = new Set(['png','jpg','jpeg','gif','webp','bmp','ico']);
  const TEXT_EXTS = new Set(['txt','md','json','csv','log','xml','yaml','yml','toml','ini','env','cfg','conf','html','css','js','ts','py','sh','sql','go','rs','c','h','cpp','java','rb','php','swift','kt']);
  const PREVIEW_TEXT_LIMIT = 500;

  function getFileExt(name: string): string {
    return name.split('.').pop()?.toLowerCase() ?? '';
  }

  async function autoPreview(msg: Message) {
    if (!msg.file) return;
    const ext = getFileExt(msg.file.name);

    if (!IMAGE_EXTS.has(ext) && !TEXT_EXTS.has(ext)) return;

    const { isSendUrl, decryptSendBlob, ghostFetch } = await import('../../lib/nologSend');

    for (const fileUrl of msg.file.urls) {
      try {
        const res = await ghostFetch(fileUrl);
        if (!res.ok) continue;
        let bytes = new Uint8Array(await res.arrayBuffer());
        if (isSendUrl(fileUrl)) bytes = await decryptSendBlob(bytes, fileUrl);
        const { data } = await decryptData(bytes, msg.file.key);

        if (IMAGE_EXTS.has(ext)) {
          const mimeMap: Record<string, string> = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', bmp:'image/bmp', ico:'image/x-icon' };
          const blob = new Blob([data], { type: mimeMap[ext] || 'image/png' });
          msg.preview = { type: 'image', url: URL.createObjectURL(blob) };
        } else {
          const text = new TextDecoder().decode(data);
          msg.preview = { type: 'text', text, expanded: false };
        }
        messages = messages;
        return;
      } catch { continue; }
    }
  }

  // A person counts as present while any of their connections is, so a reconnect or a second tab never counts twice.
  // A departure waits briefly: coming straight back, as a phone does after the app was in the background, announces nothing.
  // Of the people still here, the one with the lowest key signs the notice, so it exists once and reaches everyone alike.
  const LEAVE_GRACE_MS = 8000;
  const liveClients = new Map<string, Set<string>>();
  const leaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function clientArrived(signer: string, clientId: unknown) {
    if (typeof clientId !== 'string' || !clientId) return;
    const set = liveClients.get(signer) ?? new Set<string>();
    set.add(clientId);
    liveClients.set(signer, set);
    const pending = leaveTimers.get(signer);
    if (pending) {
      clearTimeout(pending);
      leaveTimers.delete(signer);
    }
  }

  function clientDeparted(clientId: string) {
    const signer = clientSigners.get(clientId);
    const set = signer ? liveClients.get(signer) : undefined;
    if (!signer || !set || !set.delete(clientId) || set.size) return;
    const name = members.get(signer)?.name ?? '';
    clearTimeout(leaveTimers.get(signer));
    leaveTimers.set(signer, setTimeout(() => {
      leaveTimers.delete(signer);
      if (liveClients.get(signer)?.size) return;
      liveClients.delete(signer);
      const present = [...liveClients.keys(), mySignerId].filter(Boolean).sort();
      if (name && present[0] === mySignerId) void sendMemberEvent('left', { name });
    }, LEAVE_GRACE_MS));
  }

  function memberEventText(parsed: any, name: string): string {
    if (parsed.kind === 'renamed') return t(dict, 'chat.renamed').replace('{from}', parsed.from).replace('{to}', parsed.to);
    if (parsed.kind === 'left') return t(dict, 'chat.leftRoom').replace('{name}', parsed.name);
    return t(dict, 'chat.joinedRoom').replace('{name}', name);
  }

  function applyMemberEvent(id: string, parsed: any, signer: string, name: string, signed?: string) {
    if (messages.some((m) => m.id === id)) return;
    const msg: Message = {
      id, text: memberEventText(parsed, name), sender: '', initials: parsed.kind === 'left' ? '←' : '→', color: 'var(--accent)',
      mine: false, time: parsed.createdAt || parsed._sentAt || Date.now(), ttl: 0, remaining: 0, pk: signer,
      ...(signed ? { signed } : {}),
    };
    messages = [...messages, msg].sort((x, y) => x.time - y.time);
  }

  async function sendMemberEvent(kind: 'joined' | 'left' | 'renamed', extra: { name?: string; from?: string; to?: string } = {}): Promise<boolean> {
    if (!verified || !cryptoKey || (roomConfig.mode === 'live' && !fsSession)) return false;
    const ttl = roomConfig.mode === 'live' ? 0 : getRoomTtlSeconds();
    const id = genId();
    const createdAt = Date.now();
    const payload: ChatPayload = { type: 'member-event', id, kind, ...extra, alias: aliasWire(alias), nick: nickname || undefined, ttl, createdAt };
    try {
      const { signed } = await sendContent(payload, createdAt);
      seenMessageIds.add(id);
      applyMemberEvent(id, JSON.parse(signed), mySignerId, identity.name, signed);
      followIncoming(true);
      if (!ttl) void storeLocalSigned(id, signed, createdAt).catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  // Everyone gets one notice when a person arrives, not one per reconnect: skip it if this browser announced itself just now.
  let joinAnnounced = false;
  $: if (verified && !joinAnnounced && (roomConfig.mode !== 'live' || fsSession)) {
    joinAnnounced = true;
    void announceJoin();
  }

  async function announceJoin() {
    const key = 'encrypt:joined:' + roomId;
    try {
      if (Date.now() - Number(localStorage.getItem(key) || 0) < 5 * 60_000) return;
    } catch {}
    if (await sendMemberEvent('joined')) {
      try { localStorage.setItem(key, String(Date.now())); } catch {}
    } else {
      setTimeout(() => { joinAnnounced = false; }, 3000);
    }
  }

  function addSystemMessage(text: string, ttl: number, initials = '→', color = 'var(--accent)') {
    messages = [...messages, { id: genId(), text, sender: '', initials, color, mine: false, time: Date.now(), ttl, remaining: ttl }];
    followIncoming(false);
  }

  // The first key a name shows up with is trusted on sight; later keys under the same name are flagged until accepted.
  const clientSigners = new Map<string, string>();

  // The relay tags each connection in rooms without server history, so a departure names the member who left.
  const connClients = new Map<string, string>();
  const clientConns = new Map<string, string>();

  function noteConnection(tag: string, id: string) {
    const previous = clientConns.get(id);
    if (previous === tag) return;
    if (previous) connClients.delete(previous);
    if (connClients.size >= 256) {
      const [oldest, client] = connClients.entries().next().value as [string, string];
      connClients.delete(oldest);
      if (clientConns.get(client) === oldest) clientConns.delete(client);
    }
    connClients.set(tag, id);
    clientConns.set(id, tag);
  }

  function departedClient(tag: string): string | undefined {
    const id = connClients.get(tag);
    connClients.delete(tag);
    if (!id || clientConns.get(id) !== tag) return undefined;
    clientConns.delete(id);
    return id;
  }

  function bindClient(id: unknown, signer: string): boolean {
    if (typeof id !== 'string' || !id) return false;
    const bound = clientSigners.get(id);
    if (bound) return bound === signer;
    clientSigners.set(id, signer);
    return true;
  }

  // Folds case, accents, spacing and the usual l/I/1, o/0 swaps so a near-identical name cannot borrow someone's trust.
  function lookalike(name: string): string {
    return name.normalize('NFKD').replace(/[̀-ͯ\s._-]/g, '').toLowerCase()
      .replace(/[i1|]/g, 'l').replace(/0/g, 'o').replace(/5/g, 's').replace(/rn/g, 'm');
  }

  function noteMember(pk: string, who: { key: string; name: string; initials: string; color: string; alias?: Alias; nick?: string }): boolean {
    if (!trustTable[who.key]?.length) {
      const folded = lookalike(who.name);
      const clash = [...members.values()].some((m) => m.trusted && m.pk !== pk && m.key !== who.key && lookalike(m.name) === folded)
        || (mySignerId !== '' && pk !== mySignerId && who.key !== myLabelKey() && lookalike(identity.name) === folded);
      if (clash) return recordMember(pk, who, false);
      trustTable[who.key] = [pk];
      saveTrustTable(trustRoom, trustTable);
    }
    return recordMember(pk, who, trustTable[who.key].includes(pk));
  }

  function recordMember(pk: string, who: { key: string; name: string; initials: string; color: string; alias?: Alias; nick?: string }, trusted: boolean): boolean {
    const member = members.get(pk);
    if (member) {
      const renamed = member.key !== who.key || member.name !== who.name || member.color !== who.color;
      if (member.trusted !== trusted || renamed) {
        Object.assign(member, { trusted, key: who.key, name: who.name, initials: who.initials, color: who.color, alias: who.alias });
        memberList = [...members.values()];
      }
    } else {
      const fresh: Member = { pk, key: who.key, name: who.name, initials: who.initials, color: who.color, alias: who.alias, trusted, safety: '', code: '' };
      members.set(pk, fresh);
      memberList = [...members.values()];
      void Promise.all([mySignerId ? safetyNumber(mySignerId, pk) : Promise.resolve(''), keyCode(pk)]).then(([safety, code]) => {
        fresh.safety = safety;
        fresh.code = code;
        memberList = [...members.values()];
        maybeOfferSafetyCompare(fresh);
      });
    }
    return trusted;
  }

  function maybeOfferSafetyCompare(member: Member) {
    if (!verified || !member.safety || member.trusted) return;
    if (safetyPromptSeen.has(member.pk) || safetyPrompt) return;
    safetyPromptSeen.add(member.pk);
    safetyPrompt = member;
  }

  function offerPendingSafetyCompares() {
    for (const member of members.values()) maybeOfferSafetyCompare(member);
  }

  function dismissSafetyPrompt() {
    safetyPrompt = null;
    offerPendingSafetyCompares();
  }

  function appProfileToggle() {
    if (appProfileOpen) { appProfileOpen = false; return; }
    nickInput = nickname || '';
    previewAlias = alias;
    nickError = '';
    appProfileOpen = true;
    void settled().then(() => {
      const el = appProfileFormEl;
      let scroller = el?.parentElement ?? null;
      while (scroller && scroller !== document.body && scroller.scrollHeight <= scroller.clientHeight + 8) scroller = scroller.parentElement;
      if (el && scroller && scroller !== document.body) {
        const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
        scroller.scrollTo({ top: Math.max(0, top - 24), behavior: 'smooth' });
      }
      el?.querySelector('input')?.focus();
    });
  }

  function toggleProfile() {
    if (profileOpen) {
      profileOpen = false;
      return;
    }
    nickInput = nickname || '';
    previewAlias = alias;
    nickError = '';
    profileOpen = true;
    membersOpen = false;
    burnConfirmMsg = null;
    headerMenuOpen = false;
    requestAnimationFrame(() => document.getElementById('chat-nickname')?.focus());
  }

  function closeHeaderMenu() {
    headerMenuOpen = false;
  }

  function closeProfileOnOutside(event: PointerEvent) {
    if (!profileOpen || !profileEl || profileEl.contains(event.target as Node)) return;
    profileOpen = false;
  }

  function closeHeaderMenuOnOutside(event: PointerEvent) {
    const target = event.target as Element | null;
    if (!headerMenuOpen || target?.closest?.('[data-chat-menu], .k-popover')) return;
    headerMenuOpen = false;
  }

  function closeProfileOnEscape(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !profileOpen) return;
    profileOpen = false;
    profileEl?.querySelector<HTMLElement>('button')?.focus();
  }

  function closeHeaderMenuOnEscape(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !headerMenuOpen) return;
    headerMenuOpen = false;
    document.getElementById('chat-room-menu-trigger')?.focus();
  }

  async function applyProfile() {
    const next = nickInput.trim();
    if (next && !NICKNAME_RE.test(next)) {
      nickError = t(dict, 'chat.nicknameInvalid');
      return;
    }
    nickError = '';
    profileOpen = false;
    appProfileOpen = false;
    const avatarChanged = aliasKey(previewAlias) !== aliasKey(alias);
    if ((next || null) === nickname && !avatarChanged) return;
    const prev = myLabelKey();
    const oldName = identity.name;
    alias = previewAlias;
    nickname = next || null;
    saveNickname(roomId, nickname);
    saveAlias(roomId, alias);
    identity = { name: nickname || aliasName(dict, alias), color: aliasColor(alias) };
    if (mySignerId) {
      const mine = myLabelKey();
      if (!trustTable[mine]?.includes(mySignerId)) {
        trustTable[mine] = [...(trustTable[mine] || []), mySignerId];
        saveTrustTable(trustRoom, trustTable);
      }
      const who = { key: mine, name: identity.name, initials: getInitials(identity.name), color: identity.color, alias, nick: nickname || undefined };
      noteMember(mySignerId, who);
    }
    if (!verified) return;
    await sendEncryptedControl({ type: 'rename', alias: aliasWire(alias), nick: nickname || undefined, prev });
    if (identity.name !== oldName) void sendMemberEvent('renamed', { from: oldName, to: identity.name });
  }

  function fileGone(msg: Message): boolean {
    return Boolean(msg.fileError) || clock - msg.time > FILE_LIFETIME_MS;
  }

  function fileTimeLeft(msg: Message): string {
    const left = Math.max(0, FILE_LIFETIME_MS - (clock - msg.time));
    const hours = Math.floor(left / 3_600_000);
    if (hours >= 1) return t(dict, 'chat.fileExpiresInHours').replace('{n}', String(hours));
    return t(dict, 'chat.fileExpiresInMinutes').replace('{n}', String(Math.max(1, Math.ceil(left / 60_000))));
  }

  function formatCallDuration(ms: number): string {
    const total = Math.max(0, Math.round(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const seconds = String(total % 60).padStart(2, '0');
    return hours ? `${hours}:${minutes}:${seconds}` : `${Number(minutes)}:${seconds}`;
  }

  // A join, or our own start, pins the moment a call began; a presence from a call already running only says that one exists.
  function noteCallParticipant(id: string, name: string, started: boolean) {
    if (!callStartedAt) {
      callStartedAt = Date.now();
      callStartKnown = started;
      if (started) addSystemMessage(t(dict, 'chat.callStartedBy').replace('{name}', name), 0);
    }
    callParticipants.add(id);
  }

  function dropCallParticipant(id: string) {
    if (!callParticipants.delete(id) || callParticipants.size || !callStartedAt) return;
    const text = callStartKnown
      ? t(dict, 'chat.callEndedAfter').replace('{duration}', formatCallDuration(Date.now() - callStartedAt))
      : t(dict, 'chat.callEnded');
    callStartedAt = 0;
    callStartKnown = false;
    addSystemMessage(text, 0, '←');
  }

  function trustKey(pk: string) {
    const member = members.get(pk);
    if (!member) return;
    trustTable[member.key] = [...(trustTable[member.key] || []), pk];
    saveTrustTable(trustRoom, trustTable);
    member.trusted = true;
    memberList = [...members.values()];
    messages = messages.map((msg) => msg.pk === pk ? { ...msg, keyWarning: false } : msg);
    if (safetyPrompt?.pk === pk) dismissSafetyPrompt();
  }

  // Only what this tab has already decrypted: no server fetch and no attachment ciphertext or keys.
  function exportHistory() {
    if (!shouldKeepParticipantHistory()) return;
    if (messages.length === 0) {
      fileError = t(dict, 'chat.exportEmpty');
      return;
    }
    fileError = '';
    const doc = buildChatHistoryExport(roomId, messages);
    const blob = new Blob([chatHistoryExportJson(doc)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = chatHistoryFileName(roomId);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (exportFlashTimer) clearTimeout(exportFlashTimer);
    exportFlash = true;
    exportFlashTimer = setTimeout(() => { exportFlash = false; exportFlashTimer = null; }, 1500);
  }

  function addOnlineUser(user: { key: string; name: string; color: string; alias?: Alias; initials: string }) {
    if (!onlineUsers.find(u => u.key === user.key)) {
      onlineUsers = [...onlineUsers, user];
    }
  }

  function tick() {
    const now = Date.now();
    if (now - clock >= 60_000) clock = now;
    if (scheduledDrafts.length && now - scheduleClock >= 1_000) scheduleClock = now;
    let changed = false;
    const alive: Message[] = [];
    for (const msg of messages) {
      if (!msg.ttl || msg.ttl <= 0) { alive.push(msg); continue; }
      if (msg.time === 0) { alive.push(msg); continue; }
      const elapsed = (now - msg.time) / 1000;
      const rem = Math.max(0, msg.ttl - elapsed);
      if (rem <= 0) { changed = true; clearOnceTimer(msg.id); reactionBook.forget(msg.id); continue; }
      if (rem !== msg.remaining) { msg.remaining = rem; changed = true; }
      alive.push(msg);
    }
    if (changed) messages = alive;
  }

  $: localHasCamera = Boolean(localStream?.getVideoTracks().length);
  $: localPreviewTrack = screenSharing && screenTrack
    ? screenTrack
    : (!cameraOff ? localStream?.getVideoTracks()[0] ?? null : null);
  $: localDisplayStream = localPreviewTrack ? new MediaStream([localPreviewTrack]) : null;
  $: localHasVisibleVideo = Boolean(localPreviewTrack);
  $: callHasVideo = localHasVisibleVideo || callPeers.some((peer) => Boolean(peer.stream?.getVideoTracks().length) && (peer.screenSharing || !peer.cameraOff));
  $: callHasScreenSharing = screenSharing || callPeers.some((peer) => peer.screenSharing);
  $: if (callChatOpen || !callActive) callChatSeen = messages.length;
  $: callChatUnread = callActive && !callChatOpen && messages.length > callChatSeen;
  $: callFullscreenMedia = getCallFullscreenMedia(callFullscreenTarget);
  $: if (callFullscreenTarget && !callFullscreenMedia) closeCallFullscreen(false);
  $: if (callActive && !callMediaSessionHandlersActive) {
    setCallMediaSessionHandlers(true);
    callMediaSessionHandlersActive = true;
  } else if (!callActive && callMediaSessionHandlersActive) {
    setCallMediaSessionHandlers(false);
    callMediaSessionHandlersActive = false;
  }

  onMount(() => {
    clientId = genId();
    baseTitle = document.title;
    notifySupported = 'Notification' in window;
    notifyOn = notifySupported && Notification.permission === 'granted' && loadNotifyPref(localStorage, roomId);
    callDebugEnabled = getCallDebugEnabledFromStorage();
    callDebug('debug enabled', {
      client: shortPeerId(clientId),
      userAgent: navigator.userAgent,
    });
    void initChat();
    tickInterval = setInterval(tick, 200);
    document.addEventListener('visibilitychange', handleVisibility);
    document.addEventListener('fullscreenchange', handleNativeFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleNativeFullscreenChange);
    window.addEventListener('keydown', handleCallFullscreenKeydown);
    window.addEventListener('blur', handleVisibility);
    window.addEventListener('focus', handleVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('online', onNetChange);
    window.addEventListener('offline', onNetChange);
    netOffline = !navigator.onLine;
    window.visualViewport?.addEventListener('resize', onViewportResize);
  });

  onDestroy(() => {
    uploadMeter.dispose();
    if (typeof document !== 'undefined') clearUnread();
    if (callActive) void sendCallSignal({ action: 'leave' });
    cleanupCall();
    dropForwardSecrecy();
    setCallMediaSessionHandlers(false);
    ws?.close();
    clearInterval(tickInterval);
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (exportFlashTimer) clearTimeout(exportFlashTimer);
    for (const timer of onceClearTimers.values()) clearTimeout(timer);
    onceClearTimers.clear();
    for (const timer of scheduleTimers.values()) clearTimeout(timer);
    scheduleTimers.clear();
    clearVerificationTimeout();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibility);
      document.removeEventListener('fullscreenchange', handleNativeFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleNativeFullscreenChange);
      window.removeEventListener('keydown', handleCallFullscreenKeydown);
      window.removeEventListener('blur', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('online', onNetChange);
      window.removeEventListener('offline', onNetChange);
      window.visualViewport?.removeEventListener('resize', onViewportResize);
      window.removeEventListener('beforeunload', chatBeforeUnload);
    }
  });

  function chatBeforeUnload(e: BeforeUnloadEvent) {
    e.preventDefault();
    e.returnValue = '';
  }

  $: if (typeof window !== 'undefined') {
    if (verified || uploading) window.addEventListener('beforeunload', chatBeforeUnload);
    else window.removeEventListener('beforeunload', chatBeforeUnload);
  }
</script>

<svelte:window on:paste={handlePaste} on:pointerdown|capture={(e) => { closeCallSettingsOnOutside(e); closeProfileOnOutside(e); closeHeaderMenuOnOutside(e); closeMenusOnOutside(e); }} on:keydown={(e) => { closeCallSettingsOnEscape(e); closeProfileOnEscape(e); closeHeaderMenuOnEscape(e); }} />

<div class="chat-container">
  {#if unsupportedBrowser}
    <div class="chat-center">
      <div class="space-y-4 max-w-xs w-full text-center">
        {@html illustration('magnify', 'state-art')}
        <p class="status status--error" role="alert">{t(dict, 'chat.unsupportedBrowser')}</p>
      </div>
    </div>

  {:else if configChanged}
    <div class="chat-center">
      <div class="space-y-4 max-w-xs w-full text-center">
        {@html illustration('magnify', 'state-art')}
        <p class="status status--error" role="alert">{t(dict, 'chat.configChanged')}</p>
        <p class="hint">{t(dict, 'chat.configChangedDetail')}</p>
        {#if appMode}
          <button type="button" class="btn-secondary w-full" on:click={() => onExitApp?.()}>{t(dict, 'common.back')}</button>
        {:else}
          <a class="btn-secondary w-full" href={`${getLocalePrefix()}/chat`}>{t(dict, 'chat.newChat')}</a>
        {/if}
      </div>
    </div>

  {:else if roomMissing}
    <div class="chat-center">
      <div class="space-y-4 max-w-xs w-full text-center">
        {@html illustration('magnify', 'state-art')}
        <p class="text-base font-bold text-text">{t(dict, 'chat.roomMissing')}</p>
        <p class="hint">{t(dict, 'chat.roomMissingDetail')}</p>
        {#if appMode}
          <button type="button" class="btn w-full" on:click={() => onExitApp?.()}>{t(dict, 'common.back')}</button>
        {:else}
          <a class="btn w-full" href={`${getLocalePrefix()}/chat?room=${encodeURIComponent(roomId)}`}>{t(dict, 'chat.roomMissingCreate')}</a>
        {/if}
        <button type="button" class="btn-secondary w-full" on:click={retryPasswordEntry}>{t(dict, 'chat.tryAgain')}</button>
      </div>
    </div>

  {:else if checkingRoom}
    <div class="chat-center">
      <div class="text-center space-y-2">
        <svg class="animate-spin mx-auto h-6 w-6 text-emerald-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">{@html LUCIDE['loader-circle']}</svg>
        <p class="hint">{t(dict, 'common.working')}</p>
      </div>
    </div>

  {:else if needsPassword}
    <div class="chat-center">
      <div class="space-y-4 max-w-xs w-full">
        <div class="text-center space-y-2">
          {@html illustration('lock', 'state-art')}
          <p class="text-base font-bold text-text">{t(dict, 'chat.roomRequiresPassword')}</p>
          <p class="hint">{t(dict, 'chat.roomPasswordHint')}</p>
        </div>
        <input
          type="password"
          class="input w-full"
          aria-label={t(dict, 'chat.password')}
          placeholder={t(dict, 'chat.roomPasswordPlaceholder')}
          bind:value={passwordInput}
          on:keydown={(e) => e.key === 'Enter' && submitPassword()}
          autocomplete="off"
          data-lpignore="true"
          data-1p-ignore
          data-bwignore="true"
        />
        {#if passwordError}
          <p class="status status--error" role="alert">{passwordError}</p>
        {/if}
        <button class="btn w-full" on:click={submitPassword}>{t(dict, 'chat.enterRoom')}</button>
      </div>
    </div>

  {:else if verifying && !everVerified}
    <div class="chat-center">
      <div class="text-center space-y-2">
        <svg class="animate-spin mx-auto h-6 w-6 text-emerald-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">{@html LUCIDE['loader-circle']}</svg>
        <p class="hint">{serverPresence > 1 ? t(dict, 'chat.verifyingPassword') : t(dict, 'chat.verifyingAlone')}</p>
      </div>
    </div>

  {:else}
    {#if !appMode}
    <div class="chat-header">
      <div class="flex items-center gap-2">
        <span class="chat-status" class:chat-status--connected={connected}></span>
        <div class="flex items-center -space-x-1.5">
          <div class="chat-profile" bind:this={profileEl}>
            <button type="button" class="chat-avatar chat-avatar--sm chat-avatar--btn" style="background: {aliasGradient(alias, identity.name)}" title="{identity.name} · {t(dict, 'chat.editProfile')}" aria-label="{identity.name} · {t(dict, 'chat.editProfile')}" aria-expanded={profileOpen} aria-controls="chat-profile-pop" on:click={toggleProfile}>
              <span class="chat-avatar__edit" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">{@html LUCIDE['pencil']}</svg></span>
            </button>
            {#if profileOpen}
              <form id="chat-profile-pop" class="chat-profile__pop" on:submit|preventDefault={applyProfile}>
                <div class="chat-profile__avatar">
                  <span class="chat-avatar chat-avatar--lg" style="background: {gradientFor(previewAlias, previewName)}" aria-hidden="true"></span>
                  <button type="button" class="btn-secondary btn-sm" on:click={rerollAvatar}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['dices']}</svg>
                    {t(dict, 'chat.rerollAvatar')}
                  </button>
                </div>
                <label class="chat-profile__label" for="chat-nickname">{t(dict, 'chat.yourName')}</label>
                <div class="chat-profile__row">
                  <input id="chat-nickname" class="input chat-profile__input" bind:value={nickInput} maxlength="24" placeholder={aliasName(dict, alias)} autocomplete="off" autocapitalize="off" spellcheck="false" aria-invalid={nickError ? 'true' : undefined} aria-describedby="chat-nickname-hint" />
                  <button type="submit" class="btn btn-sm">{t(dict, 'chat.nicknameSave')}</button>
                </div>
                <p id="chat-nickname-hint" class="chat-profile__hint" class:chat-profile__hint--error={Boolean(nickError)} role={nickError ? 'alert' : undefined}>{nickError || t(dict, 'chat.nicknameHint')}</p>
                
              </form>
            {/if}
          </div>
          {#each onlineUsers as user}
            <div class="chat-avatar chat-avatar--sm" style="background: {gradientFor(user.alias, user.name)}" title={user.name} aria-label={user.name}></div>
          {/each}
        </div>
      </div>
      <div class="flex flex-wrap items-center justify-end gap-1.5">
        <span class="sr-only" aria-live="polite">{connected ? t(dict, 'chat.connected') : t(dict, 'chat.connecting')}</span>
        <div class="chat-room-chips" aria-label={getRoomModeLabel()}>
          <span class="chat-mode-badge chat-mode-badge--soft" title={t(dict, 'chat.chip.online').replace('{n}', String(serverPresence))}>{t(dict, 'chat.chip.online').replace('{n}', String(Math.max(0, serverPresence)))}</span>
        </div>
        <button type="button" class="btn-ghost btn-sm btn-icon" title={t(dict, 'chat.callStart')} aria-label={t(dict, 'chat.callStart')} on:click={() => { closeHeaderMenu(); startCall(); }} disabled={!connected || !verified || callJoining || callActive}>
          {#if callJoining}
            <svg class="animate-spin" xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">{@html LUCIDE['loader-circle']}</svg>
          {:else}
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">{@html LUCIDE['phone']}</svg>
          {/if}
        </button>
        <button type="button" class="btn-ghost btn-sm btn-icon" title={t(dict, 'chat.members')} aria-label={t(dict, 'chat.members')} aria-expanded={membersOpen} on:click={() => { membersOpen = !membersOpen; burnConfirmMsg = null; headerMenuOpen = false; }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['key']}</svg>
        </button>
        <div class="chat-header-menu relative" data-chat-menu>
          <button
            id="chat-room-menu-trigger"
            type="button"
            class="btn-ghost btn-sm btn-icon"
            title={t(dict, 'chat.roomMenu')}
            aria-label={t(dict, 'chat.roomMenu')}
            aria-haspopup="menu"
            aria-expanded={headerMenuOpen}
            aria-controls="chat-room-menu"
            on:click={() => { headerMenuOpen = !headerMenuOpen; membersOpen = false; burnConfirmMsg = null; profileOpen = false; }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['ellipsis-vertical']}</svg>
          </button>
          <div id="chat-room-menu" class="menu menu--end chat-header-menu__panel" class:menu--open={headerMenuOpen} role="menu">
            <button type="button" class="menu__item" role="menuitem" on:click={() => { closeHeaderMenu(); copyShareLink(); }}>
              <svg class="chat-header-menu__icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['link']}</svg>
              {shareCopiedLink ? t(dict, 'common.copied') : t(dict, 'chat.copyRoomLink')}
            </button>
            <div role="none" on:click={closeHeaderMenu}>
              <SaveRoomButton {dict} kind="chat" {roomId} mode={roomConfig.mode} password={passwordInput} ready={verified} variant="menu" />
            </div>
          <button type="button" class="menu__item" role="menuitemcheckbox" aria-checked={blurWhenAway} on:click={() => { setBlurWhenAway(!blurWhenAway); closeHeaderMenu(); }}>
              <svg class="chat-header-menu__icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['eye']}</svg>
              {t(dict, 'chat.blurWhenAway')}
              {#if blurWhenAway}<svg class="chat-header-menu__check" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['check']}</svg>{/if}
            </button>
            {#if notifySupported}
              <button type="button" class="menu__item" role="menuitemcheckbox" aria-checked={notifyOn} on:click={() => { void toggleNotifications(); closeHeaderMenu(); }}>
                <svg class="chat-header-menu__icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['bell']}</svg>
                {t(dict, 'chat.notifications')}
                {#if notifyOn}<svg class="chat-header-menu__check" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['check']}</svg>{/if}
              </button>
            {/if}
            {#if shouldKeepParticipantHistory()}
              <button type="button" class="menu__item" role="menuitem" on:click={() => { closeHeaderMenu(); exportHistory(); }} disabled={!verified}>
                <svg class="chat-header-menu__icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['download']}</svg>
                {exportFlash ? t(dict, 'chat.exportDownloaded') : t(dict, 'chat.exportHistory')}
              </button>
            {/if}
          </div>
        </div>
      </div>
    </div>
    {/if}

    {#if appMode}
      <Popover class="w-72!" opened={headerMenuOpen} target="#chat-room-menu-trigger" angle onBackdropClick={closeHeaderMenu}>
        <MenuList>
          {#if onShareApp}
            <MenuListItem link chevron={false} linkComponent="button" linkProps={{ type: 'button' }} title={t(dict, 'common.shareLink')} onClick={() => { closeHeaderMenu(); onShareApp(); }}>
              {#snippet media()}
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['share-2']}</svg>
              {/snippet}
            </MenuListItem>
          {/if}
          <MenuListItem link chevron={false} linkComponent="button" linkProps={{ type: 'button' }} title={shareCopiedLink ? t(dict, 'common.copied') : t(dict, 'chat.copyRoomLink')} onClick={() => { closeHeaderMenu(); copyShareLink(); }}>
            {#snippet media()}
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['link']}</svg>
            {/snippet}
          </MenuListItem>
          <div on:click={closeHeaderMenu} role="presentation">
            <SaveRoomButton {dict} kind="chat" {roomId} mode={roomConfig.mode} password={passwordInput} ready={verified} variant="konsta" />
          </div>
          <MenuListItem link chevron={false} linkComponent="button" linkProps={{ type: 'button' }} title={t(dict, 'chat.blurWhenAway')} aria-checked={blurWhenAway} onClick={() => { setBlurWhenAway(!blurWhenAway); closeHeaderMenu(); }}>
            {#snippet media()}
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['eye']}</svg>
            {/snippet}
            {#snippet after()}{#if blurWhenAway}
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['check']}</svg>
            {/if}{/snippet}
          </MenuListItem>
          {#if notifySupported}
            <MenuListItem link chevron={false} linkComponent="button" linkProps={{ type: 'button' }} title={t(dict, 'chat.notifications')} aria-checked={notifyOn} onClick={() => { void toggleNotifications(); closeHeaderMenu(); }}>
              {#snippet media()}
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['bell']}</svg>
              {/snippet}
              {#snippet after()}{#if notifyOn}
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['check']}</svg>
              {/if}{/snippet}
            </MenuListItem>
          {/if}
          {#if shouldKeepParticipantHistory()}
            <MenuListItem link chevron={false} linkComponent="button" linkProps={{ type: 'button', disabled: !verified }} title={exportFlash ? t(dict, 'chat.exportDownloaded') : t(dict, 'chat.exportHistory')} onClick={() => { closeHeaderMenu(); exportHistory(); }}>
              {#snippet media()}
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['download']}</svg>
              {/snippet}
            </MenuListItem>
          {/if}
        </MenuList>
      </Popover>
    {/if}

    {#if appMode}
      <Sheet opened={actionMenuFor !== null} onBackdropClick={() => { actionMenuFor = null; }} class="app-sheet chat-msg-sheet pb-[env(safe-area-inset-bottom)]">
        <div class="app-sheet__handle"></div>
        {#if sheetMsg}
          {@const picked = myReactions(sheetMsg.id, reactionTick)}
          <div class="chat-react-row" role="group" aria-label={t(dict, 'chat.messageActions')}>
            {#each REACTION_EMOJI as emoji}
              <button
                type="button"
                class="chat-react-btn"
                class:chat-react-btn--on={picked.includes(emoji)}
                aria-pressed={picked.includes(emoji)}
                aria-label={t(dict, 'chat.reactWith').replace('{emoji}', emoji)}
                on:click={() => { if (sheetMsg) void toggleReaction(sheetMsg, emoji); actionMenuFor = null; }}
              >{emoji}</button>
            {/each}
          </div>
          <List strongIos insetIos class="mt-1! mb-3!">
            <ListItem link linkComponent="button" linkProps={{ type: 'button' }} chevron={false} title={t(dict, 'chat.reply')} onClick={() => { if (sheetMsg) startReply(sheetMsg); }}>
              {#snippet media()}
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['reply']}</svg>
              {/snippet}
            </ListItem>
            {#if sheetMsg.text}
              <ListItem link linkComponent="button" linkProps={{ type: 'button' }} chevron={false} title={t(dict, 'chat.copyMessage')} onClick={() => { if (sheetMsg) void copyMessageText(sheetMsg); }}>
                {#snippet media()}
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['copy']}</svg>
                {/snippet}
              </ListItem>
            {/if}
            {#if sheetMsg.mine && !sheetMsg.whiteboard}
              <ListItem link linkComponent="button" linkProps={{ type: 'button' }} chevron={false} onClick={() => { if (sheetMsg) burnOwnMessage(sheetMsg); }}>
                {#snippet title()}<span class="app-danger-text">{t(dict, 'chat.burnForEveryone')}</span>{/snippet}
                {#snippet media()}
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="app-danger-text">{@html LUCIDE['trash']}</svg>
                {/snippet}
              </ListItem>
            {/if}
          </List>
        {/if}
      </Sheet>
    {/if}

    {#if safetyPrompt}
      <div class="chat-call-banner chat-safety-banner" role="dialog" aria-label={t(dict, 'chat.safetyCompareTitle')}>
        <div class="chat-call-banner__meta">
          <p class="chat-call-banner__title">{t(dict, 'chat.safetyCompareTitle')}</p>
          <p class="chat-call-banner__name">{safetyPrompt.name}</p>
          <p class="chat-member__emoji chat-member__safety" aria-label={safetyPrompt.safety}>{#each safetyPrompt.safety.split(' ') as group}<span>{group}</span>{/each}</p>
          <p class="hint">{t(dict, 'chat.safetyCompareHint')}</p>
        </div>
        <div class="chat-call-banner__actions">
          {#if !safetyPrompt.trusted}
            <button type="button" class="btn-outline btn-sm" on:click={() => trustKey(safetyPrompt!.pk)}>{t(dict, 'chat.keyTrust')}</button>
          {/if}
          <button type="button" class="btn-ghost btn-sm" on:click={dismissSafetyPrompt}>{t(dict, 'chat.safetyCompareDismiss')}</button>
        </div>
      </div>
    {/if}

    {#if burnConfirmMsg}
      <div class="chat-call-banner" role="alertdialog" aria-label={t(dict, 'chat.burnForEveryone')}>
        <p class="chat-call-banner__title">{t(dict, 'chat.burnConfirm')}</p>
        <div class="chat-call-banner__actions">
          <button type="button" class="chat-call-decline" on:click={() => { void confirmBurnOwnMessage(); }}>{t(dict, 'chat.burnConfirmYes')}</button>
          <button type="button" class="btn-ghost btn-sm" on:click={() => { burnConfirmMsg = null; }}>{t(dict, 'chat.burnConfirmNo')}</button>
        </div>
      </div>
    {/if}

    {#if membersOpen && !appMode}
      <div class="chat-members">
        <div class="chat-member">
          <div class="chat-avatar chat-avatar--sm" style="background: {aliasGradient(alias, identity.name)}" title={identity.name} aria-label={identity.name}></div>
          <div class="min-w-0 flex-1">
            <p class="chat-member__name">{identity.name} <span class="text-muted">· {t(dict, 'chat.you')}</span></p>
            <p class="chat-member__line"><span class="hint">{t(dict, 'chat.keyCode')}</span><span class="chat-member__emoji" aria-label={myKeyCode}>{myKeyCode}</span></p>
          </div>
        </div>
        {#if memberList.length === 0}
          <p class="hint">{t(dict, 'chat.noMembersYet')}</p>
        {/if}
        {#each memberList as member (member.pk)}
          <div class="chat-member" class:chat-member--warn={!member.trusted}>
            <div class="chat-avatar chat-avatar--sm" style="background: {gradientFor(member.alias, member.name)}" title={member.name} aria-label={member.name}></div>
            <div class="min-w-0 flex-1">
              <p class="chat-member__name">
                {member.name}
                {#if !member.trusted}<span class="chat-key-warn">{t(dict, 'chat.keyNew')}</span>{/if}
              </p>
              <p class="chat-member__line"><span class="hint">{t(dict, 'chat.keyCode')}</span><span class="chat-member__emoji" aria-label={member.code}>{member.code}</span></p>
              <p class="chat-member__line"><span class="hint">{t(dict, 'chat.safetyNumber')}</span><span class="chat-member__emoji chat-member__safety" aria-label={member.safety}>{#each member.safety.split(' ') as group}<span>{group}</span>{/each}</span></p>
              {#if !member.trusted}
                <p class="hint">{t(dict, 'chat.keyNewHint')}</p>
                <button type="button" class="btn-outline btn-sm" on:click={() => trustKey(member.pk)}>{t(dict, 'chat.keyTrust')}</button>
              {/if}
            </div>
          </div>
        {/each}
        <p class="hint">{t(dict, 'chat.safetyNumberHint')}</p>
      </div>
    {/if}

    {#if appMode}
      <Sheet opened={membersOpen} onBackdropClick={() => { membersOpen = false; appProfileOpen = false; }} class="pb-safe">
        <div class="app-room-info">
          <p class="app-room-info__title">{roomId}</p>
          <p class="app-room-info__meta">{t(dict, 'chat.chip.online').replace('{n}', String(Math.max(0, serverPresence)))} · {getRoomModeLabel()}</p>
          <div class="chat-members">
            <div class="chat-member">
              <div class="chat-avatar chat-avatar--sm" style="background: {aliasGradient(alias, identity.name)}" title={identity.name} aria-label={identity.name}></div>
              <div class="min-w-0 flex-1">
                <p class="chat-member__name">{identity.name} <span class="text-muted">· {t(dict, 'chat.you')}</span></p>
                <p class="chat-member__line"><span class="hint">{t(dict, 'chat.keyCode')}</span><span class="chat-member__emoji" aria-label={myKeyCode}>{myKeyCode}</span></p>
              </div>
              <button type="button" class="chat-profile-edit" on:click={appProfileToggle} aria-expanded={appProfileOpen} aria-label={t(dict, 'chat.editProfile')}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['pencil']}</svg>
              </button>
            </div>
            {#if appProfileOpen}
              <form class="chat-profile__pop chat-profile__pop--inline" bind:this={appProfileFormEl} on:submit|preventDefault={applyProfile}>
                <div class="chat-profile__avatar">
                  <span class="chat-avatar chat-avatar--lg" style="background: {gradientFor(previewAlias, previewName)}" aria-hidden="true"></span>
                  <button type="button" class="app-sheet-btn app-sheet-btn--tonal" on:click={rerollAvatar}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['dices']}</svg>
                    {t(dict, 'chat.rerollAvatar')}
                  </button>
                </div>
                <label class="chat-profile__label" for="chat-nickname-app">{t(dict, 'chat.yourName')}</label>
                <div class="chat-profile__row">
                  <input id="chat-nickname-app" class="app-dialog-input" bind:value={nickInput} maxlength="24" placeholder={aliasName(dict, alias)} autocomplete="off" autocapitalize="off" spellcheck="false" aria-invalid={nickError ? 'true' : undefined} />
                  <button type="submit" class="app-sheet-btn">{t(dict, 'chat.nicknameSave')}</button>
                </div>
                <p class="chat-profile__hint" class:chat-profile__hint--error={Boolean(nickError)} role={nickError ? 'alert' : undefined}>{nickError || t(dict, 'chat.nicknameHint')}</p>
              </form>
            {/if}
            {#if memberList.length === 0}
              <p class="hint">{t(dict, 'chat.noMembersYet')}</p>
            {/if}
            {#each memberList as member (member.pk)}
              <div class="chat-member" class:chat-member--warn={!member.trusted}>
                <div class="chat-avatar chat-avatar--sm" style="background: {gradientFor(member.alias, member.name)}" title={member.name} aria-label={member.name}></div>
                <div class="min-w-0 flex-1">
                  <p class="chat-member__name">
                    {member.name}
                    {#if !member.trusted}<span class="chat-key-warn">{t(dict, 'chat.keyNew')}</span>{/if}
                  </p>
                  <p class="chat-member__line"><span class="hint">{t(dict, 'chat.keyCode')}</span><span class="chat-member__emoji" aria-label={member.code}>{member.code}</span></p>
                  <p class="chat-member__line"><span class="hint">{t(dict, 'chat.safetyNumber')}</span><span class="chat-member__emoji chat-member__safety" aria-label={member.safety}>{#each member.safety.split(' ') as group}<span>{group}</span>{/each}</span></p>
                  {#if !member.trusted}
                    <p class="hint">{t(dict, 'chat.keyNewHint')}</p>
                    <button type="button" class="app-sheet-btn app-sheet-btn--tonal" on:click={() => trustKey(member.pk)}>{t(dict, 'chat.keyTrust')}</button>
                  {/if}
                </div>
              </div>
            {/each}
            <p class="hint">{t(dict, 'chat.safetyNumberHint')}</p>
          </div>
        </div>
      </Sheet>
    {/if}

    {#if sharePassword && !shareDismissed}
      {#if appMode}
        <Sheet opened onBackdropClick={() => { shareDismissed = true; }} class="pb-safe">
          <div class="app-invite-sheet">
            <RoomInviteCard
              {dict}
              {appMode}
              title={roomId}
              url={shareUrl}
              password={sharePassword}
              warning={t(dict, 'chat.sharePasswordWarning')}
              onDismiss={() => { shareDismissed = true; }}
            />
          </div>
        </Sheet>
      {:else}
        <div class="chat-share-banner">
          <RoomInviteCard
            {dict}
            title={roomId}
            url={shareUrl}
            password={sharePassword}
            warning={t(dict, 'chat.sharePasswordWarning')}
            onDismiss={() => { shareDismissed = true; }}
          />
        </div>
      {/if}
    {/if}

    {#if activeCallNotice && !callActive}
      <div class="chat-call-banner">
        <div class="chat-call-banner__meta">
          <div class="chat-avatar chat-avatar--sm" style="background: {gradientFor(activeCallNotice.alias, activeCallNotice.name)}" title={activeCallNotice.name} aria-label={activeCallNotice.name}></div>
          <div class="min-w-0">
            <p class="chat-call-banner__title">{t(dict, 'chat.callInProgress')}</p>
            <p class="chat-call-banner__name">{t(dict, 'chat.callInProgressBy').replace('{name}', activeCallNotice.name)}</p>
          </div>
        </div>
        <div class="chat-call-banner__actions">
          <button class="chat-call-accept" on:click={joinActiveCall}>{t(dict, 'chat.callJoin')}</button>
          <button class="chat-call-decline" on:click={() => { activeCallNotice = null; callNoticeDismissed = true; }}>{t(dict, 'chat.callDismiss')}</button>
        </div>
      </div>
    {/if}

    <div class="chat-body" class:chat-body--call={callActive} class:chat-body--chat-hidden={callActive && !callChatOpen}>
      <ChatCall
        {dict}
        {callActive}
        {callError}
        {callPeers}
        {serverQuality}
        {serverLatencyMs}
        {callHasScreenSharing}
        {callHasVideo}
        {localDisplayStream}
        {localHasVisibleVideo}
        {localSpeaking}
        {localAudioLevel}
        {micMuted}
        {cameraOff}
        {screenSharing}
        {callAudioMuted}
        {callVolume}
        {callChatUnread}
        {blurWhenAway}
        {blurred}
        {alias}
        localName={identity.name}
        {audioInputDevices}
        {videoInputDevices}
        {audioOutputDevices}
        {canSelectAudioOutput}
        relayTitle={getRelayTitle()}
        relayStatusLabel={getRelayStatusLabel()}
        fullscreenMedia={callFullscreenMedia}
        bind:callSettingsOpen
        bind:callChatOpen
        bind:selectedAudioInputId
        bind:selectedVideoInputId
        bind:selectedAudioOutputId
        bind:fullscreenOverlayEl={callFullscreenOverlayEl}
        ontogglemic={toggleMic}
        ontogglecamera={toggleCamera}
        ontogglescreen={() => screenSharing ? stopScreenShare() : startScreenShare()}
        onendcall={() => endCall(true)}
        onrefreshdevices={refreshCallDevices}
        onaudioinputchange={handleAudioInputChange}
        onvideoinputchange={handleVideoInputChange}
        onaudiooutputchange={handleAudioOutputChange}
        onsetvolume={setCallVolume}
        onsetaudiomuted={setCallAudioMuted}
        onsetblurwhenaway={setBlurWhenAway}
        onsetpeeraudiomuted={setPeerAudioMuted}
        onsetpeervolume={setPeerVolume}
        onopenfullscreen={openCallFullscreen}
        onclosefullscreen={() => closeCallFullscreen()}
        onkeepplaying={keepCallMediaPlaying}
        onpreventcontextmenu={preventMediaContextMenu}
      />

      <div class="chat-thread" class:chat-thread--drop={dragDepth > 0} on:dragenter={handleDragEnter} on:dragover={handleDragOver} on:dragleave={handleDragLeave} on:drop={handleDrop}>
        <div class="chat-messages-shell">
        <div class="chat-messages" class:chat-messages--blurred={blurWhenAway && blurred} bind:this={messagesEl} on:scroll={updateStickToBottom} on:wheel={cancelPin} on:touchstart|passive={cancelPin} use:revealSpoilers role="log" aria-live="polite">
      {#if messages.length === 0 && historyReady}
        <div class="empty max-w-sm mx-auto my-auto">
          {@html illustration('chill', 'state-art mb-2')}
          <p class="empty__title">{t(dict, serverPresence > 1 ? 'chat.emptyRoomNoticeOthers' : 'chat.emptyRoomNotice')}</p>
          <p class="text-text">{t(dict, 'chat.emptyRoomNotice2')}</p>
          <p class="hint">{t(dict, roomConfig.mode === 'live' ? 'chat.emptyRoomNotice3' : 'chat.emptyRoomNotice3Ttl')}</p>
        </div>
      {/if}

      {#each messages as msg, i (msg.id)}
        {#if !msg.sender}
          <p class="chat-system">{msg.text}</p>
        {:else if appMode}
        {@const groupStart = !messages[i - 1]?.sender || messages[i - 1]?.sender !== msg.sender}
        {@const groupEnd = !messages[i + 1] || messages[i + 1]?.sender !== msg.sender}
        {#snippet bubbleAvatar()}
          <div class="chat-avatar" style="background: {gradientFor(msg.alias, msg.sender)}" title={msg.sender} aria-label={msg.sender}></div>
        {/snippet}
        {#snippet bubbleMeta()}
          <div class="chat-sender-row">
            {#if !msg.mine && groupStart}
              <span class="chat-sender" style="color: {safeColor(msg.color)}">{msg.sender}</span>
            {/if}
            {#if msg.once}
              <span class="chat-once-badge" title={t(dict, 'chat.onceHint')}>{t(dict, 'chat.onceBadge')}</span>
            {/if}
            {#if msg.keyWarning}
              <button type="button" class="chat-key-warn" title={t(dict, 'chat.keyNewHint')} on:click={() => { membersOpen = true; burnConfirmMsg = null; headerMenuOpen = false; }}>{t(dict, 'chat.keyNew')}</button>
            {/if}
          </div>
        {/snippet}
        <div
          class="chat-kmsg-wrap"
          class:chat-kmsg-wrap--break={groupStart}
          class:chat-bubble--menu={actionMenuFor === msg.id}
          class:chat-bubble--highlight={highlightedId === msg.id}
          id={`chat-msg-${msg.id}`}
          use:longPress={() => { if (verified) actionMenuFor = msg.id; }}
          use:swipeReply={{ onreply: () => startReply(msg), enabled: verified && !msg.pending }}
          on:contextmenu|preventDefault={() => { if (verified) actionMenuFor = msg.id; }}
        >
          <Message
            type={msg.mine ? 'sent' : 'received'}
            colors={kmsgColors}
            class={`${msg.mine ? 'chat-kmsg chat-kmsg--mine' : 'chat-kmsg'}${msg.pending ? ' chat-kmsg--pending' : ''}${!msg.mine && !groupEnd ? ' chat-kmsg--gutter' : ''}`}
            avatar={msg.mine || !groupEnd ? undefined : bubbleAvatar}
            name={(!msg.mine && groupStart) || msg.once || msg.keyWarning ? bubbleMeta : undefined}
          >
            {#snippet text()}
              {#if msg.replyTo}
                {@const quote = quoteOf(msg.replyTo, messageIndex)}
                <ChatQuote {dict} name={quote.name} color={quote.color} text={quote.text} onjump={quote.name ? () => jumpTo(msg.replyTo) : undefined} />
              {/if}
              {#if msg.once && !msg.mine && !msg.revealed}
                <button type="button" class="chat-once-reveal" on:click={() => revealOnce(msg)}>
                  <span class="chat-once-reveal__blur" aria-hidden="true">{msg.file?.voice ? t(dict, 'chat.onceBlurVoice') : msg.file ? t(dict, 'chat.onceBlurFile') : (msg.text || t(dict, 'chat.onceBlurText'))}</span>
                  <span class="chat-once-reveal__label">{t(dict, 'chat.onceReveal')}</span>
                </button>
              {:else}
              {#if msg.file?.voice && !msg.pending}
                {@const gone = fileGone(msg)}
                <ChatVoiceMessage {dict} {appMode} seed={msg.id} seconds={msg.file.duration ?? 0} {gone} note={gone ? t(dict, 'chat.fileExpired') : fileTimeLeft(msg)} load={() => loadVoice(msg)} />
              {:else if msg.file}
                {@const gone = !msg.pending && fileGone(msg)}
                <div class="chat-file" class:chat-file--error={gone}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{@html LUCIDE['file']}</svg>
                  <div class="flex-1 min-w-0">
                    <span class="chat-file__name">{msg.file.name}</span>
                    <span class="chat-file__size">
                      {#if gone}
                        {t(dict, 'chat.fileExpired')}
                      {:else if msg.pending}
                        {msg.file.size < 1048576 ? `${(msg.file.size / 1024).toFixed(1)} KB` : `${(msg.file.size / 1048576).toFixed(1)} MB`} · {t(dict, 'chat.queued')}
                      {:else}
                        {msg.file.size < 1048576 ? `${(msg.file.size / 1024).toFixed(1)} KB` : `${(msg.file.size / 1048576).toFixed(1)} MB`} · {fileTimeLeft(msg)}
                      {/if}
                    </span>
                  </div>
                  {#if !gone && !msg.pending}
                    <button type="button" class="chat-file__dl" on:click={() => downloadChatFile(msg)} aria-label={t(dict, 'chat.downloadFile')}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{@html LUCIDE['download']}</svg>
                    </button>
                  {/if}
                </div>
              {/if}
              {#if msg.whiteboard}
                <div class="chat-whiteboard-card">
                  <div class="chat-whiteboard-card__icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">{@html LUCIDE['presentation']}</svg>
                  </div>
                  <div class="chat-whiteboard-card__body">
                    <p class="chat-whiteboard-card__title">{t(dict, 'chat.whiteboardTitle')}</p>
                    <p class="chat-whiteboard-card__meta">{t(dict, 'chat.whiteboardStartedBy').replace('{name}', msg.whiteboard.sender)}</p>
                    <div class="chat-whiteboard-card__actions">
                      <button type="button" class="chat-whiteboard-card__btn chat-whiteboard-card__btn--primary" on:click={() => openWhiteboardNewTab(msg.whiteboard!)}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['external-link']}</svg>
                        {t(dict, 'chat.whiteboardOpenNewTab')}
                      </button>
                    </div>
                  </div>
                </div>
              {/if}
              {#if msg.preview}
                {#if msg.preview.type === 'image' && msg.preview.url}
                  {#if appMode}
                    <button type="button" class="chat-preview-img-btn" on:click={() => openLightbox(msg.preview!.url!)} aria-label={t(dict, 'app.lightbox.image')}>
                      <img src={msg.preview.url} alt={msg.file?.name || ''} class="chat-preview-img" />
                    </button>
                  {:else}
                    <img src={msg.preview.url} alt={msg.file?.name || ''} class="chat-preview-img" />
                  {/if}
                {:else if msg.preview.type === 'text' && msg.preview.text}
                  <div class="chat-preview-text">
                    <pre class="chat-preview-code">{msg.preview.expanded ? msg.preview.text : msg.preview.text.slice(0, PREVIEW_TEXT_LIMIT)}{!msg.preview.expanded && msg.preview.text.length > PREVIEW_TEXT_LIMIT ? '…' : ''}</pre>
                    {#if msg.preview.text.length > PREVIEW_TEXT_LIMIT}
                      <button class="chat-preview-expand" on:click={() => { if (msg.preview) msg.preview.expanded = !msg.preview.expanded; messages = messages; }}>
                        {msg.preview.expanded ? t(dict, 'chat.previewLess') : t(dict, 'chat.previewMore')}
                      </button>
                    {/if}
                  </div>
                {/if}
              {/if}
              {#if msg.text}
                <p class="chat-text">{@html messageHtml(msg)}</p>
              {/if}
              {#if msg.once && !msg.mine && msg.revealed}
                <p class="chat-once-note">{t(dict, 'chat.onceBurned')}</p>
              {/if}
              {/if}
            {/snippet}
            {#snippet footer()}
              <div class="chat-kmsg-meta">
                {#if msg.pending}
                  <span class="chat-kmsg-pending" role="status">
                    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['clock']}</svg>
                    {t(dict, 'chat.queued')}
                  </span>
                {:else if msg.failed}
                  <button type="button" class="chat-kmsg-pending chat-kmsg-pending--failed" on:click={() => retryQueued(msg)}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['rotate-ccw-clock']}</svg>
                    {t(dict, 'chat.tryAgain')}
                  </button>
                {/if}
                <ChatReactions {dict} items={reactionTick >= 0 ? reactionBook.summary(msg.id, mySignerId, t(dict, 'chat.you')) : []} ontoggle={(emoji) => toggleReaction(msg, emoji)} />
                {#if msg.ttl > 0}
                  <div class="chat-timer" title="{Math.ceil(msg.remaining)}s">
                    <svg class="chat-timer__ring" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" opacity="0.1" />
                      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"
                        stroke-dasharray="62.83"
                        stroke-dashoffset={62.83 * (1 - msg.remaining / msg.ttl)}
                        stroke-linecap="round"
                        transform="rotate(-90 12 12)" />
                    </svg>
                    <span class="chat-timer__num">{Math.ceil(msg.remaining)}</span>
                  </div>
                {/if}
              </div>
            {/snippet}
          </Message>
        </div>
        {:else}
        <div
          class="chat-bubble"
          class:chat-bubble--mine={msg.mine}
          class:chat-bubble--menu={actionMenuFor === msg.id}
          class:chat-bubble--highlight={highlightedId === msg.id}
          id={`chat-msg-${msg.id}`}
          use:longPress={() => { actionMenuFor = msg.id; }}
        >
          <div class="flex items-start gap-2">
            {#if !msg.mine}
              <div class="chat-avatar" style="background: {gradientFor(msg.alias, msg.sender)}" title={msg.sender} aria-label={msg.sender}></div>
            {/if}
            <div class="flex-1 min-w-0">
              <div class="chat-sender-row">
                <span class="chat-sender" style="color: {msg.mine ? 'var(--accent)' : safeColor(msg.color)}">{msg.sender}</span>
                {#if msg.once}
                  <span class="chat-once-badge" title={t(dict, 'chat.onceHint')}>{t(dict, 'chat.onceBadge')}</span>
                {/if}
                {#if msg.keyWarning}
                  <button type="button" class="chat-key-warn" title={t(dict, 'chat.keyNewHint')} on:click={() => { membersOpen = true; burnConfirmMsg = null; headerMenuOpen = false; }}>{t(dict, 'chat.keyNew')}</button>
                {/if}
                {#if verified}
                  <ChatMessageActions
                    {dict}
                    open={actionMenuFor === msg.id}
                    align={msg.mine ? 'end' : 'start'}
                    mine={actionMenuFor === msg.id ? myReactions(msg.id, reactionTick) : []}
                    canBurn={msg.mine && !msg.whiteboard}
                    ontoggle={(open) => { actionMenuFor = open ? msg.id : actionMenuFor === msg.id ? null : actionMenuFor; }}
                    onreply={() => startReply(msg)}
                    onreact={(emoji) => toggleReaction(msg, emoji)}
                    onburn={() => burnOwnMessage(msg)}
                  />
                {/if}
              </div>
              {#if msg.replyTo}
                {@const quote = quoteOf(msg.replyTo, messageIndex)}
                <ChatQuote {dict} name={quote.name} color={quote.color} text={quote.text} onjump={quote.name ? () => jumpTo(msg.replyTo) : undefined} />
              {/if}
              {#if msg.once && !msg.mine && !msg.revealed}
                <button type="button" class="chat-once-reveal" on:click={() => revealOnce(msg)}>
                  <span class="chat-once-reveal__blur" aria-hidden="true">{msg.file?.voice ? t(dict, 'chat.onceBlurVoice') : msg.file ? t(dict, 'chat.onceBlurFile') : (msg.text || t(dict, 'chat.onceBlurText'))}</span>
                  <span class="chat-once-reveal__label">{t(dict, 'chat.onceReveal')}</span>
                </button>
              {:else}
              {#if msg.file?.voice && !msg.pending}
                {@const gone = fileGone(msg)}
                <ChatVoiceMessage {dict} {appMode} seed={msg.id} seconds={msg.file.duration ?? 0} {gone} note={gone ? t(dict, 'chat.fileExpired') : fileTimeLeft(msg)} load={() => loadVoice(msg)} />
              {:else if msg.file}
                {@const gone = !msg.pending && fileGone(msg)}
                <div class="chat-file" class:chat-file--error={gone}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{@html LUCIDE['file']}</svg>
                  <div class="flex-1 min-w-0">
                    <span class="chat-file__name">{msg.file.name}</span>
                    <span class="chat-file__size">
                      {#if gone}
                        {t(dict, 'chat.fileExpired')}
                      {:else if msg.pending}
                        {msg.file.size < 1048576 ? `${(msg.file.size / 1024).toFixed(1)} KB` : `${(msg.file.size / 1048576).toFixed(1)} MB`} · {t(dict, 'chat.queued')}
                      {:else}
                        {msg.file.size < 1048576 ? `${(msg.file.size / 1024).toFixed(1)} KB` : `${(msg.file.size / 1048576).toFixed(1)} MB`} · {fileTimeLeft(msg)}
                      {/if}
                    </span>
                  </div>
                  {#if !gone && !msg.pending}
                    <button type="button" class="chat-file__dl" on:click={() => downloadChatFile(msg)} aria-label={t(dict, 'chat.downloadFile')}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{@html LUCIDE['download']}</svg>
                    </button>
                  {/if}
                </div>
              {/if}
              {#if msg.whiteboard}
                <div class="chat-whiteboard-card">
                  <div class="chat-whiteboard-card__icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">{@html LUCIDE['presentation']}</svg>
                  </div>
                  <div class="chat-whiteboard-card__body">
                    <p class="chat-whiteboard-card__title">{t(dict, 'chat.whiteboardTitle')}</p>
                    <p class="chat-whiteboard-card__meta">{t(dict, 'chat.whiteboardStartedBy').replace('{name}', msg.whiteboard.sender)}</p>
                    <div class="chat-whiteboard-card__actions">
                      <button type="button" class="chat-whiteboard-card__btn chat-whiteboard-card__btn--primary" on:click={() => openWhiteboardNewTab(msg.whiteboard!)}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['external-link']}</svg>
                        {t(dict, 'chat.whiteboardOpenNewTab')}
                      </button>
                    </div>
                  </div>
                </div>
              {/if}
              {#if msg.preview}
                {#if msg.preview.type === 'image' && msg.preview.url}
                  <img src={msg.preview.url} alt={msg.file?.name || ''} class="chat-preview-img" />
                {:else if msg.preview.type === 'text' && msg.preview.text}
                  <div class="chat-preview-text">
                    <pre class="chat-preview-code">{msg.preview.expanded ? msg.preview.text : msg.preview.text.slice(0, PREVIEW_TEXT_LIMIT)}{!msg.preview.expanded && msg.preview.text.length > PREVIEW_TEXT_LIMIT ? '…' : ''}</pre>
                    {#if msg.preview.text.length > PREVIEW_TEXT_LIMIT}
                      <button class="chat-preview-expand" on:click={() => { if (msg.preview) msg.preview.expanded = !msg.preview.expanded; messages = messages; }}>
                        {msg.preview.expanded ? t(dict, 'chat.previewLess') : t(dict, 'chat.previewMore')}
                      </button>
                    {/if}
                  </div>
                {/if}
              {/if}
              {#if msg.text}
                <p class="chat-text">{@html messageHtml(msg)}</p>
              {/if}
              {#if msg.once && !msg.mine && msg.revealed}
                <p class="chat-once-note">{t(dict, 'chat.onceBurned')}</p>
              {/if}
              {/if}
              <ChatReactions {dict} items={reactionTick >= 0 ? reactionBook.summary(msg.id, mySignerId, t(dict, 'chat.you')) : []} ontoggle={(emoji) => toggleReaction(msg, emoji)} />
            </div>
            {#if msg.ttl > 0}
              <div class="chat-timer" title="{Math.ceil(msg.remaining)}s">
                <svg class="chat-timer__ring" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" opacity="0.1" />
                  <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"
                    stroke-dasharray="62.83"
                    stroke-dashoffset={62.83 * (1 - msg.remaining / msg.ttl)}
                    stroke-linecap="round"
                    transform="rotate(-90 12 12)" />
                </svg>
                <span class="chat-timer__num">{Math.ceil(msg.remaining)}</span>
              </div>
            {/if}
          </div>
        </div>
        {/if}
      {/each}


        </div>

        {#if !stickToBottom}
          <button type="button" class="chat-jump-latest" class:chat-jump-latest--new={belowCount > 0} on:click={jumpToLatest} aria-label={t(dict, 'chat.jumpLatest')}>
            {#if belowCount > 0}
              <span class="chat-jump-latest__count">{belowCount > 99 ? '99+' : belowCount}</span>
              <span>{t(dict, 'chat.newBelow')}</span>
            {/if}
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['arrow-down']}</svg>
          </button>
        {/if}
        </div>

        <div class="chat-typing" aria-live="polite">
          {#if typing}
            <span class="chat-avatar chat-avatar--xs" style="background: {gradientFor(typing.alias, typing.sender)}" aria-hidden="true"></span>
            <span><strong style="color: {safeColor(typing.color)}">{typing.sender}</strong> {t(dict, 'chat.isTyping')}</span>
          {/if}
        </div>

        {#if uploading}
          <div class="chat-upload-progress">
            {#if appMode}
              <Progressbar progress={uploadBar} />
              <span class="chat-upload-line">{uploadLine || t(dict, 'chat.uploading')}</span>
            {:else}
              <ProgressPulse
                title={t(dict, 'chat.uploading')}
                compact={true}
                ratio={uploadBar}
                transferLine={uploadLine}
              />
            {/if}
          </div>
        {/if}
        {#if fileError}
          <div class="chat-file-error" role="alert">
            <span>{fileError}</span>
            <button type="button" class="btn-ghost btn-sm btn-icon" on:click={() => { fileError = ''; }} aria-label={t(dict, 'chat.callDismiss')}>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['x']}</svg>
            </button>
          </div>
        {/if}
        {#if replyTarget}
          {@const quote = quoteOf(replyTarget.id, messageIndex)}
          <div class="chat-reply-bar">
            <ChatQuote {dict} name={quote.name} color={quote.color} text={quote.text} oncancel={() => { replyTarget = null; inputEl?.focus(); }} />
          </div>
        {/if}
        {#if scheduledDrafts.length}
          <div class="chat-schedule-list" aria-live="polite">
            {#each scheduledDrafts as draft (draft.id)}
              <div class="chat-schedule-item">
                <div class="chat-schedule-item__body">
                  <span class="chat-schedule-item__when">{t(dict, 'chat.scheduleFor').replace('{when}', formatScheduleAt(draft.sendAt, locale, scheduleClock))}</span>
                  <span class="chat-schedule-item__text">{draft.text}</span>
                </div>
                <button type="button" class="btn-ghost btn-sm" on:click={() => cancelScheduled(draft.id)}>{t(dict, 'chat.scheduleCancel')}</button>
              </div>
            {/each}
          </div>
        {/if}
        <ChatComposer
          {dict}
          {connected}
          {verified}
          {uploading}
          allowQueue={Boolean(cryptoKey)}
          {appMode}
          bind:inputText
          bind:inputEl
          bind:fileInputEl
          bind:composerMenuOpen
          bind:voiceRecording
          bind:onceEnabled
          bind:scheduleMenuOpen
          hasReply={Boolean(replyTarget)}
          schedulePresets={SCHEDULE_PRESETS}
          onsend={handleSend}
          ontyping={handleTyping}
          onchoosefile={chooseFileUpload}
          oncreatewhiteboard={createWhiteboardInvite}
          onfileselect={handleFileSelect}
          onvoicerecorded={sendVoice}
          onvoiceerror={(message) => { fileError = message; }}
          onclearreply={() => { replyTarget = null; }}
          onschedule={(offsetMs) => queueScheduled(offsetMs)}
        />
      </div>
    </div>
  {/if}

</div>

{#if appMode && lightboxUrl}
  <div
    class="chat-lightbox"
    role="dialog"
    aria-modal="true"
    aria-label={t(dict, 'app.lightbox.image')}
    on:click={closeLightbox}
  >
    <img src={lightboxUrl} alt="" class="chat-lightbox__img" />
    <button
      type="button"
      class="chat-lightbox__close"
      on:click={closeLightbox}
      aria-label={t(dict, 'app.lightbox.close')}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">{@html LUCIDE['x']}</svg>
    </button>
  </div>
{/if}

<style>
  .chat-container {
    display: flex;
    flex-direction: column;
    container: chat-body / inline-size;
    height: min(75dvh, 700px);
    border-radius: 0.75rem;
    overflow: hidden;
    border: 1px solid var(--line-soft);
    background: var(--surface);
  }
  .chat-container:has(.chat-body--call) {
    height: min(88dvh, 940px);
  }
  .chat-center {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
  }
  .chat-header {
    flex-wrap: wrap;
    gap: 0.5rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1.25rem;
    border-bottom: 1px solid var(--line-soft);
  }
  .chat-header-menu__panel {
    min-width: 17rem;
    max-width: min(22rem, calc(100vw - 2rem));
    max-height: min(70dvh, 28rem);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .chat-header-menu__panel :global(.menu__item) {
    min-height: 2.75rem;
  }
  .chat-header-menu__icon {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
  }
  .chat-header-menu__check {
    width: 0.95rem;
    height: 0.95rem;
    margin-left: auto;
    color: var(--accent);
    flex-shrink: 0;
  }
  .chat-header-menu__danger:not(:disabled):hover {
    color: var(--danger);
  }
  .chat-profile { position: relative; z-index: 3; }
  .chat-avatar--btn {
    position: relative;
    border: 0;
    padding: 0;
    cursor: pointer;
    overflow: visible;
    transition: transform var(--duration-fast) var(--ease-out);
  }
  .chat-avatar--btn:hover { transform: scale(1.08); }
  .chat-avatar__edit {
    position: absolute;
    right: -5px;
    top: -5px;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 9999px;
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 0 0 1px var(--line);
  }
  .chat-profile__pop {
    position: absolute;
    top: calc(100% + 0.5rem);
    left: 0;
    z-index: 30;
    width: min(18rem, calc(100vw - 2rem));
    max-height: calc(100dvh - 4rem);
    overflow-y: auto;
    overscroll-behavior: contain;
    display: grid;
    gap: 0.4rem;
    padding: 0.75rem;
    border-radius: 0.875rem;
    border: 1px solid var(--line);
    background: var(--surface);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  }
  .chat-profile__label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .chat-profile__row {
    display: flex;
    gap: 0.4rem;
  }
  .chat-profile__input {
    flex: 1 1 auto;
    width: auto;
    min-width: 0;
    min-height: 2.25rem;
    padding-top: 0.35rem;
    padding-bottom: 0.35rem;
    font-size: 0.9rem;
  }
  .chat-profile__hint {
    font-size: 12px;
    line-height: 1.4;
    color: var(--muted);
  }
  .chat-profile__hint--error { color: var(--danger); }
  .chat-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .chat-thread {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .chat-messages-shell {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .chat-jump-latest {
    position: absolute;
    right: 1.25rem;
    bottom: 0.75rem;
    z-index: 4;
    min-width: 2.5rem;
    min-height: 2.5rem;
    justify-content: center;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    max-width: calc(100% - 2rem);
    padding: 0.45rem 0.85rem;
    border: 1px solid var(--accent-line);
    border-radius: 999px;
    background: var(--surface);
    color: var(--accent-strong);
    box-shadow: var(--shadow-float);
    font-size: 0.8125rem;
    font-weight: 600;
    line-height: 1.2;
    cursor: pointer;
  }
  .chat-jump-latest--new { border-radius: 999px; padding-inline: 0.9rem; }
  .chat-jump-latest:hover,
  .chat-jump-latest:focus-visible {
    background: var(--accent-weak);
    outline: none;
  }
  .chat-jump-latest__count {
    display: inline-flex;
    min-width: 1.25rem;
    justify-content: center;
    padding: 0.05rem 0.35rem;
    border-radius: 999px;
    background: var(--accent);
    color: white;
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
  }
  .chat-share-banner {
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid oklch(0.7019 0.1577 160.44 / 0.15);
    background: oklch(0.7019 0.1577 160.44 / 0.04);
  }
  :global(.dark) .chat-share-banner {
    background: oklch(0.7019 0.1577 160.44 / 0.06);
    border-color: oklch(0.7019 0.1577 160.44 / 0.1);
  }
  .chat-room-chips {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 0.35rem;
  }
  .chat-mode-badge {
    min-height: 30px;
    display: inline-flex;
    align-items: center;
    padding: 0 0.55rem;
    border-radius: 0.5rem;
    border: 1px solid oklch(0.7019 0.1577 160.44 / 0.18);
    background: oklch(0.7019 0.1577 160.44 / 0.07);
    color: oklch(0.60 0.14 160.44);
    font-size: 0.75rem;
    font-weight: 700;
    white-space: nowrap;
  }
  .chat-mode-badge--soft {
    border-color: var(--line-soft);
    background: var(--surface-2);
    color: var(--muted);
    font-weight: 600;
  }
  :global(.dark) .chat-mode-badge {
    color: oklch(0.84 0.13 160.44);
    border-color: oklch(0.7019 0.1577 160.44 / 0.16);
    background: oklch(0.7019 0.1577 160.44 / 0.09);
  }
  :global(.dark) .chat-mode-badge--soft {
    color: var(--muted);
    border-color: var(--line-soft);
    background: transparent;
  }
  .chat-safety-banner .chat-member__safety {
    margin-top: 0.15rem;
    font-size: 1.15rem;
    letter-spacing: 0.08em;
  }
  .chat-members {
    display: grid;
    gap: 0.6rem;
    padding: 0.75rem 1.25rem;
    border-bottom: 1px solid var(--line-soft);
  }
  .chat-member {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
  }
  .chat-member--warn {
    padding: 0.5rem;
    border-radius: 0.6rem;
    background: rgba(240, 178, 50, 0.12);
  }
  .chat-member__name {
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--text);
  }
  .chat-member__line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.4rem;
  }
  .chat-member__emoji {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.2rem;
    font-size: 1.15rem;
    line-height: 1.3;
    letter-spacing: 0.05em;
    color: var(--text);
  }
  .chat-member__safety {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .chat-key-warn {
    display: inline-flex;
    align-items: center;
    margin-left: 0.35rem;
    padding: 0 0.4rem;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: rgb(122, 75, 0);
    background: rgb(253, 230, 138);
  }
  :global(.dark) .chat-key-warn {
    color: rgb(253, 230, 138);
    background: rgba(240, 178, 50, 0.22);
  }
  .chat-call-banner {
    display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
    padding: 0.65rem 0.85rem;
    border-bottom: 1px solid oklch(0.7019 0.1577 160.44 / 0.15);
    background: oklch(0.7019 0.1577 160.44 / 0.05);
  }
  :global(.dark) .chat-call-banner {
    background: oklch(0.7019 0.1577 160.44 / 0.07);
    border-color: oklch(0.7019 0.1577 160.44 / 0.12);
  }
  .chat-call-banner__meta {
    min-width: 0;
    display: flex; align-items: center; gap: 0.55rem;
  }
  .chat-call-banner__title {
    font-size: 12px; font-weight: 800;
    color: var(--text);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  :global(.dark) .chat-call-banner__title { color: var(--text); }
  .chat-call-banner__name {
    font-size: 0.75rem; color: var(--muted);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .chat-call-banner__actions { display: flex; align-items: center; gap: 0.45rem; flex-shrink: 0; }
  .chat-call-accept,
  .chat-call-decline {
    min-height: 30px;
    padding: 0 0.65rem;
    border-radius: 0.5rem;
    font-size: 12px; font-weight: 800;
  }
  .chat-call-accept {
    color: white;
    background: var(--accent);
  }
  .chat-call-decline {
    color: var(--muted);
    background: var(--surface-2);
  }
  :global(.dark) .chat-call-decline {
    color: var(--text);
    background: rgba(20, 31, 18, 0.65);
  }
  .chat-status {
    width: 8px; height: 8px; border-radius: 9999px;
    background: rgb(245, 158, 11);
    animation: chat-pulse 1.2s ease-in-out infinite;
  }
  .chat-status--connected {
    background: var(--accent);
    box-shadow: 0 0 0 3px oklch(0.7019 0.1577 160.44 / 0.2);
    animation: none;
  }
  @keyframes chat-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  .chat-messages {
    scrollbar-width: auto;
    scrollbar-color: auto;
    flex: 1; min-height: 0; overflow-y: auto; padding: 1.25rem;
    display: flex; flex-direction: column; gap: 0.6rem;
    transition: filter 0.3s;
  }
  .chat-messages::-webkit-scrollbar { width: 12px; }
  .chat-messages::-webkit-scrollbar-track { background: transparent; }
  .chat-messages::-webkit-scrollbar-thumb {
    min-height: 72px;
    border: 3px solid transparent;
    border-radius: 999px;
    background: var(--line) padding-box;
  }
  .chat-messages::-webkit-scrollbar-thumb:hover { background: var(--accent) padding-box; }
  .chat-messages--blurred { filter: blur(8px); }
  .chat-thread--drop { outline: 2px dashed var(--accent); outline-offset: -6px; border-radius: 0.75rem; }
  .chat-avatar {
    width: 34px; height: 34px; border-radius: 9999px;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    overflow: hidden;
    background-color: var(--surface-2);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--line-soft) 85%, transparent), 0 2px 8px rgba(0,0,0,0.12);
  }
  .chat-avatar--sm {
    width: 24px; height: 24px; border-radius: 9999px;
  }
  .chat-system {
    align-self: center;
    max-width: 85%;
    padding: 0.1rem 0.75rem;
    text-align: center;
    font-size: 12px;
    line-height: 1.4;
    color: var(--muted);
    word-break: break-word;
  }
  .chat-bubble {
    max-width: 85%; padding: 0.5rem 0.75rem; border-radius: 0.875rem;
    background: var(--surface-2); align-self: flex-start;
    content-visibility: auto;
    contain-intrinsic-size: auto 12rem auto 4rem;
  }
  :global(.dark) .chat-bubble { background: rgba(20, 31, 18, 0.5); }
  .chat-bubble--mine {
    align-self: flex-end;
    background: oklch(0.7019 0.1577 160.44 / 0.12);
  }
  :global(.dark) .chat-bubble--mine { background: oklch(0.7019 0.1577 160.44 / 0.15); }
  .chat-bubble--menu { content-visibility: visible; position: relative; z-index: 5; }
  .chat-bubble--highlight { box-shadow: 0 0 0 2px var(--accent-line); }
  .chat-reply-bar { padding: 0.4rem 0.75rem 0; }
  .chat-schedule-list {
    display: grid;
    gap: 0.35rem;
    padding: 0.5rem 0.75rem 0;
  }
  .chat-schedule-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.45rem 0.65rem;
    border-radius: 0.55rem;
    border: 1px solid var(--line-soft);
    background: var(--surface-2, oklch(0.97 0.01 150));
  }
  :global(.dark) .chat-schedule-item {
    background: oklch(0.22 0.02 150 / 0.55);
  }
  .chat-schedule-item__body {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 0.1rem;
  }
  .chat-schedule-item__when {
    font-size: 0.7rem;
    font-weight: 800;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .chat-schedule-item__text {
    font-size: 0.85rem;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chat-sender-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-bottom: 2px;
  }
  .chat-sender { font-size: 12px; font-weight: 700; display: block; overflow-wrap: anywhere; }
  .chat-once-badge {
    display: inline-flex;
    align-items: center;
    padding: 0.05rem 0.4rem;
    border-radius: 0.35rem;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--accent);
    background: oklch(0.7019 0.1577 160.44 / 0.12);
  }
  .chat-once-reveal {
    position: relative;
    display: block;
    width: 100%;
    margin-top: 0.15rem;
    padding: 0.65rem 0.75rem;
    border-radius: 0.55rem;
    border: 1px dashed color-mix(in srgb, var(--accent) 35%, var(--line-soft));
    background: oklch(0.7019 0.1577 160.44 / 0.06);
    text-align: left;
    overflow: hidden;
  }
  .chat-once-reveal__blur {
    display: block;
    filter: blur(7px);
    user-select: none;
    color: var(--muted);
    font-size: 14px;
    line-height: 1.4;
    max-height: 3.2em;
    overflow: hidden;
  }
  .chat-once-reveal__label {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 800;
    color: var(--accent);
  }
  .chat-once-note {
    margin-top: 0.35rem;
    font-size: 11px;
    color: var(--muted);
  }
  .chat-text {
    font-size: 15px; line-height: 1.5; color: var(--muted); word-break: break-word;
  }
  :global(.dark) .chat-text { color: var(--text); }
  .chat-timer {
    position: relative; width: 32px; height: 32px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
  }
  .chat-timer__ring {
    position: absolute; inset: 0; width: 100%; height: 100%;
    color: var(--accent);
  }
  .chat-timer__num {
    font-size: 0.75rem; font-weight: 700; color: var(--muted);
    position: relative; z-index: 1;
  }
  .chat-text :global(strong) { font-weight: 700; }
  .chat-text :global(em) { font-style: italic; }
  .chat-text :global(del) { text-decoration: line-through; opacity: 0.6; }
  .chat-text :global(.chat-code-inline) {
    font-family: var(--font-mono); font-size: 13px;
    background: oklch(0.7019 0.1577 160.44 / 0.08); border-radius: 4px;
    padding: 2px 5px;
  }
  :global(.dark) .chat-text :global(.chat-code-inline) {
    background: oklch(0.7019 0.1577 160.44 / 0.12);
  }
  .chat-text :global(.chat-code-block) {
    font-family: var(--font-mono); font-size: 13px;
    background: rgba(0, 0, 0, 0.04); border-radius: 8px;
    padding: 8px 10px; margin: 6px 0; overflow-x: auto;
    white-space: pre-wrap; word-break: break-all;
  }
  :global(.dark) .chat-text :global(.chat-code-block) {
    background: rgba(255, 255, 255, 0.05);
  }
  .chat-text :global(.chat-spoiler) {
    background: var(--line); color: transparent; border-radius: 3px;
    padding: 0 3px; cursor: pointer; transition: all 0.2s;
  }
  .chat-text :global(.chat-spoiler.revealed) {
    background: oklch(0.7019 0.1577 160.44 / 0.1); color: inherit;
  }
  .chat-text :global(.chat-quote) {
    border-left: 3px solid oklch(0.7019 0.1577 160.44 / 0.4);
    padding-left: 8px; margin: 2px 0;
    color: var(--muted);
  }
  .chat-typing {
    height: 1.5rem; flex: none;
    font-size: 12px; color: var(--muted); padding: 0 1.25rem;
    display: flex; align-items: center; gap: 0.4rem;
    overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  }
  .chat-avatar--xs { width: 16px; height: 16px; box-shadow: none; }
  .chat-avatar--lg { width: 48px; height: 48px; }
  .chat-profile__avatar { display: flex; align-items: center; gap: 0.75rem; }
  .chat-wrong-password {
    display: flex; align-items: center; gap: 0.4rem;
    font-size: 0.75rem; color: var(--danger);
    padding: 0.5rem 0.75rem; margin-top: 0.25rem;
    border-radius: 0.5rem;
    background: rgba(239, 68, 68, 0.08);
  }
  .chat-file-error {
    display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
    padding: 0.375rem 0.75rem 0.375rem 1rem;
    border-top: 1px solid color-mix(in srgb, var(--danger) 20%, transparent);
    background: var(--danger-weak);
    color: var(--danger);
    font-size: 0.875rem;
  }
  .chat-upload-line {
    font-size: 11px;
    color: var(--muted);
  }
  .chat-upload-progress {
    padding: 0.5rem 0.75rem 0;
  }
  .chat-upload-progress :global(.status) {
    margin: 0;
  }
  .chat-preview-img {
    max-width: 100%; max-height: 240px;
    border-radius: 0.5rem; margin-top: 0.25rem;
    object-fit: contain;
  }
  .chat-preview-text {
    margin-top: 0.25rem; border-radius: 0.4rem; overflow: hidden;
    border: 1px solid var(--line-soft);
  }
  :global(.dark) .chat-preview-text {
    border-color: var(--text);
  }
  .chat-preview-code {
    margin: 0; padding: 0.5rem 0.6rem;
    font-family: var(--font-mono); font-size: 12px; line-height: 1.5;
    white-space: pre-wrap; word-break: break-all;
    color: var(--muted); background: var(--surface-2);
    max-height: 200px; overflow-y: auto;
  }
  :global(.dark) .chat-preview-code {
    color: var(--muted);
    background: rgba(7, 11, 6, 0.5);
  }
  .chat-preview-expand {
    display: block; width: 100%; padding: 0.3rem;
    font-size: 0.75rem; font-weight: 600; text-align: center;
    color: var(--accent);
    background: var(--surface-2);
    border-top: 1px solid var(--line-soft);
  }
  :global(.dark) .chat-preview-expand {
    background: rgba(7, 11, 6, 0.6);
    border-color: var(--text);
  }
  .chat-preview-expand:hover { background: oklch(0.7019 0.1577 160.44 / 0.08); }
  .chat-file {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.4rem 0.6rem; margin: 0.25rem 0;
    border-radius: 0.5rem;
    background: oklch(0.7019 0.1577 160.44 / 0.06);
    border: 1px solid oklch(0.7019 0.1577 160.44 / 0.12);
    color: var(--accent);
  }
  .chat-file--error {
    border-color: var(--danger);
    background: rgba(239, 68, 68, 0.06);
    color: var(--danger);
    opacity: 0.6;
  }
  .chat-file__name {
    font-size: 13px; font-weight: 600; display: block;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--muted);
  }
  :global(.dark) .chat-file__name { color: var(--text); }
  .chat-file__size { font-size: 0.75rem; color: var(--muted); }
  .chat-file__dl {
    padding: 0.25rem; border-radius: 0.35rem;
    color: var(--accent); transition: background 0.15s;
  }
  .chat-file__dl:hover { background: oklch(0.7019 0.1577 160.44 / 0.1); }
  .chat-whiteboard-card {
    display: flex;
    gap: 0.6rem;
    min-width: min(320px, 72vw);
    margin: 0.25rem 0;
    padding: 0.6rem;
    border-radius: 0.65rem;
    border: 1px solid oklch(0.7019 0.1577 160.44 / 0.16);
    background: linear-gradient(180deg, oklch(0.7019 0.1577 160.44 / 0.08), oklch(0.7019 0.1577 160.44 / 0.035));
  }
  :global(.dark) .chat-whiteboard-card {
    border-color: oklch(0.7019 0.1577 160.44 / 0.14);
    background: linear-gradient(180deg, oklch(0.7019 0.1577 160.44 / 0.12), oklch(0.7019 0.1577 160.44 / 0.055));
  }
  .chat-whiteboard-card__icon {
    width: 32px;
    height: 32px;
    border-radius: 0.55rem;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: var(--accent);
    background: oklch(0.7019 0.1577 160.44 / 0.12);
  }
  .chat-whiteboard-card__body {
    min-width: 0;
    flex: 1;
  }
  .chat-whiteboard-card__title {
    font-size: 13px;
    font-weight: 700;
    color: var(--text);
  }
  :global(.dark) .chat-whiteboard-card__title { color: var(--text); }
  .chat-whiteboard-card__meta {
    margin-top: 1px;
    font-size: 0.75rem;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chat-whiteboard-card__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.55rem;
  }
  .chat-whiteboard-card__btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 32px;
    padding: 0 0.65rem;
    border-radius: 0.45rem;
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--muted);
    background: rgba(255, 255, 255, 0.72);
    border: 1px solid var(--line-soft);
  }
  .chat-whiteboard-card__btn:hover {
    color: var(--accent);
    border-color: oklch(0.7019 0.1577 160.44 / 0.22);
  }
  .chat-whiteboard-card__btn--primary {
    color: white;
    background: var(--accent);
    border-color: var(--accent);
  }
  .chat-whiteboard-card__btn--primary:hover {
    color: white;
    background: oklch(0.60 0.14 160.44);
  }
  :global(.dark) .chat-whiteboard-card__btn {
    color: var(--text);
    background: rgba(20, 31, 18, 0.68);
    border-color: var(--muted);
  }
  :global(.dark) .chat-whiteboard-card__btn--primary {
    color: white;
    background: var(--accent);
    border-color: var(--accent);
  }
</style>
