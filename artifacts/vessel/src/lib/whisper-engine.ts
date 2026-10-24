/**
 * The transcript's speech engine: Whisper base in a worker, model and
 * runtime served by this site. Implements `SpeechEngine` for
 * `transcribeSession`. Create it when the host asks for a transcript and
 * dispose it afterwards to free the model's memory.
 */
import type { Segment, SpeechEngine } from "./transcript";

export type WhisperEngine = SpeechEngine & { dispose: () => void };

export async function createWhisperEngine(
  opts: {
    onLoadProgress?: (percent: number) => void;
    device?: "webgpu" | "wasm";
  } = {},
): Promise<WhisperEngine> {
  const worker = new Worker(
    new URL("../workers/transcribe-worker.ts", import.meta.url),
    { type: "module" },
  );
  const pending = new Map<
    number,
    { resolve: (s: Segment[]) => void; reject: (e: Error) => void }
  >();
  let nextId = 1;

  await new Promise<void>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data as {
        type: string;
        progress?: number;
        id?: number;
        segments?: Segment[];
        message?: string;
      };
      if (m.type === "progress" && typeof m.progress === "number")
        opts.onLoadProgress?.(m.progress);
      else if (m.type === "loaded") resolve();
      else if (m.type === "result" && m.id !== undefined) {
        pending.get(m.id)?.resolve(m.segments ?? []);
        pending.delete(m.id);
      } else if (m.type === "error") {
        const err = new Error(m.message ?? "Transcription failed");
        if (m.id !== undefined) {
          pending.get(m.id)?.reject(err);
          pending.delete(m.id);
        } else reject(err);
      }
    };
    worker.onerror = (e) =>
      reject(new Error(e.message || "The transcript engine could not start"));
    worker.postMessage({
      type: "load",
      baseUrl: import.meta.env.BASE_URL || "/",
      device: opts.device,
    });
  });

  return {
    transcribe(samples: Float32Array, signal?: AbortSignal) {
      return new Promise<Segment[]>((resolve, reject) => {
        if (signal?.aborted)
          return reject(
            Object.assign(new Error("cancelled"), { name: "AbortError" }),
          );
        const id = nextId++;
        pending.set(id, { resolve, reject });
        worker.postMessage({ type: "transcribe", id, samples }, [
          samples.buffer,
        ]);
      });
    },
    dispose() {
      worker.terminate();
      for (const p of pending.values())
        p.reject(Object.assign(new Error("cancelled"), { name: "AbortError" }));
      pending.clear();
    },
  };
}
