import { describe, expect, it } from "vitest";
import { nanoid } from "../src/lib/nanoid";

describe("nanoid", () => {
  it("produces ids of the requested length from the URL-safe alphabet", () => {
    for (const size of [8, 21]) {
      const id = nanoid(size);
      expect(id).toHaveLength(size);
      expect(id).toMatch(/^[A-Za-z0-9]+$/);
    }
  });

  it("does not repeat across many draws", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(nanoid(8));
    expect(seen.size).toBe(2000);
  });

  it("uses the whole alphabet", () => {
    const chars = new Set<string>();
    for (let i = 0; i < 500; i++) for (const c of nanoid(21)) chars.add(c);
    expect(chars.size).toBeGreaterThan(50);
  });
});
