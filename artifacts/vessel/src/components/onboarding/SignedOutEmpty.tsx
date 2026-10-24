import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { KeyRound } from "lucide-react";
import { VesselButton } from "../vessel-ui/VesselButton";
import { VesselBrandIcon } from "../icons/VesselBrandIcon";
import { BackupKeySignInModal } from "./BackupKeySignInModal";
import { NostrSignInModal } from "./NostrSignInModal";

type SignedOutEmptyProps = {
  context: "home" | "vault";
};

const COPY: Record<SignedOutEmptyProps["context"], { headline: string; body: string }> = {
  home: {
    headline: "You're not signed in.",
    body: "Create a fresh studio to start recording, or sign in on this device with your recovery key.",
  },
  vault: {
    headline: "Your vault lives in your studio.",
    body: "Sign in with your recovery key to see the recordings tied to your studio. New here? You can create a studio in a few seconds.",
  },
};

export function SignedOutEmpty({ context }: SignedOutEmptyProps) {
  const [, setLocation] = useLocation();
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [showNostrModal, setShowNostrModal] = useState(false);
  const { headline, body } = COPY[context];
  const successPath = context === "vault" ? "/vault" : "/home";

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center relative overflow-hidden bg-vessel-bg-base text-vessel-text-primary px-6 selection:bg-vessel-accent/30 selection:text-vessel-accent">
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-0 left-0 w-[800px] h-[800px] bg-vessel-accent/5 rounded-full blur-[120px] -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute bottom-0 right-0 w-[600px] h-[600px] bg-vessel-accent/5 rounded-full blur-[100px] translate-x-1/3 translate-y-1/3" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 max-w-lg w-full text-center flex flex-col items-center"
      >
        <a
          href="/"
          className="group flex items-center gap-2 mb-12 text-vessel-text-primary"
          data-testid="link-vessel-home"
        >
          <VesselBrandIcon className="w-7 h-7 text-vessel-accent shrink-0 transition-transform group-hover:-translate-y-px" />
          <span className="font-display font-bold text-2xl tracking-tight">
            Vessel<span className="text-vessel-accent">.</span>
          </span>
        </a>

        <div className="relative mb-6">
          <div className="absolute inset-0 rounded-full bg-vessel-accent/15 blur-xl" aria-hidden="true" />
          <div className="relative w-16 h-16 rounded-full bg-vessel-accent/10 border border-vessel-accent/25 flex items-center justify-center">
            <KeyRound className="w-7 h-7 text-vessel-accent" />
          </div>
        </div>

        <h1 className="font-display text-3xl sm:text-4xl font-bold mb-3 tracking-tight">{headline}</h1>
        <p className="text-vessel-text-secondary text-sm sm:text-base leading-relaxed mb-8 max-w-md">
          {body}
        </p>

        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto sm:justify-center">
          <VesselButton
            onClick={() => setLocation("/start")}
            data-testid="signed-out-cta-create"
            className="whitespace-nowrap sm:min-w-[180px]"
          >
            Create a studio
          </VesselButton>
          <VesselButton
            variant="ghost"
            onClick={() => setShowBackupModal(true)}
            data-testid="signed-out-cta-backup"
            className="whitespace-nowrap sm:min-w-[180px]"
          >
            Sign in with your recovery key
          </VesselButton>
        </div>

        <button
          type="button"
          onClick={() => setLocation("/")}
          className="mt-8 inline-flex items-center gap-1 text-xs text-vessel-text-muted hover:text-vessel-accent transition-colors"
        >
          <span aria-hidden="true">&larr;</span> Back to home page
        </button>
      </motion.div>

      <BackupKeySignInModal
        open={showBackupModal}
        onOpenChange={setShowBackupModal}
        onSuccess={() => setLocation(successPath)}
        onUseNostr={() => {
          setShowBackupModal(false);
          setShowNostrModal(true);
        }}
      />

      <NostrSignInModal
        open={showNostrModal}
        onOpenChange={setShowNostrModal}
        onSuccess={() => setLocation(successPath)}
        onUseBackupKey={() => {
          setShowNostrModal(false);
          setShowBackupModal(true);
        }}
      />
    </div>
  );
}
