/// <reference lib="webworker" />
/**
 * Whisper in a worker. The model and the ONNX runtime are served by this
 * site (model: scripts/fetch-whisper.mjs; runtime: bundled assets); remote
 * model downloads are disabled, so
 * nothing leaves the device.
 *
 * Runs on WASM by default: with the quantized model WebGPU produced garbage
 * text in testing (it needs the much larger fp32 encoder), while WASM
 * transcribed word-perfectly at about 7x real time. WebGPU stays available
 * only when asked for explicitly.
 *
 * In:  { type: "load", baseUrl }                     → { type: "loaded", device } | progress
 *      { type: "transcribe", id, samples (16 kHz) }  → { type: "result", id, segments }
 * Errors come back as { type: "error", id?, message }.
 */
import {
  env,
  pipeline as rawPipeline,
  type AutomaticSpeechRecognitionPipeline,
} from "@huggingface/transformers";

// The library's overloads build a union too large for TypeScript; this
// worker only ever asks for speech recognition.
const pipeline = rawPipeline as unknown as (
  task: "automatic-speech-recognition",
  model: string,
  options: Record<string, unknown>,
) => Promise<AutomaticSpeechRecognitionPipeline>;

import ortMjsUrl from "../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs?url";
import ortWasmUrl from "../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm?url";

const MODEL = "onnx-community/whisper-base";
let asr: AutomaticSpeechRecognitionPipeline | null = null;

type InMessage =
  | { type: "load"; baseUrl: string; device?: "webgpu" | "wasm" }
  | { type: "transcribe"; id: number; samples: Float32Array };

async function load(baseUrl: string, forced?: "webgpu" | "wasm") {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = `${baseUrl}models/`;
  // Runtime files bundled with the app, so the library never falls back to
  // its default CDN.
  if (env.backends.onnx.wasm)
    env.backends.onnx.wasm.wasmPaths = { mjs: ortMjsUrl, wasm: ortWasmUrl };
  const hasWebGpu =
    forced === "webgpu" &&
    typeof navigator !== "undefined" &&
    "gpu" in navigator;
  const progress_callback = (p: {
    status?: string;
    progress?: number;
    file?: string;
  }) => {
    if (p.status === "progress" && typeof p.progress === "number") {
      postMessage({ type: "progress", progress: p.progress, file: p.file });
    }
  };
  const options = {
    dtype: { encoder_model: "q8", decoder_model_merged: "q8" },
    progress_callback,
  } as const;
  try {
    asr = await pipeline("automatic-speech-recognition", MODEL, {
      ...options,
      device: hasWebGpu ? "webgpu" : "wasm",
    });
    postMessage({ type: "loaded", device: hasWebGpu ? "webgpu" : "wasm" });
  } catch (err) {
    if (!hasWebGpu) throw err;
    asr = await pipeline("automatic-speech-recognition", MODEL, {
      ...options,
      device: "wasm",
    });
    postMessage({ type: "loaded", device: "wasm" });
  }
}

self.onmessage = async (e: MessageEvent<InMessage>) => {
  const msg = e.data;
  try {
    if (msg.type === "load") {
      await load(msg.baseUrl, msg.device);
      return;
    }
    if (msg.type === "transcribe") {
      if (!asr) throw new Error("model not loaded");
      const out = (await asr(msg.samples, {
        return_timestamps: true,
        chunk_length_s: 30,
      })) as {
        chunks?: Array<{ timestamp: [number, number | null]; text: string }>;
        text?: string;
      };
      const windowMs = (msg.samples.length / 16_000) * 1000;
      const segments = (
        out.chunks ??
        (out.text ? [{ timestamp: [0, null], text: out.text }] : [])
      ).map((c) => ({
        startMs: Math.round((c.timestamp[0] ?? 0) * 1000),
        endMs: Math.round((c.timestamp[1] ?? windowMs / 1000) * 1000),
        text: c.text,
      }));
      postMessage({ type: "result", id: msg.id, segments });
    }
  } catch (err) {
    postMessage({
      type: "error",
      id: msg.type === "transcribe" ? msg.id : undefined,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
