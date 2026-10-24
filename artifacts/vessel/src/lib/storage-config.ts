import type { Event } from "nostr-tools/pure";
import { getRelayPool } from "./relay-pool";
import { getPublishRelays } from "./relay-config";
import type { VesselIdentity } from "./identity";

/**
 * Per-participant storage server configuration.
 *
 * "Storage server" in code = a Blossom-compatible content-addressed file host
 * (BUD-01 / BUD-02). The user-facing surface always calls it "your storage" —
 * Blossom / BUD / SHA-256 are forbidden in rendered UI text.
 *
 * Layout:
 * - The chosen URL is persisted to localStorage under STORAGE_URL_KEY,
 *   scoped per identity pubkey: `vessel_storage_url:<pubkey>`. The bare
 *   `vessel_storage_url` key is the legacy global slot, still read as a
 *   fallback / migration source for users created before scoping landed.
 * - For portable signers (extension / remote), the same URL is also published
 *   as a Kind 10063 server-list event so the setting follows the user across
 *   devices. (BUD-03 spec.)
 * - On sign-in we best-effort fetch any published Kind 10063 list for the
 *   pubkey and apply it iff there is no local override yet — local browser
 *   choice always wins, never silently overwritten.
 * - LEGACY_PLACEHOLDER ("https://storage.vessel.local") was used by an earlier
 *   simulation. Reads coerce it back to the real default so users aren't stuck
 *   pointing at a non-existent host.
 */

export const STORAGE_URL_KEY = "vessel_storage_url";
/** New plural slot — JSON-encoded ordered string[]. Primary first, then mirrors. */
export const STORAGE_URLS_KEY = "vessel_storage_urls";
export const DEFAULT_STORAGE_URL = "https://blossom.band";
const LEGACY_PLACEHOLDER = "https://storage.vessel.local";

const KIND_USER_SERVER_LIST = 10063;
const REMOTE_FETCH_TIMEOUT_MS = 4000;

export type ReachabilityResult =
  | { state: "ok"; latencyMs: number }
  | { state: "unreachable"; reason: string };

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function normalizeStorageUrl(url: string): string {
  return stripTrailingSlash(url.trim());
}

export function isValidStorageUrl(raw: string): boolean {
  const url = raw.trim();
  if (!url) return false;
  try {
    const u = new URL(url);
    // HTTPS only — uploads carry signed auth headers and recording media, both
    // unsafe over plaintext. UI copy advertises "https:// URL" for the same
    // reason; reject http: even though the URL parser accepts it.
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

function scopedKey(pubkey: string): string {
  return `${STORAGE_URL_KEY}:${pubkey}`;
}

function scopedListKey(pubkey: string): string {
  return `${STORAGE_URLS_KEY}:${pubkey}`;
}

function readList(key: string): string[] | null {
  const raw = readRaw(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (typeof item !== "string") continue;
      const c = coerce(item);
      // coerce only normalises and remaps the legacy placeholder — it does
      // not enforce protocol/format. Apply isValidStorageUrl here so a stale
      // / hand-edited list with non-https entries is silently filtered
      // instead of being handed to upload code.
      if (!c || !isValidStorageUrl(c)) continue;
      if (seen.has(c)) continue;
      seen.add(c);
      cleaned.push(c);
    }
    return cleaned.length > 0 ? cleaned : null;
  } catch {
    return null;
  }
}

function writeList(key: string, urls: string[]): void {
  if (typeof localStorage === "undefined") return;
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const u of urls) {
    const n = normalizeStorageUrl(u);
    if (!isValidStorageUrl(n)) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    cleaned.push(n);
  }
  if (cleaned.length === 0) {
    localStorage.removeItem(key);
    return;
  }
  localStorage.setItem(key, JSON.stringify(cleaned));
}

function readRaw(key: string): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(key);
}

function coerce(raw: string | null): string | null {
  if (!raw) return null;
  const normalized = normalizeStorageUrl(raw);
  if (!normalized) return null;
  // Coerce dead simulation host back to real default rather than leaving the
  // user pointing at nothing.
  if (normalized === LEGACY_PLACEHOLDER) return DEFAULT_STORAGE_URL;
  return normalized;
}

/**
 * Resolve the full ordered list of storage URLs for a given identity. The
 * first entry is the **primary** — new uploads from this device target it.
 * Later entries are mirrors which are saved/published as the user's
 * preferred server set so the choice follows them across devices.
 *
 * Lookup order:
 *   1. identity-scoped plural slot (`vessel_storage_urls:<pubkey>`)
 *   2. identity-scoped legacy single slot (`vessel_storage_url:<pubkey>`)
 *      — wrapped as `[that]` for migration without forced rewrites
 *   3. global plural slot (`vessel_storage_urls`)
 *      — mirrors the symmetric setter; without this an anonymous-write would
 *        become an unreadable orphan
 *   4. legacy global single slot (`vessel_storage_url`)
 *   5. `[DEFAULT_STORAGE_URL]`
 *
 * Always returns a non-empty array. Duplicates are removed; order preserved.
 */
export function getStorageUrls(pubkey?: string): string[] {
  if (pubkey) {
    const scopedList = readList(scopedListKey(pubkey));
    if (scopedList && scopedList.length > 0) return scopedList;
    const scopedSingle = coerce(readRaw(scopedKey(pubkey)));
    if (scopedSingle) return [scopedSingle];
  }
  const globalList = readList(STORAGE_URLS_KEY);
  if (globalList && globalList.length > 0) return globalList;
  const legacy = coerce(readRaw(STORAGE_URL_KEY));
  if (legacy) return [legacy];
  return [DEFAULT_STORAGE_URL];
}

/**
 * Resolve the effective primary storage URL for a given identity. Equivalent
 * to `getStorageUrls(pubkey)[0]`. Kept as a stable single-URL helper for the
 * many call sites that just need "where do new uploads go?".
 *
 * Pass `undefined` for an anonymous / pre-sign-in caller — only the global
 * slot and default are consulted in that case, so two accounts on the same
 * device never bleed each other's storage choice.
 */
export function getStorageUrl(pubkey?: string): string {
  return getStorageUrls(pubkey)[0] ?? DEFAULT_STORAGE_URL;
}

/**
 * True iff there is any explicit local choice for this identity that the
 * remote-list applier must not overwrite. This includes:
 *   - the per-identity scoped plural key, or
 *   - the per-identity scoped legacy single key, or
 *   - the legacy global key (during migration — a user who set the global
 *     URL before scoping landed should not have it silently replaced by the
 *     remote list when they next sign in).
 *
 * Used to enforce the "local always wins" contract on
 * applyRemoteStorageChoiceIfMissing.
 */
export function hasLocalStorageChoice(pubkey: string): boolean {
  if (readRaw(scopedListKey(pubkey)) != null) return true;
  if (readRaw(scopedKey(pubkey)) != null) return true;
  // Global plural slot — parity with `setStorageUrls(_, undefined)`. Without
  // this, an anonymous-write made before sign-in could be silently
  // overwritten by `applyRemoteStorageChoiceIfMissing` on first sign-in.
  if (readRaw(STORAGE_URLS_KEY) != null) return true;
  if (readRaw(STORAGE_URL_KEY) != null) return true;
  return false;
}

/**
 * Persist the full ordered storage list. Empty / invalid entries are
 * filtered; duplicates de-duped (first occurrence wins). Writing an empty
 * list clears the slot — subsequent reads then resolve to the default.
 *
 * Also clears the legacy single-URL slot for this identity so two slots
 * never disagree post-write — readers always see the new plural slot first
 * anyway, but cleaning up keeps localStorage tidy and avoids confusion if
 * someone inspects the keys directly.
 */
export function setStorageUrls(urls: string[], pubkey?: string): void {
  if (typeof localStorage === "undefined") return;
  if (pubkey) {
    writeList(scopedListKey(pubkey), urls);
    localStorage.removeItem(scopedKey(pubkey));
  } else {
    writeList(STORAGE_URLS_KEY, urls);
    localStorage.removeItem(STORAGE_URL_KEY);
  }
}

/**
 * Single-URL convenience setter — replaces the entire list with `[url]`.
 * Kept for backward compatibility with existing single-input call sites
 * (onboarding, sign-up). New code with multiple URLs should call
 * `setStorageUrls` directly.
 */
export function setStorageUrl(url: string, pubkey?: string): void {
  setStorageUrls([url], pubkey);
}

export function clearStorageUrl(pubkey?: string): void {
  if (typeof localStorage === "undefined") return;
  if (pubkey) {
    localStorage.removeItem(scopedListKey(pubkey));
    localStorage.removeItem(scopedKey(pubkey));
  } else {
    localStorage.removeItem(STORAGE_URLS_KEY);
    localStorage.removeItem(STORAGE_URL_KEY);
  }
}

/**
 * Probes the storage server with a tiny content-addressed lookup. Any HTTP
 * response (including 404 for a never-existed hash) means the host is up and
 * speaking the protocol. A network/CORS failure means unreachable.
 *
 * Uses a 64-zero hash so we never accidentally trigger a real download.
 */
export async function checkStorageReachability(
  url: string,
  signal?: AbortSignal,
): Promise<ReachabilityResult> {
  if (!isValidStorageUrl(url)) {
    return { state: "unreachable", reason: "Invalid URL." };
  }
  const normalized = normalizeStorageUrl(url);
  const probeUrl = `${normalized}/${"0".repeat(64)}`;
  const t0 =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const ctl = new AbortController();
  const timeoutId = setTimeout(() => ctl.abort(), 5000);
  const linkedSignal = signal ? combineSignals(signal, ctl.signal) : ctl.signal;
  try {
    const res = await fetch(probeUrl, {
      method: "HEAD",
      signal: linkedSignal,
      mode: "cors",
    });
    const latencyMs = Math.round(
      (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0,
    );
    // 200, 404, 405 — all valid signs of a live Blossom-compatible host.
    if (res.status >= 200 && res.status < 600) {
      return { state: "ok", latencyMs };
    }
    return {
      state: "unreachable",
      reason: `Server responded with ${res.status}.`,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { state: "unreachable", reason: "Timed out reaching server." };
    }
    console.warn("Storage server test failed:", err);
    return { state: "unreachable", reason: "Couldn't reach this server." };
  } finally {
    clearTimeout(timeoutId);
  }
}

function combineSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a;
  if (b.aborted) return b;
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  a.addEventListener("abort", onAbort, { once: true });
  b.addEventListener("abort", onAbort, { once: true });
  return ctl.signal;
}

/**
 * Build & sign a Kind 10063 user-server-list event mirroring the chosen
 * storage URL, then best-effort publish it to the default relay set so the
 * setting roams across devices for portable signers.
 *
 * Failures are logged but never thrown — UI must not block on this.
 */
export async function publishStorageServerList(
  identity: VesselIdentity,
  urls: string[],
  relays: string[] = getPublishRelays(identity._pubkey),
): Promise<{ event: Event; published: boolean }> {
  const tags = urls
    .map((u) => normalizeStorageUrl(u))
    .filter((u) => isValidStorageUrl(u))
    .map((u) => ["server", u]);

  const template = {
    kind: KIND_USER_SERVER_LIST,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "",
  };
  const signed = await identity._signer.signEvent(template);

  let published = false;
  try {
    const pool = getRelayPool();
    const results = await pool.publish(relays, signed);
    published = results.some((r) => r && r.ok);
  } catch (err) {
    console.warn("Failed to publish storage server list:", err);
  }
  return { event: signed, published };
}

/**
 * Best-effort fetch the most recent Kind 10063 server-list event for this
 * pubkey from the default relay set. Returns the parsed list of server URLs
 * (in `["server", <url>]` tag order), or `[]` if nothing is published or any
 * failure occurs. Always resolves within ~`REMOTE_FETCH_TIMEOUT_MS`.
 */
export async function fetchUserStorageServerList(
  pubkey: string,
  relays: string[] = getPublishRelays(pubkey),
): Promise<string[]> {
  if (!pubkey) return [];
  return new Promise<string[]>((resolve) => {
    const events: Event[] = [];
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      try {
        sub?.unsubscribe();
      } catch {
        // ignore
      }
      clearTimeout(timeoutId);
      if (events.length === 0) return resolve([]);
      // Replaceable event — multiple relays may return slightly different
      // versions; keep the most recent.
      const latest = [...events].sort((a, b) => b.created_at - a.created_at)[0];
      if (!latest || !Array.isArray(latest.tags)) return resolve([]);
      const urls: string[] = [];
      for (const tag of latest.tags) {
        if (Array.isArray(tag) && tag[0] === "server" && typeof tag[1] === "string") {
          const normalized = normalizeStorageUrl(tag[1]);
          if (isValidStorageUrl(normalized)) urls.push(normalized);
        }
      }
      resolve(urls);
    };

    const timeoutId = setTimeout(settle, REMOTE_FETCH_TIMEOUT_MS);
    let sub: { unsubscribe: () => void } | null = null;
    try {
      const pool = getRelayPool();
      const obs = pool.request(relays, [
        { kinds: [KIND_USER_SERVER_LIST], authors: [pubkey], limit: 1 },
      ]);
      sub = obs.subscribe({
        next: (ev) => {
          // request() yields NostrEvent values directly (not subscription
          // responses). Defensive guard for non-event payloads anyway.
          if (ev && typeof (ev as Event).created_at === "number") {
            events.push(ev as Event);
          }
        },
        error: () => settle(),
        complete: () => settle(),
      });
    } catch (err) {
      console.warn("Failed to fetch storage server list:", err);
      settle();
    }
  });
}

/**
 * If this identity has no local storage choice on this device, best-effort
 * apply the **full ordered list** from their published Kind 10063 server
 * list. Local choices always win — never silently overwritten. Returns the
 * primary URL that was adopted (so callers can show a "synced from your
 * other device" hint), or `null` if nothing was applied.
 */
export async function applyRemoteStorageChoiceIfMissing(
  pubkey: string,
): Promise<string | null> {
  if (!pubkey) return null;
  // Pre-check: skip the network round-trip entirely if the user already has a
  // local choice on this device.
  if (hasLocalStorageChoice(pubkey)) return null;
  const list = await fetchUserStorageServerList(pubkey);
  if (list.length === 0) return null;
  // Double-check after the async fetch returns. The user may have picked a
  // server in Settings while the relay request was in flight; "local always
  // wins" requires we not clobber that choice.
  if (hasLocalStorageChoice(pubkey)) return null;
  setStorageUrls(list, pubkey);
  return list[0];
}
