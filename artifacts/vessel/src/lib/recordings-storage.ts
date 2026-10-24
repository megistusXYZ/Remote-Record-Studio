/**
 * Local recording storage (IndexedDB).
 *
 * Two layers:
 *
 * 1. `blobs`: one finished file per key (`<recordingId>`, `<recordingId>:audio`,
 *    `<recordingId>:video`). This is what the Vault and downloads read.
 * 2. `chunks` + `inProgress`: the durability net. While a recording runs, every
 *    slice the recorder produces is appended here within milliseconds, and a
 *    small metadata row describes the recording in flight. A reload, crash or
 *    navigation mid-recording therefore loses at most one slice, and the
 *    recording can be rebuilt from its chunks afterwards (see
 *    `recording-recovery.ts`). When a recording finishes normally and its
 *    final blobs are saved, its chunks and metadata are removed.
 */

const DB_NAME = "vessel_recordings";
const DB_VERSION = 2;
const STORE_BLOBS = "blobs";
const STORE_CHUNKS = "chunks";
const STORE_IN_PROGRESS = "inProgress";
const CHUNKS_BY_RECORDING = "byRecording";

export type RecordingStream = "combined" | "audio" | "video";

export const RECORDING_STREAMS: readonly RecordingStream[] = [
  "combined",
  "audio",
  "video",
];

/**
 * recording:   slices are being written; a stale `updatedAtMs` means the tab died.
 * interrupted: the recorder stopped without a normal finish (navigation, failed save).
 * saved:       the finished files are in `blobs`, but the recording has not been
 *              registered with the API yet (the user left before that happened).
 */
export type InProgressStatus = "recording" | "interrupted" | "saved";

export type InProgressContext = {
  /** Camera+mic recording (default) or a screen-share clip. */
  kind?: "camera" | "screen";
  sessionId?: string;
  sessionTitle?: string;
  role?: "host" | "guest" | "solo";
  pubkey?: string;
  displayName?: string;
};

export type InProgressRecording = {
  recordingId: string;
  status: InProgressStatus;
  /** Wall-clock start, ms since epoch, on this device. */
  startedAtMs: number;
  /** `performance.timeOrigin + performance.now()` at start, for sub-second alignment within this device. */
  startedAtPerfMs: number;
  /** Last time a chunk or status change was written. */
  updatedAtMs: number;
  hasVideo: boolean;
  mimeTypes: Partial<Record<RecordingStream, string>>;
  chunkCounts: Record<RecordingStream, number>;
  context: InProgressContext;
  /** Server clock minus this device's clock at start, ms. Null when unknown. */
  serverOffsetMs?: number | null;
  /** Set once the finished files were saved and uploaded; lets recovery skip both. */
  finalOutcome?: FinalOutcome;
};

export type FinalOutcomeStream = {
  mimeType: string;
  sizeBytes: number;
  hash: string;
  remoteUrl: string | null;
};

export type FinalOutcome = {
  durationSeconds: number;
  hasVideo: boolean;
  combined: FinalOutcomeStream;
  audio: FinalOutcomeStream | null;
  video: FinalOutcomeStream | null;
};

type ChunkRow = {
  key: string;
  recordingId: string;
  stream: RecordingStream;
  index: number;
  blob: Blob;
  sizeBytes: number;
  createdAtMs: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS);
      }
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        const chunks = db.createObjectStore(STORE_CHUNKS, { keyPath: "key" });
        chunks.createIndex(CHUNKS_BY_RECORDING, "recordingId", {
          unique: false,
        });
      }
      if (!db.objectStoreNames.contains(STORE_IN_PROGRESS)) {
        db.createObjectStore(STORE_IN_PROGRESS, { keyPath: "recordingId" });
      }
    };
  });
}

/** Run one request inside its own transaction and close the connection after. */
async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = run(tx.objectStore(storeName));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
    tx.oncomplete = () => db.close();
  });
}

// ---------------------------------------------------------------------------
// Finished blobs
// ---------------------------------------------------------------------------

export async function saveRecordingBlob(
  recordingId: string,
  blob: Blob,
): Promise<void> {
  await withStore(STORE_BLOBS, "readwrite", (s) => s.put(blob, recordingId));
}

export async function loadRecordingBlob(
  recordingId: string,
): Promise<Blob | null> {
  const result = await withStore<Blob | undefined>(
    STORE_BLOBS,
    "readonly",
    (s) => s.get(recordingId),
  );
  return result ?? null;
}

export async function deleteRecordingBlob(recordingId: string): Promise<void> {
  await withStore(STORE_BLOBS, "readwrite", (s) => s.delete(recordingId));
}

/** Removes finished blobs, in-flight chunks and in-progress metadata alike. */
export async function clearAllLocalRecordings(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(
      [STORE_BLOBS, STORE_CHUNKS, STORE_IN_PROGRESS],
      "readwrite",
    );
    tx.objectStore(STORE_BLOBS).clear();
    tx.objectStore(STORE_CHUNKS).clear();
    tx.objectStore(STORE_IN_PROGRESS).clear();
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
  });
}

// ---------------------------------------------------------------------------
// In-flight chunks
// ---------------------------------------------------------------------------

function chunkKey(
  recordingId: string,
  stream: RecordingStream,
  index: number,
): string {
  // Zero-padded so lexical key order equals chunk order within a stream.
  return `${recordingId}|${stream}|${String(index).padStart(8, "0")}`;
}

function streamKeyRange(
  recordingId: string,
  stream: RecordingStream,
): IDBKeyRange {
  const prefix = `${recordingId}|${stream}|`;
  return IDBKeyRange.bound(prefix, `${prefix}￿`);
}

/** Append one recorder slice. Safe to call out of order; reads sort by index. */
export async function appendRecordingChunk(
  recordingId: string,
  stream: RecordingStream,
  index: number,
  blob: Blob,
): Promise<void> {
  const row: ChunkRow = {
    key: chunkKey(recordingId, stream, index),
    recordingId,
    stream,
    index,
    blob,
    sizeBytes: blob.size,
    createdAtMs: Date.now(),
  };
  await withStore(STORE_CHUNKS, "readwrite", (s) => s.put(row));
}

/** All slices of one stream, in index order. */
export async function loadRecordingChunks(
  recordingId: string,
  stream: RecordingStream,
): Promise<Blob[]> {
  const rows = await withStore<ChunkRow[]>(STORE_CHUNKS, "readonly", (s) =>
    s.getAll(streamKeyRange(recordingId, stream)),
  );
  rows.sort((a, b) => a.index - b.index);
  return rows.map((r) => r.blob);
}

/** Number of stored slices per stream for a recording. */
export async function countRecordingChunks(
  recordingId: string,
): Promise<Record<RecordingStream, number>> {
  const counts: Record<RecordingStream, number> = {
    combined: 0,
    audio: 0,
    video: 0,
  };
  for (const stream of RECORDING_STREAMS) {
    counts[stream] = await withStore<number>(STORE_CHUNKS, "readonly", (s) =>
      s.count(streamKeyRange(recordingId, stream)),
    );
  }
  return counts;
}

/**
 * Rebuild one stream's file from its slices. Returns null when no slices
 * exist. The result references the stored slices rather than copying them,
 * so this is cheap even for long recordings.
 */
export async function assembleRecordingChunks(
  recordingId: string,
  stream: RecordingStream,
  mimeType: string,
): Promise<Blob | null> {
  const parts = await loadRecordingChunks(recordingId, stream);
  if (parts.length === 0) return null;
  return new Blob(parts, { type: mimeType });
}

/** Remove every slice of a recording, across all streams. */
export async function deleteRecordingChunks(
  recordingId: string,
): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_CHUNKS, "readwrite");
    const index = tx.objectStore(STORE_CHUNKS).index(CHUNKS_BY_RECORDING);
    const cursorReq = index.openKeyCursor(IDBKeyRange.only(recordingId));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      tx.objectStore(STORE_CHUNKS).delete(cursor.primaryKey);
      cursor.continue();
    };
    cursorReq.onerror = () => reject(cursorReq.error);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
  });
}

// ---------------------------------------------------------------------------
// In-progress metadata
// ---------------------------------------------------------------------------

export async function putInProgressRecording(
  meta: InProgressRecording,
): Promise<void> {
  await withStore(STORE_IN_PROGRESS, "readwrite", (s) => s.put(meta));
}

export async function getInProgressRecording(
  recordingId: string,
): Promise<InProgressRecording | null> {
  const row = await withStore<InProgressRecording | undefined>(
    STORE_IN_PROGRESS,
    "readonly",
    (s) => s.get(recordingId),
  );
  return row ?? null;
}

/** Every recording that started but never finished, newest first. */
export async function listInProgressRecordings(): Promise<
  InProgressRecording[]
> {
  const rows = await withStore<InProgressRecording[]>(
    STORE_IN_PROGRESS,
    "readonly",
    (s) => s.getAll(),
  );
  return rows.sort((a, b) => b.startedAtMs - a.startedAtMs);
}

export async function deleteInProgressRecording(
  recordingId: string,
): Promise<void> {
  await withStore(STORE_IN_PROGRESS, "readwrite", (s) => s.delete(recordingId));
}

/** Patch a few fields of an in-progress row without rewriting the rest. */
export async function updateInProgressRecording(
  recordingId: string,
  patch: Partial<Omit<InProgressRecording, "recordingId">>,
): Promise<void> {
  const current = await getInProgressRecording(recordingId);
  if (!current) return;
  await putInProgressRecording({
    ...current,
    ...patch,
    recordingId,
    updatedAtMs: Date.now(),
  });
}

/** Drop both the chunks and the metadata of a recording that is now finished or discarded. */
export async function discardInProgressRecording(
  recordingId: string,
): Promise<void> {
  await deleteRecordingChunks(recordingId);
  await deleteInProgressRecording(recordingId);
}

// ---------------------------------------------------------------------------
// Browser storage durability
// ---------------------------------------------------------------------------

/**
 * Ask the browser not to evict this origin's storage under pressure. Chrome
 * grants it silently for installed or engaged sites; Safari evicts
 * unpersisted data after a week without visits. Returns the final state.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const storage =
      typeof navigator !== "undefined" ? navigator.storage : undefined;
    if (!storage?.persist) return false;
    if (storage.persisted && (await storage.persisted())) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}

export async function estimateStorage(): Promise<{
  usageBytes: number;
  quotaBytes: number;
} | null> {
  try {
    const storage =
      typeof navigator !== "undefined" ? navigator.storage : undefined;
    if (!storage?.estimate) return null;
    const { usage = 0, quota = 0 } = await storage.estimate();
    return { usageBytes: usage, quotaBytes: quota };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Downloads and local URLs
// ---------------------------------------------------------------------------

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadRecordingById(
  recordingId: string,
  filename: string,
): Promise<boolean> {
  const blob = await loadRecordingBlob(recordingId);
  if (!blob) return false;
  downloadBlob(blob, filename);
  return true;
}

export function buildLocalBlobUrl(recordingId: string): string {
  return `idb://${recordingId}`;
}

export function isLocalBlobUrl(url: string | null | undefined): boolean {
  return !!url && url.startsWith("idb://");
}

export function extractRecordingIdFromLocalUrl(url: string): string | null {
  if (!isLocalBlobUrl(url)) return null;
  return url.replace(/^idb:\/\//, "");
}
