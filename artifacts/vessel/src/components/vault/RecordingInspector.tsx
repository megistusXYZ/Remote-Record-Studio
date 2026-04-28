import { useState, useMemo, useCallback } from "react";
import { format } from "date-fns";
import {
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  HardDrive,
  AlertCircle,
  Loader2,
  Mic,
  MonitorPlay,
} from "lucide-react";
import { nip19 } from "nostr-tools";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useToast } from "../../hooks/use-toast";
import { isLocalBlobUrl } from "../../lib/recordings-storage";
import type { Recording } from "@workspace/api-client-react";

/**
 * Structured "view as data" panel for a vault session and its track records.
 *
 * Design intent (per UX spec):
 *  - Default users never see this — it lives behind a tiny </> affordance on
 *    each session card. Power users open it to verify the sovereignty story.
 *  - Each piece of data is rendered as a **labeled row** with a copy button,
 *    not a JSON wall. Keys explain themselves.
 *  - The raw JSON dump lives at the bottom, collapsed by default, syntax
 *    highlighted with a tiny in-house renderer (no new deps, theme-perfect).
 *  - Honest labelling: vault recordings are database rows on the api-server,
 *    not signed Nostr events. We call it "Vault record", not "Signed event".
 *  - Zero new network calls. Renders entirely from data already in memory.
 *  - The Sheet only mounts its content when open, so closed = zero cost.
 */

export type InspectorSession = {
  id: string;
  title: string;
  createdAt: Date;
  recordings: Recording[];
};

export type RecordingInspectorProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  session: InspectorSession | null;
};

export function RecordingInspector({
  open,
  onOpenChange,
  session,
}: RecordingInspectorProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl bg-vessel-bg-base border-vessel-border p-0 flex flex-col"
        data-testid="sheet-recording-inspector"
      >
        {session ? <InspectorBody session={session} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function InspectorBody({ session }: { session: InspectorSession }) {
  const isSolo =
    session.id.startsWith("quick-record:") || session.id.startsWith("__solo_");

  return (
    <>
      <SheetHeader className="px-6 pt-6 pb-4 border-b border-vessel-border">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-vessel-bg-elevated border border-vessel-border flex items-center justify-center">
            <span className="font-mono-vessel text-xs text-vessel-accent">{`</>`}</span>
          </div>
          <SheetTitle className="text-vessel-text-primary text-base font-display">
            View as data
          </SheetTitle>
        </div>
        <SheetDescription className="text-vessel-text-muted text-xs">
          The exact information your vault keeps about this {isSolo ? "recording" : "session"}.
          Copy anything · share with your tools · audit what's stored.
        </SheetDescription>
        <div className="flex items-center gap-2 pt-2 text-xs">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-mono-vessel text-vessel-text-secondary bg-vessel-bg-elevated border border-vessel-border">
            {isSolo ? <MonitorPlay className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
            {isSolo ? "Solo" : "Studio"}
          </span>
          <span className="text-vessel-text-muted font-mono-vessel">
            {session.recordings.length} track{session.recordings.length === 1 ? "" : "s"}
          </span>
          <span className="text-vessel-text-muted">·</span>
          <span className="text-vessel-text-muted font-mono-vessel">
            {format(session.createdAt, "yyyy-MM-dd HH:mm")}
          </span>
        </div>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
        <SessionIdentitySection session={session} />
        <TracksSection recordings={session.recordings} />
        <RawRecordSection recordings={session.recordings} />
      </div>
    </>
  );
}

/* ========================================================================== *
 *                              SECTION: Identity                              *
 * ========================================================================== */

function SessionIdentitySection({ session }: { session: InspectorSession }) {
  const owner = session.recordings[0]?.ownerPubkey ?? "";
  const npub = useMemo(() => safeNpub(owner), [owner]);
  const isSyntheticSessionId =
    session.id.startsWith("quick-record:") || session.id.startsWith("__solo_");

  return (
    <Section title="Identity" testId="inspector-section-identity">
      <KeyValueRow
        label="Title"
        value={session.title}
        testIdSuffix="title"
      />
      {isSyntheticSessionId ? (
        <KeyValueRow
          label="Session ID"
          value={null}
          hint="Solo recording — no shared session ID."
          testIdSuffix="session-id"
        />
      ) : (
        <KeyValueRow
          label="Session ID"
          value={session.id}
          mono
          testIdSuffix="session-id"
        />
      )}
      <KeyValueRow
        label="Owner"
        value={owner}
        secondary={npub}
        secondaryLabel="As npub"
        mono
        testIdSuffix="owner"
      />
      <KeyValueRow
        label="Created"
        value={format(session.createdAt, "yyyy-MM-dd HH:mm:ss")}
        secondary={session.createdAt.toISOString()}
        secondaryLabel="ISO"
        mono
        testIdSuffix="created"
      />
    </Section>
  );
}

/* ========================================================================== *
 *                                SECTION: Tracks                              *
 * ========================================================================== */

function TracksSection({ recordings }: { recordings: Recording[] }) {
  return (
    <Section
      title={recordings.length === 1 ? "Track" : "Tracks"}
      testId="inspector-section-tracks"
    >
      <div className="space-y-3">
        {recordings.map((r, idx) => (
          <TrackCard
            key={r.id}
            recording={r}
            index={idx}
            defaultOpen={recordings.length <= 2}
          />
        ))}
      </div>
    </Section>
  );
}

function TrackCard({
  recording,
  index,
  defaultOpen,
}: {
  recording: Recording;
  index: number;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const variants = describeVariants(recording);

  return (
    <div
      className="rounded-lg border border-vessel-border bg-vessel-bg-surface overflow-hidden"
      data-testid={`inspector-track-${index}`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-vessel-bg-elevated/40 transition-colors text-left"
        data-testid={`inspector-track-toggle-${index}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {open ? (
            <ChevronDown className="w-3.5 h-3.5 text-vessel-text-muted shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-vessel-text-muted shrink-0" />
          )}
          <span className="text-sm font-medium text-vessel-text-primary truncate">
            {recording.participantName || "Participant"}
          </span>
          <span className="text-xs text-vessel-text-muted font-mono-vessel">
            ·{" "}
            {variants.length === 0
              ? "metadata only"
              : `${variants.length} variant${variants.length === 1 ? "" : "s"}`}
          </span>
        </div>
        <SyncBadge recording={recording} />
      </button>
      {open ? (
        <div className="px-4 pb-4 pt-1 border-t border-vessel-border space-y-4">
          <KeyValueRow
            label="Recording ID"
            value={recording.id}
            mono
            testIdSuffix={`track-${index}-id`}
          />
          <KeyValueRow
            label="Format"
            value={recording.mimeType || "—"}
            mono
            testIdSuffix={`track-${index}-format`}
          />
          <div className="grid grid-cols-2 gap-3">
            <KeyValueRow
              label="Duration"
              value={`${recording.durationSeconds || 0}s`}
              mono
              compact
              testIdSuffix={`track-${index}-duration`}
            />
            <KeyValueRow
              label="Size"
              value={formatBytes(recording.sizeBytes || 0)}
              mono
              compact
              testIdSuffix={`track-${index}-size`}
            />
          </div>
          {variants.length > 0 ? (
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-vessel-text-muted font-mono-vessel">
                Where it lives
              </div>
              <div className="space-y-2">
                {variants.map((v) => (
                  <VariantRow
                    key={v.kind}
                    variant={v}
                    testIdPrefix={`inspector-variant-${index}-${v.kind}`}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="text-xs text-vessel-text-muted italic px-3 py-2 rounded-md bg-vessel-bg-base border border-vessel-border">
              No file storage references on this track yet.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

type Variant = {
  kind: "combined" | "audio" | "video" | "screen";
  label: string;
  url: string | null;
  hash: string | null;
  size: number | null;
  mime: string | null;
};

function describeVariants(r: Recording): Variant[] {
  const list: Variant[] = [];
  if (r.blobUrl || r.blobHash) {
    list.push({
      kind: "combined",
      label: "Combined (video + audio)",
      url: r.blobUrl ?? null,
      hash: r.blobHash ?? null,
      size: r.sizeBytes ?? null,
      mime: r.mimeType ?? null,
    });
  }
  if (r.audioBlobUrl || r.audioBlobHash) {
    list.push({
      kind: "audio",
      label: "Audio only",
      url: r.audioBlobUrl ?? null,
      hash: r.audioBlobHash ?? null,
      size: r.audioSizeBytes ?? null,
      mime: r.audioMimeType ?? null,
    });
  }
  if (r.videoBlobUrl || r.videoBlobHash) {
    list.push({
      kind: "video",
      label: "Video only",
      url: r.videoBlobUrl ?? null,
      hash: r.videoBlobHash ?? null,
      size: r.videoSizeBytes ?? null,
      mime: r.videoMimeType ?? null,
    });
  }
  if (r.screenBlobUrl || r.screenBlobHash) {
    list.push({
      kind: "screen",
      label: "Screen share",
      url: r.screenBlobUrl ?? null,
      hash: r.screenBlobHash ?? null,
      size: r.screenSizeBytes ?? null,
      mime: r.screenMimeType ?? null,
    });
  }
  return list;
}

function VariantRow({
  variant,
  testIdPrefix,
}: {
  variant: Variant;
  testIdPrefix: string;
}) {
  const local = variant.url ? isLocalBlobUrl(variant.url) : false;
  return (
    <div
      className="rounded-md bg-vessel-bg-base border border-vessel-border px-3 py-2 space-y-1.5"
      data-testid={testIdPrefix}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-vessel-text-primary">
          {variant.label}
        </span>
        <div className="flex items-center gap-1.5 text-[10px] font-mono-vessel">
          {local ? (
            <span className="inline-flex items-center gap-1 text-vessel-text-muted">
              <HardDrive className="w-3 h-3" />
              On this device
            </span>
          ) : variant.url ? (
            <span className="inline-flex items-center gap-1 text-vessel-accent">
              <Cloud className="w-3 h-3" />
              On your storage
            </span>
          ) : (
            <span className="text-vessel-text-muted">—</span>
          )}
        </div>
      </div>
      {variant.url ? (
        <ValueWithCopy
          value={variant.url}
          tinyLabel={local ? "Device URL" : "URL"}
          mono
          testIdSuffix={`${testIdPrefix}-url`}
          breakAll
        />
      ) : null}
      {variant.hash ? (
        <ValueWithCopy
          value={variant.hash}
          tinyLabel="Content hash"
          mono
          testIdSuffix={`${testIdPrefix}-hash`}
          breakAll
        />
      ) : null}
      {(variant.mime || variant.size) ? (
        <div className="flex items-center gap-3 text-[10px] font-mono-vessel text-vessel-text-muted pt-0.5">
          {variant.mime ? <span>{variant.mime}</span> : null}
          {variant.size ? <span>{formatBytes(variant.size)}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function SyncBadge({ recording }: { recording: Recording }) {
  if (recording.status === "processing") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono-vessel text-vessel-text-muted shrink-0">
        <Loader2 className="w-3 h-3 animate-spin" />
        Processing
      </span>
    );
  }
  if (recording.status === "error") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono-vessel text-vessel-red shrink-0">
        <AlertCircle className="w-3 h-3" />
        Error
      </span>
    );
  }
  if (recording.blobUrl && !isLocalBlobUrl(recording.blobUrl)) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono-vessel text-vessel-accent shrink-0">
        <Cloud className="w-3 h-3" />
        Synced
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono-vessel text-vessel-text-muted shrink-0">
      <HardDrive className="w-3 h-3" />
      Local
    </span>
  );
}

/* ========================================================================== *
 *                              SECTION: Raw record                            *
 * ========================================================================== */

function RawRecordSection({ recordings }: { recordings: Recording[] }) {
  const [open, setOpen] = useState(false);
  const json = useMemo(
    () => (recordings.length === 1 ? recordings[0] : recordings),
    [recordings],
  );

  return (
    <Section title="Full record" testId="inspector-section-raw">
      <p className="text-xs text-vessel-text-muted -mt-1">
        Every field your vault stores about this {recordings.length === 1 ? "recording" : "session"},
        exactly as kept. The structured view above is built from these values.
      </p>
      <div className="rounded-lg border border-vessel-border bg-vessel-bg-surface overflow-hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-vessel-bg-elevated/40 transition-colors"
          data-testid="inspector-raw-toggle"
        >
          <span className="inline-flex items-center gap-2 text-xs font-medium text-vessel-text-primary">
            {open ? (
              <ChevronDown className="w-3.5 h-3.5 text-vessel-text-muted" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-vessel-text-muted" />
            )}
            {open ? "Hide" : "Show"} raw JSON
          </span>
          <CopyButton
            value={JSON.stringify(json, null, 2)}
            label="Copy JSON"
            testIdSuffix="raw-json"
            stopPropagation
          />
        </button>
        {open ? (
          <div
            className="border-t border-vessel-border bg-vessel-bg-base px-4 py-3 overflow-x-auto"
            data-testid="inspector-raw-json"
          >
            <JsonView value={json} />
          </div>
        ) : null}
      </div>
    </Section>
  );
}

/* ========================================================================== *
 *                              Reusable primitives                            *
 * ========================================================================== */

function Section({
  title,
  testId,
  children,
}: {
  title: string;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3" data-testid={testId}>
      <h3 className="text-[10px] uppercase tracking-[0.14em] font-mono-vessel text-vessel-text-muted">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function KeyValueRow({
  label,
  value,
  secondary,
  secondaryLabel,
  hint,
  mono,
  compact,
  testIdSuffix,
}: {
  label: string;
  value: string | null;
  secondary?: string | null;
  secondaryLabel?: string;
  hint?: string;
  mono?: boolean;
  compact?: boolean;
  testIdSuffix: string;
}) {
  return (
    <div
      className={compact ? "space-y-1" : "space-y-1.5"}
      data-testid={`inspector-kv-${testIdSuffix}`}
    >
      <div className="text-[10px] uppercase tracking-wider text-vessel-text-muted font-mono-vessel">
        {label}
      </div>
      {value !== null ? (
        <ValueWithCopy
          value={value}
          mono={mono}
          testIdSuffix={`${testIdSuffix}-value`}
          breakAll={mono}
        />
      ) : (
        <div className="text-xs text-vessel-text-muted italic">{hint ?? "—"}</div>
      )}
      {secondary ? (
        <div className="space-y-1 pt-0.5">
          {secondaryLabel ? (
            <div className="text-[10px] uppercase tracking-wider text-vessel-text-muted/70 font-mono-vessel">
              {secondaryLabel}
            </div>
          ) : null}
          <ValueWithCopy
            value={secondary}
            mono
            testIdSuffix={`${testIdSuffix}-secondary`}
            breakAll
          />
        </div>
      ) : null}
    </div>
  );
}

function ValueWithCopy({
  value,
  tinyLabel,
  mono,
  breakAll,
  testIdSuffix,
}: {
  value: string;
  tinyLabel?: string;
  mono?: boolean;
  breakAll?: boolean;
  testIdSuffix: string;
}) {
  return (
    <div className="flex items-start gap-2 group">
      <div className="flex-1 min-w-0">
        {tinyLabel ? (
          <div className="text-[10px] uppercase tracking-wider text-vessel-text-muted/70 font-mono-vessel mb-0.5">
            {tinyLabel}
          </div>
        ) : null}
        <div
          className={`text-xs text-vessel-text-primary ${mono ? "font-mono-vessel" : ""} ${breakAll ? "break-all" : ""} leading-relaxed`}
        >
          {value}
        </div>
      </div>
      <CopyButton value={value} testIdSuffix={testIdSuffix} />
    </div>
  );
}

function CopyButton({
  value,
  label,
  testIdSuffix,
  stopPropagation,
}: {
  value: string;
  label?: string;
  testIdSuffix: string;
  stopPropagation?: boolean;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const onClick = useCallback(
    async (e: React.MouseEvent) => {
      if (stopPropagation) {
        e.stopPropagation();
        e.preventDefault();
      }
      try {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      } catch {
        toast({
          variant: "destructive",
          description: "Couldn't copy to clipboard.",
        });
      }
    },
    [value, stopPropagation, toast],
  );

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label ? `${label}` : "Copy value"}
      title={label ?? "Copy"}
      data-testid={`inspector-copy-${testIdSuffix}`}
      className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono-vessel text-vessel-text-muted hover:text-vessel-text-primary hover:bg-vessel-bg-elevated transition-colors opacity-60 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-vessel-accent"
    >
      {copied ? (
        <>
          <Check className="w-3 h-3 text-vessel-accent" />
          {label ? <span className="text-vessel-accent">Copied</span> : null}
        </>
      ) : (
        <>
          <Copy className="w-3 h-3" />
          {label ? <span>{label}</span> : null}
        </>
      )}
    </button>
  );
}

/* ========================================================================== *
 *                            JSON pretty-print view                           *
 *                                                                             *
 *  Tiny in-house renderer — keeps theme exact, avoids bundling a JSON         *
 *  library, and lazy-rendered (only when the user expands the section).       *
 * ========================================================================== */

function JsonView({ value }: { value: unknown }) {
  return (
    <pre className="text-[11px] leading-relaxed font-mono-vessel text-vessel-text-secondary whitespace-pre m-0">
      <JsonNode node={value} indent={0} />
    </pre>
  );
}

function JsonNode({
  node,
  indent,
  trailingComma = false,
}: {
  node: unknown;
  indent: number;
  trailingComma?: boolean;
}) {
  if (node === null) {
    return (
      <>
        <span className="text-vessel-text-muted">null</span>
        {trailingComma ? "," : ""}
      </>
    );
  }
  if (typeof node === "boolean") {
    return (
      <>
        <span className="text-vessel-accent">{String(node)}</span>
        {trailingComma ? "," : ""}
      </>
    );
  }
  if (typeof node === "number") {
    return (
      <>
        <span className="text-[#ffaa7b]">{String(node)}</span>
        {trailingComma ? "," : ""}
      </>
    );
  }
  if (typeof node === "string") {
    return (
      <>
        <span className="text-vessel-accent">{JSON.stringify(node)}</span>
        {trailingComma ? "," : ""}
      </>
    );
  }
  if (Array.isArray(node)) {
    if (node.length === 0) {
      return (
        <>
          <span className="text-vessel-text-muted">[]</span>
          {trailingComma ? "," : ""}
        </>
      );
    }
    return (
      <>
        <span className="text-vessel-text-muted">[</span>
        {"\n"}
        {node.map((item, i) => (
          <span key={i}>
            {pad(indent + 2)}
            <JsonNode
              node={item}
              indent={indent + 2}
              trailingComma={i < node.length - 1}
            />
            {"\n"}
          </span>
        ))}
        {pad(indent)}
        <span className="text-vessel-text-muted">]</span>
        {trailingComma ? "," : ""}
      </>
    );
  }
  if (typeof node === "object") {
    const entries = Object.entries(node as Record<string, unknown>);
    if (entries.length === 0) {
      return (
        <>
          <span className="text-vessel-text-muted">{"{}"}</span>
          {trailingComma ? "," : ""}
        </>
      );
    }
    return (
      <>
        <span className="text-vessel-text-muted">{"{"}</span>
        {"\n"}
        {entries.map(([k, v], i) => (
          <span key={k}>
            {pad(indent + 2)}
            <span className="text-vessel-text-primary">{JSON.stringify(k)}</span>
            <span className="text-vessel-text-muted">: </span>
            <JsonNode
              node={v}
              indent={indent + 2}
              trailingComma={i < entries.length - 1}
            />
            {"\n"}
          </span>
        ))}
        {pad(indent)}
        <span className="text-vessel-text-muted">{"}"}</span>
        {trailingComma ? "," : ""}
      </>
    );
  }
  return <span className="text-vessel-text-muted">{String(node)}</span>;
}

function pad(n: number): string {
  return " ".repeat(n);
}

/* ========================================================================== *
 *                                  Helpers                                    *
 * ========================================================================== */

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function safeNpub(hex: string): string | null {
  if (!hex) return null;
  try {
    return nip19.npubEncode(hex);
  } catch {
    return null;
  }
}
