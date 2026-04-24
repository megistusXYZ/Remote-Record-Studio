import { useEffect, useRef } from "react";
import { Video, Mic } from "lucide-react";
import { PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { MediaDevice } from "../../hooks/use-media-devices";

export type DevicePickerPopoverProps = {
  cameras: MediaDevice[];
  microphones: MediaDevice[];
  selectedCameraId: string | null;
  selectedMicId: string | null;
  onSelectCamera: (id: string) => void;
  onSelectMic: (id: string) => void;
  previewStream?: MediaStream | null;
};

export function DevicePickerPopover({
  cameras,
  microphones,
  selectedCameraId,
  selectedMicId,
  onSelectCamera,
  onSelectMic,
  previewStream,
}: DevicePickerPopoverProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && previewStream) {
      videoRef.current.srcObject = previewStream;
    }
  }, [previewStream]);

  return (
    <PopoverContent
      className="w-80 p-0 bg-vessel-bg-surface border-vessel-border shadow-2xl"
      side="top"
      sideOffset={8}
    >
      <div className="px-4 py-3 border-b border-vessel-border">
        <h3 className="font-display text-sm font-bold text-vessel-text-primary">Devices</h3>
      </div>

      <div className="px-4 py-3 border-b border-vessel-border">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-vessel-text-muted mb-2">
          <Video className="w-3.5 h-3.5" />
          <span>Camera</span>
        </div>
        <div className="space-y-0.5">
          {cameras.length === 0 ? (
            <p className="text-sm text-vessel-text-secondary py-1">No cameras found</p>
          ) : (
            cameras.map((cam) => (
              <div
                key={cam.deviceId}
                data-testid={`device-camera-${cam.deviceId}`}
                onClick={() => onSelectCamera(cam.deviceId)}
                className="flex items-center gap-2 py-1.5 cursor-pointer hover:bg-vessel-bg-base rounded-md px-2 -mx-2 transition-colors"
              >
                <div
                  className={cn(
                    "w-1.5 h-1.5 rounded-full shrink-0",
                    selectedCameraId === cam.deviceId ? "bg-vessel-accent" : "bg-transparent"
                  )}
                />
                <span className="text-sm text-vessel-text-primary truncate">{cam.label}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="px-4 py-3 border-b border-vessel-border">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-vessel-text-muted mb-2">
          <Mic className="w-3.5 h-3.5" />
          <span>Microphone</span>
        </div>
        <div className="space-y-0.5">
          {microphones.length === 0 ? (
            <p className="text-sm text-vessel-text-secondary py-1">No microphones found</p>
          ) : (
            microphones.map((mic) => (
              <div
                key={mic.deviceId}
                data-testid={`device-mic-${mic.deviceId}`}
                onClick={() => onSelectMic(mic.deviceId)}
                className="flex items-center gap-2 py-1.5 cursor-pointer hover:bg-vessel-bg-base rounded-md px-2 -mx-2 transition-colors"
              >
                <div
                  className={cn(
                    "w-1.5 h-1.5 rounded-full shrink-0",
                    selectedMicId === mic.deviceId ? "bg-vessel-accent" : "bg-transparent"
                  )}
                />
                <span className="text-sm text-vessel-text-primary truncate">{mic.label}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="p-4 bg-vessel-bg-elevated rounded-b-md">
        <div className="w-full aspect-video rounded-lg bg-vessel-bg-base overflow-hidden border border-vessel-border flex items-center justify-center">
          {previewStream ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-sm text-vessel-text-muted">No preview</span>
          )}
        </div>
      </div>
    </PopoverContent>
  );
}
