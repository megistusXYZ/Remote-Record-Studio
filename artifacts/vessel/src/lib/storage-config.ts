import type { Event } from "nostr-tools/pure";
import { getRelayPool } from "./relay-pool";
import type { VesselIdentity } from "./identity";

/**
 * Per-participant storage server configuration.
 *
 * "Storage server" in code = a Blossom-compatible content-addressed file host
 * (BUD-01 / BUD-02). The user-facing surface always calls it "your storage" —
 * Blossom / BUD / SHA-256 are forbidden in rendered UI text.
 *
 * Layout:
 * - The chosen URL is persisted to localStorage under STORAGE_URL_KEY.
 * - For portable signers (extension / remote), the same URL is also published
 *   as a Kind 10063 server-list event so the setting follows the user across
 *   devices. (BUD-03 spec.)
 * - LEGACY_PLACEHOLDER ("https://storage.vessel.local") was used by an earlier
 *   simulation. Reads coerce it back to the real default so users aren't stuck
 *   pointing at a non-existent host.
 */

export const STORAGE_URL_KEY = "vessel_storage_url";
export const DEFAULT_STORAGE_URL = "https://blossom.band";
const LEGACY_PLACEHOLDER = "https://storage.vessel.local";

const DEFAULT_PUBLISH_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
  "wss://nos.lol",
];

const KIND_USER_SERVER_LIST = 10063;

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

export function getStorageUrl(): string {
  if (typeof localStorage === "undefined") return DEFAULT_STORAGE_URL;
  const raw = localStorage.getItem(STORAGE_URL_KEY);
  if (!raw) return DEFAULT_STORAGE_URL;
  // Normalize before comparison so legacy values with whitespace or trailing
  // slashes ("https://storage.vessel.local/") still get coerced to the real
  // default. Otherwise the user would silently keep pointing at a dead host.
  const normalized = normalizeStorageUrl(raw);
  if (normalized === LEGACY_PLACEHOLDER) return DEFAULT_STORAGE_URL;
  return normalized;
}

export function setStorageUrl(url: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_URL_KEY, normalizeStorageUrl(url));
}

export function clearStorageUrl(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_URL_KEY);
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
    const reason =
      err instanceof Error
        ? err.name === "AbortError"
          ? "Timed out reaching server."
          : err.message
        : "Couldn't reach server.";
    return { state: "unreachable", reason };
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
  relays: string[] = DEFAULT_PUBLISH_RELAYS,
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
