import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../ui/tooltip";
import { useToast } from "../../hooks/use-toast";

export type SessionCodeBadgeProps = {
  code: string;
};

/**
 * SessionCodeBadge — compact inline pill for the in-call studio header.
 * Click-to-copy with both a tooltip + a transient toast so the user
 * always knows the copy worked, even when the tooltip is dismissed by
 * the click.
 *
 * Visually distinct from SessionCodeChip (which is a labelled card) —
 * this is the dense breadcrumb-row version.
 */
export function SessionCodeBadge({ code }: SessionCodeBadgeProps) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    toast({ description: "Session code copied to clipboard." });
  };

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={handleCopy}
          type="button"
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-vessel-border bg-vessel-bg-surface/60 hover:bg-vessel-bg-surface hover:border-vessel-accent/40 font-mono-vessel text-[11px] uppercase tracking-[0.14em] text-vessel-text-secondary hover:text-vessel-text-primary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent/40"
          data-testid="badge-session-code"
          aria-label={copied ? "Session code copied" : `Copy session code ${code}`}
        >
          <span>{code}</span>
          {copied ? (
            <Check className="w-3 h-3 text-vessel-green" />
          ) : (
            <Copy className="w-3 h-3 opacity-60" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {copied ? "Copied!" : "Click to copy session code"}
      </TooltipContent>
    </Tooltip>
  );
}
