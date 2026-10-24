import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  QrCode,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { VesselButton } from "../vessel-ui/VesselButton";
import { useToast } from "../../hooks/use-toast";
import {
  downloadBackupFile,
  exportIdentityBackup,
  getStudioIdBech32,
  type VesselIdentity,
} from "../../lib/identity";

export type BackupKeyModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  identity: VesselIdentity | null;
  /** Show the public Studio ID block above the key. Defaults to true. */
  showStudioId?: boolean;
  /** Called when the user clicks Done on the reveal stage (after the key was shown). */
  onDone?: () => void;
};

type Stage = "warn" | "reveal";

export function BackupKeyModal({
  open,
  onOpenChange,
  identity,
  showStudioId = true,
  onDone,
}: BackupKeyModalProps) {
  const { toast } = useToast();
  const [stage, setStage] = useState<Stage>("warn");
  const [backupValue, setBackupValue] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const studioId = useMemo(
    () => (identity ? getStudioIdBech32(identity) : null),
    [identity],
  );

  // Reset on every open transition so the modal always starts at the
  // confirm-to-reveal step, even if the user closes and reopens it
  // faster than any close animation. Also reset on close so the secret
  // doesn't linger in React state while the modal is hidden.
  useEffect(() => {
    setStage("warn");
    setBackupValue(null);
    setShowQr(false);
    setCopied(false);
    setCopiedId(false);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  useEffect(() => {
    if (!copiedId) return;
    const t = setTimeout(() => setCopiedId(false), 2000);
    return () => clearTimeout(t);
  }, [copiedId]);

  const handleReveal = () => {
    if (!identity) {
      setError(
        "We couldn't find your studio on this device. Try signing in again.",
      );
      return;
    }
    try {
      const nsec = exportIdentityBackup(identity);
      setBackupValue(nsec);
      setStage("reveal");
      setError(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Couldn't show your recovery key.";
      setError(message);
    }
  };

  const handleCopy = async () => {
    if (!backupValue) return;
    try {
      await navigator.clipboard.writeText(backupValue);
      setCopied(true);
      toast({ title: "Copied", description: "Recovery key copied." });
    } catch {
      toast({
        title: "Couldn't copy",
        description: "Select the text and copy it manually.",
        variant: "destructive",
      });
    }
  };

  const handleCopyStudioId = async () => {
    if (!studioId) return;
    try {
      await navigator.clipboard.writeText(studioId);
      setCopiedId(true);
    } catch {
      toast({
        title: "Couldn't copy",
        description: "Select the text and copy it manually.",
        variant: "destructive",
      });
    }
  };

  const handleDownload = () => {
    if (!backupValue || !identity) return;
    const filename = downloadBackupFile(identity, backupValue);
    toast({ title: "Downloaded", description: `Saved as ${filename}.` });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-vessel-bg-surface border-vessel-border text-vessel-text-primary max-w-md">
        <DialogHeader className="mb-2">
          <DialogTitle className="font-display text-xl">Recovery key</DialogTitle>
          <DialogDescription className="text-vessel-text-secondary mt-2">
            {stage === "warn"
              ? "This key is your studio. Anyone who has it can sign in as you on any device."
              : "Save this somewhere private. A password manager works well."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="p-3 text-sm rounded-lg bg-vessel-red/10 border border-vessel-red/20 text-vessel-red">
            {error}
          </div>
        )}

        {stage === "warn" ? (
          <div className="mt-2 space-y-5">
            <div className="rounded-xl border border-[#ffa502]/20 bg-[#ffa502]/5 p-4 flex gap-3">
              <ShieldAlert className="w-5 h-5 text-vessel-amber shrink-0 mt-0.5" />
              <div className="text-sm text-vessel-text-secondary leading-relaxed">
                Make sure no one is looking at your screen. Vessel will never
                ask for this key — don't share it with anyone.
              </div>
            </div>

            <div className="flex gap-3 sm:justify-end">
              <VesselButton
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                data-testid="button-backup-cancel"
              >
                Cancel
              </VesselButton>
              <VesselButton
                type="button"
                onClick={handleReveal}
                data-testid="button-backup-reveal"
              >
                <Eye className="w-4 h-4 mr-2" />
                Show key
              </VesselButton>
            </div>
          </div>
        ) : (
          <div className="mt-2 space-y-4">
            {showStudioId && studioId && (
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <label className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-vessel-text-muted">
                    <ShieldCheck className="w-3.5 h-3.5 text-vessel-accent" />
                    Studio ID
                    <span className="ml-1 normal-case text-[10px] tracking-normal text-vessel-text-muted/80">
                      (public)
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={handleCopyStudioId}
                    className="text-xs text-vessel-accent hover:underline focus:outline-none flex items-center gap-1"
                    data-testid="button-copy-studio-id"
                  >
                    {copiedId ? (
                      <Check className="w-3 h-3 text-vessel-green" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    {copiedId ? "Copied" : "Copy"}
                  </button>
                </div>
                <code
                  className="block font-mono-vessel text-[11px] select-all break-all p-3 rounded-lg bg-vessel-bg-base border border-vessel-border text-vessel-text-secondary"
                  data-testid="text-studio-id-value"
                >
                  {studioId}
                </code>
              </div>
            )}

            <div>
              <label className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-vessel-text-muted">
                <ShieldAlert className="w-3.5 h-3.5 text-vessel-amber" />
                Recovery key
                <span className="ml-1 normal-case text-[10px] tracking-normal text-vessel-text-muted/80">
                  (private, never share)
                </span>
              </label>
              <code
                className="block mt-2 font-mono-vessel text-xs select-all break-all p-3 rounded-lg bg-vessel-bg-base border border-vessel-border-strong text-vessel-text-secondary"
                data-testid="text-backup-key-value"
              >
                {backupValue}
              </code>
            </div>

            <div className="flex flex-wrap gap-2">
              <VesselButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleCopy}
                data-testid="button-copy-backup"
              >
                {copied ? (
                  <Check className="w-4 h-4 mr-2 text-vessel-green" />
                ) : (
                  <Copy className="w-4 h-4 mr-2" />
                )}
                {copied ? "Copied" : "Copy"}
              </VesselButton>
              <VesselButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDownload}
                data-testid="button-download-backup"
              >
                <Download className="w-4 h-4 mr-2" />
                Download
              </VesselButton>
              <VesselButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowQr((v) => !v)}
                data-testid="button-toggle-backup-qr"
              >
                {showQr ? (
                  <EyeOff className="w-4 h-4 mr-2" />
                ) : (
                  <QrCode className="w-4 h-4 mr-2" />
                )}
                {showQr ? "Hide QR" : "Show QR"}
              </VesselButton>
            </div>

            {showQr && backupValue && (
              <div
                className="flex flex-col items-center pt-2"
                data-testid="container-backup-qr"
              >
                <div className="rounded-2xl p-5 bg-white shadow-lg">
                  <QRCodeSVG
                    value={backupValue}
                    size={196}
                    bgColor="#ffffff"
                    fgColor="#080b0f"
                    level="M"
                    includeMargin={false}
                  />
                </div>
                <div className="mt-3 flex items-start gap-2 text-xs text-vessel-amber max-w-xs text-center">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    Scan from your own device only. Anyone who scans this can
                    sign in as you.
                  </span>
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <VesselButton
                type="button"
                variant="ghost"
                onClick={() => {
                  onOpenChange(false);
                  onDone?.();
                }}
                data-testid="button-backup-close"
              >
                Done
              </VesselButton>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
