import { useEffect, useState } from "react";
import { useRoute, Link } from "wouter";
import { ShieldOff, ShieldAlert, Loader2, Check, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
import {
  revokeShareLink,
  ShareRevokeError,
  isLocallyRevoked,
  getRevokeMaterial,
  type ShareRevokeResult,
} from "../lib/share-revoke";
import {
  getReceiptByArchiveId,
  type PersonalReceiptRecord,
} from "../lib/personal-receipts";
import { VesselBrandIcon } from "../components/icons/VesselBrandIcon";
import { VesselButton } from "../components/vessel-ui/VesselButton";

/**
 * Revocation page mounted at `/revoke/:archiveId`.
 *
 * Reachable from the personal receipt page (`/r/:pointer`). Loads the
 * locally-stored revocation material for this archive — if it isn't here,
 * this device didn't create the link and can't take it down. Otherwise
 * shows an explicit confirmation step before signing + publishing the
 * deletion event.
 */

type Phase =
  | { kind: "confirm" }
  | { kind: "revoking" }
  | { kind: "done"; result: ShareRevokeResult }
  | { kind: "already_revoked" }
  | { kind: "no_material" }
  | { kind: "error"; message: string };

export default function RevokeTrackPage() {
  const [, params] = useRoute<{ archiveId: string }>("/revoke/:archiveId");
  const archiveId = decodeURIComponent(params?.archiveId || "");

  const [receipt, setReceipt] = useState<PersonalReceiptRecord | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "confirm" });

  useEffect(() => {
    if (!archiveId) {
      setPhase({ kind: "no_material" });
      return;
    }
    setReceipt(getReceiptByArchiveId(archiveId));
    if (isLocallyRevoked(archiveId)) {
      setPhase({ kind: "already_revoked" });
      return;
    }
    if (!getRevokeMaterial(archiveId)) {
      setPhase({ kind: "no_material" });
    }
  }, [archiveId]);

  const isHost = receipt?.isHost ?? false;
  const sessionTitle = receipt?.sessionTitle || "this recording";
  const hostName = receipt?.hostName || "the host";

  const handleConfirm = async () => {
    setPhase({ kind: "revoking" });
    try {
      const result = await revokeShareLink(archiveId);
      setPhase({ kind: "done", result });
    } catch (err) {
      if (err instanceof ShareRevokeError && err.code === "no_material") {
        setPhase({ kind: "no_material" });
        return;
      }
      if (err instanceof ShareRevokeError && err.code === "already_revoked") {
        setPhase({ kind: "already_revoked" });
        return;
      }
      const message =
        err instanceof ShareRevokeError
          ? err.message
          : "We couldn't take this link down right now. Try again in a moment.";
      setPhase({ kind: "error", message });
    }
  };

  return (
    <div className="min-h-screen bg-vessel-bg-base text-vessel-text-primary">
      <div className="max-w-xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <header className="flex items-center justify-between mb-10">
          <a
            href="/"
            className="group flex items-center gap-2 text-vessel-text-primary"
            data-testid="link-vessel-home"
          >
            <VesselBrandIcon className="w-7 h-7 text-vessel-accent shrink-0 transition-transform group-hover:-translate-y-px" />
            <span className="font-display text-lg font-bold tracking-tight group-hover:text-vessel-accent transition-colors">
              Vessel
            </span>
          </a>
          <span className="text-xs text-vessel-text-muted font-mono-vessel uppercase tracking-wider">
            Revoke
          </span>
        </header>

        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          {phase.kind === "confirm" && (
            <div data-testid="revoke-confirm">
              <div className="w-14 h-14 rounded-full bg-vessel-red/10 border border-vessel-red/40 text-vessel-red flex items-center justify-center mb-5">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <h1 className="font-display text-2xl font-bold tracking-tight mb-3">
                {isHost ? "Revoke this share link?" : `Revoke ${hostName}'s access?`}
              </h1>
              <p className="text-sm text-vessel-text-secondary leading-relaxed mb-6">
                {isHost ? (
                  <>
                    This will take down the share link for{" "}
                    <span className="text-vessel-text-primary font-medium">{sessionTitle}</span>.
                    Anyone holding the link will see a "taken down" message instead of the file.
                    Your local copy of the audio is not affected.
                  </>
                ) : (
                  <>
                    This will take down{" "}
                    <span className="text-vessel-text-primary font-medium">{hostName}</span>
                    's access to your track from{" "}
                    <span className="text-vessel-text-primary font-medium">{sessionTitle}</span>.
                    Their multi-track download will no longer include your track. Your own copy
                    is not affected.
                  </>
                )}
              </p>

              <div className="p-4 rounded-lg bg-vessel-bg-surface border border-vessel-border mb-6">
                <p className="text-xs text-vessel-text-secondary leading-relaxed">
                  Once you confirm, the link stops working everywhere. Your own copy is not
                  affected.
                  {isHost
                    ? " You can publish a new share link later if you change your mind."
                    : " The host can ask you to record again, but they can't restore this access."}
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <VesselButton
                  variant="primary"
                  className="w-full sm:w-auto bg-vessel-red text-white hover:opacity-90 hover:bg-vessel-red"
                  onClick={handleConfirm}
                  data-testid="button-revoke-confirm"
                >
                  <ShieldOff className="w-4 h-4 mr-2" />
                  {isHost ? "Yes, take it down" : "Yes, revoke access"}
                </VesselButton>
                <Link href={receipt ? `/r/${receipt.pointer}` : "/"}>
                  <VesselButton
                    variant="ghost"
                    className="w-full sm:w-auto"
                    data-testid="button-revoke-cancel"
                  >
                    Cancel
                  </VesselButton>
                </Link>
              </div>
            </div>
          )}

          {phase.kind === "revoking" && (
            <div className="flex flex-col items-center text-center py-12" data-testid="revoke-loading">
              <Loader2 className="w-7 h-7 text-vessel-accent animate-spin mb-3" />
              <p className="text-sm text-vessel-text-secondary">Taking it down…</p>
            </div>
          )}

          {phase.kind === "done" && (
            <div data-testid="revoke-done">
              <div className="w-14 h-14 rounded-full bg-vessel-accent/10 border border-vessel-accent/40 text-vessel-accent flex items-center justify-center mb-5">
                <Check className="w-6 h-6" />
              </div>
              <h1 className="font-display text-2xl font-bold tracking-tight mb-3">
                Done — the link is down.
              </h1>
              <p className="text-sm text-vessel-text-secondary leading-relaxed mb-6">
                {phase.result.publish.successCount === phase.result.publish.totalCount ? (
                  <>
                    Done. Anyone opening this link from now on will see that it was taken down.
                  </>
                ) : (
                  <>
                    Taken down. Some servers may take a moment to catch up; Vessel treats the link
                    as revoked now.
                  </>
                )}
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link href="/">
                  <VesselButton variant="primary" className="w-full sm:w-auto" data-testid="button-revoke-done-home">
                    Back to home
                  </VesselButton>
                </Link>
                {receipt && (
                  <Link href={`/r/${receipt.pointer}`}>
                    <VesselButton variant="ghost" className="w-full sm:w-auto">
                      Back to receipt
                    </VesselButton>
                  </Link>
                )}
              </div>
            </div>
          )}

          {phase.kind === "already_revoked" && (
            <div data-testid="revoke-already">
              <div className="w-14 h-14 rounded-full bg-vessel-bg-surface border border-vessel-border text-vessel-text-secondary flex items-center justify-center mb-5">
                <ShieldOff className="w-6 h-6" />
              </div>
              <h1 className="font-display text-2xl font-bold tracking-tight mb-3">
                Already taken down
              </h1>
              <p className="text-sm text-vessel-text-secondary leading-relaxed mb-6">
                You've already revoked this link from this device. There's nothing more to do here.
              </p>
              <Link href="/">
                <VesselButton variant="primary" data-testid="button-revoke-already-home">
                  Back to home
                </VesselButton>
              </Link>
            </div>
          )}

          {phase.kind === "no_material" && (
            <div data-testid="revoke-no-material">
              <div className="w-14 h-14 rounded-full bg-vessel-bg-surface border border-vessel-border text-vessel-text-secondary flex items-center justify-center mb-5">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <h1 className="font-display text-2xl font-bold tracking-tight mb-3">
                Can't take this link down here
              </h1>
              <p className="text-sm text-vessel-text-secondary leading-relaxed mb-6">
                Only the device that created this link can take it down. If you created the link on
                another browser or computer, open the receipt there to revoke it.
              </p>
              <Link href="/">
                <VesselButton variant="primary" data-testid="button-revoke-no-material-home">
                  Back to home
                </VesselButton>
              </Link>
            </div>
          )}

          {phase.kind === "error" && (
            <div data-testid="revoke-error">
              <div className="w-14 h-14 rounded-full bg-vessel-red/10 border border-vessel-red/40 text-vessel-red flex items-center justify-center mb-5">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h1 className="font-display text-2xl font-bold tracking-tight mb-3">
                We couldn't take it down
              </h1>
              <p className="text-sm text-vessel-text-secondary leading-relaxed mb-6">{phase.message}</p>
              <div className="flex flex-col sm:flex-row gap-3">
                <VesselButton
                  variant="primary"
                  onClick={handleConfirm}
                  data-testid="button-revoke-retry"
                >
                  Try again
                </VesselButton>
                <Link href={receipt ? `/r/${receipt.pointer}` : "/"}>
                  <VesselButton variant="ghost">Back to receipt</VesselButton>
                </Link>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
