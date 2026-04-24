import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useIdentity } from "../hooks/use-identity";
import {
  useGetSession,
  getGetSessionQueryKey,
  useUpdateSession,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "../components/layout";
import { LobbyScreen } from "../components/lobby/LobbyScreen";
import { StudioScreen } from "../components/studio/StudioScreen";
import { cancelSession } from "../lib/session";

export default function SessionStudio() {
  const params = useParams();
  const sessionId = params.id;
  const [, setLocation] = useLocation();
  const { pubkey, isLoaded } = useIdentity();
  const queryClient = useQueryClient();

  const [isStartingRecording, setIsStartingRecording] = useState(false);
  const [isStoppingRecording, setIsStoppingRecording] = useState(false);
  // Set by StudioScreen (host or guest) when it owns the post-session UI flow,
  // suppresses the auto-redirect-to-vault below.
  const [studioInEndingFlow, setStudioInEndingFlow] = useState(false);

  const { data: session, isLoading, error } = useGetSession(
    sessionId || "",
    {
      query: {
        enabled: !!sessionId && !!pubkey,
        queryKey: getGetSessionQueryKey(sessionId || ""),
        refetchInterval: (query) => query.state.data?.status === "waiting" ? 3000 : false,
      },
    }
  );

  const updateSessionMutation = useUpdateSession();

  useEffect(() => {
    if (error) {
      setLocation("/home");
    }
  }, [error, setLocation]);

  useEffect(() => {
    // Auto-redirect when the session has ended — but skip while the StudioScreen
    // is mid-finalization (showing SessionComplete + persisting the local track).
    if (session?.status === "ended" && !isStoppingRecording && !studioInEndingFlow) {
      setLocation("/vault");
    }
  }, [session?.status, isStoppingRecording, studioInEndingFlow, setLocation]);

  if (!isLoaded || !pubkey) return null;
  if (isLoading || !session) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-vessel-bg-base text-vessel-text-primary">
        <div className="w-12 h-12 rounded-full border-4 border-vessel-bg-surface border-t-vessel-accent animate-spin" />
      </div>
    );
  }

  const isHost = session.hostPubkey === pubkey;

  const handleStartRecording = async () => {
    if (!isHost || !sessionId) return;
    setIsStartingRecording(true);
    try {
      await updateSessionMutation.mutateAsync({
        sessionId,
        data: { status: "live" },
      });
      queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(sessionId) });
    } catch (err) {
      console.error("Failed to start recording", err);
    } finally {
      setIsStartingRecording(false);
    }
  };

  const handleStopRecording = async () => {
    if (!isHost || !sessionId) return;
    setIsStoppingRecording(true);
    try {
      await updateSessionMutation.mutateAsync({
        sessionId,
        data: { status: "ended" },
      });
      queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(sessionId) });
      setLocation("/vault");
    } catch (err) {
      console.error("Failed to stop recording", err);
    } finally {
      setIsStoppingRecording(false);
    }
  };

  const handleCancelSession = async () => {
    if (!sessionId) return;
    try {
      await cancelSession(sessionId);
      setLocation("/home");
    } catch (err) {
      console.error("Failed to cancel session", err);
    }
  };

  const handleLeave = async () => {
    setLocation("/home");
  };

  if (session.status === "waiting") {
    return (
      <Layout>
        <LobbyScreen
          state="waitingRoom"
          session={{
            id: session.id,
            title: session.title,
            inviteCode: session.inviteCode,
            hostPubkey: session.hostPubkey,
            hostName: session.hostName,
            participants: session.participants.map((p) => ({
              id: p.id,
              displayName: p.displayName,
              pubkey: p.pubkey,
              role: p.role as "host" | "guest",
            })),
          }}
          onStartRecording={isHost ? handleStartRecording : undefined}
          onCancelSession={isHost ? handleCancelSession : undefined}
          isStarting={isStartingRecording}
        />
      </Layout>
    );
  }

  return (
    <StudioScreen
      session={{
        id: session.id,
        title: session.title,
        status: session.status as "waiting" | "live" | "ended",
        inviteCode: session.inviteCode,
        hostPubkey: session.hostPubkey,
        hostName: session.hostName,
        participants: session.participants.map((p) => ({
          id: p.id,
          displayName: p.displayName,
          pubkey: p.pubkey,
          role: p.role as "host" | "guest",
        })),
      }}
      isHost={isHost}
      onStartRecording={handleStartRecording}
      onStopRecording={async () => {
        setStudioInEndingFlow(true);
        await handleStopRecording();
      }}
      onLeave={handleLeave}
      onViewVault={() => setLocation("/vault")}
      onStartNewSession={() => setLocation("/home")}
      onEnterEndingFlow={() => setStudioInEndingFlow(true)}
      isStartingRecording={isStartingRecording}
      isStoppingRecording={isStoppingRecording}
    />
  );
}
