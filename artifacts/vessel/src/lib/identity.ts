import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nip19 } from "nostr-tools";

export interface VesselIdentity {
  displayName: string;
  avatarColor: string;
  isGuest: boolean;
  email?: string;
  _pubkey: string;
  _secretKey: Uint8Array;
  _signer: unknown;
}

const STORAGE_KEY = "vessel_identity_v2";
const PBKDF2_ITERATIONS = 100_000;

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function getDeviceFingerprint(): string {
  return [
    navigator.userAgent,
    `${screen.width}x${screen.height}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.language,
  ].join("|");
}

function deriveAvatarColor(pubkey: string): string {
  const hue = parseInt(pubkey.slice(0, 4), 16) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

interface EncryptedBlob {
  iv: string;
  salt: string;
  ciphertext: string;
  displayName: string;
  email?: string;
}

async function encryptSecret(
  secretKey: Uint8Array,
  displayName: string,
  email: string | undefined
): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const passphrase = displayName + "::" + getDeviceFingerprint();
  const key = await deriveKey(passphrase, salt);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    secretKey as BufferSource
  );
  return {
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
    ciphertext: bytesToBase64(new Uint8Array(ct)),
    displayName,
    email,
  };
}

async function decryptSecret(blob: EncryptedBlob): Promise<Uint8Array> {
  const iv = base64ToBytes(blob.iv);
  const salt = base64ToBytes(blob.salt);
  const ciphertext = base64ToBytes(blob.ciphertext);
  const passphrase = blob.displayName + "::" + getDeviceFingerprint();
  const key = await deriveKey(passphrase, salt);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ciphertext as BufferSource
  );
  return new Uint8Array(pt);
}

async function tryCreateSigner(secretKey: Uint8Array): Promise<unknown> {
  try {
    const mod = (await import("applesauce-signers")) as unknown as {
      SimpleSigner?: new (sk: Uint8Array) => unknown;
    };
    if (mod.SimpleSigner) return new mod.SimpleSigner(secretKey);
  } catch {
    // Signer is optional for Module 1 — relays come in Module 2
  }
  return null;
}

function buildIdentity(
  displayName: string,
  secretKey: Uint8Array,
  email: string | undefined,
  isGuest: boolean,
  signer: unknown
): VesselIdentity {
  const pubkey = getPublicKey(secretKey);
  return {
    displayName,
    avatarColor: deriveAvatarColor(pubkey),
    isGuest,
    email,
    _pubkey: pubkey,
    _secretKey: secretKey,
    _signer: signer,
  };
}

export async function createNewIdentity(
  displayName: string,
  email?: string
): Promise<VesselIdentity> {
  const secretKey = generateSecretKey();
  const signer = await tryCreateSigner(secretKey);
  const identity = buildIdentity(displayName, secretKey, email, false, signer);
  const blob = await encryptSecret(secretKey, displayName, email);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  // Kind 0 (profile) publishing happens in Module 2 once relays are wired up.
  return identity;
}

export async function createGuestIdentity(displayName: string): Promise<VesselIdentity> {
  const secretKey = generateSecretKey();
  const signer = await tryCreateSigner(secretKey);
  const identity = buildIdentity(displayName, secretKey, undefined, true, signer);
  const blob = await encryptSecret(secretKey, displayName, undefined);
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  return identity;
}

export async function loadSavedIdentity(): Promise<VesselIdentity | null> {
  const stored = localStorage.getItem(STORAGE_KEY) ?? sessionStorage.getItem(STORAGE_KEY);
  if (!stored) return null;
  try {
    const blob = JSON.parse(stored) as EncryptedBlob;
    const secretKey = await decryptSecret(blob);
    const signer = await tryCreateSigner(secretKey);
    const isGuest = !localStorage.getItem(STORAGE_KEY);
    return buildIdentity(blob.displayName, secretKey, blob.email, isGuest, signer);
  } catch {
    return null;
  }
}

export async function importIdentityFromBackup(
  nsec: string,
  displayName: string
): Promise<VesselIdentity> {
  const decoded = nip19.decode(nsec.trim());
  if (decoded.type !== "nsec") {
    throw new Error("That backup key doesn't look right. Make sure it starts with nsec1.");
  }
  const secretKey = decoded.data as Uint8Array;
  const signer = await tryCreateSigner(secretKey);
  const identity = buildIdentity(displayName, secretKey, undefined, false, signer);
  const blob = await encryptSecret(secretKey, displayName, undefined);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  return identity;
}

export function exportIdentityBackup(identity: VesselIdentity): string {
  return nip19.nsecEncode(identity._secretKey);
}

export function clearStoredIdentity(): void {
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
}

export function deriveAvatarColorFromPubkey(pubkey: string): string {
  return deriveAvatarColor(pubkey);
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
