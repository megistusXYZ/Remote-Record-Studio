import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  Loader2,
  Link as LinkIcon,
  Cloud,
  CloudOff,
  ShieldCheck,
  ExternalLink,
  ShieldOff,
  Video,
  Music,
  MonitorPlay,
  Film,
  Package,
  Hash,
  FileText,
  Subtitles,
  Captions,
  Braces,
} from "lucide-react";
import { AvatarMark } from "../AvatarMark";
import { useIdentity } from "../../hooks/use-identity";
import {
  resolveAvatarColor,
  useStoredAvatarColor,
} from "../../hooks/use-avatar-color";
import { downloadBlob } from "../../lib/recordings-storage";
import { VesselButton } from "../vessel-ui/VesselButton";
import { useToast } from "../../hooks/use-toast";
import {
  buildExportFilename,
  downloadSelectionsAsZip,
  resolveStreamBlob,
  downloadBlobAsFile,
  type TrackExportSource,
  type TrackSelection,
  type TrackStreamKind,
} from "../../lib/track-export";
import {
  buildTranscriptBlob,
  pickOriginMs,
  transcriptFilename,
  type TranscriptExportFormat,
} from "../../lib/transcript-export";
import type { TranscriptFragment } from "../../hooks/use-call-signal";

export type Track = {
  participantId: string;
  participantName: string;
  participantPubkey: string;
  recordingId: string | null;
  /** In-memory combined V+A blob — only set for the local participant's
   *  freshly finished recording. Other participants' tracks resolve via
   *  the URL fields below. */
  blob: Blob | null;
  durationSeconds: number;
  sizeBytes: number;
  mimeType: string;
  hasVideo: boolean;
  /** Where this track ended up. `remote` = saved to participant's storage,
   *  `local-only` = upload didn't reach the storage server (kept on this
   *  device only), `unknown` = sync state still settling. */
  storageState?: "remote" | "local-only" | "unknown";
  /** Combined V+A URL — `idb://<id>` when only local, `https://…` once the
   *  storage server returned a canonical URL. Used by the export helper to
   *  resolve the blob when `blob` isn't held in memory. */
  combinedBlobUrl?: string | null;
  /** Combined V+A blob's *remote* URL. Distinct from `combinedBlobUrl`
   *  because the latter falls back to `idb://` for local-only blobs;
   *  the Copy-Link affordance only makes sense for true remote URLs. */
  combinedRemoteUrl?: string | null;
  /** Lowercase-hex SHA-256 of the combined blob bytes. Surfaced as a small
   *  hash chip so the user can verify integrity at a glance, and used by
   *  `verifyTrackHash` when the recipient page downloads the file. */
  combinedBlobHash?: string | null;
  /** Audio-only sibling URL. Null when no audio sibling exists for this
   *  participant (no mic, audio recorder failed, or legacy v=1 manifest). */
  audioBlobUrl?: string | null;
  audioRemoteUrl?: string | null;
  audioBlob?: Blob | null;
  audioMimeType?: string | null;
  audioSizeBytes?: number;
  audioBlobHash?: string | null;
  /** Video-only sibling. `videoOnlyBlob` / `videoOnlyLocalUrl` cover the
   *  local participant; `videoOnlyRemoteUrl` covers cross-device guests
   *  whose host published the v=3 manifest with a `video` block. All null
   *  when the third recorder didn't produce a sibling. */
  videoOnlyBlob?: Blob | null;
  videoOnlyLocalUrl?: string | null;
  videoOnlyRemoteUrl?: string | null;
  videoOnlyMimeType?: string | null;
  videoOnlySizeBytes?: number;
  videoOnlyBlobHash?: string | null;
  /** Optional screen-share sibling captured in parallel by the screen
   *  recorder. Mirrors the audio/video sibling shape so the same
   *  download/copy-link UX works without special-casing. All fields stay
   *  null when this participant didn't share their screen. */
  screenBlob?: Blob | null;
  screenLocalUrl?: string | null;
  screenRemoteUrl?: string | null;
  screenMimeType?: string | null;
  screenSizeBytes?: number;
  screenBlobHash?: string | null;
  screenDurationSeconds?: number | null;
};

/** Status of publishing this device's personal single-track archive. */
export type PersonalArchiveStatus =
  | { status: "idle" }
  | { status: "publishing" }
  | {
      status: "ready";
      archiveId: string;
      receiptUrl: string;
      successCount: number;
      totalCount: number;
    }
  | { status: "error"; message: string };

export type SessionCompleteProps = {
  open: boolean;
  isHost: boolean;
  hostName: string;
  /** Session title, used to name the bundle zip download. */
  sessionTitle?: string;
  /** Wall-clock the session ended; used for the zip filename date stamp. */
  sessionDate?: Date;
  syncStatus: "idle" | "syncing" | "complete" | "partial-failure";
  syncProgress: { synced: number; total: number; percent: number; failed: number };
  tracks: Track[];
  /** Per-device personal-archive publishing state. */
  personalArchive?: PersonalArchiveStatus;
  /** Per-pubkey waiting-for placeholders. `state` is `"listening"` while
   *  the relay subscription window is open, `"timeout"` afterwards. */
  expectedParticipants?: Array<{
    pubkey: string;
    displayName: string;
    state: "listening" | "timeout";
    /** Inline error when a pointer arrived but couldn't be resolved. */
    resolveError?: string;
  }>;
  onViewVault: () => void;
  onStartNew: () => void;
  onClose?: () => void;
  /** Live transcript fragments captured during the session, oldest-first.
   *  When non-empty, the session-complete card surfaces a download row
   *  so the user can grab the transcript in subtitle (SRT/VTT), JSON,
   *  or plain-text form. Empty / undefined hides the row entirely. */
  transcriptFragments?: TranscriptFragment[];
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

/** Build the canonical export source from a Track row. The export helper
 *  uses this to resolve actual blobs at download time. */
function trackToExportSource(track: Track): TrackExportSource {
  return {
    participantName: track.participantName,
    combinedBlobUrl: track.combinedBlobUrl ?? null,
    combinedMimeType: track.mimeType,
    combinedBlob: track.blob ?? null,
    audioBlobUrl: track.audioBlobUrl ?? null,
    audioMimeType: track.audioMimeType ?? null,
    audioBlob: track.audioBlob ?? null,
    videoOnlyBlob: track.videoOnlyBlob ?? null,
    videoOnlyLocalUrl: track.videoOnlyLocalUrl ?? null,
    videoOnlyRemoteUrl: track.videoOnlyRemoteUrl ?? null,
    videoOnlyMimeType: track.videoOnlyMimeType ?? null,
    screenBlob: track.screenBlob ?? null,
    screenLocalUrl: track.screenLocalUrl ?? null,
    screenRemoteUrl: track.screenRemoteUrl ?? null,
    screenMimeType: track.screenMimeType ?? null,
  };
}

/** Truncate a long hash to a glanceable prefix while keeping enough of it
 *  to reasonably identify the file. */
function shortHash(hash: string | null | undefined): string {
  if (!hash) return "";
  return hash.length > 16 ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : hash;
}

/** Whether a URL is a real https:// remote URL we can hand to a third
 *  party. `idb://...` blob URLs are local-only and meaningless to anyone
 *  outside this device, so we never offer them as a Copy Link. */
function isShareableRemoteUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  return url.startsWith("https://") || url.startsWith("http://");
}

/** Build a YYYY-MM-DD stamp suitable for the bundle filename. */
function formatDateStamp(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function bundleFilename(sessionTitle: string | undefined, sessionDate?: Date): string {
  const stamp = formatDateStamp(sessionDate ?? new Date());
  const safeTitle = (sessionTitle ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return safeTitle
    ? `vessel-session-${safeTitle}-${stamp}.zip`
    : `vessel-session-${stamp}.zip`;
}

// ─── Personal receipt card (unchanged behavior) ──────────────────────────
function PersonalReceiptCard({
  personalArchive,
  isHost,
  hostName,
  onCopy,
  receiptArchiveId,
}: {
  personalArchive: PersonalArchiveStatus | undefined;
  isHost: boolean;
  hostName: string;
  onCopy: (url: string) => void;
  receiptArchiveId: string | null;
}) {
  if (!personalArchive || personalArchive.status === "idle") {
    return null;
  }

  if (personalArchive.status === "publishing") {
    return (
      <div
        className="w-full mb-6 p-4 rounded-xl bg-vessel-bg-base border border-vessel-border text-left flex items-center gap-3"
        data-testid="receipt-card-publishing"
      >
        <Loader2 className="w-4 h-4 animate-spin text-vessel-accent shrink-0" />
        <div className="text-sm text-vessel-text-secondary">
          Publishing your personal receipt link…
        </div>
      </div>
    );
  }

  if (personalArchive.status === "error") {
    return (
      <div
        className="w-full mb-6 p-4 rounded-xl bg-vessel-bg-base border border-vessel-border text-left flex items-start gap-3"
        data-testid="receipt-card-error"
      >
        <ShieldOff className="w-4 h-4 text-vessel-amber mt-0.5 shrink-0" />
        <div className="text-sm text-vessel-text-secondary leading-relaxed">
          We couldn't publish your personal receipt link.{" "}
          <span className="text-vessel-text-muted">{personalArchive.message}</span>{" "}
          Your local copy is unaffected.
        </div>
      </div>
    );
  }

  const partial = personalArchive.successCount < personalArchive.totalCount;

  return (
    <div
      className="w-full mb-6 p-5 rounded-xl bg-gradient-to-br from-vessel-accent/8 to-vessel-bg-base border border-vessel-accent/40 text-left"
      data-testid="receipt-card-ready"
    >
      <div className="flex items-center gap-2 mb-2">
        <ShieldCheck className="w-4 h-4 text-vessel-accent shrink-0" />
        <span className="text-xs font-mono-vessel text-vessel-accent uppercase tracking-wider font-semibold">
          {isHost ? "Your archive receipt" : "Your personal receipt"}
        </span>
      </div>
      <p className="text-sm text-vessel-text-secondary leading-relaxed mb-3">
        {isHost ? (
          <>Save this link — it's your archive's receipt and the only way to take this share down later.</>
        ) : (
          <>This is your proof you owned this recording. {hostName} has access to your track until you take it down — open this link any time to revoke.</>
        )}
      </p>

      <div className="flex items-center gap-2 mb-3">
        <code
          className="flex-1 min-w-0 px-3 py-2 rounded-md bg-vessel-bg-base border border-vessel-border font-mono-vessel text-xs text-vessel-text-primary truncate"
          data-testid="text-receipt-url"
          title={personalArchive.receiptUrl}
        >
          {personalArchive.receiptUrl.replace(/^https?:\/\//, "")}
        </code>
        <VesselButton variant="ghost" size="sm" onClick={() => onCopy(personalArchive.receiptUrl)} data-testid="button-copy-receipt">
          <LinkIcon className="w-4 h-4" />
        </VesselButton>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <a href={personalArchive.receiptUrl} target="_blank" rel="noopener noreferrer" className="flex-1" data-testid="link-open-receipt">
          <VesselButton variant="primary" size="sm" className="w-full">
            <ExternalLink className="w-4 h-4 mr-2" />
            Open my receipt
          </VesselButton>
        </a>
        {receiptArchiveId && (
          <a
            href={`/revoke/${encodeURIComponent(receiptArchiveId)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 sm:flex-none"
            data-testid="link-revoke-from-complete"
          >
            <VesselButton variant="ghost" size="sm" className="w-full hover:text-vessel-red hover:border-vessel-red/40 hover:bg-vessel-red/10">
              <ShieldOff className="w-4 h-4 mr-2" />
              Revoke
            </VesselButton>
          </a>
        )}
      </div>

      {partial && (
        <p className="text-[11px] text-vessel-text-muted mt-3 leading-relaxed">
          Published to {personalArchive.successCount} of {personalArchive.totalCount} sharing servers. The rest will catch up shortly.
        </p>
      )}
    </div>
  );
}

function StorageStateChip({ state }: { state?: "remote" | "local-only" | "unknown" }) {
  if (!state || state === "unknown") {
    return (
      <div className="text-xs text-vessel-text-muted mt-1.5 flex items-center gap-1.5">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>Saving to your storage…</span>
      </div>
    );
  }
  if (state === "remote") {
    return (
      <div className="text-xs text-vessel-green mt-1.5 flex items-center gap-1.5" data-testid="chip-track-storage-remote">
        <Cloud className="w-3 h-3" />
        <span>Saved to your storage</span>
      </div>
    );
  }
  return (
    <div className="text-xs text-vessel-amber mt-1.5 flex items-center gap-1.5" data-testid="chip-track-storage-local">
      <CloudOff className="w-3 h-3" />
      <span>On this device only — couldn't reach your storage</span>
    </div>
  );
}

function TrackStreamButtons({
  track,
  onDownload,
  isWorking,
}: {
  track: Track;
  onDownload: (track: Track, kind: TrackStreamKind) => Promise<void>;
  isWorking: boolean;
}) {
  const hasVideo = track.hasVideo;
  const hasAudioSibling = !!track.audioBlob || !!track.audioBlobUrl;
  const hasVideoOnly =
    hasVideo && (!!track.videoOnlyBlob || !!track.videoOnlyLocalUrl || !!track.videoOnlyRemoteUrl);
  const hasCombined =
    !!track.blob || !!track.combinedBlobUrl || !!track.combinedRemoteUrl;
  // Screen sibling availability — independent of camera/mic status. The
  // button stays in the row even when null so the layout doesn't shift,
  // and the disabled state advertises that this participant didn't
  // share. The on-disk file is whatever the screen recorder captured
  // (display video plus optional system audio, depending on what the
  // user opted into at picker time) — we never re-mux it with the mic.
  const hasScreen =
    !!track.screenBlob || !!track.screenLocalUrl || !!track.screenRemoteUrl;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <VesselButton
        variant="primary"
        size="sm"
        disabled={!hasCombined || isWorking}
        title={
          hasVideo
            ? "Download the combined video + audio file"
            : "This participant's camera was off — downloads the combined audio recording"
        }
        onClick={() => onDownload(track, "video+audio")}
        data-testid={`button-download-va-${track.participantId}`}
      >
        <Film className="w-4 h-4 mr-2" />
        {hasVideo ? "Video + Audio" : "Combined (audio)"}
      </VesselButton>
      <VesselButton
        variant="ghost"
        size="sm"
        disabled={!hasVideoOnly || isWorking}
        title={
          hasVideoOnly
            ? "Download a true video-only file (no audio bytes)"
            : hasVideo
              ? "No video-only sibling was recorded for this participant"
              : "No video for this participant"
        }
        onClick={() => onDownload(track, "video-only")}
        data-testid={`button-download-v-${track.participantId}`}
      >
        <Video className="w-4 h-4 mr-2" />
        Video only
      </VesselButton>
      <VesselButton
        variant="ghost"
        size="sm"
        disabled={!hasAudioSibling || isWorking}
        title={hasAudioSibling ? "Download just the audio sibling track" : "No audio-only sibling was recorded"}
        onClick={() => onDownload(track, "audio-only")}
        data-testid={`button-download-a-${track.participantId}`}
      >
        <Music className="w-4 h-4 mr-2" />
        Audio only
      </VesselButton>
      <VesselButton
        variant="ghost"
        size="sm"
        disabled={!hasScreen || isWorking}
        title={
          hasScreen
            ? "Download the screen-share file from this session"
            : "This participant didn't share their screen"
        }
        onClick={() => onDownload(track, "screen-only")}
        data-testid={`button-download-s-${track.participantId}`}
      >
        <MonitorPlay className="w-4 h-4 mr-2" />
        Screen
      </VesselButton>
    </div>
  );
}

function TrackMetaRow({
  track,
  onCopy,
}: {
  track: Track;
  onCopy: (url: string, label: string) => void;
}) {
  const combinedUrl = track.combinedRemoteUrl ?? track.combinedBlobUrl;
  const audioUrl = track.audioRemoteUrl ?? track.audioBlobUrl;
  const videoUrl = track.videoOnlyRemoteUrl ?? track.videoOnlyLocalUrl ?? null;
  // Screen prefers the remote URL; the local idb:// fallback is shown as
  // a hash chip but never as a "Copy file link" since that link is
  // meaningless to anyone outside this device.
  const screenUrl = track.screenRemoteUrl ?? track.screenLocalUrl ?? null;
  const combinedShareable = isShareableRemoteUrl(combinedUrl);
  const audioShareable = isShareableRemoteUrl(audioUrl);
  const videoShareable = isShareableRemoteUrl(videoUrl);
  const screenShareable = isShareableRemoteUrl(screenUrl);
  const showCombinedHash = !!track.combinedBlobHash;
  const showAudioHash = !!track.audioBlobHash;
  const showVideoHash = !!track.videoOnlyBlobHash;
  const showScreenHash = !!track.screenBlobHash;
  if (
    !combinedShareable &&
    !audioShareable &&
    !videoShareable &&
    !screenShareable &&
    !showCombinedHash &&
    !showAudioHash &&
    !showVideoHash &&
    !showScreenHash
  ) {
    return null;
  }
  return (
    <div className="mt-3 pt-3 border-t border-vessel-border/50 flex flex-col gap-2">
      {(showCombinedHash || combinedShareable) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-vessel-text-muted font-mono-vessel uppercase tracking-wider w-12 shrink-0">
            V+A
          </span>
          {showCombinedHash && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-vessel-bg-surface border border-vessel-border text-vessel-text-secondary font-mono-vessel"
              title={`SHA-256: ${track.combinedBlobHash}`}
              data-testid={`chip-hash-va-${track.participantId}`}
            >
              <Hash className="w-3 h-3" />
              {shortHash(track.combinedBlobHash)}
            </span>
          )}
          {combinedShareable && combinedUrl && (
            <button
              type="button"
              onClick={() => onCopy(combinedUrl, "Video + Audio")}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-vessel-text-secondary hover:text-vessel-accent hover:bg-vessel-accent/5 transition-colors"
              title={combinedUrl}
              data-testid={`button-copy-link-va-${track.participantId}`}
            >
              <LinkIcon className="w-3 h-3" />
              <span>Copy file link</span>
            </button>
          )}
        </div>
      )}
      {(showAudioHash || audioShareable) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-vessel-text-muted font-mono-vessel uppercase tracking-wider w-12 shrink-0">
            Audio
          </span>
          {showAudioHash && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-vessel-bg-surface border border-vessel-border text-vessel-text-secondary font-mono-vessel"
              title={`SHA-256: ${track.audioBlobHash}`}
              data-testid={`chip-hash-a-${track.participantId}`}
            >
              <Hash className="w-3 h-3" />
              {shortHash(track.audioBlobHash)}
            </span>
          )}
          {audioShareable && audioUrl && (
            <button
              type="button"
              onClick={() => onCopy(audioUrl, "Audio only")}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-vessel-text-secondary hover:text-vessel-accent hover:bg-vessel-accent/5 transition-colors"
              title={audioUrl}
              data-testid={`button-copy-link-a-${track.participantId}`}
            >
              <LinkIcon className="w-3 h-3" />
              <span>Copy file link</span>
            </button>
          )}
        </div>
      )}
      {(showVideoHash || videoShareable) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-vessel-text-muted font-mono-vessel uppercase tracking-wider w-12 shrink-0">
            Video
          </span>
          {showVideoHash && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-vessel-bg-surface border border-vessel-border text-vessel-text-secondary font-mono-vessel"
              title={`SHA-256: ${track.videoOnlyBlobHash}`}
              data-testid={`chip-hash-v-${track.participantId}`}
            >
              <Hash className="w-3 h-3" />
              {shortHash(track.videoOnlyBlobHash)}
            </span>
          )}
          {videoShareable && videoUrl && (
            <button
              type="button"
              onClick={() => onCopy(videoUrl, "Video only")}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-vessel-text-secondary hover:text-vessel-accent hover:bg-vessel-accent/5 transition-colors"
              title={videoUrl}
              data-testid={`button-copy-link-v-${track.participantId}`}
            >
              <LinkIcon className="w-3 h-3" />
              <span>Copy file link</span>
            </button>
          )}
        </div>
      )}
      {(showScreenHash || screenShareable) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-vessel-text-muted font-mono-vessel uppercase tracking-wider w-12 shrink-0">
            Screen
          </span>
          {showScreenHash && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-vessel-bg-surface border border-vessel-border text-vessel-text-secondary font-mono-vessel"
              title={`SHA-256: ${track.screenBlobHash}`}
              data-testid={`chip-hash-s-${track.participantId}`}
            >
              <Hash className="w-3 h-3" />
              {shortHash(track.screenBlobHash)}
            </span>
          )}
          {screenShareable && screenUrl && (
            <button
              type="button"
              onClick={() => onCopy(screenUrl, "Screen")}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-vessel-text-secondary hover:text-vessel-accent hover:bg-vessel-accent/5 transition-colors"
              title={screenUrl}
              data-testid={`button-copy-link-s-${track.participantId}`}
            >
              <LinkIcon className="w-3 h-3" />
              <span>Copy file link</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function WaitingForRow({
  pubkey,
  displayName,
  state,
  resolveError,
}: {
  pubkey: string;
  displayName: string;
  state: "listening" | "timeout";
  resolveError?: string;
}) {
  return (
    <div
      className="p-4 rounded-xl bg-vessel-bg-base border border-vessel-border border-dashed flex items-start gap-3"
      data-testid={`row-waiting-${pubkey}`}
      data-state={resolveError ? "error" : state}
    >
      <div className="w-4 h-4 mt-1 shrink-0" />
      <AvatarMark
        pubkey={pubkey}
        displayName={displayName}
        className="w-10 h-10 shrink-0 opacity-60"
        initialsClassName="text-sm"
      />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-vessel-text-secondary truncate">
          {displayName}'s Track
        </div>
        {resolveError ? (
          <div
            className="text-xs text-vessel-amber mt-1 flex items-center gap-1.5"
            data-testid={`text-waiting-error-${pubkey}`}
          >
            <ShieldOff className="w-3 h-3 shrink-0" />
            <span>Couldn't load — {resolveError}</span>
          </div>
        ) : state === "listening" ? (
          <div className="text-xs text-vessel-text-muted mt-1 flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Waiting for {displayName}'s upload to land…</span>
          </div>
        ) : (
          <div
            className="text-xs text-vessel-amber mt-1 flex items-center gap-1.5"
            data-testid={`text-waiting-timeout-${pubkey}`}
          >
            <span className="w-2 h-2 rounded-full bg-vessel-amber shrink-0" />
            <span>
              Still waiting for {displayName}. They may not have finished
              uploading yet — leave this open or check back later.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Compact card with one button per supported transcript export
 *  format. Sits inside the success view so a host or guest can grab a
 *  caption file (SRT/VTT), structured JSON for editors, or a plain
 *  speaker:line .txt for show-notes. Hidden entirely when no fragments
 *  were captured. */
function TranscriptDownloadCard({
  fragmentCount,
  onDownload,
}: {
  fragmentCount: number;
  onDownload: (format: TranscriptExportFormat) => void;
}) {
  return (
    <div
      className="w-full p-4 rounded-xl bg-vessel-bg-base border border-vessel-border text-left mb-3"
      data-testid="card-transcript-download"
    >
      <div className="flex items-center gap-2 mb-3">
        <Captions className="w-4 h-4 text-vessel-accent" aria-hidden="true" />
        <div className="text-sm font-medium text-vessel-text-primary">
          Transcript
        </div>
        <div className="text-xs text-vessel-text-muted ml-auto">
          {fragmentCount} {fragmentCount === 1 ? "line" : "lines"}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <VesselButton
          variant="muted"
          size="sm"
          onClick={() => onDownload("srt")}
          data-testid="button-transcript-srt"
        >
          <Subtitles className="w-4 h-4 mr-2" />
          .srt
        </VesselButton>
        <VesselButton
          variant="muted"
          size="sm"
          onClick={() => onDownload("vtt")}
          data-testid="button-transcript-vtt"
        >
          <Subtitles className="w-4 h-4 mr-2" />
          .vtt
        </VesselButton>
        <VesselButton
          variant="muted"
          size="sm"
          onClick={() => onDownload("json")}
          data-testid="button-transcript-json"
        >
          <Braces className="w-4 h-4 mr-2" />
          .json
        </VesselButton>
        <VesselButton
          variant="muted"
          size="sm"
          onClick={() => onDownload("txt")}
          data-testid="button-transcript-txt"
        >
          <FileText className="w-4 h-4 mr-2" />
          .txt
        </VesselButton>
      </div>
      <p className="text-[11px] text-vessel-text-muted mt-3 leading-relaxed">
        Captions are generated on-device — choose subtitles for video editors, JSON for downstream tools, or plain text for show notes.
      </p>
    </div>
  );
}

export function SessionComplete({
  open,
  isHost,
  hostName,
  sessionTitle,
  sessionDate,
  syncStatus,
  syncProgress,
  tracks,
  personalArchive,
  expectedParticipants = [],
  onViewVault,
  onStartNew,
  onClose,
  transcriptFragments,
}: SessionCompleteProps) {
  const { toast } = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { pubkey: selfPubkey } = useIdentity();
  const storedColor = useStoredAvatarColor();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bundleStream, setBundleStream] = useState<TrackStreamKind>("video+audio");
  const [busy, setBusy] = useState(false);

  // Re-prime selection to "all" when the track list changes.
  useEffect(() => {
    setSelected(new Set(tracks.map((t) => t.participantId)));
  }, [tracks]);

  // Confetti effect (unchanged)
  useEffect(() => {
    if ((syncStatus === "complete" || syncStatus === "partial-failure") && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;

      const particles: Array<{ x: number; y: number; r: number; color: string; vx: number; vy: number; life: number; maxLife: number }> = [];
      const colors = ["#00d4aa", "#ffffff", "#00a886"];

      for (let i = 0; i < 80; i++) {
        particles.push({
          x: canvas.width / 2,
          y: canvas.height / 2,
          r: Math.random() * 4 + 2,
          color: colors[Math.floor(Math.random() * colors.length)],
          vx: (Math.random() - 0.5) * 20,
          vy: (Math.random() - 0.5) * 20 - 5,
          life: 0,
          maxLife: 60 + Math.random() * 30,
        });
      }

      let animationFrame: number;
      const animate = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let allDead = true;
        particles.forEach((p) => {
          if (p.life < p.maxLife) {
            allDead = false;
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.5;
            p.life++;
            ctx.globalAlpha = 1 - p.life / p.maxLife;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.fill();
          }
        });
        if (!allDead) {
          animationFrame = requestAnimationFrame(animate);
        } else {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      };
      animate();

      return () => cancelAnimationFrame(animationFrame);
    }
    return undefined;
  }, [syncStatus]);

  const handleCopyReceipt = (url: string) => {
    navigator.clipboard.writeText(url);
    toast({ description: "Receipt link copied — keep it somewhere safe." });
  };

  const handleCopyFileLink = (url: string, label: string) => {
    void navigator.clipboard.writeText(url).then(
      () => toast({ description: `${label} file link copied.` }),
      () =>
        toast({
          variant: "destructive",
          description: "Couldn't copy to the clipboard. Long-press the link to copy manually.",
        }),
    );
  };

  const receiptArchiveId =
    personalArchive?.status === "ready" ? personalArchive.archiveId : null;

  const isSyncing = syncStatus === "syncing" || (syncStatus === "idle" && tracks.length === 0);

  // Per-row single-stream download.
  const handleSingleDownload = async (track: Track, kind: TrackStreamKind) => {
    if (busy) return;
    setBusy(true);
    try {
      const selection: TrackSelection = { source: trackToExportSource(track), stream: kind };
      const blob = await resolveStreamBlob(selection);
      if (!blob) {
        toast({
          variant: "destructive",
          description:
            kind === "audio-only"
              ? "Audio-only sibling isn't available for this participant."
              : "Track isn't available on this device.",
        });
        return;
      }
      const filename = buildExportFilename(
        track.participantName,
        kind,
        kind === "audio-only"
          ? track.audioMimeType ?? blob.type
          : kind === "video-only"
            ? track.videoOnlyMimeType ?? blob.type
            : track.mimeType,
      );
      downloadBlobAsFile(blob, filename);
    } finally {
      setBusy(false);
    }
  };

  // Bundle download for all selected rows; serialized behind `busy`.
  const handleBundleDownload = async (kind: TrackStreamKind) => {
    if (busy) return;
    const chosen = tracks.filter((t) => selected.has(t.participantId));
    if (chosen.length === 0) {
      toast({ description: "Pick at least one participant first." });
      return;
    }
    setBusy(true);
    try {
      // Selective by stream type: missing siblings → reported in `skipped`,
      // never swapped for a different stream.
      const selections: TrackSelection[] = chosen.map((t) => ({
        source: trackToExportSource(t),
        stream: kind,
      }));
      const result = await downloadSelectionsAsZip(selections, bundleFilename(sessionTitle, sessionDate));
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
        toast({ description: `Bundle downloaded — ${result.includedFilenames.length} tracks.` });
      }
    } catch (err) {
      console.error("Bundle download failed", err);
      toast({ variant: "destructive", description: "Couldn't build the zip. Try again in a moment." });
    } finally {
      setBusy(false);
    }
  };

  // Transcript downloads. Origin is the wall-clock of the first
  // fragment so SRT/VTT timestamps start near 00:00 instead of an
  // unhelpful absolute Unix timestamp. Disabled when there are no
  // fragments at all so the buttons don't tease at empty downloads.
  const transcriptOriginMs = useMemo(
    () =>
      transcriptFragments && transcriptFragments.length > 0
        ? pickOriginMs(transcriptFragments, null)
        : 0,
    [transcriptFragments],
  );
  const handleTranscriptDownload = (format: TranscriptExportFormat) => {
    if (!transcriptFragments || transcriptFragments.length === 0) return;
    try {
      const blob = buildTranscriptBlob(
        transcriptFragments,
        format,
        transcriptOriginMs,
        sessionTitle,
      );
      const filename = transcriptFilename(sessionTitle, format, sessionDate);
      downloadBlob(blob, filename);
    } catch (err) {
      console.error("Transcript download failed", err);
      toast({
        variant: "destructive",
        description: "Couldn't build the transcript file. Try again in a moment.",
      });
    }
  };
  const hasTranscript = !!(transcriptFragments && transcriptFragments.length > 0);

  const toggleSelect = (participantId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(participantId)) next.delete(participantId);
      else next.add(participantId);
      return next;
    });
  };
  const allSelected = tracks.length > 0 && tracks.every((t) => selected.has(t.participantId));
  const toggleSelectAll = () => {
    setSelected(allSelected ? new Set() : new Set(tracks.map((t) => t.participantId)));
  };

  const selectedCount = tracks.filter((t) => selected.has(t.participantId)).length;

  // Per-stream byte totals across the current selection (footer summary).
  // The screen total is folded in alongside the existing three so the
  // footer chips reflect every stream the bundle dropdown can produce.
  const selectedTotals = tracks
    .filter((t) => selected.has(t.participantId))
    .reduce(
      (acc, t) => ({
        videoAudio: acc.videoAudio + (t.sizeBytes || 0),
        videoOnly: acc.videoOnly + (t.videoOnlySizeBytes || 0),
        audioOnly: acc.audioOnly + (t.audioSizeBytes || 0),
        screenOnly: acc.screenOnly + (t.screenSizeBytes || 0),
      }),
      { videoAudio: 0, videoOnly: 0, audioOnly: 0, screenOnly: 0 },
    );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-vessel-bg-base/95 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto"
        >
          <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none z-[60]" />

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3 }}
            className={`w-full p-8 rounded-2xl bg-vessel-bg-surface border border-vessel-border shadow-2xl relative z-50 ${
              isSyncing ? "max-w-md" : isHost ? "max-w-3xl" : "max-w-md"
            }`}
          >
            {isSyncing ? (
              <div className="flex flex-col items-center text-center">
                <div className="w-16 h-16 mb-6 flex items-end justify-center gap-1">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <motion.div
                      key={i}
                      className="w-1.5 bg-vessel-accent rounded-t-sm"
                      animate={{ scaleY: [0.4, 1, 0.4] }}
                      transition={{ duration: 1, repeat: Infinity, delay: i * 0.1 }}
                      style={{ originY: 1, height: "100%" }}
                    />
                  ))}
                </div>
                <h2 className="font-display text-2xl font-bold text-vessel-text-primary mb-2">Saving your session...</h2>
                <p className="text-sm text-vessel-text-secondary mb-8">We're packaging your tracks. This usually takes under a minute.</p>

                <div className="w-full space-y-0">
                  {tracks.map((track, idx) => (
                    <motion.div
                      key={track.participantId}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.08 }}
                      className="flex items-center gap-3 py-3 border-b border-vessel-border last:border-0"
                    >
                      <AvatarMark
                        pubkey={track.participantPubkey}
                        displayName={track.participantName}
                        className="w-8 h-8"
                        initialsClassName="text-xs"
                      />
                      <span className="flex-1 text-sm font-medium text-vessel-text-primary text-left truncate">{track.participantName}</span>
                      <div className="w-32 h-1 rounded-full bg-vessel-bg-base overflow-hidden shrink-0">
                        <div className="h-full bg-vessel-accent transition-all duration-500" style={{ width: `${syncProgress.percent}%` }} />
                      </div>
                      <span className="font-mono-vessel text-xs text-vessel-text-secondary w-10 text-right shrink-0">{syncProgress.percent}%</span>
                      <div className="w-4 h-4 flex items-center justify-center shrink-0">
                        {syncProgress.percent < 100 ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-vessel-accent" />
                        ) : (
                          <Check className="w-3.5 h-3.5 text-vessel-accent" />
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center text-center">
                <div className="w-20 h-20 mb-6 flex items-center justify-center">
                  <motion.svg width="80" height="80" viewBox="0 0 80 80" className="text-vessel-accent">
                    <circle cx="40" cy="40" r="38" fill="currentColor" fillOpacity="0.1" />
                    <motion.path
                      d="M25 40 L35 50 L55 30"
                      fill="transparent"
                      stroke="currentColor"
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 0.6, ease: "easeOut" }}
                    />
                  </motion.svg>
                </div>

                {isHost ? (
                  <>
                    <h2 className="font-display text-3xl font-bold mb-2 text-vessel-text-primary">Session complete.</h2>
                    <p className="text-sm text-vessel-text-secondary mb-4">
                      Each track is saved separately so you can edit at studio quality. Pick a stream — you'll get a real audio file, not a transcoded clip.
                    </p>

                    {/* Select-all header + running selection count. */}
                    <div className="w-full mb-2 flex items-center justify-between text-left">
                      <label className="inline-flex items-center gap-2 text-xs text-vessel-text-secondary cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleSelectAll}
                          className="w-4 h-4 rounded border-vessel-border accent-vessel-accent"
                          data-testid="checkbox-select-all-tracks"
                        />
                        <span>{allSelected ? "Deselect all" : "Select all"}</span>
                      </label>
                      <span className="text-xs text-vessel-text-muted font-mono-vessel">
                        {selectedCount} of {tracks.length} selected
                      </span>
                    </div>

                    <div className="w-full space-y-3 mb-4 text-left">
                      {tracks.map((track) => {
                        const isSelected = selected.has(track.participantId);
                        return (
                          <div
                            key={track.participantId}
                            className={`p-4 rounded-xl bg-vessel-bg-base border ${
                              isSelected ? "border-vessel-accent/40" : "border-vessel-border"
                            } transition-colors`}
                            data-testid={`row-track-${track.participantId}`}
                          >
                            <div className="flex items-start gap-3 mb-3">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSelect(track.participantId)}
                                className="mt-1 w-4 h-4 rounded border-vessel-border accent-vessel-accent shrink-0"
                                data-testid={`checkbox-track-${track.participantId}`}
                                aria-label={`Include ${track.participantName} in bundle`}
                              />
                              <AvatarMark
                                pubkey={track.participantPubkey}
                                displayName={track.participantName}
                                className="w-10 h-10 shrink-0"
                                initialsClassName="text-sm"
                              />
                              <div className="min-w-0">
                                <div className="font-medium text-vessel-text-primary truncate">{track.participantName}'s Track</div>
                                <div className="text-xs text-vessel-text-muted font-mono-vessel mt-0.5">
                                  {track.hasVideo ? "Video + Audio" : "Audio only"} &middot;{" "}
                                  {formatDuration(track.durationSeconds)} &middot; {formatSize(track.sizeBytes)}
                                  {track.audioBlobUrl || track.audioBlob ? (
                                    <span className="text-vessel-text-secondary"> &middot; Audio sibling ready</span>
                                  ) : track.hasVideo ? (
                                    <span className="text-vessel-text-muted"> &middot; No audio sibling</span>
                                  ) : null}
                                </div>
                                <StorageStateChip state={track.storageState} />
                              </div>
                            </div>
                            <TrackStreamButtons
                              track={track}
                              onDownload={handleSingleDownload}
                              isWorking={busy}
                            />
                            <TrackMetaRow track={track} onCopy={handleCopyFileLink} />
                          </div>
                        );
                      })}
                      {/* Per-pubkey waiting placeholders. */}
                      {expectedParticipants.length > 0 && (
                        <div className="space-y-3" data-testid="list-waiting-tracks">
                          {expectedParticipants.map((p) => (
                            <WaitingForRow
                              key={p.pubkey}
                              pubkey={p.pubkey}
                              displayName={p.displayName}
                              state={p.state}
                              resolveError={p.resolveError}
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    <div
                      className="w-full mb-6 p-4 rounded-xl bg-vessel-bg-base border border-vessel-border text-left"
                      data-testid="bundle-footer"
                    >
                      <div className="flex items-start gap-2 mb-3">
                        <Package className="w-4 h-4 text-vessel-accent shrink-0 mt-0.5" />
                        <div className="text-xs text-vessel-text-secondary">
                          {selectedCount > 0 ? (
                            <>
                              <div>
                                <span className="font-medium text-vessel-text-primary">{selectedCount} track{selectedCount === 1 ? "" : "s"}</span>{" "}
                                selected — pick a stream to bundle as a zip.
                              </div>
                              <div
                                className="mt-1 text-[11px] text-vessel-text-muted"
                                data-testid="bundle-footer-totals"
                              >
                                <span data-testid="bundle-total-va">V+A: {formatSize(selectedTotals.videoAudio)}</span>
                                <span className="mx-2 opacity-50">·</span>
                                <span data-testid="bundle-total-v">Video only: {selectedTotals.videoOnly > 0 ? formatSize(selectedTotals.videoOnly) : "—"}</span>
                                <span className="mx-2 opacity-50">·</span>
                                <span data-testid="bundle-total-a">Audio only: {selectedTotals.audioOnly > 0 ? formatSize(selectedTotals.audioOnly) : "—"}</span>
                                <span className="mx-2 opacity-50">·</span>
                                <span data-testid="bundle-total-s">Screen: {selectedTotals.screenOnly > 0 ? formatSize(selectedTotals.screenOnly) : "—"}</span>
                              </div>
                            </>
                          ) : (
                            <>Select participants above to enable bundle download.</>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="sr-only" htmlFor="bundle-stream-select">
                          Bundle stream
                        </label>
                        <select
                          id="bundle-stream-select"
                          value={bundleStream}
                          onChange={(e) => setBundleStream(e.target.value as TrackStreamKind)}
                          disabled={busy || selectedCount === 0}
                          className="h-9 rounded-md border border-vessel-border bg-vessel-bg-base px-2 text-sm text-vessel-text-primary disabled:opacity-50"
                          data-testid="select-bundle-stream"
                        >
                          <option value="video+audio">Video + Audio</option>
                          <option value="video-only">Video only</option>
                          <option value="audio-only">Audio only</option>
                          <option value="screen-only">Screen</option>
                        </select>
                        <VesselButton
                          variant="primary"
                          size="sm"
                          disabled={busy || selectedCount === 0}
                          onClick={() => handleBundleDownload(bundleStream)}
                          data-testid="button-bundle-download"
                        >
                          {busy ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : bundleStream === "video-only" ? (
                            <Video className="w-4 h-4 mr-2" />
                          ) : bundleStream === "audio-only" ? (
                            <Music className="w-4 h-4 mr-2" />
                          ) : (
                            <Film className="w-4 h-4 mr-2" />
                          )}
                          Download selected (.zip)
                        </VesselButton>
                      </div>
                    </div>

                    {hasTranscript && (
                      <TranscriptDownloadCard
                        fragmentCount={transcriptFragments?.length ?? 0}
                        onDownload={handleTranscriptDownload}
                      />
                    )}

                    <PersonalReceiptCard
                      personalArchive={personalArchive}
                      isHost
                      hostName={hostName}
                      onCopy={handleCopyReceipt}
                      receiptArchiveId={receiptArchiveId}
                    />

                    <div className="flex flex-col sm:flex-row gap-3 w-full justify-center mt-2">
                      <VesselButton variant="primary" className="w-full sm:w-auto" onClick={onViewVault} data-testid="button-view-vault">
                        View in My Vault &rarr;
                      </VesselButton>
                      <VesselButton variant="ghost" className="w-full sm:w-auto" onClick={onStartNew} data-testid="button-start-new">
                        Start New Session
                      </VesselButton>
                    </div>
                  </>
                ) : (
                  <>
                    <h2 className="font-display text-2xl font-bold mb-2 text-vessel-text-primary">Thanks for recording with {hostName}!</h2>
                    <p className="text-sm text-vessel-text-secondary mb-6">
                      Your track is saved on your storage and a copy went to {hostName} for the edit.
                    </p>

                    <PersonalReceiptCard
                      personalArchive={personalArchive}
                      isHost={false}
                      hostName={hostName}
                      onCopy={handleCopyReceipt}
                      receiptArchiveId={receiptArchiveId}
                    />

                    {/* Guests get a per-stream download for their own
                        track — same V+A / V / A choices as the host so
                        they can grab just the audio if that's all they
                        need. Falls back to the legacy single-button if
                        we somehow have no track at all. */}
                    {tracks[0] ? (
                      <div className="w-full p-4 rounded-xl bg-vessel-bg-base border border-vessel-border text-left mb-3">
                        <div className="text-xs text-vessel-text-secondary mb-2">Download from this device:</div>
                        <TrackStreamButtons
                          track={tracks[0]}
                          onDownload={handleSingleDownload}
                          isWorking={busy}
                        />
                        <TrackMetaRow track={tracks[0]} onCopy={handleCopyFileLink} />
                      </div>
                    ) : null}

                    {hasTranscript && (
                      <TranscriptDownloadCard
                        fragmentCount={transcriptFragments?.length ?? 0}
                        onDownload={handleTranscriptDownload}
                      />
                    )}

                    <div className="flex flex-col gap-3 w-full mt-2">
                      <VesselButton variant="primary" onClick={onClose} data-testid="button-guest-close">
                        Close
                      </VesselButton>
                    </div>
                  </>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
