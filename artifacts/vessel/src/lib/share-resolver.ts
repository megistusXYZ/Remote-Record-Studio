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
  | "network";

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

  // 3. Race the relays for the matching event. We treat the request as an
  //    Observable but consume it via subscribe + Promise so we don't add a
  //    direct rxjs dependency to this package. Defensive: always unsubscribe
  //    in every settle path (resolve, reject, timeout, error, complete) — the
  //    relay pool's request observable can stay open keeping sockets in use.
  const pool = getRelayPool();
  const evt: Event = await new Promise<Event>((resolve, reject) => {
    let settled = false;
    let sub: { unsubscribe: () => void } | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
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
    sub = pool
      .request(relays, [
        {
          kinds: [decoded.kind],
          authors: [decoded.pubkey],
          "#d": [decoded.identifier],
          limit: 1,
        },
      ])
      .subscribe({
        next: (e: Event) => {
          if (settled) return;
          if (
            e.kind === decoded.kind &&
            e.pubkey === decoded.pubkey &&
            e.tags.some((t) => t[0] === "d" && t[1] === decoded.identifier)
          ) {
            settle(() => resolve(e));
          }
        },
        error: (err: any) =>
          settle(() =>
            reject(new ShareResolveError("network", err?.message || "Couldn't reach any relay.")),
          ),
        complete: () =>
          settle(() =>
            reject(
              new ShareResolveError(
                "not_found",
                "We couldn't find this archive on any relay.",
              ),
            ),
          ),
      });
    timer = setTimeout(() => {
      settle(() =>
        reject(
          new ShareResolveError(
            "not_found",
            "We couldn't find this archive on any relay.",
          ),
        ),
      );
    }, FETCH_TIMEOUT_MS);
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
