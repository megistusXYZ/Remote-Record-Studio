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
  | { type: "sync-complete"; status: SyncStatus; progress: SyncProgress };

export type UploadListener = (event: UploadEvent) => void;

export type UploadQueueOptions = {
  serverUrl?: string;
  simulatedChunkDurationMs?: number;
};

export class BlossomUploadQueue {
  private listeners = new Set<UploadListener>();
  private status: SyncStatus = "idle";
  private progress: SyncProgress = { synced: 0, total: 0, percent: 0, failed: 0 };
  private serverUrl: string;
  private simulatedChunkDurationMs: number;
  private cancelled = false;

  constructor(options: UploadQueueOptions = {}) {
    this.serverUrl = options.serverUrl ?? "https://storage.vessel.local";
    this.simulatedChunkDurationMs = options.simulatedChunkDurationMs ?? 220;
  }

  on(listener: UploadListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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
    return this.serverUrl;
  }

  cancel() {
    this.cancelled = true;
  }

  /**
   * Simulates uploading the final blob to the storage server in chunks.
   * Real implementation would chunk and PUT to the server. For now we
   * simulate progress events so the UI can render correctly.
   */
  async sync(blob: Blob, opts: { chunkSizeBytes?: number } = {}): Promise<{ status: SyncStatus; remoteUrl: string | null; hash: string }> {
    if (this.status === "syncing") {
      throw new Error("Sync already in progress");
    }
    this.cancelled = false;
    const chunkSize = opts.chunkSizeBytes ?? Math.max(1024 * 1024, Math.ceil(blob.size / 12));
    const total = Math.max(1, Math.ceil(blob.size / chunkSize));
    this.progress = { synced: 0, total, percent: 0, failed: 0 };
    this.status = "syncing";
    this.emit({ type: "sync-started", total });

    for (let i = 0; i < total; i++) {
      if (this.cancelled) break;
      await new Promise<void>((r) => setTimeout(r, this.simulatedChunkDurationMs));
      const sliceSize = Math.min(chunkSize, blob.size - i * chunkSize);
      this.progress.synced += 1;
      this.progress.percent = Math.round((this.progress.synced / total) * 100);
      this.emit({ type: "chunk-synced", index: i, sizeBytes: sliceSize, progress: { ...this.progress } });
    }

    const finalStatus: SyncStatus =
      this.progress.failed > 0
        ? this.progress.failed === total
          ? "partial-failure"
          : "partial-failure"
        : "complete";

    this.status = finalStatus;
    this.emit({ type: "sync-complete", status: finalStatus, progress: { ...this.progress } });

    const hash = await sha256Hex(blob).catch(() => "");
    return { status: finalStatus, remoteUrl: null, hash };
  }
}

async function sha256Hex(blob: Blob): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) return "";
  const buf = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
