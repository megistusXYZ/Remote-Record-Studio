/**
 * Personal receipt registry.
 *
 * When a participant ends a call we automatically publish a single-track
 * "personal archive" (see `publishPersonalArchive` in `session-archive.ts`)
 * and persist a small receipt record locally. The receipt is what powers the
 * `/r/:pointer` page — even if the manifest is later revoked, the receipt
 * record lets us render a meaningful "this archive was taken down by you on
 * <date>" view rather than a generic error.
 *
 * Storage is intentionally browser-local. The receipt is only ever visible to
 * the participant whose device created it, which mirrors the rest of the
 * federated ownership model: nothing about your participation lives on a
 * server you don't control.
 */

const STORAGE_KEY = "vessel_personal_receipts_v1";
const MAX_STORED = 100;

export type PersonalReceiptRecord = {
  /** Same fingerprint as `share-revoke` material — stable join key. */
  archiveId: string;
  /** Opaque pointer used in `/r/<pointer>` and `/s/<pointer>` URLs. */
  pointer: string;
  /** Friendly session title (decrypted manifest also has this). */
  sessionTitle: string;
  /** True iff this device was the host of the call. */
  isHost: boolean;
  /** Display name of the host (for guest receipts: "you talked to <hostName>"). */
  hostName: string;
  /** Other participants on the call (best-effort, for the receipt summary). */
  otherParticipantNames: string[];
  /** Receipt URL — what we showed the user at session end. Stored so
   *  we can re-display it from /home or /vault later. */
  receiptUrl: string;
  /** Canonical share URL (recipient page). Useful if the user wants to
   *  share their personal track with someone else later. */
  shareUrl: string;
  /** ISO timestamp the personal archive was published. */
  publishedAt: string;
  /** Pubkey of the local participant that owns this receipt. Lets us scope
   *  receipts to the currently-signed-in identity when listing them. */
  ownerPubkey: string;
};

function readAll(): PersonalReceiptRecord[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as PersonalReceiptRecord[];
  } catch {
    return [];
  }
}

function writeAll(records: PersonalReceiptRecord[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Quota errors are non-fatal — the receipt just won't be re-findable from
    // /home later. The user already saw the URL at session end.
  }
}

export function rememberPersonalReceipt(record: PersonalReceiptRecord): void {
  const all = readAll();
  // De-dupe by archiveId so re-publishing replaces the prior entry.
  const next = all.filter((r) => r.archiveId !== record.archiveId);
  next.push(record);
  while (next.length > MAX_STORED) next.shift();
  writeAll(next);
}

/** Look up a stored receipt by its opaque pointer (URL path segment). */
export function getReceiptByPointer(pointer: string): PersonalReceiptRecord | null {
  return readAll().find((r) => r.pointer === pointer) ?? null;
}

export function getReceiptByArchiveId(archiveId: string): PersonalReceiptRecord | null {
  return readAll().find((r) => r.archiveId === archiveId) ?? null;
}

/** All receipts owned by the currently-signed-in participant, newest first. */
export function listReceiptsForOwner(ownerPubkey: string | null): PersonalReceiptRecord[] {
  if (!ownerPubkey) return [];
  return readAll()
    .filter((r) => r.ownerPubkey === ownerPubkey)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
