import { useState } from "react";
import { motion } from "framer-motion";
import {
  ShieldCheck,
  User,
  Mic,
  Cloud,
  Eye,
  ShieldOff,
  AlertCircle,
  Lock,
  Loader2,
  Users,
} from "lucide-react";
import { VesselButton } from "../vessel-ui/VesselButton";
import { cn } from "@/lib/utils";

/**
 * Consent screen — second pre-join step.
 *
 * Shown after the greenroom. The point is to make every meaningful claim
 * about the recording explicit before the guest enters the studio: who they
 * are recording with, what gets captured, where the file lives, who has
 * access, and how to take the access back.
 *
 * Both actions ("I'm in" / "Decline and leave") get equal visual weight so the
 * decline path doesn't feel like a hidden corner. The screen also surfaces
 * a friendly room-full state if the join API rejects with a 409.
 */

export type RoomFullInfo = {
  hostName: string;
  participantCount: number;
  maxParticipants: number;
};

export type ConsentScreenProps = {
  hostName: string;
  sessionTitle: string;
  myName: string;
  /** Resolves on success. Caller is responsible for navigation. The screen
   *  only manages its own loading + error UI. */
  onAccept: () => Promise<void>;
  onDecline: () => void;
  /** When set, the studio is full — render the friendly blocked view. */
  roomFull: RoomFullInfo | null;
  /** When non-null, render the inline error block. */
  error: string | null;
};

export function ConsentScreen({
  hostName,
  sessionTitle,
  myName,
  onAccept,
  onDecline,
  roomFull,
  error,
}: ConsentScreenProps) {
  const [submitting, setSubmitting] = useState(false);
  const hostFirst = hostName.split(" ")[0];

  const handleAccept = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onAccept();
    } finally {
      setSubmitting(false);
    }
  };

  if (roomFull) {
    return <RoomFullView info={roomFull} onLeave={onDecline} />;
  }

  return (
    <div className="min-h-[100dvh] bg-vessel-bg-base text-vessel-text-primary">
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-0 left-0 w-[800px] h-[800px] bg-vessel-accent/5 rounded-full blur-[120px] -translate-x-1/2 -translate-y-1/2" />
      </div>

      <div className="relative z-10 max-w-xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <motion.header
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mb-8 text-center"
        >
          <p className="text-xs font-mono-vessel text-vessel-accent uppercase tracking-wider mb-2">
            One last thing
          </p>
          <h1
            className="font-display text-2xl sm:text-3xl font-bold tracking-tight mb-2"
            data-testid="text-consent-title"
          >
            How {hostFirst}'s recording works
          </h1>
          <p className="text-sm text-vessel-text-secondary">
            Take a second to know what's happening to your audio and video.
          </p>
        </motion.header>

        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.05 }}
          className="rounded-2xl bg-vessel-bg-surface border border-vessel-border p-6 sm:p-7 space-y-5"
          data-testid="card-consent-contract"
        >
          <ContractRow
            icon={<User className="w-4 h-4" />}
            label="Who you're with"
            body={
              <>
                You're joining <span className="text-vessel-text-primary font-medium">{hostName}</span>'s
                session{" "}
                <span className="text-vessel-text-muted">— {sessionTitle}</span>. You'll show up
                as <span className="text-vessel-text-primary font-medium">{myName}</span>.
              </>
            }
          />
          <ContractRow
            icon={<Mic className="w-4 h-4" />}
            label="What gets recorded"
            body={
              <>
                Your microphone and camera, captured locally as a high-quality track.
                Recording starts when {hostFirst} starts the session and ends when you leave.
              </>
            }
          />
          <ContractRow
            icon={<Cloud className="w-4 h-4" />}
            label="Where your file goes"
            body={
              <>
                Your track is uploaded to storage so {hostFirst} can download it, and a copy
                stays on this device. Vessel's server never sees the file.
              </>
            }
          />
          <ContractRow
            icon={<Eye className="w-4 h-4" />}
            label="Who else can see it"
            body={
              <>
                <span className="text-vessel-text-primary font-medium">{hostFirst}</span>{" "}
                gets read access for the multi-track edit — until you take it away. Nobody else.
              </>
            }
          />
          <ContractRow
            icon={<ShieldOff className="w-4 h-4" />}
            label="Taking access back"
            body={
              <>
                When the session ends you get a receipt link. Open it any time to take{" "}
                {hostFirst}'s access back. No email or account needed.
              </>
            }
          />

          <div className="flex items-center gap-2 pt-1 text-[11px] text-vessel-text-muted border-t border-vessel-border pt-4">
            <Lock className="w-3 h-3 shrink-0" />
            <span>Only this device can take that access back.</span>
          </div>
        </motion.section>

        {error && (
          <div
            className="mt-4 p-3 rounded-lg bg-vessel-red/10 border border-vessel-red/30 text-vessel-red text-sm flex items-start gap-2"
            role="alert"
            data-testid="text-consent-error"
          >
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.1 }}
          className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          <VesselButton
            variant="ghost"
            size="lg"
            onClick={onDecline}
            disabled={submitting}
            className="w-full"
            data-testid="button-consent-decline"
          >
            Decline and leave
          </VesselButton>
          <VesselButton
            variant="primary"
            size="lg"
            onClick={handleAccept}
            disabled={submitting}
            className="w-full"
            data-testid="button-consent-accept"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Joining…
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4 mr-2" />
                I'm in
              </>
            )}
          </VesselButton>
        </motion.div>

        <p className="text-xs text-vessel-text-muted text-center mt-6">
          By joining you accept this recording's terms. You can leave at any time.
        </p>
      </div>
    </div>
  );
}

function ContractRow({
  icon,
  label,
  body,
}: {
  icon: React.ReactNode;
  label: string;
  body: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <div
        className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
          "bg-vessel-accent/10 border border-vessel-accent/30 text-vessel-accent",
        )}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xs font-mono-vessel text-vessel-text-muted uppercase tracking-wider mb-1">
          {label}
        </div>
        <div className="text-sm text-vessel-text-secondary leading-relaxed">{body}</div>
      </div>
    </div>
  );
}

function RoomFullView({
  info,
  onLeave,
}: {
  info: RoomFullInfo;
  onLeave: () => void;
}) {
  const hostFirst = info.hostName.split(" ")[0];
  return (
    <div className="min-h-[100dvh] bg-vessel-bg-base text-vessel-text-primary flex items-center justify-center px-4">
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-0 left-0 w-[800px] h-[800px] bg-vessel-amber/5 rounded-full blur-[120px] -translate-x-1/2 -translate-y-1/2" />
      </div>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 max-w-md w-full text-center"
        data-testid="card-room-full"
      >
        <div className="w-16 h-16 mx-auto rounded-full bg-vessel-amber/10 border border-vessel-amber/40 text-vessel-amber flex items-center justify-center mb-5">
          <Users className="w-7 h-7" />
        </div>
        <h1 className="font-display text-2xl font-bold tracking-tight mb-3">
          {hostFirst}'s session is full
        </h1>
        <p className="text-sm text-vessel-text-secondary leading-relaxed mb-2">
          {info.participantCount} of {info.maxParticipants} people are already on the call.
        </p>
        <p className="text-sm text-vessel-text-secondary leading-relaxed mb-8">
          Try again in a moment, or message {hostFirst} to be let in.
        </p>
        <VesselButton
          variant="primary"
          size="md"
          onClick={onLeave}
          className="w-full sm:w-auto"
          data-testid="button-room-full-leave"
        >
          Back to home
        </VesselButton>
      </motion.div>
    </div>
  );
}
