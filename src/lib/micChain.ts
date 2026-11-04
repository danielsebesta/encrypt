export type MicChain = { track: MediaStreamTrack; context: AudioContext };

export const MIC_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true } as const;

/** Rumble filter, then a gentle compressor that evens out loudness and a limiter that caps an overdriven mic. */
export function buildMicChain(raw: MediaStreamTrack): MicChain | null {
  const Ctor: typeof AudioContext | undefined = typeof window === 'undefined' ? undefined : window.AudioContext ?? (window as any).webkitAudioContext;
  if (!Ctor) return null;
  try {
    const context = new Ctor();
    const source = context.createMediaStreamSource(new MediaStream([raw]));
    const highpass = context.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 80;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.25;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.1;
    const destination = context.createMediaStreamDestination();
    source.connect(highpass).connect(compressor).connect(limiter).connect(destination);
    void context.resume().catch(() => {});
    const track = destination.stream.getAudioTracks()[0];
    if (!track) {
      void context.close().catch(() => {});
      return null;
    }
    return { track, context };
  } catch {
    return null;
  }
}
