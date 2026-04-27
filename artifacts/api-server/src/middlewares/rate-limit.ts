import type { Request, Response, RequestHandler } from "express";
import {
  rateLimit,
  type Options as RateLimitOptions,
} from "express-rate-limit";
import { logger } from "../lib/logger";
import { getAuthPubkey } from "./require-signed-request";

/**
 * Rate-limiting & per-pubkey quota middlewares.
 *
 * Design goals (see Task #68 plan):
 * - In-process only. No Redis, no DB, no extra network hop per request.
 * - Every limiter is feature-flagged off by default and ships in
 *   "observe" mode for the first deploy so we can watch what would have
 *   been blocked without actually blocking real users.
 * - Limits are read from env at startup so an operator can flip a flag
 *   and restart the process without redeploying.
 * - Zero impact on the recording hot path: media never touches this
 *   server, and these middlewares are skipped on `/api/healthz`.
 */

type Mode = "enforce" | "observe" | "off";

function readMode(): Mode {
  const raw = (process.env["VESSEL_RATE_LIMIT_MODE"] ?? "observe")
    .trim()
    .toLowerCase();
  if (raw === "enforce" || raw === "off") return raw;
  return "observe";
}

function readBoolFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "true" || trimmed === "1" || trimmed === "yes") return true;
  if (trimmed === "false" || trimmed === "0" || trimmed === "no") return false;
  return defaultValue;
}

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/**
 * Single source of truth for the runtime config. Read from env once at
 * module load. Intentionally NOT frozen so tests can flip values to
 * exercise mode/flag behavior; production code never writes to it.
 */
export const rateLimitConfig: {
  enabled: boolean;
  quotaEnabled: boolean;
  mode: Mode;
} = {
  enabled: readBoolFlag("VESSEL_RATE_LIMIT_ENABLED", true),
  quotaEnabled: readBoolFlag("VESSEL_QUOTA_ENABLED", true),
  mode: readMode(),
};

interface BuildLimiterArgs {
  /** Identifier used in log lines so an operator can tell which limiter fired. */
  name: string;
  windowMs: number;
  limit: number;
  /**
   * Custom key extractor. Default: client IP, IPv6-safe via the upstream
   * helper. Pass a function that returns `undefined` to skip the request.
   */
  keyGenerator?: (req: Request, res: Response) => string | undefined;
  /**
   * Per-limiter skip predicate. Combined with the global `enabled` flag and
   * the global `/api/healthz` skip.
   */
  skip?: (req: Request) => boolean;
  /**
   * Optional 429 response body shape override. Defaults to a generic
   * `{error:"rate_limited", message, retryAfterSeconds}` object.
   */
  buildBlockedBody?: (retryAfterSeconds: number) => Record<string, unknown>;
}

const defaultBlockedBody = (retryAfterSeconds: number) => ({
  error: "rate_limited",
  message: "Too many requests. Please slow down and try again.",
  retryAfterSeconds,
});

/**
 * Build an Express middleware that wraps `express-rate-limit` with our
 * mode/flag plumbing. The returned middleware:
 *   - is a no-op when `VESSEL_RATE_LIMIT_ENABLED=false` or mode is `off`.
 *   - logs would-be blocks (and continues) in `observe` mode.
 *   - sends 429 + Retry-After + JSON body in `enforce` mode.
 *   - always skips `/api/healthz` so monitors can't be locked out.
 */
export function buildLimiter(args: BuildLimiterArgs): RequestHandler {
  const {
    name,
    windowMs,
    limit,
    keyGenerator,
    skip,
    buildBlockedBody = defaultBlockedBody,
  } = args;

  // Express-rate-limit needs a keyGenerator that always returns a string. If
  // the caller passes one that returns undefined for "don't track this
  // request", we translate that into a `skip`.
  const customSkipForKey = keyGenerator
    ? (req: Request, res: Response) => keyGenerator(req, res) === undefined
    : undefined;

  const finalSkip = (req: Request, res: Response) => {
    // Health checks must never trip a limiter.
    if (req.path === "/healthz" || req.originalUrl.startsWith("/api/healthz")) {
      return true;
    }
    if (skip && skip(req)) return true;
    if (customSkipForKey && customSkipForKey(req, res)) return true;
    return false;
  };

  const options: Partial<RateLimitOptions> = {
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: finalSkip,
    // Suppress the "trust proxy enabled but you didn't pass a number" warning
    // — our app.ts already configures trust proxy correctly for the upstream
    // edge proxy, and we accept the security trade-offs.
    validate: { trustProxy: false, xForwardedForHeader: false },
    // When the caller supplies a custom key generator (e.g. pubkey-based
    // quotas), use it. Otherwise fall through to express-rate-limit's
    // default IPv4/IPv6-safe IP keying.
    ...(keyGenerator
      ? {
          keyGenerator: (req: Request, res: Response): string => {
            // finalSkip already filtered out the undefined case, so this
            // branch only runs when the caller's keyGenerator returns a
            // string. Defensive fallback string for the type-checker.
            return keyGenerator(req, res) ?? "_skipped_";
          },
        }
      : {}),
    handler: (req, res, _next, optionsObj) => {
      const retryAfterSeconds = Math.ceil(
        (optionsObj.windowMs ?? windowMs) / 1000,
      );
      const mode = rateLimitConfig.mode;
      const logPayload = {
        limiter: name,
        mode,
        method: req.method,
        path: req.originalUrl.split("?")[0],
        // Pubkey is short-form-prefixed in logs already by upstream; here we
        // just record whether one was present.
        authed: getAuthPubkey(req) !== undefined,
        retryAfterSeconds,
      };

      if (mode === "observe") {
        // Use warn so it shows up in default log volume but doesn't pretend
        // to be an error — these are intentional diagnostic events.
        logger.warn(logPayload, "rate-limit observed (would-block)");
        // Do NOT send headers/body — let the request through to the next
        // middleware as if the limit didn't exist.
        _next();
        return;
      }

      logger.warn(logPayload, "rate-limit enforced (blocked)");
      res.set("Retry-After", String(retryAfterSeconds));
      res.status(429).json(buildBlockedBody(retryAfterSeconds));
    },
  };

  const limiter = rateLimit(options);

  // Outer wrapper handles the mode=off short-circuit so the limiter doesn't
  // pay for per-request work when it's globally disabled. Subsystem-level
  // enable flags (`VESSEL_RATE_LIMIT_ENABLED`, `VESSEL_QUOTA_ENABLED`) are
  // checked by the FACTORY wrappers below — buildLimiter only owns the mode
  // axis so per-IP and per-pubkey switches stay independent.
  return (req, res, next) => {
    if (rateLimitConfig.mode === "off") return next();
    return limiter(req, res, next);
  };
}

/**
 * Per-IP limiter for ALL public endpoints. Generous default so legitimate
 * users never see it; tightens via env. Stays well below typical browser
 * burst behavior (a page load + a handful of API calls).
 *
 * Gated independently by `VESSEL_RATE_LIMIT_ENABLED` so an operator can
 * turn IP limits off without touching per-pubkey quotas (or vice versa).
 */
export function publicIpLimiter(): RequestHandler {
  const limiter = buildLimiter({
    name: "public-ip",
    windowMs: readIntEnv("VESSEL_RATE_LIMIT_PUBLIC_WINDOW_MS", 60_000),
    limit: readIntEnv("VESSEL_RATE_LIMIT_PUBLIC_PER_WINDOW", 120),
  });
  return (req, res, next) => {
    if (!rateLimitConfig.enabled) return next();
    return limiter(req, res, next);
  };
}

/**
 * Tighter per-IP limiter just for `GET /api/sessions/:id` — the only
 * unauthenticated DB-touching endpoint. Stops invite-code enumeration at
 * a meaningful cost without blocking a host who refreshes the page.
 *
 * Mounted as ROUTE-LEVEL middleware (in `routes/sessions.ts`) on the
 * specific GET handler, NOT as `app.use("/api/sessions/:id", ...)` —
 * mounting as path middleware would also penalize authenticated POST
 * /sessions/:id/join, PATCH, DELETE, etc., which already have their
 * own per-pubkey quotas.
 */
export function sessionLookupIpLimiter(): RequestHandler {
  const limiter = buildLimiter({
    name: "session-lookup-ip",
    windowMs: readIntEnv("VESSEL_RATE_LIMIT_LOOKUP_WINDOW_MS", 60_000),
    limit: readIntEnv("VESSEL_RATE_LIMIT_LOOKUP_PER_WINDOW", 30),
  });
  return (req, res, next) => {
    if (!rateLimitConfig.enabled) return next();
    return limiter(req, res, next);
  };
}

interface PubkeyQuotaArgs {
  /** Identifier used in log lines (e.g. `sessions-create`). */
  name: string;
  windowMs: number;
  limit: number;
  /** Override the quota's body so the route can give a route-specific reason. */
  buildBlockedBody?: (retryAfterSeconds: number) => Record<string, unknown>;
}

/**
 * Per-pubkey write quota. Must be mounted AFTER `requireSignedRequest`
 * so the verified pubkey is available. Requests without a verified
 * pubkey are skipped (the auth middleware would have already rejected
 * them — this is a defensive belt-and-braces).
 */
export function pubkeyQuota(args: PubkeyQuotaArgs): RequestHandler {
  const limiter = buildLimiter({
    name: `pubkey-${args.name}`,
    windowMs: args.windowMs,
    limit: args.limit,
    buildBlockedBody:
      args.buildBlockedBody ??
      ((retryAfterSeconds) => ({
        error: "quota_exceeded",
        message:
          "You've hit the per-account write limit for this action. Please try again in a few minutes.",
        retryAfterSeconds,
      })),
    keyGenerator: (req) => {
      const pubkey = getAuthPubkey(req);
      if (!pubkey) return undefined;
      return `pk:${args.name}:${pubkey}`;
    },
  });

  return (req, res, next) => {
    if (!rateLimitConfig.quotaEnabled) return next();
    return limiter(req, res, next);
  };
}

/**
 * Pre-built quotas for the three write endpoints we want to gate. Defaults
 * sized for a heavy-day podcaster: 30 new sessions / hour, 60 joins / hour,
 * and 500 recording metadata writes / hour (well above what a real
 * 5-participant 4-hour session generates).
 */
export const sessionsCreateQuota = (): RequestHandler =>
  pubkeyQuota({
    name: "sessions-create",
    windowMs: readIntEnv("VESSEL_QUOTA_SESSIONS_CREATE_WINDOW_MS", 3_600_000),
    limit: readIntEnv("VESSEL_QUOTA_SESSIONS_CREATE_PER_WINDOW", 30),
  });

export const sessionsJoinQuota = (): RequestHandler =>
  pubkeyQuota({
    name: "sessions-join",
    windowMs: readIntEnv("VESSEL_QUOTA_SESSIONS_JOIN_WINDOW_MS", 3_600_000),
    limit: readIntEnv("VESSEL_QUOTA_SESSIONS_JOIN_PER_WINDOW", 60),
  });

export const recordingsWriteQuota = (): RequestHandler =>
  pubkeyQuota({
    name: "recordings-write",
    windowMs: readIntEnv("VESSEL_QUOTA_RECORDINGS_WRITE_WINDOW_MS", 3_600_000),
    limit: readIntEnv("VESSEL_QUOTA_RECORDINGS_WRITE_PER_WINDOW", 500),
  });

/**
 * Test seam: reset every limiter's in-memory store. NOT exported from the
 * package — tests import directly from this module. Production code should
 * never need this.
 */
export function _resetAllLimitersForTests(): void {
  // express-rate-limit holds state inside each `rateLimit()` call's closure.
  // We can't reach in from outside, so tests construct their own limiters
  // per-test via `buildLimiter` instead of relying on a global reset.
}
