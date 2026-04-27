/**
 * Captions worker — runs the on-device speech-to-text model in a dedicated
 * thread so the studio UI never blocks while a window is being analysed.
 *
 * The worker:
 *   1. Lazy-loads the model on first use (~75 MB for the tiny English model;
 *      cached by the browser thereafter).
 *   2. Accepts 16 kHz mono Float32 audio windows from the main thread.
 *   3. Emits text fragments (one per processed window) back to the main thread.
 *
 * Failure modes (model download blocked, model load throws, inference throws)
 * surface as `{ type: "status", status: "error" }` messages so the hook on
 * the main thread can display a calm fallback rather than spinning forever.
 *
 * No user-visible jargon escapes from this file — all log strings stay
 * developer-facing; the studio UI labels everything with "captions".
 */

// We dynamically import the model runtime inside `loadModel` so the worker
// bundle stays small and the network/CPU cost of fetching the runtime is
// only paid the first time the user actually turns captions on.

type Status = "idle" | "loading" | "ready" | "running" | "error";

type WorkerInbound =
  | { type: "init"; modelId?: string }
  | {
      type: "transcribe";
      jobId: string;
      audio: Float32Array;
      startMs: number;
      endMs: number;
      language?: string | null;
    }
  | { type: "shutdown" };

type WorkerOutbound =
  | { type: "status"; status: Status; progress?: number; message?: string }
  | {
      type: "fragment";
      jobId: string;
      text: string;
      startMs: number;
      endMs: number;
    };

const DEFAULT_MODEL_ID = "Xenova/whisper-tiny.en";

let currentModelId: string | null = null;
let asrPipeline: ((audio: Float32Array, opts?: Record<string, unknown>) => Promise<unknown>) | null =
  null;
let loadPromise: Promise<void> | null = null;
let status: Status = "idle";

function send(msg: WorkerOutbound): void {
  (self as unknown as Worker).postMessage(msg);
}

function setStatus(next: Status, extra?: { progress?: number; message?: string }): void {
  status = next;
  send({ type: "status", status: next, ...extra });
}

async function loadModel(modelId: string): Promise<void> {
  if (asrPipeline && currentModelId === modelId) return;
  if (loadPromise) {
    await loadPromise;
    if (asrPipeline && currentModelId === modelId) return;
  }
  loadPromise = (async () => {
    setStatus("loading", { progress: 0 });
    try {
      const mod = await import("@huggingface/transformers");
      // Force download from the public CDN; we don't ship local model files.
      mod.env.allowLocalModels = false;
      // Some hosts block cross-origin model fetches behind credentialless
      // COEP — disabling remote model fetching guards would defeat the
      // point, so leave the default (true) in place.
      const pipeline = await mod.pipeline(
        "automatic-speech-recognition",
        modelId,
        {
          // Browser-side execution; the runtime picks the best available
          // backend (WebGPU when present, falling back gracefully).
          progress_callback: (info: { status?: string; progress?: number }) => {
            if (
              info &&
              typeof info === "object" &&
              info.status === "progress" &&
              typeof info.progress === "number"
            ) {
              setStatus("loading", { progress: Math.max(0, Math.min(100, info.progress)) });
            }
          },
        },
      );
      asrPipeline = pipeline as unknown as (
        audio: Float32Array,
        opts?: Record<string, unknown>,
      ) => Promise<unknown>;
      currentModelId = modelId;
      setStatus("ready");
    } catch (err) {
      asrPipeline = null;
      currentModelId = null;
      const message = err instanceof Error ? err.message : "Captions engine failed to load.";
      setStatus("error", { message });
      throw err;
    } finally {
      loadPromise = null;
    }
  })();
  await loadPromise;
}

async function transcribe(
  jobId: string,
  audio: Float32Array,
  startMs: number,
  endMs: number,
  language: string | null,
): Promise<void> {
  if (!asrPipeline) {
    // Caller forgot to init — load the default model on demand so a
    // window dropped in early doesn't get silently lost.
    try {
      await loadModel(currentModelId ?? DEFAULT_MODEL_ID);
    } catch {
      return;
    }
  }
  if (!asrPipeline) return;
  setStatus("running");
  try {
    const opts: Record<string, unknown> = {
      // Avoid generating timestamp tokens so we can stitch text together
      // ourselves from window boundaries — fewer tokens = faster runs.
      return_timestamps: false,
      chunk_length_s: 30,
      stride_length_s: 5,
    };
    if (language) opts.language = language;
    const result = (await asrPipeline(audio, opts)) as { text?: string } | { text?: string }[];
    const text = Array.isArray(result)
      ? (result[0]?.text ?? "").trim()
      : (result?.text ?? "").trim();
    if (text) {
      send({ type: "fragment", jobId, text, startMs, endMs });
    }
    setStatus("ready");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Captions engine error.";
    setStatus("error", { message });
  }
}

self.addEventListener("message", (event: MessageEvent<WorkerInbound>) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  switch (data.type) {
    case "init": {
      void loadModel(data.modelId ?? DEFAULT_MODEL_ID).catch(() => {
        // Status already reported via setStatus("error", ...).
      });
      break;
    }
    case "transcribe": {
      void transcribe(
        data.jobId,
        data.audio,
        data.startMs,
        data.endMs,
        data.language ?? null,
      );
      break;
    }
    case "shutdown": {
      asrPipeline = null;
      currentModelId = null;
      setStatus("idle");
      break;
    }
  }
});

// Announce that the worker thread is alive even before any model load —
// gives the hook a way to detect a worker that crashed during construction.
setStatus("idle");

export {};
