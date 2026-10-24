import { useState, useEffect, useRef, useMemo } from "react";
import { useRecordingMarkers } from "../../hooks/use-recording-markers";
import { getCachedServerOffsetMs } from "../../lib/server-time";
import { AlertTriangle, X, MonitorPlay, Copy, Check } from "lucide-react";
import { useIdentity } from "../../hooks/use-identity";
import { useMediaDevices, useLocalStream } from "../../hooks/use-media-devices";
import { useRecording } from "../../hooks/use-recording";
import { markRecordingRegistered } from "../../lib/recording-finalize";
import { useScreenRecording, type ScreenRecordingResult } from "../../hooks/use-screen-recording";
import { useKeyboardShortcuts, type Shortcut } from "../../hooks/use-keyboard-shortcuts";
import { useLiveTransport } from "../../hooks/use-live-transport";
import { useCallSignal, type ConnectionQuality } from "../../hooks/use-call-signal";
import { useScreenShare } from "../../hooks/use-screen-share";
import { getConnectionQualityLabel } from "../../lib/moq";
import { isMoqAvailable } from "../../lib/transport-select";
import { buildInviteUrl } from "../../lib/session";
import { InviteModal } from "../lobby/InviteModal";
import { RecordingDot } from "../vessel-ui/RecordingDot";
import { SessionCodeBadge } from "../vessel-ui/SessionCodeBadge";
import { VesselBrandIcon } from "../icons/VesselBrandIcon";
import { VideoGrid } from "./VideoGrid";
import { VideoTile } from "./VideoTile";
import { SpotlightView, type SpotlightTile } from "./SpotlightView";
import { ControlBar } from "./ControlBar";
import { RaisedHandNotification } from "./RaisedHandNotification";
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
  deliverPersonalArchive,
  DeliveryUnsupportedError,
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
  /** Host only: mark the session ended on the server right away, without navigating. */
  onEndSession?: () => Promise<void>;
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
  onEndSession,
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

  const { stream: localStream, error: localStreamError, videoUnavailableReason } = useLocalStream({
    cameraId: selectedCameraId,
    micId: selectedMicId,
    cameraEnabled,
    micEnabled,
    // During a take the camera only blanks (a recorder stops if its tracks
    // change); outside one, camera off frees the device and its light.
    keepTracks: recording.isRecording,
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

  // Local browser's MoQ capability bit. Probed once at mount and shared
  // between the call signal (which broadcasts it on every presence beat
  // so peers can decide whether the room needs the WebRTC fallback) and
  // the live transport itself (which uses it when picking which
  // transport to drive).
  const [selfSupportsMoq] = useState<boolean>(() => isMoqAvailable());

  // Mirror of `liveTransport.quality`, kept as state so the call-signal
  // hook can be declared BEFORE the live transport without forming a
  // render-time circular dependency. The transport publishes new quality
  // values via an effect below; the call-signal beats them out on the
  // next render. One extra render per quality change is fine — quality
  // updates are throttled at the source.
  const [signalQuality, setSignalQuality] = useState<ConnectionQuality>("unknown");

  const hostPubkey = useMemo(
    () => session.participants.find((p) => p.role === "host")?.pubkey ?? null,
    [session.participants],
  );

  const callSignal = useCallSignal({
    sessionId: session.id,
    inviteCode: session.inviteCode,
    identity,
    myDisplayName: displayName || "You",
    myMicEnabled: micEnabled,
    myCameraEnabled: cameraEnabled,
    myScreenSharing: screenShare.isSharing,
    myScreenSharingStartedAtMs: screenShareStartedAtMs,
    myQuality: signalQuality,
    myLiveSupportsMoq: selfSupportsMoq,
    enabled: session.status !== "ended",
    hostPubkey,
    // Surface a one-off toast the moment a peer cleanly leaves the room.
    // Much more attention-grabbing than a row silently disappearing from
    // the side panel — it tells the host "they meant to go, the call
    // didn't drop". The display name comes from the most recent presence
    // beat we saw from this peer (the hook captures it before deleting
    // the row), so the toast reads naturally even when the leaver had
    // already disconnected from our live transport.
    onPeerLeave: ({ displayName: leaverName }) => {
      toast({
        description: `${leaverName} left the session.`,
      });
    },
  });

  // Markers the host drops during a take (M key or the flag button). They
  // live on this device and land in the editor download.
  const sessionMarkers = useRecordingMarkers({
    sessionId: session.id,
    isRecording: isHost && recording.isRecording,
    serverOffsetMs: getCachedServerOffsetMs(),
  });
  const markerCountRef = useRef(sessionMarkers.markers.length);
  useEffect(() => {
    const n = sessionMarkers.markers.length;
    if (n > markerCountRef.current) toast({ description: `Marker ${n} added.` });
    markerCountRef.current = n;
  }, [sessionMarkers.markers.length, toast]);

  const acceptedLivePeers = useMemo(
    () => session.participants.map((p) => p.pubkey).filter(Boolean),
    [session.participants],
  );
  const liveTransport = useLiveTransport({
    sessionId: session.id,
    selfPubkey: currentPubkey,
    localStream,
    screenStream: screenShare.stream,
    enabled: session.status === "live" || session.status === "waiting",
    // Roster + signalling come from the call-signal hook above; both
    // feed the dual-transport selector. When the room contains a peer
    // who can't speak the higher-capacity path, the hook transparently
    // falls back to the cross-browser WebRTC mesh.
    peers: callSignal.peers,
    signaling: callSignal.webRtcSignaling,
    selfSupportsMoq,
    // Only people on the session's participant list may open a live
    // connection to this browser; a stranger who learned the session id
    // and signed a valid offer is ignored.
    acceptedPeers: acceptedLivePeers,
  });

  // Forward live-transport quality back into the call-signal beat. The
  // state setter dedupes — React skips the re-render when the value is
  // unchanged — so the hot path is cheap.
  useEffect(() => {
    const q = liveTransport.quality;
    setSignalQuality(
      q === "good" || q === "fair" || q === "poor" ? q : "unknown",
    );
  }, [liveTransport.quality]);

  useEffect(() => {
    if (session.status === "ended" && screenShare.isSharing) {
      screenShare.stop();
    }
  }, [session.status, screenShare]);

  /** Start screen-sharing for real (helper used both by the direct path and
   *  the post-confirmation take-over path). Surfaces friendly toasts on
   *  failure and silently ignores the user's own cancel of the OS picker.
   *
   *  Reads the error directly from the structured `start()` result rather
   *  than the React state mirror — state updates aren't visible in the
   *  same call stack, which would otherwise let a freshly-failed start
   *  silently swallow the toast on the first failure. */
  const beginScreenShare = () => {
    void (async () => {
      const result = await screenShare.start();
      if (result.stream) return;
      if (!result.error.cancelled) {
        toast({ variant: "destructive", description: result.error.message });
      }
    })();
  };
  const connQuality = liveTransport.quality;

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

  // Augment the canonical DB roster with any peer we currently see on
  // the signaling channel that hasn't been written to the session row
  // yet. Two windows cause this:
  //
  //   1. A guest just joined: the relay heartbeat reaches us in <1s
  //      thanks to the burst-rate cadence, but the polling refetch of
  //      GET /sessions/:id can take up to its 8s interval to land.
  //
  //   2. A guest is in the room but the server-side participants row
  //      was lost (e.g. a transient DB error). Presence keeps them
  //      visible to everyone else even when the canonical roster
  //      forgot about them.
  //
  // Either way, the roster panel showing them as "Joining…" beats a
  // ghost feeling of "I can hear them, why aren't they in the list?".
  // Their role defaults to "guest" because hosts are always present in
  // the DB row (the session is created with the host already in it),
  // so a host appearing here would be a server bug worth surfacing as
  // a non-host row anyway. Display name is whatever they're heartbeating;
  // a fallback of a short pubkey preview keeps the row labelled even
  // before the first beat carries a name.
  const augmentedParticipants = useMemo<RosterParticipant[]>(() => {
    const known = new Set(session.participants.map((p) => p.pubkey));
    const dbRows: RosterParticipant[] = session.participants.map((p) => ({
      pubkey: p.pubkey,
      displayName: p.displayName,
      role: p.role,
      isSelf: p.pubkey === currentPubkey,
    }));
    const presenceOnly: RosterParticipant[] = [];
    for (const peer of callSignal.peers) {
      if (known.has(peer.pubkey)) continue;
      presenceOnly.push({
        pubkey: peer.pubkey,
        displayName: peer.displayName?.trim() || "Guest",
        role: "guest",
        isSelf: peer.pubkey === currentPubkey,
      });
    }
    return [...dbRows, ...presenceOnly];
  }, [session.participants, callSignal.peers, currentPubkey]);

  const rosterParticipants = augmentedParticipants;

  // Peers with their hand currently up, sorted oldest-first by raise
  // timestamp so the floating notification names whoever's been waiting
  // the longest. Local user is excluded by virtue of `peers` already
  // excluding self.
  const raisedHandsList = useMemo(
    () =>
      callSignal.peers
        .filter((p) => p.handRaised)
        .sort(
          (a, b) =>
            (a.handRaisedAtMs ?? Number.POSITIVE_INFINITY) -
            (b.handRaisedAtMs ?? Number.POSITIVE_INFINITY),
        )
        .map((p) => ({
          pubkey: p.pubkey,
          displayName: p.displayName || "Guest",
        })),
    [callSignal.peers],
  );
  const raisedHandsCount = raisedHandsList.length;

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
      void recording
        .start(localStream, {
          kind: "camera",
          sessionId: session.id,
          sessionTitle: session.title,
          role: isHost ? "host" : "guest",
        })
        .catch(() => {
          recordingStartedRef.current = false;
        });
    }
  }, [session.status, localStream, recording, session.id, session.title, isHost]);

  // Camera missing or blocked: recording continues as audio only; say so once.
  useEffect(() => {
    if (!videoUnavailableReason) return;
    toast({ title: "Recording audio only", description: videoUnavailableReason });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUnavailableReason]);

  // Mid-recording local write failures (usually a full disk) are rare and
  // serious enough to interrupt for.
  useEffect(() => {
    if (!recording.localPersistError) return;
    toast({
      title: "Storage problem",
      description: recording.localPersistError,
      variant: "destructive",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording.localPersistError]);

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
        .then(() => markRecordingRegistered(r.recordingId))
        .catch((err) => {
          // The recording stays listed under "Recover" on the home screen
          // until it is filed, so nothing is lost here.
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
            startedAtMs: r.startedAtMs,
            serverOffsetMs: r.serverOffsetMs,
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
            message: "The receipt couldn't be published.",
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

        // Deliver to the host: the link is sealed to the host's key here and
        // recorded by the API, so the host gets it even after a reload.
        if (!isHost && hostPubkey) {
          try {
            await deliverPersonalArchive({
              signer: identity._signer,
              hostPubkey,
              sessionId: session.id,
              shareUrl: result.shareUrl,
            });
          } catch (deliveryErr) {
            console.warn("delivery to host failed", deliveryErr);
            toast({
              variant: "destructive",
              description:
                deliveryErr instanceof DeliveryUnsupportedError
                  ? "Your key app can't send your track to the host automatically. Send them your receipt link; your recording is safe on this device."
                  : "Couldn't send your track to the host yet. Your recording is safe on this device; send them your receipt link if this keeps happening.",
            });
          }
        }
      } catch (err) {
        // Raw error text (relay/storage/crypto failures) stays in the console;
        // the UI only ever shows the friendly line.
        console.error("Failed to publish personal archive", err);
        setPersonalArchive({
          status: "error",
          message: "We couldn't publish your receipt yet.",
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
      // End the session for everyone now. Guests stop recording when they
      // see the status change; before this, a host who closed the tab after
      // Stop left the room "live" and guests recording indefinitely.
      void onEndSession?.().catch((err) => {
        console.error("Failed to end session", err);
      });
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
    // Tell every other peer we're leaving so their roster drops our row
    // immediately. Best-effort and non-blocking — if the relay publish
    // hangs (network drop, slow ws) we still want to navigate the user
    // out of the studio without a perceptible delay. The receiving side
    // also has stale/drop TTLs as a safety net.
    void callSignal.sendLeave();
    void onLeave();
  };

  const localParticipant = session.participants.find((p) => p.pubkey === currentPubkey);
  const trackStorageState: "remote" | "local-only" | "unknown" =
    recording.syncStatus === "complete"
      ? "remote"
      : recording.syncStatus === "partial-failure"
      ? recording.result?.persistedLocally
        ? "local-only"
        : "unknown"
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
        startedAtMs: recording.result.startedAtMs,
        serverOffsetMs: recording.result.serverOffsetMs,
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
          startedAtMs: t.startedAtMs,
          serverOffsetMs: t.serverOffsetMs,
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
              <span className="text-sm font-medium truncate max-w-[240px]">
                {session.title}
              </span>
              <SessionCodeBadge code={session.inviteCode} />
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
            // Bottom padding clears the fixed ControlBar (h-20) PLUS the
            // iOS home-indicator safe-area inset (the bar itself absorbs
            // the inset via env(safe-area-inset-bottom), so the grid
            // needs to clear the same amount of extra height).
            "flex-1 overflow-hidden relative pb-[calc(5rem+env(safe-area-inset-bottom))] transition-[padding-right] duration-200 ease-out",
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

            // "First one here" empty-room overlay. Triggers when both:
            //   - the canonical roster has exactly one entry (us), AND
            //   - no other peer is currently heartbeating presence.
            //
            // The second clause matters because the augmented roster
            // already accounts for presence-only peers in the side panel —
            // here we want the overlay to disappear the instant any
            // remote peer lights up the relay, before they've even
            // managed to write their participant row to the DB. The
            // overlay shows the local tile prominently with a copyable
            // invite link below, so the host can grab it from the
            // session itself rather than digging into a separate menu.
            const noRemotePresence = callSignal.peers.length === 0;
            const aloneInRoom =
              session.participants.length === 1 &&
              session.participants[0]?.pubkey === currentPubkey &&
              noRemotePresence;
            if (aloneInRoom) {
              const selfTile = participantTiles[0];
              const selfParticipant = session.participants[0];
              return (
                <FirstOneHereOverlay
                  inviteCode={session.inviteCode}
                  selfStream={selfTile?.cameraStream ?? null}
                  selfMicEnabled={selfTile?.micEnabled ?? micEnabled}
                  selfCameraEnabled={selfTile?.cameraEnabled ?? cameraEnabled}
                  selfParticipant={selfParticipant}
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
          onAddMarker={() => sessionMarkers.addMarker()}
          markerCount={sessionMarkers.markers.length}
          screenShareSupported={screenShare.isSupported}
          isScreenSharing={screenShare.isSharing}
          onToggleScreenShare={handleToggleScreenShare}
        />

        <RaisedHandNotification
          raisedHands={raisedHandsList}
          rosterOpen={showRoster}
          onView={() => setShowRoster(true)}
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
          sessionId={session.id}
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

/**
 * FirstOneHereOverlay — replaces the empty grid the host sees when they
 * are alone in the room before any guest has arrived.
 *
 * Riverside-style empty rooms feel cold: a lone tile floating in a sea
 * of black with no obvious next step. This overlay keeps the local
 * preview prominent (the host can still check their own framing) and
 * pairs it with a copyable invite link so the natural next action —
 * "share the link" — is one click away. As soon as any peer lights up
 * the relay or the DB roster grows past one, the overlay vanishes and
 * the standard `VideoGrid` takes over.
 */
function FirstOneHereOverlay({
  inviteCode,
  selfStream,
  selfMicEnabled,
  selfCameraEnabled,
  selfParticipant,
  myMicLevel,
}: {
  inviteCode: string;
  selfStream: MediaStream | null;
  selfMicEnabled: boolean;
  selfCameraEnabled: boolean;
  selfParticipant: StudioScreenProps["session"]["participants"][number] | undefined;
  myMicLevel: number;
}) {
  const [copied, setCopied] = useState(false);
  const inviteUrl = useMemo(() => buildInviteUrl(inviteCode), [inviteCode]);

  // Reset the "Copied" affordance after a short beat so a host who
  // re-shares the link a minute later still gets the visual confirmation.
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(id);
  }, [copied]);

  const handleCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteUrl);
      } else {
        // Fallback for browsers without the async clipboard API
        // (rare in the modern set we support, but cheap insurance).
        const ta = document.createElement("textarea");
        ta.value = inviteUrl;
        ta.setAttribute("readonly", "");
        ta.style.position = "absolute";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
    } catch {
      // Silent failure — the visible URL is still readable so the user
      // can copy it manually. We deliberately don't toast here because
      // the dominant copy is the input itself, not the button.
    }
  };

  const fallbackParticipant = {
    id: selfParticipant?.id ?? "self",
    displayName: selfParticipant?.displayName ?? "You",
    pubkey: selfParticipant?.pubkey ?? "",
    role: (selfParticipant?.role ?? "host") as "host" | "guest",
  };

  return (
    <div
      className="absolute inset-0 flex items-center justify-center p-6"
      data-testid="overlay-first-one-here"
    >
      <div className="w-full max-w-2xl flex flex-col items-center gap-6">
        <div className="w-full aspect-video max-h-[55vh] rounded-2xl overflow-hidden">
          <VideoTile
            participant={fallbackParticipant}
            stream={selfStream ?? undefined}
            isLocal={true}
            micEnabled={selfMicEnabled}
            cameraEnabled={selfCameraEnabled}
            audioLevel={selfMicEnabled ? myMicLevel : 0}
          />
        </div>

        <div className="text-center">
          <h2 className="text-xl sm:text-2xl font-medium text-vessel-text-primary">
            You're the first one here.
          </h2>
          <p className="mt-1.5 text-sm text-vessel-text-secondary">
            Share this link to bring everyone else in.
          </p>
        </div>

        <div className="w-full max-w-md flex items-stretch gap-2">
          <input
            type="text"
            readOnly
            value={inviteUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-vessel-bg-base border border-vessel-border text-sm font-mono-vessel text-vessel-text-primary focus:outline-none focus:ring-2 focus:ring-vessel-accent/40"
            data-testid="input-empty-room-invite-url"
            aria-label="Invite link"
          />
          <button
            type="button"
            onClick={handleCopy}
            className={cn(
              "px-3 py-2 rounded-lg border text-sm font-medium inline-flex items-center gap-1.5 transition-colors shrink-0",
              copied
                ? "bg-vessel-accent/15 border-vessel-accent/40 text-vessel-accent"
                : "bg-vessel-bg-base border-vessel-border text-vessel-text-primary hover:border-vessel-accent/40",
            )}
            data-testid="button-empty-room-copy-invite"
            aria-label={copied ? "Invite link copied" : "Copy invite link"}
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <div className="text-xs text-vessel-text-muted font-mono-vessel">
          Waiting for others to join…
        </div>
      </div>
    </div>
  );
}
