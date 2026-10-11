<script lang="ts">
  import { archiveLegacyHistory, migrateRoomHistory } from '../../lib/chatHistory';
  import { stampPayload, validPayload } from '../../lib/chatProtocol';
  let verificationChallenge = '';
  const encryptMessage = (key: CryptoKey, text: string) => sealMessage(key, stampPayload(text, channelId));
  import { randomIndex } from "../../lib/random";
  import { roomCredentials, safeColor, ReplayWindow } from "../../lib/roomAccess";
  import { loadAlias, newAlias, parseAlias, aliasWire, aliasKey, aliasName, aliasColor, aliasGradient, gradientFor, type Alias } from "../../lib/alias";
  let accessToken = "";
  let channelId = "";
  const replay = new ReplayWindow();
  import { onMount, onDestroy } from 'svelte';
  import PartySocket from 'partysocket';
  import Whiteboard from './Whiteboard.svelte';
  import {
    deriveKeyFromPassword,
    encryptMessage as sealMessage, decryptMessage,
  } from '../../lib/chatCrypto';
  import { encryptData, decryptData, prependEclkMagic } from '../../lib/ghost/crypto';
  import ToolHelp from './ToolHelp.svelte';
  const chatHelpSections = ['what', 'messages', 'calls', 'files', 'safe', 'watchOut'];
  import { prepareSendUpload } from '../../lib/nologSend';
  import { t } from '../../lib/t';

  export let locale = 'en';
  export let roomId = '';
  export let partyHost = '';

  export let dict: Record<string, string>;

  type Message = {
    id: string;
    text: string;
    sender: string;
    initials: string;
    color: string;
    alias?: Alias;
    mine: boolean;
    time: number;
    ttl: number;
    remaining: number;
    file?: { name: string; size: number; urls: string[] };
    fileError?: boolean;
    preview?: { type: 'image' | 'text'; url?: string; text?: string; expanded?: boolean };
    revealed?: boolean;
    whiteboard?: WhiteboardInvite;
  };

  type ChatRoomMode = 'live' | 'ttl-10' | 'ttl-5';
  type ChatAuthMode = 'password' | 'fragment';

  type RoomConfig = {
    mode: ChatRoomMode;
    authMode: ChatAuthMode;
    createdAt: number;
  };

  type ChatPayload = {
    type?: string;
    id?: string;
    roomId?: string;
    password?: string;
    text?: string;
    sender?: string;
    color?: string;
    ttl?: number;
    file?: { name: string; size: number; urls?: string[]; url?: string };
    createdAt?: number;
  };

  type ServerEnvelope = {
    type: 'message';
    id?: string;
    payload: string;
    persist?: boolean;
    seq?: number;
    prevHash?: string;
    hash?: string;
    createdAt?: number;
    serverSeq?: number;
  };

  type HistoryEnvelope = {
    type: 'history';
    config?: RoomConfig | null;
    messages?: ServerEnvelope[];
  };

  type LiveSyncMessage = {
    id: string;
    text: string;
    sender: string;
    color: string;
    alias?: [number, number, number];
    time: number;
    file?: { name: string; size: number; urls: string[] };
  };

  type LocalHistoryEnvelope = Pick<ServerEnvelope, 'type' | 'id' | 'payload' | 'createdAt'>;

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
    volume: number;
    audioMuted: boolean;
    audioLevel: number;
    speaking: boolean;
  };

  type CallSignal = {
    type: 'call-signal';
    action: 'join' | 'presence' | 'offer' | 'answer' | 'ice' | 'leave' | 'media';
    callId: string;
    from: string;
    fromName: string;
    fromColor: string;
    fromAlias?: [number, number, number];
    to?: string;
    mode?: CallMode;
    reply?: boolean;
    sdp?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
    audio?: boolean;
    video?: boolean;
    screen?: boolean;
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

  type StreamMediaOptions = MediaStream | null | undefined | {
    stream: MediaStream | null | undefined;
    muted?: boolean;
    volume?: number;
    sinkId?: string;
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
  let cryptoKey: CryptoKey | null = null;
  const alias: Alias = typeof localStorage === 'undefined' ? newAlias() : loadAlias(roomId);
  const identity = { name: aliasName(dict, alias), color: aliasColor(alias) };

  function senderInfo(p: any, fallbackName = '', fallbackColor = '') {
    const al = parseAlias(p?.alias ?? p?.fromAlias) ?? undefined;
    const raw = typeof p?.sender === 'string' ? p.sender : typeof p?.fromName === 'string' ? p.fromName : '';
    const name = al ? aliasName(dict, al) : (raw.trim() || fallbackName || t(dict, 'chat.guest'));
    const color = al ? aliasColor(al) : safeColor(p?.color ?? p?.fromColor ?? fallbackColor);
    return { name, color, alias: al, initials: getInitials(name), key: al ? aliasKey(al) : name };
  }
  let messages: Message[] = [];
  let inputText = '';
  let connected = false;
  let verified = false;
  let verifying = false;
  let wrongPassword = false;
  let checkingRoom = false;
  let needsPassword = false;
  let passwordInput = '';
  let passwordError = '';
  let serverRawPresence = 0;
  let typing: { sender: string; initials: string; color: string; alias?: Alias } | null = null;
  let typingTimeout: ReturnType<typeof setTimeout>;
  let blurred = false;
  let roomConfig: RoomConfig = { mode: 'live', authMode: 'fragment', createdAt: 0 };
  let pendingRoomConfig: RoomConfig | null = null;
  let currentAuthAttempt: ChatAuthMode | null = null;
  let localHistoryKey = '';
  let localHistoryLoaded = false;
  const seenMessageIds = new Set<string>();
  let decryptFailCount = 0;
  let onlineUsers: { key: string; name: string; initials: string; color: string; alias?: Alias }[] = [];
  let lastWrongPasswordNotice = 0;
  let uploading = false;
  let fileInputEl: HTMLInputElement;
  let sharePassword = '';
  let shareCopiedLink = false;
  let shareCopiedPass = false;
  let shareDismissed = false;
  let clientId = '';
  let callActive = false;
  let callJoining = false;
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
  let callDebugEnabled = false;
  let callDebugEvents: CallDebugEvent[] = [];
  let localAudioLevel = 0;
  let localSpeaking = false;
  let blurCallMediaWhenAway = true;
  let audioInputDevices: MediaDeviceInfo[] = [];
  let videoInputDevices: MediaDeviceInfo[] = [];
  let audioOutputDevices: MediaDeviceInfo[] = [];
  let selectedAudioInputId = '';
  let selectedVideoInputId = '';
  let selectedAudioOutputId = '';
  let canSelectAudioOutput = false;
  let serverLatencyMs: number | null = null;
  let serverQuality: ServerQuality = 'unknown';
  let lastServerPongAt = 0;
  let serverConnectStartedAt = 0;
  let serverName = 'encrypt-1';
  let serverRegion = 'AMS-NL';
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
  let callFullscreenOverlayEl: HTMLDivElement;
  let callFullscreenNativeActive = false;
  let callMediaSessionHandlersActive = false;
  let composerMenuOpen = false;
  let activeWhiteboard: WhiteboardInvite | null = null;

  const MAX_FILE = 50 * 1024 * 1024;
  const TEXT_AS_FILE_LIMIT = 2000;
  const MAX_SDP_CHARS = 96_000;
  const MAX_ICE_CANDIDATE_CHARS = 4096;
  const MAX_PENDING_ICE_PER_PEER = 64;
  const LOCAL_HISTORY_LIMIT = 1000;
  const LOCAL_HISTORY_PREFIX = 'encrypt.click:chat-history:v3:';
  const CALL_DEBUG_STORAGE_KEY = 'encrypt.click:call-debug';
  const FIRST_PARTY_UPLOAD_URL = 'https://upload.encrypt.click';
  const FIRST_PARTY_DOWNLOAD_BASE_URL = 'https://dl.encrypt.click';
  const SERVER_FALLBACK_NAME = 'encrypt-1';
  const SERVER_FALLBACK_REGION = 'AMS-NL';
  const CALL_ID = `call:${roomId}`;
  const callPeerMap = new Map<string, CallPeer>();
  const pendingIce = new Map<string, RTCIceCandidateInit[]>();
  let lastRelayDebugKey = '';
  let localAudioMonitor: AudioLevelMonitor | null = null;
  const peerAudioMonitors = new Map<string, AudioLevelMonitor>();
  let relayStatsInterval: ReturnType<typeof setInterval> | undefined;
  let tickInterval: ReturnType<typeof setInterval>;
  let messagesEl: HTMLElement;

  $: myInitials = getInitials(identity.name);

  function getInitials(name: string): string {
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }

  function shuffleArr<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function parseMarkdown(text: string): string {
    let html = esc(text);
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre class="chat-code-block"><code>${code.trim()}</code></pre>`);
    html = html.replace(/`([^`]+)`/g, '<code class="chat-code-inline">$1</code>');
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
    html = html.replace(/(?<!\w)\*(.+?)\*(?!\w)/g, '<em>$1</em>');
    html = html.replace(/(?<!\w)_(.+?)_(?!\w)/g, '<em>$1</em>');
    html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
    // Spoiler clicks are delegated through a Svelte action, so chat text never injects handlers.
    html = html.replace(/\|\|(.+?)\|\|/g, '<span class="chat-spoiler" data-chat-spoiler role="button" tabindex="0">$1</span>');
    html = html.replace(/(^|\n)&gt; (.+)/g, '$1<blockquote class="chat-quote">$2</blockquote>');
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  function revealSpoilers(node: HTMLElement) {
    function toggleSpoiler(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) return false;
      const spoiler = target.closest<HTMLElement>('[data-chat-spoiler]');
      if (!spoiler || !node.contains(spoiler)) return false;
      spoiler.classList.toggle('revealed');
      return true;
    }

    function handleClick(event: MouseEvent) {
      toggleSpoiler(event.target);
    }

    function handleKeydown(event: KeyboardEvent) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (toggleSpoiler(event.target)) event.preventDefault();
    }

    node.addEventListener('click', handleClick);
    node.addEventListener('keydown', handleKeydown);
    return {
      destroy() {
        node.removeEventListener('click', handleClick);
        node.removeEventListener('keydown', handleKeydown);
      },
    };
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  function getStreamMediaOptions(options: StreamMediaOptions) {
    if (options && typeof options === 'object' && 'stream' in options) {
      return options;
    }
    return { stream: options };
  }

  function applyStreamMediaOptions(node: HTMLMediaElement, options: StreamMediaOptions) {
    const next = getStreamMediaOptions(options);
    if (node.srcObject !== next.stream) node.srcObject = next.stream ?? null;
    if (typeof next.muted === 'boolean') node.muted = next.muted;
    if (typeof next.volume === 'number') node.volume = Math.max(0, Math.min(1, next.volume));
    applyAudioOutputDevice(node, next.sinkId);
    ensureMediaElementPlaying(node);
  }

  function supportsAudioOutputSelection(): boolean {
    if (typeof HTMLMediaElement === 'undefined') return false;
    return 'setSinkId' in HTMLMediaElement.prototype;
  }

  function applyAudioOutputDevice(node: HTMLMediaElement, sinkId: string | undefined) {
    if (!supportsAudioOutputSelection()) return;
    const outputNode = node as HTMLMediaElement & { setSinkId?: (sinkId: string) => Promise<void>; sinkId?: string };
    const nextSink = sinkId || '';
    if (!outputNode.setSinkId || outputNode.sinkId === nextSink) return;
    void outputNode.setSinkId(nextSink).catch(() => {});
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

  function setCallMediaSessionHandlers(enabled: boolean) {
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

  function streamMedia(node: HTMLMediaElement, options: StreamMediaOptions) {
    applyStreamMediaOptions(node, options);
    return {
      update(next: StreamMediaOptions) {
        applyStreamMediaOptions(node, next);
      },
      destroy() {
        node.srcObject = null;
      },
    };
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
    if (host === 'turn.encrypt.click' || host.endsWith('.encrypt.click')) return 'encrypt-1';
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
      if (callActive && Date.now() >= iceServersExpiresAt) void loadIceServers().catch(() => {});
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
    const lines = description.sdp.split('\r\n').filter((line) => {
      if (!line.startsWith('a=candidate:')) return true;
      return isRelayCandidateString(line);
    });
    return { type: description.type, sdp: lines.join('\r\n') };
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
      iceServersExpiresAt = iceServersFetchedAt + Math.max(30, (data.ttl ?? 300) - 60) * 1000;
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

  async function sendEncryptedControl(payload: Record<string, unknown>, idPrefix: string) {
    if (!cryptoKey || !ws || ws.readyState !== 1) return;
    const encrypted = await encryptMessage(cryptoKey, JSON.stringify(payload));
    ws.send(JSON.stringify({ type: 'message', payload: encrypted, id: `${idPrefix}-${genId()}` }));
  }

  async function sendCallSignal(partial: Partial<CallSignal>) {
    if (!clientId) return;
    const signal: CallSignal = {
      type: 'call-signal',
      action: partial.action ?? 'media',
      callId: CALL_ID,
      from: clientId,
      fromName: identity.name,
      fromColor: identity.color,
      fromAlias: aliasWire(alias),
      mode: 'audio',
      audio: !micMuted,
      video: screenSharing || !cameraOff,
      screen: screenSharing,
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
    await sendEncryptedControl(signal as unknown as Record<string, unknown>, 'call');
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

  const MODE_LABELS: Record<ChatRoomMode, string> = {
    live: 'chat.modeLabelLive',
    'ttl-10': 'chat.modeLabelTtl10',
    'ttl-5': 'chat.modeLabelTtl5',
  };

  function getRoomTtlSeconds(): number {
    if (roomConfig.mode === 'ttl-10') return 10;
    if (roomConfig.mode === 'ttl-5') return 5;
    return 0;
  }

  function shouldKeepParticipantHistory(): boolean {
    return roomConfig.mode === 'live';
  }

  function genId(): string {
    const arr = crypto.getRandomValues(new Uint8Array(8));
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  }

  function genAutoPassword(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const arr = crypto.getRandomValues(new Uint8Array(20));
    const chars = Array.from(arr, b => alphabet[b % alphabet.length]);
    return [0, 5, 10, 15].map(i => chars.slice(i, i + 5).join('')).join('-');
  }

  function genWhiteboardRoomId(): string {
    const base = `chat-${roomId || 'room'}-${genId()}`.toLowerCase();
    return base.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 80).replace(/^-|-$/g, '');
  }

  function getLocalePrefix(): string {
    return locale && locale !== 'en' ? `/${locale}` : '';
  }

  function normalizeChatRoomMode(value: unknown): ChatRoomMode {
    if (value === 'live' || value === 'ttl-10' || value === 'ttl-5') return value;
    if (value === 'burn') return 'ttl-10';
    return 'live';
  }

  function isChatAuthMode(value: unknown): value is ChatAuthMode {
    return value === 'password' || value === 'fragment';
  }

  function normalizeRoomConfig(input: unknown): RoomConfig | null {
    if (!input || typeof input !== 'object') return null;
    const value = input as Partial<RoomConfig>;
    if (!isChatAuthMode(value.authMode)) return null;
    return {
      mode: normalizeChatRoomMode(value.mode),
      authMode: value.authMode,
      createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
    };
  }

  function applyRoomConfig(input: unknown): RoomConfig | null {
    const normalized = normalizeRoomConfig(input);
    if (normalized) roomConfig = normalized;
    return normalized;
  }

  function getRoomModeLabel(): string {
    return t(dict, MODE_LABELS[roomConfig.mode]);
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

  async function buildLocalHistoryKey(password: string): Promise<string> {
    const key = `${LOCAL_HISTORY_PREFIX}${roomId}:${channelId}`;
    try {
      archiveLegacyHistory(localStorage);
      const legacyKey = await deriveKeyFromPassword(password, roomId, 200_000);
      await migrateRoomHistory(localStorage, roomId, key,
        async cipher => encryptMessage(cryptoKey!, await decryptMessage(legacyKey, cipher)), LOCAL_HISTORY_LIMIT);
    } catch { /* Storage may be disabled or full; chat remains usable. */ }
    return key;
  }

  function readLocalHistory(): LocalHistoryEnvelope[] {
    if (!localHistoryKey || typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem(localHistoryKey);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item): item is LocalHistoryEnvelope =>
          item?.type === 'message' &&
          typeof item.id === 'string' &&
          typeof item.payload === 'string'
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

  function storeLocalEnvelope(envelope: ServerEnvelope | LocalHistoryEnvelope) {
    if (!shouldKeepParticipantHistory() || !localHistoryKey || !envelope.id || !envelope.payload) return;
    const items = readLocalHistory();
    if (items.some((item) => item.id === envelope.id)) return;
    items.push({
      type: 'message',
      id: envelope.id,
      payload: envelope.payload,
      createdAt: typeof envelope.createdAt === 'number' ? envelope.createdAt : Date.now(),
    });
    writeLocalHistory(items);
  }

  async function storeLocalPayload(payload: ChatPayload, id: string, createdAt: number) {
    if (!cryptoKey || !shouldKeepParticipantHistory()) return;
    const encrypted = await encryptMessage(cryptoKey, JSON.stringify({ ...payload, id, createdAt }));
    storeLocalEnvelope({ type: 'message', id, payload: encrypted, createdAt });
  }

  async function restoreLocalHistory() {
    if (localHistoryLoaded || !cryptoKey || !shouldKeepParticipantHistory()) return;
    localHistoryLoaded = true;
    const items = readLocalHistory();
    if (!items.length) return;
    for (const envelope of [...items].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))) {
      await processServerEnvelope(envelope as ServerEnvelope, true);
    }
    scrollToBottom();
  }

  function getWhiteboardUrl(invite: WhiteboardInvite): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://encrypt.click';
    return `${origin}${getLocalePrefix()}/whiteboard/${encodeURIComponent(invite.roomId)}`;
  }

  function normalizeWhiteboardInvite(parsed: any): WhiteboardInvite | null {
    if (!parsed || typeof parsed.roomId !== 'string' || typeof parsed.password !== 'string') return null;
    if (!parsed.roomId.trim() || !parsed.password.trim()) return null;
    const who = senderInfo(parsed, '', 'var(--accent)');
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
    scrollToBottom();
  }

  async function createWhiteboardInvite() {
    if (!cryptoKey || !ws || !connected || !verified) return;
    composerMenuOpen = false;

    const invite: WhiteboardInvite = {
      roomId: genWhiteboardRoomId(),
      password: genAutoPassword(),
      sender: identity.name,
      color: identity.color,
      alias,
      createdAt: Date.now(),
    };
    const msgId = `whiteboard-${genId()}`;
    const payload: ChatPayload = {
      type: 'whiteboard-invite',
      id: msgId,
      roomId: invite.roomId,
      password: invite.password,
      sender: invite.sender,
      color: invite.color,
      createdAt: invite.createdAt,
    };
    const encrypted = await encryptMessage(cryptoKey, JSON.stringify(payload));
    ws.send(JSON.stringify({ type: 'message', payload: encrypted, id: msgId }));
    addWhiteboardInviteMessage(invite, msgId, true);
    activeWhiteboard = invite;
  }

  function getLiveSyncMessages(): LiveSyncMessage[] {
    if (roomConfig.mode !== 'live') return [];
    return messages
      .filter((msg) => !msg.whiteboard && msg.sender && (msg.text || msg.file))
      .slice(-200)
      .map((msg) => ({
        id: msg.id,
        text: msg.text,
        sender: msg.sender,
        color: msg.color,
        alias: msg.alias ? aliasWire(msg.alias) : undefined,
        time: msg.time || Date.now(),
        file: msg.file ? { name: msg.file.name, size: msg.file.size, urls: msg.file.urls } : undefined,
      }));
  }

  async function sendLiveHistorySync() {
    if (roomConfig.mode !== 'live') return;
    const syncMessages = getLiveSyncMessages();
    if (syncMessages.length === 0) return;
    await sendEncryptedControl({ type: 'chat-sync', messages: syncMessages }, 'sync');
  }

  async function applyLiveHistorySync(syncMessages: unknown) {
    if (roomConfig.mode !== 'live' || !Array.isArray(syncMessages)) return;
    const incoming: Message[] = [];
    for (const item of syncMessages as LiveSyncMessage[]) {
      if (!item?.id || seenMessageIds.has(item.id)) continue;
      const who = senderInfo(item, '', 'var(--accent)');
      const createdAt = item.time || Date.now();
      seenMessageIds.add(item.id);
      incoming.push({
        id: item.id,
        text: item.text || '',
        sender: who.name,
        initials: who.initials,
        alias: who.alias,
        color: who.color,
        mine: false,
        time: createdAt,
        ttl: 0,
        remaining: 0,
        file: item.file,
        revealed: true,
      });
      await storeLocalPayload({
        type: 'chat-message',
        id: item.id,
        text: item.text || '',
        sender,
        color: item.color || 'var(--accent)',
        ttl: 0,
        createdAt,
        file: item.file,
      }, item.id, createdAt);
    }
    if (incoming.length) {
      messages = [...messages, ...incoming].sort((a, b) => a.time - b.time);
      scrollToBottom();
    }
  }

  function openWhiteboardInline(invite: WhiteboardInvite) {
    composerMenuOpen = false;
    activeWhiteboard = invite;
  }

  function openWhiteboardNewTab(invite: WhiteboardInvite) {
    composerMenuOpen = false;
    const url = getWhiteboardUrl(invite);
    const child = typeof window !== 'undefined' ? window.open('about:blank', '_blank') : null;
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
    const fragmentKey = new URLSearchParams(location.hash.slice(1)).get('k');
    const stored = fragmentKey && /^[A-Za-z0-9_-]{43}$/.test(fragmentKey) ? fragmentKey : sessionStorage.getItem('chat-password');
    const sharePass = sessionStorage.getItem('chat-share-password');
    if (sharePass) {
      sharePassword = sharePass;
      sessionStorage.removeItem('chat-share-password');
    }
    if (stored) {
      sessionStorage.removeItem('chat-password');
      passwordInput = stored;
      await enterWithPassword(stored, { authMode: fragmentKey ? 'fragment' : pendingRoomConfig?.authMode || 'password' });
    } else {
      checkingRoom = false; needsPassword = true;
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

  async function submitPassword() {
    passwordError = '';
    if (!passwordInput.trim()) { passwordError = t(dict, 'chat.errorEnterPassword'); return; }
    await enterWithPassword(passwordInput.trim());
  }

  function retryAfterWrongPassword() {
    clearVerificationTimeout();
    clearRoomConfigWaitTimeout();
    wrongPassword = false;
    needsPassword = false;
    checkingRoom = true;
    currentAuthAttempt = null;
    passwordInput = '';
    passwordUsed = '';
    cryptoKey = null;
    verified = false;
    verifying = false;
    joinedRoom = false;
    ws?.close();
    ws = null;
    checkingRoom = false; needsPassword = true;
  }

  function clearVerificationTimeout() {
    if (!verificationTimeout) return;
    clearTimeout(verificationTimeout);
    verificationTimeout = undefined;
  }

  function clearRoomConfigWaitTimeout() {
    if (!roomConfigWaitTimeout) return;
    clearTimeout(roomConfigWaitTimeout);
    roomConfigWaitTimeout = undefined;
  }

  function markVerified() {
    clearVerificationTimeout();
    verified = true;
    verifying = false;
    wrongPassword = false;
    currentAuthAttempt = null;
  }

  function startPasswordVerification(activePeerCount: number) {
    clearVerificationTimeout();
    verifying = true;
    verified = false;
    wrongPassword = false;

    if (activePeerCount <= 0) {
      markVerified();
      return;
    }

    verificationTimeout = setTimeout(() => {
      if (verifying && !verified) {
        verifying = false;
        joinedRoom = false;
        if (currentAuthAttempt === 'fragment') {
          cryptoKey = null;
          passwordUsed = '';
          currentAuthAttempt = null;
          needsPassword = true;
        } else {
          wrongPassword = true;
          ws?.close();
        }
      }
    }, 4000);
  }

  async function announceJoined(activePeerCount?: number) {
    if (!cryptoKey || !ws || ws.readyState !== 1) return;

    joinedRoom = true;
    ws.send(JSON.stringify({ type: 'join', token: accessToken, config: pendingRoomConfig || roomConfig }));

    if (typeof activePeerCount === 'number') {
      startPasswordVerification(activePeerCount);
    } else {
      verifying = true;
      verified = false;
      wrongPassword = false;
    }

    verificationChallenge = crypto.randomUUID();
    const verifyPayload = await encryptMessage(cryptoKey, JSON.stringify({ type: 'verify', challenge: verificationChallenge, sender: identity.name, color: identity.color, alias: aliasWire(alias), clientId }));
    ws.send(JSON.stringify({ type: 'message', payload: verifyPayload, id: 'verify-' + genId() }));
  }

  async function enterWithPassword(pwd: string, options: { share?: boolean; activePeerCount?: number; authMode?: ChatAuthMode } = {}) {
    try {
      clearRoomConfigWaitTimeout();
      currentAuthAttempt = options.authMode || 'password';
      const access = await roomCredentials(pwd, roomId, 'chat');
      accessToken = access.token; channelId = access.channel;
      cryptoKey = await deriveKeyFromPassword(pwd, roomId);
      passwordUsed = pwd;
      localHistoryKey = await buildLocalHistoryKey(pwd);
      localHistoryLoaded = false;
      needsPassword = false;
      checkingRoom = false;
      if (options.share && !sharePassword) sharePassword = pwd;
      await restoreLocalHistory();
      if (ws && ws.readyState === 1) {
        await announceJoined(options.activePeerCount ?? serverPresence);
      } else {
        connectWs();
      }
    } catch {
      passwordError = t(dict, 'chat.errorDeriveKey');
      checkingRoom = false;
      needsPassword = true;
    }
  }

  async function enterRoomNameOnly(activePeerCount = 0) {
    checkingRoom = false; needsPassword = true;
  }

  function waitBrieflyForRoomConfig() {
    clearRoomConfigWaitTimeout();
    checkingRoom = true;
    needsPassword = false;
    verifying = false;
    roomConfigWaitTimeout = setTimeout(() => {
      roomConfigWaitTimeout = undefined;
      if (cryptoKey) return;
      checkingRoom = false;
      if (roomConfig.authMode === 'fragment') {
        void enterRoomNameOnly(serverPresence);
      } else {
        needsPassword = true;
      }
    }, 1200);
  }

  async function resolveRoomAccess(configKnown: boolean) {
    if (cryptoKey) return;
    clearRoomConfigWaitTimeout();
    checkingRoom = false;
    verifying = false;
    wrongPassword = false;

    if (roomConfig.authMode === 'password') {
      needsPassword = true;
      return;
    }

    if (configKnown || serverRawPresence <= 1) {
      await enterRoomNameOnly(serverPresence);
      return;
    }

    // A first peer may still be storing the room config. Wait for the
    // room-config broadcast before falling back to room-name-only access.
    waitBrieflyForRoomConfig();
  }

  let serverPresence = 0;
  let joinedRoom = false;

  let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
  let verificationTimeout: ReturnType<typeof setTimeout> | undefined;
  let roomConfigWaitTimeout: ReturnType<typeof setTimeout> | undefined;

  function connectWs() {
    verifying = true;
    wrongPassword = false;
    serverConnectStartedAt = Date.now();
    ws = new PartySocket({
      host: partyHost || window.location.host,
      room: channelId,
      minReconnectionDelay: 500,
      maxReconnectionDelay: 8000,
      reconnectionDelayGrowFactor: 1.4,
      connectionTimeout: 8000,
      maxRetries: Infinity,
    });
    ws.addEventListener('open', async () => {
      connected = true;
      recordServerLatencySample(serverConnectStartedAt);
      if (cryptoKey) await announceJoined();
      sendServerPing();
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
    ws.addEventListener('message', handleServerMessage);

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
      serverRawPresence = typeof data.rawPresence === 'number' ? data.rawPresence : serverPresence;
      serverName = data.server?.name || SERVER_FALLBACK_NAME;
      serverRegion = data.server?.location || SERVER_FALLBACK_REGION;
      const config = applyRoomConfig(data.config);
      if (!cryptoKey) {
        await resolveRoomAccess(Boolean(config));
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
      if (!cryptoKey && config) await resolveRoomAccess(true);
      return;
    }
    if (data.type === 'history') {
      const config = applyRoomConfig(data.config);
      if (!cryptoKey) {
        if (config) await resolveRoomAccess(true);
      } else {
        await processHistory(data as HistoryEnvelope);
      }
      return;
    }
    if (data.type === 'pong') {
      if (typeof data.t === 'number') {
        serverLatencyMs = Math.max(0, Date.now() - data.t);
        lastServerPongAt = Date.now();
      }
      serverName = data.server?.name || SERVER_FALLBACK_NAME;
      serverRegion = data.server?.location || SERVER_FALLBACK_REGION;
      updateServerQuality();
      return;
    }
    if (data.type === 'presence') {
      serverPresence = typeof data.count === 'number' ? data.count : 0;
      serverRawPresence = typeof data.rawCount === 'number' ? data.rawCount : serverPresence;
      if (cryptoKey && joinedRoom && verifying && !verified && serverPresence <= 1) {
        markVerified();
      }
      return;
    }
    if (data.type !== 'message') return;
    await processServerEnvelope(data as ServerEnvelope);
  }

  async function processHistory(history: HistoryEnvelope) {
    const historyMessages = Array.isArray(history.messages) ? history.messages : [];
    if (!historyMessages.length) {
      if (verifying && serverPresence <= 1) markVerified();
      return;
    }

    for (const envelope of [...historyMessages].sort((a, b) => (a.serverSeq || 0) - (b.serverSeq || 0))) {
      await processServerEnvelope(envelope, true);
    }
    if (verifying) markVerified();
    scrollToBottom();
  }

  async function processServerEnvelope(data: ServerEnvelope, fromHistory = false): Promise<boolean> {
    if (!cryptoKey) return false;


    try {
      const plaintext = await decryptMessage(cryptoKey, data.payload);
      const parsed = JSON.parse(plaintext) as ChatPayload & Record<string, any>;
      if (!validPayload(parsed, channelId, fromHistory)) return false;
      if (!replay.accept(parsed._id)) return true;
      if (!replay.accept(await sha256B64url(data.payload))) return true;
      if (typeof parsed.id === 'string' && seenMessageIds.has(parsed.id)) return true;
      if (typeof parsed.id === 'string') seenMessageIds.add(parsed.id);
      parsed.color = safeColor(parsed.color);

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
          const ack = await encryptMessage(cryptoKey, JSON.stringify({ type: 'verify-ack', challenge: parsed.challenge, sender: identity.name, color: identity.color, alias: aliasWire(alias), clientId }));
          ws.send(JSON.stringify({ type: 'message', payload: ack, id: 'vack-' + genId() }));
        }
        if (callActive) void sendCallSignal({ action: 'presence' });
        const joiner = senderInfo(parsed);
        addOnlineUser(joiner);
        void sendLiveHistorySync();
        messages = [...messages, {
          id: genId(), text: t(dict, 'chat.joinedRoom').replace('{name}', joiner.name), sender: '', initials: '→',
          color: 'var(--accent)', mine: false, time: Date.now(), ttl: 15, remaining: 15,
        }];
        scrollToBottom();
        return true;
      }

      if (parsed.type === 'verify-ack') {
        if (fromHistory || parsed.challenge !== verificationChallenge) return true;
        if (verifying) markVerified();
        addOnlineUser(senderInfo(parsed));
        return true;
      }

      if (parsed.type === 'chat-sync') {
        await applyLiveHistorySync(parsed.messages);
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
        await handleCallSignal(parsed as CallSignal);
        return true;
      }


      const id = parsed.id || genId();
      const ttl = parsed.ttl || 0;
      const who = senderInfo(parsed, '', 'var(--accent)');
      const msg: Message = {
        id,
        text: parsed.text || '',
        sender: who.name,
        initials: who.initials,
        alias: who.alias,
        color: who.color,
        mine: false,
        time: parsed.createdAt || Date.now(),
        ttl,
        remaining: ttl,
        file: parsed.file ? { name: parsed.file.name, size: parsed.file.size, urls: parsed.file.urls || (parsed.file.url ? [parsed.file.url] : []) } : undefined,
        revealed: true,
      };
      seenMessageIds.add(id);
      messages = [...messages, msg];
      typing = null;
      if (!fromHistory) scrollToBottom();
      if (!fromHistory) storeLocalEnvelope({ ...data, id });

      if (msg.file) autoPreview(msg);

      if (blurred) document.title = `(!) encrypt.click/chat`;
      return true;
    } catch {
      // One failed decrypt may be a peer with a different password; the init timeout decides.
      if (!fromHistory && verified && Date.now() - lastWrongPasswordNotice > 10000) {
        lastWrongPasswordNotice = Date.now();
        messages = [...messages, {
          id: genId(), text: t(dict, 'chat.someoneTriedJoin'), sender: '', initials: '!',
          color: 'rgb(239,68,68)', mine: false, time: Date.now(), ttl: 10, remaining: 10,
        }];
        scrollToBottom();
      }
      return false;
    }
  }

  async function sendMessage() {
    if (!inputText.trim() || !cryptoKey || !ws) return;

    const finalTtl = roomConfig.mode === 'live' ? 0 : getRoomTtlSeconds();
    const text = inputText.trim();
    const msgId = genId();
    const createdAt = Date.now();

    const payload: ChatPayload = {
      type: 'chat-message',
      id: msgId,
      text,
      sender: identity.name,
      color: identity.color,
      alias: aliasWire(alias),
      ttl: finalTtl,
      createdAt,
    };

    const encrypted = await encryptMessage(cryptoKey, JSON.stringify(payload));
    ws.send(JSON.stringify({
      type: 'message',
      payload: encrypted,
      id: msgId,
      persist: false,
      createdAt,
    }));
    storeLocalEnvelope({ type: 'message', payload: encrypted, id: msgId, createdAt });
    seenMessageIds.add(msgId);

    messages = [...messages, {
      id: msgId, text, sender: identity.name, initials: myInitials, alias,
      color: identity.color, mine: true, time: createdAt,
      ttl: finalTtl, remaining: finalTtl,
      revealed: true,
    }];

    inputText = '';
    scrollToBottom();
  }

  async function handleSend() {
    if (!cryptoKey || !ws || !connected) return;
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
    if (!file) return;
    if (file.size > MAX_FILE) return;
    sendFile(file);
    target.value = '';
  }

  async function sendFile(file: File) {
    if (!cryptoKey || !ws || uploading) return;
    uploading = true;

    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      const encrypted = await encryptData(buffer, passwordUsed, file.name);

      // First-party R2 upload first; Send and public hosts are fallbacks only.
      const uploadUrls: string[] = [];

      async function tryHost(svc: string, body: Uint8Array, headers: Record<string, string> = {}): Promise<string | null> {
        try {
          if (svc === 'eclk') {
            const res = await fetch(FIRST_PARTY_UPLOAD_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/octet-stream' },
              body: prependEclkMagic(body),
            });
            if (!res.ok) return null;
            const data = await res.json().catch(() => null);
            return data?.success && data?.id ? `${FIRST_PARTY_DOWNLOAD_BASE_URL}/${encodeURIComponent(data.id)}` : null;
          }

          const res = await fetch(`/api/ghost/upload?services=${svc}&stego=false&filename=ghost.bin`, {
            method: 'POST', body, headers,
          });
          if (!res.ok) return null;
          const data = await res.json();
          return data?.results?.[0]?.url || null;
        } catch { return null; }
      }

      const firstPartyUrl = encrypted.length + 4 <= MAX_FILE ? await tryHost('eclk', encrypted) : null;
      if (firstPartyUrl) uploadUrls.push(firstPartyUrl);

      if (uploadUrls.length === 0) try {
        const prepared = await prepareSendUpload(encrypted, 'ghost.bin', 'application/octet-stream');
        const sendUrl = await tryHost('nologsend', prepared.encryptedBytes, {
          'X-Send-Metadata': prepared.metadataB64,
          'X-Send-Auth': prepared.authHeader,
        });
        if (sendUrl) uploadUrls.push(`${sendUrl}#${prepared.secretB64}`);
      } catch {}

      if (uploadUrls.length === 0) {
        for (const svc of shuffleArr(['quax', 'x0at', 'tmpfile'])) {
          const url = await tryHost(svc, encrypted);
          if (url) { uploadUrls.push(url); break; }
        }
      }

      if (uploadUrls.length === 0) return;

      const fileTtl = roomConfig.mode === 'live' ? 0 : getRoomTtlSeconds();
      const msgId = genId();
      const createdAt = Date.now();
      const payload: ChatPayload = {
        type: 'chat-message',
        id: msgId,
        text: '',
        sender: identity.name,
        color: identity.color,
        alias: aliasWire(alias),
        ttl: fileTtl,
        createdAt,
        file: { name: file.name, size: file.size, urls: uploadUrls },
      };

      const encPayload = await encryptMessage(cryptoKey!, JSON.stringify(payload));
      ws!.send(JSON.stringify({
        type: 'message',
        payload: encPayload,
        id: msgId,
        persist: false,
        createdAt,
      }));
      storeLocalEnvelope({ type: 'message', payload: encPayload, id: msgId, createdAt });
      seenMessageIds.add(msgId);

      const ownMsg: Message = {
        id: msgId, text: '', sender: identity.name, initials: myInitials, alias,
        color: identity.color, mine: true, time: createdAt,
        ttl: fileTtl, remaining: fileTtl,
        file: { name: file.name, size: file.size, urls: uploadUrls },
        revealed: true,
      };
      messages = [...messages, ownMsg];
      scrollToBottom();
      autoPreview(ownMsg);
    } finally {
      uploading = false;
    }
  }

  async function downloadChatFile(msg: Message) {
    if (!msg.file || !passwordUsed) return;
    const { isSendUrl, decryptSendBlob } = await import('../../lib/nologSend');

    for (const fileUrl of msg.file.urls) {
      try {
        const res = await fetch(`/api/ghost/fetch?url=${encodeURIComponent(fileUrl)}`);
        if (!res.ok) continue;
        let bytes = new Uint8Array(await res.arrayBuffer());

        if (isSendUrl(fileUrl)) {
          bytes = await decryptSendBlob(bytes, fileUrl);
        }

        const { data, name } = await decryptData(bytes, passwordUsed);
        const blob = new Blob([data], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name || msg.file!.name;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
        return;
      } catch { continue; }
    }
    msg.fileError = true;
    messages = messages;
  }

  let passwordUsed = '';

  let typingSent = 0;
  async function handleTyping() {
    if (!ws || !connected || !cryptoKey) return;
    // No one to show the indicator to - skip the send, save a request.
    if (serverPresence <= 1) return;
    const now = Date.now();
    if (now - typingSent > 3000) {
      // Send typing indicator as encrypted message (no leaking to wrong-password users)
      const payload = await encryptMessage(cryptoKey, JSON.stringify({ type: 'typing', sender: identity.name, color: identity.color, alias: aliasWire(alias) }));
      ws.send(JSON.stringify({ type: 'message', payload, id: 'typing-' + genId() }));
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
    });

    const audioTrack = getCurrentOutgoingAudioTrack();
    const videoTrack = getCurrentOutgoingVideoTrack();
    const audioTransceiver = addCallTransceiver(pc, 'audio', audioTrack, audioTrack ? localStream : null);
    const videoTransceiver = addCallTransceiver(pc, 'video', videoTrack, getCallVideoStream(videoTrack));

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
      volume: 1,
      audioMuted: false,
      audioLevel: 0,
      speaking: false,
    };
    callPeerMap.set(peerId, peer);
    callDebug('peer created', {
      peer: shortPeerId(peerId),
      connectionState: pc.connectionState,
      iceConnectionState: pc.iceConnectionState,
      iceServers: describeIceServersForDebug(iceServers),
    });

    pc.ontrack = (event) => {
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
      void sendCallSignal({
        action: 'ice',
        to: peerId,
        candidate: event.candidate.toJSON(),
      });
    };

    pc.onconnectionstatechange = () => {
      const current = callPeerMap.get(peerId);
      if (!current) return;
      current.state = pc.connectionState;
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
      syncCallPeers();
      void refreshRelayStats();
    };

    syncCallPeers();
    void refreshRelayStats();
    return peer;
  }

  function removeCallPeer(peerId: string) {
    const peer = callPeerMap.get(peerId);
    if (!peer) return;
    peer.pc.close();
    callPeerMap.delete(peerId);
    pendingIce.delete(peerId);
    stopPeerAudioMonitor(peerId);
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

  async function createAndSendOffer(peer: CallPeer, waitForStable = false) {
    if (peer.makingOffer) return;
    if (peer.pc.signalingState !== 'stable') {
      if (!waitForStable || !(await waitForStableSignaling(peer.pc))) return;
    }
    peer.makingOffer = true;
    try {
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      const sdp = sanitizeRelayDescription(peer.pc.localDescription);
      if (!sdp) throw new Error(t(dict, 'chat.callConnectionFailed'));
      await sendCallSignal({
        action: 'offer',
        to: peer.id,
        sdp,
      });
    } catch (e: any) {
      callError = e?.message || t(dict, 'chat.callConnectionFailed');
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
    try {
      if (peer.pc.signalingState !== 'stable') {
        await peer.pc.setLocalDescription({ type: 'rollback' } as RTCSessionDescriptionInit).catch(() => {});
      }
      await peer.pc.setRemoteDescription(remoteSdp);
      await flushPendingIce(signal.from);
      await applyPeerOutgoingTracks(peer);
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
      await peer.pc.setRemoteDescription(remoteSdp);
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
      showActiveCallNotice();
      return;
    }

    if (signal.action === 'join') {
      if (!callActive) {
        showActiveCallNotice();
        return;
      }

      const peer = ensureCallPeer(signal.from, senderInfo(signal).name, senderInfo(signal).color, senderInfo(signal).alias);
      peer.muted = signal.audio === false;
      peer.cameraOff = signal.video === false;
      peer.screenSharing = signal.screen === true;
      syncCallPeers();

      if (!signal.reply && clientId > signal.from) {
        await sendCallSignal({ action: 'join', to: signal.from, reply: true });
      }
      if (clientId < signal.from) await createAndSendOffer(peer);
      return;
    }

    if (signal.action === 'leave') {
      if (callActive) removeCallPeer(signal.from);
      if (activeCallNotice?.from === signal.from) activeCallNotice = null;
      return;
    }

    if (!callActive) {
      if (signal.action === 'offer') showActiveCallNotice();
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

  function stopLocalTracks(kind: 'audio' | 'video') {
    if (!localStream) return;
    const tracks = kind === 'audio' ? localStream.getAudioTracks() : localStream.getVideoTracks();
    if (kind === 'audio') stopLocalAudioMonitor();
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
      peer.audioSender = peer.pc.addTrack(audioTrack, localStream);
      needsOffer = true;
    }

    needsOffer = setCallTransceiverDirection(peer.videoTransceiver, Boolean(videoTrack)) || needsOffer;
    const videoStream = getCallVideoStream(videoTrack);
    if (peer.videoSender) {
      await peer.videoSender.replaceTrack(videoTrack);
    } else if (peer.videoTransceiver) {
      peer.videoSender = peer.videoTransceiver.sender;
      await peer.videoSender.replaceTrack(videoTrack);
    } else if (videoTrack && videoStream) {
      peer.videoSender = peer.pc.addTrack(videoTrack, videoStream);
      needsOffer = true;
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
        peer.audioSender = peer.pc.addTrack(track, stream);
        renegotiations.push(createAndSendOffer(peer, true));
      }

      if (needsOffer) renegotiations.push(createAndSendOffer(peer, true));
    }

    await Promise.all(renegotiations);
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
        peer.videoSender = peer.pc.addTrack(track, stream);
        renegotiations.push(createAndSendOffer(peer, true));
      }

      if (needsOffer) renegotiations.push(createAndSendOffer(peer, true));
    }

    await Promise.all(renegotiations);
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
      localStream = new MediaStream();
      micMuted = true;
      cameraOff = true;
      callAudioMuted = false;
      callActive = true;
      updateRelayQuality();
      startRelayStatsMonitor();
      await refreshDevices();
      callDebug('call started', {
        audioInputs: audioInputDevices.length,
        videoInputs: videoInputDevices.length,
        audioOutputs: audioOutputDevices.length,
      });
      await sendCallSignal({ action: 'join', reply: false });
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
    for (const peer of callPeerMap.values()) peer.pc.close();
    callPeerMap.clear();
    pendingIce.clear();
    callPeers = [];
    stopAllAudioMonitors();
    stopRelayStatsMonitor();
    if (localStream) {
      for (const track of localStream.getTracks()) track.stop();
    }
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
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error(t(dict, 'chat.callMicrophoneStartFailed'));

      stopLocalTracks('audio');
      ensureLocalStream().addTrack(track);
      touchLocalStream();
      micMuted = false;
      callError = '';

      const deviceId = track.getSettings().deviceId;
      if (deviceId) selectedAudioInputId = deviceId;
      track.onended = () => {
        micMuted = true;
        stopLocalAudioMonitor();
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

  async function setBlurCallMediaWhenAway(nextBlur: boolean) {
    blurCallMediaWhenAway = nextBlur;
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
    blurred = document.hidden || !document.hasFocus();
    if (!blurred) {
      document.title = 'encrypt.click/chat';
      sendServerPing();
    }
  }

  const IMAGE_EXTS = new Set(['png','jpg','jpeg','gif','webp','svg','bmp','ico']);
  const TEXT_EXTS = new Set(['txt','md','json','csv','log','xml','yaml','yml','toml','ini','env','cfg','conf','html','css','js','ts','py','sh','sql','go','rs','c','h','cpp','java','rb','php','swift','kt']);
  const PREVIEW_TEXT_LIMIT = 500;

  function getFileExt(name: string): string {
    return name.split('.').pop()?.toLowerCase() ?? '';
  }

  async function autoPreview(msg: Message) {
    if (!msg.file || !passwordUsed) return;
    const ext = getFileExt(msg.file.name);

    if (!IMAGE_EXTS.has(ext) && !TEXT_EXTS.has(ext)) return;

    const { isSendUrl, decryptSendBlob } = await import('../../lib/nologSend');

    for (const fileUrl of msg.file.urls) {
      try {
        const res = await fetch(`/api/ghost/fetch?url=${encodeURIComponent(fileUrl)}`);
        if (!res.ok) continue;
        let bytes = new Uint8Array(await res.arrayBuffer());
        if (isSendUrl(fileUrl)) bytes = await decryptSendBlob(bytes, fileUrl);
        const { data } = await decryptData(bytes, passwordUsed);

        if (IMAGE_EXTS.has(ext)) {
          const mimeMap: Record<string, string> = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', svg:'image/svg+xml', bmp:'image/bmp', ico:'image/x-icon' };
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

  function addOnlineUser(user: { key: string; name: string; color: string; alias?: Alias; initials: string }) {
    if (!onlineUsers.find(u => u.key === user.key)) {
      onlineUsers = [...onlineUsers, user];
    }
  }

  function tick() {
    const now = Date.now();
    let changed = false;
    const alive: Message[] = [];
    for (const msg of messages) {
      if (!msg.ttl || msg.ttl <= 0) { alive.push(msg); continue; }
      if (msg.time === 0) { alive.push(msg); continue; }
      const elapsed = (now - msg.time) / 1000;
      const rem = Math.max(0, msg.ttl - elapsed);
      if (rem <= 0) { changed = true; continue; }
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
  });

  onDestroy(() => {
    if (callActive) void sendCallSignal({ action: 'leave' });
    cleanupCall();
    setCallMediaSessionHandlers(false);
    ws?.close();
    clearInterval(tickInterval);
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    clearVerificationTimeout();
    clearRoomConfigWaitTimeout();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibility);
      document.removeEventListener('fullscreenchange', handleNativeFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleNativeFullscreenChange);
      window.removeEventListener('keydown', handleCallFullscreenKeydown);
      window.removeEventListener('blur', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
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

<div class="chat-container">
  {#if wrongPassword}
    <div class="chat-center">
      <div class="space-y-4 max-w-xs w-full text-center">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mx-auto text-red-500"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <p class="status status--error" role="alert">{t(dict, 'chat.wrongPassword')}</p>
        <p class="hint">{t(dict, 'chat.wrongPasswordDetail')}</p>
        <button type="button" class="btn-secondary w-full" on:click={retryAfterWrongPassword}>{t(dict, 'chat.tryAgain')}</button>
      </div>
    </div>

  {:else if checkingRoom}
    <div class="chat-center">
      <div class="text-center space-y-2">
        <svg class="animate-spin mx-auto h-6 w-6 text-emerald-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
        <p class="hint">{t(dict, 'common.working')}</p>
      </div>
    </div>

  {:else if needsPassword}
    <div class="chat-center">
      <div class="space-y-4 max-w-xs w-full">
        <div class="text-center space-y-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mx-auto text-emerald-500"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
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

  {:else if verifying}
    <div class="chat-center">
      <div class="text-center space-y-2">
        <svg class="animate-spin mx-auto h-6 w-6 text-emerald-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
        <p class="hint">{serverPresence > 1 ? t(dict, 'chat.verifyingPassword') : t(dict, 'chat.verifyingAlone')}</p>
      </div>
    </div>

  {:else}
    <div class="chat-header">
      <div class="flex items-center gap-2">
        <span class="chat-status" class:chat-status--connected={connected}></span>
        <div class="flex items-center -space-x-1.5">
          <div class="chat-avatar chat-avatar--sm" style="background: {aliasGradient(alias)}" title={identity.name}>{myInitials}</div>
          {#each onlineUsers as user}
            <div class="chat-avatar chat-avatar--sm" style="background: {gradientFor(user.alias, user.name)}" title={user.name}>{user.initials}</div>
          {/each}
        </div>
      </div>
      <div class="flex items-center gap-1.5">
        <span class="sr-only" aria-live="polite">{connected ? t(dict, 'chat.connected') : t(dict, 'chat.connecting')}</span>
        <button type="button" class="btn-ghost btn-sm chat-copy-link" on:click={copyShareLink} aria-label={t(dict, 'chat.copyRoomLink')}>
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          <span>{shareCopiedLink ? t(dict, 'common.copied') : t(dict, 'chat.copyRoomLink')}</span>
        </button>
        <ToolHelp dict={dict} prefix="chat" sections={chatHelpSections} />
        <button type="button" class="btn-ghost btn-sm btn-icon" title={t(dict, 'chat.callStart')} aria-label={t(dict, 'chat.callStart')} on:click={startCall} disabled={!connected || !verified || callJoining || callActive}>
          {#if callJoining}
            <svg class="animate-spin" xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
          {:else}
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.91.33 1.8.62 2.65a2 2 0 0 1-.45 2.11L8 9.76a16 16 0 0 0 6.24 6.24l1.28-1.28a2 2 0 0 1 2.11-.45c.85.29 1.74.5 2.65.62A2 2 0 0 1 22 16.92Z"/></svg>
          {/if}
        </button>
        <span class="chat-mode-badge" title={getRoomModeLabel()}>{getRoomModeLabel()}</span>
      </div>
    </div>

    {#if sharePassword && !shareDismissed}
      <div class="chat-share-banner">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-bold text-accent">{t(dict, 'chat.sharePasswordWarning')}</span>
          <button type="button" class="btn-ghost btn-sm btn-icon" on:click={() => { shareDismissed = true; }} aria-label={t(dict, 'chat.closeSharePanel')}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="flex items-center gap-1.5 mb-1.5">
          <span class="shrink-0 whitespace-nowrap text-sm text-muted">{t(dict, 'chat.roomLink')}</span>
          <code class="chat-share-value">{typeof window !== 'undefined' ? window.location.href : ''}</code>
          <button type="button" class="chat-share-copy" on:click={copyShareLink} aria-label={t(dict, 'chat.copyRoomLink')}>
            {#if shareCopiedLink}
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-500"><polyline points="20 6 9 17 4 12"/></svg>
            {:else}
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            {/if}
          </button>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="shrink-0 whitespace-nowrap text-sm text-muted">{t(dict, 'chat.password')}</span>
          <code class="chat-share-value">{sharePassword}</code>
          <button type="button" class="chat-share-copy" on:click={copySharePassword} aria-label={t(dict, 'chat.copyRoomPassword')}>
            {#if shareCopiedPass}
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-500"><polyline points="20 6 9 17 4 12"/></svg>
            {:else}
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            {/if}
          </button>
        </div>
      </div>
    {/if}

    {#if activeCallNotice && !callActive}
      <div class="chat-call-banner">
        <div class="chat-call-banner__meta">
          <div class="chat-avatar chat-avatar--sm" style="background: {gradientFor(activeCallNotice.alias, activeCallNotice.name)}">{getInitials(activeCallNotice.name)}</div>
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

    <div class="chat-body" class:chat-body--call={callActive} class:chat-body--call-settings={callActive && callSettingsOpen}>
      {#if callActive || callError}
        <div class="call" class:call--error={!callActive && Boolean(callError)}>
          {#if callActive}
            <div class="call__stage">
              <div class="call__status" title={`${t(dict, 'chat.callServer')}: ${serverName} ${serverRegion} · ${getRelayTitle()}`}>
                <span class="call__dot call__dot--{serverQuality}"></span>
                <span>{callHasScreenSharing ? t(dict, 'chat.callScreenActive') : callHasVideo ? t(dict, 'chat.callVideoActive') : t(dict, 'chat.callAudioActive')}</span>
                <span aria-hidden="true">·</span>
                <span>{callPeers.length + 1} {t(dict, 'chat.callParticipants')}</span>
                {#if serverLatencyMs !== null}<span aria-hidden="true">·</span><span>{serverLatencyMs} ms</span>{/if}
              </div>

              <div class="call__grid" class:call__grid--audio={!callHasVideo}>
                <div class="call__tile" class:call__tile--speaking={localSpeaking && !micMuted} class:call__tile--blurred={blurCallMediaWhenAway && blurred}>
                  {#if localDisplayStream && localHasVisibleVideo}
                    <video
                      class="call__video"
                      class:call__video--contain={screenSharing}
                      use:streamMedia={{ stream: localDisplayStream, muted: true, volume: 0 }}
                      autoplay
                      muted
                      playsinline
                      controlslist="nodownload nofullscreen noremoteplayback"
                      disablepictureinpicture
                      disableremoteplayback
                      on:pause={keepCallMediaPlaying}
                      on:contextmenu={preventMediaContextMenu}
                    ></video>
                    <button type="button" class="call__expand" title={t(dict, 'chat.callEnterFullscreen')} aria-label={t(dict, 'chat.callEnterFullscreen')} on:click={() => openCallFullscreen({ source: 'local' })}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
                    </button>
                  {:else}
                    <div class="call__avatar" style="background: {aliasGradient(alias)}">{myInitials}</div>
                  {/if}
                  <div class="call__name">
                    <span>{t(dict, 'chat.callYou')}</span>
                    {#if micMuted}
                      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label={t(dict, 'chat.callMuted')}><line x1="2" y1="2" x2="22" y2="22"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><path d="M15 9.34V5a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2"/><path d="M19 10v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
                    {:else}
                      <span class="call__level" style={`--level: ${Math.max(0.04, localAudioLevel)}`}></span>
                    {/if}
                    {#if screenSharing}
                      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label={t(dict, 'chat.callScreenSharing')} class="call__name-screen"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/></svg>
                    {/if}
                  </div>
                </div>

                {#each callPeers as peer (peer.id)}
                  <div class="call__tile" class:call__tile--speaking={peer.speaking && !peer.muted} class:call__tile--blurred={blurCallMediaWhenAway && blurred}>
                    {#if peer.stream && peer.stream.getVideoTracks().length && (peer.screenSharing || !peer.cameraOff)}
                      <video
                        class="call__video"
                        class:call__video--contain={peer.screenSharing}
                        use:streamMedia={{ stream: peer.stream, muted: callAudioMuted || peer.audioMuted, volume: callAudioMuted || peer.audioMuted ? 0 : callVolume * peer.volume, sinkId: selectedAudioOutputId }}
                        autoplay
                        playsinline
                        controlslist="nodownload nofullscreen noremoteplayback"
                        disablepictureinpicture
                        disableremoteplayback
                        on:pause={keepCallMediaPlaying}
                        on:contextmenu={preventMediaContextMenu}
                      ></video>
                      <button type="button" class="call__expand" title={t(dict, 'chat.callEnterFullscreen')} aria-label={t(dict, 'chat.callEnterFullscreen')} on:click={() => openCallFullscreen({ source: 'peer', peerId: peer.id })}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
                      </button>
                    {:else}
                      {#if peer.stream}
                        <audio
                          use:streamMedia={{ stream: peer.stream, muted: callAudioMuted || peer.audioMuted, volume: callAudioMuted || peer.audioMuted ? 0 : callVolume * peer.volume, sinkId: selectedAudioOutputId }}
                          autoplay
                          controlslist="nodownload noremoteplayback"
                          disableremoteplayback
                          on:pause={keepCallMediaPlaying}
                          on:contextmenu={preventMediaContextMenu}
                        ></audio>
                      {/if}
                      <div class="call__avatar" style="background: {gradientFor(peer.alias, peer.name)}">{peer.initials}</div>
                    {/if}
                    <div class="call__name">
                      <span>{peer.name}</span>
                      {#if peer.muted}
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label={t(dict, 'chat.callMuted')}><line x1="2" y1="2" x2="22" y2="22"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><path d="M15 9.34V5a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2"/><path d="M19 10v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
                      {:else}
                        <span class="call__level" style={`--level: ${Math.max(0.04, peer.audioLevel)}`}></span>
                      {/if}
                      {#if peer.screenSharing}
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label={t(dict, 'chat.callScreenSharing')} class="call__name-screen"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/></svg>
                      {/if}
                      {#if peer.state !== 'connected'}<span class="call__name-state">{peer.state}</span>{/if}
                    </div>
                  </div>
                {/each}
              </div>
            </div>

            <div class="call__bar">
              <button type="button" class="call__btn" class:call__btn--off={micMuted} title={micMuted ? t(dict, 'chat.callUnmute') : t(dict, 'chat.callMute')} aria-label={micMuted ? t(dict, 'chat.callUnmute') : t(dict, 'chat.callMute')} aria-pressed={!micMuted} on:click={toggleMic}>
                {#if micMuted}
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="2" y1="2" x2="22" y2="22"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><path d="M15 9.34V5a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2"/><path d="M19 10v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
                {:else}
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
                {/if}
              </button>
              <button type="button" class="call__btn" class:call__btn--off={cameraOff} title={cameraOff ? t(dict, 'chat.callCameraOn') : t(dict, 'chat.callCameraOff')} aria-label={cameraOff ? t(dict, 'chat.callCameraOn') : t(dict, 'chat.callCameraOff')} aria-pressed={!cameraOff} on:click={toggleCamera}>
                {#if cameraOff}
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="2" y1="2" x2="22" y2="22"/><path d="M10.66 6H14a2 2 0 0 1 2 2v2.34l5.22-3.48A.5.5 0 0 1 22 7.28v9.44a.5.5 0 0 1-.78.42L16 13.66V16"/><path d="M14 18H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2"/></svg>
                {:else}
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 13 5.22 3.48A.5.5 0 0 0 22 16.06V7.94a.5.5 0 0 0-.78-.42L16 11"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>
                {/if}
              </button>
              <button type="button" class="call__btn" class:call__btn--on={screenSharing} title={screenSharing ? t(dict, 'chat.callStopScreen') : t(dict, 'chat.callStartScreen')} aria-label={screenSharing ? t(dict, 'chat.callStopScreen') : t(dict, 'chat.callStartScreen')} aria-pressed={screenSharing} on:click={() => screenSharing ? stopScreenShare() : startScreenShare()}>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/><path d="m8 10 4-4 4 4"/><path d="M12 6v7"/></svg>
              </button>
              <button type="button" class="call__btn" class:call__btn--on={callSettingsOpen} title={t(dict, 'chat.callAudioAndDevices')} aria-label={t(dict, 'chat.callAudioAndDevices')} aria-expanded={callSettingsOpen} aria-controls="chat-call-settings" on:click={() => { callSettingsOpen = !callSettingsOpen; }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8.92 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.2.48.67 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.84 0-1.31.52-1.51 1Z"/></svg>
              </button>
              <button type="button" class="call__btn call__btn--leave" title={t(dict, 'chat.callHangUp')} aria-label={t(dict, 'chat.callHangUp')} on:click={() => endCall(true)}>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/><line x1="22" y1="2" x2="2" y2="22"/></svg>
              </button>
            </div>

            {#if callSettingsOpen}
              <div class="call__settings" id="chat-call-settings">
                <div class="call__settings-head">
                  <span>{t(dict, 'chat.callAudioAndDevices')}</span>
                  <button type="button" class="btn-ghost btn-sm btn-icon" title={t(dict, 'chat.callRefreshDevices')} aria-label={t(dict, 'chat.callRefreshDevices')} on:click={refreshCallDevices}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M16 8h5V3"/></svg>
                  </button>
                </div>
                <div class="call__fields">
                  <div class="field">
                    <label class="label" for="call-mic">{t(dict, 'chat.callMicrophone')}</label>
                    <select id="call-mic" class="input" bind:value={selectedAudioInputId} on:change={handleAudioInputChange}>
                      <option value="">{t(dict, 'chat.callDefaultMicrophone')}</option>
                      {#each audioInputDevices as device, index (device.deviceId || index)}
                        <option value={device.deviceId}>{device.label || `${t(dict, 'chat.callMicrophone')} ${index + 1}`}</option>
                      {/each}
                    </select>
                  </div>
                  <div class="field">
                    <label class="label" for="call-cam">{t(dict, 'chat.callCamera')}</label>
                    <select id="call-cam" class="input" bind:value={selectedVideoInputId} on:change={handleVideoInputChange}>
                      <option value="">{t(dict, 'chat.callDefaultCamera')}</option>
                      {#each videoInputDevices as device, index (device.deviceId || index)}
                        <option value={device.deviceId}>{device.label || `${t(dict, 'chat.callCamera')} ${index + 1}`}</option>
                      {/each}
                    </select>
                  </div>
                  {#if canSelectAudioOutput}
                    <div class="field">
                      <label class="label" for="call-out">{t(dict, 'chat.callAudioOutput')}</label>
                      <select id="call-out" class="input" bind:value={selectedAudioOutputId} on:change={handleAudioOutputChange}>
                        <option value="">{t(dict, 'chat.callDefaultOutput')}</option>
                        {#each audioOutputDevices as device, index (device.deviceId || index)}
                          <option value={device.deviceId}>{device.label || `${t(dict, 'chat.callAudioOutput')} ${index + 1}`}</option>
                        {/each}
                      </select>
                    </div>
                  {/if}
                  <div class="field">
                    <label class="label" for="call-volume">{t(dict, 'chat.callVolume')}</label>
                    <input id="call-volume" type="range" min="0" max="1" step="0.05" value={callVolume} disabled={callAudioMuted} on:input={(e) => setCallVolume((e.currentTarget as HTMLInputElement).value)} />
                  </div>
                </div>
                <label class="check">
                  <input type="checkbox" checked={callAudioMuted} on:change={(e) => setCallAudioMuted((e.currentTarget as HTMLInputElement).checked)} />
                  <span>{t(dict, 'chat.callDeafen')}</span>
                </label>
                <label class="check">
                  <input type="checkbox" checked={blurCallMediaWhenAway} on:change={(e) => setBlurCallMediaWhenAway((e.currentTarget as HTMLInputElement).checked)} />
                  <span>{t(dict, 'chat.callBlurMediaWhenAway')}</span>
                </label>
                {#if callPeers.length > 0}
                  <div class="call__peers">
                    <p class="label">{t(dict, 'chat.callParticipantAudio')}</p>
                    {#each callPeers as peer (peer.id)}
                      <div class="call__peer">
                        <div class="call__peer-name">
                          <div class="chat-avatar chat-avatar--sm" style="background: {gradientFor(peer.alias, peer.name)}">{peer.initials}</div>
                          <span>{peer.name}</span>
                        </div>
                        <button type="button" class="btn-ghost btn-sm btn-icon" class:text-danger={peer.audioMuted} title={peer.audioMuted ? t(dict, 'chat.callUnmuteAllAudio') : t(dict, 'chat.callMuteAllAudio')} aria-label={peer.audioMuted ? t(dict, 'chat.callUnmuteAllAudio') : t(dict, 'chat.callMuteAllAudio')} aria-pressed={peer.audioMuted} on:click={() => setPeerAudioMuted(peer.id, !peer.audioMuted)}>
                          {#if peer.audioMuted}
                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>
                          {:else}
                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                          {/if}
                        </button>
                        <input type="range" min="0" max="1" step="0.05" value={peer.volume} disabled={callAudioMuted || peer.audioMuted} on:input={(e) => setPeerVolume(peer.id, (e.currentTarget as HTMLInputElement).value)} aria-label={`${t(dict, 'chat.callVolume')} ${peer.name}`} />
                      </div>
                    {/each}
                  </div>
                {/if}
                <p class="call__relay">{t(dict, 'chat.callRelay')}: {getRelayStatusLabel()}</p>
              </div>
            {/if}
          {/if}
          {#if callError}
            <p class="status status--error" role="alert">{callError}</p>
          {/if}
        </div>
      {/if}

      <div class="chat-thread">
        {#if activeWhiteboard}
          <div class="chat-whiteboard-panel">
            <div class="chat-whiteboard-panel__bar">
              <div class="min-w-0">
                <p class="chat-whiteboard-panel__title">{t(dict, 'chat.whiteboardTitle')}</p>
                <p class="chat-whiteboard-panel__meta">{t(dict, 'chat.whiteboardStartedBy').replace('{name}', activeWhiteboard.sender)}</p>
              </div>
              <div class="chat-whiteboard-panel__actions">
                <button type="button" class="chat-whiteboard-panel__button" title={t(dict, 'chat.whiteboardOpenNewTab')} aria-label={t(dict, 'chat.whiteboardOpenNewTab')} on:click={() => openWhiteboardNewTab(activeWhiteboard!)}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>
                </button>
                <button type="button" class="chat-whiteboard-panel__button" title={t(dict, 'chat.whiteboardClose')} aria-label={t(dict, 'chat.whiteboardClose')} on:click={() => { activeWhiteboard = null; }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            </div>
            <div class="chat-whiteboard-panel__surface">
              {#key activeWhiteboard.roomId}
                <Whiteboard locale={locale} dict={dict} roomId={activeWhiteboard.roomId} partyHost={partyHost} initialPassword={activeWhiteboard.password} />
              {/key}
            </div>
          </div>
        {/if}
        <div class="chat-messages" class:chat-messages--blurred={blurred} bind:this={messagesEl} use:revealSpoilers>
      {#if messages.length === 0}
        <div class="empty max-w-sm mx-auto my-auto">
          <p class="empty__title">{t(dict, 'chat.emptyRoomNotice')}</p>
          <p class="text-text">{t(dict, 'chat.emptyRoomNotice2')}</p>
          <p class="hint">{t(dict, 'chat.emptyRoomNotice3')}</p>
        </div>
      {/if}

      {#each messages as msg (msg.id)}
        <div class="chat-bubble" class:chat-bubble--mine={msg.mine}>
          <div class="flex items-start gap-2">
            {#if !msg.mine}
              <div class="chat-avatar" style="background: {gradientFor(msg.alias, msg.sender)}">{msg.initials}</div>
            {/if}
            <div class="flex-1 min-w-0">
              <div class="chat-sender-row">
                <span class="chat-sender" style="color: {msg.mine ? 'var(--accent)' : safeColor(msg.color)}">{msg.sender}</span>
              </div>
              {#if msg.file}
                <div class="chat-file" class:chat-file--error={msg.fileError}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  <div class="flex-1 min-w-0">
                    <span class="chat-file__name">{msg.file.name}</span>
                    <span class="chat-file__size">
                      {#if msg.fileError}
                        {t(dict, 'chat.fileExpired')}
                      {:else}
                        {msg.file.size < 1048576 ? `${(msg.file.size / 1024).toFixed(1)} KB` : `${(msg.file.size / 1048576).toFixed(1)} MB`}
                      {/if}
                    </span>
                  </div>
                  {#if !msg.fileError}
                    <button type="button" class="chat-file__dl" on:click={() => downloadChatFile(msg)} aria-label={t(dict, 'chat.downloadFile')}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    </button>
                  {/if}
                </div>
              {/if}
              {#if msg.whiteboard}
                <div class="chat-whiteboard-card">
                  <div class="chat-whiteboard-card__icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h18v14H3z"/><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 9h5"/><path d="M7 13h10"/></svg>
                  </div>
                  <div class="chat-whiteboard-card__body">
                    <p class="chat-whiteboard-card__title">{t(dict, 'chat.whiteboardTitle')}</p>
                    <p class="chat-whiteboard-card__meta">{t(dict, 'chat.whiteboardStartedBy').replace('{name}', msg.whiteboard.sender)}</p>
                    <div class="chat-whiteboard-card__actions">
                      <button class="chat-whiteboard-card__btn chat-whiteboard-card__btn--primary" on:click={() => openWhiteboardInline(msg.whiteboard!)}>
                        {t(dict, 'chat.whiteboardOpenInline')}
                      </button>
                      <button class="chat-whiteboard-card__btn" on:click={() => openWhiteboardNewTab(msg.whiteboard!)}>
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
                <p class="chat-text">{@html parseMarkdown(msg.text)}</p>
              {/if}
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
      {/each}

      {#if typing}
        <div class="chat-typing">
          <div class="chat-avatar chat-avatar--sm" style="background: {gradientFor(typing.alias, typing.sender)}">{typing.initials}</div>
          <span style="color: {safeColor(typing.color)}">{typing.sender}</span> {t(dict, 'chat.isTyping')}
        </div>
      {/if}

        </div>

        <div class="chat-input">
          <div class="chat-attach-menu">
            <button
              type="button"
              class="chat-attach-btn"
              class:chat-attach-btn--active={composerMenuOpen}
              on:click={() => { composerMenuOpen = !composerMenuOpen; }}
              disabled={!connected || uploading}
              aria-haspopup="menu"
              aria-expanded={composerMenuOpen}
              aria-label={t(dict, 'chat.addMenu')}
              title={t(dict, 'chat.addMenu')}
            >
              {#if uploading}
                <svg class="animate-spin" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
              {:else}
                <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              {/if}
            </button>
            {#if composerMenuOpen}
              <div class="chat-attach-dropdown" role="menu">
                <button type="button" class="chat-attach-option" role="menuitem" on:click={chooseFileUpload}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  <span>{t(dict, 'chat.uploadFile')}</span>
                </button>
                <button type="button" class="chat-attach-option" role="menuitem" on:click={createWhiteboardInvite} disabled={!verified}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h18v14H3z"/><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 9h5"/><path d="M7 13h10"/></svg>
                  <span>{t(dict, 'chat.createWhiteboard')}</span>
                </button>
              </div>
            {/if}
          </div>
          <input id="chat-file" type="file" class="sr-only" bind:this={fileInputEl} on:change={handleFileSelect} />
          <input
            type="text"
            class="chat-input-field"
            aria-label={t(dict, 'chat.messagePlaceholder')}
            placeholder={uploading ? t(dict, 'chat.uploading') : t(dict, 'chat.messagePlaceholder')}
            bind:value={inputText}
            on:input={handleTyping}
            on:keydown={(e) => e.key === 'Enter' && handleSend()}
            on:focus={() => { composerMenuOpen = false; }}
            disabled={!connected || uploading}
            autocomplete="off"
            data-lpignore="true"
            data-1p-ignore
          />
          <button type="button" class="chat-send-btn" aria-label={t(dict, 'chat.send')} on:click={handleSend} disabled={!connected || (!inputText.trim() && !uploading)}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if callFullscreenMedia}
    <div
      class="chat-call-fullscreen"
      bind:this={callFullscreenOverlayEl}
      role="dialog"
      aria-modal="true"
      aria-label={callFullscreenMedia.name}
      tabindex="-1"
    >
      <div class="chat-call-fullscreen__bar">
        <div class="chat-call-fullscreen__meta">
          <span>{callFullscreenMedia.name}</span>
          {#if callFullscreenMedia.isScreen}<span>{t(dict, 'chat.callScreenSharing')}</span>{/if}
        </div>
        <button class="chat-call-fullscreen__close" title={t(dict, 'chat.callExitFullscreen')} on:click={() => closeCallFullscreen()}>
          <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>
        </button>
      </div>
      <video
        class="chat-call-fullscreen__video"
        use:streamMedia={{ stream: callFullscreenMedia.stream, muted: true, volume: 0 }}
        autoplay
        muted
        playsinline
        controlslist="nodownload nofullscreen noremoteplayback"
        disablepictureinpicture
        disableremoteplayback
        on:pause={keepCallMediaPlaying}
        on:contextmenu={preventMediaContextMenu}
      ></video>
    </div>
  {/if}
</div>

<style>
  .call {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: #111214;
    color: #f2f3f5;
  }
  .call--error {
    background: transparent;
    color: inherit;
    padding: 0.75rem;
  }
  .call__stage {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .call__status {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.4rem;
    font-size: 0.75rem;
    font-weight: 700;
    color: #b5bac1;
  }
  .call__dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: #80848e;
  }
  .call__dot--good { background: #23a55a; }
  .call__dot--fair { background: #f0b232; }
  .call__dot--poor,
  .call__dot--offline { background: #f23f43; }
  .call__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 0.6rem;
    align-content: start;
  }
  .call__grid--audio {
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  }
  .call__tile {
    position: relative;
    aspect-ratio: 16 / 10;
    min-height: 110px;
    border-radius: 0.75rem;
    overflow: hidden;
    background: #2b2d31;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 0 0 2px transparent;
    transition: box-shadow 0.15s ease-out;
  }
  .call__tile--speaking {
    box-shadow: 0 0 0 2px #23a55a;
  }
  .call__tile--blurred .call__video {
    filter: blur(14px);
  }
  .call__video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    background: #000;
  }
  .call__video--contain {
    object-fit: contain;
  }
  .call__avatar {
    width: 72px;
    height: 72px;
    border-radius: 999px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.25rem;
    font-weight: 900;
    color: #fff;
  }
  .call__name {
    position: absolute;
    left: 0.5rem;
    bottom: 0.5rem;
    max-width: calc(100% - 1rem);
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.2rem 0.55rem;
    border-radius: 0.4rem;
    background: rgba(0, 0, 0, 0.6);
    font-size: 0.75rem;
    font-weight: 700;
    color: #fff;
  }
  .call__name > span:first-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .call__name svg {
    flex: none;
    color: #f23f43;
  }
  .call__name .call__name-screen {
    color: #23a55a;
  }
  .call__name-state {
    color: #b5bac1;
    font-weight: 400;
  }
  .call__level {
    flex: none;
    width: 26px;
    height: 4px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.18);
    overflow: hidden;
  }
  .call__level::after {
    content: "";
    display: block;
    height: 100%;
    width: calc(var(--level, 0) * 100%);
    background: #23a55a;
    transition: width 0.1s linear;
  }
  .call__expand {
    position: absolute;
    top: 0.45rem;
    right: 0.45rem;
    width: 32px;
    height: 32px;
    border-radius: 0.45rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    opacity: 0;
    transition: opacity 0.15s ease-out;
  }
  .call__tile:hover .call__expand,
  .call__expand:focus-visible {
    opacity: 1;
  }
  .call__bar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    padding: 0.6rem 0.75rem 0.8rem;
  }
  .call__btn {
    width: 48px;
    height: 48px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: #2b2d31;
    color: #f2f3f5;
    transition: background-color 0.15s ease-out, color 0.15s ease-out, transform 0.1s ease-out;
  }
  .call__btn:hover:not(:disabled) {
    background: #3f4147;
  }
  .call__btn:active:not(:disabled) {
    transform: scale(0.96);
  }
  .call__btn--off {
    background: #f2f3f5;
    color: #f23f43;
  }
  .call__btn--off:hover:not(:disabled) {
    background: #fff;
  }
  .call__btn--on {
    background: #f2f3f5;
    color: #111214;
  }
  .call__btn--on:hover:not(:disabled) {
    background: #fff;
  }
  .call__btn--leave {
    background: #f23f43;
    color: #fff;
  }
  .call__btn--leave:hover:not(:disabled) {
    background: #da373c;
  }
  .call__btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .call__btn:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 2px;
  }
  .call__settings {
    position: absolute;
    left: 0.75rem;
    right: 0.75rem;
    bottom: 4.6rem;
    max-height: calc(100% - 5.6rem);
    z-index: 1;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
    padding: 0.75rem;
    border-radius: 0.75rem;
    background: #2b2d31;
    display: grid;
    gap: 0.75rem;
    font-size: 0.875rem;
    overflow: auto;
  }
  .call__settings-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-weight: 700;
  }
  .call__settings .label,
  .call__settings .check {
    color: #f2f3f5;
  }
  .call__settings .input {
    background: #1e1f22;
    border-color: #3f4147;
    color: #f2f3f5;
    min-height: 2.5rem;
  }
  .call__settings .btn-ghost {
    color: #b5bac1;
  }
  .call__settings .btn-ghost:hover {
    background: #3f4147;
    color: #fff;
  }
  .call__settings .btn-ghost.text-danger {
    color: #f23f43;
  }
  .call__fields {
    display: grid;
    gap: 0.6rem;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  }
  .call__peers {
    display: grid;
    gap: 0.5rem;
  }
  .call__peer {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.4rem 0.5rem;
  }
  .call__peer input[type="range"] {
    grid-column: 1 / -1;
    height: 2rem;
  }
  .call__peer-name {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }
  .call__peer-name span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .call__relay {
    font-size: 0.75rem;
    color: #b5bac1;
  }
  .call .status--error {
    margin: 0.75rem;
  }
  .chat-body--call > .call {
    flex: 0 1 auto;
    max-height: 64%;
    min-height: 240px;
    overflow: hidden;
  }
  @media (max-width: 860px) {
    .chat-body--call > .call {
      max-height: 56%;
    }
    .call__btn {
      width: 44px;
      height: 44px;
    }
    .call__expand {
      opacity: 1;
    }
  }

  .chat-container {
    display: flex;
    flex-direction: column;
    height: min(75dvh, 700px);
    border-radius: 0.75rem;
    overflow: hidden;
    border: 1px solid var(--line-soft);
    background: var(--surface);
  }
  .chat-container:has(.chat-whiteboard-panel) {
    height: min(88dvh, 940px);
  }
  .chat-center {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
  }
  .chat-copy-link span {
    display: none;
  }
  @media (min-width: 640px) {
    .chat-copy-link span {
      display: inline;
    }
  }
  .chat-header {
    flex-wrap: wrap;
    gap: 0.5rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1.25rem;
    border-bottom: 1px solid rgba(228, 228, 231, 0.5);
  }
  :global(.dark) .chat-header { border-color: rgba(39, 39, 42, 0.4); }
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
  .chat-whiteboard-panel {
    flex: 1 1 72%;
    min-height: 320px;
    display: flex;
    flex-direction: column;
    border-bottom: 1px solid rgba(228, 228, 231, 0.55);
    background: rgba(250, 250, 250, 0.72);
  }
  :global(.dark) .chat-whiteboard-panel {
    border-color: rgba(39, 39, 42, 0.55);
    background: rgba(9, 9, 11, 0.28);
  }
  .chat-whiteboard-panel__bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.55rem 0.75rem;
    border-bottom: 1px solid rgba(228, 228, 231, 0.5);
  }
  :global(.dark) .chat-whiteboard-panel__bar { border-color: rgba(39, 39, 42, 0.45); }
  .chat-whiteboard-panel__title {
    font-size: 12px;
    font-weight: 700;
    color: rgb(39, 39, 42);
  }
  :global(.dark) .chat-whiteboard-panel__title { color: rgb(228, 228, 231); }
  .chat-whiteboard-panel__meta {
    font-size: 0.75rem;
    color: rgb(113, 113, 122);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chat-whiteboard-panel__actions {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-shrink: 0;
  }
  .chat-whiteboard-panel__button {
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.5rem;
    color: rgb(113, 113, 122);
    background: rgba(244, 244, 245, 0.85);
    border: 1px solid rgba(228, 228, 231, 0.75);
  }
  .chat-whiteboard-panel__button:hover {
    color: var(--accent);
    background: oklch(0.7019 0.1577 160.44 / 0.08);
    border-color: oklch(0.7019 0.1577 160.44 / 0.18);
  }
  :global(.dark) .chat-whiteboard-panel__button {
    color: rgb(212, 212, 216);
    background: rgba(39, 39, 42, 0.65);
    border-color: rgba(63, 63, 70, 0.45);
  }
  .chat-whiteboard-panel__surface {
    flex: 1;
    min-height: 0;
  }
  .chat-whiteboard-panel__surface :global(.wb-container) {
    height: 100%;
    max-height: none;
    border: 0;
    border-radius: 0;
    background: transparent;
    backdrop-filter: none;
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
  .chat-share-value {
    flex: 1; min-width: 0;
    font-size: 12px; font-family: var(--font-mono);
    color: rgb(63, 63, 70); background: rgba(244, 244, 245, 0.8);
    padding: 4px 8px; border-radius: 6px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  :global(.dark) .chat-share-value {
    color: rgb(212, 212, 216);
    background: rgba(39, 39, 42, 0.6);
  }
  .chat-share-copy {
    flex-shrink: 0; padding: 2px;
    color: rgb(161, 161, 170); transition: color 0.15s;
  }
  .chat-share-copy:hover { color: var(--accent); }
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
  :global(.dark) .chat-mode-badge {
    color: oklch(0.84 0.13 160.44);
    border-color: oklch(0.7019 0.1577 160.44 / 0.16);
    background: oklch(0.7019 0.1577 160.44 / 0.09);
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
    color: rgb(39, 39, 42);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  :global(.dark) .chat-call-banner__title { color: rgb(228, 228, 231); }
  .chat-call-banner__name {
    font-size: 0.75rem; color: rgb(113, 113, 122);
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
    color: rgb(113, 113, 122);
    background: rgba(244, 244, 245, 0.85);
  }
  :global(.dark) .chat-call-decline {
    color: rgb(212, 212, 216);
    background: rgba(39, 39, 42, 0.65);
  }
  .chat-call-fullscreen-btn {
    position: absolute;
    top: 7px;
    right: 7px;
    z-index: 2;
    width: 28px;
    height: 28px;
    border-radius: 0.45rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: white;
    background: rgba(24, 24, 27, 0.68);
    border: 1px solid rgba(255, 255, 255, 0.16);
    opacity: 0;
    transform: translateY(-2px);
    transition: opacity 0.15s, transform 0.15s, background 0.15s;
  }
  .chat-call-fullscreen-btn:hover {
    background: oklch(0.7019 0.1577 160.44 / 0.82);
  }
  .chat-call-fullscreen {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgb(5, 5, 6);
    outline: none;
  }
  .chat-call-fullscreen__video {
    width: 100vw;
    height: 100dvh;
    object-fit: contain;
    background: rgb(5, 5, 6);
  }
  .chat-call-fullscreen__bar {
    position: absolute;
    top: max(14px, env(safe-area-inset-top));
    left: max(14px, env(safe-area-inset-left));
    right: max(14px, env(safe-area-inset-right));
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    pointer-events: none;
  }
  .chat-call-fullscreen__meta {
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.38rem 0.55rem;
    border-radius: 0.55rem;
    color: white;
    background: rgba(24, 24, 27, 0.74);
    border: 1px solid rgba(255, 255, 255, 0.12);
    font-size: 12px;
    font-weight: 700;
    pointer-events: auto;
  }
  .chat-call-fullscreen__meta span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chat-call-fullscreen__meta span + span {
    flex-shrink: 0;
    color: rgb(187, 247, 208);
  }
  .chat-call-fullscreen__close {
    width: 36px;
    height: 36px;
    border-radius: 0.55rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: white;
    background: rgba(24, 24, 27, 0.74);
    border: 1px solid rgba(255, 255, 255, 0.12);
    pointer-events: auto;
  }
  .chat-call-fullscreen__close:hover {
    background: rgba(239, 68, 68, 0.82);
  }
  @media (hover: none) {
    .chat-call-fullscreen-btn {
      opacity: 1;
      transform: translateY(0);
    }
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
    flex: 1; min-height: 0; overflow-y: auto; padding: 1.25rem;
    display: flex; flex-direction: column; gap: 0.6rem;
    transition: filter 0.3s;
  }
  .chat-messages--blurred { filter: blur(8px); }
  .chat-avatar {
    width: 34px; height: 34px; border-radius: 9999px;
    display: flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 800; color: white;
    flex-shrink: 0; letter-spacing: 0.02em;
    box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  }
  .chat-avatar--sm {
    width: 24px; height: 24px; border-radius: 9999px; font-size: 0.75rem;
  }
  .chat-bubble {
    max-width: 85%; padding: 0.5rem 0.75rem; border-radius: 0.875rem;
    background: rgba(244, 244, 245, 0.8); align-self: flex-start;
  }
  :global(.dark) .chat-bubble { background: rgba(39, 39, 42, 0.5); }
  .chat-bubble--mine {
    align-self: flex-end;
    background: oklch(0.7019 0.1577 160.44 / 0.12);
  }
  :global(.dark) .chat-bubble--mine { background: oklch(0.7019 0.1577 160.44 / 0.15); }
  .chat-sender-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-bottom: 2px;
  }
  .chat-sender { font-size: 12px; font-weight: 700; display: block; }
  .chat-text {
    font-size: 15px; line-height: 1.5; color: rgb(63, 63, 70); word-break: break-word;
  }
  :global(.dark) .chat-text { color: rgb(212, 212, 216); }
  .chat-timer {
    position: relative; width: 32px; height: 32px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
  }
  .chat-timer__ring {
    position: absolute; inset: 0; width: 100%; height: 100%;
    color: var(--accent);
  }
  .chat-timer__num {
    font-size: 0.75rem; font-weight: 700; color: rgb(161, 161, 170);
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
    background: rgb(63, 63, 70); color: transparent; border-radius: 3px;
    padding: 0 3px; cursor: pointer; transition: all 0.2s;
  }
  .chat-text :global(.chat-spoiler.revealed) {
    background: oklch(0.7019 0.1577 160.44 / 0.1); color: inherit;
  }
  .chat-text :global(.chat-quote) {
    border-left: 3px solid oklch(0.7019 0.1577 160.44 / 0.4);
    padding-left: 8px; margin: 2px 0;
    color: rgb(113, 113, 122);
  }
  .chat-typing {
    font-size: 13px; color: rgb(161, 161, 170); padding: 0.3rem 0;
    display: flex; align-items: center; gap: 0.5rem;
  }
  .chat-wrong-password {
    display: flex; align-items: center; gap: 0.4rem;
    font-size: 0.75rem; color: rgb(239, 68, 68);
    padding: 0.5rem 0.75rem; margin-top: 0.25rem;
    border-radius: 0.5rem;
    background: rgba(239, 68, 68, 0.08);
  }
  .chat-input {
    display: flex; align-items: center; gap: 0.6rem;
    padding: 0.75rem 1rem;
    border-top: 1px solid rgba(228, 228, 231, 0.5);
  }
  :global(.dark) .chat-input { border-color: rgba(39, 39, 42, 0.4); }
  .chat-input-field {
    flex: 1; background: transparent; border: none; outline: none;
    font-size: 15px; color: rgb(24, 24, 27); padding: 0.5rem 0;
  }
  :global(.dark) .chat-input-field { color: rgb(228, 228, 231); }
  .chat-input-field::placeholder { color: rgb(161, 161, 170); }
  .chat-preview-img {
    max-width: 100%; max-height: 240px;
    border-radius: 0.5rem; margin-top: 0.25rem;
    object-fit: contain;
  }
  .chat-preview-text {
    margin-top: 0.25rem; border-radius: 0.4rem; overflow: hidden;
    border: 1px solid rgba(228, 228, 231, 0.5);
  }
  :global(.dark) .chat-preview-text {
    border-color: rgba(39, 39, 42, 0.4);
  }
  .chat-preview-code {
    margin: 0; padding: 0.5rem 0.6rem;
    font-family: var(--font-mono); font-size: 12px; line-height: 1.5;
    white-space: pre-wrap; word-break: break-all;
    color: rgb(82, 82, 91); background: rgba(244, 244, 245, 0.6);
    max-height: 200px; overflow-y: auto;
  }
  :global(.dark) .chat-preview-code {
    color: rgb(161, 161, 170);
    background: rgba(24, 24, 27, 0.5);
  }
  .chat-preview-expand {
    display: block; width: 100%; padding: 0.3rem;
    font-size: 0.75rem; font-weight: 600; text-align: center;
    color: var(--accent);
    background: rgba(244, 244, 245, 0.8);
    border-top: 1px solid rgba(228, 228, 231, 0.5);
  }
  :global(.dark) .chat-preview-expand {
    background: rgba(24, 24, 27, 0.6);
    border-color: rgba(39, 39, 42, 0.4);
  }
  .chat-preview-expand:hover { background: oklch(0.7019 0.1577 160.44 / 0.08); }
  .chat-attach-btn {
    padding: 0.4rem; border-radius: 0.5rem;
    color: rgb(161, 161, 170); transition: color 0.15s;
  }
  .chat-attach-menu { position: relative; flex-shrink: 0; }
  .chat-attach-btn:hover:not(:disabled),
  .chat-attach-btn--active {
    color: var(--accent);
  }
  .chat-attach-btn:disabled { opacity: 0.3; }
  .chat-attach-dropdown {
    position: absolute;
    left: 0;
    bottom: calc(100% + 8px);
    z-index: 30;
    width: 190px;
    padding: 0.3rem;
    border-radius: 0.65rem;
    border: 1px solid rgba(228, 228, 231, 0.75);
    background: rgba(255, 255, 255, 0.96);
    box-shadow: 0 18px 45px rgba(15, 23, 42, 0.16);
    backdrop-filter: blur(14px);
  }
  :global(.dark) .chat-attach-dropdown {
    border-color: rgba(63, 63, 70, 0.65);
    background: rgba(24, 24, 27, 0.96);
    box-shadow: 0 18px 45px rgba(0, 0, 0, 0.38);
  }
  .chat-attach-option {
    width: 100%;
    min-height: 34px;
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0 0.55rem;
    border-radius: 0.5rem;
    font-size: 12px;
    font-weight: 800;
    color: rgb(63, 63, 70);
    text-align: left;
  }
  .chat-attach-option:hover:not(:disabled) {
    color: var(--accent);
    background: oklch(0.7019 0.1577 160.44 / 0.08);
  }
  .chat-attach-option:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }
  :global(.dark) .chat-attach-option {
    color: rgb(228, 228, 231);
  }
  .chat-file {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.4rem 0.6rem; margin: 0.25rem 0;
    border-radius: 0.5rem;
    background: oklch(0.7019 0.1577 160.44 / 0.06);
    border: 1px solid oklch(0.7019 0.1577 160.44 / 0.12);
    color: var(--accent);
  }
  .chat-file--error {
    border-color: rgba(239, 68, 68, 0.2);
    background: rgba(239, 68, 68, 0.06);
    color: rgb(239, 68, 68);
    opacity: 0.6;
  }
  .chat-file__name {
    font-size: 13px; font-weight: 600; display: block; truncate: true;
    color: rgb(63, 63, 70);
  }
  :global(.dark) .chat-file__name { color: rgb(212, 212, 216); }
  .chat-file__size { font-size: 0.75rem; color: rgb(161, 161, 170); }
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
    color: rgb(39, 39, 42);
  }
  :global(.dark) .chat-whiteboard-card__title { color: rgb(228, 228, 231); }
  .chat-whiteboard-card__meta {
    margin-top: 1px;
    font-size: 0.75rem;
    color: rgb(113, 113, 122);
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
    min-height: 28px;
    padding: 0 0.55rem;
    border-radius: 0.45rem;
    font-size: 0.75rem;
    font-weight: 700;
    color: rgb(82, 82, 91);
    background: rgba(255, 255, 255, 0.72);
    border: 1px solid rgba(228, 228, 231, 0.8);
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
    color: rgb(212, 212, 216);
    background: rgba(39, 39, 42, 0.68);
    border-color: rgba(63, 63, 70, 0.5);
  }
  :global(.dark) .chat-whiteboard-card__btn--primary {
    color: white;
    background: var(--accent);
    border-color: var(--accent);
  }
  .chat-send-btn {
    padding: 0.4rem; border-radius: 0.5rem;
    color: var(--accent); transition: background 0.15s;
  }
  .chat-send-btn:hover:not(:disabled) { background: oklch(0.7019 0.1577 160.44 / 0.1); }
  .chat-send-btn:disabled { opacity: 0.3; }
</style>
