import { useMemo } from "react";
import { format } from "date-fns";
import { Download, Loader2, ShieldAlert, Inbox, FileWarning, Wifi, ShieldOff } from "lucide-react";
import { motion } from "framer-motion";
import type { RecipientManifest, ShareResolveErrorCode } from "../../lib/share-resolver";
import { isSafeDownloadUrl } from "../../lib/share-resolver";
import { deriveAvatarColorFromPubkey, getInitials } from "../../lib/identity";
import { VesselButton } from "../vessel-ui/VesselButton";

export type RecipientPageProps = {
  loading: boolean;
  error: { code: ShareResolveErrorCode; message: string } | null;
  manifest: RecipientManifest | null;
  onRetry: () => void;
};

function formatDuration(seconds: number) {
  if (!seconds || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}min`;
}

function formatSize(bytes: number) {
  if (!bytes || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function suggestedFilename(track: { participantName: string; mimeType: string }) {
  const ext =
    track.mimeType.includes("webm")
      ? "webm"
      : track.mimeType.includes("mp4")
      ? "mp4"
      : track.mimeType.includes("opus") || track.mimeType.includes("ogg")
      ? "ogg"
      : track.mimeType.includes("wav")
      ? "wav"
      : "bin";
  const safe = track.participantName.replace(/[^a-z0-9-_]+/gi, "-").replace(/-+/g, "-").toLowerCase();
  return `${safe || "track"}.${ext}`;
}

function ErrorBlock({ icon, title, body, onRetry }: { icon: React.ReactNode; title: string; body: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center text-center max-w-md mx-auto py-16" data-testid="recipient-error">
      <div className="w-14 h-14 rounded-full bg-vessel-bg-base border border-vessel-border flex items-center justify-center text-vessel-text-secondary mb-4">
        {icon}
      </div>
      <h2 className="font-display text-xl font-bold text-vessel-text-primary mb-2">{title}</h2>
      <p className="text-sm text-vessel-text-secondary leading-relaxed mb-6">{body}</p>
      {onRetry && (
        <VesselButton variant="ghost" size="sm" onClick={onRetry} data-testid="button-retry">
          Try again
        </VesselButton>
      )}
    </div>
  );
}

export function RecipientPage({ loading, error, manifest, onRetry }: RecipientPageProps) {
  const archivedAtPretty = useMemo(() => {
    if (!manifest?.archivedAt) return null;
    try {
      return format(new Date(manifest.archivedAt), "MMM d, yyyy 'at' h:mm a");
    } catch {
      return null;
    }
  }, [manifest?.archivedAt]);

  return (
    <div className="min-h-screen bg-vessel-bg-base text-vessel-text-primary">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        {/* Brand header */}
        <header className="flex items-center justify-between mb-10">
          <a
            href="/"
            className="flex items-center gap-2 text-vessel-text-primary"
            data-testid="link-vessel-home"
          >
            <div className="w-8 h-8 rounded-md bg-vessel-accent flex items-center justify-center text-vessel-bg-base font-bold">
              V
            </div>
            <span className="font-display text-lg font-bold tracking-tight">Vessel</span>
          </a>
          <span className="text-xs text-vessel-text-muted font-mono-vessel uppercase tracking-wider">
            Shared session
          </span>
        </header>

        {loading && (
          <div className="flex flex-col items-center py-24" data-testid="recipient-loading">
            <Loader2 className="w-7 h-7 text-vessel-accent animate-spin mb-3" />
            <p className="text-sm text-vessel-text-secondary">Opening this archive…</p>
          </div>
        )}

        {!loading && error && (
          <ErrorBlock
            icon={
              error.code === "revoked" ? (
                <ShieldOff className="w-6 h-6" />
              ) : error.code === "missing_key" || error.code === "wrong_key" ? (
                <ShieldAlert className="w-6 h-6" />
              ) : error.code === "not_found" ? (
                <Inbox className="w-6 h-6" />
              ) : error.code === "network" ? (
                <Wifi className="w-6 h-6" />
              ) : (
                <FileWarning className="w-6 h-6" />
              )
            }
            title={
              error.code === "revoked"
                ? "This share has been revoked"
                : error.code === "missing_key"
                ? "This link can't be opened"
                : error.code === "wrong_key"
                ? "Wrong link"
                : error.code === "not_found"
                ? "Archive not found"
                : error.code === "bad_pointer"
                ? "Broken link"
                : error.code === "bad_format"
                ? "Couldn't read this archive"
                : "Connection trouble"
            }
            body={
              error.code === "revoked"
                ? "The host took this link down, so the tracks are no longer available here. If you still need a copy, ask the host to share a new link."
                : error.code === "missing_key"
                ? "This link is missing the part that lets you read it. Make sure you copied the whole link, including everything after the # sign."
                : error.code === "wrong_key"
                ? "The reading code in this link doesn't match this archive. The link may have been edited or truncated."
                : error.code === "not_found"
                ? "We couldn't find this archive. It may have been removed by the host, or the link may be incomplete."
                : error.code === "bad_pointer"
                ? "This share link looks broken or incomplete. Ask the sender to copy it again."
                : error.code === "bad_format"
                ? "We could open this archive but its contents looked unexpected."
                : "We couldn't reach the network to open this archive. Check your connection and try again."
            }
            onRetry={
              error.code === "network" || error.code === "not_found" ? onRetry : undefined
            }
          />
        )}

        {!loading && !error && manifest && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="mb-8" data-testid="recipient-header">
              <h1 className="font-display text-3xl font-bold tracking-tight mb-2">
                {manifest.sessionTitle}
              </h1>
              <p className="text-sm text-vessel-text-secondary">
                Shared by{" "}
                <span className="text-vessel-text-primary font-medium" data-testid="text-host-name">
                  {manifest.hostName}
                </span>
                {archivedAtPretty && <> · {archivedAtPretty}</>}
              </p>
              {manifest.scopedToTrackId && (
                <p className="text-xs text-vessel-text-muted mt-2">
                  Showing your track only.
                </p>
              )}
            </div>

            {manifest.tracks.length === 0 ? (
              <ErrorBlock
                icon={<Inbox className="w-6 h-6" />}
                title="Nothing to download"
                body="There are no tracks in this archive that match your link."
              />
            ) : (
              <div className="space-y-3" data-testid="recipient-track-list">
                {manifest.tracks.map((track, i) => (
                  <motion.div
                    key={track.recordingId || i}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="flex items-center gap-3 p-4 rounded-lg bg-vessel-bg-surface border border-vessel-border"
                    data-testid={`recipient-track-${track.recordingId}`}
                  >
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                      style={{ backgroundColor: deriveAvatarColorFromPubkey(track.participantPubkey || track.recordingId) }}
                    >
                      <span className="text-white text-xs font-bold">
                        {getInitials(track.participantName)}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-vessel-text-primary truncate">
                        {track.participantName}
                      </div>
                      <div className="text-xs text-vessel-text-muted">
                        {formatDuration(track.durationSeconds)} · {formatSize(track.sizeBytes)}
                      </div>
                    </div>
                    {track.url && isSafeDownloadUrl(track.url) ? (
                      <a
                        href={track.url}
                        download={suggestedFilename(track)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-vessel-accent text-vessel-bg-base text-xs font-bold hover:opacity-90 transition-opacity shrink-0"
                        data-testid={`button-download-${track.recordingId}`}
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download
                      </a>
                    ) : track.url ? (
                      <span
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-vessel-bg-base border border-vessel-border text-vessel-text-muted text-xs font-medium shrink-0"
                        data-testid={`text-track-unsafe-${track.recordingId}`}
                        title="The download address looks unsafe and was blocked."
                      >
                        Blocked
                      </span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-vessel-bg-base border border-vessel-border text-vessel-text-muted text-xs font-medium shrink-0"
                        data-testid={`text-track-unavailable-${track.recordingId}`}
                      >
                        Not yet uploaded
                      </span>
                    )}
                  </motion.div>
                ))}
              </div>
            )}

            <p className="text-xs text-vessel-text-muted mt-10 text-center leading-relaxed">
              This page reads everything directly in your browser. Your visit is
              not tracked.
            </p>
          </motion.div>
        )}
      </div>
    </div>
  );
}
