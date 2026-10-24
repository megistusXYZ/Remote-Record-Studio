import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { VesselButton } from "../vessel-ui/VesselButton";
import { SessionCodeChip } from "../vessel-ui/SessionCodeChip";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, Share2 } from "lucide-react";

export type InviteModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inviteUrl: string;
  inviteCode: string;
};

type CopiedField = "url" | null;

export function InviteModal({
  open,
  onOpenChange,
  inviteUrl,
  inviteCode,
}: InviteModalProps) {
  const [copied, setCopied] = useState<CopiedField>(null);

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(inviteUrl);
    setCopied("url");
  };

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  // Reset feedback when the modal closes so it doesn't reappear on reopen.
  useEffect(() => {
    if (!open) setCopied(null);
  }, [open]);

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Join my Vessel studio",
          text: `Join my recording session on Vessel — code ${inviteCode}`,
          url: inviteUrl,
        });
      } catch {
        handleCopyUrl();
      }
    } else {
      handleCopyUrl();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="
          w-[calc(100vw-2rem)] max-w-[26rem]
          p-5 sm:p-6
          bg-vessel-bg-surface border-vessel-border
          overflow-hidden
        "
      >
        <DialogHeader className="text-left space-y-1 min-w-0 w-full">
          <DialogTitle className="font-display text-xl sm:text-2xl text-vessel-text-primary">
            Invite guests
          </DialogTitle>
          <DialogDescription className="text-sm text-vessel-text-secondary">
            Share the code, link, or QR — guests join in one tap, no account needed.
          </DialogDescription>
        </DialogHeader>

        {/* w-full + min-w-0: DialogContent is a CSS grid, and grid
            items default to min-width: auto. Without this, the long
            invite URL inside grows the grid item past max-w, throwing
            the centered QR off to the side. */}
        <div className="mt-5 space-y-5 w-full min-w-0">
          {/* QR — primary visual */}
          <div className="flex flex-col items-center gap-2">
            <div className="rounded-2xl p-3 bg-white shadow-[0_8px_24px_rgb(var(--vessel-shadow-rgb)/0.25)]">
              <QRCodeSVG
                value={inviteUrl}
                size={144}
                bgColor="#ffffff"
                fgColor="#080b0f"
                level="M"
                includeMargin={false}
                data-testid="qr-invite"
              />
            </div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-vessel-text-muted">
              Scan with a phone camera
            </p>
          </div>

          {/* Soft divider */}
          <div className="h-px bg-vessel-border/70" aria-hidden="true" />

          {/* Session code — short, easy to read aloud or text */}
          <SessionCodeChip
            code={inviteCode}
            helperText="Guests can paste this on the home screen to join."
          />

          {/* Invite link row — min-w-0 fixes flex truncation */}
          <div className="space-y-2">
            <label className="block text-[11px] uppercase tracking-[0.18em] text-vessel-text-muted">
              Or share the link
            </label>
            <div className="flex items-stretch gap-2 min-w-0 bg-vessel-bg-base border border-vessel-border rounded-xl p-1.5 pl-3">
              <div
                className="
                  font-mono-vessel text-xs text-vessel-text-secondary
                  flex-1 min-w-0
                  self-center
                  overflow-hidden text-ellipsis whitespace-nowrap
                "
                title={inviteUrl}
                data-testid="text-invite-url"
              >
                {inviteUrl}
              </div>
              <button
                onClick={handleCopyUrl}
                className="
                  shrink-0 inline-flex items-center justify-center gap-1.5
                  px-3 py-2 min-w-[5.25rem]
                  rounded-lg
                  bg-vessel-bg-surface hover:bg-vessel-accent/10
                  text-vessel-text-primary text-xs font-medium
                  transition-colors
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent
                "
                data-testid="button-copy-invite-link"
                aria-label={copied === "url" ? "Link copied" : "Copy invite link"}
              >
                {copied === "url" ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-vessel-green" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Actions — stack on very narrow screens for thumb-friendliness */}
          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 pt-1">
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
