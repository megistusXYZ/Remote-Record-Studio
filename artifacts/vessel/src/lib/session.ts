import { customFetch } from "@workspace/api-client-react";
import type { VesselIdentity } from "./identity";

export type SessionSettings = {
  title: string;
};

export type CreatedSession = {
  sessionId: string;
  inviteCode: string;
  inviteUrl: string;
  hostPubkey: string;
};

const API_BASE = "/api";

export function buildInviteUrl(inviteCode: string, _hostPubkey?: string): string {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  return `${window.location.origin}${base}/join/${encodeURIComponent(inviteCode)}`;
}

type CreatedSessionResponse = {
  id: string;
  inviteCode: string;
};

export async function createSession(
  identity: VesselIdentity,
  settings: SessionSettings,
): Promise<CreatedSession> {
  // customFetch attaches the NIP-98 Authorization header automatically via the
  // installed AuthHeaderProvider, so the signed request reaches the server.
  const session = await customFetch<CreatedSessionResponse>(`${API_BASE}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: settings.title,
      hostPubkey: identity._pubkey,
      hostName: identity.displayName,
    }),
  });

  return {
    sessionId: session.id,
    inviteCode: session.inviteCode,
    inviteUrl: buildInviteUrl(session.inviteCode, identity._pubkey),
    hostPubkey: identity._pubkey,
  };
}

type JoinedSessionResponse = { id: string };

export async function joinSession(
  sessionIdOrInvite: string,
  identity: VesselIdentity,
): Promise<{ sessionId: string }> {
  const session = await customFetch<JoinedSessionResponse>(
    `${API_BASE}/sessions/${encodeURIComponent(sessionIdOrInvite)}/join`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guestName: identity.displayName,
        guestPubkey: identity._pubkey,
      }),
    },
  );
  return { sessionId: session.id };
}

export async function cancelSession(sessionId: string): Promise<void> {
  await customFetch<null>(
    `${API_BASE}/sessions/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" },
  );
}

/**
 * Mark the calling participant as having cleanly left the session. The
 * server stamps `leftAt` on their participant row so other participants'
 * polled session responses drop them from the live roster within one
 * polling cycle (~8s) — much faster than waiting for the in-room
 * heartbeat DROP TTL to expire.
 *
 * `keepalive: true` lets the request finish even if the page is in the
 * middle of unloading or navigating away, so this is safe to call from
 * the Leave button right before navigation.
 *
 * Best-effort: callers should fire-and-forget. The relay LEAVE event +
 * heartbeat DROP TTL still cover the case where this request fails or
 * never reaches the server.
 */
export async function leaveSession(
  sessionId: string,
  pubkey: string,
): Promise<void> {
  await customFetch<unknown>(
    `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/leave`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pubkey }),
      keepalive: true,
    },
  );
}

export function extractInviteCodeFromInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    const sessionParam = url.searchParams.get("session");
    if (sessionParam) return sessionParam;

    const pathMatch = url.pathname.match(/\/join\/([^/?#]+)/);
    if (pathMatch) return pathMatch[1];
  } catch {
    // not a URL, fall through to treat as raw code
  }

  return trimmed;
}
