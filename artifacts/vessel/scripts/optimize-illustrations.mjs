#!/usr/bin/env node
/**
 * One-shot optimization for the six background illustrations.
 *
 * Reads PNG masters from `artifacts/vessel/masters/illustrations/`,
 * produces AVIF + WebP variants in `artifacts/vessel/src/assets/illustrations/`
 * at the resolution and quality the production UI actually uses
 * (CSS background-image at ≤7% opacity with invert + grayscale + radial mask).
 *
 * The PNG masters are not bundled — only the AVIF + WebP outputs ship.
 *
 * Re-run any time the masters change:
 *   pnpm --filter @workspace/vessel run optimize-illustrations
 */
import { readdir, mkdir, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MASTERS_DIR = join(__dirname, "..", "masters", "illustrations");
const OUTPUT_DIR = join(__dirname, "..", "src", "assets", "illustrations");

const TARGET_WIDTH = 1600;
const AVIF_QUALITY = 50;
const WEBP_QUALITY = 65;

function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const files = (await readdir(MASTERS_DIR)).filter((f) =>
    f.toLowerCase().endsWith(".png"),
  );

  if (files.length === 0) {
    console.error(`No PNGs found in ${MASTERS_DIR}`);
    process.exit(1);
  }

  console.log(`Converting ${files.length} illustration(s) → AVIF + WebP`);
  console.log(`  Target width: ${TARGET_WIDTH}px`);
  console.log(`  AVIF quality: ${AVIF_QUALITY}`);
  console.log(`  WebP quality: ${WEBP_QUALITY}`);
  console.log(`  Output:       ${OUTPUT_DIR}`);
  console.log("");

  let totalIn = 0;
  let totalAvif = 0;
  let totalWebp = 0;

  for (const file of files.sort()) {
    const inPath = join(MASTERS_DIR, file);
    const baseName = file.replace(/\.png$/i, "");
    const avifPath = join(OUTPUT_DIR, `${baseName}.avif`);
    const webpPath = join(OUTPUT_DIR, `${baseName}.webp`);

    const inSize = (await stat(inPath)).size;
    totalIn += inSize;

    const pipeline = sharp(inPath).resize({
      width: TARGET_WIDTH,
      withoutEnlargement: true,
    });

    await pipeline
      .clone()
      .avif({ quality: AVIF_QUALITY, effort: 6 })
      .toFile(avifPath);
    await pipeline
      .clone()
      .webp({ quality: WEBP_QUALITY, effort: 6 })
      .toFile(webpPath);

    const avifSize = (await stat(avifPath)).size;
    const webpSize = (await stat(webpPath)).size;
    totalAvif += avifSize;
    totalWebp += webpSize;

    const pct = (x) => `${((1 - x / inSize) * 100).toFixed(1)}%`;
    console.log(
      `  ${file.padEnd(26)} ${fmtBytes(inSize).padStart(8)} → ` +
        `AVIF ${fmtBytes(avifSize).padStart(8)} (${pct(avifSize).padStart(5)} smaller), ` +
        `WebP ${fmtBytes(webpSize).padStart(8)} (${pct(webpSize).padStart(5)} smaller)`,
    );
  }

  const pct = (x) => `${((1 - x / totalIn) * 100).toFixed(1)}%`;
  console.log("");
  console.log("Totals:");
  console.log(`  Source PNG : ${fmtBytes(totalIn).padStart(9)}`);
  console.log(`  AVIF       : ${fmtBytes(totalAvif).padStart(9)} (${pct(totalAvif)} smaller)`);
  console.log(`  WebP       : ${fmtBytes(totalWebp).padStart(9)} (${pct(totalWebp)} smaller)`);
}

main().catch((err) => {
  console.error("Optimization failed:", err);
  process.exit(1);
});
