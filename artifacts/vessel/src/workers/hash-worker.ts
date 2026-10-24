/// <reference lib="webworker" />
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/**
 * Hashes a Blob by streaming it, so a multi-gigabyte recording never has to
 * sit in memory as one buffer and the page thread stays responsive.
 */
type Request = { id: number; blob: Blob };
type Response =
  | { id: number; ok: true; hex: string }
  | { id: number; ok: false; error: string };

self.onmessage = async (event: MessageEvent<Request>) => {
  const { id, blob } = event.data;
  try {
    const hasher = sha256.create();
    const reader = blob.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) hasher.update(value);
    }
    const response: Response = {
      id,
      ok: true,
      hex: bytesToHex(hasher.digest()),
    };
    self.postMessage(response);
  } catch (err) {
    const response: Response = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
};
