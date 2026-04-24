import * as React from "react";
import { cn } from "@/lib/utils";

interface VesselCardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "interactive" | "ghost";
}

export const VesselCard = React.forwardRef<HTMLDivElement, VesselCardProps>(
  ({ className, variant = "default", ...props }, ref) => {
    const baseStyles = "rounded-2xl";

    const variants = {
      default: "bg-vessel-bg-surface border border-vessel-border",
      interactive: "bg-vessel-bg-surface border border-vessel-border transition-all duration-200 ease-out hover:bg-vessel-bg-elevated hover:scale-[1.01] hover:border-vessel-border-strong",
      ghost: "bg-transparent",
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
VesselCard.displayName = "VesselCard";
