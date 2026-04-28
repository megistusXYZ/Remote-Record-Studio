import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorPlay,
  MonitorOff,
  Square,
  Loader2,
  Check,
  Copy,
  ArrowRight,
  AlertTriangle,
  Info,
} from "lucide-react";
import { useIdentity } from "../../hooks/use-identity";
import { useMediaDevices, useLocalStream } from "../../hooks/use-media-devices";
import { useRecording } from "../../hooks/use-recording";
import {
  useScreenRecording,
  type ScreenRecordingResult,
} from "../../hooks/use-screen-recording";
import { useScreenShare } from "../../hooks/use-screen-share";
import { useToast } from "../../hooks/use-toast";
import { VesselButton } from "../vessel-ui/VesselButton";
import { VesselCard } from "../vessel-ui/VesselCard";
import { RecordingDot } from "../vessel-ui/RecordingDot";
import { SignedOutEmpty } from "../onboarding/SignedOutEmpty";
import { publishPersonalArchive } from "../../lib/session-archive";
import { rememberPersonalReceipt } from "../../lib/personal-receipts";

type Phase = "setup" | "recording" | "finalizing" | "done" | "error";

type FinalizeStep = "saving" | "publishing" | null;

type DoneState = {
  shareUrl: string;
  receiptUrl: string;
  publishWarning: string | null;
};

function formatSeconds(s: number): string {
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export function SoloRecordScreen() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { identity, pubkey, displayName, isLoaded } = useIdentity();

  const recording = useRecording();
  const screenRecording = useScreenRecording();
  const screenShare = useScreenShare();

  const {
    cameras,
    microphones,
    selectedCameraId,
    selectedMicId,
    setSelectedCameraId,
    setSelectedMicId,
  } = useMediaDevices();

  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const { stream: localStream, error: localStreamError } = useLocalStream({
    cameraId: selectedCameraId,
    micId: selectedMicId,
    cameraEnabled,
    micEnabled,
  });

  const [phase, setPhase] = useState<Phase>("setup");
  const [elapsed, setElapsed] = useState(0);
  const [finalizeStep, setFinalizeStep] = useState<FinalizeStep>(null);
  const [done, setDone] = useState<DoneState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const previewRef = useRef<HTMLVideoElement | null>(null);
  const screenPreviewRef = useRef<HTMLVideoElement | null>(null);
  const screenRecResultRef = useRef<ScreenRecordingResult | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);

  // Bind the local camera stream into the preview <video>.
  useEffect(() => {
    if (previewRef.current && localStream) {
      previewRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Bind the screen stream into the screen-preview <video>.
  useEffect(() => {
    if (screenPreviewRef.current) {
      screenPreviewRef.current.srcObject = screenShare.stream;
    }
  }, [screenShare.stream]);

  // Mirror the screen-share lifecycle into the screen recorder. Same pattern
  // as the studio: starting a share kicks off an independent chunked
  // recorder; ending the share (whether via our Stop button or the browser's
  // native "Stop sharing" bar) finalizes the screen clip and stashes its
  // result for inclusion in the archive.
  useEffect(() => {
    const liveScreen = screenShare.isSharing ? screenShare.stream : null;
    if (
      liveScreen &&
      !screenRecording.isRecording &&
      phase === "recording"
    ) {
      void screenRecording.start(liveScreen).catch((err) => {
        console.warn(
          "Screen recording failed to start; the recording continues without it.",
          err,
        );
      });
    } else if (!liveScreen && screenRecording.isRecording) {
      void screenRecording.stop().then((r) => {
        if (r) screenRecResultRef.current = r;
      });
    }
  }, [screenShare.isSharing, screenShare.stream, screenRecording, phase]);

  // Elapsed timer — wall-clock based so a backgrounded tab still tracks.
  useEffect(() => {
    if (phase !== "recording") {
      if (tickRef.current !== null) {
        window.clearInterval(tickRef.current);
        tickRef.current = null;
      }
      return;
    }
    if (startedAtRef.current === null) startedAtRef.current = Date.now();
    setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    tickRef.current = window.setInterval(() => {
      if (startedAtRef.current === null) return;
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => {
      if (tickRef.current !== null) {
        window.clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [phase]);

  // Stop any active share when the component unmounts so we never leave a
  // capture warm in the background after the user navigates away.
  useEffect(() => {
    return () => {
      if (screenShare.isSharing) screenShare.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canRecord =
    !!localStream &&
    !localStreamError &&
    (micEnabled || cameraEnabled);

  const handleToggleScreen = useCallback(() => {
    if (screenShare.isSharing) {
      screenShare.stop();
      return;
    }
    void (async () => {
      const result = await screenShare.start();
      if (result.stream) return;
      if (!result.error.cancelled) {
        toast({ variant: "destructive", description: result.error.message });
      }
    })();
  }, [screenShare, toast]);

  const handleStart = useCallback(async () => {
    if (!localStream) {
      toast({
        variant: "destructive",
        description: "Camera and microphone aren't ready yet.",
      });
      return;
    }
    if (!micEnabled && !cameraEnabled) {
      toast({
        variant: "destructive",
        description: "Turn on your camera or microphone before recording.",
      });
      return;
    }
    setErrorMessage(null);
    screenRecResultRef.current = null;
    startedAtRef.current = null;
    setElapsed(0);
    setPhase("recording");
    try {
      await recording.start(localStream);
    } catch (err) {
      console.error("Failed to start recording", err);
      // Surface a controlled, jargon-free message — never the raw underlying
      // error, which can include browser/library internals that violate the
      // forbidden-vocabulary rules in user copy.
      setErrorMessage(
        "Couldn't start recording on this device. Check that your camera and microphone permissions are granted, then try again.",
      );
      setPhase("error");
    }
  }, [localStream, micEnabled, cameraEnabled, recording, toast]);

  const handleStop = useCallback(async () => {
    setPhase("finalizing");
    setFinalizeStep("saving");
    try {
      // Stop screen first so its result is in hand by the time we publish.
      if (screenShare.isSharing) screenShare.stop();
      if (screenRecording.isRecording) {
        const sr = await screenRecording.stop();
        if (sr) screenRecResultRef.current = sr;
      }
      const r = await recording.stop();
      if (!r) {
        setErrorMessage("The recording finished but produced no file.");
        setPhase("error");
        return;
      }
      if (!identity || !pubkey) {
        setErrorMessage("Sign in is required to publish a share link.");
        setPhase("error");
        return;
      }

      setFinalizeStep("publishing");
      const ownerName = displayName || "You";
      const screenResult = screenRecResultRef.current;
      const archive = await publishPersonalArchive(
        identity,
        {
          // Solo Quick-Records aren't tied to a multi-person session, but
          // the archive schema expects a sessionId. Use a stable per-record
          // sentinel so the recipient page can still de-dupe correctly.
          sessionId: `quick-record:${r.recordingId}`,
          sessionTitle: "Quick Record",
          hostName: ownerName,
          endedAt: new Date(),
          isHost: true,
          otherParticipantNames: [],
        },
        {
          recordingId: r.recordingId,
          participantPubkey: pubkey,
          participantName: ownerName,
          blobUrl: r.blobUrl,
          blobHash: r.blobHash,
          mimeType: r.meta.mimeType,
          sizeBytes: r.meta.sizeBytes,
          durationSeconds: r.meta.durationSeconds,
          audio:
            r.audio && r.audio.remoteUrl
              ? {
                  url: r.audio.remoteUrl,
                  hash: r.audio.blobHash || null,
                  sizeBytes: r.audio.sizeBytes,
                  mimeType: r.audio.mimeType,
                }
              : null,
          video:
            r.video && r.video.remoteUrl
              ? {
                  url: r.video.remoteUrl,
                  hash: r.video.blobHash || null,
                  sizeBytes: r.video.sizeBytes,
                  mimeType: r.video.mimeType,
                }
              : null,
          screen:
            screenResult && screenResult.remoteUrl
              ? {
                  url: screenResult.remoteUrl,
                  hash: screenResult.blobHash || null,
                  sizeBytes: screenResult.meta.sizeBytes,
                  mimeType: screenResult.meta.mimeType,
                }
              : null,
          screenDurationSeconds: screenResult?.meta.durationSeconds ?? null,
        },
      );

      const noneAccepted = archive.publish.successCount === 0;
      const partial =
        archive.publish.successCount > 0 &&
        archive.publish.successCount < archive.publish.totalCount;

      if (!noneAccepted) {
        rememberPersonalReceipt({
          archiveId: archive.archiveId,
          pointer: archive.pointer,
          sessionTitle: "Quick Record",
          isHost: true,
          hostName: ownerName,
          otherParticipantNames: [],
          receiptUrl: archive.receiptUrl,
          shareUrl: archive.shareUrl,
          publishedAt: archive.archivedAt,
          ownerPubkey: pubkey,
        });
      }

      setDone({
        shareUrl: archive.shareUrl,
        receiptUrl: archive.receiptUrl,
        publishWarning: noneAccepted
          ? "No sharing servers accepted the link. Your file is saved on this device — try recording again to retry the upload."
          : partial
            ? "Some sharing servers didn't respond, but your link is live."
            : null,
      });
      setPhase("done");

      // Auto-copy the share URL to clipboard.
      try {
        await navigator.clipboard.writeText(archive.shareUrl);
        setCopied(true);
        toast({ description: "Share link copied to your clipboard." });
      } catch {
        // Clipboard can fail in private mode or when the document has lost
        // focus; the URL is still on screen for manual copy.
      }
    } catch (err) {
      console.error("Failed to finalize Quick Record", err);
      // Use a controlled message — raw error text from upstream libraries
      // can include forbidden internal vocabulary.
      setErrorMessage(
        "Couldn't finish saving the recording. Your file is still on this device — try again, or sign out and back in to retry.",
      );
      setPhase("error");
    } finally {
      setFinalizeStep(null);
    }
  }, [
    screenShare,
    screenRecording,
    recording,
    identity,
    pubkey,
    displayName,
    toast,
  ]);

  const handleReset = useCallback(() => {
    recording.reset();
    screenRecording.reset();
    screenRecResultRef.current = null;
    startedAtRef.current = null;
    setElapsed(0);
    setDone(null);
    setErrorMessage(null);
    setCopied(false);
    setPhase("setup");
  }, [recording, screenRecording]);

  const handleCopyAgain = useCallback(async () => {
    if (!done) return;
    try {
      await navigator.clipboard.writeText(done.shareUrl);
      setCopied(true);
      toast({ description: "Copied again." });
    } catch {
      toast({
        variant: "destructive",
        description: "Couldn't access your clipboard. Copy the link manually.",
      });
    }
  }, [done, toast]);

  const screenAvailable = screenShare.isSupported;

  const incrementalSync = recording.incrementalSync;
  const incrementalChip = useMemo(() => {
    if (phase !== "recording") return null;
    if (incrementalSync.total === 0) return "Backing up to your storage…";
    if (incrementalSync.failed > 0) {
      return `Backed up ${incrementalSync.saved} of ${incrementalSync.total} chunks (${incrementalSync.failed} retrying).`;
    }
    return `Backed up ${incrementalSync.saved} of ${incrementalSync.total} chunks.`;
  }, [phase, incrementalSync]);

  if (!isLoaded) return null;
  if (!identity || !pubkey || !displayName) {
    return <SignedOutEmpty context="home" />;
  }

  return (
    <div className="min-h-full w-full">
      <div className="container max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10 md:py-12">
        <div className="mb-6 sm:mb-8">
          <p className="font-mono-vessel text-[11px] uppercase tracking-[0.18em] text-vessel-accent mb-2">
            Quick Record
          </p>
          <h1 className="font-display text-3xl sm:text-4xl md:text-5xl font-bold text-vessel-text-primary tracking-tight leading-[1.1]">
            Record on your own.
          </h1>
          <p className="text-vessel-text-secondary mt-2 sm:mt-3 text-base sm:text-lg max-w-2xl">
            Capture your camera, microphone, and your screen — then share a
            private link in one click. No invite, no scheduling.
          </p>
        </div>

        {phase === "setup" && (
          <SetupView
            cameras={cameras}
            microphones={microphones}
            selectedCameraId={selectedCameraId}
            selectedMicId={selectedMicId}
            setSelectedCameraId={setSelectedCameraId}
            setSelectedMicId={setSelectedMicId}
            micEnabled={micEnabled}
            cameraEnabled={cameraEnabled}
            setMicEnabled={setMicEnabled}
            setCameraEnabled={setCameraEnabled}
            screenAvailable={screenAvailable}
            screenSharing={screenShare.isSharing}
            onToggleScreen={handleToggleScreen}
            previewRef={previewRef}
            screenPreviewRef={screenPreviewRef}
            localStreamError={localStreamError}
            onStart={handleStart}
            canRecord={canRecord}
          />
        )}

        {(phase === "recording" || phase === "finalizing") && (
          <RecordingView
            previewRef={previewRef}
            screenPreviewRef={screenPreviewRef}
            cameraEnabled={cameraEnabled}
            micEnabled={micEnabled}
            screenSharing={screenShare.isSharing}
            screenAvailable={screenAvailable}
            elapsed={elapsed}
            onToggleMic={() => setMicEnabled((v) => !v)}
            onToggleCamera={() => setCameraEnabled((v) => !v)}
            onToggleScreen={handleToggleScreen}
            onStop={handleStop}
            phase={phase}
            finalizeStep={finalizeStep}
            incrementalChip={incrementalChip}
          />
        )}

        {phase === "done" && done && (
          <DoneView
            shareUrl={done.shareUrl}
            receiptUrl={done.receiptUrl}
            publishWarning={done.publishWarning}
            copied={copied}
            onCopyAgain={handleCopyAgain}
            onRecordAnother={handleReset}
          />
        )}

        {phase === "error" && (
          <ErrorView
            message={
              errorMessage ?? "Something went wrong while recording."
            }
            onRetry={handleReset}
          />
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Subviews
// ──────────────────────────────────────────────────────────────────────────

type SetupViewProps = {
  cameras: ReturnType<typeof useMediaDevices>["cameras"];
  microphones: ReturnType<typeof useMediaDevices>["microphones"];
  selectedCameraId: string | null;
  selectedMicId: string | null;
  setSelectedCameraId: (id: string | null) => void;
  setSelectedMicId: (id: string | null) => void;
  micEnabled: boolean;
  cameraEnabled: boolean;
  setMicEnabled: (v: boolean) => void;
  setCameraEnabled: (v: boolean) => void;
  screenAvailable: boolean;
  screenSharing: boolean;
  onToggleScreen: () => void;
  previewRef: React.MutableRefObject<HTMLVideoElement | null>;
  screenPreviewRef: React.MutableRefObject<HTMLVideoElement | null>;
  localStreamError: string | null;
  onStart: () => void;
  canRecord: boolean;
};

function SetupView({
  cameras,
  microphones,
  selectedCameraId,
  selectedMicId,
  setSelectedCameraId,
  setSelectedMicId,
  micEnabled,
  cameraEnabled,
  setMicEnabled,
  setCameraEnabled,
  screenAvailable,
  screenSharing,
  onToggleScreen,
  previewRef,
  screenPreviewRef,
  localStreamError,
  onStart,
  canRecord,
}: SetupViewProps) {
  return (
    <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6">
      <VesselCard className="p-4 sm:p-6">
        <div className="aspect-video w-full rounded-xl overflow-hidden bg-vessel-bg-base border border-vessel-border relative">
          {cameraEnabled ? (
            <video
              ref={previewRef}
              autoPlay
              muted
              playsInline
              // Mirror the self-view so the user sees themselves like in a
              // mirror (matches Zoom / Loom / Riverside). The recorded file
              // is unaffected — only the live preview is flipped via CSS.
              className="w-full h-full object-cover -scale-x-100"
              data-testid="video-camera-preview"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-vessel-text-muted gap-2">
              <VideoOff className="w-10 h-10" />
              <span className="text-sm">Camera off</span>
            </div>
          )}
          {screenSharing && (
            <div className="absolute bottom-3 right-3 w-32 sm:w-40 aspect-video rounded-lg overflow-hidden border border-vessel-accent/40 bg-vessel-bg-base shadow-lg">
              <video
                ref={screenPreviewRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-contain"
                data-testid="video-screen-preview"
              />
            </div>
          )}
        </div>
        {localStreamError && (
          <div className="mt-3 flex items-start gap-2 p-3 rounded-lg bg-vessel-red/10 border border-vessel-red/30 text-sm text-vessel-red">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{localStreamError}</span>
          </div>
        )}
      </VesselCard>

      <div className="flex flex-col gap-4">
        <VesselCard className="p-5">
          <h3 className="font-display text-base font-bold text-vessel-text-primary mb-3">
            What to capture
          </h3>
          <div className="flex flex-col gap-3">
            <ToggleRow
              label="Camera"
              icon={cameraEnabled ? Video : VideoOff}
              active={cameraEnabled}
              onClick={() => setCameraEnabled(!cameraEnabled)}
              testId="toggle-camera"
            />
            <DeviceSelect
              value={selectedCameraId}
              onChange={setSelectedCameraId}
              devices={cameras}
              disabled={!cameraEnabled}
              placeholder="Default camera"
              testId="select-camera"
            />
            <ToggleRow
              label="Microphone"
              icon={micEnabled ? Mic : MicOff}
              active={micEnabled}
              onClick={() => setMicEnabled(!micEnabled)}
              testId="toggle-mic"
            />
            <DeviceSelect
              value={selectedMicId}
              onChange={setSelectedMicId}
              devices={microphones}
              disabled={!micEnabled}
              placeholder="Default microphone"
              testId="select-mic"
            />
            {screenAvailable ? (
              <ToggleRow
                label={screenSharing ? "Stop sharing screen" : "Share your screen"}
                icon={screenSharing ? MonitorOff : MonitorPlay}
                active={screenSharing}
                onClick={onToggleScreen}
                testId="toggle-screen"
              />
            ) : (
              <div className="text-xs text-vessel-text-muted px-1">
                Screen capture isn't available on this device. Use a desktop
                browser to record your screen.
              </div>
            )}
          </div>
        </VesselCard>

        {screenAvailable && (
          <VesselCard className="p-5 border-vessel-accent/20">
            <div className="flex items-start gap-2 text-sm text-vessel-text-secondary">
              <Info className="w-4 h-4 text-vessel-accent shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-vessel-text-primary mb-1">
                  Want to capture audio playing from your computer?
                </p>
                <p className="leading-relaxed">
                  When the picker opens, choose <strong>Entire Screen</strong>{" "}
                  or <strong>A Tab</strong> and tick <strong>Share audio</strong>.
                  Window-only sharing won't include the sound. This works in
                  Chrome and Edge — Safari and Firefox can't capture computer
                  audio yet.
                </p>
              </div>
            </div>
          </VesselCard>
        )}

        <VesselButton
          size="lg"
          onClick={onStart}
          disabled={!canRecord}
          data-testid="button-start-record"
          className="w-full"
        >
          <RecordingDot animated={false} className="mr-2" />
          Start recording
        </VesselButton>
      </div>
    </div>
  );
}

type RecordingViewProps = {
  previewRef: React.MutableRefObject<HTMLVideoElement | null>;
  screenPreviewRef: React.MutableRefObject<HTMLVideoElement | null>;
  cameraEnabled: boolean;
  micEnabled: boolean;
  screenSharing: boolean;
  screenAvailable: boolean;
  elapsed: number;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleScreen: () => void;
  onStop: () => void;
  phase: "recording" | "finalizing";
  finalizeStep: FinalizeStep;
  incrementalChip: string | null;
};

function RecordingView({
  previewRef,
  screenPreviewRef,
  cameraEnabled,
  micEnabled,
  screenSharing,
  screenAvailable,
  elapsed,
  onToggleMic,
  onToggleCamera,
  onToggleScreen,
  onStop,
  phase,
  finalizeStep,
  incrementalChip,
}: RecordingViewProps) {
  const finalizing = phase === "finalizing";
  return (
    <VesselCard className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <RecordingDot animated={!finalizing} />
          <span
            className="font-mono-vessel text-sm text-vessel-text-primary tabular-nums"
            data-testid="text-elapsed"
          >
            {formatSeconds(elapsed)}
          </span>
          {finalizing && (
            <span className="text-xs text-vessel-text-muted ml-2 flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {finalizeStep === "publishing"
                ? "Publishing share link…"
                : "Saving recording…"}
            </span>
          )}
        </div>
        {incrementalChip && (
          <span className="text-xs text-vessel-text-muted hidden sm:inline">
            {incrementalChip}
          </span>
        )}
      </div>

      <div className="aspect-video w-full rounded-xl overflow-hidden bg-vessel-bg-base border border-vessel-border relative">
        {cameraEnabled ? (
          <video
            ref={previewRef}
            autoPlay
            muted
            playsInline
            // Mirror the self-view (see SetupView for rationale). The
            // recorded file stays un-mirrored — this is preview-only CSS.
            className="w-full h-full object-cover -scale-x-100"
            data-testid="video-camera-preview-live"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-vessel-text-muted gap-2">
            <VideoOff className="w-10 h-10" />
            <span className="text-sm">Camera off</span>
          </div>
        )}
        {screenSharing && (
          <div className="absolute bottom-3 right-3 w-36 sm:w-48 aspect-video rounded-lg overflow-hidden border border-vessel-accent/40 bg-vessel-bg-base shadow-lg">
            <video
              ref={screenPreviewRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-contain"
              data-testid="video-screen-preview-live"
            />
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <VesselButton
          variant="muted"
          size="md"
          onClick={onToggleMic}
          disabled={finalizing}
          data-testid="button-toggle-mic"
        >
          {micEnabled ? <Mic className="w-4 h-4 mr-2" /> : <MicOff className="w-4 h-4 mr-2" />}
          {micEnabled ? "Mute" : "Unmute"}
        </VesselButton>
        <VesselButton
          variant="muted"
          size="md"
          onClick={onToggleCamera}
          disabled={finalizing}
          data-testid="button-toggle-camera"
        >
          {cameraEnabled ? <Video className="w-4 h-4 mr-2" /> : <VideoOff className="w-4 h-4 mr-2" />}
          {cameraEnabled ? "Hide camera" : "Show camera"}
        </VesselButton>
        {screenAvailable && (
          <VesselButton
            variant="muted"
            size="md"
            onClick={onToggleScreen}
            disabled={finalizing}
            data-testid="button-toggle-screen-live"
          >
            {screenSharing ? <MonitorOff className="w-4 h-4 mr-2" /> : <MonitorPlay className="w-4 h-4 mr-2" />}
            {screenSharing ? "Stop screen" : "Share screen"}
          </VesselButton>
        )}
        <VesselButton
          variant="danger"
          size="md"
          onClick={onStop}
          disabled={finalizing}
          data-testid="button-stop-record"
        >
          <Square className="w-4 h-4 mr-2 fill-current" />
          Stop & share
        </VesselButton>
      </div>
    </VesselCard>
  );
}

type DoneViewProps = {
  shareUrl: string;
  receiptUrl: string;
  publishWarning: string | null;
  copied: boolean;
  onCopyAgain: () => void;
  onRecordAnother: () => void;
};

function DoneView({
  shareUrl,
  receiptUrl,
  publishWarning,
  copied,
  onCopyAgain,
  onRecordAnother,
}: DoneViewProps) {
  return (
    <VesselCard className="p-5 sm:p-6 border-vessel-accent/40 shadow-[0_0_30px_rgba(0,212,170,0.12)]">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-full bg-vessel-accent/15 flex items-center justify-center">
          <Check className="w-4 h-4 text-vessel-accent" />
        </div>
        <h2 className="font-display text-xl font-bold text-vessel-text-primary">
          Your recording is ready.
        </h2>
      </div>
      <p className="text-vessel-text-secondary text-sm mb-4">
        We've copied the share link to your clipboard. Anyone you send it to
        can watch and download — only with this exact link.
      </p>

      {publishWarning && (
        <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-vessel-amber/10 border border-vessel-amber/30 text-sm text-vessel-text-primary">
          <AlertTriangle className="w-4 h-4 text-vessel-amber shrink-0 mt-0.5" />
          <span>{publishWarning}</span>
        </div>
      )}

      <div className="bg-vessel-bg-base border border-vessel-border rounded-xl p-3 font-mono-vessel text-xs sm:text-sm text-vessel-text-secondary overflow-hidden text-ellipsis whitespace-nowrap mb-4" data-testid="text-share-url">
        {shareUrl}
      </div>

      <div className="flex flex-wrap gap-2">
        <VesselButton
          variant="ghost"
          size="md"
          onClick={onCopyAgain}
          data-testid="button-copy-share-url"
        >
          {copied ? (
            <Check className="w-4 h-4 mr-2 text-vessel-green" />
          ) : (
            <Copy className="w-4 h-4 mr-2" />
          )}
          {copied ? "Copied" : "Copy link"}
        </VesselButton>
        <VesselButton
          variant="ghost"
          size="md"
          onClick={() => window.open(receiptUrl, "_blank")}
          data-testid="button-open-receipt"
        >
          Open receipt page
          <ArrowRight className="w-4 h-4 ml-2" />
        </VesselButton>
        <VesselButton
          size="md"
          onClick={onRecordAnother}
          data-testid="button-record-another"
        >
          Record another
        </VesselButton>
      </div>
    </VesselCard>
  );
}

function ErrorView({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <VesselCard className="p-5 sm:p-6 border-vessel-red/30">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-vessel-red shrink-0 mt-0.5" />
        <div className="flex-1">
          <h2 className="font-display text-lg font-bold text-vessel-text-primary mb-1">
            Recording didn't finish
          </h2>
          <p className="text-vessel-text-secondary text-sm mb-4">{message}</p>
          <VesselButton
            variant="ghost"
            size="md"
            onClick={onRetry}
            data-testid="button-error-retry"
          >
            Try again
          </VesselButton>
        </div>
      </div>
    </VesselCard>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Tiny helpers
// ──────────────────────────────────────────────────────────────────────────

function ToggleRow({
  label,
  icon: Icon,
  active,
  onClick,
  testId,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-left transition-colors ${
        active
          ? "bg-vessel-accent/10 border-vessel-accent/40 text-vessel-text-primary"
          : "bg-vessel-bg-base border-vessel-border text-vessel-text-secondary hover:text-vessel-text-primary"
      }`}
    >
      <span className="flex items-center gap-3">
        <Icon className={`w-4 h-4 ${active ? "text-vessel-accent" : ""}`} />
        <span className="text-sm font-medium">{label}</span>
      </span>
      <span
        className={`w-9 h-5 rounded-full relative transition-colors ${
          active ? "bg-vessel-accent" : "bg-vessel-bg-elevated"
        }`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
            active ? "translate-x-[18px]" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );
}

function DeviceSelect({
  value,
  onChange,
  devices,
  disabled,
  placeholder,
  testId,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  devices: { deviceId: string; label: string }[];
  disabled?: boolean;
  placeholder: string;
  testId: string;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={disabled}
      data-testid={testId}
      className="w-full bg-vessel-bg-base border border-vessel-border text-vessel-text-primary text-sm rounded-xl px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-vessel-accent disabled:opacity-50"
    >
      <option value="">{placeholder}</option>
      {devices.map((d) => (
        <option key={d.deviceId} value={d.deviceId}>
          {d.label || "Unknown device"}
        </option>
      ))}
    </select>
  );
}
