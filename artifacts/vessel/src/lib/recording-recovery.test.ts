// @vitest-environment node
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  discardRecoverableRecording,
  estimateDurationSeconds,
  isRecoverable,
  listRecoverableRecordings,
  recoverRecording,
} from "./recording-recovery";
import { markRecordingRegistered } from "./recording-finalize";
import {
  appendRecordingChunk,
  clearAllLocalRecordings,
  countRecordingChunks,
  getInProgressRecording,
  loadRecordingBlob,
  putInProgressRecording,
  saveRecordingBlob,
  type InProgressRecording,
} from "./recordings-storage";

const NOW = 1_700_000_000_000;

function row(
  overrides: Partial<InProgressRecording> = {},
): InProgressRecording {
  return {
    recordingId: "rec1",
    status: "recording",
    startedAtMs: NOW - 65_000,
    startedAtPerfMs: NOW - 65_000,
    updatedAtMs: NOW - 60_000,
    hasVideo: false,
    mimeTypes: { combined: "audio/webm", audio: "audio/webm" },
    chunkCounts: { combined: 2, audio: 2, video: 0 },
    context: {
      sessionId: "s1",
      sessionTitle: "Episode 1",
      role: "host",
      pubkey: "abc",
    },
    ...overrides,
  };
}

describe("recording-recovery: which rows qualify", () => {
  it("treats a stale 'recording' row as crashed, a fresh one as live", () => {
    expect(isRecoverable(row({ updatedAtMs: NOW - 60_000 }), NOW)).toBe(true);
    expect(isRecoverable(row({ updatedAtMs: NOW - 2_000 }), NOW)).toBe(false);
  });

  it("always offers interrupted and saved rows", () => {
    expect(
      isRecoverable(row({ status: "interrupted", updatedAtMs: NOW }), NOW),
    ).toBe(true);
    expect(isRecoverable(row({ status: "saved", updatedAtMs: NOW }), NOW)).toBe(
      true,
    );
  });

  it("estimates length from the last write when no final outcome exists", () => {
    expect(estimateDurationSeconds(row())).toBe(5);
  });
});

describe("recording-recovery: rebuilding and registering", () => {
  beforeEach(async () => {
    await clearAllLocalRecordings();
  });

  it("rebuilds the files from slices, saves them, and leaves the row as 'saved' until registered", async () => {
    await putInProgressRecording(row());
    await appendRecordingChunk("rec1", "combined", 0, new Blob(["ab"]));
    await appendRecordingChunk("rec1", "combined", 1, new Blob(["cd"]));
    await appendRecordingChunk("rec1", "audio", 0, new Blob(["x"]));

    const outcome = await recoverRecording(row(), null);
    expect(outcome).not.toBeNull();
    expect(outcome!.rebuiltFromChunks).toBe(true);
    const r = outcome!.result;
    expect(await r.blob.text()).toBe("abcd");
    expect(r.meta.mimeType).toBe("audio/webm");
    expect(r.meta.hasVideo).toBe(false);
    expect(r.meta.durationSeconds).toBe(5);
    expect(r.persistedLocally).toBe(true);
    expect(r.syncStatus).toBe("partial-failure"); // no identity, so no upload
    expect(r.audio).not.toBeNull();
    expect(await r.audio!.blob.text()).toBe("x");
    expect(r.startedAtMs).toBe(NOW - 65_000);

    // Finished files are in place and the slices are gone.
    expect(await (await loadRecordingBlob("rec1"))!.text()).toBe("abcd");
    expect(await countRecordingChunks("rec1")).toEqual({
      combined: 0,
      audio: 0,
      video: 0,
    });

    const saved = await getInProgressRecording("rec1");
    expect(saved?.status).toBe("saved");
    expect(saved?.finalOutcome?.combined.remoteUrl).toBeNull();
    expect(
      (await listRecoverableRecordings(NOW)).map((x) => x.recordingId),
    ).toEqual(["rec1"]);

    await markRecordingRegistered("rec1");
    expect(await getInProgressRecording("rec1")).toBeNull();
    expect(await listRecoverableRecordings(NOW)).toEqual([]);
  });

  it("reuses saved files and the remembered upload outcome for a 'saved' row", async () => {
    await saveRecordingBlob("rec1", new Blob(["final"]));
    await putInProgressRecording(
      row({
        status: "saved",
        finalOutcome: {
          durationSeconds: 42,
          hasVideo: false,
          combined: {
            mimeType: "audio/webm",
            sizeBytes: 5,
            hash: "h1",
            remoteUrl: "https://store.example/h1",
          },
          audio: null,
          video: null,
        },
      }),
    );

    const outcome = await recoverRecording(row({ status: "saved" }), null);
    expect(outcome).not.toBeNull();
    expect(outcome!.rebuiltFromChunks).toBe(false);
    expect(outcome!.result.syncStatus).toBe("complete");
    expect(outcome!.result.remoteUrl).toBe("https://store.example/h1");
    expect(outcome!.result.meta.durationSeconds).toBe(42);
    expect(await outcome!.result.blob.text()).toBe("final");
  });

  it("rebuilds a WAV master from positioned chunks and repairs its header", async () => {
    // A streaming WAV writer emits a header with zero sizes followed by PCM
    // appends; the finalize patches never arrived because the page died.
    const header = new Uint8Array(44);
    const ascii = (o: number, t: string) => {
      for (let i = 0; i < t.length; i++) header[o + i] = t.charCodeAt(i);
    };
    ascii(0, "RIFF");
    ascii(8, "WAVE");
    ascii(12, "fmt ");
    new DataView(header.buffer).setUint32(16, 16, true);
    ascii(36, "data");
    await putInProgressRecording(
      row({
        hasVideo: false,
        mimeTypes: { combined: "audio/webm", audio: "audio/wav" },
        chunkCounts: { combined: 1, audio: 2, video: 0 },
      }),
    );
    await appendRecordingChunk("rec1", "combined", 0, new Blob(["webm"]));
    await appendRecordingChunk("rec1", "audio", 0, new Blob([header, new Uint8Array(100)]), 0);
    await appendRecordingChunk("rec1", "audio", 1, new Blob([new Uint8Array(50)]), 144);

    const outcome = await recoverRecording(row(), null);
    expect(outcome).not.toBeNull();
    const audio = outcome!.result.audio;
    expect(audio).not.toBeNull();
    expect(audio!.mimeType).toBe("audio/wav");
    expect(audio!.blob.size).toBe(194);
    const bytes = new Uint8Array(await audio!.blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(4, true)).toBe(194 - 8);
    expect(view.getUint32(40, true)).toBe(150);
  });

  it("returns null when nothing usable is stored", async () => {
    await putInProgressRecording(row());
    expect(await recoverRecording(row(), null)).toBeNull();
  });

  it("discard removes slices, saved files and the row", async () => {
    await putInProgressRecording(row({ status: "saved" }));
    await appendRecordingChunk("rec1", "combined", 0, new Blob(["a"]));
    await saveRecordingBlob("rec1", new Blob(["final"]));
    await saveRecordingBlob("rec1:audio", new Blob(["a"]));

    await discardRecoverableRecording("rec1");

    expect(await getInProgressRecording("rec1")).toBeNull();
    expect(await countRecordingChunks("rec1")).toEqual({
      combined: 0,
      audio: 0,
      video: 0,
    });
    expect(await loadRecordingBlob("rec1")).toBeNull();
    expect(await loadRecordingBlob("rec1:audio")).toBeNull();
  });
});
