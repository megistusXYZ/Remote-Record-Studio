import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { useGetSession, useJoinSession } from "@workspace/api-client-react";
import { useIdentity } from "../../hooks/use-identity";
import { getInitials } from "../../lib/identity";
import { useAvatarColor } from "../../hooks/use-avatar-color";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { VesselButton } from "../vessel-ui/VesselButton";
import { VesselCard } from "../vessel-ui/VesselCard";

export function GuestJoinScreen({
  inviteCode,
  onJoined,
}: {
  inviteCode: string;
  onJoined: (sessionId: string) => void;
}) {
  const { data: session, isLoading: isSessionLoading, isError: isSessionError } = useGetSession(inviteCode);
  const joinSessionMutation = useJoinSession();
  const { displayName, createGuestIdentity } = useIdentity();
  const avatarColor = useAvatarColor(session?.hostPubkey ?? null);

  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitLockRef = useRef(false);

  useEffect(() => {
    if (displayName && !name) {
      setName(displayName);
    }
  }, [displayName, name]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !consent || submitLockRef.current || !session) return;

    submitLockRef.current = true;
    setIsJoining(true);
    setError(null);

    try {
      const identity = await createGuestIdentity(name.trim());
      const joinedSession = await joinSessionMutation.mutateAsync({
        sessionId: inviteCode,
        data: { guestName: name.trim(), guestPubkey: identity._pubkey },
      });
      onJoined(joinedSession.id);
    } catch (err: any) {
      console.error(err);
      setError("Failed to join the studio. The invite might be expired.");
      setIsJoining(false);
      submitLockRef.current = false;
    }
  };

  if (isSessionLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-vessel-bg-base text-vessel-text-primary">
        <div className="fixed inset-0 z-0 pointer-events-none">
          <div className="absolute top-0 left-0 w-[800px] h-[800px] bg-vessel-accent/5 rounded-full blur-[120px] -translate-x-1/2 -translate-y-1/2" />
        </div>
        <div className="relative z-10 flex flex-col items-center gap-4">
          <div className="h-10 w-10 border-2 border-vessel-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-vessel-text-secondary text-sm animate-pulse">Finding studio...</p>
        </div>
      </div>
    );
  }

  if (isSessionError || !session) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-vessel-bg-base text-vessel-text-primary px-4">
        <div className="fixed inset-0 z-0 pointer-events-none">
          <div className="absolute top-0 left-0 w-[800px] h-[800px] bg-vessel-accent/5 rounded-full blur-[120px] -translate-x-1/2 -translate-y-1/2" />
        </div>
        <div className="relative z-10 max-w-md text-center">
          <h2 className="font-display text-2xl font-bold mb-4">Studio not found</h2>
          <p className="text-vessel-text-secondary mb-8">
            This invite link doesn't work anymore. The host may have ended the session or cancelled the invite.
          </p>
          <VesselButton onClick={() => (window.location.href = "/")}>Return Home</VesselButton>
        </div>
      </div>
    );
  }

  const hostFirstName = session.hostName.split(" ")[0];
  const initials = getInitials(session.hostName);

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-vessel-bg-base text-vessel-text-primary px-4 selection:bg-vessel-accent/30 selection:text-vessel-accent">
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-0 left-0 w-[800px] h-[800px] bg-vessel-accent/5 rounded-full blur-[120px] -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute bottom-0 right-0 w-[600px] h-[600px] bg-vessel-accent/5 rounded-full blur-[100px] translate-x-1/3 translate-y-1/3" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative z-10 w-full max-w-md"
      >
        <VesselCard variant="default" className="p-8 sm:p-10 flex flex-col items-center text-center">
          <p className="text-sm text-vessel-text-secondary tracking-wide uppercase mb-1">
            You've been invited to record with
          </p>
          <h2 className="text-2xl font-display font-bold text-vessel-text-primary mb-4">
            {session.hostName}
          </h2>

          <div
            className="w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-lg"
            style={{
              backgroundColor: avatarColor,
              boxShadow: `0 0 20px ${avatarColor}40`,
            }}
          >
            {initials}
          </div>

          <div className="w-full h-px bg-vessel-border my-10" />

          <h3 className="font-display text-3xl font-bold mb-3 leading-tight">
            Ready to record with {hostFirstName}?
          </h3>
          <p className="text-sm text-vessel-text-secondary leading-relaxed mb-8">
            You'll record from your browser — no app download needed. Your audio and video stay on
            your device until the session ends.
          </p>

          {error && (
            <div className="w-full mb-6 p-3 rounded-lg bg-vessel-red/10 border border-vessel-red/20 text-vessel-red text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="w-full flex flex-col">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="h-14 bg-vessel-bg-surface border-vessel-border focus-visible:ring-vessel-accent rounded-xl px-5 text-lg mb-4"
              autoFocus
              data-testid="input-guest-name"
            />

            <div className="flex items-center gap-3 px-1 mb-6">
              <Checkbox
                id="consent"
                checked={consent}
                onCheckedChange={(c) => setConsent(c === true)}
                className="border-vessel-border data-[state=checked]:bg-vessel-accent data-[state=checked]:border-vessel-accent"
                data-testid="checkbox-consent"
              />
              <Label
                htmlFor="consent"
                className="text-sm text-vessel-text-secondary cursor-pointer leading-none"
              >
                I agree to be recorded in this session
              </Label>
            </div>

            <VesselButton
              type="submit"
              size="lg"
              className="w-full"
              isLoading={isJoining}
              disabled={!name.trim() || !consent}
              data-testid="button-join-studio"
            >
              {isJoining ? `Connecting to ${hostFirstName}'s studio...` : "Join the Studio \u2192"}
            </VesselButton>

            <p className="text-xs text-vessel-text-muted mt-5">
              Your files will be delivered to you after recording ends.
            </p>
          </form>
        </VesselCard>
      </motion.div>
    </div>
  );
}
