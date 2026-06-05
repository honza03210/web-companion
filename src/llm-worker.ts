/// <reference lib="webworker" />
import { pipeline, TextStreamer, type TextGenerationPipeline } from "@huggingface/transformers";
import {
  GENERATION,
  DEFAULT_LLM_ID,
  llmModel,
  pickDevice,
  idleDisposeMs,
  type Device,
} from "./config";
import type { ChatMessage, LlmRequest, WorkerEvent } from "./protocol";
import { installModelCache } from "./opfs-cache";

installModelCache();

const post = (msg: WorkerEvent, transfer?: Transferable[]) =>
  (self as DedicatedWorkerGlobalScope).postMessage(msg, transfer ?? []);

let generator: TextGenerationPipeline | null = null;
let loadedId: string | null = null;
let device: Device = "wasm";
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function keepAlive(reset: boolean) {
  clearTimeout(idleTimer);
  if (reset) idleTimer = setTimeout(release, idleDisposeMs("llm"));
}

async function release() {
  if (!generator) return;
  try {
    await generator.dispose();
  } catch {
    /* ignore */
  }
  generator = null;
  loadedId = null;
  post({ type: "released" });
}

async function ensureLoaded(id: string) {
  if (generator && loadedId === id) return;
  if (generator) await release(); // switching models — free the old one first
  const model = llmModel(id);
  device = await pickDevice();
  generator = (await (pipeline as any)("text-generation", model.id, {
    device,
    dtype: model.dtype[device],
    progress_callback: (info: any) => post({ type: "progress", info }),
  })) as TextGenerationPipeline;
  loadedId = id;
  post({ type: "ready", device });
}

async function generate(messages: ChatMessage[], id: string) {
  keepAlive(false);
  await ensureLoaded(id);

  const streamer = new TextStreamer(generator!.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text: string) => post({ type: "token", text }),
  });

  const output: any = await generator!(messages as any, {
    ...GENERATION,
    streamer,
  });

  const turns = output[0].generated_text;
  const text = Array.isArray(turns) ? turns.at(-1).content : String(turns);
  post({ type: "done", text: text.trim() });
  keepAlive(true);
}

self.addEventListener("message", async (e: MessageEvent<LlmRequest>) => {
  try {
    if (e.data.type === "load") await ensureLoaded(e.data.model ?? DEFAULT_LLM_ID);
    else if (e.data.type === "generate")
      await generate(e.data.messages, e.data.model ?? DEFAULT_LLM_ID);
  } catch (err: any) {
    post({ type: "error", message: err?.message ?? String(err) });
  }
});
