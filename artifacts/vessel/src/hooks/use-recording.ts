import { useCallback, useEffect, useRef, useState } from "react";
import { ChunkedRecorder } from "../lib/recorder";
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

export type RecordingResult = {
  recordingId: string;
  blob: Blob;
  meta: RecordingMeta;
  blobHash: string;
  /** Canonical URL for retrieval. Real remote URL when sync succeeded; falls
   *  back to `idb://<id>` so local-only downloads still work. */
  blobUrl: string;
  /** Always set — local download fallback even when remote upload succeeded. */
  localBlobUrl: string;
  /** Remote storage URL on success, null on failure. */
  remoteUrl: string | null;
  syncStatus: SyncStatus;
  /** Number of mid-recording slices safely uploaded to the storage server. */
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

export function useRecording(): UseRecordingResult {
  const { identity } = useIdentity();
  const recorderRef = useRef<ChunkedRecorder | null>(null);
  const queueRef = useRef<BlossomUploadQueue | null>(null);
  const recorderUnsubRef = useRef<(() => void) | null>(null);
  const queueUnsubRef = useRef<(() => void) | null>(null);
  const sliceCountRef = useRef(0);

  const [isSupported] = useState(ChunkedRecorder.isSupported());
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

      const rec = new ChunkedRecorder();
      recorderRef.current = rec;

      // Spin up the upload queue immediately so each finalized recorder slice
      // can be PUT to the user's storage server while the call is still live.
      // This is the crash-resilience path: a tab crash mid-session preserves
      // every slice that already finished syncing. The final-blob upload at
      // stop() still runs and produces the canonical playable URL.
      let queue: BlossomUploadQueue | null = null;
      if (identity) {
        queue = new BlossomUploadQueue({
          serverUrl: getStorageUrl(identity._pubkey),
          signer: identity._signer,
        });
        queueRef.current = queue;
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

      // Hash the just-finalized timeslice and upload it as its own
      // content-addressed blob. Fire-and-forget by design — the queue tracks
      // outcomes and the final-blob sync at stop() is the source of truth for
      // the canonical recording.
      recorderUnsubRef.current = rec.on((ev) => {
        if (ev.type === "chunk-saved-locally") {
          sliceCountRef.current = Math.max(sliceCountRef.current, ev.index + 1);
          setIncrementalSync((s) => ({ ...s, total: sliceCountRef.current }));
          // Pull the just-finalized slice as a standalone Blob. Recorder keeps
          // the ordered list of chunks; the new arrival is at index `ev.index`.
          // We snapshot only that one chunk here (slice-of-one) so the Blob
          // body is independent of any future appends.
          const chunks = (rec as unknown as { chunks: Blob[] }).chunks;
          const slice = chunks?.[ev.index];
          if (queue && slice) {
            queue.enqueueIncrementalChunk(slice, ev.index);
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
    }
  }, [isSupported, identity, teardownListeners]);

  const stop = useCallback(async (): Promise<RecordingResult | null> => {
    const rec = recorderRef.current;
    if (!rec) return null;
    setIsFinalizing(true);
    try {
      const blob = await rec.stop();
      setIsRecording(false);
      const recordingId = makeRecordingId();
      const localBlobUrl = buildLocalBlobUrl(recordingId);

      try {
        await saveRecordingBlob(recordingId, blob);
      } catch (err) {
        console.warn("Failed to persist recording locally", err);
      }

      let syncResult: { status: SyncStatus; remoteUrl: string | null; hash: string };
      const queue = queueRef.current;
      if (!identity || !queue) {
        // No active identity (rare — guest path always has one). Skip remote
        // sync entirely; mark as failed so the UI shows local-only state.
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
          // Wait briefly for any in-flight live slice uploads so the totals we
          // report on the result match what's actually on the server. Bounded
          // so a stuck slice can't block session teardown.
          await queue.waitForIncrementalUploads(8000);
          syncResult = await queue.sync(blob);
        } catch (err) {
          console.error("Sync failed", err);
          syncResult = { status: "partial-failure", remoteUrl: null, hash: "" };
          setSyncStatus("partial-failure");
          setIsSyncing(false);
        }
        finalListenerUnsub();
      }

      const mimeType = blob.type || "video/webm";
      const meta: RecordingMeta = {
        durationSeconds: rec.getDurationSeconds(),
        sizeBytes: blob.size,
        mimeType,
        chunkCount: rec.getChunkCount(),
        hasVideo: mimeType.startsWith("video/"),
      };

      const incStats = queue?.getIncrementalStats() ?? { saved: 0, failed: 0, remoteUrls: [] };

      const r: RecordingResult = {
        recordingId,
        blob,
        meta,
        blobHash: syncResult.hash,
        // Prefer the real remote URL so vault rows resolve to a fetchable
        // address; fall back to idb:// when upload failed so local download
        // still works.
        blobUrl: syncResult.remoteUrl ?? localBlobUrl,
        localBlobUrl,
        remoteUrl: syncResult.remoteUrl,
        syncStatus: syncResult.status,
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
