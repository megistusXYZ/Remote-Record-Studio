import { Hand } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { VesselButton } from "../vessel-ui/VesselButton";

export type RaisedHandEntry = {
  pubkey: string;
  displayName: string;
};

export type RaisedHandNotificationProps = {
  /** Peers currently raising their hand, sorted oldest-first by
   *  handRaisedAtMs. Pass an empty array to hide the pill. */
  raisedHands: RaisedHandEntry[];
  /** When true the pill stays hidden because the room panel is already
   *  open and the user is presumably looking at the queue there — no
   *  point shouting twice. */
  rosterOpen: boolean;
  /** "View" action — opens the room panel so the user can see the queue
   *  and (if host) lower individual hands. */
  onView: () => void;
};

/**
 * A floating, lightly-animated pill that surfaces raised-hand activity
 * to anyone in the studio. Lives just above the control bar, animates in
 * and out with framer-motion, and stays visible for as long as one or
 * more peers have their hand raised. Designed to be impossible to miss
 * but never modal — it doesn't block the call surface or steal focus.
 */
export function RaisedHandNotification({
  raisedHands,
  rosterOpen,
  onView,
}: RaisedHandNotificationProps) {
  const visible = raisedHands.length > 0 && !rosterOpen;
  const primary = raisedHands[0];
  const others = raisedHands.length - 1;

  const message = primary
    ? others === 0
      ? `${primary.displayName} raised a hand`
      : others === 1
      ? `${primary.displayName} and 1 other raised their hands`
      : `${primary.displayName} and ${others} others raised their hands`
    : "";

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="raised-hand-pill"
          initial={{ opacity: 0, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.96 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 pointer-events-none"
          role="status"
          aria-live="polite"
          data-testid="notification-raised-hand"
        >
          <div className="pointer-events-auto flex items-center gap-3 pl-2.5 pr-2 py-2 rounded-full bg-vessel-bg-elevated/95 backdrop-blur-xl border border-vessel-amber/40 shadow-lg shadow-vessel-amber/10">
            <span className="relative flex items-center justify-center w-7 h-7 rounded-full bg-vessel-amber/15 shrink-0">
              <span className="absolute inset-0 rounded-full bg-vessel-amber/30 animate-ping" />
              <Hand className="w-3.5 h-3.5 text-vessel-amber relative" />
            </span>
            <span
              className="text-sm text-vessel-text-primary font-medium pr-1 max-w-[60vw] truncate"
              data-testid="text-raised-hand-message"
            >
              {message}
            </span>
            <VesselButton
              variant="ghost"
              size="sm"
              onClick={onView}
              className="h-7 px-3 text-xs shrink-0"
              data-testid="button-raised-hand-view"
            >
              View
            </VesselButton>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
