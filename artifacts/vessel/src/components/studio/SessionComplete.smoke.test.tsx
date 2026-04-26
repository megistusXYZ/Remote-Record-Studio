import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { SessionComplete, type Track } from "./SessionComplete";

beforeAll(() => {
  if (typeof HTMLCanvasElement !== "undefined") {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  }
});

vi.mock("../../hooks/use-identity", () => ({
  useIdentity: () => ({ identity: null, pubkey: null, displayName: "Host" }),
}));

vi.mock("../../hooks/use-avatar-color", () => ({
  resolveAvatarColor: () => "#0a0",
  useStoredAvatarColor: () => "#0a0",
}));

vi.mock("../../hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("framer-motion", async () => {
  const React = await import("react");
  type MotionProps = React.HTMLAttributes<HTMLElement> & {
    children?: React.ReactNode;
  };
  const passthrough = (tag: string) =>
    React.forwardRef<HTMLElement, MotionProps>(({ children, ...rest }, ref) =>
      React.createElement(tag, { ref, ...rest }, children),
    );
  return {
    motion: new Proxy({}, { get: (_t, key: string) => passthrough(String(key)) }),
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  };
});

function makeTrack(overrides: Partial<Track>): Track {
  return {
    participantId: "id",
    participantName: "Name",
    participantPubkey: "pk",
    recordingId: "rec",
    blob: null,
    durationSeconds: 30,
    sizeBytes: 100,
    mimeType: "video/webm",
    hasVideo: true,
    storageState: "remote",
    combinedBlobUrl: "https://blossom.example/combined",
    combinedRemoteUrl: "https://blossom.example/combined",
    combinedBlobHash: "a".repeat(64),
    audioBlobUrl: "https://blossom.example/audio",
    audioRemoteUrl: "https://blossom.example/audio",
    audioMimeType: "audio/webm",
    audioSizeBytes: 20,
    audioBlobHash: "b".repeat(64),
    videoOnlyRemoteUrl: "https://blossom.example/video",
    videoOnlyMimeType: "video/webm",
    videoOnlySizeBytes: 80,
    videoOnlyBlobHash: "c".repeat(64),
    ...overrides,
  };
}

describe("SessionComplete — 2-participant smoke", () => {
  it("renders two participant rows with V+A, audio, and video chips, and a footer with per-stream totals", () => {
    const ada = makeTrack({
      participantId: "ada",
      participantName: "Ada",
      participantPubkey: "pkAda",
      recordingId: "rec-ada",
      sizeBytes: 100,
      audioSizeBytes: 20,
      videoOnlySizeBytes: 80,
    });
    const grace = makeTrack({
      participantId: "grace",
      participantName: "Grace",
      participantPubkey: "pkGrace",
      recordingId: "rec-grace",
      sizeBytes: 200,
      audioSizeBytes: 40,
      videoOnlySizeBytes: 160,
    });

    render(
      <SessionComplete
        open={true}
        isHost={true}
        hostName="Host"
        sessionTitle="Test session"
        sessionDate={new Date("2026-04-26T00:00:00Z")}
        syncStatus="complete"
        syncProgress={{ synced: 2, total: 2, percent: 100, failed: 0 }}
        tracks={[ada, grace]}
        onViewVault={() => {}}
        onStartNew={() => {}}
      />,
    );

    expect(screen.getByText(/Ada'?s Track/)).toBeTruthy();
    expect(screen.getByText(/Grace'?s Track/)).toBeTruthy();

    expect(screen.getByTestId("chip-hash-va-ada")).toBeTruthy();
    expect(screen.getByTestId("chip-hash-a-ada")).toBeTruthy();
    expect(screen.getByTestId("chip-hash-v-ada")).toBeTruthy();
    expect(screen.getByTestId("chip-hash-va-grace")).toBeTruthy();
    expect(screen.getByTestId("chip-hash-a-grace")).toBeTruthy();
    expect(screen.getByTestId("chip-hash-v-grace")).toBeTruthy();

    expect(screen.getByTestId("button-copy-link-va-ada")).toBeTruthy();
    expect(screen.getByTestId("button-copy-link-a-ada")).toBeTruthy();
    expect(screen.getByTestId("button-copy-link-v-ada")).toBeTruthy();
    expect(screen.getByTestId("button-copy-link-va-grace")).toBeTruthy();
    expect(screen.getByTestId("button-copy-link-a-grace")).toBeTruthy();
    expect(screen.getByTestId("button-copy-link-v-grace")).toBeTruthy();

    expect(screen.getByTestId("select-bundle-stream")).toBeTruthy();
    expect(screen.getByTestId("button-bundle-download")).toBeTruthy();

    const footer = screen.getByTestId("bundle-footer-totals");
    expect(within(footer).getByTestId("bundle-total-va").textContent).toMatch(/V\+A/);
    expect(within(footer).getByTestId("bundle-total-v").textContent).toMatch(/Video only/);
    expect(within(footer).getByTestId("bundle-total-a").textContent).toMatch(/Audio only/);
  });

  it("hides per-stream chips when the participant lacks that sibling", () => {
    const noAudio = makeTrack({
      participantId: "p1",
      participantName: "P1",
      participantPubkey: "pk1",
      recordingId: "rec1",
      audioBlobUrl: null,
      audioRemoteUrl: null,
      audioBlobHash: null,
    });
    const noVideo = makeTrack({
      participantId: "p2",
      participantName: "P2",
      participantPubkey: "pk2",
      recordingId: "rec2",
      videoOnlyRemoteUrl: null,
      videoOnlyLocalUrl: null,
      videoOnlyBlobHash: null,
    });

    render(
      <SessionComplete
        open={true}
        isHost={true}
        hostName="Host"
        syncStatus="complete"
        syncProgress={{ synced: 2, total: 2, percent: 100, failed: 0 }}
        tracks={[noAudio, noVideo]}
        onViewVault={() => {}}
        onStartNew={() => {}}
      />,
    );

    expect(screen.queryByTestId("chip-hash-a-p1")).toBeNull();
    expect(screen.getByTestId("chip-hash-v-p1")).toBeTruthy();
    expect(screen.getByTestId("chip-hash-a-p2")).toBeTruthy();
    expect(screen.queryByTestId("chip-hash-v-p2")).toBeNull();
  });
});
