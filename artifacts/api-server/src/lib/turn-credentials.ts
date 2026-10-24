import { createHmac } from "node:crypto";

/**
 * ICE server list for the live preview mesh.
 *
 * STUN alone connects most peers; peers behind strict NATs need a TURN
 * relay. TURN credentials are time-limited and derived from a shared secret
 * the way coturn's `use-auth-secret` expects (username `expiry:user`,
 * credential `base64(HMAC-SHA1(secret, username))`), so the browser never
 * holds the secret and a leaked credential dies with its expiry.
 *
 * Configuration (environment of the API process):
 *   TURN_URLS           comma-separated, e.g. turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349
 *   TURN_SHARED_SECRET  the `static-auth-secret` of the coturn instance
 *   TURN_TTL_SECONDS    credential lifetime (default 43200, twelve hours)
 *   STUN_URLS           optional override of the public STUN defaults
 */

export type IceServer = {
  urls: string[];
  username?: string;
  credential?: string;
};

export type IceServersResult = {
  iceServers: IceServer[];
  /** Seconds the TURN credential stays valid; 0 when no TURN is configured. */
  ttlSeconds: number;
  turnConfigured: boolean;
};

const DEFAULT_STUN_URLS = [
  "stun:stun.l.google.com:19302",
  "stun:stun.cloudflare.com:3478",
];
const DEFAULT_TTL_SECONDS = 12 * 60 * 60;

function list(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export type TurnEnv = {
  TURN_URLS?: string;
  TURN_SHARED_SECRET?: string;
  TURN_TTL_SECONDS?: string;
  STUN_URLS?: string;
};

/** Pure: build the list for `userId` at `nowMs` from the given environment. */
export function buildIceServers(
  userId: string,
  env: TurnEnv,
  nowMs: number = Date.now(),
): IceServersResult {
  const stunUrls = list(env.STUN_URLS);
  const servers: IceServer[] = [
    { urls: stunUrls.length ? stunUrls : DEFAULT_STUN_URLS },
  ];

  const turnUrls = list(env.TURN_URLS);
  const secret = env.TURN_SHARED_SECRET?.trim();
  if (turnUrls.length === 0 || !secret) {
    return { iceServers: servers, ttlSeconds: 0, turnConfigured: false };
  }

  const ttlRaw = Number(env.TURN_TTL_SECONDS);
  const ttlSeconds =
    Number.isFinite(ttlRaw) && ttlRaw > 0
      ? Math.floor(ttlRaw)
      : DEFAULT_TTL_SECONDS;
  const expiry = Math.floor(nowMs / 1000) + ttlSeconds;
  // The user part is informational for coturn's logs; keep it short.
  const username = `${expiry}:${userId.slice(0, 16)}`;
  const credential = createHmac("sha1", secret)
    .update(username)
    .digest("base64");
  servers.push({ urls: turnUrls, username, credential });
  return { iceServers: servers, ttlSeconds, turnConfigured: true };
}
