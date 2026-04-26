import { useState, useEffect } from "react";
import { Check, Copy } from "lucide-react";

export type SessionCodeChipProps = {
  code: string;
  /** Optional helper text rendered below the chip. */
  helperText?: string;
};

/**
 * SessionCodeChip — the canonical "Session code" affordance used in the
 * Invite modal and the lobby's share card. Renders a labelled monospace
 * pill with a self-contained copy button + 2s "Copied" feedback.
 *
 * Owns its own copy state so callers don't have to thread it through —
 * different surfaces (modal, lobby) can host it without coupling.
 */
export function SessionCodeChip({ code, helperText }: SessionCodeChipProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
  };

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <div className="space-y-1.5">
      <div className="text-[11px] uppercase tracking-[0.18em] text-vessel-text-muted">
        Session code
      </div>
      <div className="flex items-stretch gap-2 min-w-0 bg-vessel-bg-base border border-vessel-border rounded-xl p-1.5 pl-3">
        <div
          className="font-mono-vessel text-base sm:text-lg tracking-[0.18em] text-vessel-text-primary uppercase flex-1 min-w-0 self-center overflow-hidden text-ellipsis whitespace-nowrap"
          data-testid="text-invite-code"
        >
          {code}
        </div>
        <button
          onClick={handleCopy}
          className="shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-2 min-w-[5.25rem] rounded-lg bg-vessel-bg-surface hover:bg-vessel-accent/10 text-vessel-text-primary text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent"
          data-testid="button-copy-invite-code"
          aria-label={copied ? "Code copied" : "Copy session code"}
        >
          {copied ? (
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
      {helperText && (
        <p className="text-[11px] text-vessel-text-muted">{helperText}</p>
      )}
    </div>
  );
}
