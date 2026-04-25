import * as React from "react";
import { cn } from "@/lib/utils";

interface RecordingDotProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "md";
  showLabel?: boolean;
  animated?: boolean;
}

export function RecordingDot({ size = "md", showLabel = false, animated = true, className, ...props }: RecordingDotProps) {
  const sizeClass = size === "sm" ? "w-2 h-2" : "w-2.5 h-2.5";

  return (
    <div className={cn("flex items-center gap-2", className)} {...props}>
      <div className="relative flex items-center justify-center">
        <div className={cn(sizeClass, "bg-vessel-red rounded-full")} />
        {animated && (
          <>
            <div
              className={cn(
                sizeClass,
                "absolute bg-vessel-red rounded-full animate-[pulse_1.5s_infinite]"
              )}
              style={{ animation: "pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite" }}
            />
            <style>{`
              @keyframes pulse {
                0% { transform: scale(1); opacity: 1; }
                100% { transform: scale(1.4); opacity: 0; }
              }
            `}</style>
          </>
        )}
      </div>
      {showLabel && (
        <span className="font-mono-vessel text-[10px] font-medium text-vessel-red">
          REC
        </span>
      )}
    </div>
  );
}
