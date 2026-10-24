/**
 * Estimate how far this device's clock is from the server's.
 *
 * Every participant records on their own device, so lining tracks up later
 * needs each start time expressed on one clock. The API's health endpoint
 * returns its current time; a round trip gives an NTP-style estimate of the
 * offset (server minus local) good to a few tens of milliseconds on a normal
 * connection. The result is cached per page load.
 */

const CACHE_MS = 10 * 60 * 1000;
const SAMPLES = 2;

let cached: { offsetMs: number; measuredAt: number } | null = null;
let inFlight: Promise<number | null> | null = null;

async function sampleOnce(): Promise<number | null> {
  const t0 = Date.now();
  const res = await fetch("/api/healthz", {
    cache: "no-store",
    credentials: "omit",
  });
  const t1 = Date.now();
  if (!res.ok) return null;
  const body = (await res.json()) as { nowMs?: unknown };
  if (typeof body.nowMs !== "number") return null;
  const midpoint = t0 + (t1 - t0) / 2;
  return body.nowMs - midpoint;
}

/** Server clock minus this device's clock, in ms. Null when unknown. */
export async function measureServerOffset(): Promise<number | null> {
  if (cached && Date.now() - cached.measuredAt < CACHE_MS)
    return cached.offsetMs;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const samples: number[] = [];
      for (let i = 0; i < SAMPLES; i++) {
        const s = await sampleOnce().catch(() => null);
        if (s !== null) samples.push(s);
      }
      if (samples.length === 0) return null;
      // The smaller spread wins; take the median for two or more samples.
      samples.sort((a, b) => a - b);
      const offsetMs = Math.round(samples[Math.floor(samples.length / 2)]!);
      cached = { offsetMs, measuredAt: Date.now() };
      return offsetMs;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export function getCachedServerOffsetMs(): number | null {
  return cached?.offsetMs ?? null;
}

/** Test hook. */
export function __resetServerTimeCache(): void {
  cached = null;
  inFlight = null;
}
