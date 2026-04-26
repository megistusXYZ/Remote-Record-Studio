import { motion } from "framer-motion";
import { VesselCard } from "../vessel-ui/VesselCard";

export function LobbyEmptyState() {
  return (
    <VesselCard className="p-6 sm:p-8 text-center border-dashed border-vessel-border/70">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="flex flex-col items-center"
      >
        <MicOnStandIllustration />
        <h4 className="font-display text-base sm:text-lg font-bold text-vessel-text-primary mt-4 sm:mt-5 mb-1.5">
          No sessions yet
        </h4>
        <p className="text-vessel-text-secondary text-sm max-w-[260px] leading-relaxed">
          Start a session to invite guests and record together.
        </p>
      </motion.div>
    </VesselCard>
  );
}

function MicOnStandIllustration() {
  return (
    <svg
      width="88"
      height="88"
      viewBox="0 0 88 88"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* base ring (ground) */}
      <ellipse cx="44" cy="78" rx="22" ry="3" fill="#00d4aa" fillOpacity="0.08" />
      {/* stand */}
      <rect x="42" y="48" width="4" height="26" rx="1.5" fill="#3a4453" />
      <rect x="32" y="74" width="24" height="3" rx="1.5" fill="#3a4453" />
      {/* mic body */}
      <rect
        x="32"
        y="14"
        width="24"
        height="36"
        rx="12"
        fill="#1a232f"
        stroke="#00d4aa"
        strokeOpacity="0.55"
        strokeWidth="1.5"
      />
      {/* grille lines */}
      <line x1="36" y1="22" x2="52" y2="22" stroke="#00d4aa" strokeOpacity="0.5" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="36" y1="28" x2="52" y2="28" stroke="#00d4aa" strokeOpacity="0.5" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="36" y1="34" x2="52" y2="34" stroke="#00d4aa" strokeOpacity="0.5" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="36" y1="40" x2="52" y2="40" stroke="#00d4aa" strokeOpacity="0.5" strokeWidth="1.2" strokeLinecap="round" />
      {/* gentle glow */}
      <circle cx="44" cy="32" r="20" fill="#00d4aa" fillOpacity="0.06" />
    </svg>
  );
}
