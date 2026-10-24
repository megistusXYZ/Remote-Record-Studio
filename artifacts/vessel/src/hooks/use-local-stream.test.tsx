import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useLocalStream } from "./use-media-devices";

/**
 * Turning the camera off must actually free it, so the camera light goes
 * out, except while a take is recording: the recording spec stops a
 * recorder whose tracks change, so then the picture is blanked and the
 * camera is released when the take ends.
 */

class FakeTrack {
  enabled = true;
  readyState: "live" | "ended" = "live";
  constructor(readonly kind: "audio" | "video") {}
  stop = vi.fn(() => {
    this.readyState = "ended";
  });
}

class FakeStream {
  private tracks: FakeTrack[];
  constructor(tracks: FakeTrack[]) {
    this.tracks = tracks;
  }
  getTracks() {
    return [...this.tracks];
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === "audio");
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === "video");
  }
  addTrack(t: FakeTrack) {
    this.tracks.push(t);
  }
  removeTrack(t: FakeTrack) {
    this.tracks = this.tracks.filter((x) => x !== t);
  }
}

const getUserMedia = vi.fn(async (c: MediaStreamConstraints) => {
  const tracks: FakeTrack[] = [];
  if (c.audio) tracks.push(new FakeTrack("audio"));
  if (c.video) tracks.push(new FakeTrack("video"));
  return new FakeStream(tracks) as unknown as MediaStream;
});

beforeEach(() => {
  getUserMedia.mockClear();
  (globalThis as unknown as { MediaStream: unknown }).MediaStream = FakeStream;
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia },
    configurable: true,
  });
});

type Props = { cameraEnabled: boolean; keepTracks?: boolean };

function render(initial: Props) {
  return renderHook(
    (p: Props) =>
      useLocalStream({
        cameraId: null,
        micId: null,
        micEnabled: true,
        cameraEnabled: p.cameraEnabled,
        keepTracks: p.keepTracks,
      }),
    { initialProps: initial },
  );
}

describe("camera off", () => {
  it("frees the camera so its light goes out, and keeps the microphone", async () => {
    const { result, rerender } = render({ cameraEnabled: true });
    await waitFor(() => expect(result.current.stream).not.toBeNull());
    const stream = result.current.stream as unknown as FakeStream;
    const camera = stream.getVideoTracks()[0]!;

    act(() => rerender({ cameraEnabled: false }));

    await waitFor(() => expect(camera.stop).toHaveBeenCalled());
    const after = result.current.stream as unknown as FakeStream;
    expect(after.getVideoTracks()).toHaveLength(0);
    // Same microphone, uninterrupted.
    expect(after.getAudioTracks()[0]).toBe(stream.getAudioTracks()[0]);
    expect(after.getAudioTracks()[0]!.readyState).toBe("live");
  });

  it("brings the camera back when turned on again, keeping the same microphone", async () => {
    const { result, rerender } = render({ cameraEnabled: true });
    await waitFor(() => expect(result.current.stream).not.toBeNull());
    const mic = (
      result.current.stream as unknown as FakeStream
    ).getAudioTracks()[0];
    act(() => rerender({ cameraEnabled: false }));
    await waitFor(() =>
      expect(
        (result.current.stream as unknown as FakeStream).getVideoTracks(),
      ).toHaveLength(0),
    );

    act(() => rerender({ cameraEnabled: true }));

    await waitFor(() =>
      expect(
        (result.current.stream as unknown as FakeStream).getVideoTracks(),
      ).toHaveLength(1),
    );
    const after = result.current.stream as unknown as FakeStream;
    expect(after.getVideoTracks()[0]!.readyState).toBe("live");
    expect(after.getAudioTracks()[0]).toBe(mic);
  });

  it("only blanks the picture during a take, then frees the camera when it ends", async () => {
    const { result, rerender } = render({
      cameraEnabled: true,
      keepTracks: true,
    });
    await waitFor(() => expect(result.current.stream).not.toBeNull());
    const stream = result.current.stream as unknown as FakeStream;
    const camera = stream.getVideoTracks()[0]!;

    act(() => rerender({ cameraEnabled: false, keepTracks: true }));
    await waitFor(() => expect(camera.enabled).toBe(false));
    expect(camera.stop).not.toHaveBeenCalled();
    expect(stream.getVideoTracks()).toHaveLength(1);

    act(() => rerender({ cameraEnabled: false, keepTracks: false }));
    await waitFor(() => expect(camera.stop).toHaveBeenCalled());
  });
});
