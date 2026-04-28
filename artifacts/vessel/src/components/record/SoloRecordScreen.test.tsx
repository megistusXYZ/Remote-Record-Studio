import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";

/**
 * Identity / signed-in stub. The real hook gates the screen on identity
 * presence; we always sign in for these tests except where noted.
 */
const mockIdentity = {
  identity: { __mock: "identity" } as unknown,
  pubkey: "pk_owner",
  displayName: "Recorder",
  isLoaded: true,
};
let identityOverride: Partial<typeof mockIdentity> | null = null;
vi.mock("../../hooks/use-identity", () => ({
  useIdentity: () => ({ ...mockIdentity, ...(identityOverride ?? {}) }),
}));

/**
 * Media-device picker stub: no devices, just the API surface the screen
 * consumes.
 */
vi.mock("../../hooks/use-media-devices", async () => {
  const React = await import("react");
  const fakeStream = { __mock: "localStream" } as unknown as MediaStream;
  return {
    useMediaDevices: () => ({
      cameras: [{ deviceId: "cam-1", label: "Built-in Camera" }],
      microphones: [{ deviceId: "mic-1", label: "Built-in Microphone" }],
      selectedCameraId: "cam-1",
      selectedMicId: "mic-1",
      setSelectedCameraId: vi.fn(),
      setSelectedMicId: vi.fn(),
    }),
    useLocalStream: () => ({
      stream: fakeStream,
      error: null,
    }),
    __fakeStream: fakeStream,
  };
});

/**
 * Recording stub. State machine: idle → start() → recording → stop() →
 * returns RecordingResult (with remote URLs already populated, mimicking
 * the post-upload state).
 */
const recordingState = {
  isRecording: false,
  start: vi.fn(),
  stop: vi.fn(),
  reset: vi.fn(),
  incrementalSync: { saved: 0, total: 0, failed: 0 },
};
vi.mock("../../hooks/use-recording", () => ({
  useRecording: () => recordingState,
}));

/**
 * Screen-recording stub.
 */
const screenRecordingState = {
  isRecording: false,
  start: vi.fn(),
  stop: vi.fn(),
  reset: vi.fn(),
};
vi.mock("../../hooks/use-screen-recording", () => ({
  useScreenRecording: () => screenRecordingState,
}));

/**
 * Screen-share stub. We default to "supported but not sharing".
 */
const screenShareState = {
  isSupported: true,
  isSharing: false,
  stream: null as MediaStream | null,
  start: vi.fn(),
  stop: vi.fn(),
};
vi.mock("../../hooks/use-screen-share", () => ({
  useScreenShare: () => screenShareState,
}));

vi.mock("../../hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const setLocationMock = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/record", setLocationMock] as const,
}));

const publishPersonalArchiveMock = vi.fn();
vi.mock("../../lib/session-archive", () => ({
  publishPersonalArchive: (...args: unknown[]) =>
    publishPersonalArchiveMock(...args),
}));

const rememberPersonalReceiptMock = vi.fn();
vi.mock("../../lib/personal-receipts", () => ({
  rememberPersonalReceipt: (...args: unknown[]) =>
    rememberPersonalReceiptMock(...args),
}));

vi.mock("../onboarding/SignedOutEmpty", () => ({
  SignedOutEmpty: () => <div data-testid="signed-out-empty" />,
}));

// Import AFTER mocks so the component picks them up.
import { SoloRecordScreen } from "./SoloRecordScreen";

beforeEach(() => {
  identityOverride = null;
  recordingState.isRecording = false;
  recordingState.start.mockReset().mockResolvedValue(undefined);
  recordingState.stop.mockReset();
  recordingState.reset.mockReset();
  recordingState.incrementalSync = { saved: 0, total: 0, failed: 0 };
  screenRecordingState.isRecording = false;
  screenRecordingState.start.mockReset().mockResolvedValue(undefined);
  screenRecordingState.stop.mockReset().mockResolvedValue(null);
  screenRecordingState.reset.mockReset();
  screenShareState.isSupported = true;
  screenShareState.isSharing = false;
  screenShareState.stream = null;
  screenShareState.start.mockReset();
  screenShareState.stop.mockReset();
  publishPersonalArchiveMock.mockReset();
  rememberPersonalReceiptMock.mockReset();
  setLocationMock.mockReset();
  // jsdom doesn't ship a clipboard. Stub it so auto-copy doesn't throw.
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  cleanup();
});

describe("SoloRecordScreen — gating", () => {
  it("shows the sign-in empty state when no identity is loaded", () => {
    identityOverride = {
      identity: null,
      pubkey: undefined,
      displayName: undefined,
      isLoaded: true,
    } as Partial<typeof mockIdentity>;
    render(<SoloRecordScreen />);
    expect(screen.getByTestId("signed-out-empty")).toBeTruthy();
  });

  it("renders the setup heading when signed in", () => {
    render(<SoloRecordScreen />);
    expect(screen.getByText(/Record on your own/i)).toBeTruthy();
    expect(screen.getByTestId("button-start-record")).toBeTruthy();
  });
});

describe("SoloRecordScreen — copy", () => {
  it("includes the system-audio hint with no forbidden vocabulary", () => {
    render(<SoloRecordScreen />);
    const body = document.body.textContent ?? "";
    // Friendly user-facing terms.
    expect(body).toMatch(/Entire Screen/);
    expect(body).toMatch(/A Tab/);
    expect(body).toMatch(/Share audio/i);
    expect(body).toMatch(/Chrome and Edge/);
    // Forbidden technical jargon — must never reach the user.
    const forbidden = [
      "MediaRecorder",
      "getDisplayMedia",
      "getUserMedia",
      "WebTransport",
      "WebRTC",
      "WASM",
      "MoQ",
      "QUIC",
      "IndexedDB",
      "Blossom",
      "Nostr",
      "nsec",
      "npub",
      "AES",
      "Whisper",
    ];
    for (const word of forbidden) {
      expect(body).not.toContain(word);
    }
  });
});

describe("SoloRecordScreen — state machine", () => {
  it("setup → recording → finalizing → done", async () => {
    publishPersonalArchiveMock.mockResolvedValue({
      archiveId: "arc-1",
      pointer: "ptr-1",
      shareUrl: "https://share.example/s/ptr-1",
      receiptUrl: "https://share.example/r/ptr-1",
      archivedAt: new Date().toISOString(),
      publish: { successCount: 2, totalCount: 2 },
    });
    recordingState.stop.mockResolvedValue({
      recordingId: "rec-123",
      blobUrl: "https://blossom.example/main",
      blobHash: "x".repeat(64),
      meta: {
        mimeType: "video/webm",
        sizeBytes: 1024,
        durationSeconds: 30,
      },
      audio: {
        remoteUrl: "https://blossom.example/audio",
        blobHash: "a".repeat(64),
        sizeBytes: 256,
        mimeType: "audio/webm",
      },
      video: null,
    });

    render(<SoloRecordScreen />);
    expect(screen.getByTestId("button-start-record")).toBeTruthy();

    // Start.
    fireEvent.click(screen.getByTestId("button-start-record"));
    await waitFor(() => {
      expect(recordingState.start).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId("button-stop-record")).toBeTruthy();
    expect(screen.getByTestId("text-elapsed")).toBeTruthy();

    // Stop.
    fireEvent.click(screen.getByTestId("button-stop-record"));

    await waitFor(() => {
      expect(publishPersonalArchiveMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByTestId("button-record-another")).toBeTruthy();
    });
    expect(screen.getByTestId("text-share-url").textContent).toContain(
      "https://share.example/s/ptr-1",
    );
    expect(rememberPersonalReceiptMock).toHaveBeenCalledTimes(1);

    // Reset back to setup.
    fireEvent.click(screen.getByTestId("button-record-another"));
    expect(screen.getByTestId("button-start-record")).toBeTruthy();
  });

  it("shows the error view when finalize publishes nothing", async () => {
    publishPersonalArchiveMock.mockResolvedValue({
      archiveId: "arc-2",
      pointer: "ptr-2",
      shareUrl: "https://share.example/s/ptr-2",
      receiptUrl: "https://share.example/r/ptr-2",
      archivedAt: new Date().toISOString(),
      publish: { successCount: 0, totalCount: 3 },
    });
    recordingState.stop.mockResolvedValue({
      recordingId: "rec-err",
      blobUrl: "https://blossom.example/main",
      blobHash: "y".repeat(64),
      meta: { mimeType: "video/webm", sizeBytes: 1, durationSeconds: 1 },
      audio: null,
      video: null,
    });

    render(<SoloRecordScreen />);
    fireEvent.click(screen.getByTestId("button-start-record"));
    await waitFor(() =>
      expect(recordingState.start).toHaveBeenCalledTimes(1),
    );
    fireEvent.click(screen.getByTestId("button-stop-record"));

    // We still finish into "done" — the warning chip surfaces the failure.
    await waitFor(() =>
      expect(screen.getByTestId("button-record-another")).toBeTruthy(),
    );
    expect(document.body.textContent).toMatch(/No sharing servers accepted/i);
    // No receipt was written because nothing was actually published.
    expect(rememberPersonalReceiptMock).not.toHaveBeenCalled();
  });

  it("shows the error view when the recorder produces no file", async () => {
    recordingState.stop.mockResolvedValue(null);

    render(<SoloRecordScreen />);
    fireEvent.click(screen.getByTestId("button-start-record"));
    await waitFor(() =>
      expect(recordingState.start).toHaveBeenCalledTimes(1),
    );
    fireEvent.click(screen.getByTestId("button-stop-record"));

    await waitFor(() =>
      expect(screen.getByTestId("button-error-retry")).toBeTruthy(),
    );
    expect(document.body.textContent).toMatch(/Recording didn't finish/i);
  });
});
