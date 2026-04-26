import { describe, it, expect, afterEach } from "vitest";
import { pickSupportedMimeType, __test__, DualChunkedRecorder } from "./recorder";

const realMediaRecorder = (globalThis as any).MediaRecorder;

function installMockMediaRecorder(supported: Set<string>) {
  (globalThis as any).MediaRecorder = class {
    static isTypeSupported(m: string): boolean {
      return supported.has(m);
    }
  };
}

function uninstallMockMediaRecorder() {
  if (realMediaRecorder === undefined) {
    delete (globalThis as any).MediaRecorder;
  } else {
    (globalThis as any).MediaRecorder = realMediaRecorder;
  }
}

describe("pickSupportedMimeType", () => {
  afterEach(() => uninstallMockMediaRecorder());

  it("returns empty string when MediaRecorder is unavailable", () => {
    delete (globalThis as any).MediaRecorder;
    expect(pickSupportedMimeType(["video/webm"])).toBe("");
  });

  it("returns the first supported candidate from the preferred list", () => {
    installMockMediaRecorder(new Set(["video/webm;codecs=vp8,opus"]));
    const got = pickSupportedMimeType([
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ]);
    expect(got).toBe("video/webm;codecs=vp8,opus");
  });

  it("returns empty string when no candidate is supported", () => {
    installMockMediaRecorder(new Set());
    expect(pickSupportedMimeType(["video/webm", "audio/webm"])).toBe("");
  });

  it("falls back to the default list when called with no preferences", () => {
    installMockMediaRecorder(new Set(["video/webm"]));
    expect(pickSupportedMimeType()).toBe("video/webm");
  });
});

describe("dual-recorder mime preference lists", () => {
  it("audio preferences are audio-codec only — never video", () => {
    for (const m of __test__.AUDIO_MIME_PREFERENCES()) {
      expect(m.startsWith("audio/")).toBe(true);
    }
  });

  it("video-only preferences are video-container only and never include opus", () => {
    for (const m of __test__.VIDEO_ONLY_MIME_PREFERENCES()) {
      expect(m.startsWith("video/")).toBe(true);
      expect(m.toLowerCase()).not.toContain("opus");
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Dual-recorder lifecycle / failure isolation
//
// Each of the three internal recorders (combined V+A, audio-only, video-only)
// must run independently. A failure in one path must NEVER prevent the
// others from finalizing — that's the contract that lets the host keep the
// session even when the audio-only or video-only sibling can't start.

class FakeTrack {
  constructor(public kind: "audio" | "video") {}
  stop() {}
}
class FakeMediaStream {
  private readonly tracks: FakeTrack[];
  constructor(tracks: FakeTrack[]) {
    this.tracks = tracks;
  }
  getAudioTracks() { return this.tracks.filter((t) => t.kind === "audio"); }
  getVideoTracks() { return this.tracks.filter((t) => t.kind === "video"); }
  getTracks() { return this.tracks.slice(); }
}

type ChannelKind = "combined" | "audio" | "video";

function classify(stream: FakeMediaStream): ChannelKind {
  const a = stream.getAudioTracks().length;
  const v = stream.getVideoTracks().length;
  if (a > 0 && v > 0) return "combined";
  if (a > 0 && v === 0) return "audio";
  return "video";
}

function installDualMockMediaRecorder(failing: Set<ChannelKind>) {
  const supported = new Set([
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "audio/webm;codecs=opus",
    "audio/webm",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
  ]);
  (globalThis as any).MediaRecorder = class {
    static isTypeSupported(m: string): boolean { return supported.has(m); }
    ondataavailable: ((ev: any) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: ((ev: any) => void) | null = null;
    private kind: ChannelKind;
    private mime: string;
    constructor(stream: FakeMediaStream, opts?: { mimeType?: string }) {
      this.kind = classify(stream);
      this.mime = opts?.mimeType || "video/webm";
      if (failing.has(this.kind)) {
        throw new Error(`Mock failure for ${this.kind} recorder`);
      }
    }
    start(_timesliceMs?: number): void {}
    stop(): void {
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob(["x"], { type: this.mime }) });
        this.onstop?.();
      });
    }
  };
  (globalThis as any).MediaStream = FakeMediaStream;
}

function uninstallDualMock() {
  uninstallMockMediaRecorder();
  delete (globalThis as any).MediaStream;
}

describe("DualChunkedRecorder — failure isolation", () => {
  afterEach(() => uninstallDualMock());

  it("audio-only failure does not affect combined or video-only", async () => {
    installDualMockMediaRecorder(new Set(["audio"]));
    const stream = new FakeMediaStream([new FakeTrack("video"), new FakeTrack("audio")]);
    const rec = new DualChunkedRecorder();
    rec.start({ stream: stream as unknown as MediaStream, timesliceMs: 1000 });
    const result = await rec.stop();
    expect(result.combinedBlob).toBeInstanceOf(Blob);
    expect(result.combinedBlob.size).toBeGreaterThan(0);
    expect(result.audioBlob).toBeNull();
    expect(result.audioRecordingOk).toBe(false);
    expect(result.videoOnlyBlob).toBeInstanceOf(Blob);
    expect(result.videoRecordingOk).toBe(true);
    expect(result.hasVideo).toBe(true);
  });

  it("video-only failure does not affect combined or audio-only", async () => {
    installDualMockMediaRecorder(new Set(["video"]));
    const stream = new FakeMediaStream([new FakeTrack("video"), new FakeTrack("audio")]);
    const rec = new DualChunkedRecorder();
    rec.start({ stream: stream as unknown as MediaStream, timesliceMs: 1000 });
    const result = await rec.stop();
    expect(result.combinedBlob).toBeInstanceOf(Blob);
    expect(result.audioBlob).toBeInstanceOf(Blob);
    expect(result.audioRecordingOk).toBe(true);
    expect(result.videoOnlyBlob).toBeNull();
    expect(result.videoRecordingOk).toBe(false);
  });

  it("combined-only stream (no camera) skips the video-only path cleanly", async () => {
    installDualMockMediaRecorder(new Set());
    const stream = new FakeMediaStream([new FakeTrack("audio")]);
    const rec = new DualChunkedRecorder();
    rec.start({ stream: stream as unknown as MediaStream, timesliceMs: 1000 });
    const result = await rec.stop();
    expect(result.combinedBlob).toBeInstanceOf(Blob);
    expect(result.audioBlob).toBeInstanceOf(Blob);
    expect(result.videoOnlyBlob).toBeNull();
    expect(result.hasVideo).toBe(false);
  });
});
