// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BlossomUploadQueue } from "./blossom";
import { decryptTrack } from "./track-crypto";

/**
 * A fake storage server behind the browser's fetch (HEAD) and
 * XMLHttpRequest (PUT). Each PUT takes the next scripted outcome.
 */
type Outcome = { status: number; body?: string } | "network-error";

let stored: Set<string>;
let script: Outcome[];
let puts: number;
let received: Blob[];

class FakeXhr {
  status = 0;
  responseText = "";
  responseType = "";
  upload: {
    onprogress:
      | ((e: {
          lengthComputable: boolean;
          loaded: number;
          total: number;
        }) => void)
      | null;
  } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open() {}
  setRequestHeader() {}
  abort() {
    this.onabort?.();
  }
  send(body: Blob) {
    puts += 1;
    received.push(body);
    const next = script.shift() ?? { status: 200 };
    queueMicrotask(() => {
      if (next === "network-error") {
        this.onerror?.();
        return;
      }
      this.status = next.status;
      this.responseText = next.body ?? "";
      if (next.status >= 200 && next.status < 300) {
        this.upload.onprogress?.({
          lengthComputable: true,
          loaded: body.size,
          total: body.size,
        });
      }
      this.onload?.();
    });
  }
}

const signer = {
  signEvent: vi.fn(async (t: object) => ({
    ...t,
    id: "id",
    pubkey: "pk",
    sig: "sig",
  })),
} as never;

function queue() {
  return new BlossomUploadQueue({
    serverUrl: "https://files.test",
    signer,
    retryDelaysMs: [0, 0, 0],
  });
}

beforeEach(() => {
  stored = new Set();
  script = [];
  puts = 0;
  received = [];
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      status: stored.has(url.split("/").pop()!) ? 200 : 404,
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("storage upload", () => {
  it("retries a temporary server error and finishes the upload", async () => {
    script = [
      { status: 503 },
      { status: 200, body: JSON.stringify({ url: "https://files.test/abc" }) },
    ];
    const result = await queue().sync(new Blob(["take one"]));
    expect(result.status).toBe("complete");
    expect(result.remoteUrl).toBe("https://files.test/abc");
    expect(puts).toBe(2);
  });

  it("does not retry when the server refuses the file", async () => {
    script = [{ status: 413, body: "too large" }];
    const result = await queue().sync(new Blob(["take"]));
    expect(result.status).toBe("partial-failure");
    expect(puts).toBe(1);
    expect(result.errorMessage).toMatch(/413/);
  });

  it("gives up after the last retry when the network stays down", async () => {
    script = [
      "network-error",
      "network-error",
      "network-error",
      "network-error",
    ];
    const result = await queue().sync(new Blob(["take"]));
    expect(result.status).toBe("partial-failure");
    expect(puts).toBe(4);
  });

  it("skips the upload when the server already has the exact bytes", async () => {
    const blob = new Blob(["already there"]);
    const { sha256Hex } = await import("./blossom");
    const hash = await sha256Hex(blob);
    stored.add(hash);
    const result = await new BlossomUploadQueue({
      serverUrl: "https://files.test",
      signer,
      retryDelaysMs: [0],
      encrypt: false,
    }).sync(blob);
    expect(result.status).toBe("complete");
    expect(result.remoteUrl).toBe(`https://files.test/${hash}`);
    expect(puts).toBe(0);
  });

  it("sends the storage server only ciphertext, and hands back the key", async () => {
    const take = new TextEncoder().encode("what the guest said, in full");
    const result = await queue().sync(new Blob([take], { type: "audio/wav" }));
    expect(result.status).toBe("complete");
    expect(result.key).toBeTruthy();
    const sent = new Uint8Array(await received[0]!.arrayBuffer());
    expect(new TextDecoder("latin1").decode(sent)).not.toContain(
      "what the guest said",
    );
    const restored = await decryptTrack(received[0]!, result.key!, "audio/wav");
    expect(new Uint8Array(await restored.arrayBuffer())).toEqual(take);
  });
});
