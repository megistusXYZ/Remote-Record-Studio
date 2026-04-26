import { useState, useMemo, useCallback } from "react";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Share2, Download, AlertTriangle, Check, Loader2, Trash2 } from "lucide-react";
import {
  useListRecordings,
  getListRecordingsQueryKey,
  useDeleteRecording,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  downloadRecordingById,
  extractRecordingIdFromLocalUrl,
  isLocalBlobUrl,
  deleteRecordingBlob,
} from "../../lib/recordings-storage";
import { useToast } from "../../hooks/use-toast";
import { AvatarMark } from "../AvatarMark";
import { useIdentity } from "../../hooks/use-identity";
import {
  resolveAvatarColor,
  useStoredAvatarColor,
} from "../../hooks/use-avatar-color";
import { VaultSidebar } from "./VaultSidebar";
import { EmptyState } from "./EmptyState";
import { ShareModal, type ShareModalRecording } from "./ShareModal";
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
  // Open in a new tab — same-origin downloads can use the `download` attribute,
  // but cross-origin storage servers will simply navigate. New tab keeps the
  // user's session intact either way.
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
  const [expandedSessionIds, setExpandedSessionIds] = useState<Set<string>>(new Set());
  const [shareSession, setShareSession] = useState<{
    id: string;
    title: string;
    createdAt: Date;
    recordings: ShareModalRecording[];
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const { data: recordings, isLoading } = useListRecordings(
    { pubkey },
    { query: { enabled: !!pubkey, queryKey: getListRecordingsQueryKey({ pubkey }) } }
  );

  const filteredSessions = useMemo(() => {
    const sessionsMap = new Map<string, { id: string; title: string; createdAt: Date; recordings: any[]; maxDuration: number; totalSize: number }>();
    for (const r of recordings || []) {
      const key = r.sessionId || `__solo_${r.id}`;
      if (!sessionsMap.has(key)) {
        sessionsMap.set(key, { id: key, title: r.sessionTitle || "Untitled session", createdAt: new Date(r.createdAt), recordings: [], maxDuration: 0, totalSize: 0 });
      }
      const s = sessionsMap.get(key)!;
      s.recordings.push(r);
      s.maxDuration = Math.max(s.maxDuration, r.durationSeconds);
      s.totalSize += r.sizeBytes;
      const rDate = new Date(r.createdAt);
      if (rDate < s.createdAt) s.createdAt = rDate;
    }
    const sessionsList = Array.from(sessionsMap.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    if (!search) return sessionsList;
    return sessionsList.filter(s => s.title.toLowerCase().includes(search.toLowerCase()));
  }, [recordings, search]);

  const toggleExpand = (id: string) => {
    setExpandedSessionIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDownloadAll = async (session: any) => {
    let downloaded = 0;
    let missing = 0;
    for (const r of session.recordings) {
      // The DB row id is a server-side UUID; the local blob is keyed by the
      // client-side recordingId encoded inside the idb:// URL. Always extract
      // from the URL — never use r.id as an IndexedDB key.
      const localId = extractRecordingIdFromLocalUrl(r.blobUrl);
      if (localId) {
        await downloadRecordingById(localId, `${r.participantName}_track.webm`);
        downloaded++;
      } else if (r.blobUrl) {
        // Recording is on a remote storage server — kick off a regular
        // browser download via the canonical URL.
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

  const handleShareSession = (session: any) => {
    setShareSession({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      recordings: session.recordings.map((r: any) => ({
        id: r.id,
        ownerPubkey: r.ownerPubkey,
        participantName: r.participantName,
        blobUrl: r.blobUrl,
        blobHash: r.blobHash,
        mimeType: r.mimeType,
        sizeBytes: r.sizeBytes,
        durationSeconds: r.durationSeconds,
      })),
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

  const handleDownloadTrack = async (r: any) => {
    const localId = extractRecordingIdFromLocalUrl(r.blobUrl);
    if (localId) {
      await downloadRecordingById(localId, `${r.participantName}_track.webm`);
      return;
    }
    if (r.blobUrl) {
      triggerRemoteDownload(r.blobUrl, `${r.participantName}_track.webm`);
      return;
    }
    toast({ description: "This track isn't available for download." });
  };

  return (
    <div className="flex h-[100dvh] bg-vessel-bg-base text-vessel-text-primary">
      <VaultSidebar active="my-vault" myVaultCount={filteredSessions.length} />
      <main className="flex-1 min-w-0 overflow-y-auto pb-[calc(72px+env(safe-area-inset-bottom))] md:pb-0">
        <header className="sticky top-0 bg-vessel-bg-base/80 backdrop-blur-xl border-b border-vessel-border z-10 px-4 sm:px-8 py-4 sm:py-0 sm:h-[72px] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
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

        <div className="px-4 sm:px-6 md:px-8 py-6 space-y-4 max-w-5xl mx-auto">
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
            filteredSessions.map(session => {
              const isExpanded = expandedSessionIds.has(session.id);
              const uniqueParticipants = Array.from(new Set(session.recordings.map(r => r.participantName))).map(name => session.recordings.find(r => r.participantName === name)!);

              return (
                <div key={session.id} className="p-6 rounded-xl bg-vessel-bg-surface border border-vessel-border hover:border-vessel-border-strong transition-colors" data-testid={`card-session-${session.id}`}>
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-vessel-accent shadow-[0_0_8px_rgba(0,212,170,0.4)]" />
                        <h2 className="font-display text-lg font-bold text-vessel-text-primary truncate">{session.title}</h2>
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
                            recordings: session.recordings.map((r: any) => ({
                              id: r.id,
                              blobUrl: r.blobUrl,
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
                    <VesselButton variant="ghost" size="sm" onClick={() => toggleExpand(session.id)} data-testid={`button-toggle-tracks-${session.id}`}>
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
                            return (
                              <div key={r.id} className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-vessel-bg-base transition-colors" data-testid={`row-track-${r.id}`}>
                                <AvatarMark
                                  pubkey={r.ownerPubkey}
                                  displayName={r.participantName}
                                  className="w-8 h-8"
                                  initialsClassName="text-xs"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium text-vessel-text-primary truncate">{r.participantName}</div>
                                  <div className="text-xs text-vessel-text-muted font-mono-vessel">
                                    {formatDuration(r.durationSeconds)} &middot; {formatSize(r.sizeBytes)} &middot; {r.mimeType.includes('video') ? 'Video + Audio' : 'Audio'}
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
                                  onClick={() => handleDownloadTrack(r)}
                                  className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-vessel-bg-elevated transition-colors shrink-0"
                                  data-testid={`button-download-track-${r.id}`}
                                  aria-label="Download track"
                                  title="Download track"
                                >
                                  <Download className="w-4 h-4 text-vessel-text-secondary" />
                                </button>
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
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })
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
