import { useState, useEffect, useRef, useMemo } from "react";
import { AlertTriangle, X, MonitorPlay } from "lucide-react";
import { useIdentity } from "../../hooks/use-identity";
import { useMediaDevices, useLocalStream } from "../../hooks/use-media-devices";
import { useRecording } from "../../hooks/use-recording";
import { useScreenRecording, type ScreenRecordingResult } from "../../hooks/use-screen-recording";
import { useKeyboardShortcuts, type Shortcut } from "../../hooks/use-keyboard-shortcuts";
import { useLiveTransport } from "../../hooks/use-live-transport";
import { useCallSignal, type ConnectionQuality } from "../../hooks/use-call-signal";
import { useScreenShare } from "../../hooks/use-screen-share";
import { getConnectionQualityLabel } from "../../lib/moq";
import { buildInviteUrl } from "../../lib/session";
import { InviteModal } from "../lobby/InviteModal";
import { RecordingDot } from "../vessel-ui/RecordingDot";
import { VesselBrandIcon } from "../icons/VesselBrandIcon";
import { VideoGrid } from "./VideoGrid";
import { VideoTile } from "./VideoTile";
import { SpotlightView, type SpotlightTile } from "./SpotlightView";
import { ControlBar } from "./ControlBar";
import { RosterSidePanel, type RosterParticipant } from "./RosterSidePanel";
import { SessionComplete, type Track, type PersonalArchiveStatus } from "./SessionComplete";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "../../hooks/use-toast";
import { cn } from "@/lib/utils";
import { useCreateRecording } from "@workspace/api-client-react";
import { publishPersonalArchive } from "../../lib/session-archive";
import { rememberPersonalReceipt } from "../../lib/personal-receipts";
import {
  deriveHostRowStorageState,
  publishPersonalArchivePointer,
  shouldPublishPersonalArchive,
  useHostAggregatedTracks,
} from "../../hooks/use-host-aggregated-tracks";
import {
  readStoredJoinWithMic,
  readStoredJoinWithCamera,
} from "../../hooks/use-join-prefs";

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
  const [micEnabled, setMicEnabled] = useState(() => readStoredJoinWithMic());
  const [cameraEnabled, setCameraEnabled] = useState(() => readStoredJoinWithCamera());
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showSessionComplete, setShowSessionComplete] = useState(false);
  const [sessionEndedAtMs, setSessionEndedAtMs] = useState<number | null>(null);
  useEffect(() => {
    if (session.status === "ended") {
      setSessionEndedAtMs((prev) => prev ?? Date.now());
    } else {
      setSessionEndedAtMs(null);
    }
  }, [session.status]);
  const [personalArchive, setPersonalArchive] = useState<PersonalArchiveStatus>({ status: "idle" });
  const [showRoster, setShowRoster] = useState(false);
  const { toast } = useToast();

  const { identity, pubkey: currentPubkey, displayName } = useIdentity();
  const recording = useRecording();
  // Separate recorder for screen-share clips. Lives alongside `recording`
  // so a failure of the screen recorder never aborts the camera/audio
  // recorder, and a failure of the camera/audio recorder never aborts an
  // in-progress screen capture. Multiple shares per session are supported
  // by retaining the most recent `ScreenRecordingResult` — the schema and
  // archive carry one screen track per participant per session.
  const screenRecording = useScreenRecording();
  const [screenRecResult, setScreenRecResult] = useState<ScreenRecordingResult | null>(null);
  const createRecordingMutation = useCreateRecording();
  const recordingStartedRef = useRef(false);
  const recordingPersistedRef = useRef(false);
  const persistPromiseRef = useRef<Promise<unknown> | null>(null);
  const guestEndingShownRef = useRef(false);
  const personalArchivePublishedRef = useRef(false);

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

  // Screen-share capture lifecycle. Surfaces a friendly toast on failure;
  // the captured stream is broadcast through the live transport below.
  // Stop on session end so a guest who's still sharing when the host
  // wraps up doesn't keep the capture alive in the background.
  const screenShare = useScreenShare();
  // Wall-clock timestamp captured at the moment our local share started.
  // Mirrored into outbound presence heartbeats so peers can render the
  // sharer's badge and arbitrate handoffs (newer-wins for take-overs).
  const [screenShareStartedAtMs, setScreenShareStartedAtMs] = useState<number | null>(null);
  // Pending "Take over from X?" confirmation. Captured at click-time so
  // the dialog body remains stable even if the remote sharer flickers
  // off mid-prompt.
  // First-run privacy heads-up — surfaced once before this device's
  // first screen-share. Stored under a stable key so the user never
  // sees it twice. Intentionally LocalStorage (not server-side): this
  // is a per-browser nudge, not a profile preference.
  const SCREEN_SHARE_HEADSUP_KEY = "vessel.studio.screen-share-headsup-seen.v1";
  const [showScreenSharePrivacy, setShowScreenSharePrivacy] = useState(false);
  const hasSeenScreenSharePrivacy = (): boolean => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem(SCREEN_SHARE_HEADSUP_KEY) === "1";
    } catch {
      // Private-mode browsers throw on localStorage access; treat as
      // "already seen" to avoid blocking the share flow indefinitely.
      return true;
    }
  };
  const markScreenSharePrivacySeen = () => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(SCREEN_SHARE_HEADSUP_KEY, "1");
    } catch {
      // Private mode — silently ignore. The dialog still won't reappear
      // in this tab because the React state already advanced.
    }
  };

  const [pendingTakeover, setPendingTakeover] = useState<
    { displayName: string } | null
  >(null);
  useEffect(() => {
    if (!screenShare.isSharing) {
      if (screenShareStartedAtMs !== null) setScreenShareStartedAtMs(null);
    } else if (screenShareStartedAtMs == null) {
      setScreenShareStartedAtMs(Date.now());
    }
  }, [screenShare.isSharing, screenShareStartedAtMs]);

  const liveTransport = useLiveTransport({
    sessionId: session.id,
    selfPubkey: currentPubkey,
    localStream,
    screenStream: screenShare.stream,
    enabled: session.status === "live" || session.status === "waiting",
  });
  useEffect(() => {
    if (session.status === "ended" && screenShare.isSharing) {
      screenShare.stop();
    }
  }, [session.status, screenShare]);

  /** Start screen-sharing for real (helper used both by the direct path and
   *  the post-confirmation take-over path). Surfaces friendly toasts on
   *  failure and silently ignores the user's own cancel of the OS picker. */
  const beginScreenShare = () => {
    void (async () => {
      const captured = await screenShare.start();
      if (!captured) {
        const err = screenShare.error;
        if (err && !err.cancelled) {
          toast({ variant: "destructive", description: err.message });
        }
      }
    })();
  };
  const connQuality = liveTransport.quality;

  const signalQuality: ConnectionQuality =
    connQuality === "good" || connQuality === "fair" || connQuality === "poor"
      ? connQuality
      : "unknown";
  const hostPubkey = useMemo(
    () => session.participants.find((p) => p.role === "host")?.pubkey ?? null,
    [session.participants],
  );
  const callSignal = useCallSignal({
    sessionId: session.id,
    identity,
    myDisplayName: displayName || "You",
    myMicEnabled: micEnabled,
    myCameraEnabled: cameraEnabled,
    myScreenSharing: screenShare.isSharing,
    myScreenSharingStartedAtMs: screenShareStartedAtMs,
    myQuality: signalQuality,
    enabled: session.status !== "ended",
    hostPubkey,
  });

  // The other participant currently broadcasting a screen-share, if any.
  // Used both to disable our share button (so two people don't fight for
  // the spotlight) and to power the "Take over from X?" confirmation
  // dialog. When multiple peers somehow claim the share at once we pick
  // the one who started earliest (oldest-wins for stable arbitration).
  const activeRemoteSharer = useMemo(() => {
    let best: (typeof callSignal.peers)[number] | null = null;
    for (const peer of callSignal.peers) {
      if (!peer.screenSharing) continue;
      if (!best) {
        best = peer;
        continue;
      }
      const a = peer.screenSharingStartedAtMs ?? Number.POSITIVE_INFINITY;
      const b = best.screenSharingStartedAtMs ?? Number.POSITIVE_INFINITY;
      if (a < b) best = peer;
    }
    return best;
  }, [callSignal.peers]);

  // Take-over arbitration: if a peer started sharing AFTER we did,
  // they win and we politely yield. This is the symmetric back-half of
  // the "Take over from X?" confirm dialog — when the other side hits
  // confirm, our share auto-stops with a calm toast instead of leaving
  // both feeds running.
  useEffect(() => {
    if (!screenShare.isSharing || screenShareStartedAtMs == null) return;
    let usurper: (typeof callSignal.peers)[number] | null = null;
    let usurperTs = Number.POSITIVE_INFINITY;
    for (const peer of callSignal.peers) {
      if (!peer.screenSharing) continue;
      const ts = peer.screenSharingStartedAtMs;
      if (ts == null) continue;
      if (ts > screenShareStartedAtMs && ts < usurperTs) {
        usurper = peer;
        usurperTs = ts;
      }
    }
    if (usurper) {
      const name = usurper.displayName || "Another participant";
      screenShare.stop();
      toast({ description: `${name} took over screen sharing.` });
    }
  }, [callSignal.peers, screenShare, screenShareStartedAtMs, toast]);

  const handleToggleScreenShare = () => {
    if (screenShare.isSharing) {
      screenShare.stop();
      return;
    }
    // First time on this device — surface a one-shot heads-up reminding
    // the user to close anything they don't want broadcast (DMs, secrets,
    // unsaved drafts). MUST run before the takeover branch so a first-run
    // user can never start sharing without seeing the heads-up, even when
    // someone else happens to be sharing at that exact moment.
    // `acknowledgeScreenSharePrivacy` re-checks for an active remote
    // sharer and routes through the takeover dialog after acknowledgement.
    if (!hasSeenScreenSharePrivacy()) {
      setShowScreenSharePrivacy(true);
      return;
    }
    if (activeRemoteSharer) {
      setPendingTakeover({
        displayName: activeRemoteSharer.displayName || "Another participant",
      });
      return;
    }
    beginScreenShare();
  };

  const acknowledgeScreenSharePrivacy = () => {
    markScreenSharePrivacySeen();
    setShowScreenSharePrivacy(false);
    if (activeRemoteSharer) {
      // Edge case: a remote sharer started while the dialog was open.
      // Re-route through the takeover confirm so we never silently
      // override someone else's broadcast.
      setPendingTakeover({
        displayName: activeRemoteSharer.displayName || "Another participant",
      });
      return;
    }
    beginScreenShare();
  };

  const confirmTakeover = () => {
    setPendingTakeover(null);
    beginScreenShare();
  };

  useEffect(() => {
    if (!callSignal.incomingMuteRequest) return;
    const req = callSignal.incomingMuteRequest;
    toast({
      description: `${req.fromName} is asking you to mute your mic.`,
    });
    callSignal.acknowledgeMuteRequest();
  }, [callSignal, toast]);

  const presenceByPubkey = useMemo(() => {
    const m = new Map<string, (typeof callSignal.peers)[number]>();
    for (const p of callSignal.peers) m.set(p.pubkey, p);
    return m;
  }, [callSignal.peers]);

  const rosterParticipants = useMemo<RosterParticipant[]>(
    () =>
      session.participants.map((p) => ({
        pubkey: p.pubkey,
        displayName: p.displayName,
        role: p.role,
        isSelf: p.pubkey === currentPubkey,
      })),
    [session.participants, currentPubkey],
  );

  const raisedHandsCount = useMemo(
    () => callSignal.peers.filter((p) => p.handRaised).length,
    [callSignal.peers],
  );

  useEffect(() => {
    if (!callSignal.handLoweredByHost) return;
    toast({
      description: `${callSignal.handLoweredByHost.fromName} lowered your hand.`,
    });
    callSignal.acknowledgeHandLowered();
  }, [callSignal, toast]);

  const [myMicLevel, setMyMicLevel] = useState(0);
  useEffect(() => {
    if (!localStream || !micEnabled) {
      setMyMicLevel(0);
      return;
    }
    const audioTracks = localStream.getAudioTracks();
    if (audioTracks.length === 0) return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    let ctx: AudioContext;
    try {
      ctx = new AudioCtx();
    } catch {
      return;
    }
    let analyser: AnalyserNode;
    let source: MediaStreamAudioSourceNode;
    try {
      source = ctx.createMediaStreamSource(localStream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
    } catch {
      try {
        void ctx.close();
      } catch {
        // ignore
      }
      return;
    }
    const buffer = new Uint8Array(analyser.frequencyBinCount);
    let cancelled = false;
    let lastEmitted = 0;
    const tick = () => {
      if (cancelled) return;
      analyser.getByteFrequencyData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) sum += buffer[i];
      const rms = sum / buffer.length / 255; // 0..1
      if (Math.abs(rms - lastEmitted) > 0.01) {
        lastEmitted = rms;
        setMyMicLevel(rms);
      }
    };
    const id = window.setInterval(tick, 66);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      try {
        source.disconnect();
      } catch {
        // ignore
      }
      try {
        analyser.disconnect();
      } catch {
        // ignore
      }
      try {
        void ctx.close();
      } catch {
        // ignore
      }
      setMyMicLevel(0);
    };
  }, [localStream, micEnabled]);

  const [showLivePreviewBanner, setShowLivePreviewBanner] = useState(!liveTransport.isSupported);
  useEffect(() => {
    setShowLivePreviewBanner(!liveTransport.isSupported);
  }, [liveTransport.isSupported]);

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

  useEffect(() => {
    recordingStartedRef.current = false;
    recordingPersistedRef.current = false;
    persistPromiseRef.current = null;
    guestEndingShownRef.current = false;
    personalArchivePublishedRef.current = false;
    setPersonalArchive({ status: "idle" });
    setScreenRecResult(null);
    screenRecording.reset();
    // `screenRecording` is intentionally excluded from deps — including the
    // unstable function identity would cause this reset to fire on every
    // re-render. Resetting on session id change is the correct semantic.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  // Mirror the screen-share lifecycle into the screen recorder. When the
  // share starts mid-call we kick off an independent ChunkedRecorder; when
  // it ends (whether by button, native "Stop sharing" bar, take-over from a
  // peer, or session end) we finalize and stash the result for later
  // archival. Multiple shares per session keep only the most recent result
  // (matches the schema's single-screen-track-per-row design).
  const screenStreamRef = useRef<MediaStream | null>(null);
  useEffect(() => {
    const liveScreen = screenShare.isSharing ? screenShare.stream : null;
    if (liveScreen && !screenRecording.isRecording && session.status === "live") {
      screenStreamRef.current = liveScreen;
      void screenRecording.start(liveScreen).catch((err) => {
        console.warn("Screen recording failed to start; live share continues.", err);
      });
    } else if (!liveScreen && screenRecording.isRecording) {
      screenStreamRef.current = null;
      void screenRecording.stop().then((r) => {
        if (r) setScreenRecResult(r);
      });
    }
  }, [screenShare.isSharing, screenShare.stream, screenRecording, session.status]);

  useEffect(() => {
    // Defer persistence until BOTH the camera/audio recorder and the
    // (optional) screen recorder have settled. Screen recording can lag
    // behind by a few seconds when the share is stopped concurrently with
    // the call ending — without this gate we'd persist a row missing the
    // screen* fields and the vault would forever forget about the screen
    // track.
    const screenSettled = !screenRecording.isRecording && !screenRecording.isFinalizing;
    if (
      recording.result &&
      !recordingPersistedRef.current &&
      (recording.syncStatus === "complete" || recording.syncStatus === "partial-failure") &&
      screenSettled
    ) {
      recordingPersistedRef.current = true;
      const r = recording.result;
      const s = screenRecResult;
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
            audioBlobHash: r.audio?.blobHash || null,
            audioBlobUrl: r.audio?.blobUrl ?? null,
            audioSizeBytes: r.audio?.sizeBytes ?? null,
            audioMimeType: r.audio?.mimeType ?? null,
            videoBlobHash: r.video?.blobHash || null,
            videoBlobUrl: r.video?.blobUrl ?? null,
            videoSizeBytes: r.video?.sizeBytes ?? null,
            videoMimeType: r.video?.mimeType ?? null,
            screenBlobHash: s?.blobHash || null,
            screenBlobUrl: s?.blobUrl ?? null,
            screenSizeBytes: s?.meta.sizeBytes ?? null,
            screenMimeType: s?.meta.mimeType ?? null,
            screenDurationSeconds: s?.meta.durationSeconds ?? null,
            status: "ready",
          },
        })
        .catch((err) => {
          console.error("Failed to save recording metadata", err);
        });
      persistPromiseRef.current = p;
    }
  }, [recording.result, recording.syncStatus, screenRecording.isRecording, screenRecording.isFinalizing, screenRecResult, createRecordingMutation, session.id, session.title, currentPubkey, displayName]);

  const acceptedPubkeys = useMemo(
    () => session.participants.map((p) => p.pubkey).filter(Boolean),
    [session.participants],
  );
  const hostAgg = useHostAggregatedTracks({
    sessionId: isHost ? session.id : null,
    enabled: isHost,
    acceptedPubkeys,
    sessionEndedAtMs,
  });

  useEffect(() => {
    if (
      !recording.result ||
      personalArchivePublishedRef.current ||
      !shouldPublishPersonalArchive(recording.syncStatus, recording.result) ||
      !identity
    ) {
      return;
    }
    const r = recording.result;
    personalArchivePublishedRef.current = true;
    setPersonalArchive({ status: "publishing" });

    const others = session.participants
      .filter((p) => p.pubkey !== currentPubkey)
      .map((p) => p.displayName);
    const ownerName = displayName || "You";

    void (async () => {
      try {
        const result = await publishPersonalArchive(
          identity,
          {
            sessionId: session.id,
            sessionTitle: session.title,
            hostName: session.hostName,
            endedAt: new Date(),
            isHost,
            otherParticipantNames: others,
          },
          {
            recordingId: r.recordingId,
            participantPubkey: currentPubkey || "",
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
            // Optional screen-share track. Only surfaced when the screen
            // recorder produced a remotely-synced blob — local-only screen
            // captures stay on this device. The participant's row in the
            // share recipient page will hide the "Screen" download choice
            // when this is null, so the receipt stays honest about what
            // is and isn't actually available.
            screen:
              screenRecResult && screenRecResult.remoteUrl
                ? {
                    url: screenRecResult.remoteUrl,
                    hash: screenRecResult.blobHash || null,
                    sizeBytes: screenRecResult.meta.sizeBytes,
                    mimeType: screenRecResult.meta.mimeType,
                  }
                : null,
            screenDurationSeconds: screenRecResult?.meta.durationSeconds ?? null,
          },
        );
        if (result.publish.successCount === 0) {
          setPersonalArchive({
            status: "error",
            message: "No sharing servers accepted the receipt.",
          });
          return;
        }
        rememberPersonalReceipt({
          archiveId: result.archiveId,
          pointer: result.pointer,
          sessionTitle: session.title,
          isHost,
          hostName: session.hostName,
          otherParticipantNames: others,
          receiptUrl: result.receiptUrl,
          shareUrl: result.shareUrl,
          publishedAt: result.archivedAt,
          ownerPubkey: currentPubkey || "",
        });
        setPersonalArchive({
          status: "ready",
          archiveId: result.archiveId,
          receiptUrl: result.receiptUrl,
          successCount: result.publish.successCount,
          totalCount: result.publish.totalCount,
        });

        // Broadcast pointer (retried with backoff inside the helper).
        try {
          await publishPersonalArchivePointer({
            signer: identity._signer,
            sessionId: session.id,
            shareUrl: result.shareUrl,
          });
        } catch (pointerErr) {
          console.warn("personal-archive pointer publish failed", pointerErr);
          toast({
            variant: "destructive",
            description:
              "Couldn't notify the host of your archive automatically. Share the link manually if needed — your local copy is safe.",
          });
        }
      } catch (err) {
        console.error("Failed to publish personal archive", err);
        setPersonalArchive({
          status: "error",
          message:
            err instanceof Error
              ? err.message
              : "An unexpected problem prevented publishing.",
        });
      }
    })();
  }, [
    recording.result,
    recording.syncStatus,
    identity,
    session.id,
    session.title,
    session.hostName,
    session.participants,
    currentPubkey,
    displayName,
    isHost,
    toast,
  ]);

  // Guests: host-ended session while mid-record → finalize before redirect.
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

  // Keyboard shortcuts: M = mic, V = camera, Space = record (host), R = roster.
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
      {
        key: "r",
        handler: () => setShowRoster((v) => !v),
      },
      {
        key: "h",
        handler: () => callSignal.toggleHand(),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isHost, session.status, callSignal.toggleHand]
  );
  useKeyboardShortcuts(shortcuts, shortcutsEnabled);

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

  const handleGuestClose = async () => {
    await awaitPersistence();
    setShowSessionComplete(false);
    onViewVault();
  };

  const handleLeave = () => {
    void onLeave();
  };

  const localParticipant = session.participants.find((p) => p.pubkey === currentPubkey);
  const trackStorageState: "remote" | "local-only" | "unknown" =
    recording.syncStatus === "complete"
      ? "remote"
      : recording.syncStatus === "partial-failure"
      ? (recording.result && recording.result.incrementalSaved > 0)
        ? "remote"
        : "local-only"
      : "unknown";

  const localTrack: Track | null = recording.result && localParticipant
    ? {
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
        combinedBlobUrl: recording.result.blobUrl,
        combinedRemoteUrl: recording.result.remoteUrl,
        combinedBlobHash: recording.result.blobHash || null,
        audioBlobUrl: recording.result.audio?.blobUrl ?? null,
        audioRemoteUrl: recording.result.audio?.remoteUrl ?? null,
        audioBlob: recording.result.audio?.blob ?? null,
        audioMimeType: recording.result.audio?.mimeType ?? null,
        audioSizeBytes: recording.result.audio?.sizeBytes ?? 0,
        audioBlobHash: recording.result.audio?.blobHash || null,
        videoOnlyBlob: recording.result.video?.blob ?? null,
        videoOnlyLocalUrl: recording.result.video?.localBlobUrl ?? null,
        videoOnlyRemoteUrl: recording.result.video?.remoteUrl ?? null,
        videoOnlyMimeType: recording.result.video?.mimeType ?? null,
        videoOnlySizeBytes: recording.result.video?.sizeBytes ?? 0,
        videoOnlyBlobHash: recording.result.video?.blobHash || null,
        // Screen-share sibling. Only carries data when the user actually
        // pressed Share screen during the call — `screenRecResult` is
        // `null` otherwise. We hold both the in-memory blob and the
        // idb:// local URL so the export helper can resolve it without
        // a remote fetch when the device is still online with the bytes.
        screenBlob: screenRecResult?.blob ?? null,
        screenLocalUrl: screenRecResult?.blobUrl ?? null,
        screenRemoteUrl: screenRecResult?.remoteUrl ?? null,
        screenMimeType: screenRecResult?.meta.mimeType ?? null,
        screenSizeBytes: screenRecResult?.meta.sizeBytes ?? 0,
        screenBlobHash: screenRecResult?.blobHash || null,
        screenDurationSeconds: screenRecResult?.meta.durationSeconds ?? null,
      }
    : localParticipant
    ? {
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
      }
    : null;

  const sessionCompleteTracks: Track[] = useMemo(() => {
    const rows: Track[] = [];
    if (localTrack) rows.push(localTrack);
    if (isHost) {
      const localPubkey = localParticipant?.pubkey ?? currentPubkey;
      for (const agg of hostAgg.aggregated) {
        if (agg.participantPubkey === localPubkey) continue;
        const t = agg.recipientTrack;
        const isVideoTrack = t.url ? t.mimeType.startsWith("video/") : false;
        rows.push({
          participantId: agg.participantPubkey,
          participantName: t.participantName,
          participantPubkey: agg.participantPubkey,
          recordingId: t.recordingId,
          blob: null,
          durationSeconds: t.durationSeconds,
          sizeBytes: t.sizeBytes,
          mimeType: t.mimeType,
          hasVideo: isVideoTrack,
          storageState: deriveHostRowStorageState({
            isVideoTrack,
            combinedRemoteUrl: t.url ?? null,
            audioSiblingRemoteUrl: t.audio?.url ?? null,
            videoSiblingRemoteUrl: t.video?.url ?? null,
          }),
          combinedBlobUrl: t.url,
          combinedRemoteUrl: t.url,
          combinedBlobHash: t.hash,
          audioBlobUrl: t.audio?.url ?? null,
          audioRemoteUrl: t.audio?.url ?? null,
          audioMimeType: t.audio?.mimeType ?? null,
          audioSizeBytes: t.audio?.sizeBytes ?? 0,
          audioBlobHash: t.audio?.hash ?? null,
          videoOnlyBlob: null,
          videoOnlyLocalUrl: null,
          videoOnlyRemoteUrl: t.video?.url ?? null,
          videoOnlyMimeType: t.video?.mimeType ?? null,
          videoOnlySizeBytes: t.video?.sizeBytes ?? 0,
          videoOnlyBlobHash: t.video?.hash ?? null,
          // Screen sibling (v=4 manifests). Remote-only on the host's
          // session-complete view since the host never recorded the
          // remote participant's screen — the local idb:// fallback only
          // lives on the participant's own device.
          screenBlob: null,
          screenLocalUrl: null,
          screenRemoteUrl: t.screen?.url ?? null,
          screenMimeType: t.screen?.mimeType ?? null,
          screenSizeBytes: t.screen?.sizeBytes ?? 0,
          screenBlobHash: t.screen?.hash ?? null,
          screenDurationSeconds: t.screenDurationSeconds ?? null,
        });
      }
    }
    return rows;
  }, [localTrack, isHost, hostAgg.aggregated, localParticipant?.pubkey, currentPubkey]);

  const expectedParticipants = useMemo(() => {
    if (!isHost) return [];
    const phase: "listening" | "timeout" = hostAgg.isWaiting ? "listening" : "timeout";
    const localPubkey = localParticipant?.pubkey ?? currentPubkey;
    const seen = new Set<string>();
    const list: Array<{
      pubkey: string;
      displayName: string;
      state: "listening" | "timeout";
      resolveError?: string;
    }> = [];
    const append = (pk: string) => {
      if (pk === localPubkey || seen.has(pk)) return;
      seen.add(pk);
      const p = session.participants.find((sp) => sp.pubkey === pk);
      list.push({
        pubkey: pk,
        displayName: p?.displayName ?? "Participant",
        state: phase,
        resolveError: hostAgg.resolveErrors.get(pk),
      });
    };
    hostAgg.waitingForPubkeys.forEach(append);
    hostAgg.resolveErrors.forEach((_msg, pk) => append(pk));
    return list;
  }, [
    isHost,
    hostAgg.isWaiting,
    hostAgg.waitingForPubkeys,
    hostAgg.resolveErrors,
    session.participants,
    localParticipant?.pubkey,
    currentPubkey,
  ]);


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
                <VesselBrandIcon className="w-6 h-6 text-vessel-accent shrink-0" />
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
            {/* Sharing pill — single source of truth for who is currently
                broadcasting their screen. Shown next to the recording dot
                so it's impossible to forget you (or someone else) is
                sharing. We label "You" for the local broadcaster so the
                user immediately recognises themselves and never has to
                play "is that me?". */}
            {(screenShare.isSharing || activeRemoteSharer) && (
              <div
                className="ml-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-vessel-accent/30 bg-vessel-accent/10 text-vessel-accent text-[11px] font-medium"
                data-testid="pill-sharing-active"
                data-state={screenShare.isSharing ? "self" : "remote"}
                title={
                  screenShare.isSharing
                    ? "You are sharing your screen with the room"
                    : `${activeRemoteSharer?.displayName ?? "A participant"} is sharing their screen`
                }
              >
                <MonitorPlay className="w-3 h-3" />
                <span>
                  {screenShare.isSharing
                    ? "Sharing · You"
                    : `Sharing · ${activeRemoteSharer?.displayName ?? "A participant"}`}
                </span>
              </div>
            )}
          </div>

          {/* Right — connection quality is the only unique signal here.
              The participants count and a settings gear used to live in
              this slot but they were dead weight: the count was already
              surfaced (and made actionable) by the roster button in the
              bottom control bar, and the gear had no handler. */}
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

        {/* Live preview unavailable banner (browser doesn't support the
            transport / codec stack — recording still works) */}
        {showLivePreviewBanner && (
          <div className="bg-vessel-amber/10 border-b border-vessel-amber/20 px-4 py-2 flex items-center justify-between shrink-0 z-10">
            <div className="flex items-center gap-2 text-sm text-vessel-amber">
              <AlertTriangle className="w-4 h-4" />
              <span>Live preview is unavailable in this browser. Your recording will still be full quality.</span>
            </div>
            <button
              onClick={() => setShowLivePreviewBanner(false)}
              className="text-vessel-amber/70 hover:text-vessel-amber p-1 rounded-md transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Main Area — when the roster is open on lg+ viewports we shift the
            video grid left so the panel pushes it instead of overlaying. On
            smaller viewports the panel still uses the overlay behavior with
            its own backdrop. */}
        <main
          className={cn(
            "flex-1 overflow-hidden relative pb-20 transition-[padding-right] duration-200 ease-out",
            showRoster && "lg:pr-[360px]",
          )}
        >
          {(() => {
            // Decide which (if any) screen feed to spotlight. The local
            // share wins over a remote share because we already arbitrate
            // remote sharers down to a single winner upstream and a local
            // share means the user is actively presenting right now.
            const localScreenStream = screenShare.isSharing ? screenShare.stream : null;
            const remoteScreenSharerPubkey =
              !localScreenStream && activeRemoteSharer ? activeRemoteSharer.pubkey : null;
            const remoteScreenStream = remoteScreenSharerPubkey
              ? liveTransport.remoteScreenStreams.get(remoteScreenSharerPubkey) ?? null
              : null;
            const heroStream = localScreenStream ?? remoteScreenStream;
            const heroIsLocal = !!localScreenStream;
            const sharerPubkey = heroIsLocal
              ? currentPubkey ?? ""
              : remoteScreenSharerPubkey ?? "";

            // Build per-participant tiles in a shape the spotlight strip
            // and the legacy grid both understand. Done once so the two
            // branches share their derivation logic.
            const participantTiles: SpotlightTile[] = session.participants.map((p) => {
              const isLocal = p.pubkey === currentPubkey;
              const remoteStream = isLocal
                ? undefined
                : liveTransport.remoteStreams.get(p.pubkey);
              const remoteIsLive = !isLocal && liveTransport.remoteReady.has(p.pubkey);
              const peerPresence = isLocal ? null : presenceByPubkey.get(p.pubkey);
              const tileMicEnabled = isLocal
                ? micEnabled
                : peerPresence?.micEnabled ?? true;
              const tileCameraEnabled = isLocal
                ? cameraEnabled
                : (peerPresence?.cameraEnabled ?? true) && remoteIsLive;
              const tileStream = isLocal
                ? localStream
                : remoteIsLive
                ? remoteStream ?? null
                : null;
              return {
                id: p.id,
                pubkey: p.pubkey,
                displayName: p.displayName,
                isLocal,
                isSharer: p.pubkey === sharerPubkey,
                cameraStream: tileStream,
                micEnabled: tileMicEnabled,
                cameraEnabled: tileCameraEnabled,
                isConnecting: !isLocal && liveTransport.isConnected && !remoteIsLive,
              } satisfies SpotlightTile;
            });

            if (heroStream) {
              const presenter =
                participantTiles.find((t) => t.pubkey === sharerPubkey) ?? null;
              return (
                <SpotlightView
                  screenStream={heroStream}
                  screenIsLocal={heroIsLocal}
                  tiles={participantTiles}
                  presenter={presenter}
                  myMicLevel={myMicLevel}
                />
              );
            }

            return (
              <VideoGrid participantCount={session.participants.length}>
                {participantTiles.map((t) => {
                  const original = session.participants.find((sp) => sp.pubkey === t.pubkey)!;
                  return (
                    <VideoTile
                      key={t.id}
                      participant={original}
                      stream={t.cameraStream ?? undefined}
                      isLocal={t.isLocal}
                      isConnecting={t.isConnecting}
                      micEnabled={t.micEnabled}
                      cameraEnabled={t.cameraEnabled}
                      audioLevel={
                        t.isLocal
                          ? micEnabled
                            ? myMicLevel
                            : 0
                          : t.micEnabled
                          ? 0.5
                          : 0
                      }
                    />
                  );
                })}
              </VideoGrid>
            );
          })()}
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
          rosterOpen={showRoster}
          onToggleRoster={() => setShowRoster((v) => !v)}
          rosterCount={session.participants.length}
          raisedHandsCount={raisedHandsCount}
          handRaised={callSignal.handRaised}
          onToggleHand={callSignal.toggleHand}
          screenShareSupported={screenShare.isSupported}
          isScreenSharing={screenShare.isSharing}
          onToggleScreenShare={handleToggleScreenShare}
        />

        <RosterSidePanel
          open={showRoster}
          onClose={() => setShowRoster(false)}
          participants={rosterParticipants}
          presenceByPubkey={presenceByPubkey}
          isConnected={callSignal.isConnected}
          isHost={isHost}
          myMicEnabled={micEnabled}
          myCameraEnabled={cameraEnabled}
          myQuality={signalQuality}
          myHandRaised={callSignal.handRaised}
          myHandRaisedAtMs={callSignal.handRaisedAtMs}
          myMicLevel={myMicLevel}
          onAskToMute={(pubkey) => {
            void callSignal.askToMute(pubkey);
            toast({ description: "Sent a polite mute request." });
          }}
          onLowerHand={(pubkey) => {
            if (pubkey === currentPubkey) {
              if (callSignal.handRaised) callSignal.toggleHand();
              return;
            }
            void callSignal.lowerHandFor(pubkey);
          }}
          onLowerAllHands={() => {
            void callSignal.lowerAllHands();
          }}
          chat={callSignal.chat}
          onSendChat={(text) => {
            void callSignal.sendChat(text);
          }}
          onSendReaction={(emoji) => {
            void callSignal.sendReaction(emoji);
          }}
        />

        <InviteModal
          open={showInviteModal}
          onOpenChange={setShowInviteModal}
          inviteUrl={buildInviteUrl(session.inviteCode)}
          inviteCode={session.inviteCode}
        />

        <AlertDialog
          open={showScreenSharePrivacy}
          onOpenChange={(o) => {
            if (!o) setShowScreenSharePrivacy(false);
          }}
        >
          <AlertDialogContent data-testid="dialog-screen-share-privacy">
            <AlertDialogHeader>
              <AlertDialogTitle>Before you share your screen</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm text-vessel-text-secondary">
                  <p>
                    Everyone in this room will see what you pick — and a
                    clean copy is recorded for your vault.
                  </p>
                  <p>
                    Take a moment to close anything you don't want
                    broadcast: chat windows, password managers, unsaved
                    drafts, browser tabs with personal info.
                  </p>
                  <p className="text-vessel-text-muted">
                    You'll only see this reminder once on this device.
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                onClick={() => setShowScreenSharePrivacy(false)}
                data-testid="button-screen-share-privacy-cancel"
              >
                Not now
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={acknowledgeScreenSharePrivacy}
                data-testid="button-screen-share-privacy-continue"
              >
                Got it — pick a window
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          open={pendingTakeover !== null}
          onOpenChange={(o) => {
            if (!o) setPendingTakeover(null);
          }}
        >
          <AlertDialogContent data-testid="dialog-takeover-screen-share">
            <AlertDialogHeader>
              <AlertDialogTitle>
                Take over screen share?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {pendingTakeover
                  ? `${pendingTakeover.displayName} is currently sharing their screen. If you continue, your share will replace theirs.`
                  : ""}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-takeover-cancel">
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmTakeover}
                data-testid="button-takeover-confirm"
              >
                Take over
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <SessionComplete
          open={showSessionComplete}
          isHost={isHost}
          hostName={session.hostName}
          sessionTitle={session.title}
          sessionDate={sessionEndedAtMs ? new Date(sessionEndedAtMs) : new Date()}
          syncStatus={recording.syncStatus}
          syncProgress={recording.syncProgress}
          tracks={sessionCompleteTracks}
          expectedParticipants={
            isHost &&
            (recording.syncStatus === "complete" || recording.syncStatus === "partial-failure")
              ? expectedParticipants
              : []
          }
          personalArchive={personalArchive}
          onViewVault={handleViewVault}
          onStartNew={handleStartNew}
          onClose={handleGuestClose}
        />
      </div>
    </TooltipProvider>
  );
}
