/**
 * Post-session transcript, made on the host's own machine.
 *
 * Each speaker's WAV master is transcribed on its own (separate tracks mean
 * the speaker labels are free and exact), in 30-second windows read straight
 * from the file, so an hour of audio never sits in memory at once. The
 * per-speaker results are placed on the shared timeline and merged into one
 * conversation, then written as SRT, VTT and text for the editor download.
 */

export type PcmFormat = {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
};

export const MODEL_SAMPLE_RATE = 16_000;

function readSample(bytes: Uint8Array, offset: number, bits: number): number {
  if (bits === 16) {
    const v = bytes[offset]! | (bytes[offset + 1]! << 8);
    return (v & 0x8000 ? v - 0x10000 : v) / 0x8000;
  }
  if (bits === 24) {
    const v =
      bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
    return (v & 0x800000 ? v - 0x1000000 : v) / 0x800000;
  }
  if (bits === 32) {
    return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getFloat32(
      0,
      true,
    );
  }
  return (bytes[offset]! - 128) / 128; // 8-bit unsigned
}

/**
 * PCM bytes (any channel count, 8/16/24-bit integer or 32-bit float) to the
 * mono 16 kHz float audio the speech model reads. Channels are averaged;
 * each output sample averages the input samples it covers, which also
 * filters out frequencies the lower rate cannot hold.
 */
export function pcmTo16kMono(
  bytes: Uint8Array,
  format: PcmFormat,
): Float32Array {
  const bytesPerSample = format.bitsPerSample / 8;
  const frameBytes = bytesPerSample * format.channels;
  const frames = Math.floor(bytes.length / frameBytes);
  const ratio = format.sampleRate / MODEL_SAMPLE_RATE;
  const outLength = Math.floor(frames / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const from = Math.floor(i * ratio);
    const to = Math.max(from + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let f = from; f < to; f++) {
      let frame = 0;
      for (let c = 0; c < format.channels; c++) {
        frame += readSample(
          bytes,
          f * frameBytes + c * bytesPerSample,
          format.bitsPerSample,
        );
      }
      sum += frame / format.channels;
    }
    out[i] = sum / (to - from);
  }
  return out;
}

/** Locate the format and audio data of a PCM WAV from its first bytes. */
async function parseWav(
  blob: Blob,
): Promise<{ format: PcmFormat; dataStart: number; dataEnd: number } | null> {
  const head = new Uint8Array(await blob.slice(0, 64 * 1024).arrayBuffer());
  const v = new DataView(head.buffer);
  const tag = (o: number) =>
    String.fromCharCode(head[o]!, head[o + 1]!, head[o + 2]!, head[o + 3]!);
  if (head.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let format: PcmFormat | null = null;
  for (let o = 12; o + 8 <= head.length; ) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    if (id === "fmt ") {
      format = {
        channels: v.getUint16(o + 10, true),
        sampleRate: v.getUint32(o + 12, true),
        bitsPerSample: v.getUint16(o + 22, true),
      };
    } else if (id === "data") {
      if (!format) return null;
      // Trust the file length over the header: a recovered take may carry a
      // placeholder size.
      return { format, dataStart: o + 8, dataEnd: blob.size };
    }
    o += 8 + size + (size % 2);
  }
  return null;
}

/**
 * Read a WAV in `windowSec` windows as 16 kHz mono, without loading the
 * whole file. Each window carries its start time from the top of the file.
 */
export async function* readWavWindows(
  blob: Blob,
  windowSec: number,
): AsyncGenerator<{ startMs: number; samples: Float32Array }> {
  const wav = await parseWav(blob);
  if (!wav) return;
  const frameBytes = (wav.format.bitsPerSample / 8) * wav.format.channels;
  const windowBytes =
    Math.round(windowSec * wav.format.sampleRate) * frameBytes;
  for (
    let at = wav.dataStart, i = 0;
    at < wav.dataEnd;
    at += windowBytes, i++
  ) {
    const bytes = new Uint8Array(
      await blob
        .slice(at, Math.min(at + windowBytes, wav.dataEnd))
        .arrayBuffer(),
    );
    yield {
      startMs: Math.round(i * windowSec * 1000),
      samples: pcmTo16kMono(bytes, wav.format),
    };
  }
}

/** A stretch of speech, timed from the start of its own track. */
export type Segment = { startMs: number; endMs: number; text: string };
/** A line of the conversation, timed on the shared timeline. */
export type TranscriptLine = {
  speaker: string;
  startMs: number;
  endMs: number;
  text: string;
};

/** A whole segment that is only a sound tag: "[Music]", "(laughs)", "[BLANK_AUDIO]". */
const SOUND_TAG = /^[[(][^\])]*[\])]$/;

/** Place each speaker's segments on the shared timeline and merge them. */
export function mergeSpeakers(
  tracks: Array<{ speaker: string; offsetMs: number; segments: Segment[] }>,
): TranscriptLine[] {
  const lines: Array<TranscriptLine & { order: number }> = [];
  tracks.forEach((t, order) => {
    for (const seg of t.segments) {
      const text = seg.text.trim().replace(/\s+/g, " ");
      if (!text || SOUND_TAG.test(text)) continue;
      lines.push({
        speaker: t.speaker,
        startMs: seg.startMs + t.offsetMs,
        endMs: seg.endMs + t.offsetMs,
        text,
        order,
      });
    }
  });
  lines.sort((a, b) => a.startMs - b.startMs || a.order - b.order);
  return lines.map(({ order: _order, ...line }) => line);
}

function clock(ms: number, sep: "," | "." | null): string {
  const t = Math.max(0, Math.round(ms));
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const base = `${p(Math.floor(t / 3_600_000))}:${p(Math.floor((t % 3_600_000) / 60_000))}:${p(Math.floor((t % 60_000) / 1000))}`;
  return sep ? `${base}${sep}${p(t % 1000, 3)}` : base;
}

/** SubRip: every video editor reads it. */
export function toSrt(lines: TranscriptLine[]): string {
  return lines
    .map(
      (l, i) =>
        `${i + 1}\n${clock(l.startMs, ",")} --> ${clock(l.endMs, ",")}\n${l.speaker}: ${l.text}\n`,
    )
    .join("\n");
}

/** WebVTT with voice tags, for the web and newer editors. */
export function toVtt(lines: TranscriptLine[]): string {
  return [
    "WEBVTT",
    "",
    ...lines.map(
      (l) =>
        `${clock(l.startMs, ".")} --> ${clock(l.endMs, ".")}\n<v ${l.speaker}>${l.text}\n`,
    ),
  ].join("\n");
}

/** A readable transcript for show notes: one timestamped paragraph per turn. */
export function toText(lines: TranscriptLine[], title?: string): string {
  const turns: Array<{ speaker: string; startMs: number; text: string[] }> = [];
  for (const l of lines) {
    const last = turns[turns.length - 1];
    if (last && last.speaker === l.speaker) last.text.push(l.text);
    else turns.push({ speaker: l.speaker, startMs: l.startMs, text: [l.text] });
  }
  const body = turns.map(
    (t) => `[${clock(t.startMs, null)}] ${t.speaker}: ${t.text.join(" ")}\n`,
  );
  return [...(title ? [title, ""] : []), ...body.flatMap((b) => [b])].join(
    "\n",
  );
}

/** Anything that turns 16 kHz mono audio into timed text (Whisper in a
 *  worker, in the app). Segment times are from the start of `samples`. */
export type SpeechEngine = {
  transcribe: (
    samples: Float32Array,
    signal?: AbortSignal,
  ) => Promise<Segment[]>;
};

export type SessionTrack = { speaker: string; offsetMs: number; audio: Blob };

/** Whisper reads 30-second windows; matching them avoids extra cuts. */
export const DEFAULT_WINDOW_SEC = 30;

export type TranscriptProgress = { fraction: number; speaker: string };

const abortError = () =>
  Object.assign(new Error("Transcription cancelled"), { name: "AbortError" });

export async function transcribeSession(input: {
  tracks: SessionTrack[];
  engine: SpeechEngine;
  windowSec?: number;
  onProgress?: (p: TranscriptProgress) => void;
  signal?: AbortSignal;
}): Promise<{ lines: TranscriptLine[]; failed: string[] }> {
  const windowSec = input.windowSec ?? DEFAULT_WINDOW_SEC;
  const perTrack: Array<{
    speaker: string;
    offsetMs: number;
    segments: Segment[];
  }> = [];
  const failed: string[] = [];
  const n = input.tracks.length;

  for (const [index, track] of input.tracks.entries()) {
    if (input.signal?.aborted) throw abortError();
    const wav = await parseWav(track.audio);
    if (!wav) {
      failed.push(track.speaker);
      input.onProgress?.({ fraction: (index + 1) / n, speaker: track.speaker });
      continue;
    }
    const frameBytes = (wav.format.bitsPerSample / 8) * wav.format.channels;
    const windowBytes =
      Math.round(windowSec * wav.format.sampleRate) * frameBytes;
    const total = Math.max(
      1,
      Math.ceil((wav.dataEnd - wav.dataStart) / windowBytes),
    );
    const segments: Segment[] = [];
    let done = 0;
    try {
      for await (const w of readWavWindows(track.audio, windowSec)) {
        if (input.signal?.aborted) throw abortError();
        const found = await input.engine.transcribe(w.samples, input.signal);
        if (input.signal?.aborted) throw abortError();
        for (const s of found)
          segments.push({
            startMs: s.startMs + w.startMs,
            endMs: s.endMs + w.startMs,
            text: s.text,
          });
        done += 1;
        input.onProgress?.({
          fraction: (index + done / total) / n,
          speaker: track.speaker,
        });
      }
      perTrack.push({
        speaker: track.speaker,
        offsetMs: track.offsetMs,
        segments,
      });
    } catch (err) {
      if ((err as { name?: string } | null)?.name === "AbortError") throw err;
      console.warn(`[transcript] ${track.speaker}'s track failed`, err);
      failed.push(track.speaker);
    }
  }
  return { lines: mergeSpeakers(perTrack), failed };
}
