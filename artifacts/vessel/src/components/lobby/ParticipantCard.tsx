import { motion, AnimatePresence } from "framer-motion";
import { getInitials } from "../../lib/identity";
import { useAvatarColor } from "../../hooks/use-avatar-color";
import { VesselBadge } from "../vessel-ui/VesselBadge";
import { Mic, Video, MicOff, VideoOff } from "lucide-react";

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
};

export function ParticipantCard({
  participant,
  isYou,
  index,
  status = "in-the-room",
  micActive = true,
  cameraActive = true,
}: ParticipantCardProps) {
  const avatarColor = useAvatarColor(participant.pubkey);
  const initials = getInitials(participant.displayName);

  let statusDotClass = "bg-vessel-accent";
  let statusText = "In the room";
  if (status === "joining") {
    statusDotClass = "bg-vessel-amber animate-pulse";
    statusText = "Joining...";
  } else if (status === "ready") {
    statusText = "Ready to record";
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ delay: index * 0.08, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="flex items-center p-4 rounded-xl bg-vessel-bg-surface border border-vessel-border"
      data-testid={`participant-${participant.id}`}
    >
      <div
        className="w-11 h-11 rounded-full flex items-center justify-center text-white text-base font-bold shrink-0 shadow-sm"
        style={{ backgroundColor: avatarColor }}
      >
        {initials}
      </div>

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
        <div className={`w-8 h-8 rounded-full flex items-center justify-center border ${micActive ? 'bg-vessel-bg-base border-vessel-border' : 'bg-vessel-red/10 border-vessel-red/20'}`}>
          {micActive ? (
            <Mic className="w-4 h-4 text-vessel-accent" />
          ) : (
            <MicOff className="w-4 h-4 text-vessel-red" />
          )}
        </div>
        <div className={`w-8 h-8 rounded-full flex items-center justify-center border ${cameraActive ? 'bg-vessel-bg-base border-vessel-border' : 'bg-vessel-red/10 border-vessel-red/20'}`}>
          {cameraActive ? (
            <Video className="w-4 h-4 text-vessel-accent" />
          ) : (
            <VideoOff className="w-4 h-4 text-vessel-red" />
          )}
        </div>
      </div>
    </motion.div>
  );
}
