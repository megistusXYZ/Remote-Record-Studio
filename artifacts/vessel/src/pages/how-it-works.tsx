import * as React from "react";
import { Link, useLocation } from "wouter";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  X,
  KeyRound,
  Send,
  Database,
  Headphones,
  Wifi,
  AudioLines,
  Stamp,
  Quote,
} from "lucide-react";
import { VesselBrandIcon } from "../components/icons/VesselBrandIcon";
import { SupportPersonIcon } from "../components/icons/SupportPersonIcon";
import { FilePersonIcon } from "../components/icons/FilePersonIcon";
import { LaptopPersonIcon } from "../components/icons/LaptopPersonIcon";
import { SketchCircle } from "../components/icons/SketchCircle";
import { SketchLine } from "../components/icons/SketchLine";
import { VesselButton } from "../components/vessel-ui/VesselButton";
import { VesselCard } from "../components/vessel-ui/VesselCard";
import { Eyebrow } from "../components/vessel-ui/Eyebrow";
import seascapeAvif from "@/assets/illustrations/seascape.avif";
import seascapeWebp from "@/assets/illustrations/seascape.webp";
import shipAvif from "@/assets/illustrations/ship.avif";
import shipWebp from "@/assets/illustrations/ship.webp";

const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
  },
};

const noMotion: Variants = {
  hidden: { opacity: 1, y: 0 },
  visible: { opacity: 1, y: 0, transition: { duration: 0 } },
};

const HowItWorksContext = React.createContext<Variants>(fadeInUp);
const useEntryVariants = () => React.useContext(HowItWorksContext);

interface SectionProps {
  eyebrow?: string;
  title: React.ReactNode;
  blurb?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
  className?: string;
}

function Section({ eyebrow, title, blurb, children, id, className }: SectionProps) {
  const variants = useEntryVariants();
  return (
    <section
      id={id}
      className={`relative z-10 px-6 py-20 sm:py-24 ${className ?? ""}`}
    >
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={variants}
          className="mb-12 max-w-3xl"
        >
          {eyebrow ? (
            <p className="font-mono-vessel text-xs uppercase tracking-[0.18em] text-vessel-accent mb-3">
              {eyebrow}
            </p>
          ) : null}
          <h2 className="font-display font-bold text-3xl sm:text-4xl tracking-tight leading-[1.1]">
            {title}
          </h2>
          {blurb ? (
            <p className="mt-4 text-vessel-text-secondary text-base sm:text-lg leading-relaxed">
              {blurb}
            </p>
          ) : null}
        </motion.div>
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
          variants={variants}
        >
          {children}
        </motion.div>
      </div>
    </section>
  );
}

interface MachineCardProps {
  icon: React.ReactNode;
  name: string;
  role: string;
  detail: string;
}

function MachineCard({ icon, name, role, detail }: MachineCardProps) {
  return (
    <VesselCard variant="interactive" className="p-6 h-full flex flex-col">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-11 h-11 rounded-xl bg-vessel-accent-glow border border-vessel-accent/20 text-vessel-accent flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div>
          <h3 className="font-display font-bold text-base text-vessel-text-primary leading-tight">
            {name}
          </h3>
          <p className="text-xs text-vessel-text-muted mt-0.5">{role}</p>
        </div>
      </div>
      <p className="text-sm text-vessel-text-secondary leading-relaxed">
        {detail}
      </p>
    </VesselCard>
  );
}

interface FlowStepProps {
  num: number;
  title: string;
  body: React.ReactNode;
}

function FlowStep({ num, title, body }: FlowStepProps) {
  const padded = String(num).padStart(2, "0");
  const variants = useEntryVariants();
  return (
    <motion.li
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-60px" }}
      variants={variants}
      className="relative pl-20 sm:pl-24 pb-10 last:pb-0"
    >
      <div
        className="absolute left-0 top-0 w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center select-none"
        style={{ transform: `rotate(${(num % 2 === 0 ? -1 : 1) * 2.5}deg)` }}
      >
        <SketchCircle className="absolute inset-0 w-full h-full text-vessel-accent" />
        <span
          className="font-display font-bold text-xl sm:text-2xl text-vessel-accent relative"
          style={{
            transform: `rotate(${(num % 2 === 0 ? 1 : -1) * 2.5}deg)`,
          }}
        >
          {padded}
        </span>
      </div>
      <h3 className="font-display font-bold text-lg sm:text-xl text-vessel-text-primary mb-2 mt-1">
        {title}
      </h3>
      <div className="text-sm sm:text-[15px] text-vessel-text-secondary leading-relaxed space-y-2">
        {body}
      </div>
    </motion.li>
  );
}

interface OwnsCardProps {
  who: string;
  what: string;
  detail: string;
  highlight?: boolean;
}

function OwnsCard({ who, what, detail, highlight }: OwnsCardProps) {
  return (
    <VesselCard
      className={`p-6 h-full flex flex-col ${
        highlight
          ? "border-vessel-accent/40 bg-vessel-accent-glow"
          : ""
      }`}
    >
      <p className="font-mono-vessel text-[10px] uppercase tracking-[0.18em] text-vessel-text-muted mb-2">
        {who}
      </p>
      <h3 className="font-display font-bold text-lg text-vessel-text-primary mb-3 leading-tight">
        {what}
      </h3>
      <p className="text-sm text-vessel-text-secondary leading-relaxed">
        {detail}
      </p>
    </VesselCard>
  );
}

export default function HowItWorks() {
  const reduceMotion = useReducedMotion();
  const variants = reduceMotion ? noMotion : fadeInUp;
  const [, setLocation] = useLocation();
  const goStart = React.useCallback(() => setLocation("/start"), [setLocation]);
  const goPrivacy = React.useCallback(
    () => setLocation("/privacy"),
    [setLocation],
  );
  return (
    <HowItWorksContext.Provider value={variants}>
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

      {/* Header */}
      <header className="relative z-20 px-6 py-5 flex items-center justify-between max-w-6xl mx-auto w-full">
        <Link
          href="/"
          className="flex items-center gap-3 group focus:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent rounded-md px-1 py-1"
          data-testid="link-content-home"
        >
          <VesselBrandIcon className="w-9 h-9 text-vessel-accent" />
          <div className="flex items-baseline gap-1">
            <span className="font-display font-bold text-xl tracking-tight">
              Vessel
            </span>
            <div className="w-1.5 h-1.5 rounded-full bg-vessel-accent" />
          </div>
        </Link>
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-medium text-vessel-text-secondary hover:text-vessel-accent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent rounded-md px-2 py-1"
          data-testid="link-content-back"
        >
          <ArrowLeft size={14} />
          <span>Back to home</span>
        </Link>
      </header>

      {/* Hero */}
      <section className="relative z-10 px-6 pt-12 pb-12 sm:pb-20 overflow-hidden">
        <div
          className="absolute inset-x-0 top-0 h-[110%] pointer-events-none bg-no-repeat bg-contain opacity-[0.06]"
          style={{
            backgroundImage: `image-set(url('${seascapeAvif}') type('image/avif'), url('${seascapeWebp}') type('image/webp'))`,
            backgroundPosition: "center top",
            filter: "invert(1) grayscale(1)",
            maskImage:
              "radial-gradient(ellipse at 50% 30%, black 30%, transparent 75%)",
            WebkitMaskImage:
              "radial-gradient(ellipse at 50% 30%, black 30%, transparent 75%)",
          }}
          aria-hidden="true"
        />
        <div className="relative z-10 max-w-3xl mx-auto text-center">
          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeInUp}
            className="flex justify-center"
          >
            <Eyebrow className="mb-7">The plain-English version</Eyebrow>
          </motion.div>
          <motion.h1
            initial="hidden"
            animate="visible"
            variants={fadeInUp}
            transition={{ delay: 0.05 }}
            className="font-display font-bold text-4xl sm:text-5xl md:text-6xl tracking-tight leading-[1.05] mb-6"
          >
            Two things travel.<br />
            <span className="text-vessel-accent">Only one is yours.</span>
          </motion.h1>
          <motion.p
            initial="hidden"
            animate="visible"
            variants={fadeInUp}
            transition={{ delay: 0.1 }}
            className="text-base sm:text-lg text-vessel-text-secondary leading-relaxed max-w-xl mx-auto"
          >
            A small, lo-fi preview zips between you and your guest so you can
            have a normal conversation. The studio-quality recording stays put
            on each person&rsquo;s own machine &mdash; then gets quietly mailed
            to wherever you want it kept. Pull up a chair, here&rsquo;s how.
          </motion.p>
        </div>

        {/* Two-track diagram */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeInUp}
          className="relative z-10 max-w-4xl mx-auto mt-14"
        >
          <VesselCard className="p-6 sm:p-8">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-6 items-center">
              {/* Host */}
              <div className="flex flex-col items-center text-center gap-3">
                <div className="w-14 h-14 rounded-full bg-vessel-accent-glow border border-vessel-accent/20 flex items-center justify-center">
                  <Headphones size={22} className="text-vessel-accent" />
                </div>
                <p className="font-display font-bold text-sm text-vessel-text-primary">
                  Host
                </p>
                <p className="text-xs text-vessel-text-muted">
                  Recording themselves on their laptop
                </p>
              </div>

              {/* Two tracks between */}
              <div className="flex flex-col gap-5 min-w-[180px]">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <Wifi size={14} className="text-vessel-text-muted" />
                    <span className="text-[10px] uppercase tracking-[0.18em] font-mono-vessel text-vessel-text-muted">
                      Lo-fi preview
                    </span>
                    <Wifi size={14} className="text-vessel-text-muted" />
                  </div>
                  <SketchLine className="w-full h-2 text-vessel-text-muted/60" />
                  <p className="text-[11px] text-vessel-text-muted text-center italic">
                    travels in real time
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <AudioLines size={14} className="text-vessel-accent" />
                    <span className="text-[10px] uppercase tracking-[0.18em] font-mono-vessel text-vessel-accent">
                      Studio master
                    </span>
                    <AudioLines size={14} className="text-vessel-accent" />
                  </div>
                  <SketchLine className="w-full h-2 text-vessel-accent" />
                  <p className="text-[11px] text-vessel-accent text-center italic">
                    stays local, mailed at the end
                  </p>
                </div>
              </div>

              {/* Guest */}
              <div className="flex flex-col items-center text-center gap-3">
                <div className="w-14 h-14 rounded-full bg-vessel-accent-glow border border-vessel-accent/20 flex items-center justify-center">
                  <Headphones size={22} className="text-vessel-accent" />
                </div>
                <p className="font-display font-bold text-sm text-vessel-text-primary">
                  Guest
                </p>
                <p className="text-xs text-vessel-text-muted">
                  Recording themselves on their laptop
                </p>
              </div>
            </div>
          </VesselCard>
          <p className="mt-4 text-center text-xs text-vessel-text-muted italic">
            The slogan version: the conversation streams, the studio masters
            get mailed.
          </p>
        </motion.div>
      </section>

      {/* The Big Shift */}
      <Section
        eyebrow="The big shift"
        title={
          <>
            Two ways to record a remote conversation.{" "}
            <span className="text-vessel-accent">Vessel picks the second.</span>
          </>
        }
        blurb="Most apps treat your audio like a pizza order — sent to a kitchen, cooked there, delivered back to you. Vessel treats it like a tape — already in your hands, you decide where it goes."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <VesselCard className="p-6 sm:p-8 h-full border-vessel-border">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-full bg-vessel-red/10 border border-vessel-red/20 flex items-center justify-center">
                <X size={16} className="text-vessel-red" />
              </div>
              <h3 className="font-display font-bold text-lg text-vessel-text-primary">
                The old way
              </h3>
            </div>
            <ul className="space-y-3 text-sm text-vessel-text-secondary leading-relaxed">
              <li className="flex gap-3">
                <span className="text-vessel-text-muted shrink-0 mt-1">·</span>
                <span>
                  Your audio gets crammed through the internet to a cloud
                  server.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="text-vessel-text-muted shrink-0 mt-1">·</span>
                <span>
                  Quality drops on every wobble of your wifi. The internet
                  decides how good your tape sounds.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="text-vessel-text-muted shrink-0 mt-1">·</span>
                <span>
                  Your finished files sit on someone else&rsquo;s server &mdash;
                  the same someone who controls the buttons on your dashboard.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="text-vessel-text-muted shrink-0 mt-1">·</span>
                <span>
                  Pay a monthly subscription forever, or one day lose access to
                  the very recordings you made.
                </span>
              </li>
            </ul>
          </VesselCard>
          <VesselCard className="p-6 sm:p-8 h-full border-vessel-accent/40 bg-vessel-accent-glow">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-full bg-vessel-accent/15 border border-vessel-accent/30 flex items-center justify-center">
                <Check size={16} className="text-vessel-accent" />
              </div>
              <h3 className="font-display font-bold text-lg text-vessel-text-primary">
                The Vessel way
              </h3>
            </div>
            <ul className="space-y-3 text-sm text-vessel-text-secondary leading-relaxed">
              <li className="flex gap-3">
                <span className="text-vessel-accent shrink-0 mt-1">·</span>
                <span>
                  Each browser records itself at full studio quality. The
                  internet is not in the audio path.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="text-vessel-accent shrink-0 mt-1">·</span>
                <span>
                  Only a tiny preview is streamed live so you can see and hear
                  each other &mdash; the master tape is not.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="text-vessel-accent shrink-0 mt-1">·</span>
                <span>
                  Each person&rsquo;s finished file ships straight to the
                  storage location{" "}
                  <em className="text-vessel-text-primary not-italic font-medium">
                    they
                  </em>{" "}
                  picked &mdash; never to us, never funnelled through one
                  account.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="text-vessel-accent shrink-0 mt-1">·</span>
                <span>
                  No monthly fee for the right to your tape. If Vessel
                  disappeared tomorrow, your recordings still exist exactly
                  where you put them.
                </span>
              </li>
            </ul>
          </VesselCard>
        </div>
      </Section>

      {/* The mental model */}
      <Section
        eyebrow="The mental model"
        title={
          <>
            Imagine each guest with their own{" "}
            <span className="text-vessel-accent">tape recorder.</span>
          </>
        }
      >
        <VesselCard className="p-6 sm:p-10 grid grid-cols-1 md:grid-cols-[1fr_1.2fr] gap-8 items-center">
          <div className="space-y-4 text-vessel-text-secondary text-[15px] leading-relaxed">
            <p>
              You and your friends each have a personal tape recorder. You all
              dial into the same call, you each press record on{" "}
              <em>your own</em> recorder, and at the end of the show each
              person&rsquo;s clean tape goes straight into{" "}
              <em>their own</em> filing cabinet &mdash; ready for the host to
              pick up and assemble.
            </p>
            <p>
              That is Vessel. Not &ldquo;everyone shouts into one shared
              microphone in the cloud.&rdquo;{" "}
              <span className="text-vessel-text-primary font-medium">
                Each guest is recorded on their own device, in studio quality,
                and keeps the canonical copy.
              </span>{" "}
              The internet only carries a small preview so people can see and
              hear each other in real time.
            </p>
            <p className="text-sm text-vessel-text-muted italic">
              Everything else on this page is detail.
            </p>
          </div>
          <div
            className="relative w-full aspect-[4/3] rounded-xl bg-vessel-bg-base/40 border border-vessel-border/60 overflow-hidden"
            aria-hidden="true"
          >
            <div
              className="absolute inset-0 bg-no-repeat bg-cover bg-center opacity-[0.18]"
              style={{
                backgroundImage: `image-set(url('${shipAvif}') type('image/avif'), url('${shipWebp}') type('image/webp'))`,
                filter: "invert(1) grayscale(1)",
                maskImage:
                  "radial-gradient(ellipse at center, black 40%, transparent 80%)",
                WebkitMaskImage:
                  "radial-gradient(ellipse at center, black 40%, transparent 80%)",
              }}
            />
            <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
              <p className="font-display italic text-base sm:text-lg text-vessel-text-secondary leading-snug">
                &ldquo;The conversation streams.<br />
                The studio masters get mailed.&rdquo;
              </p>
            </div>
          </div>
        </VesselCard>
      </Section>

      {/* The 6-step record flow */}
      <Section
        eyebrow="When you press record"
        title={
          <>
            Six small things happen,{" "}
            <span className="text-vessel-accent">most of them invisible.</span>
          </>
        }
        blurb="From the moment you click your invite link to the moment the host opens the editor — here is the whole timeline."
      >
        <ol className="relative max-w-3xl">
          <FlowStep
            num={1}
            title="You make a studio."
            body={
              <p>
                Vessel hands you a shareable invite link. You text it to your
                guest. That&rsquo;s the whole setup.
              </p>
            }
          />
          <FlowStep
            num={2}
            title="Your guest clicks the link."
            body={
              <p>
                Their browser opens a page that asks &ldquo;can I use your
                microphone and camera?&rdquo; They say yes. Nothing to install,
                no account to create.
              </p>
            }
          />
          <FlowStep
            num={3}
            title="The receptionist plays matchmaker."
            body={
              <p>
                Our server hands both browsers an address for a thin
                conversation server &mdash; a small middleman whose only job
                is to forward the live preview between you. It does not look
                inside, it does not save anything, and it never sees the
                studio-quality recording.
              </p>
            }
          />
          <FlowStep
            num={4}
            title="You both press Record."
            body={
              <>
                <p>From this moment on, two things happen in parallel:</p>
                <ul className="list-disc pl-5 space-y-1.5 text-vessel-text-secondary">
                  <li>
                    A small, compressed audio and video preview zips between
                    you so you can have a normal conversation.
                  </li>
                  <li>
                    Each browser quietly saves the{" "}
                    <em className="text-vessel-text-primary not-italic font-medium">
                      full
                    </em>{" "}
                    high-quality recording to storage on its own device.
                    Yours stays on your laptop. Your guest&rsquo;s stays on
                    theirs.
                  </li>
                </ul>
              </>
            }
          />
          <FlowStep
            num={5}
            title="You finish the chat."
            body={<p>Everyone clicks &ldquo;stop.&rdquo; The preview stops streaming.</p>}
          />
          <FlowStep
            num={6}
            title="Delivery time."
            body={
              <>
                <p>
                  Each browser packages up its own high-quality file and ships
                  it straight to a storage server. Your tape goes to your storage.
                  Your guest&rsquo;s tape goes to theirs. The files do{" "}
                  <strong className="text-vessel-text-primary">not</strong>{" "}
                  stop over on Vessel&rsquo;s servers.
                </p>
                <p className="text-vessel-text-muted">
                  As the host, you open your editor and see the session
                  bundled together &mdash; one neat row of tracks, each one
                  pulled from wherever its owner keeps it. Clean, separated,
                  ready to mix.
                </p>
              </>
            }
          />
        </ol>
      </Section>

      {/* Four little machines */}
      <Section
        eyebrow="The building blocks"
        title={
          <>
            Four little machines,{" "}
            <span className="text-vessel-accent">talking to each other.</span>
          </>
        }
        blurb="Vessel is not a monolith. It is a small cast of cooperating parts. Knowing which is which makes the rest of this page easier."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MachineCard
            icon={<VesselBrandIcon className="w-6 h-6" />}
            name="The studio"
            role="What you’re looking at right now"
            detail="A website with the buttons and the big record button. Loads in any modern browser."
          />
          <MachineCard
            icon={<SupportPersonIcon className="w-6 h-6" />}
            name="The receptionist"
            role="Tiny, polite, busy"
            detail="Issues invites, keeps track of who is in which room, and points both browsers at a small coordination server so they can preview each other live. Never sees your audio."
          />
          <MachineCard
            icon={<FilePersonIcon className="w-6 h-6" />}
            name="The filing cabinet"
            role="Names and dates only"
            detail="Remembers studio names, session titles, and who joined when — the boring stuff that makes your dashboard not be empty."
          />
          <MachineCard
            icon={<LaptopPersonIcon className="w-6 h-6" />}
            name="Your browser"
            role="The actual studio"
            detail="Captures your microphone and camera at full quality, stores the file safely on your device, then ships it. The interesting work happens here."
          />
        </div>
        <p className="mt-6 text-sm text-vessel-text-muted leading-relaxed max-w-2xl">
          Notice what&rsquo;s <em>not</em> on that list: no app to install, no
          special plugin, no big media server humming in a data centre holding
          your audio hostage.
        </p>
      </Section>

      {/* Where things actually live */}
      <Section
        eyebrow="The geography"
        title={
          <>
            Three things get stored,{" "}
            <span className="text-vessel-accent">in three different places.</span>
          </>
        }
        blurb="When people ask “where is my data?” the honest answer has three parts. Here they are."
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <VesselCard className="p-6 h-full">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-vessel-accent-glow border border-vessel-accent/20 flex items-center justify-center">
                <KeyRound size={18} className="text-vessel-accent" />
              </div>
              <p className="font-mono-vessel text-[10px] uppercase tracking-[0.18em] text-vessel-text-muted">
                Lives on your device
              </p>
            </div>
            <h3 className="font-display font-bold text-base text-vessel-text-primary mb-2">
              Your recovery key
            </h3>
            <p className="text-sm text-vessel-text-secondary leading-relaxed">
              Generated by your browser when you first sign up. Stored in your
              browser&rsquo;s local memory. Nobody else&rsquo;s machine has it
              &mdash; not even ours.
            </p>
          </VesselCard>
          <VesselCard className="p-6 h-full border-vessel-accent/40 bg-vessel-accent-glow">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-vessel-accent/15 border border-vessel-accent/30 flex items-center justify-center">
                <Send size={18} className="text-vessel-accent" />
              </div>
              <p className="font-mono-vessel text-[10px] uppercase tracking-[0.18em] text-vessel-accent">
                Lives on each person&rsquo;s own storage
              </p>
            </div>
            <h3 className="font-display font-bold text-base text-vessel-text-primary mb-2">
              The studio-quality recordings
            </h3>
            <p className="text-sm text-vessel-text-secondary leading-relaxed">
              First on the device that recorded them. Then shipped straight to
              the storage server that <em className="not-italic font-medium text-vessel-text-primary">that participant</em>{" "}
              chose &mdash; the host&rsquo;s tape to the host&rsquo;s storage,
              the guest&rsquo;s tape to the guest&rsquo;s. Vessel never touches
              the bytes.
            </p>
          </VesselCard>
          <VesselCard className="p-6 h-full">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-vessel-accent-glow border border-vessel-accent/20 flex items-center justify-center">
                <Database size={18} className="text-vessel-accent" />
              </div>
              <p className="font-mono-vessel text-[10px] uppercase tracking-[0.18em] text-vessel-text-muted">
                Lives on Vessel
              </p>
            </div>
            <h3 className="font-display font-bold text-base text-vessel-text-primary mb-2">
              Boring metadata
            </h3>
            <p className="text-sm text-vessel-text-secondary leading-relaxed">
              Studio names, session titles, when people joined. Just enough to
              show your dashboard. No audio, no video, no key, no password
              (there isn&rsquo;t one), no contacts, no calendar.
            </p>
          </VesselCard>
        </div>
      </Section>

      {/* The wax seal — identity */}
      <Section
        eyebrow="Who you are"
        title={
          <>
            Every request gets a{" "}
            <span className="text-vessel-accent">wax seal.</span>
          </>
        }
      >
        <VesselCard className="p-6 sm:p-10 grid grid-cols-1 md:grid-cols-[auto_1fr] gap-8 items-start">
          <div className="flex items-center justify-center">
            <div className="relative w-32 h-32 sm:w-40 sm:h-40 flex items-center justify-center">
              <SketchCircle className="absolute inset-0 w-full h-full text-vessel-accent" />
              <div className="absolute inset-3 rounded-full border border-vessel-accent/20 bg-vessel-accent-glow" />
              <Stamp
                size={48}
                className="relative text-vessel-accent"
              />
            </div>
          </div>
          <div className="space-y-4 text-vessel-text-secondary text-[15px] leading-relaxed">
            <p>
              When you sign up, your browser quietly generates a{" "}
              <strong className="text-vessel-text-primary">
                recovery key
              </strong>{" "}
              &mdash; think of it as the only physical key to a safety deposit
              box. That key lives on your device. We never see it.
            </p>
            <p>
              Every time you ask Vessel for something &mdash; &ldquo;list my
              sessions,&rdquo; &ldquo;create a room,&rdquo; &ldquo;cancel an
              invite&rdquo; &mdash; your browser stamps the request with that
              key first. Anyone can read whose seal it is, but only the person
              holding the stamp could have made it.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div className="flex items-start gap-2 text-sm">
                <Check size={16} className="text-vessel-accent shrink-0 mt-0.5" />
                <span>No password to phish or leak</span>
              </div>
              <div className="flex items-start gap-2 text-sm">
                <Check size={16} className="text-vessel-accent shrink-0 mt-0.5" />
                <span>No session cookie to steal</span>
              </div>
              <div className="flex items-start gap-2 text-sm">
                <Check size={16} className="text-vessel-accent shrink-0 mt-0.5" />
                <span>No &ldquo;forgot my login&rdquo; loophole</span>
              </div>
              <div className="flex items-start gap-2 text-sm">
                <Check size={16} className="text-vessel-accent shrink-0 mt-0.5" />
                <span>Your studio works on any Vessel server</span>
              </div>
            </div>
            <p className="text-xs text-vessel-text-muted italic pt-1">
              Trade-off: lose the key and you lose access. Same as the only key
              to a safety deposit box. By design &mdash; that is the cost of
              not handing your identity to a company.
            </p>
          </div>
        </VesselCard>
      </Section>

      {/* What our server does / doesn't */}
      <Section
        eyebrow="The receptionist’s job"
        title={
          <>
            What our server actually does.{" "}
            <span className="text-vessel-accent">And doesn&rsquo;t.</span>
          </>
        }
        blurb="Honestly? Not much, on purpose. The interesting work happens inside the browsers of the people in the room."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <VesselCard className="p-6 sm:p-8 h-full">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-8 h-8 rounded-full bg-vessel-accent/15 border border-vessel-accent/30 flex items-center justify-center">
                <Check size={16} className="text-vessel-accent" />
              </div>
              <h3 className="font-display font-bold text-lg text-vessel-text-primary">
                Vessel does
              </h3>
            </div>
            <ul className="space-y-3 text-sm text-vessel-text-secondary leading-relaxed">
              {[
                "Checks the wax-seal signature on every incoming request to confirm it is really you.",
                "Hands out invite links and points the right browsers at the small coordination server so they can see and hear each other live.",
                "Remembers the names of your studios and sessions so your dashboard isn\u2019t empty.",
                "Routes the small \u201care you online?\u201d and \u201cyou are muted!\u201d type messages between participants.",
                "Writes a tiny log line per request \u2014 request id, method, and path. No IP, no headers, no body.",
              ].map((item) => (
                <li key={item} className="flex gap-3">
                  <Check size={14} className="text-vessel-accent shrink-0 mt-1" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </VesselCard>
          <VesselCard className="p-6 sm:p-8 h-full border-vessel-border">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-8 h-8 rounded-full bg-vessel-red/10 border border-vessel-red/20 flex items-center justify-center">
                <X size={16} className="text-vessel-red" />
              </div>
              <h3 className="font-display font-bold text-lg text-vessel-text-primary">
                Vessel never
              </h3>
            </div>
            <ul className="space-y-3 text-sm text-vessel-text-secondary leading-relaxed">
              {[
                "Touches your audio. Not in transit, not at rest.",
                "Touches your video. Same.",
                "Stores your recovery key. We can\u2019t \u2014 we never receive it.",
                "Holds your contacts, calendar, or address book.",
                "Reads, transcribes, or analyses your recordings.",
              ].map((item) => (
                <li key={item} className="flex gap-3">
                  <X size={14} className="text-vessel-red shrink-0 mt-1" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </VesselCard>
        </div>
        <p className="mt-6 text-sm text-vessel-text-muted leading-relaxed max-w-2xl">
          Want the literal field-by-field list of what we store?{" "}
          <Link
            href="/privacy"
            className="text-vessel-accent hover:underline font-medium"
          >
            The privacy notice
          </Link>{" "}
          spells it out.
        </p>
      </Section>

      {/* Who owns what */}
      <Section
        eyebrow="Ownership"
        title={
          <>
            Who owns{" "}
            <span className="text-vessel-accent">what.</span>
          </>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <OwnsCard
            who="Each guest"
            what="Owns their own raw track"
            detail="It is their voice, their face, their tape. It lives on their device first, then on the storage server they themselves picked. Nobody else holds the canonical copy."
          />
          <OwnsCard
            who="The host"
            what="Owns the assembled session"
            detail="A bundle that points to every participant’s track, wherever they keep it. The host is the editor and publisher of the final episode — they can pull, mix, and ship — but the original tape still belongs to whoever recorded it."
            highlight
          />
          <OwnsCard
            who="Vessel"
            what="Owns nothing about your sessions"
            detail="We just run the matchmaking service. If we shut down tomorrow, every recording you have made still exists, exactly where you put it."
          />
        </div>
      </Section>

      {/* One-paragraph summary */}
      <Section
        eyebrow="If you only read one paragraph"
        title={
          <>
            The whole thing,{" "}
            <span className="text-vessel-accent">in a single breath.</span>
          </>
        }
      >
        <VesselCard className="relative p-8 sm:p-12 border-vessel-accent/30 bg-vessel-accent-glow overflow-hidden">
          <Quote
            size={48}
            className="absolute top-6 left-6 text-vessel-accent/20"
            aria-hidden="true"
          />
          <p className="relative font-display text-xl sm:text-2xl text-vessel-text-primary leading-snug tracking-tight pl-12">
            You sign in with a key only you have. You make a studio and invite a
            guest. While you talk, a lightweight preview is forwarded between
            you through a small preview server &mdash; but each of you is{" "}
            <em className="text-vessel-accent not-italic font-bold">also</em>{" "}
            recording yourselves at studio quality, on your own machine. When
            you stop, each browser ships its own high-quality file straight to
            the storage that{" "}
            <em className="text-vessel-accent not-italic font-bold">that
            person</em>{" "}
            chose. The host opens the editor and sees the session bundled
            together &mdash; pulled from wherever each track lives. Vessel
            handles invites and bookkeeping; never the audio. Each person owns
            their own tape.{" "}
            <span className="text-vessel-accent">The end.</span>
          </p>
        </VesselCard>
      </Section>

      {/* Footer CTA */}
      <section className="relative z-10 px-6 py-20 sm:py-24">
        <div className="max-w-3xl mx-auto text-center">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-60px" }}
            variants={fadeInUp}
          >
            <h2 className="font-display font-bold text-3xl sm:text-4xl tracking-tight leading-tight mb-4">
              Ready to make your first tape?
            </h2>
            <p className="text-vessel-text-secondary text-base sm:text-lg leading-relaxed max-w-xl mx-auto mb-10">
              No credit card. No subscription. No app to install on your guest&rsquo;s
              laptop. Open a studio in about ten seconds.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <VesselButton
                size="lg"
                onClick={goStart}
                data-testid="how-cta-start"
              >
                Create your free studio <ArrowRight size={18} className="ml-2" />
              </VesselButton>
              <VesselButton
                variant="ghost"
                size="lg"
                onClick={goPrivacy}
                data-testid="how-cta-privacy"
              >
                Read the privacy notice
              </VesselButton>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Page footer */}
      <footer className="relative z-10 py-12 px-6 border-t border-vessel-border bg-vessel-bg-base">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <VesselBrandIcon className="w-6 h-6 text-vessel-accent" />
            <span className="font-display font-bold text-base tracking-tight">
              Vessel
            </span>
            <div className="w-1 h-1 rounded-full bg-vessel-accent" />
          </div>
          <div className="flex flex-wrap justify-center gap-6 text-sm text-vessel-text-muted font-medium">
            <Link
              href="/privacy"
              className="hover:text-vessel-accent transition-colors"
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              className="hover:text-vessel-accent transition-colors"
            >
              Terms
            </Link>
            <a
              href="https://github.com/megistusXYZ/Remote-Record-Studio"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-vessel-accent transition-colors"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>
      </div>
    </HowItWorksContext.Provider>
  );
}
