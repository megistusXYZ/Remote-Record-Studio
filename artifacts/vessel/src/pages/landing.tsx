import * as React from "react";
import { Link, useLocation } from "wouter";
import { motion, AnimatePresence, useReducedMotion, type Variants } from "framer-motion";
import { useIdentity } from "../hooks/use-identity";
import { VesselButton } from "../components/vessel-ui/VesselButton";
import { VesselCard } from "../components/vessel-ui/VesselCard";
import { VesselBadge } from "../components/vessel-ui/VesselBadge";
import { AudioMeter } from "../components/vessel-ui/AudioMeter";
import { RecordingDot } from "../components/vessel-ui/RecordingDot";
import { SketchHost, SketchGuest } from "../components/vessel-ui/SketchConversation";
import { BackupKeySignInModal } from "../components/onboarding/BackupKeySignInModal";
import { NostrSignInModal } from "../components/onboarding/NostrSignInModal";
import { Mic, MicOff, Video, VideoOff, PhoneOff, Check, X } from "lucide-react";
import { SupportPersonIcon } from "../components/icons/SupportPersonIcon";
import { FilePersonIcon } from "../components/icons/FilePersonIcon";
import { LaptopPersonIcon } from "../components/icons/LaptopPersonIcon";
import { VesselBrandIcon } from "../components/icons/VesselBrandIcon";
import { AimIcon } from "../components/icons/AimIcon";
import { PresentationIcon } from "../components/icons/PresentationIcon";
import { LampIcon } from "../components/icons/LampIcon";
import { SketchCircle } from "../components/icons/SketchCircle";
import { SketchLine } from "../components/icons/SketchLine";
import shipSketch from "@assets/Gemini_Generated_Image_b432cvb432cvb432_1777081786194.png";
import podcastSketch from "@assets/Gemini_Generated_Image_ptr74qptr74qptr7_1777075390674.png";
import pirateCrewSketch from "@assets/Gemini_Generated_Image_sctiuasctiuascti_1777089542804.png";
import seascapeSketch from "@assets/Gemini_Generated_Image_b0di8ib0di8ib0di_1777089861634.png";

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const { displayName, isLoaded } = useIdentity();
  const [showBackupModal, setShowBackupModal] = React.useState(false);
  const [showNostrModal, setShowNostrModal] = React.useState(false);

  // --- Interactive landing demo state (must run before any early return) ---
  const reduceMotion = useReducedMotion();
  const [cameraOn, setCameraOn] = React.useState(true);
  const [micOn, setMicOn] = React.useState(true);
  const [minimized, setMinimized] = React.useState(false);
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const lastWahRef = React.useRef(0);

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

  React.useEffect(() => {
    return () => {
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, []);

  // Play a brief Charlie-Brown-teacher style "wah-wah" — two pitched sweeps
  // through a low-pass filter. Generated from oscillators so we don't ship
  // any audio file and only fires on a real user click (autoplay-safe).
  const playWahWah = React.useCallback(() => {
    const now = Date.now();
    if (now - lastWahRef.current < 700) return;
    lastWahRef.current = now;

    try {
      if (!audioCtxRef.current) {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Ctx) return;
        audioCtxRef.current = new Ctx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }

      const t0 = ctx.currentTime;
      const playNote = (
        startOffset: number,
        freqStart: number,
        freqEnd: number,
        duration: number,
      ) => {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(freqStart, t0 + startOffset);
        osc.frequency.linearRampToValueAtTime(
          freqEnd,
          t0 + startOffset + duration,
        );

        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.Q.value = 6;
        filter.frequency.setValueAtTime(820, t0 + startOffset);
        filter.frequency.linearRampToValueAtTime(
          440,
          t0 + startOffset + duration,
        );

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, t0 + startOffset);
        gain.gain.exponentialRampToValueAtTime(
          0.16,
          t0 + startOffset + 0.04,
        );
        gain.gain.exponentialRampToValueAtTime(
          0.0001,
          t0 + startOffset + duration,
        );

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        osc.start(t0 + startOffset);
        osc.stop(t0 + startOffset + duration + 0.05);
      };

      // "Wah" then "wah" — second slightly higher, like the teacher's cadence.
      playNote(0, 196, 156, 0.26);
      playNote(0.3, 175, 220, 0.3);
    } catch {
      // Playful sound; failure must never block UI.
    }
  }, []);

  const handleMicToggle = () => {
    setMicOn((prev) => !prev);
    playWahWah();
  };
  const handleCameraToggle = () => setCameraOn((prev) => !prev);
  const handleHangUp = () => setMinimized(true);
  const handleRejoin = () => setMinimized(false);

  if (!isLoaded || displayName) {
    return null;
  }

  const navigateToStart = () => setLocation("/start");
  const openBackupSignIn = () => setShowBackupModal(true);
  const scrollToHowItWorks = () => {
    document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" });
  };

  const fadeInUp: Variants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } }
  };

  return (
    <div className="min-h-[100dvh] bg-vessel-bg-base text-vessel-text-primary selection:bg-vessel-accent/30 selection:text-vessel-accent overflow-x-hidden">
      {/* Background FX */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-0 left-0 w-[800px] h-[800px] bg-vessel-accent/5 rounded-full blur-[120px] -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute bottom-0 right-0 w-[600px] h-[600px] bg-vessel-accent/5 rounded-full blur-[100px] translate-x-1/3 translate-y-1/3" />
        <div 
          className="absolute inset-0 opacity-[0.03]" 
          style={{ backgroundImage: "url('data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.65%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E')" }}
        />
      </div>

      {/* Top Nav */}
      <header className="relative z-20 px-6 py-5 flex items-center justify-between max-w-6xl mx-auto w-full">
        <div className="flex items-center gap-2">
          <VesselBrandIcon className="w-7 h-7 text-vessel-accent" />
          <div className="flex items-baseline gap-1">
            <span className="font-display font-bold text-xl tracking-tight">Vessel</span>
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
          <span>Return to your studio</span>
        </button>
      </header>

      {/* Hero Section */}
      <section className="relative z-10 flex flex-col items-center justify-center pt-12 pb-32 px-6 overflow-hidden">
        <div
          className="absolute inset-x-0 top-0 h-[55%] pointer-events-none bg-no-repeat bg-contain opacity-[0.06]"
          style={{
            backgroundImage: `url(${podcastSketch})`,
            backgroundPosition: "center top",
            filter: "invert(1) grayscale(1)",
            maskImage: "radial-gradient(ellipse at 50% 35%, black 30%, transparent 75%)",
            WebkitMaskImage: "radial-gradient(ellipse at 50% 35%, black 30%, transparent 75%)",
          }}
          aria-hidden="true"
        />
        <motion.div 
          initial="hidden" 
          animate="visible" 
          variants={{
            hidden: { opacity: 0, y: 30 },
            visible: { opacity: 1, y: 0, transition: { staggerChildren: 0.2 } }
          }}
          className="text-center max-w-4xl mx-auto flex flex-col items-center"
        >
          <motion.div variants={fadeInUp}>
            <VesselBadge variant="accent" className="mb-8">
              Studio-quality remote recording
            </VesselBadge>
          </motion.div>
          
          <motion.h1 
            variants={fadeInUp}
            className="font-display font-bold text-5xl sm:text-6xl md:text-[72px] leading-[1.05] tracking-tight mb-6"
          >
            Record Like a Studio.<br />
            <span className="text-vessel-accent">Own It Like Never Before.</span>
          </motion.h1>
          
          <motion.p 
            variants={fadeInUp}
            className="text-lg md:text-xl text-vessel-text-secondary max-w-lg mb-10"
          >
            Vessel captures studio-quality audio and video from anywhere in the world. Your recordings go straight to you — no monthly fees, no cloud lock-in.
          </motion.p>
          
          <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
            <VesselButton size="lg" onClick={navigateToStart} data-testid="hero-cta-start">
              Create Your Free Studio &rarr;
            </VesselButton>
            <VesselButton variant="ghost" size="lg" onClick={scrollToHowItWorks} data-testid="hero-cta-how">
              See How It Works
            </VesselButton>
          </motion.div>
          
          <motion.p variants={fadeInUp} className="text-xs text-vessel-text-muted mt-6 space-x-4">
            <span>✓ No credit card required</span>
            <span className="hidden sm:inline">✓ No subscription fees</span>
            <span className="hidden sm:inline">✓ Works on any device</span>
          </motion.p>

          <motion.p variants={fadeInUp} className="text-sm text-vessel-text-muted mt-8">
            Already have a studio?{" "}
            <button
              type="button"
              onClick={openBackupSignIn}
              className="text-vessel-accent hover:underline focus:outline-none font-medium"
              data-testid="hero-cta-signin"
            >
              Return to it
            </button>
          </motion.p>
        </motion.div>

        {/* Fake Studio Preview — interactive demo */}
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.6, ease: "easeOut" }}
          className="mt-20 w-full max-w-[900px]"
        >
          <AnimatePresence initial={false} mode="wait">
            {!minimized ? (
              <motion.div
                key="studio-card"
                layout={!reduceMotion}
                initial={
                  reduceMotion
                    ? { opacity: 0 }
                    : { opacity: 0, scale: 0.96, y: 8 }
                }
                animate={
                  reduceMotion
                    ? { opacity: 1 }
                    : { opacity: 1, scale: 1, y: 0 }
                }
                exit={
                  reduceMotion
                    ? { opacity: 0 }
                    : { opacity: 0, scale: 0.92, y: -6 }
                }
                transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                className="bg-vessel-bg-surface border border-vessel-border rounded-2xl shadow-2xl overflow-hidden origin-top"
              >
                <div className="flex justify-between items-center px-4 py-3 border-b border-vessel-border bg-vessel-bg-elevated/50">
                  <div className="flex gap-2">
                    <div className="w-3 h-3 rounded-full bg-vessel-border-strong" />
                    <div className="w-3 h-3 rounded-full bg-vessel-border-strong" />
                    <div className="w-3 h-3 rounded-full bg-vessel-border-strong" />
                  </div>
                  <RecordingDot showLabel animated={!reduceMotion} />
                </div>

                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <ParticipantTile
                    role="Host"
                    initial="H"
                    cameraOn={cameraOn}
                    micOn={micOn}
                    reduceMotion={reduceMotion}
                  />
                  <ParticipantTile
                    role="Guest"
                    initial="G"
                    cameraOn={cameraOn}
                    micOn={micOn}
                    reduceMotion={reduceMotion}
                  />
                </div>

                <div className="p-4 flex justify-center gap-4 border-t border-vessel-border bg-vessel-bg-elevated/30">
                  <DemoControlButton
                    label={micOn ? "Mute microphone" : "Unmute microphone"}
                    pressed={!micOn}
                    onClick={handleMicToggle}
                    variant={micOn ? "neutral" : "off"}
                    testId="demo-mic"
                  >
                    {micOn ? <Mic size={20} /> : <MicOff size={20} />}
                  </DemoControlButton>
                  <DemoControlButton
                    label={cameraOn ? "Turn camera off" : "Turn camera on"}
                    pressed={!cameraOn}
                    onClick={handleCameraToggle}
                    variant={cameraOn ? "neutral" : "off"}
                    testId="demo-camera"
                  >
                    {cameraOn ? <Video size={20} /> : <VideoOff size={20} />}
                  </DemoControlButton>
                  <DemoControlButton
                    label="Leave the studio"
                    onClick={handleHangUp}
                    variant="hangup"
                    testId="demo-hangup"
                  >
                    <PhoneOff size={20} />
                  </DemoControlButton>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="studio-pill"
                initial={
                  reduceMotion
                    ? { opacity: 0 }
                    : { opacity: 0, scale: 0.85, y: -8 }
                }
                animate={
                  reduceMotion
                    ? { opacity: 1 }
                    : { opacity: 1, scale: 1, y: 0 }
                }
                exit={
                  reduceMotion
                    ? { opacity: 0 }
                    : { opacity: 0, scale: 0.85, y: 8 }
                }
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                className="flex justify-center py-6"
              >
                <button
                  type="button"
                  onClick={handleRejoin}
                  className="group inline-flex items-center gap-3 px-5 py-3 rounded-full bg-vessel-bg-surface border border-vessel-border shadow-lg hover:border-vessel-accent hover:shadow-vessel-accent/20 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent"
                  aria-label="Rejoin the studio preview"
                  data-testid="demo-rejoin"
                >
                  <RecordingDot />
                  <span className="text-sm font-medium text-vessel-text-primary">
                    Rejoin studio
                  </span>
                  <span
                    className="text-xs text-vessel-text-muted group-hover:text-vessel-accent transition-colors"
                    aria-hidden="true"
                  >
                    ↺
                  </span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </section>

      {/* Features Section */}
      <section id="features" className="relative z-10 py-24 px-6 bg-vessel-bg-surface/30 overflow-hidden">
        <div className="relative z-10 max-w-6xl mx-auto">
          <motion.div 
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-100px" }}
            variants={fadeInUp}
            className="text-center mb-16"
          >
            <div className="flex justify-center mb-6">
              <LampIcon
                className="w-14 h-14 text-vessel-accent"
                aria-hidden="true"
              />
            </div>
            <h2 className="font-display text-3xl md:text-4xl font-bold">
              Everything your studio needs.<br />Nothing it doesn't.
            </h2>
          </motion.div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeInUp}>
              <VesselCard variant="interactive" className="p-8 h-full">
                <SupportPersonIcon className="w-12 h-12 text-vessel-accent mb-6" />
                <h3 className="font-display font-bold text-xl mb-3">Lossless Local Recording</h3>
                <p className="text-sm text-vessel-text-secondary leading-relaxed">
                  Every participant records directly on their device at full quality — not a compressed video call screengrab.
                </p>
              </VesselCard>
            </motion.div>
            
            <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeInUp} transition={{ delay: 0.1 }}>
              <VesselCard variant="interactive" className="p-8 h-full">
                <FilePersonIcon className="w-12 h-12 text-vessel-accent mb-6" />
                <h3 className="font-display font-bold text-xl mb-3">Files the Moment You Stop</h3>
                <p className="text-sm text-vessel-text-secondary leading-relaxed">
                  Your recordings land in your vault the instant the session ends. No processing queue, no waiting for an email.
                </p>
              </VesselCard>
            </motion.div>
            
            <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeInUp} transition={{ delay: 0.2 }}>
              <VesselCard variant="interactive" className="p-8 h-full">
                <LaptopPersonIcon className="w-12 h-12 text-vessel-accent mb-6" />
                <h3 className="font-display font-bold text-xl mb-3">You Pick Where Files Live</h3>
                <p className="text-sm text-vessel-text-secondary leading-relaxed">
                  Send recordings to the community default server or one you control — never to ours. Your media stays yours even if Vessel disappeared tomorrow.
                </p>
              </VesselCard>
            </motion.div>
          </div>
        </div>
      </section>

      {/* How it Works */}
      <section id="how-it-works" className="relative z-10 py-32 px-6 overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none bg-center bg-no-repeat bg-cover opacity-[0.07]"
          style={{
            backgroundImage: `url(${seascapeSketch})`,
            filter: "invert(1) grayscale(1)",
            maskImage: "radial-gradient(ellipse at center, black 45%, transparent 80%)",
            WebkitMaskImage: "radial-gradient(ellipse at center, black 45%, transparent 80%)",
          }}
          aria-hidden="true"
        />
        <div className="relative z-10 max-w-6xl mx-auto">
          <motion.div 
            initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeInUp}
            className="text-center mb-20"
          >
            <h2 className="font-display text-4xl font-bold mb-4">Up and running in 60 seconds.</h2>
            <p className="text-vessel-text-secondary text-lg">No software to install. No account required for guests.</p>
          </motion.div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 relative">
            {[
              { num: "1", title: "Create your studio", desc: "Sign up in 10 seconds. Just a name — no credit card, no app download." },
              { num: "2", title: "Invite your guests", desc: "Share a link. They join in one click. Nothing to install on their end." },
              { num: "3", title: "Your files, instantly", desc: "Everyone's track downloads separately in studio quality the moment you stop." }
            ].map((step, i) => (
              <motion.div 
                key={step.num}
                initial="hidden" whileInView="visible" viewport={{ once: true }} 
                variants={{
                  hidden: { opacity: 0, y: 20 },
                  visible: { opacity: 1, y: 0, transition: { delay: i * 0.2, duration: 0.5 } }
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
                <h3 className="font-display font-bold text-xl mb-3">{step.title}</h3>
                <p className="text-sm text-vessel-text-secondary">{step.desc}</p>
              </motion.div>
            ))}
          </div>

          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }} variants={fadeInUp}
            className="mt-20 text-center"
          >
            <p className="text-sm text-vessel-text-muted mb-5">Want the deeper version, in plain English?</p>
            <Link
              href="/how-it-works"
              className="group inline-flex items-center gap-2 px-6 py-3 rounded-full bg-vessel-bg-surface border border-vessel-border text-sm font-medium text-vessel-text-primary hover:border-vessel-accent hover:text-vessel-accent hover:shadow-lg hover:shadow-vessel-accent/10 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent"
              data-testid="link-how-it-works"
            >
              <span>Read the deeper version</span>
              <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">&rarr;</span>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Comparison Table */}
      <section className="relative z-10 py-24 px-6 bg-vessel-bg-surface/30">
        <div className="max-w-4xl mx-auto">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeInUp}>
            <div className="flex flex-col items-center mb-6">
              <PresentationIcon
                className="w-14 h-14 text-vessel-accent"
                aria-hidden="true"
              />
            </div>
            <h2 className="font-display text-3xl font-bold mb-12 text-center">How Vessel stacks up.</h2>
            
            <div className="overflow-x-auto rounded-2xl border border-vessel-border bg-vessel-bg-elevated/50 backdrop-blur-sm">
              <table className="w-full text-left border-collapse min-w-[600px]">
                <thead>
                  <tr className="border-b border-vessel-border">
                    <th className="p-6 font-medium text-vessel-text-secondary w-1/3">Feature</th>
                    <th className="p-6 font-display font-bold text-vessel-accent text-lg w-1/5">Vessel</th>
                    <th className="p-6 font-medium text-vessel-text-secondary w-1/5">Riverside.fm</th>
                    <th className="p-6 font-medium text-vessel-text-secondary w-1/5">Zoom</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-vessel-border/50 text-sm">
                  {[
                    { label: "Local recording quality", v: "Lossless", r: "Lossless", z: "Compressed" },
                    { label: "Monthly cost", v: "Free", r: "$15–$100/mo", z: "$15–$20/mo" },
                    { label: "You own your files", v: "Always", r: "Platform-stored", z: "Platform-stored" },
                    { label: "You pick where files live", v: "Yes", vCheck: true, r: "No", rCross: true, z: "No", zCross: true },
                    { label: "Guests need an account", v: "No", vCheck: true, r: "Yes", rCross: true, z: "Yes", zCross: true },
                    { label: "Works on spotty wi-fi", v: "Yes", vCheck: true, r: "Yes", rCheck: true, z: "No", zCross: true }
                  ].map((row, i) => (
                    <tr key={i} className="hover:bg-vessel-bg-surface/50 transition-colors">
                      <td className="p-6 font-medium text-vessel-text-primary">{row.label}</td>
                      <td className="p-6 text-vessel-accent font-medium flex items-center gap-2">
                        {row.vCheck && <Check size={16} />}
                        {row.v}
                      </td>
                      <td className="p-6 text-vessel-text-secondary">
                        <span className="flex items-center gap-2">
                          {row.rCross && <X size={16} className="text-vessel-red/70" />}
                          {row.rCheck && <Check size={16} className="text-vessel-text-muted" />}
                          {row.r}
                        </span>
                      </td>
                      <td className="p-6 text-vessel-text-secondary">
                        <span className="flex items-center gap-2">
                          {row.zCross && <X size={16} className="text-vessel-red/70" />}
                          {row.z}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        </div>
      </section>

      {/* CTA Section */}
      <section id="cta" className="relative z-10 py-32 px-6 text-center border-t border-vessel-border overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none bg-center bg-no-repeat bg-contain opacity-[0.07]"
          style={{
            backgroundImage: `url(${shipSketch})`,
            filter: "invert(1) grayscale(1)",
            maskImage: "radial-gradient(ellipse at center, black 40%, transparent 78%)",
            WebkitMaskImage: "radial-gradient(ellipse at center, black 40%, transparent 78%)",
          }}
          aria-hidden="true"
        />
        <div className="absolute inset-0 bg-vessel-accent/5 pointer-events-none" />
        <motion.div 
          initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeInUp}
          className="relative max-w-2xl mx-auto"
        >
          <h2 className="font-display text-4xl md:text-5xl font-bold mb-6">Your studio is waiting.</h2>
          <p className="text-xl text-vessel-text-secondary mb-10">Start recording in under a minute.</p>
          <VesselButton size="lg" onClick={navigateToStart} className="mb-6 w-full sm:w-auto" data-testid="footer-cta-start">
            Create Your Free Studio &rarr;
          </VesselButton>
          <p className="text-xs text-vessel-text-muted font-medium">No credit card. No subscription. Free forever.</p>
          <p className="text-sm text-vessel-text-muted mt-8">
            Coming back to your studio?{" "}
            <button
              type="button"
              onClick={openBackupSignIn}
              className="text-vessel-accent hover:underline focus:outline-none font-medium"
              data-testid="footer-cta-signin"
            >
              Step back in
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
                <span className="font-display font-bold text-2xl tracking-tight">Vessel</span>
                <div className="w-1.5 h-1.5 rounded-full bg-vessel-accent" />
              </div>
            </div>
            <p className="text-xs text-vessel-text-secondary">Studio-quality recordings, delivered straight to you.</p>
          </div>
          
          <div className="flex flex-wrap justify-center gap-6 text-sm text-vessel-text-muted font-medium">
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
          </div>
        </div>
        
        <div className="max-w-6xl mx-auto mt-12 pt-8 border-t border-vessel-border/30 text-center">
          <p className="text-xs text-vessel-text-muted/60">
            Built on open protocols. Yours from mic to file.
          </p>
        </div>
      </footer>

      <BackupKeySignInModal
        open={showBackupModal}
        onOpenChange={setShowBackupModal}
        onSuccess={() => setLocation("/home")}
        onUseNostr={() => {
          setShowBackupModal(false);
          setShowNostrModal(true);
        }}
      />

      <NostrSignInModal
        open={showNostrModal}
        onOpenChange={setShowNostrModal}
        onSuccess={() => setLocation("/home")}
        onUseBackupKey={() => {
          setShowNostrModal(false);
          setShowBackupModal(true);
        }}
      />
    </div>
  );
}

// --- Landing demo helpers ---

interface ParticipantTileProps {
  role: "Host" | "Guest";
  initial: string;
  cameraOn: boolean;
  micOn: boolean;
  reduceMotion: boolean | null;
}

function ParticipantTile({
  role,
  initial,
  cameraOn,
  micOn,
  reduceMotion,
}: ParticipantTileProps) {
  const isHost = role === "Host";
  return (
    <div className="relative aspect-video rounded-xl border border-vessel-border overflow-hidden bg-vessel-bg-elevated">
      <AnimatePresence initial={false} mode="wait">
        {cameraOn ? (
          <motion.div
            key="video"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 1.02 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="absolute inset-0"
          >
            {isHost ? <SketchHost /> : <SketchGuest />}
          </motion.div>
        ) : (
          <motion.div
            key="avatar"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-vessel-bg-elevated to-vessel-bg-base"
          >
            <div className="flex flex-col items-center gap-2">
              <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-vessel-accent/15 border-2 border-vessel-accent/40 flex items-center justify-center shadow-lg shadow-vessel-accent/10">
                <span
                  className="font-display font-bold text-3xl sm:text-4xl text-vessel-accent"
                  aria-hidden="true"
                >
                  {initial}
                </span>
              </div>
              <span className="sr-only">{role}'s camera is off</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute bottom-4 left-4 bg-vessel-bg-surface/85 backdrop-blur-md px-3 py-1.5 rounded-lg border border-vessel-border flex items-center gap-3 z-10">
        <span className="text-sm font-medium">{role}</span>
        {!micOn && (
          <MicOff
            size={14}
            className="text-vessel-red"
            aria-label="Microphone muted"
          />
        )}
        <AudioMeter active={micOn} barCount={8} />
      </div>
    </div>
  );
}

interface DemoControlButtonProps {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  pressed?: boolean;
  variant?: "neutral" | "off" | "hangup";
  testId?: string;
}

function DemoControlButton({
  label,
  onClick,
  children,
  pressed,
  variant = "neutral",
  testId,
}: DemoControlButtonProps) {
  const base =
    "w-12 h-12 rounded-full flex items-center justify-center transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent focus-visible:ring-offset-2 focus-visible:ring-offset-vessel-bg-elevated active:scale-95";
  const styles =
    variant === "hangup"
      ? "bg-vessel-red hover:bg-red-500 text-white shadow-lg shadow-vessel-red/20"
      : variant === "off"
        ? "bg-vessel-red/15 border border-vessel-red/50 text-vessel-red hover:bg-vessel-red/25"
        : "bg-vessel-bg-surface border border-vessel-border text-vessel-text-primary hover:bg-vessel-bg-elevated hover:border-vessel-border-strong";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      data-testid={testId}
      className={`${base} ${styles}`}
    >
      {children}
    </button>
  );
}
