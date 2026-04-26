import { useSyncExternalStore } from "react";
import { useIdentity } from "./use-identity";
import { isAvatarMarkId, type AvatarMarkId } from "../components/icons/avatar-marks";

const STORAGE_KEY = "vessel_avatar_icon";
const EVENT_NAME = "vessel:avatar-icon-change";

function readStoredIcon(): AvatarMarkId | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isAvatarMarkId(raw) ? raw : null;
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

const getServerSnapshot = (): AvatarMarkId | null => null;

/**
 * Subscribes to the user's locally-chosen avatar icon (Settings → Avatar
 * picker). Re-renders when the icon changes in the same tab (via
 * `setStoredAvatarIcon`) or in another tab (via the native `storage`
 * event). Returns `null` when no icon has been picked yet — render
 * code should fall back to initials.
 */
export function useStoredAvatarIcon(): AvatarMarkId | null {
  return useSyncExternalStore(subscribe, readStoredIcon, getServerSnapshot);
}

/**
 * Persists the avatar icon and notifies in-tab listeners. Pass `null`
 * to clear the stored choice (revert to initials). The native `storage`
 * event only fires in *other* tabs, so we dispatch a custom event so
 * components in the current tab also re-render.
 */
export function setStoredAvatarIcon(icon: AvatarMarkId | null): void {
  if (typeof window === "undefined") return;
  try {
    if (icon === null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, icon);
    }
    window.dispatchEvent(new Event(EVENT_NAME));
  } catch {
    // ignore quota/permission errors — icon is non-critical UI state
  }
}

/**
 * Pure helper for resolving an avatar icon outside of a component
 * (e.g. inside a `.map()` body where calling hooks would violate the
 * rules of hooks). Components should call `useStoredAvatarIcon()` and
 * `useIdentity()` once at the top level, then call this for each item.
 *
 * Returns the chosen icon id only when the row's pubkey matches the
 * signed-in user. Other participants always get `null` (render initials)
 * — the icon is a personal local choice, the same model used by
 * `resolveAvatarColor`. A future task can add icon broadcast over
 * the call signaling channel if desired.
 */
export function resolveAvatarIcon(
  targetPubkey: string | null | undefined,
  selfPubkey: string | null | undefined,
  storedIcon: AvatarMarkId | null,
): AvatarMarkId | null {
  if (!targetPubkey || !selfPubkey) return null;
  if (targetPubkey !== selfPubkey) return null;
  return storedIcon;
}

/**
 * Returns the avatar icon to use for the given pubkey.
 * - If the pubkey matches the signed-in user and they have picked an
 *   icon in Settings, returns that icon id.
 * - Otherwise returns null (caller renders initials).
 */
export function useAvatarIcon(
  pubkey: string | null | undefined,
): AvatarMarkId | null {
  const { pubkey: selfPubkey } = useIdentity();
  const stored = useStoredAvatarIcon();
  return resolveAvatarIcon(pubkey, selfPubkey, stored);
}
