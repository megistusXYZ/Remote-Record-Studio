import { describe, it, expect } from "vitest";
import { backgroundEffectAssets } from "./background-effect";

describe("background blur assets", () => {
  it("loads the runtime and the model from this site, not a third party", () => {
    const { wasmBaseUrl, modelUrl } = backgroundEffectAssets("/");
    expect(wasmBaseUrl).toBe("/mediapipe/wasm");
    expect(modelUrl).toBe("/mediapipe/selfie_segmenter.tflite");
  });

  it("respects a deployment under a sub-path", () => {
    expect(backgroundEffectAssets("/studio/").modelUrl).toBe(
      "/studio/mediapipe/selfie_segmenter.tflite",
    );
  });
});
