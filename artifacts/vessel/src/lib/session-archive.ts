import type { Event } from "nostr-tools/pure";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools/pure";
import type { VesselIdentity } from "./identity";
import { getRelayPool } from "./relay-pool";
import { getPublishRelays } from "./relay-config";
import {
  encryptManifestContent,
  encodeShareKey,
  encodeSharePointer,
  buildArchiveFingerprint,
  generateShareKey,
  generateRandomIdentifier,
} from "./share-crypto";
import { rememberShareForRevoke, encodeEphemeralSecret } from "./share-revoke";

/**
 * Session archive publishing.
 *
 * "Archive" is what the user sees. Under the hood we publish two kinds of
 * Nostr events to the configured public relays:
 *   - Kind 1063 (file metadata, NIP-94 inspired) — one per recorded track.
 *     The public tags carry only opaque/random data; real per-track URLs and
 *     hashes live inside the encrypted manifest content.
 *   - Kind 30563 (parameterized replaceable manifest) — one per session,
 *     content is AES-256-GCM encrypted under a fresh per-archive key.
 *
 * The events are signed by a fresh ephemeral keypair (NOT the host's primary
 * identity) so a relay scraper can't link multiple sessions back to the same
 * host. The decryption key is base64url-encoded into the URL fragment of the
 * share link, which never travels over HTTP. The recipient page at /s/:pointer
 * fetches the manifest from the relays, decrypts client-side, and renders the
 * download UI.
 */

/** Per-stream blob descriptor inside an archive manifest. */
export type ArchiveStream = {
  url: string | null | undefined;
  hash: string | null | undefined;
  sizeBytes: number;
  mimeType: string;
};

export type TrackDescriptor = {
  recordingId: string;
  participantPubkey: string;
  participantName: string;
  /** Combined V+A blob — always present (it may also be audio-only when no
   *  camera was used; that's reflected in `mimeType`). */
  blobUrl: string | null | undefined;
  blobHash: string | null | undefined;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number;
  /** Audio-only sibling blob, recorded in parallel by a second MediaRecorder.
   *  Null when no audio-only sibling exists. */
  audio?: ArchiveStream | null;
  /** Video-only sibling blob (no audio bytes), recorded in parallel by a
   *  third MediaRecorder. Null when no camera was on or the recorder didn't
   *  produce a sibling. Surfaced in the manifest so recipients can offer a
   *  true "Video only" download cross-device with no transcoding. */
  video?: ArchiveStream | null;
  /** Optional screen-share blob captured in parallel when the participant
   *  pressed "Share screen" during the call. Carries its own duration so the
   *  vault can label it independently of the camera/audio track length —
   *  the screen recorder may have started or stopped at a different time
   *  than the camera/audio recorder. Null when the participant never
   *  shared, the share was too short to flush a chunk, or the screen
   *  recorder errored before producing a blob. */
  screen?: ArchiveStream | null;
  screenDurationSeconds?: number | null;
};

export type SessionArchiveInput = {
  sessionId: string;
  sessionTitle: string;
  hostPubkey: string;
  hostName: string;
  endedAt: Date;
};

export type RelayPublishStatus = {
  url: string;
  ok: boolean;
  message?: string;
};

export type SessionArchiveResult = {
  /** Short user-facing fingerprint (hex, friendly grouping). Safe to display. */
  archiveId: string;
  /** Opaque pointer used inside `/s/<pointer>` URLs. Never shown to users. */
  pointer: string;
  shareUrl: string;            // /s/<pointer>#<key>
  perTrackUrls: Array<{
    recordingId: string;
    participantName: string;
    url: string;               // /s/<pointer>#<key>/<recordingId>
    eventId: string;
  }>;
  manifestEventId: string;
  archivedAt: string;          // ISO timestamp
  /** One entry per relay we tried. ≥1 ok=true means the archive is reachable. */
  publish: {
    relays: RelayPublishStatus[];
    successCount: number;
    totalCount: number;
  };
};

const KIND_FILE_METADATA = 1063;
const KIND_SESSION_MANIFEST = 30563;

const PUBLISH_TIMEOUT_MS = 8000;
const PUBLISH_MAX_ATTEMPTS = 3;
const PUBLISH_RETRY_DELAY_MS = 800;

function getConfiguredRelays(identity?: VesselIdentity | null): string[] {
  // Deployment-level override always wins. Set by ops, not the user.
  const raw = (import.meta.env.VITE_NOSTR_RELAYS as string | undefined) || "";
  const envList = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("ws://") || s.startsWith("wss://"));
  if (envList.length > 0) return envList;
  // Otherwise: the participant's own configured publish endpoints. When no
  // identity is supplied (e.g. anonymous publish), this falls back to the
  // global slot or the built-in defaults — see relay-config.getPublishRelays.
  return getPublishRelays(identity?._pubkey);
}

/** Build a kind-1063 file-metadata event for a single track. The public tags
 *  intentionally carry only opaque metadata; the real URL and hash are inside
 *  the encrypted manifest. */
function buildPublicTrackEvent(
  ephemeralSecret: Uint8Array,
  track: TrackDescriptor,
  createdAt: number,
): Event {
  const tags: string[][] = [
    ["d", `vessel-track-${generateRandomIdentifier(8)}`],
    ["m", track.mimeType],
    ["size", String(track.sizeBytes)],
    ["duration", String(track.durationSeconds)],
    ["alt", "Encrypted Vessel session track"],
  ];
  return finalizeEvent(
    {
      kind: KIND_FILE_METADATA,
      created_at: createdAt,
      tags,
      content: "",
    },
    ephemeralSecret,
  );
}

/** Build the encrypted kind-30563 manifest event, signed by the ephemeral key. */
async function buildEncryptedManifestEvent(opts: {
  ephemeralSecret: Uint8Array;
  shareKey: Uint8Array;
  identifier: string;
  session: SessionArchiveInput;
  trackEvents: Event[];
  trackDescriptors: TrackDescriptor[];
  createdAt: number;
}): Promise<Event> {
  const { ephemeralSecret, shareKey, identifier, session, trackEvents, trackDescriptors, createdAt } = opts;

  const tags: string[][] = [
    ["d", identifier],
    ["alt", "Encrypted Vessel session archive"],
  ];

  // v: 4 — adds the optional `screen` sibling (clean screen-share blob
  // recorded in parallel when the participant pressed "Share screen"
  // during the call) parallel to `audio` (v=2) and `video` (v=3). Older
  // recipients that only know v=1/v=2/v=3 still see all their existing
  // fields in the same place — `screen` is purely additive.
  const plaintext = JSON.stringify({
    v: 4,
    sessionTitle: session.sessionTitle,
    hostName: session.hostName,
    endedAt: session.endedAt.toISOString(),
    archivedAt: new Date(createdAt * 1000).toISOString(),
    trackCount: trackDescriptors.length,
    tracks: trackDescriptors.map((t, i) => {
      const audio =
        t.audio && t.audio.url && !String(t.audio.url).startsWith("idb://")
          ? {
              url: t.audio.url,
              hash: t.audio.hash || null,
              sizeBytes: t.audio.sizeBytes,
              mimeType: t.audio.mimeType,
            }
          : null;
      const video =
        t.video && t.video.url && !String(t.video.url).startsWith("idb://")
          ? {
              url: t.video.url,
              hash: t.video.hash || null,
              sizeBytes: t.video.sizeBytes,
              mimeType: t.video.mimeType,
            }
          : null;
      const screen =
        t.screen && t.screen.url && !String(t.screen.url).startsWith("idb://")
          ? {
              url: t.screen.url,
              hash: t.screen.hash || null,
              sizeBytes: t.screen.sizeBytes,
              mimeType: t.screen.mimeType,
              durationSeconds: t.screenDurationSeconds ?? null,
            }
          : null;
      return {
        recordingId: t.recordingId,
        participantName: t.participantName,
        participantPubkey: t.participantPubkey,
        durationSeconds: t.durationSeconds,
        sizeBytes: t.sizeBytes,
        mimeType: t.mimeType,
        url: t.blobUrl && !t.blobUrl.startsWith("idb://") ? t.blobUrl : null,
        hash: t.blobHash || null,
        audio,
        video,
        screen,
        eventId: trackEvents[i]?.id ?? null,
      };
    }),
  });

  const content = await encryptManifestContent(plaintext, shareKey);

  return finalizeEvent(
    {
      kind: KIND_SESSION_MANIFEST,
      created_at: createdAt,
      tags,
      content,
    },
    ephemeralSecret,
  );
}

function buildShareUrl(pointer: string, shareKeyEncoded: string, trackId?: string): string {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  // The fragment never travels to a server.
  const frag = trackId ? `${shareKeyEncoded}/${encodeURIComponent(trackId)}` : shareKeyEncoded;
  return `${window.location.origin}${base}/s/${pointer}#${frag}`;
}

/** Publish one event with bounded retries. Returns the per-relay statuses. */
async function publishWithRetry(
  pool: ReturnType<typeof getRelayPool>,
  relays: string[],
  event: Event,
): Promise<Array<{ ok: boolean; message?: string; from: string }>> {
  // Track best-known status per relay across attempts. Once a relay says ok,
  // we stop retrying it. Failures get retried up to PUBLISH_MAX_ATTEMPTS times.
  const statusByRelay = new Map<string, { ok: boolean; message?: string; from: string }>();
  for (const r of relays) statusByRelay.set(r, { ok: false, from: r, message: "Not yet attempted" });

  for (let attempt = 1; attempt <= PUBLISH_MAX_ATTEMPTS; attempt++) {
    const remaining = relays.filter((r) => !statusByRelay.get(r)?.ok);
    if (remaining.length === 0) break;
    let responses: Array<{ ok: boolean; message?: string; from: string }>;
    try {
      responses = (await Promise.race([
        pool.publish(remaining, event),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Publish timeout")), PUBLISH_TIMEOUT_MS),
        ),
      ])) as Array<{ ok: boolean; message?: string; from: string }>;
    } catch (err: any) {
      responses = remaining.map((r) => ({ ok: false, from: r, message: err?.message || "Publish failed" }));
    }
    for (const r of responses) {
      const prev = statusByRelay.get(r.from);
      if (!prev || (!prev.ok && r.ok)) {
        statusByRelay.set(r.from, { ok: r.ok, from: r.from, message: r.message });
      } else if (!prev.ok) {
        // keep the latest error message for diagnostics
        statusByRelay.set(r.from, { ok: false, from: r.from, message: r.message ?? prev.message });
      }
    }
    // back off before the next round
    if (attempt < PUBLISH_MAX_ATTEMPTS && Array.from(statusByRelay.values()).some((s) => !s.ok)) {
      await new Promise((res) => setTimeout(res, PUBLISH_RETRY_DELAY_MS * attempt));
    }
  }

  return Array.from(statusByRelay.values());
}

/**
 * Publish a session archive end-to-end:
 *  - Generate ephemeral keypair + symmetric share key.
 *  - Encrypt the manifest content under the share key.
 *  - Publish the manifest + per-track events to the configured relays.
 *  - Return user-facing share URLs with the share key in the URL fragment.
 *
 * We treat the publish as successful if ≥1 relay accepts the manifest. The
 * caller can inspect `result.publish` to surface partial-success messaging.
 */
export async function publishSessionArchive(
  identity: VesselIdentity,
  session: SessionArchiveInput,
  tracks: TrackDescriptor[],
): Promise<SessionArchiveResult> {
  if (!identity) {
    throw new Error("Identity is required to archive a session");
  }
  if (!tracks.length) {
    throw new Error("No tracks to archive");
  }

  const createdAt = Math.floor(Date.now() / 1000);
  const ephemeralSecret = generateSecretKey();
  const ephemeralPubkey = getPublicKey(ephemeralSecret);
  const shareKey = generateShareKey();
  const shareKeyEncoded = encodeShareKey(shareKey);
  const identifier = generateRandomIdentifier(16);

  const trackEvents = tracks.map((t) =>
    buildPublicTrackEvent(ephemeralSecret, t, createdAt),
  );
  const manifestEvent = await buildEncryptedManifestEvent({
    ephemeralSecret,
    shareKey,
    identifier,
    session,
    trackEvents,
    trackDescriptors: tracks,
    createdAt,
  });

  const relays = getConfiguredRelays(identity);
  const pool = getRelayPool();

  // Publish manifest + tracks in parallel, each with bounded retries. We
  // tolerate per-relay failures and surface them up so the UI can show a
  // partial-success caption. A relay is considered fully "ok" for this archive
  // only if every event sent to it ultimately succeeded.
  const allEvents = [manifestEvent, ...trackEvents];
  const publishResults = await Promise.all(
    allEvents.map((evt) => publishWithRetry(pool, relays, evt)),
  );

  const relayMap = new Map<string, RelayPublishStatus>();
  for (const url of relays) {
    relayMap.set(url, { url, ok: true });
  }
  for (const eventResults of publishResults) {
    for (const r of eventResults) {
      const prev = relayMap.get(r.from);
      if (!prev) {
        relayMap.set(r.from, { url: r.from, ok: r.ok, message: r.message });
        continue;
      }
      if (!r.ok && prev.ok) {
        prev.ok = false;
        prev.message = r.message;
      }
    }
  }
  const relayStatuses = Array.from(relayMap.values());
  const successCount = relayStatuses.filter((r) => r.ok).length;

  const pointer = encodeSharePointer({
    kind: KIND_SESSION_MANIFEST,
    pubkey: ephemeralPubkey,
    identifier,
    relays,
  });
  const archiveId = buildArchiveFingerprint(manifestEvent.id);

  const archivedAt = new Date(createdAt * 1000).toISOString();
  const shareUrl = buildShareUrl(pointer, shareKeyEncoded);

  // Persist material needed to later sign a kind-5 deletion event under the
  // SAME ephemeral pubkey. We only do this when at least one relay accepted
  // the manifest — otherwise there's nothing to revoke.
  if (successCount > 0) {
    rememberShareForRevoke({
      archiveId,
      pointer,
      manifestEventId: manifestEvent.id,
      ephemeralPubkey,
      ephemeralSecretB64: encodeEphemeralSecret(ephemeralSecret),
      identifier,
      kind: KIND_SESSION_MANIFEST,
      relays,
      publishedAt: archivedAt,
    });
  }

  const perTrackUrls = tracks.map((t, i) => ({
    recordingId: t.recordingId,
    participantName: t.participantName,
    url: buildShareUrl(pointer, shareKeyEncoded, t.recordingId),
    eventId: trackEvents[i].id,
  }));

  return {
    archiveId,
    pointer,
    shareUrl,
    perTrackUrls,
    manifestEventId: manifestEvent.id,
    archivedAt,
    publish: {
      relays: relayStatuses,
      successCount,
      totalCount: relayStatuses.length,
    },
  };
}

// `identity` is no longer required for signing (we use an ephemeral key) but
// the parameter is kept for callers and future analytics. Reference it once
// here so TypeScript doesn't strip the import as unused.
export type { VesselIdentity };

// ─────────────────────────────────────────────────────────────────────────────
// Per-participant ("personal") archives
// ─────────────────────────────────────────────────────────────────────────────
//
// The host's archive (above) bundles every track. In addition to that, every
// participant — including each guest — automatically gets their OWN single-
// track archive at session end. Three properties matter:
//
//   1. The personal archive is signed by an ephemeral key generated and held
//      only on the participant's device, so they (and only they) can later
//      sign a deletion event and pull the link offline.
//   2. The encrypted manifest contains exactly one track: their own. Even if
//      a relay scraper somehow got past encryption they couldn't reconstruct
//      the conversation from a personal archive alone.
//   3. The personal share URL — together with an /r/:pointer receipt page —
//      is what guests walk away with. It's the visible proof of the federated
//      ownership model: "this is your audio, here's where it lives, here's
//      how to take it down."
//
// Personal archives reuse the same publishing primitives (kind 30563 manifest
// + kind 1063 file metadata) so the existing share-resolver already understands
// them. The only difference is the manifest carries a single-track payload.

export type PersonalArchiveInput = {
  sessionId: string;
  sessionTitle: string;
  hostName: string;
  endedAt: Date;
  /** True if this archive belongs to the session host. Drives receipt copy. */
  isHost: boolean;
  /** Other people who were on the call (best-effort; just for the receipt). */
  otherParticipantNames: string[];
};

export type PersonalArchiveResult = {
  archiveId: string;
  pointer: string;
  /** /s/<pointer>#<key> — opens the existing recipient page. */
  shareUrl: string;
  /** /r/<pointer>#<key> — opens the friendly receipt page. */
  receiptUrl: string;
  manifestEventId: string;
  archivedAt: string;
  publish: {
    relays: RelayPublishStatus[];
    successCount: number;
    totalCount: number;
  };
};

function buildReceiptUrl(pointer: string, shareKeyEncoded: string): string {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  return `${window.location.origin}${base}/r/${pointer}#${shareKeyEncoded}`;
}

/**
 * Publish a single-track "personal" archive owned by the participant.
 *
 * Returns both the canonical share URL (pointing at the existing recipient
 * page) and a receipt URL (`/r/:pointer`) that wraps the same manifest in a
 * receipt-styled view with download + revoke calls to action.
 *
 * `identity` is unused for signing — we generate a fresh ephemeral key per
 * archive — but is accepted to keep the call-site parallel with
 * {@link publishSessionArchive} and to leave room for future analytics.
 */
export async function publishPersonalArchive(
  identity: VesselIdentity | null,
  input: PersonalArchiveInput,
  track: TrackDescriptor,
): Promise<PersonalArchiveResult> {
  if (!track) {
    throw new Error("A recorded track is required to publish a personal archive");
  }

  const createdAt = Math.floor(Date.now() / 1000);
  const ephemeralSecret = generateSecretKey();
  const ephemeralPubkey = getPublicKey(ephemeralSecret);
  const shareKey = generateShareKey();
  const shareKeyEncoded = encodeShareKey(shareKey);
  const identifier = generateRandomIdentifier(16);

  const trackEvent = buildPublicTrackEvent(ephemeralSecret, track, createdAt);
  const manifestEvent = await buildEncryptedManifestEvent({
    ephemeralSecret,
    shareKey,
    identifier,
    session: {
      sessionId: input.sessionId,
      sessionTitle: input.sessionTitle,
      hostPubkey: track.participantPubkey,
      hostName: input.hostName,
      endedAt: input.endedAt,
    },
    trackEvents: [trackEvent],
    trackDescriptors: [track],
    createdAt,
  });

  const relays = getConfiguredRelays(identity);
  const pool = getRelayPool();

  const allEvents = [manifestEvent, trackEvent];
  const publishResults = await Promise.all(
    allEvents.map((evt) => publishWithRetry(pool, relays, evt)),
  );

  const relayMap = new Map<string, RelayPublishStatus>();
  for (const url of relays) relayMap.set(url, { url, ok: true });
  for (const eventResults of publishResults) {
    for (const r of eventResults) {
      const prev = relayMap.get(r.from);
      if (!prev) {
        relayMap.set(r.from, { url: r.from, ok: r.ok, message: r.message });
        continue;
      }
      if (!r.ok && prev.ok) {
        prev.ok = false;
        prev.message = r.message;
      }
    }
  }
  const relayStatuses = Array.from(relayMap.values());
  const successCount = relayStatuses.filter((r) => r.ok).length;

  const pointer = encodeSharePointer({
    kind: KIND_SESSION_MANIFEST,
    pubkey: ephemeralPubkey,
    identifier,
    relays,
  });
  const archiveId = buildArchiveFingerprint(manifestEvent.id);
  const archivedAt = new Date(createdAt * 1000).toISOString();
  const shareUrl = buildShareUrl(pointer, shareKeyEncoded);
  const receiptUrl = buildReceiptUrl(pointer, shareKeyEncoded);

  if (successCount > 0) {
    rememberShareForRevoke({
      archiveId,
      pointer,
      manifestEventId: manifestEvent.id,
      ephemeralPubkey,
      ephemeralSecretB64: encodeEphemeralSecret(ephemeralSecret),
      identifier,
      kind: KIND_SESSION_MANIFEST,
      relays,
      publishedAt: archivedAt,
    });
  }

  // We intentionally don't `void` `input.isHost` / `otherParticipantNames`
  // here — they're carried into the receipt UI through a separate
  // localStorage record (see `personal-receipts.ts`) so the receipt page can
  // render even after the manifest is revoked.
  void input.isHost;
  void input.otherParticipantNames;

  return {
    archiveId,
    pointer,
    shareUrl,
    receiptUrl,
    manifestEventId: manifestEvent.id,
    archivedAt,
    publish: {
      relays: relayStatuses,
      successCount,
      totalCount: relayStatuses.length,
    },
  };
}
