<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import PartySocket from 'partysocket';
  import Whiteboard from './Whiteboard.svelte';
  import {
    deriveKeyFromPassword,
    deriveRoomNamePassword,
    encryptMessage, decryptMessage, generateIdentity, nameToGradient,
  } from '../../lib/chatCrypto';
  import { encryptData, decryptData, prependEclkMagic } from '../../lib/ghost/crypto';
  import { prepareSendUpload } from '../../lib/nologSend';
  import { getTranslations, t } from '../../lib/i18n';

  export let locale = 'en';
  export let roomId = '';
  export let partyHost = 'encrypt-click.danielsebesta.partykit.dev';

  $: dict = getTranslations(locale);

  type Message = {
    id: string;
    text: string;
    sender: string;
    initials: string;
    color: string;
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
  type ChatAuthMode = 'password' | 'room-name';

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
    time: number;
    file?: { name: string; size: number; urls: string[] };
  };

  type LocalHistoryEnvelope = Pick<ServerEnvelope, 'type' | 'id' | 'payload' | 'createdAt'>;

  type WhiteboardInvite = {
    roomId: string;
    password: string;
    sender: string;
    color: string;
    createdAt: number;
  };

  type CallMode = 'audio' | 'video';

  type CallPeer = {
    id: string;
    name: string;
    initials: string;
    color: string;
    pc: RTCPeerConnection;
    audioTransceiver: RTCRtpTransceiver | null;
    videoTransceiver: RTCRtpTransceiver | null;
    audioSender: RTCRtpSender | null;
    videoSender: RTCRtpSender | null;
    stream: MediaStream | null;
    state: RTCPeerConnectionState;
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
  let identity = generateIdentity(locale);
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
  let typing: { sender: string; initials: string; color: string } | null = null;
  let typingTimeout: ReturnType<typeof setTimeout>;
  let blurred = false;
  let roomConfig: RoomConfig = { mode: 'live', authMode: 'room-name', createdAt: 0 };
  let pendingRoomConfig: RoomConfig | null = null;
  let currentAuthAttempt: ChatAuthMode | null = null;
  let localHistoryKey = '';
  let localHistoryLoaded = false;
  const seenMessageIds = new Set<string>();
  let decryptFailCount = 0;
  let onlineUsers: { name: string; initials: string; color: string }[] = [];
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
  let relayRoute: RelayRoute = {
    provider: 'unknown',
    name: 'TURN',
    host: '',
    location: '',
    protocol: '',
  };
  let relayRttMs: number | null = null;
  let relayQuality: ServerQuality = 'unknown';
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
  const LOCAL_HISTORY_PREFIX = 'encrypt.click:chat-history:v2:';
  const FIRST_PARTY_UPLOAD_URL = 'https://upload.encrypt.click';
  const FIRST_PARTY_DOWNLOAD_BASE_URL = 'https://dl.encrypt.click';
  const SERVER_FALLBACK_NAME = 'encrypt-1';
  const SERVER_FALLBACK_REGION = 'AMS-NL';
  const CALL_ID = `call:${roomId}`;
  const callPeerMap = new Map<string, CallPeer>();
  const pendingIce = new Map<string, RTCIceCandidateInit[]>();
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
    // Code blocks: ```lang\ncode\n``` → <pre><code>
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre class="chat-code-block"><code>${code.trim()}</code></pre>`);
    // Inline code: `code`
    html = html.replace(/`([^`]+)`/g, '<code class="chat-code-inline">$1</code>');
    // Bold italic: ***text*** or ___text___
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
    // Bold: **text** or __text__
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
    // Italic: *text* or _text_
    html = html.replace(/(?<!\w)\*(.+?)\*(?!\w)/g, '<em>$1</em>');
    html = html.replace(/(?<!\w)_(.+?)_(?!\w)/g, '<em>$1</em>');
    // Strikethrough: ~~text~~
    html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
    // Spoiler: ||text|| -> click to reveal. The click handler is delegated
    // through a Svelte action so encrypted chat text never injects JS handlers.
    html = html.replace(/\|\|(.+?)\|\|/g, '<span class="chat-spoiler" data-chat-spoiler role="button" tabindex="0">$1</span>');
    // Blockquote: > text (at line start)
    html = html.replace(/(^|\n)&gt; (.+)/g, '$1<blockquote class="chat-quote">$2</blockquote>');
    // Newlines
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
    const mediaNodes = document.querySelectorAll<HTMLMediaElement>('.chat-call-video, .chat-call-fullscreen__video, .chat-call-tile audio');
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
    const withoutScheme = url.replace(/^turns?:/i, '').split('?')[0];
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
      : (callPeers.length ? getServerQualityLabel(relayQuality) : t(dict, 'chat.callRelayWaiting'));
    return `${relayRoute.name}${location} · ${rtt}`;
  }

  function getRelayTitle(): string {
    const parts = [
      `${t(dict, 'chat.callRelay')}: ${relayRoute.name}`,
      relayRoute.location ? `${t(dict, 'chat.callRelayLocation')}: ${relayRoute.location}` : '',
      relayRoute.host ? `${t(dict, 'chat.callRelayHost')}: ${relayRoute.host}` : '',
      relayRoute.protocol ? `${t(dict, 'chat.callRelayTransport')}: ${relayRoute.protocol}` : '',
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
      if (!res.ok) return;
      const values = new Map<string, string>();
      for (const line of (await res.text()).split('\n')) {
        const index = line.indexOf('=');
        if (index <= 0) continue;
        values.set(line.slice(0, index), line.slice(index + 1).trim());
      }
      cloudflareRelayColo = values.get('colo') || cloudflareRelayColo;
      cloudflareRelayCountry = values.get('loc') || cloudflareRelayCountry;
      updateRelayRoute();
    } catch {}
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
    const rttSeconds = typeof pair.currentRoundTripTime === 'number'
      ? pair.currentRoundTripTime
      : (typeof pair.totalRoundTripTime === 'number' && typeof pair.responsesReceived === 'number' && pair.responsesReceived > 0
        ? pair.totalRoundTripTime / pair.responsesReceived
        : null);

    return {
      rttMs: rttSeconds !== null && Number.isFinite(rttSeconds) ? Math.max(0, Math.round(rttSeconds * 1000)) : null,
      url,
      protocol: protocol ? protocol.toUpperCase() : '',
    };
  }

  async function refreshRelayStats() {
    if (!callActive) return;
    const snapshots = await Promise.all(Array.from(callPeerMap.values()).map((peer) => readPeerRelayStats(peer).catch(() => null)));
    const valid = snapshots.filter((item): item is RelayStatsSnapshot => Boolean(item));
    const rtts = valid.map((item) => item.rttMs).filter((value): value is number => typeof value === 'number');
    relayRttMs = rtts.length ? Math.round(rtts.reduce((sum, value) => sum + value, 0) / rtts.length) : null;
    const routeSnapshot = valid.find((item) => item.url);
    updateRelayRoute(routeSnapshot?.url || '', routeSnapshot?.protocol || '');
    updateRelayQuality();
  }

  function startRelayStatsMonitor() {
    if (relayStatsInterval) clearInterval(relayStatsInterval);
    relayStatsInterval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void refreshRelayStats();
    }, 2500);
    void refreshRelayStats();
  }

  function stopRelayStatsMonitor() {
    if (relayStatsInterval) clearInterval(relayStatsInterval);
    relayStatsInterval = undefined;
    relayRttMs = null;
    relayQuality = 'unknown';
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
    if (!force && iceServersFetchedAt && Date.now() - iceServersFetchedAt < 45 * 60 * 1000) {
      return iceServers;
    }

    try {
      const res = await fetch('/api/turn', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as TurnConfig;
      if (!data.turnReady || !Array.isArray(data.iceServers) || !hasTurnCredentials(data.iceServers)) {
        throw new Error(t(dict, 'chat.callTurnRequired'));
      }
      iceServers = data.iceServers;
      iceServersFetchedAt = Date.now();
      updateRelayRoute();
      void refreshCloudflareRelayTrace();
    } catch {
      iceServers = [];
      iceServersFetchedAt = Date.now();
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
      mode: 'audio',
      audio: !micMuted,
      video: screenSharing || !cameraOff,
      screen: screenSharing,
      ...partial,
    };
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
    return value === 'password' || value === 'room-name';
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
    const fingerprint = await sha256B64url(`${roomId}\n${password}`);
    return `${LOCAL_HISTORY_PREFIX}${roomId}:${fingerprint.slice(0, 32)}`;
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
    return {
      roomId: parsed.roomId,
      password: parsed.password,
      sender: typeof parsed.sender === 'string' && parsed.sender.trim() ? parsed.sender : t(dict, 'chat.guest'),
      color: typeof parsed.color === 'string' && parsed.color.trim() ? parsed.color : 'rgb(16,185,129)',
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
      const sender = item.sender || t(dict, 'chat.guest');
      const createdAt = item.time || Date.now();
      seenMessageIds.add(item.id);
      incoming.push({
        id: item.id,
        text: item.text || '',
        sender,
        initials: getInitials(sender),
        color: item.color || 'rgb(16,185,129)',
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
        color: item.color || 'rgb(16,185,129)',
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
    const stored = sessionStorage.getItem('chat-password');
    const sharePass = sessionStorage.getItem('chat-share-password');
    if (sharePass) {
      sharePassword = sharePass;
      sessionStorage.removeItem('chat-share-password');
    }
    if (stored) {
      sessionStorage.removeItem('chat-password');
      passwordInput = stored;
      await enterWithPassword(stored, { authMode: pendingRoomConfig?.authMode || 'password' });
    } else {
      connectWs();
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
    connectWs();
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
        if (currentAuthAttempt === 'room-name') {
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
    ws.send(JSON.stringify({ type: 'join', config: pendingRoomConfig || roomConfig }));

    if (typeof activePeerCount === 'number') {
      startPasswordVerification(activePeerCount);
    } else {
      verifying = true;
      verified = false;
      wrongPassword = false;
    }

    const verifyPayload = await encryptMessage(cryptoKey, JSON.stringify({ type: 'verify', sender: identity.name, color: identity.color, clientId }));
    ws.send(JSON.stringify({ type: 'message', payload: verifyPayload, id: 'verify-' + genId() }));
  }

  async function enterWithPassword(pwd: string, options: { share?: boolean; activePeerCount?: number; authMode?: ChatAuthMode } = {}) {
    try {
      clearRoomConfigWaitTimeout();
      currentAuthAttempt = options.authMode || 'password';
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
    const generated = await deriveRoomNamePassword(roomId);
    passwordInput = '';
    await enterWithPassword(generated, { share: false, activePeerCount, authMode: 'room-name' });
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
      if (roomConfig.authMode === 'room-name') {
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
      host: partyHost,
      room: roomId,
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
      // WS error means TCP/upgrade/network problem — NOT a password issue.
      // Let PartySocket retry; the 4 s handshake timeout after peers are present
      // is the authoritative wrong-password signal.
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

    // Handle server control messages
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
    if (data.id && seenMessageIds.has(data.id)) return true;

    try {
      const plaintext = await decryptMessage(cryptoKey, data.payload);
      const parsed = JSON.parse(plaintext) as ChatPayload & Record<string, any>;

      // Typing indicator
      if (parsed.type === 'typing') {
        if (fromHistory) return true;
        if (verifying) markVerified();
        typing = { sender: parsed.sender, initials: getInitials(parsed.sender), color: parsed.color };
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => { typing = null; }, 3000);
        return true;
      }

      // Verify message - someone joined with correct password
      if (parsed.type === 'verify') {
        if (fromHistory) return true;
        if (verifying) markVerified();
        if (verified && cryptoKey && ws) {
          const ack = await encryptMessage(cryptoKey, JSON.stringify({ type: 'verify-ack', sender: identity.name, color: identity.color, clientId }));
          ws.send(JSON.stringify({ type: 'message', payload: ack, id: 'vack-' + genId() }));
        }
        if (callActive) void sendCallSignal({ action: 'presence' });
        addOnlineUser(parsed.sender, parsed.color);
        void sendLiveHistorySync();
        messages = [...messages, {
          id: genId(), text: t(dict, 'chat.joinedRoom').replace('{name}', parsed.sender), sender: '', initials: '→',
          color: 'rgb(16,185,129)', mine: false, time: Date.now(), ttl: 15, remaining: 15,
        }];
        scrollToBottom();
        return true;
      }

      // Verify-ack - confirmation from existing member
      if (parsed.type === 'verify-ack') {
        if (fromHistory) return true;
        if (verifying) markVerified();
        addOnlineUser(parsed.sender, parsed.color);
        return true;
      }

      if (parsed.type === 'chat-sync') {
        if (verifying) markVerified();
        await applyLiveHistorySync(parsed.messages);
        return true;
      }

      if (parsed.type === 'whiteboard-invite') {
        if (fromHistory) return true;
        if (verifying) markVerified();
        const id = data.id || parsed.id || `whiteboard-${genId()}`;
        const invite = normalizeWhiteboardInvite(parsed);
        if (!invite) return true;
        addWhiteboardInviteMessage(invite, id, false);
        return true;
      }

      if (parsed.type === 'call-signal') {
        if (fromHistory) return true;
        if (verifying) markVerified();
        await handleCallSignal(parsed as CallSignal);
        return true;
      }

      if (!verified) markVerified();

      const id = parsed.id || data.id || genId();
      const ttl = parsed.ttl || 0;
      const msg: Message = {
        id,
        text: parsed.text || '',
        sender: parsed.sender || t(dict, 'chat.guest'),
        initials: getInitials(parsed.sender || t(dict, 'chat.guest')),
        color: parsed.color || 'rgb(16,185,129)',
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

      // Auto-preview for images and text files
      if (msg.file) autoPreview(msg);

      if (blurred) document.title = `(!) encrypt.click/chat`;
      return true;
    } catch {
      // A single failed decrypt only proves THIS message wasn't from
      // someone with our password — could be a peer in the same room
      // with a different password. The 4s init-handler timeout below
      // is the authoritative "no peer can hear me" signal.
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
      id: msgId, text, sender: identity.name, initials: myInitials,
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

    // Large text → auto-convert to file
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
          'X-Send-Secret': prepared.secretB64,
        });
        if (sendUrl) uploadUrls.push(sendUrl);
      } catch {}

      if (uploadUrls.length === 0) {
        for (const svc of shuffleArr(['quax', 'x0at', 'tmpfile'])) {
          const url = await tryHost(svc, encrypted);
          if (url) { uploadUrls.push(url); break; }
        }
      }

      if (uploadUrls.length === 0) return;

      // Send file message
      const fileTtl = roomConfig.mode === 'live' ? 0 : getRoomTtlSeconds();
      const msgId = genId();
      const createdAt = Date.now();
      const payload: ChatPayload = {
        type: 'chat-message',
        id: msgId,
        text: '',
        sender: identity.name,
        color: identity.color,
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
        id: msgId, text: '', sender: identity.name, initials: myInitials,
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
        return; // success
      } catch { continue; }
    }
    // All URLs failed
    msg.fileError = true;
    messages = messages;
  }

  let passwordUsed = '';

  let typingSent = 0;
  async function handleTyping() {
    if (!ws || !connected || !cryptoKey) return;
    // No one to show the indicator to — skip the send, save a request.
    if (serverPresence <= 1) return;
    const now = Date.now();
    if (now - typingSent > 3000) {
      // Send typing indicator as encrypted message (no leaking to wrong-password users)
      const payload = await encryptMessage(cryptoKey, JSON.stringify({ type: 'typing', sender: identity.name, color: identity.color }));
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

  function ensureCallPeer(peerId: string, name: string, color: string): CallPeer {
    let peer = callPeerMap.get(peerId);
    if (peer) {
      peer.name = name || peer.name;
      peer.color = color || peer.color;
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
      color: color || 'rgb(16,185,129)',
      pc,
      audioTransceiver,
      videoTransceiver,
      audioSender: audioTransceiver?.sender ?? null,
      videoSender: videoTransceiver?.sender ?? null,
      stream: null,
      state: pc.connectionState,
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
      startPeerAudioMonitor(current);
      syncCallPeers();
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      if (!isRelayCandidate(event.candidate)) return;
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
    const peer = ensureCallPeer(signal.from, signal.fromName, signal.fromColor);
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
      return;
    }
    try { await peer.pc.addIceCandidate(signal.candidate); } catch {}
  }

  async function handleCallSignal(signal: CallSignal) {
    if (!signal || signal.from === clientId || signal.callId !== CALL_ID) return;
    if (signal.to && signal.to !== clientId) return;

    const showActiveCallNotice = () => {
      if (callActive || callNoticeDismissed) return;
      activeCallNotice = {
        from: signal.from,
        name: signal.fromName,
        color: signal.fromColor,
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

      const peer = ensureCallPeer(signal.from, signal.fromName, signal.fromColor);
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
      await sendCallSignal({ action: 'join', reply: false });
    } catch (e: any) {
      callError = e?.message || t(dict, 'chat.callStartFailed');
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

  function addOnlineUser(name: string, color: string) {
    if (!onlineUsers.find(u => u.name === name)) {
      onlineUsers = [...onlineUsers, { name, initials: getInitials(name), color }];
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
        <p class="text-sm font-medium text-red-500">{t(dict, 'chat.wrongPassword')}</p>
        <p class="text-xs text-zinc-400 dark:text-zinc-500 leading-relaxed">{t(dict, 'chat.wrongPasswordDetail')}</p>
        <button class="btn-outline w-full text-xs" on:click={retryAfterWrongPassword}>{t(dict, 'chat.tryAgain')}</button>
      </div>
    </div>

  {:else if checkingRoom}
    <div class="chat-center">
      <div class="text-center space-y-2">
        <svg class="animate-spin mx-auto h-6 w-6 text-emerald-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
        <p class="text-xs text-zinc-400">{t(dict, 'common.working')}</p>
      </div>
    </div>

  {:else if needsPassword}
    <div class="chat-center">
      <div class="space-y-4 max-w-xs w-full">
        <div class="text-center space-y-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mx-auto text-emerald-500"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <p class="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t(dict, 'chat.roomRequiresPassword')}</p>
          <p class="text-[10px] text-zinc-400 dark:text-zinc-500 leading-relaxed">{t(dict, 'chat.roomPasswordHint')}</p>
        </div>
        <input
          type="password"
          class="input w-full"
          placeholder={t(dict, 'chat.roomPasswordPlaceholder')}
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
        <button class="btn w-full" on:click={submitPassword}>{t(dict, 'chat.enterRoom')}</button>
      </div>
    </div>

  {:else if verifying}
    <div class="chat-center">
      <div class="text-center space-y-2">
        <svg class="animate-spin mx-auto h-6 w-6 text-emerald-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
        <p class="text-xs text-zinc-400">{serverPresence > 1 ? t(dict, 'chat.verifyingPassword') : t(dict, 'chat.verifyingAlone')}</p>
      </div>
    </div>

  {:else}
    <div class="chat-header">
      <div class="flex items-center gap-2">
        <span class="chat-status" class:chat-status--connected={connected}></span>
        <div class="flex items-center -space-x-1.5">
          <div class="chat-avatar chat-avatar--sm" style="background: {nameToGradient(identity.name)}" title={identity.name}>{myInitials}</div>
          {#each onlineUsers as user}
            <div class="chat-avatar chat-avatar--sm" style="background: {nameToGradient(user.name)}" title={user.name}>{user.initials}</div>
          {/each}
        </div>
      </div>
      <div class="flex items-center gap-1.5">
        <button class="chat-call-btn" title={t(dict, 'chat.callStart')} on:click={startCall} disabled={!connected || !verified || callJoining || callActive}>
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
          <span class="text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">{t(dict, 'chat.sharePasswordWarning')}</span>
          <button class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors" on:click={() => { shareDismissed = true; }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="flex items-center gap-1.5 mb-1.5">
          <span class="text-[10px] text-zinc-400 w-8 shrink-0">{t(dict, 'chat.roomLink')}</span>
          <code class="chat-share-value">{typeof window !== 'undefined' ? window.location.href : ''}</code>
          <button class="chat-share-copy" on:click={copyShareLink}>
            {#if shareCopiedLink}
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-500"><polyline points="20 6 9 17 4 12"/></svg>
            {:else}
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            {/if}
          </button>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="text-[10px] text-zinc-400 w-8 shrink-0">{t(dict, 'chat.password')}</span>
          <code class="chat-share-value">{sharePassword}</code>
          <button class="chat-share-copy" on:click={copySharePassword}>
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
          <div class="chat-avatar chat-avatar--sm" style="background: {nameToGradient(activeCallNotice.name)}">{getInitials(activeCallNotice.name)}</div>
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
        <div class="chat-call-panel" class:chat-call-panel--error={!callActive && Boolean(callError)}>
          {#if callActive}
            <div class="chat-call-panel__top">
              <div class="min-w-0">
                <p class="chat-call-title">{callHasScreenSharing ? t(dict, 'chat.callScreenActive') : callHasVideo ? t(dict, 'chat.callVideoActive') : t(dict, 'chat.callAudioActive')}</p>
                <p class="chat-call-subtitle">{callPeers.length + 1} {t(dict, 'chat.callParticipants')}</p>
              </div>
              <div class="chat-call-panel__right">
                <div class="chat-call-statuses">
                  <div class="chat-call-server" class:chat-call-server--good={serverQuality === 'good'} class:chat-call-server--fair={serverQuality === 'fair'} class:chat-call-server--poor={serverQuality === 'poor'} class:chat-call-server--offline={serverQuality === 'offline'} title={`${t(dict, 'chat.callServer')}: ${serverName} ${serverRegion}`}>
                    <span class="chat-call-server__dot"></span>
                    <span>{serverLatencyMs !== null ? `${serverLatencyMs} ms` : getServerQualityLabel(serverQuality)}</span>
                  </div>
                  <div class="chat-call-server chat-call-server--relay" class:chat-call-server--good={relayQuality === 'good'} class:chat-call-server--fair={relayQuality === 'fair'} class:chat-call-server--poor={relayQuality === 'poor'} class:chat-call-server--offline={relayQuality === 'offline'} title={getRelayTitle()}>
                    <span class="chat-call-server__dot"></span>
                    <span>{t(dict, 'chat.callRelay')}</span>
                    <span class="chat-call-server__value">{getRelayStatusLabel()}</span>
                  </div>
                </div>
              <div class="chat-call-controls">
              <button class="chat-call-control" class:chat-call-control--active={micMuted} title={micMuted ? t(dict, 'chat.callUnmute') : t(dict, 'chat.callMute')} aria-label={micMuted ? t(dict, 'chat.callUnmute') : t(dict, 'chat.callMute')} aria-pressed={!micMuted} on:click={toggleMic}>
                {#if micMuted}
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="2" x2="22" y2="22"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><path d="M15 9.34V5a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2"/><path d="M19 10v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
                {:else}
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
                {/if}
              </button>
              <button class="chat-call-control" class:chat-call-control--active={callAudioMuted} title={callAudioMuted ? t(dict, 'chat.callUndeafen') : t(dict, 'chat.callDeafen')} aria-label={callAudioMuted ? t(dict, 'chat.callUndeafen') : t(dict, 'chat.callDeafen')} aria-pressed={callAudioMuted} on:click={() => setCallAudioMuted(!callAudioMuted)}>
                {#if callAudioMuted}
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>
                {:else}
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
                {/if}
              </button>
              <button class="chat-call-control" class:chat-call-control--active={cameraOff} title={cameraOff ? t(dict, 'chat.callCameraOn') : t(dict, 'chat.callCameraOff')} aria-label={cameraOff ? t(dict, 'chat.callCameraOn') : t(dict, 'chat.callCameraOff')} aria-pressed={!cameraOff} on:click={toggleCamera}>
                {#if cameraOff}
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="2" x2="22" y2="22"/><path d="M10.66 6H14a2 2 0 0 1 2 2v2.34l5.22-3.48A.5.5 0 0 1 22 7.28v9.44a.5.5 0 0 1-.78.42L16 13.66V16"/><path d="M14 18H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2"/></svg>
                {:else}
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="m16 13 5.22 3.48A.5.5 0 0 0 22 16.06V7.94a.5.5 0 0 0-.78-.42L16 11"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>
                {/if}
              </button>
              <button class="chat-call-control" class:chat-call-control--active={screenSharing} title={screenSharing ? t(dict, 'chat.callStopScreen') : t(dict, 'chat.callStartScreen')} aria-label={screenSharing ? t(dict, 'chat.callStopScreen') : t(dict, 'chat.callStartScreen')} aria-pressed={screenSharing} on:click={() => screenSharing ? stopScreenShare() : startScreenShare()}>
                {#if screenSharing}
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/><path d="m7 8 10 6"/><path d="m17 8-10 6"/></svg>
                {:else}
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/><path d="m8 10 4-4 4 4"/><path d="M12 6v7"/></svg>
                {/if}
              </button>
              <button class="chat-call-control" class:chat-call-control--active={callSettingsOpen} title={t(dict, 'chat.callAudioAndDevices')} aria-label={t(dict, 'chat.callAudioAndDevices')} aria-expanded={callSettingsOpen} aria-controls="chat-call-settings" on:click={() => { callSettingsOpen = !callSettingsOpen; }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8.92 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.2.48.67 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.84 0-1.31.52-1.51 1Z"/></svg>
              </button>
              <button class="chat-call-control chat-call-control--end" title={t(dict, 'chat.callHangUp')} aria-label={t(dict, 'chat.callHangUp')} on:click={() => endCall(true)}>
                <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M10.1 7.6a12.4 12.4 0 0 1 3.8 0l.6 2.7a1 1 0 0 0 .95.8h3.75a1 1 0 0 0 .98-1.2l-.48-2.38a3 3 0 0 0-2.02-2.22 18 18 0 0 0-11.36 0 3 3 0 0 0-2.02 2.22l-.48 2.38a1 1 0 0 0 .98 1.2h3.75a1 1 0 0 0 .95-.8Z"/></svg>
              </button>
              </div>
              </div>
            </div>

          {#if callSettingsOpen}
          <div class="chat-call-settings" id="chat-call-settings">
            <div class="chat-call-settings__header">
              <span>{t(dict, 'chat.callAudioAndDevices')}</span>
              <button class="chat-call-settings__refresh" title={t(dict, 'chat.callRefreshDevices')} on:click={refreshCallDevices}>
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M16 8h5V3"/></svg>
              </button>
            </div>
            <div class="chat-call-device-grid">
              <label class="chat-call-field">
                <span>{t(dict, 'chat.callMicrophone')}</span>
                <select bind:value={selectedAudioInputId} on:change={handleAudioInputChange}>
                  <option value="">{t(dict, 'chat.callDefaultMicrophone')}</option>
                  {#each audioInputDevices as device, index (device.deviceId || index)}
                    <option value={device.deviceId}>{device.label || `${t(dict, 'chat.callMicrophone')} ${index + 1}`}</option>
                  {/each}
                </select>
              </label>
              <label class="chat-call-field">
                <span>{t(dict, 'chat.callCamera')}</span>
                <select bind:value={selectedVideoInputId} on:change={handleVideoInputChange}>
                  <option value="">{t(dict, 'chat.callDefaultCamera')}</option>
                  {#each videoInputDevices as device, index (device.deviceId || index)}
                    <option value={device.deviceId}>{device.label || `${t(dict, 'chat.callCamera')} ${index + 1}`}</option>
                  {/each}
                </select>
              </label>
              {#if canSelectAudioOutput}
              <label class="chat-call-field">
                <span>{t(dict, 'chat.callAudioOutput')}</span>
                <select bind:value={selectedAudioOutputId} on:change={handleAudioOutputChange}>
                  <option value="">{t(dict, 'chat.callDefaultOutput')}</option>
                  {#each audioOutputDevices as device, index (device.deviceId || index)}
                    <option value={device.deviceId}>{device.label || `${t(dict, 'chat.callAudioOutput')} ${index + 1}`}</option>
                  {/each}
                </select>
              </label>
              {/if}
              <label class="chat-call-field chat-call-field--volume">
                <span>{t(dict, 'chat.callVolume')}</span>
                <input type="range" min="0" max="1" step="0.05" value={callVolume} disabled={callAudioMuted} on:input={(e) => setCallVolume((e.currentTarget as HTMLInputElement).value)} />
              </label>
            </div>
            <div class="chat-call-toggles">
              <label class="chat-call-toggle">
                <input type="checkbox" checked={blurCallMediaWhenAway} on:change={(e) => setBlurCallMediaWhenAway((e.currentTarget as HTMLInputElement).checked)} />
                <span>{t(dict, 'chat.callBlurMediaWhenAway')}</span>
              </label>
            </div>
            {#if callPeers.length > 0}
              <div class="chat-call-peer-audio">
                <p class="chat-call-peer-audio__title">{t(dict, 'chat.callParticipantAudio')}</p>
                {#each callPeers as peer (peer.id)}
                  <div class="chat-call-peer-row">
                    <div class="chat-call-peer-row__meta">
                      <div class="chat-avatar chat-avatar--sm" style="background: {nameToGradient(peer.name)}">{peer.initials}</div>
                      <span>{peer.name}</span>
                    </div>
                    <button class="chat-call-mini-control" class:chat-call-mini-control--active={peer.audioMuted} title={peer.audioMuted ? t(dict, 'chat.callUnmuteAllAudio') : t(dict, 'chat.callMuteAllAudio')} on:click={() => setPeerAudioMuted(peer.id, !peer.audioMuted)}>
                      {#if peer.audioMuted}
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>
                      {:else}
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                      {/if}
                    </button>
                    <input type="range" min="0" max="1" step="0.05" value={peer.volume} disabled={callAudioMuted || peer.audioMuted} on:input={(e) => setPeerVolume(peer.id, (e.currentTarget as HTMLInputElement).value)} aria-label={`${t(dict, 'chat.callVolume')} ${peer.name}`} />
                  </div>
                {/each}
              </div>
            {/if}
          </div>
          {/if}

          <div class="chat-call-grid" class:chat-call-grid--audio={!callHasVideo}>
            <div class="chat-call-tile" class:chat-call-tile--blurred={blurCallMediaWhenAway && blurred} class:chat-call-tile--speaking={localSpeaking && !micMuted}>
              {#if localDisplayStream && localHasVisibleVideo}
                <video
                  class="chat-call-video"
                  class:chat-call-video--contain={screenSharing}
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
                <button class="chat-call-fullscreen-btn" title={t(dict, 'chat.callEnterFullscreen')} on:click={() => openCallFullscreen({ source: 'local' })}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
                </button>
              {:else}
                <div class="chat-call-avatar" style="background: {nameToGradient(identity.name)}">{myInitials}</div>
              {/if}
              <div class="chat-call-label">
                <span>{t(dict, 'chat.callYou')}</span>
                {#if !micMuted}
                  <span class="chat-call-level" style={`--level: ${Math.max(0.04, localAudioLevel)}`}></span>
                {/if}
                {#if screenSharing}<span>{t(dict, 'chat.callScreenSharing')}</span>{:else if micMuted}<span>{t(dict, 'chat.callMuted')}</span>{:else if localSpeaking}<span>{t(dict, 'chat.callSpeaking')}</span>{/if}
              </div>
            </div>
            {#each callPeers as peer (peer.id)}
              <div class="chat-call-tile" class:chat-call-tile--blurred={blurCallMediaWhenAway && blurred} class:chat-call-tile--speaking={peer.speaking && !peer.muted}>
                {#if peer.stream && peer.stream.getVideoTracks().length && (peer.screenSharing || !peer.cameraOff)}
                  <video
                    class="chat-call-video"
                    class:chat-call-video--contain={peer.screenSharing}
                    use:streamMedia={{ stream: peer.stream, muted: callAudioMuted || peer.audioMuted, volume: callAudioMuted || peer.audioMuted ? 0 : callVolume * peer.volume, sinkId: selectedAudioOutputId }}
                    autoplay
                    playsinline
                    controlslist="nodownload nofullscreen noremoteplayback"
                    disablepictureinpicture
                    disableremoteplayback
                    on:pause={keepCallMediaPlaying}
                    on:contextmenu={preventMediaContextMenu}
                  ></video>
                  <button class="chat-call-fullscreen-btn" title={t(dict, 'chat.callEnterFullscreen')} on:click={() => openCallFullscreen({ source: 'peer', peerId: peer.id })}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
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
                  <div class="chat-call-avatar" style="background: {nameToGradient(peer.name)}">{peer.initials}</div>
                {/if}
                <div class="chat-call-label">
                  <span>{peer.name}</span>
                  {#if !peer.muted}
                    <span class="chat-call-level" style={`--level: ${Math.max(0.04, peer.audioLevel)}`}></span>
                  {/if}
                  {#if peer.screenSharing}<span>{t(dict, 'chat.callScreenSharing')}</span>{:else if peer.muted}<span>{t(dict, 'chat.callMuted')}</span>{:else if peer.speaking}<span>{t(dict, 'chat.callSpeaking')}</span>{:else if peer.state !== 'connected'}<span>{peer.state}</span>{/if}
                </div>
              </div>
            {/each}
          </div>
          {/if}
          {#if callError}
            <p class="chat-call-error">{callError}</p>
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
                <button class="chat-whiteboard-panel__button" title={t(dict, 'chat.whiteboardOpenNewTab')} on:click={() => openWhiteboardNewTab(activeWhiteboard!)}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>
                </button>
                <button class="chat-whiteboard-panel__button" title={t(dict, 'chat.whiteboardClose')} on:click={() => { activeWhiteboard = null; }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            </div>
            <div class="chat-whiteboard-panel__surface">
              {#key activeWhiteboard.roomId}
                <Whiteboard locale={locale} roomId={activeWhiteboard.roomId} partyHost={partyHost} initialPassword={activeWhiteboard.password} />
              {/key}
            </div>
          </div>
        {/if}
        <div class="chat-messages" class:chat-messages--blurred={blurred} bind:this={messagesEl} use:revealSpoilers>
      {#if messages.length === 0}
        <div class="chat-center">
          <div class="text-center space-y-2 max-w-xs">
            <p class="text-sm font-medium text-zinc-600 dark:text-zinc-400">{t(dict, 'chat.emptyRoomNotice')}</p>
            <p class="text-xs text-emerald-500 font-medium">{t(dict, 'chat.emptyRoomNotice2')}</p>
            <p class="text-[10px] text-zinc-400 dark:text-zinc-500 leading-relaxed">{t(dict, 'chat.emptyRoomNotice3')}</p>
          </div>
        </div>
      {/if}

      {#each messages as msg (msg.id)}
        <div class="chat-bubble" class:chat-bubble--mine={msg.mine}>
          <div class="flex items-start gap-2">
            {#if !msg.mine}
              <div class="chat-avatar" style="background: {nameToGradient(msg.sender)}">{msg.initials}</div>
            {/if}
            <div class="flex-1 min-w-0">
              <div class="chat-sender-row">
                <span class="chat-sender" style="color: {msg.mine ? 'rgb(16,185,129)' : msg.color}">{msg.sender}</span>
              </div>
              {#if msg.file}
                <div class="chat-file" class:chat-file--error={msg.fileError}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  <div class="flex-1 min-w-0">
                    <span class="chat-file__name">{msg.file.name}</span>
                    <span class="chat-file__size">
                      {#if msg.fileError}
                        Expired
                      {:else}
                        {msg.file.size < 1048576 ? `${(msg.file.size / 1024).toFixed(1)} KB` : `${(msg.file.size / 1048576).toFixed(1)} MB`}
                      {/if}
                    </span>
                  </div>
                  {#if !msg.fileError}
                    <button class="chat-file__dl" on:click={() => downloadChatFile(msg)}>
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
                        {msg.preview.expanded ? '▲' : '▼'} {msg.preview.expanded ? 'Less' : 'More'}
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
          <div class="chat-avatar chat-avatar--sm" style="background: {nameToGradient(typing.sender)}">{typing.initials}</div>
          <span style="color: {typing.color}">{typing.sender}</span> {t(dict, 'chat.isTyping')}
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
          <button class="chat-send-btn" on:click={handleSend} disabled={!connected || (!inputText.trim() && !uploading)}>
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
  .chat-container {
    display: flex;
    flex-direction: column;
    height: 75vh;
    max-height: 700px;
    border-radius: 1rem;
    overflow: hidden;
    border: 1px solid rgba(228, 228, 231, 0.6);
    background: rgba(255, 255, 255, 0.6);
    backdrop-filter: blur(12px);
  }
  :global(.dark) .chat-container {
    border-color: rgba(39, 39, 42, 0.5);
    background: rgba(9, 9, 11, 0.6);
  }
  .chat-center {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
  }
  .chat-header {
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
  .chat-body--call {
    display: grid;
    grid-template-columns: minmax(0, 1.22fr) minmax(280px, 0.78fr);
  }
  .chat-thread {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .chat-body--call .chat-thread {
    border-left: 1px solid rgba(228, 228, 231, 0.55);
    background: rgba(255, 255, 255, 0.3);
  }
  :global(.dark) .chat-body--call .chat-thread {
    border-color: rgba(39, 39, 42, 0.55);
    background: rgba(9, 9, 11, 0.18);
  }
  .chat-whiteboard-panel {
    flex: 0 0 min(430px, 58%);
    min-height: 300px;
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
    font-weight: 850;
    color: rgb(39, 39, 42);
  }
  :global(.dark) .chat-whiteboard-panel__title { color: rgb(228, 228, 231); }
  .chat-whiteboard-panel__meta {
    font-size: 11px;
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
    color: rgb(16, 185, 129);
    background: rgba(16, 185, 129, 0.08);
    border-color: rgba(16, 185, 129, 0.18);
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
    border-bottom: 1px solid rgba(16, 185, 129, 0.15);
    background: rgba(16, 185, 129, 0.04);
  }
  :global(.dark) .chat-share-banner {
    background: rgba(16, 185, 129, 0.06);
    border-color: rgba(16, 185, 129, 0.1);
  }
  .chat-share-value {
    flex: 1; min-width: 0;
    font-size: 12px; font-family: 'fira-code', monospace;
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
  .chat-share-copy:hover { color: rgb(16, 185, 129); }
  .chat-mode-badge {
    min-height: 30px;
    display: inline-flex;
    align-items: center;
    padding: 0 0.55rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(16, 185, 129, 0.18);
    background: rgba(16, 185, 129, 0.07);
    color: rgb(5, 150, 105);
    font-size: 11px;
    font-weight: 850;
    white-space: nowrap;
  }
  :global(.dark) .chat-mode-badge {
    color: rgb(110, 231, 183);
    border-color: rgba(16, 185, 129, 0.16);
    background: rgba(16, 185, 129, 0.09);
  }
  .chat-call-btn {
    width: 30px; height: 30px; border-radius: 0.5rem;
    display: inline-flex; align-items: center; justify-content: center;
    color: rgb(82, 82, 91);
    background: rgba(244, 244, 245, 0.7);
    border: 1px solid rgba(228, 228, 231, 0.7);
    transition: color 0.15s, background 0.15s, border-color 0.15s;
  }
  :global(.dark) .chat-call-btn {
    color: rgb(212, 212, 216);
    background: rgba(39, 39, 42, 0.45);
    border-color: rgba(63, 63, 70, 0.45);
  }
  .chat-call-btn:hover:not(:disabled) {
    color: rgb(16, 185, 129);
    background: rgba(16, 185, 129, 0.08);
    border-color: rgba(16, 185, 129, 0.18);
  }
  .chat-call-btn:disabled { opacity: 0.35; cursor: not-allowed; }
  .chat-call-banner {
    display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
    padding: 0.65rem 0.85rem;
    border-bottom: 1px solid rgba(16, 185, 129, 0.15);
    background: rgba(16, 185, 129, 0.05);
  }
  :global(.dark) .chat-call-banner {
    background: rgba(16, 185, 129, 0.07);
    border-color: rgba(16, 185, 129, 0.12);
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
    font-size: 11px; color: rgb(113, 113, 122);
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
    background: rgb(16, 185, 129);
  }
  .chat-call-decline {
    color: rgb(113, 113, 122);
    background: rgba(244, 244, 245, 0.85);
  }
  :global(.dark) .chat-call-decline {
    color: rgb(212, 212, 216);
    background: rgba(39, 39, 42, 0.65);
  }
  .chat-call-panel {
    min-width: 0;
    min-height: 0;
    padding: 0.75rem 0.85rem;
    border-bottom: 1px solid rgba(228, 228, 231, 0.55);
    background: rgba(250, 250, 250, 0.62);
    overflow-y: auto;
  }
  .chat-body--call .chat-call-panel {
    border-bottom: 0;
  }
  .chat-body--call .chat-call-panel__top {
    align-items: flex-start;
    flex-direction: column;
  }
  .chat-body--call .chat-call-panel__right {
    width: 100%;
    align-items: flex-start;
    flex-direction: column;
    gap: 0.5rem;
  }
  .chat-body--call .chat-call-controls {
    width: 100%;
    justify-content: flex-start;
    flex-wrap: wrap;
  }
  :global(.dark) .chat-call-panel {
    border-color: rgba(39, 39, 42, 0.55);
    background: rgba(24, 24, 27, 0.42);
  }
  .chat-call-panel--error {
    background: rgba(239, 68, 68, 0.05);
    border-color: rgba(239, 68, 68, 0.14);
  }
  .chat-call-panel__top {
    display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
  }
  .chat-call-panel__right {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    flex-shrink: 0;
  }
  .chat-call-title {
    font-size: 13px; line-height: 1.2; font-weight: 900;
    color: rgb(39, 39, 42);
  }
  :global(.dark) .chat-call-title { color: rgb(228, 228, 231); }
  .chat-call-subtitle { margin-top: 1px; font-size: 11px; color: rgb(113, 113, 122); }
  .chat-call-controls { display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0; }
  .chat-call-control {
    width: 34px; height: 34px; border-radius: 0.55rem;
    display: inline-flex; align-items: center; justify-content: center;
    color: rgb(82, 82, 91);
    background: rgba(244, 244, 245, 0.85);
    border: 1px solid rgba(228, 228, 231, 0.8);
    transition: color 0.15s, background 0.15s, border-color 0.15s;
  }
  :global(.dark) .chat-call-control {
    color: rgb(212, 212, 216);
    background: rgba(39, 39, 42, 0.7);
    border-color: rgba(63, 63, 70, 0.55);
  }
  .chat-call-control:hover:not(:disabled) {
    color: rgb(16, 185, 129);
    background: rgba(16, 185, 129, 0.08);
    border-color: rgba(16, 185, 129, 0.18);
  }
  .chat-call-control--active {
    color: rgb(239, 68, 68);
    background: rgba(239, 68, 68, 0.08);
    border-color: rgba(239, 68, 68, 0.2);
  }
  .chat-call-control--end {
    color: white;
    background: rgb(239, 68, 68);
    border-color: rgba(239, 68, 68, 0.2);
  }
  .chat-call-control--end:hover:not(:disabled) {
    color: white;
    background: rgb(220, 38, 38);
    border-color: rgba(220, 38, 38, 0.25);
  }
  .chat-call-control:disabled { opacity: 0.35; cursor: not-allowed; }
  .chat-call-statuses {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
    min-width: 0;
    max-width: 100%;
  }
  .chat-call-server {
    min-height: 28px;
    display: inline-flex; align-items: center; gap: 0.35rem;
    padding: 0 0.55rem;
    border-radius: 0.5rem;
    background: rgba(244, 244, 245, 0.82);
    border: 1px solid rgba(228, 228, 231, 0.75);
    font-size: 10px; font-weight: 800;
    color: rgb(113, 113, 122);
    white-space: nowrap;
    min-width: 0;
    max-width: 100%;
  }
  .chat-call-server--relay {
    max-width: min(100%, 320px);
  }
  .chat-call-server__value {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  :global(.dark) .chat-call-server {
    color: rgb(161, 161, 170);
    background: rgba(39, 39, 42, 0.58);
    border-color: rgba(63, 63, 70, 0.45);
  }
  .chat-call-server__dot {
    width: 8px; height: 8px; border-radius: 9999px;
    background: rgb(161, 161, 170);
    box-shadow: 0 0 0 3px rgba(161, 161, 170, 0.12);
  }
  .chat-call-server--good .chat-call-server__dot {
    background: rgb(16, 185, 129);
    box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.16);
  }
  .chat-call-server--fair .chat-call-server__dot {
    background: rgb(245, 158, 11);
    box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.16);
  }
  .chat-call-server--poor .chat-call-server__dot,
  .chat-call-server--offline .chat-call-server__dot {
    background: rgb(239, 68, 68);
    box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.16);
  }
  .chat-call-settings {
    margin-top: 0.65rem;
    padding: 0.65rem;
    border-radius: 0.65rem;
    border: 1px solid rgba(228, 228, 231, 0.68);
    background: rgba(255, 255, 255, 0.52);
  }
  :global(.dark) .chat-call-settings {
    border-color: rgba(63, 63, 70, 0.42);
    background: rgba(24, 24, 27, 0.5);
  }
  .chat-call-settings__header {
    display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
    font-size: 10px; font-weight: 900; text-transform: uppercase;
    color: rgb(113, 113, 122);
  }
  .chat-call-settings__refresh {
    width: 24px; height: 24px; border-radius: 0.4rem;
    display: inline-flex; align-items: center; justify-content: center;
    color: rgb(113, 113, 122);
    background: rgba(244, 244, 245, 0.72);
    border: 1px solid rgba(228, 228, 231, 0.7);
  }
  .chat-call-settings__refresh:hover {
    color: rgb(16, 185, 129);
    border-color: rgba(16, 185, 129, 0.2);
  }
  :global(.dark) .chat-call-settings__refresh {
    color: rgb(161, 161, 170);
    background: rgba(39, 39, 42, 0.55);
    border-color: rgba(63, 63, 70, 0.45);
  }
  .chat-call-toggles {
    display: flex; align-items: center; flex-wrap: wrap; gap: 0.45rem;
    margin-top: 0.5rem;
  }
  .chat-call-toggle {
    display: inline-flex; align-items: center; gap: 0.35rem;
    min-height: 28px;
    padding: 0 0.55rem;
    border-radius: 0.45rem;
    color: rgb(82, 82, 91);
    background: rgba(244, 244, 245, 0.76);
    border: 1px solid rgba(228, 228, 231, 0.72);
    font-size: 11px; font-weight: 800;
  }
  :global(.dark) .chat-call-toggle {
    color: rgb(212, 212, 216);
    background: rgba(39, 39, 42, 0.58);
    border-color: rgba(63, 63, 70, 0.45);
  }
  .chat-call-toggle input {
    width: 13px; height: 13px;
    accent-color: rgb(16, 185, 129);
  }
  .chat-call-device-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 0.5rem;
    margin-top: 0.55rem;
  }
  .chat-call-field {
    min-width: 0;
    display: flex; flex-direction: column; gap: 0.25rem;
  }
  .chat-call-field span {
    font-size: 10px; font-weight: 900;
    color: rgb(113, 113, 122);
  }
  .chat-call-field select,
  .chat-call-field input[type="range"] {
    width: 100%;
    min-height: 30px;
  }
  .chat-call-field select {
    border-radius: 0.45rem;
    border: 1px solid rgba(228, 228, 231, 0.75);
    background: rgba(255, 255, 255, 0.72);
    color: rgb(63, 63, 70);
    padding: 0 0.45rem;
    font-size: 11px; font-weight: 700;
    outline: none;
  }
  :global(.dark) .chat-call-field select {
    color: rgb(228, 228, 231);
    background: rgba(24, 24, 27, 0.68);
    border-color: rgba(63, 63, 70, 0.55);
  }
  .chat-call-field select:focus {
    border-color: rgba(16, 185, 129, 0.45);
  }
  .chat-call-field input[type="range"] {
    accent-color: rgb(16, 185, 129);
  }
  .chat-call-field input[type="range"]:disabled {
    opacity: 0.35;
  }
  .chat-body--call .chat-call-device-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .chat-body--call .chat-call-field--volume {
    grid-column: 1 / -1;
  }
  .chat-call-peer-audio {
    margin-top: 0.65rem;
    padding-top: 0.6rem;
    border-top: 1px solid rgba(228, 228, 231, 0.58);
  }
  :global(.dark) .chat-call-peer-audio {
    border-color: rgba(63, 63, 70, 0.42);
  }
  .chat-call-peer-audio__title {
    margin-bottom: 0.45rem;
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
    color: rgb(113, 113, 122);
  }
  .chat-call-peer-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 30px minmax(86px, 0.8fr);
    align-items: center;
    gap: 0.45rem;
    min-height: 34px;
  }
  .chat-call-peer-row + .chat-call-peer-row {
    margin-top: 0.35rem;
  }
  .chat-call-peer-row__meta {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.45rem;
    color: rgb(63, 63, 70);
    font-size: 11px;
    font-weight: 800;
  }
  :global(.dark) .chat-call-peer-row__meta {
    color: rgb(228, 228, 231);
  }
  .chat-call-peer-row__meta span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chat-call-peer-row input[type="range"] {
    width: 100%;
    accent-color: rgb(16, 185, 129);
  }
  .chat-call-peer-row input[type="range"]:disabled {
    opacity: 0.35;
  }
  .chat-call-mini-control {
    width: 28px;
    height: 28px;
    border-radius: 0.45rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: rgb(113, 113, 122);
    background: rgba(244, 244, 245, 0.78);
    border: 1px solid rgba(228, 228, 231, 0.7);
  }
  :global(.dark) .chat-call-mini-control {
    color: rgb(212, 212, 216);
    background: rgba(39, 39, 42, 0.58);
    border-color: rgba(63, 63, 70, 0.45);
  }
  .chat-call-mini-control--active {
    color: rgb(239, 68, 68);
    background: rgba(239, 68, 68, 0.08);
    border-color: rgba(239, 68, 68, 0.2);
  }
  .chat-call-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 0.55rem;
    margin-top: 0.65rem;
  }
  .chat-call-grid--audio {
    grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  }
  .chat-body--call .chat-call-grid {
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  }
  .chat-body--call .chat-call-grid--audio {
    grid-template-columns: repeat(auto-fit, minmax(118px, 1fr));
  }
  .chat-call-tile {
    position: relative;
    min-height: 92px;
    aspect-ratio: 16 / 10;
    overflow: hidden;
    border-radius: 0.5rem;
    display: flex; align-items: center; justify-content: center;
    background: rgba(228, 228, 231, 0.55);
    border: 1px solid rgba(212, 212, 216, 0.65);
    transition: border-color 0.18s ease-out, box-shadow 0.18s ease-out;
  }
  :global(.dark) .chat-call-tile {
    background: rgba(39, 39, 42, 0.65);
    border-color: rgba(63, 63, 70, 0.55);
  }
  .chat-call-tile--speaking {
    border-color: rgba(16, 185, 129, 0.72);
    box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.14);
  }
  .chat-call-grid--audio .chat-call-tile {
    min-height: 72px;
    aspect-ratio: 4 / 3;
  }
  .chat-call-video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    background: rgb(24, 24, 27);
    transition: filter 0.25s;
  }
  .chat-call-video--contain {
    object-fit: contain;
  }
  .chat-call-tile--blurred .chat-call-video {
    filter: blur(8px);
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
  .chat-call-tile:hover .chat-call-fullscreen-btn,
  .chat-call-fullscreen-btn:focus-visible {
    opacity: 1;
    transform: translateY(0);
  }
  .chat-call-fullscreen-btn:hover {
    background: rgba(16, 185, 129, 0.82);
  }
  .chat-call-avatar {
    width: 44px; height: 44px; border-radius: 9999px;
    display: flex; align-items: center; justify-content: center;
    color: white; font-size: 14px; font-weight: 900;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.14);
  }
  .chat-call-label {
    position: absolute; left: 7px; right: 7px; bottom: 7px;
    display: flex; align-items: center; justify-content: space-between; gap: 0.4rem;
    min-height: 22px;
    padding: 0 0.45rem;
    border-radius: 0.4rem;
    color: white;
    background: rgba(24, 24, 27, 0.72);
    font-size: 11px; font-weight: 800;
  }
  .chat-call-label span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chat-call-label span + span {
    flex-shrink: 0;
    color: rgb(244, 244, 245);
    opacity: 0.75;
  }
  .chat-call-level {
    flex: 1;
    min-width: 24px;
    max-width: 52px;
    height: 4px;
    border-radius: 9999px;
    background: rgba(255, 255, 255, 0.18);
    overflow: hidden;
    opacity: 0.9;
  }
  .chat-call-level::before {
    content: '';
    display: block;
    width: calc(var(--level, 0) * 100%);
    height: 100%;
    min-width: 4px;
    border-radius: inherit;
    background: rgb(52, 211, 153);
    transition: width 0.08s linear;
  }
  .chat-call-tile audio { display: none; }
  .chat-call-error {
    margin-top: 0.45rem;
    font-size: 11px; line-height: 1.45;
    color: rgb(239, 68, 68);
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
    height: 100vh;
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
    font-weight: 850;
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
  @media (max-width: 860px) {
    .chat-body--call {
      display: flex;
      flex-direction: column;
    }
    .chat-body--call .chat-call-panel {
      max-height: 52%;
      border-bottom: 1px solid rgba(228, 228, 231, 0.55);
    }
    .chat-body--call-settings .chat-call-panel {
      max-height: 80%;
    }
    :global(.dark) .chat-body--call .chat-call-panel {
      border-color: rgba(39, 39, 42, 0.55);
    }
    .chat-body--call .chat-thread {
      border-left: 0;
      min-height: 0;
    }
  }
  @media (hover: none) {
    .chat-call-fullscreen-btn {
      opacity: 1;
      transform: translateY(0);
    }
  }
  @media (max-width: 640px) {
    .chat-call-panel__top {
      align-items: flex-start;
      flex-direction: column;
    }
    .chat-call-panel__right {
      width: 100%;
      align-items: flex-start;
      flex-direction: column;
      gap: 0.5rem;
    }
    .chat-call-server {
      max-width: 100%;
    }
    .chat-call-controls {
      width: 100%;
      justify-content: flex-start;
      flex-wrap: wrap;
    }
    .chat-call-device-grid {
      grid-template-columns: 1fr;
    }
    .chat-body--call .chat-call-device-grid {
      grid-template-columns: 1fr;
    }
    .chat-call-peer-row {
      grid-template-columns: minmax(0, 1fr) 30px;
    }
    .chat-call-peer-row input[type="range"] {
      grid-column: 1 / -1;
    }
  }
  .chat-status {
    width: 8px; height: 8px; border-radius: 9999px;
    background: rgb(245, 158, 11);
    animation: chat-pulse 1.2s ease-in-out infinite;
  }
  .chat-status--connected {
    background: rgb(16, 185, 129);
    box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.2);
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
    width: 24px; height: 24px; border-radius: 9999px; font-size: 9px;
  }
  .chat-bubble {
    max-width: 85%; padding: 0.5rem 0.75rem; border-radius: 0.875rem;
    background: rgba(244, 244, 245, 0.8); align-self: flex-start;
  }
  :global(.dark) .chat-bubble { background: rgba(39, 39, 42, 0.5); }
  .chat-bubble--mine {
    align-self: flex-end;
    background: rgba(16, 185, 129, 0.12);
  }
  :global(.dark) .chat-bubble--mine { background: rgba(16, 185, 129, 0.15); }
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
    color: rgb(16, 185, 129);
  }
  .chat-timer__num {
    font-size: 10px; font-weight: 700; color: rgb(161, 161, 170);
    position: relative; z-index: 1;
  }
  .chat-text :global(strong) { font-weight: 700; }
  .chat-text :global(em) { font-style: italic; }
  .chat-text :global(del) { text-decoration: line-through; opacity: 0.6; }
  .chat-text :global(.chat-code-inline) {
    font-family: 'fira-code', monospace; font-size: 13px;
    background: rgba(16, 185, 129, 0.08); border-radius: 4px;
    padding: 2px 5px;
  }
  :global(.dark) .chat-text :global(.chat-code-inline) {
    background: rgba(16, 185, 129, 0.12);
  }
  .chat-text :global(.chat-code-block) {
    font-family: 'fira-code', monospace; font-size: 13px;
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
    background: rgba(16, 185, 129, 0.1); color: inherit;
  }
  .chat-text :global(.chat-quote) {
    border-left: 3px solid rgba(16, 185, 129, 0.4);
    padding-left: 8px; margin: 2px 0;
    color: rgb(113, 113, 122);
  }
  .chat-typing {
    font-size: 13px; color: rgb(161, 161, 170); padding: 0.3rem 0;
    display: flex; align-items: center; gap: 0.5rem;
  }
  .chat-wrong-password {
    display: flex; align-items: center; gap: 0.4rem;
    font-size: 11px; color: rgb(239, 68, 68);
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
    font-family: 'fira-code', monospace; font-size: 12px; line-height: 1.5;
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
    font-size: 11px; font-weight: 600; text-align: center;
    color: rgb(16, 185, 129);
    background: rgba(244, 244, 245, 0.8);
    border-top: 1px solid rgba(228, 228, 231, 0.5);
  }
  :global(.dark) .chat-preview-expand {
    background: rgba(24, 24, 27, 0.6);
    border-color: rgba(39, 39, 42, 0.4);
  }
  .chat-preview-expand:hover { background: rgba(16, 185, 129, 0.08); }
  .chat-attach-btn {
    padding: 0.4rem; border-radius: 0.5rem;
    color: rgb(161, 161, 170); transition: color 0.15s;
  }
  .chat-attach-menu { position: relative; flex-shrink: 0; }
  .chat-attach-btn:hover:not(:disabled),
  .chat-attach-btn--active {
    color: rgb(16, 185, 129);
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
    color: rgb(16, 185, 129);
    background: rgba(16, 185, 129, 0.08);
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
    background: rgba(16, 185, 129, 0.06);
    border: 1px solid rgba(16, 185, 129, 0.12);
    color: rgb(16, 185, 129);
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
  .chat-file__size { font-size: 11px; color: rgb(161, 161, 170); }
  .chat-file__dl {
    padding: 0.25rem; border-radius: 0.35rem;
    color: rgb(16, 185, 129); transition: background 0.15s;
  }
  .chat-file__dl:hover { background: rgba(16, 185, 129, 0.1); }
  .chat-whiteboard-card {
    display: flex;
    gap: 0.6rem;
    min-width: min(320px, 72vw);
    margin: 0.25rem 0;
    padding: 0.6rem;
    border-radius: 0.65rem;
    border: 1px solid rgba(16, 185, 129, 0.16);
    background: linear-gradient(180deg, rgba(16, 185, 129, 0.08), rgba(16, 185, 129, 0.035));
  }
  :global(.dark) .chat-whiteboard-card {
    border-color: rgba(16, 185, 129, 0.14);
    background: linear-gradient(180deg, rgba(16, 185, 129, 0.12), rgba(16, 185, 129, 0.055));
  }
  .chat-whiteboard-card__icon {
    width: 32px;
    height: 32px;
    border-radius: 0.55rem;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: rgb(16, 185, 129);
    background: rgba(16, 185, 129, 0.12);
  }
  .chat-whiteboard-card__body {
    min-width: 0;
    flex: 1;
  }
  .chat-whiteboard-card__title {
    font-size: 13px;
    font-weight: 850;
    color: rgb(39, 39, 42);
  }
  :global(.dark) .chat-whiteboard-card__title { color: rgb(228, 228, 231); }
  .chat-whiteboard-card__meta {
    margin-top: 1px;
    font-size: 11px;
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
    font-size: 11px;
    font-weight: 850;
    color: rgb(82, 82, 91);
    background: rgba(255, 255, 255, 0.72);
    border: 1px solid rgba(228, 228, 231, 0.8);
  }
  .chat-whiteboard-card__btn:hover {
    color: rgb(16, 185, 129);
    border-color: rgba(16, 185, 129, 0.22);
  }
  .chat-whiteboard-card__btn--primary {
    color: white;
    background: rgb(16, 185, 129);
    border-color: rgb(16, 185, 129);
  }
  .chat-whiteboard-card__btn--primary:hover {
    color: white;
    background: rgb(5, 150, 105);
  }
  :global(.dark) .chat-whiteboard-card__btn {
    color: rgb(212, 212, 216);
    background: rgba(39, 39, 42, 0.68);
    border-color: rgba(63, 63, 70, 0.5);
  }
  :global(.dark) .chat-whiteboard-card__btn--primary {
    color: white;
    background: rgb(16, 185, 129);
    border-color: rgb(16, 185, 129);
  }
  .chat-send-btn {
    padding: 0.4rem; border-radius: 0.5rem;
    color: rgb(16, 185, 129); transition: background 0.15s;
  }
  .chat-send-btn:hover:not(:disabled) { background: rgba(16, 185, 129, 0.1); }
  .chat-send-btn:disabled { opacity: 0.3; }
</style>
