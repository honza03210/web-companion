// Rasterises assets/icon.svg into the PNG sizes a PWA needs.
// Run with: node scripts/gen-icons.mjs
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "assets", "icon.svg");
const outDir = join(root, "public");

const targets = [
  { name: "pwa-192.png", size: 192 },
  { name: "pwa-512.png", size: 512 },
  { name: "apple-touch-icon.png", size: 180, background: "#0b0f1a" },
  { name: "maskable-512.png", size: 512, padding: 0.12 },
];

await mkdir(outDir, { recursive: true });

for (const t of targets) {
  let img = sharp(src).resize(t.size, t.size, { fit: "contain", background: "#0b0f1a" });
  if (t.padding) {
    const inner = Math.round(t.size * (1 - t.padding * 2));
    img = sharp(src)
      .resize(inner, inner)
      .extend({
        top: Math.round((t.size - inner) / 2),
        bottom: Math.round((t.size - inner) / 2),
        left: Math.round((t.size - inner) / 2),
        right: Math.round((t.size - inner) / 2),
        background: "#0b0f1a",
      });
  }
  await img.png().flatten({ background: t.background ?? "#0b0f1a" }).toFile(join(outDir, t.name));
  console.log("wrote", t.name);
}
