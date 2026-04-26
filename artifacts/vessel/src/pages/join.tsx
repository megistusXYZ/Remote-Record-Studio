import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { useGetSession, useJoinSession } from "@workspace/api-client-react";
import { useIdentity } from "../hooks/use-identity";
import { Greenroom, type GreenroomResult } from "../components/onboarding/Greenroom";
import {
  ConsentScreen,
  type RoomFullInfo,
} from "../components/onboarding/ConsentScreen";

/**
 * Join orchestrator for `/join/:inviteCode`.
 *
 * Flow:
 *   1. Resolve the invite — show "Studio not found" if it doesn't.
 *   2. Greenroom: pick devices, run mic check, see preflight, set name.
 *   3. Consent: read the contract, accept (calls joinSession) or decline.
 *   4. On success → /session/:id. On 409 (room full) → friendly blocked view
 *      driven by the consent screen's RoomFull state.
 *
 * The greenroom owns its own preview MediaStream and tears it down before
 * navigation so the studio's own useLocalStream takes the device handles
 * without contention. Selected device IDs are persisted to localStorage by
 * useMediaDevices, so the studio reopens the same camera/mic.
 */

type Phase = "greenroom" | "consent";

export default function Join() {
  const params = useParams();
  const inviteCode = params.inviteCode;
  const [, setLocation] = useLocation();

  const {
    data: session,
    isLoading: isSessionLoading,
    isError: isSessionError,
  } = useGetSession(inviteCode || "");

  const joinSessionMutation = useJoinSession();
  const { displayName, createGuestIdentity } = useIdentity();

  const [phase, setPhase] = useState<Phase>("greenroom");
  const [chosen, setChosen] = useState<GreenroomResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roomFull, setRoomFull] = useState<RoomFullInfo | null>(null);

  // Reset state when the invite changes (e.g. user opens a different link
  // in the same tab).
  useEffect(() => {
    setPhase("greenroom");
    setChosen(null);
    setError(null);
    setRoomFull(null);
  }, [inviteCode]);

  if (!inviteCode) {
    return null;
  }

  if (isSessionLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-vessel-bg-base text-vessel-text-primary">
        <div className="fixed inset-0 z-0 pointer-events-none">
          <div className="absolute top-0 left-0 w-[800px] h-[800px] bg-vessel-accent/5 rounded-full blur-[120px] -translate-x-1/2 -translate-y-1/2" />
        </div>
        <div className="relative z-10 flex flex-col items-center gap-4">
          <div className="h-10 w-10 border-2 border-vessel-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-vessel-text-secondary text-sm animate-pulse">Finding studio…</p>
        </div>
      </div>
    );
  }

  if (isSessionError || !session) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-vessel-bg-base text-vessel-text-primary px-4">
        <div className="fixed inset-0 z-0 pointer-events-none">
          <div className="absolute top-0 left-0 w-[800px] h-[800px] bg-vessel-accent/5 rounded-full blur-[120px] -translate-x-1/2 -translate-y-1/2" />
        </div>
        <div className="relative z-10 max-w-md text-center">
          <h2 className="font-display text-2xl font-bold mb-4">Studio not found</h2>
          <p className="text-vessel-text-secondary mb-8">
            This invite link doesn't work anymore. The host may have ended the session
            or cancelled the invite.
          </p>
          <button
            type="button"
            onClick={() => setLocation("/")}
            className="vessel-btn vessel-btn-primary px-6 py-3"
            data-testid="button-join-go-home"
          >
            Return Home
          </button>
        </div>
      </div>
    );
  }

  const handleAccept = async () => {
    if (!chosen || !session) return;
    setError(null);
    setRoomFull(null);
    try {
      const identity = await createGuestIdentity(chosen.name);
      const joined = await joinSessionMutation.mutateAsync({
        sessionId: inviteCode,
        data: { guestName: chosen.name, guestPubkey: identity._pubkey },
      });
      setLocation(`/session/${joined.id}`);
    } catch (err: unknown) {
      const parsed = parseJoinError(err);
      if (parsed.kind === "room_full") {
        setRoomFull(parsed.info);
      } else {
        setError(parsed.message);
      }
    }
  };

  if (phase === "greenroom") {
    return (
      <Greenroom
        hostName={session.hostName}
        sessionTitle={session.title}
        initialName={chosen?.name || displayName || ""}
        onContinue={(result) => {
          setChosen(result);
          setError(null);
          setRoomFull(null);
          setPhase("consent");
        }}
        onCancel={() => setLocation("/")}
      />
    );
  }

  return (
    <ConsentScreen
      hostName={session.hostName}
      sessionTitle={session.title}
      myName={chosen?.name || displayName || "you"}
      onAccept={handleAccept}
      onDecline={() => setLocation("/")}
      roomFull={roomFull}
      error={error}
    />
  );
}

/**
 * Best-effort interpretation of a join error so the UI can render the right
 * branch. We tolerate a few shapes since the orval-generated client doesn't
 * always carry the response body in a typed way for non-2xx codes.
 */
function parseJoinError(err: unknown):
  | { kind: "room_full"; info: RoomFullInfo }
  | { kind: "generic"; message: string } {
  const fallback = "We couldn't join the studio. The invite might be expired.";
  if (!err || typeof err !== "object") {
    return { kind: "generic", message: fallback };
  }
  const anyErr = err as {
    status?: number;
    response?: { status?: number; data?: unknown };
    data?: unknown;
    message?: string;
  };
  const status = anyErr.status ?? anyErr.response?.status;
  const body = anyErr.response?.data ?? anyErr.data;
  if (status === 409 && body && typeof body === "object") {
    const b = body as {
      error?: string;
      session?: {
        hostName?: string;
        participantCount?: number;
        maxParticipants?: number;
      };
    };
    if (b.error === "ROOM_FULL" && b.session) {
      return {
        kind: "room_full",
        info: {
          hostName: b.session.hostName ?? "the host",
          participantCount: b.session.participantCount ?? 0,
          maxParticipants: b.session.maxParticipants ?? 0,
        },
      };
    }
  }
  return {
    kind: "generic",
    message: anyErr.message?.trim() ? anyErr.message : fallback,
  };
}
