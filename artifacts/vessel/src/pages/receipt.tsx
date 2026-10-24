import { useEffect, useMemo, useState, useCallback } from "react";
import { useRoute, Link } from "wouter";
import { format } from "date-fns";
import {
  Download,
  Loader2,
  ShieldOff,
  ShieldAlert,
  Wifi,
  Inbox,
  FileWarning,
  AlertCircle,
  Check,
  X,
  Lock,
  Server,
  Eye,
} from "lucide-react";
import { motion } from "framer-motion";
import {
  resolveShareLink,
  type RecipientManifest,
  type ShareResolveErrorCode,
  ShareResolveError,
  isSafeDownloadUrl,
  verifyTrackHash,
} from "../lib/share-resolver";
import {
  getReceiptByPointer,
  type PersonalReceiptRecord,
} from "../lib/personal-receipts";
import { isLocallyRevoked } from "../lib/share-revoke";
import {
  downloadToBlob,
  saveBlob,
  DownloadCancelled,
  DownloadError,
  type DownloadProgress,
} from "../lib/share-download";
import { VesselBrandIcon } from "../components/icons/VesselBrandIcon";
import { VesselButton } from "../components/vessel-ui/VesselButton";

/**
 * Personal receipt page mounted at `/r/:pointer`.
 *
 * This is what every participant — host and guest — walks away with at the
 * end of a session. It wraps the existing share-resolver in a friendlier
 * frame focused on a single audience: the person who owns this archive.
 *
 * The decryption key lives only in the URL fragment (`window.location.hash`)
 * and never travels to a server.
 *
 * The page degrades gracefully if the user is opening a stranger's receipt
 * URL on a different device — we just don't have the local receipt record
 * (host name, "you talked to" copy) so we render a stripped-back version.
 */

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

type DownloadState =
  | { status: "idle" }
  | { status: "downloading"; received: number; total: number | null }
  | { status: "verifying" }
  | { status: "done" }
  | { status: "tampered"; expected: string; actual: string }
  | { status: "error"; message: string };

export default function ReceiptPage() {
  const [, params] = useRoute<{ pointer: string }>("/r/:pointer");
  const pointer = params?.pointer || "";

  const [loading, setLoading] = useState(true);
  const [manifest, setManifest] = useState<RecipientManifest | null>(null);
  const [error, setError] = useState<{ code: ShareResolveErrorCode; message: string } | null>(null);
  const [receipt, setReceipt] = useState<PersonalReceiptRecord | null>(null);

  const load = useCallback(async () => {
    if (!pointer) {
      setError({ code: "bad_pointer", message: "Missing receipt link." });
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setManifest(null);
    setReceipt(getReceiptByPointer(pointer));
    try {
      const result = await resolveShareLink({
        pointer,
        fragment: window.location.hash || "",
      });
      setManifest(result);
    } catch (err) {
      if (err instanceof ShareResolveError) {
        setError({ code: err.code, message: err.message });
      } else {
        setError({ code: "network", message: "Something went wrong opening this receipt." });
      }
    } finally {
      setLoading(false);
    }
  }, [pointer]);

  useEffect(() => {
    void load();
  }, [load]);

  const archivedAtPretty = useMemo(() => {
    const iso = manifest?.archivedAt || receipt?.publishedAt;
    if (!iso) return null;
    try {
      return format(new Date(iso), "MMM d, yyyy 'at' h:mm a");
    } catch {
      return null;
    }
  }, [manifest?.archivedAt, receipt?.publishedAt]);

  const track = manifest?.tracks[0];
  const sessionTitle = manifest?.sessionTitle || receipt?.sessionTitle || "Your recording";
  const hostName = receipt?.hostName || manifest?.hostName || "the host";
  const isHost = receipt?.isHost ?? false;
  const others = receipt?.otherParticipantNames ?? [];
  const archiveId = receipt?.archiveId;
  const locallyRevoked = !!archiveId && isLocallyRevoked(archiveId);

  return (
    <div className="min-h-screen bg-vessel-bg-base text-vessel-text-primary">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        {/* Brand header */}
        <header className="flex items-center justify-between mb-10">
          <a
            href="/"
            className="group flex items-center gap-2 text-vessel-text-primary"
            data-testid="link-vessel-home"
          >
            <VesselBrandIcon className="w-7 h-7 text-vessel-accent shrink-0 transition-transform group-hover:-translate-y-px" />
            <span className="font-display text-lg font-bold tracking-tight group-hover:text-vessel-accent transition-colors">
              Vessel
            </span>
          </a>
          <span className="text-xs text-vessel-text-muted font-mono-vessel uppercase tracking-wider">
            Your receipt
          </span>
        </header>

        {loading && (
          <div className="flex flex-col items-center py-24" data-testid="receipt-loading">
            <Loader2 className="w-7 h-7 text-vessel-accent animate-spin mb-3" />
            <p className="text-sm text-vessel-text-secondary">Opening your receipt…</p>
          </div>
        )}

        {!loading && error && (
          <ReceiptErrorBlock
            code={error.code}
            onRetry={error.code === "network" || error.code === "not_found" ? load : undefined}
            wasLocallyRevoked={locallyRevoked}
            sessionTitle={sessionTitle}
            hostName={hostName}
            isHost={isHost}
          />
        )}

        {!loading && !error && manifest && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="mb-8" data-testid="receipt-header">
              <p className="text-xs font-mono-vessel text-vessel-accent uppercase tracking-wider mb-2">
                Your receipt
              </p>
              <h1
                className="font-display text-3xl font-bold tracking-tight mb-3"
                data-testid="text-receipt-session-title"
              >
                {sessionTitle}
              </h1>
              <p className="text-sm text-vessel-text-secondary leading-relaxed">
                {isHost ? (
                  <>
                    You hosted this session
                    {others.length > 0 && (
                      <>
                        {" "}with{" "}
                        <span
                          className="text-vessel-text-primary font-medium"
                          data-testid="text-receipt-others"
                        >
                          {formatNameList(others)}
                        </span>
                      </>
                    )}
                    .
                  </>
                ) : (
                  <>
                    You recorded with{" "}
                    <span
                      className="text-vessel-text-primary font-medium"
                      data-testid="text-receipt-host"
                    >
                      {hostName}
                    </span>
                    {others.length > 0 && (
                      <>
                        {" "}and{" "}
                        <span className="text-vessel-text-primary font-medium">
                          {formatNameList(others)}
                        </span>
                      </>
                    )}
                    .
                  </>
                )}
                {archivedAtPretty && (
                  <>
                    {" "}
                    <span className="text-vessel-text-muted">· {archivedAtPretty}</span>
                  </>
                )}
              </p>
            </div>

            {/* The track */}
            {track ? (
              <TrackDownloadCard track={track} />
            ) : (
              <div className="p-6 rounded-xl bg-vessel-bg-surface border border-vessel-border text-center">
                <Inbox className="w-6 h-6 text-vessel-text-muted mx-auto mb-2" />
                <p className="text-sm text-vessel-text-secondary">
                  Your track isn't in this receipt.
                </p>
              </div>
            )}

            {/* Sovereignty contract */}
            <div
              className="mt-8 p-5 rounded-xl bg-vessel-bg-surface border border-vessel-border"
              data-testid="receipt-contract"
            >
              <h2 className="font-display text-sm font-bold text-vessel-text-primary mb-4 flex items-center gap-2">
                <Lock className="w-4 h-4 text-vessel-accent" />
                What this means
              </h2>
              <ul className="space-y-3 text-sm text-vessel-text-secondary leading-relaxed">
                <li className="flex items-start gap-3">
                  <Server className="w-4 h-4 text-vessel-text-muted mt-0.5 shrink-0" />
                  <span>
                    Your recording is stored on{" "}
                    <span className="text-vessel-text-primary font-medium">a storage server</span>
                    , not on Vessel's server. Vessel never sees the file.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <Eye className="w-4 h-4 text-vessel-text-muted mt-0.5 shrink-0" />
                  <span>
                    {isHost ? (
                      <>This receipt link is yours. Don't share it — anyone with the full link can download your track.</>
                    ) : (
                      <>
                        <span className="text-vessel-text-primary font-medium">{hostName}</span>{" "}
                        has access to your track for their multi-track edit. You can take that
                        access away at any time below.
                      </>
                    )}
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <Lock className="w-4 h-4 text-vessel-text-muted mt-0.5 shrink-0" />
                  <span>
                    Only this device can take this link down.
                  </span>
                </li>
              </ul>
            </div>

            {/* Revoke CTA */}
            {archiveId && (
              <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
                <Link
                  href={`/revoke/${encodeURIComponent(archiveId)}`}
                  data-testid="link-revoke-receipt"
                >
                  <VesselButton
                    variant="ghost"
                    size="md"
                    className="w-full sm:w-auto hover:text-vessel-red hover:border-vessel-red/40 hover:bg-vessel-red/10"
                  >
                    {isHost ? "Revoke share link" : `Revoke ${hostName}'s access`}
                  </VesselButton>
                </Link>
              </div>
            )}

            <p className="text-xs text-vessel-text-muted mt-10 text-center leading-relaxed">
              This page reads everything directly in your browser. Your visit is not tracked.
            </p>
          </motion.div>
        )}
      </div>
    </div>
  );
}

function formatNameList(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function ReceiptErrorBlock({
  code,
  onRetry,
  wasLocallyRevoked,
  sessionTitle,
  hostName,
  isHost,
}: {
  code: ShareResolveErrorCode;
  onRetry?: () => void;
  wasLocallyRevoked: boolean;
  sessionTitle: string;
  hostName: string;
  isHost: boolean;
}) {
  // Special case: if the user themselves revoked this share from this
  // device, render a confirmation tone rather than a generic error.
  const friendlyRevoke = code === "revoked" && wasLocallyRevoked;
  const icon =
    code === "revoked" ? (
      <ShieldOff className="w-6 h-6" />
    ) : code === "missing_key" || code === "wrong_key" ? (
      <ShieldAlert className="w-6 h-6" />
    ) : code === "not_found" ? (
      <Inbox className="w-6 h-6" />
    ) : code === "network" ? (
      <Wifi className="w-6 h-6" />
    ) : (
      <FileWarning className="w-6 h-6" />
    );
  const title = friendlyRevoke
    ? "You took this share down"
    : code === "revoked"
    ? "This share has been taken down"
    : code === "missing_key"
    ? "This receipt link can't be opened"
    : code === "wrong_key"
    ? "Wrong link"
    : code === "not_found"
    ? "Receipt not found"
    : code === "bad_pointer"
    ? "Broken link"
    : code === "bad_format"
    ? "Couldn't read this receipt"
    : "Connection trouble";
  const body = friendlyRevoke
    ? `${sessionTitle}: ${
        isHost ? "your share link" : `${hostName}'s access to your track`
      } is no longer active. The link no longer works.`
    : code === "revoked"
    ? "This share is no longer available. Whoever owns this track took the link down."
    : code === "missing_key"
    ? "This link is missing the part that lets you read it. Make sure you copied the whole link, including everything after the # sign."
    : code === "wrong_key"
    ? "This link doesn't match this receipt."
    : code === "not_found"
    ? "We couldn't find this receipt. It may have been removed, or it may not have finished publishing yet."
    : code === "bad_pointer"
    ? "This receipt link looks broken or incomplete."
    : code === "bad_format"
    ? "We could open this receipt but its contents looked unexpected."
    : "We couldn't reach the network to open this receipt. Check your connection and try again.";

  return (
    <div className="flex flex-col items-center text-center max-w-md mx-auto py-16" data-testid="receipt-error">
      <div
        className={`w-14 h-14 rounded-full border flex items-center justify-center mb-4 ${
          friendlyRevoke
            ? "bg-vessel-accent/10 border-vessel-accent/40 text-vessel-accent"
            : "bg-vessel-bg-base border-vessel-border text-vessel-text-secondary"
        }`}
      >
        {icon}
      </div>
      <h2 className="font-display text-xl font-bold text-vessel-text-primary mb-2">{title}</h2>
      <p className="text-sm text-vessel-text-secondary leading-relaxed mb-6">{body}</p>
      {onRetry && (
        <VesselButton variant="ghost" size="sm" onClick={onRetry} data-testid="button-retry-receipt">
          Try again
        </VesselButton>
      )}
    </div>
  );
}

function TrackDownloadCard({ track }: { track: RecipientManifest["tracks"][number] }) {
  const [state, setState] = useState<DownloadState>({ status: "idle" });
  const [controller, setController] = useState<AbortController | null>(null);

  const handleDownload = async () => {
    if (!track.url || !isSafeDownloadUrl(track.url)) {
      setState({ status: "error", message: "This download address looks unsafe and was blocked." });
      return;
    }
    const c = new AbortController();
    setController(c);
    setState({ status: "downloading", received: 0, total: null });
    try {
      const blob = await downloadToBlob({
        url: track.url,
        signal: c.signal,
        onProgress: (p: DownloadProgress) => {
          setState((prev) =>
            prev.status === "downloading"
              ? { status: "downloading", received: p.receivedBytes, total: p.totalBytes }
              : prev,
          );
        },
      });
      setState({ status: "verifying" });
      const verification = await verifyTrackHash(blob, track.hash);
      if (c.signal.aborted) {
        setState({ status: "idle" });
        return;
      }
      if (verification.status === "mismatch") {
        setState({
          status: "tampered",
          expected: verification.expected,
          actual: verification.actual,
        });
        return;
      }
      if (verification.status === "error") {
        setState({ status: "error", message: verification.message });
        return;
      }
      saveBlob(blob, suggestedFilename(track));
      setState({ status: "done" });
    } catch (err) {
      if (err instanceof DownloadCancelled) {
        setState({ status: "idle" });
        return;
      }
      const message =
        err instanceof DownloadError
          ? err.message
          : err instanceof Error
          ? err.message
          : "The download failed.";
      setState({ status: "error", message });
    } finally {
      setController(null);
    }
  };

  const handleCancel = () => {
    controller?.abort();
    setController(null);
    setState({ status: "idle" });
  };

  const fallbackTotal =
    track.sizeBytes && Number.isFinite(track.sizeBytes) && track.sizeBytes > 0 ? track.sizeBytes : null;

  return (
    <div
      className="p-6 rounded-xl bg-gradient-to-br from-vessel-bg-surface to-vessel-bg-elevated border border-vessel-accent/30 shadow-[0_0_40px_rgba(0,212,170,0.08)]"
      data-testid="receipt-track-card"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-mono-vessel text-vessel-text-muted uppercase tracking-wider">
          Your file
        </span>
        <span className="text-xs font-mono-vessel text-vessel-text-muted">
          {formatDuration(track.durationSeconds)} · {formatSize(track.sizeBytes)}
        </span>
      </div>
      <div className="text-sm font-medium text-vessel-text-primary mb-4 truncate">
        {suggestedFilename(track)}
      </div>

      {state.status === "downloading" && (
        <DownloadProgressBar received={state.received} total={state.total ?? fallbackTotal} />
      )}

      {state.status === "tampered" && (
        <div
          className="mb-4 flex items-start gap-2 p-3 rounded-md bg-vessel-red/10 border border-vessel-red text-vessel-red"
          role="alert"
          data-testid="receipt-tampered"
        >
          <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="text-xs leading-relaxed">
            <div className="font-bold mb-1">This file doesn't match what was published</div>
            <p className="opacity-90">
              The file on the storage server doesn't match what was published, so it was
              not saved.
            </p>
          </div>
        </div>
      )}

      {state.status === "error" && (
        <div
          className="mb-4 flex items-start gap-2 p-3 rounded-md bg-vessel-bg-base border border-vessel-border text-vessel-red"
          role="alert"
          data-testid="receipt-download-error"
        >
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="text-xs leading-relaxed">{state.message}</div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        {state.status === "downloading" ? (
          <VesselButton
            variant="ghost"
            size="md"
            onClick={handleCancel}
            className="w-full sm:w-auto"
            data-testid="button-receipt-cancel"
          >
            <X className="w-4 h-4 mr-2" />
            Cancel
          </VesselButton>
        ) : state.status === "verifying" ? (
          <VesselButton
            variant="ghost"
            size="md"
            disabled
            className="w-full sm:w-auto"
            data-testid="button-receipt-verifying"
          >
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Verifying
          </VesselButton>
        ) : state.status === "done" ? (
          <VesselButton
            variant="ghost"
            size="md"
            disabled
            className="w-full sm:w-auto text-vessel-accent"
            data-testid="button-receipt-saved"
          >
            <Check className="w-4 h-4 mr-2" />
            Saved
          </VesselButton>
        ) : (
          <VesselButton
            variant="primary"
            size="md"
            onClick={handleDownload}
            disabled={!track.url || !isSafeDownloadUrl(track.url)}
            className="w-full sm:w-auto"
            data-testid="button-receipt-download"
          >
            <Download className="w-4 h-4 mr-2" />
            {state.status === "tampered" || state.status === "error"
              ? "Try again"
              : "Download my track"}
          </VesselButton>
        )}
      </div>

      {!track.url && (
        <p className="mt-3 text-xs text-vessel-text-muted">
          The file isn't available yet. Try again in a moment.
        </p>
      )}
    </div>
  );
}

function DownloadProgressBar({ received, total }: { received: number; total: number | null }) {
  const hasTotal = !!total && total > 0;
  const pct = hasTotal ? Math.min(100, Math.round((received / (total as number)) * 100)) : null;
  return (
    <div className="mb-4" data-testid="receipt-progress">
      <div className="h-1.5 w-full rounded-full bg-vessel-bg-base overflow-hidden">
        {hasTotal ? (
          <div
            className="h-full bg-vessel-accent transition-[width] duration-150 ease-out"
            style={{ width: `${pct}%` }}
          />
        ) : (
          <div className="h-full w-1/3 bg-vessel-accent animate-pulse" />
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px] font-mono-vessel text-vessel-text-muted">
        <span>
          {formatSize(received)}
          {hasTotal ? ` / ${formatSize(total as number)}` : ""}
        </span>
        <span>{hasTotal ? `${pct}%` : "Downloading…"}</span>
      </div>
    </div>
  );
}
