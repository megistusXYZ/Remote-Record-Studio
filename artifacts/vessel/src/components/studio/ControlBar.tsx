import { Settings, Mic, MicOff, Video as VideoIcon, VideoOff, Users, Hand, MonitorUp, MonitorOff, UserPlus } from "lucide-react";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { VesselButton } from "../vessel-ui/VesselButton";
import { DevicePickerPopover } from "./DevicePickerPopover";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import type { MediaDevice } from "../../hooks/use-media-devices";

export type ControlBarProps = {
  micEnabled: boolean;
  onToggleMic: () => void;
  cameraEnabled: boolean;
  onToggleCamera: () => void;
  isRecording: boolean;
  recordingSeconds: number;
  isHost: boolean;
  isStartingRecording?: boolean;
  isStoppingRecording?: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onOpenInvite: () => void;
  onLeave: () => void;
  cameras: MediaDevice[];
  microphones: MediaDevice[];
  selectedCameraId: string | null;
  selectedMicId: string | null;
  onSelectCamera: (id: string) => void;
  onSelectMic: (id: string) => void;
  previewStream?: MediaStream | null;
  /** Roster sidepanel toggle. When omitted the button is hidden. */
  rosterOpen?: boolean;
  onToggleRoster?: () => void;
  /** Number of participants on the call (host + guests). Drives the badge. */
  rosterCount?: number;
  /** Number of raised hands among other participants — surfaced as an
   *  attention-grabbing accent on the roster button. */
  raisedHandsCount?: number;
  /** Local raise-hand state (host AND guests). */
  handRaised?: boolean;
  onToggleHand?: () => void;
  /** Screen-share controls. The button is hidden entirely when
   *  `screenShareSupported` is false (mobile / unsupported browsers).
   *  When omitted, the button is also hidden — keeps the control bar
   *  unchanged for callers that haven't opted into the feature yet. */
  screenShareSupported?: boolean;
  isScreenSharing?: boolean;
  onToggleScreenShare?: () => void;
};

function formatSeconds(s: number): string {
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;

  const mmss = `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  if (hrs > 0) return `${hrs.toString().padStart(2, "0")}:${mmss}`;
  return mmss;
}

export function ControlBar({
  micEnabled,
  onToggleMic,
  cameraEnabled,
  onToggleCamera,
  isRecording,
  recordingSeconds,
  isHost,
  isStartingRecording,
  isStoppingRecording,
  onStartRecording,
  onStopRecording,
  onOpenInvite,
  onLeave,
  cameras,
  microphones,
  selectedCameraId,
  selectedMicId,
  onSelectCamera,
  onSelectMic,
  previewStream,
  rosterOpen,
  onToggleRoster,
  rosterCount,
  raisedHandsCount = 0,
  handRaised = false,
  onToggleHand,
  screenShareSupported = false,
  isScreenSharing = false,
  onToggleScreenShare,
}: ControlBarProps) {
  const handleLeave = () => {
    if (window.confirm("Leave this session?")) {
      onLeave();
    }
  };

  const isRecordingLoading = isStartingRecording || isStoppingRecording;

  return (
    <TooltipProvider>
      <div
        // overflow-x-auto is the safety net for sub-390px viewports
        // (iPhone SE 1st gen and a handful of small Androids): the
        // three flex-1 groups can collectively demand more than the
        // viewport width once every optional control (hand,
        // screen-share substitute) is on screen. Rather
        // than clip the Leave button or fight intrinsic sizes, we
        // let the bar scroll horizontally as a graceful fallback.
        // [&::-webkit-scrollbar]:hidden hides the scroll-track so
        // the mobile bar still looks like a cohesive control strip.
        className="fixed bottom-0 left-0 right-0 min-h-20 bg-vessel-bg-base/80 backdrop-blur-xl border-t border-vessel-border flex items-center justify-between px-3 sm:px-6 pb-[env(safe-area-inset-bottom)] z-30 overflow-x-auto sm:overflow-x-visible [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {/* Left Group */}
        <div className="flex-1 flex items-center justify-start">
          <Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <button
                    data-testid="button-open-devices"
                    className="w-10 h-10 rounded-full bg-vessel-bg-surface hover:bg-vessel-bg-elevated border border-vessel-border flex items-center justify-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent"
                  >
                    <Settings className="w-5 h-5 text-vessel-text-secondary" />
                  </button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent>Device Settings</TooltipContent>
            </Tooltip>
            <DevicePickerPopover
              cameras={cameras}
              microphones={microphones}
              selectedCameraId={selectedCameraId}
              selectedMicId={selectedMicId}
              onSelectCamera={onSelectCamera}
              onSelectMic={onSelectMic}
              previewStream={previewStream}
            />
          </Popover>
        </div>

        {/* Center Group — gap tightens on mobile so the row of primary
            controls (mic / record / camera / hand) fits a
            375px-wide phone without overflowing the side groups. */}
        <div className="flex-1 flex items-center gap-2 sm:gap-3 justify-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                data-testid="button-toggle-mic"
                onClick={onToggleMic}
                className={cn(
                  "w-12 h-12 sm:w-14 sm:h-14 rounded-full border transition-all flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent",
                  micEnabled
                    ? "bg-vessel-bg-surface border-vessel-border hover:bg-vessel-bg-elevated text-vessel-text-primary"
                    : "bg-vessel-red/20 border-vessel-red/40 text-vessel-red"
                )}
              >
                {micEnabled ? <Mic className="w-5 h-5 sm:w-6 sm:h-6" /> : <MicOff className="w-5 h-5 sm:w-6 sm:h-6" />}
              </button>
            </TooltipTrigger>
            <TooltipContent>{micEnabled ? "Mute microphone" : "Unmute microphone"}</TooltipContent>
          </Tooltip>

          {isHost && (
            <div className="relative flex flex-col items-center justify-center w-[68px] h-[68px]">
              <motion.button
                layout
                data-testid="button-record"
                disabled={isRecordingLoading}
                onClick={isRecording ? onStopRecording : onStartRecording}
                className={cn(
                  "absolute inset-0 rounded-full flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent focus-visible:ring-offset-2 focus-visible:ring-offset-vessel-bg-base z-10 disabled:opacity-70 disabled:cursor-not-allowed",
                  isRecording
                    ? "bg-vessel-red text-white shadow-[0_0_30px_rgba(255,71,87,0.4)] hover:brightness-110"
                    : "bg-vessel-accent text-white shadow-[0_0_30px_rgba(0,212,170,0.4)] hover:scale-105 hover:bg-vessel-accent-dim"
                )}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              >
                {isRecordingLoading ? (
                  <div className="w-6 h-6 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                ) : (
                  <motion.div
                    layoutId="record-icon"
                    className={cn(
                      "bg-white",
                      isRecording ? "w-5 h-5 rounded-sm" : "w-6 h-6 rounded-full"
                    )}
                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  />
                )}
              </motion.button>

              <AnimatePresence>
                {isRecording && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute -top-1.5 -inset-x-2 -bottom-1.5 rounded-full border border-vessel-red/30 animate-[pulse_2s_infinite] pointer-events-none"
                  />
                )}
              </AnimatePresence>

              <div className="absolute -bottom-6 whitespace-nowrap text-xs font-mono-vessel text-vessel-text-secondary font-medium tracking-wide">
                {isRecording ? `Stop · ${formatSeconds(recordingSeconds)}` : "Record"}
              </div>
            </div>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                data-testid="button-toggle-camera"
                onClick={onToggleCamera}
                className={cn(
                  "w-12 h-12 sm:w-14 sm:h-14 rounded-full border transition-all flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent",
                  cameraEnabled
                    ? "bg-vessel-bg-surface border-vessel-border hover:bg-vessel-bg-elevated text-vessel-text-primary"
                    : "bg-vessel-red/20 border-vessel-red/40 text-vessel-red"
                )}
              >
                {cameraEnabled ? <VideoIcon className="w-5 h-5 sm:w-6 sm:h-6" /> : <VideoOff className="w-5 h-5 sm:w-6 sm:h-6" />}
              </button>
            </TooltipTrigger>
            <TooltipContent>{cameraEnabled ? "Turn off camera" : "Turn on camera"}</TooltipContent>
          </Tooltip>

          {/* Raise hand — open to host AND guests. Accent fills the icon when
              the hand is up. Press H elsewhere to toggle the same state. */}
          {onToggleHand && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  data-testid="button-toggle-hand"
                  onClick={onToggleHand}
                  aria-pressed={handRaised}
                  aria-label={handRaised ? "Lower hand" : "Raise hand"}
                  className={cn(
                    "w-12 h-12 sm:w-14 sm:h-14 rounded-full border transition-all flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent",
                    handRaised
                      ? "bg-vessel-accent/20 border-vessel-accent/50 text-vessel-accent shadow-[0_0_20px_rgba(0,212,170,0.25)]"
                      : "bg-vessel-bg-surface border-vessel-border hover:bg-vessel-bg-elevated text-vessel-text-primary",
                  )}
                >
                  <Hand className="w-5 h-5 sm:w-6 sm:h-6" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{handRaised ? "Lower hand (H)" : "Raise hand (H)"}</TooltipContent>
            </Tooltip>
          )}


          {/* Share screen — desktop only. Hidden on mobile / tablet via the
              `hidden md:flex` wrapper since browser screen-share APIs aren't
              reliable on touch devices. The accent ring fills when sharing. */}
          {onToggleScreenShare && screenShareSupported && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  data-testid="button-toggle-screen-share"
                  onClick={onToggleScreenShare}
                  aria-pressed={isScreenSharing}
                  aria-label={isScreenSharing ? "Stop sharing screen" : "Share screen"}
                  className={cn(
                    "hidden md:flex w-14 h-14 rounded-full border transition-all items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent",
                    isScreenSharing
                      ? "bg-vessel-accent/20 border-vessel-accent/50 text-vessel-accent shadow-[0_0_20px_rgba(0,212,170,0.25)]"
                      : "bg-vessel-bg-surface border-vessel-border hover:bg-vessel-bg-elevated text-vessel-text-primary",
                  )}
                >
                  {isScreenSharing ? (
                    <MonitorOff className="w-6 h-6" />
                  ) : (
                    <MonitorUp className="w-6 h-6" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {isScreenSharing ? "Stop sharing screen" : "Share screen"}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Right Group */}
        <div className="flex-1 flex items-center gap-2 justify-end">
          {onToggleRoster && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onToggleRoster}
                  aria-pressed={!!rosterOpen}
                  aria-label={rosterOpen ? "Close room panel" : "Open room panel"}
                  data-testid="button-toggle-roster"
                  className={cn(
                    "relative w-10 h-10 rounded-full border flex items-center justify-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent",
                    rosterOpen
                      ? "bg-vessel-accent/15 border-vessel-accent/40 text-vessel-accent"
                      : "bg-vessel-bg-surface border-vessel-border hover:bg-vessel-bg-elevated text-vessel-text-secondary",
                  )}
                >
                  <Users className="w-4 h-4" />
                  {typeof rosterCount === "number" && rosterCount > 0 && (
                    <span
                      className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-vessel-bg-base border border-vessel-border text-[10px] font-mono-vessel text-vessel-text-primary flex items-center justify-center"
                      data-testid="badge-roster-count"
                    >
                      {rosterCount}
                    </span>
                  )}
                  {raisedHandsCount > 0 && (
                    <span className="absolute -bottom-1 -right-1 w-4 h-4 pointer-events-none">
                      {/* Subtle ping ring keeps the badge feeling "live"
                          and draws the eye even when the floating
                          notification pill is hidden (e.g. while the
                          room panel is open). */}
                      <span className="absolute inset-0 rounded-full bg-vessel-amber/50 animate-ping" />
                      <span
                        className="relative w-4 h-4 rounded-full bg-vessel-amber border border-vessel-bg-base flex items-center justify-center"
                        data-testid="badge-raised-hands"
                        aria-label={`${raisedHandsCount} hand${raisedHandsCount === 1 ? "" : "s"} raised`}
                      >
                        <Hand className="w-2.5 h-2.5 text-vessel-bg-base" />
                      </span>
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {rosterOpen ? "Close room panel" : "Open room panel"}
              </TooltipContent>
            </Tooltip>
          )}
          {/* Mobile: icon-only so the action is reachable without leaving
              the call. Desktop: full label for clarity. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <VesselButton
                variant="ghost"
                size="sm"
                onClick={onOpenInvite}
                data-testid="button-invite-from-studio"
                aria-label="Invite guests"
                className="px-2.5 sm:px-3"
              >
                <UserPlus className="w-4 h-4 sm:mr-1.5" />
                <span className="hidden sm:inline">Invite</span>
              </VesselButton>
            </TooltipTrigger>
            <TooltipContent>Invite guests</TooltipContent>
          </Tooltip>
          <VesselButton
            variant="ghost"
            size="sm"
            onClick={handleLeave}
            data-testid="button-leave-studio"
            className="hover:text-vessel-red hover:border-vessel-red/40 hover:bg-vessel-red/10"
          >
            Leave
          </VesselButton>
        </div>
      </div>
    </TooltipProvider>
  );
}
