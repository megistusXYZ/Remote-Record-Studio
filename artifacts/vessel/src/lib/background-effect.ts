/**
 * Background effect pipeline.
 *
 * Takes an input MediaStream (camera + mic), returns a NEW MediaStream whose
 * video track has been replaced with a canvas-composited frame:
 *   output = personMask * videoFrame + (1 - personMask) * background
 *
 * The audio tracks from the source are reused unchanged in the output stream.
 *
 * Person segmentation runs via the Selfie Segmenter from MediaPipe Tasks
 * Vision (Apache-2.0). The library, its WebAssembly runtime, and the
 * segmentation file all load lazily on first activation — passthrough mode
 * pays nothing for the import cost.
 *
 * Privacy: every video frame is processed on-device. Custom background
 * images stay in the browser; nothing about the user's image or feed is
 * sent to a server.
 *
 * Performance: ~5-25 ms per frame on desktop hardware depending on whether
 * the browser exposes the GPU delegate. We default to GPU and silently fall
 * back to CPU. Mobile is intentionally not supported in V1 — the pipeline
 * is too expensive for typical phones and the UI surface hides the picker
 * on touch devices anyway.
 */

import type {
  ImageSegmenter as ImageSegmenterType,
  ImageSegmenterResult,
} from "@mediapipe/tasks-vision";

const WASM_BASE_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm";
const SEGMENTER_ASSET_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite";

export type BackgroundMode =
  | { kind: "none" }
  | { kind: "blur" }
  | { kind: "image"; src: string };

export type BackgroundEffectHandle = {
  outputStream: MediaStream;
  /** Swap the active effect without rebuilding the pipeline. */
  setMode: (mode: Exclude<BackgroundMode, { kind: "none" }>) => void;
  stop: () => void;
};

/**
 * Capability gate. We require canvas.captureStream (for the output track),
 * a non-coarse pointer (proxy for "not a phone or tablet"), and a 2D canvas
 * context. Touch laptops still pass.
 */
export function isBackgroundEffectSupported(): boolean {
  if (typeof document === "undefined") return false;
  if (typeof window === "undefined") return false;
  const canvas = document.createElement("canvas");
  if (typeof canvas.captureStream !== "function") return false;
  if (!canvas.getContext("2d")) return false;
  // Touch-only devices (phones, most tablets): hide.
  try {
    if (window.matchMedia("(hover: none) and (pointer: coarse)").matches) {
      return false;
    }
  } catch {
    // matchMedia missing — assume desktop.
  }
  return true;
}

// ──────────────────────────────────────────────────────────────────────────
// Segmenter cache (module-scoped — first activation pays the load cost,
// subsequent activations are instant).
// ──────────────────────────────────────────────────────────────────────────

let segmenterPromise: Promise<ImageSegmenterType> | null = null;

async function getSegmenter(): Promise<ImageSegmenterType> {
  if (segmenterPromise) return segmenterPromise;
  segmenterPromise = (async () => {
    const tasks = await import("@mediapipe/tasks-vision");
    const fileset = await tasks.FilesetResolver.forVisionTasks(WASM_BASE_URL);
    try {
      return await tasks.ImageSegmenter.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: SEGMENTER_ASSET_URL,
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      });
    } catch (gpuErr) {
      // GPU delegate can fail on some browsers / driver combos. Fall back
      // to CPU silently — it's slower but still produces good output.
      console.warn(
        "Background effect: GPU delegate failed, falling back to CPU.",
        gpuErr,
      );
      return tasks.ImageSegmenter.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: SEGMENTER_ASSET_URL,
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      });
    }
  })().catch((err) => {
    // Reset so the next activation can retry from scratch.
    segmenterPromise = null;
    throw err;
  });
  return segmenterPromise;
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't load background image."));
    img.src = src;
  });
}

/**
 * Draw `img` onto `ctx` using cover-fit semantics — fill the canvas while
 * preserving aspect ratio, cropping the overflowing axis.
 */
function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const srcRatio = img.width / img.height;
  const dstRatio = canvasWidth / canvasHeight;
  let sx = 0;
  let sy = 0;
  let sw = img.width;
  let sh = img.height;
  if (srcRatio > dstRatio) {
    sw = img.height * dstRatio;
    sx = (img.width - sw) / 2;
  } else {
    sh = img.width / dstRatio;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvasWidth, canvasHeight);
}

// ──────────────────────────────────────────────────────────────────────────
// Pipeline
// ──────────────────────────────────────────────────────────────────────────

/**
 * Start the background-effect pipeline against `source`. Resolves once the
 * segmenter is loaded and the output stream is producing frames.
 *
 * The returned handle owns:
 *   - a hidden <video> driving the segmenter (bound to `source`)
 *   - an off-screen mask canvas
 *   - a person-cutout canvas
 *   - the visible output canvas (whose captureStream is the public output)
 *
 * Calling stop() releases all of the above and stops the synthesized video
 * track. Audio tracks are NOT stopped — they belong to the source stream.
 */
export async function startBackgroundEffect(
  source: MediaStream,
  initialMode: Exclude<BackgroundMode, { kind: "none" }>,
): Promise<BackgroundEffectHandle> {
  const videoTrack = source.getVideoTracks()[0];
  if (!videoTrack) {
    throw new Error("Source stream has no video track to process.");
  }
  const settings = videoTrack.getSettings();
  const width = settings.width ?? 1280;
  const height = settings.height ?? 720;

  // Hidden <video> drives sampling. Must be in the DOM in some browsers
  // (Safari) for play() to actually decode frames — attach off-screen.
  // We attach it BEFORE the awaits below; if anything throws during init we
  // need to remove it again, hence the try/catch wrapper around the whole
  // setup block.
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.srcObject = source;
  video.style.position = "fixed";
  video.style.left = "-9999px";
  video.style.top = "0";
  video.style.width = "1px";
  video.style.height = "1px";
  document.body.appendChild(video);

  // Cleanup helper for partial-init failures. Pre-handle this is the only
  // way to release the DOM node + the source binding; once the handle
  // exists, stop() takes over.
  const teardownPartial = () => {
    try {
      video.pause();
    } catch {
      /* ignore */
    }
    video.srcObject = null;
    video.remove();
  };

  try {
    await video.play().catch(() => {
      // play() rejects if the source was already stopped; the draw loop will
      // simply spin until readyState becomes good, or the caller stops us.
    });

    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = width;
    outputCanvas.height = height;
    const outCtx = outputCanvas.getContext("2d", { alpha: false });
    if (!outCtx) throw new Error("Couldn't acquire output drawing context.");

    const personCanvas = document.createElement("canvas");
    personCanvas.width = width;
    personCanvas.height = height;
    const personCtx = personCanvas.getContext("2d");
    if (!personCtx) throw new Error("Couldn't acquire person drawing context.");

    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = width;
    maskCanvas.height = height;
    const maskCtx = maskCanvas.getContext("2d");
    if (!maskCtx) throw new Error("Couldn't acquire mask drawing context.");

    let mode: Exclude<BackgroundMode, { kind: "none" }> = initialMode;
    let bgImage: HTMLImageElement | null = null;
    // Monotonic token so out-of-order setMode image loads can be discarded —
    // otherwise a slow earlier load can clobber the user's newer choice.
    let imageLoadToken = 0;
    if (mode.kind === "image") {
      const myToken = ++imageLoadToken;
      try {
        const img = await loadImage(mode.src);
        if (myToken === imageLoadToken) bgImage = img;
      } catch {
        // Non-fatal — we'll fall back to drawing the raw video as background
        // until a working image is supplied.
      }
    }

    const segmenter = await getSegmenter();

  let stopped = false;
  let rafId: number | null = null;
  // Reused ImageData buffer for the mask write.
  let maskImageData: ImageData | null = null;

  const draw = () => {
    if (stopped) return;
    if (video.readyState < 2 || video.videoWidth === 0) {
      rafId = requestAnimationFrame(draw);
      return;
    }

    let segResult: ImageSegmenterResult | null = null;
    try {
      segResult = segmenter.segmentForVideo(video, performance.now());
    } catch {
      // Segmenter can transiently fail when the video resizes; skip the
      // frame and try again on the next tick.
    }

    if (segResult?.categoryMask) {
      const cat = segResult.categoryMask;
      const data = cat.getAsUint8Array();
      const cw = cat.width;
      const ch = cat.height;
      // Selfie segmenter emits category 0 = background, 1 = person.
      // Build an RGBA buffer where person => fully opaque white.
      if (
        !maskImageData ||
        maskImageData.width !== cw ||
        maskImageData.height !== ch
      ) {
        maskImageData = maskCtx.createImageData(cw, ch);
        // Pre-fill RGB to white for any pixels we set as opaque.
        const buf = maskImageData.data;
        for (let i = 0; i < buf.length; i += 4) {
          buf[i] = 255;
          buf[i + 1] = 255;
          buf[i + 2] = 255;
        }
      }
      const buf = maskImageData.data;
      for (let i = 0; i < data.length; i++) {
        buf[i * 4 + 3] = data[i] === 0 ? 0 : 255;
      }
      // Draw mask into a temp area, then upscale into the full mask canvas.
      // To avoid a second canvas, putImageData into top-left and stretch
      // via drawImage of the same canvas onto itself.
      maskCtx.clearRect(0, 0, width, height);
      if (cw === width && ch === height) {
        maskCtx.putImageData(maskImageData, 0, 0);
      } else {
        // Upscale: putImageData is unscaled, so we need a stash canvas.
        const stash = document.createElement("canvas");
        stash.width = cw;
        stash.height = ch;
        stash.getContext("2d")?.putImageData(maskImageData, 0, 0);
        // Soft edges — cheap blur during upscale.
        maskCtx.filter = "blur(2px)";
        maskCtx.drawImage(stash, 0, 0, cw, ch, 0, 0, width, height);
        maskCtx.filter = "none";
      }
      cat.close();
    }

    // 1) Draw background to the output canvas.
    if (mode.kind === "blur") {
      outCtx.filter = "blur(18px)";
      outCtx.drawImage(video, 0, 0, width, height);
      outCtx.filter = "none";
    } else if (mode.kind === "image" && bgImage) {
      drawImageCover(outCtx, bgImage, width, height);
    } else {
      // Fallback if image hasn't loaded yet — show raw video so the user
      // doesn't see a black screen.
      outCtx.drawImage(video, 0, 0, width, height);
    }

    // 2) Build the person cutout = video clipped by mask.
    personCtx.globalCompositeOperation = "source-over";
    personCtx.clearRect(0, 0, width, height);
    personCtx.drawImage(video, 0, 0, width, height);
    personCtx.globalCompositeOperation = "destination-in";
    personCtx.drawImage(maskCanvas, 0, 0);
    personCtx.globalCompositeOperation = "source-over";

    // 3) Composite person on top of background.
    outCtx.drawImage(personCanvas, 0, 0);

    rafId = requestAnimationFrame(draw);
  };

  draw();

  // Build the output stream: synthesized video + original audio tracks.
  const outputStream: MediaStream = outputCanvas.captureStream(30);
  for (const audio of source.getAudioTracks()) {
    outputStream.addTrack(audio);
  }

    return {
      outputStream,
      setMode: (next) => {
        mode = next;
        if (next.kind === "image") {
          // Token-based dedupe: only the most-recent load wins. Without
          // this, a slow earlier image load can resolve after a newer one
          // and replace the user's intended background.
          const myToken = ++imageLoadToken;
          loadImage(next.src)
            .then((img) => {
              if (stopped) return;
              if (myToken !== imageLoadToken) return;
              bgImage = img;
            })
            .catch(() => {
              // Keep the previous bgImage if the new one fails to load.
            });
        }
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        if (rafId !== null) cancelAnimationFrame(rafId);
        for (const t of outputStream.getVideoTracks()) t.stop();
        teardownPartial();
      },
    };
  } catch (initErr) {
    // Pre-handle failure: caller never gets a stop() to call, so we have
    // to release the DOM/source binding ourselves to avoid accumulating
    // hidden video elements on retry.
    teardownPartial();
    throw initErr;
  }
}
