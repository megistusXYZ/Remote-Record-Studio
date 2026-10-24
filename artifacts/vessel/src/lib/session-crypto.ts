/**
 * Per-session encryption for in-call signaling.
 *
 * Presence, chat, reactions and WebRTC offers travel
 * through public relays. Until now their contents were plain JSON, so any
 * relay (or anyone watching one) could read names, messages and IP
 * addresses. Every participant already shares one secret, the invite code,
 * so a session key is derived from it with HKDF and each message is sealed
 * with AES-256-GCM. Relays still see event kinds and the session tag, never
 * the content.
 *
 * Envelope on the wire: `{"v":1,"iv":"<base64>","ct":"<base64>"}`.
 */

export type SignalEnvelope = { v: 1; iv: string; ct: string };

const SALT = new TextEncoder().encode("vessel-signal-v1");
const KEY_CACHE = new Map<string, Promise<CryptoKey>>();

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function subtle(): SubtleCrypto {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("This browser can't encrypt session messages.");
  }
  return crypto.subtle;
}

/**
 * AES-GCM key for one session, derived from the invite code with the
 * session id as context so two sessions that reuse a code never share a key.
 */
export function deriveSessionKey(
  sessionId: string,
  inviteCode: string,
): Promise<CryptoKey> {
  const cacheKey = `${sessionId}\u0000${inviteCode}`;
  const cached = KEY_CACHE.get(cacheKey);
  if (cached) return cached;
  const promise = (async () => {
    const enc = new TextEncoder();
    const ikm = await subtle().importKey(
      "raw",
      enc.encode(inviteCode),
      "HKDF",
      false,
      ["deriveKey"],
    );
    return subtle().deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: SALT,
        info: enc.encode(sessionId),
      },
      ikm,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  })();
  KEY_CACHE.set(cacheKey, promise);
  promise.catch(() => KEY_CACHE.delete(cacheKey));
  return promise;
}

export async function sealSignal(
  key: CryptoKey,
  plaintext: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const envelope: SignalEnvelope = {
    v: 1,
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(ct)),
  };
  return JSON.stringify(envelope);
}

export function parseEnvelope(content: string): SignalEnvelope | null {
  if (!content || content[0] !== "{") return null;
  try {
    const parsed = JSON.parse(content) as Partial<SignalEnvelope> | null;
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.v === 1 &&
      typeof parsed.iv === "string" &&
      typeof parsed.ct === "string"
    ) {
      return parsed as SignalEnvelope;
    }
  } catch {
    // not JSON
  }
  return null;
}

/** Null when the content is an envelope that does not open with this key. */
export async function openSignal(
  key: CryptoKey,
  envelope: SignalEnvelope,
): Promise<string | null> {
  try {
    const plain = await subtle().decrypt(
      { name: "AES-GCM", iv: base64ToBytes(envelope.iv) },
      key,
      base64ToBytes(envelope.ct),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

/** Test hook. */
export function __resetSessionKeyCache(): void {
  KEY_CACHE.clear();
}
