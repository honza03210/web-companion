/// <reference lib="webworker" />
import { KokoroTTS } from "kokoro-js";
import { MODELS, DTYPE, TTS_VOICE, pickDevice, idleDisposeMs, type Device } from "./config";
import type { TtsRequest, WorkerEvent } from "./protocol";
import { installModelCache } from "./opfs-cache";

// Kokoro uses transformers.js under the hood, so this also redirects its weights.
installModelCache();

const post = (msg: WorkerEvent, transfer?: Transferable[]) =>
  (self as DedicatedWorkerGlobalScope).postMessage(msg, transfer ?? []);

let tts: KokoroTTS | null = null;
let device: Device = "wasm";
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function keepAlive(reset: boolean) {
  clearTimeout(idleTimer);
  if (reset) idleTimer = setTimeout(release, idleDisposeMs("tts"));
}

async function release() {
  if (!tts) return;
  // KokoroTTS has no public dispose; free the underlying ONNX session if exposed.
  try {
    await (tts as any)?.model?.dispose?.();
  } catch {
    /* ignore */
  }
  tts = null;
  post({ type: "released" });
}

async function ensureLoaded() {
  if (tts) return;
  device = await pickDevice();
  tts = await KokoroTTS.from_pretrained(MODELS.tts, {
    device,
    dtype: DTYPE.tts[device],
    progress_callback: (info: any) => post({ type: "progress", info }),
  });
  post({ type: "ready", device });
}

async function speak(id: number, text: string) {
  keepAlive(false);
  await ensureLoaded();
  const audio: any = await tts!.generate(text, { voice: TTS_VOICE });
  const pcm: Float32Array = audio.audio;
  post({ type: "audio", id, pcm, sampleRate: audio.sampling_rate }, [pcm.buffer]);
  keepAlive(true);
}

self.addEventListener("message", async (e: MessageEvent<TtsRequest>) => {
  try {
    if (e.data.type === "load") await ensureLoaded();
    else if (e.data.type === "speak") await speak(e.data.id, e.data.text);
  } catch (err: any) {
    post({ type: "error", message: err?.message ?? String(err) });
  }
});
