import { useEffect, useState } from "react";
import { Chrome, KeyRound, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { VesselButton } from "../vessel-ui/VesselButton";
import { useIdentity } from "../../hooks/use-identity";

interface NostrSignInModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

type Mode = "choose" | "extension" | "remote";

/**
 * Sign-in modal for users who already have a Nostr identity. The word "Nostr"
 * is allowed here per the product brief — this is the explicit Nostr on-ramp.
 */
export function NostrSignInModal({ open, onOpenChange, onSuccess }: NostrSignInModalProps) {
  const { signInWithExtension, signInWithRemoteSigner, isNostrExtensionAvailable } = useIdentity();
  const [mode, setMode] = useState<Mode>("choose");
  const [displayName, setDisplayName] = useState("");
  const [bunkerUri, setBunkerUri] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extensionPresent, setExtensionPresent] = useState(false);

  useEffect(() => {
    if (open) {
      setExtensionPresent(isNostrExtensionAvailable());
      setMode("choose");
      setError(null);
      setIsLoading(false);
    }
  }, [open, isNostrExtensionAvailable]);

  const handleExtension = async () => {
    if (!displayName.trim()) {
      setError("Choose a name guests will see in the studio.");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      await signInWithExtension(displayName.trim());
      onSuccess();
      onOpenChange(false);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Couldn't sign in with your browser extension.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemote = async () => {
    if (!displayName.trim()) {
      setError("Choose a name guests will see in the studio.");
      return;
    }
    if (!bunkerUri.trim().startsWith("bunker://")) {
      setError("Paste a connection URL that starts with 'bunker://'.");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      await signInWithRemoteSigner(bunkerUri.trim(), displayName.trim());
      onSuccess();
      onOpenChange(false);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Couldn't connect to your remote signer.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-vessel-bg-surface border-vessel-border text-vessel-text-primary max-w-md">
        <DialogHeader className="mb-2">
          <DialogTitle className="font-display text-xl">Sign in with Nostr</DialogTitle>
          <DialogDescription className="text-vessel-text-secondary mt-2">
            {mode === "choose"
              ? "Use the same identity you already use elsewhere on Nostr. Your key never touches Vessel."
              : "Choose a name guests will see during your studio sessions."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="p-3 mt-4 text-sm rounded-lg bg-vessel-red/10 border border-vessel-red/20 text-vessel-red">
            {error}
          </div>
        )}

        {mode === "choose" && (
          <div className="space-y-3 mt-4">
            <button
              type="button"
              onClick={() => setMode("extension")}
              disabled={!extensionPresent}
              className="w-full text-left p-4 rounded-xl bg-vessel-bg-base border border-vessel-border hover:border-vessel-accent/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-start gap-3"
              data-testid="button-choose-extension"
            >
              <Chrome className="w-5 h-5 text-vessel-accent shrink-0 mt-0.5" />
              <div>
                <div className="font-medium text-vessel-text-primary">Browser extension</div>
                <div className="text-xs text-vessel-text-secondary mt-1">
                  {extensionPresent
                    ? "Sign with the extension you already have installed (Alby, nos2x, etc.)."
                    : "Install Alby, nos2x, or another Nostr extension to use this option."}
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setMode("remote")}
              className="w-full text-left p-4 rounded-xl bg-vessel-bg-base border border-vessel-border hover:border-vessel-accent/40 transition-colors flex items-start gap-3"
              data-testid="button-choose-remote"
            >
              <KeyRound className="w-5 h-5 text-vessel-accent shrink-0 mt-0.5" />
              <div>
                <div className="font-medium text-vessel-text-primary">Remote signer</div>
                <div className="text-xs text-vessel-text-secondary mt-1">
                  Paste a connection URL from your signer app (Amber and similar apps).
                </div>
              </div>
            </button>
          </div>
        )}

        {mode === "extension" && (
          <div className="space-y-4 mt-4">
            <div className="space-y-2">
              <label htmlFor="ext-name" className="text-sm font-medium text-vessel-text-primary">
                Display name
              </label>
              <Input
                id="ext-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="How you appear to guests"
                className="h-12 bg-vessel-bg-base border-vessel-border focus-visible:ring-vessel-accent rounded-lg"
                autoFocus
                data-testid="input-ext-display-name"
              />
            </div>
            <p className="text-xs text-vessel-text-muted">
              You'll see a permission prompt from your extension to share your public key with Vessel.
            </p>
          </div>
        )}

        {mode === "remote" && (
          <div className="space-y-4 mt-4">
            <div className="space-y-2">
              <label htmlFor="remote-name" className="text-sm font-medium text-vessel-text-primary">
                Display name
              </label>
              <Input
                id="remote-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="How you appear to guests"
                className="h-12 bg-vessel-bg-base border-vessel-border focus-visible:ring-vessel-accent rounded-lg"
                autoFocus
                data-testid="input-remote-display-name"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="bunker-uri" className="text-sm font-medium text-vessel-text-primary">
                Connection URL
              </label>
              <Textarea
                id="bunker-uri"
                value={bunkerUri}
                onChange={(e) => setBunkerUri(e.target.value)}
                placeholder="bunker://..."
                className="font-mono-vessel resize-none bg-vessel-bg-base border-vessel-border focus-visible:ring-vessel-accent rounded-lg"
                rows={3}
                data-testid="input-bunker-uri"
              />
              <p className="text-xs text-vessel-text-muted">
                Find this in your signer app under "Connect to client" or similar.
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="mt-6 flex gap-3 sm:justify-between">
          {mode === "choose" ? (
            <VesselButton
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </VesselButton>
          ) : (
            <VesselButton
              type="button"
              variant="ghost"
              onClick={() => setMode("choose")}
              disabled={isLoading}
            >
              &larr; Back
            </VesselButton>
          )}

          {mode === "extension" && (
            <VesselButton
              type="button"
              onClick={handleExtension}
              isLoading={isLoading}
              disabled={!displayName.trim()}
              data-testid="button-submit-extension"
            >
              Continue with extension
            </VesselButton>
          )}
          {mode === "remote" && (
            <VesselButton
              type="button"
              onClick={handleRemote}
              isLoading={isLoading}
              disabled={!displayName.trim() || !bunkerUri.trim()}
              data-testid="button-submit-remote"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Connecting…
                </>
              ) : (
                "Connect"
              )}
            </VesselButton>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
