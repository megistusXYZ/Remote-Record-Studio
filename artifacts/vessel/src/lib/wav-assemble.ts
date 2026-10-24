/**
 * Rebuild a WAV file from the chunks a streaming writer produced.
 *
 * A WAV written through mediabunny's `StreamTarget` is append-only except for
 * two 4-byte patches written at finalize: the RIFF size at byte 4 and the
 * `data` chunk size inside the header. Chunks therefore fall into two kinds:
 * appends (position equals the bytes written so far) and header patches
 * (position inside the header). If the page died before finalize, no patches
 * exist and the header still says size 0; `repairWavHeader` fills the sizes
 * in from the total length. Either way the result is built from Blob slices,
 * so a two-hour master is never copied through the JS heap.
 */

export type WavChunkPart = {
  /** Arrival order. */
  index: number;
  /** Byte offset in the finished file. Undefined means "append". */
  position?: number;
  blob: Blob;
};

/** Size of the standard header: RIFF (12) + fmt chunk (24) + data chunk header (8). */
export const WAV_MIN_HEADER_BYTES = 44;

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++)
    out += String.fromCharCode(bytes[offset + i] ?? 0);
  return out;
}

/**
 * Patch RIFF and `data` sizes in a header so they describe `totalLength`
 * bytes. Returns the patched copy and where the data payload starts, or null
 * when `header` is not a recognisable RIFF/WAVE header.
 */
export function repairWavHeader(
  header: Uint8Array,
  totalLength: number,
): { header: Uint8Array; dataOffset: number } | null {
  if (header.length < WAV_MIN_HEADER_BYTES) return null;
  if (readAscii(header, 0, 4) !== "RIFF" || readAscii(header, 8, 4) !== "WAVE")
    return null;
  const out = header.slice();
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  let p = 12;
  while (p + 8 <= out.length) {
    const id = readAscii(out, p, 4);
    const size = view.getUint32(p + 4, true);
    if (id === "data") {
      view.setUint32(p + 4, Math.max(0, totalLength - (p + 8)), true);
      view.setUint32(4, Math.max(0, totalLength - 8), true);
      return { header: out, dataOffset: p + 8 };
    }
    p += 8 + size + (size & 1);
  }
  return null;
}

/**
 * Assemble the chunks into one WAV Blob. `finalized` reports whether header
 * patches were present (a normal finish) or the sizes had to be repaired.
 */
export async function assembleWavFromChunks(
  parts: WavChunkPart[],
  mimeType = "audio/wav",
): Promise<{ blob: Blob; finalized: boolean } | null> {
  const ordered = [...parts].sort((a, b) => a.index - b.index);
  const appends: Blob[] = [];
  const patches: Array<{ position: number; blob: Blob }> = [];
  let written = 0;

  for (const part of ordered) {
    const pos = part.position ?? written;
    if (pos === written) {
      appends.push(part.blob);
      written += part.blob.size;
    } else if (
      pos < written &&
      pos + part.blob.size <= Math.max(WAV_MIN_HEADER_BYTES, 4096)
    ) {
      patches.push({ position: pos, blob: part.blob });
    } else {
      // A write that is neither an append nor a header patch means this is
      // not the WAV stream we expect; refuse rather than produce garbage.
      return null;
    }
  }
  if (written === 0) return null;

  // The header may span the first few appends if the writer emitted small
  // pieces; gather enough bytes to cover any patch and the standard header.
  const headerSpan = Math.max(
    WAV_MIN_HEADER_BYTES,
    ...patches.map((p) => p.position + p.blob.size),
  );
  const headBlob = new Blob(appends).slice(0, headerSpan);
  const head = new Uint8Array(await headBlob.arrayBuffer());
  if (head.length < WAV_MIN_HEADER_BYTES) return null;

  let finalized = false;
  if (patches.length > 0) {
    for (const patch of patches) {
      const bytes = new Uint8Array(await patch.blob.arrayBuffer());
      head.set(bytes, patch.position);
    }
    finalized = true;
  }

  // Even a finalized header is re-derived from the real length: it costs
  // nothing and guards against a patch that was lost mid-write.
  const repaired = repairWavHeader(head, written);
  if (!repaired) return null;
  const headerBytes = repaired.header.slice(0, head.length);

  const rest = new Blob(appends).slice(head.length);
  return {
    blob: new Blob([headerBytes, rest], { type: mimeType }),
    finalized,
  };
}
