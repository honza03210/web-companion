// Message protocol shared between the UI thread and the model workers.

import type { Device, Engine } from "./config";

export interface ProgressInfo {
  status: "initiate" | "download" | "progress" | "done" | "ready";
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

// ---- main -> worker ----
// Every request carries the chosen engine so a worker honours backend switches.
export type LlmRequest =
  | { type: "load"; model: string; engine?: Engine }
  | { type: "generate"; messages: ChatMessage[]; model: string; engine?: Engine };

export type SttRequest =
  | { type: "load"; engine?: Engine }
  | { type: "transcribe"; audio: Float32Array; engine?: Engine };

export type TtsRequest =
  | { type: "load"; engine?: Engine }
  | { type: "speak"; id: number; text: string; engine?: Engine };

// ---- worker -> main ----
export type WorkerEvent =
  | { type: "progress"; info: ProgressInfo }
  | { type: "ready"; device: Device }
  | { type: "released" }
  | { type: "error"; message: string }
  // llm
  | { type: "token"; text: string }
  | { type: "done"; text: string }
  // stt
  | { type: "transcript"; text: string }
  // tts
  | { type: "audio"; id: number; pcm: Float32Array; sampleRate: number };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
