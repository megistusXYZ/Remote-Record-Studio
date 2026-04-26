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
