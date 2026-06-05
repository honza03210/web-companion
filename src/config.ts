// Central place to swap models / tune sizes.

export const MODELS = {
  // IBM Granite 4.0 Nano — plain (non-hybrid) transformer variant, browser ONNX export.
  // Swap to the 1b repo for a bigger brain (heavier on iOS memory).
  llm: "onnx-community/granite-4.0-350m-ONNX-web",
  // Whisper base, multilingual. Use whisper-tiny.en for fastest English-only.
  stt: "onnx-community/whisper-base",
  // Kokoro 82M — small, high quality, fully offline.
  tts: "onnx-community/Kokoro-82M-v1.0-ONNX",
} as const;

// LLM weight quantization. q4f16 is the smallest download for the 350m export
// (~350 MB vs ~576 MB for q4) and the best fit for WebGPU (fp16 activations).
export const LLM_DTYPE = "q4f16";

export const SYSTEM_PROMPT =
  "You are Web Companion, a friendly, concise voice assistant running entirely " +
  "on the user's device. Keep answers short and conversational unless asked for detail.";

export const MAX_NEW_TOKENS = 512;

// Default Kokoro voice. See kokoro-js voices for the full list.
export const TTS_VOICE = "af_heart";

export type Device = "webgpu" | "wasm";

/** Detect a usable WebGPU adapter, falling back to WASM. */
export async function pickDevice(): Promise<Device> {
  try {
    const gpu = (navigator as any).gpu;
    if (gpu) {
      const adapter = await gpu.requestAdapter();
      if (adapter) return "webgpu";
    }
  } catch {
    /* fall through */
  }
  return "wasm";
}
