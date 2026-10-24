// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  alignTracks,
  timelineOriginMs,
  padWavStart,
  buildAudacityLabels,
  buildMarkersCsv,
  buildReaperProject,
} from "./editor-export";

describe("track alignment", () => {
  it("puts every track on one timeline that starts with the earliest speaker", () => {
    // Maya's device clock runs 2 s behind the server; Theo's 500 ms ahead.
    // On the server clock Maya started at 10 000 and Theo at 11 250.
    const aligned = alignTracks([
      { id: "maya", startedAtMs: 12_000, serverOffsetMs: -2_000 },
      { id: "theo", startedAtMs: 11_750, serverOffsetMs: -500 },
    ]);
    expect(aligned).toEqual([
      { id: "maya", offsetMs: 0, aligned: true },
      { id: "theo", offsetMs: 1_250, aligned: true },
    ]);
  });

  it("places a track without timing at the start and says so", () => {
    expect(
      alignTracks([
        { id: "maya", startedAtMs: 5_000, serverOffsetMs: 0 },
        { id: "legacy", startedAtMs: null, serverOffsetMs: null },
      ]),
    ).toEqual([
      { id: "maya", offsetMs: 0, aligned: true },
      { id: "legacy", offsetMs: 0, aligned: false },
    ]);
  });
});

/** A minimal PCM WAV: mono, 1 kHz, 24-bit, with the given sample bytes. */
function wav(samples: number[], sampleRate = 1000): Blob {
  const data = new Uint8Array(samples);
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const str = (o: number, t: string) =>
    [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + data.length, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 3, true);
  v.setUint16(32, 3, true); // block align
  v.setUint16(34, 24, true);
  str(36, "data");
  v.setUint32(40, data.length, true);
  return new Blob([header, data], { type: "audio/wav" });
}

describe("timeline origin", () => {
  it("is the earliest start on the server clock, so markers can be placed against it", () => {
    expect(
      timelineOriginMs([
        { id: "maya", startedAtMs: 12_000, serverOffsetMs: -2_000 },
        { id: "theo", startedAtMs: 11_750, serverOffsetMs: -500 },
        { id: "legacy", startedAtMs: null, serverOffsetMs: null },
      ]),
    ).toBe(10_000);
    expect(
      timelineOriginMs([{ id: "x", startedAtMs: null, serverOffsetMs: null }]),
    ).toBeNull();
  });
});

describe("WAV padding", () => {
  it("adds silence at the start so the track lines up, leaving the audio untouched", async () => {
    // 1 kHz mono 24-bit: 5 ms of offset is 5 frames, 15 bytes of silence.
    const original = wav([1, 2, 3, 4, 5, 6]);
    const padded = new Uint8Array(
      await (await padWavStart(original, 5)).arrayBuffer(),
    );
    const v = new DataView(padded.buffer);
    expect(v.getUint32(40, true)).toBe(6 + 15); // data chunk size
    expect(v.getUint32(4, true)).toBe(36 + 6 + 15); // RIFF size
    expect([...padded.slice(44, 44 + 15)]).toEqual(new Array(15).fill(0));
    expect([...padded.slice(44 + 15)]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("leaves anything that is not a WAV as it is", async () => {
    const webm = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3])], {
      type: "video/webm",
    });
    expect(await padWavStart(webm, 500)).toBe(webm);
  });
});

describe("editor files", () => {
  const markers = [
    { atMs: 1_500, label: "Great story" },
    { atMs: 754_250, label: "Cut this" },
  ];

  it("writes Audacity labels", () => {
    expect(buildAudacityLabels(markers)).toBe(
      "1.500000\t1.500000\tGreat story\n754.250000\t754.250000\tCut this\n",
    );
  });

  it("writes a marker list a person or a spreadsheet can read", () => {
    expect(buildMarkersCsv(markers)).toBe(
      "Time,Seconds,Label\n00:00:01.500,1.500,Great story\n00:12:34.250,754.250,Cut this\n",
    );
  });

  it("quotes labels that contain commas or quotes", () => {
    expect(buildMarkersCsv([{ atMs: 0, label: 'Ask "why", later' }])).toBe(
      'Time,Seconds,Label\n00:00:00.000,0.000,"Ask ""why"", later"\n',
    );
  });

  it("writes a Reaper project with one named track per speaker, placed on the timeline", () => {
    const rpp = buildReaperProject({
      sampleRate: 48_000,
      tracks: [
        {
          name: "Maya",
          file: "Maya/maya.wav",
          positionMs: 0,
          lengthMs: 1_440_000,
        },
        {
          name: "Theo",
          file: "Theo/theo.webm",
          positionMs: 1_250,
          lengthMs: 1_438_000,
        },
      ],
      markers: [{ atMs: 1_500, label: "Great story" }],
    });
    expect(rpp).toBe(
      [
        '<REAPER_PROJECT 0.1 "6.0" 0',
        "  SAMPLERATE 48000 0 0",
        '  MARKER 1 1.500000 "Great story" 0',
        "  <TRACK",
        '    NAME "Maya"',
        "    <ITEM",
        "      POSITION 0.000000",
        "      LENGTH 1440.000000",
        '      NAME "maya.wav"',
        "      <SOURCE WAVE",
        '        FILE "Maya/maya.wav"',
        "      >",
        "    >",
        "  >",
        "  <TRACK",
        '    NAME "Theo"',
        "    <ITEM",
        "      POSITION 1.250000",
        "      LENGTH 1438.000000",
        '      NAME "theo.webm"',
        "      <SOURCE VIDEO",
        '        FILE "Theo/theo.webm"',
        "      >",
        "    >",
        "  >",
        ">",
        "",
      ].join("\n"),
    );
  });
});
