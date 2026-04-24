import { VesselButton } from "../vessel-ui/VesselButton";

export type EmptyStateProps = {
  title: string;
  subtitle: string;
  ctaLabel?: string;
  onCta?: () => void;
  ctaTestId?: string;
};

export function EmptyState({ title, subtitle, ctaLabel, onCta, ctaTestId }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center px-4">
      <svg viewBox="0 0 64 64" className="w-20 h-20 mb-6 text-vessel-accent/60">
        <rect x="24" y="12" width="16" height="28" rx="8" fill="currentColor" opacity="0.2" stroke="currentColor" strokeWidth="2" />
        <path d="M18 32 L18 36 a14 14 0 0 0 28 0 L46 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="32" y1="50" x2="32" y2="56" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="26" y1="56" x2="38" y2="56" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <g className="text-vessel-accent">
          <path d="M50 14 L50 22 M46 18 L54 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </g>
      </svg>
      <h3 className="font-display text-xl font-bold text-vessel-text-primary mb-2">{title}</h3>
      <p className="text-sm text-vessel-text-secondary max-w-md mb-6">{subtitle}</p>
      {ctaLabel && onCta && (
        <VesselButton variant="primary" onClick={onCta} data-testid={ctaTestId}>
          {ctaLabel}
        </VesselButton>
      )}
    </div>
  );
}
