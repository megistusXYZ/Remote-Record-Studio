import { useEffect, useRef, useState } from "react";
import { Chrome, Copy, KeyRound, Loader2, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
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
import {
  isSupportedRemoteSignerUri,
  startNostrConnectInvite,
  type NostrConnectInvite,
  type VesselIdentity,
} from "../../lib/identity";

interface NostrSignInModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

type Mode = "choose" | "extension" | "remote-paste" | "remote-invite";

/**
 * Sign-in modal for users who already have a Nostr identity. The word "Nostr"
 * is allowed here per the product brief — this is the explicit Nostr on-ramp.
 *
 * Two NIP-46 sub-flows:
 *   - "remote-paste": user has a `bunker://` URL from their signer, pastes it.
 *   - "remote-invite": we generate a `nostrconnect://` URL (with our client
 *     keypair baked in) for the user to scan/paste in their signer.
 */
export function NostrSignInModal({ open, onOpenChange, onSuccess }: NostrSignInModalProps) {
  const {
    signInWithExtension,
    signInWithRemoteSigner,
    adoptIdentity,
    isNostrExtensionAvailable,
  } = useIdentity();
  const [mode, setMode] = useState<Mode>("choose");
  const [displayName, setDisplayName] = useState("");
  const [bunkerUri, setBunkerUri] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extensionPresent, setExtensionPresent] = useState(false);
  const [invite, setInvite] = useState<NostrConnectInvite | null>(null);
  const [waitingForSigner, setWaitingForSigner] = useState(false);
  const inviteRef = useRef<NostrConnectInvite | null>(null);

  useEffect(() => {
    if (open) {
      setExtensionPresent(isNostrExtensionAvailable());
      setMode("choose");
      setError(null);
      setIsLoading(false);
      setBunkerUri("");
      setWaitingForSigner(false);
      setInvite(null);
    }
  }, [open, isNostrExtensionAvailable]);

  // Tear down any open invite subscription when the modal closes (open flips
  // false) or the component unmounts (covers ESC, backdrop click, parent
  // unmount, navigation, hot-reload).
  useEffect(() => {
    if (!open) {
      const i = inviteRef.current;
      if (i) {
        void i.cancel();
        inviteRef.current = null;
      }
    }
  }, [open]);
  useEffect(() => {
    return () => {
      const i = inviteRef.current;
      if (i) {
        void i.cancel();
        inviteRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    inviteRef.current = invite;
  }, [invite]);

  const cancelInvite = async () => {
    if (inviteRef.current) {
      await inviteRef.current.cancel();
      inviteRef.current = null;
      setInvite(null);
    }
    setWaitingForSigner(false);
  };

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
    } catch (err) {
      console.error(err);
      setError((err instanceof Error && err.message) || "Couldn't sign in with your browser extension.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemotePaste = async () => {
    if (!displayName.trim()) {
      setError("Choose a name guests will see in the studio.");
      return;
    }
    if (!isSupportedRemoteSignerUri(bunkerUri)) {
      setError("Paste a connection URL that starts with 'bunker://'.");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      await signInWithRemoteSigner(bunkerUri.trim(), displayName.trim());
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      console.error(err);
      setError((err instanceof Error && err.message) || "Couldn't connect to your remote signer.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartInvite = async () => {
    if (!displayName.trim()) {
      setError("Choose a name guests will see in the studio.");
      return;
    }
    setError(null);
    try {
      const i = startNostrConnectInvite();
      setInvite(i);
      inviteRef.current = i;
      setWaitingForSigner(true);
      // Block until the signer connects. This won't block the UI — the modal
      // shows a "waiting…" indicator and a Cancel button.
      const identity: VesselIdentity = await i.awaitConnection(displayName.trim());
      // Route through useIdentity().adoptIdentity so the post-sign-in side
      // effects (Zustand store + best-effort backend register) match the other
      // sign-in paths.
      await adoptIdentity(identity);
      inviteRef.current = null;
      setInvite(null);
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      console.error(err);
      setError((err instanceof Error && err.message) || "Couldn't complete the connection.");
      await cancelInvite();
    } finally {
      setWaitingForSigner(false);
    }
  };

  const handleCopyInvite = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.uri);
    } catch {
      /* clipboard might be blocked — fall through; user can copy manually */
    }
  };

  // Wrap the dialog's onOpenChange so any in-flight invite is torn down before
  // the parent unmounts the dialog content (ESC, backdrop click, X button).
  const handleOpenChange = (next: boolean) => {
    if (!next && inviteRef.current) {
      void inviteRef.current.cancel();
      inviteRef.current = null;
      setInvite(null);
      setWaitingForSigner(false);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
              onClick={() => setMode("remote-paste")}
              className="w-full text-left p-4 rounded-xl bg-vessel-bg-base border border-vessel-border hover:border-vessel-accent/40 transition-colors flex items-start gap-3"
              data-testid="button-choose-remote-paste"
            >
              <KeyRound className="w-5 h-5 text-vessel-accent shrink-0 mt-0.5" />
              <div>
                <div className="font-medium text-vessel-text-primary">Paste a connection URL</div>
                <div className="text-xs text-vessel-text-secondary mt-1">
                  Use a <code className="font-mono-vessel">bunker://</code> URL from your signer app
                  (Amber and similar apps).
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setMode("remote-invite")}
              className="w-full text-left p-4 rounded-xl bg-vessel-bg-base border border-vessel-border hover:border-vessel-accent/40 transition-colors flex items-start gap-3"
              data-testid="button-choose-remote-invite"
            >
              <QrCode className="w-5 h-5 text-vessel-accent shrink-0 mt-0.5" />
              <div>
                <div className="font-medium text-vessel-text-primary">Scan from your signer</div>
                <div className="text-xs text-vessel-text-secondary mt-1">
                  Show a QR code Vessel generates and approve the connection inside your signer.
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

        {mode === "remote-paste" && (
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
                placeholder="bunker://…"
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

        {mode === "remote-invite" && (
          <div className="space-y-4 mt-4">
            <div className="space-y-2">
              <label htmlFor="invite-name" className="text-sm font-medium text-vessel-text-primary">
                Display name
              </label>
              <Input
                id="invite-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="How you appear to guests"
                className="h-12 bg-vessel-bg-base border-vessel-border focus-visible:ring-vessel-accent rounded-lg"
                autoFocus
                disabled={waitingForSigner}
                data-testid="input-invite-display-name"
              />
            </div>

            {!invite && (
              <p className="text-xs text-vessel-text-muted">
                Vessel will generate a one-time connection URL. Open it (or scan the QR) in your
                signer app, approve the request, and you'll be signed in.
              </p>
            )}

            {invite && (
              <div className="space-y-3">
                <div className="rounded-xl bg-white p-4 flex items-center justify-center">
                  <QRCodeSVG
                    value={invite.uri}
                    size={196}
                    level="M"
                    bgColor="#ffffff"
                    fgColor="#080b0f"
                    data-testid="qr-invite"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={invite.uri}
                    className="font-mono-vessel text-xs bg-vessel-bg-base border-vessel-border"
                    onFocus={(e) => e.currentTarget.select()}
                    data-testid="input-invite-uri"
                  />
                  <VesselButton
                    type="button"
                    variant="ghost"
                    onClick={handleCopyInvite}
                    aria-label="Copy invite URL"
                    data-testid="button-copy-invite"
                  >
                    <Copy className="w-4 h-4" />
                  </VesselButton>
                </div>
                {waitingForSigner && (
                  <div className="flex items-center gap-2 text-xs text-vessel-text-secondary">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Waiting for your signer to approve…
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="mt-6 flex gap-3 sm:justify-between">
          {mode === "choose" ? (
            <VesselButton
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </VesselButton>
          ) : (
            <VesselButton
              type="button"
              variant="ghost"
              onClick={async () => {
                await cancelInvite();
                setMode("choose");
              }}
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
          {mode === "remote-paste" && (
            <VesselButton
              type="button"
              onClick={handleRemotePaste}
              isLoading={isLoading}
              disabled={!displayName.trim() || !bunkerUri.trim()}
              data-testid="button-submit-remote-paste"
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
          {mode === "remote-invite" && !invite && (
            <VesselButton
              type="button"
              onClick={handleStartInvite}
              disabled={!displayName.trim()}
              data-testid="button-start-invite"
            >
              Generate connection URL
            </VesselButton>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
