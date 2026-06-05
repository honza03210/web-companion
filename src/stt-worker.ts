/// <reference lib="webworker" />
import { pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import { MODELS, pickDevice, type Device } from "./config";
import type { SttRequest, WorkerEvent } from "./protocol";
import { installModelCache } from "./opfs-cache";

installModelCache();

const post = (msg: WorkerEvent) => (self as DedicatedWorkerGlobalScope).postMessage(msg);

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;

async function load() {
  const device: Device = await pickDevice();
  transcriber = (await (pipeline as any)("automatic-speech-recognition", MODELS.stt, {
    device,
    dtype:
      device === "webgpu"
        ? { encoder_model: "fp16", decoder_model_merged: "q4" }
        : "q8",
    progress_callback: (info: any) => post({ type: "progress", info }),
  })) as AutomaticSpeechRecognitionPipeline;
  post({ type: "ready", device });
}

async function transcribe(audio: Float32Array) {
  if (!transcriber) throw new Error("STT not loaded");
  const out: any = await transcriber(audio, {
    // Push-to-talk clips are short; no chunking needed.
    return_timestamps: false,
  });
  post({ type: "transcript", text: (out.text ?? "").trim() });
}

self.addEventListener("message", async (e: MessageEvent<SttRequest>) => {
  try {
    if (e.data.type === "load") await load();
    else if (e.data.type === "transcribe") await transcribe(e.data.audio);
  } catch (err: any) {
    post({ type: "error", message: err?.message ?? String(err) });
  }
});
