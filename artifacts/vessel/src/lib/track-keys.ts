/**
 * Keys for encrypted recordings, kept on the device.
 *
 * Every upload is encrypted with its own key (track-crypto.ts). The storage
 * server only ever sees ciphertext, and the Vessel API never sees a key.
 * Keys live in two places:
 *
 *   - this device's key list, written when it uploads a file and when it
 *     opens a share link (so a host keeps the keys to guests' tracks), and
 *   - the share manifest, encrypted under the link's own key, which is how a
 *     key reaches anyone else.
 *
 * Stored files are content-addressed, so the SHA-256 of the stored bytes
 * (also the last segment of the storage URL) identifies the key.
 */
import { decryptTrack, TrackDecryptError } from "./track-crypto";

const STORAGE_KEY = "vessel_track_keys";
let cache: Map<string, string> | null = null;

function load(): Map<string, string> {
  if (cache) return cache;
  cache = new Map();
  try {
    const raw =
      typeof localStorage !== "undefined"
        ? localStorage.getItem(STORAGE_KEY)
        : null;
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    for (const [hash, key] of Object.entries(parsed)) {
      if (typeof key === "string") cache.set(hash.toLowerCase(), key);
    }
  } catch {
    // A corrupt list should not break playback of unencrypted files.
  }
  return cache;
}

function save(map: Map<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(map)));
  } catch (err) {
    console.warn("[track-keys] could not save the key list", err);
  }
}

export function rememberTrackKey(
  hash: string | null | undefined,
  key: string | null | undefined,
): void {
  if (!hash || !key) return;
  const map = load();
  const h = hash.toLowerCase();
  if (map.get(h) === key) return;
  map.set(h, key);
  save(map);
}

export function getTrackKey(hash: string | null | undefined): string | null {
  if (!hash) return null;
  return load().get(hash.toLowerCase()) ?? null;
}

/** `https://files.example/<sha256>[.ext]` → the hash, or null. */
export function hashFromStorageUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
    const hash = last.split(".")[0] ?? "";
    return /^[0-9a-f]{64}$/i.test(hash) ? hash.toLowerCase() : null;
  } catch {
    return null;
  }
}

const MAGIC = [0x56, 0x53, 0x4c, 0x54];

async function isSealed(blob: Blob): Promise<boolean> {
  if (blob.size < MAGIC.length) return false;
  const head = new Uint8Array(await blob.slice(0, MAGIC.length).arrayBuffer());
  return MAGIC.every((b, i) => head[i] === b);
}

/**
 * Turn downloaded bytes into the playable recording. Encrypted files are
 * decrypted with the given key, or the one this device holds for the file;
 * files uploaded before encryption existed pass through unchanged.
 */
export async function openStoredTrack(
  blob: Blob,
  opts: {
    key?: string | null;
    hash?: string | null;
    url?: string | null;
    type?: string | null;
  },
): Promise<Blob> {
  if (!(await isSealed(blob))) return blob;
  const key =
    opts.key ?? getTrackKey(opts.hash ?? hashFromStorageUrl(opts.url));
  if (!key) {
    throw new TrackDecryptError(
      "This recording is encrypted and this device doesn't have its key. Open it from the share link, or from the device that recorded it.",
    );
  }
  return decryptTrack(blob, key, opts.type ?? "");
}

/** Test hook. */
export function __resetTrackKeyCache(): void {
  cache = null;
}
