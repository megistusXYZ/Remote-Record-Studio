import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A short label above a heading: monospace, spaced capitals, led by a small
 * light like the studio's recording indicator. Use it where a section needs
 * a kicker; keep pills (VesselBadge) for status such as "Host".
 */
export function Eyebrow({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        "inline-flex items-center gap-2.5 font-mono-vessel text-[11px] sm:text-xs uppercase tracking-[0.18em] text-vessel-text-secondary",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-vessel-accent shadow-[0_0_8px_rgba(0,212,170,0.6)]"
      />
      {children}
    </p>
  );
}
