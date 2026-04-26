import { motion } from "framer-motion";
import { VesselButton } from "../vessel-ui/VesselButton";
import { VesselBadge } from "../vessel-ui/VesselBadge";
import { SketchCircle } from "../icons/SketchCircle";

export type EmptyStateProps = {
  title: string;
  subtitle: string;
  ctaLabel?: string;
  onCta?: () => void;
  ctaTestId?: string;
  badge?: string;
};

const fadeInUp = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
  },
};

export function EmptyState({
  title,
  subtitle,
  ctaLabel,
  onCta,
  ctaTestId,
  badge = "Studio standing by",
}: EmptyStateProps) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        hidden: { opacity: 0 },
        visible: {
          opacity: 1,
          transition: { staggerChildren: 0.08, delayChildren: 0.05 },
        },
      }}
      className="relative flex flex-col items-center justify-center py-20 sm:py-28 text-center px-4"
    >
      {/* Microphone glyph circled by the same hand-drawn SketchCircle
          used to highlight key elements on the landing page. The
          accent-tinted halo behind it picks up the homepage's soft
          glow language. */}
      <motion.div
        variants={fadeInUp}
        className="relative w-32 h-32 mb-8 flex items-center justify-center"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-vessel-accent/10 blur-2xl"
        />
        <SketchCircle className="absolute inset-0 w-full h-full text-vessel-accent/40" />
        <svg
          viewBox="0 0 64 64"
          className="relative w-14 h-14 text-vessel-accent"
          aria-hidden="true"
        >
          <rect
            x="24"
            y="12"
            width="16"
            height="28"
            rx="8"
            fill="currentColor"
            opacity="0.18"
            stroke="currentColor"
            strokeWidth="2.5"
          />
          <path
            d="M18 32 L18 36 a14 14 0 0 0 28 0 L46 32"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <line
            x1="32"
            y1="50"
            x2="32"
            y2="56"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <line
            x1="26"
            y1="56"
            x2="38"
            y2="56"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      </motion.div>

      <motion.div variants={fadeInUp}>
        <VesselBadge variant="accent" className="mb-5">
          {badge}
        </VesselBadge>
      </motion.div>

      <motion.h3
        variants={fadeInUp}
        className="font-display font-bold text-3xl sm:text-4xl text-vessel-text-primary tracking-tight leading-[1.1] mb-4 max-w-xl"
      >
        {title}
      </motion.h3>

      <motion.p
        variants={fadeInUp}
        className="text-base sm:text-lg text-vessel-text-secondary max-w-md mb-8 leading-relaxed"
      >
        {subtitle}
      </motion.p>

      {ctaLabel && onCta && (
        <motion.div variants={fadeInUp}>
          <VesselButton
            variant="primary"
            size="lg"
            onClick={onCta}
            data-testid={ctaTestId}
          >
            {ctaLabel}
          </VesselButton>
        </motion.div>
      )}

      <motion.p
        variants={fadeInUp}
        className="text-xs text-vessel-text-muted mt-8 space-x-4"
      >
        <span>✓ Studio-quality recording</span>
        <span className="hidden sm:inline">✓ Yours forever, no lock-in</span>
      </motion.p>
    </motion.div>
  );
}
