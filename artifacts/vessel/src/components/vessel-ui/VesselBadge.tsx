import * as React from "react";
import { cn } from "@/lib/utils";

interface VesselBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "success" | "warning" | "error" | "accent";
}

export const VesselBadge = React.forwardRef<HTMLDivElement, VesselBadgeProps>(
  ({ className, variant = "default", ...props }, ref) => {
    const baseStyles =
      "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] sm:text-[11px] uppercase font-medium tracking-wider";

    const variants = {
      default: "bg-vessel-bg-surface text-vessel-text-muted border border-vessel-border",
      success: "bg-[#2ed573]/10 text-vessel-green border border-[#2ed573]/20",
      warning: "bg-[#ffa502]/10 text-vessel-amber border border-[#ffa502]/20",
      error: "bg-[#ff4757]/10 text-vessel-red border border-[#ff4757]/20",
      accent: "bg-vessel-accent-glow text-vessel-accent border border-vessel-accent/20",
    };

    return (
      <div
        ref={ref}
        className={cn(baseStyles, variants[variant], className)}
        {...props}
      />
    );
  }
);
VesselBadge.displayName = "VesselBadge";
