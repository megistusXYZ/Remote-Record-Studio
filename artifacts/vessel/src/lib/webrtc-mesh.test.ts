import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  WebRtcMesh,
  MAX_ICE_RESTARTS,
  DISCONNECT_GRACE_MS,
  type WebRtcMeshEvent,
  type WebRtcSignaling,
  type WebRtcSignalPayload,
} from "./webrtc-mesh";

// ─── Mocks ──────────────────────────────────────────────────────────────
//
// Real RTCPeerConnection is browser-only and stateful enough that a
// genuine integration test belongs in the manual cross-browser run. The
// unit suite exercises the WebRtcMesh's public state machine — adding
// peers, signal routing, perfect-negotiation glare resolution, ICE
// buffering, close — against a minimal mock RTCPeerConnection.

class MockDataChannel {
  readyState: "connecting" | "open" | "closing" | "closed" = "open";
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = "closed";
  });
}

type AnyDesc = { type: string; sdp?: string };

class MockPC {
  signalingState: RTCSignalingState = "stable";
  iceConnectionState: RTCIceConnectionState = "new";
  localDescription: AnyDesc | null = null;
  remoteDescription: AnyDesc | null = null;
  ontrack: ((e: { track: MediaStreamTrack; streams: MediaStream[] }) => void) | null = null;
  onnegotiationneeded: (() => void) | null = null;
  onicecandidate: ((e: { candidate: { toJSON: () => RTCIceCandidateInit } | null }) => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((e: { channel: MockDataChannel }) => void) | null = null;
  senders: Array<{ track: MediaStreamTrack | null }> = [];

  addTrack = vi.fn((track: MediaStreamTrack, _stream: MediaStream) => {
    const sender = { track };
    this.senders.push(sender);
    return sender;
  });
  removeTrack = vi.fn((sender: { track: MediaStreamTrack | null }) => {
    const i = this.senders.indexOf(sender);
    if (i >= 0) this.senders.splice(i, 1);
  });
  getSenders = () => this.senders;
  createDataChannel = vi.fn((_label: string) => new MockDataChannel());
  setLocalDescription = vi.fn(async (desc?: AnyDesc) => {
    this.localDescription = desc ?? { type: "offer", sdp: "fake-local-sdp" };
  });
  setRemoteDescription = vi.fn(async (desc: AnyDesc) => {
    this.remoteDescription = desc;
  });
  addIceCandidate = vi.fn(async (_c: RTCIceCandidateInit) => {});
  getStats = vi.fn(async () => new Map());
  restartIce = vi.fn();
  close = vi.fn(() => {
    this.signalingState = "closed";
    this.iceConnectionState = "closed";
  });
}

let createdPCs: MockPC[] = [];

beforeEach(() => {
  createdPCs = [];
  (globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection =
    class TrackingPC extends MockPC {
      constructor() {
        super();
        createdPCs.push(this);
      }
    };
  // MediaStream is also browser-only; happy-dom polyfills it but provide
  // a tiny shim if absent.
  if (typeof (globalThis as unknown as { MediaStream?: unknown }).MediaStream === "undefined") {
    class FakeMediaStream {
      id = `ms-${Math.random().toString(36).slice(2)}`;
      private tracks: MediaStreamTrack[] = [];
      constructor(initial?: MediaStreamTrack[]) {
        if (initial) this.tracks = [...initial];
      }
      getTracks() {
        return [...this.tracks];
      }
      addTrack(t: MediaStreamTrack) {
        this.tracks.push(t);
      }
      removeTrack(t: MediaStreamTrack) {
        this.tracks = this.tracks.filter((x) => x !== t);
      }
    }
    (globalThis as unknown as { MediaStream: unknown }).MediaStream = FakeMediaStream;
  }
});

afterEach(() => {
  delete (globalThis as unknown as { RTCPeerConnection?: unknown }).RTCPeerConnection;
});

function makeSignaling() {
  const handlers: Array<(from: string, payload: WebRtcSignalPayload) => void> = [];
  const sent: Array<{ to: string; payload: WebRtcSignalPayload }> = [];
  const sig: WebRtcSignaling & {
    sent: typeof sent;
    deliver: (from: string, payload: WebRtcSignalPayload) => void;
  } = {
    sent,
    send: vi.fn(async (to: string, payload: WebRtcSignalPayload) => {
      sent.push({ to, payload });
    }),
    on: (handler) => {
      handlers.push(handler);
      return () => {
        const i = handlers.indexOf(handler);
        if (i >= 0) handlers.splice(i, 1);
      };
    },
    deliver: (from, payload) => {
      for (const h of handlers) h(from, payload);
    },
  };
  return sig;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("WebRtcMesh", () => {
  it("creates a peer connection per remote pubkey", () => {
    const sig = makeSignaling();
    const mesh = new WebRtcMesh({ selfPubkey: "self", signaling: sig });
    mesh.setPeers(["bob", "carol"]);
    expect(createdPCs.length).toBe(2);
    expect(mesh.__peekStates().size).toBe(2);
  });

  it("excludes the local pubkey from the peer set", () => {
    const sig = makeSignaling();
    const mesh = new WebRtcMesh({ selfPubkey: "self", signaling: sig });
    mesh.setPeers(["self", "bob"]);
    expect(createdPCs.length).toBe(1);
  });

  it("tears down a peer connection when the peer leaves the roster", () => {
    const sig = makeSignaling();
    const mesh = new WebRtcMesh({ selfPubkey: "self", signaling: sig });
    mesh.setPeers(["bob"]);
    expect(createdPCs.length).toBe(1);
    mesh.setPeers([]);
    expect(createdPCs[0].close).toHaveBeenCalled();
    expect(mesh.__peekStates().size).toBe(0);
  });

  it("buffers ICE candidates that arrive before the remote description", async () => {
    const sig = makeSignaling();
    const mesh = new WebRtcMesh({ selfPubkey: "self", signaling: sig });
    mesh.setPeers(["bob"]);
    const pc = createdPCs[0];

    sig.deliver("bob", { type: "ice", candidate: { candidate: "cand-1" } });
    await flush();
    expect(pc.addIceCandidate).not.toHaveBeenCalled();

    sig.deliver("bob", { type: "offer", sdp: "remote-sdp" });
    await flush();
    expect(pc.setRemoteDescription).toHaveBeenCalledWith({
      type: "offer",
      sdp: "remote-sdp",
    });
    expect(pc.addIceCandidate).toHaveBeenCalledWith({ candidate: "cand-1" });
  });

  it("polite peer accepts an offer that collides with our own", async () => {
    const sig = makeSignaling();
    // selfPubkey "z..." > "a..." → self is polite
    const mesh = new WebRtcMesh({ selfPubkey: "zzzz", signaling: sig });
    mesh.setPeers(["aaaa"]);
    const pc = createdPCs[0];
    pc.signalingState = "have-local-offer"; // simulate mid-offer
    sig.deliver("aaaa", { type: "offer", sdp: "remote-sdp" });
    await flush();
    expect(pc.setRemoteDescription).toHaveBeenCalled();
  });

  it("impolite peer ignores an offer that collides with our own", async () => {
    const sig = makeSignaling();
    // selfPubkey "a..." < "z..." → self is impolite
    const mesh = new WebRtcMesh({ selfPubkey: "aaaa", signaling: sig });
    mesh.setPeers(["zzzz"]);
    const pc = createdPCs[0];
    pc.signalingState = "have-local-offer";
    sig.deliver("zzzz", { type: "offer", sdp: "remote-sdp" });
    await flush();
    expect(pc.setRemoteDescription).not.toHaveBeenCalled();
  });

  it("ignores an answer that arrives when we are not waiting for one", async () => {
    const sig = makeSignaling();
    const mesh = new WebRtcMesh({ selfPubkey: "self", signaling: sig });
    mesh.setPeers(["bob"]);
    const pc = createdPCs[0];
    pc.signalingState = "stable";
    sig.deliver("bob", { type: "answer", sdp: "spurious-sdp" });
    await flush();
    expect(pc.setRemoteDescription).not.toHaveBeenCalled();
  });

  it("lazily creates a PC for an unexpected sender (roster race)", async () => {
    const sig = makeSignaling();
    const mesh = new WebRtcMesh({ selfPubkey: "self", signaling: sig });
    // No peers configured yet
    expect(createdPCs.length).toBe(0);
    sig.deliver("late-joiner", { type: "offer", sdp: "remote-sdp" });
    await flush();
    expect(createdPCs.length).toBe(1);
    expect(createdPCs[0].setRemoteDescription).toHaveBeenCalled();
  });

  it("close() tears down every PC and stops accepting signals", async () => {
    const sig = makeSignaling();
    const mesh = new WebRtcMesh({ selfPubkey: "self", signaling: sig });
    mesh.setPeers(["bob", "carol"]);
    mesh.close();
    for (const pc of createdPCs) expect(pc.close).toHaveBeenCalled();
    sig.deliver("bob", { type: "offer", sdp: "post-close" });
    await flush();
    // No new PC, no new RD set on the closed ones
    expect(createdPCs.length).toBe(2);
  });

  it("setPeers is idempotent and does not recreate existing PCs", () => {
    const sig = makeSignaling();
    const mesh = new WebRtcMesh({ selfPubkey: "self", signaling: sig });
    mesh.setPeers(["bob"]);
    mesh.setPeers(["bob"]);
    expect(createdPCs.length).toBe(1);
  });
});

describe("WebRtcMesh — roster gate", () => {
  it("drops signals from pubkeys outside the accepted set", async () => {
    const sig = makeSignaling();
    const accepted = new Set(["bob"]);
    new WebRtcMesh({ selfPubkey: "self", signaling: sig, acceptedPeers: () => accepted });
    // A valid-looking offer from someone who is not on the roster must
    // not open a connection (and so never receive our camera).
    sig.deliver("mallory", { type: "offer", sdp: "remote-sdp" });
    await flush();
    expect(createdPCs.length).toBe(0);
    // The same offer from a roster member is accepted lazily as before.
    sig.deliver("bob", { type: "offer", sdp: "remote-sdp" });
    await flush();
    expect(createdPCs.length).toBe(1);
  });

  it("accepts anyone when the gate returns null", async () => {
    const sig = makeSignaling();
    new WebRtcMesh({ selfPubkey: "self", signaling: sig, acceptedPeers: () => null });
    sig.deliver("whoever", { type: "offer", sdp: "remote-sdp" });
    await flush();
    expect(createdPCs.length).toBe(1);
  });
});

describe("WebRtcMesh — ICE recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function failedPeer() {
    const sig = makeSignaling();
    const mesh = new WebRtcMesh({ selfPubkey: "self", signaling: sig });
    mesh.setPeers(["bob"]);
    const pc = createdPCs[0];
    return { mesh, pc };
  }

  it("restarts ICE after a failure and stops once the peer is back", () => {
    const { mesh, pc } = failedPeer();
    pc.iceConnectionState = "failed";
    pc.oniceconnectionstatechange?.();
    // Immediate failure: first restart after the base backoff only.
    expect(pc.restartIce).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(pc.restartIce).toHaveBeenCalledTimes(1);
    // The restart worked: no further attempts, counter reset.
    pc.iceConnectionState = "connected";
    pc.oniceconnectionstatechange?.();
    vi.advanceTimersByTime(60_000);
    expect(pc.restartIce).toHaveBeenCalledTimes(1);
    mesh.close();
  });

  it("gives a transient disconnect a grace period before restarting", () => {
    const { mesh, pc } = failedPeer();
    pc.iceConnectionState = "disconnected";
    pc.oniceconnectionstatechange?.();
    vi.advanceTimersByTime(DISCONNECT_GRACE_MS + 999);
    expect(pc.restartIce).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(pc.restartIce).toHaveBeenCalledTimes(1);
    mesh.close();
  });

  it("stops after the restart budget and reports the loss once", () => {
    const { mesh, pc } = failedPeer();
    const events: WebRtcMeshEvent[] = [];
    mesh.on((ev) => events.push(ev));
    pc.iceConnectionState = "failed";
    pc.oniceconnectionstatechange?.();
    vi.advanceTimersByTime(5 * 60_000);
    expect(pc.restartIce).toHaveBeenCalledTimes(MAX_ICE_RESTARTS);
    const lost = events.filter((e) => e.type === "disconnected" && "error" in e && e.error);
    expect(lost).toHaveLength(1);
    mesh.close();
  });

  it("cancels a pending restart when the peer leaves", () => {
    const { mesh, pc } = failedPeer();
    pc.iceConnectionState = "failed";
    pc.oniceconnectionstatechange?.();
    mesh.setPeers([]);
    vi.advanceTimersByTime(60_000);
    expect(pc.restartIce).not.toHaveBeenCalled();
    mesh.close();
  });
});
