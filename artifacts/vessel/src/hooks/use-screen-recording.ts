import { useCallback, useEffect, useRef, useState } from "react";
import { ChunkedRecorder } from "../lib/recorder";
import { BlossomUploadQueue, type SyncStatus } from "../lib/blossom";
import {
  appendRecordingChunk,
  buildLocalBlobUrl,
  discardInProgressRecording,
  putInProgressRecording,
  saveRecordingBlob,
  updateInProgressRecording,
  type InProgressContext,
} from "../lib/recordings-storage";
import { getStorageUrl } from "../lib/storage-config";
import { useIdentity } from "./use-identity";

/**
 * useScreenRecording — capture a participant's screen-share as a clean
 * separate per-participant track, alongside (and totally independent of)
 * the camera+mic recording produced by `useRecording`.
 *
 * This intentionally mirrors the simpler shape of a single-stream
 * `ChunkedRecorder` rather than the dual/triple recorder used for camera:
 * a screen capture is its own self-contained clip and we never want to
 * mix it with anything else. Slices are written to this device as they
 * are produced, so a screen recording survives a mid-call crash the same
 * way camera recordings do.
 *
 * Lifecycle invariants:
 *  - Failure of the screen recorder must never affect the camera/audio
 *    recorders or the live call. The caller treats this hook's result as
 *    purely additive.
 *  - The hook is idempotent: stop() called twice resolves to the same
 *    result; reset() clears state so a participant can share again later
 *    in the same session.
 */

export type ScreenRecordingMeta = {
  durationSeconds: number;
  sizeBytes: number;
  mimeType: string;
  chunkCount: number;
};

export type ScreenRecordingResult = {
  recordingId: string;
  blob: Blob;
  meta: ScreenRecordingMeta;
  blobHash: string;
  /** Canonical retrieval URL — remote when sync succeeded, falls back to
   *  `idb://<id>:screen` so local-only downloads still work. */
  blobUrl: string;
  localBlobUrl: string;
  remoteUrl: string | null;
  syncStatus: SyncStatus;
  /** Slices written to this device while the share was live, and slices
   *  that could not be written. Mirrors the camera recorder's stat. */
  incrementalSaved: number;
  incrementalFailed: number;
};

export type UseScreenRecordingResult = {
  isSupported: boolean;
  isRecording: boolean;
  isFinalizing: boolean;
  result: ScreenRecordingResult | null;
  error: string | null;
  start: (stream: MediaStream, context?: InProgressContext) => Promise<void>;
  stop: () => Promise<ScreenRecordingResult | null>;
  reset: () => void;
};

function makeRecordingId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `screenrec_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Derived IndexedDB key for the screen sibling. Same `<id>:<kind>`
 *  derivation pattern as the audio/video siblings so the vault download
 *  path can locate the local fallback without consulting any manifest. */
export function screenLocalKey(recordingId: string): string {
  return `${recordingId}:screen`;
}

export function screenLocalUrl(recordingId: string): string {
  return buildLocalBlobUrl(screenLocalKey(recordingId));
}

const SCREEN_MIME_PREFERENCES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

export function useScreenRecording(): UseScreenRecordingResult {
  const { identity } = useIdentity();
  const recorderRef = useRef<ChunkedRecorder | null>(null);
  const recordingIdRef = useRef<string | null>(null);
  const recorderUnsubRef = useRef<(() => void) | null>(null);

  const [isSupported] = useState(ChunkedRecorder.isSupported());
  const [isRecording, setIsRecording] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [result, setResult] = useState<ScreenRecordingResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const teardownListeners = useCallback(() => {
    recorderUnsubRef.current?.();
    recorderUnsubRef.current = null;
  }, []);

  const start = useCallback(
    async (stream: MediaStream, context: InProgressContext = {}) => {
      if (!isSupported) {
        setError("Screen recording is not supported in this browser.");
        return;
      }
      if (recorderRef.current) {
        // A previous share is still being held — refuse silently rather
        // than crashing the live call. Caller is expected to call stop()
        // before starting a new share.
        return;
      }
      try {
        setError(null);
        setResult(null);

        const rec = new ChunkedRecorder();
        recorderRef.current = rec;
        const recordingId = makeRecordingId();
        recordingIdRef.current = recordingId;

        const startedAtMs = Date.now();
        await putInProgressRecording({
          recordingId,
          status: "recording",
          startedAtMs,
          startedAtPerfMs: startedAtMs,
          updatedAtMs: startedAtMs,
          hasVideo: true,
          mimeTypes: {},
          chunkCounts: { combined: 0, audio: 0, video: 0 },
          context: {
            ...context,
            kind: "screen",
            pubkey: context.pubkey ?? identity?._pubkey,
            displayName: context.displayName ?? identity?.displayName,
          },
        }).catch((err) => {
          console.warn("Could not register in-progress screen recording", err);
        });

        let persisted = 0;
        recorderUnsubRef.current = rec.on((ev) => {
          if (ev.type === "chunk-persisted") {
            persisted += 1;
            void updateInProgressRecording(recordingId, {
              chunkCounts: { combined: persisted, audio: 0, video: 0 },
            }).catch(() => {});
          } else if (ev.type === "chunk-persist-failed") {
            console.warn("Could not save a screen recording slice locally", ev.error);
          }
        });

        rec.start({
          stream,
          timesliceMs: 3000,
          preferredMimeTypes: SCREEN_MIME_PREFERENCES,
          persistChunk: (index, blob) => appendRecordingChunk(recordingId, "combined", index, blob),
        });
        const startTime = rec.getStartTime();
        void updateInProgressRecording(recordingId, {
          startedAtMs: startTime.startedAtMs,
          startedAtPerfMs: startTime.startedAtPerfMs,
          mimeTypes: { combined: rec.getMimeType() || "video/webm" },
        }).catch(() => {});
        setIsRecording(true);
      } catch (err) {
        // Per the spec: a failed screen recorder must never abort the
        // live call. We surface the error in state, clean up local refs,
        // and let the caller carry on.
        console.error("Failed to start screen recording", err);
        setError(err instanceof Error ? err.message : "Failed to start screen recording");
        teardownListeners();
        recorderRef.current = null;
        recordingIdRef.current = null;
      }
    },
    [isSupported, identity, teardownListeners],
  );

  const stop = useCallback(async (): Promise<ScreenRecordingResult | null> => {
    const rec = recorderRef.current;
    const recordingId = recordingIdRef.current;
    if (!rec || !recordingId) return null;
    setIsFinalizing(true);
    try {
      const blob = await rec.stop();
      setIsRecording(false);
      const localBlobUrl = screenLocalUrl(recordingId);

      let savedLocally = false;
      try {
        await saveRecordingBlob(screenLocalKey(recordingId), blob);
        savedLocally = true;
      } catch (err) {
        console.warn("Failed to persist screen recording locally", err);
      }
      try {
        if (savedLocally) await discardInProgressRecording(recordingId);
        else await updateInProgressRecording(recordingId, { status: "interrupted" });
      } catch (err) {
        console.warn("Failed to update in-progress bookkeeping", err);
      }

      let syncStatus: SyncStatus = "partial-failure";
      let remoteUrl: string | null = null;
      let blobHash = "";
      if (identity) {
        try {
          const queue = new BlossomUploadQueue({
            serverUrl: getStorageUrl(identity._pubkey),
            signer: identity._signer,
          });
          const r = await queue.sync(blob);
          syncStatus = r.status;
          remoteUrl = r.remoteUrl;
          blobHash = r.hash;
        } catch (err) {
          console.warn("Screen-only sync failed; keeping local-only screen sibling.", err);
        }
      }

      const persistStats = rec.getPersistStats();

      const r: ScreenRecordingResult = {
        recordingId,
        blob,
        meta: {
          durationSeconds: rec.getDurationSeconds(),
          sizeBytes: blob.size,
          mimeType: blob.type || "video/webm",
          chunkCount: rec.getChunkCount(),
        },
        blobHash,
        blobUrl: remoteUrl ?? localBlobUrl,
        localBlobUrl,
        remoteUrl,
        syncStatus,
        incrementalSaved: persistStats.persisted,
        incrementalFailed: persistStats.failed,
      };
      setResult(r);
      return r;
    } catch (err) {
      console.error("Failed to finalize screen recording", err);
      setError(err instanceof Error ? err.message : "Failed to finalize screen recording");
      return null;
    } finally {
      setIsFinalizing(false);
      teardownListeners();
      recorderRef.current = null;
      recordingIdRef.current = null;
    }
  }, [identity, teardownListeners]);

  const reset = useCallback(() => {
    teardownListeners();
    recorderRef.current = null;
    recordingIdRef.current = null;
    setIsRecording(false);
    setIsFinalizing(false);
    setResult(null);
    setError(null);
  }, [teardownListeners]);

  useEffect(() => {
    return () => {
      const rec = recorderRef.current;
      const recordingId = recordingIdRef.current;
      if (rec && recordingId && rec.getStatus() === "recording") {
        rec
          .stop()
          .catch(() => null)
          .finally(() => {
            void updateInProgressRecording(recordingId, { status: "interrupted" }).catch(() => {});
          });
      }
      teardownListeners();
    };
  }, [teardownListeners]);

  return {
    isSupported,
    isRecording,
    isFinalizing,
    result,
    error,
    start,
    stop,
    reset,
  };
}
