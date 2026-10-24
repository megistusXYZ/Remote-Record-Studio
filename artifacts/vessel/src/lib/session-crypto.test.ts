// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetSessionKeyCache,
  deriveSessionKey,
  openSignal,
  parseEnvelope,
  sealSignal,
} from "./session-crypto";

describe("session-crypto", () => {
  beforeEach(() => __resetSessionKeyCache());

  it("seals and opens a message with the session key", async () => {
    const key = await deriveSessionKey("session-1", "abc12XYZ");
    const sealed = await sealSignal(key, JSON.stringify({ text: "hello" }));
    const env = parseEnvelope(sealed);
    expect(env).not.toBeNull();
    expect(env!.v).toBe(1);
    expect(sealed).not.toContain("hello");
    expect(await openSignal(key, env!)).toBe(JSON.stringify({ text: "hello" }));
  });

  it("uses a different key per session even with the same invite code", async () => {
    const k1 = await deriveSessionKey("session-1", "same");
    const k2 = await deriveSessionKey("session-2", "same");
    const sealed = await sealSignal(k1, "secret");
    expect(await openSignal(k2, parseEnvelope(sealed)!)).toBeNull();
  });

  it("refuses a wrong invite code", async () => {
    const good = await deriveSessionKey("s", "right");
    const bad = await deriveSessionKey("s", "wrong");
    const sealed = await sealSignal(good, "secret");
    expect(await openSignal(bad, parseEnvelope(sealed)!)).toBeNull();
  });

  it("produces a fresh nonce every time", async () => {
    const key = await deriveSessionKey("s", "code");
    const a = parseEnvelope(await sealSignal(key, "x"))!;
    const b = parseEnvelope(await sealSignal(key, "x"))!;
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it("tells envelopes apart from plain JSON and junk", () => {
    expect(parseEnvelope('{"displayName":"Sam"}')).toBeNull();
    expect(parseEnvelope("not json")).toBeNull();
    expect(parseEnvelope("")).toBeNull();
    expect(parseEnvelope('{"v":1,"iv":"AAAA","ct":"BBBB"}')).toEqual({
      v: 1,
      iv: "AAAA",
      ct: "BBBB",
    });
  });
});
