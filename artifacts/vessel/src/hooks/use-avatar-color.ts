import { useSyncExternalStore } from "react";
import { useIdentity } from "./use-identity";
import { deriveAvatarColorFromPubkey } from "../lib/identity";

const STORAGE_KEY = "vessel_avatar_color";
const EVENT_NAME = "vessel:avatar-color-change";
const FALLBACK_COLOR = "#4a5568";

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
 * Subscribes to the user's locally-chosen avatar color (Settings → Avatar
 * color picker). Re-renders when the color changes in the same tab (via
 * `setStoredAvatarColor`) or in another tab (via the native `storage`
 * event). Returns `null` when no color has been picked yet.
 */
export function useStoredAvatarColor(): string | null {
  return useSyncExternalStore(subscribe, readStoredColor, getServerSnapshot);
}

/**
 * Persists the avatar color and notifies in-tab listeners. The native
 * `storage` event only fires in *other* tabs, so we dispatch a custom
 * event so components in the current tab also re-render.
 */
export function setStoredAvatarColor(color: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, color);
    window.dispatchEvent(new Event(EVENT_NAME));
  } catch {
    // ignore quota/permission errors — color is non-critical UI state
  }
}

/**
 * Pure helper for resolving an avatar color outside of a component
 * (e.g. inside a `.map()` body where calling hooks would violate the
 * rules of hooks). Components should call `useStoredAvatarColor()` and
 * `useIdentity()` once at the top level, then call this for each item.
 */
export function resolveAvatarColor(
  targetPubkey: string | null | undefined,
  selfPubkey: string | null | undefined,
  storedColor: string | null,
): string {
  if (!targetPubkey) return FALLBACK_COLOR;
  if (selfPubkey && targetPubkey === selfPubkey && storedColor) {
    return storedColor;
  }
  return deriveAvatarColorFromPubkey(targetPubkey);
}

/**
 * Returns the avatar color to use for the given pubkey.
 * - If the pubkey matches the signed-in user and they have picked a
 *   custom color in Settings, returns that color.
 * - Otherwise returns the deterministic color derived from the pubkey.
 * - If the pubkey is empty/null, returns a neutral fallback.
 */
export function useAvatarColor(pubkey: string | null | undefined): string {
  const { pubkey: selfPubkey } = useIdentity();
  const stored = useStoredAvatarColor();
  return resolveAvatarColor(pubkey, selfPubkey, stored);
}
