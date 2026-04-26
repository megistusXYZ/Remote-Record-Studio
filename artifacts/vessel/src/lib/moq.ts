/**
 * Live A/V transport for the studio preview.
 *
 * Wire shape (intentionally a small, predictable subset — not the full IETF
 * Media-over-QUIC Transport draft):
 *
 *   - Control: a single client-initiated bidirectional stream carrying
 *     length-prefixed JSON frames. Both sides exchange `setup`, `announce`,
 *     `subscribe`, and `ping` / `pong` here.
 *
 *   - Data: each published track opens its own client-initiated unidirectional
 *     stream. The first frame is a JSON `header` carrying
 *     `{ namespace, kind, codec, init? }`; subsequent frames are length-
 *     prefixed binary OBJECTs (the encoded WebCodecs chunks). Subscribers
 *     read inbound unidirectional streams the same way.
 *
 * This is enough for two Vessel peers to find each other through any relay
 * that simply re-forwards client streams to other clients in the same
 * "session". A draft-conformant MoQ relay (e.g. relay.quic.video) speaks a
 * different OBJECT framing and will not interoperate; that's a known
 * deviation documented in the task notes.
 *
 * UI strings emitted from this module are limited to "Connection quality"
 * labels — never the underlying transport or codec name (the in-app glossary
 * forbids surfacing "MoQ", "WebTransport", "QUIC", "RTT", etc.).
 */

import { useEffect, useState } from "react";

export type ConnectionQuality = "good" | "fair" | "poor" | "unknown";

const HEARTBEAT_INTERVAL_MS = 2000;
const HEARTBEAT_TIMEOUT_MS = 5000;
const QUALITY_RTT_GOOD_MS = 120;
const QUALITY_RTT_FAIR_MS = 350;

export function isWebTransportAvailable(): boolean {
  return typeof window !== "undefined" && "WebTransport" in window;
}

export function isWebCodecsAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    "VideoEncoder" in window &&
    "AudioEncoder" in window &&
    "MediaStreamTrackProcessor" in window &&
    "MediaStreamTrackGenerator" in window
  );
}

export function isLivePreviewSupported(): boolean {
  return isWebTransportAvailable() && isWebCodecsAvailable();
}

export function getConnectionQualityLabel(quality: ConnectionQuality): string {
  switch (quality) {
    case "good":
      return "Connection quality: Good";
    case "fair":
      return "Connection quality: Fair";
    case "poor":
      return "Connection quality: Poor";
    default:
      return "Connection quality: Checking...";
  }
}

function rttToQuality(rttMs: number): ConnectionQuality {
  if (rttMs <= QUALITY_RTT_GOOD_MS) return "good";
  if (rttMs <= QUALITY_RTT_FAIR_MS) return "fair";
  return "poor";
}

/**
 * Back-compat hook used by older callers that don't yet drive a real
 * transport. Falls back to the browser's network-info heuristic. New code
 * should use `useLiveTransport` and read `quality` from there instead.
 */
export function useConnectionQuality(): ConnectionQuality {
  const [quality, setQuality] = useState<ConnectionQuality>("unknown");

  useEffect(() => {
    if (!isWebTransportAvailable()) {
      setQuality("good");
      return;
    }

    const update = () => {
      const conn = (navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number } }).connection;
      if (!conn) {
        setQuality("good");
        return;
      }
      const eff = conn.effectiveType ?? "";
      if (eff === "4g") setQuality("good");
      else if (eff === "3g") setQuality("fair");
      else if (eff === "2g" || eff === "slow-2g") setQuality("poor");
      else setQuality("good");
    };

    update();
    const conn = (navigator as Navigator & { connection?: EventTarget }).connection;
    if (!conn || typeof conn.addEventListener !== "function") return;
    conn.addEventListener("change", update);
    return () => conn.removeEventListener("change", update);
  }, []);

  return quality;
}

// ---------------------------------------------------------------------------
// Wire helpers
// ---------------------------------------------------------------------------

const HEADER_BYTES = 4;

function writeUint32BE(value: number, out: Uint8Array, offset: number): void {
  out[offset] = (value >>> 24) & 0xff;
  out[offset + 1] = (value >>> 16) & 0xff;
  out[offset + 2] = (value >>> 8) & 0xff;
  out[offset + 3] = value & 0xff;
}

function readUint32BE(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset] << 24) >>> 0) |
    (buf[offset + 1] << 16) |
    (buf[offset + 2] << 8) |
    buf[offset + 3]
  );
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Write a length-prefixed binary frame to a writable stream. */
async function writeFrame(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  payload: Uint8Array,
): Promise<void> {
  const header = new Uint8Array(HEADER_BYTES);
  writeUint32BE(payload.byteLength, header, 0);
  // The cast is required because lib.dom now types Uint8Array as
  // Uint8Array<ArrayBuffer>; a typed-array view backed by ArrayBufferLike
  // is the same shape on the wire.
  await writer.write(header as Uint8Array<ArrayBuffer>);
  await writer.write(payload as Uint8Array<ArrayBuffer>);
}

/** Write a JSON frame (length-prefixed UTF-8). */
async function writeJsonFrame(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  obj: unknown,
): Promise<void> {
  await writeFrame(writer, textEncoder.encode(JSON.stringify(obj)));
}

/**
 * Pull length-prefixed frames off a readable byte stream and yield the
 * payloads. Stops when the stream closes. Buffer growth is bounded by the
 * sender — callers should not feed adversarial peers without a max-frame
 * guard above this layer.
 */
async function* readFrames(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<Uint8Array, void, unknown> {
  let buffer: Uint8Array = new Uint8Array(0);
  try {
    while (true) {
      // First, satisfy the 4-byte length header.
      while (buffer.byteLength < HEADER_BYTES) {
        const { value, done } = await reader.read();
        if (done) return;
        if (!value) continue;
        buffer = concat(buffer, value);
      }
      const len = readUint32BE(buffer, 0);
      const total = HEADER_BYTES + len;
      while (buffer.byteLength < total) {
        const { value, done } = await reader.read();
        if (done) return;
        if (!value) continue;
        buffer = concat(buffer, value);
      }
      const payload = buffer.slice(HEADER_BYTES, total);
      buffer = buffer.slice(total);
      yield payload;
    }
  } finally {
    // If a downstream consumer calls `.return()` (or throws), make sure we
    // don't leave a pending reader.read() parked forever.
    try {
      await reader.cancel();
    } catch {
      // ignore — stream may already be closed.
    }
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  // Always allocate a fresh ArrayBuffer-backed view so the return type stays
  // strict and assignable everywhere `Uint8Array<ArrayBuffer>` is expected.
  const out = new Uint8Array(a.byteLength + b.byteLength);
  if (a.byteLength) out.set(a, 0);
  if (b.byteLength) out.set(b, a.byteLength);
  return out;
}

// ---------------------------------------------------------------------------
// Inbound track types — what subscribers see
// ---------------------------------------------------------------------------

export type TrackHeader = {
  namespace: string;
  kind: "video" | "audio";
  /** WebCodecs codec string, e.g. "vp8", "opus". */
  codec: string;
  /** Optional codec init / config payload base64-encoded (audio mostly). */
  initBase64?: string;
  /** Encoder-reported sample rate / channel count (audio). */
  sampleRate?: number;
  numberOfChannels?: number;
  /** Encoder-reported width / height (video). */
  width?: number;
  height?: number;
  /** Which capture source produced the track. Optional for backward
   *  compatibility — receivers that see this missing or unknown should
   *  treat the track as the legacy default ("camera"). */
  source?: "camera" | "screen";
};

export type ObjectFrame = {
  /** True iff this is a key frame (decoder can resync here). */
  key: boolean;
  /** Microsecond timestamp from the encoder. */
  timestampUs: number;
  /** Encoded payload bytes. */
  data: Uint8Array;
};

export type IncomingTrack = {
  header: TrackHeader;
  /** Async iterator of decoded objects. Completes when the publisher closes. */
  objects: AsyncGenerator<ObjectFrame, void, unknown>;
};

export type MoqClientEvent =
  | { type: "connected" }
  | { type: "disconnected"; error?: string }
  | { type: "quality"; quality: ConnectionQuality; rttMs: number | null }
  | { type: "track"; track: IncomingTrack };

type Listener = (ev: MoqClientEvent) => void;

// ---------------------------------------------------------------------------
// MoqClient
// ---------------------------------------------------------------------------

type WebTransportCtor = new (
  url: string,
  options?: { allowPooling?: boolean },
) => WebTransport;

function getWebTransport(): WebTransportCtor | null {
  if (!isWebTransportAvailable()) return null;
  return (window as unknown as { WebTransport: WebTransportCtor }).WebTransport;
}

export class MoqClient {
  private transport: WebTransport | null = null;
  private listeners = new Set<Listener>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pendingPings = new Map<number, { sentAt: number }>();
  private nextPingId = 1;
  private lastQuality: ConnectionQuality = "unknown";
  private controlWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private closed = false;

  constructor(private readonly url: string, private readonly sessionId: string) {}

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(ev: MoqClientEvent): void {
    for (const l of this.listeners) {
      try {
        l(ev);
      } catch (err) {
        console.error("MoqClient listener threw", err);
      }
    }
  }

  /**
   * Real one-shot probe: open a WebTransport against `url`, await `.ready`,
   * close immediately. Returns within `timeoutMs` either way. Used by
   * Settings paste-and-test.
   */
  static async probe(
    url: string,
    signal?: AbortSignal,
    timeoutMs = 4000,
  ): Promise<{ ok: true; latencyMs: number } | { ok: false; reason: string }> {
    const Ctor = getWebTransport();
    if (!Ctor) return { ok: false, reason: "Live preview is not supported in this browser." };
    if (!url || !url.startsWith("https://")) {
      return { ok: false, reason: "Enter an https:// URL." };
    }
    let wt: WebTransport | null = null;
    const start = performance.now();
    try {
      wt = new Ctor(url);
      await Promise.race([
        wt.ready,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Timed out reaching the relay.")), timeoutMs),
        ),
        new Promise<never>((_, reject) => {
          if (!signal) return;
          if (signal.aborted) reject(new Error("Cancelled."));
          signal.addEventListener("abort", () => reject(new Error("Cancelled.")));
        }),
      ]);
      const latencyMs = Math.round(performance.now() - start);
      try {
        wt.close();
      } catch {
        // ignore
      }
      return { ok: true, latencyMs };
    } catch (err) {
      try {
        wt?.close();
      } catch {
        // ignore
      }
      const reason =
        err instanceof Error ? err.message : "Couldn't reach the relay.";
      return { ok: false, reason };
    }
  }

  /**
   * Open the WebTransport session and the control stream. Resolves once the
   * setup handshake has been written; tracks become available via the
   * `track` event as remote peers publish.
   */
  async connect(): Promise<void> {
    const Ctor = getWebTransport();
    if (!Ctor) throw new Error("Live preview is not supported in this browser.");
    const wt = new Ctor(this.url);
    this.transport = wt;
    await wt.ready;

    // Open the control bidi stream.
    const control = await wt.createBidirectionalStream();
    const writer = control.writable.getWriter();
    this.controlWriter = writer;
    await writeJsonFrame(writer, {
      type: "setup",
      session: this.sessionId,
      version: 1,
    });

    void this.readControl(control.readable.getReader());
    void this.readIncomingTracks(wt);
    void this.watchClosed(wt);

    this.emit({ type: "connected" });
    this.startHeartbeat();
  }

  private async watchClosed(wt: WebTransport): Promise<void> {
    try {
      await wt.closed;
      if (this.closed) return;
      this.handleDisconnect();
    } catch (err) {
      if (this.closed) return;
      const msg = err instanceof Error ? err.message : "Connection lost.";
      this.handleDisconnect(msg);
    }
  }

  private handleDisconnect(error?: string): void {
    if (this.closed) return;
    this.closed = true;
    this.stopHeartbeat();
    this.emit({ type: "disconnected", error });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      void this.sendPing();
    }, HEARTBEAT_INTERVAL_MS);
    // Send an immediate first ping so quality settles fast.
    void this.sendPing();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.pendingPings.clear();
  }

  private async sendPing(): Promise<void> {
    const writer = this.controlWriter;
    if (!writer) return;
    const id = this.nextPingId++;
    this.pendingPings.set(id, { sentAt: performance.now() });
    setTimeout(() => {
      const p = this.pendingPings.get(id);
      if (!p) return;
      this.pendingPings.delete(id);
      // No reply within the window — degrade quality to poor.
      this.publishQuality(QUALITY_RTT_FAIR_MS + 1, true);
    }, HEARTBEAT_TIMEOUT_MS);
    try {
      await writeJsonFrame(writer, { type: "ping", id });
    } catch {
      this.pendingPings.delete(id);
    }
  }

  private publishQuality(rttMs: number | null, force = false): void {
    const next = rttMs == null ? "unknown" : rttToQuality(rttMs);
    if (!force && next === this.lastQuality) return;
    this.lastQuality = next;
    this.emit({ type: "quality", quality: next, rttMs });
  }

  private async readControl(
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): Promise<void> {
    try {
      for await (const frame of readFrames(reader)) {
        let msg: { type: string; id?: number };
        try {
          msg = JSON.parse(textDecoder.decode(frame));
        } catch {
          continue;
        }
        if (msg.type === "pong" && typeof msg.id === "number") {
          const p = this.pendingPings.get(msg.id);
          if (!p) continue;
          this.pendingPings.delete(msg.id);
          const rtt = performance.now() - p.sentAt;
          this.publishQuality(rtt);
        } else if (msg.type === "ping" && typeof msg.id === "number") {
          // Some relays echo control frames between peers; reply so the
          // other side can measure RTT against us too.
          const writer = this.controlWriter;
          if (writer) {
            await writeJsonFrame(writer, { type: "pong", id: msg.id }).catch(() => {});
          }
        }
      }
    } catch {
      // Reader cancelled / transport closed; handled by watchClosed.
    }
  }

  private async readIncomingTracks(wt: WebTransport): Promise<void> {
    try {
      const reader = wt.incomingUnidirectionalStreams.getReader();
      while (true) {
        const { value: stream, done } = await reader.read();
        if (done) return;
        if (!stream) continue;
        void this.consumeTrackStream(stream);
      }
    } catch {
      // Transport closed.
    }
  }

  private async consumeTrackStream(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    const frames = readFrames(reader);
    // First frame must be the JSON header.
    let header: TrackHeader | null = null;
    try {
      const first = await frames.next();
      if (first.done) {
        await frames.return?.(undefined).catch(() => {});
        return;
      }
      try {
        header = JSON.parse(textDecoder.decode(first.value)) as TrackHeader;
      } catch {
        header = null;
      }
      if (
        !header ||
        typeof header.namespace !== "string" ||
        (header.kind !== "video" && header.kind !== "audio")
      ) {
        await frames.return?.(undefined).catch(() => {});
        return;
      }
    } catch {
      await frames.return?.(undefined).catch(() => {});
      return;
    }

    const objects = (async function* (): AsyncGenerator<ObjectFrame, void, unknown> {
      try {
        for await (const payload of frames) {
          // OBJECT layout: 1 byte flags (bit0=key) + 8 bytes BE timestamp_us + data.
          if (payload.byteLength < 9) continue;
          const key = (payload[0] & 1) === 1;
          let ts = 0;
          for (let i = 1; i <= 8; i++) {
            ts = ts * 256 + payload[i];
          }
          yield { key, timestampUs: ts, data: payload.slice(9) };
        }
      } finally {
        // Propagate cancellation upstream so the underlying reader.read()
        // doesn't park forever when the consumer (decodeTrack.stop) exits.
        await frames.return?.(undefined).catch(() => {});
      }
    })();

    this.emit({ type: "track", track: { header, objects } });
  }

  /**
   * Open a publish stream for `header`. Caller writes encoded chunks via the
   * returned `publish(chunk)` helper; calling `close()` ends the track.
   */
  async openPublishTrack(header: TrackHeader): Promise<{
    publish: (frame: ObjectFrame) => Promise<void>;
    close: () => Promise<void>;
  }> {
    const wt = this.transport;
    if (!wt) throw new Error("Not connected.");
    const stream = await wt.createUnidirectionalStream();
    const writer = stream.getWriter();
    await writeJsonFrame(writer, header);

    let alive = true;
    return {
      publish: async (frame: ObjectFrame) => {
        if (!alive) return;
        const out = new Uint8Array(9 + frame.data.byteLength);
        out[0] = frame.key ? 1 : 0;
        let ts = Math.max(0, Math.floor(frame.timestampUs));
        for (let i = 8; i >= 1; i--) {
          out[i] = ts & 0xff;
          ts = Math.floor(ts / 256);
        }
        out.set(frame.data, 9);
        try {
          await writeFrame(writer, out);
        } catch {
          alive = false;
        }
      },
      close: async () => {
        alive = false;
        try {
          await writer.close();
        } catch {
          // ignore
        }
      },
    };
  }

  close(): void {
    this.handleDisconnect();
    try {
      this.controlWriter?.close().catch(() => {});
    } catch {
      // ignore
    }
    this.controlWriter = null;
    try {
      this.transport?.close();
    } catch {
      // ignore
    }
    this.transport = null;
  }
}

// ---------------------------------------------------------------------------
// Back-compat factory used by older imports
// ---------------------------------------------------------------------------

export type MoQTransport = {
  send: (data: ArrayBuffer | Uint8Array) => Promise<void>;
  close: () => void;
  isConnected: boolean;
};

/**
 * Back-compat: older call sites used a tiny `connectMoQ(url)` factory that
 * returned a featureless transport handle. New code should construct
 * `MoqClient` directly. Kept so existing imports don't break — now backed
 * by a real WebTransport connection so `isConnected` reflects reality.
 */
export async function connectMoQ(url: string): Promise<MoQTransport | null> {
  const Ctor = getWebTransport();
  if (!Ctor) return null;
  if (!url || !url.startsWith("https://")) return null;
  try {
    const wt = new Ctor(url);
    await wt.ready;
    let connected = true;
    void wt.closed.finally(() => {
      connected = false;
    });
    return {
      send: async (_data) => {
        // No application-level framing here; callers wanting real publish/
        // subscribe should use MoqClient. This shim exists only for the
        // legacy "is the relay reachable?" check.
      },
      close: () => {
        connected = false;
        try {
          wt.close();
        } catch {
          // ignore
        }
      },
      get isConnected() {
        return connected;
      },
    };
  } catch {
    return null;
  }
}
