<script lang="ts">
  import { t } from '../../lib/t';
  import { aliasGradient, gradientFor, type Alias } from '../../lib/alias';
  import { LUCIDE } from '../../lib/lucideIcons';

  export type ChatCallPeer = {
    id: string;
    name: string;
    alias?: Alias;
    stream: MediaStream | null;
    state: string;
    muted: boolean;
    cameraOff: boolean;
    screenSharing: boolean;
    volume: number;
    audioMuted: boolean;
    audioLevel: number;
    speaking: boolean;
  };

  export type ChatCallFullscreenMedia = {
    name: string;
    stream: MediaStream;
    isScreen: boolean;
  };

  export type ChatCallFullscreenTarget = {
    source: 'local' | 'peer';
    peerId?: string;
  };

  type StreamMediaOptions = MediaStream | null | undefined | {
    stream: MediaStream | null | undefined;
    muted?: boolean;
    volume?: number;
    sinkId?: string;
  };

  type TileFit = { count: number; ratio: number; max: number };

  let {
    dict,
    callActive,
    callError = '',
    callPeers,
    serverQuality,
    serverLatencyMs = null,
    callHasScreenSharing,
    callHasVideo,
    localDisplayStream = null,
    localHasVisibleVideo,
    localSpeaking,
    localAudioLevel,
    micMuted,
    cameraOff,
    screenSharing,
    callAudioMuted,
    callVolume,
    callChatUnread,
    blurWhenAway,
    blurred,
    alias,
    localName,
    audioInputDevices,
    videoInputDevices,
    audioOutputDevices,
    canSelectAudioOutput,
    relayTitle,
    relayStatusLabel,
    fullscreenMedia = null,
    callSettingsOpen = $bindable(false),
    callChatOpen = $bindable(true),
    selectedAudioInputId = $bindable(''),
    selectedVideoInputId = $bindable(''),
    selectedAudioOutputId = $bindable(''),
    fullscreenOverlayEl = $bindable<HTMLDivElement | undefined>(undefined),
    ontogglemic,
    ontogglecamera,
    ontogglescreen,
    onendcall,
    onrefreshdevices,
    onaudioinputchange,
    onvideoinputchange,
    onaudiooutputchange,
    onsetvolume,
    onsetaudiomuted,
    onsetblurwhenaway,
    onsetpeeraudiomuted,
    onsetpeervolume,
    onopenfullscreen,
    onclosefullscreen,
    onkeepplaying,
    onpreventcontextmenu,
  }: {
    dict: Record<string, string>;
    callActive: boolean;
    callError?: string;
    callPeers: ChatCallPeer[];
    serverQuality: string;
    serverLatencyMs?: number | null;
    callHasScreenSharing: boolean;
    callHasVideo: boolean;
    localDisplayStream?: MediaStream | null;
    localHasVisibleVideo: boolean;
    localSpeaking: boolean;
    localAudioLevel: number;
    micMuted: boolean;
    cameraOff: boolean;
    screenSharing: boolean;
    callAudioMuted: boolean;
    callVolume: number;
    callChatUnread: boolean;
    blurWhenAway: boolean;
    blurred: boolean;
    alias: Alias;
    localName: string;
    audioInputDevices: MediaDeviceInfo[];
    videoInputDevices: MediaDeviceInfo[];
    audioOutputDevices: MediaDeviceInfo[];
    canSelectAudioOutput: boolean;
    relayTitle: string;
    relayStatusLabel: string;
    fullscreenMedia?: ChatCallFullscreenMedia | null;
    callSettingsOpen?: boolean;
    callChatOpen?: boolean;
    selectedAudioInputId?: string;
    selectedVideoInputId?: string;
    selectedAudioOutputId?: string;
    fullscreenOverlayEl?: HTMLDivElement | undefined;
    ontogglemic: () => void;
    ontogglecamera: () => void;
    ontogglescreen: () => void;
    onendcall: () => void;
    onrefreshdevices: () => void;
    onaudioinputchange: () => void;
    onvideoinputchange: () => void;
    onaudiooutputchange: () => void;
    onsetvolume: (value: string) => void;
    onsetaudiomuted: (muted: boolean) => void;
    onsetblurwhenaway: (enabled: boolean) => void;
    onsetpeeraudiomuted: (peerId: string, muted: boolean) => void;
    onsetpeervolume: (peerId: string, value: string) => void;
    onopenfullscreen: (target: ChatCallFullscreenTarget) => void;
    onclosefullscreen: () => void;
    onkeepplaying: (event?: Event) => void;
    onpreventcontextmenu: (event: MouseEvent) => void;
  } = $props();

  function mediaElementHasLiveStream(node: HTMLMediaElement): boolean {
    const stream = node.srcObject instanceof MediaStream ? node.srcObject : null;
    return Boolean(stream?.getTracks().some((track) => track.readyState === 'live'));
  }

  function ensureMediaElementPlaying(node: HTMLMediaElement) {
    if (!mediaElementHasLiveStream(node) || !node.paused) return;
    void node.play().catch(() => {});
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

  function fitTiles(node: HTMLElement, options: TileFit) {
    let current = options;
    const gap = 8;
    const apply = () => {
      const w = node.clientWidth - 2;
      const h = node.clientHeight - 2;
      if (!w || !h) return;
      const n = Math.max(1, current.count);
      let best = 0;
      for (let cols = 1; cols <= n; cols++) {
        const rows = Math.ceil(n / cols);
        const byWidth = (w - (cols - 1) * gap) / cols;
        const byHeight = ((h - (rows - 1) * gap) / rows) * current.ratio;
        best = Math.max(best, Math.min(byWidth, byHeight));
      }
      node.style.setProperty('--tile-w', `${Math.floor(Math.min(best, current.max))}px`);
      node.style.setProperty('--tile-ratio', String(current.ratio));
    };
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    apply();
    return {
      update(next: TileFit) { current = next; apply(); },
      destroy() { observer.disconnect(); },
    };
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
</script>

    {#if callActive || callError}
      <div class="call" class:call--error={!callActive && Boolean(callError)}>
        {#if callActive}
          <div class="call__stage">
            <div class="call__status" title={relayTitle}>
              <span class="call__dot call__dot--{serverQuality}"></span>
              <span>{callHasScreenSharing ? t(dict, 'chat.callScreenActive') : callHasVideo ? t(dict, 'chat.callVideoActive') : t(dict, 'chat.callAudioActive')}</span>
              <span aria-hidden="true">·</span>
              <span class="call__count" role="img" aria-label={`${callPeers.length + 1} ${t(dict, 'chat.callParticipants')}`}>
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['users']}</svg>
                <span aria-hidden="true">{callPeers.length + 1}</span>
              </span>
              <span aria-hidden="true">·</span>
              <span class="call__count" title={t(dict, 'chat.callE2eeTitle')}>
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['lock']}</svg>
                <span>{t(dict, 'chat.callE2ee')}</span>
              </span>
              {#if serverLatencyMs !== null}<span aria-hidden="true">·</span><span>{serverLatencyMs} ms</span>{/if}
            </div>

            <div class="call__grid" use:fitTiles={{ count: callPeers.length + 1, ratio: 16 / 10, max: callHasVideo ? 1280 : 280 }}>
              <div class="call__tile" class:call__tile--speaking={localSpeaking && !micMuted} class:call__tile--blurred={blurWhenAway && blurred}>
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
                    on:pause={onkeepplaying}
                    on:contextmenu={onpreventcontextmenu}
                  ></video>
                  <button type="button" class="call__expand" title={t(dict, 'chat.callEnterFullscreen')} aria-label={t(dict, 'chat.callEnterFullscreen')} on:click={() => onopenfullscreen({ source: 'local' })}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['maximize']}</svg>
                  </button>
                {:else}
                  <div class="call__avatar" style="background: {aliasGradient(alias, localName)}" title={localName} aria-label={localName}></div>
                {/if}
                <div class="call__name">
                  <span>{t(dict, 'chat.callYou')}</span>
                  {#if micMuted}
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label={t(dict, 'chat.callMuted')}>{@html LUCIDE['mic-off']}</svg>
                  {:else}
                    <span class="call__level" style={`--level: ${Math.max(0.04, localAudioLevel)}`}></span>
                  {/if}
                  {#if screenSharing}
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label={t(dict, 'chat.callScreenSharing')} class="call__name-screen">{@html LUCIDE['monitor']}</svg>
                  {/if}
                </div>
              </div>

              {#each callPeers as peer (peer.id)}
                <div class="call__tile" class:call__tile--speaking={peer.speaking && !peer.muted} class:call__tile--blurred={blurWhenAway && blurred}>
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
                      on:pause={onkeepplaying}
                      on:contextmenu={onpreventcontextmenu}
                    ></video>
                    <button type="button" class="call__expand" title={t(dict, 'chat.callEnterFullscreen')} aria-label={t(dict, 'chat.callEnterFullscreen')} on:click={() => onopenfullscreen({ source: 'peer', peerId: peer.id })}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['maximize']}</svg>
                    </button>
                  {:else}
                    {#if peer.stream}
                      <audio
                        use:streamMedia={{ stream: peer.stream, muted: callAudioMuted || peer.audioMuted, volume: callAudioMuted || peer.audioMuted ? 0 : callVolume * peer.volume, sinkId: selectedAudioOutputId }}
                        autoplay
                        controlslist="nodownload noremoteplayback"
                        disableremoteplayback
                        on:pause={onkeepplaying}
                        on:contextmenu={onpreventcontextmenu}
                      ></audio>
                    {/if}
                    <div class="call__avatar" style="background: {gradientFor(peer.alias, peer.name)}" title={peer.name} aria-label={peer.name}></div>
                  {/if}
                  <div class="call__name">
                    <span>{peer.name}</span>
                    {#if peer.muted}
                      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label={t(dict, 'chat.callMuted')}>{@html LUCIDE['mic-off']}</svg>
                    {:else}
                      <span class="call__level" style={`--level: ${Math.max(0.04, peer.audioLevel)}`}></span>
                    {/if}
                    {#if peer.screenSharing}
                      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label={t(dict, 'chat.callScreenSharing')} class="call__name-screen">{@html LUCIDE['monitor']}</svg>
                    {/if}
                    {#if peer.state !== 'connected'}<span class="call__name-state" class:call__name-state--failed={peer.state === 'failed'} role="img" aria-label={peer.state === 'failed' ? t(dict, 'chat.callConnectionFailed') : t(dict, 'chat.callPeerConnecting')} title={peer.state === 'failed' ? t(dict, 'chat.callConnectionFailed') : t(dict, 'chat.callPeerConnecting')}></span>{/if}
                  </div>
                </div>
              {/each}
            </div>
          </div>

          <div class="call__bar">
            <button type="button" class="call__btn" class:call__btn--off={micMuted} title={micMuted ? t(dict, 'chat.callUnmute') : t(dict, 'chat.callMute')} aria-label={micMuted ? t(dict, 'chat.callUnmute') : t(dict, 'chat.callMute')} aria-pressed={!micMuted} on:click={ontogglemic}>
              {#if micMuted}
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['mic-off']}</svg>
              {:else}
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['mic']}</svg>
              {/if}
            </button>
            <button type="button" class="call__btn" class:call__btn--off={cameraOff} title={cameraOff ? t(dict, 'chat.callCameraOn') : t(dict, 'chat.callCameraOff')} aria-label={cameraOff ? t(dict, 'chat.callCameraOn') : t(dict, 'chat.callCameraOff')} aria-pressed={!cameraOff} on:click={ontogglecamera}>
              {#if cameraOff}
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['video-off']}</svg>
              {:else}
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['video']}</svg>
              {/if}
            </button>
            <button type="button" class="call__btn" class:call__btn--on={screenSharing} title={screenSharing ? t(dict, 'chat.callStopScreen') : t(dict, 'chat.callStartScreen')} aria-label={screenSharing ? t(dict, 'chat.callStopScreen') : t(dict, 'chat.callStartScreen')} aria-pressed={screenSharing} on:click={ontogglescreen}>
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['monitor-up']}</svg>
            </button>
            <button type="button" class="call__btn" class:call__btn--on={callSettingsOpen} title={t(dict, 'chat.callAudioAndDevices')} aria-label={t(dict, 'chat.callAudioAndDevices')} aria-expanded={callSettingsOpen} aria-controls="chat-call-settings" data-call-settings-trigger on:click={() => { callSettingsOpen = !callSettingsOpen; }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['settings']}</svg>
            </button>
            <button type="button" class="call__btn call__btn--chat" class:call__btn--on={callChatOpen} title={callChatOpen ? t(dict, 'chat.callHideChat') : t(dict, 'chat.callShowChat')} aria-label={callChatOpen ? t(dict, 'chat.callHideChat') : t(dict, 'chat.callShowChat')} aria-pressed={callChatOpen} on:click={() => { callChatOpen = !callChatOpen; }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['message-square']}</svg>
              {#if callChatUnread}<span class="call__badge" aria-hidden="true"></span>{/if}
            </button>
            <button type="button" class="call__btn call__btn--leave" title={t(dict, 'chat.callHangUp')} aria-label={t(dict, 'chat.callHangUp')} on:click={onendcall}>
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['phone-off']}</svg>
            </button>
          </div>

          {#if callSettingsOpen}
            <div class="call__settings" id="chat-call-settings" role="dialog" aria-label={t(dict, 'chat.callAudioAndDevices')}>
              <div class="call__settings-head">
                <span>{t(dict, 'chat.callAudioAndDevices')}</span>
                <button type="button" class="btn-ghost btn-sm btn-icon" title={t(dict, 'chat.callRefreshDevices')} aria-label={t(dict, 'chat.callRefreshDevices')} on:click={onrefreshdevices}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['refresh-cw']}</svg>
                </button>
              </div>
              <div class="call__fields">
                <div class="field">
                  <label class="label" for="call-mic">{t(dict, 'chat.callMicrophone')}</label>
                  <select id="call-mic" class="input" bind:value={selectedAudioInputId} on:change={onaudioinputchange}>
                    <option value="">{t(dict, 'chat.callDefaultMicrophone')}</option>
                    {#each audioInputDevices as device, index (device.deviceId || index)}
                      <option value={device.deviceId}>{device.label || `${t(dict, 'chat.callMicrophone')} ${index + 1}`}</option>
                    {/each}
                  </select>
                </div>
                <div class="field">
                  <label class="label" for="call-cam">{t(dict, 'chat.callCamera')}</label>
                  <select id="call-cam" class="input" bind:value={selectedVideoInputId} on:change={onvideoinputchange}>
                    <option value="">{t(dict, 'chat.callDefaultCamera')}</option>
                    {#each videoInputDevices as device, index (device.deviceId || index)}
                      <option value={device.deviceId}>{device.label || `${t(dict, 'chat.callCamera')} ${index + 1}`}</option>
                    {/each}
                  </select>
                </div>
                {#if canSelectAudioOutput}
                  <div class="field">
                    <label class="label" for="call-out">{t(dict, 'chat.callAudioOutput')}</label>
                    <select id="call-out" class="input" bind:value={selectedAudioOutputId} on:change={onaudiooutputchange}>
                      <option value="">{t(dict, 'chat.callDefaultOutput')}</option>
                      {#each audioOutputDevices as device, index (device.deviceId || index)}
                        <option value={device.deviceId}>{device.label || `${t(dict, 'chat.callAudioOutput')} ${index + 1}`}</option>
                      {/each}
                    </select>
                  </div>
                {/if}
                <div class="field">
                  <label class="label" for="call-volume">{t(dict, 'chat.callVolume')}</label>
                  <input id="call-volume" type="range" min="0" max="1" step="0.05" value={callVolume} disabled={callAudioMuted} on:input={(e) => onsetvolume((e.currentTarget as HTMLInputElement).value)} />
                </div>
              </div>
              <label class="check">
                <input type="checkbox" checked={callAudioMuted} on:change={(e) => onsetaudiomuted((e.currentTarget as HTMLInputElement).checked)} />
                <span>{t(dict, 'chat.callDeafen')}</span>
              </label>
              <label class="check">
                <input type="checkbox" checked={blurWhenAway} on:change={(e) => onsetblurwhenaway((e.currentTarget as HTMLInputElement).checked)} />
                <span>{t(dict, 'chat.blurWhenAway')}</span>
              </label>
              {#if callPeers.length > 0}
                <div class="call__peers">
                  <p class="label">{t(dict, 'chat.callParticipantAudio')}</p>
                  {#each callPeers as peer (peer.id)}
                    <div class="call__peer">
                      <div class="call__peer-name">
                        <div class="chat-avatar chat-avatar--sm" style="background: {gradientFor(peer.alias, peer.name)}" title={peer.name} aria-label={peer.name}></div>
                        <span>{peer.name}</span>
                      </div>
                      <button type="button" class="btn-ghost btn-sm btn-icon" class:text-danger={peer.audioMuted} title={peer.audioMuted ? t(dict, 'chat.callUnmuteAllAudio') : t(dict, 'chat.callMuteAllAudio')} aria-label={peer.audioMuted ? t(dict, 'chat.callUnmuteAllAudio') : t(dict, 'chat.callMuteAllAudio')} aria-pressed={peer.audioMuted} on:click={() => onsetpeeraudiomuted(peer.id, !peer.audioMuted)}>
                        {#if peer.audioMuted}
                          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['volume-x']}</svg>
                        {:else}
                          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['volume-1']}</svg>
                        {/if}
                      </button>
                      <input type="range" min="0" max="1" step="0.05" value={peer.volume} disabled={callAudioMuted || peer.audioMuted} on:input={(e) => onsetpeervolume(peer.id, (e.currentTarget as HTMLInputElement).value)} aria-label={`${t(dict, 'chat.callVolume')} ${peer.name}`} />
                    </div>
                  {/each}
                </div>
              {/if}
              <p class="call__relay">{t(dict, 'chat.callRelay')}: {relayStatusLabel}</p>
            </div>
          {/if}
        {/if}
        {#if callError}
          <p class="status status--error" role="alert">{callError}</p>
        {/if}
      </div>
    {/if}


{#if fullscreenMedia}
  <div
    class="chat-call-fullscreen"
    bind:this={fullscreenOverlayEl}
    role="dialog"
    aria-modal="true"
    aria-label={fullscreenMedia.name}
    tabindex="-1"
  >
    <div class="chat-call-fullscreen__bar">
      <div class="chat-call-fullscreen__meta">
        <span>{fullscreenMedia.name}</span>
        {#if fullscreenMedia.isScreen}<span>{t(dict, 'chat.callScreenSharing')}</span>{/if}
      </div>
      <button class="chat-call-fullscreen__close" title={t(dict, 'chat.callExitFullscreen')} on:click={() => onclosefullscreen()}>
        <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">{@html LUCIDE['minimize']}</svg>
      </button>
    </div>
    <video
      class="chat-call-fullscreen__video"
      use:streamMedia={{ stream: fullscreenMedia.stream, muted: true, volume: 0 }}
      autoplay
      muted
      playsinline
      controlslist="nodownload nofullscreen noremoteplayback"
      disablepictureinpicture
      disableremoteplayback
      on:pause={onkeepplaying}
      on:contextmenu={onpreventcontextmenu}
    ></video>
  </div>
{/if}

<style>
  .call {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: #070b06;
    color: #ecf39e;
  }
  .call--error {
    background: transparent;
    color: inherit;
    padding: 0.75rem;
  }
  .call__stage {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    padding: 0.6rem 0.6rem 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .call__status {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.4rem;
    font-size: 0.75rem;
    font-weight: 700;
    color: #c4d0bd;
  }
  .call__dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: #6b7f63;
  }
  .call__dot--good { background: #6fa23c; }
  .call__dot--fair { background: #f0b232; }
  .call__dot--poor,
  .call__dot--offline { background: #f23f43; }
  .call__grid {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-wrap: wrap;
    align-content: center;
    justify-content: center;
    gap: 8px;
  }
  .call__tile {
    position: relative;
    width: var(--tile-w, 200px);
    aspect-ratio: var(--tile-ratio, 1.6);
    container-type: inline-size;
    border-radius: 0.75rem;
    overflow: hidden;
    background: #0d140b;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 0 0 2px transparent;
    transition: box-shadow 0.15s ease-out;
  }
  .call__tile--speaking {
    box-shadow: 0 0 0 2px #6fa23c;
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
    width: clamp(36px, 28cqw, 88px);
    aspect-ratio: 1;
    border-radius: 999px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background-color: #111;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.12);
  }
  .call__name {
    position: absolute;
    left: 0.4rem;
    bottom: 0.4rem;
    max-width: calc(100% - 0.8rem);
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
    color: #6fa23c;
  }
  .call__name-state {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: #f0b232;
    animation: call-pulse 1.2s ease-in-out infinite;
  }
  .call__name-state--failed {
    background: #f23f43;
    animation: none;
  }
  @keyframes call-pulse {
    50% { opacity: 0.35; }
  }
  @media (prefers-reduced-motion: reduce) {
    .call__name-state { animation: none; }
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
    background: #6fa23c;
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
  .call__count {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
  .call__bar {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0.5rem 0.6rem 0.6rem;
  }
  .call__btn {
    position: relative;
    width: 44px;
    height: 44px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: #0d140b;
    color: #ecf39e;
    transition: background-color 0.15s ease-out, color 0.15s ease-out, transform 0.1s ease-out;
  }
  .call__btn:hover:not(:disabled) {
    background: #1f301b;
  }
  .call__btn:active:not(:disabled) {
    transform: scale(0.96);
  }
  .call__btn--off {
    background: #ecf39e;
    color: #f23f43;
  }
  .call__btn--off:hover:not(:disabled) {
    background: #fff;
  }
  .call__btn--on {
    background: #ecf39e;
    color: #070b06;
  }
  .call__btn--on:hover:not(:disabled) {
    background: #fff;
  }
  .call__btn--leave {
    width: 56px;
    background: #f23f43;
    color: #fff;
  }
  .call__badge {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 9px;
    height: 9px;
    border-radius: 999px;
    background: #f23f43;
    box-shadow: 0 0 0 2px #070b06;
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
    right: 0.6rem;
    bottom: 3.9rem;
    width: min(19rem, calc(100% - 1.2rem));
    max-height: calc(100% - 4.5rem);
    z-index: 2;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
    padding: 0.5rem 0.65rem 0.65rem;
    border-radius: 0.75rem;
    border: 1px solid #1f301b;
    background: #0d140b;
    display: grid;
    gap: 0.4rem;
    font-size: 0.8125rem;
    overflow: auto;
    overscroll-behavior: contain;
  }
  .call__settings-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-weight: 700;
  }
  .call__settings .label,
  .call__settings .check {
    color: #ecf39e;
  }
  .call__settings .label {
    font-size: 0.75rem;
    color: #c4d0bd;
  }
  .call__settings .field {
    gap: 0.25rem;
  }
  .call__settings .check {
    min-height: 2rem;
    gap: 0.5rem;
    font-size: 0.8125rem;
  }
  .call__settings input[type="range"] {
    height: 1.25rem;
  }
  .call__settings .input {
    background: #070b06;
    border-color: #1f301b;
    color: #ecf39e;
    min-height: 2rem;
    padding-top: 0.25rem;
    padding-bottom: 0.25rem;
    font-size: 0.8125rem;
  }
  .call__settings .btn-ghost {
    color: #c4d0bd;
  }
  .call__settings .btn-ghost:hover {
    background: #1f301b;
    color: #fff;
  }
  .call__settings .btn-ghost.text-danger {
    color: #f23f43;
  }
  .call__fields {
    display: grid;
    gap: 0.5rem;
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
    color: #c4d0bd;
  }
  .call .status--error {
    margin: 0.75rem;
  }
  :global(.chat-body--call) > .call {
    flex: 1 1 58%;
    min-height: 240px;
    overflow: hidden;
  }
  :global(.chat-body--call > .chat-thread) {
    flex: 1 1 42%;
    min-height: 180px;
  }
  :global(.chat-body.chat-body--chat-hidden > .chat-thread) {
    display: none;
  }
  @container chat-body (min-width: 760px) {
    :global(.chat-body--call) {
      flex-direction: row;
    }
    :global(.chat-body--call) > .call {
      flex: 1 1 auto;
      min-height: 0;
    }
    :global(.chat-body--call > .chat-thread) {
      flex: 0 0 clamp(280px, 34%, 380px);
      min-height: 0;
      border-left: 1px solid var(--line-soft);
    }
  }
  @media (hover: none) {
    .call__expand {
      opacity: 1;
    }
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
    background: rgba(7, 11, 6, 0.68);
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
    background: var(--bg);
    outline: none;
  }
  .chat-call-fullscreen__video {
    width: 100vw;
    height: 100dvh;
    object-fit: contain;
    background: var(--bg);
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
    background: rgba(7, 11, 6, 0.74);
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
    background: rgba(7, 11, 6, 0.74);
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
</style>
