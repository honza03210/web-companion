import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// COOP/COEP enable SharedArrayBuffer -> multi-threaded WASM fallback (when WebGPU
// is unavailable). `credentialless` lets us keep cross-origin model downloads from
// the Hugging Face CDN working. WebGPU itself does not require these headers.
const crossOriginIsolation = {
  name: "cross-origin-isolation",
  configureServer(server: any) {
    server.middlewares.use((_req: any, res: any, next: any) => {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
      next();
    });
  },
  configurePreviewServer(server: any) {
    server.middlewares.use((_req: any, res: any, next: any) => {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
      next();
    });
  },
};

export default defineConfig({
  plugins: [
    crossOriginIsolation,
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png", "icon.svg"],
      manifest: {
        name: "Web Companion",
        short_name: "Companion",
        description: "On-device voice assistant — runs entirely in your browser, offline.",
        theme_color: "#0b0f1a",
        background_color: "#0b0f1a",
        display: "standalone",
        orientation: "portrait",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Precache the app shell, worker chunks, and the onnxruntime WASM so the app
        // launches with no network. Model *weights* are not here — they live in OPFS.
        globPatterns: ["**/*.{js,css,html,svg,png,wasm}"],
        maximumFileSizeToCacheInBytes: 32 * 1024 * 1024,
      },
    }),
  ],
  // transformers.js / onnxruntime-web ship their own workers + wasm; let Vite serve
  // them as-is instead of trying to pre-bundle them.
  optimizeDeps: {
    exclude: ["@huggingface/transformers", "kokoro-js"],
  },
  worker: {
    format: "es",
  },
});
