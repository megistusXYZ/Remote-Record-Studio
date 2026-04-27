import type {
  Request,
  Response,
  NextFunction,
  ErrorRequestHandler,
} from "express";
import { logger } from "../lib/logger";

/**
 * Internal terms that must NEVER reach a user-visible response body. This
 * mirrors the project-wide forbidden-vocabulary policy (Privacy /
 * branding-drift guard). The error handler scrubs any of these strings
 * defensively before serializing — the route handlers should never
 * surface them, but a thrown library error could still mention them.
 */
const FORBIDDEN_TERMS: readonly string[] = [
  "nostr",
  "nsec",
  "npub",
  "keypair",
  "pubkey",
  "blossom",
  "moq",
  "webtransport",
  "mediarecorder",
  "getusermedia",
  "indexeddb",
  "quic",
  "naddr",
  "whisper",
  "transformers.js",
  "wasm",
  "relay",
];

function containsForbiddenTerm(text: string): boolean {
  const lower = text.toLowerCase();
  for (const term of FORBIDDEN_TERMS) {
    if (lower.includes(term)) return true;
  }
  return false;
}

function getRequestId(req: Request): string | undefined {
  // pino-http stamps `req.id` so a maintainer can find the full failure
  // log by the same id we hand back to the client. We read it loosely so
  // we don't have to widen the global Express Request typing.
  const id = (req as unknown as { id?: unknown }).id;
  if (id === undefined || id === null) return undefined;
  return String(id);
}

/**
 * Catch-all 404 handler. Mounted AFTER all routes. Returns a generic
 * JSON body so probing for hidden endpoints doesn't leak which paths
 * exist.
 *
 * `HEAD` requests get an empty body — RFC 7231 forbids a body on HEAD
 * responses, and Express's default JSON write would still set
 * Content-Type which some clients dislike.
 */
export function notFoundHandler(req: Request, res: Response): void {
  if (req.method === "HEAD") {
    res.status(404).end();
    return;
  }
  res.status(404).json({ error: "not_found" });
}

/**
 * Global error handler. Mounted AFTER all routes and the 404 handler.
 *
 * Behavior:
 * - Logs the full error with the request's pino `requestId` so the
 *   maintainer can correlate the user's friendly error with the full
 *   stack server-side.
 * - Returns `{error:"internal_error", requestId}` to the client. Never
 *   the stack, never an internal path.
 * - Defensive scrub: if some upstream library error message contains
 *   one of the forbidden internal vocabulary terms, it would never have
 *   leaked anyway (we don't put `err.message` in the response), but the
 *   defensive check is here as a tripwire so a future refactor that
 *   changes this can't regress silently.
 *
 * Express requires the 4-argument signature for error middleware, so the
 * unused `_next` parameter is intentional.
 */
export const errorHandler: ErrorRequestHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  const requestId = getRequestId(req);

  logger.error(
    {
      err,
      requestId,
      method: req.method,
      path: req.originalUrl.split("?")[0],
    },
    "unhandled-route-error",
  );

  // If headers were already sent (e.g. error mid-stream), Express will
  // close the connection itself — we just delegate.
  if (res.headersSent) {
    _next(err);
    return;
  }

  // Static body. We do NOT echo any portion of `err.message`. The
  // forbidden-term check below runs on the static body to keep this
  // function honest if the body shape ever changes.
  const body = {
    error: "internal_error",
    ...(requestId ? { requestId } : {}),
  };

  // Tripwire — if this ever logs, someone added a dynamic value to the
  // error body without thinking about disclosure.
  const serialized = JSON.stringify(body);
  if (containsForbiddenTerm(serialized)) {
    logger.error(
      { requestId },
      "error-handler tried to emit a forbidden internal term — body suppressed",
    );
    res.status(500).json({ error: "internal_error" });
    return;
  }

  res.status(500).json(body);
};
