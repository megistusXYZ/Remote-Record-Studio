import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, ArrowRight, Copy, QrCode, Users, Check } from "lucide-react";
import { useGetRecentActivity, getGetRecentActivityQueryKey } from "@workspace/api-client-react";

import { useIdentity } from "../../hooks/use-identity";
import { buildInviteUrl, extractInviteCodeFromInput } from "../../lib/session";
import { VesselButton } from "../vessel-ui/VesselButton";
import { VesselCard } from "../vessel-ui/VesselCard";
import { VesselBadge } from "../vessel-ui/VesselBadge";
import { Input } from "@/components/ui/input";
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
  
  const [newSessionTitle, setNewSessionTitle] = useState("");
  const [inviteInput, setInviteInput] = useState("");
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: activity, isLoading: isActivityLoading } = useGetRecentActivity(
    { pubkey: pubkey!, limit: 5 },
    { query: { enabled: !!pubkey && state === "default", queryKey: getGetRecentActivityQueryKey({ pubkey: pubkey!, limit: 5 }) } }
  );

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

      <div className="relative z-10 w-full min-h-full pb-20">
        {state === "default" ? (
          <div className="container max-w-6xl mx-auto px-4 py-12 grid lg:grid-cols-[1.5fr_1fr] gap-8">
            <div className="flex flex-col">
              <div className="mb-10">
                <h1 className="font-display text-4xl font-bold text-vessel-text-primary tracking-tight">
                  Good {timeOfDay}, {displayName}.
                </h1>
                <p className="text-vessel-text-secondary mt-2 text-lg">
                  Ready to record something great?
                </p>
              </div>

              <VesselCard className="p-8 mb-6 border-vessel-accent/30 shadow-[0_0_40px_rgba(0,212,170,0.08)]">
                <div className="w-16 h-16 rounded-2xl bg-vessel-accent/10 flex items-center justify-center mb-6">
                  <Mic className="w-10 h-10 text-vessel-accent" />
                </div>
                <h2 className="font-display text-2xl font-bold text-vessel-text-primary mb-2">
                  Start a new studio session
                </h2>
                <p className="text-vessel-text-secondary text-base mb-6">
                  Create a private room, invite your guests, and record in studio quality.
                </p>
                <div className="flex flex-col gap-4">
                  <Input
                    value={newSessionTitle}
                    onChange={(e) => setNewSessionTitle(e.target.value)}
                    placeholder="Session title (e.g. Episode 12 — Future of Audio)"
                    className="h-12 bg-vessel-bg-base border-vessel-border focus-visible:ring-vessel-accent rounded-xl"
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

              <VesselCard variant="ghost" className="p-6">
                <h3 className="font-display text-lg font-bold text-vessel-text-primary mb-3">
                  Have an invite link?
                </h3>
                <div className="flex gap-3">
                  <Input
                    value={inviteInput}
                    onChange={(e) => setInviteInput(e.target.value)}
                    placeholder="Paste invite link or session code"
                    className="h-11 flex-1 bg-vessel-bg-base border-vessel-border focus-visible:ring-vessel-accent rounded-xl"
                    data-testid="input-invite-code"
                  />
                  <VesselButton
                    size="md"
                    onClick={handleJoin}
                    disabled={!inviteInput.trim()}
                    isLoading={isJoining}
                    data-testid="button-join-by-code"
                  >
                    Join &rarr;
                  </VesselButton>
                </div>
              </VesselCard>
            </div>

            <div className="flex flex-col">
              <h3 className="font-display text-lg font-bold text-vessel-text-primary mb-4">
                Recent Sessions
              </h3>
              <div className="flex flex-col gap-3">
                {isActivityLoading ? (
                  <>
                    <div className="h-16 rounded-xl bg-vessel-bg-surface animate-pulse" />
                    <div className="h-16 rounded-xl bg-vessel-bg-surface animate-pulse" />
                    <div className="h-16 rounded-xl bg-vessel-bg-surface animate-pulse" />
                  </>
                ) : !activity?.recentSessions?.length ? (
                  <VesselCard className="p-8 text-center">
                    <div className="w-[60px] h-[60px] rounded-full bg-vessel-bg-surface flex items-center justify-center mx-auto mb-4">
                      <Mic className="w-10 h-10 text-vessel-text-muted" />
                    </div>
                    <h4 className="font-display text-base font-bold text-vessel-text-primary mb-1">
                      No sessions yet
                    </h4>
                    <p className="text-vessel-text-muted text-sm">
                      Your past sessions will appear here.
                    </p>
                  </VesselCard>
                ) : (
                  activity.recentSessions.map(s => (
                    <VesselCard
                      key={s.id}
                      className="p-4 cursor-pointer hover:border-vessel-accent/40 transition-colors flex items-center justify-between"
                      onClick={() => setLocation(`/session/${s.id}`)}
                      data-testid={`card-recent-session-${s.id}`}
                    >
                      <div className="flex flex-col">
                        <span className="font-medium text-vessel-text-primary">{s.title}</span>
                        <div className="flex items-center gap-1.5 mt-1 text-xs text-vessel-text-muted">
                          <div className={`w-1.5 h-1.5 rounded-full ${s.status === 'live' ? 'bg-vessel-red animate-pulse' : s.status === 'waiting' ? 'bg-vessel-accent' : 'bg-vessel-text-muted'}`} />
                          <span className="capitalize">{s.status}</span>
                          <span>&bull;</span>
                          <span>{formatDistanceToNow(new Date(s.createdAt), { addSuffix: true })}</span>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-vessel-text-muted" />
                    </VesselCard>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : session ? (
          <div className="container max-w-2xl mx-auto px-4 py-12">
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-vessel-accent shadow-[0_0_8px_rgba(0,212,170,0.8)] animate-pulse" />
                <span className="text-vessel-text-secondary text-sm">Your studio is open</span>
              </div>
              <h1 className="font-display text-3xl font-bold text-vessel-text-primary">
                {session.title}
              </h1>
            </div>

            <VesselCard className="p-6 border-vessel-accent/40 shadow-[0_0_30px_rgba(0,212,170,0.12)]">
              <label className="block text-xs text-vessel-text-muted uppercase tracking-wider mb-3">
                Share this link to invite guests:
              </label>
              <div className="flex gap-2">
                <div 
                  className="flex-1 bg-vessel-bg-base border border-vessel-border rounded-xl p-3 font-mono-vessel text-sm text-vessel-text-primary overflow-hidden text-ellipsis whitespace-nowrap"
                  data-testid="text-invite-link"
                >
                  {buildInviteUrl(session.inviteCode, session.hostPubkey)}
                </div>
                <VesselButton
                  variant="ghost"
                  size="md"
                  onClick={handleCopyLink}
                  data-testid="button-copy-link"
                >
                  {copied ? <Check className="w-4 h-4 mr-2 text-vessel-green" /> : <Copy className="w-4 h-4 mr-2" />}
                  {copied ? "Copied!" : "Copy"}
                </VesselButton>
                <VesselButton
                  variant="ghost"
                  size="md"
                  onClick={() => setShowInviteModal(true)}
                  data-testid="button-show-qr"
                >
                  <QrCode className="w-4 h-4 mr-2" />
                  QR Code
                </VesselButton>
              </div>
            </VesselCard>

            <div className="mt-10">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <h2 className="font-display text-lg font-bold text-vessel-text-primary">In the room</h2>
                  <VesselBadge variant="default">{session.participants.length}</VesselBadge>
                </div>
                <VesselButton
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowInviteModal(true)}
                  data-testid="button-invite-more"
                >
                  <Users className="w-4 h-4 mr-2" />
                  Invite More
                </VesselButton>
              </div>

              <div className="space-y-3">
                <AnimatePresence initial={false}>
                  {session.participants.map((p, i) => (
                    <ParticipantCard
                      key={p.id}
                      participant={p}
                      isYou={p.pubkey === pubkey}
                      index={i}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </div>

            <div className="mt-8 text-center">
              {session.participants.length <= 1 ? (
                <p className="text-vessel-text-secondary text-base animate-pulse">
                  Waiting for guests...
                </p>
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
