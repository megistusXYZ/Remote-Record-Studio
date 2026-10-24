import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { LifeBuoy } from "lucide-react";
import { useCreateRecording } from "@workspace/api-client-react";
import { useIdentity } from "../../hooks/use-identity";
import { useToast } from "../../hooks/use-toast";
import { VesselButton } from "../vessel-ui/VesselButton";
import { markRecordingRegistered } from "../../lib/recording-finalize";
import {
  discardRecoverableRecording,
  estimateDurationSeconds,
  listRecoverableRecordings,
  recoverRecording,
} from "../../lib/recording-recovery";
import type { InProgressRecording } from "../../lib/recordings-storage";

type Busy = { recordingId: string; label: string } | null;

function formatWhen(ms: number): string {
  try {
    return new Date(ms).toLocaleString(undefined, {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function formatLength(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

function titleFor(row: InProgressRecording): string {
  if (row.context.sessionTitle) return row.context.sessionTitle;
  if (row.context.kind === "screen") return "Screen recording";
  return "Recording";
}

/**
 * Lists recordings on this device that never finished normally (a reload or
 * crash mid-recording, or leaving before the recording was filed) and lets
 * the person recover them into the Vault or throw them away.
 */
export function RecoveryPanel({ className }: { className?: string }) {
  const { identity, pubkey, displayName } = useIdentity();
  const createRecording = useCreateRecording();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [rows, setRows] = useState<InProgressRecording[]>([]);
  const [busy, setBusy] = useState<Busy>(null);

  const refresh = useCallback(async () => {
    try {
      const all = await listRecoverableRecordings();
      // Only recordings that belong to this studio, or that predate the
      // ownership stamp, are offered here.
      setRows(
        all.filter((r) => !r.context.pubkey || r.context.pubkey === pubkey),
      );
    } catch {
      setRows([]);
    }
  }, [pubkey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!identity || !pubkey || rows.length === 0) return null;

  const handleRecover = async (row: InProgressRecording) => {
    setBusy({ recordingId: row.recordingId, label: "Rebuilding…" });
    try {
      const outcome = await recoverRecording(row, identity, (u) => {
        if (u.syncing) {
          setBusy({
            recordingId: row.recordingId,
            label: `Uploading… ${u.progress.percent}%`,
          });
        }
      });
      if (!outcome) {
        await discardRecoverableRecording(row.recordingId);
        toast({
          title: "Nothing to recover",
          description:
            "No usable part of that recording was left on this device.",
          variant: "destructive",
        });
        return;
      }
      setBusy({ recordingId: row.recordingId, label: "Adding to your Vault…" });
      const r = outcome.result;
      await createRecording.mutateAsync({
        data: {
          sessionId: row.context.sessionId ?? null,
          sessionTitle: row.context.sessionTitle ?? null,
          ownerPubkey: pubkey,
          participantName: row.context.displayName || displayName || "You",
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
          screenBlobHash: null,
          screenBlobUrl: null,
          screenSizeBytes: null,
          screenMimeType: null,
          screenDurationSeconds: null,
          status: "ready",
        },
      });
      await markRecordingRegistered(row.recordingId);
      toast({
        title: "Recording recovered",
        description:
          r.syncStatus === "complete"
            ? "It's in your Vault and uploaded to storage."
            : "It's in your Vault, saved on this device. The upload didn't finish; you can download it any time.",
      });
      setLocation("/vault");
    } catch (err) {
      console.error("Recovery failed", err);
      toast({
        title: "Couldn't finish recovering",
        description:
          "The recording is still safe on this device. Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const handleDiscard = async (row: InProgressRecording) => {
    if (!window.confirm("Throw this recording away? This can't be undone."))
      return;
    setBusy({ recordingId: row.recordingId, label: "Removing…" });
    try {
      await discardRecoverableRecording(row.recordingId);
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  return (
    <section
      aria-label="Recordings to recover"
      className={`rounded-2xl border border-vessel-border bg-vessel-bg-surface p-5 sm:p-6 ${className ?? ""}`}
      data-testid="recovery-panel"
    >
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 shrink-0 rounded-full bg-vessel-accent/10 border border-vessel-accent/20 flex items-center justify-center">
          <LifeBuoy className="w-5 h-5 text-vessel-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-display font-bold text-lg text-vessel-text-primary">
            {rows.length === 1
              ? "A recording didn't finish"
              : `${rows.length} recordings didn't finish`}
          </h2>
          <p className="mt-1 text-sm text-vessel-text-secondary leading-relaxed">
            The page closed or reloaded while recording. Everything captured up
            to that moment is still on this device.
          </p>
          <ul className="mt-4 space-y-3">
            {rows.map((row) => {
              const isBusy = busy?.recordingId === row.recordingId;
              return (
                <li
                  key={row.recordingId}
                  className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-vessel-border/60 bg-vessel-bg-base/40 px-4 py-3"
                  data-testid="recovery-row"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-vessel-text-primary truncate">
                      {titleFor(row)}
                    </div>
                    <div className="text-xs text-vessel-text-muted">
                      {formatWhen(row.startedAtMs)} · about{" "}
                      {formatLength(estimateDurationSeconds(row))}
                      {row.status === "saved"
                        ? " · saved, not yet in your Vault"
                        : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <VesselButton
                      size="sm"
                      onClick={() => void handleRecover(row)}
                      disabled={busy !== null}
                      isLoading={isBusy && busy?.label !== "Removing…"}
                      data-testid="recovery-recover"
                    >
                      {isBusy && busy?.label !== "Removing…"
                        ? busy.label
                        : "Recover"}
                    </VesselButton>
                    <button
                      type="button"
                      onClick={() => void handleDiscard(row)}
                      disabled={busy !== null}
                      className="text-sm font-medium text-vessel-text-muted hover:text-vessel-red focus:outline-none focus-visible:underline disabled:opacity-50"
                      data-testid="recovery-discard"
                    >
                      Discard
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
