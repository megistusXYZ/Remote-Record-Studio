import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Hand,
  Send,
  Smile,
  MicVocal,
  Crown,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  type Peer,
  type ChatMessage,
  type ConnectionQuality,
} from "../../hooks/use-call-signal";
import { AvatarMark } from "../AvatarMark";
import { useIdentity } from "../../hooks/use-identity";
import { cn } from "@/lib/utils";

/**
 * RosterSidePanel — slide-in side panel showing live presence + chat.
 *
 * Pulls everything it needs from props — the StudioScreen owns the signaling
 * hook and passes the snapshot down. The panel itself just renders.
 *
 * Sort order (top → bottom):
 *   1. Raised hands, oldest raise first (so the queue is fair). Self goes
 *      into this bucket too if its hand is up.
 *   2. The host (if not already in the raised bucket).
 *   3. Other live participants, alphabetical by display name.
 *   4. Stale participants (no presence beat in >15s), at the bottom and
 *      semi-transparent with a "Reconnecting…" tag. Self never goes stale.
 *
 * The raise-hand toggle itself lives in the studio control bar — this panel
 * only shows the queue and (for the host) hover-✕ + "Lower all hands"
 * affordances.
 */

export type RosterParticipant = {
  pubkey: string;
  displayName: string;
  role: "host" | "guest";
  /** True if this participant is the local user. */
  isSelf: boolean;
};

export type RosterSidePanelProps = {
  open: boolean;
  onClose: () => void;
  /** All participants we know about (from the session DB), so the roster
   *  always shows the canonical list even before a heartbeat lands. */
  participants: RosterParticipant[];
  /** Live signaling snapshot keyed by pubkey. Mic/cam/quality/handRaised come
   *  from here when present; missing → "joining…" affordance. */
  presenceByPubkey: Map<string, Peer>;
  /** True when at least one signaling relay has acked our subscription. */
  isConnected: boolean;
  /** Optional room cap (when known) so the header can show "5 of 8". */
  roomCap?: number | null;

  // Local user state
  isHost: boolean;
  myMicEnabled: boolean;
  myCameraEnabled: boolean;
  myQuality: ConnectionQuality;
  myHandRaised: boolean;
  /** Local-mic instantaneous level (0..1). Drives the soft pulse on the
   *  self-row mic dot. Other participants render a static dot — we don't
   *  exchange audio levels over the signaling channel. */
  myMicLevel?: number;
  /** Wall-clock ms when our own hand went up, so we can position ourselves
   *  in the raised-hand queue alongside everyone else. */
  myHandRaisedAtMs?: number | null;

  // Host actions
  onAskToMute: (targetPubkey: string) => void;
  /** Host-only: ask one specific participant to lower their hand. */
  onLowerHand: (targetPubkey: string) => void;
  /** Host-only: ask everyone with a raised hand to lower it. */
  onLowerAllHands: () => void;

  // Reactions (chat is intentionally still here from earlier work; raise-hand
  // task spec says to keep the channel general but doesn't ask us to remove
  // existing chat/reactions UX).
  chat: ChatMessage[];
  onSendChat: (text: string) => void;
  onSendReaction: (emoji: string) => void;
};

const QUICK_REACTIONS = ["👏", "🎉", "❤️", "🔥", "😂", "👍"];

/** RMS threshold above which the mic dot pulses. Tuned so that a steady
 *  background hum doesn't flicker, but normal speech triggers it cleanly. */
const MIC_PULSE_THRESHOLD = 0.04;

type RosterRowData = {
  participant: RosterParticipant;
  micEnabled: boolean;
  cameraEnabled: boolean;
  quality: ConnectionQuality;
  handRaised: boolean;
  handRaisedAtMs: number | null;
  /** True when the peer has been quiet for >15s on the signaling channel. */
  stale: boolean;
  /** True if we have no signaling data yet (and aren't the local user). */
  joining: boolean;
};

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export function RosterSidePanel({
  open,
  onClose,
  participants,
  presenceByPubkey,
  isConnected,
  roomCap,
  isHost,
  myMicEnabled,
  myCameraEnabled,
  myQuality,
  myHandRaised,
  myMicLevel = 0,
  myHandRaisedAtMs = null,
  onAskToMute,
  onLowerHand,
  onLowerAllHands,
  chat,
  onSendChat,
  onSendReaction,
}: RosterSidePanelProps) {
  const { pubkey: selfPubkey } = useIdentity();
  const [draft, setDraft] = useState("");

  // Build per-row state (combines DB-known participants + signaling).
  const rows = useMemo<RosterRowData[]>(() => {
    return participants.map((p) => {
      const isLocal = p.isSelf;
      const presence = presenceByPubkey.get(p.pubkey);
      return {
        participant: p,
        micEnabled: isLocal ? myMicEnabled : presence?.micEnabled ?? false,
        cameraEnabled: isLocal ? myCameraEnabled : presence?.cameraEnabled ?? false,
        quality: isLocal ? myQuality : presence?.quality ?? "unknown",
        handRaised: isLocal ? myHandRaised : presence?.handRaised ?? false,
        handRaisedAtMs: isLocal ? myHandRaisedAtMs : presence?.handRaisedAtMs ?? null,
        // Self never goes stale — we know we're here. For others, presence
        // missing entirely means "joining" rather than "stale".
        stale: !isLocal && !!presence?.stale,
        joining: !isLocal && !presence,
      };
    });
  }, [
    participants,
    presenceByPubkey,
    myMicEnabled,
    myCameraEnabled,
    myQuality,
    myHandRaised,
    myHandRaisedAtMs,
  ]);

  // Sort according to the documented order at the top of the file. The
  // raised-hand queue itself uses the timestamp on the raise event so every
  // client renders the same ordinal.
  const sortedRows = useMemo(() => {
    const raised: RosterRowData[] = [];
    const live: RosterRowData[] = [];
    const stale: RosterRowData[] = [];
    for (const row of rows) {
      // Stale beats raised: a participant who has gone quiet on the
      // signaling channel sinks to the bottom even if their last beat
      // had a hand up. This keeps the queue ordering reflective of who
      // is actually here right now.
      if (row.stale) stale.push(row);
      else if (row.handRaised) raised.push(row);
      else live.push(row);
    }
    raised.sort((a, b) => {
      const ta = a.handRaisedAtMs ?? Number.MAX_SAFE_INTEGER;
      const tb = b.handRaisedAtMs ?? Number.MAX_SAFE_INTEGER;
      if (ta !== tb) return ta - tb;
      return a.participant.displayName.localeCompare(b.participant.displayName);
    });
    live.sort((a, b) => {
      // Host first within the live bucket, then alphabetical.
      if (a.participant.role === "host" && b.participant.role !== "host") return -1;
      if (b.participant.role === "host" && a.participant.role !== "host") return 1;
      return a.participant.displayName.localeCompare(b.participant.displayName, undefined, {
        sensitivity: "base",
      });
    });
    stale.sort((a, b) =>
      a.participant.displayName.localeCompare(b.participant.displayName, undefined, {
        sensitivity: "base",
      }),
    );
    return [...raised, ...live, ...stale];
  }, [rows]);

  const raisedCount = useMemo(
    () => sortedRows.filter((r) => r.handRaised).length,
    [sortedRows],
  );

  // Header count: every row we're rendering, including stale-but-not-yet-dropped.
  const visibleCount = sortedRows.length;

  const handleSendChat = () => {
    const text = draft.trim();
    if (!text) return;
    onSendChat(text);
    setDraft("");
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop — only on small viewports, so the studio stays visible
              behind the panel on desktop. */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/40 z-30 lg:hidden"
            data-testid="overlay-roster-backdrop"
          />

          <motion.aside
            key="roster"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
            className="fixed top-0 right-0 bottom-20 z-40 w-full sm:w-[360px] bg-vessel-bg-surface border-l border-vessel-border flex flex-col shadow-2xl"
            data-testid="panel-roster"
          >
            {/* Header */}
            <header className="px-4 pt-3 pb-2 border-b border-vessel-border shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="text-sm font-medium text-vessel-text-primary"
                    data-testid="text-roster-count"
                  >
                    {visibleCount} in this room
                    {typeof roomCap === "number" && roomCap > 0 && (
                      <span className="text-vessel-text-muted font-normal">
                        {" "}of {roomCap}
                      </span>
                    )}
                  </span>
                  {isConnected ? (
                    <Wifi className="w-3 h-3 text-vessel-accent" aria-label="Connected" />
                  ) : (
                    <WifiOff
                      className="w-3 h-3 text-vessel-text-muted"
                      aria-label="Connecting…"
                    />
                  )}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close roster"
                  className="w-7 h-7 rounded-full hover:bg-vessel-bg-base flex items-center justify-center text-vessel-text-secondary transition-colors"
                  data-testid="button-roster-close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {isHost && raisedCount > 0 && (
                <div className="mt-1.5">
                  <button
                    type="button"
                    onClick={onLowerAllHands}
                    className="text-xs text-vessel-accent hover:text-vessel-accent-dim hover:underline transition-colors"
                    data-testid="button-lower-all-hands"
                  >
                    Lower all hands
                  </button>
                </div>
              )}
            </header>

            {/* Roster list */}
            <div className="overflow-y-auto px-2 py-2 max-h-[40vh] border-b border-vessel-border">
              <ul className="space-y-1">
                <AnimatePresence initial={false}>
                  {sortedRows.map((row, idx) => {
                    const queuePosition = row.handRaised
                      ? sortedRows
                          .slice(0, idx + 1)
                          .filter((r) => r.handRaised).length
                      : null;
                    return (
                      <RosterRow
                        key={row.participant.pubkey}
                        row={row}
                        queuePosition={queuePosition}
                        isHost={isHost}
                        myMicLevel={myMicLevel}
                        onAskToMute={onAskToMute}
                        onLowerHand={onLowerHand}
                      />
                    );
                  })}
                </AnimatePresence>
              </ul>
            </div>

            {/* Quick actions row — reactions only; the raise-hand button now
                lives in the control bar so it's always reachable. */}
            <div className="px-3 py-2 border-b border-vessel-border flex items-center justify-end">
              <ReactionPicker onPick={onSendReaction} />
            </div>

            {/* Chat */}
            <ChatThread chat={chat} selfPubkey={selfPubkey} />

            <ChatComposer
              draft={draft}
              setDraft={setDraft}
              onSend={handleSendChat}
            />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function RosterRow({
  row,
  queuePosition,
  isHost,
  myMicLevel,
  onAskToMute,
  onLowerHand,
}: {
  row: RosterRowData;
  queuePosition: number | null;
  isHost: boolean;
  myMicLevel: number;
  onAskToMute: (pubkey: string) => void;
  onLowerHand: (pubkey: string) => void;
}) {
  const { participant: p, micEnabled, cameraEnabled, quality, handRaised, stale, joining } = row;
  const isLocal = p.isSelf;

  // Mic-dot pulse: only meaningful for self because we have an audio
  // analyzer hooked up to the local stream. For other peers we simply show
  // the static enabled/disabled state.
  const pulse = isLocal && micEnabled && myMicLevel > MIC_PULSE_THRESHOLD;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: stale ? 0.55 : 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "group/row flex items-center gap-3 px-2 py-2 rounded-lg overflow-hidden",
        handRaised && "bg-vessel-amber/5 ring-1 ring-vessel-amber/20",
        joining && "opacity-60",
      )}
      data-testid={`row-roster-${p.pubkey}`}
      data-stale={stale ? "true" : "false"}
      data-hand-raised={handRaised ? "true" : "false"}
    >
      <AvatarMark
        pubkey={p.pubkey}
        displayName={p.displayName}
        className="w-9 h-9"
        initialsClassName="text-xs"
      >
        {handRaised && (
          <span
            className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-vessel-amber border-2 border-vessel-bg-surface flex items-center justify-center"
            aria-label="Hand raised"
            data-testid={`chip-hand-${p.pubkey}`}
          >
            <Hand className="w-2.5 h-2.5 text-vessel-bg-base" />
          </span>
        )}
      </AvatarMark>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm font-medium text-vessel-text-primary truncate">
            {p.displayName}
            {isLocal && (
              <span className="text-vessel-text-muted font-normal"> (you)</span>
            )}
          </span>
          {p.role === "host" && (
            <span
              className="inline-flex items-center gap-0.5 px-1.5 py-px rounded-full text-[9px] font-mono-vessel uppercase tracking-wider bg-vessel-amber/15 text-vessel-amber border border-vessel-amber/25 shrink-0"
              aria-label="Host"
              data-testid={`chip-host-${p.pubkey}`}
            >
              <Crown className="w-2.5 h-2.5" />
              Host
            </span>
          )}
          {handRaised && queuePosition !== null && (
            <span
              className="text-[10px] font-mono-vessel text-vessel-amber shrink-0"
              data-testid={`text-hand-position-${p.pubkey}`}
              aria-label={`Position ${queuePosition} in raised-hand queue`}
            >
              {ordinal(queuePosition)}
            </span>
          )}
        </div>
        <div className="text-[11px] text-vessel-text-muted">
          {stale ? "Reconnecting…" : joining ? "Joining…" : qualityLabel(quality)}
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <DeviceDot
          enabled={micEnabled}
          on={<Mic className="w-3 h-3" />}
          off={<MicOff className="w-3 h-3" />}
          testId={`dot-mic-${p.pubkey}`}
          pulse={pulse}
        />
        <DeviceDot
          enabled={cameraEnabled}
          on={<Video className="w-3 h-3" />}
          off={<VideoOff className="w-3 h-3" />}
          testId={`dot-cam-${p.pubkey}`}
        />
        <QualityDot quality={quality} />
        {/* Host-only inline action: lower this row's hand. Available on
            EVERY raised row including the host's own — when self, the
            StudioScreen handler routes back through `toggleHand` instead
            of publishing a host→self moderation event. */}
        {isHost && handRaised && (
          <button
            type="button"
            onClick={() => onLowerHand(p.pubkey)}
            className="ml-1 w-6 h-6 rounded-full bg-vessel-bg-base border border-vessel-border text-vessel-text-secondary hover:text-vessel-text-primary hover:border-vessel-amber/40 hover:bg-vessel-amber/10 flex items-center justify-center transition-all opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vessel-amber/40"
            data-testid={`button-lower-hand-${p.pubkey}`}
            title={isLocal ? "Lower your hand" : `Lower ${p.displayName.split(" ")[0]}'s hand`}
            aria-label={isLocal ? "Lower your hand" : `Lower ${p.displayName}'s hand`}
          >
            <X className="w-3 h-3" />
          </button>
        )}
        {isHost && !isLocal && micEnabled && !stale && (
          <button
            type="button"
            onClick={() => onAskToMute(p.pubkey)}
            className="ml-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-vessel-bg-base border border-vessel-border text-vessel-text-secondary hover:text-vessel-text-primary hover:border-vessel-accent/40 transition-colors"
            data-testid={`button-ask-mute-${p.pubkey}`}
            title={`Ask ${p.displayName.split(" ")[0]} to mute`}
            aria-label={`Ask ${p.displayName} to mute`}
          >
            <MicVocal className="w-3 h-3" />
          </button>
        )}
      </div>
    </motion.li>
  );
}

function qualityLabel(quality: ConnectionQuality): string {
  switch (quality) {
    case "good":
      return "Strong connection";
    case "fair":
      return "Connection: fair";
    case "poor":
      return "Connection: weak";
    default:
      return "Connection: checking…";
  }
}

function DeviceDot({
  enabled,
  on,
  off,
  testId,
  pulse = false,
}: {
  enabled: boolean;
  on: React.ReactNode;
  off: React.ReactNode;
  testId: string;
  pulse?: boolean;
}) {
  return (
    <span
      className={cn(
        "relative w-6 h-6 rounded-full border flex items-center justify-center",
        enabled
          ? "bg-vessel-bg-base border-vessel-border text-vessel-text-secondary"
          : "bg-vessel-red/15 border-vessel-red/30 text-vessel-red",
      )}
      data-testid={testId}
      data-enabled={enabled}
      data-pulse={pulse ? "true" : "false"}
    >
      {pulse && (
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-vessel-accent/40 animate-ping pointer-events-none"
        />
      )}
      <span className="relative">{enabled ? on : off}</span>
    </span>
  );
}

function QualityDot({ quality }: { quality: ConnectionQuality }) {
  const color =
    quality === "good"
      ? "bg-vessel-accent"
      : quality === "fair"
      ? "bg-vessel-amber"
      : quality === "poor"
      ? "bg-vessel-red"
      : "bg-vessel-text-muted";
  return (
    <span
      className={cn("w-2 h-2 rounded-full ml-0.5 shrink-0", color)}
      title={qualityLabel(quality)}
      aria-label={qualityLabel(quality)}
    />
  );
}

function ReactionPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-9 w-9 rounded-lg border border-vessel-border bg-vessel-bg-base text-vessel-text-secondary hover:text-vessel-text-primary flex items-center justify-center transition-colors"
        data-testid="button-reaction-picker"
        aria-label="Send reaction"
      >
        <Smile className="w-4 h-4" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="absolute right-0 bottom-11 p-1 rounded-xl bg-vessel-bg-surface border border-vessel-border shadow-lg flex items-center gap-1 z-50"
            data-testid="popover-reactions"
          >
            {QUICK_REACTIONS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => {
                  onPick(e);
                  setOpen(false);
                }}
                className="w-8 h-8 rounded-md hover:bg-vessel-bg-base flex items-center justify-center text-lg transition-colors"
                data-testid={`button-reaction-${e}`}
              >
                {e}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ChatThread({
  chat,
  selfPubkey,
}: {
  chat: ChatMessage[];
  selfPubkey: string | null | undefined;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chat.length]);

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto px-3 py-3 space-y-2"
      data-testid="list-chat"
    >
      {chat.length === 0 ? (
        <div className="text-center text-xs text-vessel-text-muted py-8">
          Say hi to the room — chat is just for the people on this call.
        </div>
      ) : (
        chat.map((m) => {
          const isSelf = m.fromPubkey === selfPubkey;
          return (
            <div
              key={m.id}
              className={cn("flex flex-col", isSelf ? "items-end" : "items-start")}
              data-testid={`chat-message-${m.id}`}
            >
              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-3 py-1.5 text-sm leading-snug",
                  isSelf
                    ? "bg-vessel-accent text-vessel-bg-base rounded-br-sm"
                    : "bg-vessel-bg-base text-vessel-text-primary rounded-bl-sm border border-vessel-border",
                )}
              >
                {m.text}
              </div>
              <div className="text-[10px] text-vessel-text-muted mt-0.5 px-1">
                {isSelf ? "You" : m.fromName}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function ChatComposer({
  draft,
  setDraft,
  onSend,
}: {
  draft: string;
  setDraft: (v: string) => void;
  onSend: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSend();
      }}
      className="border-t border-vessel-border p-2 flex items-center gap-2 shrink-0"
    >
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, 1000))}
        placeholder="Message the room…"
        className="flex-1 h-9 rounded-lg bg-vessel-bg-base border border-vessel-border focus:outline-none focus:ring-2 focus:ring-vessel-accent/40 px-3 text-sm text-vessel-text-primary placeholder:text-vessel-text-muted"
        data-testid="input-chat-draft"
      />
      <button
        type="submit"
        disabled={!draft.trim()}
        className="h-9 w-9 rounded-lg bg-vessel-accent text-vessel-bg-base disabled:opacity-40 disabled:cursor-not-allowed hover:bg-vessel-accent/90 flex items-center justify-center transition-opacity"
        data-testid="button-chat-send"
        aria-label="Send message"
      >
        <Send className="w-4 h-4" />
      </button>
    </form>
  );
}
