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

/**
 * One recording from the microphone. The microphone is released the moment recording stops or is cancelled, and a
 * recording that reaches the limit stops by itself.
 */
export class VoiceRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private limit: ReturnType<typeof setTimeout> | undefined;
  private done: ((recording: VoiceRecording | null) => void) | null = null;

  constructor(private readonly onLimit: () => void) {}

  static supported(): boolean {
    return typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  }

  get elapsedMs(): number {
    return this.startedAt ? performance.now() - this.startedAt : 0;
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const type = pickVoiceType((candidate) => MediaRecorder.isTypeSupported(candidate));
    try {
      this.recorder = new MediaRecorder(this.stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32_000 });
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
  }
}
