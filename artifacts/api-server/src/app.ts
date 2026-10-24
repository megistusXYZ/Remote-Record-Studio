import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { httpLogSerializers } from "./lib/log-serializers";
import { publicIpLimiter } from "./middlewares/rate-limit";
import { errorHandler, notFoundHandler } from "./middlewares/error-handler";

const app: Express = express();

// Trust the upstream proxy (Replit edge / any CDN in front) so that
// `req.protocol` and `req.get("host")` reflect what the client actually
// targeted. NIP-98 binds the auth event to the absolute request URL, so
// these must match what the client signed.
app.set("trust proxy", true);

app.use(
  pinoHttp({
    logger,
    serializers: httpLogSerializers,
  }),
);

// Security response headers, API-tuned. We deliberately:
//   - leave CSP off (CSP belongs on the web client only — this is a JSON API
//     consumed cross-origin),
//   - leave Cross-Origin-Embedder-Policy / Cross-Origin-Opener-Policy off so
//     the web client (which talks to many third-party storage / signaling
//     origins) isn't accidentally locked into require-corp,
//   - keep HSTS conservative (1 year, subdomains, no preload by default — a
//     maintainer can flip preload via env once they've committed to it).
const helmetEnabled =
  (process.env["VESSEL_HELMET_ENABLED"] ?? "true").toLowerCase() !== "false";
if (helmetEnabled) {
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
      referrerPolicy: { policy: "no-referrer" },
      hsts: {
        maxAge: 60 * 60 * 24 * 365,
        includeSubDomains: true,
        preload: false,
      },
      // Helmet's defaults already cover X-Content-Type-Options, X-DNS-Prefetch-
      // Control, X-Download-Options, X-Frame-Options (DENY), X-Permitted-
      // Cross-Domain-Policies, X-XSS-Protection (off, modern browsers ignore).
    }),
  );
}

app.use(cors());

// Per-IP rate limit on EVERYTHING under /api. Skips /api/healthz internally
// so monitoring can't be locked out. Ships in observe mode by default — see
// rate-limit.ts and OPERATIONS.md for the env-var contract.
//
// The TIGHTER per-IP limit for `GET /api/sessions/:id` (the only
// unauthenticated DB-touching endpoint) is mounted as route-level
// middleware in `routes/sessions.ts` so it only fires on that specific
// GET, not on every other method/sub-path under /api/sessions/:id/...
app.use("/api", publicIpLimiter());

// Tight body-size limit per parser. None of our current endpoints accept
// anything close to 16 KB; the largest signed event today is a few KB.
// `limit` rejects oversized bodies with a 413 before parsing.
// `verify` keeps the raw bytes so signed requests can be bound to their
// body (see require-signed-request.ts). Both parsers share the hook.
const keepRawBody = (req: express.Request, _res: express.Response, buf: Buffer) => {
  (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
};
app.use(express.json({ limit: "16kb", verify: keepRawBody }));
app.use(express.urlencoded({ extended: true, limit: "16kb", verify: keepRawBody }));

app.use("/api", router);

// 404 must come AFTER all routes but BEFORE the error handler.
app.use(notFoundHandler);

// Global error handler is the last middleware; Express recognizes the
// 4-argument signature and only invokes it on `next(err)` or a thrown
// error in an async handler.
app.use(errorHandler);

export default app;
