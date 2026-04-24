import { useCallback, useEffect, useRef, useState } from "react";
import { ChunkedRecorder } from "../lib/recorder";
import { BlossomUploadQueue, type SyncProgress, type SyncStatus } from "../lib/blossom";
import { saveRecordingBlob, buildLocalBlobUrl } from "../lib/recordings-storage";

export type RecordingMeta = {
  durationSeconds: number;
  sizeBytes: number;
  mimeType: string;
  chunkCount: number;
  hasVideo: boolean;
};

export type RecordingResult = {
  recordingId: string;
  blob: Blob;
  meta: RecordingMeta;
  blobHash: string;
  blobUrl: string;
  syncStatus: SyncStatus;
};

export type UseRecordingResult = {
  isSupported: boolean;
  isRecording: boolean;
  isFinalizing: boolean;
  isSyncing: boolean;
  syncProgress: SyncProgress;
  syncStatus: SyncStatus;
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
  const recorderRef = useRef<ChunkedRecorder | null>(null);
  const queueRef = useRef<BlossomUploadQueue | null>(null);

  const [isSupported] = useState(ChunkedRecorder.isSupported());
  const [isRecording, setIsRecording] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [syncProgress, setSyncProgress] = useState<SyncProgress>({ synced: 0, total: 0, percent: 0, failed: 0 });
  const [result, setResult] = useState<RecordingResult | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      const rec = new ChunkedRecorder();
      recorderRef.current = rec;
      rec.start({ stream, timesliceMs: 5000 });
      setIsRecording(true);
    } catch (err) {
      console.error("Failed to start recording", err);
      setError(err instanceof Error ? err.message : "Failed to start recording");
      recorderRef.current = null;
    }
  }, [isSupported]);

  const stop = useCallback(async (): Promise<RecordingResult | null> => {
    const rec = recorderRef.current;
    if (!rec) return null;
    setIsFinalizing(true);
    try {
      const blob = await rec.stop();
      setIsRecording(false);
      const recordingId = makeRecordingId();

      try {
        await saveRecordingBlob(recordingId, blob);
      } catch (err) {
        console.warn("Failed to persist recording locally", err);
      }

      const queue = new BlossomUploadQueue();
      queueRef.current = queue;
      const unsubscribe = queue.on((ev) => {
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

      let syncResult: { status: SyncStatus; remoteUrl: string | null; hash: string };
      try {
        syncResult = await queue.sync(blob);
      } catch (err) {
        console.error("Sync failed", err);
        syncResult = { status: "partial-failure", remoteUrl: null, hash: "" };
        setSyncStatus("partial-failure");
        setIsSyncing(false);
      }
      unsubscribe();

      const mimeType = blob.type || "video/webm";
      const meta: RecordingMeta = {
        durationSeconds: rec.getDurationSeconds(),
        sizeBytes: blob.size,
        mimeType,
        chunkCount: rec.getChunkCount(),
        hasVideo: mimeType.startsWith("video/"),
      };

      const r: RecordingResult = {
        recordingId,
        blob,
        meta,
        blobHash: syncResult.hash,
        blobUrl: buildLocalBlobUrl(recordingId),
        syncStatus: syncResult.status,
      };
      setResult(r);
      return r;
    } catch (err) {
      console.error("Failed to finalize recording", err);
      setError(err instanceof Error ? err.message : "Failed to finalize recording");
      return null;
    } finally {
      setIsFinalizing(false);
      recorderRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    recorderRef.current = null;
    queueRef.current = null;
    setIsRecording(false);
    setIsFinalizing(false);
    setIsSyncing(false);
    setSyncStatus("idle");
    setSyncProgress({ synced: 0, total: 0, percent: 0, failed: 0 });
    setResult(null);
    setError(null);
  }, []);

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
    };
  }, []);

  return {
    isSupported,
    isRecording,
    isFinalizing,
    isSyncing,
    syncProgress,
    syncStatus,
    result,
    error,
    start,
    stop,
    reset,
  };
}
