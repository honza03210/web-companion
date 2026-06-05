/// <reference lib="webworker" />
import { pipeline, TextStreamer, type TextGenerationPipeline } from "@huggingface/transformers";
import { MODELS, LLM_DTYPE, MAX_NEW_TOKENS, pickDevice, type Device } from "./config";
import type { ChatMessage, LlmRequest, WorkerEvent } from "./protocol";
import { installModelCache } from "./opfs-cache";

installModelCache();

const post = (msg: WorkerEvent, transfer?: Transferable[]) =>
  (self as DedicatedWorkerGlobalScope).postMessage(msg, transfer ?? []);

let generator: TextGenerationPipeline | null = null;

async function load() {
  const device: Device = await pickDevice();
  // `pipeline` has a giant overload union; cast the call to keep tsc happy.
  generator = (await (pipeline as any)("text-generation", MODELS.llm, {
    device,
    dtype: LLM_DTYPE,
    progress_callback: (info: any) => post({ type: "progress", info }),
  })) as TextGenerationPipeline;
  post({ type: "ready", device });
}

async function generate(messages: ChatMessage[]) {
  if (!generator) throw new Error("LLM not loaded");

  const streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text: string) => post({ type: "token", text }),
  });

  const output: any = await generator(messages as any, {
    max_new_tokens: MAX_NEW_TOKENS,
    do_sample: false,
    streamer,
  });

  // output[0].generated_text is the full conversation; last turn is the assistant reply.
  const turns = output[0].generated_text;
  const text =
    Array.isArray(turns) ? turns.at(-1).content : String(turns);
  post({ type: "done", text: text.trim() });
}

self.addEventListener("message", async (e: MessageEvent<LlmRequest>) => {
  try {
    if (e.data.type === "load") await load();
    else if (e.data.type === "generate") await generate(e.data.messages);
  } catch (err: any) {
    post({ type: "error", message: err?.message ?? String(err) });
  }
});
