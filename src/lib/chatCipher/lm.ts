import {
  AutoModelForCausalLM,
  AutoTokenizer,
  DynamicCache,
  Tensor,
  env,
  type PreTrainedModel,
  type PreTrainedTokenizer,
} from '@huggingface/transformers';
import { assertOffline } from './cache';
import { PACKS, type PackId } from './packs';
import type { ChatCipherProgress } from './progress';
import { createStegoCodec, type StegoCodec, type StegoProgress } from './stego';

type PastCache = InstanceType<typeof DynamicCache>;

/**
 * transformers.js session outputs use `present.*` keys; generation wraps them via
 * getPastKeyValues (not public). Mirror that rename so we can feed past_key_values.
 */
function extractPast(out: Record<string, unknown>, previous: PastCache | null): PastCache | null {
  const pkvs: Record<string, Tensor> = Object.create(null);
  let found = false;
  for (const name of Object.keys(out)) {
    if (!name.startsWith('present')) continue;
    found = true;
    const newName = name
      .replace('present_ssm', 'past_ssm')
      .replace('present_conv', 'past_conv')
      .replace('present_recurrent', 'past_recurrent')
      .replace('present_compressor', 'past_compressor')
      .replace('present_indexer', 'past_indexer')
      .replace('present', 'past_key_values');
    const value = out[name];
    if (value instanceof Tensor) pkvs[newName] = value;
  }
  if (!found) return null;
  if (previous) {
    previous.update(pkvs);
    return previous;
  }
  return new DynamicCache(pkvs);
}

let configured = false;

function configureEnv() {
  if (configured) return;
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.useBrowserCache = true;
  // Oversized ORT WASM is not in the Worker assets bundle; serve from same-origin /models/ort/.
  const wasm = env.backends?.onnx?.wasm;
  if (wasm) {
    wasm.wasmPaths = `${typeof location !== 'undefined' ? location.origin : ''}/models/ort/`;
    // Multi-thread ORT workers hang in some Chromium embeds; single-thread is reliable enough for Kecal/Falcon.
    wasm.numThreads = 1;
    wasm.proxy = false;
  }
  configured = true;
}

export type CoverProgress = (done: number, total: number, preview?: string) => void;

export interface LmSession {
  lang: PackId;
  encodeCover(data: Uint8Array, onProgress?: CoverProgress): Promise<string>;
  decodeCover(text: string, onProgress?: StegoProgress): Promise<Uint8Array>;
}

/** Browser WebGPU availability before any model load. */
export type AcceleratorProbe = {
  status: 'unsupported' | 'no-adapter' | 'ready';
  /** Adapter label when status is ready (vendor / device). */
  name: string;
};

/** Actual device used by a loaded ONNX session. */
export type LmRuntimeInfo = {
  device: 'webgpu' | 'wasm';
  kv: boolean;
  adapterName: string;
  /** Why WASM was chosen despite a probe that looked ready. */
  fallback: 'timeout' | 'error' | null;
};

type Loaded = {
  model: PreTrainedModel;
  tokenizer: PreTrainedTokenizer;
  stego: StegoCodec;
  runtime: LmRuntimeInfo;
};

const loaded = new Map<PackId, Loaded>();

type GpuAdapterLike = {
  info?: { vendor?: string; device?: string; description?: string; adapterType?: string };
  requestAdapterInfo?: () => Promise<{ vendor?: string; device?: string; description?: string }>;
};

function formatAdapterName(adapter: GpuAdapterLike): string {
  const info = adapter.info;
  if (info) {
    const bits = [info.vendor, info.device || info.description, info.adapterType].filter(Boolean);
    if (bits.length) return bits.join(' · ');
  }
  return 'WebGPU';
}

/** Probe WebGPU without loading a model — safe to call on page mount. */
export async function probeAccelerator(): Promise<AcceleratorProbe> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!gpu) return { status: 'unsupported', name: '' };
    const raw = await gpu.requestAdapter();
    if (!raw) return { status: 'no-adapter', name: '' };
    const adapter = raw as GpuAdapterLike;
    // Older Chromium: info may need requestAdapterInfo().
    if (!adapter.info && typeof adapter.requestAdapterInfo === 'function') {
      try {
        const info = await adapter.requestAdapterInfo();
        const bits = [info.vendor, info.device || info.description].filter(Boolean);
        return { status: 'ready', name: bits.join(' · ') || 'WebGPU' };
      } catch {
        /* fall through */
      }
    }
    return { status: 'ready', name: formatAdapterName(adapter) };
  } catch {
    return { status: 'unsupported', name: '' };
  }
}

/** Runtime used by an already-loaded pack, or null before first encrypt/decrypt. */
export function getLmRuntime(lang: PackId): LmRuntimeInfo | null {
  return loaded.get(lang)?.runtime ?? null;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      err => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function modelAllowsKvCache(model: PreTrainedModel): boolean {
  const params = (model as unknown as { forward_params?: string[] }).forward_params;
  if (Array.isArray(params) && params.includes('past_key_values')) return true;
  const sessions = (model as unknown as { sessions?: Record<string, { inputNames?: string[] }> }).sessions;
  if (!sessions) return false;
  return Object.values(sessions).some(
    s => Array.isArray(s.inputNames) && s.inputNames.some(n => n.includes('past_key_values')),
  );
}

async function loadOnnx(lang: PackId, onProgress?: ChatCipherProgress): Promise<Loaded> {
  configureEnv();
  await assertOffline(lang);
  const pack = PACKS[lang];
  if (pack.engine !== 'onnx') throw new Error('Pack is not an ONNX model');

  const modelId = pack.base.replace(/\/$/, '');
  let tokenizer: PreTrainedTokenizer;
  let model: PreTrainedModel;
  let device: 'webgpu' | 'wasm' = 'wasm';
  let fallback: LmRuntimeInfo['fallback'] = null;
  let adapterName = '';
  try {
    tokenizer = await AutoTokenizer.from_pretrained(modelId, { local_files_only: true });
    const probe = await probeAccelerator();
    adapterName = probe.name;
    const dtype = pack.dtype ?? 'q8';
    const load = (next: 'webgpu' | 'wasm') =>
      AutoModelForCausalLM.from_pretrained(modelId, {
        local_files_only: true,
        dtype,
        device: next,
      });
    // WebGPU can hang forever on some GPUs/drivers; race a timeout then fall back to WASM.
    if (probe.status === 'ready') {
      onProgress?.('loadModel', { backend: 'webgpu' });
      try {
        model = await withTimeout(load('webgpu'), 20_000, 'WebGPU model load');
        device = 'webgpu';
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        fallback = /timed out/i.test(msg) ? 'timeout' : 'error';
        onProgress?.('loadModel', { backend: 'wasm' });
        model = await load('wasm');
        device = 'wasm';
      }
    } else {
      onProgress?.('loadModel', { backend: 'wasm' });
      model = await load('wasm');
      device = 'wasm';
    }
  } catch (e: unknown) {
    const detail = e instanceof Error && e.message ? e.message : String(e);
    throw new Error(`ONNX model failed to load: ${detail}`, { cause: e });
  }

  const ban: number[] = [];
  for (const key of ['pad_token_id', 'bos_token_id', 'unk_token_id'] as const) {
    const id = (tokenizer as unknown as Record<string, unknown>)[key];
    if (typeof id === 'number' && id >= 0) ban.push(id);
  }
  // Keep cover paste-friendly: no newlines/tabs that indent lines in chat UIs.
  ban.push(...layoutBreakTokenIds(tokenizer));

  const startId =
    (typeof tokenizer.bos_token_id === 'number' && tokenizer.bos_token_id >= 0
      ? tokenizer.bos_token_id
      : null) ??
    (typeof tokenizer.eos_token_id === 'number' ? tokenizer.eos_token_id : 0);

  const config = (
    model as unknown as {
      config?: { model_type?: string; n_positions?: number; max_position_embeddings?: number };
    }
  ).config;
  const window =
    (typeof config?.n_positions === 'number' && config.n_positions > 0 ? config.n_positions : null) ??
    (typeof config?.max_position_embeddings === 'number' && config.max_position_embeddings > 0
      ? config.max_position_embeddings
      : 2048);
  // Kecal's GPT-2 ONNX export requires mask + positions; Falcon accepts input_ids alone.
  const gpt2Inputs = config?.model_type === 'gpt2';
  const kvOk = modelAllowsKvCache(model);

  const stego = createStegoCodec(createCachedScorer(model, window, gpt2Inputs, kvOk), {
    start: [startId],
    topK: 16,
    ban,
    maxTokens: 3000,
  });

  // Warm the session so the first cover token is not a cold GPU/WASM compile.
  try {
    const warm: Record<string, unknown> = {
      input_ids: new Tensor('int64', BigInt64Array.from([BigInt(startId)]), [1, 1]),
    };
    if (gpt2Inputs) {
      warm.attention_mask = new Tensor('int64', BigInt64Array.from([1n]), [1, 1]);
      warm.position_ids = new Tensor('int64', BigInt64Array.from([0n]), [1, 1]);
    }
    await model(warm as never);
  } catch {
    /* warmup is best-effort */
  }

  return {
    model,
    tokenizer,
    stego,
    runtime: { device, kv: kvOk, adapterName, fallback },
  };
}

/**
 * Prefer past_key_values so each new cover token only runs the last position.
 * Falls back to full-window forwards if the ONNX pack has no KV inputs or a step fails.
 */
function createCachedScorer(
  model: PreTrainedModel,
  window: number,
  gpt2Inputs: boolean,
  allowKv: boolean,
) {
  let past: PastCache | null = null;
  let cachedLen = 0;
  let kvEnabled = allowKv;

  const reset = () => {
    if (past) void past.dispose();
    past = null;
    cachedLen = 0;
  };

  const run = async (feed: number[], absStart: number, usePast: PastCache | null) => {
    const len = feed.length;
    const ids = BigInt64Array.from(feed.map(n => BigInt(n)));
    const feeds: Record<string, unknown> = {
      input_ids: new Tensor('int64', ids, [1, len]),
      // Only the last position is used for stego; skip full-seq LM-head when the export allows it.
      num_logits_to_keep: new Tensor('int64', [1n], []),
    };
    if (gpt2Inputs) {
      const pastLen = usePast ? usePast.get_seq_length() : 0;
      const maskLen = pastLen + len;
      feeds.attention_mask = new Tensor(
        'int64',
        BigInt64Array.from({ length: maskLen }, () => 1n),
        [1, maskLen],
      );
      feeds.position_ids = new Tensor(
        'int64',
        BigInt64Array.from({ length: len }, (_, i) => BigInt(absStart + i)),
        [1, len],
      );
    }
    if (usePast) feeds.past_key_values = usePast;
    const out = (await model(feeds as never)) as Record<string, unknown> & { logits: Tensor };
    const logits = out.logits;
    const seq = logits.dims[1] ?? len;
    const vocab = logits.dims[2] ?? logits.dims[1]!;
    const data = logits.data as Float32Array;
    const offset = (seq - 1) * vocab;
    return {
      logits: data.slice(offset, offset + vocab),
      past: extractPast(out, usePast),
    };
  };

  return async (context: number[]) => {
    const tokens = context.length > window ? context.slice(context.length - window) : context;
    // Sliding the window drops prefix tokens → cached K/V no longer match.
    const continued = Boolean(past) && tokens.length === cachedLen + 1 && tokens.length <= window;

    if (kvEnabled && continued && past) {
      try {
        const feed = [tokens[tokens.length - 1]!];
        const result = await run(feed, tokens.length - 1, past);
        if (!result.past) throw new Error('KV cache missing from model output');
        past = result.past;
        cachedLen = tokens.length;
        return result.logits;
      } catch {
        kvEnabled = false;
        reset();
      }
    }

    reset();
    const result = await run(tokens, 0, null);
    if (kvEnabled && result.past) {
      past = result.past;
      cachedLen = tokens.length;
    } else if (kvEnabled && !result.past) {
      kvEnabled = false;
    }
    return result.logits;
  };
}

export async function openLmSession(
  lang: PackId,
  onProgress?: ChatCipherProgress,
): Promise<LmSession> {
  let session = loaded.get(lang);
  if (!session) {
    onProgress?.('loadModel');
    session = await loadOnnx(lang, onProgress);
    loaded.set(lang, session);
  }
  const { tokenizer, stego } = session;

  return {
    lang,
    async encodeCover(data, onStego) {
      const grown: number[] = [];
      let lastPreviewAt = 0;
      const tokens = await stego.encode(data, (done, total, token) => {
        if (typeof token === 'number') grown.push(token);
        const shouldPreview = done === total || done === 1 || done - lastPreviewAt >= 4;
        if (shouldPreview) {
          lastPreviewAt = done;
          const preview =
            grown.length > 0 ? tokenizer.decode(grown, { skip_special_tokens: true }) : '';
          onStego?.(done, total, preview);
        } else {
          onStego?.(done, total);
        }
      });
      return tidyCover(tokenizer.decode(tokens, { skip_special_tokens: true }));
    },
    async decodeCover(text, onStego) {
      const encoded = tokenizer.encode(text.trim(), { add_special_tokens: false });
      const tokens = Array.from(encoded as number[]);
      return stego.decode(tokens, onStego);
    },
  };
}

/** Newline/tab pieces make chat UIs look indented; ban them from top-k choices. */
function layoutBreakTokenIds(tokenizer: PreTrainedTokenizer): number[] {
  const bans = new Set<number>();
  const vocab =
    (tokenizer as unknown as { model?: { vocab?: Record<string, number> } }).model?.vocab ??
    (tokenizer as unknown as { vocab?: Record<string, number> }).vocab;
  if (vocab && typeof vocab === 'object') {
    for (const [piece, id] of Object.entries(vocab)) {
      if (typeof id !== 'number') continue;
      // GPT-2 byte-level BPE uses Ċ for newline; also catch raw controls.
      if (/[\n\r\t\f\v\u2028\u2029]/.test(piece) || piece.includes('Ċ')) bans.add(id);
    }
    return [...bans];
  }
  const size =
    typeof (tokenizer as unknown as { vocab_size?: number }).vocab_size === 'number'
      ? (tokenizer as unknown as { vocab_size: number }).vocab_size
      : 0;
  for (let id = 0; id < Math.min(size, 64_000); id++) {
    try {
      const piece = tokenizer.decode([id], { skip_special_tokens: false });
      if (/[\n\r\t\f\v\u2028\u2029]/.test(piece)) bans.add(id);
    } catch {
      /* ignore undecodable ids */
    }
  }
  return [...bans];
}

/** Strip control whitespace that chat UIs render as indent; keep ordinary spaces for tokenization. */
function tidyCover(text: string): string {
  return text.replace(/[\t\f\v\u2028\u2029]+/g, '').replace(/\r\n?/g, '\n').trim();
}

/** Drop an in-memory ONNX session so the next open reloads from cache. */
export function dropLmSession(lang: PackId): void {
  loaded.delete(lang);
}
