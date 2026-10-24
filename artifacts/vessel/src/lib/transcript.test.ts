// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  pcmTo16kMono,
  readWavWindows,
  mergeSpeakers,
  toSrt,
  toVtt,
  toText,
} from "./transcript";

/** 24-bit little-endian signed PCM bytes for the given sample values. */
function pcm24(values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 3);
  values.forEach((v, i) => {
    const n = v < 0 ? v + 0x1000000 : v;
    out[i * 3] = n & 0xff;
    out[i * 3 + 1] = (n >> 8) & 0xff;
    out[i * 3 + 2] = (n >> 16) & 0xff;
  });
  return out;
}

describe("audio prep", () => {
  it("turns 48 kHz 24-bit audio into the 16 kHz the speech model reads", () => {
    // Full scale is 2^23. Every third 48 kHz sample becomes one 16 kHz sample.
    const half = 0x400000; // 0.5
    const quarter = 0x200000; // 0.25
    const out = pcmTo16kMono(
      pcm24([half, half, half, -quarter, -quarter, -quarter]),
      {
        sampleRate: 48_000,
        channels: 1,
        bitsPerSample: 24,
      },
    );
    expect(Array.from(out)).toEqual([0.5, -0.25]);
  });

  it("averages stereo channels", () => {
    const out = pcmTo16kMono(pcm24([0x400000, 0, 0x400000, 0, 0x400000, 0]), {
      sampleRate: 48_000,
      channels: 2,
      bitsPerSample: 24,
    });
    expect(Array.from(out)).toEqual([0.25]);
  });

  it("reads a WAV file in windows, each with its start time", async () => {
    // 2.5 s of 16 kHz mono 24-bit audio, read in 1-second windows.
    const frames = 40_000;
    const data = new Uint8Array(frames * 3);
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
    v.setUint32(28, 48_000, true);
    v.setUint16(32, 3, true);
    v.setUint16(34, 24, true);
    str(36, "data");
    v.setUint32(40, data.length, true);
    const windows = [];
    for await (const w of readWavWindows(new Blob([header, data]), 1))
      windows.push({ startMs: w.startMs, length: w.samples.length });
    expect(windows).toEqual([
      { startMs: 0, length: 16_000 },
      { startMs: 1_000, length: 16_000 },
      { startMs: 2_000, length: 8_000 },
    ]);
  });
});

describe("merging speakers", () => {
  it("weaves each speaker's lines into one conversation on the shared timeline", () => {
    // Theo's track starts 1.25 s after Maya's, so his times shift by 1250.
    const lines = mergeSpeakers([
      {
        speaker: "Maya",
        offsetMs: 0,
        segments: [
          { startMs: 0, endMs: 2_000, text: " Welcome to the show." },
          { startMs: 5_000, endMs: 6_000, text: "Tell us more." },
        ],
      },
      {
        speaker: "Theo",
        offsetMs: 1_250,
        segments: [
          { startMs: 1_000, endMs: 3_000, text: "Thanks for having me." },
        ],
      },
    ]);
    expect(lines).toEqual([
      {
        speaker: "Maya",
        startMs: 0,
        endMs: 2_000,
        text: "Welcome to the show.",
      },
      {
        speaker: "Theo",
        startMs: 2_250,
        endMs: 4_250,
        text: "Thanks for having me.",
      },
      { speaker: "Maya", startMs: 5_000, endMs: 6_000, text: "Tell us more." },
    ]);
  });

  it("drops empty lines and the model's sound tags", () => {
    const lines = mergeSpeakers([
      {
        speaker: "Maya",
        offsetMs: 0,
        segments: [
          { startMs: 0, endMs: 1_000, text: "  " },
          { startMs: 1_000, endMs: 2_000, text: "[BLANK_AUDIO]" },
          { startMs: 2_000, endMs: 3_000, text: " (laughs) " },
          { startMs: 3_000, endMs: 4_000, text: "[Music]" },
          { startMs: 4_000, endMs: 5_000, text: "So, (laughs) where were we?" },
        ],
      },
    ]);
    expect(lines.map((l) => l.text)).toEqual(["So, (laughs) where were we?"]);
  });
});

describe("caption files", () => {
  const lines = [
    { speaker: "Maya", startMs: 0, endMs: 2_000, text: "Welcome to the show." },
    { speaker: "Maya", startMs: 2_100, endMs: 3_500, text: "Theo is here." },
    {
      speaker: "Theo",
      startMs: 3_750,
      endMs: 5_250,
      text: "Thanks for having me.",
    },
    {
      speaker: "Maya",
      startMs: 3_725_040,
      endMs: 3_727_000,
      text: "That's a wrap.",
    },
  ];

  it("writes SRT with speaker names", () => {
    expect(toSrt(lines)).toBe(
      [
        "1",
        "00:00:00,000 --> 00:00:02,000",
        "Maya: Welcome to the show.",
        "",
        "2",
        "00:00:02,100 --> 00:00:03,500",
        "Maya: Theo is here.",
        "",
        "3",
        "00:00:03,750 --> 00:00:05,250",
        "Theo: Thanks for having me.",
        "",
        "4",
        "01:02:05,040 --> 01:02:07,000",
        "Maya: That's a wrap.",
        "",
      ].join("\n"),
    );
  });

  it("writes WebVTT with voice tags", () => {
    expect(toVtt(lines)).toBe(
      [
        "WEBVTT",
        "",
        "00:00:00.000 --> 00:00:02.000",
        "<v Maya>Welcome to the show.",
        "",
        "00:00:02.100 --> 00:00:03.500",
        "<v Maya>Theo is here.",
        "",
        "00:00:03.750 --> 00:00:05.250",
        "<v Theo>Thanks for having me.",
        "",
        "01:02:05.040 --> 01:02:07.000",
        "<v Maya>That's a wrap.",
        "",
      ].join("\n"),
    );
  });

  it("writes a readable transcript, one paragraph per turn", () => {
    expect(toText(lines, "Episode 12")).toBe(
      [
        "Episode 12",
        "",
        "[00:00:00] Maya: Welcome to the show. Theo is here.",
        "",
        "[00:00:03] Theo: Thanks for having me.",
        "",
        "[01:02:05] Maya: That's a wrap.",
        "",
      ].join("\n"),
    );
  });
});
