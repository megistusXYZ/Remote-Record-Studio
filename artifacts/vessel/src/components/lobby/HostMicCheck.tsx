import { useEffect, useState } from "react";
import { Mic, X } from "lucide-react";
import {
  LoopbackButton,
  useLoopback,
  useMicLevel,
} from "../onboarding/Greenroom";

/**
 * The mic check guests get in the greenroom, offered to the host in the
 * lobby. Opens the microphone only while the panel is open and releases it
 * on close, so the studio's own capture starts from a clean device.
 */
export function HostMicCheck() {
  const [open, setOpen] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    let acquired: MediaStream | null = null;
    setError(null);
    navigator.mediaDevices
      ?.getUserMedia({ audio: true })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        acquired = s;
        setStream(s);
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "Your browser blocked the microphone. Allow it in the address bar, then try again.",
          );
      });
    return () => {
      cancelled = true;
      acquired?.getTracks().forEach((t) => t.stop());
      setStream(null);
    };
  }, [open]);

  const level = useMicLevel(stream, open);
  const loopback = useLoopback(stream, open);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mx-auto mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-vessel-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent rounded"
        data-testid="button-host-mic-check"
      >
        <Mic className="w-3.5 h-3.5" aria-hidden="true" />
        Check my mic
      </button>
    );
  }

  return (
    <div
      className="mt-3 rounded-2xl bg-vessel-bg-surface border border-vessel-border p-4 text-left"
      data-testid="host-mic-check"
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-medium">Mic check</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close mic check"
          className="text-vessel-text-muted hover:text-vessel-text-primary"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {error ? (
        <p className="text-xs text-vessel-red">{error}</p>
      ) : (
        <>
          <div
            className="h-2 rounded-full bg-vessel-bg-base overflow-hidden mb-3"
            aria-label="Microphone level"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(level * 100)}
          >
            <div
              className="h-full bg-vessel-accent transition-[width] duration-75"
              style={{ width: `${Math.min(100, level * 100)}%` }}
            />
          </div>
          <p className="text-xs text-vessel-text-muted mb-3">
            Say a few words. Record a short clip and play it back to hear what
            your guests will.
          </p>
          <LoopbackButton
            phase={loopback.phase}
            onStart={loopback.start}
            onStop={loopback.stop}
            disabled={!stream}
          />
        </>
      )}
    </div>
  );
}
