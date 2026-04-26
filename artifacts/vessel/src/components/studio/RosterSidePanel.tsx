import { useEffect, useRef, useState } from "react";
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
import { getInitials } from "../../lib/identity";
import { resolveAvatarColor, useStoredAvatarColor } from "../../hooks/use-avatar-color";
import { useIdentity } from "../../hooks/use-identity";
import { cn } from "@/lib/utils";

/**
 * RosterSidePanel — slide-in side panel showing live presence + chat.
 *
 * Pulls everything it needs from props — the StudioScreen owns the signaling
 * hook and passes the snapshot down. The panel itself just renders. The
 * design intentionally matches the existing studio header chrome (12-pixel
 * border, vessel-bg-surface, mono-vessel labels) so it feels like part of
 * the same surface.
 *
 * Two zones:
 *   1. Roster — every participant currently visible (host card pinned at the
 *      top, then guests sorted by name). Each row shows mic/cam/quality and,
 *      for the host, an "Ask to mute" inline action.
 *   2. Chat — a small message list + composer + emoji reactions. Reactions
 *      animate over the studio canvas via the parent.
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

  // Local user state
  isHost: boolean;
  myMicEnabled: boolean;
  myCameraEnabled: boolean;
  myQuality: ConnectionQuality;
  myHandRaised: boolean;
  onToggleHand: () => void;

  // Host actions
  onAskToMute: (targetPubkey: string) => void;

  // Chat
  chat: ChatMessage[];
  onSendChat: (text: string) => void;
  onSendReaction: (emoji: string) => void;
};

const QUICK_REACTIONS = ["👏", "🎉", "❤️", "🔥", "😂", "👍"];

export function RosterSidePanel({
  open,
  onClose,
  participants,
  presenceByPubkey,
  isConnected,
  isHost,
  myMicEnabled,
  myCameraEnabled,
  myQuality,
  myHandRaised,
  onToggleHand,
  onAskToMute,
  chat,
  onSendChat,
  onSendReaction,
}: RosterSidePanelProps) {
  const { pubkey: selfPubkey } = useIdentity();
  const storedColor = useStoredAvatarColor();
  const [draft, setDraft] = useState("");

  const sortedParticipants = [...participants].sort((a, b) => {
    if (a.role === "host" && b.role !== "host") return -1;
    if (b.role === "host" && a.role !== "host") return 1;
    return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
  });

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
            <header className="h-12 px-4 border-b border-vessel-border flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono-vessel text-vessel-text-muted uppercase tracking-wider">
                  In the room
                </span>
                <span
                  className="text-xs font-mono-vessel text-vessel-accent"
                  data-testid="text-roster-count"
                >
                  {sortedParticipants.length}
                </span>
                {isConnected ? (
                  <Wifi className="w-3 h-3 text-vessel-accent" aria-label="Signaling live" />
                ) : (
                  <WifiOff
                    className="w-3 h-3 text-vessel-text-muted"
                    aria-label="Signaling connecting…"
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
            </header>

            {/* Roster list */}
            <div className="overflow-y-auto px-2 py-2 max-h-[40vh] border-b border-vessel-border">
              <ul className="space-y-1">
                {sortedParticipants.map((p) => {
                  const isLocal = p.isSelf;
                  const presence = presenceByPubkey.get(p.pubkey);
                  const mic = isLocal ? myMicEnabled : presence?.micEnabled ?? false;
                  const cam = isLocal ? myCameraEnabled : presence?.cameraEnabled ?? false;
                  const quality = isLocal
                    ? myQuality
                    : presence?.quality ?? (presence ? "unknown" : "unknown");
                  const handRaised = isLocal ? myHandRaised : presence?.handRaised ?? false;
                  const showJoining = !isLocal && !presence;
                  return (
                    <li
                      key={p.pubkey}
                      className={cn(
                        "flex items-center gap-3 px-2 py-2 rounded-lg",
                        handRaised && "bg-vessel-amber/5",
                        showJoining && "opacity-60",
                      )}
                      data-testid={`row-roster-${p.pubkey}`}
                    >
                      <div
                        className="relative w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                        style={{
                          backgroundColor: resolveAvatarColor(
                            p.pubkey,
                            selfPubkey,
                            storedColor,
                          ),
                        }}
                      >
                        <span className="text-white text-xs font-bold">
                          {getInitials(p.displayName)}
                        </span>
                        {handRaised && (
                          <span
                            className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-vessel-amber border-2 border-vessel-bg-surface flex items-center justify-center"
                            aria-label="Hand raised"
                            data-testid={`chip-hand-${p.pubkey}`}
                          >
                            <Hand className="w-2.5 h-2.5 text-vessel-bg-base" />
                          </span>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-sm font-medium text-vessel-text-primary truncate">
                            {p.displayName}
                            {isLocal && (
                              <span className="text-vessel-text-muted font-normal"> (you)</span>
                            )}
                          </span>
                          {p.role === "host" && (
                            <Crown
                              className="w-3 h-3 text-vessel-amber shrink-0"
                              aria-label="Host"
                            />
                          )}
                        </div>
                        <div className="text-[11px] text-vessel-text-muted">
                          {showJoining ? "Joining…" : qualityLabel(quality)}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <DeviceDot enabled={mic} on={<Mic className="w-3 h-3" />} off={<MicOff className="w-3 h-3" />} testId={`dot-mic-${p.pubkey}`} />
                        <DeviceDot enabled={cam} on={<Video className="w-3 h-3" />} off={<VideoOff className="w-3 h-3" />} testId={`dot-cam-${p.pubkey}`} />
                        <QualityDot quality={quality} />
                        {isHost && !isLocal && presence?.micEnabled && (
                          <button
                            type="button"
                            onClick={() => onAskToMute(p.pubkey)}
                            className="ml-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-vessel-bg-base border border-vessel-border text-vessel-text-secondary hover:text-vessel-text-primary hover:border-vessel-accent/40 transition-colors"
                            data-testid={`button-ask-mute-${p.pubkey}`}
                            title={`Ask ${p.displayName.split(" ")[0]} to mute`}
                          >
                            <MicVocal className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Quick actions row */}
            <div className="px-3 py-2 border-b border-vessel-border flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={onToggleHand}
                className={cn(
                  "flex-1 h-9 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition-colors",
                  myHandRaised
                    ? "bg-vessel-amber/15 border-vessel-amber/40 text-vessel-amber"
                    : "bg-vessel-bg-base border-vessel-border text-vessel-text-secondary hover:text-vessel-text-primary",
                )}
                data-testid="button-toggle-hand"
              >
                <Hand className="w-3.5 h-3.5" />
                {myHandRaised ? "Lower hand" : "Raise hand"}
              </button>
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
}: {
  enabled: boolean;
  on: React.ReactNode;
  off: React.ReactNode;
  testId: string;
}) {
  return (
    <span
      className={cn(
        "w-6 h-6 rounded-full border flex items-center justify-center",
        enabled
          ? "bg-vessel-bg-base border-vessel-border text-vessel-text-secondary"
          : "bg-vessel-red/15 border-vessel-red/30 text-vessel-red",
      )}
      data-testid={testId}
      data-enabled={enabled}
    >
      {enabled ? on : off}
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
