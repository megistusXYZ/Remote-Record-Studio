import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useAppUpdate } from "../lib/pwa-update";
import { useRecordingActivity } from "../lib/recording-activity";
import { VesselButton } from "./vessel-ui/VesselButton";

/**
 * Small bottom banner offering to apply a waiting app update. Hidden while a
 * recording is in progress so nothing can interrupt a take; it reappears
 * once recording ends.
 */
export function AppUpdatePrompt() {
  const needRefresh = useAppUpdate((s) => s.needRefresh);
  const apply = useAppUpdate((s) => s.apply);
  const recording = useRecordingActivity((s) => s.activeCount > 0);
  const [applying, setApplying] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (!needRefresh || recording || dismissed) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-4 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:max-w-sm z-[70] rounded-2xl border border-vessel-border bg-vessel-bg-surface shadow-2xl p-4 flex items-start gap-3"
      data-testid="app-update-prompt"
    >
      <div className="w-9 h-9 shrink-0 rounded-full bg-vessel-accent/10 border border-vessel-accent/20 flex items-center justify-center">
        <RefreshCw className="w-4 h-4 text-vessel-accent" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-vessel-text-primary">
          A new version of Vessel is ready
        </div>
        <p className="mt-0.5 text-sm text-vessel-text-secondary">
          Reload to pick it up. Your recordings stay where they are.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <VesselButton
            size="sm"
            isLoading={applying}
            onClick={() => {
              setApplying(true);
              void apply();
            }}
            data-testid="app-update-apply"
          >
            Reload now
          </VesselButton>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="text-sm font-medium text-vessel-text-muted hover:text-vessel-text-primary focus:outline-none focus-visible:underline"
            data-testid="app-update-later"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
