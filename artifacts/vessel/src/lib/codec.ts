/**
 * WebCodecs encode / decode pipelines used by the live preview transport.
 *
 * These wrappers intentionally only know how to:
 *   - Encode a MediaStream's video + audio tracks into encoded chunks and
 *     hand them to a publish callback (one publish handle per kind).
 *   - Decode incoming OBJECT frames into VideoFrames / AudioData and write
 *     them to a MediaStreamTrackGenerator so they can be rendered with a
 *     plain <video> element.
 *
 * They have no awareness of the wire format itself — that's lib/moq.ts.
 *
 * Browser support note: MediaStreamTrackProcessor / MediaStreamTrackGenerator
 * and the WebCodecs encoder/decoder pair currently ship in Chromium-family
 * browsers. The caller is expected to gate construction on
 * `isLivePreviewSupported()` from lib/moq.ts.
 *
 * UI strings emitted from this module: none. The live-preview banner copy
 * lives in StudioScreen and references "live preview", never the underlying
 * codec / API names.
 */

import type { ObjectFrame, TrackHeader } from "./moq";

const VIDEO_CODEC = "vp8";
const VIDEO_BITRATE = 1_500_000;
const VIDEO_KEY_FRAME_INTERVAL = 60; // ~once per 2s at 30fps
const AUDIO_CODEC = "opus";
const AUDIO_BITRATE = 64_000;

// MediaStreamTrackProcessor / MediaStreamTrackGenerator are not yet in the
// stock TS DOM lib (Chromium-only at the moment). We narrow them to the
// exact surface this file uses so we can avoid leaking `any` into callers.
interface MediaStreamTrackProcessorCtor {
  new (init: { track: MediaStreamTrack }): {
    readable: ReadableStream<VideoFrame | AudioData>;
  };
}
interface MediaStreamTrackGeneratorCtor {
  new (init: { kind: "video" | "audio" }): MediaStreamTrack & {
    writable: WritableStream<VideoFrame | AudioData>;
  };
}

type WebCodecsApi = {
  VideoEncoder: typeof VideoEncoder;
  VideoDecoder: typeof VideoDecoder;
  AudioEncoder: typeof AudioEncoder;
  AudioDecoder: typeof AudioDecoder;
  EncodedVideoChunk: typeof EncodedVideoChunk;
  EncodedAudioChunk: typeof EncodedAudioChunk;
  MediaStreamTrackProcessor: MediaStreamTrackProcessorCtor;
  MediaStreamTrackGenerator: MediaStreamTrackGeneratorCtor;
};

function api(): WebCodecsApi {
  const w = window as unknown as Partial<WebCodecsApi>;
  if (
    !w.VideoEncoder ||
    !w.VideoDecoder ||
    !w.AudioEncoder ||
    !w.AudioDecoder ||
    !w.EncodedVideoChunk ||
    !w.EncodedAudioChunk ||
    !w.MediaStreamTrackProcessor ||
    !w.MediaStreamTrackGenerator
  ) {
    throw new Error("Live preview not supported in this browser.");
  }
  return w as WebCodecsApi;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// Publish (encode)
// ---------------------------------------------------------------------------

export type PublishHandle = {
  publish: (frame: ObjectFrame) => Promise<void>;
  close: () => Promise<void>;
};

export type StartPublish = (header: TrackHeader) => Promise<PublishHandle>;

export type PublisherHandle = {
  /** Stop encoders and close all open tracks. Idempotent. */
  stop: () => Promise<void>;
};

/**
 * Encode every video + audio track of `stream` and stream the encoded chunks
 * via `startPublish`. Returns a handle that tears the encoders down.
 */
export async function publishStream(
  stream: MediaStream,
  namespace: string,
  startPublish: StartPublish,
): Promise<PublisherHandle> {
  const w = api();
  const handles: PublishHandle[] = [];
  const cleanup: Array<() => void> = [];
  let stopped = false;

  for (const track of stream.getVideoTracks()) {
    const settings = track.getSettings?.() ?? {};
    const header: TrackHeader = {
      namespace,
      kind: "video",
      codec: VIDEO_CODEC,
      width: settings.width,
      height: settings.height,
    };
    const handle = await startPublish(header);
    handles.push(handle);

    let frameCount = 0;
    const encoder = new w.VideoEncoder({
      output: (chunk) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        void handle.publish({
          key: chunk.type === "key",
          timestampUs: chunk.timestamp,
          data,
        });
      },
      error: (err) => {
        console.warn("Video encoder error", err);
      },
    });
    encoder.configure({
      codec: VIDEO_CODEC,
      width: settings.width ?? 1280,
      height: settings.height ?? 720,
      bitrate: VIDEO_BITRATE,
      framerate: 30,
      latencyMode: "realtime",
    });

    const processor = new w.MediaStreamTrackProcessor({ track });
    const reader = processor.readable.getReader() as ReadableStreamDefaultReader<VideoFrame>;
    cleanup.push(() => {
      try {
        reader.cancel().catch(() => {});
      } catch {
        // ignore
      }
    });
    void (async () => {
      try {
        while (!stopped) {
          const { value: frame, done } = await reader.read();
          if (done || !frame) break;
          if (encoder.state === "closed") {
            frame.close();
            break;
          }
          const isKey = frameCount % VIDEO_KEY_FRAME_INTERVAL === 0;
          encoder.encode(frame, { keyFrame: isKey });
          frame.close();
          frameCount++;
        }
      } finally {
        try {
          encoder.close();
        } catch {
          // ignore
        }
        await handle.close().catch(() => {});
      }
    })();
  }

  for (const track of stream.getAudioTracks()) {
    const settings = track.getSettings?.() ?? {};
    const sampleRate = settings.sampleRate ?? 48000;
    const numberOfChannels = settings.channelCount ?? 1;
    const header: TrackHeader = {
      namespace,
      kind: "audio",
      codec: AUDIO_CODEC,
      sampleRate,
      numberOfChannels,
    };
    const handle = await startPublish(header);
    handles.push(handle);

    const encoder = new w.AudioEncoder({
      output: (chunk) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        void handle.publish({
          key: chunk.type === "key",
          timestampUs: chunk.timestamp,
          data,
        });
      },
      error: (err) => {
        console.warn("Audio encoder error", err);
      },
    });
    encoder.configure({
      codec: AUDIO_CODEC,
      sampleRate,
      numberOfChannels,
      bitrate: AUDIO_BITRATE,
    });

    const processor = new w.MediaStreamTrackProcessor({ track });
    const reader = processor.readable.getReader() as ReadableStreamDefaultReader<AudioData>;
    cleanup.push(() => {
      try {
        reader.cancel().catch(() => {});
      } catch {
        // ignore
      }
    });
    void (async () => {
      try {
        while (!stopped) {
          const { value: data, done } = await reader.read();
          if (done || !data) break;
          if (encoder.state === "closed") {
            data.close();
            break;
          }
          encoder.encode(data);
          data.close();
        }
      } finally {
        try {
          encoder.close();
        } catch {
          // ignore
        }
        await handle.close().catch(() => {});
      }
    })();
  }

  return {
    stop: async () => {
      if (stopped) return;
      stopped = true;
      for (const c of cleanup) c();
      await Promise.allSettled(handles.map((h) => h.close()));
    },
  };
}

// ---------------------------------------------------------------------------
// Subscribe (decode)
// ---------------------------------------------------------------------------

export type DecodedTrack = {
  /** A MediaStreamTrack the caller can drop into a MediaStream. */
  track: MediaStreamTrack;
  kind: "video" | "audio";
  /** Stop decoding and close the generator. Idempotent. */
  stop: () => void;
};

export type DecodeTrackOptions = {
  /** Fires once after the first decoded frame / sample has been written.
   *  Lets the caller flip the per-tile "Connecting..." state only when
   *  media is actually flowing — not just when the header arrived. */
  onFirstFrame?: () => void;
};

/**
 * Decode every OBJECT frame from `objects` into the appropriate WebCodecs
 * decoder and pipe the frames into a fresh MediaStreamTrackGenerator. The
 * returned `track` can be added to a MediaStream and rendered in <video>.
 *
 * Lifecycle: `stop()` closes the decoder + the writable side and asks the
 * upstream `objects` generator to return — which propagates a cancel down
 * into the underlying stream reader so we don't leave any pending
 * `await reader.read()` parked indefinitely.
 */
export function decodeTrack(
  header: TrackHeader,
  objects: AsyncGenerator<ObjectFrame, void, unknown>,
  options: DecodeTrackOptions = {},
): DecodedTrack {
  const w = api();
  if (header.kind === "video") {
    const generator = new w.MediaStreamTrackGenerator({ kind: "video" });
    const writer = generator.writable.getWriter();
    let stopped = false;
    let firstFrameSent = false;

    const decoder = new w.VideoDecoder({
      output: (frame) => {
        if (stopped) {
          frame.close();
          return;
        }
        writer.write(frame).then(
          () => {
            if (!firstFrameSent) {
              firstFrameSent = true;
              try {
                options.onFirstFrame?.();
              } catch (err) {
                console.warn("onFirstFrame callback threw", err);
              }
            }
          },
          () => {
            // writer rejected; nothing to clean up — the frame was
            // transferred into the writer's queue.
          },
        );
      },
      error: (err) => {
        console.warn("Video decoder error", err);
      },
    });
    decoder.configure({
      codec: header.codec || VIDEO_CODEC,
      codedWidth: header.width,
      codedHeight: header.height,
      optimizeForLatency: true,
    });

    void (async () => {
      try {
        for await (const obj of objects) {
          if (stopped) break;
          if (decoder.state === "closed") break;
          const chunk = new w.EncodedVideoChunk({
            type: obj.key ? "key" : "delta",
            timestamp: obj.timestampUs,
            data: obj.data,
          });
          try {
            decoder.decode(chunk);
          } catch (err) {
            console.warn("Video decode failed", err);
          }
        }
      } finally {
        try {
          decoder.close();
        } catch {
          // ignore
        }
        try {
          await writer.close();
        } catch {
          // ignore
        }
      }
    })();

    return {
      track: generator,
      kind: "video",
      stop: () => {
        if (stopped) return;
        stopped = true;
        // Tell the upstream async generator we're done. This lets readFrames
        // run its `finally` block which cancels the underlying reader.
        objects.return?.(undefined).catch(() => {});
        try {
          decoder.close();
        } catch {
          // ignore
        }
        writer.close().catch(() => {});
      },
    };
  }

  // audio
  const generator = new w.MediaStreamTrackGenerator({ kind: "audio" });
  const writer = generator.writable.getWriter();
  let stopped = false;
  let firstSampleSent = false;

  const decoder = new w.AudioDecoder({
    output: (data) => {
      if (stopped) {
        data.close();
        return;
      }
      writer.write(data).then(
        () => {
          if (!firstSampleSent) {
            firstSampleSent = true;
            try {
              options.onFirstFrame?.();
            } catch (err) {
              console.warn("onFirstFrame callback threw", err);
            }
          }
        },
        () => {
          // see video branch above
        },
      );
    },
    error: (err) => {
      console.warn("Audio decoder error", err);
    },
  });
  decoder.configure({
    codec: header.codec || AUDIO_CODEC,
    sampleRate: header.sampleRate ?? 48000,
    numberOfChannels: header.numberOfChannels ?? 1,
    description: header.initBase64 ? base64ToUint8(header.initBase64) : undefined,
  });

  void (async () => {
    try {
      for await (const obj of objects) {
        if (stopped) break;
        if (decoder.state === "closed") break;
        const chunk = new w.EncodedAudioChunk({
          type: obj.key ? "key" : "delta",
          timestamp: obj.timestampUs,
          data: obj.data,
        });
        try {
          decoder.decode(chunk);
        } catch (err) {
          console.warn("Audio decode failed", err);
        }
      }
    } finally {
      try {
        decoder.close();
      } catch {
        // ignore
      }
      try {
        await writer.close();
      } catch {
        // ignore
      }
    }
  })();

  return {
    track: generator,
    kind: "audio",
    stop: () => {
      if (stopped) return;
      stopped = true;
      objects.return?.(undefined).catch(() => {});
      try {
        decoder.close();
      } catch {
        // ignore
      }
      writer.close().catch(() => {});
    },
  };
}

// Exported so callers can refer to symmetrically without importing the
// constant in two places (unused currently, kept for future codec-pref UI).
export const livePreviewCodecs = {
  video: VIDEO_CODEC,
  audio: AUDIO_CODEC,
} as const;

// Avoid "unused import" lint by referencing the helper. base64 path is only
// used for audio config in some encoders; keep it exported so future code
// (e.g. AAC) can plug in without re-implementation.
export { uint8ToBase64 };
