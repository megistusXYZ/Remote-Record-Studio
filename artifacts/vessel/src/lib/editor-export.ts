/**
 * Editor-ready export: every speaker on a shared timeline.
 *
 * Each participant records on their own device, so their files start at
 * slightly different moments by different clocks. Each track carries its
 * device start time and the device's offset from the server clock; on the
 * server clock the starts are comparable, and the earliest becomes zero.
 */

export type TimedTrack = {
  id: string;
  /** Start on the recording device's clock, ms since epoch. */
  startedAtMs: number | null | undefined;
  /** Server clock minus the device clock at start, ms. */
  serverOffsetMs: number | null | undefined;
};

export type AlignedTrack = {
  id: string;
  /** Where this track starts on the shared timeline, ms (0 = first speaker). */
  offsetMs: number;
  /** False when the track lacked timing; it is placed at 0. */
  aligned: boolean;
};

/** The earliest start on the server clock, or null when no track has timing. */
export function timelineOriginMs(tracks: TimedTrack[]): number | null {
  const known = tracks
    .map((t) =>
      typeof t.startedAtMs === "number" && typeof t.serverOffsetMs === "number"
        ? t.startedAtMs + t.serverOffsetMs
        : null,
    )
    .filter((s): s is number => s !== null);
  return known.length > 0 ? Math.min(...known) : null;
}

export function alignTracks(tracks: TimedTrack[]): AlignedTrack[] {
  const serverStart = (t: TimedTrack): number | null =>
    typeof t.startedAtMs === "number" && typeof t.serverOffsetMs === "number"
      ? t.startedAtMs + t.serverOffsetMs
      : null;
  const starts = tracks.map(serverStart);
  const known = starts.filter((s): s is number => s !== null);
  const origin = known.length > 0 ? Math.min(...known) : 0;
  return tracks.map((t, i) => {
    const s = starts[i];
    return s === null
      ? { id: t.id, offsetMs: 0, aligned: false }
      : { id: t.id, offsetMs: Math.round(s - origin), aligned: true };
  });
}

const HEADER_PEEK_BYTES = 64 * 1024;

/**
 * Prepend `offsetMs` of silence to a PCM WAV so it starts in sync when
 * dropped onto any editor's timeline at zero. The audio bytes are not
 * touched or loaded: the result is a new header, a block of silence, and a
 * slice of the original file. Sizes in the header are recomputed from the
 * bytes actually present, which also repairs a placeholder size.
 */
export async function padWavStart(
  wavBlob: Blob,
  offsetMs: number,
): Promise<Blob> {
  if (offsetMs <= 0) return wavBlob;
  const head = new Uint8Array(
    await wavBlob.slice(0, HEADER_PEEK_BYTES).arrayBuffer(),
  );
  const v = new DataView(head.buffer);
  const tag = (o: number) =>
    String.fromCharCode(head[o]!, head[o + 1]!, head[o + 2]!, head[o + 3]!);
  if (head.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE")
    return wavBlob;

  let sampleRate = 0;
  let blockAlign = 0;
  let bitsPerSample = 0;
  let dataHeaderAt = -1;
  for (let o = 12; o + 8 <= head.length; ) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    if (id === "fmt ") {
      sampleRate = v.getUint32(o + 12, true);
      blockAlign = v.getUint16(o + 20, true);
      bitsPerSample = v.getUint16(o + 22, true);
    } else if (id === "data") {
      dataHeaderAt = o;
      break;
    }
    o += 8 + size + (size % 2);
  }
  if (dataHeaderAt < 0 || !sampleRate || !blockAlign) return wavBlob;

  const dataStart = dataHeaderAt + 8;
  const audioBytes = wavBlob.size - dataStart;
  const silenceBytes = Math.round((offsetMs * sampleRate) / 1000) * blockAlign;
  const header = head.slice(0, dataStart);
  const hv = new DataView(header.buffer);
  hv.setUint32(4, header.length - 8 + silenceBytes + audioBytes, true);
  hv.setUint32(dataHeaderAt + 4, silenceBytes + audioBytes, true);
  // 8-bit PCM is unsigned: its silence is 0x80. Wider formats are signed: 0.
  const silence = new Uint8Array(silenceBytes).fill(
    bitsPerSample === 8 ? 0x80 : 0,
  );
  return new Blob([header, silence, wavBlob.slice(dataStart)], {
    type: wavBlob.type || "audio/wav",
  });
}

/** A point on the shared timeline someone flagged while recording. */
export type TimelineMarker = { atMs: number; label: string };

const secs = (ms: number) => (ms / 1000).toFixed(6);

/** Audacity label track: File › Import › Labels. */
export function buildAudacityLabels(markers: TimelineMarker[]): string {
  return markers
    .map(
      (m) =>
        `${secs(m.atMs)}\t${secs(m.atMs)}\t${m.label.replace(/[\t\n]/g, " ")}\n`,
    )
    .join("");
}

function timecode(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const frac = total % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)}.${p(frac, 3)}`;
}

function csvCell(text: string): string {
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Plain marker list for people, spreadsheets and editors without import. */
export function buildMarkersCsv(markers: TimelineMarker[]): string {
  const rows = markers.map(
    (m) =>
      `${timecode(m.atMs)},${(m.atMs / 1000).toFixed(3)},${csvCell(m.label)}`,
  );
  return ["Time,Seconds,Label", ...rows].join("\n") + "\n";
}

export type ProjectTrack = {
  name: string;
  /** Path inside the bundle, relative to the project file. */
  file: string;
  positionMs: number;
  lengthMs: number;
};

const rppString = (text: string) => `"${text.replace(/"/g, "'")}"`;

/**
 * A Reaper project that opens with one named track per speaker, each file
 * placed at its position on the shared timeline, and the session markers.
 */
export function buildReaperProject(input: {
  sampleRate: number;
  tracks: ProjectTrack[];
  markers: TimelineMarker[];
}): string {
  const lines = [
    `<REAPER_PROJECT 0.1 "6.0" 0`,
    `  SAMPLERATE ${input.sampleRate} 0 0`,
  ];
  input.markers.forEach((m, i) =>
    lines.push(`  MARKER ${i + 1} ${secs(m.atMs)} ${rppString(m.label)} 0`),
  );
  for (const t of input.tracks) {
    const fileName = t.file.split("/").pop() ?? t.file;
    const kind = /\.wav$/i.test(t.file) ? "WAVE" : "VIDEO";
    lines.push(
      "  <TRACK",
      `    NAME ${rppString(t.name)}`,
      "    <ITEM",
      `      POSITION ${secs(t.positionMs)}`,
      `      LENGTH ${secs(t.lengthMs)}`,
      `      NAME ${rppString(fileName)}`,
      `      <SOURCE ${kind}`,
      `        FILE ${rppString(t.file)}`,
      "      >",
      "    >",
      "  >",
    );
  }
  lines.push(">", "");
  return lines.join("\n");
}
