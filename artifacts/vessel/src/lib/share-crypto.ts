/**
 * Share-link encryption helpers.
 *
 * The share manifest is published to public Nostr relays signed by an
 * ephemeral keypair. Its `content` field is encrypted with a symmetric
 * AES-256-GCM key that lives ONLY in the URL fragment, which is never sent
 * to any server. A relay scraper sees an opaque ciphertext from an unknown
 * author with no way to enumerate the host's other sessions.
 *
 * URL shape:
 *   /s/<opaque-pointer>       #<base64url-key>                   (full archive)
 *   /s/<opaque-pointer>       #<base64url-key>/<recordingId>     (per-track scope)
 *
 * No Nostr / AES / etc. terms ever appear in user-visible UI strings.
 */

const KEY_BYTES = 32;
const IV_BYTES = 12;

export type ParsedShareFragment = {
  /** Decoded 32-byte AES-256-GCM key. */
  key: Uint8Array;
  /** Optional per-track recording id when the URL was a per-track share. */
  trackId?: string;
};

/** Generate a fresh 32-byte symmetric key. */
export function generateShareKey(): Uint8Array {
  const k = new Uint8Array(KEY_BYTES);
  crypto.getRandomValues(k);
  return k;
}

/** Generate a short random hex string suitable for a `d` tag identifier. */
export function generateRandomIdentifier(byteLen = 16): string {
  const buf = new Uint8Array(byteLen);
  crypto.getRandomValues(buf);
  let s = "";
  for (let i = 0; i < buf.length; i++) {
    s += buf[i].toString(16).padStart(2, "0");
  }
  return s;
}

async function importGcmKey(rawKey: Uint8Array): Promise<CryptoKey> {
  if (rawKey.byteLength !== KEY_BYTES) {
    throw new Error("Invalid share key length");
  }
  // Use the underlying ArrayBuffer slice — TS lib `importKey` expects a
  // BufferSource which a generic `Uint8Array<ArrayBufferLike>` doesn't satisfy
  // under newer @types/web definitions.
  // Copy into a fresh ArrayBuffer to satisfy BufferSource (Uint8Array on a
  // SharedArrayBuffer doesn't qualify under newer @types/web definitions).
  const ab = new ArrayBuffer(rawKey.byteLength);
  new Uint8Array(ab).set(rawKey);
  return crypto.subtle.importKey(
    "raw",
    ab,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt a UTF-8 string under the given key. Returns a base64 string of the
 * concatenation `iv || ciphertext+tag`. Suitable for stuffing directly into a
 * Nostr event `content` field.
 */
export async function encryptManifestContent(
  plaintext: string,
  rawKey: Uint8Array,
): Promise<string> {
  const key = await importGcmKey(rawKey);
  const iv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(iv);
  const data = new TextEncoder().encode(plaintext);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  const out = new Uint8Array(IV_BYTES + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), IV_BYTES);
  return bytesToBase64(out);
}

/** Decrypt the output of {@link encryptManifestContent}. Throws on wrong key. */
export async function decryptManifestContent(
  payload: string,
  rawKey: Uint8Array,
): Promise<string> {
  const all = base64ToBytes(payload);
  if (all.byteLength <= IV_BYTES) {
    throw new ShareDecryptError("bad_format", "Payload is too short");
  }
  const iv = all.slice(0, IV_BYTES);
  const ct = all.slice(IV_BYTES);
  const key = await importGcmKey(rawKey);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  } catch {
    throw new ShareDecryptError(
      "wrong_key",
      "The link's decryption key doesn't match this archive.",
    );
  }
  return new TextDecoder().decode(plain);
}

export class ShareDecryptError extends Error {
  constructor(
    public code: "wrong_key" | "bad_format" | "missing_key",
    message: string,
  ) {
    super(message);
    this.name = "ShareDecryptError";
  }
}

// --- opaque pointer encoding -------------------------------------------------
//
// We deliberately avoid bech32-prefixed pointer strings (which would leak
// implementation terms into the user-visible URL). Instead we serialize the
// minimum address info as JSON and base64url-encode it. The recipient page
// decodes this back into the relay query.

export type SharePointer = {
  kind: number;
  pubkey: string;       // hex
  identifier: string;   // d-tag value
  relays: string[];     // hint relays
};

export function encodeSharePointer(p: SharePointer): string {
  const compact = { k: p.kind, p: p.pubkey, d: p.identifier, r: p.relays };
  const bytes = new TextEncoder().encode(JSON.stringify(compact));
  return base64UrlEncode(bytes);
}

export function decodeSharePointer(encoded: string): SharePointer {
  let bytes: Uint8Array;
  try {
    bytes = base64UrlDecode(encoded);
  } catch {
    throw new ShareDecryptError("bad_format", "Share pointer is malformed");
  }
  let body: any;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ShareDecryptError("bad_format", "Share pointer is malformed");
  }
  if (
    !body ||
    typeof body !== "object" ||
    typeof body.k !== "number" ||
    typeof body.p !== "string" ||
    typeof body.d !== "string"
  ) {
    throw new ShareDecryptError("bad_format", "Share pointer is malformed");
  }
  return {
    kind: body.k,
    pubkey: body.p,
    identifier: body.d,
    relays: Array.isArray(body.r) ? body.r.filter((r: any) => typeof r === "string") : [],
  };
}

/** Short, friendly hex fingerprint for display (no implementation prefix). */
export function buildArchiveFingerprint(eventIdHex: string): string {
  // Show as `xxxx-xxxx-xxxx-xxxx` from the first 16 hex chars.
  const head = eventIdHex.slice(0, 16);
  return `${head.slice(0, 4)}-${head.slice(4, 8)}-${head.slice(8, 12)}-${head.slice(12, 16)}`;
}

// --- base64url (no padding) ---------------------------------------------------

export function encodeShareKey(bytes: Uint8Array): string {
  return base64UrlEncode(bytes);
}

export function decodeShareKey(str: string): Uint8Array {
  const bytes = base64UrlDecode(str);
  if (bytes.byteLength !== KEY_BYTES) {
    throw new ShareDecryptError("bad_format", "Decryption key is malformed");
  }
  return bytes;
}

/**
 * Parse the URL fragment of a share link. Accepts the leading `#` or not.
 * Returns the decoded key and (optionally) a per-track scope.
 */
export function parseShareFragment(hash: string): ParsedShareFragment {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) throw new ShareDecryptError("bad_format", "Missing decryption key");
  const slash = raw.indexOf("/");
  if (slash < 0) {
    return { key: decodeShareKey(raw) };
  }
  const keyPart = raw.slice(0, slash);
  const trackId = raw.slice(slash + 1);
  return {
    key: decodeShareKey(keyPart),
    trackId: trackId || undefined,
  };
}

// --- base64 helpers (browser-safe) -------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

function base64UrlEncode(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(s: string): Uint8Array {
  const padded =
    s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return base64ToBytes(padded);
}
