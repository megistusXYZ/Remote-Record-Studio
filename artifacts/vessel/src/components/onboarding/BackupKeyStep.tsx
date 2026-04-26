import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  QrCode,
  ShieldCheck,
} from "lucide-react";
import { VesselBrandIcon } from "../icons/VesselBrandIcon";
import { VesselButton } from "../vessel-ui/VesselButton";
import { useToast } from "../../hooks/use-toast";
import {
  downloadBackupFile,
  exportIdentityBackup,
  getStudioIdBech32,
  type VesselIdentity,
} from "../../lib/identity";

export type BackupKeyStepProps = {
  identity: VesselIdentity;
  onContinue: () => void;
};

/**
 * Forced step shown immediately after a user creates a brand-new studio.
 * Surfaces both the public Studio ID and the private Backup Key with
 * plain-English copy. Continue button is disabled until the user confirms
 * they've saved the backup somewhere safe.
 *
 * For sign-in flows (extension / remote signer / existing backup-key login),
 * skip this step — the user already has the key elsewhere.
 */
export function BackupKeyStep({ identity, onContinue }: BackupKeyStepProps) {
  const { toast } = useToast();
  const [studioId] = useState(() => getStudioIdBech32(identity));
  const [backupKey, setBackupKey] = useState<string | null>(null);
  const [deriveError, setDeriveError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [copiedField, setCopiedField] = useState<"id" | "key" | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);

  // Compute the backup key once on mount — derives from the in-memory
  // identity, never round-trips to the server. If derivation fails we
  // surface a blocking error and refuse to let the user advance, since
  // continuing without a recoverable key would defeat the whole point
  // of this step.
  useEffect(() => {
    try {
      setBackupKey(exportIdentityBackup(identity));
      setDeriveError(null);
    } catch (err) {
      console.error("Failed to derive backup key:", err);
      const message =
        err instanceof Error
          ? err.message
          : "We couldn't generate your backup key.";
      setDeriveError(message);
    }
  }, [identity]);

  useEffect(() => {
    if (!copiedField) return;
    const t = setTimeout(() => setCopiedField(null), 2000);
    return () => clearTimeout(t);
  }, [copiedField]);

  const markInteracted = () => setHasInteracted(true);

  const handleCopyStudioId = async () => {
    try {
      await navigator.clipboard.writeText(studioId);
      setCopiedField("id");
      markInteracted();
    } catch {
      toast({
        variant: "destructive",
        description: "Couldn't copy. Select the text and copy it manually.",
      });
    }
  };

  const handleCopyBackupKey = async () => {
    if (!backupKey) return;
    setRevealed(true);
    try {
      await navigator.clipboard.writeText(backupKey);
      setCopiedField("key");
      markInteracted();
    } catch {
      toast({
        variant: "destructive",
        description: "Couldn't copy. Select the text and copy it manually.",
      });
    }
  };

  const handleDownload = () => {
    if (!backupKey) return;
    const filename = downloadBackupFile(identity, backupKey);
    markInteracted();
    toast({
      title: "Downloaded",
      description: `Saved as ${filename}.`,
    });
  };

  const maskedKey = backupKey
    ? `${backupKey.slice(0, 9)}${"•".repeat(20)}${backupKey.slice(-6)}`
    : "";

  return (
    <motion.div
      key="backup"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full flex flex-col"
    >
      <div className="flex items-center self-center gap-2 font-display font-bold text-2xl tracking-tight mb-8 sm:mb-10">
        <VesselBrandIcon className="w-8 h-8 text-vessel-accent" />
        <div className="flex items-baseline gap-1">
          <span>Vessel</span>
          <div className="w-1.5 h-1.5 rounded-full bg-vessel-accent" />
        </div>
      </div>

      <div className="text-center mb-6 sm:mb-8">
        <div className="w-14 h-14 rounded-full bg-vessel-accent/10 border border-vessel-accent/20 flex items-center justify-center mx-auto mb-5">
          <KeyRound className="w-6 h-6 text-vessel-accent" />
        </div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold mb-3 leading-tight">
          Save your backup, save your studio.
        </h1>
        <p className="text-vessel-text-secondary text-sm sm:text-base leading-relaxed max-w-md mx-auto">
          Your studio lives on this device. The backup key below is the
          <span className="text-vessel-text-primary"> only </span>
          way to sign back in if you change browsers, phones, or computers.
          Vessel can't recover it for you.
        </p>
      </div>

      {deriveError && (
        <div
          className="mb-5 p-4 rounded-xl bg-vessel-red/10 border border-vessel-red/20 text-sm text-vessel-red"
          data-testid="text-onboarding-backup-error"
        >
          We couldn't generate your backup key on this device. Please refresh
          and try again — you'll need this key to sign back in later.
        </div>
      )}

      {/* Studio ID — public, safe to share */}
      <section className="rounded-2xl border border-vessel-border bg-vessel-bg-surface/60 backdrop-blur-sm p-5 mb-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <ShieldCheck className="w-4 h-4 text-vessel-accent shrink-0" />
            <h2 className="font-display text-sm font-bold tracking-tight text-vessel-text-primary truncate">
              Studio ID
            </h2>
            <span className="text-[10px] uppercase tracking-wider font-mono-vessel text-vessel-accent bg-vessel-accent/10 border border-vessel-accent/20 px-1.5 py-0.5 rounded shrink-0">
              Public
            </span>
          </div>
        </div>
        <p className="text-xs text-vessel-text-muted leading-relaxed mb-3">
          Your public studio address. Share it freely — guests use it to find
          your sessions and your recordings carry it as proof they're yours.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <code
            className="flex-1 min-w-0 block font-mono-vessel text-[11px] sm:text-xs select-all break-all p-3 rounded-lg bg-vessel-bg-base border border-vessel-border text-vessel-text-secondary"
            data-testid="text-onboarding-studio-id"
          >
            {studioId}
          </code>
          <VesselButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCopyStudioId}
            className="shrink-0 sm:self-start"
            data-testid="button-onboarding-copy-studio-id"
          >
            {copiedField === "id" ? (
              <Check className="w-4 h-4 sm:mr-2 text-vessel-green" />
            ) : (
              <Copy className="w-4 h-4 sm:mr-2" />
            )}
            <span className="hidden sm:inline">
              {copiedField === "id" ? "Copied" : "Copy"}
            </span>
          </VesselButton>
        </div>
      </section>

      {/* Backup Key — private, never share */}
      <section className="rounded-2xl border border-vessel-amber/30 bg-vessel-amber/5 p-5 mb-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <KeyRound className="w-4 h-4 text-vessel-amber shrink-0" />
            <h2 className="font-display text-sm font-bold tracking-tight text-vessel-text-primary truncate">
              Backup Key
            </h2>
            <span className="text-[10px] uppercase tracking-wider font-mono-vessel text-vessel-amber bg-vessel-amber/10 border border-vessel-amber/20 px-1.5 py-0.5 rounded shrink-0">
              Private
            </span>
          </div>
        </div>
        <p className="text-xs text-vessel-text-muted leading-relaxed mb-3">
          This signs you in. Anyone who has it
          <span className="text-vessel-text-primary"> becomes you </span>
          — keep it in a password manager. Never share it.
        </p>

        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <code
            className="flex-1 min-w-0 block font-mono-vessel text-[11px] sm:text-xs select-all break-all p-3 rounded-lg bg-vessel-bg-base border border-vessel-border-strong text-vessel-text-secondary"
            data-testid="text-onboarding-backup-key"
          >
            {backupKey ? (revealed ? backupKey : maskedKey) : "…"}
          </code>
          <VesselButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setRevealed((v) => !v);
              markInteracted();
            }}
            className="shrink-0 sm:self-start"
            data-testid="button-onboarding-toggle-reveal"
          >
            {revealed ? (
              <EyeOff className="w-4 h-4 sm:mr-2" />
            ) : (
              <Eye className="w-4 h-4 sm:mr-2" />
            )}
            <span className="hidden sm:inline">
              {revealed ? "Hide" : "Reveal"}
            </span>
          </VesselButton>
        </div>

        <div className="flex flex-wrap gap-2">
          <VesselButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCopyBackupKey}
            data-testid="button-onboarding-copy-backup"
          >
            {copiedField === "key" ? (
              <Check className="w-4 h-4 mr-2 text-vessel-green" />
            ) : (
              <Copy className="w-4 h-4 mr-2" />
            )}
            {copiedField === "key" ? "Copied" : "Copy backup key"}
          </VesselButton>
          <VesselButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleDownload}
            data-testid="button-onboarding-download-backup"
          >
            <Download className="w-4 h-4 mr-2" />
            Download as .txt
          </VesselButton>
          <VesselButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowQr((v) => !v);
              markInteracted();
            }}
            data-testid="button-onboarding-toggle-qr"
          >
            <QrCode className="w-4 h-4 mr-2" />
            {showQr ? "Hide QR" : "Show QR"}
          </VesselButton>
        </div>

        {showQr && backupKey && (
          <div
            className="flex flex-col items-center pt-4"
            data-testid="container-onboarding-backup-qr"
          >
            <div className="rounded-2xl p-4 bg-white shadow-lg">
              <QRCodeSVG
                value={backupKey}
                size={168}
                bgColor="#ffffff"
                fgColor="#080b0f"
                level="M"
                includeMargin={false}
              />
            </div>
            <div className="mt-3 flex items-start gap-2 text-xs text-vessel-amber max-w-xs text-center">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                Scan from your own device only. Anyone who scans this can sign
                in as you.
              </span>
            </div>
          </div>
        )}
      </section>

      {/* How to sign back in */}
      <section className="rounded-xl border border-vessel-border bg-vessel-bg-surface/40 p-4 mb-6 text-xs sm:text-sm text-vessel-text-secondary leading-relaxed">
        <h3 className="font-display text-sm font-bold text-vessel-text-primary mb-2">
          How to sign back in
        </h3>
        <ol className="list-decimal list-outside ml-5 space-y-1">
          <li>Open Vessel on any device.</li>
          <li>Choose <span className="text-vessel-text-primary">Sign in with backup key</span>.</li>
          <li>Paste your backup key. You're back — recordings and all.</li>
        </ol>
      </section>

      {/* Confirmation gate */}
      <label
        className="flex items-start gap-3 p-4 rounded-xl border border-vessel-border bg-vessel-bg-surface/40 cursor-pointer hover:border-vessel-border-strong transition-colors mb-5"
        data-testid="label-onboarding-backup-confirm"
      >
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 w-4 h-4 shrink-0 accent-vessel-accent cursor-pointer"
          data-testid="checkbox-onboarding-backup-confirm"
        />
        <span className="text-sm text-vessel-text-primary leading-snug">
          I've saved my backup key somewhere safe.
          <span className="block text-xs text-vessel-text-muted mt-1">
            (Password manager, downloaded file, written down — your call.)
          </span>
        </span>
      </label>

      <VesselButton
        type="button"
        size="lg"
        className="w-full"
        onClick={onContinue}
        disabled={!confirmed || !backupKey}
        data-testid="button-onboarding-backup-continue"
      >
        Enter my studio &rarr;
      </VesselButton>

      {!hasInteracted && (
        <p className="text-center text-xs text-vessel-text-muted mt-4">
          Tip: copy or download your backup key before continuing.
        </p>
      )}
    </motion.div>
  );
}
