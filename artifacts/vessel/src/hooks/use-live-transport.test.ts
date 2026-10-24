import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

/**
 * Transport-selection and mid-call transport-swap tests for
 * `useLiveTransport`.
 *
 * The hook drives one of two underlying transports for the studio's
 * live A/V plane, picked by `selectTransport()` from the roster of peer
 * capabilities plus the state of the (optional) relay:
 *
 *   - "webrtc": the cross-browser peer-to-peer mesh. The default.
 *   - "moq":    the higher-capacity Chromium-only path through a relay
 *               the operator configured, used only once that relay has
 *               answered a probe.
 *
 * What this suite protects:
 *
 *   1. No relay configured ⇒ the mesh, always, with no probe traffic.
 *   2. A configured relay is probed first; nothing starts while the
 *      probe is in flight, so a room never stands up the mesh only to
 *      swap a second later.
 *   3. Switching between the transports mid-call is clean: the old
 *      client shuts down before the new one starts. Either leak would
 *      silently double the upstream bandwidth.
 *   4. A relay that refuses or drops the connection flips the room to
 *      the mesh for the rest of the session.
 *   5. The mesh gets the API's ICE servers (STUN + short-lived TURN) and
 *      the session roster as its accepted-peer gate; a failed ICE
 *      lookup still yields a mesh on the built-in defaults.
 *
 * Both transports are mocked at the module boundary because real
 * `RTCPeerConnection` / `WebTransport` machinery is browser-only. The
 * tests assert on instance creation/teardown and configuration — the
 * lifecycle the hook is responsible for — not on the transports'
 * internals, which have their own suites (`webrtc-mesh.test.ts`).
 */

// ─── Hoisted mock state ────────────────────────────────────────────────
const hoisted = vi.hoisted(() => {
  type AnyEvent = Record<string, unknown>;

  const state = {
    /** Make the next MoqClient.connect() reject. */
    failNextConnect: false,
    /** Probe verdict for the configured relay. */
    probeOk: true,
    /** When set, probes wait on it (lets a test hold the probe open). */
    probeGate: null as Promise<void> | null,
  };

  const probe = vi.fn(
    async (
      _url: string,
    ): Promise<
      { ok: true; latencyMs: number } | { ok: false; reason: string }
    > => {
      if (state.probeGate) await state.probeGate;
      return state.probeOk
        ? { ok: true, latencyMs: 12 }
        : { ok: false, reason: "Couldn't reach this server." };
    },
  );

  class MockMoqClient {
    static probe = probe;
    listeners = new Set<(ev: AnyEvent) => void>();
    closed = false;
    constructor(
      public url: string,
      public sessionId: string,
    ) {
      moqInstances.push(this);
    }
    on(l: (ev: AnyEvent) => void): () => void {
      this.listeners.add(l);
      return () => this.listeners.delete(l);
    }
    // Resolves without emitting "connected": the publish effect is gated
    // on a local stream these tests never provide.
    async connect(): Promise<void> {
      if (state.failNextConnect) {
        state.failNextConnect = false;
        throw new Error("relay refused the connection");
      }
    }
    close(): void {
      this.closed = true;
    }
    openPublishTrack(): { write: () => void; close: () => void } {
      return { write: () => {}, close: () => {} };
    }
  }

  type MeshConfig = {
    selfPubkey: string;
    signaling: unknown;
    iceServers?: RTCIceServer[];
    acceptedPeers?: () => ReadonlySet<string> | null;
  };

  class MockWebRtcMesh {
    listeners = new Set<(ev: AnyEvent) => void>();
    closed = false;
    setPeers = vi.fn<(peers: string[]) => void>();
    setLocalCameraStream = vi.fn<(s: MediaStream | null) => void>();
    setLocalScreenStream = vi.fn<(s: MediaStream | null) => void>();
    constructor(public cfg: MeshConfig) {
      meshInstances.push(this);
    }
    on(l: (ev: AnyEvent) => void): () => void {
      this.listeners.add(l);
      return () => this.listeners.delete(l);
    }
    close(): void {
      this.closed = true;
    }
  }

  const ICE_FROM_API = [
    { urls: ["stun:stun.test:3478"] },
    {
      urls: ["turn:turn.test:3478?transport=udp"],
      username: "1700000600:self",
      credential: "c2VjcmV0",
    },
  ];
  const getIceServers = vi.fn(async () => ({
    iceServers: ICE_FROM_API,
    ttlSeconds: 600,
    turnConfigured: true,
  }));

  const moqInstances: MockMoqClient[] = [];
  const meshInstances: MockWebRtcMesh[] = [];

  return {
    MockMoqClient,
    MockWebRtcMesh,
    moqInstances,
    meshInstances,
    state,
    probe,
    getIceServers,
    ICE_FROM_API,
  };
});

// ─── Module mocks ──────────────────────────────────────────────────────
vi.mock("../lib/moq", () => ({
  MoqClient: hoisted.MockMoqClient,
  isLivePreviewSupported: () => true,
}));

vi.mock("../lib/webrtc-mesh", () => ({
  WebRtcMesh: hoisted.MockWebRtcMesh,
}));

vi.mock("../lib/codec", () => ({
  decodeTrack: vi.fn(),
  publishStream: vi.fn(async () => ({ stop: vi.fn(async () => {}) })),
}));

vi.mock("@workspace/api-client-react", () => ({
  getIceServers: hoisted.getIceServers,
}));

import {
  useLiveTransport,
  __resetLiveTransportCaches,
  type LivePeer,
} from "./use-live-transport";
import type { WebRtcSignaling } from "../lib/webrtc-mesh";

const RELAY_KEY = "vessel_relay_url";
const RELAY = "https://relay.test";

function makeSignaling(): WebRtcSignaling {
  return {
    send: vi.fn(async () => {}),
    on: vi.fn(() => () => {}),
  };
}

/** Let probes, the ICE lookup and the effects they trigger run to rest. */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const ALL_MOQ: LivePeer[] = [{ pubkey: "peer1", supportsMoq: true }];
const MIXED: LivePeer[] = [
  { pubkey: "peer1", supportsMoq: true },
  { pubkey: "safari", supportsMoq: false },
];

beforeEach(() => {
  hoisted.moqInstances.length = 0;
  hoisted.meshInstances.length = 0;
  hoisted.state.failNextConnect = false;
  hoisted.state.probeOk = true;
  hoisted.state.probeGate = null;
  hoisted.probe.mockClear();
  hoisted.getIceServers.mockClear();
  localStorage.removeItem(RELAY_KEY);
  __resetLiveTransportCaches();
  // Make `isWebRtcAvailable()` (which probes globalThis.RTCPeerConnection)
  // return true so `selectTransport` can pick "webrtc".
  (globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection =
    class {};
});

afterEach(() => {
  delete (globalThis as unknown as { RTCPeerConnection?: unknown })
    .RTCPeerConnection;
  localStorage.removeItem(RELAY_KEY);
});

describe("useLiveTransport — default transport", () => {
  it("uses direct connections when no relay is configured, even in an all-capable room", async () => {
    const signaling = makeSignaling();
    const { result } = renderHook(() =>
      useLiveTransport({
        sessionId: "sess-default",
        selfPubkey: "self",
        localStream: null,
        peers: ALL_MOQ,
        signaling,
        selfSupportsMoq: true,
      }),
    );
    await settle();

    expect(result.current.mode).toBe("webrtc");
    expect(result.current.isSupported).toBe(true);
    expect(hoisted.moqInstances).toHaveLength(0);
    expect(hoisted.meshInstances).toHaveLength(1);
    // No relay URL ⇒ nothing to probe.
    expect(hoisted.probe).not.toHaveBeenCalled();
  });

  it("hands the mesh the API's ICE servers and the session roster as its gate", async () => {
    const signaling = makeSignaling();
    renderHook(() =>
      useLiveTransport({
        sessionId: "sess-ice",
        selfPubkey: "self",
        localStream: null,
        peers: ALL_MOQ,
        signaling,
        selfSupportsMoq: true,
        acceptedPeers: ["peer1", "host"],
      }),
    );
    await settle();

    expect(hoisted.getIceServers).toHaveBeenCalledTimes(1);
    const mesh = hoisted.meshInstances[0];
    expect(mesh.cfg.iceServers).toEqual(hoisted.ICE_FROM_API);
    expect(mesh.cfg.acceptedPeers?.()).toEqual(new Set(["peer1", "host"]));
    // The roster pushed while the ICE lookup was pending still lands.
    expect(mesh.setPeers).toHaveBeenCalledWith(["peer1"]);
  });

  it("still builds the mesh on built-in ICE defaults when the lookup fails", async () => {
    hoisted.getIceServers.mockRejectedValueOnce(new Error("offline"));
    const signaling = makeSignaling();
    const { result } = renderHook(() =>
      useLiveTransport({
        sessionId: "sess-ice-fail",
        selfPubkey: "self",
        localStream: null,
        peers: ALL_MOQ,
        signaling,
        selfSupportsMoq: true,
      }),
    );
    await settle();

    expect(result.current.mode).toBe("webrtc");
    expect(hoisted.meshInstances).toHaveLength(1);
    expect(hoisted.meshInstances[0].cfg.iceServers).toBeUndefined();
  });

  it("refuses to stand up the mesh when signaling is missing — surfaces an error instead of crashing", async () => {
    const { result } = renderHook(() =>
      useLiveTransport({
        sessionId: "sess-no-sig",
        selfPubkey: "self",
        localStream: null,
        peers: MIXED,
        signaling: null,
        selfSupportsMoq: true,
      }),
    );
    await settle();

    expect(result.current.mode).toBe("webrtc");
    expect(hoisted.meshInstances).toHaveLength(0);
    expect(result.current.error).toBeTruthy();
    expect(result.current.isConnected).toBe(false);
  });
});

describe("useLiveTransport — configured relay", () => {
  beforeEach(() => {
    localStorage.setItem(RELAY_KEY, RELAY);
  });

  it("uses the relay in an all-capable room once it answers the probe — no mesh constructed", async () => {
    const signaling = makeSignaling();
    const { result } = renderHook(() =>
      useLiveTransport({
        sessionId: "sess-1",
        selfPubkey: "self",
        localStream: null,
        peers: ALL_MOQ,
        signaling,
        selfSupportsMoq: true,
      }),
    );
    await settle();

    expect(hoisted.probe).toHaveBeenCalledWith(RELAY);
    expect(result.current.mode).toBe("moq");
    expect(result.current.isSupported).toBe(true);
    expect(hoisted.moqInstances).toHaveLength(1);
    expect(hoisted.moqInstances[0].url).toBe(RELAY);
    expect(hoisted.moqInstances[0].closed).toBe(false);
    expect(hoisted.meshInstances).toHaveLength(0);
  });

  it("starts nothing while the probe is in flight, then picks the relay without a mesh detour", async () => {
    let openGate!: () => void;
    hoisted.state.probeGate = new Promise<void>((r) => {
      openGate = r;
    });
    const signaling = makeSignaling();
    renderHook(() =>
      useLiveTransport({
        sessionId: "sess-probing",
        selfPubkey: "self",
        localStream: null,
        peers: ALL_MOQ,
        signaling,
        selfSupportsMoq: true,
      }),
    );
    await settle();
    expect(hoisted.moqInstances).toHaveLength(0);
    expect(hoisted.meshInstances).toHaveLength(0);

    openGate();
    await settle();
    expect(hoisted.moqInstances).toHaveLength(1);
    expect(hoisted.meshInstances).toHaveLength(0);
  });

  it("falls back to direct connections when the relay fails its probe", async () => {
    hoisted.state.probeOk = false;
    const signaling = makeSignaling();
    const { result } = renderHook(() =>
      useLiveTransport({
        sessionId: "sess-bad-probe",
        selfPubkey: "self",
        localStream: null,
        peers: ALL_MOQ,
        signaling,
        selfSupportsMoq: true,
      }),
    );
    await settle();

    expect(result.current.mode).toBe("webrtc");
    expect(hoisted.moqInstances).toHaveLength(0);
    expect(hoisted.meshInstances).toHaveLength(1);
  });

  it("drops to direct connections for the rest of the session when the relay refuses the connection", async () => {
    hoisted.state.failNextConnect = true;
    const signaling = makeSignaling();
    const { result } = renderHook(() =>
      useLiveTransport({
        sessionId: "sess-refused",
        selfPubkey: "self",
        localStream: null,
        peers: ALL_MOQ,
        signaling,
        selfSupportsMoq: true,
      }),
    );
    await settle();

    expect(result.current.mode).toBe("webrtc");
    expect(hoisted.moqInstances).toHaveLength(1);
    expect(hoisted.moqInstances[0].closed).toBe(true);
    expect(hoisted.meshInstances).toHaveLength(1);
    expect(hoisted.meshInstances[0].closed).toBe(false);
    // The user-facing error stays clear: the mesh took over.
    expect(result.current.error).toBeNull();
  });

  it("flips relay → direct the moment a non-capable peer joins, tearing down the old client", async () => {
    const signaling = makeSignaling();
    const { result, rerender } = renderHook(
      (props: { peers: LivePeer[] }) =>
        useLiveTransport({
          sessionId: "sess-2",
          selfPubkey: "self",
          localStream: null,
          peers: props.peers,
          signaling,
          selfSupportsMoq: true,
        }),
      { initialProps: { peers: ALL_MOQ } },
    );
    await settle();

    expect(result.current.mode).toBe("moq");
    expect(hoisted.moqInstances).toHaveLength(1);
    const firstMoq = hoisted.moqInstances[0];
    expect(firstMoq.closed).toBe(false);

    // A Safari peer joins.
    await act(async () => {
      rerender({ peers: MIXED });
    });
    await settle();

    expect(result.current.mode).toBe("webrtc");
    expect(firstMoq.closed).toBe(true);
    expect(hoisted.meshInstances).toHaveLength(1);
    const mesh = hoisted.meshInstances[0];
    expect(mesh.closed).toBe(false);
    expect(mesh.cfg.selfPubkey).toBe("self");
    // The full (sorted) roster reaches the new mesh so every peer gets paired.
    expect(mesh.setPeers).toHaveBeenCalledWith(["peer1", "safari"]);
    // No new relay client was constructed during the swap.
    expect(hoisted.moqInstances).toHaveLength(1);
  });

  it("flips direct → relay when the only non-capable peer leaves, tearing down the mesh", async () => {
    const signaling = makeSignaling();
    const { result, rerender } = renderHook(
      (props: { peers: LivePeer[] }) =>
        useLiveTransport({
          sessionId: "sess-3",
          selfPubkey: "self",
          localStream: null,
          peers: props.peers,
          signaling,
          selfSupportsMoq: true,
        }),
      { initialProps: { peers: MIXED } },
    );
    await settle();

    expect(result.current.mode).toBe("webrtc");
    expect(hoisted.meshInstances).toHaveLength(1);
    expect(hoisted.moqInstances).toHaveLength(0);
    const firstMesh = hoisted.meshInstances[0];

    await act(async () => {
      rerender({ peers: ALL_MOQ });
    });
    await settle();

    expect(result.current.mode).toBe("moq");
    expect(firstMesh.closed).toBe(true);
    expect(hoisted.moqInstances).toHaveLength(1);
    expect(hoisted.moqInstances[0].closed).toBe(false);
    expect(hoisted.meshInstances).toHaveLength(1);
  });

  it("never spins up the relay client on a browser without the capability", async () => {
    const signaling = makeSignaling();
    const { result } = renderHook(() =>
      useLiveTransport({
        sessionId: "sess-4",
        selfPubkey: "self",
        localStream: null,
        peers: ALL_MOQ,
        signaling,
        selfSupportsMoq: false,
      }),
    );
    await settle();

    expect(result.current.mode).toBe("webrtc");
    expect(hoisted.moqInstances).toHaveLength(0);
    expect(hoisted.meshInstances).toHaveLength(1);
    expect(hoisted.probe).not.toHaveBeenCalled();
  });

  it("tears down both transports cleanly on unmount — no leaked clients", async () => {
    const signaling = makeSignaling();
    const { unmount, rerender } = renderHook(
      (props: { peers: LivePeer[] }) =>
        useLiveTransport({
          sessionId: "sess-5",
          selfPubkey: "self",
          localStream: null,
          peers: props.peers,
          signaling,
          selfSupportsMoq: true,
        }),
      { initialProps: { peers: ALL_MOQ } },
    );
    await settle();

    await act(async () => {
      rerender({ peers: MIXED });
    });
    await settle();

    expect(hoisted.moqInstances).toHaveLength(1);
    expect(hoisted.meshInstances).toHaveLength(1);
    expect(hoisted.moqInstances[0].closed).toBe(true);
    expect(hoisted.meshInstances[0].closed).toBe(false);

    unmount();

    expect(hoisted.moqInstances[0].closed).toBe(true);
    expect(hoisted.meshInstances[0].closed).toBe(true);
  });
});
