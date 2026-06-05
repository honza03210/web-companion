// PWA glue: service-worker registration, persistent-storage request, install
// affordances, and a storage-usage readout. Kept free of any transformers.js
// imports so it doesn't bloat the main bundle.

import { registerSW } from "virtual:pwa-register";

const fmt = (bytes: number) => {
  if (!bytes) return "0 MB";
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${Math.round(mb)} MB`;
};

const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  // iPadOS reports as Mac; detect by touch support
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as any).standalone === true;

async function updateStorageReadout() {
  const el = document.getElementById("storage");
  if (!el || !navigator.storage?.estimate) return;
  try {
    const { usage = 0 } = await navigator.storage.estimate();
    const persisted = (await navigator.storage.persisted?.()) ?? false;
    el.textContent = usage
      ? `${persisted ? "Saved offline" : "Cached"} · ${fmt(usage)}`
      : persisted
        ? "Storage persisted"
        : "";
  } catch {
    /* ignore */
  }
}

export function initPWA() {
  // 1. Register the service worker (precaches app shell + wasm for offline launch).
  registerSW({ immediate: true });

  // 2. Ask the browser to keep our storage (exempt from eviction under pressure).
  navigator.storage?.persist?.().finally(updateStorageReadout);

  // 3. Chrome/Android: surface a real install button when eligible.
  const installBtn = document.getElementById("install") as HTMLButtonElement | null;
  let deferredPrompt: any = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) installBtn.hidden = false;
  });
  installBtn?.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.hidden = true;
  });
  window.addEventListener("appinstalled", () => {
    if (installBtn) installBtn.hidden = true;
  });

  // 4. iOS Safari has no install prompt — show the Add-to-Home-Screen hint instead.
  const hint = document.getElementById("ioshint");
  if (hint && isIOS() && !isStandalone() && !localStorage.getItem("ioshint-dismissed")) {
    hint.hidden = false;
    document.getElementById("ioshint-close")?.addEventListener("click", () => {
      hint.hidden = true;
      localStorage.setItem("ioshint-dismissed", "1");
    });
  }

  // 5. Refresh the storage readout after models likely finished downloading.
  updateStorageReadout();
  setInterval(updateStorageReadout, 5000);
}
