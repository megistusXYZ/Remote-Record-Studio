import { useState, useEffect, useRef, useMemo } from "react";
import { AlertTriangle, X, Users, Settings } from "lucide-react";
import { useIdentity } from "../../hooks/use-identity";
import { useMediaDevices, useLocalStream } from "../../hooks/use-media-devices";
import { useRecording } from "../../hooks/use-recording";
import { useKeyboardShortcuts, type Shortcut } from "../../hooks/use-keyboard-shortcuts";
import { isWebTransportAvailable, useConnectionQuality, getConnectionQualityLabel } from "../../lib/moq";
import { buildInviteUrl } from "../../lib/session";
import { InviteModal } from "../lobby/InviteModal";
import { RecordingDot } from "../vessel-ui/RecordingDot";
import { VesselBadge } from "../vessel-ui/VesselBadge";
import { VideoGrid } from "./VideoGrid";
import { VideoTile } from "./VideoTile";
import { ControlBar } from "./ControlBar";
import { SessionComplete, type Track } from "./SessionComplete";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useCreateRecording } from "@workspace/api-client-react";

export type StudioScreenProps = {
  session: {
    id: string;
    title: string;
    status: "waiting" | "live" | "ended";
    inviteCode: string;
    hostPubkey: string;
    hostName: string;
    participants: Array<{ id: string; displayName: string; pubkey: string; role: "host" | "guest" }>;
  };
  isHost: boolean;
  onStartRecording: () => Promise<void>;
  onStopRecording: () => Promise<void>;
  onLeave: () => Promise<void> | void;
  onViewVault: () => void;
  onStartNewSession: () => void;
  onEnterEndingFlow?: () => void;
  isStartingRecording?: boolean;
  isStoppingRecording?: boolean;
};

function formatSeconds(s: number): string {
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;

  const mmss = `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  if (hrs > 0) return `${hrs.toString().padStart(2, "0")}:${mmss}`;
  return mmss;
}

export function StudioScreen({
  session,
  isHost,
  onStartRecording,
  onStopRecording,
  onLeave,
  onViewVault,
  onStartNewSession,
  onEnterEndingFlow,
  isStartingRecording,
  isStoppingRecording,
}: StudioScreenProps) {
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showWebTransportBanner, setShowWebTransportBanner] = useState(!isWebTransportAvailable());
  const [showSessionComplete, setShowSessionComplete] = useState(false);

  const { pubkey: currentPubkey, displayName } = useIdentity();
  const connQuality = useConnectionQuality();
  const recording = useRecording();
  const createRecordingMutation = useCreateRecording();
  const recordingStartedRef = useRef(false);
  const recordingPersistedRef = useRef(false);
  const persistPromiseRef = useRef<Promise<unknown> | null>(null);
  const guestEndingShownRef = useRef(false);

  const {
    cameras,
    microphones,
    selectedCameraId,
    selectedMicId,
    setSelectedCameraId,
    setSelectedMicId,
  } = useMediaDevices();

  const { stream: localStream, error: localStreamError } = useLocalStream({
    cameraId: selectedCameraId,
    micId: selectedMicId,
    cameraEnabled,
    micEnabled,
  });
  const [showMediaErrorBanner, setShowMediaErrorBanner] = useState(true);
  useEffect(() => {
    if (localStreamError) setShowMediaErrorBanner(true);
  }, [localStreamError]);

  useEffect(() => {
    if (session.status !== "live") {
      setRecordingSeconds(0);
      return;
    }
    const start = Date.now();
    const interval = setInterval(() => {
      setRecordingSeconds(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [session.status]);

  // Auto-start the local recorder once the session is live and the local stream is ready.
  // Sets the ref to `true` BEFORE start to prevent double-fire on rapid re-renders, but
  // resets it on failure so the user can retry by re-toggling devices.
  useEffect(() => {
    if (
      session.status === "live" &&
      localStream &&
      !recordingStartedRef.current &&
      !recording.isRecording &&
      !recording.result &&
      recording.isSupported
    ) {
      recordingStartedRef.current = true;
      void recording.start(localStream).catch(() => {
        recordingStartedRef.current = false;
      });
    }
  }, [session.status, localStream, recording]);

  // Reset persistence guards when the session id changes (e.g., a new session in the same tab).
  useEffect(() => {
    recordingStartedRef.current = false;
    recordingPersistedRef.current = false;
    persistPromiseRef.current = null;
    guestEndingShownRef.current = false;
  }, [session.id]);

  // After sync completes, persist the recording metadata to the API once.
  // We capture the mutation promise on a ref so navigation handlers can await it
  // before unmounting (avoids losing tracks for guests who get redirected).
  useEffect(() => {
    if (
      recording.result &&
      !recordingPersistedRef.current &&
      (recording.syncStatus === "complete" || recording.syncStatus === "partial-failure")
    ) {
      recordingPersistedRef.current = true;
      const r = recording.result;
      const p = createRecordingMutation
        .mutateAsync({
          data: {
            sessionId: session.id,
            sessionTitle: session.title,
            ownerPubkey: currentPubkey || "",
            participantName: displayName || "Anonymous",
            durationSeconds: r.meta.durationSeconds,
            sizeBytes: r.meta.sizeBytes,
            mimeType: r.meta.mimeType,
            blobHash: r.blobHash || null,
            blobUrl: r.blobUrl,
            status: "ready",
          },
        })
        .catch((err) => {
          console.error("Failed to save recording metadata", err);
        });
      persistPromiseRef.current = p;
    }
  }, [recording.result, recording.syncStatus, createRecordingMutation, session.id, session.title, currentPubkey, displayName]);

  // Guests: when the host ends the session externally and a guest is mid-recording,
  // show the SessionComplete (guest variant) so their track is finalized + persisted
  // before they navigate away. Also signal the parent to suppress the auto-redirect.
  useEffect(() => {
    if (
      !isHost &&
      session.status === "ended" &&
      !guestEndingShownRef.current &&
      (recording.isRecording || recording.isFinalizing || recording.isSyncing || recording.result)
    ) {
      guestEndingShownRef.current = true;
      onEnterEndingFlow?.();
      setShowSessionComplete(true);
      if (recording.isRecording) {
        void recording.stop().catch((err) => {
          console.error("Failed to finalize guest recording", err);
        });
      }
    }
  }, [isHost, session.status, recording, onEnterEndingFlow]);

  const handleStartRecording = () => {
    void onStartRecording();
  };

  const handleStopRecording = async () => {
    if (isHost) {
      onEnterEndingFlow?.();
      setShowSessionComplete(true);
      try {
        await recording.stop();
      } catch (err) {
        console.error("Failed to stop recording", err);
      }
    } else {
      void onStopRecording();
    }
  };

  // Keyboard shortcuts: M = mic, V = camera, Space = record (host).
  // Skip when an input is focused, when the SessionComplete overlay is shown,
  // or when the invite modal is open (Escape handles modal close natively).
  const shortcutsEnabled = !showSessionComplete && !showInviteModal;
  const shortcuts = useMemo<Shortcut[]>(
    () => [
      {
        key: "m",
        handler: () => setMicEnabled((v) => !v),
      },
      {
        key: "v",
        handler: () => setCameraEnabled((v) => !v),
      },
      {
        key: " ",
        preventDefault: true,
        handler: () => {
          if (!isHost) return;
          if (session.status === "live") {
            void handleStopRecording();
          } else if (session.status === "waiting") {
            handleStartRecording();
          }
        },
      },
    ],
    // handleStopRecording / handleStartRecording are stable enough — re-binding on
    // every render is fine because the hook strips and re-attaches the listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isHost, session.status]
  );
  useKeyboardShortcuts(shortcuts, shortcutsEnabled);

  // Wait for the metadata POST to complete (or fail) before navigating away,
  // so we don't lose track records on unmount.
  const awaitPersistence = async () => {
    if (persistPromiseRef.current) {
      try {
        await persistPromiseRef.current;
      } catch {
        // already logged in the persistence effect
      }
    }
  };

  const handleViewVault = async () => {
    await awaitPersistence();
    setShowSessionComplete(false);
    if (isHost) {
      await onStopRecording();
    } else {
      onViewVault();
    }
  };

  const handleStartNew = async () => {
    await awaitPersistence();
    setShowSessionComplete(false);
    if (isHost) {
      await onStopRecording();
    }
    onStartNewSession();
  };

  // Guest "Close" button — finalize persistence then navigate to their vault.
  const handleGuestClose = async () => {
    await awaitPersistence();
    setShowSessionComplete(false);
    onViewVault();
  };

  const handleLeave = () => {
    void onLeave();
  };

  // Build the SessionComplete tracks array (currently only the local user's track is captured).
  // `storageState` mirrors recording.syncStatus so the per-track chip surfaces
  // whether the track landed on the participant's storage server or fell back
  // to local-only.
  const localParticipant = session.participants.find((p) => p.pubkey === currentPubkey);
  const trackStorageState: "remote" | "local-only" | "unknown" =
    recording.syncStatus === "complete"
      ? "remote"
      : recording.syncStatus === "partial-failure"
      ? // If at least one mid-recording slice made it through, treat the
        // track as remotely persisted even if the final-blob upload failed —
        // user can recover from slices.
        (recording.result && recording.result.incrementalSaved > 0)
        ? "remote"
        : "local-only"
      : "unknown";

  const sessionCompleteTracks: Track[] = recording.result && localParticipant
    ? [{
        participantId: localParticipant.id,
        participantName: localParticipant.displayName,
        participantPubkey: localParticipant.pubkey,
        recordingId: recording.result.recordingId,
        blob: recording.result.blob,
        durationSeconds: recording.result.meta.durationSeconds,
        sizeBytes: recording.result.meta.sizeBytes,
        mimeType: recording.result.meta.mimeType,
        hasVideo: recording.result.meta.hasVideo,
        storageState: trackStorageState,
      }]
    : localParticipant
    ? [{
        participantId: localParticipant.id,
        participantName: localParticipant.displayName,
        participantPubkey: localParticipant.pubkey,
        recordingId: null,
        blob: null,
        durationSeconds: recordingSeconds,
        sizeBytes: 0,
        mimeType: "video/webm",
        hasVideo: true,
        storageState: "unknown",
      }]
    : [];

  const connQualityColor =
    connQuality === "good" ? "bg-vessel-accent" :
    connQuality === "fair" ? "bg-vessel-amber" :
    connQuality === "poor" ? "bg-vessel-red" : "bg-vessel-text-muted";

  return (
    <TooltipProvider>
      <div className="fixed inset-0 flex flex-col bg-vessel-bg-base text-vessel-text-primary selection:bg-vessel-accent/30 selection:text-vessel-accent overflow-hidden">
        {/* Header */}
        <header className="h-12 border-b border-vessel-border bg-vessel-bg-base/60 backdrop-blur-xl flex items-center justify-between px-4 z-20 shrink-0">
          {/* Left */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-vessel-accent/10 flex items-center justify-center">
                  <div className="w-[2.5px] h-[2.5px] rounded-full bg-vessel-accent" />
                </div>
                <span className="font-display font-bold text-sm tracking-tight">Vessel</span>
              </div>
              <span className="text-vessel-text-muted">/</span>
              <span className="text-sm font-medium truncate max-w-[300px]">
                {session.title}
              </span>
            </div>
          </div>

          {/* Center */}
          <div className="flex items-center gap-2">
            {session.status === "live" ? (
              <>
                <RecordingDot size="sm" />
                <span className="font-mono-vessel text-xs text-vessel-red font-medium">
                  Recording · {formatSeconds(recordingSeconds)}
                </span>
              </>
            ) : (
              <>
                <div className="w-2 h-2 rounded-full bg-vessel-accent shadow-[0_0_8px_rgba(0,212,170,0.4)]" />
                <span className="text-xs text-vessel-text-secondary font-medium">
                  Ready to record
                </span>
              </>
            )}
          </div>

          {/* Right */}
          <div className="flex items-center gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="hover:bg-vessel-bg-surface px-2 py-1 rounded-md flex items-center gap-1 cursor-default transition-colors">
                  <div className={cn("w-1 h-1 rounded-full", connQualityColor)} />
                  <div className={cn("w-1 h-1 rounded-full", connQualityColor, connQuality === "poor" && "opacity-30")} />
                  <div className={cn("w-1 h-1 rounded-full", connQualityColor, (connQuality === "poor" || connQuality === "fair") && "opacity-30")} />
                </div>
              </TooltipTrigger>
              <TooltipContent>{getConnectionQualityLabel(connQuality)}</TooltipContent>
            </Tooltip>

            <VesselBadge variant="default" className="hidden sm:inline-flex">
              <Users className="w-3 h-3 mr-1.5" />
              {session.participants.length}
            </VesselBadge>

            <button
              data-testid="button-header-settings"
              className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-vessel-bg-surface transition-colors"
            >
              <Settings className="w-4 h-4 text-vessel-text-secondary" />
            </button>
          </div>
        </header>

        {/* Media permission/error banner */}
        {localStreamError && showMediaErrorBanner && (
          <div
            data-testid="banner-media-error"
            className="bg-vessel-red/10 border-b border-vessel-red/20 px-4 py-2 flex items-center justify-between shrink-0 z-10"
          >
            <div className="flex items-center gap-2 text-sm text-vessel-red">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{localStreamError}</span>
            </div>
            <button
              onClick={() => setShowMediaErrorBanner(false)}
              className="text-vessel-red/70 hover:text-vessel-red p-1 rounded-md transition-colors shrink-0"
              data-testid="button-dismiss-media-error"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* WebTransport Degradation Banner */}
        {showWebTransportBanner && (
          <div className="bg-vessel-amber/10 border-b border-vessel-amber/20 px-4 py-2 flex items-center justify-between shrink-0 z-10">
            <div className="flex items-center gap-2 text-sm text-vessel-amber">
              <AlertTriangle className="w-4 h-4" />
              <span>Live preview is limited in this browser. Your recording will still be full quality.</span>
            </div>
            <button
              onClick={() => setShowWebTransportBanner(false)}
              className="text-vessel-amber/70 hover:text-vessel-amber p-1 rounded-md transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Main Area */}
        <main className="flex-1 overflow-hidden relative pb-20">
          <VideoGrid participantCount={session.participants.length}>
            {session.participants.map((p) => {
              const isLocal = p.pubkey === currentPubkey;
              return (
                <VideoTile
                  key={p.id}
                  participant={p}
                  stream={isLocal ? localStream : undefined}
                  isLocal={isLocal}
                  micEnabled={isLocal ? micEnabled : true} // remote participants default true for now
                  cameraEnabled={isLocal ? cameraEnabled : true}
                  audioLevel={isLocal ? (micEnabled ? 0.5 : 0) : 0.5} // mocked audio level for now
                />
              );
            })}
          </VideoGrid>
        </main>

        <ControlBar
          micEnabled={micEnabled}
          onToggleMic={() => setMicEnabled(!micEnabled)}
          cameraEnabled={cameraEnabled}
          onToggleCamera={() => setCameraEnabled(!cameraEnabled)}
          isRecording={session.status === "live"}
          recordingSeconds={recordingSeconds}
          isHost={isHost}
          isStartingRecording={isStartingRecording}
          isStoppingRecording={isStoppingRecording}
          onStartRecording={handleStartRecording}
          onStopRecording={handleStopRecording}
          onOpenInvite={() => setShowInviteModal(true)}
          onLeave={handleLeave}
          cameras={cameras}
          microphones={microphones}
          selectedCameraId={selectedCameraId}
          selectedMicId={selectedMicId}
          onSelectCamera={setSelectedCameraId}
          onSelectMic={setSelectedMicId}
          previewStream={localStream}
        />

        <InviteModal
          open={showInviteModal}
          onOpenChange={setShowInviteModal}
          inviteUrl={buildInviteUrl(session.inviteCode)}
          inviteCode={session.inviteCode}
        />

        <SessionComplete
          open={showSessionComplete}
          isHost={isHost}
          hostName={session.hostName}
          syncStatus={recording.syncStatus}
          syncProgress={recording.syncProgress}
          tracks={sessionCompleteTracks}
          onViewVault={handleViewVault}
          onStartNew={handleStartNew}
          onClose={handleGuestClose}
        />
      </div>
    </TooltipProvider>
  );
}
