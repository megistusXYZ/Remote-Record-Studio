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
  DEFAULT_STORAGE_URL,
  checkStorageReachability,
  getStorageUrls,
  isValidStorageUrl,
  normalizeStorageUrl,
  publishStorageServerList,
  setStorageUrls,
  type ReachabilityResult,
} from "../../lib/storage-config";
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

export interface StorageServerListProps {
  pubkey: string;
  identity: VesselIdentity | null;
  onToast: ToastFn;
}

/**
 * Manage the user's ordered storage server list.
 *
 * - Default view (single URL): a simple input + Save, with a "+ Add backup
 *   server" affordance below. Visually identical to the prior single-field
 *   UI, so users who never want mirrors aren't asked to learn anything new.
 * - Expanded view (>1 URL or user clicked Add): each row gets an explicit
 *   PRIMARY / MIRROR label, up/down reorder arrows (no drag library — works
 *   on touch with no extra deps), reachability indicator, and a delete
 *   button. Save commits the entire ordered list at once.
 *
 * The first row is always the **primary** — it's where new uploads go.
 * Mirrors are best-effort additional copies (and read-time fallbacks). This
 * mirrors the wire format the network already uses (Kind 10063 server list
 * tags are an ordered array, primary first).
 */
export function StorageServerList({
  pubkey,
  identity,
  onToast,
}: StorageServerListProps) {
  // Source-of-truth for "what's currently persisted". We track this so the
  // dirty check doesn't compare against a stale snapshot after publishes.
  const [savedUrls, setSavedUrls] = useState<string[]>(() =>
    getStorageUrls(pubkey),
  );
  // The working draft the user is editing. Mirrored from savedUrls on
  // mount, save, and restore.
  const [draftUrls, setDraftUrls] = useState<string[]>(() =>
    getStorageUrls(pubkey),
  );
  // True once the user has explicitly opted into the multi-server view, or
  // when the saved list already has >1 entry. We never auto-collapse — once
  // expanded, stay expanded for this mount, so a user who deletes a mirror
  // back down to 1 doesn't have the "+ Add" affordance vanish under their
  // cursor.
  const [expanded, setExpanded] = useState<boolean>(
    () => getStorageUrls(pubkey).length > 1,
  );
  const [isPublishing, setIsPublishing] = useState(false);

  // Per-row reachability, keyed by the row's URL string. We key by URL
  // rather than index so reordering doesn't cause spurious "checking…"
  // flickers — the result for a given URL is reusable regardless of where
  // it sits in the list.
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
      setReachability((prev) => ({
        ...prev,
        [url]: { kind: "idle" },
      }));
      return;
    }
    if (!isValidStorageUrl(trimmed)) {
      setReachability((prev) => ({
        ...prev,
        [url]: { kind: "error", reason: "Enter a valid https:// URL." },
      }));
      return;
    }
    // Cancel any in-flight probe for this exact URL key.
    probesRef.current.get(url)?.abort();
    const ctl = new AbortController();
    probesRef.current.set(url, ctl);
    setReachability((prev) => ({ ...prev, [url]: { kind: "checking" } }));
    void (async () => {
      const result: ReachabilityResult = await checkStorageReachability(
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

  // Debounced re-probe whenever the draft list changes. We probe each
  // unique URL exactly once per debounce window AND cancel any in-flight
  // probes for URLs no longer present in the list (rows that were edited
  // or removed) so we don't accumulate stale controllers and waste
  // network on values the user has already moved past.
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
      if (normalizeStorageUrl(draftUrls[i]) !== savedUrls[i]) return true;
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
      const n = normalizeStorageUrl(raw);
      if (!isValidStorageUrl(n)) {
        issues.push(`Row ${i + 1} isn't a valid https:// URL.`);
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
      // Always keep at least one row in the editor — an empty list isn't
      // meaningful and the Save validator would reject it. If the user
      // deletes the last row, replace it with an empty input so they can
      // type a new value rather than losing the row entirely.
      if (prev.length <= 1) return [""];
      return prev.filter((_, idx) => idx !== i);
    });
  };

  const addRow = () => {
    setExpanded(true);
    setDraftUrls((prev) => [...prev, ""]);
  };

  const restoreDefault = () => {
    setDraftUrls([DEFAULT_STORAGE_URL]);
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
    setStorageUrls(cleaned, pubkey);
    setSavedUrls(cleaned);
    setDraftUrls(cleaned);
    onToast({
      title: "Saved",
      description:
        cleaned.length === 1
          ? "Storage updated."
          : `Storage updated: 1 primary and ${cleaned.length - 1} backup${cleaned.length - 1 === 1 ? "" : "s"}.`,
    });
    if (identity) {
      setIsPublishing(true);
      try {
        const { published } = await publishStorageServerList(identity, cleaned);
        if (published) {
          onToast({
            description: "Synced your storage list across devices.",
          });
        } else {
          // Local save succeeded but the publish helper reported zero
          // accepting hosts. Surface this so the user knows the choice
          // won't follow them to other devices yet — and so they can
          // retry by saving again later when their network is healthier.
          onToast({
            title: "Saved on this device",
            description: "Couldn't sync the list to your other devices right now.",
          });
        }
      } catch (err) {
        console.warn("Server list publish failed:", err);
        onToast({
          title: "Saved on this device",
          description: "Couldn't sync the list to your other devices right now.",
        });
      } finally {
        setIsPublishing(false);
      }
    }
  };

  // Determine which rendering branch we're in. Default: 1 saved URL & user
  // hasn't expanded → simple single-input look. Otherwise: full list view.
  const showSimpleView = !expanded && draftUrls.length === 1;

  const isAtDefault =
    draftUrls.length === 1 &&
    normalizeStorageUrl(draftUrls[0]) === DEFAULT_STORAGE_URL &&
    savedUrls.length === 1 &&
    savedUrls[0] === DEFAULT_STORAGE_URL;

  return (
    <div className="space-y-2" data-testid="storage-server-list">
      <div className="flex items-baseline justify-between gap-3">
        <label className="text-xs uppercase tracking-wider text-vessel-text-muted">
          Storage
        </label>
        <button
          type="button"
          onClick={restoreDefault}
          disabled={isAtDefault}
          className="text-xs flex items-center gap-1 text-vessel-text-secondary hover:text-vessel-text-primary disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          data-testid="button-restore-default-storage"
        >
          <RotateCcw className="w-3 h-3" />
          Restore default
        </button>
      </div>

      <p className="text-xs text-vessel-text-muted">
        {showSimpleView
          ? "Where your recordings are saved. The default server is provided for free and is not run by Vessel. Point to your own server any time."
          : "Your storage servers in order. New recordings upload to the primary. The list syncs to your other devices."}
      </p>

      {showSimpleView ? (
        <SingleRow
          value={draftUrls[0]}
          onChange={(v) => updateRow(0, v)}
          reachability={reachability[draftUrls[0]] ?? { kind: "idle" }}
        />
      ) : (
        <div className="space-y-2 mt-2" data-testid="storage-server-list-rows">
          {draftUrls.map((url, i) => (
            <ServerRow
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
          className="text-xs flex items-center gap-1 text-vessel-accent hover:text-vessel-accent/80 transition-colors"
          data-testid="button-add-storage-mirror"
        >
          <Plus className="w-3.5 h-3.5" />
          {showSimpleView ? "Add a backup server" : "Add another server"}
        </button>
        <VesselButton
          variant="primary"
          size="sm"
          onClick={handleSave}
          disabled={!canSave}
          data-testid="button-save-storage-list"
        >
          {isPublishing ? "Saving…" : "Save"}
        </VesselButton>
      </div>

      {validation.issues.length > 0 && isDirty && (
        <p
          className="text-xs text-vessel-red flex items-center gap-1.5 pt-1"
          data-testid="storage-list-validation"
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
        placeholder="https://your-server.example"
        className="bg-vessel-bg-base border-vessel-border text-vessel-text-primary mt-2"
        data-testid="input-storage-url"
      />
      <ReachabilityChip reachability={reachability} testId="text-storage-reachability" />
    </>
  );
}

function ServerRow({
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
      data-testid={`storage-row-${index}`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${
            isPrimary
              ? "bg-vessel-accent/15 text-vessel-accent"
              : "bg-vessel-bg-elevated text-vessel-text-muted border border-vessel-border"
          }`}
          data-testid={`storage-row-label-${index}`}
        >
          {isPrimary ? "Primary" : "Backup"}
        </span>
        <Input
          value={url}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://your-server.example"
          className="bg-vessel-bg-elevated border-vessel-border text-vessel-text-primary text-sm h-8 flex-1 min-w-0"
          data-testid={`input-storage-url-${index}`}
        />
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            className="p-1.5 rounded text-vessel-text-secondary hover:text-vessel-text-primary hover:bg-vessel-bg-elevated disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Move up"
            data-testid={`button-storage-up-${index}`}
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            className="p-1.5 rounded text-vessel-text-secondary hover:text-vessel-text-primary hover:bg-vessel-bg-elevated disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Move down"
            data-testid={`button-storage-down-${index}`}
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={!canRemove}
            className="p-1.5 rounded text-vessel-text-secondary hover:text-vessel-red hover:bg-vessel-red/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Remove server"
            data-testid={`button-storage-remove-${index}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <ReachabilityChip
        reachability={reachability}
        testId={`storage-row-reachability-${index}`}
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
