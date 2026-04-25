import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import {
  Download,
  Loader2,
  ShieldAlert,
  Inbox,
  FileWarning,
  Wifi,
  ShieldOff,
  X,
  AlertCircle,
  Check,
} from "lucide-react";
import { motion } from "framer-motion";
import type { RecipientManifest, ShareResolveErrorCode } from "../../lib/share-resolver";
import { isSafeDownloadUrl, verifyTrackHash } from "../../lib/share-resolver";
import {
  downloadToBlob,
  saveBlob,
  DownloadCancelled,
  DownloadError,
  type DownloadProgress,
} from "../../lib/share-download";
import { getInitials } from "../../lib/identity";
import { useIdentity } from "../../hooks/use-identity";
import {
  resolveAvatarColor,
  useStoredAvatarColor,
} from "../../hooks/use-avatar-color";
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

type DownloadState =
  | { status: "idle" }
  | { status: "downloading"; received: number; total: number | null }
  | { status: "verifying" }
  | { status: "done" }
  | { status: "tampered"; expected: string; actual: string }
  | { status: "error"; message: string };

type TrackRowProps = {
  track: RecipientManifest["tracks"][number];
};

function TrackRow({ track }: TrackRowProps) {
  const [state, setState] = useState<DownloadState>({ status: "idle" });
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const { pubkey: selfPubkey } = useIdentity();
  const storedColor = useStoredAvatarColor();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  const safeSetState = useCallback((next: DownloadState) => {
    if (mountedRef.current) setState(next);
  }, []);

  const handleDownload = useCallback(async () => {
    if (!track.url) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    safeSetState({ status: "downloading", received: 0, total: null });
    const fileName = suggestedFilename(track);
    try {
      const blob = await downloadToBlob({
        url: track.url,
        signal: controller.signal,
        onProgress: (p: DownloadProgress) => {
          if (!mountedRef.current) return;
          setState((prev) =>
            prev.status === "downloading"
              ? { status: "downloading", received: p.receivedBytes, total: p.totalBytes }
              : prev,
          );
        },
      });

      // Re-hash the bytes locally and compare against the per-track hash from
      // the decrypted manifest. This catches a malicious storage server that
      // serves different bytes than the host originally uploaded — without
      // this check the recipient would silently save tampered files.
      safeSetState({ status: "verifying" });
      const verification = await verifyTrackHash(blob, track.hash);
      if (controller.signal.aborted) {
        safeSetState({ status: "idle" });
        return;
      }
      if (verification.status === "mismatch") {
        // Do NOT save — surface a loud warning so the recipient can ask the
        // host for a new link or download from a trusted server.
        safeSetState({
          status: "tampered",
          expected: verification.expected,
          actual: verification.actual,
        });
        return;
      }
      if (verification.status === "error") {
        safeSetState({ status: "error", message: verification.message });
        return;
      }
      // status === "ok" or "skipped" (no expected hash in the manifest)
      saveBlob(blob, fileName);
      safeSetState({ status: "done" });
    } catch (err) {
      if (err instanceof DownloadCancelled) {
        safeSetState({ status: "idle" });
        return;
      }
      const message =
        err instanceof DownloadError
          ? err.message
          : err instanceof Error
          ? err.message
          : "The download failed.";
      safeSetState({ status: "error", message });
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  }, [track, safeSetState]);

  const handleCancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    safeSetState({ status: "idle" });
  }, [safeSetState]);

  const fallbackTotal = track.sizeBytes && Number.isFinite(track.sizeBytes) && track.sizeBytes > 0 ? track.sizeBytes : null;

  let actionSlot: React.ReactNode;
  if (!track.url) {
    actionSlot = (
      <span
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-vessel-bg-base border border-vessel-border text-vessel-text-muted text-xs font-medium shrink-0"
        data-testid={`text-track-unavailable-${track.recordingId}`}
      >
        Not yet uploaded
      </span>
    );
  } else if (!isSafeDownloadUrl(track.url)) {
    actionSlot = (
      <span
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-vessel-bg-base border border-vessel-border text-vessel-text-muted text-xs font-medium shrink-0"
        data-testid={`text-track-unsafe-${track.recordingId}`}
        title="The download address looks unsafe and was blocked."
      >
        Blocked
      </span>
    );
  } else if (state.status === "downloading") {
    actionSlot = (
      <button
        type="button"
        onClick={handleCancel}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-vessel-bg-base border border-vessel-border text-vessel-text-secondary text-xs font-medium shrink-0 hover:text-vessel-text-primary hover:border-vessel-text-secondary transition-colors"
        data-testid={`button-cancel-${track.recordingId}`}
      >
        <X className="w-3.5 h-3.5" />
        Cancel
      </button>
    );
  } else if (state.status === "verifying") {
    actionSlot = (
      <span
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-vessel-bg-base border border-vessel-border text-vessel-text-secondary text-xs font-medium shrink-0"
        data-testid={`text-verifying-${track.recordingId}`}
      >
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Verifying
      </span>
    );
  } else if (state.status === "tampered") {
    actionSlot = (
      <button
        type="button"
        onClick={handleDownload}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-vessel-bg-base border border-vessel-red text-vessel-red text-xs font-bold hover:opacity-90 transition-opacity shrink-0"
        data-testid={`button-retry-${track.recordingId}`}
      >
        <Download className="w-3.5 h-3.5" />
        Try again
      </button>
    );
  } else if (state.status === "done") {
    actionSlot = (
      <span
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-vessel-bg-base border border-vessel-border text-vessel-accent text-xs font-medium shrink-0"
        data-testid={`text-download-done-${track.recordingId}`}
      >
        <Check className="w-3.5 h-3.5" />
        Saved
      </span>
    );
  } else {
    actionSlot = (
      <button
        type="button"
        onClick={handleDownload}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-vessel-accent text-vessel-bg-base text-xs font-bold hover:opacity-90 transition-opacity shrink-0"
        data-testid={`button-download-${track.recordingId}`}
      >
        <Download className="w-3.5 h-3.5" />
        {state.status === "error" ? "Retry" : "Download"}
      </button>
    );
  }

  return (
    <div
      className="p-4 rounded-lg bg-vessel-bg-surface border border-vessel-border"
      data-testid={`recipient-track-${track.recordingId}`}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
          style={{ backgroundColor: resolveAvatarColor(track.participantPubkey || track.recordingId, selfPubkey, storedColor) }}
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
        {actionSlot}
      </div>

      {state.status === "downloading" && (
        <DownloadProgressBar
          received={state.received}
          total={state.total ?? fallbackTotal}
          recordingId={track.recordingId}
        />
      )}

      {state.status === "error" && (
        <div
          className="mt-3 flex items-start gap-2 p-3 rounded-md bg-vessel-bg-base border border-vessel-border text-vessel-red"
          role="alert"
          data-testid={`text-download-error-${track.recordingId}`}
        >
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="text-xs leading-relaxed">{state.message}</div>
        </div>
      )}

      {state.status === "tampered" && (
        <div
          className="mt-3 flex items-start gap-2 p-3 rounded-md bg-vessel-red/10 border border-vessel-red text-vessel-red"
          role="alert"
          data-testid={`text-download-tampered-${track.recordingId}`}
        >
          <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="text-xs leading-relaxed">
            <div className="font-bold mb-1">
              This file doesn't match what the host shared
            </div>
            <p className="opacity-90">
              The bytes from the storage server don't match the fingerprint in
              the host's signed manifest. The file was not saved. Ask the host
              to share a new link, or try again later in case the storage
              server is in a bad state.
            </p>
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] opacity-80 hover:opacity-100">
                Technical details
              </summary>
              <div className="mt-1 font-mono-vessel text-[10px] break-all opacity-80">
                <div>
                  <span className="opacity-70">expected: </span>
                  <span data-testid={`text-tampered-expected-${track.recordingId}`}>
                    {state.expected}
                  </span>
                </div>
                <div>
                  <span className="opacity-70">received: </span>
                  <span data-testid={`text-tampered-actual-${track.recordingId}`}>
                    {state.actual}
                  </span>
                </div>
              </div>
            </details>
          </div>
        </div>
      )}
    </div>
  );
}

function DownloadProgressBar({
  received,
  total,
  recordingId,
}: {
  received: number;
  total: number | null;
  recordingId: string;
}) {
  const hasTotal = !!total && total > 0;
  const pct = hasTotal ? Math.min(100, Math.round((received / (total as number)) * 100)) : null;
  return (
    <div className="mt-3" data-testid={`progress-${recordingId}`}>
      <div className="h-1.5 w-full rounded-full bg-vessel-bg-base overflow-hidden">
        {hasTotal ? (
          <div
            className="h-full bg-vessel-accent transition-[width] duration-150 ease-out"
            style={{ width: `${pct}%` }}
            data-testid={`progress-fill-${recordingId}`}
          />
        ) : (
          <div className="h-full w-1/3 bg-vessel-accent animate-pulse" />
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px] font-mono-vessel text-vessel-text-muted">
        <span data-testid={`progress-bytes-${recordingId}`}>
          {formatSize(received)}
          {hasTotal ? ` / ${formatSize(total as number)}` : ""}
        </span>
        <span>
          {hasTotal ? `${pct}%` : "Downloading…"}
        </span>
      </div>
    </div>
  );
}

export function RecipientPage({ loading, error, manifest, onRetry }: RecipientPageProps) {
  const { pubkey: selfPubkey } = useIdentity();
  const storedColor = useStoredAvatarColor();
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
                  >
                    <TrackRow track={track} />
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
