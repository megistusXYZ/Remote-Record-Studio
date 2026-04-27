/**
 * Transcript export helpers.
 *
 * The studio captures live caption fragments into a single ordered list
 * (sender + start/end ms + text). At the end of a session we offer the
 * host (and each guest, for their own fragments) a download in three
 * common formats:
 *   - SRT — universal subtitle format, opens in any video editor.
 *   - VTT — modern web-native subtitle format.
 *   - JSON — raw structured fragments for programmatic post-processing.
 *
 * All formatters take a session-relative time origin so the timestamps
 * line up with `t = 0` at the moment the recording started, regardless
 * of when the captions actually began emitting.
 */

export type TranscriptFragment = {
  /** Stable id for dedup / React keys. Worker-derived (event id from the
   *  signaling channel for remote, locally-generated for self). */
  id: string;
  /** Pubkey of whoever spoke. Used to colour the transcript bubbles
   *  consistently with the rest of the UI. */
  fromPubkey: string;
  /** Display name as it appeared at publish time. */
  fromName: string;
  text: string;
  /** Wall-clock ms when the audio window started. */
  startMs: number;
  /** Wall-clock ms when the audio window ended. */
  endMs: number;
  /** Wall-clock ms when this fragment landed locally — used for stable
   *  ordering when start times tie. */
  createdAtMs: number;
};

function pad(n: number, width: number): string {
  return n.toString().padStart(width, "0");
}

/** Format `ms` as an SRT timestamp `HH:MM:SS,mmm`. */
function fmtSrt(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;
  const milli = Math.floor(ms % 1000);
  return `${pad(hh, 2)}:${pad(mm, 2)}:${pad(ss, 2)},${pad(milli, 3)}`;
}

/** Format `ms` as a WebVTT timestamp `HH:MM:SS.mmm`. */
function fmtVtt(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;
  const milli = Math.floor(ms % 1000);
  return `${pad(hh, 2)}:${pad(mm, 2)}:${pad(ss, 2)}.${pad(milli, 3)}`;
}

/** Sort fragments by start time, breaking ties with arrival order. */
export function sortFragments(fragments: TranscriptFragment[]): TranscriptFragment[] {
  return [...fragments].sort((a, b) => {
    if (a.startMs !== b.startMs) return a.startMs - b.startMs;
    return a.createdAtMs - b.createdAtMs;
  });
}

/** Pick the lower of (earliest fragment start, supplied origin). Used as
 *  the default time origin so unsigned-int subtractions never go negative. */
export function pickOriginMs(
  fragments: TranscriptFragment[],
  preferred: number | null,
): number {
  if (fragments.length === 0) return preferred ?? Date.now();
  const first = sortFragments(fragments)[0].startMs;
  if (preferred == null) return first;
  return Math.min(preferred, first);
}

/** Build an SRT document string. */
export function toSrt(
  fragments: TranscriptFragment[],
  originMs: number,
): string {
  const sorted = sortFragments(fragments);
  const lines: string[] = [];
  sorted.forEach((f, i) => {
    const start = fmtSrt(Math.max(0, f.startMs - originMs));
    const end = fmtSrt(Math.max(0, f.endMs - originMs));
    lines.push(`${i + 1}`);
    lines.push(`${start} --> ${end}`);
    lines.push(`${f.fromName}: ${f.text}`);
    lines.push("");
  });
  return lines.join("\n");
}

/** Build a WebVTT document string. */
export function toVtt(
  fragments: TranscriptFragment[],
  originMs: number,
): string {
  const sorted = sortFragments(fragments);
  const lines: string[] = ["WEBVTT", ""];
  sorted.forEach((f) => {
    const start = fmtVtt(Math.max(0, f.startMs - originMs));
    const end = fmtVtt(Math.max(0, f.endMs - originMs));
    lines.push(`${start} --> ${end}`);
    lines.push(`<v ${f.fromName}>${f.text}`);
    lines.push("");
  });
  return lines.join("\n");
}

/** Build a JSON document with session-relative timestamps and metadata. */
export function toJson(
  fragments: TranscriptFragment[],
  originMs: number,
  sessionTitle?: string,
): string {
  const sorted = sortFragments(fragments);
  const payload = {
    sessionTitle: sessionTitle ?? null,
    originIsoUtc: new Date(originMs).toISOString(),
    fragments: sorted.map((f) => ({
      id: f.id,
      fromPubkey: f.fromPubkey,
      fromName: f.fromName,
      text: f.text,
      startMs: Math.max(0, f.startMs - originMs),
      endMs: Math.max(0, f.endMs - originMs),
    })),
  };
  return JSON.stringify(payload, null, 2);
}

/** Build a plain-text "speaker: line" transcript. Useful for show notes. */
export function toPlainText(fragments: TranscriptFragment[]): string {
  const sorted = sortFragments(fragments);
  return sorted.map((f) => `${f.fromName}: ${f.text}`).join("\n");
}

export type TranscriptExportFormat = "srt" | "vtt" | "json" | "txt";

export function buildTranscriptBlob(
  fragments: TranscriptFragment[],
  format: TranscriptExportFormat,
  originMs: number,
  sessionTitle?: string,
): Blob {
  switch (format) {
    case "srt":
      return new Blob([toSrt(fragments, originMs)], {
        type: "application/x-subrip;charset=utf-8",
      });
    case "vtt":
      return new Blob([toVtt(fragments, originMs)], {
        type: "text/vtt;charset=utf-8",
      });
    case "json":
      return new Blob([toJson(fragments, originMs, sessionTitle)], {
        type: "application/json;charset=utf-8",
      });
    case "txt":
      return new Blob([toPlainText(fragments)], { type: "text/plain;charset=utf-8" });
  }
}

export function transcriptFilename(
  sessionTitle: string | undefined,
  format: TranscriptExportFormat,
  date?: Date,
): string {
  const stamp = (() => {
    const d = date ?? new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
  })();
  const safeTitle = (sessionTitle ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  const base = safeTitle ? `vessel-transcript-${safeTitle}-${stamp}` : `vessel-transcript-${stamp}`;
  return `${base}.${format}`;
}
