import { describe, it, expect } from "vitest";
import {
  buildExportFilename,
  hasScreenExport,
  resolveStreamBlob,
  type TrackExportSource,
} from "./track-export";

function makeSource(overrides: Partial<TrackExportSource> = {}): TrackExportSource {
  return {
    participantName: "Alex",
    combinedBlobUrl: null,
    combinedMimeType: "video/webm",
    ...overrides,
  };
}

describe("buildExportFilename — screen-only", () => {
  it("appends `-screen` and respects the webm container", () => {
    expect(buildExportFilename("Alex", "screen-only", "video/webm")).toBe(
      "Alex-screen.webm",
    );
  });

  it("falls back to webm when no mime type is supplied", () => {
    expect(buildExportFilename("Alex", "screen-only", null)).toBe(
      "Alex-screen.webm",
    );
  });

  it("sanitises spaces and unsafe characters in the participant name", () => {
    expect(buildExportFilename("Dr. Jane / Smith", "screen-only", "video/webm")).toBe(
      "Dr._Jane_Smith-screen.webm",
    );
  });

  it("does not collide with the audio/video/combined filename suffixes", () => {
    const screen = buildExportFilename("Alex", "screen-only", "video/webm");
    const audio = buildExportFilename("Alex", "audio-only", "audio/webm");
    const video = buildExportFilename("Alex", "video-only", "video/webm");
    const combined = buildExportFilename("Alex", "video+audio", "video/webm");
    expect(new Set([screen, audio, video, combined]).size).toBe(4);
  });
});

describe("hasScreenExport", () => {
  it("is false when none of the three screen slots are populated", () => {
    expect(hasScreenExport(makeSource())).toBe(false);
  });

  it("is true when only the in-memory blob is set (just-recorded local case)", () => {
    expect(hasScreenExport(makeSource({ screenBlob: new Blob(["x"]) }))).toBe(true);
  });

  it("is true when only the local idb URL is set (resumed-from-storage case)", () => {
    expect(
      hasScreenExport(makeSource({ screenLocalUrl: "idb://rec_abc:screen" })),
    ).toBe(true);
  });

  it("is true when only the remote URL is set (cross-device recipient case)", () => {
    expect(
      hasScreenExport(
        makeSource({ screenRemoteUrl: "https://storage.example/x" }),
      ),
    ).toBe(true);
  });
});

describe("resolveStreamBlob — screen-only refuses to fall back", () => {
  it("returns null when the source has no screen sibling — never silently substitutes V+A", async () => {
    const source = makeSource({
      combinedBlob: new Blob(["camera bytes"]),
      combinedBlobUrl: "https://storage.example/combined",
    });
    const blob = await resolveStreamBlob({ source, stream: "screen-only" });
    expect(blob).toBeNull();
  });

  it("returns the in-memory screen blob when present (preferred over any URL)", async () => {
    const screen = new Blob(["screen bytes"]);
    const source = makeSource({
      screenBlob: screen,
      screenRemoteUrl: "https://storage.example/screen",
    });
    const blob = await resolveStreamBlob({ source, stream: "screen-only" });
    expect(blob).toBe(screen);
  });
});
