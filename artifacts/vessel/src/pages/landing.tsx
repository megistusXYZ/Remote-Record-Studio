import * as React from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { useIdentity } from "../hooks/use-identity";
import { VesselButton } from "../components/vessel-ui/VesselButton";
import { VesselCard } from "../components/vessel-ui/VesselCard";
import { VesselBadge } from "../components/vessel-ui/VesselBadge";
import { AudioMeter } from "../components/vessel-ui/AudioMeter";
import { RecordingDot } from "../components/vessel-ui/RecordingDot";
import { SketchHost, SketchGuest } from "../components/vessel-ui/SketchConversation";
import { BackupKeySignInModal } from "../components/onboarding/BackupKeySignInModal";
import { Mic, Video, PhoneOff, Zap, Shield, Check, X, KeyRound } from "lucide-react";
import { SupportPersonIcon } from "../components/icons/SupportPersonIcon";
import { FilePersonIcon } from "../components/icons/FilePersonIcon";
import { LaptopPersonIcon } from "../components/icons/LaptopPersonIcon";
import { VesselBrandIcon } from "../components/icons/VesselBrandIcon";
import { SketchCircle } from "../components/icons/SketchCircle";

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const { displayName, isLoaded } = useIdentity();
  const [showBackupModal, setShowBackupModal] = React.useState(false);

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
    document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" });
  };

  const fadeInUp = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } }
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
          <KeyRound size={14} />
          <span>Sign in with backup key</span>
        </button>
      </header>

      {/* Hero Section */}
      <section className="relative z-10 flex flex-col items-center justify-center pt-12 pb-32 px-6">
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
              Sign in with your backup key
            </button>
          </motion.p>
        </motion.div>

        {/* Fake Studio Preview */}
        <motion.div 
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.6, ease: "easeOut" }}
          className="mt-20 w-full max-w-[900px] bg-vessel-bg-surface border border-vessel-border rounded-2xl shadow-2xl overflow-hidden"
        >
          <div className="flex justify-between items-center px-4 py-3 border-b border-vessel-border bg-vessel-bg-elevated/50">
            <div className="flex gap-2">
              <div className="w-3 h-3 rounded-full bg-vessel-border-strong" />
              <div className="w-3 h-3 rounded-full bg-vessel-border-strong" />
              <div className="w-3 h-3 rounded-full bg-vessel-border-strong" />
            </div>
            <RecordingDot showLabel />
          </div>
          
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="relative aspect-video rounded-xl border border-vessel-border overflow-hidden group">
              <SketchHost />
              <div className="absolute bottom-4 left-4 bg-vessel-bg-surface/85 backdrop-blur-md px-3 py-1.5 rounded-lg border border-vessel-border flex items-center gap-3">
                <span className="text-sm font-medium">Host</span>
                <AudioMeter active barCount={8} />
              </div>
            </div>
            
            <div className="relative aspect-video rounded-xl border border-vessel-border overflow-hidden">
              <SketchGuest />
              <div className="absolute bottom-4 left-4 bg-vessel-bg-surface/85 backdrop-blur-md px-3 py-1.5 rounded-lg border border-vessel-border flex items-center gap-3">
                <span className="text-sm font-medium">Guest</span>
                <AudioMeter active barCount={8} />
              </div>
            </div>
          </div>
          
          <div className="p-4 flex justify-center gap-4 border-t border-vessel-border bg-vessel-bg-elevated/30">
            <button className="w-12 h-12 rounded-full bg-vessel-bg-surface border border-vessel-border flex items-center justify-center text-vessel-text-primary hover:bg-vessel-bg-elevated">
              <Mic size={20} />
            </button>
            <button className="w-12 h-12 rounded-full bg-vessel-bg-surface border border-vessel-border flex items-center justify-center text-vessel-text-primary hover:bg-vessel-bg-elevated">
              <Video size={20} />
            </button>
            <button className="w-12 h-12 rounded-full bg-vessel-red hover:bg-red-500 flex items-center justify-center text-white shadow-lg shadow-vessel-red/20">
              <PhoneOff size={20} />
            </button>
          </div>
        </motion.div>
      </section>

      {/* Features Section */}
      <section id="features" className="relative z-10 py-24 px-6 bg-vessel-bg-surface/30">
        <div className="max-w-6xl mx-auto">
          <motion.div 
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-100px" }}
            variants={fadeInUp}
            className="text-center mb-16"
          >
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
                <h3 className="font-display font-bold text-xl mb-3">Permanently Yours</h3>
                <p className="text-sm text-vessel-text-secondary leading-relaxed">
                  Files are distributed directly to you, not stored on our servers. Your media stays yours even if Vessel disappeared tomorrow.
                </p>
              </VesselCard>
            </motion.div>
          </div>
        </div>
      </section>

      {/* How it Works */}
      <section id="how-it-works" className="relative z-10 py-32 px-6">
        <div className="max-w-6xl mx-auto">
          <motion.div 
            initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeInUp}
            className="text-center mb-20"
          >
            <h2 className="font-display text-4xl font-bold mb-4">Up and running in 60 seconds.</h2>
            <p className="text-vessel-text-secondary text-lg">No software to install. No account required for guests.</p>
          </motion.div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 relative">
            {/* Connecting line for desktop */}
            <div className="hidden md:block absolute top-12 left-1/6 right-1/6 h-[1px] border-t-2 border-dashed border-vessel-border-strong z-0" />
            
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
        </div>
      </section>

      {/* Comparison Table */}
      <section className="relative z-10 py-24 px-6 bg-vessel-bg-surface/30">
        <div className="max-w-4xl mx-auto">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeInUp}>
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
                          {row.zCheck && <Check size={16} className="text-vessel-text-muted" />}
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
      <section className="relative z-10 py-32 px-6 text-center border-t border-vessel-border">
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
              Sign in with your backup key
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
            <a href="#" className="hover:text-vessel-accent transition-colors">Privacy</a>
            <a href="#" className="hover:text-vessel-accent transition-colors">Terms</a>
            <a href="#" className="hover:text-vessel-accent transition-colors">GitHub</a>
          </div>
        </div>
        
        <div className="max-w-6xl mx-auto mt-12 pt-8 border-t border-vessel-border/30 text-center">
          <p className="text-xs text-vessel-text-muted/60">Built on open protocols. Your media never touches our servers.</p>
        </div>
      </footer>

      <BackupKeySignInModal
        open={showBackupModal}
        onOpenChange={setShowBackupModal}
        onSuccess={() => setLocation("/home")}
      />
    </div>
  );
}
