export type RecorderEvent =
  | { type: "recording-started"; startedAt: number }
  | { type: "chunk-saved-locally"; index: number; sizeBytes: number }
  | { type: "recording-complete"; durationSeconds: number; sizeBytes: number; mimeType: string; blob: Blob; chunkCount: number };

export type RecorderListener = (event: RecorderEvent) => void;

export type RecorderOptions = {
  stream: MediaStream;
  timesliceMs?: number;
  preferredMimeTypes?: string[];
};

const DEFAULT_MIME_TYPES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "audio/webm",
];

function pickSupportedMimeType(preferred?: string[]): string {
  const candidates = preferred && preferred.length ? preferred : DEFAULT_MIME_TYPES;
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

export class ChunkedRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private listeners = new Set<RecorderListener>();
  private startTime = 0;
  private chunkIndex = 0;
  private mimeType = "";
  private finalBlob: Blob | null = null;
  private status: "idle" | "recording" | "stopped" = "idle";
  private stopPromise: Promise<Blob> | null = null;
  private resolveStop: ((blob: Blob) => void) | null = null;
  private rejectStop: ((err: unknown) => void) | null = null;

  static isSupported(): boolean {
    return typeof window !== "undefined" && typeof MediaRecorder !== "undefined";
  }

  on(listener: RecorderListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: RecorderEvent) {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (err) {
        console.error("Recorder listener error", err);
      }
    }
  }

  start(options: RecorderOptions): void {
    if (this.status !== "idle") {
      throw new Error("Recorder is already started");
    }
    if (!ChunkedRecorder.isSupported()) {
      throw new Error("Recording is not supported in this browser.");
    }
    const { stream, timesliceMs = 5000, preferredMimeTypes } = options;
    const mimeType = pickSupportedMimeType(preferredMimeTypes);
    this.mimeType = mimeType;
    this.chunks = [];
    this.chunkIndex = 0;
    this.finalBlob = null;
    this.status = "recording";
    this.startTime = Date.now();

    const recorderOptions: MediaRecorderOptions = mimeType ? { mimeType } : {};
    this.mediaRecorder = new MediaRecorder(stream, recorderOptions);

    this.mediaRecorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) {
        this.chunks.push(ev.data);
        const idx = this.chunkIndex++;
        this.emit({ type: "chunk-saved-locally", index: idx, sizeBytes: ev.data.size });
      }
    };

    this.mediaRecorder.onstop = () => {
      const finalMime = this.mimeType || (this.chunks[0]?.type ?? "video/webm");
      const blob = new Blob(this.chunks, { type: finalMime });
      this.finalBlob = blob;
      const durationSeconds = Math.max(1, Math.round((Date.now() - this.startTime) / 1000));
      this.emit({
        type: "recording-complete",
        durationSeconds,
        sizeBytes: blob.size,
        mimeType: finalMime,
        blob,
        chunkCount: this.chunks.length,
      });
      this.status = "stopped";
      this.resolveStop?.(blob);
    };

    this.mediaRecorder.onerror = (ev) => {
      const err = (ev as unknown as { error?: Error }).error ?? new Error("Recording error");
      this.rejectStop?.(err);
    };

    this.mediaRecorder.start(timesliceMs);
    this.emit({ type: "recording-started", startedAt: this.startTime });
  }

  stop(): Promise<Blob> {
    if (this.status !== "recording" || !this.mediaRecorder) {
      if (this.finalBlob) return Promise.resolve(this.finalBlob);
      return Promise.reject(new Error("Recorder is not running"));
    }
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = new Promise<Blob>((resolve, reject) => {
      this.resolveStop = resolve;
      this.rejectStop = reject;
    });
    try {
      this.mediaRecorder.stop();
    } catch (err) {
      this.rejectStop?.(err);
    }
    return this.stopPromise;
  }

  getStatus(): "idle" | "recording" | "stopped" {
    return this.status;
  }

  getChunkCount(): number {
    return this.chunks.length;
  }

  getFinalBlob(): Blob | null {
    return this.finalBlob;
  }

  getDurationSeconds(): number {
    if (this.startTime === 0) return 0;
    return Math.max(0, Math.round((Date.now() - this.startTime) / 1000));
  }
}
