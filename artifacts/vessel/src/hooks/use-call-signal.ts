import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Event as NostrEvent } from "nostr-tools";
import { getRelayPool } from "../lib/relay-pool";
import type { VesselIdentity } from "../lib/identity";

/**
 * Ephemeral in-call signaling channel.
 *
 * A lightweight presence + control plane for the studio: every participant
 * heartbeats their state every {@link HEARTBEAT_MS}, plus we multiplex small
 * control messages (raise hand, chat, reaction, host mute request) over the
 * same relay subscription. All events are signed by each participant's own
 * identity — there's no central server in this loop.
 *
 * We intentionally use kinds in the ephemeral range (20000-29999) so relays
 * don't try to persist the heartbeats. Each event carries `["d", sessionId]`
 * so a single subscription can multiplex everything for one room.
 *
 * No user-visible jargon escapes from this module: the public API speaks in
 * "peers", "send chat", "raise hand", "ask to mute".
 */

// ─── Event kinds (ephemeral) ────────────────────────────────────────────────
export const KIND_PRESENCE = 27001;
export const KIND_CHAT = 27002;
export const KIND_REACTION = 27003;
export const KIND_MUTE_REQUEST = 27004;
/** Host → guest moderation signal asking the recipient to lower their hand.
 *  Authenticity is enforced the same way as MUTE_REQUEST: only the verified
 *  host's signature is honoured. The recipient drops their own raise-hand
 *  state when this lands; non-host senders are silently ignored. */
export const KIND_LOWER_HAND_REQUEST = 27005;

const ALL_KINDS = [
  KIND_PRESENCE,
  KIND_CHAT,
  KIND_REACTION,
  KIND_MUTE_REQUEST,
  KIND_LOWER_HAND_REQUEST,
];

// ─── Timing ────────────────────────────────────────────────────────────────
const HEARTBEAT_MS = 5_000;
/** A peer that hasn't heartbeated within this window is flagged "stale" in
 *  the roster — UI fades them and shows a "Reconnecting…" tag. */
const STALE_TTL_MS = 15_000;
/** A peer past this window is dropped from the roster (presumed gone). */
const DROP_TTL_MS = 45_000;
/** How often we re-evaluate stale peers on the wall clock. */
const PRUNE_TICK_MS = 2_000;
const RECENT_EVENT_RING_SIZE = 200;
/** Hard caps so a misbehaving relay can't eat unbounded memory. */
const MAX_CHAT_HISTORY = 100;
const MAX_REACTION_HISTORY = 30;

// ─── Default relays ────────────────────────────────────────────────────────
// Public free relays. The signaling channel is best-effort: as long as ONE
// relay is reachable everyone sees each other. Falls back gracefully if all
// are down — the studio still works, just without the live roster.
export const DEFAULT_SIGNAL_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
];

// ─── Public types ──────────────────────────────────────────────────────────

export type ConnectionQuality = "good" | "fair" | "poor" | "unknown";

export type Peer = {
  pubkey: string;
  /** Display name as it appears in the room; we cache the latest non-empty
   *  name we've seen from this peer's heartbeats. */
  displayName: string;
  micEnabled: boolean;
  cameraEnabled: boolean;
  handRaised: boolean;
  /** Wall-clock ms when this peer's hand first went up in the current
   *  raise cycle. Used to render the queue ordinal ("1st", "2nd"). Cleared
   *  whenever the peer transitions back to handRaised=false. */
  handRaisedAtMs: number | null;
  quality: ConnectionQuality;
  /** Wall-clock ms of the most recent heartbeat we've received. */
  lastSeenMs: number;
  /** True once we haven't heard from this peer in {@link STALE_TTL_MS}. The
   *  roster keeps the row visible (semi-transparent + "Reconnecting…") until
   *  {@link DROP_TTL_MS} passes, after which it's removed entirely. */
  stale: boolean;
};

export type ChatMessage = {
  id: string;
  fromPubkey: string;
  fromName: string;
  text: string;
  createdAtMs: number;
};

export type ReactionPing = {
  id: string;
  fromPubkey: string;
  fromName: string;
  emoji: string;
  createdAtMs: number;
};

export type UseCallSignalArgs = {
  sessionId: string;
  identity: VesselIdentity | null;
  myDisplayName: string;
  myMicEnabled: boolean;
  myCameraEnabled: boolean;
  myQuality: ConnectionQuality;
  /** Disable the channel entirely (e.g. while the session is still loading
   *  or after it has ended). When false the hook is a no-op. */
  enabled?: boolean;
  /** Override the default signaling relay set. Mostly here for tests. */
  relays?: string[];
  /** Public key of the room host. When set, only mute requests authored by
   *  this key are surfaced as `incomingMuteRequest` — anything else is
   *  silently dropped. Without this, any participant could spoof a host
   *  "ask to mute" prompt by publishing their own event. */
  hostPubkey?: string | null;
};

export type UseCallSignalResult = {
  /** Live peer roster (excludes the local user). Sorted by name for stability. */
  peers: Peer[];
  /** Local raise-hand state. Toggled by `toggleHand()` and broadcast on the
   *  next heartbeat. */
  handRaised: boolean;
  /** Wall-clock ms when the local hand went up in the current cycle, or
   *  null when the hand is down. Used by the roster to position the local
   *  user inside the raised-hand queue alongside everyone else. */
  handRaisedAtMs: number | null;
  toggleHand: () => void;
  /** Send a chat message to everyone in the room. Returns when the relay
   *  publish settles. Errors are swallowed — chat is best-effort. */
  sendChat: (text: string) => Promise<void>;
  /** Send a tiny reaction ping (single emoji) to everyone in the room. */
  sendReaction: (emoji: string) => Promise<void>;
  /** Host-only call to politely ask a guest to mute. The guest's UI sees a
   *  toast; nothing is forced on their device. */
  askToMute: (targetPubkey: string) => Promise<void>;
  /** Host-only call asking a specific guest to lower their hand. The guest's
   *  client respects the request automatically (drops its handRaised state)
   *  and surfaces a calm toast. Non-host senders are silently ignored. */
  lowerHandFor: (targetPubkey: string) => Promise<void>;
  /** Host-only convenience: lower every currently-raised peer at once. */
  lowerAllHands: () => Promise<void>;
  /** When the host has just lowered our own hand, this carries the moment
   *  that happened so the studio can surface a one-off toast. Cleared by
   *  {@link acknowledgeHandLowered}. */
  handLoweredByHost: { id: string; fromName: string; createdAtMs: number } | null;
  acknowledgeHandLowered: () => void;
  /** Most recent chat messages, oldest-first, capped at {@link MAX_CHAT_HISTORY}. */
  chat: ChatMessage[];
  /** Recent reactions for the brief overlay animation. Caller should evict
   *  by id once the animation completes. */
  reactions: ReactionPing[];
  removeReaction: (id: string) => void;
  /** Rolling count of mute requests received targeting the local user (so a
   *  guest's UI can surface a toast). The most recent request is also
   *  exposed. */
  incomingMuteRequest: { id: string; fromName: string; createdAtMs: number } | null;
  acknowledgeMuteRequest: () => void;
  /** True once we've successfully published our first heartbeat AND received
   *  a relay's EOSE — i.e. the channel is "live". */
  isConnected: boolean;
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function genId(): string {
  // Cheap non-cryptographic id for UI keys + dedupe rings.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type SignedTemplate = Parameters<VesselIdentity["_signer"]["signEvent"]>[0];

function buildEventTemplate(
  kind: number,
  sessionId: string,
  contentObj: Record<string, unknown>,
  extraTags: string[][] = [],
): SignedTemplate {
  return {
    kind,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["d", sessionId], ...extraTags],
    content: JSON.stringify(contentObj),
  } as SignedTemplate;
}

/** Pull the session ID out of an incoming event's `d` tag. */
function getEventSessionId(ev: NostrEvent): string | null {
  if (!Array.isArray(ev.tags)) return null;
  for (const t of ev.tags) {
    if (Array.isArray(t) && t[0] === "d" && typeof t[1] === "string") return t[1];
  }
  return null;
}

function getTagValue(ev: NostrEvent, name: string): string | null {
  if (!Array.isArray(ev.tags)) return null;
  for (const t of ev.tags) {
    if (Array.isArray(t) && t[0] === name && typeof t[1] === "string") return t[1];
  }
  return null;
}

function safeParseContent<T extends Record<string, unknown>>(content: string): T | null {
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object") return parsed as T;
  } catch {
    // ignore
  }
  return null;
}

function clampString(input: unknown, max: number): string {
  if (typeof input !== "string") return "";
  return input.slice(0, max).trim();
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useCallSignal({
  sessionId,
  identity,
  myDisplayName,
  myMicEnabled,
  myCameraEnabled,
  myQuality,
  enabled = true,
  relays = DEFAULT_SIGNAL_RELAYS,
  hostPubkey = null,
}: UseCallSignalArgs): UseCallSignalResult {
  const myPubkey = identity?._pubkey ?? "";
  const hostPubkeyRef = useRef<string | null>(hostPubkey);
  useEffect(() => {
    hostPubkeyRef.current = hostPubkey;
  }, [hostPubkey]);

  // ── State ──
  const [peers, setPeers] = useState<Map<string, Peer>>(new Map());
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<ReactionPing[]>([]);
  const [handRaised, setHandRaised] = useState(false);
  const [handRaisedAtMs, setHandRaisedAtMs] = useState<number | null>(null);
  const [incomingMuteRequest, setIncomingMuteRequest] =
    useState<UseCallSignalResult["incomingMuteRequest"]>(null);
  const [handLoweredByHost, setHandLoweredByHost] =
    useState<UseCallSignalResult["handLoweredByHost"]>(null);
  const [isConnected, setIsConnected] = useState(false);

  // ── Refs (avoid stale closures in long-lived intervals & subscriptions) ──
  const handRaisedRef = useRef(false);
  /** Local timestamp of when our own hand went up in the current cycle. We
   *  publish it on every heartbeat so other clients can render the queue
   *  ordinal even after they joined late. */
  const handRaisedAtRef = useRef<number | null>(null);
  /** Live snapshot of every peer we know about — used by host moderation
   *  actions (lowerAllHands) without going through React state. */
  const peersRef = useRef<Map<string, Peer>>(new Map());
  const myMicRef = useRef(myMicEnabled);
  const myCamRef = useRef(myCameraEnabled);
  const myQualityRef = useRef<ConnectionQuality>(myQuality);
  const myNameRef = useRef(myDisplayName);
  const seenIdsRef = useRef<string[]>([]);
  const seenSetRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    myMicRef.current = myMicEnabled;
  }, [myMicEnabled]);
  useEffect(() => {
    myCamRef.current = myCameraEnabled;
  }, [myCameraEnabled]);
  useEffect(() => {
    myQualityRef.current = myQuality;
  }, [myQuality]);
  useEffect(() => {
    myNameRef.current = myDisplayName;
  }, [myDisplayName]);

  const rememberSeen = useCallback((id: string): boolean => {
    if (seenSetRef.current.has(id)) return false;
    seenSetRef.current.add(id);
    seenIdsRef.current.push(id);
    if (seenIdsRef.current.length > RECENT_EVENT_RING_SIZE) {
      const dropped = seenIdsRef.current.shift();
      if (dropped) seenSetRef.current.delete(dropped);
    }
    return true;
  }, []);

  // ── Sign + publish primitive (best-effort) ──
  const publishSigned = useCallback(
    async (template: SignedTemplate): Promise<void> => {
      if (!identity) return;
      try {
        const signed = (await identity._signer.signEvent(template)) as NostrEvent;
        // Mark our own event as seen so we don't echo it through the
        // subscription path.
        if (signed?.id) rememberSeen(signed.id);
        const pool = getRelayPool();
        await pool.publish(relays, signed);
      } catch (err) {
        // Best-effort; chat / heartbeats should never break the studio.
        console.warn("[call-signal] publish failed:", err);
      }
    },
    [identity, relays, rememberSeen],
  );

  // ── Inbound event router ──
  const handleIncoming = useCallback(
    (ev: NostrEvent) => {
      if (!ev || !ev.id || !ev.pubkey) return;
      if (getEventSessionId(ev) !== sessionId) return;
      if (ev.pubkey === myPubkey) return; // ignore loopback
      if (!rememberSeen(ev.id)) return; // dedupe across relays

      switch (ev.kind) {
        case KIND_PRESENCE: {
          const c = safeParseContent<{
            displayName?: string;
            micEnabled?: boolean;
            cameraEnabled?: boolean;
            handRaised?: boolean;
            handRaisedAtMs?: number;
            quality?: ConnectionQuality;
          }>(ev.content);
          if (!c) return;
          setPeers((prev) => {
            const next = new Map(prev);
            const existing = next.get(ev.pubkey);
            const incomingName = clampString(c.displayName, 80);
            const handRaised =
              typeof c.handRaised === "boolean" ? c.handRaised : !!existing?.handRaised;
            // Hand-raise timestamp: prefer the sender's own claim (so the
            // queue ordinal is consistent across clients), but fall back to
            // the moment we first observed the raise locally if absent.
            // Cleared the instant the hand goes back down.
            let handRaisedAtMs: number | null = existing?.handRaisedAtMs ?? null;
            if (!handRaised) {
              handRaisedAtMs = null;
            } else {
              const claimed =
                typeof c.handRaisedAtMs === "number" && Number.isFinite(c.handRaisedAtMs)
                  ? c.handRaisedAtMs
                  : null;
              // Anti-cut-the-line: once we've recorded a timestamp for
              // this peer's current raise cycle, freeze it. A peer must
              // not be able to "move up" the queue by retroactively
              // publishing an earlier handRaisedAtMs. We accept a claim
              // ONLY when (a) the peer was previously down (fresh raise)
              // or (b) we haven't observed any timestamp yet for the
              // current raise. After that the value is sticky until the
              // hand goes back down (which clears it above).
              if (!existing?.handRaised) {
                handRaisedAtMs = claimed ?? Date.now();
              } else if (handRaisedAtMs == null && claimed != null) {
                handRaisedAtMs = claimed;
              }
              // else: keep existing — refuse to rewrite backwards.
            }
            const updated: Peer = {
              pubkey: ev.pubkey,
              displayName: incomingName || existing?.displayName || "Guest",
              micEnabled: typeof c.micEnabled === "boolean" ? c.micEnabled : !!existing?.micEnabled,
              cameraEnabled:
                typeof c.cameraEnabled === "boolean" ? c.cameraEnabled : !!existing?.cameraEnabled,
              handRaised,
              handRaisedAtMs,
              quality:
                c.quality === "good" || c.quality === "fair" || c.quality === "poor"
                  ? c.quality
                  : existing?.quality ?? "unknown",
              lastSeenMs: Date.now(),
              stale: false,
            };
            next.set(ev.pubkey, updated);
            peersRef.current = next;
            return next;
          });
          break;
        }
        case KIND_CHAT: {
          const c = safeParseContent<{ displayName?: string; text?: string }>(ev.content);
          if (!c) return;
          const text = clampString(c.text, 1000);
          if (!text) return;
          const fromName = clampString(c.displayName, 80) || "Guest";
          setChat((prev) => {
            const next = [
              ...prev,
              {
                id: ev.id,
                fromPubkey: ev.pubkey,
                fromName,
                text,
                createdAtMs: ev.created_at * 1000,
              },
            ];
            if (next.length > MAX_CHAT_HISTORY) next.splice(0, next.length - MAX_CHAT_HISTORY);
            return next;
          });
          break;
        }
        case KIND_REACTION: {
          const c = safeParseContent<{ displayName?: string; emoji?: string }>(ev.content);
          if (!c) return;
          const emoji = clampString(c.emoji, 8);
          if (!emoji) return;
          const fromName = clampString(c.displayName, 80) || "Guest";
          setReactions((prev) => {
            const next = [
              ...prev,
              {
                id: ev.id,
                fromPubkey: ev.pubkey,
                fromName,
                emoji,
                createdAtMs: ev.created_at * 1000,
              },
            ];
            if (next.length > MAX_REACTION_HISTORY)
              next.splice(0, next.length - MAX_REACTION_HISTORY);
            return next;
          });
          break;
        }
        case KIND_MUTE_REQUEST: {
          const targetPubkey = getTagValue(ev, "p");
          if (!targetPubkey || targetPubkey !== myPubkey) return;
          // Only honour mute prompts that come from the verified room host.
          // If we don't yet know who the host is, drop it — better to miss a
          // prompt than to let a guest spoof one. Sender authenticity itself
          // is guaranteed by the signature check the relay pool performs.
          const expectedHost = hostPubkeyRef.current;
          if (!expectedHost || ev.pubkey !== expectedHost) return;
          const c = safeParseContent<{ displayName?: string }>(ev.content);
          const fromName = clampString(c?.displayName, 80) || "The host";
          setIncomingMuteRequest({
            id: ev.id,
            fromName,
            createdAtMs: ev.created_at * 1000,
          });
          break;
        }
        case KIND_LOWER_HAND_REQUEST: {
          const targetPubkey = getTagValue(ev, "p");
          if (!targetPubkey || targetPubkey !== myPubkey) return;
          // Same trust model as the mute request: only honour requests
          // signed by the verified host. Anything else is silently ignored
          // so a noisy guest can't drop a co-presenter's hand.
          const expectedHost = hostPubkeyRef.current;
          if (!expectedHost || ev.pubkey !== expectedHost) return;
          // Only act if our hand is actually up — otherwise this is a
          // stale request and we suppress the toast.
          if (handRaisedRef.current) {
            handRaisedRef.current = false;
            handRaisedAtRef.current = null;
            setHandRaised(false);
            setHandRaisedAtMs(null);
            const c = safeParseContent<{ displayName?: string }>(ev.content);
            const fromName = clampString(c?.displayName, 80) || "The host";
            setHandLoweredByHost({
              id: ev.id,
              fromName,
              createdAtMs: ev.created_at * 1000,
            });
            // Send an immediate presence beat so other clients see the
            // lowered hand without waiting for the next tick.
            const tmpl = buildEventTemplate(KIND_PRESENCE, sessionId, {
              displayName: myNameRef.current,
              micEnabled: myMicRef.current,
              cameraEnabled: myCamRef.current,
              handRaised: false,
              handRaisedAtMs: null,
              quality: myQualityRef.current,
            });
            void publishSigned(tmpl);
          }
          break;
        }
        default:
          break;
      }
    },
    [sessionId, myPubkey, rememberSeen],
  );

  // ── Per-room hard reset ──
  // Whenever the room or active identity changes, blow away any state we
  // accumulated for the previous room so chat/reactions/peers can never
  // leak across sessions. The dedupe ring is also reset so old event ids
  // don't shadow legitimate new ones from a re-entered room.
  useEffect(() => {
    setPeers(new Map());
    peersRef.current = new Map();
    setChat([]);
    setReactions([]);
    setIncomingMuteRequest(null);
    setHandLoweredByHost(null);
    setHandRaised(false);
    setHandRaisedAtMs(null);
    handRaisedRef.current = false;
    handRaisedAtRef.current = null;
    seenIdsRef.current = [];
    seenSetRef.current = new Set();
  }, [sessionId, myPubkey]);

  // ── Subscription lifecycle ──
  useEffect(() => {
    if (!enabled || !sessionId || !identity) {
      setPeers(new Map());
      setChat([]);
      setReactions([]);
      setIncomingMuteRequest(null);
      setIsConnected(false);
      return;
    }
    const pool = getRelayPool();
    let cancelled = false;
    const obs = pool.subscription(relays, [
      {
        kinds: ALL_KINDS,
        "#d": [sessionId],
        // No `since` filter — heartbeats are constant and we want to pick up
        // the very next one from each peer.
      },
    ]);
    const sub = obs.subscribe({
      next: (payload: NostrEvent | "EOSE" | unknown) => {
        if (cancelled) return;
        if (payload === "EOSE") {
          // Initial backlog drained; channel is live.
          setIsConnected(true);
          return;
        }
        if (payload && typeof payload === "object" && "kind" in (payload as object)) {
          handleIncoming(payload as NostrEvent);
        }
      },
      error: (err: unknown) => {
        console.warn("[call-signal] subscription error:", err);
      },
    });
    return () => {
      cancelled = true;
      try {
        sub.unsubscribe();
      } catch {
        // ignore
      }
      setIsConnected(false);
    };
  }, [enabled, sessionId, identity, relays, handleIncoming]);

  // ── Heartbeat loop ──
  useEffect(() => {
    if (!enabled || !sessionId || !identity) return;
    let cancelled = false;
    const sendHeartbeat = () => {
      if (cancelled) return;
      const tmpl = buildEventTemplate(KIND_PRESENCE, sessionId, {
        displayName: myNameRef.current,
        micEnabled: myMicRef.current,
        cameraEnabled: myCamRef.current,
        handRaised: handRaisedRef.current,
        handRaisedAtMs: handRaisedAtRef.current,
        quality: myQualityRef.current,
      });
      void publishSigned(tmpl);
    };
    // Immediate beat so we appear in everyone else's roster ASAP.
    sendHeartbeat();
    const id = window.setInterval(sendHeartbeat, HEARTBEAT_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled, sessionId, identity, publishSigned]);

  // ── Pruning loop — flag stale peers, then drop after the longer TTL ──
  // Two-stage to give "Reconnecting…" UX time to surface before the row
  // disappears, matching the 3-strikes feel called out in the spec.
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      const now = Date.now();
      const staleAt = now - STALE_TTL_MS;
      const dropAt = now - DROP_TTL_MS;
      setPeers((prev) => {
        let dirty = false;
        const next = new Map<string, Peer>();
        prev.forEach((peer, pubkey) => {
          if (peer.lastSeenMs < dropAt) {
            dirty = true; // drop entirely
            return;
          }
          const shouldBeStale = peer.lastSeenMs < staleAt;
          if (shouldBeStale !== peer.stale) {
            next.set(pubkey, { ...peer, stale: shouldBeStale });
            dirty = true;
          } else {
            next.set(pubkey, peer);
          }
        });
        if (dirty) peersRef.current = next;
        return dirty ? next : prev;
      });
    }, PRUNE_TICK_MS);
    return () => window.clearInterval(id);
  }, [enabled]);

  // ── Public actions ──
  const toggleHand = useCallback(() => {
    const next = !handRaisedRef.current;
    const ts = next ? Date.now() : null;
    handRaisedRef.current = next;
    handRaisedAtRef.current = ts;
    setHandRaised(next);
    setHandRaisedAtMs(ts);
    if (!enabled || !sessionId || !identity) return;
    // Send an immediate presence beat so the change is reflected without
    // waiting up to 5s for the next tick.
    const tmpl = buildEventTemplate(KIND_PRESENCE, sessionId, {
      displayName: myNameRef.current,
      micEnabled: myMicRef.current,
      cameraEnabled: myCamRef.current,
      handRaised: handRaisedRef.current,
      handRaisedAtMs: handRaisedAtRef.current,
      quality: myQualityRef.current,
    });
    void publishSigned(tmpl);
  }, [enabled, sessionId, identity, publishSigned]);

  const sendChat = useCallback(
    async (text: string) => {
      const trimmed = text.trim().slice(0, 1000);
      if (!trimmed || !enabled || !sessionId || !identity) return;
      const tmpl = buildEventTemplate(KIND_CHAT, sessionId, {
        displayName: myNameRef.current,
        text: trimmed,
      });
      await publishSigned(tmpl);
      // Locally echo so the sender sees their own message immediately.
      setChat((prev) => {
        const next = [
          ...prev,
          {
            id: genId(),
            fromPubkey: myPubkey,
            fromName: myNameRef.current || "You",
            text: trimmed,
            createdAtMs: Date.now(),
          },
        ];
        if (next.length > MAX_CHAT_HISTORY) next.splice(0, next.length - MAX_CHAT_HISTORY);
        return next;
      });
    },
    [enabled, sessionId, identity, myPubkey, publishSigned],
  );

  const sendReaction = useCallback(
    async (emoji: string) => {
      const e = emoji.slice(0, 8);
      if (!e || !enabled || !sessionId || !identity) return;
      const tmpl = buildEventTemplate(KIND_REACTION, sessionId, {
        displayName: myNameRef.current,
        emoji: e,
      });
      await publishSigned(tmpl);
      setReactions((prev) => {
        const next = [
          ...prev,
          {
            id: genId(),
            fromPubkey: myPubkey,
            fromName: myNameRef.current || "You",
            emoji: e,
            createdAtMs: Date.now(),
          },
        ];
        if (next.length > MAX_REACTION_HISTORY) next.splice(0, next.length - MAX_REACTION_HISTORY);
        return next;
      });
    },
    [enabled, sessionId, identity, myPubkey, publishSigned],
  );

  const askToMute = useCallback(
    async (targetPubkey: string) => {
      if (!targetPubkey || !enabled || !sessionId || !identity) return;
      const tmpl = buildEventTemplate(
        KIND_MUTE_REQUEST,
        sessionId,
        { displayName: myNameRef.current },
        [["p", targetPubkey]],
      );
      await publishSigned(tmpl);
    },
    [enabled, sessionId, identity, publishSigned],
  );

  const lowerHandFor = useCallback(
    async (targetPubkey: string) => {
      if (!targetPubkey || !enabled || !sessionId || !identity) return;
      // Host-only action — enforced at the boundary so non-host callers
      // can't accidentally publish a moderation signal that other clients
      // will (correctly) ignore. Recipients also re-verify the signature
      // matches the host pubkey before honouring the request.
      if (!hostPubkeyRef.current || hostPubkeyRef.current !== myPubkey) return;
      const tmpl = buildEventTemplate(
        KIND_LOWER_HAND_REQUEST,
        sessionId,
        { displayName: myNameRef.current },
        [["p", targetPubkey]],
      );
      await publishSigned(tmpl);
      // Optimistic local update so the host's roster row clears immediately.
      // The target's own next presence beat will confirm; if for any reason
      // they don't acknowledge, the next inbound presence event will simply
      // re-set handRaised back to true.
      setPeers((prev) => {
        const existing = prev.get(targetPubkey);
        if (!existing || !existing.handRaised) return prev;
        const next = new Map(prev);
        next.set(targetPubkey, { ...existing, handRaised: false, handRaisedAtMs: null });
        peersRef.current = next;
        return next;
      });
    },
    [enabled, sessionId, identity, publishSigned],
  );

  const lowerAllHands = useCallback(async () => {
    if (!enabled || !sessionId || !identity) return;
    // Same boundary check as `lowerHandFor` — non-host clients shouldn't
    // be publishing moderation signals at all.
    if (!hostPubkeyRef.current || hostPubkeyRef.current !== myPubkey) return;
    const targets: string[] = [];
    peersRef.current.forEach((p) => {
      if (p.handRaised) targets.push(p.pubkey);
    });
    // If the host themselves has a hand up, lowering "all" should include
    // their own hand too — otherwise the link in the roster looks broken
    // when the host is the only person with a raised hand.
    if (handRaisedRef.current) {
      handRaisedRef.current = false;
      handRaisedAtRef.current = null;
      setHandRaised(false);
      setHandRaisedAtMs(null);
      // Push an immediate presence beat so peers see the change without
      // waiting for the next tick. Mirrors the shape used by toggleHand().
      const tmpl = buildEventTemplate(KIND_PRESENCE, sessionId, {
        displayName: myNameRef.current,
        micEnabled: myMicRef.current,
        cameraEnabled: myCamRef.current,
        handRaised: false,
        handRaisedAtMs: null,
        quality: myQualityRef.current,
      });
      void publishSigned(tmpl);
    }
    if (targets.length === 0) return;
    // Best-effort: fire all in parallel and let the publishSigned helper
    // swallow individual relay errors. UI doesn't gate on success.
    await Promise.all(targets.map((t) => lowerHandFor(t)));
  }, [enabled, sessionId, identity, publishSigned, lowerHandFor]);

  const removeReaction = useCallback((id: string) => {
    setReactions((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const acknowledgeMuteRequest = useCallback(() => {
    setIncomingMuteRequest(null);
  }, []);

  const acknowledgeHandLowered = useCallback(() => {
    setHandLoweredByHost(null);
  }, []);

  const peersList = useMemo(() => {
    return [...peers.values()].sort((a, b) =>
      a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }),
    );
  }, [peers]);

  return {
    peers: peersList,
    handRaised,
    handRaisedAtMs,
    toggleHand,
    sendChat,
    sendReaction,
    askToMute,
    lowerHandFor,
    lowerAllHands,
    handLoweredByHost,
    acknowledgeHandLowered,
    chat,
    reactions,
    removeReaction,
    incomingMuteRequest,
    acknowledgeMuteRequest,
    isConnected,
  };
}
