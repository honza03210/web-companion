// Central place to swap models / tune sizes.

export const MODELS = {
  // Whisper base, multilingual. Use whisper-tiny.en for fastest English-only.
  stt: "onnx-community/whisper-base",
  // Kokoro 82M — small, high quality, fully offline.
  tts: "onnx-community/Kokoro-82M-v1.0-ONNX",
} as const;

// Selectable LLMs (runtime picker). Both are plain (non-hybrid) Granite 4.0 Nano
// transformer variants with browser ONNX exports. The H-/Mamba variants are NOT
// listed — their state-space ops aren't supported by ONNX Runtime Web.
export interface LlmModel {
  id: string;
  label: string;
  note: string;
  dtype: { webgpu: string; wasm: string };
}

export const LLM_MODELS: LlmModel[] = [
  {
    id: "onnx-community/granite-4.0-350m-ONNX-web",
    label: "Granite 350M",
    note: "fast · ~350 MB · weaker chat",
    dtype: { webgpu: "q4f16", wasm: "q4" },
  },
  {
    id: "onnx-community/granite-4.0-1b-ONNX-web",
    label: "Granite 1B",
    note: "better chat · ~1.25 GB",
    dtype: { webgpu: "q4f16", wasm: "q4" },
  },
];

export const DEFAULT_LLM_ID = LLM_MODELS[0].id;

export const llmModel = (id: string): LlmModel =>
  LLM_MODELS.find((m) => m.id === id) ?? LLM_MODELS[0];

// Per-device weight quantization for the speech models. WebGPU gets fp16-friendly
// formats; the WASM fallback avoids fp16 (poorly supported / slow).
export const DTYPE = {
  // Whisper splits into encoder/decoder; q4 decoder keeps it light on WebGPU.
  stt: {
    webgpu: { encoder_model: "fp16", decoder_model_merged: "q4" },
    wasm: "q8",
  },
  // q8 Kokoro is ~80 MB vs ~330 MB for fp32, with little audible loss.
  tts: { webgpu: "q8", wasm: "q8" },
} as const;

export const SYSTEM_PROMPT =
  "You are Web Companion, a helpful voice assistant running on the user's device. " +
  "Answer every question directly and accurately: do simple arithmetic yourself, " +
  "give real answers, and chat naturally. Never say you are unable to help with an " +
  "ordinary question and never ask for a tool to do basic math. Keep replies short " +
  "and easy to read aloud.";

// Greedy decoding makes this small model collapse into canned refusals across turns.
// Light sampling + a gentle repetition penalty + an n-gram block keeps replies
// varied and on-task without suppressing the EOS token (which makes it ramble).
// Short max_new_tokens keeps answers voice-friendly and fast.
export const GENERATION = {
  max_new_tokens: 256,
  do_sample: false,
  repetition_penalty: 1.2,
  no_repeat_ngram_size: 3,
} as const;

// Cap how many prior turns we feed back in — a long degrading history is what tips
// the 350M model into mode-collapse. Keep the system prompt + the last N exchanges.
export const MAX_HISTORY_TURNS = 6;

// Default Kokoro voice. See kokoro-js voices for the full list.
export const TTS_VOICE = "af_heart";

export type Device = "webgpu" | "wasm";
export type Engine = "auto" | "webgpu" | "wasm";

async function hasWebGPU(): Promise<boolean> {
  try {
    const gpu = (navigator as any).gpu;
    if (gpu) {
      const adapter = await gpu.requestAdapter();
      return !!adapter;
    }
  } catch {
    /* fall through */
  }
  return false;
}

/** iPhone/iPad, including iPadOS that reports itself as desktop Safari. */
export function isIOSLike(): boolean {
  const ua = navigator.userAgent;
  return (
    /iphone|ipad|ipod/i.test(ua) ||
    (/macintosh/i.test(ua) && (navigator as any).maxTouchPoints > 1)
  );
}

/**
 * Resolve the compute backend. On iOS, WebGPU inference OOM-kills the Safari tab
 * for these model sizes (per-buffer/memory limits hit at compute time), so "auto"
 * deliberately uses WASM there — slower but stable. Desktop "auto" uses WebGPU.
 */
export async function resolveDevice(engine: Engine = "auto"): Promise<Device> {
  if (engine === "wasm") return "wasm";
  if (engine === "webgpu") return (await hasWebGPU()) ? "webgpu" : "wasm";
  if (isIOSLike()) return "wasm";
  return (await hasWebGPU()) ? "webgpu" : "wasm";
}

/**
 * Heuristic for "tight memory" devices (phones, low-RAM laptops). Used to decide
 * how aggressively to unload idle models so we don't keep all three resident in
 * WebGPU at once — the real constraint on a 6 GB iPhone 15.
 */
export function isLowMemoryDevice(): boolean {
  const mem = (navigator as any).deviceMemory; // GB, Chromium only
  const mobile =
    /android|iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return mobile || (typeof mem === "number" && mem <= 4);
}

/** How long a model stays resident after its last use before being disposed. */
export function idleDisposeMs(kind: "llm" | "stt" | "tts"): number {
  const low = isLowMemoryDevice();
  // The LLM is used every turn, so keep it warm longer; STT/TTS are brief.
  if (kind === "llm") return low ? 90_000 : 600_000;
  return low ? 20_000 : 120_000;
}
