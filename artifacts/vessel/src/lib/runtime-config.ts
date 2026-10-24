/**
 * Deployment settings read at runtime.
 *
 * One published web image serves every deployment: the container's
 * entrypoint writes `/config.js` from its environment (deploy/web-entrypoint.sh)
 * and index.html loads it before the app, so `window.__VESSEL_CONFIG__` is
 * set before any module here evaluates. Values in it win over the build-time
 * VITE_* variables, which remain the way to bake defaults into a custom
 * build and the only source in `pnpm dev` (public/config.js ships empty).
 *
 * Nothing here is secret; all of it reaches the browser.
 */

type RawConfig = {
  relays?: unknown;
  storageServer?: unknown;
  moqRelayUrl?: unknown;
};

function rawConfig(): RawConfig {
  if (typeof window === "undefined") return {};
  const value = (window as unknown as { __VESSEL_CONFIG__?: unknown })
    .__VESSEL_CONFIG__;
  return value && typeof value === "object" ? (value as RawConfig) : {};
}

function asList(value: unknown): string[] {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return items
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const isWebSocketUrl = (url: string): boolean => /^wss?:\/\//i.test(url);
const isHttpsUrl = (url: string): boolean => /^https:\/\//i.test(url);
const stripTrailingSlash = (url: string): string => url.replace(/\/+$/, "");

/**
 * Sync servers chosen by the deployment, in order. Empty when the operator
 * set none; callers then fall back to the built-in public list.
 */
export function deploymentRelays(): string[] {
  const fromRuntime = asList(rawConfig().relays).filter(isWebSocketUrl);
  if (fromRuntime.length > 0) return fromRuntime;
  return asList(import.meta.env.VITE_NOSTR_RELAYS).filter(isWebSocketUrl);
}

/** Default storage server for new studios, or null to use the built-in one. */
export function deploymentStorageServer(): string | null {
  const fromRuntime = asString(rawConfig().storageServer);
  if (isHttpsUrl(fromRuntime)) return stripTrailingSlash(fromRuntime);
  const fromEnv = asString(import.meta.env.VITE_BLOSSOM_SERVER);
  if (isHttpsUrl(fromEnv)) return stripTrailingSlash(fromEnv);
  return null;
}

/** Optional higher-capacity live preview server; "" when none is configured. */
export function deploymentMoqRelayUrl(): string {
  const fromRuntime = asString(rawConfig().moqRelayUrl);
  if (isHttpsUrl(fromRuntime)) return stripTrailingSlash(fromRuntime);
  const fromEnv = asString(import.meta.env.VITE_MOQ_RELAY_URL);
  if (isHttpsUrl(fromEnv)) return stripTrailingSlash(fromEnv);
  return "";
}
