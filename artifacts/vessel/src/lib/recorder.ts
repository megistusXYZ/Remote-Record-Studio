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

export function pickSupportedMimeType(preferred?: string[]): string {
  const candidates = preferred && preferred.length ? preferred : DEFAULT_MIME_TYPES;
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
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

  /** Snapshot of the chunk at `index`, or null if out of bounds. Public,
   *  typed accessor used by the upload pipeline so callers don't have to
   *  reach into private state via type escapes. */
  getChunkAt(index: number): Blob | null {
    return this.chunks[index] ?? null;
  }

  getFinalBlob(): Blob | null {
    return this.finalBlob;
  }

  getDurationSeconds(): number {
    if (this.startTime === 0) return 0;
    return Math.max(0, Math.round((Date.now() - this.startTime) / 1000));
  }
}

// Dual-stream recorder: combined V+A + audio-only sibling + video-only
// sibling, each on its own MediaRecorder. Sibling failures never abort
// the combined path; no post-call transcoding required.

export type DualRecorderResult = {
  /** Combined video + audio blob. May be audio-only if no camera was on. */
  combinedBlob: Blob;
  combinedMimeType: string;
  combinedSizeBytes: number;
  /** Audio-only sibling blob. Null when no mic track was on, when the
   *  audio-only recorder failed to initialize, or when the audio recorder
   *  errored mid-call. The combined blob is always returned regardless. */
  audioBlob: Blob | null;
  audioMimeType: string | null;
  audioSizeBytes: number;
  /** Video-only sibling blob. A real video stream WITHOUT audio bytes —
   *  recorded by a third MediaRecorder fed only the camera tracks. Null
   *  when there's no camera, when the video-only recorder failed, or when
   *  the browser doesn't support a video-only mime type. The combined
   *  blob is unaffected either way. */
  videoOnlyBlob: Blob | null;
  videoOnlyMimeType: string | null;
  videoOnlySizeBytes: number;
  /** True when the source stream had a video track at start. Drives the
   *  "Video + Audio" vs "Audio only" copy in the UI. */
  hasVideo: boolean;
  durationSeconds: number;
  combinedChunkCount: number;
  audioChunkCount: number;
  videoOnlyChunkCount: number;
  /** True when the audio-only recorder ran for the full duration. False
   *  when it either never started or errored before stop(). */
  audioRecordingOk: boolean;
  /** True when the video-only recorder ran for the full duration. */
  videoRecordingOk: boolean;
};

const AUDIO_MIME_PREFERENCES = [
  "audio/webm;codecs=opus",
  "audio/webm",
];

// Try no-audio codec strings first so the container holds video bytes only.
const VIDEO_ONLY_MIME_PREFERENCES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

/** Combined recorder + best-effort audio-only and video-only siblings.
 *  Top-level listeners forward only the combined stream; sibling listeners
 *  use `onAudio` / `onVideoOnly`. */
export class DualChunkedRecorder {
  private readonly combined = new ChunkedRecorder();
  private audioOnly: ChunkedRecorder | null = null;
  private videoOnly: ChunkedRecorder | null = null;
  private audioStream: MediaStream | null = null;
  private videoStream: MediaStream | null = null;
  private hasVideo = false;
  private audioStarted = false;
  private videoStarted = false;

  static isSupported(): boolean {
    return ChunkedRecorder.isSupported();
  }

  /** Subscribe to the combined recorder's event stream. */
  on(listener: RecorderListener): () => void {
    return this.combined.on(listener);
  }

  /** Subscribe to the audio-only recorder's event stream. Safe to call
   *  before start; the listener is buffered and attached when (and if) the
   *  audio recorder initializes successfully. */
  onAudio(listener: RecorderListener): () => void {
    if (this.audioOnly) return this.audioOnly.on(listener);
    this.pendingAudioListeners.push(listener);
    return () => {
      const i = this.pendingAudioListeners.indexOf(listener);
      if (i >= 0) this.pendingAudioListeners.splice(i, 1);
    };
  }
  private pendingAudioListeners: RecorderListener[] = [];

  /** Subscribe to the video-only recorder's event stream. Same buffering
   *  semantics as `onAudio`. */
  onVideoOnly(listener: RecorderListener): () => void {
    if (this.videoOnly) return this.videoOnly.on(listener);
    this.pendingVideoListeners.push(listener);
    return () => {
      const i = this.pendingVideoListeners.indexOf(listener);
      if (i >= 0) this.pendingVideoListeners.splice(i, 1);
    };
  }
  private pendingVideoListeners: RecorderListener[] = [];

  start(options: RecorderOptions): void {
    const { stream } = options;
    const videoTracks = stream.getVideoTracks();
    const audioTracks = stream.getAudioTracks();
    this.hasVideo = videoTracks.length > 0;

    // Combined recorder — required.
    this.combined.start(options);

    // Audio-only sibling (best-effort).
    if (audioTracks.length > 0) {
      try {
        const audioStream = new MediaStream(audioTracks);
        const rec = new ChunkedRecorder();
        for (const l of this.pendingAudioListeners) rec.on(l);
        this.pendingAudioListeners = [];
        rec.start({
          stream: audioStream,
          timesliceMs: options.timesliceMs,
          preferredMimeTypes: AUDIO_MIME_PREFERENCES,
        });
        this.audioOnly = rec;
        this.audioStream = audioStream;
        this.audioStarted = true;
      } catch (err) {
        console.warn("Audio-only recorder failed to start; continuing with combined only.", err);
        this.audioOnly = null;
        this.audioStream = null;
        this.audioStarted = false;
      }
    }

    // Video-only sibling (best-effort).
    if (videoTracks.length > 0) {
      try {
        const videoStream = new MediaStream(videoTracks);
        const rec = new ChunkedRecorder();
        for (const l of this.pendingVideoListeners) rec.on(l);
        this.pendingVideoListeners = [];
        rec.start({
          stream: videoStream,
          timesliceMs: options.timesliceMs,
          preferredMimeTypes: VIDEO_ONLY_MIME_PREFERENCES,
        });
        this.videoOnly = rec;
        this.videoStream = videoStream;
        this.videoStarted = true;
      } catch (err) {
        console.warn("Video-only recorder failed to start; continuing without it.", err);
        this.videoOnly = null;
        this.videoStream = null;
        this.videoStarted = false;
      }
    }
  }

  /** Stop all recorders and resolve with their blobs. The audio/video-only
   *  blobs are null when their respective paths were never started or
   *  errored mid-call. */
  async stop(): Promise<DualRecorderResult> {
    const combinedPromise = this.combined.stop();
    const audioPromise: Promise<Blob | null> = this.audioOnly
      ? this.audioOnly.stop().catch((err) => {
          console.warn("Audio-only recorder stop() failed", err);
          return null;
        })
      : Promise.resolve(null);
    const videoOnlyPromise: Promise<Blob | null> = this.videoOnly
      ? this.videoOnly.stop().catch((err) => {
          console.warn("Video-only recorder stop() failed", err);
          return null;
        })
      : Promise.resolve(null);

    const [combinedBlob, audioBlob, videoOnlyBlob] = await Promise.all([
      combinedPromise,
      audioPromise,
      videoOnlyPromise,
    ]);

    // Release the synthetic streams so the underlying tracks aren't
    // double-held; the original local stream still owns the actual tracks.
    this.audioStream = null;
    this.videoStream = null;

    const combinedMime = combinedBlob.type || "video/webm";
    const audioRec = this.audioOnly;
    const audioMime = audioBlob ? audioBlob.type || (audioRec?.getFinalBlob()?.type ?? "audio/webm") : null;
    const videoRec = this.videoOnly;
    const videoOnlyMime = videoOnlyBlob
      ? videoOnlyBlob.type || (videoRec?.getFinalBlob()?.type ?? "video/webm")
      : null;

    return {
      combinedBlob,
      combinedMimeType: combinedMime,
      combinedSizeBytes: combinedBlob.size,
      audioBlob,
      audioMimeType: audioMime,
      audioSizeBytes: audioBlob ? audioBlob.size : 0,
      videoOnlyBlob,
      videoOnlyMimeType: videoOnlyMime,
      videoOnlySizeBytes: videoOnlyBlob ? videoOnlyBlob.size : 0,
      hasVideo: this.hasVideo,
      durationSeconds: this.combined.getDurationSeconds(),
      combinedChunkCount: this.combined.getChunkCount(),
      audioChunkCount: audioRec?.getChunkCount() ?? 0,
      videoOnlyChunkCount: videoRec?.getChunkCount() ?? 0,
      audioRecordingOk: this.audioStarted && !!audioBlob,
      videoRecordingOk: this.videoStarted && !!videoOnlyBlob,
    };
  }

  getStatus(): "idle" | "recording" | "stopped" {
    return this.combined.getStatus();
  }

  getDurationSeconds(): number {
    return this.combined.getDurationSeconds();
  }

  /** Underlying combined recorder — exposed so `useRecording` can reach the
   *  internal `chunks` array for incremental slice uploads (mirrors the
   *  existing single-recorder behavior). */
  getCombinedRecorder(): ChunkedRecorder {
    return this.combined;
  }

  /** Underlying audio-only recorder, or null when audio recording was not
   *  started. Same shape as the combined recorder so the upload queue can
   *  treat both uniformly. */
  getAudioRecorder(): ChunkedRecorder | null {
    return this.audioOnly;
  }

  /** Underlying video-only recorder, or null when no camera was attached.
   *  Local-only by design — exposed for diagnostics, not for upload. */
  getVideoOnlyRecorder(): ChunkedRecorder | null {
    return this.videoOnly;
  }
}
