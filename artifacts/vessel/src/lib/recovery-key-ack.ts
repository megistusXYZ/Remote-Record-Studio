/**
 * Tracks whether the person has confirmed they saved their recovery key.
 *
 * Sign-up no longer forces the key step before the first session; instead we
 * ask once there is something to lose, after the first finished recording.
 * Both flags are per Studio ID and live in localStorage only; nothing here is
 * sent anywhere.
 */

const ACK_PREFIX = "vessel:recovery-key-saved:";
const RECORDED_PREFIX = "vessel:has-finished-recording:";

function read(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function write(key: string): void {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    // Storage may be unavailable (private mode, quota); the prompt simply
    // shows again next time.
  }
}

/** True once the person has confirmed they saved their recovery key. */
export function hasSavedRecoveryKey(pubkey: string): boolean {
  return read(ACK_PREFIX + pubkey);
}

export function markRecoveryKeySaved(pubkey: string): void {
  write(ACK_PREFIX + pubkey);
}

/** True once this studio has finished at least one recording on this device. */
export function hasFinishedRecording(pubkey: string): boolean {
  return read(RECORDED_PREFIX + pubkey);
}

export function markFinishedRecording(pubkey: string): void {
  write(RECORDED_PREFIX + pubkey);
}

/** The prompt is due when there is something to lose and no backup yet. */
export function shouldPromptForRecoveryKey(pubkey: string): boolean {
  return hasFinishedRecording(pubkey) && !hasSavedRecoveryKey(pubkey);
}
