import type { ISigner } from "applesauce-signers";
import { sha256HexOfBlob } from "./streaming-hash";
import { normalizeStorageUrl } from "./storage-config";

/**
 * Real Blossom (BUD-01 / BUD-02) upload client + queue wrapper.
 *
 * "Storage server" in user-facing copy. Internally we PUT the recording blob
 * to `<server>/upload` with an `Authorization: Nostr <base64(event)>` header.
 * The auth event is a Kind 24242 template carrying:
 *   - tag `t = upload`
 *   - tag `expiration = <unix>` (5 minutes from now)
 *   - tag `x = <sha256_hex>` (the blob hash)
 * It is signed by the active participant's signer (local key, browser
 * extension, or NIP-46 remote signer — all expose the same `signEvent` API
 * via applesauce-signers).
 *
 * The {@link BlossomUploadQueue} preserves the previous listener event API
 * (sync-started / chunk-synced / chunk-sync-failed / sync-complete) so the
 * existing `useRecording` hook and overlays don't need to change. Real upload
 * progress (XHR `upload.onprogress`) is mapped onto a fixed number of notional
 * chunks so the progress bar still ticks at a reasonable cadence.
 */

const KIND_BLOSSOM_AUTH = 24242;
const AUTH_LIFETIME_SECONDS = 5 * 60;

export type SyncStatus = "idle" | "syncing" | "complete" | "partial-failure";

export type SyncProgress = {
  synced: number;
  total: number;
  percent: number;
  failed: number;
};

export type UploadEvent =
  | { type: "sync-started"; total: number }
  | { type: "chunk-synced"; index: number; sizeBytes: number; progress: SyncProgress }
  | { type: "chunk-sync-failed"; index: number; error: string; progress: SyncProgress }
  | { type: "sync-complete"; status: SyncStatus; progress: SyncProgress; remoteUrl: string | null }
  // Live, mid-recording uploads of finalized recorder slices. Independent of
  // the final-blob `chunk-synced` stream above so the saving overlay can keep
  // its existing progress UX while listeners interested in crash-resilience
  // (vault, status chip) can react in real time.
  | { type: "incremental-chunk-uploaded"; index: number; sizeBytes: number; remoteUrl: string; saved: number; failed: number }
  | { type: "incremental-chunk-failed"; index: number; error: string; saved: number; failed: number };

export type UploadListener = (event: UploadEvent) => void;

export type UploadQueueOptions = {
  serverUrl: string;
  signer: ISigner;
  /** Hint for splitting progress events. Real upload is one PUT regardless. */
  chunkSizeBytes?: number;
};

export type SyncResult = {
  status: SyncStatus;
  remoteUrl: string | null;
  hash: string;
  errorMessage?: string;
};

/** BUD-02 blob descriptor returned by the server on a successful PUT /upload. */
type BlobDescriptor = {
  url?: string;
  sha256?: string;
  size?: number;
  type?: string;
  uploaded?: number;
};

/** Lowercase hex SHA-256 of a blob, streamed so large recordings never sit
 *  in memory as one buffer. See `streaming-hash.ts`. */
export async function sha256Hex(blob: Blob): Promise<string> {
  return sha256HexOfBlob(blob);
}

async function buildAuthEvent(
  signer: ISigner,
  hash: string,
  description: string,
) {
  const now = Math.floor(Date.now() / 1000);
  const template = {
    kind: KIND_BLOSSOM_AUTH,
    created_at: now,
    content: description,
    tags: [
      ["t", "upload"],
      ["expiration", String(now + AUTH_LIFETIME_SECONDS)],
      ["x", hash],
    ],
  };
  return signer.signEvent(template);
}

function utf8ToBase64(input: string): string {
  if (typeof window !== "undefined" && typeof window.btoa === "function") {
    // btoa needs binary-string input; use TextEncoder so unicode is safe.
    const bytes = new TextEncoder().encode(input);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return window.btoa(binary);
  }
  // Node fallback (unlikely in this browser-only path).
  return Buffer.from(input, "utf-8").toString("base64");
}

/**
 * Direct, low-level Blossom client. One instance == one server URL.
 */
export class BlossomClient {
  private readonly serverUrl: string;
  private readonly signer: ISigner;

  constructor(opts: { serverUrl: string; signer: ISigner }) {
    this.serverUrl = normalizeStorageUrl(opts.serverUrl);
    this.signer = opts.signer;
  }

  getServerUrl(): string {
    return this.serverUrl;
  }

  /** Has the server already seen a blob with this hash? */
  async has(hash: string, signal?: AbortSignal): Promise<boolean> {
    const url = `${this.serverUrl}/${hash}`;
    try {
      const res = await fetch(url, { method: "HEAD", signal, mode: "cors" });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Upload a blob to the storage server. Streams progress through `onProgress`
   * (uses XHR because `fetch()` doesn't expose request-body progress yet).
   *
   * Resolves with the BUD-02 blob descriptor returned by the server on 2xx,
   * or rejects with an Error whose message is suitable for surface in UI.
   */
  async upload(
    blob: Blob,
    opts: {
      hash: string;
      description?: string;
      onProgress?: (loaded: number, total: number) => void;
      signal?: AbortSignal;
    },
  ): Promise<BlobDescriptor> {
    const auth = await buildAuthEvent(
      this.signer,
      opts.hash,
      opts.description ?? "Vessel session track",
    );
    const authHeader = `Nostr ${utf8ToBase64(JSON.stringify(auth))}`;
    const url = `${this.serverUrl}/upload`;

    return new Promise<BlobDescriptor>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url);
      xhr.setRequestHeader("Authorization", authHeader);
      if (blob.type) xhr.setRequestHeader("Content-Type", blob.type);
      xhr.responseType = "text";

      xhr.upload.onprogress = (ev) => {
        if (!opts.onProgress) return;
        if (ev.lengthComputable) {
          opts.onProgress(ev.loaded, ev.total);
        } else {
          opts.onProgress(ev.loaded, blob.size);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          let descriptor: BlobDescriptor = {};
          try {
            descriptor = xhr.responseText ? JSON.parse(xhr.responseText) : {};
          } catch {
            descriptor = {};
          }
          resolve(descriptor);
        } else {
          const message = xhr.responseText
            ? `Storage server rejected upload (${xhr.status}): ${xhr.responseText.slice(0, 200)}`
            : `Storage server rejected upload (${xhr.status})`;
          reject(new Error(message));
        }
      };

      xhr.onerror = () => {
        reject(new Error("Network error contacting storage server."));
      };
      xhr.ontimeout = () => {
        reject(new Error("Storage server timed out."));
      };
      xhr.onabort = () => {
        reject(new DOMException("Upload aborted", "AbortError"));
      };

      if (opts.signal) {
        if (opts.signal.aborted) {
          xhr.abort();
          return;
        }
        opts.signal.addEventListener(
          "abort",
          () => {
            try {
              xhr.abort();
            } catch {
              // ignore
            }
          },
          { once: true },
        );
      }

      xhr.send(blob);
    });
  }
}

/**
 * Listener-API wrapper used by `useRecording`. Performs ONE real PUT and
 * fans out XHR upload progress as discrete `chunk-synced` events so the
 * existing progress UI keeps working without any prop changes.
 */
export class BlossomUploadQueue {
  private readonly client: BlossomClient;
  private readonly chunkSizeBytes: number;
  private listeners = new Set<UploadListener>();
  private status: SyncStatus = "idle";
  private progress: SyncProgress = { synced: 0, total: 0, percent: 0, failed: 0 };
  private cancelController: AbortController | null = null;
  // Live mid-recording uploads — totals visible to UI for crash-safety chip.
  private incrementalSaved = 0;
  private incrementalFailed = 0;
  private incrementalInflight = new Set<Promise<unknown>>();
  private incrementalRemoteUrls: string[] = [];

  constructor(opts: UploadQueueOptions) {
    this.client = new BlossomClient({
      serverUrl: opts.serverUrl,
      signer: opts.signer,
    });
    // Real upload uses a single PUT; chunkSizeBytes only controls how many
    // discrete progress events the UI sees. Default ≈ 1MB per tick, capped at
    // 12 ticks for short recordings so the bar moves smoothly either way.
    this.chunkSizeBytes = Math.max(64 * 1024, opts.chunkSizeBytes ?? 1024 * 1024);
  }

  on(listener: UploadListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: UploadEvent) {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (err) {
        console.error("Upload listener error", err);
      }
    }
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  getProgress(): SyncProgress {
    return { ...this.progress };
  }

  getServerUrl(): string {
    return this.client.getServerUrl();
  }

  cancel(): void {
    this.cancelController?.abort();
  }

  getIncrementalStats(): { saved: number; failed: number; remoteUrls: string[] } {
    return {
      saved: this.incrementalSaved,
      failed: this.incrementalFailed,
      remoteUrls: [...this.incrementalRemoteUrls],
    };
  }

  /**
   * Wait for any in-flight live chunk uploads to settle. Bounded by `timeoutMs`
   * so a stuck upload doesn't block session teardown — leftover uploads are
   * simply orphaned (their chunks are content-addressed, so no UI implication).
   */
  async waitForIncrementalUploads(timeoutMs = 8000): Promise<void> {
    const inflight = Array.from(this.incrementalInflight);
    if (inflight.length === 0) return;
    await Promise.race([
      Promise.allSettled(inflight),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }

  /**
   * Live, mid-recording upload of a finalized recorder slice. Each slice is
   * uploaded as its own content-addressed Blossom blob so a mid-session crash
   * preserves every slice that finished syncing. Fire-and-forget — failures
   * are surfaced via `incremental-chunk-failed` events but never thrown.
   *
   * Note: timeslice WebM chunks are not independently playable on their own,
   * but each is durably persisted at the user's storage and can be reassembled
   * after a crash. This is the "first iteration" per the task spec — true
   * rolling streaming (independently playable segments) is a follow-up.
   */
  enqueueIncrementalChunk(blob: Blob, index: number): void {
    if (blob.size === 0) return;
    const task = (async () => {
      try {
        const hash = await sha256Hex(blob);
        const descriptor = await this.client.upload(blob, {
          hash,
          description: `Vessel session slice #${index}`,
        });
        const remoteUrl =
          descriptor.url ?? `${this.client.getServerUrl()}/${descriptor.sha256 ?? hash}`;
        this.incrementalSaved += 1;
        this.incrementalRemoteUrls.push(remoteUrl);
        this.emit({
          type: "incremental-chunk-uploaded",
          index,
          sizeBytes: blob.size,
          remoteUrl,
          saved: this.incrementalSaved,
          failed: this.incrementalFailed,
        });
      } catch (err) {
        this.incrementalFailed += 1;
        const message = err instanceof Error ? err.message : "Slice upload failed.";
        this.emit({
          type: "incremental-chunk-failed",
          index,
          error: message,
          saved: this.incrementalSaved,
          failed: this.incrementalFailed,
        });
      }
    })();
    this.incrementalInflight.add(task);
    task.finally(() => {
      this.incrementalInflight.delete(task);
    });
  }

  /**
   * Hash + PUT the blob once. Emits sync-started / chunk-synced / sync-complete
   * (or chunk-sync-failed + sync-complete on failure). Resolves with a
   * structured result the caller can persist to local recording metadata.
   */
  async sync(blob: Blob): Promise<SyncResult> {
    if (this.status === "syncing") {
      throw new Error("Sync already in progress");
    }
    this.cancelController = new AbortController();

    const totalBytes = Math.max(1, blob.size);
    const totalChunks = Math.max(
      1,
      Math.min(12, Math.ceil(totalBytes / this.chunkSizeBytes)),
    );
    const bytesPerChunk = Math.max(1, Math.ceil(totalBytes / totalChunks));

    this.progress = { synced: 0, total: totalChunks, percent: 0, failed: 0 };
    this.status = "syncing";
    this.emit({ type: "sync-started", total: totalChunks });

    let hash = "";
    try {
      hash = await sha256Hex(blob);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Couldn't fingerprint recording.";
      this.progress.failed = totalChunks;
      this.status = "partial-failure";
      this.emit({
        type: "chunk-sync-failed",
        index: 0,
        error: message,
        progress: { ...this.progress },
      });
      this.emit({
        type: "sync-complete",
        status: this.status,
        progress: { ...this.progress },
        remoteUrl: null,
      });
      return { status: this.status, remoteUrl: null, hash: "", errorMessage: message };
    }

    let lastEmittedChunkIndex = -1;
    const onProgress = (loaded: number, total: number) => {
      const fraction = total > 0 ? loaded / total : 0;
      const completedChunks = Math.min(
        totalChunks,
        Math.floor(fraction * totalChunks),
      );
      while (lastEmittedChunkIndex < completedChunks - 1) {
        lastEmittedChunkIndex += 1;
        this.progress.synced = lastEmittedChunkIndex + 1;
        this.progress.percent = Math.min(
          99,
          Math.round((this.progress.synced / totalChunks) * 100),
        );
        this.emit({
          type: "chunk-synced",
          index: lastEmittedChunkIndex,
          sizeBytes: bytesPerChunk,
          progress: { ...this.progress },
        });
      }
    };

    try {
      const descriptor = await this.client.upload(blob, {
        hash,
        onProgress,
        signal: this.cancelController.signal,
      });

      // Final tick → 100% so the UI lands cleanly even if the last
      // `upload.onprogress` event didn't reach the chunk boundary.
      while (lastEmittedChunkIndex < totalChunks - 1) {
        lastEmittedChunkIndex += 1;
        this.progress.synced = lastEmittedChunkIndex + 1;
        this.progress.percent = Math.round(
          (this.progress.synced / totalChunks) * 100,
        );
        this.emit({
          type: "chunk-synced",
          index: lastEmittedChunkIndex,
          sizeBytes: bytesPerChunk,
          progress: { ...this.progress },
        });
      }
      this.progress.synced = totalChunks;
      this.progress.percent = 100;

      const remoteUrl =
        descriptor.url ?? `${this.client.getServerUrl()}/${descriptor.sha256 ?? hash}`;

      this.status = "complete";
      this.emit({
        type: "sync-complete",
        status: this.status,
        progress: { ...this.progress },
        remoteUrl,
      });
      return { status: this.status, remoteUrl, hash };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Couldn't reach storage server.";
      this.progress.failed = totalChunks - this.progress.synced;
      this.status = "partial-failure";
      this.emit({
        type: "chunk-sync-failed",
        index: lastEmittedChunkIndex + 1,
        error: message,
        progress: { ...this.progress },
      });
      this.emit({
        type: "sync-complete",
        status: this.status,
        progress: { ...this.progress },
        remoteUrl: null,
      });
      return {
        status: this.status,
        remoteUrl: null,
        hash,
        errorMessage: message,
      };
    } finally {
      this.cancelController = null;
    }
  }
}
