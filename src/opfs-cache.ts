// Routes transformers.js model downloads into the Origin Private File System (OPFS)
// instead of the Cache API. OPFS handles multi-hundred-MB weight files well and gives
// us an explicit, durable store we can inspect ("is the model already downloaded?").
//
// transformers.js calls `match(key)` -> Response | undefined, and (because we always
// pass a progress_callback) `put(key, Response)` with an already-buffered body. That's
// the entire contract we need to satisfy. See getModelFile() in the library source.

import { env } from "@huggingface/transformers";

const DIR = "model-cache";

function opfsSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.storage &&
    typeof navigator.storage.getDirectory === "function"
  );
}

// Cache keys are URLs; flatten them into a single safe filename.
const keyToName = (key: string) => encodeURIComponent(key);

class OPFSCache {
  private dir: Promise<FileSystemDirectoryHandle>;

  constructor() {
    this.dir = navigator.storage
      .getDirectory()
      .then((root) => root.getDirectoryHandle(DIR, { create: true }));
  }

  async match(key: string): Promise<Response | undefined> {
    try {
      const dir = await this.dir;
      const handle = await dir.getFileHandle(keyToName(key)); // throws if absent
      const file = await handle.getFile();
      if (file.size === 0) return undefined;
      return new Response(file);
    } catch {
      return undefined; // not cached
    }
  }

  async put(key: string, response: Response): Promise<void> {
    const buffer = await response.arrayBuffer();
    const dir = await this.dir;
    const handle = await dir.getFileHandle(keyToName(key), { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(buffer);
    } finally {
      await writable.close();
    }
  }
}

/**
 * Point transformers.js at OPFS. Call once per worker before loading any model.
 * Falls back silently to the default Cache API where OPFS is unavailable.
 */
export function installModelCache(): void {
  if (!opfsSupported()) return;
  env.useCustomCache = true;
  env.customCache = new OPFSCache();
}

/** Total bytes currently stored in the OPFS model cache (for UI display). */
export async function cachedBytes(): Promise<number> {
  if (!opfsSupported()) return 0;
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(DIR);
    let total = 0;
    // @ts-expect-error - values() async iterator is standard but not yet in lib.dom
    for await (const handle of dir.values()) {
      if (handle.kind === "file") total += (await handle.getFile()).size;
    }
    return total;
  } catch {
    return 0;
  }
}
