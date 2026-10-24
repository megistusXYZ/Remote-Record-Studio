import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRecordingMarkers } from "./use-recording-markers";

/**
 * Markers: press M (or the button) during a take to flag a moment. They are
 * kept on the server clock so they line up with every speaker's track, and
 * they survive a reload.
 */

const press = (key: string, target: EventTarget = window) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-24T10:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("recording markers", () => {
  it("drops a marker on the server clock when M is pressed during a take", () => {
    const { result } = renderHook(() =>
      useRecordingMarkers({
        sessionId: "s1",
        isRecording: true,
        serverOffsetMs: 250,
      }),
    );
    press("m");
    expect(result.current.markers).toEqual([
      {
        atServerMs: Date.parse("2026-10-24T10:00:00.000Z") + 250,
        label: "Marker 1",
      },
    ]);
  });

  it("ignores M outside a take, and while typing in a field such as chat", () => {
    const { result, rerender } = renderHook(
      (p: { isRecording: boolean }) =>
        useRecordingMarkers({
          sessionId: "s1",
          isRecording: p.isRecording,
          serverOffsetMs: 0,
        }),
      { initialProps: { isRecording: false } },
    );
    press("m");
    expect(result.current.markers).toHaveLength(0);

    rerender({ isRecording: true });
    const input = document.createElement("input");
    document.body.appendChild(input);
    press("m", input);
    input.remove();
    expect(result.current.markers).toHaveLength(0);
  });

  it("lets the button name a marker", () => {
    const { result } = renderHook(() =>
      useRecordingMarkers({
        sessionId: "s1",
        isRecording: true,
        serverOffsetMs: 0,
      }),
    );
    act(() => result.current.addMarker("Cut this"));
    expect(result.current.markers.map((m) => m.label)).toEqual(["Cut this"]);
  });

  it("keeps a session's markers through a reload", () => {
    const first = renderHook(() =>
      useRecordingMarkers({
        sessionId: "s1",
        isRecording: true,
        serverOffsetMs: 0,
      }),
    );
    press("m");
    first.unmount();
    const again = renderHook(() =>
      useRecordingMarkers({
        sessionId: "s1",
        isRecording: false,
        serverOffsetMs: 0,
      }),
    );
    expect(again.result.current.markers).toHaveLength(1);
    const other = renderHook(() =>
      useRecordingMarkers({
        sessionId: "s2",
        isRecording: false,
        serverOffsetMs: 0,
      }),
    );
    expect(other.result.current.markers).toHaveLength(0);
  });
});
