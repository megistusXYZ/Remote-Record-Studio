import { describe, it, expect } from "vitest";
import { screenLocalKey, screenLocalUrl } from "./use-screen-recording";

describe("screenLocalKey / screenLocalUrl", () => {
  it("derives the screen sibling key from the recording id with the :screen suffix", () => {
    expect(screenLocalKey("rec_abc")).toBe("rec_abc:screen");
  });

  it("never collides with the audio or video sibling derivations for the same id", () => {
    const id = "rec_xyz";
    const key = screenLocalKey(id);
    expect(key).not.toBe(`${id}:audio`);
    expect(key).not.toBe(`${id}:video`);
    expect(key.endsWith(":screen")).toBe(true);
  });

  it("produces a deterministic idb:// URL the vault download path can resolve", () => {
    expect(screenLocalUrl("rec_abc")).toBe("idb://rec_abc:screen");
  });

  it("is pure — same input yields the same output across calls", () => {
    expect(screenLocalKey("rec_1")).toBe(screenLocalKey("rec_1"));
    expect(screenLocalUrl("rec_1")).toBe(screenLocalUrl("rec_1"));
  });
});
