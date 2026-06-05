// Mic capture (push-to-talk) and PCM playback helpers.

/** Records mic audio and returns it as 16 kHz mono Float32 — what Whisper expects. */
export class Recorder {
  private media?: MediaRecorder;
  private chunks: Blob[] = [];
  private stream?: MediaStream;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    this.media = new MediaRecorder(this.stream);
    this.media.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.media.start();
  }

  stop(): Promise<Float32Array> {
    return new Promise((resolve, reject) => {
      const media = this.media;
      if (!media) return reject(new Error("not recording"));
      media.onstop = async () => {
        this.stream?.getTracks().forEach((t) => t.stop());
        const blob = new Blob(this.chunks, { type: media.mimeType });
        try {
          resolve(await blobTo16kMono(blob));
        } catch (err) {
          reject(err);
        }
      };
      media.stop();
    });
  }
}

async function blobTo16kMono(blob: Blob): Promise<Float32Array> {
  const bytes = await blob.arrayBuffer();
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(bytes);
  await ctx.close();

  const offline = new OfflineAudioContext(
    1,
    Math.ceil(decoded.duration * 16000),
    16000,
  );
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}

let activeCtx: AudioContext | null = null;

/** Stops any in-progress TTS playback immediately. */
export function stopPlayback(): void {
  if (activeCtx) {
    activeCtx.close().catch(() => {});
    activeCtx = null;
  }
}

/** Plays raw PCM and resolves when playback finishes (or is stopped). */
export function playPcm(pcm: Float32Array, sampleRate: number): Promise<void> {
  stopPlayback(); // only one utterance at a time
  const ctx = new AudioContext();
  activeCtx = ctx;
  const buffer = ctx.createBuffer(1, pcm.length, sampleRate);
  // Copy into a fresh (non-shared) backing buffer to satisfy copyToChannel's typing.
  buffer.copyToChannel(new Float32Array(pcm), 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  return new Promise((resolve) => {
    src.onended = () => {
      if (activeCtx === ctx) {
        ctx.close().catch(() => {});
        activeCtx = null;
      }
      resolve();
    };
    src.start();
  });
}
