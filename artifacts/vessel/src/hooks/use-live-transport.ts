/**
 * useLiveTransport — orchestrates the studio's real-time A/V plane.
 *
 * Two underlying transports, picked dynamically per-room:
 *
 *   - "moq":    WebTransport + WebCodecs publish/subscribe pipeline. Used
 *               whenever every peer in the room can speak it (which is
 *               whenever everyone is on a Chromium-family browser today).
 *   - "webrtc": Peer-to-peer WebRTC mesh, used the moment any peer in
 *               the room can't speak MoQ. Slightly more bandwidth on the
 *               Chromium peers in exchange for the cross-browser peer
 *               seeing and hearing everyone.
 *
 * Both feed the same per-pubkey aggregation: each remote participant
 * gets a `cameraStream` + an optional `screenStream`, exposed to the
 * caller via the same `remoteStreams` / `remoteScreenStreams` maps.
 * Switching modes is handled transparently — when the roster shifts
 * (someone on Safari joins or leaves) the previous transport tears
 * down, the new one stands up, and the caller's UI continues to read
 * the same shape.
 *
 * No UI strings live in this file. The studio chrome reads `mode` only
 * for an optional dev-only indicator and never names the transport in
 * user-visible copy.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  MoqClient,
  isLivePreviewSupported,
  type ConnectionQuality,
  type IncomingTrack,
} from "../lib/moq";
import { decodeTrack, publishStream, type DecodedTrack, type PublisherHandle } from "../lib/codec";
import {
  selectTransport,
  isWebRtcAvailable,
  type TransportMode,
} from "../lib/transport-select";
import { WebRtcMesh, type WebRtcSignaling } from "../lib/webrtc-mesh";

const DEFAULT_RELAY_URL =
  (import.meta.env.VITE_MOQ_RELAY_URL as string | undefined) ||
  "https://relay.quic.video";

const RELAY_KEY = "vessel_relay_url";
const RELAY_CHANGED_EVENT = "vessel:relay-url-changed";

function getRelayUrl(): string {
  if (typeof localStorage === "undefined") return DEFAULT_RELAY_URL;
  return localStorage.getItem(RELAY_KEY) || DEFAULT_RELAY_URL;
}

/**
 * React to relay-URL changes from anywhere in the app — both other tabs
 * (storage event) and the same tab (custom event dispatched by Settings).
 */
function useReactiveRelayUrl(): string {
  const [url, setUrl] = useState<string>(() => getRelayUrl());
  useEffect(() => {
    const refresh = () => setUrl(getRelayUrl());
    const onStorage = (e: StorageEvent) => {
      if (e.key === RELAY_KEY || e.key === null) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(RELAY_CHANGED_EVENT, refresh as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(RELAY_CHANGED_EVENT, refresh as EventListener);
    };
  }, []);
  return url;
}

/** Settings calls this after persisting a new URL so the active studio
 *  re-connects without waiting for a tab reload. */
export function notifyRelayUrlChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(RELAY_CHANGED_EVENT));
}

/** Subset of the `Peer` shape from `useCallSignal` that this hook needs.
 *  Kept narrow so the hook can be tested without dragging in the whole
 *  signalling API. */
export type LivePeer = {
  pubkey: string;
  /** False ⇒ this peer can't speak the MoQ transport, so the room must
   *  fall back to the cross-browser WebRTC mesh. */
  supportsMoq: boolean;
};

export type UseLiveTransportArgs = {
  sessionId: string;
  /** The local participant's pubkey, used to build their publish namespace
   *  (MoQ mode) and to determine polite/impolite role (WebRTC mode). */
  selfPubkey: string | null | undefined;
  /** Local A/V stream to publish. May be null while devices are warming up. */
  localStream: MediaStream | null;
  /** Optional local screen-capture stream to publish as a second feed
   *  tagged source="screen". When null we don't publish anything extra
   *  and any previously-published screen stream is torn down. */
  screenStream?: MediaStream | null;
  /** Pause the transport entirely (e.g. session not yet live). */
  enabled?: boolean;
  /** Live peer roster (everyone except the local user). When any peer
   *  reports `supportsMoq: false`, the room falls back to WebRTC. */
  peers?: LivePeer[];
  /** Direct peer-to-peer signalling adapter. Required for the WebRTC
   *  fallback to function — when null and we'd otherwise pick "webrtc",
   *  the hook reports `mode: "none"` and surfaces an error. */
  signaling?: WebRtcSignaling | null;
  /** Override the local browser's MoQ capability bit. Mostly here so the
   *  caller can mirror the same value into its presence beats and the
   *  transport selection without two separate probes. */
  selfSupportsMoq?: boolean;
};

export type UseLiveTransportResult = {
  /** True iff at least ONE transport is available (MoQ OR WebRTC). False
   *  only on genuinely ancient browsers that have neither WebTransport
   *  nor WebRTC. */
  isSupported: boolean;
  /** Which transport the hook is currently driving. Exposed so a dev-only
   *  studio chip can render an A/B indicator; user-visible copy never
   *  references this. */
  mode: TransportMode;
  /** True iff the current transport is connected. */
  isConnected: boolean;
  /** Real RTT-derived link quality, or "unknown" before the first probe. */
  quality: ConnectionQuality;
  /** Latest measured round-trip latency in ms, if known. */
  rttMs: number | null;
  /** Last connect / disconnect error, cleared on reconnect. */
  error: string | null;
  /** Decoded remote camera MediaStreams keyed by participant pubkey. */
  remoteStreams: Map<string, MediaStream>;
  /** Decoded remote screen-share MediaStreams keyed by sharer pubkey.
   *  Only present while a participant is actively sharing. */
  remoteScreenStreams: Map<string, MediaStream>;
  /** Pubkeys whose camera video track has actually rendered at least one
   *  frame. Use this — not just `remoteStreams.has(pubkey)` — to flip a
   *  tile from "Connecting..." to live preview, since a track exists from
   *  the moment its header arrives, before any payload bytes are decoded. */
  remoteReady: Set<string>;
  /** Pubkeys whose screen track has rendered its first frame. */
  remoteScreenReady: Set<string>;
};

/** Per-pubkey aggregation. Both transports funnel into this shape. */
type RemoteParticipant = {
  pubkey: string;
  cameraVideoTrack: DecodedTrack | null;
  cameraAudioTrack: DecodedTrack | null;
  cameraStream: MediaStream;
  screenVideoTrack: DecodedTrack | null;
  screenAudioTrack: DecodedTrack | null;
  screenStream: MediaStream;
  /** True once the screen feed has actually carried any track at all
   *  (header arrived). Used so callers can distinguish "no share" from
   *  "share started but first frame still pending" in concert with
   *  `remoteScreenReady`. */
  hasScreen: boolean;
};

function newEmptyParticipant(pubkey: string): RemoteParticipant {
  return {
    pubkey,
    cameraVideoTrack: null,
    cameraAudioTrack: null,
    cameraStream: new MediaStream(),
    screenVideoTrack: null,
    screenAudioTrack: null,
    screenStream: new MediaStream(),
    hasScreen: false,
  };
}

function namespaceFor(sessionId: string, pubkey: string): string {
  return `vessel/${sessionId}/${pubkey}`;
}

function parseNamespace(ns: string): { sessionId: string; pubkey: string } | null {
  const parts = ns.split("/");
  if (parts.length !== 3 || parts[0] !== "vessel") return null;
  return { sessionId: parts[1], pubkey: parts[2] };
}

/** Wrap a raw MediaStreamTrack as a DecodedTrack so the WebRTC ingestion
 *  path can share storage with the MoQ ingestion path. The `stop()` call
 *  is a thin pass-through; for raw tracks there's no decoder to tear
 *  down. */
function wrapPlainTrack(track: MediaStreamTrack): DecodedTrack {
  return {
    track,
    kind: track.kind === "audio" ? "audio" : "video",
    stop: () => {
      try {
        track.stop();
      } catch {
        // ignore — already stopped
      }
    },
  };
}

export function useLiveTransport({
  sessionId,
  selfPubkey,
  localStream,
  screenStream = null,
  enabled = true,
  peers,
  signaling = null,
  selfSupportsMoq,
}: UseLiveTransportArgs): UseLiveTransportResult {
  // Capability probes. Stable across the hook's lifetime (browser support
  // doesn't change between renders), so a one-shot lazy initialiser is fine.
  const [moqCapable] = useState<boolean>(() =>
    selfSupportsMoq ?? isLivePreviewSupported(),
  );
  const [webRtcCapable] = useState<boolean>(() => isWebRtcAvailable());

  // Recompute mixed-room flag from the roster on every render. Cheap —
  // the roster is small and this is just a one-pass scan.
  const roomNeedsWebRtc = useMemo(
    () => (peers ?? []).some((p) => !p.supportsMoq),
    [peers],
  );
  const mode: TransportMode = useMemo(
    () =>
      selectTransport({
        moqAvailable: moqCapable,
        webRtcAvailable: webRtcCapable,
        roomNeedsWebRtc,
      }),
    [moqCapable, webRtcCapable, roomNeedsWebRtc],
  );
  const isSupported = mode !== "none";

  const [isConnected, setIsConnected] = useState(false);
  const [quality, setQuality] = useState<ConnectionQuality>("unknown");
  const [rttMs, setRttMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(
    () => new Map(),
  );
  const [remoteScreenStreams, setRemoteScreenStreams] = useState<Map<string, MediaStream>>(
    () => new Map(),
  );
  const [remoteReady, setRemoteReady] = useState<Set<string>>(() => new Set());
  const [remoteScreenReady, setRemoteScreenReady] = useState<Set<string>>(() => new Set());

  const relayUrl = useReactiveRelayUrl();

  const clientRef = useRef<MoqClient | null>(null);
  const publisherRef = useRef<PublisherHandle | null>(null);
  const screenPublisherRef = useRef<PublisherHandle | null>(null);
  const meshRef = useRef<WebRtcMesh | null>(null);
  const remotesRef = useRef<Map<string, RemoteParticipant>>(new Map());

  const refreshStreamMaps = () => {
    const cameraEntries: Array<readonly [string, MediaStream]> = [];
    const screenEntries: Array<readonly [string, MediaStream]> = [];
    remotesRef.current.forEach((r, k) => {
      cameraEntries.push([k, r.cameraStream] as const);
      if (r.hasScreen) screenEntries.push([k, r.screenStream] as const);
    });
    setRemoteStreams(new Map(cameraEntries));
    setRemoteScreenStreams(new Map(screenEntries));
  };

  /** MoQ ingestion path — incoming `DecodedTrack` from the codec layer. */
  const upsertRemoteTrack = (
    pubkey: string,
    decoded: DecodedTrack,
    source: "camera" | "screen",
  ) => {
    let entry = remotesRef.current.get(pubkey);
    if (!entry) {
      entry = newEmptyParticipant(pubkey);
      remotesRef.current.set(pubkey, entry);
    }
    const isScreen = source === "screen";
    const targetStream = isScreen ? entry.screenStream : entry.cameraStream;
    if (decoded.kind === "video") {
      const existing = isScreen ? entry.screenVideoTrack : entry.cameraVideoTrack;
      if (existing) {
        existing.stop();
        try {
          targetStream.removeTrack(existing.track);
        } catch {
          // ignore
        }
      }
      if (isScreen) entry.screenVideoTrack = decoded;
      else entry.cameraVideoTrack = decoded;
    } else {
      const existing = isScreen ? entry.screenAudioTrack : entry.cameraAudioTrack;
      if (existing) {
        existing.stop();
        try {
          targetStream.removeTrack(existing.track);
        } catch {
          // ignore
        }
      }
      if (isScreen) entry.screenAudioTrack = decoded;
      else entry.cameraAudioTrack = decoded;
    }
    targetStream.addTrack(decoded.track);
    if (isScreen) entry.hasScreen = true;
    refreshStreamMaps();
  };

  /** WebRTC ingestion path — incoming raw `MediaStreamTrack` plus the
   *  publisher-asserted source label ("camera" / "screen"). */
  const attachRtcTrack = (
    pubkey: string,
    source: "camera" | "screen",
    track: MediaStreamTrack,
  ) => {
    let entry = remotesRef.current.get(pubkey);
    if (!entry) {
      entry = newEmptyParticipant(pubkey);
      remotesRef.current.set(pubkey, entry);
    }
    const isScreen = source === "screen";
    const targetStream = isScreen ? entry.screenStream : entry.cameraStream;
    if (track.kind === "video") {
      const existing = isScreen ? entry.screenVideoTrack : entry.cameraVideoTrack;
      if (existing) {
        existing.stop();
        try {
          targetStream.removeTrack(existing.track);
        } catch {
          // ignore
        }
      }
      const wrapped = wrapPlainTrack(track);
      if (isScreen) entry.screenVideoTrack = wrapped;
      else entry.cameraVideoTrack = wrapped;
      // Mark the tile as ready when the track first carries media. Some
      // remotes start muted (camera off) — we wait for `unmute` so the
      // "Connecting…" state doesn't flip to "live" prematurely. Tracks
      // that arrive already unmuted (typical) are marked ready
      // immediately so the tile doesn't sit stuck.
      const markReady = () => markRemoteReady(pubkey, source);
      if (track.muted) {
        track.addEventListener("unmute", markReady, { once: true });
      } else {
        markReady();
      }
    } else {
      const existing = isScreen ? entry.screenAudioTrack : entry.cameraAudioTrack;
      if (existing) {
        existing.stop();
        try {
          targetStream.removeTrack(existing.track);
        } catch {
          // ignore
        }
      }
      const wrapped = wrapPlainTrack(track);
      if (isScreen) entry.screenAudioTrack = wrapped;
      else entry.cameraAudioTrack = wrapped;
    }
    targetStream.addTrack(track);
    if (isScreen) entry.hasScreen = true;
    refreshStreamMaps();
  };

  /** WebRTC track-removed: drop the matching wrapper if its trackId
   *  still matches what we last ingested. Out-of-order events (a swap
   *  followed by a removed-old-track event) become no-ops. */
  const detachRtcTrack = (
    pubkey: string,
    source: "camera" | "screen",
    kind: "video" | "audio",
    trackId: string,
  ) => {
    const entry = remotesRef.current.get(pubkey);
    if (!entry) return;
    const isScreen = source === "screen";
    const targetStream = isScreen ? entry.screenStream : entry.cameraStream;
    let removed: DecodedTrack | null = null;
    if (kind === "video") {
      const existing = isScreen ? entry.screenVideoTrack : entry.cameraVideoTrack;
      if (existing && existing.track.id === trackId) {
        removed = existing;
        if (isScreen) entry.screenVideoTrack = null;
        else entry.cameraVideoTrack = null;
      }
    } else {
      const existing = isScreen ? entry.screenAudioTrack : entry.cameraAudioTrack;
      if (existing && existing.track.id === trackId) {
        removed = existing;
        if (isScreen) entry.screenAudioTrack = null;
        else entry.cameraAudioTrack = null;
      }
    }
    if (!removed) return;
    try {
      targetStream.removeTrack(removed.track);
    } catch {
      // ignore
    }
    removed.stop();
    if (isScreen && !entry.screenVideoTrack && !entry.screenAudioTrack) {
      entry.hasScreen = false;
      // Drop the screen-ready flag too so a fresh share can re-arm it.
      setRemoteScreenReady((prev) => {
        if (!prev.has(pubkey)) return prev;
        const next = new Set(prev);
        next.delete(pubkey);
        return next;
      });
    }
    refreshStreamMaps();
  };

  const markRemoteReady = (pubkey: string, source: "camera" | "screen") => {
    if (source === "screen") {
      setRemoteScreenReady((prev) => {
        if (prev.has(pubkey)) return prev;
        const next = new Set(prev);
        next.add(pubkey);
        return next;
      });
    } else {
      setRemoteReady((prev) => {
        if (prev.has(pubkey)) return prev;
        const next = new Set(prev);
        next.add(pubkey);
        return next;
      });
    }
  };

  const clearAllRemotes = () => {
    for (const r of remotesRef.current.values()) {
      r.cameraVideoTrack?.stop();
      r.cameraAudioTrack?.stop();
      r.screenVideoTrack?.stop();
      r.screenAudioTrack?.stop();
    }
    remotesRef.current.clear();
    setRemoteStreams(new Map());
    setRemoteScreenStreams(new Map());
    setRemoteReady(new Set());
    setRemoteScreenReady(new Set());
  };

  // ── MoQ connection lifecycle ───────────────────────────────────────────
  // Restarts if the session id, self pubkey, or configured relay URL
  // changes. Tears down cleanly when the mode flips away from "moq" (e.g.
  // a Safari peer joins and the room falls back to the WebRTC mesh).
  useEffect(() => {
    if (!enabled || mode !== "moq" || !sessionId || !selfPubkey) return;

    if (!relayUrl || !relayUrl.startsWith("https://")) {
      setError("Live preview server needs an https:// URL.");
      return;
    }

    const client = new MoqClient(relayUrl, sessionId);
    clientRef.current = client;

    const off = client.on((ev) => {
      if (ev.type === "connected") {
        setIsConnected(true);
        setError(null);
      } else if (ev.type === "disconnected") {
        setIsConnected(false);
        if (ev.error) setError(ev.error);
        clearAllRemotes();
      } else if (ev.type === "quality") {
        setQuality(ev.quality);
        setRttMs(ev.rttMs);
      } else if (ev.type === "track") {
        handleIncomingTrack(ev.track);
      }
    });

    function handleIncomingTrack(track: IncomingTrack) {
      const parsed = parseNamespace(track.header.namespace);
      if (!parsed) return;
      if (parsed.sessionId !== sessionId) return;
      // Skip our own published tracks if the relay echoes them back.
      if (parsed.pubkey === selfPubkey) return;
      // Default to "camera" so legacy publishers (and any future unknown
      // source value) keep working without changes.
      const source: "camera" | "screen" =
        track.header.source === "screen" ? "screen" : "camera";
      try {
        const decoded = decodeTrack(track.header, track.objects, {
          onFirstFrame:
            track.header.kind === "video"
              ? () => markRemoteReady(parsed.pubkey, source)
              : undefined,
        });
        upsertRemoteTrack(parsed.pubkey, decoded, source);
      } catch (err) {
        console.warn("Failed to decode incoming track", err);
      }
    }

    let cancelled = false;
    void (async () => {
      try {
        await client.connect();
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Couldn't reach the live preview server.";
        setError(msg);
        setIsConnected(false);
      }
    })();

    return () => {
      cancelled = true;
      off();
      try {
        client.close();
      } catch {
        // ignore
      }
      clientRef.current = null;
      clearAllRemotes();
      setIsConnected(false);
      setQuality("unknown");
      setRttMs(null);
    };
  }, [enabled, mode, sessionId, selfPubkey, relayUrl]);

  // ── MoQ camera publish lifecycle ───────────────────────────────────────
  // Restarts encoders whenever the local stream identity changes (device
  // switch). Tears down on transport loss.
  useEffect(() => {
    if (mode !== "moq" || !isConnected || !localStream || !selfPubkey) return;
    const client = clientRef.current;
    if (!client) return;

    let cancelled = false;
    let publisher: PublisherHandle | null = null;

    void (async () => {
      try {
        const ns = namespaceFor(sessionId, selfPubkey);
        publisher = await publishStream(
          localStream,
          ns,
          (header) => client.openPublishTrack(header),
          { source: "camera" },
        );
        if (cancelled) {
          await publisher.stop().catch(() => {});
          return;
        }
        publisherRef.current = publisher;
      } catch (err) {
        if (!cancelled) {
          console.warn("Failed to publish local stream", err);
        }
      }
    })();

    return () => {
      cancelled = true;
      const p = publisher;
      publisherRef.current = null;
      void p?.stop().catch(() => {});
    };
  }, [mode, isConnected, localStream, selfPubkey, sessionId]);

  // ── MoQ screen publish lifecycle ───────────────────────────────────────
  // Independent screen-share publisher tagged source="screen" against the
  // same per-pubkey namespace whenever a screen stream is provided. Tears
  // down cleanly when the stream goes away. Failures here NEVER affect
  // the camera publisher above.
  useEffect(() => {
    if (mode !== "moq" || !isConnected || !screenStream || !selfPubkey) return;
    const client = clientRef.current;
    if (!client) return;

    let cancelled = false;
    let publisher: PublisherHandle | null = null;

    void (async () => {
      try {
        const ns = namespaceFor(sessionId, selfPubkey);
        publisher = await publishStream(
          screenStream,
          ns,
          (header) => client.openPublishTrack(header),
          { source: "screen" },
        );
        if (cancelled) {
          await publisher.stop().catch(() => {});
          return;
        }
        screenPublisherRef.current = publisher;
      } catch (err) {
        if (!cancelled) {
          console.warn("Failed to publish screen stream", err);
        }
      }
    })();

    return () => {
      cancelled = true;
      const p = publisher;
      screenPublisherRef.current = null;
      void p?.stop().catch(() => {});
    };
  }, [mode, isConnected, screenStream, selfPubkey, sessionId]);

  // ── WebRTC mesh lifecycle ──────────────────────────────────────────────
  // Stand up a `WebRtcMesh` while `mode === "webrtc"`. Roster + local
  // stream changes are pushed via dedicated effects below so the mesh
  // itself isn't recreated on every roster blip.
  const peerPubkeys = useMemo(() => {
    const list = (peers ?? []).map((p) => p.pubkey).filter(Boolean);
    list.sort();
    return list;
  }, [peers]);
  const peerPubkeysKey = peerPubkeys.join(","); // stable string for deps

  useEffect(() => {
    if (!enabled || mode !== "webrtc" || !sessionId || !selfPubkey) return;
    if (!signaling) {
      setError("Live video isn't available in this browser.");
      return;
    }
    setError(null);

    // `cancelled` guards the inbound event callback from racing the
    // teardown path: mesh.close() may not synchronously stop in-flight
    // listener invocations (e.g. an ICE-state callback already on the
    // microtask queue), and an `attachRtcTrack` after `clearAllRemotes`
    // would resurrect a stream the rest of the hook has just dropped.
    let cancelled = false;
    const mesh = new WebRtcMesh({ selfPubkey, signaling });
    meshRef.current = mesh;

    const off = mesh.on((ev) => {
      if (cancelled) return;
      if (ev.type === "connected") {
        setIsConnected(true);
        setError(null);
      } else if (ev.type === "disconnected") {
        setIsConnected(false);
        if (ev.error) setError(ev.error);
      } else if (ev.type === "quality") {
        setQuality(ev.quality);
        setRttMs(ev.rttMs);
      } else if (ev.type === "track-added") {
        attachRtcTrack(ev.pubkey, ev.source, ev.track);
      } else if (ev.type === "track-removed") {
        detachRtcTrack(ev.pubkey, ev.source, ev.kind, ev.trackId);
      }
    });

    return () => {
      cancelled = true;
      off();
      try {
        mesh.close();
      } catch {
        // ignore
      }
      meshRef.current = null;
      clearAllRemotes();
      setIsConnected(false);
      setQuality("unknown");
      setRttMs(null);
    };
  }, [enabled, mode, sessionId, selfPubkey, signaling]);

  // Push roster updates into the live mesh (no recreate).
  useEffect(() => {
    if (mode !== "webrtc") return;
    meshRef.current?.setPeers(peerPubkeys);
    // peerPubkeysKey participates in the deps so we re-run when the
    // sorted list of pubkeys changes content, not just identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, peerPubkeysKey]);

  // Push local stream changes into the live mesh.
  useEffect(() => {
    if (mode !== "webrtc") return;
    meshRef.current?.setLocalCameraStream(localStream);
  }, [mode, localStream]);
  useEffect(() => {
    if (mode !== "webrtc") return;
    meshRef.current?.setLocalScreenStream(screenStream);
  }, [mode, screenStream]);

  return {
    isSupported,
    mode,
    isConnected,
    quality,
    rttMs,
    error,
    remoteStreams,
    remoteScreenStreams,
    remoteReady,
    remoteScreenReady,
  };
}
