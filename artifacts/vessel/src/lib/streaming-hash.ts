import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/**
 * SHA-256 of a Blob without loading it whole.
 *
 * Small blobs go through the browser's native digest, which is fastest.
 * Anything larger is streamed through a worker so a two-hour recording
 * (several gigabytes across three files) never has to exist as one
 * ArrayBuffer and never blocks the page. Environments without workers or
 * `Blob.stream()` fall back to streaming on the calling thread.
 */

/** Below this, one native digest call is cheaper than spinning up a worker. */
export const NATIVE_DIGEST_MAX_BYTES = 16 * 1024 * 1024;

export type HashOptions = {
  /** Force the streaming path even for small blobs (tests, diagnostics). */
  forceStreaming?: boolean;
};

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (hex: string) => void; reject: (err: Error) => void }
>();

function getWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("../workers/hash-worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return null;
  }
  worker.onmessage = (
    event: MessageEvent<{
      id: number;
      ok: boolean;
      hex?: string;
      error?: string;
    }>,
  ) => {
    const msg = event.data;
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.ok && typeof msg.hex === "string") entry.resolve(msg.hex);
    else entry.reject(new Error(msg.error || "Hashing failed"));
  };
  worker.onerror = () => {
    // Fail everything in flight; callers fall back to the main thread.
    for (const [id, entry] of pending) {
      pending.delete(id);
      entry.reject(new Error("Hash worker crashed"));
    }
    worker?.terminate();
    worker = null;
  };
  return worker;
}

async function hashInWorker(blob: Blob): Promise<string> {
  const w = getWorker();
  if (!w) throw new Error("No worker");
  const id = nextId++;
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, blob });
  });
}

async function hashStreamingHere(blob: Blob): Promise<string> {
  const hasher = sha256.create();
  if (typeof blob.stream === "function") {
    const reader = blob.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) hasher.update(value);
    }
  } else {
    // Very old engines: read in slices to keep the peak bounded.
    const step = 8 * 1024 * 1024;
    for (let offset = 0; offset < blob.size; offset += step) {
      const buf = await blob.slice(offset, offset + step).arrayBuffer();
      hasher.update(new Uint8Array(buf));
    }
  }
  return bytesToHex(hasher.digest());
}

async function hashNative(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return bytesToHex(new Uint8Array(digest));
}

/** Lowercase hex SHA-256 of the blob's bytes. */
export async function sha256HexOfBlob(
  blob: Blob,
  options: HashOptions = {},
): Promise<string> {
  const canNative =
    !options.forceStreaming &&
    blob.size <= NATIVE_DIGEST_MAX_BYTES &&
    typeof crypto !== "undefined" &&
    !!crypto.subtle;
  if (canNative) return hashNative(blob);
  try {
    return await hashInWorker(blob);
  } catch {
    return hashStreamingHere(blob);
  }
}
