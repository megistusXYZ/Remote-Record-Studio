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
  /** Decoded remote MediaStreams keyed by participant pubkey. */
  remoteStreams: Map<string, MediaStream>;
  /** Pubkeys whose video track has actually rendered at least one frame.
   *  Use this — not just `remoteStreams.has(pubkey)` — to flip a tile
   *  from "Connecting..." to live preview, since a track exists from the
   *  moment its header arrives, before any payload bytes are decoded. */
  remoteReady: Set<string>;
};

type RemoteParticipant = {
  pubkey: string;
  videoTrack: DecodedTrack | null;
  audioTrack: DecodedTrack | null;
  stream: MediaStream;
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
  const [remoteReady, setRemoteReady] = useState<Set<string>>(() => new Set());

  const relayUrl = useReactiveRelayUrl();

  const clientRef = useRef<MoqClient | null>(null);
  const publisherRef = useRef<PublisherHandle | null>(null);
  const remotesRef = useRef<Map<string, RemoteParticipant>>(new Map());

  const upsertRemoteTrack = (pubkey: string, decoded: DecodedTrack) => {
    let entry = remotesRef.current.get(pubkey);
    if (!entry) {
      entry = {
        pubkey,
        videoTrack: null,
        audioTrack: null,
        stream: new MediaStream(),
      };
      remotesRef.current.set(pubkey, entry);
    }
    if (decoded.kind === "video") {
      if (entry.videoTrack) {
        entry.videoTrack.stop();
        try {
          entry.stream.removeTrack(entry.videoTrack.track);
        } catch {
          // ignore
        }
      }
      entry.videoTrack = decoded;
    } else {
      if (entry.audioTrack) {
        entry.audioTrack.stop();
        try {
          entry.stream.removeTrack(entry.audioTrack.track);
        } catch {
          // ignore
        }
      }
      entry.audioTrack = decoded;
    }
    entry.stream.addTrack(decoded.track);
    // Force a fresh Map identity so React re-renders consumers.
    setRemoteStreams(new Map(Array.from(remotesRef.current.entries()).map(
      ([k, v]) => [k, v.stream] as const,
    )));
  };

  const markRemoteReady = (pubkey: string) => {
    setRemoteReady((prev) => {
      if (prev.has(pubkey)) return prev;
      const next = new Set(prev);
      next.add(pubkey);
      return next;
    });
  };

  const clearAllRemotes = () => {
    for (const r of remotesRef.current.values()) {
      r.videoTrack?.stop();
      r.audioTrack?.stop();
    }
    remotesRef.current.clear();
    setRemoteStreams(new Map());
    setRemoteReady(new Set());
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
      try {
        const decoded = decodeTrack(track.header, track.objects, {
          onFirstFrame:
            track.header.kind === "video"
              ? () => markRemoteReady(parsed.pubkey)
              : undefined,
        });
        upsertRemoteTrack(parsed.pubkey, decoded);
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

  // Publish lifecycle. Restarts encoders whenever the local stream identity
  // changes (device switch). Tears down on transport loss.
  useEffect(() => {
    if (!isConnected || !localStream || !selfPubkey) return;
    const client = clientRef.current;
    if (!client) return;

    let cancelled = false;
    let publisher: PublisherHandle | null = null;

    void (async () => {
      try {
        const ns = namespaceFor(sessionId, selfPubkey);
        publisher = await publishStream(localStream, ns, (header) =>
          client.openPublishTrack(header),
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

  return {
    isSupported,
    isConnected,
    quality,
    rttMs,
    error,
    remoteStreams,
    remoteReady,
  };
}
