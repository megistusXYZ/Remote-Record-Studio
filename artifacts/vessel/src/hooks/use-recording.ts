import { useCallback, useEffect, useRef, useState } from "react";
import { DualChunkedRecorder } from "../lib/recorder";
import { BlossomUploadQueue, type SyncProgress, type SyncStatus } from "../lib/blossom";
import { saveRecordingBlob, buildLocalBlobUrl } from "../lib/recordings-storage";
import { getStorageUrl } from "../lib/storage-config";
import { useIdentity } from "./use-identity";

export type RecordingMeta = {
  durationSeconds: number;
  sizeBytes: number;
  mimeType: string;
  chunkCount: number;
  hasVideo: boolean;
};

/** Live, mid-recording crash-safety status. Each finalized recorder slice is
 *  uploaded to the user's storage server independently of the final blob. */
export type IncrementalSyncStats = {
  saved: number;
  failed: number;
  /** Latest known total slice count from the recorder; floor of `saved+failed`. */
  total: number;
};

/** Per-stream blob descriptor. Returned for both the combined V+A blob and
 *  the optional audio-only sibling so callers can offer real "Audio only"
 *  downloads without any post-call transcoding. */
export type StreamBlob = {
  blob: Blob;
  blobHash: string;
  /** Canonical URL for retrieval. Real remote URL when sync succeeded; falls
   *  back to `idb://<id>:<kind>` so local-only downloads still work. */
  blobUrl: string;
  /** Always set — local download fallback even when remote upload succeeded. */
  localBlobUrl: string;
  /** Remote storage URL on success, null on failure. */
  remoteUrl: string | null;
  syncStatus: SyncStatus;
  sizeBytes: number;
  mimeType: string;
};

export type RecordingResult = {
  recordingId: string;
  /** Combined video + audio blob (or audio-only when no camera). */
  blob: Blob;
  meta: RecordingMeta;
  blobHash: string;
  blobUrl: string;
  localBlobUrl: string;
  remoteUrl: string | null;
  syncStatus: SyncStatus;
  /** Audio-only sibling blob — null when no mic was on or the audio-only
   *  recorder failed. The combined blob always exists. */
  audio: StreamBlob | null;
  /** Video-only sibling blob — null when no camera was on or the recorder
   *  failed. Uploaded on its own queue (mirroring `audio`); IndexedDB is
   *  the local fallback when remote sync didn't complete. */
  video: StreamBlob | null;
  /** Number of mid-recording slices safely uploaded to the storage server.
   *  Counts the COMBINED stream's slices only (the existing chip semantics).
   *  Audio-only slice uploads run on a parallel queue but are not surfaced
   *  here to keep the live UI unchanged. */
  incrementalSaved: number;
  incrementalFailed: number;
};

export type UseRecordingResult = {
  isSupported: boolean;
  isRecording: boolean;
  isFinalizing: boolean;
  isSyncing: boolean;
  syncProgress: SyncProgress;
  syncStatus: SyncStatus;
  /** Live mid-recording upload status. Updates while `isRecording` is true. */
  incrementalSync: IncrementalSyncStats;
  result: RecordingResult | null;
  error: string | null;
  start: (stream: MediaStream) => Promise<void>;
  stop: () => Promise<RecordingResult | null>;
  reset: () => void;
};

function makeRecordingId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `rec_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Audio-only sibling blobs are persisted under a derived key so the same
 *  recording id maps to BOTH the combined blob (`<id>`) and the audio-only
 *  blob (`<id>:audio`). The vault download path falls back to this key
 *  when offering an "Audio only" download for an offline-only recording. */
export function audioOnlyLocalKey(recordingId: string): string {
  return `${recordingId}:audio`;
}

/** Derive the IndexedDB key for the local-only video-only sibling. Same
 *  derivation pattern as the audio sibling so callers can derive both from
 *  the recording id without consulting the manifest. */
export function videoOnlyLocalKey(recordingId: string): string {
  return `${recordingId}:video`;
}

/** `idb://<id>:video` URL for serving the video-only sibling out of
 *  IndexedDB. Mirrors `audioOnlyLocalUrl`. */
export function videoOnlyLocalUrl(recordingId: string): string {
  return buildLocalBlobUrl(videoOnlyLocalKey(recordingId));
}

export function audioOnlyLocalUrl(recordingId: string): string {
  return buildLocalBlobUrl(audioOnlyLocalKey(recordingId));
}

export function useRecording(): UseRecordingResult {
  const { identity } = useIdentity();
  const recorderRef = useRef<DualChunkedRecorder | null>(null);
  const queueRef = useRef<BlossomUploadQueue | null>(null);
  const audioQueueRef = useRef<BlossomUploadQueue | null>(null);
  const videoQueueRef = useRef<BlossomUploadQueue | null>(null);
  const recorderUnsubRef = useRef<(() => void) | null>(null);
  const audioRecorderUnsubRef = useRef<(() => void) | null>(null);
  const videoRecorderUnsubRef = useRef<(() => void) | null>(null);
  const queueUnsubRef = useRef<(() => void) | null>(null);
  const sliceCountRef = useRef(0);

  const [isSupported] = useState(DualChunkedRecorder.isSupported());
  const [isRecording, setIsRecording] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [syncProgress, setSyncProgress] = useState<SyncProgress>({ synced: 0, total: 0, percent: 0, failed: 0 });
  const [incrementalSync, setIncrementalSync] = useState<IncrementalSyncStats>({
    saved: 0,
    failed: 0,
    total: 0,
  });
  const [result, setResult] = useState<RecordingResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const teardownListeners = useCallback(() => {
    recorderUnsubRef.current?.();
    recorderUnsubRef.current = null;
    audioRecorderUnsubRef.current?.();
    audioRecorderUnsubRef.current = null;
    videoRecorderUnsubRef.current?.();
    videoRecorderUnsubRef.current = null;
    queueUnsubRef.current?.();
    queueUnsubRef.current = null;
  }, []);

  const start = useCallback(async (stream: MediaStream) => {
    if (!isSupported) {
      setError("Recording is not supported in this browser.");
      return;
    }
    if (recorderRef.current) {
      setError("A recording is already in progress.");
      return;
    }
    try {
      setError(null);
      setResult(null);
      setSyncStatus("idle");
      setSyncProgress({ synced: 0, total: 0, percent: 0, failed: 0 });
      setIncrementalSync({ saved: 0, failed: 0, total: 0 });
      sliceCountRef.current = 0;

      const rec = new DualChunkedRecorder();
      recorderRef.current = rec;

      // Live slice uploads (crash-resilience). Final-blob sync at stop()
      // remains the source of truth for the canonical recording.
      let queue: BlossomUploadQueue | null = null;
      let audioQueue: BlossomUploadQueue | null = null;
      let videoQueue: BlossomUploadQueue | null = null;
      if (identity) {
        queue = new BlossomUploadQueue({
          serverUrl: getStorageUrl(identity._pubkey),
          signer: identity._signer,
        });
        queueRef.current = queue;
        audioQueue = new BlossomUploadQueue({
          serverUrl: getStorageUrl(identity._pubkey),
          signer: identity._signer,
        });
        audioQueueRef.current = audioQueue;
        videoQueue = new BlossomUploadQueue({
          serverUrl: getStorageUrl(identity._pubkey),
          signer: identity._signer,
        });
        videoQueueRef.current = videoQueue;
        queueUnsubRef.current = queue.on((ev) => {
          if (ev.type === "incremental-chunk-uploaded" || ev.type === "incremental-chunk-failed") {
            setIncrementalSync({
              saved: ev.saved,
              failed: ev.failed,
              total: Math.max(sliceCountRef.current, ev.saved + ev.failed),
            });
          }
        });
      }

      recorderUnsubRef.current = rec.on((ev) => {
        if (ev.type === "chunk-saved-locally") {
          sliceCountRef.current = Math.max(sliceCountRef.current, ev.index + 1);
          setIncrementalSync((s) => ({ ...s, total: sliceCountRef.current }));
          const slice = rec.getCombinedRecorder().getChunkAt(ev.index);
          if (queue && slice) {
            queue.enqueueIncrementalChunk(slice, ev.index);
          }
        }
      });

      // Sibling slice uploads (best-effort; not surfaced in incrementalSync).
      audioRecorderUnsubRef.current = rec.onAudio((ev) => {
        if (ev.type === "chunk-saved-locally") {
          const audioRec = rec.getAudioRecorder();
          if (!audioRec) return;
          const slice = audioRec.getChunkAt(ev.index);
          if (audioQueue && slice) {
            audioQueue.enqueueIncrementalChunk(slice, ev.index);
          }
        }
      });

      videoRecorderUnsubRef.current = rec.onVideoOnly((ev) => {
        if (ev.type === "chunk-saved-locally") {
          const videoRec = rec.getVideoOnlyRecorder();
          if (!videoRec) return;
          const slice = videoRec.getChunkAt(ev.index);
          if (videoQueue && slice) {
            videoQueue.enqueueIncrementalChunk(slice, ev.index);
          }
        }
      });

      rec.start({ stream, timesliceMs: 5000 });
      setIsRecording(true);
    } catch (err) {
      console.error("Failed to start recording", err);
      setError(err instanceof Error ? err.message : "Failed to start recording");
      teardownListeners();
      recorderRef.current = null;
      queueRef.current = null;
      audioQueueRef.current = null;
      videoQueueRef.current = null;
    }
  }, [isSupported, identity, teardownListeners]);

  const stop = useCallback(async (): Promise<RecordingResult | null> => {
    const rec = recorderRef.current;
    if (!rec) return null;
    setIsFinalizing(true);
    try {
      const dual = await rec.stop();
      setIsRecording(false);
      const recordingId = makeRecordingId();
      const localBlobUrl = buildLocalBlobUrl(recordingId);
      const audioLocalBlobUrl = dual.audioBlob ? audioOnlyLocalUrl(recordingId) : "";
      const videoLocalBlobUrl = dual.videoOnlyBlob ? videoOnlyLocalUrl(recordingId) : "";

      try {
        await saveRecordingBlob(recordingId, dual.combinedBlob);
      } catch (err) {
        console.warn("Failed to persist recording locally", err);
      }
      if (dual.audioBlob) {
        try {
          await saveRecordingBlob(audioOnlyLocalKey(recordingId), dual.audioBlob);
        } catch (err) {
          console.warn("Failed to persist audio-only sibling locally", err);
        }
      }
      if (dual.videoOnlyBlob) {
        try {
          await saveRecordingBlob(videoOnlyLocalKey(recordingId), dual.videoOnlyBlob);
        } catch (err) {
          console.warn("Failed to persist video-only sibling locally", err);
        }
      }

      // Combined-stream final-blob sync (drives the saving progress UI).
      let syncResult: { status: SyncStatus; remoteUrl: string | null; hash: string };
      const queue = queueRef.current;
      if (!identity || !queue) {
        const failProgress: SyncProgress = { synced: 0, total: 1, percent: 0, failed: 1 };
        setSyncStatus("partial-failure");
        setSyncProgress(failProgress);
        setIsSyncing(false);
        syncResult = { status: "partial-failure", remoteUrl: null, hash: "" };
      } else {
        const finalListenerUnsub = queue.on((ev) => {
          if (ev.type === "sync-started") {
            setSyncStatus("syncing");
            setIsSyncing(true);
            setSyncProgress({ synced: 0, total: ev.total, percent: 0, failed: 0 });
          } else if (ev.type === "chunk-synced") {
            setSyncProgress(ev.progress);
          } else if (ev.type === "chunk-sync-failed") {
            setSyncProgress(ev.progress);
          } else if (ev.type === "sync-complete") {
            setSyncStatus(ev.status);
            setSyncProgress(ev.progress);
            setIsSyncing(false);
          }
        });

        try {
          await queue.waitForIncrementalUploads(8000);
          syncResult = await queue.sync(dual.combinedBlob);
        } catch (err) {
          console.error("Sync failed", err);
          syncResult = { status: "partial-failure", remoteUrl: null, hash: "" };
          setSyncStatus("partial-failure");
          setIsSyncing(false);
        }
        finalListenerUnsub();
      }

      // Audio-only final-blob sync (best-effort, no UI progress).
      let audioStream: StreamBlob | null = null;
      if (dual.audioBlob) {
        const audioQueue = audioQueueRef.current;
        let audioSync: { status: SyncStatus; remoteUrl: string | null; hash: string } = {
          status: "partial-failure",
          remoteUrl: null,
          hash: "",
        };
        if (identity && audioQueue) {
          try {
            await audioQueue.waitForIncrementalUploads(8000);
            audioSync = await audioQueue.sync(dual.audioBlob);
          } catch (err) {
            console.warn("Audio-only sync failed; keeping local-only audio sibling.", err);
          }
        }
        audioStream = {
          blob: dual.audioBlob,
          blobHash: audioSync.hash,
          blobUrl: audioSync.remoteUrl ?? audioLocalBlobUrl,
          localBlobUrl: audioLocalBlobUrl,
          remoteUrl: audioSync.remoteUrl,
          syncStatus: audioSync.status,
          sizeBytes: dual.audioSizeBytes,
          mimeType: dual.audioMimeType ?? "audio/webm",
        };
      }

      const meta: RecordingMeta = {
        durationSeconds: dual.durationSeconds,
        sizeBytes: dual.combinedSizeBytes,
        mimeType: dual.combinedMimeType,
        chunkCount: dual.combinedChunkCount,
        hasVideo: dual.hasVideo,
      };

      const incStats = queue?.getIncrementalStats() ?? { saved: 0, failed: 0, remoteUrls: [] };

      // Video-only final-blob sync (mirrors audio-only; best-effort).
      let videoStream: StreamBlob | null = null;
      if (dual.videoOnlyBlob) {
        const videoQueue = videoQueueRef.current;
        let videoSync: { status: SyncStatus; remoteUrl: string | null; hash: string } = {
          status: "partial-failure",
          remoteUrl: null,
          hash: "",
        };
        if (identity && videoQueue) {
          try {
            await videoQueue.waitForIncrementalUploads(8000);
            videoSync = await videoQueue.sync(dual.videoOnlyBlob);
          } catch (err) {
            console.warn("Video-only sync failed; keeping local-only video sibling.", err);
          }
        }
        videoStream = {
          blob: dual.videoOnlyBlob,
          blobHash: videoSync.hash,
          blobUrl: videoSync.remoteUrl ?? videoLocalBlobUrl,
          localBlobUrl: videoLocalBlobUrl,
          remoteUrl: videoSync.remoteUrl,
          syncStatus: videoSync.status,
          sizeBytes: dual.videoOnlySizeBytes,
          mimeType: dual.videoOnlyMimeType ?? "video/webm",
        };
      }

      const r: RecordingResult = {
        recordingId,
        blob: dual.combinedBlob,
        meta,
        blobHash: syncResult.hash,
        blobUrl: syncResult.remoteUrl ?? localBlobUrl,
        localBlobUrl,
        remoteUrl: syncResult.remoteUrl,
        syncStatus: syncResult.status,
        audio: audioStream,
        video: videoStream,
        incrementalSaved: incStats.saved,
        incrementalFailed: incStats.failed,
      };
      setResult(r);
      return r;
    } catch (err) {
      console.error("Failed to finalize recording", err);
      setError(err instanceof Error ? err.message : "Failed to finalize recording");
      return null;
    } finally {
      setIsFinalizing(false);
      teardownListeners();
      recorderRef.current = null;
      // Keep queueRef for getIncrementalStats() consumers until reset().
    }
  }, [identity, teardownListeners]);

  const reset = useCallback(() => {
    teardownListeners();
    recorderRef.current = null;
    queueRef.current = null;
    audioQueueRef.current = null;
    videoQueueRef.current = null;
    sliceCountRef.current = 0;
    setIsRecording(false);
    setIsFinalizing(false);
    setIsSyncing(false);
    setSyncStatus("idle");
    setSyncProgress({ synced: 0, total: 0, percent: 0, failed: 0 });
    setIncrementalSync({ saved: 0, failed: 0, total: 0 });
    setResult(null);
    setError(null);
  }, [teardownListeners]);

  useEffect(() => {
    return () => {
      const rec = recorderRef.current;
      if (rec && rec.getStatus() === "recording") {
        try {
          rec.stop();
        } catch {
          // ignore on unmount
        }
      }
      teardownListeners();
    };
  }, [teardownListeners]);

  return {
    isSupported,
    isRecording,
    isFinalizing,
    isSyncing,
    syncProgress,
    syncStatus,
    incrementalSync,
    result,
    error,
    start,
    stop,
    reset,
  };
}
