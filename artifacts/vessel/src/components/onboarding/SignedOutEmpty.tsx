import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { KeyRound } from "lucide-react";
import { VesselButton } from "../vessel-ui/VesselButton";
import { BackupKeySignInModal } from "./BackupKeySignInModal";

type SignedOutEmptyProps = {
  context: "home" | "vault";
};

const COPY: Record<SignedOutEmptyProps["context"], { headline: string; body: string }> = {
  home: {
    headline: "You're not signed in.",
    body: "Create a fresh studio to start recording, or sign in on this device with the backup key from your other studio.",
  },
  vault: {
    headline: "Your vault lives in your studio.",
    body: "Sign in with the backup key from your studio to see the recordings tied to it. New here? You can create a studio in a few seconds.",
  },
};

export function SignedOutEmpty({ context }: SignedOutEmptyProps) {
  const [, setLocation] = useLocation();
  const [showBackupModal, setShowBackupModal] = useState(false);
  const { headline, body } = COPY[context];

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center relative overflow-hidden bg-vessel-bg-base text-vessel-text-primary px-6 selection:bg-vessel-accent/30 selection:text-vessel-accent">
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-0 left-0 w-[800px] h-[800px] bg-vessel-accent/5 rounded-full blur-[120px] -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute bottom-0 right-0 w-[600px] h-[600px] bg-vessel-accent/5 rounded-full blur-[100px] translate-x-1/3 translate-y-1/3" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 max-w-md w-full text-center flex flex-col items-center"
      >
        <div className="flex items-center font-display font-bold text-2xl tracking-tight mb-12">
          Vessel<span className="text-vessel-accent">.</span>
        </div>

        <div className="w-14 h-14 rounded-full bg-vessel-accent/10 border border-vessel-accent/20 flex items-center justify-center mb-6">
          <KeyRound className="w-6 h-6 text-vessel-accent" />
        </div>

        <h1 className="font-display text-3xl font-bold mb-3">{headline}</h1>
        <p className="text-vessel-text-secondary text-sm leading-relaxed mb-8">{body}</p>

        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto sm:justify-center">
          <VesselButton
            size="lg"
            onClick={() => setLocation("/start")}
            data-testid="signed-out-cta-create"
          >
            Create a studio
          </VesselButton>
          <VesselButton
            variant="ghost"
            size="lg"
            onClick={() => setShowBackupModal(true)}
            data-testid="signed-out-cta-backup"
          >
            Sign in with backup key
          </VesselButton>
        </div>

        <button
          type="button"
          onClick={() => setLocation("/")}
          className="mt-8 text-xs text-vessel-text-muted hover:text-vessel-text-secondary transition-colors"
        >
          &larr; Back to home page
        </button>
      </motion.div>

      <BackupKeySignInModal
        open={showBackupModal}
        onOpenChange={setShowBackupModal}
        onSuccess={() => setLocation(context === "vault" ? "/vault" : "/home")}
      />
    </div>
  );
}
