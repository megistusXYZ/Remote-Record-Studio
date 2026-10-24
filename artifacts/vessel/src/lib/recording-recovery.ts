/**
 * Recovery of recordings that did not finish normally.
 *
 * Two situations are covered:
 * - The tab died or the person navigated away while recording: only the
 *   in-flight slices exist. They are reassembled into the finished files and
 *   run through the normal finalize path (local save, upload).
 * - The recording finished and was saved and uploaded, but the person left
 *   before it was registered (API row or published receipt). The saved
 *   files and the remembered upload outcome are reused as they are.
 *
 * Registration itself (the API call) needs React hooks and session context,
 * so it lives in the UI (`RecoveryPanel`); this module only produces a
 * `RecordingResult` and cleans up.
 */

import type { VesselIdentity } from "./identity";
import {
  audioOnlyLocalKey,
  audioOnlyLocalUrl,
  finalizeRecording,
  videoOnlyLocalKey,
  videoOnlyLocalUrl,
  type RecordingResult,
  type SyncUpdate,
} from "./recording-finalize";
import {
  assembleRecordingChunks,
  buildLocalBlobUrl,
  countRecordingChunks,
  deleteRecordingBlob,
  discardInProgressRecording,
  getInProgressRecording,
  listInProgressRecordings,
  loadRecordingBlob,
  type InProgressRecording,
} from "./recordings-storage";

/** A "recording" row untouched for this long belongs to a tab that is gone. */
export const STALE_RECORDING_MS = 20_000;

export function isRecoverable(
  row: InProgressRecording,
  nowMs: number = Date.now(),
): boolean {
  if (row.status === "interrupted" || row.status === "saved") return true;
  return (
    row.status === "recording" && nowMs - row.updatedAtMs > STALE_RECORDING_MS
  );
}

/** Rows worth offering to the person, newest first. */
export async function listRecoverableRecordings(
  nowMs: number = Date.now(),
): Promise<InProgressRecording[]> {
  const rows = await listInProgressRecordings();
  return rows.filter((row) => isRecoverable(row, nowMs));
}

/** Best-effort length of an interrupted recording, in whole seconds. */
export function estimateDurationSeconds(row: InProgressRecording): number {
  if (row.finalOutcome) return row.finalOutcome.durationSeconds;
  return Math.max(1, Math.round((row.updatedAtMs - row.startedAtMs) / 1000));
}

export type RecoveryOutcome = {
  result: RecordingResult;
  row: InProgressRecording;
  /** True when the files had to be rebuilt from slices (and were uploaded now). */
  rebuiltFromChunks: boolean;
};

async function recoverFromSavedFiles(
  row: InProgressRecording,
): Promise<RecoveryOutcome | null> {
  const outcome = row.finalOutcome;
  if (!outcome) return null;
  const combined = await loadRecordingBlob(row.recordingId);
  if (!combined) return null;
  const audioBlob = outcome.audio
    ? await loadRecordingBlob(audioOnlyLocalKey(row.recordingId))
    : null;
  const videoBlob = outcome.video
    ? await loadRecordingBlob(videoOnlyLocalKey(row.recordingId))
    : null;
  const localBlobUrl = buildLocalBlobUrl(row.recordingId);

  const result: RecordingResult = {
    recordingId: row.recordingId,
    blob: combined,
    meta: {
      durationSeconds: outcome.durationSeconds,
      sizeBytes: combined.size,
      mimeType: outcome.combined.mimeType,
      chunkCount: row.chunkCounts.combined,
      hasVideo: outcome.hasVideo,
    },
    blobHash: outcome.combined.hash,
    blobUrl: outcome.combined.remoteUrl ?? localBlobUrl,
    localBlobUrl,
    remoteUrl: outcome.combined.remoteUrl,
    syncStatus: outcome.combined.remoteUrl ? "complete" : "partial-failure",
    audio:
      outcome.audio && audioBlob
        ? {
            blob: audioBlob,
            blobHash: outcome.audio.hash,
            blobUrl:
              outcome.audio.remoteUrl ?? audioOnlyLocalUrl(row.recordingId),
            localBlobUrl: audioOnlyLocalUrl(row.recordingId),
            remoteUrl: outcome.audio.remoteUrl,
            syncStatus: outcome.audio.remoteUrl
              ? "complete"
              : "partial-failure",
            sizeBytes: audioBlob.size,
            mimeType: outcome.audio.mimeType,
          }
        : null,
    video:
      outcome.video && videoBlob
        ? {
            blob: videoBlob,
            blobHash: outcome.video.hash,
            blobUrl:
              outcome.video.remoteUrl ?? videoOnlyLocalUrl(row.recordingId),
            localBlobUrl: videoOnlyLocalUrl(row.recordingId),
            remoteUrl: outcome.video.remoteUrl,
            syncStatus: outcome.video.remoteUrl
              ? "complete"
              : "partial-failure",
            sizeBytes: videoBlob.size,
            mimeType: outcome.video.mimeType,
          }
        : null,
    startedAtMs: row.startedAtMs,
    startedAtPerfMs: row.startedAtPerfMs,
    serverOffsetMs: row.serverOffsetMs ?? null,
    persistedLocally: true,
    localSaveError: null,
    incrementalSaved:
      row.chunkCounts.combined + row.chunkCounts.audio + row.chunkCounts.video,
    incrementalFailed: 0,
  };
  return { result, row, rebuiltFromChunks: false };
}

async function recoverFromChunks(
  row: InProgressRecording,
  identity: VesselIdentity | null,
  onSync?: (update: SyncUpdate) => void,
): Promise<RecoveryOutcome | null> {
  const mimeTypes = {
    combined:
      row.mimeTypes.combined ?? (row.hasVideo ? "video/webm" : "audio/webm"),
    audio: row.mimeTypes.audio ?? "audio/webm",
    video: row.mimeTypes.video ?? "video/webm",
  };
  const combined = await assembleRecordingChunks(
    row.recordingId,
    "combined",
    mimeTypes.combined,
  );
  if (!combined) return null;
  const audio = await assembleRecordingChunks(
    row.recordingId,
    "audio",
    mimeTypes.audio,
  );
  const video = await assembleRecordingChunks(
    row.recordingId,
    "video",
    mimeTypes.video,
  );
  const counts = await countRecordingChunks(row.recordingId);
  const persisted = counts.combined + counts.audio + counts.video;

  const result = await finalizeRecording({
    recordingId: row.recordingId,
    identity,
    combined: { blob: combined, mimeType: mimeTypes.combined },
    audio: audio ? { blob: audio, mimeType: mimeTypes.audio } : null,
    video: video ? { blob: video, mimeType: mimeTypes.video } : null,
    hasVideo: row.hasVideo,
    durationSeconds: estimateDurationSeconds(row),
    startedAtMs: row.startedAtMs,
    startedAtPerfMs: row.startedAtPerfMs,
    serverOffsetMs: row.serverOffsetMs ?? null,
    combinedChunkCount: counts.combined,
    persistStats: { captured: persisted, persisted, failed: 0 },
    onSync,
  });
  return { result, row, rebuiltFromChunks: true };
}

/**
 * Produce a `RecordingResult` for an unfinished recording. Returns null when
 * nothing usable is stored (no slices and no saved file). Never throws for
 * storage or network trouble; the result says what succeeded.
 */
export async function recoverRecording(
  staleRow: InProgressRecording,
  identity: VesselIdentity | null,
  onSync?: (update: SyncUpdate) => void,
): Promise<RecoveryOutcome | null> {
  // The UI may hold a row from before the last write; always act on the
  // stored one.
  const row = (await getInProgressRecording(staleRow.recordingId)) ?? staleRow;
  if (row.status === "saved") {
    const fromSaved = await recoverFromSavedFiles(row);
    if (fromSaved) return fromSaved;
  }
  return recoverFromChunks(row, identity, onSync);
}

/** The person chose to throw the recording away: slices, saved files and bookkeeping. */
export async function discardRecoverableRecording(
  recordingId: string,
): Promise<void> {
  await discardInProgressRecording(recordingId);
  for (const key of [
    recordingId,
    audioOnlyLocalKey(recordingId),
    videoOnlyLocalKey(recordingId),
  ]) {
    try {
      await deleteRecordingBlob(key);
    } catch {
      // Best effort.
    }
  }
}
