// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { transcribeSession, type SpeechEngine } from "./transcript";

/** A silent 16 kHz mono 16-bit WAV of the given length. */
function silentWav(seconds: number): Blob {
  const data = new Uint8Array(Math.round(seconds * 16_000) * 2);
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const str = (o: number, t: string) =>
    [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + data.length, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 16_000, true);
  v.setUint32(28, 32_000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, data.length, true);
  return new Blob([header, data], { type: "audio/wav" });
}

/** Says one line per window, naming how long the window was. */
const fakeEngine = (): SpeechEngine => ({
  transcribe: vi.fn(async (samples: Float32Array) => [
    { startMs: 100, endMs: 900, text: `heard ${samples.length / 16} ms` },
  ]),
});

describe("session transcriber", () => {
  it("transcribes each speaker's track window by window onto the shared timeline", async () => {
    const result = await transcribeSession({
      tracks: [
        { speaker: "Maya", offsetMs: 0, audio: silentWav(2.5) },
        { speaker: "Theo", offsetMs: 1_250, audio: silentWav(1) },
      ],
      engine: fakeEngine(),
      windowSec: 1,
    });
    expect(result.failed).toEqual([]);
    expect(result.lines).toEqual([
      { speaker: "Maya", startMs: 100, endMs: 900, text: "heard 1000 ms" },
      { speaker: "Maya", startMs: 1_100, endMs: 1_900, text: "heard 1000 ms" },
      { speaker: "Theo", startMs: 1_350, endMs: 2_150, text: "heard 1000 ms" },
      { speaker: "Maya", startMs: 2_100, endMs: 2_900, text: "heard 500 ms" },
    ]);
  });

  it("keeps going when one speaker's track cannot be transcribed, and names them", async () => {
    const result = await transcribeSession({
      tracks: [
        { speaker: "Maya", offsetMs: 0, audio: new Blob(["not a wav"]) },
        { speaker: "Theo", offsetMs: 0, audio: silentWav(1) },
      ],
      engine: fakeEngine(),
      windowSec: 1,
    });
    expect(result.failed).toEqual(["Maya"]);
    expect(result.lines.map((l) => l.speaker)).toEqual(["Theo"]);
  });

  it("names a speaker whose transcription failed part way", async () => {
    const engine: SpeechEngine = {
      transcribe: vi.fn().mockRejectedValue(new Error("out of memory")),
    };
    const result = await transcribeSession({
      tracks: [{ speaker: "Theo", offsetMs: 0, audio: silentWav(1) }],
      engine,
      windowSec: 1,
    });
    expect(result.failed).toEqual(["Theo"]);
  });

  it("reports progress from 0 to 1 across every speaker", async () => {
    const seen: number[] = [];
    await transcribeSession({
      tracks: [
        { speaker: "Maya", offsetMs: 0, audio: silentWav(2) },
        { speaker: "Theo", offsetMs: 0, audio: silentWav(2) },
      ],
      engine: fakeEngine(),
      windowSec: 1,
      onProgress: (p) => seen.push(p.fraction),
    });
    expect(seen).toEqual([0.25, 0.5, 0.75, 1]);
  });

  it("stops when cancelled", async () => {
    const controller = new AbortController();
    const engine: SpeechEngine = {
      transcribe: vi.fn(async () => {
        controller.abort();
        return [];
      }),
    };
    await expect(
      transcribeSession({
        tracks: [{ speaker: "Maya", offsetMs: 0, audio: silentWav(3) }],
        engine,
        windowSec: 1,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(engine.transcribe).toHaveBeenCalledTimes(1);
  });
});
