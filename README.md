# Web Companion

An on-device voice assistant that runs **entirely in the browser** — no server, no API keys. The LLM, speech-to-text, and text-to-speech all execute client-side via WebGPU (with a WASM fallback).

- **LLM** — IBM [Granite 4.0 Nano](https://huggingface.co/spaces/ibm-granite/Granite-4.0-Nano-WebGPU) (**350M or 1B**, switchable in-app) via [transformers.js](https://github.com/huggingface/transformers.js)
- **Speech-to-text** — OpenAI Whisper (base) via transformers.js
- **Text-to-speech** — [Kokoro 82M](https://github.com/hexgrad/kokoro) via `kokoro-js`

End goal: usable on iPhone 15 and up, fully offline. **Phases 1 & 2 are done** — a working desktop build with the offline-capable speech stack, installable as a PWA with weights persisted on-device.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
```

On first use each model downloads once (hundreds of MB) and is cached by the browser. Type a message, or **hold the 🎙️ button to talk** (push-to-talk). Toggle "Speak" to hear replies.

Requires a WebGPU-capable browser (Chrome/Edge 113+, Safari 18+). Without WebGPU it falls back to WASM (slower).

### Choosing a model

The header has a model picker (persisted across sessions):

- **Granite 350M** (~350 MB) — fast, smallest download, but genuinely weak at open conversation: it answers direct single-turn facts/math fine, but tends to deflect on greetings and ramble on general knowledge. Best for short factual Q&A or tool/function-calling, which is what Nano was tuned for.
- **Granite 1B** (~1.25 GB) — noticeably better at conversation and general knowledge. Slower first load; instant afterwards (cached in OPFS).

Decoding is tuned in [`src/config.ts`](src/config.ts) (`GENERATION`, `SYSTEM_PROMPT`, `MAX_HISTORY_TURNS`): short replies, a repetition penalty + n-gram block to avoid canned loops, and a sliding history window so a long transcript doesn't tip the small model into mode-collapse.

## Deploy to GitHub Pages

A workflow ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)) builds and publishes on every push to `main`:

1. Push this repo to GitHub.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Push to `main` (or run the workflow manually). It serves at `https://<user>.github.io/<repo>/`.

The workflow sets Vite's `base` to `/<repo>/` automatically. Notes:

- **HTTPS is required** for service workers and the microphone — GitHub Pages provides it, so install-to-home-screen and the voice loop work there (they won't over plain `http://`).
- GitHub Pages can't send `COOP`/`COEP` headers, so multi-threaded WASM is disabled in production. **WebGPU is unaffected** — on a modern phone/desktop the fast path still runs; only the no-WebGPU WASM fallback is single-threaded.

```bash
npm run build    # type-check + production bundle into dist/
npm run preview
```

## How it works

```
index.html ── main.ts ──┬── llm-worker.ts   (Granite, text generation, streamed)
   UI / orchestration    ├── stt-worker.ts   (Whisper, push-to-talk transcription)
                         └── tts-worker.ts   (Kokoro, speech synthesis)
```

Each model runs in its own **Web Worker** so heavy inference never blocks the UI, and so memory can be managed independently (important on iOS). The UI ↔ worker message protocol lives in [`src/protocol.ts`](src/protocol.ts).

- [`src/config.ts`](src/config.ts) — model IDs, system prompt, WebGPU detection. **Swap models here.**
- [`src/audio.ts`](src/audio.ts) — mic capture → 16 kHz mono Float32 (Whisper input), and PCM playback.
- Voice loop: hold mic → record → Whisper transcribes → text goes to Granite → tokens stream into the bubble → Kokoro speaks the reply.

### Swapping models

In `src/config.ts`, e.g. use the bigger 1B LLM:

```ts
llm: "onnx-community/granite-4.0-1b-ONNX-web",
```

> **Note:** Use the plain transformer Granite variants (`350m`, `1b`), **not** the `H-` hybrid (Mamba) variants — Mamba state-space ops aren't supported by ONNX Runtime Web yet.

## Offline & persistence (Phase 2)

The app is an installable PWA, so it survives without a network and the model isn't re-downloaded each visit:

- **Service worker** (via `vite-plugin-pwa`) precaches the app shell, worker chunks, and the onnxruntime WASM (~25 MB) — so the app *launches* offline.
- **Model weights** are stored in **OPFS** ([`src/opfs-cache.ts`](src/opfs-cache.ts)) via a custom transformers.js cache. First visit downloads them once; every visit after reads from disk.
- **`navigator.storage.persist()`** is requested on startup so the browser won't evict the weights under storage pressure.
- **Install to keep it forever:** Chrome/Android show an **Install** button; iOS shows an *Add to Home Screen* hint. On iOS this matters — Home-Screen web apps are exempt from Safari's 7-day storage-eviction rule, so persistence becomes indefinite. No App Store, no native app.

The header shows live storage usage (e.g. `Saved offline · 354 MB`).

> Icons are generated from [`assets/icon.svg`](assets/icon.svg) with `npm run icons` (uses `sharp`).

## Phase 3 — memory & device hardening

- **Idle-dispose lifecycle** ([`src/config.ts`](src/config.ts) `idleDisposeMs` + each worker): every model disposes itself after a period of disuse, so all three never sit resident in WebGPU at once on a 6 GB iPhone 15. The LLM stays warm longer (used every turn); STT/TTS release quickly. Workers transparently reload on next use.
- **Device-aware quantization** ([`src/config.ts`](src/config.ts) `DTYPE`): WebGPU gets fp16-friendly formats; the WASM fallback avoids fp16. Kokoro is q8 (~88 MB, down from ~330 MB fp32).
- **Capability messaging**: detects WebGPU and tells the user when it's falling back to (slower) WASM.
- **iOS-safe backend**: on iPhone/iPad, WebGPU *inference* OOM-kills the Safari tab for these model sizes (per-buffer/memory limits hit at compute time, even though load succeeds). So the **Auto** engine uses **WASM on iOS** — slower but stable. A header **engine picker** (Auto / WebGPU / WASM) lets you override and experiment, and an on-screen error bar surfaces failures instead of crashing silently.

## Phase 4 — voice UX

- **Interruptible TTS**: a Stop button halts playback; starting a new turn (typing or mic) cancels the current spoken reply, and stale audio is dropped by id.
- **Conversation persistence**: history is saved to `localStorage` and restored on load; a Clear button resets it.
- **Long-audio STT**: Whisper chunking (`chunk_length_s`) handles recordings longer than 30 s.

## Roadmap

- [x] **Phase 1** — desktop, WebGPU, Granite 350M chat + Whisper STT + Kokoro TTS
- [x] **Phase 2** — installable PWA; service worker offline launch; OPFS weight persistence; `persist()`
- [x] **Phase 3** — idle-dispose memory budgeting, device-aware dtypes, WASM fallback messaging
- [x] **Phase 4** — interruptible TTS, conversation persistence, long-audio STT chunking
- [ ] **Remaining** — real-device validation on an iPhone 15 / iOS 18 (needs hardware): confirm install-to-home-screen persistence, memory headroom with all models, and mic/voice loop in mobile Safari

## Notes & gotchas

- **iOS Safari memory** is the real constraint, not raw model size. 350M is comfortable; 1B is near the edge on a base iPhone 15. Lazy-load STT/TTS (already done) and consider unloading models you aren't using.
- **WebGPU on iOS** requires iOS 18+. Always feature-detect (`navigator.gpu`) — `src/config.ts` already does.
- The dev/preview servers set `COOP`/`COEP: credentialless` headers (see `vite.config.ts`) to enable multi-threaded WASM without breaking cross-origin model downloads.
