import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

/**
 * The host's view of guest tracks comes from deliveries the API stored,
 * sealed to the host's key. A host who reloads, or comes back the next day,
 * still sees every guest's track.
 */

const hoisted = vi.hoisted(() => ({
  listDeliveries: vi.fn(),
  recordDelivery: vi.fn(),
  resolveShareLink: vi.fn(),
  decrypt: vi.fn(async (_sender: string, sealed: string) =>
    sealed.replace(/^sealed:/, ""),
  ),
}));

vi.mock("@workspace/api-client-react", () => ({
  listDeliveries: hoisted.listDeliveries,
  recordDelivery: hoisted.recordDelivery,
}));
vi.mock("../lib/share-resolver", async (orig) => ({
  ...(await orig<typeof import("../lib/share-resolver")>()),
  resolveShareLink: hoisted.resolveShareLink,
}));
vi.mock("./use-identity", () => ({
  useIdentity: () => ({
    identity: {
      _pubkey: "host",
      _signer: { nip44: { decrypt: hoisted.decrypt } },
    },
  }),
}));

import {
  useHostAggregatedTracks,
  deliverPersonalArchive,
  DeliveryUnsupportedError,
} from "./use-host-aggregated-tracks";

const shareUrl = (who: string) => `https://vessel.test/s/ptr-${who}#key-${who}`;
const sealedNote = (who: string) =>
  `sealed:${JSON.stringify({ shareUrl: shareUrl(who) })}`;

function manifestFor(who: string) {
  return {
    archiveId: `a-${who}`,
    sessionTitle: "Ep 1",
    hostName: "Host",
    endedAt: "",
    archivedAt: "",
    trackCount: 1,
    tracks: [
      {
        recordingId: `r-${who}`,
        participantName: who,
        participantPubkey: who,
        durationSeconds: 60,
        sizeBytes: 10,
        mimeType: "audio/wav",
        url: `https://files.test/${who}`,
        hash: "h",
        audio: null,
        video: null,
        screen: null,
        screenDurationSeconds: null,
        startedAtMs: null,
        serverOffsetMs: null,
      },
    ],
  };
}

beforeEach(() => {
  hoisted.listDeliveries.mockReset();
  hoisted.resolveShareLink.mockReset();
  hoisted.resolveShareLink.mockImplementation(
    async ({ pointer }: { pointer: string }) =>
      manifestFor(pointer.replace("ptr-", "")),
  );
});

describe("host deliveries", () => {
  it("shows a guest's track to a host who opens the session long after it ended", async () => {
    hoisted.listDeliveries.mockResolvedValue([
      {
        id: "d1",
        senderPubkey: "sam",
        sealed: sealedNote("sam"),
        createdAt: "2026-10-24T10:00:00Z",
        updatedAt: "2026-10-24T10:00:00Z",
      },
    ]);
    const { result } = renderHook(() =>
      useHostAggregatedTracks({
        sessionId: "s1",
        acceptedPubkeys: ["sam"],
        sessionEndedAtMs: Date.now() - 24 * 60 * 60 * 1000,
      }),
    );
    await waitFor(() => expect(result.current.aggregated).toHaveLength(1));
    expect(result.current.aggregated[0].participantPubkey).toBe("sam");
    expect(hoisted.listDeliveries).toHaveBeenCalledWith("s1");
    expect(hoisted.decrypt).toHaveBeenCalledWith("sam", sealedNote("sam"));
  });

  it("ignores deliveries from people who were not in the session", async () => {
    hoisted.listDeliveries.mockResolvedValue([
      {
        id: "d1",
        senderPubkey: "mallory",
        sealed: sealedNote("mallory"),
        createdAt: "",
        updatedAt: "2026-10-24T10:00:00Z",
      },
      {
        id: "d2",
        senderPubkey: "sam",
        sealed: sealedNote("sam"),
        createdAt: "",
        updatedAt: "2026-10-24T10:00:00Z",
      },
    ]);
    const { result } = renderHook(() =>
      useHostAggregatedTracks({
        sessionId: "s1",
        acceptedPubkeys: ["sam"],
        sessionEndedAtMs: Date.now(),
      }),
    );
    await waitFor(() => expect(result.current.aggregated).toHaveLength(1));
    expect(result.current.aggregated.map((t) => t.participantPubkey)).toEqual([
      "sam",
    ]);
  });

  it("reports a delivery it cannot open instead of waiting on it forever", async () => {
    hoisted.listDeliveries.mockResolvedValue([
      {
        id: "d1",
        senderPubkey: "sam",
        sealed: "garbage",
        createdAt: "",
        updatedAt: "2026-10-24T10:00:00Z",
      },
    ]);
    const { result } = renderHook(() =>
      useHostAggregatedTracks({
        sessionId: "s1",
        acceptedPubkeys: ["sam"],
        sessionEndedAtMs: Date.now(),
      }),
    );
    await waitFor(() =>
      expect(result.current.resolveErrors.get("sam")).toBeTruthy(),
    );
    expect(result.current.waitingForPubkeys).toEqual([]);
  });
});

describe("guest delivery", () => {
  it("seals the share link to the host before it leaves the device", async () => {
    hoisted.recordDelivery.mockReset().mockResolvedValue({});
    const encrypt = vi.fn(
      async (pk: string, text: string) => `sealed-to-${pk}:${text.length}`,
    );
    await deliverPersonalArchive({
      signer: { nip44: { encrypt, decrypt: vi.fn() } },
      hostPubkey: "host",
      sessionId: "s1",
      shareUrl: shareUrl("sam"),
      backoffMs: [0],
    });
    expect(encrypt).toHaveBeenCalledWith(
      "host",
      JSON.stringify({ shareUrl: shareUrl("sam") }),
    );
    const [sessionId, body] = hoisted.recordDelivery.mock.calls[0];
    expect(sessionId).toBe("s1");
    expect(body.sealed).toMatch(/^sealed-to-host:/);
    expect(JSON.stringify(body)).not.toContain("key-sam");
  });

  it("retries until the API records it", async () => {
    hoisted.recordDelivery
      .mockReset()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({});
    await deliverPersonalArchive({
      signer: { nip44: { encrypt: async () => "s", decrypt: vi.fn() } },
      hostPubkey: "host",
      sessionId: "s1",
      shareUrl: shareUrl("sam"),
      backoffMs: [0, 0],
    });
    expect(hoisted.recordDelivery).toHaveBeenCalledTimes(2);
  });

  it("says so plainly when the key app cannot seal", async () => {
    await expect(
      deliverPersonalArchive({
        signer: {},
        hostPubkey: "host",
        sessionId: "s1",
        shareUrl: shareUrl("sam"),
      }),
    ).rejects.toBeInstanceOf(DeliveryUnsupportedError);
  });
});
