import { useCallback, useEffect, useState } from "react";

/**
 * Markers dropped during a take ("good bit", "cut this"). Press M, or call
 * `addMarker`, while recording. Times are on the server clock, the same
 * clock every track's start is expressed in, so the export can place them
 * on the shared timeline.
 */
export type RecordingMarker = { atServerMs: number; label: string };

const storageKey = (sessionId: string) => `vessel_markers:${sessionId}`;

/** Markers saved for a session on this device (the export reads these). */
export function loadSessionMarkers(
  sessionId: string | null,
): RecordingMarker[] {
  if (!sessionId) return [];
  try {
    const parsed = JSON.parse(
      localStorage.getItem(storageKey(sessionId)) ?? "[]",
    ) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (m): m is RecordingMarker =>
            !!m &&
            typeof (m as RecordingMarker).atServerMs === "number" &&
            typeof (m as RecordingMarker).label === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  return (
    el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)
  );
}

export function useRecordingMarkers(args: {
  sessionId: string | null;
  isRecording: boolean;
  /** Server clock minus this device's clock, ms (0 when unknown). */
  serverOffsetMs: number | null;
}) {
  const { sessionId, isRecording, serverOffsetMs } = args;
  const [markers, setMarkers] = useState<RecordingMarker[]>(() =>
    loadSessionMarkers(sessionId),
  );

  useEffect(() => {
    setMarkers(loadSessionMarkers(sessionId));
  }, [sessionId]);

  const persist = useCallback(
    (next: RecordingMarker[]) => {
      if (!sessionId) return;
      try {
        localStorage.setItem(storageKey(sessionId), JSON.stringify(next));
      } catch (err) {
        console.warn("[markers] could not save", err);
      }
    },
    [sessionId],
  );

  const addMarker = useCallback(
    (label?: string) => {
      if (!isRecording) return;
      const atServerMs = Date.now() + (serverOffsetMs ?? 0);
      setMarkers((prev) => {
        const next = [
          ...prev,
          { atServerMs, label: label?.trim() || `Marker ${prev.length + 1}` },
        ];
        persist(next);
        return next;
      });
    },
    [isRecording, serverOffsetMs, persist],
  );

  useEffect(() => {
    if (!isRecording) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "m" && e.key !== "M") return;
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target))
        return;
      addMarker();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isRecording, addMarker]);

  return { markers, addMarker };
}
