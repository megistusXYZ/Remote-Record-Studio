import ostrichImg from "@assets/219715635-58e1cafc-97d4-44ec-bccb-b70e09701579_1777095073597.png";
import { cn } from "@/lib/utils";

export type NostrOstrichProps = {
  className?: string;
};

/**
 * Small ostrich-in-the-stars mascot used as a decorative mark next to the
 * word "Nostr" wherever it appears. Rendered as a normal raster — the
 * dark image background harmonizes with the surrounding "Broadcast Dark"
 * surfaces, so callers can size it via `className` (e.g. `w-10 h-7
 * rounded-md`) and treat it like a small badge.
 */
export function NostrOstrich({ className }: NostrOstrichProps) {
  return (
    <img
      src={ostrichImg}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn(
        "inline-block object-cover pointer-events-none select-none",
        className,
      )}
    />
  );
}
