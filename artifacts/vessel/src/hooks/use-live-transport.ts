/**
 * useLiveTransport — orchestrates the real live-preview pipeline:
 *
 *   1. Open a WebTransport-backed MoqClient against the configured relay.
 *   2. Encode the local stream (video + audio) and publish into the
 *      session's per-pubkey namespace.
 *   3. Watch incoming tracks from the relay, decode them, group by
 *      participant pubkey, and expose the resulting MediaStreams to the
 *      caller as `remoteStreams`.
 *   4. Surface real connection-quality measurements driven by control-plane
 *      RTT (NOT navigator.connection.effectiveType).
 *
 * No UI strings live in this file. The studio chrome reads the results and
 * uses the same "live preview" / "Connection quality" copy it always has.
 */

import { useEffect, useRef, useState } from "react";
import {
  MoqClient,
  isLivePreviewSupported,
  type ConnectionQuality,
  type IncomingTrack,
} from "../lib/moq";
import { decodeTrack, publishStream, type DecodedTrack, type PublisherHandle } from "../lib/codec";

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

export type UseLiveTransportArgs = {
  sessionId: string;
  /** The local participant's pubkey, used to build their publish namespace. */
  selfPubkey: string | null | undefined;
  /** Local A/V stream to publish. May be null while devices are warming up. */
  localStream: MediaStream | null;
  /** Optional local screen-capture stream to publish as a second feed
   *  tagged source="screen". When null we don't publish anything extra
   *  and any previously-published screen stream is torn down. */
  screenStream?: MediaStream | null;
  /** Pause the transport entirely (e.g. session not yet live). */
  enabled?: boolean;
};

export type UseLiveTransportResult = {
  /** True iff the browser supports WebTransport + WebCodecs. */
  isSupported: boolean;
  /** True iff the transport is currently connected to the relay. */
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

function namespaceFor(sessionId: string, pubkey: string): string {
  return `vessel/${sessionId}/${pubkey}`;
}

function parseNamespace(ns: string): { sessionId: string; pubkey: string } | null {
  const parts = ns.split("/");
  if (parts.length !== 3 || parts[0] !== "vessel") return null;
  return { sessionId: parts[1], pubkey: parts[2] };
}

export function useLiveTransport({
  sessionId,
  selfPubkey,
  localStream,
  screenStream = null,
  enabled = true,
}: UseLiveTransportArgs): UseLiveTransportResult {
  const [isSupported] = useState(() => isLivePreviewSupported());
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

  const upsertRemoteTrack = (
    pubkey: string,
    decoded: DecodedTrack,
    source: "camera" | "screen",
  ) => {
    let entry = remotesRef.current.get(pubkey);
    if (!entry) {
      entry = {
        pubkey,
        cameraVideoTrack: null,
        cameraAudioTrack: null,
        cameraStream: new MediaStream(),
        screenVideoTrack: null,
        screenAudioTrack: null,
        screenStream: new MediaStream(),
        hasScreen: false,
      };
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

  // Connection lifecycle. Restarts if the session id, self pubkey, or
  // configured relay URL changes (relay URL is reactive via storage events
  // and the same-tab `vessel:relay-url-changed` event).
  useEffect(() => {
    if (!enabled || !isSupported || !sessionId || !selfPubkey) return;

    if (!relayUrl || !relayUrl.startsWith("https://")) {
      setError("Live preview relay needs an https:// URL.");
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
        const msg = err instanceof Error ? err.message : "Couldn't reach the live preview relay.";
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
  }, [enabled, isSupported, sessionId, selfPubkey, relayUrl]);

  // Publish lifecycle (camera + mic). Restarts encoders whenever the local
  // stream identity changes (device switch). Tears down on transport loss.
  useEffect(() => {
    if (!isConnected || !localStream || !selfPubkey) return;
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
  }, [isConnected, localStream, selfPubkey, sessionId]);

  // Independent screen-share publish lifecycle. Spins up a second publisher
  // tagged source="screen" against the same per-pubkey namespace whenever a
  // screen stream is provided. Tears down cleanly when the stream goes
  // away (user pressed Stop, OS dialog closed, session ended). Failures
  // here NEVER affect the camera publisher above.
  useEffect(() => {
    if (!isConnected || !screenStream || !selfPubkey) return;
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
  }, [isConnected, screenStream, selfPubkey, sessionId]);

  return {
    isSupported,
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
