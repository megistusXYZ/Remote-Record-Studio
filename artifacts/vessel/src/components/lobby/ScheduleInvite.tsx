import { useMemo, useState } from "react";
import { CalendarPlus, Download, Copy, Check } from "lucide-react";
import { VesselButton } from "../vessel-ui/VesselButton";
import { buildSessionInvite, guestChecklist } from "../../lib/session-invite";
import { downloadBlobAsFile } from "../../lib/track-export";

/** Next whole hour, as the value a datetime-local input expects. */
function nextHourLocal(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Pick a time, get a calendar invite with the link and a guest checklist.
 * Nothing is sent: the host downloads the .ics or copies the text.
 */
export function ScheduleInvite(props: {
  sessionId: string;
  title: string;
  hostName: string;
  joinUrl: string;
}) {
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState(nextHourLocal);
  const [minutes, setMinutes] = useState(60);
  const [copied, setCopied] = useState(false);
  const start = useMemo(() => new Date(when), [when]);
  const valid = !Number.isNaN(start.getTime());

  const download = () => {
    if (!valid) return;
    const ics = buildSessionInvite({
      uid: `${props.sessionId}@vessel`,
      title: props.title || "Recording session",
      hostName: props.hostName || "your host",
      start,
      durationMinutes: minutes,
      joinUrl: props.joinUrl,
    });
    downloadBlobAsFile(
      new Blob([ics], { type: "text/calendar" }),
      "vessel-session.ics",
    );
  };

  const copyText = async () => {
    const when = valid
      ? start.toLocaleString(undefined, {
          dateStyle: "full",
          timeStyle: "short",
        })
      : "";
    const text = `${props.title || "Recording session"}${when ? `, ${when}` : ""}\n\n${guestChecklist(props.hostName || "your host", props.joinUrl)}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked; the download still works.
    }
  };

  if (!open) {
    return (
      <VesselButton
        variant="ghost"
        size="md"
        onClick={() => setOpen(true)}
        className="w-full"
        data-testid="button-schedule"
      >
        <CalendarPlus className="w-4 h-4 mr-2" />
        Schedule and send a calendar invite
      </VesselButton>
    );
  }

  return (
    <div
      className="rounded-xl border border-vessel-border bg-vessel-bg-base p-3 space-y-3"
      data-testid="schedule-invite"
    >
      <div className="flex flex-col sm:flex-row gap-2">
        <label className="flex-1 text-xs text-vessel-text-muted">
          When
          <input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="mt-1 w-full h-10 rounded-lg border border-vessel-border bg-vessel-bg-surface px-3 text-sm text-vessel-text-primary"
            data-testid="input-schedule-when"
          />
        </label>
        <label className="sm:w-36 text-xs text-vessel-text-muted">
          Length
          <select
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="mt-1 w-full h-10 rounded-lg border border-vessel-border bg-vessel-bg-surface px-2 text-sm text-vessel-text-primary"
          >
            {[30, 45, 60, 90, 120].map((m) => (
              <option key={m} value={m}>
                {m < 60
                  ? `${m} min`
                  : `${m / 60} h${m % 60 ? ` ${m % 60} min` : ""}`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex gap-2">
        <VesselButton
          variant="primary"
          size="md"
          onClick={download}
          disabled={!valid}
          className="flex-1"
          data-testid="button-download-ics"
        >
          <Download className="w-4 h-4 mr-2" />
          Calendar invite
        </VesselButton>
        <VesselButton
          variant="ghost"
          size="md"
          onClick={copyText}
          className="flex-1"
          data-testid="button-copy-invite-text"
        >
          {copied ? (
            <Check className="w-4 h-4 mr-2 text-vessel-green" />
          ) : (
            <Copy className="w-4 h-4 mr-2" />
          )}
          {copied ? "Copied" : "Copy message"}
        </VesselButton>
      </div>
      <p className="text-xs text-vessel-text-muted">
        The invite includes the link and a short checklist for your guest.
      </p>
    </div>
  );
}
