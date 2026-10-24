/**
 * WebRTC peer-to-peer mesh transport — fallback for browsers that can't
 * run the MoQ (WebTransport + WebCodecs) stack, primarily Safari and
 * Firefox today.
 *
 * Topology
 * --------
 *   - One {@link RTCPeerConnection} per OTHER peer in the room (full mesh).
 *   - The local participant's audio + video tracks are added to every
 *     connection. When the local stream changes (device swap, screen
 *     share start/stop), tracks are replaced on every PC.
 *   - Inbound `RTCTrackEvent`s are routed back to the orchestrator together
 *     with the originating peer pubkey and the source ("camera" / "screen").
 *
 * Signalling
 * ----------
 * Offer / Answer / ICE messages travel over an injected
 * {@link WebRtcSignaling} adapter. The adapter is responsible for SIGNING
 * the payload with the local participant's identity and VERIFYING the
 * sender's signature on receive. This module assumes both have already
 * happened — every payload that reaches `handleSignal()` is treated as
 * authentic.
 *
 * Glare resolution uses the "perfect negotiation" pattern: the
 * lexicographically larger pubkey is the polite peer (yields on
 * collision), and the smaller pubkey is impolite (initiates). Both sides
 * arrive at this conclusion deterministically without an extra
 * handshake.
 *
 * Source attribution (camera vs screen)
 * -------------------------------------
 * WebRTC alone can't tell a receiver "this incoming track is the
 * publisher's screen-share, not their webcam" — there's no `source` field
 * on `MediaStreamTrack`. We solve this with a small ordered DataChannel
 * named "vessel-meta" on each PC. As soon as it opens, the publisher
 * sends a hello message mapping each MediaStream id to its source
 * ("camera" / "screen"). Every track event the receiver sees is then
 * tagged using that mapping. Tracks that arrive BEFORE the hello are
 * buffered briefly and resolved when the hello lands.
 *
 * STUN / TURN
 * -----------
 * Default ICE config: a couple of public STUN servers (Google +
 * Cloudflare), overridable via the `iceServers` constructor option (the
 * live-transport hook passes the list from `GET /api/turn`, which adds
 * short-lived TURN credentials when the operator runs a relay) or the
 * `VITE_VESSEL_STUN_URLS` env var (comma-separated).
 *
 * Recovery
 * --------
 * A peer connection that reports `failed` gets an ICE restart right away;
 * one that reports `disconnected` gets a short grace period first. Restarts
 * back off and stop after a few attempts, at which point a `disconnected`
 * event with a reason is emitted so the UI can say so.
 *
 * UI strings
 * ----------
 * NONE. The studio chrome already references "live video" and "this
 * room" and never names the underlying transport / signalling
 * primitives. Forbidden vocabulary (WebRTC / SDP / ICE / TURN / STUN /
 * MoQ / WebTransport) MUST NOT escape this module into user-visible
 * copy.
 */

import type { ConnectionQuality } from "./moq";

const META_CHANNEL_LABEL = "vessel-meta";
const STATS_INTERVAL_MS = 2000;
const QUALITY_RTT_GOOD_MS = 120;
const QUALITY_RTT_FAIR_MS = 350;

const DEFAULT_STUN_URLS = [
  "stun:stun.l.google.com:19302",
  "stun:stun.cloudflare.com:3478",
];

/** ICE restarts per peer before we give up and tell the UI. */
export const MAX_ICE_RESTARTS = 5;
/** How long a `disconnected` state may last before we restart ICE. */
export const DISCONNECT_GRACE_MS = 3000;
/** Base of the exponential backoff between restarts. */
const RESTART_BACKOFF_BASE_MS = 1000;
const RESTART_BACKOFF_MAX_MS = 8000;

/** Read STUN urls from the build-time env var if present, else fall back
 *  to the public defaults. Comma-separated list. */
function defaultIceServers(): RTCIceServer[] {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  const raw = env?.VITE_VESSEL_STUN_URLS;
  const urls = (raw ? raw.split(",") : DEFAULT_STUN_URLS)
    .map((u) => u.trim())
    .filter(Boolean);
  return [{ urls }];
}

export type Source = "camera" | "screen";

export type WebRtcSignalPayload =
  | { type: "offer"; sdp: string }
  | { type: "answer"; sdp: string }
  | { type: "ice"; candidate: RTCIceCandidateInit | null };

export interface WebRtcSignaling {
  /** Send a signed signalling payload addressed to one peer. The adapter
   *  is responsible for signing + relaying; this module never inspects
   *  the wire bytes. */
  send(targetPubkey: string, payload: WebRtcSignalPayload): Promise<void>;
  /** Subscribe to inbound signalling payloads addressed to us. The handler
   *  is invoked AFTER the adapter has verified the sender's signature.
   *  Returns an unsubscribe function. */
  on(handler: (from: string, payload: WebRtcSignalPayload) => void): () => void;
}

export type WebRtcMeshEvent =
  | { type: "connected" }
  | { type: "disconnected"; error?: string }
  | { type: "quality"; quality: ConnectionQuality; rttMs: number | null }
  | {
      type: "track-added";
      pubkey: string;
      source: Source;
      track: MediaStreamTrack;
    }
  | {
      type: "track-removed";
      pubkey: string;
      source: Source;
      kind: "video" | "audio";
      trackId: string;
    };

type Listener = (ev: WebRtcMeshEvent) => void;

/** Per-peer signalling state machine. Mirrors the names used in the task
 *  description so tests can assert against a stable vocabulary. */
export type PeerStateName =
  | "idle"
  | "offering"
  | "answering"
  | "connecting"
  | "connected"
  | "closed";

type PeerState = {
  pubkey: string;
  pc: RTCPeerConnection;
  meta: RTCDataChannel | null;
  /** Lexicographic ordering — true = polite (yields on glare). */
  polite: boolean;
  state: PeerStateName;
  /** Pending ICE candidates received before the remote description was
   *  set. Drained the moment a remote description lands. */
  pendingIce: RTCIceCandidateInit[];
  /** Source map from the remote's MediaStream.id → "camera" / "screen",
   *  populated by the META hello. */
  sourceByStreamId: Map<string, Source>;
  /** Tracks awaiting source resolution (arrived before the hello). */
  pendingTracks: Array<{ track: MediaStreamTrack; streamId: string }>;
  /** Track id → source we last reported it as, plus the track kind so
   *  the close-peer cleanup path can emit a faithful track-removed. */
  reportedByTrackId: Map<string, { source: Source; kind: "video" | "audio" }>;
  /** Perfect negotiation flags. */
  makingOffer: boolean;
  ignoreOffer: boolean;
  /** ICE restarts attempted since the last good connection. */
  restartAttempts: number;
  restartTimer: ReturnType<typeof setTimeout> | null;
};

export type WebRtcMeshConfig = {
  /** The local participant's pubkey. Determines polite vs impolite role. */
  selfPubkey: string;
  signaling: WebRtcSignaling;
  /** Override STUN servers. Default: a couple of public STUN servers,
   *  optionally overridden by `VITE_VESSEL_STUN_URLS`. */
  iceServers?: RTCIceServer[];
  /** Returns the set of pubkeys allowed to signal us (the session
   *  roster), or null to accept anyone whose signature verified. Signals
   *  from outside the set are dropped before a connection is created. */
  acceptedPeers?: () => ReadonlySet<string> | null;
};

export class WebRtcMesh {
  private peers = new Map<string, PeerState>();
  private listeners = new Set<Listener>();
  private cameraStream: MediaStream;
  private screenStream: MediaStream;
  private wantedPeers = new Set<string>();
  private offSignal: () => void;
  private closed = false;
  private iceServers: RTCIceServer[];
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private lastQuality: ConnectionQuality = "unknown";
  private lastConnectedEmitted = false;

  constructor(private cfg: WebRtcMeshConfig) {
    this.iceServers = cfg.iceServers ?? defaultIceServers();
    this.cameraStream = new MediaStream();
    this.screenStream = new MediaStream();
    this.offSignal = cfg.signaling.on((from, payload) => {
      void this.handleSignal(from, payload);
    });
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(ev: WebRtcMeshEvent): void {
    for (const l of this.listeners) {
      try {
        l(ev);
      } catch (err) {
        console.error("[webrtc-mesh] listener threw", err);
      }
    }
  }

  /** Update the desired peer roster. Adds a new RTCPeerConnection for
   *  newcomers and tears one down for departures. Idempotent. */
  setPeers(pubkeys: Iterable<string>): void {
    if (this.closed) return;
    const next = new Set<string>();
    for (const pk of pubkeys) {
      if (pk && pk !== this.cfg.selfPubkey) next.add(pk);
    }
    this.wantedPeers = next;
    for (const pk of next) {
      if (!this.peers.has(pk)) this.addPeer(pk);
    }
    for (const pk of [...this.peers.keys()]) {
      if (!next.has(pk)) this.removePeer(pk);
    }
    this.maybeStartStatsLoop();
  }

  /** Replace the local camera+mic stream broadcast to every peer. */
  setLocalCameraStream(stream: MediaStream | null): void {
    if (this.closed) return;
    this.replaceLocalStream("camera", stream);
  }

  /** Replace the local screen-capture stream broadcast to every peer. */
  setLocalScreenStream(stream: MediaStream | null): void {
    if (this.closed) return;
    this.replaceLocalStream("screen", stream);
  }

  private replaceLocalStream(source: Source, next: MediaStream | null): void {
    const current = source === "camera" ? this.cameraStream : this.screenStream;
    // Unhook old senders for tracks we previously published from this slot.
    const oldTracks = current.getTracks();
    for (const tr of oldTracks) {
      for (const peer of this.peers.values()) {
        for (const sender of peer.pc.getSenders()) {
          if (sender.track === tr) {
            try {
              peer.pc.removeTrack(sender);
            } catch {
              // ignore — PC may already be closed
            }
          }
        }
      }
      try {
        current.removeTrack(tr);
      } catch {
        // ignore
      }
    }
    // Build a fresh container so the receiver sees a fresh MediaStream id
    // and re-keys its source map via the next META hello.
    const replacement = new MediaStream(next ? next.getTracks() : []);
    if (source === "camera") this.cameraStream = replacement;
    else this.screenStream = replacement;
    for (const peer of this.peers.values()) {
      for (const tr of replacement.getTracks()) {
        try {
          peer.pc.addTrack(tr, replacement);
        } catch (err) {
          console.warn("[webrtc-mesh] addTrack failed", err);
        }
      }
      this.sendMetaHello(peer);
    }
  }

  private addPeer(pubkey: string): PeerState {
    // Higher pubkey = polite (yields). Equal would be self, already filtered.
    const polite = this.cfg.selfPubkey > pubkey;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer: PeerState = {
      pubkey,
      pc,
      meta: null,
      polite,
      state: "idle",
      pendingIce: [],
      sourceByStreamId: new Map(),
      pendingTracks: [],
      reportedByTrackId: new Map(),
      makingOffer: false,
      ignoreOffer: false,
      restartAttempts: 0,
      restartTimer: null,
    };
    this.peers.set(pubkey, peer);
    this.wirePeer(peer);
    // Add whatever local tracks we already have.
    for (const tr of this.cameraStream.getTracks()) {
      try {
        pc.addTrack(tr, this.cameraStream);
      } catch (err) {
        console.warn("[webrtc-mesh] initial camera addTrack failed", err);
      }
    }
    for (const tr of this.screenStream.getTracks()) {
      try {
        pc.addTrack(tr, this.screenStream);
      } catch (err) {
        console.warn("[webrtc-mesh] initial screen addTrack failed", err);
      }
    }
    // The IMPOLITE side opens the META data channel; the POLITE side
    // watches `ondatachannel`. This deterministic assignment avoids the
    // duplicate-channel ambiguity that arises when both sides try to
    // create one.
    if (!polite) {
      try {
        peer.meta = pc.createDataChannel(META_CHANNEL_LABEL, { ordered: true });
        this.wireMeta(peer);
      } catch (err) {
        console.warn("[webrtc-mesh] createDataChannel failed", err);
      }
    }
    return peer;
  }

  private wirePeer(peer: PeerState): void {
    const pc = peer.pc;

    pc.onnegotiationneeded = () => {
      void (async () => {
        try {
          peer.makingOffer = true;
          peer.state = "offering";
          await pc.setLocalDescription();
          await this.cfg.signaling.send(peer.pubkey, {
            type: "offer",
            sdp: pc.localDescription?.sdp ?? "",
          });
        } catch (err) {
          console.warn("[webrtc-mesh] onnegotiationneeded failed", err);
        } finally {
          peer.makingOffer = false;
        }
      })();
    };

    pc.onicecandidate = ({ candidate }) => {
      void this.cfg.signaling
        .send(peer.pubkey, {
          type: "ice",
          candidate: candidate ? candidate.toJSON() : null,
        })
        .catch(() => {});
    };

    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      if (s === "connected" || s === "completed") {
        peer.state = "connected";
        peer.restartAttempts = 0;
        this.clearRestart(peer);
      } else if (s === "closed") {
        peer.state = "closed";
        this.clearRestart(peer);
      } else if (s === "failed") {
        if (peer.state !== "closed") {
          peer.state = "connecting";
          this.scheduleIceRestart(peer, 0);
        }
      } else if (s === "disconnected") {
        if (peer.state !== "closed") {
          peer.state = "connecting";
          this.scheduleIceRestart(peer, DISCONNECT_GRACE_MS);
        }
      }
      this.recomputeOverallConnected();
    };

    pc.ontrack = (ev) => {
      const stream = ev.streams[0];
      const streamId = stream?.id ?? "";
      this.routeIncomingTrack(peer, ev.track, streamId);
    };

    pc.ondatachannel = (ev) => {
      if (ev.channel.label !== META_CHANNEL_LABEL) return;
      peer.meta = ev.channel;
      this.wireMeta(peer);
    };
  }

  private clearRestart(peer: PeerState): void {
    if (peer.restartTimer) {
      clearTimeout(peer.restartTimer);
      peer.restartTimer = null;
    }
  }

  /** Restart ICE for one peer after `delayMs` plus exponential backoff,
   *  unless it reconnected on its own meanwhile. Gives up after
   *  {@link MAX_ICE_RESTARTS} and reports it. */
  private scheduleIceRestart(peer: PeerState, delayMs: number): void {
    if (this.closed || peer.state === "closed") return;
    this.clearRestart(peer);
    const backoff = Math.min(
      RESTART_BACKOFF_MAX_MS,
      RESTART_BACKOFF_BASE_MS * 2 ** peer.restartAttempts,
    );
    peer.restartTimer = setTimeout(() => {
      peer.restartTimer = null;
      if (this.closed || peer.state === "closed") return;
      const s = peer.pc.iceConnectionState;
      if (s === "connected" || s === "completed") return;
      if (peer.restartAttempts >= MAX_ICE_RESTARTS) {
        this.emit({
          type: "disconnected",
          error: "Live video lost the connection to a participant.",
        });
        return;
      }
      peer.restartAttempts += 1;
      this.restartIce(peer);
      // If this attempt does not reconnect either, try again later.
      this.scheduleIceRestart(peer, DISCONNECT_GRACE_MS);
    }, delayMs + backoff);
  }

  /** `restartIce()` queues a fresh ICE offer through `onnegotiationneeded`,
   *  so the existing perfect-negotiation path handles the exchange. Older
   *  engines without it get an explicit restart offer from the impolite side. */
  private restartIce(peer: PeerState): void {
    const pc = peer.pc as RTCPeerConnection & { restartIce?: () => void };
    try {
      if (typeof pc.restartIce === "function") {
        pc.restartIce();
        return;
      }
    } catch (err) {
      console.warn("[webrtc-mesh] restartIce failed", err);
    }
    if (peer.polite) return;
    void (async () => {
      try {
        peer.makingOffer = true;
        peer.state = "offering";
        const offer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(offer);
        await this.cfg.signaling.send(peer.pubkey, {
          type: "offer",
          sdp: pc.localDescription?.sdp ?? offer.sdp ?? "",
        });
      } catch (err) {
        console.warn("[webrtc-mesh] ICE restart offer failed", err);
      } finally {
        peer.makingOffer = false;
      }
    })();
  }

  private wireMeta(peer: PeerState): void {
    const ch = peer.meta;
    if (!ch) return;
    const announce = () => this.sendMetaHello(peer);
    if (ch.readyState === "open") announce();
    else ch.onopen = announce;
    ch.onmessage = (ev) => {
      try {
        const text = typeof ev.data === "string" ? ev.data : "";
        if (!text) return;
        const msg = JSON.parse(text) as { type?: string; streams?: unknown };
        if (msg.type !== "hello" || !Array.isArray(msg.streams)) return;
        for (const raw of msg.streams) {
          const s = raw as { id?: unknown; source?: unknown };
          if (
            typeof s.id === "string" &&
            (s.source === "camera" || s.source === "screen")
          ) {
            peer.sourceByStreamId.set(s.id, s.source);
          }
        }
        this.drainPendingTracks(peer);
      } catch {
        // ignore malformed meta payloads
      }
    };
  }

  private sendMetaHello(peer: PeerState): void {
    const ch = peer.meta;
    if (!ch || ch.readyState !== "open") return;
    const payload = {
      type: "hello",
      streams: [
        { id: this.cameraStream.id, source: "camera" as const },
        { id: this.screenStream.id, source: "screen" as const },
      ],
    };
    try {
      ch.send(JSON.stringify(payload));
    } catch (err) {
      console.warn("[webrtc-mesh] meta hello send failed", err);
    }
  }

  private routeIncomingTrack(
    peer: PeerState,
    track: MediaStreamTrack,
    streamId: string,
  ): void {
    const known = peer.sourceByStreamId.get(streamId);
    if (known) this.reportTrackAdded(peer, track, known);
    else peer.pendingTracks.push({ track, streamId });

    track.onended = () => {
      const reported = peer.reportedByTrackId.get(track.id);
      if (!reported) return;
      peer.reportedByTrackId.delete(track.id);
      this.emit({
        type: "track-removed",
        pubkey: peer.pubkey,
        source: reported.source,
        kind: reported.kind,
        trackId: track.id,
      });
    };
  }

  private drainPendingTracks(peer: PeerState): void {
    if (!peer.pendingTracks.length) return;
    const remaining: typeof peer.pendingTracks = [];
    for (const entry of peer.pendingTracks) {
      const src = peer.sourceByStreamId.get(entry.streamId);
      if (src) this.reportTrackAdded(peer, entry.track, src);
      else remaining.push(entry);
    }
    peer.pendingTracks = remaining;
  }

  private reportTrackAdded(
    peer: PeerState,
    track: MediaStreamTrack,
    source: Source,
  ): void {
    const kind: "video" | "audio" = track.kind === "audio" ? "audio" : "video";
    peer.reportedByTrackId.set(track.id, { source, kind });
    this.emit({ type: "track-added", pubkey: peer.pubkey, source, track });
  }

  private removePeer(pubkey: string): void {
    const peer = this.peers.get(pubkey);
    if (!peer) return;
    peer.state = "closed";
    this.clearRestart(peer);
    try {
      peer.meta?.close();
    } catch {
      // ignore
    }
    try {
      peer.pc.close();
    } catch {
      // ignore
    }
    // Surface track-removed for everything we'd reported, so the
    // orchestrator drops their tiles cleanly.
    for (const [trackId, info] of peer.reportedByTrackId) {
      this.emit({
        type: "track-removed",
        pubkey,
        source: info.source,
        kind: info.kind,
        trackId,
      });
    }
    this.peers.delete(pubkey);
    this.recomputeOverallConnected();
  }

  /** Inbound signal router. Implements the "perfect negotiation" pattern
   *  so two browsers offering simultaneously deterministically converge
   *  on a single PC instead of looping. */
  private async handleSignal(
    from: string,
    payload: WebRtcSignalPayload,
  ): Promise<void> {
    if (this.closed) return;
    if (from === this.cfg.selfPubkey) return;
    // Only people on the session roster may open a connection to us. A
    // valid signature proves a key, not membership.
    const accepted = this.cfg.acceptedPeers?.();
    if (accepted && !accepted.has(from)) return;
    if (!this.wantedPeers.has(from)) {
      // Lazily accept the connection. The remote may have noticed us
      // ahead of our own roster update — the polite/impolite split
      // handles glare, so it's safe to spin up a PC for them now.
      this.addPeer(from);
      this.wantedPeers.add(from);
    }
    const peer = this.peers.get(from);
    if (!peer) return;
    const pc = peer.pc;

    try {
      if (payload.type === "offer") {
        const collision = peer.makingOffer || pc.signalingState !== "stable";
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;
        peer.state = "answering";
        if (collision) {
          // Polite peer rolls back its outbound offer before accepting.
          try {
            await pc.setLocalDescription({ type: "rollback" });
          } catch {
            // Some implementations don't expose rollback as a separate
            // call; falling through to setRemoteDescription is the
            // documented alternative.
          }
        }
        await pc.setRemoteDescription({ type: "offer", sdp: payload.sdp });
        await this.flushPendingIce(peer);
        await pc.setLocalDescription();
        await this.cfg.signaling.send(from, {
          type: "answer",
          sdp: pc.localDescription?.sdp ?? "",
        });
        peer.state = "connecting";
      } else if (payload.type === "answer") {
        if (pc.signalingState !== "have-local-offer") {
          // Spurious answer — we're not waiting for one. Drop quietly.
          return;
        }
        await pc.setRemoteDescription({ type: "answer", sdp: payload.sdp });
        await this.flushPendingIce(peer);
        peer.state = "connecting";
      } else if (payload.type === "ice") {
        if (!payload.candidate) {
          // End-of-candidates marker — nothing to do for trickle ICE.
          return;
        }
        if (!pc.remoteDescription) {
          peer.pendingIce.push(payload.candidate);
        } else {
          try {
            await pc.addIceCandidate(payload.candidate);
          } catch (err) {
            if (!peer.ignoreOffer)
              console.warn("[webrtc-mesh] addIceCandidate failed", err);
          }
        }
      }
    } catch (err) {
      console.warn("[webrtc-mesh] handleSignal failed", err);
    }
  }

  private async flushPendingIce(peer: PeerState): Promise<void> {
    if (!peer.pendingIce.length) return;
    const pending = peer.pendingIce.splice(0);
    for (const c of pending) {
      try {
        await peer.pc.addIceCandidate(c);
      } catch (err) {
        console.warn("[webrtc-mesh] flushPendingIce failed", err);
      }
    }
  }

  private recomputeOverallConnected(): void {
    if (this.closed) return;
    const anyConnected = [...this.peers.values()].some(
      (p) => p.state === "connected",
    );
    if (anyConnected && !this.lastConnectedEmitted) {
      this.lastConnectedEmitted = true;
      this.emit({ type: "connected" });
    } else if (!anyConnected && this.lastConnectedEmitted) {
      this.lastConnectedEmitted = false;
      this.emit({ type: "disconnected" });
    }
  }

  private maybeStartStatsLoop(): void {
    if (this.statsTimer) return;
    if (this.peers.size === 0) return;
    this.statsTimer = setInterval(() => {
      void this.collectStats().catch(() => {});
    }, STATS_INTERVAL_MS);
  }

  private async collectStats(): Promise<void> {
    let bestRttMs: number | null = null;
    for (const peer of this.peers.values()) {
      if (peer.state !== "connected") continue;
      try {
        const stats = await peer.pc.getStats();
        stats.forEach((report) => {
          const r = report as {
            type?: string;
            nominated?: boolean;
            currentRoundTripTime?: number;
          };
          if (
            r.type === "candidate-pair" &&
            r.nominated &&
            typeof r.currentRoundTripTime === "number"
          ) {
            const ms = r.currentRoundTripTime * 1000;
            if (bestRttMs == null || ms < bestRttMs) bestRttMs = ms;
          }
        });
      } catch {
        // ignore — getStats can throw on a torn-down PC
      }
    }
    if (bestRttMs == null) return;
    const next: ConnectionQuality =
      bestRttMs <= QUALITY_RTT_GOOD_MS
        ? "good"
        : bestRttMs <= QUALITY_RTT_FAIR_MS
          ? "fair"
          : "poor";
    if (next !== this.lastQuality) {
      this.lastQuality = next;
      this.emit({ type: "quality", quality: next, rttMs: Math.round(bestRttMs) });
    }
  }

  /** Tear down every PC and unsubscribe from signalling. Idempotent. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.offSignal();
    } catch {
      // ignore
    }
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
    for (const pubkey of [...this.peers.keys()]) {
      this.removePeer(pubkey);
    }
    this.peers.clear();
    if (this.lastConnectedEmitted) {
      this.lastConnectedEmitted = false;
      this.emit({ type: "disconnected" });
    }
  }

  /** Test-only: peek at the per-peer state machine names. Stable contract
   *  used by `webrtc-mesh.test.ts`. */
  __peekStates(): Map<string, PeerStateName> {
    const out = new Map<string, PeerStateName>();
    for (const [k, v] of this.peers) out.set(k, v.state);
    return out;
  }
}
