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
 * No drawings of people and no stock faces: the point of the page is that
 * this is real software you can trust with your recordings. When real
 * footage exists, drop `hero/host.webm` and `hero/guest.webm` into
 * `public/`; the tiles play them (muted, looping) instead of the avatars.
 */

type Person = {
  name: string;
  role: "Host" | "Guest";
  initials: string;
  hue: number;
  clip: string;
};

const PEOPLE: Person[] = [
  {
    name: "Ben",
    role: "Host",
    initials: "B",
    hue: 168,
    clip: "hero/host.webm",
  },
  {
    name: "Sam",
    role: "Guest",
    initials: "S",
    hue: 24,
    clip: "hero/guest.webm",
  },
];

const SPEAKER_SWAP_MS = 3800;
/** Bytes per second of a mono 48 kHz 24-bit WAV, for the saved-files beat. */
const WAV_BYTES_PER_SECOND = 48_000 * 3;

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
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
  const [seconds, setSeconds] = React.useState(0);
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
    setSeconds(0);
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
};

function DemoTile({
  person,
  cameraOn,
  micOn,
  speaking,
  reduceMotion,
}: DemoTileProps) {
  const [clipReady, setClipReady] = React.useState(false);
  const [clipMissing, setClipMissing] = React.useState(false);
  const showClip = cameraOn && clipReady && !clipMissing;
  const clipSrc = `${import.meta.env.BASE_URL}${person.clip}`;

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
      {/* Real footage, when the operator has recorded some. */}
      {cameraOn && !clipMissing && (
        <video
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
            showClip ? "opacity-100" : "opacity-0"
          }`}
          src={clipSrc}
          muted
          loop
          playsInline
          autoPlay
          preload="metadata"
          onCanPlay={() => setClipReady(true)}
          onError={() => setClipMissing(true)}
          aria-hidden="true"
        />
      )}

      {/* Otherwise: the tile exactly as the room shows a person without a camera. */}
      <AnimatePresence initial={false}>
        {!showClip && (
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
                {formatMegabytes(wavBytes)}
                <span className="hidden sm:inline">
                  {" "}
                  · {person.name.toLowerCase()}-camera.webm · 1080p
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
