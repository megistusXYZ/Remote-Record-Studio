import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { useIdentity } from "../../hooks/use-identity";
import { Input } from "@/components/ui/input";
import { VesselButton } from "../vessel-ui/VesselButton";
import { BackupKeySignInModal } from "./BackupKeySignInModal";
import { NostrSignInModal } from "./NostrSignInModal";
import { VesselBrandIcon } from "../icons/VesselBrandIcon";

type Step = "name" | "welcome";

/**
 * Sign-up is one question: a display name. The key is created silently and
 * the recovery-key prompt appears after the first finished recording (see
 * `RecoveryKeyPrompt`), when there is something to lose. Storage defaults to
 * the instance's server and can be changed in Settings.
 */
export function SignUpScreen({ onComplete }: { onComplete: () => void }) {
  const { createNewIdentity, displayName: storedName } = useIdentity();
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRecoveryKeyModal, setShowRecoveryKeyModal] = useState(false);
  const [showKeyAppModal, setShowKeyAppModal] = useState(false);
  const submitLockRef = useRef(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || submitLockRef.current) return;

    submitLockRef.current = true;
    setIsSubmitting(true);
    setError(null);

    try {
      await createNewIdentity(name.trim());
      setStep("welcome");
    } catch (err) {
      console.error(err);
      setError(
        "We couldn't create your studio. Check your connection and try again.",
      );
    } finally {
      setIsSubmitting(false);
      submitLockRef.current = false;
    }
  };

  useEffect(() => {
    if (step !== "welcome") return undefined;
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

      {step === "name" && (
        <button
          type="button"
          onClick={() => setLocation("/")}
          aria-label="Back"
          className="absolute top-4 left-4 sm:top-6 sm:left-6 z-20 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-vessel-text-muted hover:text-vessel-text-primary hover:bg-vessel-bg-surface/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent/40 transition-colors"
          data-testid="button-onboarding-back"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>
      )}

      <div className="relative z-10 w-full max-w-md flex flex-col items-center">
        {step === "name" ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full flex flex-col"
          >
            <div className="flex items-center self-center gap-2 font-display font-bold text-2xl tracking-tight mb-16">
              <VesselBrandIcon className="w-8 h-8 text-vessel-accent" />
              <div className="flex items-baseline gap-1">
                <span>Vessel</span>
                <div className="w-1.5 h-1.5 rounded-full bg-vessel-accent" />
              </div>
            </div>

            <div className="text-center mb-10">
              <h1 className="font-display text-4xl font-bold mb-3">
                What should we call you?
              </h1>
              <p className="text-vessel-text-secondary text-base">
                Guests will see this name in your sessions.
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

              <VesselButton
                type="submit"
                size="lg"
                className="w-full mt-8"
                isLoading={isSubmitting}
                disabled={!name.trim()}
                data-testid="button-create-studio"
              >
                Create your studio
              </VesselButton>

              <div className="mt-8 text-center text-sm text-vessel-text-muted">
                Already have a studio?{" "}
                <button
                  type="button"
                  onClick={() => setShowRecoveryKeyModal(true)}
                  className="text-vessel-accent hover:underline focus:outline-none"
                  data-testid="button-sign-in-recovery-key"
                >
                  Sign in with your recovery key
                </button>
              </div>

              <div className="mt-3 text-center text-xs text-vessel-text-muted/80">
                <button
                  type="button"
                  onClick={() => setShowKeyAppModal(true)}
                  className="hover:text-vessel-text-primary hover:underline focus:outline-none"
                  data-testid="button-sign-in-key-app"
                >
                  Use a key app instead
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
              Go to your studio &rarr;
            </VesselButton>
          </motion.div>
        )}
      </div>

      <BackupKeySignInModal
        open={showRecoveryKeyModal}
        onOpenChange={setShowRecoveryKeyModal}
        onSuccess={onComplete}
        onUseNostr={() => {
          setShowRecoveryKeyModal(false);
          setShowKeyAppModal(true);
        }}
      />

      <NostrSignInModal
        open={showKeyAppModal}
        onOpenChange={setShowKeyAppModal}
        onSuccess={onComplete}
        onUseBackupKey={() => {
          setShowKeyAppModal(false);
          setShowRecoveryKeyModal(true);
        }}
      />
    </div>
  );
}
