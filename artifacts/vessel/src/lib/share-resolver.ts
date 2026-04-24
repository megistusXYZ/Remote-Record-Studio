import type { Event } from "nostr-tools/pure";
import { getRelayPool } from "./relay-pool";
import {
  decryptManifestContent,
  decodeShareKey,
  decodeSharePointer,
  parseShareFragment,
  ShareDecryptError,
} from "./share-crypto";

/**
 * Resolves an encrypted share link → the decrypted recipient manifest.
 *
 * Reads the URL pointer (opaque base64url-encoded JSON) for the relays + author +
 * identifier, fetches the matching event, and decrypts its content under the
 * key from the URL fragment. Pure-client; nothing is logged or POSTed.
 */

export type RecipientTrack = {
  recordingId: string;
  participantName: string;
  participantPubkey: string;
  durationSeconds: number;
  sizeBytes: number;
  mimeType: string;
  url: string | null;
  hash: string | null;
  eventId: string | null;
};

export type RecipientManifest = {
  archiveId: string;
  sessionTitle: string;
  hostName: string;
  endedAt: string;
  archivedAt: string;
  trackCount: number;
  tracks: RecipientTrack[];
  /** When set, the URL was a per-track scope and only matching tracks are present. */
  scopedToTrackId?: string;
};

export type ShareResolveErrorCode =
  | "missing_key"
  | "bad_pointer"
  | "not_found"
  | "wrong_key"
  | "bad_format"
  | "network"
  | "revoked";

export class ShareResolveError extends Error {
  constructor(public code: ShareResolveErrorCode, message: string) {
    super(message);
    this.name = "ShareResolveError";
  }
}

const FALLBACK_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
];

const FETCH_TIMEOUT_MS = 8000;

function envRelays(): string[] {
  const raw = (import.meta.env.VITE_NOSTR_RELAYS as string | undefined) || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("ws://") || s.startsWith("wss://"));
}

export type ResolveShareInput = {
  /** The encoded pointer from the URL path (opaque base64url JSON). */
  pointer: string;
  /** Raw URL fragment, with or without the leading `#`. */
  fragment: string;
};

export async function resolveShareLink(input: ResolveShareInput): Promise<RecipientManifest> {
  // 1. Parse fragment for symmetric key + optional per-track scope. Distinguish
  //    "no fragment at all" (missing_key) from "fragment present but garbage"
  //    (bad_format) so the recipient page can give a useful error.
  const rawFragment = (input.fragment || "").startsWith("#")
    ? input.fragment.slice(1)
    : input.fragment || "";
  if (!rawFragment) {
    throw new ShareResolveError(
      "missing_key",
      "This link is missing the part that lets you read it.",
    );
  }
  let key: Uint8Array;
  let trackId: string | undefined;
  try {
    const parsed = parseShareFragment(rawFragment);
    key = parsed.key;
    // The publisher URL-encodes the track id when it embeds it, so undo that.
    // A bad `%` escape here means the link itself is malformed — surface it
    // explicitly rather than silently picking up an empty track filter.
    if (parsed.trackId !== undefined) {
      try {
        trackId = decodeURIComponent(parsed.trackId);
      } catch {
        throw new ShareDecryptError("bad_format", "Per-track scope is malformed");
      }
    }
  } catch (err) {
    const code = err instanceof ShareDecryptError ? err.code : "bad_format";
    throw new ShareResolveError(
      code === "missing_key" ? "missing_key" : "bad_format",
      "This link's reading code looks malformed.",
    );
  }

  // 2. Decode the opaque pointer for relays + identifier + ephemeral pubkey.
  let decoded: ReturnType<typeof decodeSharePointer>;
  try {
    decoded = decodeSharePointer(input.pointer);
  } catch {
    throw new ShareResolveError("bad_pointer", "This share link looks broken or incomplete.");
  }

  const relays = dedupe([
    ...(decoded.relays || []),
    ...envRelays(),
    ...FALLBACK_RELAYS,
  ]);

  // 3. Race the relays for the matching event. We subscribe with TWO filters
  //    in one request: the manifest event itself plus any kind-5 deletion
  //    events authored by the same ephemeral pubkey that reference this
  //    archive's NIP-33 address. If we see the deletion we surface the link
  //    as revoked even on relays that don't honor NIP-09.
  //
  //    Defensive: always unsubscribe in every settle path — the relay pool's
  //    request observable can stay open keeping sockets in use.
  const archiveAddress = `${decoded.kind}:${decoded.pubkey}:${decoded.identifier}`;
  // Small grace window after we receive the manifest, so a deletion event
  // arriving from a slower relay can still preempt the resolve. Without this,
  // a fast relay that hasn't dropped the manifest yet would win the race and
  // the recipient would download the archive even though it's revoked.
  const POST_MANIFEST_GRACE_MS = 1500;

  const pool = getRelayPool();
  const evt: Event = await new Promise<Event>((resolve, reject) => {
    let settled = false;
    let sub: { unsubscribe: () => void } | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    let manifest: Event | null = null;
    let revoked = false;

    const cleanup = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (graceTimer !== null) {
        clearTimeout(graceTimer);
        graceTimer = null;
      }
      if (sub) {
        try {
          sub.unsubscribe();
        } catch {
          // ignore
        }
        sub = null;
      }
    };
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const decide = () => {
      if (revoked) {
        settle(() =>
          reject(
            new ShareResolveError(
              "revoked",
              "The host took this share down.",
            ),
          ),
        );
        return;
      }
      if (manifest) {
        const m = manifest;
        settle(() => resolve(m));
        return;
      }
      settle(() =>
        reject(
          new ShareResolveError(
            "not_found",
            "We couldn't find this archive on any relay.",
          ),
        ),
      );
    };

    sub = pool
      .request(relays, [
        {
          kinds: [decoded.kind],
          authors: [decoded.pubkey],
          "#d": [decoded.identifier],
          limit: 1,
        },
        {
          kinds: [5],
          authors: [decoded.pubkey],
          "#a": [archiveAddress],
          limit: 5,
        },
      ])
      .subscribe({
        next: (e: Event) => {
          if (settled) return;
          if (e.pubkey !== decoded.pubkey) return;
          if (e.kind === 5) {
            // Confirm this deletion event actually references our archive.
            const refsAddress = e.tags.some(
              (t) => t[0] === "a" && t[1] === archiveAddress,
            );
            const refsManifestEvent =
              !!manifest &&
              e.tags.some((t) => t[0] === "e" && t[1] === manifest!.id);
            if (refsAddress || refsManifestEvent) {
              revoked = true;
              decide();
            }
            return;
          }
          if (
            e.kind === decoded.kind &&
            e.tags.some((t) => t[0] === "d" && t[1] === decoded.identifier)
          ) {
            if (!manifest) manifest = e;
            // Don't resolve immediately — give a brief window for a deletion
            // event from a slower relay to land. If a deletion is already
            // known, decide() will short-circuit to revoked.
            if (graceTimer === null) {
              graceTimer = setTimeout(() => decide(), POST_MANIFEST_GRACE_MS);
            }
          }
        },
        error: (err: any) =>
          settle(() =>
            reject(new ShareResolveError("network", err?.message || "Couldn't reach any relay.")),
          ),
        complete: () => decide(),
      });
    timer = setTimeout(() => decide(), FETCH_TIMEOUT_MS);
  });

  // 4. Decrypt the content under the key.
  let plaintext: string;
  try {
    plaintext = await decryptManifestContent(evt.content, key);
  } catch (err) {
    if (err instanceof ShareDecryptError) {
      throw new ShareResolveError(err.code, err.message);
    }
    throw new ShareResolveError("bad_format", "This archive looks corrupted.");
  }

  // 5. Parse + validate the decrypted JSON.
  let body: any;
  try {
    body = JSON.parse(plaintext);
  } catch {
    throw new ShareResolveError("bad_format", "This archive looks corrupted.");
  }
  if (!body || typeof body !== "object" || !Array.isArray(body.tracks)) {
    throw new ShareResolveError("bad_format", "This archive looks corrupted.");
  }

  let tracks = (body.tracks as any[]).map(
    (t): RecipientTrack => ({
      recordingId: String(t.recordingId ?? ""),
      participantName: String(t.participantName ?? "Unknown"),
      participantPubkey: String(t.participantPubkey ?? ""),
      durationSeconds: Number(t.durationSeconds ?? 0),
      sizeBytes: Number(t.sizeBytes ?? 0),
      mimeType: String(t.mimeType ?? "application/octet-stream"),
      url: t.url ? String(t.url) : null,
      hash: t.hash ? String(t.hash) : null,
      eventId: t.eventId ? String(t.eventId) : null,
    }),
  );

  if (trackId) {
    tracks = tracks.filter((t) => t.recordingId === trackId);
  }

  return {
    archiveId: input.pointer,
    sessionTitle: String(body.sessionTitle ?? "Untitled session"),
    hostName: String(body.hostName ?? "Host"),
    endedAt: String(body.endedAt ?? ""),
    archivedAt: String(body.archivedAt ?? ""),
    trackCount: Number(body.trackCount ?? tracks.length),
    tracks,
    scopedToTrackId: trackId,
  };
}

/** Re-export so consumers can construct keys for tests / debugging. */
export { decodeShareKey };

/**
 * Compute the lowercase-hex SHA-256 of a downloaded blob so the recipient page
 * can verify the bytes match the per-track hash from the decrypted manifest.
 * The manifest carries hashes the host computed at upload time (see
 * `sha256Hex` in `blossom.ts`); recomputing here detects a storage server that
 * swapped the file between upload and download.
 */
export async function sha256HexOfBlob(blob: Blob): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("Web Crypto is not available in this environment");
  }
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type TrackHashVerification =
  | { status: "ok"; actual: string }
  | { status: "mismatch"; actual: string; expected: string }
  | { status: "skipped"; reason: "no_expected_hash" }
  | { status: "error"; message: string };

/**
 * Verify a downloaded blob against the per-track hash from the decrypted
 * manifest. Returns a structured result so the UI can distinguish a true
 * mismatch (loud warning, do not save) from a manifest that simply didn't
 * include a hash (skip verification, save normally).
 *
 * Comparison is case-insensitive to tolerate manifests that happen to store
 * the hash in upper case, and trims whitespace for the same reason.
 */
export async function verifyTrackHash(
  blob: Blob,
  expected: string | null | undefined,
): Promise<TrackHashVerification> {
  const trimmed = typeof expected === "string" ? expected.trim() : "";
  if (!trimmed) {
    return { status: "skipped", reason: "no_expected_hash" };
  }
  let actual: string;
  try {
    actual = await sha256HexOfBlob(blob);
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Couldn't verify the file.",
    };
  }
  if (actual.toLowerCase() === trimmed.toLowerCase()) {
    return { status: "ok", actual };
  }
  return { status: "mismatch", actual, expected: trimmed.toLowerCase() };
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)));
}

/**
 * Whether a download URL is safe to render directly into an `<a href>`. Only
 * https / http / blob / data are allowed — `javascript:` and other unsafe
 * schemes are rejected. The recipient page renders attacker-controlled
 * (decrypted) URLs, so this gate is critical to prevent click-triggered
 * script execution.
 */
export function isSafeDownloadUrl(raw: string | null | undefined): boolean {
  if (!raw || typeof raw !== "string") return false;
  let parsed: URL;
  try {
    parsed = new URL(raw, window.location.origin);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" || parsed.protocol === "http:" || parsed.protocol === "blob:";
}
