import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { useIdentity } from "../../hooks/use-identity";
import { VesselButton } from "../vessel-ui/VesselButton";
import { BackupKeyModal } from "../vault/BackupKeyModal";
import {
  markFinishedRecording,
  markRecoveryKeySaved,
  shouldPromptForRecoveryKey,
} from "../../lib/recovery-key-ack";

interface RecoveryKeyPromptProps {
  /**
   * Set where a recording has just finished (the session-complete screen).
   * Records that this studio now has something to lose, which is what makes
   * the prompt show here and on the home screen until the key is saved.
   */
  markRecorded?: boolean;
  className?: string;
}

/**
 * Asks the person to save their recovery key, once there is a recording to
 * lose. Shown only for studios whose key lives on this device: guests have no
 * studio, and key-app users back their key up in that app.
 */
export function RecoveryKeyPrompt({
  markRecorded = false,
  className,
}: RecoveryKeyPromptProps) {
  const { identity, pubkey, isGuest, signerType } = useIdentity();
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(false);
  const [, setRevision] = useState(0);

  const eligible = Boolean(
    identity && pubkey && !isGuest && signerType === "local",
  );

  useEffect(() => {
    if (markRecorded && eligible && pubkey) {
      markFinishedRecording(pubkey);
      setRevision((n) => n + 1);
    }
  }, [markRecorded, eligible, pubkey]);

  if (!eligible || !identity || !pubkey) return null;
  if (dismissed || !shouldPromptForRecoveryKey(pubkey)) return null;

  const handleDone = () => {
    markRecoveryKeySaved(pubkey);
    setRevision((n) => n + 1);
  };

  return (
    <>
      <section
        role="status"
        aria-label="Save your recovery key"
        className={`rounded-2xl border border-vessel-accent/30 bg-vessel-accent/5 p-5 sm:p-6 ${className ?? ""}`}
        data-testid="recovery-key-prompt"
      >
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="w-10 h-10 shrink-0 rounded-full bg-vessel-accent/10 border border-vessel-accent/20 flex items-center justify-center">
            <KeyRound className="w-5 h-5 text-vessel-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-display font-bold text-lg text-vessel-text-primary">
              Save your recovery key
            </h2>
            <p className="mt-1 text-sm text-vessel-text-secondary leading-relaxed">
              Your studio lives on this device. Your recovery key is the only
              way back in from another phone or computer. Nobody can recover it
              for you, not even Vessel.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <VesselButton
                size="md"
                onClick={() => setOpen(true)}
                data-testid="recovery-key-prompt-save"
              >
                Save it now
              </VesselButton>
              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="text-sm font-medium text-vessel-text-muted hover:text-vessel-text-primary focus:outline-none focus-visible:underline"
                data-testid="recovery-key-prompt-later"
              >
                Later
              </button>
            </div>
          </div>
        </div>
      </section>

      <BackupKeyModal
        open={open}
        onOpenChange={setOpen}
        identity={identity}
        showStudioId={false}
        onDone={handleDone}
      />
    </>
  );
}
