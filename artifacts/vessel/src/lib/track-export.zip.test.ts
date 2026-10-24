// @vitest-environment node
import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { buildZipBlob, type TrackSelection } from "./track-export";

function selection(
  name: string,
  stream: TrackSelection["stream"],
  blob: Blob,
  extra: Partial<TrackSelection["source"]> = {},
): TrackSelection {
  return {
    stream,
    source: {
      participantName: name,
      combinedBlobUrl: null,
      combinedMimeType: "video/webm",
      combinedBlob: stream === "video+audio" ? blob : null,
      audioBlob: stream === "audio-only" ? blob : null,
      audioMimeType: "audio/wav",
      ...extra,
    },
  };
}

describe("track-export: streamed bundle", () => {
  it("stores each file under its participant folder and writes a tracks.json sidecar", async () => {
    const video = new Blob([new Uint8Array(5000).fill(1)], {
      type: "video/webm",
    });
    const audio = new Blob([new Uint8Array(3000).fill(2)], {
      type: "audio/wav",
    });
    const result = await buildZipBlob([
      selection("Sam Host", "video+audio", video, {
        durationSeconds: 120,
        startedAtMs: 1_700_000_000_000,
        serverOffsetMs: -250,
      }),
      selection("Sam Host", "audio-only", audio),
      selection("Guest One", "audio-only", new Blob([]), { audioBlob: null }),
    ]);

    expect(result.blob).not.toBeNull();
    expect(result.includedFilenames).toEqual([
      "Sam_Host/Sam_Host-video-audio.webm",
      "Sam_Host_2/Sam_Host-audio.wav",
    ]);
    expect(result.skipped).toEqual([
      {
        participantName: "Guest One",
        reason: "Audio-only file isn't available.",
      },
    ]);

    const files = unzipSync(new Uint8Array(await result.blob!.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual([
      "Sam_Host/Sam_Host-video-audio.webm",
      "Sam_Host_2/Sam_Host-audio.wav",
      "tracks.json",
    ]);
    expect(files["Sam_Host/Sam_Host-video-audio.webm"]!.byteLength).toBe(5000);
    expect(files["Sam_Host/Sam_Host-video-audio.webm"]![0]).toBe(1);
    expect(files["Sam_Host_2/Sam_Host-audio.wav"]!.byteLength).toBe(3000);

    const sidecar = JSON.parse(strFromU8(files["tracks.json"]!));
    expect(sidecar.format).toBe("vessel-bundle");
    expect(sidecar.tracks).toHaveLength(2);
    expect(sidecar.tracks[0]).toMatchObject({
      file: "Sam_Host/Sam_Host-video-audio.webm",
      participant: "Sam Host",
      stream: "video+audio",
      sizeBytes: 5000,
      durationSeconds: 120,
      startedAtMs: 1_700_000_000_000,
      serverOffsetMs: -250,
      startedAtServerMs: 1_699_999_999_750,
    });
    expect(sidecar.tracks[1].startedAtServerMs).toBeNull();
  });

  it("returns no blob when nothing resolves", async () => {
    const result = await buildZipBlob([
      selection("Nobody", "audio-only", new Blob([]), { audioBlob: null }),
    ]);
    expect(result.blob).toBeNull();
    expect(result.includedFilenames).toEqual([]);
    expect(result.skipped).toHaveLength(1);
  });
});
