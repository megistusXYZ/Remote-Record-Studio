import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { VesselButton } from "../vessel-ui/VesselButton";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_PUBLISH_RELAYS,
  MAX_PUBLISH_RELAYS,
  checkRelayReachability,
  getPublishRelays,
  isValidRelayUrl,
  normalizeRelayUrl,
  publishRelayList,
  setPublishRelays,
  type RelayReachabilityResult,
} from "../../lib/relay-config";
import type { VesselIdentity } from "../../lib/identity";

type Reachability =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "ok"; latencyMs: number }
  | { kind: "error"; reason: string };

export type ToastFn = (msg: {
  title?: string;
  description?: string;
  variant?: "destructive";
}) => void;

export interface EndpointListProps {
  pubkey: string;
  identity: VesselIdentity | null;
  onToast: ToastFn;
}

/**
 * Manage the user's ordered list of publish endpoints. Mirrors the
 * StorageServerList UX exactly: simple single-input view by default, expand
 * to a full list with PRIMARY / BACKUP labels and reorder arrows when the
 * user wants more than one.
 *
 * UI vocabulary deliberately avoids the protocol-level word ("relay") and
 * the project name behind it — see relay-config.ts for the underlying spec.
 *
 * Save commits the entire ordered list to localStorage AND publishes a Kind
 * 10002 metadata event so the choice roams across the user's other devices.
 */
export function EndpointList({ pubkey, identity, onToast }: EndpointListProps) {
  const [savedUrls, setSavedUrls] = useState<string[]>(() =>
    getPublishRelays(pubkey),
  );
  const [draftUrls, setDraftUrls] = useState<string[]>(() =>
    getPublishRelays(pubkey),
  );
  // True once the user has explicitly opted into the multi-endpoint view, or
  // when the saved list already has >1 entry. Never auto-collapse — once
  // expanded, stay expanded for this mount.
  const [expanded, setExpanded] = useState<boolean>(
    () => getPublishRelays(pubkey).length > 1,
  );
  const [isPublishing, setIsPublishing] = useState(false);

  const [reachability, setReachability] = useState<Record<string, Reachability>>(
    {},
  );

  // Track inflight probes so we can cancel them on unmount or when the
  // input changes again before the previous probe resolved.
  const probesRef = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => {
    return () => {
      for (const ctl of probesRef.current.values()) ctl.abort();
      probesRef.current.clear();
    };
  }, []);

  const probeUrl = useCallback((url: string) => {
    const trimmed = url.trim();
    if (!trimmed) {
      setReachability((prev) => ({ ...prev, [url]: { kind: "idle" } }));
      return;
    }
    if (!isValidRelayUrl(trimmed)) {
      setReachability((prev) => ({
        ...prev,
        [url]: { kind: "error", reason: "Enter a valid wss:// URL." },
      }));
      return;
    }
    probesRef.current.get(url)?.abort();
    const ctl = new AbortController();
    probesRef.current.set(url, ctl);
    setReachability((prev) => ({ ...prev, [url]: { kind: "checking" } }));
    void (async () => {
      const result: RelayReachabilityResult = await checkRelayReachability(
        trimmed,
        ctl.signal,
      );
      if (ctl.signal.aborted) return;
      setReachability((prev) => ({
        ...prev,
        [url]:
          result.state === "ok"
            ? { kind: "ok", latencyMs: result.latencyMs }
            : { kind: "error", reason: result.reason },
      }));
    })();
  }, []);

  // Debounced re-probe whenever the draft list changes. Cancel any in-flight
  // probes for URLs no longer present (rows that were edited or removed) so
  // we don't accumulate stale controllers.
  useEffect(() => {
    const t = setTimeout(() => {
      const present = new Set(draftUrls);
      for (const [url, ctl] of probesRef.current.entries()) {
        if (!present.has(url)) {
          ctl.abort();
          probesRef.current.delete(url);
        }
      }
      const seen = new Set<string>();
      for (const url of draftUrls) {
        if (seen.has(url)) continue;
        seen.add(url);
        probeUrl(url);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [draftUrls, probeUrl]);

  const isDirty = useMemo(() => {
    if (draftUrls.length !== savedUrls.length) return true;
    for (let i = 0; i < draftUrls.length; i++) {
      if (normalizeRelayUrl(draftUrls[i]) !== savedUrls[i]) return true;
    }
    return false;
  }, [draftUrls, savedUrls]);

  const validation = useMemo(() => {
    const issues: string[] = [];
    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < draftUrls.length; i++) {
      const raw = draftUrls[i].trim();
      if (!raw) {
        issues.push(`Row ${i + 1} is empty.`);
        continue;
      }
      const n = normalizeRelayUrl(raw);
      if (!isValidRelayUrl(n)) {
        issues.push(`Row ${i + 1} isn't a valid wss:// URL.`);
        continue;
      }
      if (seen.has(n)) {
        issues.push(`Row ${i + 1} duplicates another server.`);
        continue;
      }
      seen.add(n);
      cleaned.push(n);
    }
    if (cleaned.length === 0 && issues.length === 0) {
      issues.push("Add at least one server.");
    }
    if (cleaned.length > MAX_PUBLISH_RELAYS) {
      issues.push(`Keep the list to ${MAX_PUBLISH_RELAYS} or fewer.`);
    }
    return { issues, cleaned };
  }, [draftUrls]);

  const canSave = isDirty && validation.issues.length === 0 && !isPublishing;

  const updateRow = (i: number, value: string) => {
    setDraftUrls((prev) => {
      const next = [...prev];
      next[i] = value;
      return next;
    });
  };

  const moveRow = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= draftUrls.length) return;
    setDraftUrls((prev) => {
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const removeRow = (i: number) => {
    setDraftUrls((prev) => {
      if (prev.length <= 1) return [""];
      return prev.filter((_, idx) => idx !== i);
    });
  };

  const addRow = () => {
    if (draftUrls.length >= MAX_PUBLISH_RELAYS) return;
    setExpanded(true);
    setDraftUrls((prev) => [...prev, ""]);
  };

  const restoreDefault = () => {
    setDraftUrls([...DEFAULT_PUBLISH_RELAYS]);
    setExpanded(true);
  };

  const handleSave = async () => {
    const cleaned = validation.cleaned;
    if (cleaned.length === 0 || validation.issues.length > 0) {
      onToast({
        title: "Can't save",
        description: validation.issues[0] ?? "Add a valid server first.",
        variant: "destructive",
      });
      return;
    }
    setPublishRelays(cleaned, pubkey);
    setSavedUrls(cleaned);
    setDraftUrls(cleaned);
    onToast({
      title: "Saved",
      description:
        cleaned.length === 1
          ? "Sync servers updated."
          : `Sync servers updated: 1 primary and ${cleaned.length - 1} backup${cleaned.length - 1 === 1 ? "" : "s"}.`,
    });
    if (identity) {
      setIsPublishing(true);
      try {
        const { published } = await publishRelayList(identity, cleaned);
        if (published) {
          onToast({
            description: "Synced your sync servers to your other devices.",
          });
        } else {
          onToast({
            title: "Saved on this device",
            description:
              "Couldn't sync the list to your other devices right now.",
          });
        }
      } catch (err) {
        console.warn("Endpoint list publish failed:", err);
        onToast({
          title: "Saved on this device",
          description:
            "Couldn't sync the list to your other devices right now.",
        });
      } finally {
        setIsPublishing(false);
      }
    }
  };

  const showSimpleView = !expanded && draftUrls.length === 1;

  const isAtDefault =
    draftUrls.length === DEFAULT_PUBLISH_RELAYS.length &&
    draftUrls.every(
      (u, i) => normalizeRelayUrl(u) === DEFAULT_PUBLISH_RELAYS[i],
    ) &&
    savedUrls.length === DEFAULT_PUBLISH_RELAYS.length &&
    savedUrls.every((u, i) => u === DEFAULT_PUBLISH_RELAYS[i]);

  return (
    <div className="space-y-2" data-testid="endpoint-list">
      <div className="flex items-baseline justify-between gap-3">
        <label className="text-xs uppercase tracking-wider text-vessel-text-muted">
          Sync servers
        </label>
        <button
          type="button"
          onClick={restoreDefault}
          disabled={isAtDefault}
          className="text-xs flex items-center gap-1 text-vessel-text-secondary hover:text-vessel-text-primary disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          data-testid="button-restore-default-endpoints"
        >
          <RotateCcw className="w-3 h-3" />
          Restore defaults
        </button>
      </div>

      <p className="text-xs text-vessel-text-muted">
        {showSimpleView
          ? "Where your settings and share links are published. Add your own any time."
          : "Your sync servers in order. The first is primary, the rest are backups. The list syncs to your other devices."}
      </p>

      {showSimpleView ? (
        <SingleRow
          value={draftUrls[0]}
          onChange={(v) => updateRow(0, v)}
          reachability={reachability[draftUrls[0]] ?? { kind: "idle" }}
        />
      ) : (
        <div className="space-y-2 mt-2" data-testid="endpoint-list-rows">
          {draftUrls.map((url, i) => (
            <EndpointRow
              key={i}
              index={i}
              url={url}
              isPrimary={i === 0}
              canMoveUp={i > 0}
              canMoveDown={i < draftUrls.length - 1}
              canRemove={draftUrls.length > 1}
              reachability={reachability[url] ?? { kind: "idle" }}
              onChange={(v) => updateRow(i, v)}
              onMoveUp={() => moveRow(i, -1)}
              onMoveDown={() => moveRow(i, 1)}
              onRemove={() => removeRow(i)}
            />
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 pt-2 flex-wrap">
        <button
          type="button"
          onClick={addRow}
          disabled={draftUrls.length >= MAX_PUBLISH_RELAYS}
          className="text-xs flex items-center gap-1 text-vessel-accent hover:text-vessel-accent/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          data-testid="button-add-endpoint"
        >
          <Plus className="w-3.5 h-3.5" />
          {showSimpleView ? "Add a backup server" : "Add another server"}
        </button>
        <VesselButton
          variant="primary"
          size="sm"
          onClick={handleSave}
          disabled={!canSave}
          data-testid="button-save-endpoint-list"
        >
          {isPublishing ? "Saving…" : "Save"}
        </VesselButton>
      </div>

      {validation.issues.length > 0 && isDirty && (
        <p
          className="text-xs text-vessel-red flex items-center gap-1.5 pt-1"
          data-testid="endpoint-list-validation"
        >
          <AlertCircle className="w-3 h-3" />
          {validation.issues[0]}
        </p>
      )}
    </div>
  );
}

function SingleRow({
  value,
  onChange,
  reachability,
}: {
  value: string;
  onChange: (v: string) => void;
  reachability: Reachability;
}) {
  return (
    <>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="wss://your-server.example"
        className="bg-vessel-bg-base border-vessel-border text-vessel-text-primary mt-2"
        data-testid="input-endpoint-url"
      />
      <ReachabilityChip
        reachability={reachability}
        testId="text-endpoint-reachability"
      />
    </>
  );
}

function EndpointRow({
  index,
  url,
  isPrimary,
  canMoveUp,
  canMoveDown,
  canRemove,
  reachability,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  index: number;
  url: string;
  isPrimary: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canRemove: boolean;
  reachability: Reachability;
  onChange: (v: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className="rounded-md border border-vessel-border bg-vessel-bg-base p-2.5 space-y-2"
      data-testid={`endpoint-row-${index}`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${
            isPrimary
              ? "bg-vessel-accent/15 text-vessel-accent"
              : "bg-vessel-bg-elevated text-vessel-text-muted border border-vessel-border"
          }`}
          data-testid={`endpoint-row-label-${index}`}
        >
          {isPrimary ? "Primary" : "Backup"}
        </span>
        <Input
          value={url}
          onChange={(e) => onChange(e.target.value)}
          placeholder="wss://your-server.example"
          className="bg-vessel-bg-elevated border-vessel-border text-vessel-text-primary text-sm h-8 flex-1 min-w-0"
          data-testid={`input-endpoint-url-${index}`}
        />
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            className="p-1.5 rounded text-vessel-text-secondary hover:text-vessel-text-primary hover:bg-vessel-bg-elevated disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Move up"
            data-testid={`button-endpoint-up-${index}`}
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            className="p-1.5 rounded text-vessel-text-secondary hover:text-vessel-text-primary hover:bg-vessel-bg-elevated disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Move down"
            data-testid={`button-endpoint-down-${index}`}
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={!canRemove}
            className="p-1.5 rounded text-vessel-text-secondary hover:text-vessel-red hover:bg-vessel-red/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Remove server"
            data-testid={`button-endpoint-remove-${index}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <ReachabilityChip
        reachability={reachability}
        testId={`endpoint-row-reachability-${index}`}
      />
    </div>
  );
}

function ReachabilityChip({
  reachability,
  testId,
}: {
  reachability: Reachability;
  testId: string;
}) {
  return (
    <div
      className="text-xs flex items-center gap-1.5 min-w-0"
      data-testid={testId}
    >
      {reachability.kind === "idle" && (
        <span className="text-vessel-text-muted truncate">—</span>
      )}
      {reachability.kind === "checking" && (
        <>
          <Loader2 className="w-3.5 h-3.5 animate-spin text-vessel-text-muted shrink-0" />
          <span className="text-vessel-text-muted truncate">Checking…</span>
        </>
      )}
      {reachability.kind === "ok" && (
        <>
          <CheckCircle2 className="w-3.5 h-3.5 text-vessel-green shrink-0" />
          <span className="text-vessel-green truncate">
            Reachable · {reachability.latencyMs} ms
          </span>
        </>
      )}
      {reachability.kind === "error" && (
        <>
          <AlertCircle className="w-3.5 h-3.5 text-vessel-red shrink-0" />
          <span className="text-vessel-red truncate">{reachability.reason}</span>
        </>
      )}
    </div>
  );
}
