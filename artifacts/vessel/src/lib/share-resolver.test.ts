import { describe, it, expect } from "vitest";
import { parseManifestTrack } from "./share-resolver";

describe("parseManifestTrack — v1/v2/v3 schema", () => {
  it("parses a v=1 manifest track (no audio or video sibling)", () => {
    const t = parseManifestTrack({
      recordingId: "rec-1",
      participantName: "Alice",
      participantPubkey: "abc",
      durationSeconds: 30,
      sizeBytes: 12345,
      mimeType: "video/webm",
      url: "https://blossom.example/v1.webm",
      hash: "deadbeef",
      eventId: "evt-1",
    });
    expect(t.url).toBe("https://blossom.example/v1.webm");
    expect(t.audio).toBeNull();
    expect(t.video).toBeNull();
  });

  it("parses a v=2 manifest track with an audio sibling but no video sibling", () => {
    const t = parseManifestTrack({
      recordingId: "rec-2",
      participantName: "Bob",
      mimeType: "video/webm",
      url: "https://blossom.example/combined.webm",
      hash: "cafebabe",
      audio: {
        url: "https://blossom.example/audio.webm",
        hash: "f00d",
        sizeBytes: 50000,
        mimeType: "audio/webm",
      },
    });
    expect(t.audio?.url).toBe("https://blossom.example/audio.webm");
    expect(t.video).toBeNull();
  });

  it("parses a v=3 manifest track with both audio and video siblings", () => {
    const t = parseManifestTrack({
      recordingId: "rec-3",
      participantName: "Carol",
      mimeType: "video/webm",
      url: "https://blossom.example/combined.webm",
      hash: "abc123",
      audio: {
        url: "https://blossom.example/audio.webm",
        hash: "audhash",
        sizeBytes: 50000,
        mimeType: "audio/webm",
      },
      video: {
        url: "https://blossom.example/video.webm",
        hash: "vidhash",
        sizeBytes: 800000,
        mimeType: "video/webm",
      },
    });
    expect(t.audio?.url).toBe("https://blossom.example/audio.webm");
    expect(t.video?.url).toBe("https://blossom.example/video.webm");
    expect(t.video?.hash).toBe("vidhash");
    expect(t.video?.sizeBytes).toBe(800000);
    expect(t.video?.mimeType).toBe("video/webm");
  });

  it("treats a non-object video field as no sibling", () => {
    const t = parseManifestTrack({ recordingId: "x", video: "garbage" });
    expect(t.video).toBeNull();
  });

  it("fills missing video sub-fields with safe defaults", () => {
    const t = parseManifestTrack({ recordingId: "x", video: {} });
    expect(t.video).not.toBeNull();
    expect(t.video?.url).toBeNull();
    expect(t.video?.hash).toBeNull();
    expect(t.video?.sizeBytes).toBe(0);
    expect(t.video?.mimeType).toBe("video/webm");
  });

  it("coerces missing fields to safe defaults instead of throwing", () => {
    const t = parseManifestTrack({});
    expect(t.recordingId).toBe("");
    expect(t.participantName).toBe("Unknown");
    expect(t.audio).toBeNull();
    expect(t.video).toBeNull();
  });

  it("treats a non-object audio field as no sibling", () => {
    const t = parseManifestTrack({ recordingId: "x", audio: "garbage" });
    expect(t.audio).toBeNull();
  });

  it("never throws on null/undefined input", () => {
    expect(() => parseManifestTrack(null)).not.toThrow();
    expect(() => parseManifestTrack(undefined)).not.toThrow();
    expect(parseManifestTrack(null).participantName).toBe("Unknown");
  });
});
