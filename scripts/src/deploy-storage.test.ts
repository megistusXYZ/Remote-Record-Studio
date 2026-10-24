import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

/**
 * The storage server is on the open internet, and anyone can make a key to
 * sign an upload. Vessel only ever uploads recordings it has encrypted on
 * the device, so the server takes nothing else: no images, text or zips it
 * could be used to host, no fetching from other servers, and a size cap.
 */

const config = parse(
  readFileSync(join(__dirname, "../../deploy/blossom.yml"), "utf8"),
) as {
  storage: { rules: Array<{ type: string }> };
  upload: { enabled: boolean; requireAuth: boolean; maxSize?: number };
  media?: { enabled?: boolean };
  mirror?: { enabled?: boolean };
};

const GiB = 1024 ** 3;
// The biggest file Vessel makes: a three-hour stereo WAV master,
// 48 kHz x 24-bit x 2 channels, about 3.1 GB.
const THREE_HOUR_STEREO_MASTER = 3 * 3600 * 48_000 * 3 * 2;

describe("storage server", () => {
  it("accepts only encrypted recordings", () => {
    expect(config.storage.rules.map((r) => r.type)).toEqual(["application/octet-stream"]);
  });

  it("caps uploads at a size that still fits a three-hour episode", () => {
    expect(config.upload.requireAuth).toBe(true);
    expect(config.upload.maxSize).toBeDefined();
    expect(config.upload.maxSize!).toBeGreaterThanOrEqual(THREE_HOUR_STEREO_MASTER);
    expect(config.upload.maxSize!).toBeLessThanOrEqual(4 * GiB);
  });

  it("does not fetch files from other servers or process media", () => {
    expect(config.mirror?.enabled).toBe(false);
    expect(config.media?.enabled ?? false).toBe(false);
  });
});
