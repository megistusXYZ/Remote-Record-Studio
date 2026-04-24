import type { Event } from "nostr-tools/pure";
import { nip19 } from "nostr-tools";
import type { VesselIdentity } from "./identity";

/**
 * Session archive publishing.
 *
 * "Archive" is what the user sees. Under the hood we sign two kinds of Nostr events:
 *   - Kind 1063 (file metadata, NIP-94 inspired) — one per recorded track
 *   - Kind 30563 (parameterized replaceable manifest) — one per session
 *
 * The events are real signed Nostr events; the publish step itself is currently
 * simulated (no relay POST yet). The Archive ID returned is a real, decodable naddr.
 */

export type TrackDescriptor = {
  recordingId: string;
  participantPubkey: string;
  participantName: string;
  blobUrl: string | null | undefined;
  blobHash: string | null | undefined;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number;
};

export type SessionArchiveInput = {
  sessionId: string;
  sessionTitle: string;
  hostPubkey: string;
  hostName: string;
  endedAt: Date;
};

export type SessionArchiveResult = {
  archiveId: string;          // naddr1...
  shareUrl: string;            // full URL pointing back to the app vault entry
  perTrackUrls: Array<{
    recordingId: string;
    participantName: string;
    url: string;
    eventId: string;           // 1063 event id
  }>;
  manifestEventId: string;     // 30563 event id
  archivedAt: string;          // ISO timestamp
};

const KIND_FILE_METADATA = 1063;
const KIND_SESSION_MANIFEST = 30563;

async function buildTrackEvent(
  identity: VesselIdentity,
  session: SessionArchiveInput,
  track: TrackDescriptor,
  createdAt: number
): Promise<Event> {
  const tags: string[][] = [
    ["d", `vessel-track-${track.recordingId}`],
    ["m", track.mimeType],
    ["size", String(track.sizeBytes)],
    ["duration", String(track.durationSeconds)],
    ["session", session.sessionId],
    ["alt", `Vessel session track: ${track.participantName} — ${session.sessionTitle}`],
  ];
  // Only emit a "url" tag if we actually have a remote URL — empty strings break
  // strict NIP-94 consumers. Local-only tracks (idb://...) get omitted.
  if (track.blobUrl && !track.blobUrl.startsWith("idb://")) {
    tags.push(["url", track.blobUrl]);
  }
  if (track.blobHash) {
    tags.push(["x", track.blobHash]);
  }

  const template = {
    kind: KIND_FILE_METADATA,
    created_at: createdAt,
    tags,
    content: `${track.participantName} — ${session.sessionTitle}`,
  };

  return identity._signer.signEvent(template);
}

async function buildManifestEvent(
  identity: VesselIdentity,
  session: SessionArchiveInput,
  trackEvents: Event[],
  trackDescriptors: TrackDescriptor[],
  createdAt: number
): Promise<Event> {
  const tags: string[][] = [
    ["d", session.sessionId],
    ["title", session.sessionTitle],
    ["session", session.sessionId],
    ["host", session.hostName],
    ["ended_at", session.endedAt.toISOString()],
    ["track_count", String(trackEvents.length)],
  ];

  for (const evt of trackEvents) {
    tags.push(["e", evt.id, "", "track"]);
  }

  const content = JSON.stringify({
    sessionId: session.sessionId,
    title: session.sessionTitle,
    archivedAt: new Date(createdAt * 1000).toISOString(),
    trackCount: trackEvents.length,
    tracks: trackDescriptors.map((t) => ({
      recordingId: t.recordingId,
      participantName: t.participantName,
      participantPubkey: t.participantPubkey,
      durationSeconds: t.durationSeconds,
      sizeBytes: t.sizeBytes,
      mimeType: t.mimeType,
    })),
  });

  const template = {
    kind: KIND_SESSION_MANIFEST,
    created_at: createdAt,
    tags,
    content,
  };

  return identity._signer.signEvent(template);
}

function buildAppShareUrl(archiveId: string, sessionId: string): string {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  const u = new URL(`${window.location.origin}${base}/vault`);
  u.searchParams.set("session", sessionId);
  u.searchParams.set("archive", archiveId);
  return u.toString();
}

function buildPerTrackUrl(
  archiveId: string,
  sessionId: string,
  recordingId: string
): string {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  const u = new URL(`${window.location.origin}${base}/vault`);
  u.searchParams.set("session", sessionId);
  u.searchParams.set("track", recordingId);
  u.searchParams.set("archive", archiveId);
  return u.toString();
}

/**
 * Publish a session archive. Builds + signs the manifest events and (currently)
 * simulates the upload to a Nostr relay. Returns shareable URLs and a real naddr.
 */
export async function publishSessionArchive(
  identity: VesselIdentity,
  session: SessionArchiveInput,
  tracks: TrackDescriptor[]
): Promise<SessionArchiveResult> {
  if (!identity._signer) {
    throw new Error("Identity is not ready to sign archive events");
  }
  if (!tracks.length) {
    throw new Error("No tracks to archive");
  }

  const createdAt = Math.floor(Date.now() / 1000);

  const trackEvents = await Promise.all(
    tracks.map((t) => buildTrackEvent(identity, session, t, createdAt))
  );
  const manifestEvent = await buildManifestEvent(
    identity,
    session,
    trackEvents,
    tracks,
    createdAt
  );

  // Simulate publish to a relay so the UI feels real.
  await new Promise((r) => setTimeout(r, 600));

  const archiveId = nip19.naddrEncode({
    identifier: session.sessionId,
    pubkey: identity._pubkey,
    kind: KIND_SESSION_MANIFEST,
  });

  const archivedAt = new Date(createdAt * 1000).toISOString();
  const shareUrl = buildAppShareUrl(archiveId, session.sessionId);

  const perTrackUrls = tracks.map((t, i) => ({
    recordingId: t.recordingId,
    participantName: t.participantName,
    url: buildPerTrackUrl(archiveId, session.sessionId, t.recordingId),
    eventId: trackEvents[i].id,
  }));

  return {
    archiveId,
    shareUrl,
    perTrackUrls,
    manifestEventId: manifestEvent.id,
    archivedAt,
  };
}
