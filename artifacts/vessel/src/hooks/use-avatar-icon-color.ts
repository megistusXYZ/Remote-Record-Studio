import { useSyncExternalStore } from "react";

const STORAGE_KEY = "vessel_avatar_icon_color";
const EVENT_NAME = "vessel:avatar-icon-color-change";

/** Default foreground color used when the user hasn't picked one.
 *  White preserves the existing behavior across the entire app —
 *  every avatar shipped with `text-white` before this hook existed. */
export const DEFAULT_AVATAR_ICON_COLOR = "#ffffff";

function readStoredColor(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT_NAME, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT_NAME, onChange);
  };
}

const getServerSnapshot = (): string | null => null;

/**
 * Subscribes to the user's locally-chosen avatar *foreground* color
 * (Settings → Avatar color → "Icon color" picker). This is the color
 * applied to the mark SVG (or the initials text) sitting on top of
 * the avatar circle. Returns `null` when no choice has been persisted
 * yet — render code should fall back to `DEFAULT_AVATAR_ICON_COLOR`.
 */
export function useStoredAvatarIconColor(): string | null {
  return useSyncExternalStore(subscribe, readStoredColor, getServerSnapshot);
}

/**
 * Persists the avatar icon color and notifies in-tab listeners. The
 * native `storage` event only fires in *other* tabs, so we dispatch a
 * custom event so components in the current tab also re-render.
 */
export function setStoredAvatarIconColor(color: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, color);
    window.dispatchEvent(new Event(EVENT_NAME));
  } catch {
    // ignore quota/permission errors — color is non-critical UI state
  }
}

/**
 * Pure helper for resolving the avatar icon color outside of a
 * component (mirrors `resolveAvatarColor` / `resolveAvatarIcon`). The
 * icon color, like the background color and icon glyph, is treated as
 * a strictly local choice — only the signed-in user sees their own
 * chosen color. Other participants always render with the default
 * white foreground.
 */
export function resolveAvatarIconColor(
  targetPubkey: string | null | undefined,
  selfPubkey: string | null | undefined,
  storedColor: string | null,
): string {
  if (!targetPubkey || !selfPubkey) return DEFAULT_AVATAR_ICON_COLOR;
  if (targetPubkey !== selfPubkey) return DEFAULT_AVATAR_ICON_COLOR;
  return storedColor ?? DEFAULT_AVATAR_ICON_COLOR;
}
