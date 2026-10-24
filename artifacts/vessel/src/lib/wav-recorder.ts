import type { PersistStats } from "./recorder";
import { assembleWavFromChunks, type WavChunkPart } from "./wav-assemble";

/**
 * Uncompressed 48 kHz WAV master of one microphone track, written with
 * mediabunny through a chunked stream target. Every ~1 MiB chunk is handed
 * to the persist sink the moment it is complete, so a crash loses at most a
 * few seconds and the file can be rebuilt (header repaired) from storage.
 *
 * mediabunny is loaded on demand so it stays out of the initial bundle.
 */

export const WAV_MIME_TYPE = "audio/wav";
export const WAV_SAMPLE_RATE = 48_000;
/** 24-bit gives editors headroom; two hours of mono is about 1 GB. */
export const WAV_CODEC = "pcm-s24" as const;
/** One IndexedDB write every few seconds instead of a hundred per second. */
export const WAV_CHUNK_BYTES = 1 << 20;

/** Durable sink for WAV chunks: index is arrival order, position the byte offset. */
export type WavPersistChunk = (
  index: number,
  position: number,
  blob: Blob,
) => Promise<void>;

export type WavRecorderLike = {
  start(track: MediaStreamTrack, persistChunk?: WavPersistChunk): Promise<void>;
  /** Finalize and rebuild the file. `loadPersisted` returns the chunks the sink stored. */
  stop(loadPersisted?: () => Promise<WavChunkPart[]>): Promise<Blob | null>;
  getPersistStats(): PersistStats;
  getBytesWritten(): number;
  /** Set when the capture or writer failed mid-recording; the file may still be usable. */
  getFailure(): unknown;
};

type LedgerEntry = {
  index: number;
  position: number;
  size: number;
  blob: Blob | null;
};

type Mediabunny = typeof import("mediabunny");

export class WavMasterRecorder implements WavRecorderLike {
  private output: InstanceType<Mediabunny["Output"]> | null = null;
  private clonedTrack: MediaStreamTrack | null = null;
  private ledger: LedgerEntry[] = [];
  private seq = 0;
  private bytesWritten = 0;
  private stats: PersistStats = { captured: 0, persisted: 0, failed: 0 };
  private failure: unknown = null;
  private finished = false;

  static isSupported(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof WritableStream !== "undefined" &&
      typeof MediaStream !== "undefined"
    );
  }

  async start(
    track: MediaStreamTrack,
    persistChunk?: WavPersistChunk,
  ): Promise<void> {
    if (this.output) throw new Error("WAV recorder is already started");
    const mb: Mediabunny = await import("mediabunny");

    // A second consumer of the microphone: the combined recorder keeps the
    // original track, the master gets its own handle.
    this.clonedTrack = track.clone();
    const source = new mb.MediaStreamAudioTrackSource(
      this.clonedTrack as MediaStreamAudioTrack,
      { codec: WAV_CODEC, transform: { sampleRate: WAV_SAMPLE_RATE } },
    );
    source.errorPromise.catch((err: unknown) => {
      this.failure ??= err;
      console.warn("WAV master capture failed", err);
    });

    const writable = new WritableStream<import("mediabunny").StreamTargetChunk>(
      {
        write: async (chunk) => {
          const index = this.seq++;
          const position = chunk.position;
          // The chunk is a view into the target's reusable buffer; copy it.
          const data = chunk.data.slice();
          const blob = new Blob([data]);
          this.stats.captured += 1;
          this.bytesWritten = Math.max(
            this.bytesWritten,
            position + data.byteLength,
          );
          const entry: LedgerEntry = {
            index,
            position,
            size: data.byteLength,
            blob: null,
          };
          this.ledger.push(entry);
          if (!persistChunk) {
            entry.blob = blob;
            return;
          }
          try {
            await persistChunk(index, position, blob);
            this.stats.persisted += 1;
          } catch (err) {
            // Keep the bytes in memory so the take is not lost; the UI warns.
            this.stats.failed += 1;
            entry.blob = blob;
            console.warn("Could not save a WAV chunk locally", err);
          }
        },
      },
      new CountQueuingStrategy({ highWaterMark: 8 }),
    );

    const output = new mb.Output({
      format: new mb.WavOutputFormat(),
      target: new mb.StreamTarget(writable, {
        chunked: true,
        chunkSize: WAV_CHUNK_BYTES,
      }),
    });
    output.addAudioTrack(source);
    await output.start();
    this.output = output;
  }

  async stop(
    loadPersisted?: () => Promise<WavChunkPart[]>,
  ): Promise<Blob | null> {
    if (!this.output || this.finished) return null;
    this.finished = true;
    try {
      await this.output.finalize();
    } catch (err) {
      // Unfinalized: the header still says size 0; assembly repairs it.
      this.failure ??= err;
      console.warn("WAV master did not finalize cleanly", err);
    } finally {
      this.clonedTrack?.stop();
      this.clonedTrack = null;
    }

    // Persisted chunks win; in-memory copies fill any gaps.
    const persisted = loadPersisted
      ? await loadPersisted().catch(() => [])
      : [];
    const byIndex = new Map<number, WavChunkPart>();
    for (const p of persisted) byIndex.set(p.index, p);
    for (const entry of this.ledger) {
      if (!byIndex.has(entry.index) && entry.blob) {
        byIndex.set(entry.index, {
          index: entry.index,
          position: entry.position,
          blob: entry.blob,
        });
      }
    }
    const assembled = await assembleWavFromChunks(
      [...byIndex.values()],
      WAV_MIME_TYPE,
    );
    return assembled?.blob ?? null;
  }

  getPersistStats(): PersistStats {
    return { ...this.stats };
  }

  getBytesWritten(): number {
    return this.bytesWritten;
  }

  getFailure(): unknown {
    return this.failure;
  }
}
