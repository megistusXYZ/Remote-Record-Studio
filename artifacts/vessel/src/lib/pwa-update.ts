import { create } from "zustand";
import { registerSW } from "virtual:pwa-register";

/**
 * App updates on our terms. The service worker used to take over open tabs
 * the moment a deploy finished, which reloads the page; mid-recording that
 * destroyed the take. Now a new version waits until the person applies it,
 * and the prompt itself stays out of the way while a recording runs.
 */
type AppUpdateState = {
  needRefresh: boolean;
  offlineReady: boolean;
  apply: () => Promise<void>;
};

let applyFn: ((reload?: boolean) => Promise<void>) | null = null;

export const useAppUpdate = create<AppUpdateState>(() => ({
  needRefresh: false,
  offlineReady: false,
  apply: async () => {
    if (applyFn) await applyFn(true);
    else window.location.reload();
  },
}));

let installed = false;

export function setupAppUpdates(): void {
  if (
    installed ||
    typeof window === "undefined" ||
    !("serviceWorker" in navigator)
  )
    return;
  installed = true;
  try {
    applyFn = registerSW({
      immediate: true,
      onNeedRefresh() {
        useAppUpdate.setState({ needRefresh: true });
      },
      onOfflineReady() {
        useAppUpdate.setState({ offlineReady: true });
      },
      onRegisterError(err: unknown) {
        console.warn("Service worker registration failed", err);
      },
    });
  } catch (err) {
    console.warn("Service worker setup failed", err);
  }
}
