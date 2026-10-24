/**
 * Capability detection + transport-mode selection for the live A/V layer.
 *
 * The studio runs one of two underlying transports for live audio/video:
 *
 *   - "webrtc": Peer-to-peer WebRTC mesh (every modern browser, including
 *               Safari and iPhone). The default. Comfortable up to ~5 peers.
 *   - "moq":    WebTransport + WebCodecs path through a relay the operator
 *               runs. Higher capacity; Chromium-family only. Opt-in.
 *
 * Both are peer-to-peer at the data plane — no central server ever sees
 * audio or video — but they have different browser support footprints
 * (WebTransport is disabled on every WebKit browser today) and the MoQ
 * path needs a relay that speaks Vessel's framing. No public relay does,
 * so without an explicitly configured and reachable relay the choice is
 * always the mesh.
 *
 * Selection rule:
 *
 *   1. "moq" only when ALL of: the local browser can do it, a relay is
 *      configured, that relay answered a probe, and every other peer in
 *      the room can do it too.
 *   2. Otherwise "webrtc" if RTCPeerConnection exists.
 *   3. Otherwise "none".
 *
 * The selector is a pure function — capability and roster are inputs.
 * Side-effecting probes live in the `is*Available` helpers and the hook.
 *
 * No UI strings live in this module. The studio chrome never names the
 * underlying transport; user-visible copy stays in plain language
 * ("live video", "this room", "connection").
 */

import { isLivePreviewSupported } from "./moq";

export type TransportMode = "moq" | "webrtc" | "none";

export type TransportFeatures = {
  /** Whether the local browser supports the MoQ stack
   *  (WebTransport + WebCodecs + MediaStreamTrackGenerator). */
  moqAvailable: boolean;
  /** Whether the local browser supports RTCPeerConnection. */
  webRtcAvailable: boolean;
  /** Whether at least one OTHER peer in the room can't speak MoQ. When
   *  the roster is unknown (still loading, no peers yet) treat as false. */
  roomNeedsWebRtc: boolean;
  /** A relay URL is explicitly configured (not a shipped default). */
  relayConfigured?: boolean;
  /** The configured relay answered a connection probe. */
  relayReady?: boolean;
};

export function selectTransport(features: TransportFeatures): TransportMode {
  const moqPossible =
    features.moqAvailable &&
    features.relayConfigured === true &&
    features.relayReady === true &&
    !features.roomNeedsWebRtc;
  if (moqPossible) return "moq";
  if (features.webRtcAvailable) return "webrtc";
  // Defensive: a browser with WebTransport but no RTCPeerConnection does
  // not exist in practice. Prefer keeping the Chromium peers on MoQ to
  // disconnecting entirely, provided a relay is actually usable.
  if (features.moqAvailable && features.relayConfigured && features.relayReady)
    return "moq";
  return "none";
}

/** Capability probe — does this browser have RTCPeerConnection? */
export function isWebRtcAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as { RTCPeerConnection?: unknown })
      .RTCPeerConnection !== "undefined"
  );
}

/** Re-exported for symmetry with `isWebRtcAvailable()` callers; the
 *  canonical implementation lives in lib/moq.ts. */
export { isLivePreviewSupported as isMoqAvailable };
