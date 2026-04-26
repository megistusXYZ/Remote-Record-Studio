import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useScreenShare — opens the browser's screen picker on demand and exposes
 * the resulting MediaStream alongside a clean stop affordance.
 *
 * Responsibilities:
 *   - Wrap `navigator.mediaDevices.getDisplayMedia()` (Chrome's
 *     screen-picker dialog) and surface friendly error states.
 *   - Track a single "sharing" lifecycle: at most one active stream at a
 *     time. Calling `start()` while already sharing is a no-op (the caller
 *     should `stop()` first).
 *   - Subscribe to the browser's native "ended" signal so when the user
 *     hits the in-browser "Stop sharing" bar we tear everything down with
 *     the same handoff as our own UI's Stop button.
 *
 * The hook is platform-agnostic — host and guest can both share. UI gating
 * (desktop-only button) lives in the control bar.
 *
 * No user-visible jargon: errors are mapped to plain language ("You blocked
 * the screen-share request" vs the raw DOMException name).
 */

export type ScreenShareError = {
  /** Plain-English message safe to show in a toast. */
  message: string;
  /** True when the user dismissed the picker (NotAllowedError). Callers
   *  usually treat this as a silent cancel rather than a hard failure. */
  cancelled: boolean;
};

/** Discriminated result of a `start()` attempt. We deliberately return
 *  the error inline (rather than asking callers to read it back from
 *  React state) because state updates aren't visible in the same call
 *  stack — so a freshly-failed start would otherwise see stale/null
 *  error and silently swallow the failure. */
export type ScreenShareStartResult =
  | { stream: MediaStream; error: null }
  | { stream: null; error: ScreenShareError };

export type UseScreenShareResult = {
  /** True iff this browser exposes `getDisplayMedia` at all. */
  isSupported: boolean;
  /** The active screen MediaStream, or null when not sharing. */
  stream: MediaStream | null;
  /** True while the screen picker is open AND while the share is active. */
  isSharing: boolean;
  /** Most recent capture error, cleared on the next successful `start()`
   *  or explicit `stop()`. Mirrored from the last `start()` result so
   *  components can render persistent error UI; transient toasts should
   *  use the value returned directly from `start()`. */
  error: ScreenShareError | null;
  /** Open the OS screen picker. Always resolves to a structured result —
   *  `stream` is set on success, `error` on failure (including the user
   *  cancelling the picker, indicated by `error.cancelled === true`).
   *  Idempotent — calling while already sharing returns the existing
   *  stream. */
  start: (options?: { systemAudio?: boolean }) => Promise<ScreenShareStartResult>;
  /** Stop the active share and release tracks. Idempotent. */
  stop: () => void;
};

function isDisplayMediaSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  const md = navigator.mediaDevices as MediaDevices | undefined;
  return !!md && typeof md.getDisplayMedia === "function";
}

function describeError(err: unknown): ScreenShareError {
  // The DOMException names are stable across Chromium / Firefox / Safari.
  if (err instanceof Error) {
    const name = (err as DOMException).name;
    if (name === "NotAllowedError") {
      return {
        message: "Screen share was cancelled.",
        cancelled: true,
      };
    }
    if (name === "NotFoundError") {
      return {
        message: "No screen, window, or tab was selected.",
        cancelled: true,
      };
    }
    if (name === "NotReadableError") {
      return {
        message: "Couldn't capture the selected screen — it may be in use.",
        cancelled: false,
      };
    }
    if (name === "AbortError") {
      return {
        message: "Screen capture was interrupted. Try again.",
        cancelled: true,
      };
    }
    if (name === "OverconstrainedError" || name === "TypeError") {
      return {
        message: "Your browser refused this screen-share request.",
        cancelled: false,
      };
    }
    return { message: err.message || "Couldn't start screen sharing.", cancelled: false };
  }
  return { message: "Couldn't start screen sharing.", cancelled: false };
}

export function useScreenShare(): UseScreenShareResult {
  const [isSupported] = useState<boolean>(() => isDisplayMediaSupported());
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<ScreenShareError | null>(null);

  // Guard against overlapping start() calls (e.g. accidental double-click).
  const startInFlightRef = useRef(false);
  // Track the active stream in a ref so the unmount cleanup can stop it
  // without re-running on every render.
  const activeStreamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    const s = activeStreamRef.current;
    if (s) {
      for (const t of s.getTracks()) {
        try {
          t.stop();
        } catch {
          // ignore — track may already be ended
        }
      }
    }
    activeStreamRef.current = null;
    setStream(null);
    setIsSharing(false);
  }, []);

  const start = useCallback<UseScreenShareResult["start"]>(
    async (options) => {
      if (!isSupported) {
        const err: ScreenShareError = {
          message: "Screen sharing isn't available in this browser.",
          cancelled: false,
        };
        setError(err);
        return { stream: null, error: err };
      }
      if (activeStreamRef.current) {
        // Already sharing — return the existing stream.
        return { stream: activeStreamRef.current, error: null };
      }
      if (startInFlightRef.current) {
        // Concurrent start() — treat as a silent cancel so we never
        // surface a noisy toast for an accidental double-click.
        return {
          stream: null,
          error: { message: "Screen share already starting.", cancelled: true },
        };
      }
      startInFlightRef.current = true;
      try {
        // Browsers ignore unknown constraints, so the explicit request for
        // system audio is best-effort; users can also opt into "Share tab
        // audio" inside the picker on Chromium.
        const constraints: DisplayMediaStreamOptions = {
          video: true,
          audio: options?.systemAudio ?? true,
        };
        const md = navigator.mediaDevices as MediaDevices;
        const captured = await md.getDisplayMedia(constraints);
        // Wire the native "Stop sharing" bar — Chromium emits "ended" on
        // the video track when the user clicks that button. We mirror the
        // same teardown as our own stop().
        const videoTrack = captured.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.addEventListener("ended", () => {
            // Only react if THIS stream is still the active one — racing
            // against an explicit stop() shouldn't double-fire.
            if (activeStreamRef.current === captured) {
              stop();
            }
          });
        }
        activeStreamRef.current = captured;
        setStream(captured);
        setIsSharing(true);
        setError(null);
        return { stream: captured, error: null };
      } catch (err) {
        const described = describeError(err);
        setError(described);
        return { stream: null, error: described };
      } finally {
        startInFlightRef.current = false;
      }
    },
    [isSupported, stop],
  );

  // Stop on unmount so navigating away doesn't leave a zombie capture.
  useEffect(() => {
    return () => {
      const s = activeStreamRef.current;
      if (s) {
        for (const t of s.getTracks()) {
          try {
            t.stop();
          } catch {
            // ignore
          }
        }
        activeStreamRef.current = null;
      }
    };
  }, []);

  return {
    isSupported,
    stream,
    isSharing,
    error,
    start,
    stop,
  };
}
