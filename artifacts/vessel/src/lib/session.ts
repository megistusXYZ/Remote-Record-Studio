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

export async function createSession(
  identity: VesselIdentity,
  settings: SessionSettings
): Promise<CreatedSession> {
  const response = await fetch(`${API_BASE}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: settings.title,
      hostPubkey: identity._pubkey,
      hostName: identity.displayName,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create session: ${text || response.statusText}`);
  }

  const session = await response.json();

  return {
    sessionId: session.id,
    inviteCode: session.inviteCode,
    inviteUrl: buildInviteUrl(session.inviteCode, identity._pubkey),
    hostPubkey: identity._pubkey,
  };
}

export async function joinSession(
  sessionIdOrInvite: string,
  identity: VesselIdentity
): Promise<{ sessionId: string }> {
  const response = await fetch(
    `${API_BASE}/sessions/${encodeURIComponent(sessionIdOrInvite)}/join`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guestName: identity.displayName,
        guestPubkey: identity._pubkey,
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to join session: ${text || response.statusText}`);
  }

  const session = await response.json();
  return { sessionId: session.id };
}

export async function cancelSession(sessionId: string): Promise<void> {
  const response = await fetch(
    `${API_BASE}/sessions/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" }
  );
  if (!response.ok && response.status !== 204) {
    const text = await response.text();
    throw new Error(`Failed to cancel session: ${text || response.statusText}`);
  }
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
