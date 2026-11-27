export type VoiceSessionControls = {
  play: () => void;
  pause: () => void;
  seekTo: (seconds: number) => void;
  seekBy: (delta: number) => void;
  stop: () => void;
};

let owner: symbol | null = null;

function mediaSession(): MediaSession | null {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return null;
  return navigator.mediaSession;
}

function setAction(ms: MediaSession, action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
  try {
    ms.setActionHandler(action, handler);
  } catch {}
}

export function claimVoiceMediaSession(
  token: symbol,
  title: string,
  controls: VoiceSessionControls,
): void {
  const ms = mediaSession();
  if (!ms) return;
  owner = token;
  try {
    ms.metadata = new MediaMetadata({
      title,
      artwork: [{ src: '/web-app-manifest-192x192-any.png', sizes: '192x192', type: 'image/png' }],
    });
  } catch {}
  setAction(ms, 'play', () => controls.play());
  setAction(ms, 'pause', () => controls.pause());
  setAction(ms, 'stop', () => controls.stop());
  setAction(ms, 'seekbackward', (detail) => controls.seekBy(-(detail.seekOffset ?? 5)));
  setAction(ms, 'seekforward', (detail) => controls.seekBy(detail.seekOffset ?? 5));
  setAction(ms, 'seekto', (detail) => {
    if (typeof detail.seekTime === 'number') controls.seekTo(detail.seekTime);
  });
}

export function updateVoiceMediaSession(
  token: symbol,
  playing: boolean,
  position: number,
  duration: number,
): void {
  if (owner !== token) return;
  const ms = mediaSession();
  if (!ms) return;
  ms.playbackState = playing ? 'playing' : 'paused';
  if (!duration || !Number.isFinite(duration)) return;
  try {
    ms.setPositionState?.({
      duration,
      position: Math.max(0, Math.min(duration, position)),
      playbackRate: 1,
    });
  } catch {}
}

export function releaseVoiceMediaSession(token: symbol): void {
  if (owner !== token) return;
  owner = null;
  const ms = mediaSession();
  if (!ms) return;
  for (const action of ['play', 'pause', 'stop', 'seekbackward', 'seekforward', 'seekto'] as MediaSessionAction[]) {
    setAction(ms, action, null);
  }
  try {
    ms.metadata = null;
  } catch {}
  ms.playbackState = 'none';
}

export function voiceMediaSessionOwner(): symbol | null {
  return owner;
}
