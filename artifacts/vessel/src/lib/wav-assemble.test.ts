// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  assembleWavFromChunks,
  repairWavHeader,
  WAV_MIN_HEADER_BYTES,
} from "./wav-assemble";

/** A 44-byte PCM header the way a streaming writer first emits it: sizes 0. */
function headerWithZeroSizes(
  channels = 1,
  sampleRate = 48000,
  bits = 16,
): Uint8Array {
  const h = new Uint8Array(WAV_MIN_HEADER_BYTES);
  const v = new DataView(h.buffer);
  const ascii = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) h[o + i] = s.charCodeAt(i);
  };
  ascii(0, "RIFF");
  v.setUint32(4, 0, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, (sampleRate * channels * bits) / 8, true);
  v.setUint16(32, (channels * bits) / 8, true);
  v.setUint16(34, bits, true);
  ascii(36, "data");
  v.setUint32(40, 0, true);
  return h;
}

function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

async function sizes(
  blob: Blob,
): Promise<{ riff: number; data: number; total: number }> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const v = new DataView(bytes.buffer);
  return {
    riff: v.getUint32(4, true),
    data: v.getUint32(40, true),
    total: bytes.length,
  };
}

describe("wav-assemble", () => {
  it("repairs the sizes of an unfinalized header", () => {
    const repaired = repairWavHeader(headerWithZeroSizes(), 44 + 1000);
    expect(repaired).not.toBeNull();
    const v = new DataView(repaired!.header.buffer);
    expect(v.getUint32(4, true)).toBe(1036);
    expect(v.getUint32(40, true)).toBe(1000);
    expect(repaired!.dataOffset).toBe(44);
  });

  it("rejects something that is not a WAV header", () => {
    expect(repairWavHeader(new Uint8Array(44), 100)).toBeNull();
    expect(repairWavHeader(new Uint8Array(10), 100)).toBeNull();
  });

  it("assembles appends plus the two finalize patches into a correct file", async () => {
    const pcm1 = new Uint8Array(600).fill(7);
    const pcm2 = new Uint8Array(400).fill(9);
    const total = 44 + 1000;
    const parts = [
      { index: 0, position: 0, blob: new Blob([headerWithZeroSizes(), pcm1]) },
      { index: 1, position: 644, blob: new Blob([pcm2]) },
      { index: 2, position: 4, blob: new Blob([u32le(total - 8)]) },
      { index: 3, position: 40, blob: new Blob([u32le(1000)]) },
    ];
    const out = await assembleWavFromChunks(parts);
    expect(out).not.toBeNull();
    expect(out!.finalized).toBe(true);
    expect(await sizes(out!.blob)).toEqual({
      riff: total - 8,
      data: 1000,
      total,
    });
    const bytes = new Uint8Array(await out!.blob.arrayBuffer());
    expect(bytes[44]).toBe(7);
    expect(bytes[44 + 600]).toBe(9);
    expect(out!.blob.type).toBe("audio/wav");
  });

  it("repairs a recording that never finalized (no patches)", async () => {
    const parts = [
      {
        index: 0,
        position: 0,
        blob: new Blob([headerWithZeroSizes(), new Uint8Array(300)]),
      },
      { index: 1, position: 344, blob: new Blob([new Uint8Array(200)]) },
    ];
    const out = await assembleWavFromChunks(parts);
    expect(out).not.toBeNull();
    expect(out!.finalized).toBe(false);
    expect(await sizes(out!.blob)).toEqual({
      riff: 544 - 8,
      data: 500,
      total: 544,
    });
  });

  it("treats chunks without positions as appends", async () => {
    const parts = [
      { index: 1, blob: new Blob([new Uint8Array(10)]) },
      { index: 0, blob: new Blob([headerWithZeroSizes()]) },
    ];
    const out = await assembleWavFromChunks(parts);
    expect(await sizes(out!.blob)).toEqual({ riff: 46, data: 10, total: 54 });
  });

  it("refuses a write that is neither append nor header patch", async () => {
    const parts = [
      { index: 0, position: 0, blob: new Blob([headerWithZeroSizes()]) },
      { index: 1, position: 10_000, blob: new Blob([new Uint8Array(4)]) },
    ];
    expect(await assembleWavFromChunks(parts)).toBeNull();
  });

  it("returns null for nothing", async () => {
    expect(await assembleWavFromChunks([])).toBeNull();
  });
});
