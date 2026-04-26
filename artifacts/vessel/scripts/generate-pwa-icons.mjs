import sharp from "sharp";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

const svg = await readFile(join(publicDir, "favicon.svg"));

async function emit(name, size, opts = {}) {
  const out = join(publicDir, name);
  let pipeline = sharp(svg, { density: 384 }).resize(size, size, {
    fit: "contain",
    background: opts.background ?? { r: 8, g: 11, b: 15, alpha: 1 },
  });
  if (opts.padding) {
    const inner = Math.round(size * (1 - opts.padding * 2));
    pipeline = sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: opts.background ?? { r: 8, g: 11, b: 15, alpha: 1 },
      },
    })
      .composite([
        {
          input: await sharp(svg, { density: 384 })
            .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toBuffer(),
          gravity: "center",
        },
      ])
      .png();
  }
  await pipeline.png().toFile(out);
  console.log(`  wrote ${name} (${size}x${size})`);
}

await mkdir(publicDir, { recursive: true });

await emit("pwa-192.png", 192);
await emit("pwa-512.png", 512);
await emit("pwa-maskable-512.png", 512, { padding: 0.18 });
await emit("apple-touch-icon.png", 180);
await emit("favicon-32.png", 32);
await emit("favicon-16.png", 16);

console.log("done");
