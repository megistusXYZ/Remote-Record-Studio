import type { Event } from "nostr-tools/pure";
import { getRelayPool } from "./relay-pool";
import { deploymentRelays } from "./runtime-config";
import type { VesselIdentity } from "./identity";

/**
 * Per-participant publish-endpoint configuration.
 *
 * "Publish endpoint" in code = a Nostr relay (NIP-65 / Kind 10002 relay-list
 * metadata). The user-facing surface always calls these "sync servers" —
 * "relay" / "Nostr" / "wss" / "kind" / "pubkey" are forbidden in rendered UI.
 *
 * Layout mirrors storage-config:
 * - The chosen list is persisted to localStorage under PUBLISH_RELAYS_KEY,
 *   scoped per identity pubkey: `vessel_publish_relays:<pubkey>`. The bare
 *   `vessel_publish_relays` key is the global slot, used when no identity is
 *   present (anonymous reads / pre-sign-in writes).
 * - For portable signers, the same list is also published as a Kind 10002
 *   relay-list metadata event so the choice follows the user across devices.
 * - On sign-in we best-effort fetch any published Kind 10002 list for the
 *   pubkey and apply it iff there is no local override yet — local browser
 *   choice always wins, never silently overwritten.
 *
 * Bootstrap chicken-and-egg: to FETCH the user's saved list we must already
 * know somewhere to look. We resolve this by always using DEFAULT_PUBLISH_RELAYS
 * as the bootstrap, and by always publishing the user's chosen list to BOTH
 * their new list AND the defaults — so a user who switches to all-private
 * endpoints does not silently lose cross-device sync.
 */

/** Legacy name mirrors storage-config's STORAGE_URL_KEY pattern. */
export const PUBLISH_RELAYS_KEY = "vessel_publish_relays";
/** Default list when no user pref exists: the deployment's own servers
 *  (runtime-config) when the operator set any, else the historical public
 *  set used across storage-config / session-archive / share-resolver /
 *  use-call-signal so existing users see no behavior change.
 *
 *  Typed as a mutable `string[]` (and not frozen) to stay structurally
 *  compatible with the publish APIs that take `string[]`. Treat the value
 *  as a constant — `getPublishRelays` always returns a fresh copy. */
const BUILT_IN_PUBLISH_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
];
const configured = deploymentRelays();
export const DEFAULT_PUBLISH_RELAYS: string[] =
  configured.length > 0 ? configured : [...BUILT_IN_PUBLISH_RELAYS];

const KIND_RELAY_LIST = 10002;
const REMOTE_FETCH_TIMEOUT_MS = 4000;
const REACHABILITY_TIMEOUT_MS = 5000;

/** Soft cap so a runaway list can't blow up publish fan-out budgets. */
export const MAX_PUBLISH_RELAYS = 12;

export type RelayReachabilityResult =
  | { state: "ok"; latencyMs: number }
  | { state: "unreachable"; reason: string };

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function normalizeRelayUrl(url: string): string {
  return stripTrailingSlash(url.trim());
}

export function isValidRelayUrl(raw: string): boolean {
  const url = raw.trim();
  if (!url) return false;
  try {
    const u = new URL(url);
    // wss is the production protocol; ws is allowed only so local dev
    // (ws://localhost:…) doesn't get filtered by the same validator at
    // every layer. Production deployments should use wss exclusively.
    return u.protocol === "wss:" || u.protocol === "ws:";
  } catch {
    return false;
  }
}

function scopedKey(pubkey: string): string {
  return `${PUBLISH_RELAYS_KEY}:${pubkey}`;
}

function readRaw(key: string): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(key);
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
      const n = normalizeRelayUrl(item);
      // Apply the same validator on the read path so a stale / hand-edited
      // entry can't be handed to publish code.
      if (!n || !isValidRelayUrl(n)) continue;
      if (seen.has(n)) continue;
      seen.add(n);
      cleaned.push(n);
      if (cleaned.length >= MAX_PUBLISH_RELAYS) break;
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
    const n = normalizeRelayUrl(u);
    if (!isValidRelayUrl(n)) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    cleaned.push(n);
    if (cleaned.length >= MAX_PUBLISH_RELAYS) break;
  }
  if (cleaned.length === 0) {
    localStorage.removeItem(key);
    return;
  }
  localStorage.setItem(key, JSON.stringify(cleaned));
}

/**
 * Resolve the full ordered list of publish endpoints for a given identity.
 *
 * Lookup order:
 *   1. identity-scoped slot (`vessel_publish_relays:<pubkey>`)
 *   2. global slot (`vessel_publish_relays`)
 *      — mirrors the symmetric setter; without this an anonymous-write would
 *        become an unreadable orphan.
 *   3. DEFAULT_PUBLISH_RELAYS (returned as a plain array copy so callers
 *      can't mutate the frozen original).
 *
 * Always returns a non-empty array. Duplicates are removed; order preserved.
 */
export function getPublishRelays(pubkey?: string): string[] {
  if (pubkey) {
    const scoped = readList(scopedKey(pubkey));
    if (scoped && scoped.length > 0) return scoped;
  }
  const global = readList(PUBLISH_RELAYS_KEY);
  if (global && global.length > 0) return global;
  return [...DEFAULT_PUBLISH_RELAYS];
}

/**
 * Resolve the publish endpoint set for an identity, falling back to the
 * default behavior when no identity is supplied. Convenience wrapper used at
 * call sites that have an `identity?: VesselIdentity | null` signature.
 */
export function resolvePublishRelaysForIdentity(
  identity?: VesselIdentity | null,
): string[] {
  return getPublishRelays(identity?._pubkey);
}

/**
 * True iff there is any explicit local choice for this identity that the
 * remote-list applier must not overwrite. Includes the per-identity scoped
 * slot AND the global slot — an anonymous-write made before sign-in should
 * not be silently clobbered by `applyRemoteRelayChoiceIfMissing` on the
 * first sign-in.
 */
export function hasLocalRelayChoice(pubkey: string): boolean {
  if (readRaw(scopedKey(pubkey)) != null) return true;
  if (readRaw(PUBLISH_RELAYS_KEY) != null) return true;
  return false;
}

/**
 * Persist the full ordered endpoint list. Empty / invalid entries are
 * filtered; duplicates de-duped (first occurrence wins). Writing an empty
 * list clears the slot — subsequent reads then resolve to the default.
 *
 * Primary first, then secondaries. The primary is still written to with the
 * rest of the list — it's the order users will see on other devices when
 * the cross-device sync completes.
 */
export function setPublishRelays(urls: string[], pubkey?: string): void {
  if (typeof localStorage === "undefined") return;
  if (pubkey) {
    writeList(scopedKey(pubkey), urls);
  } else {
    writeList(PUBLISH_RELAYS_KEY, urls);
  }
}

export function clearPublishRelays(pubkey?: string): void {
  if (typeof localStorage === "undefined") return;
  if (pubkey) {
    localStorage.removeItem(scopedKey(pubkey));
  } else {
    localStorage.removeItem(PUBLISH_RELAYS_KEY);
  }
}

/**
 * Probe a single endpoint by opening a real WebSocket connection and waiting
 * for OPEN. Resolves "ok" with the round-trip latency on success, or
 * "unreachable" with a brief reason on any failure within
 * REACHABILITY_TIMEOUT_MS. The socket is closed in every code path — we
 * never leave a probe socket dangling.
 */
export async function checkRelayReachability(
  url: string,
  signal?: AbortSignal,
): Promise<RelayReachabilityResult> {
  if (!isValidRelayUrl(url)) {
    return { state: "unreachable", reason: "Invalid URL." };
  }
  const normalized = normalizeRelayUrl(url);
  const t0 =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  return new Promise<RelayReachabilityResult>((resolve) => {
    let ws: WebSocket | null = null;
    let settled = false;
    const cleanup = () => {
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      ws = null;
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener("abort", onAbort);
    };
    const settle = (r: RelayReachabilityResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(r);
    };
    const onAbort = () =>
      settle({ state: "unreachable", reason: "Cancelled." });
    const timeoutId = setTimeout(
      () => settle({ state: "unreachable", reason: "Timed out reaching server." }),
      REACHABILITY_TIMEOUT_MS,
    );
    if (signal) {
      if (signal.aborted) {
        settle({ state: "unreachable", reason: "Cancelled." });
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    try {
      ws = new WebSocket(normalized);
    } catch (err) {
      console.warn("Sync server test failed:", err);
      settle({ state: "unreachable", reason: "Couldn't reach this server." });
      return;
    }
    ws.onopen = () => {
      const latencyMs = Math.round(
        (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0,
      );
      settle({ state: "ok", latencyMs });
    };
    ws.onerror = () => {
      settle({ state: "unreachable", reason: "Couldn't reach server." });
    };
    ws.onclose = (ev) => {
      // If we never saw OPEN this was a connection failure. The browser
      // intentionally hides socket-level reasons from JS for privacy, so we
      // surface the close code instead of inventing a more specific message.
      const reason =
        ev.code === 1006
          ? "Couldn't reach server."
          : `Server closed the connection (${ev.code}).`;
      settle({ state: "unreachable", reason });
    };
  });
}

/**
 * Build & sign a Kind 10002 relay-list metadata event mirroring the chosen
 * publish endpoint set, then best-effort publish it so the setting roams
 * across devices for portable signers.
 *
 * The publish target is the union of the user's new list AND the defaults —
 * a user who moves entirely to private endpoints would otherwise lose
 * cross-device sync because the defaults wouldn't carry the new list.
 *
 * Failures are logged but never thrown — UI must not block on this.
 */
export async function publishRelayList(
  identity: VesselIdentity,
  urls: string[],
): Promise<{ event: Event; published: boolean }> {
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const u of urls) {
    const n = normalizeRelayUrl(u);
    if (!isValidRelayUrl(n)) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    cleaned.push(n);
  }
  const tags = cleaned.map((u) => ["r", u]);
  const template = {
    kind: KIND_RELAY_LIST,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "",
  };
  const signed = await identity._signer.signEvent(template);

  const publishTargets: string[] = [];
  const targetSeen = new Set<string>();
  for (const u of [...cleaned, ...DEFAULT_PUBLISH_RELAYS]) {
    if (targetSeen.has(u)) continue;
    targetSeen.add(u);
    publishTargets.push(u);
  }

  let published = false;
  try {
    const pool = getRelayPool();
    const results = await pool.publish(publishTargets, signed);
    published = results.some((r) => r && r.ok);
  } catch (err) {
    console.warn("Failed to publish endpoint list:", err);
  }
  return { event: signed, published };
}

/**
 * Best-effort fetch the most recent Kind 10002 relay-list event for this
 * pubkey from the bootstrap relay set. Returns the parsed list of URLs in
 * `["r", <url>]` tag order, or `[]` if nothing is published or any failure
 * occurs. Always resolves within ~`REMOTE_FETCH_TIMEOUT_MS`.
 */
export async function fetchUserRelayList(
  pubkey: string,
  bootstrapRelays: string[] = DEFAULT_PUBLISH_RELAYS,
): Promise<string[]> {
  if (!pubkey) return [];
  return new Promise<string[]>((resolve) => {
    const events: Event[] = [];
    let settled = false;
    let sub: { unsubscribe: () => void } | null = null;
    const settle = () => {
      if (settled) return;
      settled = true;
      try {
        sub?.unsubscribe();
      } catch {
        /* ignore */
      }
      clearTimeout(timeoutId);
      if (events.length === 0) return resolve([]);
      // Replaceable event — multiple relays may return slightly different
      // versions; keep the most recent.
      const latest = [...events].sort((a, b) => b.created_at - a.created_at)[0];
      if (!latest || !Array.isArray(latest.tags)) return resolve([]);
      const urls: string[] = [];
      const seen = new Set<string>();
      for (const tag of latest.tags) {
        if (
          Array.isArray(tag) &&
          tag[0] === "r" &&
          typeof tag[1] === "string"
        ) {
          const n = normalizeRelayUrl(tag[1]);
          if (!isValidRelayUrl(n)) continue;
          if (seen.has(n)) continue;
          seen.add(n);
          urls.push(n);
          if (urls.length >= MAX_PUBLISH_RELAYS) break;
        }
      }
      resolve(urls);
    };

    const timeoutId = setTimeout(settle, REMOTE_FETCH_TIMEOUT_MS);
    try {
      const pool = getRelayPool();
      const obs = pool.request([...bootstrapRelays], [
        { kinds: [KIND_RELAY_LIST], authors: [pubkey], limit: 1 },
      ]);
      sub = obs.subscribe({
        next: (ev) => {
          if (ev && typeof (ev as Event).created_at === "number") {
            events.push(ev as Event);
          }
        },
        error: () => settle(),
        complete: () => settle(),
      });
    } catch (err) {
      console.warn("Failed to fetch endpoint list:", err);
      settle();
    }
  });
}

/**
 * If this identity has no local endpoint choice on this device, best-effort
 * apply the published Kind 10002 list. Local choices always win — never
 * silently overwritten. Returns the primary URL that was adopted, or `null`
 * if nothing was applied.
 */
export async function applyRemoteRelayChoiceIfMissing(
  pubkey: string,
): Promise<string | null> {
  if (!pubkey) return null;
  // Pre-check: skip the network round-trip entirely if the user already has
  // a local choice on this device.
  if (hasLocalRelayChoice(pubkey)) return null;
  const list = await fetchUserRelayList(pubkey);
  if (list.length === 0) return null;
  // Double-check after the async fetch returns. The user may have set a list
  // in Settings while the request was in flight; "local always wins" requires
  // we not clobber that choice.
  if (hasLocalRelayChoice(pubkey)) return null;
  setPublishRelays(list, pubkey);
  return list[0];
}
