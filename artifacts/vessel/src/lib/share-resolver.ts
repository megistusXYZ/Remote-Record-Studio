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

/** A single per-stream blob descriptor inside a recipient track. */
export type RecipientStream = {
  url: string | null;
  hash: string | null;
  sizeBytes: number;
  mimeType: string;
};

export type RecipientTrack = {
  recordingId: string;
  participantName: string;
  participantPubkey: string;
  durationSeconds: number;
  /** Combined V+A blob's size. Mirrored at top level for backward
   *  compatibility with v=1 recipients that only knew one stream. */
  sizeBytes: number;
  mimeType: string;
  url: string | null;
  hash: string | null;
  /** Audio-only sibling blob (v≥2 manifests). Null when not present. */
  audio: RecipientStream | null;
  /** Video-only sibling blob (v≥3 manifests). Null when not present (legacy
   *  manifests, no camera, or video-only sync failed on the host). */
  video: RecipientStream | null;
  /** Screen-share sibling blob (v≥4 manifests). Null when the participant
   *  never shared their screen, the share was too short to flush a chunk,
   *  or the upload didn't reach a sharing server before the session ended. */
  screen: RecipientStream | null;
  /** Wall-clock duration of the screen-share file. May differ from the
   *  combined track's duration because the screen recorder starts/stops
   *  on Share-screen, not on session start/end. Null when no screen file. */
  screenDurationSeconds: number | null;
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

/** Pure: normalize one raw track entry from a v=1/2/3 manifest into a
 *  RecipientTrack. v=1 carries only `{url, hash}`; v=2 adds `audio`; v=3
 *  adds `video`. Older shapes parse cleanly here with safe defaults. */
export function parseManifestTrack(raw: unknown): RecipientTrack {
  const t = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawAudio = t.audio && typeof t.audio === "object" ? (t.audio as Record<string, unknown>) : null;
  const audio: RecipientStream | null = rawAudio
    ? {
        url: rawAudio.url ? String(rawAudio.url) : null,
        hash: rawAudio.hash ? String(rawAudio.hash) : null,
        sizeBytes: Number(rawAudio.sizeBytes ?? 0),
        mimeType: String(rawAudio.mimeType ?? "audio/webm"),
      }
    : null;
  const rawVideo = t.video && typeof t.video === "object" ? (t.video as Record<string, unknown>) : null;
  const video: RecipientStream | null = rawVideo
    ? {
        url: rawVideo.url ? String(rawVideo.url) : null,
        hash: rawVideo.hash ? String(rawVideo.hash) : null,
        sizeBytes: Number(rawVideo.sizeBytes ?? 0),
        mimeType: String(rawVideo.mimeType ?? "video/webm"),
      }
    : null;
  // Screen sibling — same defensive parse as audio/video. We accept
  // missing duration as null (the recipient page just won't show a
  // separate runtime for the screen file when it's absent).
  const rawScreen = t.screen && typeof t.screen === "object" ? (t.screen as Record<string, unknown>) : null;
  const screen: RecipientStream | null = rawScreen
    ? {
        url: rawScreen.url ? String(rawScreen.url) : null,
        hash: rawScreen.hash ? String(rawScreen.hash) : null,
        sizeBytes: Number(rawScreen.sizeBytes ?? 0),
        mimeType: String(rawScreen.mimeType ?? "video/webm"),
      }
    : null;
  // Screen duration may live inside the `screen` block (preferred) or as
  // a top-level sibling on the manifest track row — accept either shape
  // so older drafts that landed before the field moved still parse.
  const screenDurationRaw =
    rawScreen && rawScreen.durationSeconds != null
      ? rawScreen.durationSeconds
      : t.screenDurationSeconds;
  const screenDurationSeconds =
    screen && screenDurationRaw != null ? Number(screenDurationRaw) : null;
  return {
    recordingId: String(t.recordingId ?? ""),
    participantName: String(t.participantName ?? "Unknown"),
    participantPubkey: String(t.participantPubkey ?? ""),
    durationSeconds: Number(t.durationSeconds ?? 0),
    sizeBytes: Number(t.sizeBytes ?? 0),
    mimeType: String(t.mimeType ?? "application/octet-stream"),
    url: t.url ? String(t.url) : null,
    hash: t.hash ? String(t.hash) : null,
    audio,
    video,
    screen,
    screenDurationSeconds,
    eventId: t.eventId ? String(t.eventId) : null,
  };
}

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
      "This link looks malformed.",
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
            "We couldn't find this share yet.",
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
          settle(() => {
            console.warn("[share-resolver] subscription error", err);
            reject(new ShareResolveError("network", "Couldn't reach the network."));
          }),
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
    throw new ShareResolveError("bad_format", "This share looks corrupted.");
  }

  // 5. Parse + validate the decrypted JSON.
  let body: any;
  try {
    body = JSON.parse(plaintext);
  } catch {
    throw new ShareResolveError("bad_format", "This share looks corrupted.");
  }
  if (!body || typeof body !== "object" || !Array.isArray(body.tracks)) {
    throw new ShareResolveError("bad_format", "This share looks corrupted.");
  }

  let tracks = (body.tracks as unknown[]).map(parseManifestTrack);

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
    throw new Error("This browser can't verify downloads.");
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
