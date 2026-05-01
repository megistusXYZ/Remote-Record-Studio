import { useEffect, useRef, useState } from "react";
import { MicOff, Captions } from "lucide-react";
import { AudioMeter } from "../vessel-ui/AudioMeter";
import { AvatarMark } from "../AvatarMark";
import { cn } from "@/lib/utils";

export type VideoTileProps = {
  participant: {
    id: string;
    displayName: string;
    pubkey: string;
    role: "host" | "guest";
  };
  stream?: MediaStream | null;
  isLocal: boolean;
  micEnabled: boolean;
  cameraEnabled: boolean;
  isConnecting?: boolean;
  audioLevel?: number;
  /** True when the local user has captions enabled. Drives a small CC
   *  indicator on the local tile so the speaker knows their audio is
   *  being captioned (and therefore broadcast as transcript fragments
   *  to everyone in the room). */
  captionsActive?: boolean;
};

// Phased copy for the connecting overlay. The thresholds (in ms) match
// the heartbeat tiers in use-call-signal: a healthy peer should arrive
// well within the first window, a slow peer within the second, and only
// a peer that is genuinely failing to deliver A/V should land in the
// third. The third copy intentionally tells the viewer that THE OTHER
// SIDE'S LIVE FEED isn't reaching them — and reassures them that the
// recording is unaffected, since the per-participant local recording is
// independent of the live preview path.
const PHASE_2_AT_MS = 3000;
const PHASE_3_AT_MS = 8000;

type ConnectingPhase = "joining" | "connecting" | "stalled";

export function VideoTile({
  participant,
  stream,
  isLocal,
  micEnabled,
  cameraEnabled,
  isConnecting,
  audioLevel,
  captionsActive = false,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Track how long this tile has been stuck in the "connecting" state so
  // we can progressively soften the copy from a cheerful "Joining…" to
  // an honest "their feed isn't reaching you". The clock resets every
  // time `isConnecting` flips back to true — so a tile that briefly
  // recovers and then loses the stream again starts the phase ladder
  // from the top, not from where it left off.
  const [phase, setPhase] = useState<ConnectingPhase>("joining");
  useEffect(() => {
    if (!isConnecting) {
      setPhase("joining");
      return;
    }
    setPhase("joining");
    const t2 = window.setTimeout(() => setPhase("connecting"), PHASE_2_AT_MS);
    const t3 = window.setTimeout(() => setPhase("stalled"), PHASE_3_AT_MS);
    return () => {
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [isConnecting]);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const connectingHeadline =
    phase === "joining"
      ? "Joining…"
      : phase === "connecting"
        ? "Connecting…"
        : "Their live video isn't reaching you";

  // Only the stalled phase warrants the explanatory subline. Showing it
  // earlier would alarm viewers during the normal first few seconds of
  // a join, which sets the wrong tone for what is usually a healthy
  // hand-off.
  const connectingSubline =
    phase === "stalled" ? "Their recording is unaffected." : null;

  return (
    <div
      data-testid={`video-tile-${participant.id}`}
      className={cn(
        // The tile fills whatever box VideoGrid hands it. The grid is
        // responsible for the outer aspect-ratio in the single-participant
        // case; for multi-participant grids each cell is auto-rows-fr.
        "relative w-full h-full min-w-0 min-h-0 rounded-2xl overflow-hidden bg-vessel-bg-surface group border border-vessel-border transition-all duration-200 hover:border-vessel-border-strong",
        !micEnabled && "outline outline-2 outline-vessel-red/50 outline-offset-[-2px]",
      )}
    >
      {isConnecting ? (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center bg-vessel-bg-surface overflow-hidden px-6 text-center"
          data-testid={`tile-connecting-${participant.id}`}
          data-phase={phase}
        >
          <div
            className="absolute inset-0 w-[200%] animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/5 to-transparent"
            style={{ transform: "skewX(-20deg)" }}
          />
          <style>{`
            @keyframes shimmer {
              100% { transform: translateX(100%) skewX(-20deg); }
            }
          `}</style>
          <span
            className={cn(
              "font-mono-vessel text-sm z-10 transition-colors duration-300",
              phase === "stalled"
                ? "text-vessel-text-primary"
                : "text-vessel-text-secondary",
            )}
          >
            {connectingHeadline}
          </span>
          {connectingSubline && (
            <span className="mt-1 text-[11px] sm:text-xs text-vessel-text-secondary z-10 max-w-[28ch]">
              {connectingSubline}
            </span>
          )}
        </div>
      ) : (
        <>
          {/* Keep the <video> element mounted whenever a stream is
              available — even while the camera is muted. Unmounting it
              on every camera-off forces the browser to re-attach the
              stream and wait for a fresh keyframe when the user toggles
              back on, which shows up as a multi-second black hole
              before video reappears. With the element kept alive, a
              disabled track simply stops delivering frames; re-enabling
              paints the next frame immediately. */}
          {stream && (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted={isLocal}
              className={cn(
                "absolute inset-0 w-full h-full object-cover",
                !cameraEnabled && "invisible",
              )}
            />
          )}
          {(!stream || !cameraEnabled) && (
            // Camera-off / no-stream overlay. The avatar scales with
            // tile size (proportional, with explicit floors and
            // ceilings) so that on a big single-participant tile it
            // reads as a confident hero rather than a lonely 96px dot
            // in the middle of the room. We also pad the bottom so the
            // avatar never sits behind the bottom-left name pill or
            // the bottom-right meter.
            <div className="absolute inset-0 bg-vessel-bg-elevated flex items-center justify-center px-6 pt-6 pb-16">
              <div className="flex flex-col items-center gap-3 sm:gap-4 max-w-full">
                <AvatarMark
                  pubkey={participant.pubkey}
                  displayName={participant.displayName}
                  className="w-20 h-20 sm:w-28 sm:h-28 md:w-36 md:h-36 lg:w-44 lg:h-44 shadow-lg"
                  initialsClassName="text-2xl sm:text-3xl md:text-4xl lg:text-5xl"
                />
                <span className="hidden sm:block text-vessel-text-secondary text-sm md:text-base font-medium truncate max-w-[80%]">
                  {participant.displayName}
                </span>
              </div>
            </div>
          )}
        </>
      )}

      {/* Bottom gradient overlay — only useful when there's actual video
          underneath; on the avatar-fallback state it just dims the
          background needlessly. */}
      {stream && cameraEnabled && !isConnecting && (
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
      )}

      {/* Top-left "LOCAL" badge + (when active) a CC chip so the local
          speaker can see at a glance that their audio is being captioned
          and broadcast. The chip sits to the right of LOCAL so it never
          competes for the same slot, and is gated to the local tile —
          remote tiles render the per-speaker bubbles in the transcript
          pane instead, not on the video itself. */}
      {isLocal && (
        <div className="absolute top-2 left-2 sm:top-3 sm:left-3 z-10 flex items-center gap-1.5">
          <div className="bg-vessel-accent/20 border border-vessel-accent/40 px-1.5 py-0.5 sm:px-2 rounded-md">
            <span className="text-[9px] sm:text-[10px] font-mono-vessel font-bold text-vessel-accent uppercase tracking-wider">
              Local
            </span>
          </div>
          {captionsActive && (
            <div
              className="flex items-center gap-1 bg-vessel-accent/20 border border-vessel-accent/40 px-1.5 py-0.5 sm:px-2 rounded-md"
              data-testid="badge-captions-active"
              aria-label="Captions on"
              title="Live captions are on"
            >
              <Captions className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-vessel-accent" />
              <span className="text-[9px] sm:text-[10px] font-mono-vessel font-bold text-vessel-accent uppercase tracking-wider">
                CC
              </span>
            </div>
          )}
        </div>
      )}

      {/* Top-right muted badge */}
      {!micEnabled && (
        <div className="absolute top-2 right-2 sm:top-3 sm:right-3 z-10 w-7 h-7 sm:w-8 sm:h-8 bg-vessel-red/20 border border-vessel-red/40 rounded-full flex items-center justify-center">
          <MicOff className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-vessel-red" />
        </div>
      )}

      {/* Bottom-left label — name pill. min-w-0 + truncate stops long
          handles from pushing the audio meter off the right edge. */}
      <div className="absolute bottom-2 left-2 sm:bottom-3 sm:left-3 right-12 sm:right-16 z-10 flex items-center gap-2 min-w-0">
        <AvatarMark
          pubkey={participant.pubkey}
          displayName={participant.displayName}
          className="w-7 h-7 sm:w-8 sm:h-8 border border-white/10 shrink-0"
          initialsClassName="text-[10px] sm:text-xs"
        />
        <div className="bg-black/60 backdrop-blur-sm px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full border border-white/5 min-w-0">
          <span className="text-xs sm:text-sm font-medium text-white truncate block">
            {participant.displayName}
          </span>
        </div>
      </div>

      {/* Bottom-right audio meter */}
      {micEnabled && (
        <div className="absolute bottom-2 right-2 sm:bottom-3 sm:right-3 z-10">
          <AudioMeter
            active={micEnabled}
            barCount={5}
            audioLevel={audioLevel}
            className="bg-black/60 backdrop-blur-sm rounded-full px-2 py-1 sm:px-3 sm:py-1.5 h-6 sm:h-7 border border-white/5"
          />
        </div>
      )}
    </div>
  );
}
