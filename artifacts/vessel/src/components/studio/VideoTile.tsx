import { useEffect, useRef } from "react";
import { MicOff } from "lucide-react";
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
};

export function VideoTile({
  participant,
  stream,
  isLocal,
  micEnabled,
  cameraEnabled,
  isConnecting,
  audioLevel,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div
      data-testid={`video-tile-${participant.id}`}
      className={cn(
        "rounded-2xl overflow-hidden bg-vessel-bg-surface aspect-video group relative border border-vessel-border transition-all duration-200 hover:border-vessel-border-strong",
        !micEnabled && "outline outline-2 outline-vessel-red/50 outline-offset-[-2px]"
      )}
    >
      {isConnecting ? (
        <div className="absolute inset-0 flex items-center justify-center bg-vessel-bg-surface overflow-hidden">
          <div
            className="absolute inset-0 w-[200%] animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/5 to-transparent"
            style={{ transform: "skewX(-20deg)" }}
          />
          <style>{`
            @keyframes shimmer {
              100% { transform: translateX(100%) skewX(-20deg); }
            }
          `}</style>
          <span className="font-mono-vessel text-sm text-vessel-text-secondary z-10">
            Connecting...
          </span>
        </div>
      ) : stream && cameraEnabled ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-vessel-bg-elevated flex items-center justify-center">
          <AvatarMark
            pubkey={participant.pubkey}
            displayName={participant.displayName}
            className="w-24 h-24 shadow-lg"
            initialsClassName="text-3xl"
          />
        </div>
      )}

      {/* Bottom gradient overlay */}
      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />

      {/* Top-left "LOCAL" badge */}
      {isLocal && (
        <div className="absolute top-3 left-3 z-10 bg-vessel-accent/20 border border-vessel-accent/40 px-2 py-0.5 rounded-md">
          <span className="text-[10px] font-mono-vessel font-bold text-vessel-accent uppercase tracking-wider">
            Local
          </span>
        </div>
      )}

      {/* Top-right muted badge */}
      {!micEnabled && (
        <div className="absolute top-3 right-3 z-10 w-8 h-8 bg-vessel-red/20 border border-vessel-red/40 rounded-full flex items-center justify-center">
          <MicOff className="w-4 h-4 text-vessel-red" />
        </div>
      )}

      {/* Bottom-left label */}
      <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2">
        <AvatarMark
          pubkey={participant.pubkey}
          displayName={participant.displayName}
          className="w-8 h-8 border border-white/10"
          initialsClassName="text-xs"
        />
        <div className="bg-black/60 backdrop-blur-sm px-2.5 py-1 rounded-full border border-white/5">
          <span className="text-sm font-medium text-white">{participant.displayName}</span>
        </div>
      </div>

      {/* Bottom-right audio meter */}
      {micEnabled && (
        <div className="absolute bottom-3 right-3 z-10">
          <AudioMeter
            active={micEnabled}
            barCount={5}
            audioLevel={audioLevel}
            className="bg-black/60 backdrop-blur-sm rounded-full px-3 py-1.5 h-7 border border-white/5"
          />
        </div>
      )}
    </div>
  );
}
