import * as React from "react";
import { motion, AnimatePresence, useInView } from "framer-motion";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  Check,
  RotateCcw,
} from "lucide-react";
import { AudioMeter } from "../vessel-ui/AudioMeter";
import { RecordingDot } from "../vessel-ui/RecordingDot";

/**
 * The studio, as it really looks, running on the landing page.
 *
 * Two beats, on a loop the visitor controls:
 *
 *   live   Two people in a session. Tiles are built the way the real room
 *          builds them (avatar when no camera, name chip, live meter,
 *          speaking ring), a recording timer runs, the controls work.
 *   saved  The visitor hangs up: the session ends and each person's files
 *          land in the vault, a 48 kHz WAV and a 1080p video per person,
 *          saved on their own device, nothing uploaded to Vessel.
 *
 * Media: each tile shows `public/hero/<host|guest>.jpg` as a still and, on
 * desktop with motion allowed and no data saver, plays two muted loops over
 * it: `<name>-talking.mp4` while that person holds the speaking ring and
 * `<name>-listening.mp4` otherwise, crossfading as the ring moves. Phones get the still; the ring, meters and
 * clock keep the demo alive. With no files present the tiles fall back to
 * the avatar the real room shows for a person without a camera. Specs and
 * the image prompts live in `docs/HERO-MEDIA.md`.
 */

/** True while the hero media are generated stand-ins rather than footage of
 *  real people. Shows a small "Illustration" note under the demo. Set false
 *  once real, consenting people replace them. */
const ILLUSTRATIVE_MEDIA = true;

type Person = {
  name: string;
  role: "Host" | "Guest";
  initials: string;
  hue: number;
  /** Path under public/ without extension: .jpg still, -talking.mp4 and
   *  -listening.mp4 loops. */
  media: string;
};

const PEOPLE: Person[] = [
  // Maya's room leans warm amber, Theo's cool teal: two places, one session.
  { name: "Maya", role: "Host", initials: "M", hue: 32, media: "hero/host" },
  { name: "Theo", role: "Guest", initials: "T", hue: 168, media: "hero/guest" },
];

const SPEAKER_SWAP_MS = 3800;
/** Bytes per second of a mono 48 kHz 24-bit WAV, for the saved-files beat. */
const WAV_BYTES_PER_SECOND = 48_000 * 3;
/** A 1080p camera file at about 5 Mbit/s. */
const VIDEO_BYTES_PER_SECOND = 625_000;
/** The take is already under way when the visitor arrives. */
const START_SECONDS = 23 * 60 + 41;

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatSize(bytes: number): string {
  return bytes >= 1_000_000_000
    ? `${(bytes / 1_000_000_000).toFixed(2)} GB`
    : `${Math.round(bytes / 1_000_000)} MB`;
}

/** Loops only where they are worth it: wide screens, motion allowed, and no
 *  data-saver. Everyone else gets the still frame. */
function useLoopsAllowed(reduceMotion: boolean | null): boolean {
  const [allowed, setAllowed] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(min-width: 640px)");
    const saveData =
      (navigator as Navigator & { connection?: { saveData?: boolean } })
        .connection?.saveData === true;
    const update = () => setAllowed(mq.matches && !reduceMotion && !saveData);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, [reduceMotion]);
  return allowed;
}

type HeroDemoProps = {
  reduceMotion: boolean | null;
};

export function HeroDemo({ reduceMotion }: HeroDemoProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const inView = useInView(rootRef, { margin: "-15% 0px -15% 0px" });

  const [phase, setPhase] = React.useState<"live" | "saved">("live");
  const [micOn, setMicOn] = React.useState(true);
  const [cameraOn, setCameraOn] = React.useState(true);
  const [speaker, setSpeaker] = React.useState(0);
  const [seconds, setSeconds] = React.useState(START_SECONDS);
  const loopsAllowed = useLoopsAllowed(reduceMotion);
  const [mediaShown, setMediaShown] = React.useState(false);
  const markMediaShown = React.useCallback(() => setMediaShown(true), []);
  const [takeSeconds, setTakeSeconds] = React.useState(0);

  // The recording clock and the speaker hand-off only run while the demo is
  // on screen, so the page stays calm when the visitor has scrolled past.
  const running = phase === "live" && inView;
  React.useEffect(() => {
    if (!running) return undefined;
    const clock = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(clock);
  }, [running]);
  React.useEffect(() => {
    if (!running || !micOn || reduceMotion) return undefined;
    setSpeaker(0);
    const id = window.setInterval(
      () => setSpeaker((s) => (s + 1) % PEOPLE.length),
      SPEAKER_SWAP_MS,
    );
    return () => window.clearInterval(id);
  }, [running, micOn, reduceMotion]);

  const hangUp = () => {
    setTakeSeconds(Math.max(seconds, 1));
    setPhase("saved");
  };
  const startAgain = () => {
    setSeconds(START_SECONDS);
    setPhase("live");
  };

  const fade = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, y: 10, scale: 0.985 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: -8, scale: 0.985 },
      };

  return (
    <div ref={rootRef} className="mt-16 sm:mt-20 w-full max-w-[900px]">
      <div className="bg-vessel-bg-surface border border-vessel-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Window chrome, the same strip the real studio shows. */}
        <div className="flex justify-between items-center px-4 py-3 border-b border-vessel-border bg-vessel-bg-elevated/50">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex gap-2 shrink-0">
              <div className="w-3 h-3 rounded-full bg-vessel-border-strong" />
              <div className="w-3 h-3 rounded-full bg-vessel-border-strong" />
              <div className="w-3 h-3 rounded-full bg-vessel-border-strong" />
            </div>
            <span className="text-xs text-vessel-text-muted truncate">
              Episode 12 · The future of audio
            </span>
          </div>
          {phase === "live" ? (
            <div className="flex items-center gap-3">
              <span
                className="font-mono-vessel text-[11px] text-vessel-text-secondary tabular-nums"
                aria-live="off"
              >
                {formatClock(seconds)}
              </span>
              <RecordingDot showLabel animated={!reduceMotion} />
            </div>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-vessel-accent">
              <Check size={12} aria-hidden="true" /> Saved
            </span>
          )}
        </div>

        <AnimatePresence initial={false} mode="wait">
          {phase === "live" ? (
            <motion.div
              key="live"
              {...fade}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                {PEOPLE.map((person, i) => (
                  <DemoTile
                    key={person.name}
                    person={person}
                    cameraOn={cameraOn}
                    micOn={micOn}
                    speaking={running && micOn && speaker === i}
                    reduceMotion={reduceMotion}
                    loopsAllowed={loopsAllowed}
                    onMediaShown={markMediaShown}
                  />
                ))}
              </div>
              <div className="p-4 flex justify-center gap-4 border-t border-vessel-border bg-vessel-bg-elevated/30">
                <DemoControlButton
                  label={micOn ? "Mute microphone" : "Unmute microphone"}
                  pressed={!micOn}
                  onClick={() => setMicOn((v) => !v)}
                  variant={micOn ? "neutral" : "off"}
                  testId="demo-mic"
                >
                  {micOn ? <Mic size={20} /> : <MicOff size={20} />}
                </DemoControlButton>
                <DemoControlButton
                  label={cameraOn ? "Turn camera off" : "Turn camera on"}
                  pressed={!cameraOn}
                  onClick={() => setCameraOn((v) => !v)}
                  variant={cameraOn ? "neutral" : "off"}
                  testId="demo-camera"
                >
                  {cameraOn ? <Video size={20} /> : <VideoOff size={20} />}
                </DemoControlButton>
                <DemoControlButton
                  label="End the session"
                  onClick={hangUp}
                  variant="hangup"
                  testId="demo-hangup"
                >
                  <PhoneOff size={20} />
                </DemoControlButton>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="saved"
              {...fade}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
              <SavedFiles seconds={takeSeconds} onStartAgain={startAgain} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {ILLUSTRATIVE_MEDIA && mediaShown && (
        <p
          className="mt-2 text-center text-[11px] text-vessel-text-muted"
          data-testid="hero-illustration-note"
        >
          Illustration. Maya and Theo are not real people.
        </p>
      )}
    </div>
  );
}

// ── Tiles ─────────────────────────────────────────────────────────────

type DemoTileProps = {
  person: Person;
  cameraOn: boolean;
  micOn: boolean;
  speaking: boolean;
  reduceMotion: boolean | null;
  loopsAllowed: boolean;
  onMediaShown: () => void;
};

function DemoTile({
  person,
  cameraOn,
  micOn,
  speaking,
  reduceMotion,
  loopsAllowed,
  onMediaShown,
}: DemoTileProps) {
  const base = `${import.meta.env.BASE_URL}${person.media}`;
  const [posterReady, setPosterReady] = React.useState(false);
  const [posterMissing, setPosterMissing] = React.useState(false);
  const [clipReady, setClipReady] = React.useState(false);
  const [clipMissing, setClipMissing] = React.useState(false);
  const showPoster = cameraOn && posterReady && !posterMissing;
  const showClip = cameraOn && loopsAllowed && clipReady && !clipMissing;
  const showMedia = showPoster || showClip;
  React.useEffect(() => {
    if (showMedia) onMediaShown();
  }, [showMedia, onMediaShown]);

  return (
    <motion.div
      className={`relative aspect-video rounded-xl overflow-hidden bg-vessel-bg-elevated border ${
        speaking ? "border-vessel-accent/70" : "border-vessel-border"
      } transition-colors duration-300`}
      animate={
        reduceMotion || !speaking
          ? { boxShadow: "0 0 0 0 rgba(0,212,170,0)" }
          : {
              boxShadow: [
                "0 0 0 0 rgba(0,212,170,0)",
                "0 0 22px 4px rgba(0,212,170,0.35)",
                "0 0 0 0 rgba(0,212,170,0)",
              ],
            }
      }
      transition={
        speaking && !reduceMotion
          ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" }
          : { duration: 0.4 }
      }
    >
      {/* Still frame: every screen. */}
      {cameraOn && !posterMissing && (
        <img
          src={`${base}.jpg`}
          alt=""
          aria-hidden="true"
          decoding="async"
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
            showPoster ? "opacity-100" : "opacity-0"
          }`}
          onLoad={() => setPosterReady(true)}
          onError={() => setPosterMissing(true)}
        />
      )}

      {/* Loops over it: desktop, motion allowed, no data saver. Both play
          all the time so the swap is instant; the speaker's clip shows. */}
      {cameraOn &&
        loopsAllowed &&
        !clipMissing &&
        (["listening", "talking"] as const).map((take) => (
          <video
            key={take}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${
              showClip && (take === "talking") === speaking
                ? "opacity-100"
                : "opacity-0"
            }`}
            src={`${base}-${take}.mp4`}
            muted
            loop
            playsInline
            autoPlay
            preload="auto"
            onCanPlay={
              take === "listening" ? () => setClipReady(true) : undefined
            }
            onError={() => setClipMissing(true)}
            aria-hidden="true"
          />
        ))}

      {/* No media: the tile exactly as the room shows a person without a camera. */}
      <AnimatePresence initial={false}>
        {!showMedia && (
          <motion.div
            key="avatar"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-vessel-bg-elevated to-vessel-bg-base"
          >
            <motion.div
              className="w-20 h-20 sm:w-24 sm:h-24 rounded-full flex items-center justify-center border-2"
              style={{
                background: `hsl(${person.hue} 55% 50% / 0.18)`,
                borderColor: `hsl(${person.hue} 60% 55% / 0.55)`,
                boxShadow: `0 10px 30px hsl(${person.hue} 60% 50% / 0.15)`,
              }}
              animate={
                speaking && !reduceMotion
                  ? { scale: [1, 1.05, 1] }
                  : { scale: 1 }
              }
              transition={
                speaking && !reduceMotion
                  ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" }
                  : { duration: 0.3 }
              }
            >
              <span
                className="font-display font-bold text-3xl sm:text-4xl"
                style={{ color: `hsl(${person.hue} 70% 62%)` }}
                aria-hidden="true"
              >
                {person.initials}
              </span>
            </motion.div>
            <span className="sr-only">
              {person.name}
              {cameraOn ? "" : ", camera off"}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className="absolute top-3 left-3 inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-vessel-bg-surface/80 border border-vessel-border backdrop-blur-md text-[10px] text-vessel-text-secondary z-10"
        title="Recording on this person's own device"
      >
        <span
          className="w-1.5 h-1.5 rounded-full bg-vessel-green"
          aria-label="Connection good"
        />
        <span>
          On device<span className="hidden sm:inline"> · 48 kHz</span>
        </span>
      </div>

      <AnimatePresence>
        {speaking && (
          <motion.div
            key="speaking"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="absolute top-3 right-3 inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-vessel-accent/20 border border-vessel-accent/60 backdrop-blur-md text-[10px] font-medium text-vessel-accent z-10"
            aria-hidden="true"
          >
            <motion.span
              className="w-1.5 h-1.5 rounded-full bg-vessel-accent"
              animate={reduceMotion ? undefined : { opacity: [0.4, 1, 0.4] }}
              transition={
                reduceMotion
                  ? undefined
                  : { duration: 1.1, repeat: Infinity, ease: "easeInOut" }
              }
            />
            Speaking
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className={`absolute bottom-3 left-3 bg-vessel-bg-surface/85 backdrop-blur-md px-3 py-1.5 rounded-lg border flex items-center gap-3 z-10 transition-colors duration-300 ${
          speaking ? "border-vessel-accent/60" : "border-vessel-border"
        }`}
      >
        <span className="text-sm font-medium">{person.name}</span>
        <span className="text-[10px] uppercase tracking-wider text-vessel-text-muted">
          {person.role}
        </span>
        {!micOn && (
          <MicOff
            size={14}
            className="text-vessel-red"
            aria-label="Microphone muted"
          />
        )}
        <AudioMeter
          active={micOn && speaking}
          animated={!reduceMotion}
          barCount={8}
        />
      </div>
    </motion.div>
  );
}

// ── Saved-files beat ───────────────────────────────────────────────────

function SavedFiles({
  seconds,
  onStartAgain,
}: {
  seconds: number;
  onStartAgain: () => void;
}) {
  const wavBytes = seconds * WAV_BYTES_PER_SECOND;
  const videoBytes = seconds * VIDEO_BYTES_PER_SECOND;
  return (
    <div className="p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div>
          <p className="font-display font-bold text-base">Session ended</p>
          <p className="text-xs text-vessel-text-muted">
            {formatClock(seconds)} recorded · each person's files are on their
            own device
          </p>
        </div>
      </div>
      <ul className="divide-y divide-vessel-border/60 rounded-xl border border-vessel-border bg-vessel-bg-elevated/60 overflow-hidden">
        {PEOPLE.map((person) => (
          <li key={person.name} className="flex items-center gap-3 px-4 py-3">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-display font-bold shrink-0"
              style={{
                background: `hsl(${person.hue} 55% 50% / 0.18)`,
                color: `hsl(${person.hue} 70% 62%)`,
              }}
              aria-hidden="true"
            >
              {person.initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{person.name}</p>
              <p className="text-xs text-vessel-text-muted truncate">
                {person.name.toLowerCase()}.wav · 48 kHz · 24-bit ·{" "}
                {formatSize(wavBytes)}
                <span className="hidden sm:inline">
                  {" "}
                  · {person.name.toLowerCase()}-camera.webm · 1080p ·{" "}
                  {formatSize(videoBytes)}
                </span>
              </p>
            </div>
            <span className="inline-flex items-center gap-1 text-xs text-vessel-accent shrink-0">
              <Check size={14} aria-hidden="true" />
              Saved
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-xs text-vessel-text-muted">
          Nothing was uploaded to Vessel. The host's vault lists both tracks.
        </p>
        <button
          type="button"
          onClick={onStartAgain}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-vessel-bg-surface border border-vessel-border text-sm font-medium hover:border-vessel-accent hover:text-vessel-accent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent"
          data-testid="demo-rejoin"
        >
          <RotateCcw size={14} aria-hidden="true" />
          Start another session
        </button>
      </div>
    </div>
  );
}

// ── Controls ──────────────────────────────────────────────────────────

type DemoControlButtonProps = {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  pressed?: boolean;
  variant?: "neutral" | "off" | "hangup";
  testId?: string;
};

function DemoControlButton({
  label,
  onClick,
  children,
  pressed,
  variant = "neutral",
  testId,
}: DemoControlButtonProps) {
  const tone =
    variant === "hangup"
      ? "bg-vessel-red text-white hover:bg-vessel-red/90 border-transparent"
      : variant === "off"
        ? "bg-vessel-red/15 text-vessel-red border-vessel-red/40 hover:bg-vessel-red/25"
        : "bg-vessel-bg-surface text-vessel-text-primary border-vessel-border hover:border-vessel-accent hover:text-vessel-accent";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={`w-12 h-12 rounded-full border flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent ${tone}`}
      data-testid={testId}
    >
      {children}
    </button>
  );
}
