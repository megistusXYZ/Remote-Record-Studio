/**
 * One place that turns whatever went wrong into a sentence a person can act
 * on. Browser, network and library errors carry text written for developers
 * ("NotReadableError: Could not start video source", "Failed to fetch");
 * that text goes to the console, never to the screen.
 *
 * Errors whose message was written for people (PlainError, and the app's
 * own TrackDecryptError, ShareResolveError, DownloadError, delivery errors)
 * pass through. Everything else maps by name or status, or falls back.
 */

/** An error whose message is already fit to show. Throw it from app code. */
export class PlainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlainError";
  }
}

/** Errors defined in this app whose messages are written for people. */
const PLAIN_ERROR_NAMES = new Set([
  "PlainError",
  "TrackDecryptError",
  "ShareResolveError",
  "ShareDecryptError",
  "DownloadError",
  "DeliveryUnsupportedError",
]);

const BLOCKED =
  "Your browser blocked the camera or microphone. Allow it from the address bar, then try again.";
const NOT_FOUND =
  "No camera or microphone was found. Plug one in, then try again.";
const BUSY =
  "Another app is using your camera or microphone. Close it, then try again.";

const BY_NAME: Record<string, string> = {
  NotAllowedError: BLOCKED,
  PermissionDeniedError: BLOCKED,
  SecurityError: BLOCKED,
  NotFoundError: NOT_FOUND,
  DevicesNotFoundError: NOT_FOUND,
  OverconstrainedError: NOT_FOUND,
  NotReadableError: BUSY,
  TrackStartError: BUSY,
  AbortError: "That was cancelled.",
  QuotaExceededError:
    "This device is out of storage space. Free some up, then try again.",
};

function byStatus(status: number): string | null {
  if (status === 401 || status === 403)
    return "Your sign-in expired on this device. Reload the page and try again.";
  if (status === 404) return "That session or recording no longer exists.";
  if (status === 410) return "That session has ended.";
  if (status === 413) return "That's too large to send.";
  if (status === 429)
    return "Too many tries in a row. Wait a minute, then try again.";
  if (status >= 500)
    return "The server is having trouble. Try again in a moment.";
  return null;
}

/** Plain-language text for `err`, or `fallback` when nothing better fits. */
export function friendlyError(err: unknown, fallback: string): string {
  if (!err || typeof err !== "object") return fallback;
  const e = err as { name?: unknown; message?: unknown; status?: unknown };
  const name = typeof e.name === "string" ? e.name : "";
  const message = typeof e.message === "string" ? e.message : "";

  if (PLAIN_ERROR_NAMES.has(name) && message) return message;
  if (BY_NAME[name]) return BY_NAME[name];
  if (typeof e.status === "number") {
    const mapped = byStatus(e.status);
    if (mapped) return mapped;
  }
  if (name === "TypeError" && /fetch|network|load failed/i.test(message)) {
    return "Couldn't reach the server. Check your connection, then try again.";
  }
  return fallback;
}
