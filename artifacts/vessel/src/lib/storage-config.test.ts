import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_STORAGE_URL,
  STORAGE_URL_KEY,
  STORAGE_URLS_KEY,
  getStorageUrl,
  getStorageUrls,
  setStorageUrl,
  setStorageUrls,
  hasLocalStorageChoice,
  clearStorageUrl,
} from "./storage-config";

const PUBKEY = "abc123def456";

describe("storage-config — multi-server lookup & migration", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("getStorageUrls / getStorageUrl precedence", () => {
    it("returns the default when nothing is set", () => {
      expect(getStorageUrls(PUBKEY)).toEqual([DEFAULT_STORAGE_URL]);
      expect(getStorageUrl(PUBKEY)).toBe(DEFAULT_STORAGE_URL);
    });

    it("reads the new scoped plural slot when present", () => {
      localStorage.setItem(
        `${STORAGE_URLS_KEY}:${PUBKEY}`,
        JSON.stringify(["https://a.example", "https://b.example"]),
      );
      expect(getStorageUrls(PUBKEY)).toEqual([
        "https://a.example",
        "https://b.example",
      ]);
      expect(getStorageUrl(PUBKEY)).toBe("https://a.example");
    });

    it("falls back to the legacy scoped single slot", () => {
      localStorage.setItem(`${STORAGE_URL_KEY}:${PUBKEY}`, "https://only.example");
      expect(getStorageUrls(PUBKEY)).toEqual(["https://only.example"]);
      expect(getStorageUrl(PUBKEY)).toBe("https://only.example");
    });

    it("falls back to the legacy global single slot", () => {
      localStorage.setItem(STORAGE_URL_KEY, "https://global.example");
      expect(getStorageUrls(PUBKEY)).toEqual(["https://global.example"]);
      expect(getStorageUrl(PUBKEY)).toBe("https://global.example");
    });

    it("plural slot wins over scoped single slot", () => {
      localStorage.setItem(`${STORAGE_URL_KEY}:${PUBKEY}`, "https://old.example");
      localStorage.setItem(
        `${STORAGE_URLS_KEY}:${PUBKEY}`,
        JSON.stringify(["https://new1.example", "https://new2.example"]),
      );
      expect(getStorageUrls(PUBKEY)).toEqual([
        "https://new1.example",
        "https://new2.example",
      ]);
    });

    it("scoped slot wins over global slot", () => {
      localStorage.setItem(STORAGE_URL_KEY, "https://global.example");
      localStorage.setItem(`${STORAGE_URL_KEY}:${PUBKEY}`, "https://scoped.example");
      expect(getStorageUrl(PUBKEY)).toBe("https://scoped.example");
    });

    it("reads the global plural slot for an anonymous caller (no pubkey)", () => {
      localStorage.setItem(
        STORAGE_URLS_KEY,
        JSON.stringify(["https://anon1.example", "https://anon2.example"]),
      );
      expect(getStorageUrls()).toEqual([
        "https://anon1.example",
        "https://anon2.example",
      ]);
      expect(getStorageUrl()).toBe("https://anon1.example");
    });

    it("anonymous setStorageUrls roundtrips through the global plural slot", () => {
      // Symmetry guard: setStorageUrls(_, undefined) must produce data that
      // getStorageUrls(undefined) can read back. Without the global plural
      // read branch, this would silently fall back to the default.
      setStorageUrls(["https://anon1.example", "https://anon2.example"]);
      expect(getStorageUrls()).toEqual([
        "https://anon1.example",
        "https://anon2.example",
      ]);
    });

    it("global plural slot wins over legacy global single slot", () => {
      localStorage.setItem(STORAGE_URL_KEY, "https://oldglobal.example");
      localStorage.setItem(
        STORAGE_URLS_KEY,
        JSON.stringify(["https://newglobal.example"]),
      );
      expect(getStorageUrl()).toBe("https://newglobal.example");
    });

    it("scoped slots win over global plural slot", () => {
      localStorage.setItem(
        STORAGE_URLS_KEY,
        JSON.stringify(["https://anon.example"]),
      );
      localStorage.setItem(
        `${STORAGE_URLS_KEY}:${PUBKEY}`,
        JSON.stringify(["https://scoped.example"]),
      );
      expect(getStorageUrl(PUBKEY)).toBe("https://scoped.example");
    });
  });

  describe("setStorageUrls", () => {
    it("writes a JSON array", () => {
      setStorageUrls(["https://a.example", "https://b.example"], PUBKEY);
      const raw = localStorage.getItem(`${STORAGE_URLS_KEY}:${PUBKEY}`);
      expect(raw).toBe(
        JSON.stringify(["https://a.example", "https://b.example"]),
      );
    });

    it("strips invalid URLs and de-duplicates", () => {
      setStorageUrls(
        [
          "https://a.example",
          "not-a-url",
          "http://insecure.example",
          "https://a.example", // duplicate
          "https://b.example",
        ],
        PUBKEY,
      );
      expect(getStorageUrls(PUBKEY)).toEqual([
        "https://a.example",
        "https://b.example",
      ]);
    });

    it("clears the legacy scoped single slot to keep storage tidy", () => {
      localStorage.setItem(`${STORAGE_URL_KEY}:${PUBKEY}`, "https://old.example");
      setStorageUrls(["https://new.example"], PUBKEY);
      expect(localStorage.getItem(`${STORAGE_URL_KEY}:${PUBKEY}`)).toBeNull();
      expect(getStorageUrl(PUBKEY)).toBe("https://new.example");
    });

    it("an empty list removes the slot and falls back to default", () => {
      setStorageUrls(["https://a.example"], PUBKEY);
      setStorageUrls([], PUBKEY);
      expect(localStorage.getItem(`${STORAGE_URLS_KEY}:${PUBKEY}`)).toBeNull();
      expect(getStorageUrl(PUBKEY)).toBe(DEFAULT_STORAGE_URL);
    });
  });

  describe("setStorageUrl backward compat", () => {
    it("writes a single-entry list when called with one URL", () => {
      setStorageUrl("https://only.example", PUBKEY);
      expect(getStorageUrls(PUBKEY)).toEqual(["https://only.example"]);
    });
  });

  describe("hasLocalStorageChoice", () => {
    it("returns false when no slots are set", () => {
      expect(hasLocalStorageChoice(PUBKEY)).toBe(false);
    });

    it("returns true for plural slot", () => {
      localStorage.setItem(
        `${STORAGE_URLS_KEY}:${PUBKEY}`,
        JSON.stringify(["https://a.example"]),
      );
      expect(hasLocalStorageChoice(PUBKEY)).toBe(true);
    });

    it("returns true for legacy scoped slot", () => {
      localStorage.setItem(`${STORAGE_URL_KEY}:${PUBKEY}`, "https://a.example");
      expect(hasLocalStorageChoice(PUBKEY)).toBe(true);
    });

    it("returns true for legacy global slot", () => {
      localStorage.setItem(STORAGE_URL_KEY, "https://global.example");
      expect(hasLocalStorageChoice(PUBKEY)).toBe(true);
    });
  });

  describe("clearStorageUrl", () => {
    it("removes both plural and legacy scoped slots", () => {
      localStorage.setItem(
        `${STORAGE_URLS_KEY}:${PUBKEY}`,
        JSON.stringify(["https://a.example"]),
      );
      localStorage.setItem(`${STORAGE_URL_KEY}:${PUBKEY}`, "https://b.example");
      clearStorageUrl(PUBKEY);
      expect(localStorage.getItem(`${STORAGE_URLS_KEY}:${PUBKEY}`)).toBeNull();
      expect(localStorage.getItem(`${STORAGE_URL_KEY}:${PUBKEY}`)).toBeNull();
    });
  });

  describe("read robustness", () => {
    it("ignores malformed JSON in the plural slot and falls back", () => {
      localStorage.setItem(`${STORAGE_URLS_KEY}:${PUBKEY}`, "{not json[");
      localStorage.setItem(`${STORAGE_URL_KEY}:${PUBKEY}`, "https://fallback.example");
      expect(getStorageUrl(PUBKEY)).toBe("https://fallback.example");
    });

    it("ignores non-array JSON in the plural slot", () => {
      localStorage.setItem(
        `${STORAGE_URLS_KEY}:${PUBKEY}`,
        JSON.stringify({ not: "an array" }),
      );
      expect(getStorageUrl(PUBKEY)).toBe(DEFAULT_STORAGE_URL);
    });

    it("treats an empty array as 'no choice' and falls back to default", () => {
      localStorage.setItem(`${STORAGE_URLS_KEY}:${PUBKEY}`, JSON.stringify([]));
      expect(getStorageUrl(PUBKEY)).toBe(DEFAULT_STORAGE_URL);
    });

    it("filters invalid entries while reading", () => {
      localStorage.setItem(
        `${STORAGE_URLS_KEY}:${PUBKEY}`,
        JSON.stringify([
          "https://good.example",
          "not-a-url",
          "http://insecure.example",
          "https://good2.example",
        ]),
      );
      expect(getStorageUrls(PUBKEY)).toEqual([
        "https://good.example",
        "https://good2.example",
      ]);
    });
  });
});
