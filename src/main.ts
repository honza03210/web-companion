import "./style.css";
import {
  SYSTEM_PROMPT,
  MAX_HISTORY_TURNS,
  LLM_MODELS,
  DEFAULT_LLM_ID,
  pickDevice,
  type Device,
} from "./config";
import type { ChatMessage, WorkerEvent } from "./protocol";
import { Recorder, playPcm, stopPlayback } from "./audio";
import { initPWA } from "./pwa";
// `?worker` lets Vite bundle each worker (and transformers.js / kokoro-js) into its
// own chunk. The URL pattern only works when inlined, so we import constructors here.
import LlmWorker from "./llm-worker.ts?worker";
import SttWorker from "./stt-worker.ts?worker";
import TtsWorker from "./tts-worker.ts?worker";

// ---------- DOM ----------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const chatEl = $("chat");
const statusEl = $("status");
const textEl = $<HTMLInputElement>("text");
const sendEl = $<HTMLButtonElement>("send");
const micEl = $<HTMLButtonElement>("mic");
const speakEl = $<HTMLInputElement>("speak");
const stopEl = $<HTMLButtonElement>("stop");
const clearEl = $<HTMLButtonElement>("clear");
const modelEl = $<HTMLSelectElement>("model");

// ---------- worker wrapper ----------
class ModelWorker {
  private worker: Worker;
  private readyResolve!: () => void;
  ready: Promise<void>;
  device: Device = "wasm";
  private loaded = false;

  constructor(WorkerCtor: new () => Worker, onEvent: (e: WorkerEvent) => void) {
    this.worker = new WorkerCtor();
    this.ready = new Promise((res) => (this.readyResolve = res));
    this.worker.onmessage = (ev: MessageEvent<WorkerEvent>) => {
      const msg = ev.data;
      if (msg.type === "ready") {
        this.device = msg.device;
        this.loaded = true;
        this.readyResolve();
      } else if (msg.type === "released") {
        // Model was disposed to free memory; reset so the next use re-arms `ready`.
        this.loaded = false;
        this.ready = new Promise((res) => (this.readyResolve = res));
      }
      onEvent(msg);
    };
  }

  /** Warm up (idempotent). Resolves once the model reports ready. */
  load(payload?: Record<string, unknown>): Promise<void> {
    if (!this.loaded) this.worker.postMessage({ type: "load", ...payload });
    return this.ready;
  }

  post(msg: unknown) {
    this.worker.postMessage(msg);
  }
}

// ---------- chat state + persistence ----------
const HISTORY_KEY = "wc-history-v1";
const messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];
let pendingBubble: HTMLDivElement | null = null;
let pendingText = "";

function saveHistory() {
  const turns = messages.filter((m) => m.role !== "system");
  localStorage.setItem(HISTORY_KEY, JSON.stringify(turns));
}

function loadHistory() {
  try {
    const turns: ChatMessage[] = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    for (const t of turns) {
      messages.push(t);
      addBubble(t.role === "user" ? "user" : "assistant", t.content);
    }
  } catch {
    /* ignore corrupt history */
  }
}

function addBubble(role: "user" | "assistant", text: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `bubble ${role}`;
  el.textContent = text;
  chatEl.appendChild(el);
  chatEl.scrollTop = chatEl.scrollHeight;
  return el;
}

function setStatus(text: string) {
  statusEl.textContent = text;
}

function progressText(info: any): string | null {
  if (info?.status === "progress" && info.file) {
    return `Downloading ${info.file} — ${Math.round(info.progress ?? 0)}%`;
  }
  return null;
}

// ---------- model selection ----------
const MODEL_KEY = "wc-llm-model";
let currentModel = localStorage.getItem(MODEL_KEY) ?? DEFAULT_LLM_ID;
if (!LLM_MODELS.some((m) => m.id === currentModel)) currentModel = DEFAULT_LLM_ID;

function setupModelPicker() {
  for (const m of LLM_MODELS) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = `${m.label} · ${m.note.split(" · ")[0]}`;
    opt.title = m.note;
    modelEl.appendChild(opt);
  }
  modelEl.value = currentModel;
  modelEl.addEventListener("change", () => {
    currentModel = modelEl.value;
    localStorage.setItem(MODEL_KEY, currentModel);
    const m = LLM_MODELS.find((x) => x.id === currentModel)!;
    setStatus(`${m.label} selected — loads on next message (${m.note})`);
  });
}

// ---------- TTS playback (interruptible) ----------
let ttsId = 0;
let activeTtsId = -1;

function stopSpeaking() {
  activeTtsId = -1;
  stopPlayback();
  stopEl.hidden = true;
}

// ---------- workers ----------
const llm = new ModelWorker(LlmWorker, (msg) => {
  switch (msg.type) {
    case "progress": {
      const t = progressText(msg.info);
      if (t) setStatus(t);
      break;
    }
    case "ready":
      setStatus(`Ready (${msg.device})`);
      break;
    case "token":
      pendingText += msg.text;
      if (pendingBubble) pendingBubble.textContent = pendingText;
      chatEl.scrollTop = chatEl.scrollHeight;
      break;
    case "done":
      messages.push({ role: "assistant", content: msg.text });
      saveHistory();
      if (pendingBubble) pendingBubble.textContent = msg.text;
      pendingBubble = null;
      setStatus(`Ready (${llm.device})`);
      if (speakEl.checked) speak(msg.text);
      setBusy(false);
      break;
    case "error":
      setStatus(`LLM error: ${msg.message}`);
      if (pendingBubble) pendingBubble.textContent = "⚠️ " + msg.message;
      pendingBubble = null;
      setBusy(false);
      break;
  }
});

const stt = new ModelWorker(SttWorker, (msg) => {
  switch (msg.type) {
    case "progress": {
      const t = progressText(msg.info);
      if (t) setStatus(t);
      break;
    }
    case "transcript":
      if (msg.text) {
        textEl.value = msg.text;
        send();
      } else {
        setStatus("Didn't catch that — try again");
      }
      break;
    case "error":
      setStatus(`STT error: ${msg.message}`);
      break;
  }
});

const tts = new ModelWorker(TtsWorker, (msg) => {
  switch (msg.type) {
    case "progress": {
      const t = progressText(msg.info);
      if (t) setStatus(t);
      break;
    }
    case "audio":
      if (msg.id !== activeTtsId) break; // stale / cancelled utterance
      stopEl.hidden = false;
      playPcm(msg.pcm, msg.sampleRate).finally(() => {
        if (msg.id === activeTtsId) stopEl.hidden = true;
      });
      break;
    case "error":
      setStatus(`TTS error: ${msg.message}`);
      break;
  }
});

// ---------- actions ----------
let busy = false;
function setBusy(b: boolean) {
  busy = b;
  sendEl.disabled = b;
  textEl.disabled = b;
}

async function send() {
  const text = textEl.value.trim();
  if (!text || busy) return;
  stopSpeaking(); // interrupt any current reply before starting a new turn
  textEl.value = "";
  setBusy(true);

  addBubble("user", text);
  messages.push({ role: "user", content: text });
  saveHistory();

  pendingText = "";
  pendingBubble = addBubble("assistant", "…");

  setStatus("Loading…");
  await llm.load({ model: currentModel });
  setStatus("Thinking…");
  // Send the system prompt + only the most recent turns; a long history tips the
  // small model into canned-refusal mode-collapse.
  const recent = messages.slice(1).slice(-MAX_HISTORY_TURNS * 2);
  llm.post({ type: "generate", messages: [messages[0], ...recent], model: currentModel });
}

async function speak(text: string) {
  const id = ++ttsId;
  activeTtsId = id;
  setStatus("Synthesizing speech…");
  await tts.load();
  tts.post({ type: "speak", id, text });
}

function clearConversation() {
  stopSpeaking();
  messages.length = 1; // keep system prompt
  chatEl.replaceChildren();
  localStorage.removeItem(HISTORY_KEY);
  setStatus("Conversation cleared");
}

// push-to-talk
const recorder = new Recorder();
let recording = false;

async function startRecording() {
  if (recording || busy) return;
  try {
    stopSpeaking();
    stt.load(); // warm up while the user speaks
    await recorder.start();
    recording = true;
    micEl.classList.add("recording");
    setStatus("Listening… (release to send)");
  } catch (err: any) {
    setStatus(`Mic error: ${err?.message ?? err}`);
  }
}

async function stopRecording() {
  if (!recording) return;
  recording = false;
  micEl.classList.remove("recording");
  setStatus("Transcribing…");
  try {
    const audio = await recorder.stop();
    stt.post({ type: "transcribe", audio });
  } catch (err: any) {
    setStatus(`Recording error: ${err?.message ?? err}`);
  }
}

// ---------- wiring ----------
sendEl.addEventListener("click", () => send());
textEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") send();
});
stopEl.addEventListener("click", stopSpeaking);
clearEl.addEventListener("click", clearConversation);

micEl.addEventListener("pointerdown", startRecording);
micEl.addEventListener("pointerup", stopRecording);
micEl.addEventListener("pointerleave", stopRecording);

// ---------- startup ----------
setupModelPicker();
loadHistory();
initPWA();

(async () => {
  const device = await pickDevice();
  if (device === "wasm") {
    setStatus("No WebGPU — running in WASM (slower). Models still work.");
  } else {
    setStatus("Ready — say hello or type a message");
  }
})();
