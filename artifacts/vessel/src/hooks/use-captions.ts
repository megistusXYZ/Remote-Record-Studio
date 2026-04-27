import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Live, on-device captions for the local user.
 *
 * Each device transcribes its OWN microphone audio with a local speech-to-text
 * model running in a dedicated worker thread. Fragments are emitted via the
 * `onFragment` callback so the studio can broadcast them to peers over the
 * room signaling channel; nothing about this hook reaches out to a remote
 * server. The studio decides when to enable the hook (after consent) and what
 * to do with each fragment.
 *
 * Capture pipeline:
 *   1. Pull the audio track from the local stream.
 *   2. Tap it with an AudioContext, downsample to 16 kHz mono.
 *   3. Buffer into ~5 s windows.
 *   4. Hand each window to the worker; receive a text fragment back.
 *
 * The hook is fully no-op until `enabled` flips true, and gracefully tears
 * everything down again on disable / unmount. A failed model load surfaces
 * via `status === "error"` plus a developer-facing `errorMessage`.
 */

export type CaptionsStatus = "off" | "loading" | "ready" | "running" | "error";

export type CaptionFragment = {
  text: string;
  startMs: number;
  endMs: number;
};

export type UseCaptionsArgs = {
  /** Master enable. When false the worker is shut down and the audio tap
   *  is detached. Toggling this is the single entry point for "captions
   *  on / off" — there's no other lifecycle method. */
  enabled: boolean;
  /** The local user's MediaStream. Audio is read from the first audio
   *  track. When null the hook idles even if `enabled` is true. */
  localStream: MediaStream | null;
  /** Called whenever the worker emits a fragment. Wired up by the studio
   *  so the fragment can be published to peers and appended to the local
   *  transcript view. */
  onFragment?: (fragment: CaptionFragment) => void;
  /** BCP-47 language hint passed to the model. Null lets the model
   *  auto-detect (only meaningful for multilingual model IDs). */
  language?: string | null;
};

export type UseCaptionsResult = {
  status: CaptionsStatus;
  /** 0..100 download progress while the model is being fetched.
   *  Only meaningful when `status === "loading"`. */
  loadProgress: number;
  /** Latest error from the worker, surfaced for debugging / toast copy. */
  errorMessage: string | null;
};

/** Target sample rate for the speech-to-text model. */
const TARGET_SAMPLE_RATE = 16_000;
/** How many seconds of audio to feed the model at once. Larger windows
 *  mean fewer (but slower) inference passes; 5 s is a reasonable
 *  trade-off between latency and accuracy for the tiny model. */
const WINDOW_SECONDS = 5;
/** Don't run inference unless the window has at least this much speech-y
 *  energy. Skipping silent windows keeps the worker idle when nobody is
 *  talking, dramatically reducing CPU and battery use. */
const SILENCE_RMS_THRESHOLD = 0.012;

/** Cheap linear-interpolation downsample. The speech model expects 16 kHz
 *  mono; the AudioContext usually runs at 48 kHz so we always need to
 *  resample. Linear is far from ideal acoustically but is good enough for
 *  recognition (the model is trained on 16 kHz inputs and is tolerant of
 *  modest aliasing at this band). */
function downsampleTo16k(input: Float32Array, sourceRate: number): Float32Array {
  if (sourceRate === TARGET_SAMPLE_RATE) return input.slice(0);
  const ratio = sourceRate / TARGET_SAMPLE_RATE;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIndex = i * ratio;
    const i0 = Math.floor(srcIndex);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = srcIndex - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

export function useCaptions({
  enabled,
  localStream,
  onFragment,
  language = null,
}: UseCaptionsArgs): UseCaptionsResult {
  const [status, setStatus] = useState<CaptionsStatus>("off");
  const [loadProgress, setLoadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onFragmentRef = useRef(onFragment);
  useEffect(() => {
    onFragmentRef.current = onFragment;
  }, [onFragment]);
  const languageRef = useRef(language);
  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  // Refs for the imperative audio plumbing — they live across renders so
  // toggling React state doesn't tear down and re-create the AudioContext.
  const workerRef = useRef<Worker | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  // Using ScriptProcessorNode rather than AudioWorklet to avoid shipping
  // a separate worklet bundle — it's deprecated but still universally
  // supported and the latency cost is acceptable for a 5-second window.
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sinkRef = useRef<GainNode | null>(null);
  const bufferRef = useRef<Float32Array[]>([]);
  const bufferLengthRef = useRef(0);
  const windowStartMsRef = useRef<number | null>(null);

  const resetBuffer = useCallback(() => {
    bufferRef.current = [];
    bufferLengthRef.current = 0;
    windowStartMsRef.current = null;
  }, []);

  const teardown = useCallback(() => {
    try {
      processorRef.current?.disconnect();
    } catch {
      // ignore
    }
    try {
      sinkRef.current?.disconnect();
    } catch {
      // ignore
    }
    try {
      sourceRef.current?.disconnect();
    } catch {
      // ignore
    }
    try {
      void audioCtxRef.current?.close();
    } catch {
      // ignore
    }
    try {
      workerRef.current?.postMessage({ type: "shutdown" });
    } catch {
      // ignore
    }
    try {
      workerRef.current?.terminate();
    } catch {
      // ignore
    }
    workerRef.current = null;
    audioCtxRef.current = null;
    sourceRef.current = null;
    processorRef.current = null;
    sinkRef.current = null;
    resetBuffer();
  }, [resetBuffer]);

  useEffect(() => {
    if (!enabled || !localStream) {
      teardown();
      setStatus("off");
      setLoadProgress(0);
      return;
    }
    const audioTracks = localStream.getAudioTracks();
    if (audioTracks.length === 0) {
      teardown();
      setStatus("off");
      return;
    }

    let cancelled = false;

    // ── Spawn worker ──
    let worker: Worker;
    try {
      worker = new Worker(
        new URL("../workers/captions-worker.ts", import.meta.url),
        { type: "module" },
      );
    } catch (err) {
      console.warn("[captions] failed to spawn worker", err);
      setStatus("error");
      setErrorMessage("Captions engine isn't available in this browser.");
      return;
    }
    workerRef.current = worker;

    worker.addEventListener("message", (event: MessageEvent) => {
      if (cancelled) return;
      const data = event.data as
        | { type: "status"; status: CaptionsStatus; progress?: number; message?: string }
        | { type: "fragment"; jobId: string; text: string; startMs: number; endMs: number }
        | undefined;
      if (!data || typeof data !== "object") return;
      if (data.type === "status") {
        setStatus(data.status);
        if (typeof data.progress === "number") setLoadProgress(data.progress);
        setErrorMessage(data.message ?? null);
      } else if (data.type === "fragment") {
        const trimmed = data.text.trim();
        if (!trimmed) return;
        onFragmentRef.current?.({
          text: trimmed,
          startMs: data.startMs,
          endMs: data.endMs,
        });
      }
    });
    worker.addEventListener("error", (ev) => {
      console.warn("[captions] worker error", ev.message);
      setStatus("error");
      setErrorMessage(ev.message || "Captions engine crashed.");
    });

    // Kick off the model load right away so the user gets feedback.
    worker.postMessage({ type: "init" });

    // ── Audio capture ──
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) {
      teardown();
      setStatus("error");
      setErrorMessage("This browser doesn't support live audio capture.");
      return;
    }
    let ctx: AudioContext;
    try {
      ctx = new AudioCtx();
    } catch {
      teardown();
      setStatus("error");
      setErrorMessage("Couldn't open the audio analyser.");
      return;
    }
    audioCtxRef.current = ctx;

    let source: MediaStreamAudioSourceNode;
    let processor: ScriptProcessorNode;
    let sink: GainNode;
    try {
      source = ctx.createMediaStreamSource(localStream);
      // Buffer size 4096 ≈ 85 ms at 48 kHz — tight enough for the windowing
      // loop and large enough not to thrash the audio thread.
      processor = ctx.createScriptProcessor(4096, 1, 1);
      // A muted sink keeps the processor "running" without playing
      // captured audio back through the speakers. Connecting straight
      // to ctx.destination would echo the user's voice.
      sink = ctx.createGain();
      sink.gain.value = 0;
      source.connect(processor);
      processor.connect(sink);
      sink.connect(ctx.destination);
    } catch (err) {
      console.warn("[captions] failed to wire audio graph", err);
      teardown();
      setStatus("error");
      setErrorMessage("Couldn't tap the microphone for captions.");
      return;
    }
    sourceRef.current = source;
    processorRef.current = processor;
    sinkRef.current = sink;

    const sourceRate = ctx.sampleRate;
    const samplesPerWindow = Math.floor(WINDOW_SECONDS * sourceRate);

    processor.onaudioprocess = (audioEvent: AudioProcessingEvent) => {
      if (cancelled) return;
      const channel = audioEvent.inputBuffer.getChannelData(0);
      // Copy out — the underlying ArrayBuffer is recycled by the audio
      // thread on the next callback.
      const copy = new Float32Array(channel.length);
      copy.set(channel);
      bufferRef.current.push(copy);
      bufferLengthRef.current += copy.length;
      if (windowStartMsRef.current === null) {
        windowStartMsRef.current = Date.now();
      }
      if (bufferLengthRef.current < samplesPerWindow) return;

      // Concatenate the accumulated chunks into a single window.
      const windowSamples = new Float32Array(bufferLengthRef.current);
      let offset = 0;
      for (const chunk of bufferRef.current) {
        windowSamples.set(chunk, offset);
        offset += chunk.length;
      }
      const startMs = windowStartMsRef.current ?? Date.now();
      const endMs = startMs + Math.floor((windowSamples.length / sourceRate) * 1000);
      resetBuffer();

      // Skip predominantly silent windows — saves CPU and keeps the
      // transcript free of stray hallucinations on dead air.
      if (rms(windowSamples) < SILENCE_RMS_THRESHOLD) return;

      const downsampled = downsampleTo16k(windowSamples, sourceRate);
      try {
        worker.postMessage(
          {
            type: "transcribe",
            jobId: `${startMs}`,
            audio: downsampled,
            startMs,
            endMs,
            language: languageRef.current,
          },
          // Transfer ownership so we don't pay a copy across the boundary.
          [downsampled.buffer],
        );
      } catch (err) {
        console.warn("[captions] failed to post window to worker", err);
      }
    };

    return () => {
      cancelled = true;
      teardown();
    };
  }, [enabled, localStream, teardown, resetBuffer]);

  return { status, loadProgress, errorMessage };
}
