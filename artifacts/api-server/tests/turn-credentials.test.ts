import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { buildIceServers } from "../src/lib/turn-credentials";

const NOW = 1_700_000_000_000;

describe("buildIceServers", () => {
  it("returns public STUN only when TURN is not configured", () => {
    const r = buildIceServers("abc", {}, NOW);
    expect(r.turnConfigured).toBe(false);
    expect(r.ttlSeconds).toBe(0);
    expect(r.iceServers).toHaveLength(1);
    expect(r.iceServers[0]!.urls[0]).toMatch(/^stun:/);
    expect(r.iceServers[0]!.username).toBeUndefined();
  });

  it("needs both TURN urls and a secret", () => {
    expect(
      buildIceServers("abc", { TURN_URLS: "turn:t.example:3478" }, NOW)
        .turnConfigured,
    ).toBe(false);
    expect(
      buildIceServers("abc", { TURN_SHARED_SECRET: "s" }, NOW).turnConfigured,
    ).toBe(false);
  });

  it("issues coturn-style time-limited credentials", () => {
    const r = buildIceServers(
      "0123456789abcdef0123456789abcdef",
      {
        TURN_URLS:
          "turn:turn.example.com:3478?transport=udp, turns:turn.example.com:5349",
        TURN_SHARED_SECRET: "top-secret",
        TURN_TTL_SECONDS: "600",
        STUN_URLS: "stun:stun.example.com:3478",
      },
      NOW,
    );
    expect(r.turnConfigured).toBe(true);
    expect(r.ttlSeconds).toBe(600);
    expect(r.iceServers[0]).toEqual({ urls: ["stun:stun.example.com:3478"] });
    const turn = r.iceServers[1]!;
    expect(turn.urls).toEqual([
      "turn:turn.example.com:3478?transport=udp",
      "turns:turn.example.com:5349",
    ]);
    const expiry = Math.floor(NOW / 1000) + 600;
    expect(turn.username).toBe(`${expiry}:0123456789abcdef`);
    expect(turn.credential).toBe(
      createHmac("sha1", "top-secret").update(turn.username!).digest("base64"),
    );
  });

  it("falls back to a twelve-hour lifetime for a bad TTL", () => {
    const r = buildIceServers(
      "abc",
      {
        TURN_URLS: "turn:t.example:3478",
        TURN_SHARED_SECRET: "s",
        TURN_TTL_SECONDS: "nope",
      },
      NOW,
    );
    expect(r.ttlSeconds).toBe(43200);
  });
});
