import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { VesselButton } from "../vessel-ui/VesselButton";
import { useIdentity } from "../../hooks/use-identity";
import { INVALID_RECOVERY_KEY_MESSAGE } from "../../lib/identity";

interface BackupKeySignInModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  onUseNostr?: () => void;
}

export function BackupKeySignInModal({ open, onOpenChange, onSuccess, onUseNostr }: BackupKeySignInModalProps) {
  const { importFromBackup } = useIdentity();
  const [displayName, setDisplayName] = useState("");
  const [backupKey, setBackupKey] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim() || !backupKey.trim() || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      await importFromBackup(backupKey.trim(), displayName.trim());
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      console.error(err);
      // Keep the one specific hint that helps (the pasted text is not a key at
      // all); everything else gets the generic line so no raw error leaks.
      setError(
        err instanceof Error && err.message === INVALID_RECOVERY_KEY_MESSAGE
          ? err.message
          : "That recovery key didn't work. Check it and try again.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-vessel-bg-surface border-vessel-border text-vessel-text-primary max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader className="mb-6">
            <DialogTitle className="font-display text-xl">Sign in with your recovery key</DialogTitle>
            <DialogDescription className="text-vessel-text-secondary mt-2">
              Paste your recovery key to open your studio on this device.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {error && (
              <div className="p-3 text-sm rounded-lg bg-vessel-red/10 border border-vessel-red/20 text-vessel-red">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="restore-name" className="text-sm font-medium text-vessel-text-primary">
                Display name
              </label>
              <Input
                id="restore-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="How you appear to guests"
                className="h-12 bg-vessel-bg-base border-vessel-border focus-visible:ring-vessel-accent rounded-lg"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="backup-key" className="text-sm font-medium text-vessel-text-primary">
                Recovery key
              </label>
              <Textarea
                id="backup-key"
                value={backupKey}
                onChange={(e) => setBackupKey(e.target.value)}
                placeholder="Paste your recovery key"
                className="font-mono-vessel resize-none bg-vessel-bg-base border-vessel-border focus-visible:ring-vessel-accent rounded-lg"
                rows={2}
              />
              <p className="text-xs text-vessel-text-muted">
                It's the long code you saved when you set up your studio.
              </p>
            </div>
          </div>

          <DialogFooter className="mt-8 flex gap-3 sm:justify-start">
            <VesselButton
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </VesselButton>
            <VesselButton
              type="submit"
              isLoading={isLoading}
              disabled={!displayName.trim() || !backupKey.trim()}
            >
              Sign in
            </VesselButton>
          </DialogFooter>
        </form>

        {onUseNostr && (
          <div className="mt-4 pt-5 border-t border-vessel-border flex justify-center">
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onUseNostr();
              }}
              className="text-xs text-vessel-text-muted hover:text-vessel-accent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent rounded"
              data-testid="link-switch-to-nostr"
            >
              Use a key app instead
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
