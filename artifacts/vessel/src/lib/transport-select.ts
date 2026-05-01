/**
 * Capability detection + transport-mode selection for the live A/V layer.
 *
 * The studio runs one of two underlying transports for live audio/video:
 *
 *   - "moq":    WebTransport + WebCodecs path (Chromium-family only).
 *               Higher capacity; scales to larger rooms.
 *   - "webrtc": Peer-to-peer WebRTC mesh (every modern browser).
 *               Mid capacity; comfortable up to ~5 peers, fine at 2–4.
 *
 * Both are peer-to-peer at the data plane — no central server ever sees
 * audio or video — but they have different browser support footprints
 * (WebTransport ships only in Chromium-family browsers today).
 *
 * Selection rule:
 *
 *   1. If the local browser CAN'T do MoQ (no WebTransport or no WebCodecs)
 *      we have no choice — pick "webrtc" if RTCPeerConnection exists,
 *      otherwise "none".
 *   2. If the local browser CAN do MoQ but the room contains at least one
 *      peer who CAN'T (mixed-room), every peer falls back to "webrtc" so
 *      the non-Chromium peer can see and hear everyone. This is the
 *      "every peer publishes via WebRTC mesh in mixed rooms" trade-off
 *      documented in the architecture notes — slightly more bandwidth
 *      for the Chromium peers in exchange for everyone-sees-everyone.
 *   3. If the room is all-MoQ-capable, pick "moq".
 *
 * The selector is a pure function — capability and roster are inputs.
 * Side-effecting probes live in the `is*Available` helpers below.
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
   *  the roster is unknown (still loading, no peers yet) treat as false
   *  so an all-Chromium room takes the higher-capacity path immediately. */
  roomNeedsWebRtc: boolean;
};

export function selectTransport(features: TransportFeatures): TransportMode {
  if (!features.moqAvailable) {
    return features.webRtcAvailable ? "webrtc" : "none";
  }
  // Local browser can do MoQ. If anyone else can't, drop everyone back
  // to the cross-browser path — but only if the local browser is also
  // capable of running it. If somehow it isn't (defensive: every browser
  // shipping WebTransport also has WebRTC) we keep MoQ rather than
  // disconnecting entirely.
  if (features.roomNeedsWebRtc && features.webRtcAvailable) return "webrtc";
  return "moq";
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
