import { useCallback, useEffect, useRef, useState } from "react";
import { DualChunkedRecorder } from "../lib/recorder";
import type { SyncProgress, SyncStatus } from "../lib/blossom";
import {
  finalizeRecording,
  type RecordingResult,
} from "../lib/recording-finalize";
import {
  appendRecordingChunk,
  putInProgressRecording,
  requestPersistentStorage,
  updateInProgressRecording,
  type InProgressContext,
  type RecordingStream,
} from "../lib/recordings-storage";
import { useIdentity } from "./use-identity";
import { measureServerOffset } from "../lib/server-time";
import { useRecordingActivity } from "../lib/recording-activity";

export type {
  RecordingMeta,
  RecordingResult,
  StreamBlob,
} from "../lib/recording-finalize";
export {
  audioOnlyLocalKey,
  audioOnlyLocalUrl,
  videoOnlyLocalKey,
  videoOnlyLocalUrl,
} from "../lib/recording-finalize";

/**
 * Live, mid-recording durability status for the combined stream: how many
 * slices MediaRecorder has produced, how many are safely on this device, and
 * how many could not be written (usually a full disk).
 */
export type IncrementalSyncStats = {
  saved: number;
  failed: number;
  total: number;
};

/** What the recording belongs to; stored with the in-flight chunks so an
 *  interrupted recording can be named and recovered later. */
export type RecordingContext = InProgressContext;

export type UseRecordingResult = {
  isSupported: boolean;
  isRecording: boolean;
  isFinalizing: boolean;
  isSyncing: boolean;
  syncProgress: SyncProgress;
  syncStatus: SyncStatus;
  /** Live local-persistence status. Updates while `isRecording` is true. */
  incrementalSync: IncrementalSyncStats;
  /** Set when slices could not be written to this device mid-recording. */
  localPersistError: string | null;
  result: RecordingResult | null;
  error: string | null;
  start: (stream: MediaStream, context?: RecordingContext) => Promise<void>;
  stop: () => Promise<RecordingResult | null>;
  reset: () => void;
};

/** Slice length. Shorter slices bound what a hard crash can lose. */
const TIMESLICE_MS = 3000;

const EMPTY_PROGRESS: SyncProgress = {
  synced: 0,
  total: 0,
  percent: 0,
  failed: 0,
};

function makeRecordingId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `rec_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function useRecording(): UseRecordingResult {
  const { identity } = useIdentity();
  const recorderRef = useRef<DualChunkedRecorder | null>(null);
  const recordingIdRef = useRef<string | null>(null);
  const unsubsRef = useRef<Array<() => void>>([]);
  const chunkCountsRef = useRef<Record<RecordingStream, number>>({
    combined: 0,
    audio: 0,
    video: 0,
  });
  const serverOffsetRef = useRef<number | null>(null);
  const activityBegin = useRecordingActivity((st) => st.begin);
  const activityEnd = useRecordingActivity((st) => st.end);

  const [isSupported] = useState(DualChunkedRecorder.isSupported());
  const [isRecording, setIsRecording] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [syncProgress, setSyncProgress] =
    useState<SyncProgress>(EMPTY_PROGRESS);
  const [incrementalSync, setIncrementalSync] = useState<IncrementalSyncStats>({
    saved: 0,
    failed: 0,
    total: 0,
  });
  const [localPersistError, setLocalPersistError] = useState<string | null>(
    null,
  );
  const [result, setResult] = useState<RecordingResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const teardownListeners = useCallback(() => {
    for (const unsub of unsubsRef.current) unsub();
    unsubsRef.current = [];
  }, []);

  const start = useCallback(
    async (stream: MediaStream, context: RecordingContext = {}) => {
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
        setSyncProgress(EMPTY_PROGRESS);
        setIncrementalSync({ saved: 0, failed: 0, total: 0 });
        setLocalPersistError(null);
        chunkCountsRef.current = { combined: 0, audio: 0, video: 0 };

        const recordingId = makeRecordingId();
        recordingIdRef.current = recordingId;

        // Best effort, once per recording: ask the browser to keep our data.
        void requestPersistentStorage();

        const rec = new DualChunkedRecorder();
        recorderRef.current = rec;

        const startedAtMs = Date.now();
        const fullContext: RecordingContext = {
          ...context,
          pubkey: context.pubkey ?? identity?._pubkey,
          displayName: context.displayName ?? identity?.displayName,
        };

        // Register the recording before the first slice can arrive, so a
        // crash at any later point leaves something to recover.
        await putInProgressRecording({
          recordingId,
          status: "recording",
          startedAtMs,
          startedAtPerfMs: startedAtMs,
          updatedAtMs: startedAtMs,
          hasVideo: stream.getVideoTracks().length > 0,
          mimeTypes: {},
          chunkCounts: { combined: 0, audio: 0, video: 0 },
          context: fullContext,
        }).catch((err) => {
          console.warn("Could not register in-progress recording", err);
        });

        const persistChunk = async (
          s: RecordingStream,
          index: number,
          blob: Blob,
        ) => {
          await appendRecordingChunk(recordingId, s, index, blob);
          chunkCountsRef.current[s] = Math.max(
            chunkCountsRef.current[s],
            index + 1,
          );
          void updateInProgressRecording(recordingId, {
            chunkCounts: { ...chunkCountsRef.current },
          }).catch(() => {
            // Bookkeeping only; the chunk itself is already stored.
          });
        };

        // The combined stream drives the visible "saved on this device" count.
        unsubsRef.current.push(
          rec.on((ev) => {
            if (ev.type === "chunk-captured") {
              setIncrementalSync((s) => ({
                ...s,
                total: Math.max(s.total, ev.index + 1),
              }));
            } else if (ev.type === "chunk-persisted") {
              setIncrementalSync((s) => ({ ...s, saved: s.saved + 1 }));
            } else if (ev.type === "chunk-persist-failed") {
              console.warn(
                "Could not save a recording slice locally",
                ev.error,
              );
              setIncrementalSync((s) => ({ ...s, failed: s.failed + 1 }));
              setLocalPersistError(
                "Part of this recording could not be saved on this device. Check free space; the recording continues.",
              );
            }
          }),
        );

        rec.start({ stream, timesliceMs: TIMESLICE_MS, persistChunk });

        // Record the real start and the containers in use.
        const startTime = rec.getStartTime();
        void updateInProgressRecording(recordingId, {
          startedAtMs: startTime.startedAtMs,
          startedAtPerfMs: startTime.startedAtPerfMs,
          mimeTypes: rec.getMimeTypes(),
        }).catch(() => {});

        // Express the start on the server's clock too, so tracks from
        // different devices can be lined up later. Non-blocking.
        serverOffsetRef.current = null;
        void measureServerOffset().then((offset) => {
          if (recordingIdRef.current !== recordingId) return;
          serverOffsetRef.current = offset;
          void updateInProgressRecording(recordingId, {
            serverOffsetMs: offset,
          }).catch(() => {});
        });

        activityBegin();
        setIsRecording(true);
      } catch (err) {
        console.error("Failed to start recording", err);
        setError(
          err instanceof Error ? err.message : "Failed to start recording",
        );
        teardownListeners();
        recorderRef.current = null;
        recordingIdRef.current = null;
      }
    },
    [isSupported, identity, teardownListeners, activityBegin],
  );

  const stop = useCallback(async (): Promise<RecordingResult | null> => {
    const rec = recorderRef.current;
    const recordingId = recordingIdRef.current;
    if (!rec || !recordingId) return null;
    setIsFinalizing(true);
    try {
      const dual = await rec.stop();
      setIsRecording(false);
      activityEnd();

      const r = await finalizeRecording({
        recordingId,
        identity,
        combined: { blob: dual.combinedBlob, mimeType: dual.combinedMimeType },
        audio: dual.audioBlob
          ? {
              blob: dual.audioBlob,
              mimeType: dual.audioMimeType ?? "audio/webm",
            }
          : null,
        video: dual.videoOnlyBlob
          ? {
              blob: dual.videoOnlyBlob,
              mimeType: dual.videoOnlyMimeType ?? "video/webm",
            }
          : null,
        hasVideo: dual.hasVideo,
        durationSeconds: dual.durationSeconds,
        startedAtMs: dual.startedAtMs,
        startedAtPerfMs: dual.startedAtPerfMs,
        serverOffsetMs: serverOffsetRef.current,
        combinedChunkCount: dual.combinedChunkCount,
        persistStats: dual.persistStats,
        onSync: (u) => {
          setSyncStatus(u.status);
          setSyncProgress(u.progress);
          setIsSyncing(u.syncing);
        },
      });
      if (r.localSaveError) setLocalPersistError(r.localSaveError);
      setResult(r);
      return r;
    } catch (err) {
      console.error("Failed to finalize recording", err);
      setError(
        err instanceof Error ? err.message : "Failed to finalize recording",
      );
      return null;
    } finally {
      setIsFinalizing(false);
      setIsSyncing(false);
      teardownListeners();
      recorderRef.current = null;
      recordingIdRef.current = null;
    }
  }, [identity, teardownListeners, activityEnd]);

  const reset = useCallback(() => {
    teardownListeners();
    recorderRef.current = null;
    recordingIdRef.current = null;
    chunkCountsRef.current = { combined: 0, audio: 0, video: 0 };
    setIsRecording(false);
    setIsFinalizing(false);
    setIsSyncing(false);
    setSyncStatus("idle");
    setSyncProgress(EMPTY_PROGRESS);
    setIncrementalSync({ saved: 0, failed: 0, total: 0 });
    setLocalPersistError(null);
    setResult(null);
    setError(null);
  }, [teardownListeners]);

  // While recording: warn before the page unloads, and push the buffered
  // slice to storage whenever the tab is hidden or about to go away.
  useEffect(() => {
    if (!isRecording) return undefined;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      recorderRef.current?.flush();
      e.preventDefault();
      // Legacy browsers need a string; modern ones show their own text.
      e.returnValue = "";
      return "";
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") recorderRef.current?.flush();
    };
    const onPageHide = () => recorderRef.current?.flush();
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [isRecording]);

  // Unmount mid-recording (in-app navigation): stop so the last slices land,
  // then mark the recording interrupted so it shows up for recovery.
  useEffect(() => {
    return () => {
      const rec = recorderRef.current;
      const recordingId = recordingIdRef.current;
      if (rec && recordingId && rec.getStatus() === "recording") {
        activityEnd();
        rec
          .stop()
          .catch(() => null)
          .finally(() => {
            void updateInProgressRecording(recordingId, {
              status: "interrupted",
            }).catch(() => {});
          });
      }
      teardownListeners();
    };
  }, [teardownListeners, activityEnd]);

  return {
    isSupported,
    isRecording,
    isFinalizing,
    isSyncing,
    syncProgress,
    syncStatus,
    incrementalSync,
    localPersistError,
    result,
    error,
    start,
    stop,
    reset,
  };
}
