import { motion } from "framer-motion";
import { AvatarMark } from "../AvatarMark";
import { VesselBadge } from "../vessel-ui/VesselBadge";
import { Mic, Video, MicOff, VideoOff } from "lucide-react";
import { cn } from "@/lib/utils";

export type ParticipantCardProps = {
  participant: {
    id: string;
    displayName: string;
    pubkey: string;
    role: "host" | "guest";
  };
  isYou: boolean;
  index: number;
  status?: "joining" | "in-the-room" | "ready";
  micActive?: boolean;
  cameraActive?: boolean;
  /**
   * When provided AND `isYou` is true, the mic indicator becomes a
   * real button that toggles your "join with mic on" preference. When
   * omitted, the dot stays as a read-only status indicator (used for
   * other participants and any read-only context).
   */
  onToggleMic?: () => void;
  onToggleCamera?: () => void;
};

export function ParticipantCard({
  participant,
  isYou,
  index,
  status = "in-the-room",
  micActive = true,
  cameraActive = true,
  onToggleMic,
  onToggleCamera,
}: ParticipantCardProps) {
  let statusDotClass = "bg-vessel-accent";
  let statusText = "In the room";
  if (status === "joining") {
    statusDotClass = "bg-vessel-amber animate-pulse";
    statusText = "Joining...";
  } else if (status === "ready") {
    statusText = "Ready to record";
  }

  // Only the *self* row gets interactive toggles. Other participants'
  // cards remain read-only because we have no source of truth for
  // their pending join prefs from outside their own browser.
  const micInteractive = isYou && Boolean(onToggleMic);
  const cameraInteractive = isYou && Boolean(onToggleCamera);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ delay: index * 0.08, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="flex items-center p-4 rounded-xl bg-vessel-bg-surface border border-vessel-border"
      data-testid={`participant-${participant.id}`}
    >
      <AvatarMark
        pubkey={participant.pubkey}
        displayName={participant.displayName}
        className="w-11 h-11 shadow-sm"
        initialsClassName="text-base"
      />

      <div className="flex-1 ml-4 overflow-hidden">
        <div className="flex items-center gap-2">
          <span className="font-medium text-vessel-text-primary truncate">
            {participant.displayName}
          </span>
          {isYou && participant.role === "host" ? (
            <VesselBadge variant="accent">You · Host</VesselBadge>
          ) : participant.role === "host" ? (
            <VesselBadge variant="accent">Host</VesselBadge>
          ) : isYou ? (
            <VesselBadge variant="default">You</VesselBadge>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <div className={`w-2 h-2 rounded-full ${statusDotClass}`} />
          <span className="text-xs text-vessel-text-secondary">{statusText}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 ml-4 shrink-0">
        <DeviceIndicator
          active={micActive}
          interactive={micInteractive}
          onToggle={onToggleMic}
          ActiveIcon={Mic}
          MutedIcon={MicOff}
          label={micActive ? "Mic on — click to join muted" : "Mic muted — click to unmute"}
          testId={`toggle-mic-${participant.id}`}
        />
        <DeviceIndicator
          active={cameraActive}
          interactive={cameraInteractive}
          onToggle={onToggleCamera}
          ActiveIcon={Video}
          MutedIcon={VideoOff}
          label={cameraActive ? "Camera on — click to join with camera off" : "Camera off — click to turn on"}
          testId={`toggle-camera-${participant.id}`}
        />
      </div>
    </motion.div>
  );
}

type IconType = typeof Mic;

function DeviceIndicator({
  active,
  interactive,
  onToggle,
  ActiveIcon,
  MutedIcon,
  label,
  testId,
}: {
  active: boolean;
  interactive: boolean;
  onToggle?: () => void;
  ActiveIcon: IconType;
  MutedIcon: IconType;
  label: string;
  testId: string;
}) {
  const baseClasses = cn(
    "w-8 h-8 rounded-full flex items-center justify-center border transition-colors",
    active
      ? "bg-vessel-bg-base border-vessel-border"
      : "bg-vessel-red/10 border-vessel-red/20",
  );

  const Icon = active ? ActiveIcon : MutedIcon;
  const iconClasses = cn(
    "w-4 h-4",
    active ? "text-vessel-accent" : "text-vessel-red",
  );

  if (!interactive) {
    return (
      <div className={baseClasses} aria-hidden="true">
        <Icon className={iconClasses} />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      aria-label={label}
      title={label}
      data-testid={testId}
      className={cn(
        baseClasses,
        "cursor-pointer hover:scale-110 active:scale-95 transition-transform",
        active
          ? "hover:border-vessel-accent/50 hover:bg-vessel-bg-elevated"
          : "hover:border-vessel-red/40 hover:bg-vessel-red/15",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent focus-visible:ring-offset-2 focus-visible:ring-offset-vessel-bg-surface",
      )}
    >
      <Icon className={iconClasses} />
    </button>
  );
}
