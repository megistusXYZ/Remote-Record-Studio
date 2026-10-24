import { useRef, useState } from "react";
import { FileText, Loader2, X } from "lucide-react";
import { VesselButton } from "../vessel-ui/VesselButton";
import { alignTracks } from "../../lib/editor-export";
import {
  downloadBlobAsFile,
  hasAudioOnlyExport,
  resolveStreamBlob,
  type TrackExportSource,
} from "../../lib/track-export";
import {
  toSrt,
  toText,
  toVtt,
  transcribeSession,
  type TranscriptLine,
} from "../../lib/transcript";
import { friendlyError } from "../../lib/friendly-error";

type State =
  | { kind: "idle" }
  | { kind: "loading"; percent: number }
  | { kind: "working"; fraction: number; speaker: string }
  | { kind: "done"; lines: TranscriptLine[]; failed: string[] }
  | { kind: "error"; message: string };

/**
 * A transcript made on this computer after the session: each speaker's
 * master is transcribed on its own, so every line carries the right name.
 * Nothing is uploaded. The result downloads as SRT, VTT or text and joins
 * the editor download.
 */
export function TranscriptCard(props: {
  sources: TrackExportSource[];
  title: string;
  fileStem: string;
  onReady: (lines: TranscriptLine[]) => void;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const cancelRef = useRef<{ abort: () => void } | null>(null);

  const start = async () => {
    const usable = props.sources.filter(hasAudioOnlyExport);
    if (usable.length === 0) {
      setState({
        kind: "error",
        message:
          "No studio-quality audio is available for these tracks on this device.",
      });
      return;
    }
    const controller = new AbortController();
    let engine: { dispose: () => void } | null = null;
    cancelRef.current = {
      abort: () => {
        controller.abort();
        engine?.dispose();
      },
    };
    try {
      setState({ kind: "loading", percent: 0 });
      const { createWhisperEngine } = await import("../../lib/whisper-engine");
      const whisper = await createWhisperEngine({
        onLoadProgress: (percent) => setState({ kind: "loading", percent }),
      });
      engine = whisper;
      const offsets = alignTracks(
        usable.map((s, i) => ({
          id: String(i),
          startedAtMs: s.startedAtMs,
          serverOffsetMs: s.serverOffsetMs,
        })),
      );
      const tracks = [];
      for (const [i, source] of usable.entries()) {
        const audio = await resolveStreamBlob({ source, stream: "audio-only" });
        if (audio)
          tracks.push({
            speaker: source.participantName,
            offsetMs: offsets[i]?.offsetMs ?? 0,
            audio,
          });
      }
      setState({
        kind: "working",
        fraction: 0,
        speaker: tracks[0]?.speaker ?? "",
      });
      const result = await transcribeSession({
        tracks,
        engine: whisper,
        signal: controller.signal,
        onProgress: (p) =>
          setState({
            kind: "working",
            fraction: p.fraction,
            speaker: p.speaker,
          }),
      });
      setState({ kind: "done", lines: result.lines, failed: result.failed });
      props.onReady(result.lines);
    } catch (err) {
      if ((err as { name?: string } | null)?.name === "AbortError") {
        setState({ kind: "idle" });
      } else {
        console.error("Transcript failed", err);
        setState({
          kind: "error",
          message: friendlyError(
            err,
            "The transcript couldn't be made on this device. Try again, or use a laptop with Chrome or Edge.",
          ),
        });
      }
    } finally {
      engine?.dispose();
      cancelRef.current = null;
    }
  };

  const save = (kind: "srt" | "vtt" | "txt") => {
    if (state.kind !== "done") return;
    const text =
      kind === "srt"
        ? toSrt(state.lines)
        : kind === "vtt"
          ? toVtt(state.lines)
          : toText(state.lines, props.title);
    const type =
      kind === "srt"
        ? "application/x-subrip"
        : kind === "vtt"
          ? "text/vtt"
          : "text/plain";
    downloadBlobAsFile(
      new Blob([text], { type: `${type};charset=utf-8` }),
      `${props.fileStem}-transcript.${kind}`,
    );
  };

  const busy = state.kind === "loading" || state.kind === "working";
  const percent =
    state.kind === "loading"
      ? Math.round(state.percent)
      : state.kind === "working"
        ? Math.round(state.fraction * 100)
        : 0;

  return (
    <div
      className="w-full p-4 rounded-xl bg-vessel-bg-base border border-vessel-border text-left mb-3"
      data-testid="card-transcript"
    >
      <div className="flex items-start gap-3">
        <FileText
          className="w-4 h-4 mt-0.5 text-vessel-accent shrink-0"
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-vessel-text-primary">
            Transcript
          </p>
          <p className="text-xs text-vessel-text-secondary">
            {state.kind === "idle" &&
              "Made on this computer, with every line labelled by speaker. Nothing is uploaded."}
            {state.kind === "loading" &&
              `Getting the speech engine ready… ${percent}% (once, then it's cached)`}
            {state.kind === "working" &&
              `Listening to ${state.speaker}… ${percent}%`}
            {state.kind === "done" &&
              (state.lines.length === 0
                ? "No speech was found."
                : `${state.lines.length} lines. It's also included in the editor download.${state.failed.length ? ` Couldn't transcribe: ${state.failed.join(", ")}.` : ""}`)}
            {state.kind === "error" && state.message}
          </p>
          {busy && (
            <div
              className="mt-2 h-1.5 rounded-full bg-vessel-bg-elevated overflow-hidden"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full bg-vessel-accent transition-[width] duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {(state.kind === "idle" || state.kind === "error") && (
          <VesselButton
            variant="primary"
            size="sm"
            onClick={start}
            data-testid="button-make-transcript"
          >
            Make a transcript
          </VesselButton>
        )}
        {busy && (
          <VesselButton
            variant="ghost"
            size="sm"
            onClick={() => cancelRef.current?.abort()}
            data-testid="button-cancel-transcript"
          >
            {state.kind === "loading" ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <X className="w-4 h-4 mr-2" />
            )}
            Stop
          </VesselButton>
        )}
        {state.kind === "done" && state.lines.length > 0 && (
          <>
            <VesselButton
              variant="ghost"
              size="sm"
              onClick={() => save("txt")}
              data-testid="button-transcript-txt"
            >
              Text
            </VesselButton>
            <VesselButton
              variant="ghost"
              size="sm"
              onClick={() => save("srt")}
              data-testid="button-transcript-srt"
            >
              SRT
            </VesselButton>
            <VesselButton
              variant="ghost"
              size="sm"
              onClick={() => save("vtt")}
              data-testid="button-transcript-vtt"
            >
              VTT
            </VesselButton>
          </>
        )}
      </div>
    </div>
  );
}
