import React from "react";
import { cn } from "@/lib/utils";

export type VideoGridProps = {
  children: React.ReactNode;
  participantCount: number;
};

export function VideoGrid({ children, participantCount }: VideoGridProps) {
  // Single-participant case is its own layout: a properly aspect-locked
  // 16:9 box, centered in the available space, capped on both axes so
  // it never blows up to the full viewport on a wide monitor and never
  // flows under the control bar on a short one. The previous "grid +
  // w-full h-full + aspect-video" combo silently lost the aspect ratio
  // because explicit dimensions override CSS aspect-ratio.
  if (participantCount === 1) {
    return (
      <div className="w-full h-full p-3 sm:p-5 lg:p-8 flex items-center justify-center">
        <div className="aspect-video w-full max-w-[1100px] max-h-full">
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full p-3 sm:p-4 lg:p-5 flex items-center justify-center">
      <div
        className={cn(
          "grid gap-3 w-full h-full auto-rows-fr items-stretch content-stretch",
          participantCount === 2 && "grid-cols-1 sm:grid-cols-2",
          (participantCount === 3 || participantCount === 4) && "grid-cols-1 sm:grid-cols-2",
          participantCount >= 5 && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
        )}
      >
        {children}
      </div>
    </div>
  );
}
