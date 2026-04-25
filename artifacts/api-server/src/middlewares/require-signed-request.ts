import type { Request, Response, NextFunction, RequestHandler } from "express";
import { verifyEvent, type Event as NostrEvent } from "nostr-tools/pure";

/**
 * Request after `requireSignedRequest` has run successfully. The middleware
 * verifies the NIP-98 auth event and stamps the request with the verified
 * pubkey before calling `next()`. Route handlers downstream of the middleware
 * can rely on `authPubkey` being present.
 *
 * We keep this as an intersection type rather than augmenting Express's
 * global `Request` interface so the dependency stays local and other modules
 * don't accidentally type-check as if every Request were authed.
 */
export type AuthedRequest = Request & { authPubkey: string };

/**
 * Local request shape used inside this module. `authPubkey` is optional so
 * we can read it before/while setting it without fighting the type system.
 */
type MaybeAuthedRequest = Request & { authPubkey?: string };

/**
 * NIP-98 HTTP Auth event kind. The auth event is a regular nostr event
 * whose tags bind it to a specific HTTP request:
 *   - `u` tag: the absolute URL the request is made to
 *   - `method` tag: the HTTP verb (uppercase)
 * The event MUST be signed by the pubkey we want to authenticate as.
 */
const AUTH_EVENT_KIND = 27235;

/**
 * Acceptance window for `created_at`. NIP-98 recommends ~60 seconds; we use
 * ±60 to absorb modest client/server clock skew while making replay windows
 * very short.
 */
const FRESHNESS_WINDOW_SECONDS = 60;

interface AuthFailure {
  status: 401;
  reason: string;
}

function fail(reason: string): AuthFailure {
  return { status: 401, reason };
}

function decodeAuthHeader(header: string | undefined): NostrEvent | AuthFailure {
  if (!header) return fail("missing Authorization header");
  const trimmed = header.trim();
  if (!trimmed.toLowerCase().startsWith("nostr ")) {
    return fail("Authorization scheme must be 'Nostr'");
  }
  const payload = trimmed.slice(6).trim();
  if (!payload) return fail("Authorization payload is empty");

  let json: string;
  try {
    // Buffer.from is forgiving about padding and accepts both base64 and
    // base64url alphabets — both are common in the wild.
    json = Buffer.from(payload, "base64").toString("utf8");
  } catch {
    return fail("Authorization payload is not valid base64");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return fail("Authorization payload is not valid JSON");
  }

  if (!isPlausibleNostrEvent(parsed)) {
    return fail("Authorization payload is not a well-formed nostr event");
  }
  return parsed;
}

function isPlausibleNostrEvent(value: unknown): value is NostrEvent {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.pubkey === "string" &&
    typeof v.sig === "string" &&
    typeof v.created_at === "number" &&
    typeof v.kind === "number" &&
    typeof v.content === "string" &&
    Array.isArray(v.tags)
  );
}

function findTag(event: NostrEvent, name: string): string | undefined {
  for (const tag of event.tags) {
    if (Array.isArray(tag) && tag[0] === name && typeof tag[1] === "string") {
      return tag[1];
    }
  }
  return undefined;
}

/**
 * Reconstruct the absolute URL the client targeted. Trusts proxy headers
 * (X-Forwarded-Proto / Host) — `app.set("trust proxy", true)` must be set
 * on the Express app for `req.protocol` to honor them.
 */
function buildRequestUrl(req: Request): string {
  const host = req.get("host");
  if (!host) return req.originalUrl;
  return `${req.protocol}://${host}${req.originalUrl}`;
}

/**
 * Compare two URLs for equality with a small amount of normalization so
 * trivial differences (default ports, trailing-slash, hash fragments) don't
 * cause spurious 401s. Query params and path are matched strictly.
 */
function urlsMatch(a: string, b: string): boolean {
  let pa: URL;
  let pb: URL;
  try {
    pa = new URL(a);
    pb = new URL(b);
  } catch {
    return a === b;
  }
  if (pa.protocol !== pb.protocol) return false;
  if (pa.hostname.toLowerCase() !== pb.hostname.toLowerCase()) return false;
  // Treat default ports as equivalent ("" == "443" for https, "80" for http).
  const portA = pa.port || (pa.protocol === "https:" ? "443" : "80");
  const portB = pb.port || (pb.protocol === "https:" ? "443" : "80");
  if (portA !== portB) return false;
  // Strip a single trailing slash for comparison.
  const pathA = pa.pathname.replace(/\/+$/, "");
  const pathB = pb.pathname.replace(/\/+$/, "");
  if (pathA !== pathB) return false;
  if (pa.search !== pb.search) return false;
  return true;
}

function verifyAuthEvent(
  event: NostrEvent,
  expectedMethod: string,
  expectedUrl: string,
): AuthFailure | null {
  if (event.kind !== AUTH_EVENT_KIND) {
    return fail(`auth event must be kind ${AUTH_EVENT_KIND}`);
  }

  const now = Math.floor(Date.now() / 1000);
  const skew = Math.abs(now - event.created_at);
  if (skew > FRESHNESS_WINDOW_SECONDS) {
    return fail(
      `auth event timestamp is outside the ${FRESHNESS_WINDOW_SECONDS}s freshness window`,
    );
  }

  const methodTag = findTag(event, "method");
  if (!methodTag) return fail("auth event is missing 'method' tag");
  if (methodTag.toUpperCase() !== expectedMethod.toUpperCase()) {
    return fail("auth event 'method' tag does not match request method");
  }

  const urlTag = findTag(event, "u");
  if (!urlTag) return fail("auth event is missing 'u' tag");
  if (!urlsMatch(urlTag, expectedUrl)) {
    return fail("auth event 'u' tag does not match request URL");
  }

  // Most expensive check last: signature + id integrity.
  if (!verifyEvent(event)) {
    return fail("auth event signature is invalid");
  }

  return null;
}

/**
 * Express middleware that requires every request to carry a valid NIP-98
 * `Authorization: Nostr <base64-signed-event>` header. On success, the
 * verified pubkey is attached to `req.authPubkey`. On failure, the request
 * is rejected with 401 and a reason in the JSON body.
 *
 * The 401 body intentionally explains *why* — these are cooperating clients,
 * not adversaries trying to learn things from error messages, and a vague
 * 401 has historically wasted hours of integration debugging.
 */
export function requireSignedRequest(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const decoded = decodeAuthHeader(req.get("authorization"));
    if ("status" in decoded) {
      res.status(decoded.status).json({ error: `unauthorized: ${decoded.reason}` });
      return;
    }
    const expectedUrl = buildRequestUrl(req);
    const verifyFailure = verifyAuthEvent(decoded, req.method, expectedUrl);
    if (verifyFailure) {
      res
        .status(verifyFailure.status)
        .json({ error: `unauthorized: ${verifyFailure.reason}` });
      return;
    }
    (req as MaybeAuthedRequest).authPubkey = decoded.pubkey;
    next();
  };
}

/**
 * Express middleware that verifies a NIP-98 auth header *if one is present*
 * and stamps `req.authPubkey` on success, but never rejects on missing or
 * invalid auth — the request continues either way.
 *
 * Use on endpoints that have a public mode (e.g. invite-code lookup) but
 * also expose a stricter mode that needs the verified pubkey (e.g.
 * direct-by-UUID lookup, restricted to the session's host or participants).
 *
 * Failure conditions are silently ignored here so attackers can't probe the
 * exact rejection reason; the route handler decides whether the absence of
 * `req.authPubkey` is acceptable for the operation.
 */
export function attachOptionalSignedAuth(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const header = req.get("authorization");
    if (!header) {
      next();
      return;
    }
    const decoded = decodeAuthHeader(header);
    if ("status" in decoded) {
      next();
      return;
    }
    const expectedUrl = buildRequestUrl(req);
    const verifyFailure = verifyAuthEvent(decoded, req.method, expectedUrl);
    if (verifyFailure) {
      next();
      return;
    }
    (req as MaybeAuthedRequest).authPubkey = decoded.pubkey;
    next();
  };
}

/**
 * Read the verified pubkey set by `requireSignedRequest` or
 * `attachOptionalSignedAuth`. Returns `undefined` if no middleware has
 * verified the request — callers should treat that as unauthenticated.
 */
export function getAuthPubkey(req: Request): string | undefined {
  return (req as MaybeAuthedRequest).authPubkey;
}

/**
 * Reject the request unless `claimedPubkey` exactly matches the verified
 * `req.authPubkey`. Callers use this on routes that take a pubkey in the
 * body/query/path so a holder of identity X cannot read or mutate data
 * scoped to identity Y.
 *
 * Returns `true` when the request should be rejected. The middleware
 * has already responded to the caller; the route handler should `return`.
 */
export function rejectIfPubkeyMismatch(
  req: Request,
  res: Response,
  claimedPubkey: string | undefined,
): boolean {
  const authPubkey = getAuthPubkey(req);
  if (!authPubkey) {
    res.status(401).json({ error: "unauthorized: missing verified pubkey" });
    return true;
  }
  if (!claimedPubkey || claimedPubkey !== authPubkey) {
    res.status(401).json({
      error: "unauthorized: claimed pubkey does not match signing pubkey",
    });
    return true;
  }
  return false;
}
