// @vitest-environment node
import { describe, it, expect } from "vitest";
import { encryptTrack, decryptTrack, TrackDecryptError } from "./track-crypto";

const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

describe("track encryption", () => {
  it("decrypts back to the exact recording", async () => {
    const original = new Blob([new TextEncoder().encode("a short take")], {
      type: "audio/wav",
    });
    const { blob, key } = await encryptTrack(original);
    const restored = await decryptTrack(blob, key, "audio/wav");
    expect(await bytes(restored)).toEqual(await bytes(original));
    expect(restored.type).toBe("audio/wav");
  });

  it("handles recordings that span many chunks, and empty ones", async () => {
    const data = new Uint8Array(1000).map((_, i) => (i * 7) % 256);
    const { blob, key } = await encryptTrack(new Blob([data]), {
      chunkBytes: 64,
    });
    expect(await bytes(await decryptTrack(blob, key))).toEqual(data);

    const empty = await encryptTrack(new Blob([]), { chunkBytes: 64 });
    expect((await decryptTrack(empty.blob, empty.key)).size).toBe(0);
  });

  it("never stores the recording in the clear", async () => {
    const secret = new TextEncoder().encode(
      "the guest said something private ".repeat(20),
    );
    const { blob } = await encryptTrack(new Blob([secret]), {
      chunkBytes: 128,
    });
    const stored = new TextDecoder("latin1").decode(await bytes(blob));
    expect(stored).not.toContain("something private");
  });

  it("gives every file its own key", async () => {
    const a = await encryptTrack(new Blob(["same"]));
    const b = await encryptTrack(new Blob(["same"]));
    expect(a.key).not.toBe(b.key);
    expect(await bytes(a.blob)).not.toEqual(await bytes(b.blob));
  });

  it("refuses a file that was altered", async () => {
    const { blob, key } = await encryptTrack(new Blob([new Uint8Array(300)]), {
      chunkBytes: 64,
    });
    const tampered = await bytes(blob);
    tampered[40] ^= 0x01;
    await expect(
      decryptTrack(new Blob([tampered]), key),
    ).rejects.toBeInstanceOf(TrackDecryptError);
  });

  it("refuses a file that was cut short at a chunk boundary", async () => {
    const { blob, key } = await encryptTrack(new Blob([new Uint8Array(300)]), {
      chunkBytes: 64,
    });
    const header = 17;
    const stride = 64 + 16;
    const cut = blob.slice(0, header + 2 * stride);
    await expect(decryptTrack(cut, key)).rejects.toBeInstanceOf(
      TrackDecryptError,
    );
  });

  it("refuses the wrong key and files that are not Vessel recordings", async () => {
    const { blob } = await encryptTrack(new Blob(["take"]));
    const other = await encryptTrack(new Blob(["take"]));
    await expect(decryptTrack(blob, other.key)).rejects.toBeInstanceOf(
      TrackDecryptError,
    );
    await expect(
      decryptTrack(new Blob(["RIFF....WAVEfmt "]), other.key),
    ).rejects.toBeInstanceOf(TrackDecryptError);
  });
});
