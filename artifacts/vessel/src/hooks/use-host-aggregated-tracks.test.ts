import { describe, it, expect } from "vitest";
import {
  parseShareUrl,
  KIND_PERSONAL_ARCHIVE_POINTER,
  POINTER_LISTEN_WINDOW_MS,
  computePointerWaitState,
  buildExportSource,
  shouldPublishPersonalArchive,
  deriveHostRowStorageState,
  computeWaitingForPubkeys,
} from "./use-host-aggregated-tracks";
import type { RecipientTrack } from "../lib/share-resolver";
import {
  hasAudioOnlyExport,
  hasVideoOnlyExport,
  buildExportFilename,
} from "../lib/track-export";

describe("KIND_PERSONAL_ARCHIVE_POINTER", () => {
  it("uses kind 27006 (parameterized replaceable, app-scoped)", () => {
    expect(KIND_PERSONAL_ARCHIVE_POINTER).toBe(27006);
    expect(KIND_PERSONAL_ARCHIVE_POINTER).toBeGreaterThanOrEqual(20000);
    expect(KIND_PERSONAL_ARCHIVE_POINTER).toBeLessThan(30000);
  });
});

describe("parseShareUrl", () => {
  it("parses a root-mounted share URL with a fragment key", () => {
    const got = parseShareUrl("https://vessel.example/s/abc123#k=xyz");
    expect(got).toEqual({ pointer: "abc123", fragment: "#k=xyz" });
  });

  it("parses a base-pathed share URL (artifact under /vessel)", () => {
    const got = parseShareUrl("https://app.example/vessel/s/abc123#k=xyz");
    expect(got).toEqual({ pointer: "abc123", fragment: "#k=xyz" });
  });

  it("returns null for empty or non-URL input", () => {
    expect(parseShareUrl("")).toBeNull();
    expect(parseShareUrl("not a url")).toBeNull();
  });

  it("returns null when the path has no /s/<pointer> segment", () => {
    expect(parseShareUrl("https://vessel.example/about")).toBeNull();
    expect(parseShareUrl("https://vessel.example/s/")).toBeNull();
  });

  it("returns an empty fragment when no hash is present", () => {
    const got = parseShareUrl("https://vessel.example/s/abc");
    expect(got).toEqual({ pointer: "abc", fragment: "" });
  });
});

describe("computePointerWaitState (host pointer-listen window)", () => {
  it("does not wait while the call is still live (sessionEndedAtMs == null)", () => {
    const got = computePointerWaitState({
      enabled: true,
      sessionEndedAtMs: null,
      nowMs: 1_000_000,
    });
    expect(got).toEqual({ isWaiting: false, remainingMs: 0 });
  });

  it("does not wait when the hook is disabled (non-host)", () => {
    const got = computePointerWaitState({
      enabled: false,
      sessionEndedAtMs: 1_000_000,
      nowMs: 1_000_000,
    });
    expect(got).toEqual({ isWaiting: false, remainingMs: 0 });
  });

  it("starts a full-length window the instant the session ends", () => {
    const endedAt = 5_000_000;
    const got = computePointerWaitState({
      enabled: true,
      sessionEndedAtMs: endedAt,
      nowMs: endedAt,
    });
    expect(got.isWaiting).toBe(true);
    expect(got.remainingMs).toBe(POINTER_LISTEN_WINDOW_MS);
  });

  it("counts down with elapsed time after session end", () => {
    const endedAt = 5_000_000;
    const got = computePointerWaitState({
      enabled: true,
      sessionEndedAtMs: endedAt,
      nowMs: endedAt + 30_000, // 30s into the window
    });
    expect(got.isWaiting).toBe(true);
    expect(got.remainingMs).toBe(POINTER_LISTEN_WINDOW_MS - 30_000);
  });

  it("stops waiting once the window elapses", () => {
    const endedAt = 5_000_000;
    const got = computePointerWaitState({
      enabled: true,
      sessionEndedAtMs: endedAt,
      nowMs: endedAt + POINTER_LISTEN_WINDOW_MS,
    });
    expect(got).toEqual({ isWaiting: false, remainingMs: 0 });
  });

  it("does not preemptively expire after a long call — pegs to session-end, not mount", () => {
    const endedAt = 90 * 60 * 1000;
    const got = computePointerWaitState({
      enabled: true,
      sessionEndedAtMs: endedAt,
      nowMs: endedAt + 100,
    });
    expect(got.isWaiting).toBe(true);
    expect(got.remainingMs).toBeGreaterThan(POINTER_LISTEN_WINDOW_MS - 1_000);
  });
});

describe("Host aggregation 2-participant smoke", () => {
  function makeTrack(participantName: string, participantPubkey: string): RecipientTrack {
    return {
      participantName,
      participantPubkey,
      url: `https://blossom.example/${participantPubkey}/combined`,
      mimeType: "video/webm",
      sizeBytes: 100,
      durationSeconds: 30,
      hash: `hash-combined-${participantPubkey}`,
      audio: {
        url: `https://blossom.example/${participantPubkey}/audio`,
        mimeType: "audio/webm",
        sizeBytes: 20,
        hash: `hash-audio-${participantPubkey}`,
      },
      video: {
        url: `https://blossom.example/${participantPubkey}/video`,
        mimeType: "video/webm",
        sizeBytes: 80,
        hash: `hash-video-${participantPubkey}`,
      },
    } as RecipientTrack;
  }

  it("derives audio + video descriptors for two participants and produces honest per-stream filenames", () => {
    const ada = makeTrack("Ada", "pkAda");
    const grace = makeTrack("Grace", "pkGrace");

    const adaSrc = buildExportSource(ada);
    const graceSrc = buildExportSource(grace);

    // Both rows surface true audio-only AND true video-only descriptors —
    // never a V+A fallback.
    expect(hasAudioOnlyExport(adaSrc)).toBe(true);
    expect(hasVideoOnlyExport(adaSrc)).toBe(true);
    expect(hasAudioOnlyExport(graceSrc)).toBe(true);
    expect(hasVideoOnlyExport(graceSrc)).toBe(true);

    expect(adaSrc.audioBlobUrl).toBe("https://blossom.example/pkAda/audio");
    expect(adaSrc.videoOnlyRemoteUrl).toBe("https://blossom.example/pkAda/video");
    expect(graceSrc.audioBlobUrl).toBe("https://blossom.example/pkGrace/audio");
    expect(graceSrc.videoOnlyRemoteUrl).toBe("https://blossom.example/pkGrace/video");

    expect(buildExportFilename("Ada", "video+audio", "video/webm")).toMatch(/Ada/);
    expect(buildExportFilename("Ada", "audio-only", "audio/webm")).toMatch(/audio/i);
    expect(buildExportFilename("Ada", "video-only", "video/webm")).toMatch(/video/i);
    expect(buildExportFilename("Grace", "video-only", "video/webm")).toMatch(/Grace/);
  });

  it("video-only filename extension derives from videoOnlyMimeType, not combinedMimeType", () => {
    expect(buildExportFilename("Ada", "video-only", "video/mp4")).toMatch(/\.mp4$/);
    expect(buildExportFilename("Ada", "video-only", "video/webm")).toMatch(/\.webm$/);
    expect(buildExportFilename("Ada", "video+audio", "video/mp4")).toMatch(/\.mp4$/);
    expect(buildExportFilename("Ada", "audio-only", "audio/mp4")).toMatch(/\.mp4$/);
    expect(buildExportFilename("Ada", "audio-only", "audio/webm")).toMatch(/\.webm$/);
  });

  it("computeWaitingForPubkeys drops a pubkey once it terminally errors (no perpetual stall)", () => {
    const accepted = ["pkAda", "pkGrace", "pkOscar"];
    const resolved = new Map<string, unknown>([["pkAda", {}]]);
    const resolveErrors = new Map<string, unknown>([
      ["pkGrace", "This link looks broken."],
    ]);

    expect(
      computeWaitingForPubkeys({ acceptedPubkeys: accepted, resolved, resolveErrors }),
    ).toEqual(["pkOscar"]);

    expect(
      computeWaitingForPubkeys({
        acceptedPubkeys: accepted,
        resolved: new Map(),
        resolveErrors: new Map(),
      }),
    ).toEqual(["pkAda", "pkGrace", "pkOscar"]);

    expect(
      computeWaitingForPubkeys({
        acceptedPubkeys: null,
        resolved: new Map(),
        resolveErrors: new Map(),
      }),
    ).toEqual([]);
  });

  it("computeWaitingForPubkeys accepts Set inputs as well as Maps", () => {
    expect(
      computeWaitingForPubkeys({
        acceptedPubkeys: ["pkAda", "pkGrace", "pkOscar"],
        resolved: new Set(["pkAda"]),
        resolveErrors: new Set(["pkGrace"]),
      }),
    ).toEqual(["pkOscar"]);
  });

  it("deriveHostRowStorageState marks rows 'unknown' when a sibling stream URL is missing", () => {
    expect(
      deriveHostRowStorageState({
        isVideoTrack: true,
        combinedRemoteUrl: "https://blossom.example/combined",
        audioSiblingRemoteUrl: "https://blossom.example/audio",
        videoSiblingRemoteUrl: "https://blossom.example/video",
      }),
    ).toBe("remote");

    expect(
      deriveHostRowStorageState({
        isVideoTrack: true,
        combinedRemoteUrl: "https://blossom.example/combined",
        audioSiblingRemoteUrl: "https://blossom.example/audio",
        videoSiblingRemoteUrl: null,
      }),
    ).toBe("unknown");

    expect(
      deriveHostRowStorageState({
        isVideoTrack: true,
        combinedRemoteUrl: "https://blossom.example/combined",
        audioSiblingRemoteUrl: null,
        videoSiblingRemoteUrl: "https://blossom.example/video",
      }),
    ).toBe("unknown");

    expect(
      deriveHostRowStorageState({
        isVideoTrack: false,
        combinedRemoteUrl: "https://blossom.example/combined",
        audioSiblingRemoteUrl: "https://blossom.example/audio",
        videoSiblingRemoteUrl: null,
      }),
    ).toBe("remote");

    expect(
      deriveHostRowStorageState({
        isVideoTrack: false,
        combinedRemoteUrl: null,
        audioSiblingRemoteUrl: "https://blossom.example/audio",
        videoSiblingRemoteUrl: null,
      }),
    ).toBe("unknown");
  });

  it("shouldPublishPersonalArchive allows partial-failure when combined remote URL/hash exist", () => {
    const goodResult = { blobUrl: "https://blossom.example/abc", blobHash: "h" };
    const noUpload = { blobUrl: null, blobHash: null };

    expect(shouldPublishPersonalArchive("complete", goodResult)).toBe(true);
    expect(shouldPublishPersonalArchive("partial-failure", goodResult)).toBe(true);
    expect(shouldPublishPersonalArchive("syncing", goodResult)).toBe(false);
    expect(shouldPublishPersonalArchive("idle", goodResult)).toBe(false);
    expect(shouldPublishPersonalArchive("complete", noUpload)).toBe(false);
    expect(shouldPublishPersonalArchive("partial-failure", noUpload)).toBe(false);
    expect(shouldPublishPersonalArchive("complete", null)).toBe(false);
  });

  it("preserves per-participant identity when both participants have parallel asset sets", () => {
    const ada = buildExportSource(makeTrack("Ada", "pkAda"));
    const grace = buildExportSource(makeTrack("Grace", "pkGrace"));

    expect(ada.combinedBlobUrl).not.toBe(grace.combinedBlobUrl);
    expect(ada.audioBlobUrl).not.toBe(grace.audioBlobUrl);
    expect(ada.videoOnlyRemoteUrl).not.toBe(grace.videoOnlyRemoteUrl);
    expect(ada.participantName).toBe("Ada");
    expect(grace.participantName).toBe("Grace");
  });

  it("hides audio/video-only export options when a participant's manifest omits the sibling block", () => {
    const audioOnlyMissing: RecipientTrack = {
      ...(makeTrack("Lonely", "pkLone") as RecipientTrack),
      audio: undefined,
    } as RecipientTrack;
    const videoOnlyMissing: RecipientTrack = {
      ...(makeTrack("Quiet", "pkQuiet") as RecipientTrack),
      video: undefined,
    } as RecipientTrack;

    const noAudio = buildExportSource(audioOnlyMissing);
    const noVideo = buildExportSource(videoOnlyMissing);

    expect(hasAudioOnlyExport(noAudio)).toBe(false);
    expect(hasVideoOnlyExport(noAudio)).toBe(true);
    expect(hasAudioOnlyExport(noVideo)).toBe(true);
    expect(hasVideoOnlyExport(noVideo)).toBe(false);
  });
});
