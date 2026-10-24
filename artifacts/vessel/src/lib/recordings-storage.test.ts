// @vitest-environment node
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  appendRecordingChunk,
  assembleRecordingChunks,
  clearAllLocalRecordings,
  countRecordingChunks,
  deleteRecordingChunks,
  discardInProgressRecording,
  getInProgressRecording,
  listInProgressRecordings,
  loadRecordingBlob,
  loadRecordingChunks,
  putInProgressRecording,
  saveRecordingBlob,
  updateInProgressRecording,
  type InProgressRecording,
} from "./recordings-storage";

function meta(id: string, startedAtMs: number): InProgressRecording {
  return {
    recordingId: id,
    status: "recording",
    startedAtMs,
    startedAtPerfMs: startedAtMs,
    updatedAtMs: startedAtMs,
    hasVideo: true,
    mimeTypes: { combined: "video/webm", audio: "audio/webm" },
    chunkCounts: { combined: 0, audio: 0, video: 0 },
    context: { sessionId: "s1", sessionTitle: "Episode 1", role: "host" },
  };
}

describe("recordings-storage: in-flight chunks", () => {
  beforeEach(async () => {
    await clearAllLocalRecordings();
  });

  it("stores slices and reads them back in index order even when written out of order", async () => {
    await appendRecordingChunk("rec1", "combined", 2, new Blob(["c"]));
    await appendRecordingChunk("rec1", "combined", 0, new Blob(["a"]));
    await appendRecordingChunk("rec1", "combined", 1, new Blob(["b"]));
    await appendRecordingChunk("rec1", "audio", 0, new Blob(["x"]));

    const parts = await loadRecordingChunks("rec1", "combined");
    expect(parts).toHaveLength(3);
    const text = await Promise.all(parts.map((p) => p.text()));
    expect(text).toEqual(["a", "b", "c"]);
  });

  it("keeps streams and recordings apart", async () => {
    await appendRecordingChunk("rec1", "combined", 0, new Blob(["a"]));
    await appendRecordingChunk("rec1", "audio", 0, new Blob(["b"]));
    await appendRecordingChunk("rec10", "combined", 0, new Blob(["c"]));

    expect(await countRecordingChunks("rec1")).toEqual({
      combined: 1,
      audio: 1,
      video: 0,
    });
    expect(await countRecordingChunks("rec10")).toEqual({
      combined: 1,
      audio: 0,
      video: 0,
    });
  });

  it("assembles a stream into one blob with the requested type", async () => {
    await appendRecordingChunk("rec1", "combined", 0, new Blob(["hel"]));
    await appendRecordingChunk("rec1", "combined", 1, new Blob(["lo"]));

    const blob = await assembleRecordingChunks(
      "rec1",
      "combined",
      "video/webm",
    );
    expect(blob).not.toBeNull();
    expect(blob!.type).toBe("video/webm");
    expect(await blob!.text()).toBe("hello");
    expect(
      await assembleRecordingChunks("rec1", "video", "video/webm"),
    ).toBeNull();
  });

  it("deletes every slice of a recording across streams and nothing else", async () => {
    await appendRecordingChunk("rec1", "combined", 0, new Blob(["a"]));
    await appendRecordingChunk("rec1", "audio", 0, new Blob(["b"]));
    await appendRecordingChunk("rec2", "combined", 0, new Blob(["c"]));

    await deleteRecordingChunks("rec1");
    expect(await countRecordingChunks("rec1")).toEqual({
      combined: 0,
      audio: 0,
      video: 0,
    });
    expect(await countRecordingChunks("rec2")).toEqual({
      combined: 1,
      audio: 0,
      video: 0,
    });
  });

  it("overwrites a slice written twice with the same index", async () => {
    await appendRecordingChunk("rec1", "combined", 0, new Blob(["old"]));
    await appendRecordingChunk("rec1", "combined", 0, new Blob(["new"]));
    const parts = await loadRecordingChunks("rec1", "combined");
    expect(parts).toHaveLength(1);
    expect(await parts[0]!.text()).toBe("new");
  });
});

describe("recordings-storage: in-progress metadata", () => {
  beforeEach(async () => {
    await clearAllLocalRecordings();
  });

  it("lists in-progress recordings newest first", async () => {
    await putInProgressRecording(meta("old", 1000));
    await putInProgressRecording(meta("new", 2000));
    const rows = await listInProgressRecordings();
    expect(rows.map((r) => r.recordingId)).toEqual(["new", "old"]);
  });

  it("patches status and chunk counts without losing context", async () => {
    await putInProgressRecording(meta("rec1", 1000));
    await updateInProgressRecording("rec1", {
      status: "interrupted",
      chunkCounts: { combined: 4, audio: 4, video: 0 },
    });
    const row = await getInProgressRecording("rec1");
    expect(row?.status).toBe("interrupted");
    expect(row?.chunkCounts.combined).toBe(4);
    expect(row?.context.sessionTitle).toBe("Episode 1");
    expect(row?.updatedAtMs).toBeGreaterThanOrEqual(1000);
  });

  it("is a no-op to patch an unknown recording", async () => {
    await updateInProgressRecording("missing", { status: "interrupted" });
    expect(await getInProgressRecording("missing")).toBeNull();
  });

  it("discards chunks and metadata together, leaving finished blobs alone", async () => {
    await putInProgressRecording(meta("rec1", 1000));
    await appendRecordingChunk("rec1", "combined", 0, new Blob(["a"]));
    await saveRecordingBlob("rec1", new Blob(["final"]));

    await discardInProgressRecording("rec1");

    expect(await getInProgressRecording("rec1")).toBeNull();
    expect(await countRecordingChunks("rec1")).toEqual({
      combined: 0,
      audio: 0,
      video: 0,
    });
    expect(await (await loadRecordingBlob("rec1"))!.text()).toBe("final");
  });

  it("clearAllLocalRecordings wipes all three stores", async () => {
    await putInProgressRecording(meta("rec1", 1000));
    await appendRecordingChunk("rec1", "combined", 0, new Blob(["a"]));
    await saveRecordingBlob("rec1", new Blob(["final"]));

    await clearAllLocalRecordings();

    expect(await listInProgressRecordings()).toEqual([]);
    expect(await countRecordingChunks("rec1")).toEqual({
      combined: 0,
      audio: 0,
      video: 0,
    });
    expect(await loadRecordingBlob("rec1")).toBeNull();
  });
});
