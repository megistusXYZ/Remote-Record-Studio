import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { useIdentity } from "../../hooks/use-identity";
import { Input } from "@/components/ui/input";
import { VesselButton } from "../vessel-ui/VesselButton";
import { BackupKeySignInModal } from "./BackupKeySignInModal";
import { NostrSignInModal } from "./NostrSignInModal";

export function SignUpScreen({ onComplete }: { onComplete: () => void }) {
  const { createNewIdentity, displayName: storedName } = useIdentity();
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [showNostrModal, setShowNostrModal] = useState(false);
  const submitLockRef = useRef(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || submitLockRef.current) return;

    submitLockRef.current = true;
    setIsSubmitting(true);
    setError(null);

    try {
      await createNewIdentity(name.trim(), email.trim() || undefined);
      setStep(2);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to create studio.");
      setIsSubmitting(false);
      submitLockRef.current = false;
    }
  };

  useEffect(() => {
    if (step !== 2) return undefined;
    const timer = setTimeout(() => {
      onComplete();
    }, 2000);
    return () => clearTimeout(timer);
  }, [step, onComplete]);

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center relative overflow-hidden bg-vessel-bg-base text-vessel-text-primary px-4 selection:bg-vessel-accent/30 selection:text-vessel-accent">
      {/* Background glow identical to landing page */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-0 left-0 w-[800px] h-[800px] bg-vessel-accent/5 rounded-full blur-[120px] -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute bottom-0 right-0 w-[600px] h-[600px] bg-vessel-accent/5 rounded-full blur-[100px] translate-x-1/3 translate-y-1/3" />
      </div>

      <div className="relative z-10 w-full max-w-md flex flex-col items-center">
        {step === 1 ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full flex flex-col"
          >
            <div className="flex items-center self-center font-display font-bold text-2xl tracking-tight mb-16">
              Vessel<span className="text-vessel-accent">.</span>
            </div>

            <div className="text-center mb-10">
              <h1 className="font-display text-4xl font-bold mb-3">What should we call you?</h1>
              <p className="text-vessel-text-secondary text-base">
                This is how you'll appear to guests in your studio.
              </p>
            </div>

            {error && (
              <div className="mb-6 p-4 rounded-xl bg-vessel-red/10 border border-vessel-red/20 text-vessel-red text-sm text-center">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="flex flex-col">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="h-14 bg-vessel-bg-surface border-vessel-border focus-visible:ring-vessel-accent rounded-xl px-5 text-lg"
                autoFocus
                data-testid="input-display-name"
              />

              <div className="mt-4">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email (optional, for account recovery)"
                  className="h-12 bg-vessel-bg-surface border-vessel-border focus-visible:ring-vessel-accent rounded-xl px-5"
                  data-testid="input-email"
                />
                <p className="text-xs text-vessel-text-muted mt-2 ml-1">
                  Optional. We'll never spam you.
                </p>
              </div>

              <VesselButton
                type="submit"
                size="lg"
                className="w-full mt-8"
                isLoading={isSubmitting}
                disabled={!name.trim()}
                data-testid="button-create-studio"
              >
                Create My Studio &rarr;
              </VesselButton>

              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-vessel-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase tracking-wider">
                  <span className="bg-vessel-bg-base px-3 text-vessel-text-muted">or</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowNostrModal(true)}
                className="w-full h-12 rounded-xl bg-vessel-bg-surface border border-vessel-border hover:border-vessel-accent/40 transition-colors text-vessel-text-primary text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent"
                data-testid="button-sign-in-nostr"
              >
                Sign in with Nostr
              </button>

              <div className="mt-6 text-center text-sm text-vessel-text-muted">
                Already have a studio?{" "}
                <button
                  type="button"
                  onClick={() => setShowBackupModal(true)}
                  className="text-vessel-accent hover:underline focus:outline-none"
                >
                  Sign in with your backup key
                </button>
              </div>
            </form>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full flex flex-col items-center text-center"
          >
            <div className="mb-8 flex items-center justify-center">
              <motion.svg
                width="96"
                height="96"
                viewBox="0 0 96 96"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <motion.circle
                  cx="48"
                  cy="48"
                  r="46"
                  stroke="var(--vessel-accent)"
                  strokeWidth="4"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 200, damping: 20 }}
                />
                <motion.path
                  d="M32 48L42.5 58.5L64 37"
                  stroke="var(--vessel-accent)"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.4, delay: 0.2, ease: "easeOut" }}
                />
              </motion.svg>
            </div>

            <h2 className="font-display text-3xl font-bold mb-3">
              Welcome to Vessel, {storedName || name}.
            </h2>
            <p className="text-vessel-text-secondary mb-10">
              Your studio is set up and ready.
            </p>

            <VesselButton variant="ghost" size="md" onClick={onComplete}>
              Enter Studio &rarr;
            </VesselButton>
          </motion.div>
        )}
      </div>

      <BackupKeySignInModal
        open={showBackupModal}
        onOpenChange={setShowBackupModal}
        onSuccess={onComplete}
      />

      <NostrSignInModal
        open={showNostrModal}
        onOpenChange={setShowNostrModal}
        onSuccess={onComplete}
      />
    </div>
  );
}
