import { useState, useEffect, useCallback, useRef } from "react";
import { Copy, Check, Loader2, Share2, Users, Info, Trash2, ShieldOff } from "lucide-react";
import { motion } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "../../hooks/use-toast";
import { useIdentity } from "../../hooks/use-identity";
import {
  publishSessionArchive,
  type SessionArchiveResult,
  type TrackDescriptor,
} from "../../lib/session-archive";
import {
  revokeShareLink,
  ShareRevokeError,
  isLocallyRevoked,
} from "../../lib/share-revoke";
import { getInitials } from "../../lib/identity";
import {
  resolveAvatarColor,
  useStoredAvatarColor,
} from "../../hooks/use-avatar-color";
import { VesselButton } from "../vessel-ui/VesselButton";

export type ShareModalRecording = {
  id: string;
  ownerPubkey: string;
  participantName: string;
  blobUrl: string | null | undefined;
  blobHash?: string | null | undefined;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number;
};

export type ShareModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: {
    id: string;
    title: string;
    createdAt: Date;
    recordings: ShareModalRecording[];
  };
};

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast({ description: "Link copied to clipboard" });
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast({
        variant: "destructive",
        description: "Couldn't copy to clipboard",
      });
    }
  }, [value, toast]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-vessel-accent text-vessel-bg-base text-xs font-bold hover:opacity-90 transition-opacity shrink-0"
      data-testid="button-copy"
      aria-label={copied ? "Link copied" : label}
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5" /> Copied
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5" /> {label}
        </>
      )}
    </button>
  );
}

export function ShareModal({ open, onOpenChange, session }: ShareModalProps) {
  const { identity, displayName, pubkey } = useIdentity();
  const storedColor = useStoredAvatarColor();
  const { toast } = useToast();
  const [archive, setArchive] = useState<SessionArchiveResult | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revokeRequested, setRevokeRequested] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  // Versioned guard: each archive call gets a unique id; only the latest one
  // is allowed to write back to component state. Prevents stale completions
  // from a previous session.id (or a previous open cycle) clobbering UI.
  const requestIdRef = useRef(0);

  const archiveSession = useCallback(async () => {
    const myId = ++requestIdRef.current;
    if (!identity || !pubkey) {
      setError("Sign-in is required to share a session.");
      return;
    }
    setIsArchiving(true);
    setError(null);
    try {
      const tracks: TrackDescriptor[] = session.recordings.map((r) => ({
        recordingId: r.id,
        participantPubkey: r.ownerPubkey,
        participantName: r.participantName,
        blobUrl: r.blobUrl,
        blobHash: r.blobHash,
        mimeType: r.mimeType,
        sizeBytes: r.sizeBytes,
        durationSeconds: r.durationSeconds,
      }));
      const result = await publishSessionArchive(
        identity,
        {
          sessionId: session.id,
          sessionTitle: session.title,
          hostPubkey: pubkey,
          hostName: displayName || "Host",
          endedAt: session.createdAt,
        },
        tracks
      );
      if (requestIdRef.current !== myId) return;
      setArchive(result);
      toast({ description: "Session archived — share away!" });
    } catch (err: any) {
      if (requestIdRef.current !== myId) return;
      console.error("Failed to archive session", err);
      setError("We couldn't archive this session. Try again in a moment.");
    } finally {
      if (requestIdRef.current === myId) setIsArchiving(false);
    }
  }, [identity, pubkey, displayName, session, toast]);

  // Reset + auto-archive each time the modal opens for a new session. The
  // requestIdRef bump in archiveSession guarantees in-flight calls from the
  // previous open cycle / session.id will be ignored.
  useEffect(() => {
    if (!open) {
      // Closing: invalidate any in-flight archive too.
      requestIdRef.current++;
      return;
    }
    setArchive(null);
    setError(null);
    setRevokeRequested(false);
    setIsRevoking(false);
    setRevoked(false);
    setRevokeError(null);
    void archiveSession();
  }, [open, session.id, archiveSession]);

  // Reflect any prior revocation as soon as the archive lands. Covers the
  // case where the modal is reopened and the archive is re-published with a
  // fresh fingerprint that we've never revoked, plus the (unusual) case where
  // a prior tab already revoked this exact archiveId.
  useEffect(() => {
    if (archive && isLocallyRevoked(archive.archiveId)) {
      setRevoked(true);
    }
  }, [archive]);

  const handleRevoke = useCallback(async () => {
    if (!archive) return;
    setIsRevoking(true);
    setRevokeError(null);
    try {
      const result = await revokeShareLink(archive.archiveId);
      setRevoked(true);
      setRevokeRequested(false);
      if (result.publish.successCount < result.publish.totalCount) {
        toast({
          description: `Link revoked on ${result.publish.successCount} of ${result.publish.totalCount} sharing servers.`,
        });
      } else {
        toast({ description: "Share link revoked." });
      }
    } catch (err) {
      const message =
        err instanceof ShareRevokeError
          ? err.message
          : "Couldn't revoke this link right now. Try again in a moment.";
      setRevokeError(message);
    } finally {
      setIsRevoking(false);
    }
  }, [archive, toast]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[560px] bg-vessel-bg-surface border-vessel-border text-vessel-text-primary"
        data-testid="dialog-share"
      >
        <DialogHeader>
          <DialogTitle className="font-display text-xl font-bold flex items-center gap-2">
            <Share2 className="w-5 h-5 text-vessel-accent" />
            Share session
          </DialogTitle>
          <DialogDescription className="text-vessel-text-secondary">
            {session.title}
          </DialogDescription>
        </DialogHeader>

        {isArchiving ? (
          <div className="flex flex-col items-center gap-3 py-12">
            <Loader2 className="w-7 h-7 text-vessel-accent animate-spin" />
            <p className="text-sm text-vessel-text-secondary">Archiving your session…</p>
          </div>
        ) : error ? (
          <div className="py-8 text-center">
            <p className="text-sm text-vessel-red mb-4">{error}</p>
            <VesselButton variant="ghost" size="sm" onClick={archiveSession}>
              Try again
            </VesselButton>
          </div>
        ) : archive && revoked ? (
          <div className="py-10 text-center" data-testid="share-revoked">
            <div className="mx-auto w-12 h-12 rounded-full bg-vessel-bg-base border border-vessel-border flex items-center justify-center text-vessel-text-secondary mb-4">
              <ShieldOff className="w-6 h-6" />
            </div>
            <h3 className="font-display text-lg font-bold text-vessel-text-primary mb-2">
              Link revoked
            </h3>
            <p className="text-sm text-vessel-text-secondary leading-relaxed max-w-sm mx-auto">
              Anyone who tries to open this link will see a "share has been
              revoked" message instead of the tracks.
            </p>
            <p className="text-xs text-vessel-text-muted mt-3">
              Archive {archive.archiveId}
            </p>
          </div>
        ) : archive ? (
          <Tabs defaultValue="editor" className="w-full">
            <TabsList
              className="grid grid-cols-3 gap-1 h-auto p-1 bg-vessel-bg-base border border-vessel-border rounded-lg w-full"
            >
              <TabsTrigger
                value="editor"
                data-testid="tab-share-editor"
                className="px-2 py-1.5 text-xs sm:text-sm font-medium text-vessel-text-secondary hover:text-vessel-text-primary data-[state=active]:bg-vessel-bg-elevated data-[state=active]:text-vessel-accent data-[state=active]:shadow-none transition-colors"
              >
                <Share2 className="w-3.5 h-3.5 mr-1.5 hidden sm:inline-block" /> Editor
              </TabsTrigger>
              <TabsTrigger
                value="tracks"
                data-testid="tab-share-tracks"
                className="px-2 py-1.5 text-xs sm:text-sm font-medium text-vessel-text-secondary hover:text-vessel-text-primary data-[state=active]:bg-vessel-bg-elevated data-[state=active]:text-vessel-accent data-[state=active]:shadow-none transition-colors"
              >
                <Users className="w-3.5 h-3.5 mr-1.5 hidden sm:inline-block" /> Per Track
              </TabsTrigger>
              <TabsTrigger
                value="info"
                data-testid="tab-share-info"
                className="px-2 py-1.5 text-xs sm:text-sm font-medium text-vessel-text-secondary hover:text-vessel-text-primary data-[state=active]:bg-vessel-bg-elevated data-[state=active]:text-vessel-accent data-[state=active]:shadow-none transition-colors"
              >
                <Info className="w-3.5 h-3.5 mr-1.5 hidden sm:inline-block" /> Archive Info
              </TabsTrigger>
            </TabsList>

            {/* Stable-height tab body so switching tabs doesn't shift the footer */}
            <div className="min-h-[260px]">

            {/* Tab 1: Editor */}
            <TabsContent value="editor" className="pt-4 space-y-4 mt-0">
              <p className="text-sm text-vessel-text-secondary">
                Anyone with this link can download your session tracks.
              </p>
              <div className="flex items-center gap-2 p-2 rounded-lg bg-vessel-bg-base border border-vessel-border">
                <input
                  readOnly
                  value={archive.shareUrl}
                  className="flex-1 bg-transparent text-xs font-mono-vessel text-vessel-text-primary outline-none px-2 py-1.5"
                  data-testid="input-share-editor-link"
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label="Editor share link"
                />
                <CopyButton value={archive.shareUrl} label="Copy Link" />
              </div>
              <p className="text-xs text-vessel-text-muted leading-relaxed">
                Only people with this link can open it. The reading code lives
                in the link itself — never on a server.
              </p>
              {archive.publish.successCount === 0 ? (
                <p
                  className="text-xs text-vessel-red leading-relaxed"
                  data-testid="text-publish-failed"
                >
                  We couldn't reach any sharing servers. The link won't work yet — try again in a moment.
                </p>
              ) : archive.publish.successCount < archive.publish.totalCount ? (
                <p
                  className="text-xs text-vessel-text-muted leading-relaxed"
                  data-testid="text-publish-partial"
                >
                  Saved to {archive.publish.successCount} of {archive.publish.totalCount} sharing servers.
                  Recipients can still open the link.
                </p>
              ) : null}
            </TabsContent>

            {/* Tab 2: Per-track */}
            <TabsContent value="tracks" className="pt-4 space-y-3 mt-0">
              <p className="text-sm text-vessel-text-secondary">
                Send each contributor a link to just their own track.
              </p>
              <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
                {archive.perTrackUrls.map((t, i) => {
                  const recording = session.recordings.find((r) => r.id === t.recordingId);
                  const ownerPubkey = recording?.ownerPubkey || "";
                  return (
                    <motion.div
                      key={t.recordingId}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className="flex items-center gap-3 p-3 rounded-lg bg-vessel-bg-base border border-vessel-border"
                    >
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                        style={{ backgroundColor: resolveAvatarColor(ownerPubkey, pubkey, storedColor) }}
                      >
                        <span className="text-white text-xs font-bold">
                          {getInitials(t.participantName)}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-vessel-text-primary truncate">
                          {t.participantName}
                        </div>
                        <div className="text-[10px] text-vessel-text-muted font-mono-vessel truncate">
                          {t.url}
                        </div>
                      </div>
                      <CopyButton value={t.url} label="Copy" />
                    </motion.div>
                  );
                })}
              </div>
            </TabsContent>

            {/* Tab 3: Archive info */}
            <TabsContent value="info" className="pt-4 space-y-4 mt-0">
              <div>
                <label className="block text-xs uppercase tracking-wide text-vessel-text-muted mb-1.5 font-mono-vessel">
                  Archive ID
                </label>
                <div className="flex items-center gap-2 p-2 rounded-lg bg-vessel-bg-base border border-vessel-border">
                  <input
                    readOnly
                    value={archive.archiveId}
                    className="flex-1 bg-transparent text-xs font-mono-vessel text-vessel-text-primary outline-none px-2 py-1.5"
                    data-testid="input-archive-id"
                    onFocus={(e) => e.currentTarget.select()}
                    aria-label="Archive ID"
                  />
                  <CopyButton value={archive.archiveId} label="Copy" />
                </div>
              </div>
              <p className="text-xs text-vessel-text-secondary leading-relaxed">
                A short fingerprint that uniquely identifies this archive. Anyone
                with the share link can confirm they're opening the same archive
                by checking this matches.
              </p>
              <div className="pt-2 text-xs text-vessel-text-muted">
                <div>Archived: {new Date(archive.archivedAt).toLocaleString()}</div>
                <div>Tracks: {archive.perTrackUrls.length}</div>
              </div>
            </TabsContent>

            </div>

            {/* Revoke action — always visible at the bottom of the tab area */}
            <div className="mt-5 pt-4 border-t border-vessel-border">
              {revokeRequested ? (
                <div className="space-y-3" data-testid="revoke-confirm">
                  <p className="text-xs text-vessel-text-secondary leading-relaxed">
                    Take this link down? Anyone who opens it from now on will see
                    a "share has been revoked" message instead of the tracks.
                    This can't be undone — you'd need to share again to make a
                    new link.
                  </p>
                  {revokeError && (
                    <p
                      className="text-xs text-vessel-red leading-relaxed"
                      data-testid="text-revoke-error"
                    >
                      {revokeError}
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <VesselButton
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setRevokeRequested(false);
                        setRevokeError(null);
                      }}
                      disabled={isRevoking}
                      data-testid="button-revoke-cancel"
                    >
                      Cancel
                    </VesselButton>
                    <button
                      type="button"
                      onClick={handleRevoke}
                      disabled={isRevoking}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-vessel-red text-white text-xs font-bold hover:opacity-90 transition-opacity disabled:opacity-60"
                      data-testid="button-revoke-confirm"
                    >
                      {isRevoking ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Revoking…
                        </>
                      ) : (
                        <>
                          <Trash2 className="w-3.5 h-3.5" />
                          Revoke link
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-vessel-text-muted leading-relaxed">
                    Change your mind? You can take this link down so it stops
                    working.
                  </p>
                  <button
                    type="button"
                    onClick={() => setRevokeRequested(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-vessel-border bg-vessel-bg-base text-vessel-text-primary text-xs font-bold hover:border-vessel-red hover:text-vessel-red transition-colors shrink-0"
                    data-testid="button-revoke"
                  >
                    <ShieldOff className="w-3.5 h-3.5" />
                    Revoke link
                  </button>
                </div>
              )}
            </div>
          </Tabs>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
