import { Settings, Mic, MicOff, Video as VideoIcon, VideoOff } from "lucide-react";
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
}: ControlBarProps) {
  const handleLeave = () => {
    if (window.confirm("Leave this session?")) {
      onLeave();
    }
  };

  const isRecordingLoading = isStartingRecording || isStoppingRecording;

  return (
    <TooltipProvider>
      <div className="fixed bottom-0 left-0 right-0 h-20 bg-vessel-bg-base/80 backdrop-blur-xl border-t border-vessel-border flex items-center justify-between px-4 sm:px-6 z-30">
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

        {/* Center Group */}
        <div className="flex-1 flex items-center gap-3 justify-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                data-testid="button-toggle-mic"
                onClick={onToggleMic}
                className={cn(
                  "w-14 h-14 rounded-full border transition-all flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent",
                  micEnabled
                    ? "bg-vessel-bg-surface border-vessel-border hover:bg-vessel-bg-elevated text-vessel-text-primary"
                    : "bg-vessel-red/20 border-vessel-red/40 text-vessel-red"
                )}
              >
                {micEnabled ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
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
                  "w-14 h-14 rounded-full border transition-all flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent",
                  cameraEnabled
                    ? "bg-vessel-bg-surface border-vessel-border hover:bg-vessel-bg-elevated text-vessel-text-primary"
                    : "bg-vessel-red/20 border-vessel-red/40 text-vessel-red"
                )}
              >
                {cameraEnabled ? <VideoIcon className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
              </button>
            </TooltipTrigger>
            <TooltipContent>{cameraEnabled ? "Turn off camera" : "Turn on camera"}</TooltipContent>
          </Tooltip>
        </div>

        {/* Right Group */}
        <div className="flex-1 flex items-center gap-2 justify-end">
          <VesselButton
            variant="ghost"
            size="sm"
            onClick={onOpenInvite}
            data-testid="button-invite-from-studio"
            className="hidden sm:inline-flex"
          >
            Invite
          </VesselButton>
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
