import type { RecordingStream } from "./recordings-storage";
import type { WavChunkPart } from "./wav-assemble";
import {
  WAV_MIME_TYPE,
  WavMasterRecorder,
  type WavRecorderLike,
} from "./wav-recorder";

export type RecorderEvent =
  | { type: "recording-started"; startedAt: number }
  /** A slice came out of MediaRecorder and is held in memory. */
  | { type: "chunk-captured"; index: number; sizeBytes: number }
  /** The slice reached durable local storage. */
  | { type: "chunk-persisted"; index: number; sizeBytes: number }
  /** The slice could not be written locally; it is still held in memory. */
  | { type: "chunk-persist-failed"; index: number; error: unknown }
  | {
      type: "recording-complete";
      durationSeconds: number;
      sizeBytes: number;
      mimeType: string;
      blob: Blob;
      chunkCount: number;
    };

export type RecorderListener = (event: RecorderEvent) => void;

/**
 * Durable sink for slices. Called once per slice as soon as MediaRecorder
 * hands it over; the recorder waits for every call to settle before it
 * reports completion, so a resolved `stop()` means every slice was offered
 * to storage.
 */
export type PersistChunk = (index: number, blob: Blob) => Promise<void>;

export type RecorderOptions = {
  stream: MediaStream;
  timesliceMs?: number;
  preferredMimeTypes?: string[];
  persistChunk?: PersistChunk;
};

export type RecorderStartTime = {
  /** Wall clock, ms since epoch. Comparable across devices once a server offset is known. */
  startedAtMs: number;
  /** High-resolution time on this device (`performance.timeOrigin + performance.now()`). */
  startedAtPerfMs: number;
};

export type PersistStats = {
  captured: number;
  persisted: number;
  failed: number;
};

const DEFAULT_MIME_TYPES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "audio/webm",
];

export function pickSupportedMimeType(preferred?: string[]): string {
  const candidates =
    preferred && preferred.length ? preferred : DEFAULT_MIME_TYPES;
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

function nowPerfMs(): number {
  if (
    typeof performance !== "undefined" &&
    typeof performance.now === "function"
  ) {
    return (performance.timeOrigin ?? 0) + performance.now();
  }
  return Date.now();
}

export const __test__ = {
  DEFAULT_MIME_TYPES,
  AUDIO_MIME_PREFERENCES: () => AUDIO_MIME_PREFERENCES,
  VIDEO_ONLY_MIME_PREFERENCES: () => VIDEO_ONLY_MIME_PREFERENCES,
};

export class ChunkedRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private listeners = new Set<RecorderListener>();
  private startedAtMs = 0;
  private startedAtPerfMs = 0;
  private chunkIndex = 0;
  private mimeType = "";
  private finalBlob: Blob | null = null;
  private status: "idle" | "recording" | "stopped" = "idle";
  private stopPromise: Promise<Blob> | null = null;
  private resolveStop: ((blob: Blob) => void) | null = null;
  private rejectStop: ((err: unknown) => void) | null = null;
  private persistChunk: PersistChunk | null = null;
  private persistPromises: Promise<void>[] = [];
  private persistStats: PersistStats = { captured: 0, persisted: 0, failed: 0 };

  static isSupported(): boolean {
    return (
      typeof window !== "undefined" && typeof MediaRecorder !== "undefined"
    );
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
    const {
      stream,
      timesliceMs = 5000,
      preferredMimeTypes,
      persistChunk,
    } = options;
    const mimeType = pickSupportedMimeType(preferredMimeTypes);
    this.mimeType = mimeType;
    this.chunks = [];
    this.chunkIndex = 0;
    this.finalBlob = null;
    this.persistChunk = persistChunk ?? null;
    this.persistPromises = [];
    this.persistStats = { captured: 0, persisted: 0, failed: 0 };
    this.status = "recording";

    const recorderOptions: MediaRecorderOptions = mimeType ? { mimeType } : {};
    this.mediaRecorder = new MediaRecorder(stream, recorderOptions);

    this.mediaRecorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) {
        this.chunks.push(ev.data);
        const idx = this.chunkIndex++;
        this.persistStats.captured += 1;
        this.emit({
          type: "chunk-captured",
          index: idx,
          sizeBytes: ev.data.size,
        });
        this.offerToStorage(idx, ev.data);
      }
    };

    this.mediaRecorder.onstop = () => {
      void this.finish();
    };

    this.mediaRecorder.onerror = (ev) => {
      const err =
        (ev as unknown as { error?: Error }).error ??
        new Error("Recording error");
      this.rejectStop?.(err);
    };

    // Stamp the start as close to the first captured frame as possible.
    this.startedAtMs = Date.now();
    this.startedAtPerfMs = nowPerfMs();
    this.mediaRecorder.start(timesliceMs);
    this.emit({ type: "recording-started", startedAt: this.startedAtMs });
  }

  private offerToStorage(index: number, blob: Blob): void {
    if (!this.persistChunk) return;
    const p = Promise.resolve()
      .then(() => this.persistChunk!(index, blob))
      .then(() => {
        this.persistStats.persisted += 1;
        this.emit({ type: "chunk-persisted", index, sizeBytes: blob.size });
      })
      .catch((error: unknown) => {
        this.persistStats.failed += 1;
        this.emit({ type: "chunk-persist-failed", index, error });
      });
    this.persistPromises.push(p);
  }

  private async finish(): Promise<void> {
    // Every slice, including the one MediaRecorder flushes on stop, has been
    // offered to storage by now; wait for those writes before reporting done.
    await Promise.allSettled(this.persistPromises);
    const finalMime = this.mimeType || (this.chunks[0]?.type ?? "video/webm");
    const blob = new Blob(this.chunks, { type: finalMime });
    this.finalBlob = blob;
    const durationSeconds = Math.max(
      1,
      Math.round((Date.now() - this.startedAtMs) / 1000),
    );
    this.status = "stopped";
    this.emit({
      type: "recording-complete",
      durationSeconds,
      sizeBytes: blob.size,
      mimeType: finalMime,
      blob,
      chunkCount: this.chunks.length,
    });
    this.resolveStop?.(blob);
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

  /**
   * Ask MediaRecorder to hand over whatever it has buffered right now, so it
   * reaches storage without waiting for the next timeslice. Used when the tab
   * is hidden or the page is about to unload. No-op unless recording.
   */
  flush(): void {
    if (this.status !== "recording" || !this.mediaRecorder) return;
    try {
      if (this.mediaRecorder.state === "recording")
        this.mediaRecorder.requestData();
    } catch {
      // Some browsers throw if a slice is already being delivered; harmless.
    }
  }

  getStatus(): "idle" | "recording" | "stopped" {
    return this.status;
  }

  getChunkCount(): number {
    return this.chunks.length;
  }

  /** Snapshot of the chunk at `index`, or null if out of bounds. */
  getChunkAt(index: number): Blob | null {
    return this.chunks[index] ?? null;
  }

  getFinalBlob(): Blob | null {
    return this.finalBlob;
  }

  getMimeType(): string {
    return this.mimeType;
  }

  getStartTime(): RecorderStartTime {
    return {
      startedAtMs: this.startedAtMs,
      startedAtPerfMs: this.startedAtPerfMs,
    };
  }

  getPersistStats(): PersistStats {
    return { ...this.persistStats };
  }

  getDurationSeconds(): number {
    if (this.startedAtMs === 0) return 0;
    return Math.max(0, Math.round((Date.now() - this.startedAtMs) / 1000));
  }
}

// Two outputs per participant: the combined video+audio file from
// MediaRecorder, and an uncompressed WAV master of the microphone written by
// `WavMasterRecorder`. A failure in the master never affects the combined
// path. (Earlier versions ran a third MediaRecorder for video-only; it is
// gone, which removes one encode and one upload per participant.)

export type DualRecorderResult = {
  /** Combined video + audio blob. May be audio-only if no camera was on. */
  combinedBlob: Blob;
  combinedMimeType: string;
  combinedSizeBytes: number;
  /** WAV master of the microphone. Null when no mic track was on, when the
   *  master failed to start, or when nothing could be assembled. The
   *  combined blob is always returned regardless. */
  audioBlob: Blob | null;
  audioMimeType: string | null;
  audioSizeBytes: number;
  /** No longer produced; kept so older call sites type-check. Always null. */
  videoOnlyBlob: Blob | null;
  videoOnlyMimeType: string | null;
  videoOnlySizeBytes: number;
  /** True when the source stream had a video track at start. Drives the
   *  "Video + Audio" vs "Audio only" copy in the UI. */
  hasVideo: boolean;
  durationSeconds: number;
  /** When the combined recorder started; see `RecorderStartTime`. */
  startedAtMs: number;
  startedAtPerfMs: number;
  combinedChunkCount: number;
  audioChunkCount: number;
  videoOnlyChunkCount: number;
  /** True when the WAV master ran and produced a file. */
  audioRecordingOk: boolean;
  /** Always false now; see `videoOnlyBlob`. */
  videoRecordingOk: boolean;
  /** Local persistence totals across all streams. */
  persistStats: PersistStats;
};

const AUDIO_MIME_PREFERENCES = ["audio/webm;codecs=opus", "audio/webm"];

// Kept for the test helper that inspects preference lists; the video-only
// recorder itself no longer exists.
const VIDEO_ONLY_MIME_PREFERENCES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

/** Per-stream durable sink. `position` is set for writers that patch earlier
 *  bytes (the WAV header); plain appends leave it undefined. */
export type PersistStreamChunk = (
  stream: RecordingStream,
  index: number,
  blob: Blob,
  position?: number,
) => Promise<void>;

export type DualRecorderOptions = Omit<RecorderOptions, "persistChunk"> & {
  persistChunk?: PersistStreamChunk;
  /** Returns the chunks the sink stored for a stream, used to rebuild the WAV at stop. */
  loadPersistedChunks?: (stream: RecordingStream) => Promise<WavChunkPart[]>;
  /** Test seam: supply a fake WAV recorder. */
  createWavRecorder?: () => WavRecorderLike;
};

/** Combined recorder plus a best-effort WAV master. Top-level listeners
 *  forward only the combined stream. */
export class DualChunkedRecorder {
  private readonly combined = new ChunkedRecorder();
  private audioMaster: WavRecorderLike | null = null;
  private audioStartPromise: Promise<void> | null = null;
  private loadPersistedChunks:
    | DualRecorderOptions["loadPersistedChunks"]
    | null = null;
  private hasVideo = false;
  private audioStarted = false;

  static isSupported(): boolean {
    return ChunkedRecorder.isSupported();
  }

  /** Subscribe to the combined recorder's event stream. */
  on(listener: RecorderListener): () => void {
    return this.combined.on(listener);
  }

  /** @deprecated The WAV master has no slice events; kept for call sites. */
  onAudio(_listener: RecorderListener): () => void {
    return () => {};
  }

  /** @deprecated No video-only recorder exists any more. */
  onVideoOnly(_listener: RecorderListener): () => void {
    return () => {};
  }

  start(options: DualRecorderOptions): void {
    const { stream, persistChunk } = options;
    const videoTracks = stream.getVideoTracks();
    const audioTracks = stream.getAudioTracks();
    this.hasVideo = videoTracks.length > 0;
    this.loadPersistedChunks = options.loadPersistedChunks ?? null;

    // Combined recorder — required. An audio-only stream gets an audio
    // container so downstream code can tell the two apart by mime type.
    this.combined.start({
      stream,
      timesliceMs: options.timesliceMs,
      preferredMimeTypes:
        options.preferredMimeTypes ??
        (this.hasVideo ? undefined : AUDIO_MIME_PREFERENCES),
      persistChunk: persistChunk
        ? (index, blob) => persistChunk("combined", index, blob)
        : undefined,
    });

    // WAV master (best-effort, starts asynchronously; never blocks combined).
    const micTrack = audioTracks[0];
    if (micTrack) {
      const master = options.createWavRecorder
        ? options.createWavRecorder()
        : new WavMasterRecorder();
      this.audioMaster = master;
      const sink = persistChunk
        ? (index: number, position: number, blob: Blob) =>
            persistChunk("audio", index, blob, position)
        : undefined;
      this.audioStartPromise = master
        .start(micTrack, sink)
        .then(() => {
          this.audioStarted = true;
        })
        .catch((err: unknown) => {
          console.warn(
            "WAV master failed to start; continuing with the combined file only.",
            err,
          );
          this.audioMaster = null;
          this.audioStarted = false;
        });
    }
  }

  /** Stop both outputs and resolve with their blobs. */
  async stop(): Promise<DualRecorderResult> {
    const combinedPromise = this.combined.stop();
    await this.audioStartPromise;
    const master = this.audioMaster;
    const audioPromise: Promise<Blob | null> = master
      ? master
          .stop(
            this.loadPersistedChunks
              ? () => this.loadPersistedChunks!("audio")
              : undefined,
          )
          .catch((err: unknown) => {
            console.warn("WAV master stop() failed", err);
            return null;
          })
      : Promise.resolve(null);

    const [combinedBlob, audioBlob] = await Promise.all([
      combinedPromise,
      audioPromise,
    ]);

    const combinedMime =
      combinedBlob.type || (this.hasVideo ? "video/webm" : "audio/webm");
    const start = this.combined.getStartTime();

    return {
      combinedBlob,
      combinedMimeType: combinedMime,
      combinedSizeBytes: combinedBlob.size,
      audioBlob,
      audioMimeType: audioBlob ? WAV_MIME_TYPE : null,
      audioSizeBytes: audioBlob ? audioBlob.size : 0,
      videoOnlyBlob: null,
      videoOnlyMimeType: null,
      videoOnlySizeBytes: 0,
      hasVideo: this.hasVideo,
      durationSeconds: this.combined.getDurationSeconds(),
      startedAtMs: start.startedAtMs,
      startedAtPerfMs: start.startedAtPerfMs,
      combinedChunkCount: this.combined.getChunkCount(),
      audioChunkCount: master?.getPersistStats().captured ?? 0,
      videoOnlyChunkCount: 0,
      audioRecordingOk: this.audioStarted && !!audioBlob,
      videoRecordingOk: false,
      persistStats: this.getPersistStats(),
    };
  }

  /** Force the combined recorder to hand over its buffered slice now. The
   *  WAV master writes continuously and needs no flush. */
  flush(): void {
    this.combined.flush();
  }

  getStatus(): "idle" | "recording" | "stopped" {
    return this.combined.getStatus();
  }

  getDurationSeconds(): number {
    return this.combined.getDurationSeconds();
  }

  getStartTime(): RecorderStartTime {
    return this.combined.getStartTime();
  }

  /** Which streams are being produced, and with which container types. */
  getMimeTypes(): Partial<Record<RecordingStream, string>> {
    const out: Partial<Record<RecordingStream, string>> = {
      combined:
        this.combined.getMimeType() ||
        (this.hasVideo ? "video/webm" : "audio/webm"),
    };
    if (this.audioMaster) out.audio = WAV_MIME_TYPE;
    return out;
  }

  getPersistStats(): PersistStats {
    const c = this.combined.getPersistStats();
    const a = this.audioMaster?.getPersistStats() ?? {
      captured: 0,
      persisted: 0,
      failed: 0,
    };
    return {
      captured: c.captured + a.captured,
      persisted: c.persisted + a.persisted,
      failed: c.failed + a.failed,
    };
  }

  /** Underlying combined recorder. */
  getCombinedRecorder(): ChunkedRecorder {
    return this.combined;
  }

  /** @deprecated The audio sibling is a WAV master now; see `getWavRecorder`. */
  getAudioRecorder(): ChunkedRecorder | null {
    return null;
  }

  getWavRecorder(): WavRecorderLike | null {
    return this.audioMaster;
  }

  /** @deprecated No video-only recorder exists any more. */
  getVideoOnlyRecorder(): ChunkedRecorder | null {
    return null;
  }
}
