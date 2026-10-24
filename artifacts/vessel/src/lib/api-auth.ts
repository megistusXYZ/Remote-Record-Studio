import { setAuthHeaderProvider, type AuthHeaderProvider } from "@workspace/api-client-react";
import { useIdentityStore } from "../store/identityStore";

/**
 * NIP-98 HTTP Auth event kind. Built once per outgoing data-fetching API
 * request and signed by the user's current signer (local key, browser
 * extension, or remote signer). The server middleware verifies the signature
 * + freshness + URL/method binding before honoring the request.
 */
const AUTH_EVENT_KIND = 27235;

interface UnsignedAuthEvent {
  kind: number;
  created_at: number;
  content: string;
  tags: string[][];
}

interface SignedAuthEvent extends UnsignedAuthEvent {
  id: string;
  pubkey: string;
  sig: string;
}

function bytesFromUtf8(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

function base64FromBytes(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/**
 * Build the NIP-98 auth header value for a single outgoing request.
 *
 * Returns `null` when no identity is loaded yet — the request will go out
 * unauthenticated and the server will respond 401, which surfaces in the
 * usual react-query error path. We deliberately do NOT block or wait here:
 * the boot sequence may race the first vault fetch with identity hydration,
 * and react-query's retries will pick up the auth header on the next attempt
 * once identity is available.
 */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytesFromUtf8(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const provider: AuthHeaderProvider = async ({ method, url, body }) => {
  const identity = useIdentityStore.getState().identity;
  if (!identity) return null;

  const tags: string[][] = [
    ["u", url],
    ["method", method.toUpperCase()],
  ];
  // Bind the signature to the exact bytes we send (NIP-98 `payload`), so a
  // captured header cannot be replayed with a different body.
  if (typeof body === "string" && body.length > 0) {
    tags.push(["payload", await sha256Hex(body)]);
  }

  const unsigned: UnsignedAuthEvent = {
    kind: AUTH_EVENT_KIND,
    created_at: Math.floor(Date.now() / 1000),
    content: "",
    tags,
  };

  let signed: SignedAuthEvent;
  try {
    // Every supported signer (local key, NIP-07 extension, NIP-46 remote)
    // implements the same `signEvent(template) -> signed` contract via
    // applesauce-signers, so we route through one path.
    signed = (await identity._signer.signEvent(unsigned)) as SignedAuthEvent;
  } catch (err) {
    // Common cases: extension is locked, remote signer is offline, user
    // dismissed an approval prompt. We log and let the request go out
    // without an Authorization header so the standard 401 path surfaces a
    // clear error to the UI rather than a silent stall.
    console.warn("Failed to produce signed auth header:", err);
    return null;
  }

  const json = JSON.stringify(signed);
  const base64 = base64FromBytes(bytesFromUtf8(json));
  return `Nostr ${base64}`;
};

/**
 * Wire the identity-aware auth provider into the shared API client.
 *
 * Call this once at app boot (before the first API call). Idempotent — safe
 * to call again, replaces the previous provider in place.
 */
export function installApiAuth(): void {
  setAuthHeaderProvider(provider);
}
