import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { VesselButton } from "../vessel-ui/VesselButton";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, Share2 } from "lucide-react";

export type InviteModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inviteUrl: string;
  inviteCode: string;
};

export function InviteModal({
  open,
  onOpenChange,
  inviteUrl,
  inviteCode,
}: InviteModalProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
  };

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Join my Vessel studio",
          text: "Join my recording session on Vessel",
          url: inviteUrl,
        });
      } catch (err) {
        handleCopy();
      }
    } else {
      handleCopy();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-6 sm:p-7 bg-vessel-bg-surface border-vessel-border">
        <DialogHeader className="text-left space-y-1.5">
          <DialogTitle className="font-display text-2xl text-vessel-text-primary">
            Invite guests
          </DialogTitle>
          <DialogDescription className="text-sm text-vessel-text-secondary">
            Share the link below — guests join with one tap, no account needed.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-6 space-y-5">
          {/* Invite link + copy pill */}
          <div className="flex items-center gap-2 bg-vessel-bg-base border border-vessel-border rounded-xl p-1.5 pl-4">
            <div
              className="font-mono-vessel text-xs text-vessel-text-secondary overflow-hidden text-ellipsis whitespace-nowrap flex-1"
              title={inviteUrl}
              data-testid="text-invite-url"
            >
              {inviteUrl}
            </div>
            <button
              onClick={handleCopy}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-vessel-bg-surface hover:bg-vessel-accent/10 text-vessel-text-primary text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent"
              data-testid="button-copy-invite-link"
              aria-label={copied ? "Link copied" : "Copy invite link"}
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-vessel-green" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span className="w-12 text-left">{copied ? "Copied" : "Copy"}</span>
            </button>
          </div>

          {/* OR divider */}
          <div className="relative" aria-hidden="true">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-vessel-border" />
            </div>
            <div className="relative flex justify-center text-[10px] uppercase tracking-[0.2em]">
              <span className="bg-vessel-bg-surface px-3 text-vessel-text-muted">
                or scan
              </span>
            </div>
          </div>

          {/* QR */}
          <div className="flex flex-col items-center gap-2.5">
            <div className="rounded-2xl p-3.5 bg-white">
              <QRCodeSVG
                value={inviteUrl}
                size={156}
                bgColor="#ffffff"
                fgColor="#080b0f"
                level="M"
                includeMargin={false}
                data-testid="qr-invite"
              />
            </div>
            <p className="text-xs text-vessel-text-muted">
              Open the camera on your phone
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <VesselButton
              variant="ghost"
              size="md"
              className="flex-1"
              onClick={handleShare}
              data-testid="button-share-link"
            >
              <Share2 className="w-4 h-4 mr-2" />
              Share…
            </VesselButton>
            <VesselButton
              variant="primary"
              size="md"
              className="flex-1"
              onClick={() => onOpenChange(false)}
              data-testid="button-close-invite"
            >
              Done
            </VesselButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
