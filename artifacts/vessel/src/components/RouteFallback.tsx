/**
 * What a lazily loaded screen shows while its code arrives: the same dark
 * canvas as every screen plus a quiet brand mark, so the hand-off from the
 * landing page does not flash white or jump.
 */
import { VesselBrandIcon } from "./icons/VesselBrandIcon";

export function RouteFallback() {
  return (
    <div
      className="min-h-[100dvh] bg-vessel-bg-base flex items-center justify-center"
      role="status"
      aria-live="polite"
      aria-label="Loading"
    >
      <VesselBrandIcon className="w-8 h-8 text-vessel-accent/60 animate-pulse" />
    </div>
  );
}
