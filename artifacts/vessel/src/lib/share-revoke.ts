import type { Event } from "nostr-tools/pure";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { getRelayPool } from "./relay-pool";

/**
 * Share-link revocation.
 *
 * When a host publishes a session archive (see `session-archive.ts`) we now
 * also persist the per-archive ephemeral signing key locally, keyed by the
 * archive's user-facing fingerprint. That lets the host later sign a NIP-09
 * kind-5 deletion event for the manifest event id from the SAME ephemeral
 * pubkey — which is what relays require to honor a deletion. The recipient
 * page (`share-resolver.ts`) also looks for this kind-5 event regardless of
 * whether any individual relay actually drops the manifest, so a revoke is
 * effective from Vessel's perspective even on relays that ignore deletions.
 *
 * The persisted material is intentionally browser-local: only the device that
 * created the share can take it down later, which matches the user's mental
 * model ("my browser made this link, my browser can revoke it").
 */

export const KIND_DELETION = 5;
export const STORAGE_KEY = "vessel_share_revoke_v1";

const PUBLISH_TIMEOUT_MS = 8000;
const PUBLISH_MAX_ATTEMPTS = 3;
const PUBLISH_RETRY_DELAY_MS = 800;

/** Per-archive material we need to mint a valid deletion event later. */
export type StoredRevokeMaterial = {
  /** The user-facing fingerprint shown in the share modal. */
  archiveId: string;
  /** Opaque pointer that lives in `/s/<pointer>` URLs. */
  pointer: string;
  /** Hex event id of the encrypted manifest event. */
  manifestEventId: string;
  /** Hex pubkey of the ephemeral signing key (must match deletion event author). */
  ephemeralPubkey: string;
  /** Base64 of the 32-byte ephemeral secret key. */
  ephemeralSecretB64: string;
  /** `d`-tag of the parameterized replaceable manifest event. */
  identifier: string;
  /** Manifest event kind (e.g. 30563), needed for the NIP-33 `a` tag. */
  kind: number;
  /** Relays to broadcast the deletion to. */
  relays: string[];
  /** ISO timestamp the share was published. */
  publishedAt: string;
  /** ISO timestamp the share was revoked, if applicable. */
  revokedAt?: string;
};

export class ShareRevokeError extends Error {
  constructor(
    public code: "no_material" | "publish_failed" | "already_revoked",
    message: string,
  ) {
    super(message);
    this.name = "ShareRevokeError";
  }
}

export type ShareRevokeRelayStatus = {
  url: string;
  ok: boolean;
  message?: string;
};

export type ShareRevokeResult = {
  archiveId: string;
  deletionEventId: string;
  publish: {
    successCount: number;
    totalCount: number;
    relays: ShareRevokeRelayStatus[];
  };
};

// ---------- localStorage helpers ----------

const MAX_STORED = 50;

function readAll(): StoredRevokeMaterial[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as StoredRevokeMaterial[];
  } catch {
    return [];
  }
}

function writeAll(items: StoredRevokeMaterial[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Quota errors etc. are non-fatal — revoke just won't be available later.
  }
}

/** Encode a 32-byte ephemeral secret for storage. */
export function encodeEphemeralSecret(secret: Uint8Array): string {
  let s = "";
  for (let i = 0; i < secret.length; i++) s += String.fromCharCode(secret[i]);
  return btoa(s);
}

function decodeEphemeralSecret(b64: string): Uint8Array {
  const t = atob(b64);
  const out = new Uint8Array(t.length);
  for (let i = 0; i < t.length; i++) out[i] = t.charCodeAt(i);
  return out;
}

/**
 * Save material so we can later sign a deletion event from the same author.
 * Replaces any prior entry with the same archiveId. Caps the table at
 * {@link MAX_STORED} to avoid unbounded growth across many sessions.
 */
export function rememberShareForRevoke(
  material: Omit<StoredRevokeMaterial, "publishedAt"> & { publishedAt?: string },
): void {
  const all = readAll();
  const next = all.filter((m) => m.archiveId !== material.archiveId);
  next.push({
    ...material,
    publishedAt: material.publishedAt ?? new Date().toISOString(),
  });
  while (next.length > MAX_STORED) next.shift();
  writeAll(next);
}

export function getRevokeMaterial(archiveId: string): StoredRevokeMaterial | null {
  return readAll().find((m) => m.archiveId === archiveId) ?? null;
}

export function isLocallyRevoked(archiveId: string): boolean {
  const m = getRevokeMaterial(archiveId);
  return !!m?.revokedAt;
}

function markRevokedLocally(archiveId: string): void {
  const all = readAll();
  const idx = all.findIndex((m) => m.archiveId === archiveId);
  if (idx === -1) return;
  all[idx] = { ...all[idx], revokedAt: new Date().toISOString() };
  writeAll(all);
}

// ---------- publish ----------

async function publishWithRetry(
  relays: string[],
  event: Event,
): Promise<ShareRevokeRelayStatus[]> {
  // Mirrors session-archive.publishWithRetry: keep best-known per-relay status
  // across attempts; a relay marked ok is dropped from later retries.
  const pool = getRelayPool();
  const statusByRelay = new Map<string, { ok: boolean; from: string; message?: string }>();
  for (const r of relays) statusByRelay.set(r, { ok: false, from: r, message: "Not yet attempted" });

  for (let attempt = 1; attempt <= PUBLISH_MAX_ATTEMPTS; attempt++) {
    const remaining = relays.filter((r) => !statusByRelay.get(r)?.ok);
    if (remaining.length === 0) break;
    let responses: Array<{ ok: boolean; message?: string; from: string }>;
    try {
      responses = (await Promise.race([
        pool.publish(remaining, event),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Publish timeout")), PUBLISH_TIMEOUT_MS),
        ),
      ])) as Array<{ ok: boolean; message?: string; from: string }>;
    } catch (err: any) {
      responses = remaining.map((r) => ({ ok: false, from: r, message: err?.message || "Publish failed" }));
    }
    for (const r of responses) {
      const prev = statusByRelay.get(r.from);
      if (!prev || (!prev.ok && r.ok)) {
        statusByRelay.set(r.from, { ok: r.ok, from: r.from, message: r.message });
      } else if (!prev.ok) {
        statusByRelay.set(r.from, { ok: false, from: r.from, message: r.message ?? prev.message });
      }
    }
    if (attempt < PUBLISH_MAX_ATTEMPTS && Array.from(statusByRelay.values()).some((s) => !s.ok)) {
      await new Promise((res) => setTimeout(res, PUBLISH_RETRY_DELAY_MS * attempt));
    }
  }

  return Array.from(statusByRelay.values()).map((s) => ({
    url: s.from,
    ok: s.ok,
    message: s.message,
  }));
}

/**
 * Publish a kind-5 deletion event for the named archive. Signed by the same
 * ephemeral key that originally signed the manifest, so relays following
 * NIP-09 will drop the manifest. We additionally consider the archive
 * "revoked" once at least one relay accepts the deletion event — the
 * recipient's resolver looks for this event explicitly and refuses to render
 * the manifest, even on relays that don't honor deletions.
 */
export async function revokeShareLink(archiveId: string): Promise<ShareRevokeResult> {
  const material = getRevokeMaterial(archiveId);
  if (!material) {
    throw new ShareRevokeError(
      "no_material",
      "We can't take this link down — only the device that created the link can revoke it.",
    );
  }
  if (material.revokedAt) {
    throw new ShareRevokeError(
      "already_revoked",
      "This link has already been revoked.",
    );
  }
  const ephemeralSecret = decodeEphemeralSecret(material.ephemeralSecretB64);
  // Defensive: if anything mangled the stored secret, signing under a wrong
  // key would silently produce a deletion no relay honors. Verify the derived
  // pubkey matches what we recorded at publish time.
  if (getPublicKey(ephemeralSecret) !== material.ephemeralPubkey) {
    throw new ShareRevokeError(
      "no_material",
      "Stored takedown credentials look corrupted.",
    );
  }

  const createdAt = Math.floor(Date.now() / 1000);
  const deletion: Event = finalizeEvent(
    {
      kind: KIND_DELETION,
      created_at: createdAt,
      tags: [
        // Both `e` (manifest event id) and `a` (NIP-33 address) so relays
        // and resolvers using either convention can match.
        ["e", material.manifestEventId],
        ["a", `${material.kind}:${material.ephemeralPubkey}:${material.identifier}`],
        ["k", String(material.kind)],
      ],
      content: "Revoked by host",
    },
    ephemeralSecret,
  );

  const results = await publishWithRetry(material.relays, deletion);
  const successCount = results.filter((r) => r.ok).length;
  if (successCount === 0) {
    throw new ShareRevokeError(
      "publish_failed",
      "We couldn't tell any sharing servers to take this link down. Try again in a moment.",
    );
  }

  markRevokedLocally(archiveId);

  return {
    archiveId,
    deletionEventId: deletion.id,
    publish: {
      successCount,
      totalCount: results.length,
      relays: results,
    },
  };
}
