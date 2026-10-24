import { useState, useMemo, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Share2,
  Download,
  AlertTriangle,
  Check,
  Loader2,
  Trash2,
  Film,
  Video,
  Music,
  Package,
  MonitorPlay,
  Mic,
  Braces,
} from "lucide-react";
import {
  downloadSelectionsAsZip,
  resolveStreamBlob,
  buildExportFilename,
  downloadBlobAsFile,
  type TrackExportSource,
  type TrackSelection,
  type TrackStreamKind,
} from "../../lib/track-export";
import {
  useListRecordings,
  getListRecordingsQueryKey,
  useDeleteRecording,
} from "@workspace/api-client-react";
import type { Recording } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  downloadRecordingById,
  extractRecordingIdFromLocalUrl,
  isLocalBlobUrl,
  deleteRecordingBlob,
} from "../../lib/recordings-storage";
import { videoOnlyLocalUrl } from "../../hooks/use-recording";
import { screenLocalUrl } from "../../hooks/use-screen-recording";
import { useToast } from "../../hooks/use-toast";
import { AvatarMark } from "../AvatarMark";
import { useIdentity } from "../../hooks/use-identity";
import {
  resolveAvatarColor,
  useStoredAvatarColor,
} from "../../hooks/use-avatar-color";
import observationCabinAvif from "@/assets/illustrations/observation-cabin.avif";
import observationCabinWebp from "@/assets/illustrations/observation-cabin.webp";
import { VaultSidebar } from "./VaultSidebar";
import { EmptyState } from "./EmptyState";
import { ShareModal, type ShareModalRecording } from "./ShareModal";
import { RecordingInspector, type InspectorSession } from "./RecordingInspector";
import { VesselButton } from "../vessel-ui/VesselButton";
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

export type VaultScreenProps = {
  pubkey: string;
};

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds} sec`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}min`;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function triggerRemoteDownload(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

type TrackSyncState = "synced" | "local-only" | "failed" | "processing";

function getTrackSyncState(r: { blobUrl?: string | null; status?: string }): TrackSyncState {
  if (r.status === "processing") return "processing";
  if (r.status === "failed") return "failed";
  if (r.blobUrl && !isLocalBlobUrl(r.blobUrl)) return "synced";
  return "local-only";
}

type VaultSession = {
  id: string;
  title: string;
  createdAt: Date;
  recordings: Recording[];
  maxDuration: number;
  totalSize: number;
};

type VaultFilter = "all" | "studio" | "solo";

// Solo recordings get a synthetic sessionId of `quick-record:<recordingId>`
// at publish time, or `__solo_<id>` when no sessionId was supplied. Anything
// else came from a multi-person studio session.
function isSoloSession(id: string): boolean {
  return id.startsWith("quick-record:") || id.startsWith("__solo_");
}

type DeleteTarget =
  | {
      kind: "session";
      title: string;
      recordings: Array<{ id: string; blobUrl?: string | null }>;
    }
  | {
      kind: "track";
      recordingId: string;
      participantName: string;
      blobUrl?: string | null;
    };

export function VaultScreen({ pubkey }: VaultScreenProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { pubkey: selfPubkey } = useIdentity();
  const storedColor = useStoredAvatarColor();
  const queryClient = useQueryClient();
  const deleteMutation = useDeleteRecording();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<VaultFilter>("all");
  const [expandedSessionIds, setExpandedSessionIds] = useState<Set<string>>(new Set());
  const [shareSession, setShareSession] = useState<{
    id: string;
    title: string;
    createdAt: Date;
    recordings: ShareModalRecording[];
  } | null>(null);
  const [inspectSession, setInspectSession] = useState<InspectorSession | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedTracks, setSelectedTracks] = useState<Map<string, Set<string>>>(new Map());
  const [bundlingSessionId, setBundlingSessionId] = useState<string | null>(null);
  const [bundleStreamBySession, setBundleStreamBySession] = useState<
    Map<string, TrackStreamKind>
  >(new Map());
  const getBundleStream = useCallback(
    (sid: string): TrackStreamKind => bundleStreamBySession.get(sid) ?? "video+audio",
    [bundleStreamBySession],
  );
  const setBundleStream = useCallback((sid: string, kind: TrackStreamKind) => {
    setBundleStreamBySession((prev) => {
      const next = new Map(prev);
      next.set(sid, kind);
      return next;
    });
  }, []);

  const { data: recordings, isLoading } = useListRecordings(
    { pubkey },
    { query: { enabled: !!pubkey, queryKey: getListRecordingsQueryKey({ pubkey }) } }
  );

  const filteredSessions = useMemo<VaultSession[]>(() => {
    const sessionsMap = new Map<string, VaultSession>();
    for (const r of recordings || []) {
      const key = r.sessionId || `__solo_${r.id}`;
      if (!sessionsMap.has(key)) {
        sessionsMap.set(key, {
          id: key,
          title: r.sessionTitle || "Untitled session",
          createdAt: new Date(r.createdAt),
          recordings: [],
          maxDuration: 0,
          totalSize: 0,
        });
      }
      const s = sessionsMap.get(key)!;
      s.recordings.push(r);
      s.maxDuration = Math.max(s.maxDuration, r.durationSeconds);
      s.totalSize += r.sizeBytes;
      const rDate = new Date(r.createdAt);
      if (rDate < s.createdAt) s.createdAt = rDate;
    }
    const sessionsList = Array.from(sessionsMap.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
    if (!search) return sessionsList;
    return sessionsList.filter((s) =>
      s.title.toLowerCase().includes(search.toLowerCase()),
    );
  }, [recordings, search]);

  // Split into the two natural categories so users can find a podcast-style
  // group recording or a Loom-style solo clip without scrolling past the
  // other type. Counts feed the segmented control labels below.
  const studioSessions = useMemo(
    () => filteredSessions.filter((s) => !isSoloSession(s.id)),
    [filteredSessions],
  );
  const soloSessions = useMemo(
    () => filteredSessions.filter((s) => isSoloSession(s.id)),
    [filteredSessions],
  );
  const visibleSessions =
    filter === "studio"
      ? studioSessions
      : filter === "solo"
        ? soloSessions
        : filteredSessions;

  const toggleExpand = (id: string) => {
    setExpandedSessionIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDownloadAll = async (session: VaultSession) => {
    let downloaded = 0;
    let missing = 0;
    for (const r of session.recordings) {
      const localId = extractRecordingIdFromLocalUrl(r.blobUrl ?? "");
      if (localId) {
        await downloadRecordingById(localId, `${r.participantName}_track.webm`);
        downloaded++;
      } else if (r.blobUrl) {
        triggerRemoteDownload(r.blobUrl, `${r.participantName}_track.webm`);
        downloaded++;
      } else {
        missing++;
      }
    }
    if (downloaded > 0) {
      toast({ description: `Downloading ${downloaded} track${downloaded === 1 ? "" : "s"}…` });
    }
    if (missing > 0) {
      toast({
        variant: "destructive",
        description: `${missing} track${missing === 1 ? "" : "s"} not available on this device.`,
      });
    }
  };

  const handleShareSession = (session: VaultSession) => {
    setShareSession({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      recordings: session.recordings.map(
        (r): ShareModalRecording => ({
          id: r.id,
          ownerPubkey: r.ownerPubkey,
          participantName: r.participantName,
          blobUrl: r.blobUrl ?? null,
          blobHash: r.blobHash ?? null,
          mimeType: r.mimeType,
          sizeBytes: r.sizeBytes,
          durationSeconds: r.durationSeconds,
        }),
      ),
    });
  };

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const targets =
        deleteTarget.kind === "session"
          ? deleteTarget.recordings
          : [{ id: deleteTarget.recordingId, blobUrl: deleteTarget.blobUrl }];

      let failures = 0;
      for (const r of targets) {
        try {
          await deleteMutation.mutateAsync({ recordingId: r.id });
          const localId = extractRecordingIdFromLocalUrl(r.blobUrl ?? "");
          if (localId) {
            await deleteRecordingBlob(localId).catch(() => {
              /* local cleanup best-effort */
            });
          }
        } catch {
          failures++;
        }
      }

      if (failures > 0) {
        toast({
          variant: "destructive",
          description:
            deleteTarget.kind === "session"
              ? `${failures} track${failures === 1 ? "" : "s"} couldn't be deleted.`
              : "Couldn't delete this track. Try again in a moment.",
        });
      } else {
        toast({
          description:
            deleteTarget.kind === "session"
              ? "Session deleted from your vault."
              : "Track deleted from your vault.",
        });
      }

      await queryClient.invalidateQueries({
        queryKey: getListRecordingsQueryKey({ pubkey }),
      });
      setDeleteTarget(null);
    } finally {
      setIsDeleting(false);
    }
  }, [deleteTarget, deleteMutation, queryClient, pubkey, toast]);

  const ensureSelectionInit = useCallback(
    (sessionId: string, recordingIds: string[]) => {
      setSelectedTracks((prev) => {
        if (prev.has(sessionId)) return prev;
        const next = new Map(prev);
        next.set(sessionId, new Set(recordingIds));
        return next;
      });
    },
    [],
  );
  const toggleTrackSelection = useCallback((sessionId: string, recordingId: string) => {
    setSelectedTracks((prev) => {
      const next = new Map(prev);
      const current = new Set(next.get(sessionId) ?? []);
      if (current.has(recordingId)) current.delete(recordingId);
      else current.add(recordingId);
      next.set(sessionId, current);
      return next;
    });
  }, []);
  const setAllSelected = useCallback(
    (sessionId: string, recordingIds: string[], selectAll: boolean) => {
      setSelectedTracks((prev) => {
        const next = new Map(prev);
        next.set(sessionId, selectAll ? new Set(recordingIds) : new Set());
        return next;
      });
    },
    [],
  );

  const recordingToExportSource = useCallback((r: Recording): TrackExportSource => {
    const localId = extractRecordingIdFromLocalUrl(r.blobUrl ?? "");
    const videoSiblingLocalUrl = localId ? videoOnlyLocalUrl(localId) : null;
    // Screen sibling local URL: derived from the combined recording id so
    // the post-merge IndexedDB lookup matches what the studio writes
    // during capture. Only meaningful for the local participant's row;
    // for remote rows we rely on `screenRemoteUrl` from the recording.
    const screenSiblingLocalUrl = localId ? screenLocalUrl(localId) : null;
    return {
      participantName: r.participantName || "Participant",
      combinedBlobUrl: r.blobUrl ?? null,
      combinedMimeType: r.mimeType || "video/webm",
      audioBlobUrl: r.audioBlobUrl ?? null,
      audioMimeType: r.audioMimeType ?? null,
      videoOnlyRemoteUrl: r.videoBlobUrl ?? null,
      videoOnlyLocalUrl: videoSiblingLocalUrl,
      videoOnlyMimeType: r.videoMimeType ?? null,
      screenRemoteUrl: r.screenBlobUrl ?? null,
      screenLocalUrl: screenSiblingLocalUrl,
      screenMimeType: r.screenMimeType ?? null,
    };
  }, []);

  const handleDownloadStream = useCallback(
    async (r: Recording, kind: TrackStreamKind) => {
      const selection: TrackSelection = { source: recordingToExportSource(r), stream: kind };
      const blob = await resolveStreamBlob(selection);
      if (!blob) {
        const fallbackUrl =
          kind === "audio-only"
            ? r.audioBlobUrl
            : kind === "video-only"
              ? r.videoBlobUrl
              : r.blobUrl;
        if (fallbackUrl && !String(fallbackUrl).startsWith("idb://")) {
          triggerRemoteDownload(
            fallbackUrl,
            buildExportFilename(
              r.participantName,
              kind,
              kind === "audio-only"
                ? r.audioMimeType ?? r.mimeType
                : kind === "video-only"
                  ? r.videoMimeType ?? r.mimeType
                  : r.mimeType,
            ),
          );
          return;
        }
        toast({
          variant: "destructive",
          description:
            kind === "audio-only"
              ? "No audio-only file for this track."
              : kind === "video-only"
                ? "No video-only file for this track."
                : "This track isn't available for download.",
        });
        return;
      }
      const filename = buildExportFilename(
        r.participantName,
        kind,
        kind === "audio-only"
          ? r.audioMimeType ?? blob.type
          : kind === "video-only"
            ? r.videoMimeType ?? blob.type
            : r.mimeType,
      );
      downloadBlobAsFile(blob, filename);
    },
    [recordingToExportSource, toast],
  );

  const handleBundleDownload = useCallback(
    async (session: VaultSession, kind: TrackStreamKind) => {
      if (bundlingSessionId) return;
      const selectedSet = selectedTracks.get(session.id) ?? new Set<string>();
      const chosen = session.recordings.filter((r) => selectedSet.has(r.id));
      if (chosen.length === 0) {
        toast({ description: "Pick at least one track first." });
        return;
      }
      setBundlingSessionId(session.id);
      try {
        const selections: TrackSelection[] = chosen.map((r) => ({
          source: recordingToExportSource(r),
          stream: kind,
        }));
        const stamp = format(session.createdAt, "yyyy-MM-dd");
        const result = await downloadSelectionsAsZip(selections, `vessel-session-${stamp}.zip`);
        if (result.includedFilenames.length === 0) {
          toast({
            variant: "destructive",
            description: "None of the selected tracks were available to download.",
          });
          return;
        }
        if (result.skipped.length > 0) {
          toast({
            description: `${result.includedFilenames.length} included, ${result.skipped.length} skipped.`,
          });
        } else {
          toast({ description: `Downloaded ${result.includedFilenames.length} tracks.` });
        }
      } catch (err) {
        console.error("Bundle download failed", err);
        toast({ variant: "destructive", description: "Couldn't build the zip. Try again in a moment." });
      } finally {
        setBundlingSessionId(null);
      }
    },
    [bundlingSessionId, recordingToExportSource, selectedTracks, toast],
  );


  return (
    <div className="flex h-[100dvh] bg-vessel-bg-base text-vessel-text-primary">
      <VaultSidebar active="my-vault" myVaultCount={filteredSessions.length} />
      <main className="relative flex-1 min-w-0 overflow-y-auto pb-[calc(72px+env(safe-area-inset-bottom))] md:pb-0">
        {/* Subtle "observation cabin" backdrop — same hand-drawn
            family as the landing page sketches. Inverted for the
            dark theme, vignette-masked so it fades into the edges
            and never competes with the vault content. */}
        <div
          className="pointer-events-none fixed inset-0 z-0 bg-center bg-no-repeat bg-cover opacity-[0.06]"
          style={{
            backgroundImage: `image-set(url('${observationCabinAvif}') type('image/avif'), url('${observationCabinWebp}') type('image/webp'))`,
            filter: "invert(1) grayscale(1)",
            maskImage:
              "radial-gradient(ellipse at center, black 35%, transparent 80%)",
            WebkitMaskImage:
              "radial-gradient(ellipse at center, black 35%, transparent 80%)",
          }}
          aria-hidden="true"
        />

        <header className="relative z-10 sticky top-0 bg-vessel-bg-base/80 backdrop-blur-xl border-b border-vessel-border px-4 sm:px-8 py-4 sm:py-0 sm:h-[72px] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-vessel-text-primary tracking-tight leading-none">My Vault</h1>
          <div className="relative w-full sm:w-auto">
            <Search className="w-4 h-4 text-vessel-text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search sessions..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full sm:w-64 pl-10 pr-3 py-2 rounded-lg bg-vessel-bg-surface border border-vessel-border text-base sm:text-sm focus:border-vessel-border-strong outline-none text-vessel-text-primary placeholder:text-vessel-text-muted"
            />
          </div>
        </header>

        <div className="relative z-10 px-4 sm:px-6 md:px-8 py-6 space-y-4 max-w-5xl mx-auto">
          {isLoading ? (
            <>
              <div className="h-44 rounded-xl bg-vessel-bg-surface/50 animate-pulse" />
              <div className="h-44 rounded-xl bg-vessel-bg-surface/50 animate-pulse" />
              <div className="h-44 rounded-xl bg-vessel-bg-surface/50 animate-pulse" />
            </>
          ) : filteredSessions.length === 0 ? (
            <EmptyState 
              title="Nothing in your vault yet" 
              subtitle="Start a recording session to see your tracks here." 
              ctaLabel="Start a Session &rarr;" 
              onCta={() => setLocation('/home')} 
              ctaTestId="button-vault-empty-cta" 
            />
          ) : (
            <>
              {/* Segmented control: lets users narrow to either category
                  while keeping a single "All" view for browsing. Counts are
                  always visible so empty categories read clearly. */}
              <div
                role="group"
                aria-label="Filter recordings by type"
                className="inline-flex items-center gap-1 p-1 rounded-lg bg-vessel-bg-surface border border-vessel-border"
                data-testid="vault-filter-tabs"
              >
                {([
                  { value: "all", label: "All", count: filteredSessions.length, Icon: null },
                  { value: "studio", label: "Sessions", count: studioSessions.length, Icon: Mic },
                  { value: "solo", label: "Solo recordings", count: soloSessions.length, Icon: MonitorPlay },
                ] as const).map((tab) => {
                  const isActive = filter === tab.value;
                  const Icon = tab.Icon;
                  return (
                    <button
                      key={tab.value}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => setFilter(tab.value)}
                      data-testid={`vault-filter-${tab.value}`}
                      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors ${
                        isActive
                          ? "bg-vessel-accent/15 text-vessel-accent shadow-[0_0_0_1px_rgba(0,212,170,0.25)_inset]"
                          : "text-vessel-text-secondary hover:text-vessel-text-primary hover:bg-vessel-bg-elevated"
                      }`}
                    >
                      {Icon ? <Icon className="w-3.5 h-3.5" /> : null}
                      <span>{tab.label}</span>
                      <span className={`font-mono-vessel text-[11px] ${isActive ? "text-vessel-accent" : "text-vessel-text-muted"}`}>
                        {tab.count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {visibleSessions.length === 0 ? (
                <div
                  className="rounded-xl border border-dashed border-vessel-border bg-vessel-bg-surface/40 px-6 py-10 text-center"
                  data-testid="vault-filter-empty"
                >
                  <p className="text-vessel-text-primary font-medium">
                    No {filter === "studio" ? "studio sessions" : "solo recordings"} yet
                  </p>
                  <p className="text-vessel-text-muted text-sm mt-1">
                    {filter === "studio"
                      ? "Multi-person recordings will appear here once you host or join one."
                      : "On-your-own recordings will appear here once you make one."}
                  </p>
                </div>
              ) : null}

              {visibleSessions.map(session => {
              const isExpanded = expandedSessionIds.has(session.id);
              const uniqueParticipants = Array.from(
                new Set(session.recordings.map((r) => r.participantName)),
              ).map((name) =>
                session.recordings.find((r) => r.participantName === name)!,
              );
              const recordingIds = session.recordings.map((r) => r.id);
              const currentSelection = selectedTracks.get(session.id);
              const selectedCount = currentSelection
                ? recordingIds.filter((id) => currentSelection.has(id)).length
                : recordingIds.length;
              const allRowsSelected = selectedCount === recordingIds.length;
              const isBundling = bundlingSessionId === session.id;
              const selectedRowsForTotals = currentSelection
                ? session.recordings.filter((r) => currentSelection.has(r.id))
                : session.recordings;
              const selectedTotals = selectedRowsForTotals.reduce(
                (acc, r) => ({
                  videoAudio: acc.videoAudio + (r.sizeBytes || 0),
                  videoOnly: acc.videoOnly + (r.videoSizeBytes || 0),
                  audioOnly: acc.audioOnly + (r.audioSizeBytes || 0),
                }),
                { videoAudio: 0, videoOnly: 0, audioOnly: 0 },
              );

              return (
                <div key={session.id} className="p-6 rounded-xl bg-vessel-bg-surface border border-vessel-border hover:border-vessel-border-strong transition-colors" data-testid={`card-session-${session.id}`}>
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="w-2 h-2 rounded-full bg-vessel-accent shadow-[0_0_8px_rgba(0,212,170,0.4)]" />
                        <h2 className="font-display text-lg font-bold text-vessel-text-primary truncate">{session.title}</h2>
                        {isSoloSession(session.id) ? (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-mono-vessel text-vessel-text-secondary bg-vessel-bg-base border border-vessel-border"
                            data-testid={`badge-session-type-${session.id}`}
                          >
                            <MonitorPlay className="w-3 h-3" /> Solo
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-mono-vessel text-vessel-text-secondary bg-vessel-bg-base border border-vessel-border"
                            data-testid={`badge-session-type-${session.id}`}
                          >
                            <Mic className="w-3 h-3" /> Session
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-vessel-text-muted font-mono-vessel mt-1">
                        {format(session.createdAt, 'MMM d, yyyy')} &middot; {formatDuration(session.maxDuration)}
                      </div>
                    </div>
                    <div className="flex items-start gap-2 shrink-0">
                      <div className="text-xs text-vessel-text-muted font-mono-vessel text-right pt-0.5">
                        {session.recordings.length} track(s) &middot; Total: {formatSize(session.totalSize)}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setDeleteTarget({
                            kind: "session",
                            title: session.title,
                            recordings: session.recordings.map((r) => ({
                              id: r.id,
                              blobUrl: r.blobUrl ?? null,
                            })),
                          })
                        }
                        className="-mt-1 -mr-1 p-1.5 rounded-lg text-vessel-text-muted hover:text-vessel-red hover:bg-vessel-red/10 transition-colors"
                        aria-label="Delete session"
                        title="Delete session"
                        data-testid={`button-delete-session-${session.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="mb-4">
                    <button className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-vessel-bg-base border border-vessel-border mr-2 mb-2 text-vessel-accent text-xs font-medium hover:bg-vessel-bg-elevated transition-colors">
                      &#9654; Preview
                    </button>
                    {uniqueParticipants.map((p, i) => (
                      <div key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-vessel-bg-base border border-vessel-border mr-2 mb-2">
                        <AvatarMark
                          pubkey={p.ownerPubkey}
                          displayName={p.participantName}
                          className="w-4 h-4"
                          initialsClassName="text-[8px]"
                          initialsSingleChar
                        />
                        <span className="text-xs text-vessel-text-secondary">{p.participantName}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <VesselButton variant="ghost" size="sm" onClick={() => handleDownloadAll(session)} data-testid={`button-download-all-${session.id}`}>
                      <Download className="w-4 h-4 mr-2" /> Download All
                    </VesselButton>
                    <VesselButton
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        ensureSelectionInit(session.id, recordingIds);
                        toggleExpand(session.id);
                      }}
                      data-testid={`button-toggle-tracks-${session.id}`}
                    >
                      {isExpanded ? "Hide Tracks" : "View Tracks"}
                    </VesselButton>
                    <VesselButton
                      variant="ghost"
                      size="sm"
                      onClick={() => handleShareSession(session)}
                      className="ml-auto"
                      data-testid={`button-share-session-${session.id}`}
                    >
                      <Share2 className="w-4 h-4 mr-2" /> Share
                    </VesselButton>
                    {/* Tiny "view as data" affordance — invisible to anyone
                        not looking for it, instantly recognised by power
                        users. Opens a structured breakdown sheet with the
                        raw vault record at the bottom. */}
                    <button
                      type="button"
                      onClick={() =>
                        setInspectSession({
                          id: session.id,
                          title: session.title,
                          createdAt: session.createdAt,
                          recordings: session.recordings,
                        })
                      }
                      className="p-1.5 rounded-lg text-vessel-text-muted hover:text-vessel-text-primary hover:bg-vessel-bg-elevated transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-vessel-accent"
                      aria-label="Details"
                      title="Details"
                      data-testid={`button-inspect-session-${session.id}`}
                    >
                      <Braces className="w-4 h-4" />
                    </button>
                  </div>

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="border-t border-vessel-border mt-4 pt-4 space-y-2">
                          {/* Select-all header for the bundle download flow.
                              Mirrors the SessionComplete affordance so the
                              UX carries over between the post-session card
                              and the vault. */}
                          <div className="flex items-center justify-between text-xs text-vessel-text-secondary px-3 pb-1">
                            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={allRowsSelected}
                                onChange={() =>
                                  setAllSelected(session.id, recordingIds, !allRowsSelected)
                                }
                                className="w-4 h-4 rounded border-vessel-border accent-vessel-accent"
                                data-testid={`checkbox-select-all-${session.id}`}
                              />
                              <span>{allRowsSelected ? "Deselect all" : "Select all"}</span>
                            </label>
                            <span className="text-vessel-text-muted font-mono-vessel">
                              {selectedCount} of {recordingIds.length} selected
                            </span>
                          </div>
                          {session.recordings.map(r => {
                            const syncState = getTrackSyncState(r);
                            const chip =
                              syncState === "synced"
                                ? { label: "Saved to your storage", className: "text-vessel-green bg-vessel-green/10 border-vessel-green/20", Icon: Check }
                                : syncState === "processing"
                                ? { label: "Saving…", className: "text-vessel-accent bg-vessel-accent/10 border-vessel-accent/20", Icon: Loader2 }
                                : syncState === "failed"
                                ? { label: "Save failed", className: "text-vessel-red bg-vessel-red/10 border-vessel-red/20", Icon: AlertTriangle }
                                : { label: "On this device only", className: "text-vessel-text-muted bg-vessel-bg-base border-vessel-border", Icon: AlertTriangle };
                            const isRowSelected =
                              currentSelection ? currentSelection.has(r.id) : true;
                            const hasAudioSibling = !!r.audioBlobUrl;
                            const rowHasVideo = (r.mimeType || "").includes("video");
                            const rowHasVideoOnly = rowHasVideo && !!r.videoBlobUrl;
                            // Screen sibling availability — true once the
                            // recipient has a remote URL or, for the local
                            // owner row, an idb:// fallback exists. The UI
                            // mirrors how audio/video-only download buttons
                            // gate themselves: button stays visible but
                            // disabled when the sibling isn't there.
                            const rowHasScreen = !!r.screenBlobUrl;
                            return (
                              <div
                                key={r.id}
                                className={`flex flex-col gap-2 py-2 px-3 rounded-lg hover:bg-vessel-bg-base transition-colors ${
                                  isRowSelected ? "bg-vessel-bg-base/50" : ""
                                }`}
                                data-testid={`row-track-${r.id}`}
                              >
                                <div className="flex items-center gap-3">
                                  <input
                                    type="checkbox"
                                    checked={isRowSelected}
                                    onChange={() => toggleTrackSelection(session.id, r.id)}
                                    className="w-4 h-4 rounded border-vessel-border accent-vessel-accent shrink-0"
                                    data-testid={`checkbox-track-${r.id}`}
                                    aria-label={`Include ${r.participantName} in bundle`}
                                  />
                                  <AvatarMark
                                    pubkey={r.ownerPubkey}
                                    displayName={r.participantName}
                                    className="w-8 h-8"
                                    initialsClassName="text-xs"
                                  />
                                  <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-vessel-text-primary truncate">{r.participantName}</div>
                                    <div className="text-xs text-vessel-text-muted font-mono-vessel">
                                      {formatDuration(r.durationSeconds)} &middot; {formatSize(r.sizeBytes)} &middot; {rowHasVideo ? 'Video + Audio' : 'Audio only'}
                                      {hasAudioSibling ? (
                                        <span className="text-vessel-text-secondary"> &middot; Audio only ready</span>
                                      ) : null}
                                    </div>
                                  </div>
                                  <div
                                    className={`hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] shrink-0 ${chip.className}`}
                                    data-testid={`chip-track-sync-${r.id}`}
                                    data-state={syncState}
                                  >
                                    <chip.Icon className={`w-3 h-3 ${syncState === "processing" ? "animate-spin" : ""}`} />
                                    <span>{chip.label}</span>
                                  </div>
                                  <button
                                    onClick={() =>
                                      setDeleteTarget({
                                        kind: "track",
                                        recordingId: r.id,
                                        participantName: r.participantName,
                                        blobUrl: r.blobUrl,
                                      })
                                    }
                                    className="w-9 h-9 rounded-full flex items-center justify-center text-vessel-text-secondary hover:text-vessel-red hover:bg-vessel-red/10 transition-colors shrink-0"
                                    data-testid={`button-delete-track-${r.id}`}
                                    aria-label="Delete track"
                                    title="Delete track"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                                {/* Per-row 3-stream download buttons —
                                    matches SessionComplete row affordance.
                                    Disabled buttons stay visible so the user
                                    can see what's available per row. */}
                                <div className="flex flex-wrap items-center gap-2 pl-7">
                                  <VesselButton
                                    variant="ghost"
                                    size="sm"
                                    disabled={!r.blobUrl}
                                    onClick={() => void handleDownloadStream(r, "video+audio")}
                                    data-testid={`button-download-va-${r.id}`}
                                    title={
                                      rowHasVideo
                                        ? "Download combined video + audio"
                                        : "Camera was off — downloads the combined audio recording"
                                    }
                                  >
                                    <Film className="w-3.5 h-3.5 mr-1.5" />
                                    {rowHasVideo ? "Video + Audio" : "Combined (audio)"}
                                  </VesselButton>
                                  <VesselButton
                                    variant="ghost"
                                    size="sm"
                                    disabled={!rowHasVideoOnly}
                                    onClick={() => void handleDownloadStream(r, "video-only")}
                                    data-testid={`button-download-v-${r.id}`}
                                    title={
                                      rowHasVideoOnly
                                        ? "Download a true video-only file (no audio bytes)"
                                        : rowHasVideo
                                          ? "No video-only file for this track."
                                          : "No video for this track"
                                    }
                                  >
                                    <Video className="w-3.5 h-3.5 mr-1.5" />
                                    Video only
                                  </VesselButton>
                                  <VesselButton
                                    variant="ghost"
                                    size="sm"
                                    disabled={!hasAudioSibling}
                                    onClick={() => void handleDownloadStream(r, "audio-only")}
                                    data-testid={`button-download-a-${r.id}`}
                                    title={hasAudioSibling ? "Download audio only" : "No audio-only file for this track."}
                                  >
                                    <Music className="w-3.5 h-3.5 mr-1.5" />
                                    Audio only
                                  </VesselButton>
                                  <VesselButton
                                    variant="ghost"
                                    size="sm"
                                    disabled={!rowHasScreen}
                                    onClick={() => void handleDownloadStream(r, "screen-only")}
                                    data-testid={`button-download-s-${r.id}`}
                                    title={
                                      rowHasScreen
                                        ? "Download the screen-share file from this session"
                                        : "This participant didn't share their screen"
                                    }
                                  >
                                    <MonitorPlay className="w-3.5 h-3.5 mr-1.5" />
                                    Screen
                                  </VesselButton>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Bundle footer — same shape as SessionComplete's
                            footer: one stream choice for the whole selection. */}
                        <div
                          className="mt-4 p-4 rounded-xl bg-vessel-bg-base border border-vessel-border"
                          data-testid={`bundle-footer-${session.id}`}
                        >
                          <div className="flex items-start gap-2 mb-3 text-xs text-vessel-text-secondary">
                            <Package className="w-4 h-4 text-vessel-accent shrink-0 mt-0.5" />
                            <div>
                              {selectedCount > 0 ? (
                                <>
                                  <div>
                                    <span className="font-medium text-vessel-text-primary">
                                      {selectedCount} track{selectedCount === 1 ? "" : "s"}
                                    </span>{" "}
                                    selected. Choose what to include.
                                  </div>
                                  <div
                                    className="mt-1 text-[11px] text-vessel-text-muted"
                                    data-testid={`bundle-footer-totals-${session.id}`}
                                  >
                                    <span data-testid={`bundle-total-va-${session.id}`}>Video and audio: {formatSize(selectedTotals.videoAudio)}</span>
                                    <span className="mx-2 opacity-50">·</span>
                                    <span data-testid={`bundle-total-v-${session.id}`}>Video only: {selectedTotals.videoOnly > 0 ? formatSize(selectedTotals.videoOnly) : "—"}</span>
                                    <span className="mx-2 opacity-50">·</span>
                                    <span data-testid={`bundle-total-a-${session.id}`}>Audio only: {selectedTotals.audioOnly > 0 ? formatSize(selectedTotals.audioOnly) : "—"}</span>
                                  </div>
                                </>
                              ) : (
                                <>Select tracks above to enable the bundle download.</>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <label className="sr-only" htmlFor={`bundle-stream-${session.id}`}>
                              What to include
                            </label>
                            <select
                              id={`bundle-stream-${session.id}`}
                              value={getBundleStream(session.id)}
                              onChange={(e) =>
                                setBundleStream(session.id, e.target.value as TrackStreamKind)
                              }
                              disabled={isBundling || selectedCount === 0}
                              className="h-9 rounded-md border border-vessel-border bg-vessel-bg-base px-2 text-sm text-vessel-text-primary disabled:opacity-50"
                              data-testid={`select-bundle-stream-${session.id}`}
                            >
                              <option value="video+audio">Video + Audio</option>
                              <option value="video-only">Video only</option>
                              <option value="audio-only">Audio only</option>
                            </select>
                            <VesselButton
                              variant="primary"
                              size="sm"
                              disabled={isBundling || selectedCount === 0}
                              onClick={() =>
                                void handleBundleDownload(session, getBundleStream(session.id))
                              }
                              data-testid={`button-bundle-download-${session.id}`}
                            >
                              {isBundling ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              ) : getBundleStream(session.id) === "video-only" ? (
                                <Video className="w-4 h-4 mr-2" />
                              ) : getBundleStream(session.id) === "audio-only" ? (
                                <Music className="w-4 h-4 mr-2" />
                              ) : (
                                <Film className="w-4 h-4 mr-2" />
                              )}
                              Download selected (.zip)
                            </VesselButton>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
            </>
          )}
        </div>
      </main>
      {shareSession && (
        <ShareModal
          open={!!shareSession}
          onOpenChange={(o) => {
            if (!o) setShareSession(null);
          }}
          session={shareSession}
        />
      )}

      <RecordingInspector
        open={!!inspectSession}
        onOpenChange={(o) => {
          if (!o) setInspectSession(null);
        }}
        session={inspectSession}
      />


      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o && !isDeleting) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent
          className="bg-vessel-bg-surface border-vessel-border text-vessel-text-primary"
          data-testid="dialog-delete-confirm"
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl font-bold flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-vessel-red" />
              {deleteTarget?.kind === "session"
                ? "Delete this session?"
                : "Delete this track?"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-vessel-text-secondary leading-relaxed">
              {deleteTarget?.kind === "session" ? (
                <>
                  This permanently removes{" "}
                  <span className="text-vessel-text-primary font-medium">
                    "{deleteTarget.title}"
                  </span>{" "}
                  and all{" "}
                  {deleteTarget.recordings.length} track
                  {deleteTarget.recordings.length === 1 ? "" : "s"} in it from
                  your vault. Anyone you shared a link with will see a "this
                  share is no longer available" message. This can't be undone.
                </>
              ) : deleteTarget?.kind === "track" ? (
                <>
                  This permanently removes{" "}
                  <span className="text-vessel-text-primary font-medium">
                    {deleteTarget.participantName}
                  </span>
                  's track from your vault. This can't be undone.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel
              disabled={isDeleting}
              className="bg-transparent border-vessel-border text-vessel-text-primary hover:bg-vessel-bg-elevated hover:text-vessel-text-primary"
              data-testid="button-delete-cancel"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleConfirmDelete();
              }}
              disabled={isDeleting}
              className="bg-vessel-red text-white hover:bg-vessel-red/90 hover:text-white border-0"
              data-testid="button-delete-confirm"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  {deleteTarget?.kind === "session" ? "Delete session" : "Delete track"}
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
