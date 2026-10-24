/**
 * In-page streaming downloader for shared archive tracks.
 *
 * Streams a URL into a Blob via fetch + ReadableStream so the recipient page
 * can show byte-level progress and honor a Cancel button. Errors are
 * normalized into a small set of codes via {@link DownloadError}; cancellation
 * raises {@link DownloadCancelled} so callers can distinguish the two.
 */

export type DownloadProgress = {
  receivedBytes: number;
  /** `null` when the server didn't send a usable Content-Length. */
  totalBytes: number | null;
};

export type DownloadErrorCode = "network" | "http_error" | "cors" | "unknown";

export class DownloadError extends Error {
  constructor(public code: DownloadErrorCode, message: string) {
    super(message);
    this.name = "DownloadError";
  }
}

export class DownloadCancelled extends Error {
  constructor() {
    super("Download cancelled");
    this.name = "DownloadCancelled";
  }
}

export type DownloadInput = {
  url: string;
  signal: AbortSignal;
  onProgress: (progress: DownloadProgress) => void;
};

export async function downloadToBlob(input: DownloadInput): Promise<Blob> {
  const { url, signal, onProgress } = input;

  if (signal.aborted) throw new DownloadCancelled();

  let response: Response;
  try {
    response = await fetch(url, { signal, credentials: "omit" });
  } catch (err) {
    if (isAbortError(err) || signal.aborted) throw new DownloadCancelled();
    // A bare fetch failure can be DNS, offline, or a missing CORS header on
    // the storage server — all indistinguishable from JS, so surface a single
    // honest message.
    throw new DownloadError(
      "cors",
      "Couldn't reach the file. The storage server may be offline or may not allow in-page downloads.",
    );
  }

  if (!response.ok) {
    throw new DownloadError(
      "http_error",
      `The storage server returned an error (${response.status}).`,
    );
  }

  const totalBytes = parseContentLength(response.headers.get("Content-Length"));
  onProgress({ receivedBytes: 0, totalBytes });

  // Some response shapes don't expose a readable body; fall back to a single
  // blob() so the user still gets the file.
  if (!response.body) {
    let blob: Blob;
    try {
      blob = await response.blob();
    } catch (err) {
      if (isAbortError(err) || signal.aborted) throw new DownloadCancelled();
      throw new DownloadError("network", "The file transfer failed.");
    }
    onProgress({ receivedBytes: blob.size, totalBytes: blob.size });
    return blob;
  }

  const reader = response.body.getReader();
  // Chunks are folded into Blob parts every few dozen megabytes so the JS
  // heap never holds a whole multi-gigabyte file; the browser's blob store
  // can spill those parts to disk.
  const FOLD_BYTES = 64 * 1024 * 1024;
  const parts: Blob[] = [];
  let pendingChunks: Uint8Array[] = [];
  let pendingBytes = 0;
  const fold = () => {
    if (pendingChunks.length === 0) return;
    parts.push(new Blob(pendingChunks as BlobPart[]));
    pendingChunks = [];
    pendingBytes = 0;
  };
  let received = 0;

  const onAbort = () => {
    reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", onAbort);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw new DownloadCancelled();
      if (done) break;
      if (value && value.byteLength > 0) {
        pendingChunks.push(value);
        pendingBytes += value.byteLength;
        if (pendingBytes >= FOLD_BYTES) fold();
        received += value.byteLength;
        onProgress({ receivedBytes: received, totalBytes });
      }
    }
  } catch (err) {
    if (err instanceof DownloadCancelled) throw err;
    if (isAbortError(err) || signal.aborted) throw new DownloadCancelled();
    throw new DownloadError("network", "The file transfer was interrupted.");
  } finally {
    signal.removeEventListener("abort", onAbort);
  }

  fold();
  const type = response.headers.get("Content-Type") || "application/octet-stream";
  return new Blob(parts, { type });
}

/** Trigger the browser's "save as" flow for an in-memory blob. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function parseContentLength(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isAbortError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    "name" in err &&
    (err as { name?: unknown }).name === "AbortError"
  );
}
