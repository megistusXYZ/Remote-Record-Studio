import * as React from "react";
import { cn } from "@/lib/utils";

interface VesselButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost" | "danger" | "muted";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
}

export const VesselButton = React.forwardRef<HTMLButtonElement, VesselButtonProps>(
  ({ className, variant = "primary", size = "md", isLoading, children, disabled, ...props }, ref) => {
    const baseStyles =
      "inline-flex items-center justify-center rounded-full font-medium transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent focus-visible:ring-offset-2 focus-visible:ring-offset-vessel-bg-base disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97]";

    const variants = {
      primary:
        "bg-vessel-accent text-vessel-bg-base hover:bg-vessel-accent-dim shadow-[0_0_15px_rgb(var(--vessel-accent-rgb)/0.15)] hover:scale-[1.02]",
      ghost:
        "bg-transparent border border-vessel-accent text-vessel-accent hover:bg-vessel-accent hover:text-vessel-bg-base",
      danger: "bg-vessel-red text-white hover:brightness-110",
      muted: "bg-vessel-bg-surface text-vessel-text-secondary hover:text-vessel-text-primary hover:bg-vessel-bg-elevated",
    };

    const sizes = {
      sm: "h-9 px-4 text-xs",
      md: "h-11 px-6 text-sm",
      lg: "h-14 px-8 text-lg",
    };

    return (
      <button
        ref={ref}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading ? (
          <div className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
        ) : (
          children
        )}
      </button>
    );
  }
);
VesselButton.displayName = "VesselButton";
