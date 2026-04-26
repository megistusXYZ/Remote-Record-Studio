import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useScreenShare } from "./use-screen-share";

/**
 * Regression tests for the structured-result API of `useScreenShare.start()`.
 *
 * The bug being guarded against: a previous version returned
 * `Promise<MediaStream | null>` and stored the error in React state. Callers
 * read `screenShare.error` immediately after `await start()` returned null —
 * but state hadn't flushed yet, so the error was stale (or null) and the
 * caller silently swallowed the failure. Now `start()` returns
 * `{ stream, error }` directly, eliminating the race entirely.
 *
 * If anyone ever regresses to reading errors from React state, these tests
 * will fail because they assert against the inline return value.
 */

type MockMediaDevices = {
  getDisplayMedia: ReturnType<typeof vi.fn>;
};

const originalNavigator = globalThis.navigator;

function setupNavigator(getDisplayMedia: ReturnType<typeof vi.fn>) {
  const mockDevices: MockMediaDevices = { getDisplayMedia };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: mockDevices },
  });
}

beforeEach(() => {
  // each test sets up its own navigator
});

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: originalNavigator,
  });
});

function makeFakeStream(): MediaStream {
  const tracks: { stop: () => void; addEventListener: () => void }[] = [
    { stop: vi.fn(), addEventListener: vi.fn() },
  ];
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks,
  } as unknown as MediaStream;
}

describe("useScreenShare.start() structured result", () => {
  it("returns the stream inline on success — caller never has to read React state", async () => {
    const fakeStream = makeFakeStream();
    const getDisplayMedia = vi.fn().mockResolvedValue(fakeStream);
    setupNavigator(getDisplayMedia);

    const { result } = renderHook(() => useScreenShare());

    let startResult: Awaited<ReturnType<typeof result.current.start>> | undefined;
    await act(async () => {
      startResult = await result.current.start();
    });

    expect(startResult).toBeDefined();
    expect(startResult!.stream).toBe(fakeStream);
    expect(startResult!.error).toBeNull();
  });

  it("returns the error inline on a real failure (NotReadableError → 'in use' message, NOT cancelled)", async () => {
    const err = new Error("device busy");
    (err as DOMException & { name: string }).name = "NotReadableError";
    const getDisplayMedia = vi.fn().mockRejectedValue(err);
    setupNavigator(getDisplayMedia);

    const { result } = renderHook(() => useScreenShare());

    let startResult: Awaited<ReturnType<typeof result.current.start>> | undefined;
    await act(async () => {
      startResult = await result.current.start();
    });

    // CRITICAL: error must be on the resolved value, not just on React state.
    // This is what protects callers from the stale-state race.
    expect(startResult!.stream).toBeNull();
    expect(startResult!.error).not.toBeNull();
    expect(startResult!.error!.cancelled).toBe(false);
    expect(startResult!.error!.message).toMatch(/in use/i);
  });

  it("flags user-cancellation (NotAllowedError) so callers can stay quiet", async () => {
    const err = new Error("permission denied");
    (err as DOMException & { name: string }).name = "NotAllowedError";
    const getDisplayMedia = vi.fn().mockRejectedValue(err);
    setupNavigator(getDisplayMedia);

    const { result } = renderHook(() => useScreenShare());

    let startResult: Awaited<ReturnType<typeof result.current.start>> | undefined;
    await act(async () => {
      startResult = await result.current.start();
    });

    expect(startResult!.stream).toBeNull();
    expect(startResult!.error!.cancelled).toBe(true);
  });

  it("returns an inline error when getDisplayMedia is missing — no silent failure on unsupported browsers", async () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { mediaDevices: {} },
    });

    const { result } = renderHook(() => useScreenShare());

    let startResult: Awaited<ReturnType<typeof result.current.start>> | undefined;
    await act(async () => {
      startResult = await result.current.start();
    });

    expect(startResult!.stream).toBeNull();
    expect(startResult!.error).not.toBeNull();
    expect(startResult!.error!.cancelled).toBe(false);
    expect(startResult!.error!.message).toMatch(/isn't available|not available/i);
  });
});
