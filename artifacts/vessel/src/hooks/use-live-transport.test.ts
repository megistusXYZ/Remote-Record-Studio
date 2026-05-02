import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

/**
 * Mid-call transport-swap regression test for `useLiveTransport`.
 *
 * The hook drives one of two underlying transports for the studio's
 * live A/V plane, picked by `selectTransport()` from a roster of peer
 * capabilities:
 *
 *   - "moq":    the high-capacity Chromium-only path.
 *   - "webrtc": the cross-browser peer-to-peer mesh fallback.
 *
 * The contract this suite protects is that switching between them
 * mid-call is clean: when a non-Chromium peer joins a Chromium-only
 * room the MoQ client must shut down before the WebRTC mesh starts,
 * and when that peer leaves we must flip back the same way. Either
 * leak (an old client kept open after the swap, or a new one created
 * while the old one is still alive) would silently double the
 * upstream bandwidth and risk a connection storm against the relay.
 *
 * Both transports are mocked at the module boundary because real
 * `RTCPeerConnection` / `WebTransport` machinery is browser-only and
 * stateful enough that exercising it here would test the browser, not
 * the hook. The tests assert on instance creation/teardown — the
 * lifecycle the hook is responsible for — not on the transports'
 * internal behaviour, which is covered by their own unit suites
 * (`webrtc-mesh.test.ts`).
 */

// ─── Hoisted mock state ────────────────────────────────────────────────
// `vi.hoisted` runs BEFORE any `vi.mock` factories, so the mock factories
// below can safely reference these closure-captured arrays/classes. We
// can't use plain top-level `let` for this — `vi.mock` is hoisted above
// imports, which would put it above the bindings.
const hoisted = vi.hoisted(() => {
  type AnyEvent = Record<string, unknown>;

  class MockMoqClient {
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
    // Intentionally a no-op: the transport-swap tests don't depend on
    // the connected-state branch (which gates the publish effect),
    // and emitting "connected" here would push state updates outside
    // act() and noise up the suite.
    async connect(): Promise<void> {}
    close(): void {
      this.closed = true;
    }
    openPublishTrack(): { write: () => void; close: () => void } {
      return { write: () => {}, close: () => {} };
    }
  }

  class MockWebRtcMesh {
    listeners = new Set<(ev: AnyEvent) => void>();
    closed = false;
    setPeers = vi.fn<(peers: string[]) => void>();
    setLocalCameraStream = vi.fn<(s: MediaStream | null) => void>();
    setLocalScreenStream = vi.fn<(s: MediaStream | null) => void>();
    constructor(public cfg: { selfPubkey: string; signaling: unknown }) {
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

  const moqInstances: MockMoqClient[] = [];
  const meshInstances: MockWebRtcMesh[] = [];

  return { MockMoqClient, MockWebRtcMesh, moqInstances, meshInstances };
});

// ─── Module mocks ──────────────────────────────────────────────────────
// We replace the transport modules with our mock classes, but leave
// `transport-select` and `codec` as-is: `selectTransport` is a pure
// function we want to exercise for real, and `codec` is only touched
// by the publish effect (gated on a present localStream + connected
// state, neither of which these tests provide).

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

import { useLiveTransport, type LivePeer } from "./use-live-transport";
import type { WebRtcSignaling } from "../lib/webrtc-mesh";

function makeSignaling(): WebRtcSignaling {
  return {
    send: vi.fn(async () => {}),
    on: vi.fn(() => () => {}),
  };
}

beforeEach(() => {
  hoisted.moqInstances.length = 0;
  hoisted.meshInstances.length = 0;
  // Make `isWebRtcAvailable()` (which probes globalThis.RTCPeerConnection)
  // return true so `selectTransport` will pick "webrtc" when the room
  // calls for it.
  (globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection =
    class {};
});

afterEach(() => {
  delete (globalThis as unknown as { RTCPeerConnection?: unknown })
    .RTCPeerConnection;
});

describe("useLiveTransport — mid-call transport swap", () => {
  it("starts in MoQ mode in an all-MoQ-capable room — no mesh constructed", () => {
    const signaling = makeSignaling();
    const { result } = renderHook(() =>
      useLiveTransport({
        sessionId: "sess-1",
        selfPubkey: "self",
        localStream: null,
        peers: [{ pubkey: "peer1", supportsMoq: true }],
        signaling,
        selfSupportsMoq: true,
      }),
    );

    expect(result.current.mode).toBe("moq");
    expect(result.current.isSupported).toBe(true);
    expect(hoisted.moqInstances).toHaveLength(1);
    expect(hoisted.moqInstances[0].closed).toBe(false);
    // Critical: the WebRTC mesh must NOT have been stood up. Building
    // it would open peer connections we'd never need.
    expect(hoisted.meshInstances).toHaveLength(0);
  });

  it("flips MoQ → WebRTC the moment a non-MoQ peer joins, tearing down the old client", () => {
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
      {
        initialProps: { peers: [{ pubkey: "peer1", supportsMoq: true }] },
      },
    );

    // Sanity: starts on MoQ.
    expect(result.current.mode).toBe("moq");
    expect(hoisted.moqInstances).toHaveLength(1);
    const firstMoq = hoisted.moqInstances[0];
    expect(firstMoq.closed).toBe(false);

    // A Safari peer joins.
    act(() => {
      rerender({
        peers: [
          { pubkey: "peer1", supportsMoq: true },
          { pubkey: "safari", supportsMoq: false },
        ],
      });
    });

    // The selector must have flipped, the old MoQ client must be
    // closed (no double-publishing), and a fresh mesh must be up.
    expect(result.current.mode).toBe("webrtc");
    expect(firstMoq.closed).toBe(true);
    expect(hoisted.meshInstances).toHaveLength(1);
    const mesh = hoisted.meshInstances[0];
    expect(mesh.closed).toBe(false);
    expect(mesh.cfg.selfPubkey).toBe("self");
    // The roster-push effect runs after the mesh constructor effect
    // and must hand the full peer list (sorted) to the new mesh so
    // every peer — Chromium and otherwise — gets paired up.
    expect(mesh.setPeers).toHaveBeenCalledWith(["peer1", "safari"]);
    // Critically NO new MoQ client was constructed during the swap.
    expect(hoisted.moqInstances).toHaveLength(1);
  });

  it("flips WebRTC → MoQ when the only non-MoQ peer leaves, tearing down the mesh", () => {
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
      {
        initialProps: {
          peers: [
            { pubkey: "peer1", supportsMoq: true },
            { pubkey: "safari", supportsMoq: false },
          ],
        },
      },
    );

    // Sanity: starts on WebRTC because of the Safari peer.
    expect(result.current.mode).toBe("webrtc");
    expect(hoisted.meshInstances).toHaveLength(1);
    expect(hoisted.moqInstances).toHaveLength(0);
    const firstMesh = hoisted.meshInstances[0];

    // Safari peer leaves.
    act(() => {
      rerender({ peers: [{ pubkey: "peer1", supportsMoq: true }] });
    });

    // Mesh must be torn down (no idle peer connections lingering),
    // and the higher-capacity MoQ path must take over.
    expect(result.current.mode).toBe("moq");
    expect(firstMesh.closed).toBe(true);
    expect(hoisted.moqInstances).toHaveLength(1);
    expect(hoisted.moqInstances[0].closed).toBe(false);
    // Critically NO new mesh was constructed during the swap.
    expect(hoisted.meshInstances).toHaveLength(1);
  });

  it("never spins up the MoQ client on a WebRTC-only browser even if every peer reports MoQ support", () => {
    const signaling = makeSignaling();
    const { result } = renderHook(() =>
      useLiveTransport({
        sessionId: "sess-4",
        selfPubkey: "self",
        localStream: null,
        peers: [{ pubkey: "peer1", supportsMoq: true }],
        signaling,
        // Local browser can't speak MoQ regardless of what peers
        // can — Safari/Firefox today.
        selfSupportsMoq: false,
      }),
    );

    expect(result.current.mode).toBe("webrtc");
    expect(result.current.isSupported).toBe(true);
    expect(hoisted.moqInstances).toHaveLength(0);
    expect(hoisted.meshInstances).toHaveLength(1);
  });

  it("refuses to stand up the mesh when WebRTC is needed but signaling is missing — surfaces an error instead of crashing", () => {
    // Regression guard for the explicit `if (!signaling)` branch in
    // the WebRTC effect. Without this gate a future refactor could
    // hand a null signaling adapter to `new WebRtcMesh(...)` and
    // crash on the first `.on(...)` call inside the constructor.
    const { result } = renderHook(() =>
      useLiveTransport({
        sessionId: "sess-no-sig",
        selfPubkey: "self",
        localStream: null,
        peers: [{ pubkey: "safari", supportsMoq: false }],
        signaling: null,
        selfSupportsMoq: true,
      }),
    );

    // Mode still reports "webrtc" — the room demands it — but no
    // mesh is constructed and an error is surfaced for the chrome.
    expect(result.current.mode).toBe("webrtc");
    expect(hoisted.meshInstances).toHaveLength(0);
    expect(result.current.error).toBeTruthy();
    expect(result.current.isConnected).toBe(false);
  });

  it("tears down both transports cleanly on unmount — no leaked clients", () => {
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
      {
        initialProps: { peers: [{ pubkey: "peer1", supportsMoq: true }] },
      },
    );

    // Kick a swap so we exercise both transports in one lifetime.
    act(() => {
      rerender({
        peers: [
          { pubkey: "peer1", supportsMoq: true },
          { pubkey: "safari", supportsMoq: false },
        ],
      });
    });

    expect(hoisted.moqInstances).toHaveLength(1);
    expect(hoisted.meshInstances).toHaveLength(1);
    expect(hoisted.moqInstances[0].closed).toBe(true); // closed by the swap
    expect(hoisted.meshInstances[0].closed).toBe(false);

    unmount();

    // Whatever transport was active when the component went away
    // must end up closed — otherwise refs survive past the React tree.
    expect(hoisted.meshInstances[0].closed).toBe(true);
  });
});
