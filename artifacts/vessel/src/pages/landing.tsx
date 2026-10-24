import * as React from "react";
import { Link, useLocation } from "wouter";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { useIdentity } from "../hooks/use-identity";
import { VesselButton } from "../components/vessel-ui/VesselButton";
import { VesselCard } from "../components/vessel-ui/VesselCard";
import { Eyebrow } from "../components/vessel-ui/Eyebrow";
import { HeroDemo } from "../components/landing/HeroDemo";
import { Check, X } from "lucide-react";
import { deploymentContactUrl } from "../lib/runtime-config";
import { SupportPersonIcon } from "../components/icons/SupportPersonIcon";
import { FilePersonIcon } from "../components/icons/FilePersonIcon";
import { LaptopPersonIcon } from "../components/icons/LaptopPersonIcon";
import { VesselBrandIcon } from "../components/icons/VesselBrandIcon";
import { AimIcon } from "../components/icons/AimIcon";
import { SketchCircle } from "../components/icons/SketchCircle";
import { SketchLine } from "../components/icons/SketchLine";
import shipAvif from "@/assets/illustrations/ship.avif";
import shipWebp from "@/assets/illustrations/ship.webp";
import podcastAvif from "@/assets/illustrations/podcast.avif";
import podcastWebp from "@/assets/illustrations/podcast.webp";
import pirateCrewAvif from "@/assets/illustrations/pirate-crew.avif";
import pirateCrewWebp from "@/assets/illustrations/pirate-crew.webp";
import seascapeAvif from "@/assets/illustrations/seascape.avif";
import seascapeWebp from "@/assets/illustrations/seascape.webp";

// Sign-in dialogs pull in the key handling; load them only when opened.
const BackupKeySignInModal = React.lazy(() =>
  import("../components/onboarding/BackupKeySignInModal").then((m) => ({
    default: m.BackupKeySignInModal,
  })),
);
const NostrSignInModal = React.lazy(() =>
  import("../components/onboarding/NostrSignInModal").then((m) => ({
    default: m.NostrSignInModal,
  })),
);

/** Provider comparison for the "How Vessel compares" section. Every cell
 *  must be true on the date in COMPARISON_CHECKED; competitors change plans
 *  often, so re-check before editing anything else on this page. Single
 *  source for the phone cards and the table. */
type ComparisonCell = { value: string; icon: "check" | "cross" | null };
type ComparisonRow = {
  label: string;
  vessel: ComparisonCell;
  riverside: ComparisonCell;
  zencastr: ComparisonCell;
};

const COMPARISON_CHECKED = "October 2026";

const COMPARISON_ROWS: ComparisonRow[] = [
  {
    label: "Separate track per person, recorded locally",
    vessel: { value: "Yes, 48 kHz WAV", icon: "check" },
    riverside: { value: "Yes", icon: "check" },
    zencastr: { value: "Yes", icon: "check" },
  },
  {
    label: "Price",
    vessel: { value: "Free, no subscription", icon: null },
    riverside: { value: "14-day trial, then from $29/mo", icon: null },
    zencastr: { value: "Free", icon: null },
  },
  {
    label: "Where your files live",
    vessel: { value: "Your device and storage you choose", icon: null },
    riverside: { value: "Riverside's cloud", icon: null },
    zencastr: { value: "Zencastr's cloud", icon: null },
  },
  {
    label: "Your recordings help train AI",
    vessel: { value: "Never", icon: "check" },
    riverside: { value: "Not stated", icon: null },
    zencastr: { value: "Transcripts do", icon: "cross" },
  },
  {
    label: "Open source, can be self-hosted",
    vessel: { value: "Yes", icon: "check" },
    riverside: { value: "No", icon: "cross" },
    zencastr: { value: "No", icon: "cross" },
  },
];

function CellGlyph({
  icon,
  tone,
}: {
  icon: ComparisonCell["icon"];
  tone: "accent" | "muted";
}) {
  if (icon === "check") {
    return (
      <Check
        size={14}
        className={
          tone === "accent" ? "text-vessel-accent" : "text-vessel-text-muted"
        }
        aria-hidden="true"
      />
    );
  }
  if (icon === "cross") {
    return <X size={14} className="text-vessel-red/70" aria-hidden="true" />;
  }
  return null;
}

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const { displayName, isLoaded } = useIdentity();
  const [showBackupModal, setShowBackupModal] = React.useState(false);
  const [showNostrModal, setShowNostrModal] = React.useState(false);

  const reduceMotion = useReducedMotion();

  React.useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const sessionInvite = searchParams.get("session");
    if (sessionInvite) {
      setLocation(`/join/${sessionInvite}`);
      return;
    }

    if (isLoaded && displayName) {
      setLocation("/home");
    }
  }, [isLoaded, displayName, setLocation]);

  if (!isLoaded || displayName) {
    return null;
  }

  const navigateToStart = () => setLocation("/start");
  const openBackupSignIn = () => setShowBackupModal(true);
  const scrollToHowItWorks = () => {
    document
      .getElementById("how-it-works")
      ?.scrollIntoView({ behavior: "smooth" });
  };

  const fadeInUp: Variants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
    },
  };

  return (
    <div className="min-h-[100dvh] bg-vessel-bg-base text-vessel-text-primary selection:bg-vessel-accent/30 selection:text-vessel-accent overflow-x-hidden">
      {/* Background FX */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-0 left-0 w-[800px] h-[800px] bg-vessel-accent/5 rounded-full blur-[120px] -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute bottom-0 right-0 w-[600px] h-[600px] bg-vessel-accent/5 rounded-full blur-[100px] translate-x-1/3 translate-y-1/3" />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "url('data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.65%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E')",
          }}
        />
      </div>

      {/* Top Nav */}
      <header className="relative z-20 px-6 py-5 flex items-center justify-between max-w-6xl mx-auto w-full">
        <div className="flex items-center gap-2">
          <VesselBrandIcon className="w-7 h-7 text-vessel-accent" />
          <div className="flex items-baseline gap-1">
            <span className="font-display font-bold text-xl tracking-tight">
              Vessel
            </span>
            <div className="w-1.5 h-1.5 rounded-full bg-vessel-accent" />
          </div>
        </div>
        <button
          type="button"
          onClick={openBackupSignIn}
          className="inline-flex items-center gap-2 text-sm font-medium text-vessel-text-secondary hover:text-vessel-accent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent rounded-md px-2 py-1"
          data-testid="nav-cta-signin"
        >
          <AimIcon className="w-4 h-4" />
          <span>Sign in</span>
        </button>
      </header>

      {/* Hero Section */}
      <section className="relative z-10 flex flex-col items-center justify-center pt-8 sm:pt-12 pb-16 sm:pb-32 px-4 sm:px-6 overflow-hidden">
        <div
          className="absolute inset-x-0 top-0 h-[55%] pointer-events-none bg-no-repeat bg-contain opacity-[0.06]"
          style={{
            backgroundImage: `image-set(url('${podcastAvif}') type('image/avif'), url('${podcastWebp}') type('image/webp'))`,
            backgroundPosition: "center top",
            filter: "invert(1) grayscale(1)",
            maskImage:
              "radial-gradient(ellipse at 50% 35%, black 30%, transparent 75%)",
            WebkitMaskImage:
              "radial-gradient(ellipse at 50% 35%, black 30%, transparent 75%)",
          }}
          aria-hidden="true"
        />
        <motion.div
          initial="hidden"
          animate="visible"
          variants={{
            hidden: { opacity: 0, y: 30 },
            visible: { opacity: 1, y: 0, transition: { staggerChildren: 0.2 } },
          }}
          className="text-center max-w-4xl mx-auto flex flex-col items-center"
        >
          <motion.div variants={fadeInUp}>
            <Eyebrow className="mb-8">Studio-quality remote recording</Eyebrow>
          </motion.div>

          <motion.h1
            variants={fadeInUp}
            className="font-display font-bold text-[44px] sm:text-6xl md:text-[72px] leading-[1.05] tracking-tight mb-6"
          >
            Record like a studio.
            <br />
            <span className="text-vessel-accent">
              Own it like never before.
            </span>
          </motion.h1>

          <motion.p
            variants={fadeInUp}
            className="text-lg md:text-xl text-vessel-text-secondary max-w-lg mb-10"
          >
            Record remote interviews with every voice on its own studio-quality
            track. The files land on your devices and stay yours. No
            subscription, no lock-in.
          </motion.p>

          <motion.div
            variants={fadeInUp}
            className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto"
          >
            <VesselButton
              size="lg"
              onClick={navigateToStart}
              data-testid="hero-cta-start"
            >
              Create your studio
            </VesselButton>
            <VesselButton
              variant="ghost"
              size="lg"
              onClick={scrollToHowItWorks}
              data-testid="hero-cta-how"
            >
              See how it works
            </VesselButton>
          </motion.div>

          <motion.ul
            variants={fadeInUp}
            className="mt-6 flex flex-col sm:flex-row sm:flex-wrap justify-center gap-x-5 gap-y-1.5 text-xs text-vessel-text-muted"
            data-testid="hero-facts"
          >
            <li className="inline-flex items-center justify-center gap-1.5">
              <Check
                size={12}
                className="text-vessel-accent"
                aria-hidden="true"
              />
              A 48 kHz WAV for every person
            </li>
            <li className="inline-flex items-center justify-center gap-1.5">
              <Check
                size={12}
                className="text-vessel-accent"
                aria-hidden="true"
              />
              Guests join from a link, no account
            </li>
            <li className="inline-flex items-center justify-center gap-1.5">
              <Check
                size={12}
                className="text-vessel-accent"
                aria-hidden="true"
              />
              Open source, never trains AI
            </li>
          </motion.ul>

          <motion.p
            variants={fadeInUp}
            className="text-sm text-vessel-text-muted mt-8"
          >
            Already have a studio?{" "}
            <button
              type="button"
              onClick={openBackupSignIn}
              className="text-vessel-accent hover:underline focus:outline-none font-medium"
              data-testid="hero-cta-signin"
            >
              Sign in with your recovery key
            </button>
          </motion.p>
        </motion.div>

        <HeroDemo reduceMotion={reduceMotion} />
      </section>

      {/* Features Section */}
      <section
        id="features"
        className="relative z-10 py-14 sm:py-24 px-4 sm:px-6 bg-vessel-bg-surface/30 overflow-hidden"
      >
        <div className="relative z-10 max-w-6xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.1 }}
            variants={fadeInUp}
            className="text-center mb-10 sm:mb-16"
          >
            <h2 className="font-display text-3xl md:text-4xl font-bold">
              Everything your studio needs.
              <br />
              Nothing it doesn't.
            </h2>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.1, margin: "0px 0px 20% 0px" }}
              variants={fadeInUp}
            >
              <VesselCard variant="interactive" className="p-8 h-full">
                <SupportPersonIcon className="w-12 h-12 text-vessel-accent mb-6" />
                <h3 className="font-display font-bold text-xl mb-3">
                  Full-quality local recording
                </h3>
                <p className="text-sm text-vessel-text-secondary leading-relaxed">
                  Every participant records directly on their device at full
                  quality — not a compressed video call screengrab.
                </p>
              </VesselCard>
            </motion.div>

            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.1, margin: "0px 0px 20% 0px" }}
              variants={fadeInUp}
              transition={{ delay: 0.1 }}
            >
              <VesselCard variant="interactive" className="p-8 h-full">
                <FilePersonIcon className="w-12 h-12 text-vessel-accent mb-6" />
                <h3 className="font-display font-bold text-xl mb-3">
                  Files the moment you stop
                </h3>
                <p className="text-sm text-vessel-text-secondary leading-relaxed">
                  Each person's track is saved on their own device as they
                  record. No processing queue, no waiting for an email.
                </p>
              </VesselCard>
            </motion.div>

            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.1, margin: "0px 0px 20% 0px" }}
              variants={fadeInUp}
              transition={{ delay: 0.2 }}
            >
              <VesselCard variant="interactive" className="p-8 h-full">
                <LaptopPersonIcon className="w-12 h-12 text-vessel-accent mb-6" />
                <h3 className="font-display font-bold text-xl mb-3">
                  You pick where files live
                </h3>
                <p className="text-sm text-vessel-text-secondary leading-relaxed">
                  Keep files on your devices, back them up to storage you
                  choose, or both. If Vessel disappeared tomorrow, your
                  recordings would still be yours.
                </p>
              </VesselCard>
            </motion.div>
          </div>
        </div>
      </section>

      {/* How it Works */}
      <section
        id="how-it-works"
        className="relative z-10 py-16 sm:py-32 px-4 sm:px-6 overflow-hidden"
      >
        <div
          className="absolute inset-0 pointer-events-none bg-center bg-no-repeat bg-cover opacity-[0.07]"
          style={{
            backgroundImage: `image-set(url('${seascapeAvif}') type('image/avif'), url('${seascapeWebp}') type('image/webp'))`,
            filter: "invert(1) grayscale(1)",
            maskImage:
              "radial-gradient(ellipse at center, black 45%, transparent 80%)",
            WebkitMaskImage:
              "radial-gradient(ellipse at center, black 45%, transparent 80%)",
          }}
          aria-hidden="true"
        />
        <div className="relative z-10 max-w-6xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.1, margin: "0px 0px 20% 0px" }}
            variants={fadeInUp}
            className="text-center mb-10 sm:mb-20"
          >
            <h2 className="font-display text-3xl sm:text-4xl font-bold mb-4">
              Up and running in a minute.
            </h2>
            <p className="text-vessel-text-secondary text-lg">
              No software to install. No account required for guests.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-12 relative">
            {[
              {
                num: "1",
                title: "Create your studio",
                desc: "Just a name. No email, no credit card, no app to download.",
              },
              {
                num: "2",
                title: "Invite your guests",
                desc: "Share a link. They join in one click. Nothing to install on their end.",
              },
              {
                num: "3",
                title: "Your files, instantly",
                desc: "Every person's track is ready in studio quality the moment you stop.",
              },
            ].map((step, i) => (
              <motion.div
                key={step.num}
                initial="hidden"
                whileInView="visible"
                viewport={{
                  once: true,
                  amount: 0.1,
                  margin: "0px 0px 20% 0px",
                }}
                variants={{
                  hidden: { opacity: 0, y: 20 },
                  visible: {
                    opacity: 1,
                    y: 0,
                    transition: { delay: i * 0.2, duration: 0.5 },
                  },
                }}
                className="relative z-10 flex flex-col items-center text-center"
              >
                <div
                  className="relative w-24 h-24 mb-6 flex items-center justify-center select-none"
                  style={{ transform: `rotate(${(i - 1) * 3}deg)` }}
                >
                  <SketchCircle className="absolute inset-0 w-full h-full text-vessel-accent" />
                  <span
                    className="font-display font-bold text-4xl text-vessel-accent relative"
                    style={{ transform: `rotate(${-(i - 1) * 3}deg)` }}
                  >
                    0{step.num}
                  </span>
                </div>
                <h3 className="font-display font-bold text-xl mb-3">
                  {step.title}
                </h3>
                <p className="text-sm text-vessel-text-secondary">
                  {step.desc}
                </p>
              </motion.div>
            ))}
          </div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.1 }}
            variants={fadeInUp}
            className="mt-12 sm:mt-20 text-center"
          >
            <p className="text-sm text-vessel-text-muted mb-5">
              Want the deeper version, in plain English?
            </p>
            <Link
              href="/how-it-works"
              className="group inline-flex items-center gap-2 px-6 py-3 rounded-full bg-vessel-bg-surface border border-vessel-border text-sm font-medium text-vessel-text-primary hover:border-vessel-accent hover:text-vessel-accent hover:shadow-lg hover:shadow-vessel-accent/10 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent"
              data-testid="link-how-it-works"
            >
              <span>Read the deeper version</span>
              <span
                aria-hidden="true"
                className="transition-transform group-hover:translate-x-0.5"
              >
                &rarr;
              </span>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Comparison: stacked-card layout on mobile, traditional
          side-by-side table on tablet+. The mobile layout drops the
          horizontal scroll (which used to hide the accent Vessel
          column off-screen) and instead leads with the Vessel answer
          inside each per-feature card. */}
      <section className="relative z-10 py-20 sm:py-24 px-4 sm:px-6 bg-vessel-bg-surface/30">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.1, margin: "0px 0px 20% 0px" }}
            variants={fadeInUp}
          >
            <h2 className="font-display text-3xl sm:text-4xl font-bold mb-8 sm:mb-12 text-center">
              How Vessel compares
            </h2>

            {/* Mobile: stacked feature cards */}
            <div
              className="md:hidden space-y-3"
              data-testid="comparison-cards-mobile"
            >
              {COMPARISON_ROWS.map((row, i) => (
                <div
                  key={i}
                  className="rounded-2xl border border-vessel-border bg-vessel-bg-elevated/60 backdrop-blur-sm p-4"
                >
                  <p className="text-sm font-medium text-vessel-text-primary mb-3">
                    {row.label}
                  </p>
                  <ul className="flex flex-col gap-1.5">
                    {/* Vessel — accent-tinted highlight row, on top so
                        thumbs-scrolling readers see our answer first. */}
                    <li className="flex items-center justify-between gap-3 rounded-xl bg-vessel-accent/[0.08] border border-vessel-accent/25 px-3 py-2.5">
                      <span className="text-[11px] font-mono-vessel uppercase tracking-[0.14em] text-vessel-accent">
                        Vessel
                      </span>
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-vessel-accent text-right">
                        <CellGlyph icon={row.vessel.icon} tone="accent" />
                        {row.vessel.value}
                      </span>
                    </li>
                    <li className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="text-xs font-medium text-vessel-text-secondary">
                        Riverside
                      </span>
                      <span className="flex items-center gap-1.5 text-sm text-vessel-text-secondary text-right">
                        <CellGlyph icon={row.riverside.icon} tone="muted" />
                        {row.riverside.value}
                      </span>
                    </li>
                    <li className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="text-xs font-medium text-vessel-text-secondary">
                        Zencastr
                      </span>
                      <span className="flex items-center gap-1.5 text-sm text-vessel-text-secondary text-right">
                        <CellGlyph icon={row.zencastr.icon} tone="muted" />
                        {row.zencastr.value}
                      </span>
                    </li>
                  </ul>
                </div>
              ))}
            </div>

            {/* Tablet+: traditional comparison table */}
            <div className="hidden md:block rounded-2xl border border-vessel-border bg-vessel-bg-elevated/50 backdrop-blur-sm overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-vessel-border">
                    <th className="p-6 font-medium text-vessel-text-secondary w-1/3">
                      <span className="sr-only">Feature</span>
                    </th>
                    <th className="p-6 font-display font-bold text-vessel-accent text-lg w-1/5">
                      Vessel
                    </th>
                    <th className="p-6 font-medium text-vessel-text-secondary w-1/5">
                      Riverside
                    </th>
                    <th className="p-6 font-medium text-vessel-text-secondary w-1/5">
                      Zencastr
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-vessel-border/50 text-sm">
                  {COMPARISON_ROWS.map((row, i) => (
                    <tr
                      key={i}
                      className="hover:bg-vessel-bg-surface/50 transition-colors"
                    >
                      <td className="p-6 font-medium text-vessel-text-primary">
                        {row.label}
                      </td>
                      <td className="p-6 text-vessel-accent font-medium">
                        <span className="flex items-center gap-2">
                          <CellGlyph icon={row.vessel.icon} tone="accent" />
                          {row.vessel.value}
                        </span>
                      </td>
                      <td className="p-6 text-vessel-text-secondary">
                        <span className="flex items-center gap-2">
                          <CellGlyph icon={row.riverside.icon} tone="muted" />
                          {row.riverside.value}
                        </span>
                      </td>
                      <td className="p-6 text-vessel-text-secondary">
                        <span className="flex items-center gap-2">
                          <CellGlyph icon={row.zencastr.icon} tone="muted" />
                          {row.zencastr.value}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p
              className="mt-4 text-xs text-vessel-text-muted text-center"
              data-testid="comparison-checked"
            >
              From each provider's public pricing and terms, checked{" "}
              {COMPARISON_CHECKED}. Plans change; check theirs before you
              decide.
            </p>
          </motion.div>
        </div>
      </section>

      {/* CTA Section */}
      <section
        id="cta"
        className="relative z-10 py-16 sm:py-32 px-4 sm:px-6 text-center border-t border-vessel-border overflow-hidden"
      >
        <div
          className="absolute inset-0 pointer-events-none bg-center bg-no-repeat bg-contain opacity-[0.07]"
          style={{
            backgroundImage: `image-set(url('${shipAvif}') type('image/avif'), url('${shipWebp}') type('image/webp'))`,
            filter: "invert(1) grayscale(1)",
            maskImage:
              "radial-gradient(ellipse at center, black 40%, transparent 78%)",
            WebkitMaskImage:
              "radial-gradient(ellipse at center, black 40%, transparent 78%)",
          }}
          aria-hidden="true"
        />
        <div className="absolute inset-0 bg-vessel-accent/5 pointer-events-none" />
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.1, margin: "0px 0px 20% 0px" }}
          variants={fadeInUp}
          className="relative max-w-2xl mx-auto"
        >
          <h2 className="font-display text-4xl md:text-5xl font-bold mb-6">
            Your studio is waiting.
          </h2>
          <p className="text-xl text-vessel-text-secondary mb-10">
            Start recording in under a minute.
          </p>
          <VesselButton
            size="lg"
            onClick={navigateToStart}
            className="mb-6 w-full sm:w-auto"
            data-testid="footer-cta-start"
          >
            Create your studio
          </VesselButton>
          <p className="text-xs text-vessel-text-muted font-medium">
            No subscription. No account for your guests. Your files stay yours.
          </p>
          <p className="text-sm text-vessel-text-muted mt-8">
            Have a studio?{" "}
            <button
              type="button"
              onClick={openBackupSignIn}
              className="text-vessel-accent hover:underline focus:outline-none font-medium"
              data-testid="footer-cta-signin"
            >
              Sign in
            </button>
          </p>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 py-12 px-6 border-t border-vessel-border bg-vessel-bg-base">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex flex-col items-center md:items-start gap-2">
            <div className="flex items-center gap-2">
              <VesselBrandIcon className="w-8 h-8 text-vessel-accent" />
              <div className="flex items-baseline gap-1">
                <span className="font-display font-bold text-2xl tracking-tight">
                  Vessel
                </span>
                <div className="w-1.5 h-1.5 rounded-full bg-vessel-accent" />
              </div>
            </div>
            <p className="text-xs text-vessel-text-secondary">
              Studio-quality recordings, delivered straight to you.
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-6 text-sm text-vessel-text-muted font-medium">
            <Link
              href="/how-it-works"
              className="hover:text-vessel-accent transition-colors"
              data-testid="footer-link-how"
            >
              How it works
            </Link>
            <Link
              href="/privacy"
              className="hover:text-vessel-accent transition-colors"
              data-testid="footer-link-privacy"
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              className="hover:text-vessel-accent transition-colors"
              data-testid="footer-link-terms"
            >
              Terms
            </Link>
            <a
              href="https://github.com/megistusXYZ/Remote-Record-Studio"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-vessel-accent transition-colors"
              data-testid="footer-link-github"
            >
              GitHub
            </a>
            <a
              href={deploymentContactUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-vessel-accent transition-colors"
              data-testid="footer-link-contact"
            >
              Contact
            </a>
          </div>
        </div>

        <div className="max-w-6xl mx-auto mt-12 pt-8 border-t border-vessel-border/30 text-center">
          <p className="text-xs text-vessel-text-muted/60">
            Open source. Open formats. Your recordings, delivered to you.
          </p>
        </div>
      </footer>

      <React.Suspense fallback={null}>
        {showBackupModal && (
          <BackupKeySignInModal
            open={showBackupModal}
            onOpenChange={setShowBackupModal}
            onSuccess={() => setLocation("/home")}
            onUseNostr={() => {
              setShowBackupModal(false);
              setShowNostrModal(true);
            }}
          />
        )}

        {showNostrModal && (
          <NostrSignInModal
            open={showNostrModal}
            onOpenChange={setShowNostrModal}
            onSuccess={() => setLocation("/home")}
            onUseBackupKey={() => {
              setShowNostrModal(false);
              setShowBackupModal(true);
            }}
          />
        )}
      </React.Suspense>
    </div>
  );
}
