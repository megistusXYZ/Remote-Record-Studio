// Make the transcript engine servable by this site: the Whisper base model
// (fetched once from its pinned Hugging Face revision) into
// public/models/onnx-community/whisper-base. The ONNX runtime ships as
// bundled assets (see the worker). The app never fetches either from a third
// party at runtime. Files already present are kept.
// Runs before `dev` and `build`; the files are git-ignored.
// Set VESSEL_SKIP_MODEL=1 to skip the model download (CI, offline work).
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, "../public");

const MODEL = "onnx-community/whisper-base";
const REVISION = "1846881b6b3a3024392c1eea3ad983695bc23925";
const FILES = [
  "config.json",
  "generation_config.json",
  "preprocessor_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "onnx/encoder_model_quantized.onnx",
  "onnx/decoder_model_merged_quantized.onnx",
];

async function exists(file) {
  try {
    return (await stat(file)).size > 0;
  } catch {
    return false;
  }
}

if (process.env.VESSEL_SKIP_MODEL === "1") {
  console.log("whisper: skipping model download (VESSEL_SKIP_MODEL=1)");
} else {
  const modelDir = path.join(publicDir, "models", MODEL);
  for (const file of FILES) {
    const target = path.join(modelDir, file);
    if (await exists(target)) continue;
    await mkdir(path.dirname(target), { recursive: true });
    const url = `https://huggingface.co/${MODEL}/resolve/${REVISION}/${file}`;
    process.stdout.write(`whisper: fetching ${file} … `);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`whisper: ${url} answered ${res.status}`);
    await writeFile(target, Buffer.from(await res.arrayBuffer()));
    console.log("done");
  }
  console.log(
    `whisper: model ready in ${path.relative(process.cwd(), modelDir)}`,
  );
}
