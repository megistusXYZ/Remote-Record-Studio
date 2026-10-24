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
import { getIceServers } from "@workspace/api-client-react";
import { deploymentMoqRelayUrl } from "../lib/runtime-config";

// No shipped relay: public MoQ relays do not speak Vessel's framing, so a
// default would only ever fail. The WebRTC mesh is the default transport;
// MoQ is opt-in through an operator-run relay.
const DEFAULT_RELAY_URL = deploymentMoqRelayUrl();

// ── Relay probe cache ─────────────────────────────────────────────────
// A configured relay is used only after it answered a connection probe.
// Results are remembered briefly so a room full of re-renders does not
// hammer it.
const PROBE_TTL_MS = 5 * 60 * 1000;
const probeCache = new Map<string, { ok: boolean; at: number }>();
/** Fresh cached verdict for `url`, or null when it has to be probed. */
function cachedProbe(url: string): boolean | null {
  const cached = probeCache.get(url);
  if (cached && Date.now() - cached.at < PROBE_TTL_MS) return cached.ok;
  return null;
}
async function probeRelay(url: string): Promise<boolean> {
  const cached = cachedProbe(url);
  if (cached !== null) return cached;
  const result = await MoqClient.probe(url).catch(() => ({ ok: false as const, reason: "probe threw" }));
  probeCache.set(url, { ok: result.ok, at: Date.now() });
  return result.ok;
}

// ── ICE servers ───────────────────────────────────────────────────────
// STUN plus, when the operator runs a TURN relay, short-lived credentials
// from the API. Cached until shortly before the credential expires. On
// any failure the mesh falls back to its public STUN defaults.
const ICE_FETCH_TIMEOUT_MS = 3000;
const ICE_STUN_ONLY_TTL_MS = 10 * 60 * 1000;
let iceCache: { servers: RTCIceServer[]; expiresAt: number } | null = null;
async function fetchIceServers(): Promise<RTCIceServer[] | undefined> {
  if (iceCache && Date.now() < iceCache.expiresAt) return iceCache.servers;
  try {
    const result = await Promise.race([
      getIceServers(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("ICE server lookup timed out")), ICE_FETCH_TIMEOUT_MS),
      ),
    ]);
    const servers = result.iceServers.map((s) => ({
      urls: s.urls,
      ...(s.username ? { username: s.username } : {}),
      ...(s.credential ? { credential: s.credential } : {}),
    })) as RTCIceServer[];
    const ttlMs = result.ttlSeconds > 0 ? Math.max(60_000, (result.ttlSeconds - 60) * 1000) : ICE_STUN_ONLY_TTL_MS;
    iceCache = { servers, expiresAt: Date.now() + ttlMs };
    return servers;
  } catch (err) {
    console.warn("[live-transport] could not fetch ICE servers; using defaults", err);
    return undefined;
  }
}

/** Test hook. */
export function __resetLiveTransportCaches(): void {
  probeCache.clear();
  iceCache = null;
}

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
  /** Pubkeys allowed to connect to us (the session roster). Signals from
   *  anyone else are ignored, so a stranger who learned the session id
   *  cannot push an offer and receive our camera. Null disables the gate. */
  acceptedPeers?: string[] | null;
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
 *  down. The optional `extraCleanup` runs before `track.stop()` so any
 *  per-track resources (e.g. a first-frame probe element) tear down
 *  alongside the track itself. */
function wrapPlainTrack(
  track: MediaStreamTrack,
  extraCleanup?: () => void,
): DecodedTrack {
  return {
    track,
    kind: track.kind === "audio" ? "audio" : "video",
    stop: () => {
      try {
        extraCleanup?.();
      } catch {
        // ignore — best-effort cleanup
      }
      try {
        track.stop();
      } catch {
        // ignore — already stopped
      }
    },
  };
}

type WithRequestVideoFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/**
 * Detect the first actually-decoded frame for an inbound video track.
 *
 * The naive `track.muted` + `unmute` gate fires when the underlying
 * pipeline reports the track is producing samples — typically a frame
 * or two BEFORE the first decoded frame is presentable. The result is
 * a perceptible black flash on the remote tile when WebRTC video
 * first arrives. Mirroring the MoQ path's `onFirstFrame` discipline,
 * we attach the track to a detached `<video>` element and ask the
 * browser to tell us when it has actually painted a frame:
 *
 *   - `requestVideoFrameCallback` (Chromium / Firefox / Safari 15.4+)
 *     is the most accurate signal; it fires exactly once per painted
 *     frame so the very first invocation IS the first frame.
 *   - Browsers without it fall back to the `playing` event, which is
 *     still strictly later than `unmute` and avoids the worst flash.
 *   - A 5-second hard timeout guarantees the tile never sits stuck on
 *     "Connecting…" if neither signal fires (e.g. a permanently
 *     muted/black track).
 *
 * Returns a cleanup function that callers MUST invoke when the track
 * is replaced or detached, otherwise the probe element leaks.
 */
function probeFirstVideoFrame(
  track: MediaStreamTrack,
  onReady: () => void,
): () => void {
  if (typeof document === "undefined") {
    // SSR / non-DOM context — fall back to the synchronous mark so the
    // tile doesn't wedge. Should never run in practice (the studio is
    // CSR-only) but keeps the helper environment-safe.
    onReady();
    return () => {};
  }
  const video = document.createElement("video") as WithRequestVideoFrameCallback;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  // Off-document is enough — we never insert it into the DOM. The
  // browser still decodes into it because srcObject + play() is what
  // drives the pipeline, not document attachment.
  try {
    video.srcObject = new MediaStream([track]);
  } catch {
    // Some test environments don't support MediaStream construction.
    // Treat as immediate ready so the tile isn't stuck.
    onReady();
    return () => {};
  }
  // `done` is set whenever the probe is finished — either because a
  // first frame fired (in `fire()`) OR because an external caller
  // tore the probe down (in `cleanup()`). Setting it in BOTH paths
  // prevents an in-flight requestVideoFrameCallback from invoking
  // `onReady()` AFTER the track has been detached/replaced (which
  // would otherwise re-add a stale pubkey to `remoteReady`).
  let done = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let rvfcHandle: number | null = null;
  const cleanup = () => {
    done = true;
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    if (rvfcHandle != null && typeof video.cancelVideoFrameCallback === "function") {
      try {
        video.cancelVideoFrameCallback(rvfcHandle);
      } catch {
        // ignore
      }
      rvfcHandle = null;
    }
    try {
      video.srcObject = null;
    } catch {
      // ignore
    }
    try {
      video.remove();
    } catch {
      // ignore — element was never inserted
    }
  };
  const fire = () => {
    if (done) return;
    cleanup();
    try {
      onReady();
    } catch (err) {
      console.warn("first-frame ready callback threw", err);
    }
  };
  if (typeof video.requestVideoFrameCallback === "function") {
    rvfcHandle = video.requestVideoFrameCallback(() => fire());
  } else {
    video.addEventListener("playing", fire, { once: true });
  }
  // Last-ditch timeout so a permanently-black track doesn't leave the
  // tile in "Connecting…" forever. 5s comfortably outlasts every
  // browser's first-decoded-frame latency on a working track.
  timer = setTimeout(fire, 5000);
  // Kick the decode pipeline. Some browsers won't decode without
  // play(); muted autoplay is universally allowed so this is safe.
  void video.play().catch(() => {
    // play() can reject on some test envs (jsdom) or if the element
    // was removed mid-call. The event/timeout paths still resolve.
  });
  return cleanup;
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
  acceptedPeers = null,
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

  // The relay must be explicitly configured AND answer a probe before the
  // MoQ path is even considered; a failure mid-call flips the room to the
  // mesh for the rest of the session (or until the URL changes).
  const relayUrl = useReactiveRelayUrl();
  const relayConfigured = relayUrl.startsWith("https://");
  const [moqFailed, setMoqFailed] = useState(false);
  useEffect(() => {
    setMoqFailed(false);
  }, [relayUrl]);
  const probeWanted = relayConfigured && moqCapable && !moqFailed;
  // `ok: null` means the probe is still in flight. While it is, neither
  // transport starts, so a room never stands up the mesh only to tear it
  // down a second later when the relay answers.
  const [probe, setProbe] = useState<{ url: string; ok: boolean | null }>(() => ({
    url: relayUrl,
    ok: probeWanted ? cachedProbe(relayUrl) : false,
  }));
  useEffect(() => {
    if (!probeWanted) {
      setProbe({ url: relayUrl, ok: false });
      return undefined;
    }
    const cached = cachedProbe(relayUrl);
    setProbe({ url: relayUrl, ok: cached });
    if (cached !== null) return undefined;
    let cancelled = false;
    void probeRelay(relayUrl).then((ok) => {
      if (!cancelled) setProbe({ url: relayUrl, ok });
    });
    return () => {
      cancelled = true;
    };
  }, [relayUrl, probeWanted]);
  const relayReady = probe.url === relayUrl && probe.ok === true;
  const relayProbing = probeWanted && (probe.url !== relayUrl || probe.ok === null);

  const mode: TransportMode = useMemo(
    () =>
      selectTransport({
        moqAvailable: moqCapable && !moqFailed,
        webRtcAvailable: webRtcCapable,
        roomNeedsWebRtc,
        relayConfigured,
        relayReady,
      }),
    [moqCapable, moqFailed, webRtcCapable, roomNeedsWebRtc, relayConfigured, relayReady],
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
      // Mark the tile as ready only when the browser has actually
      // painted the first frame, NOT when the track reports it's
      // unmuted (the unmute event consistently fires a frame or two
      // before the first decoded frame, producing a brief black flash
      // on the tile). The probe element is torn down by the wrapper's
      // stop() — see wrapPlainTrack.
      const markReady = () => markRemoteReady(pubkey, source);
      const cancelProbe = probeFirstVideoFrame(track, markReady);
      const wrapped = wrapPlainTrack(track, cancelProbe);
      if (isScreen) entry.screenVideoTrack = wrapped;
      else entry.cameraVideoTrack = wrapped;
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
      // A participant without a camera (phone, no camera, camera blocked)
      // is live the moment their audio lands; the tile shows their avatar.
      markRemoteReady(pubkey, source);
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
    // Camera ready means "the camera video track has produced its
    // first decoded frame". When that video track is detached, the
    // flag is no longer meaningful — clear it so a fresh camera
    // republish (e.g. user toggles their camera off and back on)
    // re-arms the first-frame probe instead of remaining stuck on a
    // stale "live" state pointing at a detached track.
    if (!isScreen && kind === "video") {
      setRemoteReady((prev) => {
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
        clearAllRemotes();
        if (ev.error) {
          // Lost the relay mid-call: carry on over the mesh rather than
          // sitting on a broken preview.
          console.warn("[live-transport] relay dropped; switching to direct connections", ev.error);
          probeCache.delete(relayUrl);
          setMoqFailed(true);
        }
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
        console.warn("[live-transport] relay connect failed; switching to direct connections", err);
        setIsConnected(false);
        probeCache.delete(relayUrl);
        setMoqFailed(true);
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

  // Latest values the asynchronous mesh set-up applies once the mesh
  // exists (ICE servers arrive from the API first).
  const acceptedRef = useRef<ReadonlySet<string> | null>(null);
  useEffect(() => {
    acceptedRef.current = acceptedPeers ? new Set(acceptedPeers) : null;
  }, [acceptedPeers]);
  const latestPeersRef = useRef<string[]>(peerPubkeys);
  latestPeersRef.current = peerPubkeys;
  const latestCameraRef = useRef<MediaStream | null>(localStream);
  latestCameraRef.current = localStream;
  const latestScreenRef = useRef<MediaStream | null>(screenStream);
  latestScreenRef.current = screenStream;

  useEffect(() => {
    if (!enabled || mode !== "webrtc" || !sessionId || !selfPubkey) return;
    // A configured relay is still being probed: hold off rather than
    // start the mesh and swap a second later.
    if (relayProbing) return;
    if (!signaling) {
      setError("Live video isn't connected yet.");
      return;
    }
    setError(null);

    // `cancelled` guards the inbound event callback from racing the
    // teardown path: mesh.close() may not synchronously stop in-flight
    // listener invocations (e.g. an ICE-state callback already on the
    // microtask queue), and an `attachRtcTrack` after `clearAllRemotes`
    // would resurrect a stream the rest of the hook has just dropped.
    let cancelled = false;
    let mesh: WebRtcMesh | null = null;
    let off: (() => void) | null = null;
    void (async () => {
      const iceServers = await fetchIceServers();
      if (cancelled) return;
      mesh = new WebRtcMesh({
        selfPubkey,
        signaling,
        ...(iceServers ? { iceServers } : {}),
        acceptedPeers: () => acceptedRef.current,
      });
      meshRef.current = mesh;

      off = mesh.on((ev) => {
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

      // Anything the roster and stream effects pushed while we were
      // waiting for ICE servers lands now.
      mesh.setPeers(latestPeersRef.current);
      mesh.setLocalCameraStream(latestCameraRef.current);
      mesh.setLocalScreenStream(latestScreenRef.current);
    })();

    return () => {
      cancelled = true;
      off?.();
      try {
        mesh?.close();
      } catch {
        // ignore
      }
      meshRef.current = null;
      clearAllRemotes();
      setIsConnected(false);
      setQuality("unknown");
      setRttMs(null);
    };
  }, [enabled, mode, sessionId, selfPubkey, signaling, relayProbing]);

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
