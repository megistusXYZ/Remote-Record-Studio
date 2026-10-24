import { Zip, ZipPassThrough } from "fflate";
import {
  loadRecordingBlob,
  buildLocalBlobUrl,
  isLocalBlobUrl,
  extractRecordingIdFromLocalUrl,
} from "./recordings-storage";
import {
  audioOnlyLocalKey,
  audioOnlyLocalUrl,
  videoOnlyLocalKey,
  videoOnlyLocalUrl,
} from "../hooks/use-recording";
import { screenLocalKey } from "../hooks/use-screen-recording";

/**
 * Per-participant export descriptor used by the SessionComplete and Vault
 * "Download selected" flows. Carries URLs and optional in-memory blobs for
 * each of the three streams: combined V+A, audio-only, video-only.
 */
export type TrackExportSource = {
  participantName: string;
  /** Combined V+A blob URL (idb:// or https://). May be null when sync failed
   *  on every channel — `combinedBlob` is the in-memory fallback. */
  combinedBlobUrl: string | null;
  combinedMimeType: string;
  combinedBlob?: Blob | null;
  /** Audio-only sibling URL (idb:// or https://). Null when no audio sibling. */
  audioBlobUrl?: string | null;
  audioMimeType?: string | null;
  audioBlob?: Blob | null;
  /** Video-only sibling. `videoOnlyBlob` / `videoOnlyLocalUrl` cover the
   *  local participant; `videoOnlyRemoteUrl` covers cross-device recipients
   *  reading from a manifest. All three may be null if no true video-only
   *  sibling exists — exports MUST then refuse, never fall back to V+A. */
  videoOnlyBlob?: Blob | null;
  videoOnlyLocalUrl?: string | null;
  videoOnlyRemoteUrl?: string | null;
  videoOnlyMimeType?: string | null;
  /** Optional screen-share sibling. `screenBlob` / `screenLocalUrl` cover
   *  the local participant who recorded their own screen capture during
   *  the call; `screenRemoteUrl` covers cross-device recipients reading
   *  from a manifest. Three slots mirror the audio/video sibling shape so
   *  the same resolver handles all three "true sibling, never fall back"
   *  semantics. Null when the participant never shared. */
  screenBlob?: Blob | null;
  screenLocalUrl?: string | null;
  screenRemoteUrl?: string | null;
  screenMimeType?: string | null;
  /** Length of the combined track, when known. Written to the bundle's `tracks.json`. */
  durationSeconds?: number | null;
  /** When the combined track started, ms since epoch on the recording device. */
  startedAtMs?: number | null;
  /** Server clock minus the recording device's clock at start, ms. */
  serverOffsetMs?: number | null;
};

export type TrackStreamKind =
  | "video+audio"
  | "video-only"
  | "audio-only"
  | "screen-only";

export type TrackSelection = {
  source: TrackExportSource;
  /** `audio-only` requires a resolvable audio sibling; `video-only` requires
   *  a resolvable true video-only sibling — neither falls back to V+A. */
  stream: TrackStreamKind;
};

/** True when this source can produce a true audio-only download. */
export function hasAudioOnlyExport(source: TrackExportSource): boolean {
  return !!(source.audioBlob || source.audioBlobUrl);
}

/** True when this source can produce a true video-only download (no audio
 *  bytes). The export helpers refuse to fall back to V+A. */
export function hasVideoOnlyExport(source: TrackExportSource): boolean {
  return !!(
    source.videoOnlyBlob ||
    source.videoOnlyLocalUrl ||
    source.videoOnlyRemoteUrl
  );
}

/** True when this source can produce a screen-share download. Mirrors the
 *  audio/video helpers — the resolver refuses to fall back to camera or
 *  audio when the screen sibling isn't present. */
export function hasScreenExport(source: TrackExportSource): boolean {
  return !!(
    source.screenBlob ||
    source.screenLocalUrl ||
    source.screenRemoteUrl
  );
}

function safeFilenameSegment(input: string): string {
  return (
    input.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") ||
    "participant"
  );
}

function extensionFromMime(
  mimeType: string | null | undefined,
  fallback: string,
): string {
  if (!mimeType) return fallback;
  const lc = mimeType.toLowerCase();
  if (lc.includes("webm")) return "webm";
  if (lc.includes("mp4")) return "mp4";
  if (lc.includes("ogg")) return "ogg";
  if (lc.includes("mpeg") || lc.includes("mp3")) return "mp3";
  if (lc.includes("wav")) return "wav";
  return fallback;
}

/** What the export should append to a participant filename for a given
 *  stream choice — `…-video-audio.webm` vs `…-audio.webm`. */
export function buildExportFilename(
  participantName: string,
  stream: TrackStreamKind,
  mimeType: string | null | undefined,
): string {
  const safe = safeFilenameSegment(participantName);
  if (stream === "audio-only") {
    return `${safe}-audio.${extensionFromMime(mimeType, "webm")}`;
  }
  if (stream === "video-only") {
    // True video-only: the file is a real video container with NO audio
    // bytes (recorded by a third MediaRecorder fed only the camera tracks).
    // `resolveStreamBlob` refuses to fall back to V+A when no sibling
    // exists; the caller surfaces a "skipped" entry in that case.
    return `${safe}-video.${extensionFromMime(mimeType, "webm")}`;
  }
  if (stream === "screen-only") {
    // Screen-share file. May or may not contain system-audio bytes
    // depending on whether the user opted into "share tab audio" at
    // capture time — kept as one self-contained file either way so the
    // recipient gets exactly what was broadcast.
    return `${safe}-screen.${extensionFromMime(mimeType, "webm")}`;
  }
  return `${safe}-video-audio.${extensionFromMime(mimeType, "webm")}`;
}

/** Resolve a single stream choice to a Blob. Returns null when the requested
 *  true sibling can't be produced — callers must surface a "skipped" entry
 *  instead of falling back to a different stream type. */
export async function resolveStreamBlob(
  selection: TrackSelection,
): Promise<Blob | null> {
  const { source, stream } = selection;
  if (stream === "audio-only") {
    if (source.audioBlob) return source.audioBlob;
    const idbBlob = await loadAudioFallback(source);
    if (idbBlob) return idbBlob;
    if (source.audioBlobUrl && !isLocalBlobUrl(source.audioBlobUrl)) {
      return fetchRemoteBlob(source.audioBlobUrl);
    }
    return null;
  }
  if (stream === "video-only") {
    if (source.videoOnlyBlob) return source.videoOnlyBlob;
    const idbVideo = await loadVideoOnlyFallback(source);
    if (idbVideo) return idbVideo;
    if (
      source.videoOnlyRemoteUrl &&
      !isLocalBlobUrl(source.videoOnlyRemoteUrl)
    ) {
      return fetchRemoteBlob(source.videoOnlyRemoteUrl);
    }
    return null;
  }
  if (stream === "screen-only") {
    if (source.screenBlob) return source.screenBlob;
    const idbScreen = await loadScreenFallback(source);
    if (idbScreen) return idbScreen;
    if (source.screenRemoteUrl && !isLocalBlobUrl(source.screenRemoteUrl)) {
      return fetchRemoteBlob(source.screenRemoteUrl);
    }
    return null;
  }
  return resolveCombinedBlob(source);
}

async function loadScreenFallback(
  source: TrackExportSource,
): Promise<Blob | null> {
  // Screen sibling is keyed by `<recordingId>:screen`. Same derivation as
  // the audio/video siblings — try the explicit `screenLocalUrl` first,
  // then fall back to deriving the key from the combined URL when the
  // explicit slot is empty (older flow that only stored the combined URL).
  if (source.screenLocalUrl && isLocalBlobUrl(source.screenLocalUrl)) {
    const key = extractRecordingIdFromLocalUrl(source.screenLocalUrl);
    if (key) {
      const blob = await loadRecordingBlob(key);
      if (blob) return blob;
    }
  }
  if (source.combinedBlobUrl && isLocalBlobUrl(source.combinedBlobUrl)) {
    const id = extractRecordingIdFromLocalUrl(source.combinedBlobUrl);
    if (id) {
      const blob = await loadRecordingBlob(screenLocalKey(id));
      if (blob) return blob;
    }
  }
  return null;
}

async function resolveCombinedBlob(
  source: TrackExportSource,
): Promise<Blob | null> {
  if (source.combinedBlob) return source.combinedBlob;
  if (source.combinedBlobUrl) {
    if (isLocalBlobUrl(source.combinedBlobUrl)) {
      const id = extractRecordingIdFromLocalUrl(source.combinedBlobUrl);
      if (id) {
        const blob = await loadRecordingBlob(id);
        if (blob) return blob;
      }
      return null;
    }
    return fetchRemoteBlob(source.combinedBlobUrl);
  }
  return null;
}

async function loadVideoOnlyFallback(
  source: TrackExportSource,
): Promise<Blob | null> {
  // The video-only sibling is keyed by `<recordingId>:video`. Same
  // derivation pattern as the audio sibling — try the explicit
  // `videoOnlyLocalUrl` first, then fall back to deriving the key from
  // the combined URL.
  if (source.videoOnlyLocalUrl && isLocalBlobUrl(source.videoOnlyLocalUrl)) {
    const key = extractRecordingIdFromLocalUrl(source.videoOnlyLocalUrl);
    if (key) {
      const blob = await loadRecordingBlob(key);
      if (blob) return blob;
    }
  }
  if (source.combinedBlobUrl && isLocalBlobUrl(source.combinedBlobUrl)) {
    const id = extractRecordingIdFromLocalUrl(source.combinedBlobUrl);
    if (id) {
      const blob = await loadRecordingBlob(videoOnlyLocalKey(id));
      if (blob) return blob;
    }
  }
  return null;
}

async function loadAudioFallback(
  source: TrackExportSource,
): Promise<Blob | null> {
  // The audio sibling is keyed by `<recordingId>:audio` in IndexedDB. We
  // can derive that from either the explicit audioBlobUrl (`idb://<id>:audio`)
  // or by appending `:audio` to the combined URL's local id.
  if (source.audioBlobUrl && isLocalBlobUrl(source.audioBlobUrl)) {
    const key = extractRecordingIdFromLocalUrl(source.audioBlobUrl);
    if (key) {
      const blob = await loadRecordingBlob(key);
      if (blob) return blob;
    }
  }
  if (source.combinedBlobUrl && isLocalBlobUrl(source.combinedBlobUrl)) {
    const id = extractRecordingIdFromLocalUrl(source.combinedBlobUrl);
    if (id) {
      const blob = await loadRecordingBlob(audioOnlyLocalKey(id));
      if (blob) return blob;
    }
  }
  return null;
}

async function fetchRemoteBlob(url: string): Promise<Blob | null> {
  try {
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

/** Trigger a single-file download in the browser. Same shape as the
 *  existing `downloadBlob` helper but accepts a remote URL and falls back
 *  to opening it in a new tab when the blob can't be inlined. */
export function downloadBlobAsFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type ZipExportResult = {
  /** Names actually included in the zip (one per selection, in input order). */
  includedFilenames: string[];
  /** Selections we couldn't resolve a blob for. The UI should surface
   *  these so the user knows which participants didn't make it in. */
  skipped: Array<{ participantName: string; reason: string }>;
  /** True when the person cancelled the save dialog; nothing was written. */
  cancelled?: boolean;
};

type ResolvedEntry = {
  path: string;
  blob: Blob;
  sel: TrackSelection;
};

type SidecarTrack = {
  file: string;
  participant: string;
  stream: TrackStreamKind;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number | null;
  /** ms since epoch on the recording device. */
  startedAtMs: number | null;
  /** Server clock minus the recording device's clock at start, ms. */
  serverOffsetMs: number | null;
  /** `startedAtMs + serverOffsetMs` when both are known: the start on one shared clock. */
  startedAtServerMs: number | null;
};

/** Resolve every selection to a blob and a path inside the bundle. */
async function resolveEntries(
  selections: TrackSelection[],
): Promise<{ entries: ResolvedEntry[]; skipped: ZipExportResult["skipped"] }> {
  const entries: ResolvedEntry[] = [];
  const skipped: ZipExportResult["skipped"] = [];
  // Track filename collisions when two participants share a normalized
  // name. We disambiguate with a numeric suffix so the second one isn't
  // silently dropped.
  const seenFolders = new Map<string, number>();

  for (const sel of selections) {
    const blob = await resolveStreamBlob(sel);
    if (!blob) {
      skipped.push({
        participantName: sel.source.participantName,
        reason:
          sel.stream === "audio-only"
            ? "Audio-only file isn't available."
            : sel.stream === "video-only"
              ? "Video-only file isn't available."
              : sel.stream === "screen-only"
                ? "Screen-share file isn't available."
                : "Track file isn't available on this device.",
      });
      continue;
    }
    const baseFolder = safeFilenameSegment(sel.source.participantName);
    const seenCount = seenFolders.get(baseFolder) ?? 0;
    seenFolders.set(baseFolder, seenCount + 1);
    const folderName =
      seenCount === 0 ? baseFolder : `${baseFolder}_${seenCount + 1}`;
    const mimeForExtension =
      sel.stream === "audio-only"
        ? (sel.source.audioMimeType ?? blob.type)
        : sel.stream === "video-only"
          ? (sel.source.videoOnlyMimeType ?? blob.type)
          : sel.stream === "screen-only"
            ? (sel.source.screenMimeType ?? blob.type)
            : sel.source.combinedMimeType || blob.type;
    const filename = buildExportFilename(
      sel.source.participantName,
      sel.stream,
      mimeForExtension,
    );
    entries.push({ path: `${folderName}/${filename}`, blob, sel });
  }
  return { entries, skipped };
}

function buildSidecar(entries: ResolvedEntry[]): string {
  const tracks: SidecarTrack[] = entries.map(({ path, blob, sel }) => {
    const startedAtMs = sel.source.startedAtMs ?? null;
    const serverOffsetMs = sel.source.serverOffsetMs ?? null;
    return {
      file: path,
      participant: sel.source.participantName,
      stream: sel.stream,
      mimeType: blob.type || "application/octet-stream",
      sizeBytes: blob.size,
      durationSeconds:
        sel.stream === "video+audio" ||
        sel.stream === "audio-only" ||
        sel.stream === "video-only"
          ? (sel.source.durationSeconds ?? null)
          : null,
      startedAtMs,
      serverOffsetMs,
      startedAtServerMs:
        startedAtMs !== null && serverOffsetMs !== null
          ? startedAtMs + serverOffsetMs
          : null,
    };
  });
  return JSON.stringify(
    {
      format: "vessel-bundle",
      version: 1,
      generatedAt: new Date().toISOString(),
      note: "Each track was recorded on its participant's own device. startedAtServerMs puts every start on one clock; subtract the smallest value to get each track's offset in ms.",
      tracks,
    },
    null,
    2,
  );
}

/**
 * Stream a store-mode zip of the entries. Media is already compressed, so
 * storing it is both fastest and exact. Nothing is held in memory beyond
 * the chunk being written: each file is piped from `Blob.stream()`.
 */
export function createZipStream(
  entries: ResolvedEntry[],
  sidecarJson: string,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const zip = new Zip();
      let failed = false;
      zip.ondata = (err, data, final) => {
        if (failed) return;
        if (err) {
          failed = true;
          controller.error(err);
          return;
        }
        if (data.byteLength > 0) controller.enqueue(data);
        if (final) controller.close();
      };

      void (async () => {
        try {
          const sidecar = new ZipPassThrough("tracks.json");
          zip.add(sidecar);
          sidecar.push(new TextEncoder().encode(sidecarJson), true);

          for (const entry of entries) {
            const file = new ZipPassThrough(entry.path);
            zip.add(file);
            const reader = entry.blob.stream().getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value && value.byteLength > 0) file.push(value);
            }
            file.push(new Uint8Array(0), true);
          }
          zip.end();
        } catch (err) {
          if (!failed) {
            failed = true;
            controller.error(err);
          }
        }
      })();
    },
  });
}

/** Build the whole bundle as a Blob. Used by tests and by browsers without
 *  the File System Access API; the browser's blob store may spill to disk. */
export async function buildZipBlob(
  selections: TrackSelection[],
): Promise<{ blob: Blob | null } & ZipExportResult> {
  const { entries, skipped } = await resolveEntries(selections);
  if (entries.length === 0) {
    return { blob: null, includedFilenames: [], skipped };
  }
  const stream = createZipStream(entries, buildSidecar(entries));
  const blob = await new Response(stream).blob();
  return {
    blob: new Blob([blob], { type: "application/zip" }),
    includedFilenames: entries.map((e) => e.path),
    skipped,
  };
}

type SaveFilePicker = (options?: {
  suggestedName?: string;
  types?: Array<{ description?: string; accept: Record<string, string[]> }>;
}) => Promise<{ createWritable: () => Promise<WritableStream<Uint8Array>> }>;

function getSaveFilePicker(): SaveFilePicker | null {
  const w = globalThis as unknown as { showSaveFilePicker?: SaveFilePicker };
  return typeof w.showSaveFilePicker === "function"
    ? w.showSaveFilePicker.bind(w)
    : null;
}

/**
 * Package one or more participant track selections into a single zip. Each
 * participant gets a folder named after them so their files stay grouped,
 * and `tracks.json` describes every file with its start time.
 *
 * Where the browser offers a save dialog with a writable file (Chrome,
 * Edge), the zip streams straight to disk and never exists in memory.
 * Elsewhere it is assembled as a Blob and handed to the download manager.
 */
export async function downloadSelectionsAsZip(
  selections: TrackSelection[],
  zipFilename: string,
): Promise<ZipExportResult> {
  if (selections.length === 0) {
    return { includedFilenames: [], skipped: [] };
  }

  // Ask for the destination first, while the click's user activation is
  // still fresh; resolving blobs can take a while for long sessions.
  const picker = getSaveFilePicker();
  let writable: WritableStream<Uint8Array> | null = null;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: zipFilename,
        types: [
          {
            description: "Zip archive",
            accept: { "application/zip": [".zip"] },
          },
        ],
      });
      writable = await handle.createWritable();
    } catch (err) {
      if ((err as { name?: string } | null)?.name === "AbortError") {
        return { includedFilenames: [], skipped: [], cancelled: true };
      }
      // Picker unavailable for this page (e.g. cross-origin iframe): fall back.
      writable = null;
    }
  }

  const { entries, skipped } = await resolveEntries(selections);
  if (entries.length === 0) {
    if (writable) await writable.abort().catch(() => undefined);
    return { includedFilenames: [], skipped };
  }
  const stream = createZipStream(entries, buildSidecar(entries));
  const includedFilenames = entries.map((e) => e.path);

  if (writable) {
    await stream.pipeTo(writable);
    return { includedFilenames, skipped };
  }

  const blob = await new Response(stream).blob();
  downloadBlobAsFile(
    new Blob([blob], { type: "application/zip" }),
    zipFilename,
  );
  return { includedFilenames, skipped };
}

/** Convenience for the audio-only local URL when we know the recordingId
 *  but only have the combined URL on hand. */
export function deriveAudioLocalUrlFromCombined(
  combinedUrl: string | null | undefined,
): string | null {
  if (!combinedUrl) return null;
  if (!isLocalBlobUrl(combinedUrl)) return null;
  const id = extractRecordingIdFromLocalUrl(combinedUrl);
  if (!id) return null;
  return audioOnlyLocalUrl(id);
}

/** Re-export for convenience so callers can build idb:// URLs without
 *  reaching into the recordings-storage module. */
export { buildLocalBlobUrl };
