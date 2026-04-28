import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_PUBLISH_RELAYS,
  PUBLISH_RELAYS_KEY,
  MAX_PUBLISH_RELAYS,
  getPublishRelays,
  setPublishRelays,
  hasLocalRelayChoice,
  clearPublishRelays,
  isValidRelayUrl,
  normalizeRelayUrl,
} from "./relay-config";

const PUBKEY = "abc123def456";

describe("relay-config — endpoint list lookup & migration", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("getPublishRelays precedence", () => {
    it("returns the defaults when nothing is set", () => {
      expect(getPublishRelays(PUBKEY)).toEqual([...DEFAULT_PUBLISH_RELAYS]);
    });

    it("returns a fresh array (defaults are not mutable through the result)", () => {
      const a = getPublishRelays();
      a.push("wss://injected.example");
      const b = getPublishRelays();
      expect(b).toEqual([...DEFAULT_PUBLISH_RELAYS]);
    });

    it("reads the scoped slot when present", () => {
      localStorage.setItem(
        `${PUBLISH_RELAYS_KEY}:${PUBKEY}`,
        JSON.stringify(["wss://a.example", "wss://b.example"]),
      );
      expect(getPublishRelays(PUBKEY)).toEqual([
        "wss://a.example",
        "wss://b.example",
      ]);
    });

    it("falls back to the global slot for an anonymous caller", () => {
      localStorage.setItem(
        PUBLISH_RELAYS_KEY,
        JSON.stringify(["wss://anon1.example", "wss://anon2.example"]),
      );
      expect(getPublishRelays()).toEqual([
        "wss://anon1.example",
        "wss://anon2.example",
      ]);
    });

    it("anonymous setPublishRelays roundtrips through the global slot", () => {
      // Symmetry guard: setPublishRelays(_, undefined) must produce data that
      // getPublishRelays(undefined) can read back. Without the global read
      // branch, this would silently fall back to the defaults.
      setPublishRelays(["wss://anon1.example", "wss://anon2.example"]);
      expect(getPublishRelays()).toEqual([
        "wss://anon1.example",
        "wss://anon2.example",
      ]);
    });

    it("global slot is also visible to a scoped-pubkey caller (without a scoped list)", () => {
      // Mirrors storage-config: an anonymous-write made before sign-in should
      // NOT become unreadable once the user signs in.
      localStorage.setItem(
        PUBLISH_RELAYS_KEY,
        JSON.stringify(["wss://anon.example"]),
      );
      expect(getPublishRelays(PUBKEY)).toEqual(["wss://anon.example"]);
    });

    it("scoped slot wins over global slot", () => {
      localStorage.setItem(
        PUBLISH_RELAYS_KEY,
        JSON.stringify(["wss://global.example"]),
      );
      localStorage.setItem(
        `${PUBLISH_RELAYS_KEY}:${PUBKEY}`,
        JSON.stringify(["wss://scoped.example"]),
      );
      expect(getPublishRelays(PUBKEY)).toEqual(["wss://scoped.example"]);
    });
  });

  describe("setPublishRelays", () => {
    it("writes a JSON array", () => {
      setPublishRelays(["wss://a.example", "wss://b.example"], PUBKEY);
      const raw = localStorage.getItem(`${PUBLISH_RELAYS_KEY}:${PUBKEY}`);
      expect(raw).toBe(JSON.stringify(["wss://a.example", "wss://b.example"]));
    });

    it("strips invalid entries and de-duplicates", () => {
      setPublishRelays(
        [
          "wss://a.example",
          "not-a-url",
          "https://wrong-protocol.example",
          "wss://a.example", // duplicate
          "wss://b.example",
        ],
        PUBKEY,
      );
      expect(getPublishRelays(PUBKEY)).toEqual([
        "wss://a.example",
        "wss://b.example",
      ]);
    });

    it("an empty list removes the slot and falls back to defaults", () => {
      setPublishRelays(["wss://a.example"], PUBKEY);
      setPublishRelays([], PUBKEY);
      expect(localStorage.getItem(`${PUBLISH_RELAYS_KEY}:${PUBKEY}`)).toBeNull();
      expect(getPublishRelays(PUBKEY)).toEqual([...DEFAULT_PUBLISH_RELAYS]);
    });

    it("caps at MAX_PUBLISH_RELAYS entries", () => {
      const tooMany = Array.from(
        { length: MAX_PUBLISH_RELAYS + 5 },
        (_, i) => `wss://r${i}.example`,
      );
      setPublishRelays(tooMany, PUBKEY);
      expect(getPublishRelays(PUBKEY)).toHaveLength(MAX_PUBLISH_RELAYS);
    });

    it("normalizes trailing slashes on write", () => {
      setPublishRelays(["wss://a.example/", "wss://b.example//"], PUBKEY);
      expect(getPublishRelays(PUBKEY)).toEqual([
        "wss://a.example",
        "wss://b.example",
      ]);
    });
  });

  describe("hasLocalRelayChoice", () => {
    it("returns false when nothing is set", () => {
      expect(hasLocalRelayChoice(PUBKEY)).toBe(false);
    });

    it("returns true for scoped slot", () => {
      localStorage.setItem(
        `${PUBLISH_RELAYS_KEY}:${PUBKEY}`,
        JSON.stringify(["wss://a.example"]),
      );
      expect(hasLocalRelayChoice(PUBKEY)).toBe(true);
    });

    it("returns true for global slot (an anonymous-write must not be clobbered)", () => {
      localStorage.setItem(
        PUBLISH_RELAYS_KEY,
        JSON.stringify(["wss://anon.example"]),
      );
      expect(hasLocalRelayChoice(PUBKEY)).toBe(true);
    });
  });

  describe("clearPublishRelays", () => {
    it("removes the scoped slot", () => {
      localStorage.setItem(
        `${PUBLISH_RELAYS_KEY}:${PUBKEY}`,
        JSON.stringify(["wss://a.example"]),
      );
      clearPublishRelays(PUBKEY);
      expect(localStorage.getItem(`${PUBLISH_RELAYS_KEY}:${PUBKEY}`)).toBeNull();
    });
  });

  describe("isValidRelayUrl", () => {
    it("accepts wss:// URLs", () => {
      expect(isValidRelayUrl("wss://relay.example")).toBe(true);
    });

    it("accepts ws:// URLs (for local dev)", () => {
      expect(isValidRelayUrl("ws://localhost:7777")).toBe(true);
    });

    it("rejects http/https URLs", () => {
      expect(isValidRelayUrl("https://relay.example")).toBe(false);
      expect(isValidRelayUrl("http://relay.example")).toBe(false);
    });

    it("rejects garbage and empties", () => {
      expect(isValidRelayUrl("")).toBe(false);
      expect(isValidRelayUrl("   ")).toBe(false);
      expect(isValidRelayUrl("not-a-url")).toBe(false);
    });
  });

  describe("normalizeRelayUrl", () => {
    it("trims and strips trailing slashes", () => {
      expect(normalizeRelayUrl("  wss://relay.example/  ")).toBe(
        "wss://relay.example",
      );
      expect(normalizeRelayUrl("wss://relay.example///")).toBe(
        "wss://relay.example",
      );
    });
  });

  describe("read robustness", () => {
    it("ignores malformed JSON in the slot and falls back", () => {
      localStorage.setItem(`${PUBLISH_RELAYS_KEY}:${PUBKEY}`, "{not json[");
      expect(getPublishRelays(PUBKEY)).toEqual([...DEFAULT_PUBLISH_RELAYS]);
    });

    it("ignores non-array JSON in the slot", () => {
      localStorage.setItem(
        `${PUBLISH_RELAYS_KEY}:${PUBKEY}`,
        JSON.stringify({ not: "an array" }),
      );
      expect(getPublishRelays(PUBKEY)).toEqual([...DEFAULT_PUBLISH_RELAYS]);
    });

    it("treats an empty array as 'no choice' and falls back", () => {
      localStorage.setItem(
        `${PUBLISH_RELAYS_KEY}:${PUBKEY}`,
        JSON.stringify([]),
      );
      expect(getPublishRelays(PUBKEY)).toEqual([...DEFAULT_PUBLISH_RELAYS]);
    });

    it("filters invalid entries while reading", () => {
      localStorage.setItem(
        `${PUBLISH_RELAYS_KEY}:${PUBKEY}`,
        JSON.stringify([
          "wss://good.example",
          "not-a-url",
          "https://wrong-protocol.example",
          "wss://good2.example",
        ]),
      );
      expect(getPublishRelays(PUBKEY)).toEqual([
        "wss://good.example",
        "wss://good2.example",
      ]);
    });

    it("caps reads at MAX_PUBLISH_RELAYS even if the slot has more", () => {
      const tooMany = Array.from(
        { length: MAX_PUBLISH_RELAYS + 5 },
        (_, i) => `wss://r${i}.example`,
      );
      localStorage.setItem(
        `${PUBLISH_RELAYS_KEY}:${PUBKEY}`,
        JSON.stringify(tooMany),
      );
      expect(getPublishRelays(PUBKEY)).toHaveLength(MAX_PUBLISH_RELAYS);
    });
  });
});
