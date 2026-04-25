import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { VesselButton } from "../vessel-ui/VesselButton";
import { useIdentity } from "../../hooks/use-identity";

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
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to restore studio. Please check your backup key.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-vessel-bg-surface border-vessel-border text-vessel-text-primary max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader className="mb-6">
            <DialogTitle className="font-display text-xl">Sign in with backup key</DialogTitle>
            <DialogDescription className="text-vessel-text-secondary mt-2">
              Paste your backup key to restore your studio on this device.
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
                Display Name
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
                Backup Key
              </label>
              <Textarea
                id="backup-key"
                value={backupKey}
                onChange={(e) => setBackupKey(e.target.value)}
                placeholder="nsec1..."
                className="font-mono-vessel resize-none bg-vessel-bg-base border-vessel-border focus-visible:ring-vessel-accent rounded-lg"
                rows={3}
              />
              <p className="text-xs text-vessel-text-muted">
                Your backup key starts with 'nsec1' and is the only way to recover a studio on a new device.
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
              Restore Studio
            </VesselButton>
          </DialogFooter>
        </form>

        {onUseNostr && (
          <div className="mt-4 pt-5 border-t border-vessel-border flex items-center justify-between gap-4">
            <span className="text-xs text-vessel-text-muted">
              Have a Nostr extension instead?
            </span>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onUseNostr();
              }}
              className="group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-vessel-accent/10 border border-vessel-accent/30 text-vessel-accent hover:bg-vessel-accent/15 hover:border-vessel-accent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent shrink-0"
              data-testid="link-switch-to-nostr"
            >
              <span>Sign in with Nostr</span>
              <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">&rarr;</span>
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
