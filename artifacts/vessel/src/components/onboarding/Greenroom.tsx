import { useEffect, useMemo, useRef, useState } from "react";
import { friendlyError } from "../../lib/friendly-error";
import { motion } from "framer-motion";
import {
  Camera,
  CameraOff,
  Mic,
  MicOff,
  ChevronDown,
  Check,
  Wifi,
  Cpu,
  Shield,
  AlertCircle,
  Volume2,
  Loader2,
  Play,
  Square,
} from "lucide-react";
import { useMediaDevices, useLocalStream } from "../../hooks/use-media-devices";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { VesselButton } from "../vessel-ui/VesselButton";
import { cn } from "@/lib/utils";

/**
 * Greenroom — pre-join device check screen.
 *
 * Shown immediately after the invite link resolves and before the consent
 * step. The goal is to give the guest a calm space to:
 *  - confirm camera + mic work and choose the right ones
 *  - see their own video preview
 *  - watch a live mic level meter so they know audio is reaching us
 *  - run a 3-second loopback test (record + play back)
 *  - see browser / network / CPU preflight chips
 *  - confirm their display name
 *
 * The greenroom owns its own preview stream and tears it down on continue
 * so the studio can reopen with the now-saved device selection without two
 * handles fighting over the same camera. Selected device IDs are persisted
 * by `useMediaDevices`, so the studio picks up the same camera/mic.
 */

export type GreenroomResult = {
  name: string;
  cameraId: string | null;
  micId: string | null;
};

export type GreenroomProps = {
  hostName: string;
  sessionTitle: string;
  initialName: string;
  onContinue: (result: GreenroomResult) => void;
  onCancel: () => void;
};

type LoopbackPhase =
  | { kind: "idle" }
  | { kind: "recording"; secondsLeft: number }
  | { kind: "playing"; url: string }
  | { kind: "unsupported" }
  | { kind: "error"; message: string };

const LOOPBACK_SECONDS = 3;

export function Greenroom({
  hostName,
  sessionTitle,
  initialName,
  onContinue,
  onCancel,
}: GreenroomProps) {
  const {
    cameras,
    microphones,
    selectedCameraId,
    selectedMicId,
    setSelectedCameraId,
    setSelectedMicId,
  } = useMediaDevices();

  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);
  const [name, setName] = useState(initialName);

  const { stream, error: streamError, isLoading, videoUnavailableReason } = useLocalStream({
    cameraId: selectedCameraId,
    micId: selectedMicId,
    cameraEnabled,
    micEnabled,
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  // Stop the greenroom's preview stream on unmount so the studio can take
  // over the device handles cleanly. The studio's own useLocalStream will
  // re-open with the same selected device IDs (persisted to localStorage).
  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [stream]);

  const micLevel = useMicLevel(stream, micEnabled);
  const preflight = usePreflightChecks();
  const loopback = useLoopback(stream, micEnabled);

  const canContinue = name.trim().length > 0 && !!stream && !streamError;

  return (
    <div className="min-h-[100dvh] bg-vessel-bg-base text-vessel-text-primary">
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-0 left-0 w-[800px] h-[800px] bg-vessel-accent/5 rounded-full blur-[120px] -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute bottom-0 right-0 w-[600px] h-[600px] bg-vessel-accent/5 rounded-full blur-[100px] translate-x-1/3 translate-y-1/3" />
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <motion.header
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mb-8 text-center"
        >
          <p className="text-xs font-mono-vessel text-vessel-accent uppercase tracking-wider mb-2">
            Greenroom
          </p>
          <h1
            className="font-display text-2xl sm:text-3xl font-bold tracking-tight mb-2"
            data-testid="text-greenroom-title"
          >
            Get set up before you join {hostName.split(" ")[0]}
          </h1>
          <p className="text-sm text-vessel-text-secondary max-w-lg mx-auto">
            Make sure your camera, mic, and connection look right.
            <span className="text-vessel-text-muted"> · {sessionTitle}</span>
          </p>
        </motion.header>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.05 }}
          className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-6"
        >
          {/* LEFT — preview + device pickers */}
          <div className="rounded-2xl bg-vessel-bg-surface border border-vessel-border overflow-hidden">
            <div className="relative aspect-video bg-black">
              {stream && cameraEnabled && (
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-cover -scale-x-100"
                  data-testid="video-greenroom-preview"
                />
              )}
              {(!stream || !cameraEnabled || isLoading) && (
                <div className="absolute inset-0 flex items-center justify-center">
                  {isLoading ? (
                    <div className="flex flex-col items-center gap-2 text-vessel-text-secondary">
                      <Loader2 className="w-6 h-6 animate-spin text-vessel-accent" />
                      <span className="text-xs">Opening camera & mic…</span>
                    </div>
                  ) : !cameraEnabled ? (
                    <div className="flex flex-col items-center gap-2 text-vessel-text-muted">
                      <CameraOff className="w-8 h-8" />
                      <span className="text-xs">Camera off</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-vessel-text-muted">
                      <Camera className="w-8 h-8" />
                      <span className="text-xs">Waiting for video…</span>
                    </div>
                  )}
                </div>
              )}

              {/* Live mic meter overlay */}
              {stream && micEnabled && (
                <div
                  className="absolute bottom-3 left-3 right-3 h-1.5 rounded-full bg-black/40 overflow-hidden backdrop-blur-sm"
                  aria-label="Microphone level"
                  data-testid="meter-greenroom-mic"
                >
                  <div
                    className="h-full bg-vessel-accent transition-[width] duration-75"
                    style={{ width: `${Math.round(micLevel * 100)}%` }}
                  />
                </div>
              )}

              {/* Device toggle pill row */}
              <div className="absolute top-3 right-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMicEnabled((v) => !v)}
                  className={cn(
                    "w-9 h-9 rounded-full border flex items-center justify-center backdrop-blur-sm transition-colors",
                    micEnabled
                      ? "bg-vessel-bg-surface/80 border-vessel-border text-vessel-text-primary"
                      : "bg-vessel-red/20 border-vessel-red/40 text-vessel-red",
                  )}
                  aria-pressed={!micEnabled}
                  aria-label={micEnabled ? "Mute microphone" : "Unmute microphone"}
                  data-testid="button-greenroom-toggle-mic"
                >
                  {micEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => setCameraEnabled((v) => !v)}
                  className={cn(
                    "w-9 h-9 rounded-full border flex items-center justify-center backdrop-blur-sm transition-colors",
                    cameraEnabled
                      ? "bg-vessel-bg-surface/80 border-vessel-border text-vessel-text-primary"
                      : "bg-vessel-red/20 border-vessel-red/40 text-vessel-red",
                  )}
                  aria-pressed={!cameraEnabled}
                  aria-label={cameraEnabled ? "Turn off camera" : "Turn on camera"}
                  data-testid="button-greenroom-toggle-cam"
                >
                  {cameraEnabled ? <Camera className="w-4 h-4" /> : <CameraOff className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {streamError && (
              <div className="px-4 py-3 bg-vessel-red/10 border-t border-vessel-red/30 text-vessel-red text-sm flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span data-testid="text-greenroom-stream-error">{streamError}</span>
              </div>
            )}
            {!streamError && videoUnavailableReason && (
              <div className="px-4 py-3 bg-vessel-bg-surface border-t border-vessel-border text-vessel-text-secondary text-sm flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-vessel-accent" />
                <span data-testid="text-greenroom-audio-only">{videoUnavailableReason}</span>
              </div>
            )}

            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 bg-vessel-bg-base/40">
              <DeviceDropdown
                label="Camera"
                icon={<Camera className="w-3.5 h-3.5" />}
                devices={cameras}
                selectedId={selectedCameraId}
                onSelect={setSelectedCameraId}
                testId="dropdown-greenroom-camera"
              />
              <DeviceDropdown
                label="Microphone"
                icon={<Mic className="w-3.5 h-3.5" />}
                devices={microphones}
                selectedId={selectedMicId}
                onSelect={setSelectedMicId}
                testId="dropdown-greenroom-mic"
              />
            </div>
          </div>

          {/* RIGHT — name + loopback + preflight + actions */}
          <div className="space-y-4">
            <section className="rounded-2xl bg-vessel-bg-surface border border-vessel-border p-5">
              <label
                htmlFor="greenroom-name"
                className="text-xs font-mono-vessel text-vessel-text-muted uppercase tracking-wider mb-2 block"
              >
                Your display name
              </label>
              <Input
                id="greenroom-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="What should we call you?"
                className="h-12 bg-vessel-bg-base border-vessel-border focus-visible:ring-vessel-accent rounded-xl px-4"
                data-testid="input-greenroom-name"
              />
              <p className="text-xs text-vessel-text-muted mt-2">
                Other people in the session, and your receipt, will see this.
              </p>
            </section>

            <section className="rounded-2xl bg-vessel-bg-surface border border-vessel-border p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-xs font-mono-vessel text-vessel-text-muted uppercase tracking-wider">
                    Mic check
                  </p>
                  <p className="text-sm text-vessel-text-secondary">
                    Record {LOOPBACK_SECONDS}s and play it back.
                  </p>
                </div>
                <Volume2 className="w-4 h-4 text-vessel-text-muted" />
              </div>
              <LoopbackButton
                phase={loopback.phase}
                onStart={loopback.start}
                onStop={loopback.stop}
                disabled={!stream || !micEnabled}
              />
            </section>

            <section className="rounded-2xl bg-vessel-bg-surface border border-vessel-border p-5">
              <p className="text-xs font-mono-vessel text-vessel-text-muted uppercase tracking-wider mb-3">
                Checks
              </p>
              <div className="space-y-2">
                <PreflightChip
                  icon={<Shield className="w-3.5 h-3.5" />}
                  label="Browser"
                  status={preflight.browser}
                  testId="chip-preflight-browser"
                />
                <PreflightChip
                  icon={<Wifi className="w-3.5 h-3.5" />}
                  label="Connection"
                  status={preflight.network}
                  testId="chip-preflight-network"
                />
                <PreflightChip
                  icon={<Cpu className="w-3.5 h-3.5" />}
                  label="This device"
                  status={preflight.cpu}
                  testId="chip-preflight-cpu"
                />
              </div>
            </section>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <VesselButton
                variant="ghost"
                size="md"
                onClick={onCancel}
                className="w-full sm:w-auto"
                data-testid="button-greenroom-cancel"
              >
                Join without checking
              </VesselButton>
              <VesselButton
                variant="primary"
                size="md"
                disabled={!canContinue}
                onClick={() =>
                  onContinue({
                    name: name.trim(),
                    cameraId: selectedCameraId,
                    micId: selectedMicId,
                  })
                }
                className="w-full sm:flex-1"
                data-testid="button-greenroom-continue"
              >
                Continue
              </VesselButton>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function DeviceDropdown({
  label,
  icon,
  devices,
  selectedId,
  onSelect,
  testId,
}: {
  label: string;
  icon: React.ReactNode;
  devices: { deviceId: string; label: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  testId: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = devices.find((d) => d.deviceId === selectedId);
  const hasOptions = devices.length > 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-full text-left rounded-lg border border-vessel-border bg-vessel-bg-base px-3 py-2.5 hover:border-vessel-accent/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent"
          data-testid={testId}
          disabled={!hasOptions}
        >
          <div className="flex items-center gap-1.5 text-[10px] font-mono-vessel text-vessel-text-muted uppercase tracking-wider mb-1">
            {icon} {label}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-vessel-text-primary truncate">
              {selected?.label || (hasOptions ? "Select a device" : "No device found")}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-vessel-text-muted shrink-0" />
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-1 bg-vessel-bg-surface border-vessel-border" align="start">
        {devices.map((d) => (
          <button
            key={d.deviceId}
            type="button"
            onClick={() => {
              onSelect(d.deviceId);
              setOpen(false);
            }}
            className={cn(
              "w-full text-left text-sm px-3 py-2 rounded-md flex items-center justify-between hover:bg-vessel-bg-base transition-colors",
              selectedId === d.deviceId && "text-vessel-accent",
            )}
            data-testid={`${testId}-option-${d.deviceId}`}
          >
            <span className="truncate">{d.label}</span>
            {selectedId === d.deviceId && <Check className="w-3.5 h-3.5 shrink-0" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function LoopbackButton({
  phase,
  onStart,
  onStop,
  disabled,
}: {
  phase: LoopbackPhase;
  onStart: () => void;
  onStop: () => void;
  disabled: boolean;
}) {
  if (phase.kind === "unsupported") {
    return (
      <p className="text-xs text-vessel-text-muted">
        Mic playback isn't supported in this browser. The live meter above still works.
      </p>
    );
  }
  if (phase.kind === "recording") {
    return (
      <VesselButton
        variant="ghost"
        size="sm"
        onClick={onStop}
        className="w-full"
        data-testid="button-loopback-recording"
      >
        <Square className="w-3.5 h-3.5 mr-2" />
        Recording… {phase.secondsLeft}s
      </VesselButton>
    );
  }
  if (phase.kind === "playing") {
    return (
      <div className="space-y-2">
        <p className="text-xs text-vessel-accent flex items-center gap-1.5">
          <Volume2 className="w-3.5 h-3.5" /> Playing back…
        </p>
        <audio
          src={phase.url}
          autoPlay
          controls
          className="w-full h-8"
          data-testid="audio-loopback-playback"
        />
        <VesselButton variant="ghost" size="sm" onClick={onStart} className="w-full">
          <Play className="w-3.5 h-3.5 mr-2" />
          Test again
        </VesselButton>
      </div>
    );
  }
  if (phase.kind === "error") {
    return (
      <div className="space-y-2">
        <p className="text-xs text-vessel-red flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {phase.message}
        </p>
        <VesselButton variant="ghost" size="sm" onClick={onStart} disabled={disabled} className="w-full">
          <Play className="w-3.5 h-3.5 mr-2" />
          Try again
        </VesselButton>
      </div>
    );
  }
  return (
    <VesselButton
      variant="ghost"
      size="sm"
      onClick={onStart}
      disabled={disabled}
      className="w-full"
      data-testid="button-loopback-start"
    >
      <Play className="w-3.5 h-3.5 mr-2" />
      Test my mic
    </VesselButton>
  );
}

type PreflightStatus =
  | { kind: "ok"; note?: string }
  | { kind: "warn"; note: string }
  | { kind: "fail"; note: string }
  | { kind: "checking" };

function PreflightChip({
  icon,
  label,
  status,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  status: PreflightStatus;
  testId: string;
}) {
  const palette =
    status.kind === "ok"
      ? "bg-vessel-accent/10 border-vessel-accent/40 text-vessel-accent"
      : status.kind === "warn"
      ? "bg-vessel-amber/10 border-vessel-amber/40 text-vessel-amber"
      : status.kind === "fail"
      ? "bg-vessel-red/10 border-vessel-red/40 text-vessel-red"
      : "bg-vessel-bg-base border-vessel-border text-vessel-text-muted";

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border px-3 py-2",
        palette,
      )}
      data-testid={testId}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="shrink-0">{icon}</span>
        <span className="text-sm font-medium truncate">{label}</span>
      </div>
      <div className="text-xs text-right truncate">
        {status.kind === "checking" ? (
          <Loader2 className="w-3 h-3 animate-spin inline" />
        ) : (
          status.note ?? (status.kind === "ok" ? "Ready" : "Issue")
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hooks
// ─────────────────────────────────────────────────────────────────────────────

/** Live RMS-based mic level (0..1). Uses the existing audio track from the
 *  preview stream — we don't open a second handle on the mic. */
export function useMicLevel(stream: MediaStream | null, enabled: boolean): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!stream || !enabled) {
      setLevel(0);
      return;
    }
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) return;
    const AudioCtx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    let raf = 0;
    const loop = () => {
      analyser.getByteTimeDomainData(buf);
      let sumSq = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / buf.length);
      // Light non-linear mapping so quiet speech isn't invisible.
      const shaped = Math.min(1, Math.pow(rms * 2.5, 0.7));
      setLevel(shaped);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      try {
        src.disconnect();
      } catch {
        // ignore
      }
      void ctx.close();
    };
  }, [stream, enabled]);
  return level;
}

/** Encapsulates the loopback record-then-play flow. */
export function useLoopback(stream: MediaStream | null, micEnabled: boolean) {
  const [phase, setPhase] = useState<LoopbackPhase>({ kind: "idle" });
  const recorderRef = useRef<MediaRecorder | null>(null);
  const tickRef = useRef<number | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  // Detect support once on mount.
  useEffect(() => {
    if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
      setPhase({ kind: "unsupported" });
    }
  }, []);

  // Revoke object URLs when phase changes away from playback.
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
      if (tickRef.current) window.clearInterval(tickRef.current);
      try {
        recorderRef.current?.stop();
      } catch {
        // ignore
      }
    };
  }, []);

  const start = () => {
    if (!stream || !micEnabled) return;
    if (phase.kind === "unsupported") return;
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      setPhase({ kind: "error", message: "No microphone is selected." });
      return;
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    try {
      const audioOnly = new MediaStream(audioTracks);
      const rec = new MediaRecorder(audioOnly);
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      rec.onstop = () => {
        if (tickRef.current) {
          window.clearInterval(tickRef.current);
          tickRef.current = null;
        }
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setPhase({ kind: "playing", url });
      };
      rec.onerror = () => {
        setPhase({ kind: "error", message: "Couldn't record from your mic." });
      };
      recorderRef.current = rec;
      rec.start();
      let secondsLeft = LOOPBACK_SECONDS;
      setPhase({ kind: "recording", secondsLeft });
      tickRef.current = window.setInterval(() => {
        secondsLeft -= 1;
        if (secondsLeft <= 0) {
          if (tickRef.current) window.clearInterval(tickRef.current);
          try {
            rec.stop();
          } catch {
            // ignore
          }
        } else {
          setPhase({ kind: "recording", secondsLeft });
        }
      }, 1000);
    } catch (err) {
      setPhase({
        kind: "error",
        message: friendlyError(err, "Couldn't start the test."),
      });
    }
  };

  const stop = () => {
    try {
      recorderRef.current?.stop();
    } catch {
      // ignore
    }
  };

  return { phase, start, stop };
}

/** Best-effort browser/network/CPU readiness checks. None of these are gates —
 *  they're nudges so the guest knows what to expect on a marginal setup. */
function usePreflightChecks() {
  const browser = useMemo<PreflightStatus>(() => {
    if (typeof window === "undefined") return { kind: "checking" };
    const ua = window.navigator.userAgent || "";
    const hasGUM = !!window.navigator.mediaDevices?.getUserMedia;
    const hasWebRTC = typeof window.RTCPeerConnection !== "undefined";
    if (!hasGUM || !hasWebRTC) {
      return {
        kind: "fail",
        note: "Live recording isn't supported here",
      };
    }
    if (/safari/i.test(ua) && !/chrome|crios/i.test(ua)) {
      return { kind: "warn", note: "Works; Chrome is smoother" };
    }
    return { kind: "ok", note: "Ready" };
  }, []);

  const cpu = useMemo<PreflightStatus>(() => {
    if (typeof window === "undefined") return { kind: "checking" };
    const cores = window.navigator.hardwareConcurrency || 0;
    if (cores === 0) return { kind: "ok", note: "Should be fine" };
    if (cores < 4) return { kind: "warn", note: "Video may stutter; audio is fine" };
    return { kind: "ok", note: "Good for video" };
  }, []);

  const [network, setNetwork] = useState<PreflightStatus>({ kind: "checking" });
  useEffect(() => {
    let cancelled = false;
    if (typeof navigator === "undefined") {
      setNetwork({ kind: "checking" });
      return;
    }
    if (!navigator.onLine) {
      setNetwork({ kind: "fail", note: "Offline" });
      return;
    }
    const conn = (navigator as unknown as {
      connection?: { effectiveType?: string; downlink?: number };
    }).connection;
    if (conn?.effectiveType) {
      const t = conn.effectiveType;
      if (t === "4g" || t === "5g") {
        setNetwork({ kind: "ok", note: "Looks good" });
        return;
      }
      if (t === "3g") {
        setNetwork({ kind: "warn", note: "Slow; video may stutter" });
        return;
      }
      setNetwork({ kind: "fail", note: "Too slow for a call" });
      return;
    }
    // Fallback: small ping to the API base path. Best-effort; we don't fail
    // hard if it errors.
    const start = performance.now();
    const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    fetch(`${base}/api/healthz`, { method: "GET", cache: "no-store" })
      .then(() => {
        if (cancelled) return;
        const ms = Math.round(performance.now() - start);
        if (ms < 250) setNetwork({ kind: "ok", note: "Looks good" });
        else setNetwork({ kind: "warn", note: "Slow; video may stutter" });
      })
      .catch(() => {
        if (!cancelled) setNetwork({ kind: "ok", note: "Online" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { browser, cpu, network };
}
