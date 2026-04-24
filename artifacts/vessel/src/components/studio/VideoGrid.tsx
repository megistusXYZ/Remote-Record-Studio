import React from "react";
import { cn } from "@/lib/utils";

export type VideoGridProps = {
  children: React.ReactNode;
  participantCount: number;
};

export function VideoGrid({ children, participantCount }: VideoGridProps) {
  return (
    <div className="w-full h-full p-3 flex items-center justify-center">
      <div
        className={cn(
          "grid gap-3 w-full h-full auto-rows-fr items-stretch content-stretch",
          participantCount === 1 && "grid-cols-1 max-w-[720px] mx-auto aspect-video",
          participantCount === 2 && "grid-cols-1 sm:grid-cols-2",
          (participantCount === 3 || participantCount === 4) && "grid-cols-1 sm:grid-cols-2",
          participantCount >= 5 && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
        )}
      >
        {children}
      </div>
    </div>
  );
}
