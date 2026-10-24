import { describe, it, expect } from "vitest";
import { selectTransport } from "./transport-select";

describe("selectTransport", () => {
  it("defaults to webrtc even in an all-Chromium room when no relay is configured", () => {
    expect(
      selectTransport({
        moqAvailable: true,
        webRtcAvailable: true,
        roomNeedsWebRtc: false,
      }),
    ).toBe("webrtc");
  });

  it("stays on webrtc when a relay is configured but has not answered a probe", () => {
    expect(
      selectTransport({
        moqAvailable: true,
        webRtcAvailable: true,
        roomNeedsWebRtc: false,
        relayConfigured: true,
        relayReady: false,
      }),
    ).toBe("webrtc");
  });

  it("picks moq only with a configured, probed relay and an all-capable room", () => {
    expect(
      selectTransport({
        moqAvailable: true,
        webRtcAvailable: true,
        roomNeedsWebRtc: false,
        relayConfigured: true,
        relayReady: true,
      }),
    ).toBe("moq");
  });

  it("picks webrtc when the local browser can't do moq", () => {
    expect(
      selectTransport({
        moqAvailable: false,
        webRtcAvailable: true,
        roomNeedsWebRtc: false,
        relayConfigured: true,
        relayReady: true,
      }),
    ).toBe("webrtc");
  });

  it("falls back to webrtc in a mixed room even with a working relay", () => {
    expect(
      selectTransport({
        moqAvailable: true,
        webRtcAvailable: true,
        roomNeedsWebRtc: true,
        relayConfigured: true,
        relayReady: true,
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

  it("keeps moq if local lacks webrtc and a relay works (defensive)", () => {
    expect(
      selectTransport({
        moqAvailable: true,
        webRtcAvailable: false,
        roomNeedsWebRtc: true,
        relayConfigured: true,
        relayReady: true,
      }),
    ).toBe("moq");
  });

  it("returns 'none' if local lacks webrtc and no relay is usable", () => {
    expect(
      selectTransport({
        moqAvailable: true,
        webRtcAvailable: false,
        roomNeedsWebRtc: false,
      }),
    ).toBe("none");
  });
});
