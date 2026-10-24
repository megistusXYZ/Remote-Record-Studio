/**
 * Turns finished recorder streams into a `RecordingResult`: saves the final
 * files locally, releases the in-flight chunks once that succeeded, uploads
 * to the storage server, and reports progress. The in-progress row survives
 * as "saved" until the caller has registered the recording (API row or
 * published receipt) and calls `markRecordingRegistered`, so a user who
 * leaves early still finds the recording under "Recover". Shared by the live recording
 * hook (`useRecording.stop`) and by recovery of an interrupted recording, so
 * both paths produce identical results.
 */

import {
  BlossomUploadQueue,
  type SyncProgress,
  type SyncStatus,
} from "./blossom";
import type { VesselIdentity } from "./identity";
import type { PersistStats } from "./recorder";
import {
  buildLocalBlobUrl,
  deleteRecordingChunks,
  discardInProgressRecording,
  saveRecordingBlob,
  updateInProgressRecording,
  type FinalOutcome,
} from "./recordings-storage";
import { getStorageUrl } from "./storage-config";

export type RecordingMeta = {
  durationSeconds: number;
  sizeBytes: number;
  mimeType: string;
  chunkCount: number;
  hasVideo: boolean;
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
   *  failed. */
  video: StreamBlob | null;
  /** Wall-clock start on the recording device, ms since epoch. */
  startedAtMs: number;
  /** High-resolution start on the recording device. */
  startedAtPerfMs: number;
  /** Server clock minus this device's clock at start, ms. Null when it could not be measured. */
  serverOffsetMs: number | null;
  /** True when the finished combined file was written to this device's storage. */
  persistedLocally: boolean;
  /** Set when a local write failed (usually quota); the remote copy may still exist. */
  localSaveError: string | null;
  /** Slices written to this device while recording (combined stream and siblings). */
  incrementalSaved: number;
  /** Slices that could not be written locally while recording. */
  incrementalFailed: number;
};

export type StreamInput = { blob: Blob; mimeType: string };

export type SyncUpdate = {
  status: SyncStatus;
  progress: SyncProgress;
  syncing: boolean;
};

export type FinalizeInput = {
  recordingId: string;
  identity: VesselIdentity | null;
  combined: StreamInput;
  audio: StreamInput | null;
  video: StreamInput | null;
  hasVideo: boolean;
  durationSeconds: number;
  startedAtMs: number;
  startedAtPerfMs: number;
  serverOffsetMs: number | null;
  combinedChunkCount: number;
  persistStats: PersistStats;
  /** Live progress of the combined upload; drives the saving UI. */
  onSync?: (update: SyncUpdate) => void;
};

type SyncOutcome = {
  status: SyncStatus;
  remoteUrl: string | null;
  hash: string;
};

const FAILED_SYNC: SyncOutcome = {
  status: "partial-failure",
  remoteUrl: null,
  hash: "",
};

/** Audio-only sibling blobs are persisted under a derived key so the same
 *  recording id maps to BOTH the combined blob (`<id>`) and the audio-only
 *  blob (`<id>:audio`). */
export function audioOnlyLocalKey(recordingId: string): string {
  return `${recordingId}:audio`;
}

export function videoOnlyLocalKey(recordingId: string): string {
  return `${recordingId}:video`;
}

export function audioOnlyLocalUrl(recordingId: string): string {
  return buildLocalBlobUrl(audioOnlyLocalKey(recordingId));
}

export function videoOnlyLocalUrl(recordingId: string): string {
  return buildLocalBlobUrl(videoOnlyLocalKey(recordingId));
}

function describeStorageError(err: unknown): string {
  const name =
    err instanceof DOMException || err instanceof Error ? err.name : "";
  if (name === "QuotaExceededError") {
    return "This device is out of storage space, so the recording could not be kept here.";
  }
  return "This device could not keep a copy of the recording.";
}

async function syncWithQueue(
  queue: BlossomUploadQueue | null,
  blob: Blob,
  onSync?: (update: SyncUpdate) => void,
): Promise<SyncOutcome> {
  if (!queue) {
    onSync?.({
      status: "partial-failure",
      progress: { synced: 0, total: 1, percent: 0, failed: 1 },
      syncing: false,
    });
    return FAILED_SYNC;
  }
  const unsub = onSync
    ? queue.on((ev) => {
        if (ev.type === "sync-started") {
          onSync({
            status: "syncing",
            progress: { synced: 0, total: ev.total, percent: 0, failed: 0 },
            syncing: true,
          });
        } else if (
          ev.type === "chunk-synced" ||
          ev.type === "chunk-sync-failed"
        ) {
          onSync({ status: "syncing", progress: ev.progress, syncing: true });
        } else if (ev.type === "sync-complete") {
          onSync({ status: ev.status, progress: ev.progress, syncing: false });
        }
      })
    : null;
  try {
    return await queue.sync(blob);
  } catch (err) {
    console.error("Upload to storage failed", err);
    onSync?.({
      status: "partial-failure",
      progress: { synced: 0, total: 1, percent: 0, failed: 1 },
      syncing: false,
    });
    return FAILED_SYNC;
  } finally {
    unsub?.();
  }
}

function makeQueue(identity: VesselIdentity | null): BlossomUploadQueue | null {
  if (!identity) return null;
  return new BlossomUploadQueue({
    serverUrl: getStorageUrl(identity._pubkey),
    signer: identity._signer,
  });
}

/**
 * Save locally, release chunks, upload, and describe the result. Never
 * throws for storage or network trouble: the result says what succeeded.
 */
export async function finalizeRecording(
  input: FinalizeInput,
): Promise<RecordingResult> {
  const { recordingId, identity, combined, audio, video } = input;
  const localBlobUrl = buildLocalBlobUrl(recordingId);
  const audioLocalBlobUrl = audio ? audioOnlyLocalUrl(recordingId) : "";
  const videoLocalBlobUrl = video ? videoOnlyLocalUrl(recordingId) : "";

  // 1. Finished files to local storage. The combined file is what the Vault
  //    needs; siblings are best-effort.
  let persistedLocally = false;
  let localSaveError: string | null = null;
  try {
    await saveRecordingBlob(recordingId, combined.blob);
    persistedLocally = true;
  } catch (err) {
    console.warn("Failed to persist recording locally", err);
    localSaveError = describeStorageError(err);
  }
  if (audio) {
    try {
      await saveRecordingBlob(audioOnlyLocalKey(recordingId), audio.blob);
    } catch (err) {
      console.warn("Failed to persist audio-only sibling locally", err);
      localSaveError ??= describeStorageError(err);
    }
  }
  if (video) {
    try {
      await saveRecordingBlob(videoOnlyLocalKey(recordingId), video.blob);
    } catch (err) {
      console.warn("Failed to persist video-only sibling locally", err);
      localSaveError ??= describeStorageError(err);
    }
  }

  // 2. The in-flight chunks are only needed until the finished file exists.
  //    If that write failed, keep them and flag the recording as recoverable.
  try {
    if (persistedLocally) {
      await deleteRecordingChunks(recordingId);
    } else {
      await updateInProgressRecording(recordingId, { status: "interrupted" });
    }
  } catch (err) {
    console.warn("Failed to update in-progress bookkeeping", err);
  }

  // 3. Upload. The combined stream drives the visible progress; siblings
  //    upload quietly afterwards.
  const combinedSync = await syncWithQueue(
    makeQueue(identity),
    combined.blob,
    input.onSync,
  );

  let audioStream: StreamBlob | null = null;
  if (audio) {
    const s = await syncWithQueue(makeQueue(identity), audio.blob);
    audioStream = {
      blob: audio.blob,
      blobHash: s.hash,
      blobUrl: s.remoteUrl ?? audioLocalBlobUrl,
      localBlobUrl: audioLocalBlobUrl,
      remoteUrl: s.remoteUrl,
      syncStatus: s.status,
      sizeBytes: audio.blob.size,
      mimeType: audio.mimeType,
    };
  }

  let videoStream: StreamBlob | null = null;
  if (video) {
    const s = await syncWithQueue(makeQueue(identity), video.blob);
    videoStream = {
      blob: video.blob,
      blobHash: s.hash,
      blobUrl: s.remoteUrl ?? videoLocalBlobUrl,
      localBlobUrl: videoLocalBlobUrl,
      remoteUrl: s.remoteUrl,
      syncStatus: s.status,
      sizeBytes: video.blob.size,
      mimeType: video.mimeType,
    };
  }

  // 4. Remember what happened so recovery never has to upload twice. The row
  //    is removed by `markRecordingRegistered` once the caller has recorded
  //    the recording where it will be found again.
  if (persistedLocally) {
    const finalOutcome: FinalOutcome = {
      durationSeconds: input.durationSeconds,
      hasVideo: input.hasVideo,
      combined: {
        mimeType: combined.mimeType,
        sizeBytes: combined.blob.size,
        hash: combinedSync.hash,
        remoteUrl: combinedSync.remoteUrl,
      },
      audio: audioStream
        ? {
            mimeType: audioStream.mimeType,
            sizeBytes: audioStream.sizeBytes,
            hash: audioStream.blobHash,
            remoteUrl: audioStream.remoteUrl,
          }
        : null,
      video: videoStream
        ? {
            mimeType: videoStream.mimeType,
            sizeBytes: videoStream.sizeBytes,
            hash: videoStream.blobHash,
            remoteUrl: videoStream.remoteUrl,
          }
        : null,
    };
    await updateInProgressRecording(recordingId, {
      status: "saved",
      finalOutcome,
    }).catch((err) => {
      console.warn("Failed to record finalize outcome", err);
    });
  }

  return {
    recordingId,
    blob: combined.blob,
    meta: {
      durationSeconds: input.durationSeconds,
      sizeBytes: combined.blob.size,
      mimeType: combined.mimeType,
      chunkCount: input.combinedChunkCount,
      hasVideo: input.hasVideo,
    },
    blobHash: combinedSync.hash,
    blobUrl: combinedSync.remoteUrl ?? localBlobUrl,
    localBlobUrl,
    remoteUrl: combinedSync.remoteUrl,
    syncStatus: combinedSync.status,
    audio: audioStream,
    video: videoStream,
    startedAtMs: input.startedAtMs,
    startedAtPerfMs: input.startedAtPerfMs,
    serverOffsetMs: input.serverOffsetMs,
    persistedLocally,
    localSaveError,
    incrementalSaved: input.persistStats.persisted,
    incrementalFailed: input.persistStats.failed,
  };
}

/**
 * The recording now exists where the user will find it again (an API row, a
 * published receipt). Drop the recovery bookkeeping for it.
 */
export async function markRecordingRegistered(
  recordingId: string,
): Promise<void> {
  try {
    await discardInProgressRecording(recordingId);
  } catch (err) {
    console.warn("Failed to clear recovery bookkeeping", err);
  }
}
