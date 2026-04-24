import { motion } from "framer-motion";

export function WaitingForGuestsEmpty() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: "easeOut" }}
      className="flex flex-col items-center text-center px-6 py-8"
    >
      <ChairsFacingIllustration />
      <h4 className="font-display text-lg font-bold text-vessel-text-primary mt-5 mb-1.5">
        Waiting for guests…
      </h4>
      <p className="text-vessel-text-secondary text-sm max-w-[300px] leading-relaxed">
        Share the invite link above. They'll appear here when they join.
      </p>
    </motion.div>
  );
}

function ChairsFacingIllustration() {
  return (
    <svg
      width="120"
      height="80"
      viewBox="0 0 120 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* floor */}
      <ellipse cx="60" cy="72" rx="48" ry="4" fill="#00d4aa" fillOpacity="0.07" />

      {/* left chair */}
      <g>
        <rect x="14" y="22" width="6" height="36" rx="2" fill="#2a3340" />
        <rect x="14" y="22" width="20" height="6" rx="2" fill="#3a4453" />
        <rect x="14" y="50" width="22" height="6" rx="2" fill="#3a4453" />
        <rect x="16" y="56" width="3" height="14" rx="1.5" fill="#2a3340" />
        <rect x="32" y="56" width="3" height="14" rx="1.5" fill="#2a3340" />
      </g>

      {/* right chair (mirrored) */}
      <g>
        <rect x="100" y="22" width="6" height="36" rx="2" fill="#2a3340" />
        <rect x="86" y="22" width="20" height="6" rx="2" fill="#3a4453" />
        <rect x="84" y="50" width="22" height="6" rx="2" fill="#3a4453" />
        <rect x="86" y="56" width="3" height="14" rx="1.5" fill="#2a3340" />
        <rect x="101" y="56" width="3" height="14" rx="1.5" fill="#2a3340" />
      </g>

      {/* tiny pulsing dot in the middle suggesting "soon" */}
      <circle cx="60" cy="40" r="2.5" fill="#00d4aa">
        <animate attributeName="opacity" values="0.2;1;0.2" dur="1.8s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}
