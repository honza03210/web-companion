/// <reference lib="webworker" />
import { KokoroTTS } from "kokoro-js";
import { MODELS, TTS_VOICE, pickDevice, type Device } from "./config";
import type { TtsRequest, WorkerEvent } from "./protocol";
import { installModelCache } from "./opfs-cache";

// Kokoro uses transformers.js under the hood, so this also redirects its weights.
installModelCache();

const post = (msg: WorkerEvent, transfer?: Transferable[]) =>
  (self as DedicatedWorkerGlobalScope).postMessage(msg, transfer ?? []);

let tts: KokoroTTS | null = null;

async function load() {
  const device: Device = await pickDevice();
  tts = await KokoroTTS.from_pretrained(MODELS.tts, {
    device,
    dtype: device === "webgpu" ? "fp32" : "q8",
    progress_callback: (info: any) => post({ type: "progress", info }),
  });
  post({ type: "ready", device });
}

async function speak(id: number, text: string) {
  if (!tts) throw new Error("TTS not loaded");
  const audio: any = await tts.generate(text, { voice: TTS_VOICE });
  const pcm: Float32Array = audio.audio;
  post(
    { type: "audio", id, pcm, sampleRate: audio.sampling_rate },
    [pcm.buffer],
  );
}

self.addEventListener("message", async (e: MessageEvent<TtsRequest>) => {
  try {
    if (e.data.type === "load") await load();
    else if (e.data.type === "speak") await speak(e.data.id, e.data.text);
  } catch (err: any) {
    post({ type: "error", message: err?.message ?? String(err) });
  }
});
