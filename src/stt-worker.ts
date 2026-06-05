/// <reference lib="webworker" />
import { pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import { MODELS, DTYPE, pickDevice, idleDisposeMs, type Device } from "./config";
import type { SttRequest, WorkerEvent } from "./protocol";
import { installModelCache } from "./opfs-cache";

installModelCache();

const post = (msg: WorkerEvent) => (self as DedicatedWorkerGlobalScope).postMessage(msg);

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let device: Device = "wasm";
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function keepAlive(reset: boolean) {
  clearTimeout(idleTimer);
  if (reset) idleTimer = setTimeout(release, idleDisposeMs("stt"));
}

async function release() {
  if (!transcriber) return;
  try {
    await transcriber.dispose();
  } catch {
    /* ignore */
  }
  transcriber = null;
  post({ type: "released" });
}

async function ensureLoaded() {
  if (transcriber) return;
  device = await pickDevice();
  transcriber = (await (pipeline as any)("automatic-speech-recognition", MODELS.stt, {
    device,
    dtype: DTYPE.stt[device],
    progress_callback: (info: any) => post({ type: "progress", info }),
  })) as AutomaticSpeechRecognitionPipeline;
  post({ type: "ready", device });
}

async function transcribe(audio: Float32Array) {
  keepAlive(false);
  await ensureLoaded();
  const out: any = await transcriber!(audio, {
    return_timestamps: false,
    // Handle recordings longer than Whisper's 30s window.
    chunk_length_s: 30,
    stride_length_s: 5,
  });
  post({ type: "transcript", text: (out.text ?? "").trim() });
  keepAlive(true);
}

self.addEventListener("message", async (e: MessageEvent<SttRequest>) => {
  try {
    if (e.data.type === "load") await ensureLoaded();
    else if (e.data.type === "transcribe") await transcribe(e.data.audio);
  } catch (err: any) {
    post({ type: "error", message: err?.message ?? String(err) });
  }
});
