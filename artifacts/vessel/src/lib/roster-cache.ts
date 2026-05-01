/**
 * Per-session roster cache.
 *
 * Caches the most-recent successful response from `GET /sessions/:id` in
 * `localStorage` so a hard refresh (or a flaky network on tab restore)
 * paints the last known roster immediately, without flashing an empty
 * "you're alone here" state while the first network roundtrip resolves.
 *
 * The cache is intentionally write-through (every successful query writes
 * a fresh snapshot) and read-through with a small TTL: stale snapshots
 * older than {@link MAX_CACHE_AGE_MS} are ignored on read so a long-dead
 * session doesn't haunt a future visitor of the same URL.
 *
 * The data shape is exactly the `Session` type the API returns. We don't
 * trim or transform anything on write — the same value React Query gets
 * from the server is what it gets from the cache, so consumers can be
 * agnostic about the source.
 */

import type { Session } from "@workspace/api-client-react";

const STORAGE_PREFIX = "vessel:roster:";
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000; // 24h — sessions older than a day aren't worth seeding from.

type Envelope = {
  /** Wall-clock time of the write, used to enforce {@link MAX_CACHE_AGE_MS}. */
  cachedAt: number;
  /** The full session payload as returned by GET /sessions/:id. */
  session: Session;
};

function keyFor(sessionId: string): string {
  return `${STORAGE_PREFIX}${sessionId}`;
}

function safeStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    // Some embedded browser contexts throw on `localStorage` access.
    return null;
  }
}

/**
 * Read the cached session for `sessionId`, or `undefined` if no fresh
 * cache entry exists. Returns `undefined` (never throws) on parse errors,
 * missing storage, or stale entries — the caller treats it as a cache
 * miss and proceeds to fetch normally.
 */
export function readCachedRoster(sessionId: string): Session | undefined {
  const store = safeStorage();
  if (!store) return undefined;

  let raw: string | null;
  try {
    raw = store.getItem(keyFor(sessionId));
  } catch {
    return undefined;
  }
  if (!raw) return undefined;

  let envelope: Envelope;
  try {
    envelope = JSON.parse(raw) as Envelope;
  } catch {
    return undefined;
  }

  if (
    !envelope ||
    typeof envelope !== "object" ||
    typeof envelope.cachedAt !== "number" ||
    !envelope.session
  ) {
    return undefined;
  }

  if (Date.now() - envelope.cachedAt > MAX_CACHE_AGE_MS) {
    // Stale — drop it and miss.
    try {
      store.removeItem(keyFor(sessionId));
    } catch {
      // ignore
    }
    return undefined;
  }

  return envelope.session;
}

/**
 * Persist `session` to the local cache for `sessionId`. Silent on any
 * storage failure (quota exceeded, private mode, etc.) — caching is a
 * pure perf optimization and must never crash the caller.
 */
export function writeCachedRoster(sessionId: string, session: Session): void {
  const store = safeStorage();
  if (!store) return;

  const envelope: Envelope = { cachedAt: Date.now(), session };
  try {
    store.setItem(keyFor(sessionId), JSON.stringify(envelope));
  } catch {
    // ignore — quota or other storage error
  }
}
