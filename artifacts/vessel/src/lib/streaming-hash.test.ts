// @vitest-environment node
import { describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import { NATIVE_DIGEST_MAX_BYTES, sha256HexOfBlob } from "./streaming-hash";

async function referenceHex(bytes: Uint8Array): Promise<string> {
  const digest = await webcrypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function patternBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i * 31 + 7) & 0xff;
  return out;
}

describe("streaming-hash", () => {
  it("matches the native digest for a small blob", async () => {
    const bytes = new TextEncoder().encode("hello vessel");
    const blob = new Blob([bytes]);
    expect(await sha256HexOfBlob(blob)).toBe(await referenceHex(bytes));
  });

  it("matches the native digest when forced down the streaming path", async () => {
    const bytes = patternBytes(3 * 1024 * 1024 + 17);
    const blob = new Blob([bytes]);
    expect(await sha256HexOfBlob(blob, { forceStreaming: true })).toBe(
      await referenceHex(bytes),
    );
  });

  it("streams blobs above the native threshold", async () => {
    const bytes = patternBytes(NATIVE_DIGEST_MAX_BYTES + 1024);
    // Several parts, so the stream yields multiple chunks.
    const blob = new Blob([
      bytes.subarray(0, 1_000_000),
      bytes.subarray(1_000_000),
    ]);
    expect(await sha256HexOfBlob(blob)).toBe(await referenceHex(bytes));
  });

  it("hashes the empty blob", async () => {
    expect(await sha256HexOfBlob(new Blob([]))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});
