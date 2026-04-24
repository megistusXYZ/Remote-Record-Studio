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
      <DialogContent className="max-w-md p-6 sm:p-8 bg-vessel-bg-surface border-vessel-border">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-vessel-text-primary">
            Invite guests
          </DialogTitle>
          <DialogDescription className="text-vessel-text-secondary">
            Share this link to bring people into your studio.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-6 flex items-center justify-between bg-vessel-bg-base border border-vessel-border rounded-xl p-4">
          <div className="font-mono-vessel text-sm text-vessel-text-primary overflow-hidden text-ellipsis whitespace-nowrap pr-4">
            {inviteUrl}
          </div>
          <button
            onClick={handleCopy}
            className="flex items-center justify-center shrink-0 w-8 h-8 rounded-lg hover:bg-vessel-bg-surface text-vessel-text-secondary hover:text-vessel-text-primary transition-colors"
            data-testid="button-copy-invite-link"
          >
            {copied ? <Check className="w-4 h-4 text-vessel-green" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>

        <div className="mt-6 flex flex-col items-center">
          <div className="rounded-2xl p-6 bg-white shadow-lg">
            <QRCodeSVG
              value={inviteUrl}
              size={200}
              bgColor="#ffffff"
              fgColor="#080b0f"
              level="M"
              includeMargin={false}
            />
          </div>
          <p className="mt-4 text-center text-xs text-vessel-text-muted">
            Scan to join from another device
          </p>
        </div>

        <div className="mt-8 flex gap-3">
          <VesselButton
            variant="ghost"
            size="md"
            className="flex-1"
            onClick={handleShare}
            data-testid="button-share-link"
          >
            <Share2 className="w-4 h-4 mr-2" />
            Share via...
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

        <p className="text-xs text-vessel-text-muted text-center mt-4">
          Guests don't need an account to join.
        </p>
      </DialogContent>
    </Dialog>
  );
}
