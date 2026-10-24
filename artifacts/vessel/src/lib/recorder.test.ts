import { describe, it, expect, afterEach } from "vitest";
import { pickSupportedMimeType, __test__, ChunkedRecorder, DualChunkedRecorder } from "./recorder";

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

// ---------------------------------------------------------------------------
// Durability: every slice is offered to storage, stop() waits for the writes.
// ---------------------------------------------------------------------------

function installSlicingMockMediaRecorder(slicesBeforeStop: number) {
  (globalThis as any).MediaRecorder = class {
    static isTypeSupported(): boolean { return true; }
    ondataavailable: ((ev: any) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: ((ev: any) => void) | null = null;
    state: "inactive" | "recording" = "inactive";
    requestDataCalls = 0;
    constructor(_stream: unknown, _opts?: { mimeType?: string }) {}
    start(_timesliceMs?: number): void {
      this.state = "recording";
      // Slice i is i+1 bytes long so tests can tell slices apart by size
      // (jsdom's Blob has no text()).
      for (let i = 0; i < slicesBeforeStop; i++) {
        queueMicrotask(() => this.ondataavailable?.({ data: new Blob(["x".repeat(i + 1)], { type: "video/webm" }) }));
      }
    }
    requestData(): void {
      this.requestDataCalls += 1;
      queueMicrotask(() => this.ondataavailable?.({ data: new Blob(["flushed"], { type: "video/webm" }) }));
    }
    stop(): void {
      this.state = "inactive";
      queueMicrotask(() => {
        // The final slice is always 100 bytes.
        this.ondataavailable?.({ data: new Blob(["z".repeat(100)], { type: "video/webm" }) });
        this.onstop?.();
      });
    }
  };
  (globalThis as any).MediaStream = FakeMediaStream;
}

describe("ChunkedRecorder — durable slices", () => {
  afterEach(() => uninstallDualMock());

  it("offers every slice, including the final one, to the sink before stop() resolves", async () => {
    installSlicingMockMediaRecorder(2);
    const written: Array<{ index: number; size: number }> = [];
    let pendingResolve: (() => void) | null = null;
    const sink = async (index: number, blob: Blob) => {
      // Hold the final write open to prove stop() waits for it.
      if (blob.size === 100) {
        await new Promise<void>((resolve) => { pendingResolve = resolve; });
      }
      written.push({ index, size: blob.size });
    };

    const rec = new ChunkedRecorder();
    rec.start({ stream: new FakeMediaStream([new FakeTrack("audio")]) as unknown as MediaStream, persistChunk: sink });

    let stopped = false;
    const stopPromise = rec.stop().then((blob) => { stopped = true; return blob; });
    // Let the microtasks run: slices 0, 1 and "last" are captured; "last" is held.
    await new Promise((r) => setTimeout(r, 0));
    expect(rec.getPersistStats().captured).toBe(3);
    expect(stopped).toBe(false);

    pendingResolve!();
    const blob = await stopPromise;
    expect(stopped).toBe(true);
    expect(written.map((w) => w.size).sort((a, b) => a - b)).toEqual([1, 2, 100]);
    expect(rec.getPersistStats()).toEqual({ captured: 3, persisted: 3, failed: 0 });
    expect(blob.size).toBe(103);
  });

  it("counts a failed write without losing the slice from the final blob", async () => {
    installSlicingMockMediaRecorder(1);
    const events: string[] = [];
    const rec = new ChunkedRecorder();
    rec.on((ev) => events.push(ev.type));
    rec.start({
      stream: new FakeMediaStream([new FakeTrack("audio")]) as unknown as MediaStream,
      persistChunk: async (index) => {
        if (index === 0) throw new DOMException("full", "QuotaExceededError");
      },
    });
    const blob = await rec.stop();
    expect(rec.getPersistStats()).toEqual({ captured: 2, persisted: 1, failed: 1 });
    expect(events).toContain("chunk-persist-failed");
    expect(events).toContain("chunk-persisted");
    expect(blob.size).toBe(101);
  });

  it("flush() asks MediaRecorder for its buffered data while recording", async () => {
    installSlicingMockMediaRecorder(0);
    const rec = new ChunkedRecorder();
    rec.start({ stream: new FakeMediaStream([new FakeTrack("audio")]) as unknown as MediaStream });
    rec.flush();
    await new Promise((r) => setTimeout(r, 0));
    expect(rec.getChunkCount()).toBe(1);
    await rec.stop();
    rec.flush(); // no-op after stop
    expect(rec.getChunkCount()).toBe(2);
  });

  it("stamps a start time and reports it through the dual recorder", async () => {
    installSlicingMockMediaRecorder(0);
    const before = Date.now();
    const rec = new DualChunkedRecorder();
    rec.start({ stream: new FakeMediaStream([new FakeTrack("audio")]) as unknown as MediaStream });
    const result = await rec.stop();
    expect(result.startedAtMs).toBeGreaterThanOrEqual(before);
    expect(result.startedAtMs).toBeLessThanOrEqual(Date.now());
    expect(result.persistStats.captured).toBeGreaterThan(0);
  });
});
