import {
  AutoModelForCausalLM,
  AutoTokenizer,
  Tensor,
  env,
  type PreTrainedModel,
  type PreTrainedTokenizer,
} from '@huggingface/transformers';
import { assertOffline } from './cache';
import { PACKS, type ChatLanguage } from './packs';
import type { ChatCipherProgress } from './progress';
import { createStegoCodec, type StegoCodec, type StegoProgress } from './stego';

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

export interface LmSession {
  lang: ChatLanguage;
  encodeCover(data: Uint8Array, onProgress?: StegoProgress): Promise<string>;
  decodeCover(text: string, onProgress?: StegoProgress): Promise<Uint8Array>;
}

type Loaded = {
  model: PreTrainedModel;
  tokenizer: PreTrainedTokenizer;
  stego: StegoCodec;
};

const loaded = new Map<ChatLanguage, Loaded>();

async function preferWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!(gpu && (await gpu.requestAdapter()));
  } catch {
    return false;
  }
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

async function loadOnnx(lang: ChatLanguage): Promise<Loaded> {
  configureEnv();
  await assertOffline(lang);
  const pack = PACKS[lang];
  if (pack.engine !== 'onnx') throw new Error('Pack is not an ONNX model');

  const modelId = pack.base.replace(/\/$/, '');
  let tokenizer: PreTrainedTokenizer;
  let model: PreTrainedModel;
  try {
    tokenizer = await AutoTokenizer.from_pretrained(modelId, { local_files_only: true });
    const webgpu = await preferWebGpu();
    const dtype = pack.dtype ?? 'q8';
    const load = (device: 'webgpu' | 'wasm') =>
      AutoModelForCausalLM.from_pretrained(modelId, {
        local_files_only: true,
        dtype,
        device,
      });
    // WebGPU can hang forever on some GPUs/drivers; race a timeout then fall back to WASM.
    if (webgpu) {
      try {
        model = await withTimeout(load('webgpu'), 20_000, 'WebGPU model load');
      } catch {
        model = await load('wasm');
      }
    } else {
      model = await load('wasm');
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

  const startId =
    (typeof tokenizer.bos_token_id === 'number' && tokenizer.bos_token_id >= 0
      ? tokenizer.bos_token_id
      : null) ??
    (typeof tokenizer.eos_token_id === 'number' ? tokenizer.eos_token_id : 0);

  const stego = createStegoCodec(
    async context => {
      const inputIds = new Tensor(
        'int64',
        BigInt64Array.from(context.map(n => BigInt(n))),
        [1, context.length],
      );
      const out = await model({ input_ids: inputIds });
      const logits = out.logits as Tensor;
      const seq = logits.dims[1] ?? context.length;
      const vocab = logits.dims[2] ?? logits.dims[1]!;
      const data = logits.data as Float32Array;
      const offset = (seq - 1) * vocab;
      return data.slice(offset, offset + vocab);
    },
    { start: [startId], topK: 16, ban, maxTokens: 3000 },
  );

  return { model, tokenizer, stego };
}

export async function openLmSession(
  lang: ChatLanguage,
  onProgress?: ChatCipherProgress,
): Promise<LmSession> {
  let session = loaded.get(lang);
  if (!session) {
    onProgress?.('loadModel');
    session = await loadOnnx(lang);
    loaded.set(lang, session);
  }
  const { tokenizer, stego } = session;

  return {
    lang,
    async encodeCover(data, onStego) {
      const tokens = await stego.encode(data, onStego);
      return tokenizer.decode(tokens, { skip_special_tokens: true }).trim();
    },
    async decodeCover(text, onStego) {
      const encoded = tokenizer.encode(text.trim(), { add_special_tokens: false });
      const tokens = Array.from(encoded as number[]);
      return stego.decode(tokens, onStego);
    },
  };
}

/** Drop an in-memory ONNX session so the next open reloads from cache. */
export function dropLmSession(lang: ChatLanguage): void {
  loaded.delete(lang);
}
