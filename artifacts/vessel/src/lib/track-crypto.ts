/**
 * Recording encryption on the device, before anything leaves it.
 *
 * Every uploaded track is encrypted with its own random 256-bit key. The key
 * travels only inside the share manifest, which is itself encrypted with the
 * share key in the link's fragment; the storage server holds ciphertext it
 * cannot read, and anyone who lists or guesses a file URL gets noise.
 *
 * Format (all integers big-endian):
 *
 *   header   "VSLT" | version u8 (1) | chunkSize u32 | noncePrefix 8 bytes
 *   chunks   AES-256-GCM(chunk_i), each plaintext chunk `chunkSize` bytes
 *            except the last; each ciphertext carries a 16-byte tag
 *
 *   nonce_i  noncePrefix | i as u32
 *   AAD_i    header | i as u32 | final flag u8 (1 on the last chunk)
 *
 * Binding the header, the index and the final flag into every tag means a
 * reordered, truncated, extended or re-headed file fails to decrypt instead
 * of decrypting into something shorter. Chunks are processed one at a time,
 * so a two-hour recording never sits in memory as one buffer.
 */

const MAGIC = [0x56, 0x53, 0x4c, 0x54]; // "VSLT"
const VERSION = 1;
const HEADER_BYTES = 4 + 1 + 4 + 8;
const TAG_BYTES = 16;
export const DEFAULT_TRACK_CHUNK_BYTES = 1024 * 1024;

export class TrackDecryptError extends Error {
  constructor(
    message = "This recording could not be decrypted. The link may be incomplete or the file damaged.",
  ) {
    super(message);
    this.name = "TrackDecryptError";
  }
}

type Bytes = Uint8Array<ArrayBuffer>;

function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(str: string): Bytes {
  const b64 =
    str.replace(/-/g, "+").replace(/_/g, "/") +
    "===".slice((str.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function u32(n: number): Bytes {
  const out = new Uint8Array(new ArrayBuffer(4));
  new DataView(out.buffer).setUint32(0, n);
  return out;
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(
    new ArrayBuffer(parts.reduce((n, p) => n + p.length, 0)),
  );
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function importKey(raw: Bytes, usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    usage,
  ]);
}

async function readBytes(blob: Blob): Promise<Bytes> {
  return new Uint8Array(await blob.arrayBuffer()) as Bytes;
}

/** Encrypt a recording. Returns the ciphertext and its key (base64url). */
export async function encryptTrack(
  plain: Blob,
  opts: { chunkBytes?: number } = {},
): Promise<{ blob: Blob; key: string }> {
  const chunkBytes = opts.chunkBytes ?? DEFAULT_TRACK_CHUNK_BYTES;
  const rawKey = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(32)));
  const noncePrefix = crypto.getRandomValues(
    new Uint8Array(new ArrayBuffer(8)),
  );
  const header = concat(
    new Uint8Array(MAGIC),
    new Uint8Array([VERSION]),
    u32(chunkBytes),
    noncePrefix,
  );
  const key = await importKey(rawKey, "encrypt");

  const count = Math.max(1, Math.ceil(plain.size / chunkBytes));
  const parts: BlobPart[] = [header];
  for (let i = 0; i < count; i++) {
    const chunk = await readBytes(
      plain.slice(i * chunkBytes, (i + 1) * chunkBytes),
    );
    const final = i === count - 1 ? 1 : 0;
    const ct = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: concat(noncePrefix, u32(i)),
        additionalData: concat(header, u32(i), new Uint8Array([final])),
      },
      key,
      chunk,
    );
    parts.push(ct);
  }
  return {
    blob: new Blob(parts, { type: "application/octet-stream" }),
    key: toBase64Url(rawKey),
  };
}

/** Decrypt a recording produced by {@link encryptTrack}. */
export async function decryptTrack(
  cipher: Blob,
  key: string,
  type = "",
): Promise<Blob> {
  let rawKey: Bytes;
  try {
    rawKey = fromBase64Url(key);
  } catch {
    throw new TrackDecryptError();
  }
  if (rawKey.length !== 32) throw new TrackDecryptError();
  const header = await readBytes(cipher.slice(0, HEADER_BYTES));
  if (
    header.length !== HEADER_BYTES ||
    MAGIC.some((m, i) => header[i] !== m) ||
    header[4] !== VERSION
  ) {
    throw new TrackDecryptError(
      "This file is not an encrypted Vessel recording.",
    );
  }
  const chunkBytes = new DataView(header.buffer).getUint32(5);
  const noncePrefix = header.slice(9, 17);
  const cryptoKey = await importKey(rawKey, "decrypt");

  const stride = chunkBytes + TAG_BYTES;
  const body = cipher.size - HEADER_BYTES;
  const count = Math.max(1, Math.ceil(body / stride));
  const parts: BlobPart[] = [];
  for (let i = 0; i < count; i++) {
    const start = HEADER_BYTES + i * stride;
    const ct = await readBytes(cipher.slice(start, start + stride));
    const final = i === count - 1 ? 1 : 0;
    try {
      parts.push(
        await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: concat(noncePrefix, u32(i)),
            additionalData: concat(header, u32(i), new Uint8Array([final])),
          },
          cryptoKey,
          ct,
        ),
      );
    } catch {
      throw new TrackDecryptError();
    }
  }
  return new Blob(parts, { type });
}
