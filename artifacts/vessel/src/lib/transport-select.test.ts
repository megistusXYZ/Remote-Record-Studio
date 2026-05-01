import { describe, it, expect } from "vitest";
import { selectTransport } from "./transport-select";

describe("selectTransport", () => {
  it("picks moq when only moq is needed and the room is all-Chromium", () => {
    expect(
      selectTransport({
        moqAvailable: true,
        webRtcAvailable: true,
        roomNeedsWebRtc: false,
      }),
    ).toBe("moq");
  });

  it("picks webrtc when the local browser can't do moq", () => {
    expect(
      selectTransport({
        moqAvailable: false,
        webRtcAvailable: true,
        roomNeedsWebRtc: false,
      }),
    ).toBe("webrtc");
  });

  it("falls back to webrtc in a mixed room even when local can do moq", () => {
    expect(
      selectTransport({
        moqAvailable: true,
        webRtcAvailable: true,
        roomNeedsWebRtc: true,
      }),
    ).toBe("webrtc");
  });

  it("returns 'none' when no transport works at all", () => {
    expect(
      selectTransport({
        moqAvailable: false,
        webRtcAvailable: false,
        roomNeedsWebRtc: false,
      }),
    ).toBe("none");
  });

  it("keeps moq if local lacks webrtc even when room signaled it (defensive)", () => {
    // The defensive branch: every browser shipping WebTransport in
    // practice also ships WebRTC, but if a user lands on something
    // exotic, we'd rather keep publishing on MoQ for the Chromium peers
    // than disconnect entirely.
    expect(
      selectTransport({
        moqAvailable: true,
        webRtcAvailable: false,
        roomNeedsWebRtc: true,
      }),
    ).toBe("moq");
  });
});
