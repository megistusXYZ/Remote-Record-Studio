import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Copy, QrCode, Users, Check, Trash2 } from "lucide-react";
import { StudioSproutIcon } from "../icons/StudioSproutIcon";
import { LobbyEmptyState } from "./LobbyEmptyState";
import { WaitingForGuestsEmpty } from "./WaitingForGuestsEmpty";
import {
  useGetRecentActivity,
  getGetRecentActivityQueryKey,
  useDeleteSession,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

import { useIdentity } from "../../hooks/use-identity";
import {
  useStoredJoinWithMic,
  useStoredJoinWithCamera,
  setStoredJoinWithMic,
  setStoredJoinWithCamera,
} from "../../hooks/use-join-prefs";
import { buildInviteUrl, extractInviteCodeFromInput } from "../../lib/session";
import { VesselButton } from "../vessel-ui/VesselButton";
import { VesselCard } from "../vessel-ui/VesselCard";
import { VesselBadge } from "../vessel-ui/VesselBadge";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ParticipantCard } from "./ParticipantCard";
import { InviteModal } from "./InviteModal";

export type LobbyScreenProps = {
  state: "default" | "waitingRoom";
  session?: {
    id: string;
    title: string;
    inviteCode: string;
    hostPubkey: string;
    hostName: string;
    participants: Array<{ id: string; displayName: string; pubkey: string; role: "host" | "guest" }>;
  };
  onCreateSession?: (title: string) => Promise<void>;
  onJoinByCode?: (code: string) => Promise<void>;
  onStartRecording?: () => void;
  onCancelSession?: () => Promise<void>;
  isCreating?: boolean;
  isJoining?: boolean;
  isStarting?: boolean;
};

export function LobbyScreen({
  state,
  session,
  onCreateSession,
  onJoinByCode,
  onStartRecording,
  onCancelSession,
  isCreating,
  isJoining,
  isStarting,
}: LobbyScreenProps) {
  const [, setLocation] = useLocation();
  const { pubkey, displayName } = useIdentity();
  const joinWithMic = useStoredJoinWithMic();
  const joinWithCamera = useStoredJoinWithCamera();
  
  const [newSessionTitle, setNewSessionTitle] = useState("");
  const [inviteInput, setInviteInput] = useState("");
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);

  const queryClient = useQueryClient();

  const { data: activity, isLoading: isActivityLoading } = useGetRecentActivity(
    { pubkey: pubkey!, limit: 5 },
    { query: { enabled: !!pubkey && state === "default", queryKey: getGetRecentActivityQueryKey({ pubkey: pubkey!, limit: 5 }) } }
  );

  const deleteSessionMutation = useDeleteSession({
    mutation: {
      onSuccess: () => {
        if (pubkey) {
          queryClient.invalidateQueries({
            queryKey: getGetRecentActivityQueryKey({ pubkey, limit: 5 }),
          });
        }
        setPendingDelete(null);
      },
    },
  });

  const hour = new Date().getHours();
  const timeOfDay = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";

  const handleCreate = () => {
    if (newSessionTitle.trim() && onCreateSession) {
      onCreateSession(newSessionTitle.trim());
    }
  };

  const handleJoin = () => {
    if (inviteInput.trim() && onJoinByCode) {
      const code = extractInviteCodeFromInput(inviteInput);
      onJoinByCode(code);
    }
  };

  const handleCopyLink = () => {
    if (!session) return;
    const url = buildInviteUrl(session.inviteCode, session.hostPubkey);
    navigator.clipboard.writeText(url);
    setCopied(true);
  };

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <div className="min-h-full w-full relative selection:bg-vessel-accent/30 selection:text-vessel-accent">
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-0 left-0 w-[800px] h-[800px] bg-vessel-accent/5 rounded-full blur-[120px] -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute bottom-0 right-0 w-[600px] h-[600px] bg-vessel-accent/5 rounded-full blur-[100px] translate-x-1/3 translate-y-1/3" />
      </div>

      <div className="relative z-10 w-full min-h-full pb-8 md:pb-12">
        {state === "default" ? (
          <div className="container max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10 md:py-12 grid lg:grid-cols-[1.5fr_1fr] gap-6 lg:gap-8">
            <div className="flex flex-col">
              <div className="mb-6 sm:mb-8 md:mb-10">
                <h1 className="font-display text-3xl sm:text-4xl md:text-5xl font-bold text-vessel-text-primary tracking-tight leading-[1.1]">
                  Good {timeOfDay}, {displayName}.
                </h1>
                <p className="text-vessel-text-secondary mt-2 sm:mt-3 text-base sm:text-lg">
                  Ready to record something great?
                </p>
              </div>

              <VesselCard className="p-5 sm:p-6 md:p-8 mb-4 sm:mb-6 border-vessel-accent/30 shadow-[0_0_40px_rgba(0,212,170,0.08)]">
                <div className="flex items-center gap-3 sm:gap-4 mb-5 sm:mb-6">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-vessel-accent/10 flex items-center justify-center shrink-0">
                    <StudioSproutIcon className="w-6 h-6 sm:w-7 sm:h-7 text-vessel-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="font-display text-xl sm:text-2xl font-bold text-vessel-text-primary leading-tight mb-1">
                      Start a new studio session
                    </h2>
                    <p className="text-vessel-text-secondary text-sm sm:text-base">
                      Create a private room, invite your guests, and record in studio quality.
                    </p>
                  </div>
                </div>
                <div className="flex flex-col gap-3 sm:gap-4">
                  <Input
                    value={newSessionTitle}
                    onChange={(e) => setNewSessionTitle(e.target.value)}
                    placeholder="Session title (e.g. Episode 12 — Future of Audio)"
                    className="h-12 bg-vessel-bg-base border-vessel-border focus-visible:ring-vessel-accent rounded-xl text-base"
                    data-testid="input-session-title"
                  />
                  <VesselButton
                    size="lg"
                    className="w-full"
                    onClick={handleCreate}
                    disabled={!newSessionTitle.trim()}
                    isLoading={isCreating}
                    data-testid="button-create-session"
                  >
                    Create Session &rarr;
                  </VesselButton>
                </div>
              </VesselCard>

              <VesselCard variant="ghost" className="px-0">
                <h3 className="font-display text-base sm:text-lg font-bold text-vessel-text-primary mb-3">
                  Have an invite link?
                </h3>
                <div className="flex flex-col sm:flex-row gap-3">
                  <Input
                    value={inviteInput}
                    onChange={(e) => setInviteInput(e.target.value)}
                    placeholder="Paste invite link or session code"
                    className="h-11 flex-1 bg-vessel-bg-base border-vessel-border focus-visible:ring-vessel-accent rounded-xl text-base"
                    data-testid="input-invite-code"
                  />
                  <VesselButton
                    size="md"
                    onClick={handleJoin}
                    disabled={!inviteInput.trim()}
                    isLoading={isJoining}
                    data-testid="button-join-by-code"
                    className="w-full sm:w-auto"
                  >
                    Join &rarr;
                  </VesselButton>
                </div>
              </VesselCard>
            </div>

            <div className="flex flex-col">
              <div className="mb-6 sm:mb-8 md:mb-10">
                <p className="font-mono-vessel text-[11px] uppercase tracking-[0.18em] text-vessel-accent mb-2">
                  Studio history
                </p>
                <h2 className="font-display text-2xl sm:text-3xl font-bold text-vessel-text-primary tracking-tight leading-[1.15]">
                  Recent sessions
                </h2>
                <p className="text-vessel-text-secondary mt-2 sm:mt-3 text-sm sm:text-base">
                  Pick up where you left off.
                </p>
              </div>
              <AlertDialog
                open={!!pendingDelete}
                onOpenChange={(o) => {
                  if (!o && !deleteSessionMutation.isPending) setPendingDelete(null);
                }}
              >
                <AlertDialogContent data-testid="dialog-remove-recent-session">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove this session?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Removes <span className="text-vessel-text-primary font-medium">{pendingDelete?.title}</span> from your studio.
                      Your recordings stay in your vault — they're never touched.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel
                      disabled={deleteSessionMutation.isPending}
                      data-testid="button-remove-recent-session-cancel"
                    >
                      Keep it
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={(e) => {
                        e.preventDefault();
                        if (pendingDelete) {
                          deleteSessionMutation.mutate({ sessionId: pendingDelete.id });
                        }
                      }}
                      disabled={deleteSessionMutation.isPending}
                      className="bg-vessel-red text-white hover:bg-vessel-red/90 focus-visible:ring-vessel-red/40"
                      data-testid="button-remove-recent-session-confirm"
                    >
                      {deleteSessionMutation.isPending ? "Removing…" : "Remove"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <div className="flex flex-col gap-3">
                {isActivityLoading ? (
                  <>
                    <div className="h-16 rounded-xl bg-vessel-bg-surface animate-pulse" />
                    <div className="h-16 rounded-xl bg-vessel-bg-surface animate-pulse" />
                    <div className="h-16 rounded-xl bg-vessel-bg-surface animate-pulse" />
                  </>
                ) : !activity?.recentSessions?.length ? (
                  <LobbyEmptyState />
                ) : (
                  activity.recentSessions.map(s => (
                    <VesselCard
                      key={s.id}
                      className="group p-4 cursor-pointer hover:border-vessel-accent/40 transition-colors flex items-center justify-between gap-3"
                      onClick={() => setLocation(`/session/${s.id}`)}
                      data-testid={`card-recent-session-${s.id}`}
                    >
                      <div className="flex flex-col min-w-0">
                        <span className="font-medium text-vessel-text-primary truncate">{s.title}</span>
                        <div className="flex items-center gap-1.5 mt-1 text-xs text-vessel-text-muted">
                          <div className={`w-1.5 h-1.5 rounded-full ${s.status === 'live' ? 'bg-vessel-red animate-pulse' : s.status === 'waiting' ? 'bg-vessel-accent' : 'bg-vessel-text-muted'}`} />
                          <span className="capitalize">{s.status}</span>
                          <span>&bull;</span>
                          <span>{formatDistanceToNow(new Date(s.createdAt), { addSuffix: true })}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingDelete({ id: s.id, title: s.title });
                          }}
                          aria-label={`Remove ${s.title} from recent sessions`}
                          className="p-1.5 rounded-lg text-vessel-text-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-vessel-red hover:bg-vessel-red/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vessel-red/40 transition-all"
                          data-testid={`button-remove-recent-session-${s.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <ArrowRight className="w-4 h-4 text-vessel-text-muted" />
                      </div>
                    </VesselCard>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : session ? (
          <div className="container max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10 md:py-12">
            <div className="mb-6 sm:mb-8">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-vessel-accent shadow-[0_0_8px_rgba(0,212,170,0.8)] animate-pulse shrink-0" />
                <span className="text-vessel-text-secondary text-sm">Your studio is open</span>
              </div>
              <h1 className="font-display text-2xl sm:text-3xl md:text-4xl font-bold text-vessel-text-primary tracking-tight leading-[1.15] break-words">
                {session.title}
              </h1>
            </div>

            <VesselCard className="p-5 sm:p-6 border-vessel-accent/40 shadow-[0_0_30px_rgba(0,212,170,0.12)]">
              <label className="block text-xs text-vessel-text-muted uppercase tracking-wider mb-3">
                Share this link to invite guests:
              </label>
              <div className="flex flex-col gap-3">
                <div
                  className="bg-vessel-bg-base border border-vessel-border rounded-xl p-3 font-mono-vessel text-xs sm:text-sm text-vessel-text-primary overflow-hidden text-ellipsis whitespace-nowrap"
                  data-testid="text-invite-link"
                >
                  {buildInviteUrl(session.inviteCode, session.hostPubkey)}
                </div>
                <div className="flex gap-2">
                  <VesselButton
                    variant="ghost"
                    size="md"
                    onClick={handleCopyLink}
                    className="flex-1"
                    data-testid="button-copy-link"
                  >
                    {copied ? <Check className="w-4 h-4 mr-2 text-vessel-green" /> : <Copy className="w-4 h-4 mr-2" />}
                    {copied ? "Copied!" : "Copy"}
                  </VesselButton>
                  <VesselButton
                    variant="ghost"
                    size="md"
                    onClick={() => setShowInviteModal(true)}
                    className="flex-1"
                    data-testid="button-show-qr"
                  >
                    <QrCode className="w-4 h-4 mr-2" />
                    QR Code
                  </VesselButton>
                </div>
              </div>
            </VesselCard>

            <div className="mt-8 sm:mt-10">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-3 min-w-0">
                  <h2 className="font-display text-base sm:text-lg font-bold text-vessel-text-primary">In the room</h2>
                  <VesselBadge variant="default">{session.participants.length}</VesselBadge>
                </div>
                <VesselButton
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowInviteModal(true)}
                  className="shrink-0"
                  data-testid="button-invite-more"
                >
                  <Users className="w-4 h-4 sm:mr-2" />
                  <span className="hidden sm:inline">Invite More</span>
                </VesselButton>
              </div>

              <div className="space-y-3">
                <AnimatePresence initial={false}>
                  {session.participants.map((p, i) => {
                    const isSelf = p.pubkey === pubkey;
                    return (
                      <ParticipantCard
                        key={p.id}
                        participant={p}
                        isYou={isSelf}
                        index={i}
                        // Show *your* current join prefs on your own
                        // row; others stay as the optimistic default
                        // until they're in the call.
                        micActive={isSelf ? joinWithMic : undefined}
                        cameraActive={isSelf ? joinWithCamera : undefined}
                        onToggleMic={
                          isSelf ? () => setStoredJoinWithMic(!joinWithMic) : undefined
                        }
                        onToggleCamera={
                          isSelf
                            ? () => setStoredJoinWithCamera(!joinWithCamera)
                            : undefined
                        }
                      />
                    );
                  })}
                </AnimatePresence>
              </div>
              <p className="mt-3 text-xs text-vessel-text-muted text-center">
                Tap your mic or camera to choose how you'll join. We'll remember it for next time.
              </p>
            </div>

            <div className="mt-8 text-center">
              {session.participants.length <= 1 ? (
                <WaitingForGuestsEmpty />
              ) : (
                <p className="text-vessel-accent text-base font-medium">
                  Everyone's here — let's go!
                </p>
              )}
            </div>

            {(onStartRecording || onCancelSession) ? (
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
                {onStartRecording && (
                  <VesselButton
                    size="lg"
                    className="w-full sm:w-auto"
                    onClick={onStartRecording}
                    isLoading={isStarting}
                    data-testid="button-start-recording"
                  >
                    Start Recording &rarr;
                  </VesselButton>
                )}
                {onCancelSession && (
                  <VesselButton
                    variant="ghost"
                    size="lg"
                    className="w-full sm:w-auto hover:text-vessel-red hover:bg-vessel-red/10"
                    onClick={() => {
                      if (window.confirm("Are you sure you want to cancel this session?")) {
                        onCancelSession();
                      }
                    }}
                    data-testid="button-cancel-session"
                  >
                    Cancel Session
                  </VesselButton>
                )}
              </div>
            ) : (
              <div className="mt-10 text-center">
                <p className="text-vessel-text-secondary">The host will start the session shortly.</p>
              </div>
            )}

            <InviteModal
              open={showInviteModal}
              onOpenChange={setShowInviteModal}
              inviteUrl={buildInviteUrl(session.inviteCode, session.hostPubkey)}
              inviteCode={session.inviteCode}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
