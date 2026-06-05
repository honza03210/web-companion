import "./style.css";
import { SYSTEM_PROMPT, type Device } from "./config";
import type { ChatMessage, WorkerEvent } from "./protocol";
import { Recorder, playPcm } from "./audio";
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

// ---------- worker wrapper ----------
class ModelWorker {
  private worker: Worker;
  private readyResolve!: () => void;
  ready: Promise<void>;
  device: Device = "wasm";
  private loadStarted = false;

  constructor(WorkerCtor: new () => Worker, onEvent: (e: WorkerEvent) => void) {
    this.worker = new WorkerCtor();
    this.ready = new Promise((res) => (this.readyResolve = res));
    this.worker.onmessage = (ev: MessageEvent<WorkerEvent>) => {
      const msg = ev.data;
      if (msg.type === "ready") {
        this.device = msg.device;
        this.readyResolve();
      }
      onEvent(msg);
    };
  }

  load(): Promise<void> {
    if (!this.loadStarted) {
      this.loadStarted = true;
      this.worker.postMessage({ type: "load" });
    }
    return this.ready;
  }

  post(msg: unknown) {
    this.worker.postMessage(msg);
  }
}

// ---------- chat state ----------
const messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];
let pendingBubble: HTMLDivElement | null = null;
let pendingText = "";
let ttsId = 0;

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
    const pct = Math.round(info.progress ?? 0);
    return `Downloading ${info.file} — ${pct}%`;
  }
  return null;
}

// ---------- workers ----------
const llm = new ModelWorker(
  LlmWorker,
  (msg) => {
    switch (msg.type) {
      case "progress": {
        const t = progressText(msg.info);
        if (t) setStatus(t);
        break;
      }
      case "ready":
        setStatus(`Granite ready (${msg.device})`);
        break;
      case "token":
        pendingText += msg.text;
        if (pendingBubble) pendingBubble.textContent = pendingText;
        chatEl.scrollTop = chatEl.scrollHeight;
        break;
      case "done":
        messages.push({ role: "assistant", content: msg.text });
        if (pendingBubble) pendingBubble.textContent = msg.text;
        pendingBubble = null;
        setStatus(`Ready (${llm.device})`);
        if (speakEl.checked) speak(msg.text);
        setBusy(false);
        break;
      case "error":
        setStatus(`LLM error: ${msg.message}`);
        setBusy(false);
        break;
    }
  },
);

const stt = new ModelWorker(
  SttWorker,
  (msg) => {
    switch (msg.type) {
      case "progress": {
        const t = progressText(msg.info);
        if (t) setStatus(t);
        break;
      }
      case "ready":
        setStatus(`Speech recognition ready (${msg.device})`);
        break;
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
  },
);

const tts = new ModelWorker(
  TtsWorker,
  (msg) => {
    switch (msg.type) {
      case "progress": {
        const t = progressText(msg.info);
        if (t) setStatus(t);
        break;
      }
      case "audio":
        playPcm(msg.pcm, msg.sampleRate);
        break;
      case "error":
        setStatus(`TTS error: ${msg.message}`);
        break;
    }
  },
);

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
  textEl.value = "";
  setBusy(true);

  addBubble("user", text);
  messages.push({ role: "user", content: text });

  pendingText = "";
  pendingBubble = addBubble("assistant", "…");

  setStatus("Loading Granite…");
  await llm.load();
  setStatus("Thinking…");
  llm.post({ type: "generate", messages });
}

async function speak(text: string) {
  setStatus("Synthesizing speech…");
  await tts.load();
  tts.post({ type: "speak", id: ++ttsId, text });
}

// push-to-talk
const recorder = new Recorder();
let recording = false;

async function startRecording() {
  if (recording || busy) return;
  try {
    await stt.load(); // warm up model while user speaks
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

micEl.addEventListener("pointerdown", startRecording);
micEl.addEventListener("pointerup", stopRecording);
micEl.addEventListener("pointerleave", stopRecording);

initPWA();
setStatus("Ready — say hello or type a message");
