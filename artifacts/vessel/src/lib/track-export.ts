import JSZip from "jszip";
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
};

export type TrackStreamKind = "video+audio" | "video-only" | "audio-only";

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
  return !!(source.videoOnlyBlob || source.videoOnlyLocalUrl || source.videoOnlyRemoteUrl);
}

function safeFilenameSegment(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "participant";
}

function extensionFromMime(mimeType: string | null | undefined, fallback: string): string {
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
  return `${safe}-video-audio.${extensionFromMime(mimeType, "webm")}`;
}

/** Resolve a single stream choice to a Blob. Returns null when the requested
 *  true sibling can't be produced — callers must surface a "skipped" entry
 *  instead of falling back to a different stream type. */
export async function resolveStreamBlob(selection: TrackSelection): Promise<Blob | null> {
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
    if (source.videoOnlyRemoteUrl && !isLocalBlobUrl(source.videoOnlyRemoteUrl)) {
      return fetchRemoteBlob(source.videoOnlyRemoteUrl);
    }
    return null;
  }
  return resolveCombinedBlob(source);
}

async function resolveCombinedBlob(source: TrackExportSource): Promise<Blob | null> {
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

async function loadVideoOnlyFallback(source: TrackExportSource): Promise<Blob | null> {
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

async function loadAudioFallback(source: TrackExportSource): Promise<Blob | null> {
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
};

/** Package one or more participant track selections into a single zip
 *  using JSZip. Each participant gets a folder named after them so the
 *  audio + video files stay grouped. The zip is dropped to the browser
 *  via a transient blob URL. */
export async function downloadSelectionsAsZip(
  selections: TrackSelection[],
  zipFilename: string,
): Promise<ZipExportResult> {
  if (selections.length === 0) {
    return { includedFilenames: [], skipped: [] };
  }
  const zip = new JSZip();
  const includedFilenames: string[] = [];
  const skipped: ZipExportResult["skipped"] = [];

  // Track filename collisions when two participants share a normalized
  // name. We disambiguate with a numeric suffix so the second one isn't
  // silently dropped by JSZip's last-write-wins folder semantics.
  const seenFolders = new Map<string, number>();

  for (const sel of selections) {
    const blob = await resolveStreamBlob(sel);
    if (!blob) {
      skipped.push({
        participantName: sel.source.participantName,
        reason:
          sel.stream === "audio-only"
            ? "Audio-only sibling isn't available."
            : sel.stream === "video-only"
              ? "Video-only sibling isn't available."
              : "Track blob isn't available on this device.",
      });
      continue;
    }
    const baseFolder = safeFilenameSegment(sel.source.participantName);
    const seenCount = seenFolders.get(baseFolder) ?? 0;
    seenFolders.set(baseFolder, seenCount + 1);
    const folderName = seenCount === 0 ? baseFolder : `${baseFolder}_${seenCount + 1}`;

    const mimeForExtension =
      sel.stream === "audio-only"
        ? sel.source.audioMimeType ?? blob.type
        : sel.stream === "video-only"
          ? sel.source.videoOnlyMimeType ?? blob.type
          : sel.source.combinedMimeType || blob.type;
    const filename = buildExportFilename(
      sel.source.participantName,
      sel.stream,
      mimeForExtension,
    );
    zip.folder(folderName)!.file(filename, blob);
    includedFilenames.push(`${folderName}/${filename}`);
  }

  if (includedFilenames.length === 0) {
    return { includedFilenames, skipped };
  }

  const zipBlob = await zip.generateAsync({ type: "blob" });
  downloadBlobAsFile(zipBlob, zipFilename);
  return { includedFilenames, skipped };
}

/** Convenience for the audio-only local URL when we know the recordingId
 *  but only have the combined URL on hand. */
export function deriveAudioLocalUrlFromCombined(combinedUrl: string | null | undefined): string | null {
  if (!combinedUrl) return null;
  if (!isLocalBlobUrl(combinedUrl)) return null;
  const id = extractRecordingIdFromLocalUrl(combinedUrl);
  if (!id) return null;
  return audioOnlyLocalUrl(id);
}

/** Re-export for convenience so callers can build idb:// URLs without
 *  reaching into the recordings-storage module. */
export { buildLocalBlobUrl };
