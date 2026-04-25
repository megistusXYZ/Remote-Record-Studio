import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { sessionsTable } from "@workspace/db/schema";
import { participantsTable } from "@workspace/db/schema";
import { recordingsTable } from "@workspace/db/schema";
import {
  reqSerializer,
  resSerializer,
  httpLogSerializers,
} from "../src/lib/log-serializers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_TS_PATH = resolve(__dirname, "../src/app.ts");

const PRIVACY_NOTICE_PATH = "artifacts/vessel/src/pages/privacy.tsx";

const failureHint = (subject: string) =>
  `\n\n${subject} drifted from what the Privacy notice claims.\n` +
  `If this change is intentional, update ${PRIVACY_NOTICE_PATH} to disclose ` +
  `the new field, then update the allow-list in this test.\n`;

const DISCLOSED_DB_COLUMNS = {
  sessions: new Set([
    "id",
    "title",
    "host_pubkey",
    "host_name",
    "status",
    "invite_code",
    "participant_count",
    "created_at",
    "started_at",
    "ended_at",
  ]),
  participants: new Set([
    "id",
    "session_id",
    "pubkey",
    "display_name",
    "role",
    "joined_at",
  ]),
  recordings: new Set([
    "id",
    "session_id",
    "session_title",
    "owner_pubkey",
    "participant_name",
    "duration_seconds",
    "size_bytes",
    "mime_type",
    "blob_hash",
    "blob_url",
    "status",
    "created_at",
  ]),
} as const;

const DISCLOSED_LOG_FIELDS = {
  req: new Set(["id", "method", "url"]),
  res: new Set(["statusCode"]),
} as const;

function actualColumnNames(table: Parameters<typeof getTableColumns>[0]) {
  return new Set(
    Object.values(getTableColumns(table)).map((c) => (c as { name: string }).name),
  );
}

function diff(actual: Set<string>, allowed: Set<string>) {
  const undisclosed = [...actual].filter((k) => !allowed.has(k)).sort();
  const stale = [...allowed].filter((k) => !actual.has(k)).sort();
  return { undisclosed, stale };
}

describe("privacy notice drift guard", () => {
  describe("database schema", () => {
    it("sessions table columns match the Privacy notice disclosure", () => {
      const { undisclosed, stale } = diff(
        actualColumnNames(sessionsTable),
        DISCLOSED_DB_COLUMNS.sessions,
      );
      expect(
        undisclosed,
        `Undisclosed sessions columns: ${JSON.stringify(undisclosed)}.` +
          failureHint("`sessions` table schema"),
      ).toEqual([]);
      expect(
        stale,
        `Privacy notice mentions removed sessions columns: ${JSON.stringify(stale)}.` +
          failureHint("`sessions` table schema"),
      ).toEqual([]);
    });

    it("participants table columns match the Privacy notice disclosure", () => {
      const { undisclosed, stale } = diff(
        actualColumnNames(participantsTable),
        DISCLOSED_DB_COLUMNS.participants,
      );
      expect(
        undisclosed,
        `Undisclosed participants columns: ${JSON.stringify(undisclosed)}.` +
          failureHint("`participants` table schema"),
      ).toEqual([]);
      expect(
        stale,
        `Privacy notice mentions removed participants columns: ${JSON.stringify(stale)}.` +
          failureHint("`participants` table schema"),
      ).toEqual([]);
    });

    it("recordings table columns match the Privacy notice disclosure", () => {
      const { undisclosed, stale } = diff(
        actualColumnNames(recordingsTable),
        DISCLOSED_DB_COLUMNS.recordings,
      );
      expect(
        undisclosed,
        `Undisclosed recordings columns: ${JSON.stringify(undisclosed)}.` +
          failureHint("`recordings` table schema"),
      ).toEqual([]);
      expect(
        stale,
        `Privacy notice mentions removed recordings columns: ${JSON.stringify(stale)}.` +
          failureHint("`recordings` table schema"),
      ).toEqual([]);
    });
  });

  describe("pino-http serializer wiring in app.ts", () => {
    const appSource = readFileSync(APP_TS_PATH, "utf8");

    it("imports the shared httpLogSerializers from ./lib/log-serializers", () => {
      const importPattern =
        /import\s*\{[^}]*\bhttpLogSerializers\b[^}]*\}\s*from\s*["']\.\/lib\/log-serializers["']/;
      expect(
        importPattern.test(appSource),
        `${APP_TS_PATH} no longer imports \`httpLogSerializers\` from \`./lib/log-serializers\`. ` +
          `The privacy-drift tests inspect that module; if you wire pino-http to a different ` +
          `serializer source, the disclosure in ${PRIVACY_NOTICE_PATH} is no longer guarded.`,
      ).toBe(true);
    });

    it("passes httpLogSerializers (not an inline object) to pinoHttp", () => {
      const wiringPattern =
        /pinoHttp\s*\(\s*\{[^}]*\bserializers\s*:\s*httpLogSerializers\b[^}]*\}\s*\)/s;
      expect(
        wiringPattern.test(appSource),
        `${APP_TS_PATH} must call \`pinoHttp({ ..., serializers: httpLogSerializers })\`. ` +
          `An inline serializers object would bypass this drift guard, letting new request/response ` +
          `log fields ship without updating ${PRIVACY_NOTICE_PATH}.`,
      ).toBe(true);
    });

    it("does not define inline req/res serializer functions in app.ts", () => {
      // If someone reintroduces inline serializers (e.g. `req(req) { ... }` or
      // `req: (req) => ({...})`) inside the pinoHttp() call, the dedicated
      // serializer module is no longer the single source of truth and this
      // drift guard becomes a lie. Catch that pattern explicitly.
      const inlinePatterns: RegExp[] = [
        /\breq\s*\([^)]*\)\s*\{/,
        /\bres\s*\([^)]*\)\s*\{/,
        /\breq\s*:\s*\([^)]*\)\s*=>/,
        /\bres\s*:\s*\([^)]*\)\s*=>/,
        /\breq\s*:\s*function\b/,
        /\bres\s*:\s*function\b/,
      ];
      const offenders = inlinePatterns
        .filter((p) => p.test(appSource))
        .map((p) => p.source);
      expect(
        offenders,
        `${APP_TS_PATH} appears to define inline pino serializer(s) (${JSON.stringify(offenders)}). ` +
          `Move them into \`src/lib/log-serializers.ts\` so the privacy-drift test can see them, ` +
          `and update ${PRIVACY_NOTICE_PATH} if any new fields are emitted.`,
      ).toEqual([]);
    });
  });

  describe("pino-http serializers", () => {
    const fakeReq = {
      id: "req-1",
      method: "GET",
      url: "/api/sessions?secret=should-be-stripped",
      headers: { authorization: "Bearer should-not-leak", cookie: "x=1" },
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as Parameters<typeof reqSerializer>[0];

    const fakeRes = {
      statusCode: 200,
      getHeaders: () => ({ "set-cookie": "should-not-leak" }),
    } as unknown as Parameters<typeof resSerializer>[0];

    it("the registered serializers are the ones the test inspects", () => {
      expect(httpLogSerializers.req).toBe(reqSerializer);
      expect(httpLogSerializers.res).toBe(resSerializer);
    });

    it("req serializer emits only the fields the Privacy notice discloses", () => {
      const emitted = new Set(Object.keys(reqSerializer(fakeReq)));
      const { undisclosed, stale } = diff(emitted, DISCLOSED_LOG_FIELDS.req);
      expect(
        undisclosed,
        `Undisclosed req log fields: ${JSON.stringify(undisclosed)}.` +
          failureHint("pino-http `req` serializer"),
      ).toEqual([]);
      expect(
        stale,
        `Privacy notice mentions removed req log fields: ${JSON.stringify(stale)}.` +
          failureHint("pino-http `req` serializer"),
      ).toEqual([]);
    });

    it("res serializer emits only the fields the Privacy notice discloses", () => {
      const emitted = new Set(Object.keys(resSerializer(fakeRes)));
      const { undisclosed, stale } = diff(emitted, DISCLOSED_LOG_FIELDS.res);
      expect(
        undisclosed,
        `Undisclosed res log fields: ${JSON.stringify(undisclosed)}.` +
          failureHint("pino-http `res` serializer"),
      ).toEqual([]);
      expect(
        stale,
        `Privacy notice mentions removed res log fields: ${JSON.stringify(stale)}.` +
          failureHint("pino-http `res` serializer"),
      ).toEqual([]);
    });

    it("req serializer strips the query string from the url", () => {
      const out = reqSerializer(fakeReq);
      expect(out.url).toBe("/api/sessions");
    });
  });
});
