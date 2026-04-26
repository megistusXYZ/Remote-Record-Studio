import { useSyncExternalStore } from "react";

const MIC_KEY = "vessel_join_with_mic";
const CAMERA_KEY = "vessel_join_with_camera";
const EVENT_NAME = "vessel:join-prefs-change";

function readBool(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const v = window.localStorage.getItem(key);
    if (v === null) return fallback;
    return v === "true";
  } catch {
    return fallback;
  }
}

/**
 * Synchronous helper for reading the user's "join with mic on?"
 * preference outside of a component (e.g. as the lazy initializer for
 * `useState(() => readStoredJoinWithMic())` in StudioScreen so the
 * preference is applied exactly once at mount and is not re-applied
 * if the user later flips it in Settings while still in a call).
 *
 * Defaults to `true` when nothing has been stored yet, matching the
 * historical "join unmuted" behavior so existing users see no change.
 */
export function readStoredJoinWithMic(): boolean {
  return readBool(MIC_KEY, true);
}

export function readStoredJoinWithCamera(): boolean {
  return readBool(CAMERA_KEY, true);
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

const getMicSnapshot = (): boolean => readStoredJoinWithMic();
const getCameraSnapshot = (): boolean => readStoredJoinWithCamera();
const getServerSnapshot = (): boolean => true;

/**
 * Reactive hook that re-renders whenever the "join with mic" pref
 * changes — either in this tab (via `setStoredJoinWithMic`) or in
 * another tab (via the native `storage` event). Used by LobbyScreen
 * so the lobby toggles stay in sync with the Settings switches.
 */
export function useStoredJoinWithMic(): boolean {
  return useSyncExternalStore(subscribe, getMicSnapshot, getServerSnapshot);
}

export function useStoredJoinWithCamera(): boolean {
  return useSyncExternalStore(subscribe, getCameraSnapshot, getServerSnapshot);
}

function writeBool(key: string, value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value ? "true" : "false");
    window.dispatchEvent(new Event(EVENT_NAME));
  } catch {
    // ignore quota/permission errors — pref is non-critical
  }
}

export function setStoredJoinWithMic(value: boolean): void {
  writeBool(MIC_KEY, value);
}

export function setStoredJoinWithCamera(value: boolean): void {
  writeBool(CAMERA_KEY, value);
}
