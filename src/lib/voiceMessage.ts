import { MIC_CONSTRAINTS, buildMicChain, type MicChain } from './micChain';
export const MAX_VOICE_MS = 5 * 60_000;
export const MAX_VOICE_SECONDS = MAX_VOICE_MS / 1000;

const VOICE_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm'];
const EXTENSIONS: Record<string, string> = { webm: 'audio/webm', ogg: 'audio/ogg', m4a: 'audio/mp4' };

/** Opus in WebM where the browser can record it, otherwise the first format it supports, or its own default. */
export function pickVoiceType(supported: (type: string) => boolean): string {
  return VOICE_TYPES.find((type) => {
    try {
      return supported(type);
    } catch {
      return false;
    }
  }) ?? '';
}

export function voiceFileName(type: string, at: Date): string {
  const ext = type.startsWith('audio/ogg') ? 'ogg' : type.startsWith('audio/mp4') ? 'm4a' : 'webm';
  const stamp = at.toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
  return `voice-${stamp}.${ext}`;
}

export function voiceTypeOf(name: string): string {
  return EXTENSIONS[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'audio/webm';
}

export function validVoiceDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_VOICE_SECONDS + 1;
}

export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export type VoiceRecording = { blob: Blob; type: string; seconds: number };

export const VOICE_BARS = 40;
const PEAKS_MAX_SECONDS = 120;

export function placeholderPeaks(seed: string, bars = VOICE_BARS): number[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return Array.from({ length: bars }, (_, i) => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    return Math.min(0.9, Math.max(0.18, 0.2 + 0.55 * ((h % 1000) / 1000) * (0.65 + 0.35 * Math.sin(i / 3))));
  });
}

/** Loudness per slice of an already decrypted recording, for drawing the waveform. Null when the browser cannot decode it. */
export async function voicePeaks(blob: Blob, seconds: number, bars = VOICE_BARS): Promise<number[] | null> {
  const Ctx = typeof window === 'undefined' ? undefined : window.AudioContext ?? (window as any).webkitAudioContext;
  if (!Ctx || seconds > PEAKS_MAX_SECONDS) return null;
  const ctx: AudioContext = new Ctx();
  try {
    const data = (await ctx.decodeAudioData(await blob.arrayBuffer())).getChannelData(0);
    const size = Math.max(1, Math.floor(data.length / bars));
    const step = Math.max(1, Math.floor(size / 256));
    const rms = Array.from({ length: bars }, (_, i) => {
      let sum = 0;
      let n = 0;
      for (let j = i * size; j < Math.min(data.length, (i + 1) * size); j += step, n++) sum += data[j] * data[j];
      return n ? Math.sqrt(sum / n) : 0;
    });
    const max = Math.max(...rms);
    return max > 0 ? rms.map((v) => Math.max(0.12, Math.sqrt(v / max))) : null;
  } catch {
    return null;
  } finally {
    void ctx.close().catch(() => {});
  }
}

/**
 * One recording from the microphone. The microphone is released the moment recording stops or is cancelled, and a
 * recording that reaches the limit stops by itself.
 */
export class VoiceRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chain: MicChain | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private limit: ReturnType<typeof setTimeout> | undefined;
  private done: ((recording: VoiceRecording | null) => void) | null = null;
  private meterCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private samples: Uint8Array<ArrayBuffer> | null = null;

  constructor(private readonly onLimit: () => void, private readonly meter = false) {}

  get level(): number {
    if (!this.analyser || !this.samples) return 0;
    this.analyser.getByteTimeDomainData(this.samples);
    let sum = 0;
    for (const value of this.samples) sum += ((value - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(sum / this.samples.length) * 3.2);
  }

  private attachMeter() {
    try {
      const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!Ctx || !this.stream) return;
      const ctx: AudioContext = new Ctx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(this.stream).connect(analyser);
      this.meterCtx = ctx;
      this.analyser = analyser;
      this.samples = new Uint8Array(analyser.fftSize);
      void ctx.resume().catch(() => {});
    } catch {}
  }

  static supported(): boolean {
    return typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  }

  get elapsedMs(): number {
    return this.startedAt ? performance.now() - this.startedAt : 0;
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
    const rawTrack = this.stream.getAudioTracks()[0];
    this.chain = rawTrack ? buildMicChain(rawTrack) : null;
    const source = this.chain ? new MediaStream([this.chain.track]) : this.stream;
    const type = pickVoiceType((candidate) => MediaRecorder.isTypeSupported(candidate));
    try {
      this.recorder = new MediaRecorder(source, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32_000 });
    } catch (error) {
      this.release();
      throw error;
    }
    this.chunks = [];
    this.recorder.ondataavailable = (event) => {
      if (event.data.size) this.chunks.push(event.data);
    };
    this.recorder.onstop = () => this.finish();
    this.recorder.start(1000);
    if (this.meter) this.attachMeter();
    this.startedAt = performance.now();
    this.limit = setTimeout(() => this.onLimit(), MAX_VOICE_MS);
  }

  stop(): Promise<VoiceRecording | null> {
    return new Promise((resolve) => {
      if (!this.recorder || this.recorder.state === 'inactive') {
        this.release();
        resolve(null);
        return;
      }
      this.done = resolve;
      this.recorder.stop();
      this.release();
    });
  }

  cancel() {
    this.done = null;
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.release();
    this.chunks = [];
  }

  private finish() {
    const seconds = Math.min(MAX_VOICE_SECONDS, Math.round(this.elapsedMs / 100) / 10);
    const type = this.recorder?.mimeType || this.chunks[0]?.type || 'audio/webm';
    const done = this.done;
    this.done = null;
    this.startedAt = 0;
    this.recorder = null;
    if (!done) return;
    done(this.chunks.length ? { blob: new Blob(this.chunks, { type }), type, seconds } : null);
    this.chunks = [];
  }

  private release() {
    clearTimeout(this.limit);
    this.limit = undefined;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.chain?.track.stop();
    void this.chain?.context.close().catch(() => {});
    this.chain = null;
    void this.meterCtx?.close().catch(() => {});
    this.meterCtx = null;
    this.analyser = null;
    this.samples = null;
  }
}
