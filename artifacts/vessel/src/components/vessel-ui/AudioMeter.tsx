import * as React from "react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

interface AudioMeterProps extends React.HTMLAttributes<HTMLDivElement> {
  audioLevel?: number;
  barCount?: number;
  active?: boolean;
}

export function AudioMeter({
  audioLevel = 0,
  barCount = 12,
  active = false,
  className,
  ...props
}: AudioMeterProps) {
  const bars = Array.from({ length: barCount });

  return (
    <div
      className={cn("flex items-end gap-[2px] h-4", className)}
      {...props}
    >
      {bars.map((_, i) => {
        const height = active ? 20 + Math.random() * 80 : 15;
        const animationDuration = 0.3 + Math.random() * 0.5;

        return (
          <motion.div
            key={i}
            className={cn(
              "w-1 rounded-t-sm origin-bottom",
              active ? "bg-vessel-accent" : "bg-vessel-border-strong"
            )}
            animate={
              active
                ? {
                    height: ["20%", `${height}%`, "20%"],
                  }
                : { height: "15%" }
            }
            transition={
              active
                ? {
                    duration: animationDuration,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }
                : undefined
            }
            style={{ minHeight: "15%" }}
          />
        );
      })}
    </div>
  );
}
