// Message protocol shared between the UI thread and the model workers.

import type { Device } from "./config";

export interface ProgressInfo {
  status: "initiate" | "download" | "progress" | "done" | "ready";
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

// ---- main -> worker ----
export type LlmRequest =
  | { type: "load"; model: string }
  | { type: "generate"; messages: ChatMessage[]; model: string };

export type SttRequest =
  | { type: "load" }
  | { type: "transcribe"; audio: Float32Array };

export type TtsRequest =
  | { type: "load" }
  | { type: "speak"; id: number; text: string };

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
