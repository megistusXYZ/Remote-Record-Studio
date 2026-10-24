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
import { cancelSession, leaveSession } from "../lib/session";
import { readCachedRoster, writeCachedRoster } from "../lib/roster-cache";

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
        // Poll every 8 seconds while the session is waiting OR live so a
        // joiner who joined after we mounted shows up promptly, and a
        // joiner who left cleanly disappears within ~8s. Stop polling
        // once the session has ended — there's nothing left to discover
        // and we don't want to keep hitting the API from the post-session
        // screens.
        refetchInterval: (query) =>
          query.state.data?.status === "ended" ? false : 8000,
        // Seed from the local roster cache so a refresh shows the last
        // known room composition immediately instead of an empty
        // skeleton, even before the first network roundtrip resolves.
        // The cache is per-sessionId and the response signature matches
        // exactly what the API returns, so this is safe.
        initialData: () => (sessionId ? readCachedRoster(sessionId) : undefined),
        // Treat the cached snapshot as immediately stale so React Query
        // still kicks off a network fetch on mount; we just skip the
        // empty loading state.
        initialDataUpdatedAt: 0,
      },
    }
  );

  // Persist every successful response to the local roster cache. This is
  // what makes the next reload paint instantly with the same room you
  // just left — no spinner, no flash of empty roster.
  useEffect(() => {
    if (session && sessionId) {
      writeCachedRoster(sessionId, session);
    }
  }, [session, sessionId]);

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
    // Fire the signed leave request so the participant disappears from
    // every other client's roster within one poll cycle (~8s) — much
    // faster than waiting for the heartbeat-based DROP TTL. We deliberately
    // don't block navigation on this; the user clicked Leave and they
    // want out of the room. `keepalive: true` lets the request finish
    // even if React unmounts the component immediately afterward.
    if (sessionId && pubkey) {
      void leaveSession(sessionId, pubkey).catch(() => {
        // Best-effort. Other participants will still notice us gone via
        // the relay LEAVE event and the heartbeat DROP TTL.
      });
    }
    setLocation("/home");
  };

  // Roster surfaces should only show people who are CURRENTLY in the room.
  // Participants who cleanly left (POST /sessions/:id/leave) keep their row
  // for recording-attribution purposes, but they shouldn't appear in the
  // lobby list or studio sidebar — that's what `leftAt` filters out here.
  const liveParticipants = session.participants.filter((p) => p.leftAt == null);

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
            participants: liveParticipants.map((p) => ({
              id: p.id,
              displayName: p.displayName,
              pubkey: p.pubkey,
              role: p.role as "host" | "guest",
            })),
          }}
          isHost={isHost}
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
        participants: liveParticipants.map((p) => ({
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
