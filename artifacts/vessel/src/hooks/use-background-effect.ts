/**
 * React wrapper around the background-effect pipeline.
 *
 * Contract:
 *   - mode === "none"           → outputStream === source (zero cost passthrough).
 *   - mode === "blur" / "image" → output is a NEW stream whose video track is
 *                                 the canvas-composited result.
 *   - Audio tracks are reused from the source either way; muting/unmuting
 *     the mic still works because we never clone or replace the audio track.
 *   - Switching mode between blur and image swaps in place, no re-init.
 *   - Switching to none disposes the pipeline and exposes the original
 *     stream.
 *   - Switching the source stream (e.g. user picks a different camera) tears
 *     the pipeline down and rebuilds it.
 */

import { useEffect, useRef, useState } from "react";
import {
  type BackgroundMode,
  type BackgroundEffectHandle,
  isBackgroundEffectSupported,
  startBackgroundEffect,
} from "../lib/background-effect";

export type UseBackgroundEffectArgs = {
  source: MediaStream | null;
  mode: BackgroundMode;
};

export type UseBackgroundEffectResult = {
  /** What the recorder + preview should consume. */
  outputStream: MediaStream | null;
  /** True while the segmenter is loading or the pipeline is being set up. */
  isLoading: boolean;
  /** User-facing message when the pipeline failed to start; null otherwise. */
  error: string | null;
  /** Capability gate — false on touch-only devices and ancient browsers. */
  isSupported: boolean;
};

export function useBackgroundEffect({
  source,
  mode,
}: UseBackgroundEffectArgs): UseBackgroundEffectResult {
  const [outputStream, setOutputStream] = useState<MediaStream | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSupported] = useState<boolean>(() =>
    isBackgroundEffectSupported(),
  );

  // Track the active pipeline handle so we can swap modes in place and tear
  // down on unmount / source change.
  const handleRef = useRef<BackgroundEffectHandle | null>(null);
  // Track which source the current pipeline was built against so source
  // swaps trigger a rebuild.
  const builtForSourceRef = useRef<MediaStream | null>(null);

  // (Re)build / tear down the pipeline whenever the source changes or the
  // user toggles between passthrough and an active effect.
  useEffect(() => {
    // No source yet: clear everything.
    if (!source) {
      handleRef.current?.stop();
      handleRef.current = null;
      builtForSourceRef.current = null;
      setOutputStream(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    // Passthrough — dispose any active pipeline, expose the source as-is.
    if (mode.kind === "none") {
      if (handleRef.current) {
        handleRef.current.stop();
        handleRef.current = null;
        builtForSourceRef.current = null;
      }
      setOutputStream(source);
      setIsLoading(false);
      setError(null);
      return;
    }

    // Capability check — fall back to passthrough silently rather than
    // showing a broken state. The component should have hidden the picker
    // already; this is defensive.
    if (!isSupported) {
      setOutputStream(source);
      setIsLoading(false);
      setError(null);
      return;
    }

    // Pipeline already built for this source — just swap the mode in place
    // and exit.
    if (handleRef.current && builtForSourceRef.current === source) {
      handleRef.current.setMode(mode);
      return;
    }

    // Otherwise: build a fresh pipeline.
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    // Tear down any previous pipeline before starting a new one.
    if (handleRef.current) {
      handleRef.current.stop();
      handleRef.current = null;
      builtForSourceRef.current = null;
    }

    startBackgroundEffect(source, mode)
      .then((handle) => {
        if (cancelled) {
          handle.stop();
          return;
        }
        handleRef.current = handle;
        builtForSourceRef.current = source;
        setOutputStream(handle.outputStream);
        setIsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Background effect failed to start", err);
        // Fall back to the raw source so the user is never stuck with a
        // black preview. Surface a friendly message — the picker UI should
        // also offer "use original" to clear it.
        setOutputStream(source);
        setError(
          "Couldn't apply background effect — using your original camera.",
        );
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [source, mode, isSupported]);

  // Hard cleanup on unmount.
  useEffect(() => {
    return () => {
      handleRef.current?.stop();
      handleRef.current = null;
    };
  }, []);

  return { outputStream, isLoading, error, isSupported };
}
