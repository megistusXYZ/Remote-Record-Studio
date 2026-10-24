import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NostrEvent } from "nostr-tools";
import { getRelayPool } from "../lib/relay-pool";
import { useIdentity } from "./use-identity";
import { DEFAULT_SIGNAL_RELAYS } from "./use-call-signal";
import type { TrackExportSource } from "../lib/track-export";
import {
  resolveShareLink,
  ShareResolveError,
  type RecipientManifest,
  type RecipientTrack,
} from "../lib/share-resolver";

/** Replaceable kind for personal-archive pointers (latest wins on
 *  `["d", sessionId]`). */
export const KIND_PERSONAL_ARCHIVE_POINTER = 27006;

/** How long the host listens for pointer events after the call ends. */
export const POINTER_LISTEN_WINDOW_MS = 60_000;

/** Pure helper for the host pointer-listen window. Exported for unit
 *  tests so the timing contract (start from session-end, never from hook
 *  mount) is locked down independently of React. */
export function computePointerWaitState(args: {
  enabled: boolean;
  sessionEndedAtMs: number | null;
  nowMs: number;
}): { isWaiting: boolean; remainingMs: number } {
  if (!args.enabled || args.sessionEndedAtMs == null) {
    return { isWaiting: false, remainingMs: 0 };
  }
  const elapsed = args.nowMs - args.sessionEndedAtMs;
  if (elapsed >= POINTER_LISTEN_WINDOW_MS) {
    return { isWaiting: false, remainingMs: 0 };
  }
  return {
    isWaiting: true,
    remainingMs: POINTER_LISTEN_WINDOW_MS - Math.max(elapsed, 0),
  };
}

/** Pointer payload published by each participant. Just the share URL —
 *  everything else is derivable by resolving the personal archive. */
export type PersonalArchivePointerPayload = {
  /** Full `/s/<pointer>#<key>` URL for the participant's personal archive. */
  shareUrl: string;
};

function safeJson<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/** Parse a Vessel share URL into the `(pointer, fragment)` pair `resolveShareLink`
 *  expects. Returns null when the URL doesn't look like one of ours. */
export function parseShareUrl(raw: string): { pointer: string; fragment: string } | null {
  if (typeof raw !== "string" || !raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const segs = url.pathname.split("/").filter(Boolean);
  const sIdx = segs.lastIndexOf("s");
  if (sIdx < 0 || sIdx >= segs.length - 1) return null;
  const pointer = segs[sIdx + 1];
  if (!pointer) return null;
  return { pointer, fragment: url.hash || "" };
}

/** Backoff schedule (ms) for the pointer publish — 5 tries over ~30s. */
export const POINTER_PUBLISH_BACKOFF_MS = [0, 1_500, 4_000, 9_000, 16_000];

/** Decide whether the local device should publish its personal-archive
 *  pointer for the host to pick up. Allowed under "complete" AND
 *  "partial-failure", as long as the combined remote URL/hash exist —
 *  publishing a partial manifest beats stranding the host on "still
 *  waiting" when only a sibling stream upload failed. */
export function shouldPublishPersonalArchive(
  syncStatus: string,
  result: { blobUrl?: string | null; blobHash?: string | null } | null,
): boolean {
  if (!result) return false;
  if (!result.blobUrl || !result.blobHash) return false;
  return syncStatus === "complete" || syncStatus === "partial-failure";
}

/** A read-only `has(pk)` predicate — accepts any container that exposes
 *  one (Map, Set, or a custom predicate function). */
export type PubkeyMembership =
  | { has: (key: string) => boolean }
  | ((key: string) => boolean);

function membershipHas(container: PubkeyMembership, key: string): boolean {
  return typeof container === "function" ? container(key) : container.has(key);
}

/** Accepted pubkeys still in flight. A pubkey is dropped from waiting
 *  the moment we have either a resolved manifest OR a terminal
 *  resolveError — a failed pointer must not stall the host UI forever. */
export function computeWaitingForPubkeys(args: {
  acceptedPubkeys: Iterable<string> | null | undefined;
  resolved: PubkeyMembership;
  resolveErrors: PubkeyMembership;
}): string[] {
  if (!args.acceptedPubkeys) return [];
  const out: string[] = [];
  for (const pk of args.acceptedPubkeys) {
    if (membershipHas(args.resolved, pk)) continue;
    if (membershipHas(args.resolveErrors, pk)) continue;
    out.push(pk);
  }
  return out;
}

/** Storage state for an aggregated host row. "remote" means the combined
 *  track AND every expected sibling resolved to a remote URL. "unknown"
 *  signals partial-archive (a sibling upload failed). */
export function deriveHostRowStorageState(args: {
  isVideoTrack: boolean;
  combinedRemoteUrl: string | null;
  audioSiblingRemoteUrl: string | null;
  videoSiblingRemoteUrl: string | null;
}): "remote" | "unknown" {
  if (!args.combinedRemoteUrl) return "unknown";
  if (!args.audioSiblingRemoteUrl) return "unknown";
  if (args.isVideoTrack && !args.videoSiblingRemoteUrl) return "unknown";
  return "remote";
}

/** Publish this device's personal-archive pointer. Replaceable on
 *  `["d", sessionId]`. Retries with backoff so a transient relay failure
 *  doesn't strand a participant from the host's aggregated view. */
export async function publishPersonalArchivePointer(args: {
  signer: { signEvent: (ev: any) => Promise<NostrEvent> };
  sessionId: string;
  shareUrl: string;
  relays?: string[];
  /** Override backoff schedule. Must contain at least one entry. */
  backoffMs?: number[];
  /** Sleep override (testing). */
  sleep?: (ms: number) => Promise<void>;
}): Promise<string> {
  const {
    signer,
    sessionId,
    shareUrl,
    relays = DEFAULT_SIGNAL_RELAYS,
    backoffMs = POINTER_PUBLISH_BACKOFF_MS,
    sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
  } = args;
  const payload: PersonalArchivePointerPayload = { shareUrl };
  const tmpl = {
    kind: KIND_PERSONAL_ARCHIVE_POINTER,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["d", sessionId]],
    content: JSON.stringify(payload),
  };
  const signed = await signer.signEvent(tmpl);
  const pool = getRelayPool();
  const schedule = backoffMs.length > 0 ? backoffMs : [0];
  let lastErr: unknown = null;
  for (let i = 0; i < schedule.length; i += 1) {
    if (schedule[i] > 0) await sleep(schedule[i]);
    try {
      await pool.publish(relays, signed);
      return signed.id;
    } catch (err) {
      lastErr = err;
      console.warn(
        `[personal-archive-pointer] publish attempt ${i + 1}/${schedule.length} failed`,
        err,
      );
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Failed to publish personal-archive pointer after retries");
}

/** A participant track aggregated from a resolved personal archive. */
export type AggregatedTrack = {
  /** Pubkey of the *primary identity* that signed the pointer event — i.e.
   *  the participant's stable identity, not the archive's ephemeral key. */
  participantPubkey: string;
  /** Verified manifest data for this participant's track. */
  recipientTrack: RecipientTrack;
  /** Wall-clock the host received the pointer event. Used for "latest
   *  wins" semantics when a participant re-publishes. */
  receivedAtMs: number;
  /** Pre-built export source so SessionComplete can hand it straight to
   *  the export helper. */
  source: TrackExportSource;
};

export type UseHostAggregatedTracksOptions = {
  /** Sessions this hook listens on. Falsy disables the subscription. */
  sessionId: string | null;
  /** Pubkeys we'll accept pointer events from. Pointers from any other
   *  pubkey are silently dropped to prevent strangers from injecting fake
   *  rows into the host's SessionComplete list. */
  acceptedPubkeys?: string[] | null;
  /** Defaults to true. Set false in non-host roles to skip aggregation. */
  enabled?: boolean;
  /** Stamp at which the session ended. The pointer-listen window starts
   *  from here (NOT hook mount). Pass null while the call is still live. */
  sessionEndedAtMs?: number | null;
  /** Override relays for testing. */
  relays?: string[];
};

type PointerRecord = {
  pubkey: string;
  shareUrl: string;
  receivedAtMs: number;
};

type ResolvedRecord = {
  pubkey: string;
  shareUrl: string;
  receivedAtMs: number;
  manifest: RecipientManifest;
};

/** Build the export-source view-model for a single resolved track.
 *  Exported for unit tests covering host aggregation across multiple
 *  participants. */
export function buildExportSource(track: RecipientTrack): TrackExportSource {
  return {
    participantName: track.participantName,
    combinedBlobUrl: track.url,
    combinedMimeType: track.mimeType,
    audioBlobUrl: track.audio?.url ?? null,
    audioMimeType: track.audio?.mimeType ?? null,
    videoOnlyRemoteUrl: track.video?.url ?? null,
    videoOnlyMimeType: track.video?.mimeType ?? null,
    screenRemoteUrl: track.screen?.url ?? null,
    screenMimeType: track.screen?.mimeType ?? null,
    durationSeconds: track.durationSeconds,
    startedAtMs: track.startedAtMs,
    serverOffsetMs: track.serverOffsetMs,
  };
}

/** Subscribe to remote participant personal-archive pointers for a given
 *  session. Always returns an empty list when disabled. The list is reset
 *  whenever the sessionId changes. */
export function useHostAggregatedTracks({
  sessionId,
  acceptedPubkeys,
  enabled = true,
  sessionEndedAtMs = null,
  relays = DEFAULT_SIGNAL_RELAYS,
}: UseHostAggregatedTracksOptions) {
  const { identity } = useIdentity();
  const [pointers, setPointers] = useState<Map<string, PointerRecord>>(new Map());
  const [resolved, setResolved] = useState<Map<string, ResolvedRecord>>(new Map());
  const [resolveErrors, setResolveErrors] = useState<Map<string, string>>(new Map());
  const [isWaiting, setIsWaiting] = useState(false);
  const acceptSetRef = useRef<Set<string> | null>(null);

  acceptSetRef.current = acceptedPubkeys ? new Set(acceptedPubkeys) : null;

  useEffect(() => {
    setPointers(new Map());
    setResolved(new Map());
    setResolveErrors(new Map());
  }, [sessionId]);

  useEffect(() => {
    if (!enabled || !sessionId || !identity) return;
    const pool = getRelayPool();
    const obs = pool.subscription(relays, [
      {
        kinds: [KIND_PERSONAL_ARCHIVE_POINTER],
        "#d": [sessionId],
      },
    ]);
    let cancelled = false;
    const sub = obs.subscribe({
      next: (payload: NostrEvent | "EOSE" | unknown) => {
        if (cancelled || payload === "EOSE") return;
        if (!payload || typeof payload !== "object" || !("kind" in (payload as object))) return;
        const ev = payload as NostrEvent;
        if (ev.kind !== KIND_PERSONAL_ARCHIVE_POINTER) return;
        const accept = acceptSetRef.current;
        if (accept && !accept.has(ev.pubkey)) return;
        const parsed = safeJson<PersonalArchivePointerPayload>(ev.content);
        if (!parsed || typeof parsed.shareUrl !== "string" || !parsed.shareUrl) return;
        const receivedAtMs = ev.created_at * 1000;
        setPointers((prev) => {
          const existing = prev.get(ev.pubkey);
          if (existing && existing.receivedAtMs >= receivedAtMs) return prev;
          const next = new Map(prev);
          next.set(ev.pubkey, {
            pubkey: ev.pubkey,
            shareUrl: parsed.shareUrl,
            receivedAtMs,
          });
          return next;
        });
      },
      error: (err: unknown) => {
        console.warn("[personal-archive-pointer] subscription error:", err);
      },
    });
    return () => {
      cancelled = true;
      try {
        sub.unsubscribe();
      } catch {
        // ignore
      }
    };
  }, [enabled, sessionId, identity, relays]);

  // Pointer wait window starts at session-end, not hook mount.
  useEffect(() => {
    if (!sessionId || !identity) {
      setIsWaiting(false);
      return;
    }
    const initial = computePointerWaitState({
      enabled,
      sessionEndedAtMs,
      nowMs: Date.now(),
    });
    setIsWaiting(initial.isWaiting);
    if (initial.remainingMs <= 0) return;
    const handle = window.setTimeout(() => setIsWaiting(false), initial.remainingMs);
    return () => {
      window.clearTimeout(handle);
    };
  }, [enabled, sessionId, identity, sessionEndedAtMs]);

  // Resolve pointers; cancellation scoped to (sessionId, identity) via epoch.
  const inFlightRef = useRef<Map<string, string>>(new Map());
  const resolvedRef = useRef<Map<string, ResolvedRecord>>(resolved);
  useEffect(() => {
    resolvedRef.current = resolved;
  }, [resolved]);

  const epochRef = useRef(0);
  useEffect(() => {
    epochRef.current += 1;
    inFlightRef.current = new Map();
    return () => {
      epochRef.current += 1;
    };
  }, [sessionId, identity]);

  useEffect(() => {
    const myEpoch = epochRef.current;
    pointers.forEach((rec) => {
      if (inFlightRef.current.get(rec.pubkey) === rec.shareUrl) return;
      const already = resolvedRef.current.get(rec.pubkey);
      if (already && already.shareUrl === rec.shareUrl) return;
      inFlightRef.current.set(rec.pubkey, rec.shareUrl);
      const parts = parseShareUrl(rec.shareUrl);
      if (!parts) {
        setResolveErrors((prev) => {
          const next = new Map(prev);
          next.set(rec.pubkey, "This link looks broken.");
          return next;
        });
        return;
      }
      void (async () => {
        try {
          const manifest = await resolveShareLink({
            pointer: parts.pointer,
            fragment: parts.fragment,
          });
          if (epochRef.current !== myEpoch) return;
          setResolved((prev) => {
            const existing = prev.get(rec.pubkey);
            if (
              existing &&
              existing.shareUrl === rec.shareUrl &&
              existing.receivedAtMs >= rec.receivedAtMs
            ) {
              return prev;
            }
            const next = new Map(prev);
            next.set(rec.pubkey, {
              pubkey: rec.pubkey,
              shareUrl: rec.shareUrl,
              receivedAtMs: rec.receivedAtMs,
              manifest,
            });
            return next;
          });
          setResolveErrors((prev) => {
            if (!prev.has(rec.pubkey)) return prev;
            const next = new Map(prev);
            next.delete(rec.pubkey);
            return next;
          });
        } catch (err) {
          if (epochRef.current !== myEpoch) return;
          // Only ShareResolveError carries copy written for people; anything
          // else is a raw transport/crypto failure that must not reach the UI.
          if (!(err instanceof ShareResolveError)) {
            console.warn("[host-aggregated-tracks] resolve failed", err);
          }
          const message =
            err instanceof ShareResolveError
              ? err.message
              : "Couldn't load this guest's track.";
          setResolveErrors((prev) => {
            const next = new Map(prev);
            next.set(rec.pubkey, message);
            return next;
          });
        } finally {
          if (inFlightRef.current.get(rec.pubkey) === rec.shareUrl) {
            inFlightRef.current.delete(rec.pubkey);
          }
        }
      })();
    });
  }, [pointers]);

  const aggregated = useMemo<AggregatedTrack[]>(() => {
    const list: AggregatedTrack[] = [];
    resolved.forEach((rec) => {
      const tracks = rec.manifest.tracks;
      if (tracks.length === 0) return;
      const own = tracks.find((t) => t.participantPubkey === rec.pubkey);
      const track = own ?? tracks[0];
      list.push({
        participantPubkey: rec.pubkey,
        recipientTrack: track,
        receivedAtMs: rec.receivedAtMs,
        source: buildExportSource(track),
      });
    });
    list.sort((a, b) => a.receivedAtMs - b.receivedAtMs);
    return list;
  }, [resolved]);

  const waitingForPubkeys = useMemo<string[]>(
    () =>
      computeWaitingForPubkeys({
        acceptedPubkeys: acceptSetRef.current,
        resolved,
        resolveErrors,
      }),
    [resolved, resolveErrors],
  );

  /** Manually clear the cache (e.g. when the host starts a new call). */
  const reset = useCallback(() => {
    setPointers(new Map());
    setResolved(new Map());
    setResolveErrors(new Map());
    setIsWaiting(false);
  }, []);

  return {
    aggregated,
    isWaiting,
    waitingForPubkeys,
    /** Pubkey → human-readable resolve error, when one occurred. The UI
     *  surfaces these as a small inline message on the placeholder row. */
    resolveErrors,
    reset,
  };
}
