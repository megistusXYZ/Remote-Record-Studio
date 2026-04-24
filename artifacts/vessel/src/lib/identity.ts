import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nip19 } from "nostr-tools";
import {
  ExtensionSigner,
  ExtensionMissingError,
  NostrConnectSigner,
  PrivateKeySigner,
  type ISigner,
} from "applesauce-signers";
import { parseBunkerURI } from "applesauce-signers/helpers/nostr-connect";
import { ensureNostrConnectWired } from "./relay-pool";

/** Public alias so other modules don't have to depend on applesauce types directly. */
export type Signer = ISigner;

export type SignerType = "local" | "extension" | "remote";

export interface VesselIdentity {
  displayName: string;
  avatarColor: string;
  isGuest: boolean;
  email?: string;
  /** Which kind of signer is backing this identity. */
  signerType: SignerType;
  /** Cached public key. Populated at sign-in / restore time. */
  _pubkey: string;
  /** Only present when signerType === "local" — needed for backup-key export. */
  _secretKey?: Uint8Array;
  /** Canonical signer for all event signing. Always present. */
  _signer: Signer;
  /** Reconnect metadata for remote signers. Only present when signerType === "remote". */
  _remoteMeta?: RemoteSignerMeta;
}

export interface RemoteSignerMeta {
  /** Original connection URI (`bunker://` or `nostrconnect://`). */
  bunkerUri: string;
  /** Relays the remote signer listens on. */
  relays: string[];
  /** Pubkey of the remote signer app, learned during the handshake. */
  remotePubkey: string;
  /** Hex-encoded secret key for our local NIP-46 client. */
  clientSecretKeyHex: string;
}

const STORAGE_KEY_V3 = "vessel_identity_v3";
const STORAGE_KEY_LEGACY = "vessel_identity_v2";
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

function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, "0");
  }
  return s;
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
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

interface EncryptedBlob {
  iv: string;
  salt: string;
  ciphertext: string;
}

async function encryptBytes(
  data: Uint8Array,
  passphraseSeed: string,
): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const passphrase = passphraseSeed + "::" + getDeviceFingerprint();
  const key = await deriveKey(passphrase, salt);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    data as BufferSource,
  );
  return {
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
    ciphertext: bytesToBase64(new Uint8Array(ct)),
  };
}

async function decryptBytes(blob: EncryptedBlob, passphraseSeed: string): Promise<Uint8Array> {
  const iv = base64ToBytes(blob.iv);
  const salt = base64ToBytes(blob.salt);
  const ciphertext = base64ToBytes(blob.ciphertext);
  const passphrase = passphraseSeed + "::" + getDeviceFingerprint();
  const key = await deriveKey(passphrase, salt);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ciphertext as BufferSource,
  );
  return new Uint8Array(pt);
}

interface StoredLocalV3 {
  v: 3;
  signerType: "local";
  displayName: string;
  email?: string;
  encrypted: EncryptedBlob; // encrypts the secretKey bytes
}

interface StoredExtensionV3 {
  v: 3;
  signerType: "extension";
  displayName: string;
  pubkey: string;
}

interface StoredRemoteV3 {
  v: 3;
  signerType: "remote";
  displayName: string;
  pubkey: string;
  // NOTE: we deliberately DO NOT persist the original `bunker://` /
  // `nostrconnect://` URI — it can carry the pairing `secret=` token and is
  // unnecessary for reconnect. Restore reconstructs the signer from
  // `relays` + `remotePubkey` + the encrypted `clientSecret` below.
  relays: string[];
  remotePubkey: string;
  clientSecret: EncryptedBlob; // encrypts the local NIP-46 client secret key bytes
}

type StoredV3 = StoredLocalV3 | StoredExtensionV3 | StoredRemoteV3;

interface StoredV2Legacy {
  iv: string;
  salt: string;
  ciphertext: string;
  displayName: string;
  email?: string;
}

function buildLocalIdentity(
  displayName: string,
  secretKey: Uint8Array,
  email: string | undefined,
  isGuest: boolean,
): VesselIdentity {
  const pubkey = getPublicKey(secretKey);
  return {
    displayName,
    avatarColor: deriveAvatarColor(pubkey),
    isGuest,
    email,
    signerType: "local",
    _pubkey: pubkey,
    _secretKey: secretKey,
    _signer: new PrivateKeySigner(secretKey),
  };
}

function buildExtensionIdentity(
  displayName: string,
  pubkey: string,
  signer: ExtensionSigner,
): VesselIdentity {
  return {
    displayName,
    avatarColor: deriveAvatarColor(pubkey),
    isGuest: false,
    signerType: "extension",
    _pubkey: pubkey,
    _signer: signer,
  };
}

function buildRemoteIdentity(
  displayName: string,
  pubkey: string,
  signer: NostrConnectSigner,
  meta: RemoteSignerMeta,
): VesselIdentity {
  return {
    displayName,
    avatarColor: deriveAvatarColor(pubkey),
    isGuest: false,
    signerType: "remote",
    _pubkey: pubkey,
    _signer: signer,
    _remoteMeta: meta,
  };
}

function persist(stored: StoredV3, isGuest: boolean): void {
  // Always clear the opposite slot first so a guest→creator (or vice-versa)
  // transition can't leave a stale identity blob in the other storage layer.
  if (isGuest) localStorage.removeItem(STORAGE_KEY_V3);
  else sessionStorage.removeItem(STORAGE_KEY_V3);
  const json = JSON.stringify(stored);
  if (isGuest) sessionStorage.setItem(STORAGE_KEY_V3, json);
  else localStorage.setItem(STORAGE_KEY_V3, json);
}

export async function createNewIdentity(
  displayName: string,
  email?: string,
): Promise<VesselIdentity> {
  const secretKey = generateSecretKey();
  const identity = buildLocalIdentity(displayName, secretKey, email, false);
  const encrypted = await encryptBytes(secretKey, displayName);
  persist({ v: 3, signerType: "local", displayName, email, encrypted }, false);
  return identity;
}

export async function createGuestIdentity(displayName: string): Promise<VesselIdentity> {
  const secretKey = generateSecretKey();
  const identity = buildLocalIdentity(displayName, secretKey, undefined, true);
  const encrypted = await encryptBytes(secretKey, displayName);
  persist({ v: 3, signerType: "local", displayName, encrypted }, true);
  return identity;
}

export async function importIdentityFromBackup(
  nsec: string,
  displayName: string,
): Promise<VesselIdentity> {
  const decoded = nip19.decode(nsec.trim());
  if (decoded.type !== "nsec") {
    throw new Error("That backup key doesn't look right. Make sure it starts with nsec1.");
  }
  const secretKey = decoded.data as Uint8Array;
  const identity = buildLocalIdentity(displayName, secretKey, undefined, false);
  const encrypted = await encryptBytes(secretKey, displayName);
  persist({ v: 3, signerType: "local", displayName, encrypted }, false);
  return identity;
}

/** NIP-07 ambient declaration: a Nostr signer extension exposes a small RPC
 * surface on the window object. We only need to detect presence here; the
 * actual calls go through `applesauce-signers/ExtensionSigner`. */
declare global {
  interface Window {
    nostr?: {
      getPublicKey(): Promise<string>;
      signEvent(event: unknown): Promise<unknown>;
    };
  }
}

export function isNostrExtensionAvailable(): boolean {
  return typeof window !== "undefined" && !!window.nostr;
}

export async function signInWithExtension(displayName: string): Promise<VesselIdentity> {
  if (!isNostrExtensionAvailable()) {
    throw new ExtensionMissingError(
      "No Nostr browser extension detected. Install one (Alby, nos2x, etc.) and reload.",
    );
  }
  const signer = new ExtensionSigner();
  const pubkey = await signer.getPublicKey();
  const identity = buildExtensionIdentity(displayName, pubkey, signer);
  persist({ v: 3, signerType: "extension", displayName, pubkey }, false);
  return identity;
}

const REMOTE_PERMISSIONS = [
  "get_public_key",
  "sign_event",
  "nip04_encrypt",
  "nip04_decrypt",
  "nip44_encrypt",
  "nip44_decrypt",
];

/** Validates that the user-pasted string is a connection URL we can act on.
 * Only `bunker://` URIs are paste-able — a `nostrconnect://` URI is generated
 * BY the client and given to the signer, so it carries our client privkey
 * implicitly. For that flow, see {@link startNostrConnectInvite}. */
export function isSupportedRemoteSignerUri(uri: string): boolean {
  return uri.trim().startsWith("bunker://");
}

/** Default relays used when we generate a `nostrconnect://` invite for the
 * signer. We use the shared NIP-46 pool. */
const DEFAULT_NOSTRCONNECT_RELAYS = [
  "wss://relay.nsec.app",
  "wss://relay.damus.io",
];

/**
 * Sign in via NIP-46 using a pasted `bunker://` URI. The signer initiates the
 * session, so the URI fully describes how to find it (remote pubkey + relays
 * + optional pairing secret).
 */
export async function signInWithRemoteSigner(
  rawUri: string,
  displayName: string,
): Promise<VesselIdentity> {
  ensureNostrConnectWired();
  const uri = rawUri.trim();
  if (!uri.startsWith("bunker://")) {
    throw new Error(
      "That doesn't look like a valid connection URL. Paste one that starts with 'bunker://'.",
    );
  }
  return signInWithBunkerUri(uri, displayName);
}

async function signInWithBunkerUri(
  uri: string,
  displayName: string,
): Promise<VesselIdentity> {
  let parsed;
  try {
    parsed = parseBunkerURI(uri);
  } catch {
    throw new Error("This bunker:// URL is malformed. Try copying it again.");
  }
  if (!parsed.relays || parsed.relays.length === 0) {
    throw new Error("This connection URL is missing a relay. Ask your signer for a complete URL.");
  }

  const clientSecretKey = generateSecretKey();
  const clientSigner = new PrivateKeySigner(clientSecretKey);

  const signer = new NostrConnectSigner({
    relays: parsed.relays,
    remote: parsed.remote,
    signer: clientSigner,
  });

  // Signer-initiated handshake — we know the remote pubkey from the URI.
  await signer.connect(parsed.secret, REMOTE_PERMISSIONS);
  const pubkey = await signer.getPublicKey();

  const meta: RemoteSignerMeta = {
    bunkerUri: uri,
    relays: parsed.relays,
    remotePubkey: parsed.remote,
    clientSecretKeyHex: bytesToHex(clientSecretKey),
  };
  return finalizeRemoteSignIn(displayName, pubkey, signer, meta, clientSecretKey);
}

/**
 * Handle for an in-progress client-initiated NIP-46 handshake.
 *
 * `uri` is the `nostrconnect://` URL the user pastes/scans into their signer.
 * `awaitConnection()` resolves once the signer responds (the user approved on
 * the signer side). `cancel()` closes the relay subscription.
 *
 * Per NIP-46: the URI's `client` pubkey is OUR pubkey, and we hold the matching
 * private key locally. That's what makes a paste-back of a foreign
 * `nostrconnect://` URI semantically wrong — only the original generator can
 * complete the handshake. We always generate fresh.
 */
export interface NostrConnectInvite {
  uri: string;
  awaitConnection(displayName: string, signal?: AbortSignal): Promise<VesselIdentity>;
  cancel(): Promise<void>;
}

export function startNostrConnectInvite(
  relays: string[] = DEFAULT_NOSTRCONNECT_RELAYS,
): NostrConnectInvite {
  ensureNostrConnectWired();
  const clientSecretKey = generateSecretKey();
  const clientSigner = new PrivateKeySigner(clientSecretKey);
  const signer = new NostrConnectSigner({
    relays,
    signer: clientSigner,
  });
  const uri = signer.getNostrConnectURI({
    name: "Vessel",
    permissions: REMOTE_PERMISSIONS,
  });

  let opened = false;

  return {
    uri,
    async awaitConnection(displayName, signal) {
      if (!opened) {
        await signer.open();
        opened = true;
      }
      await signer.waitForSigner(signal);
      const pubkey = await signer.getPublicKey();
      // After waitForSigner resolves the handshake, NostrConnectSigner
      // populates its public `remote` field with the signer's pubkey.
      const remotePubkey = signer.remote ?? pubkey;
      const meta: RemoteSignerMeta = {
        bunkerUri: uri,
        relays,
        remotePubkey,
        clientSecretKeyHex: bytesToHex(clientSecretKey),
      };
      return finalizeRemoteSignIn(displayName, pubkey, signer, meta, clientSecretKey);
    },
    async cancel() {
      if (opened) {
        try {
          await signer.close();
        } catch (err) {
          console.warn("Failed to close nostrconnect invite:", err);
        }
      }
    },
  };
}

async function finalizeRemoteSignIn(
  displayName: string,
  pubkey: string,
  signer: NostrConnectSigner,
  meta: RemoteSignerMeta,
  clientSecretKey: Uint8Array,
): Promise<VesselIdentity> {
  const identity = buildRemoteIdentity(displayName, pubkey, signer, meta);
  const encryptedClientSecret = await encryptBytes(clientSecretKey, displayName);
  persist(
    {
      v: 3,
      signerType: "remote",
      displayName,
      pubkey,
      relays: meta.relays,
      remotePubkey: meta.remotePubkey,
      clientSecret: encryptedClientSecret,
    },
    false,
  );
  return identity;
}

export async function loadSavedIdentity(): Promise<VesselIdentity | null> {
  const v3Local = localStorage.getItem(STORAGE_KEY_V3);
  const v3Session = sessionStorage.getItem(STORAGE_KEY_V3);
  const stored = v3Local ?? v3Session;
  const isGuest = !v3Local && !!v3Session;

  if (stored) {
    try {
      const parsed = JSON.parse(stored) as StoredV3;
      return await restoreV3(parsed, isGuest);
    } catch (err) {
      console.error("Failed to restore identity:", err);
      return null;
    }
  }

  // Fall back to legacy v2 (always local-key)
  const legacyLocal = localStorage.getItem(STORAGE_KEY_LEGACY);
  const legacySession = sessionStorage.getItem(STORAGE_KEY_LEGACY);
  const legacy = legacyLocal ?? legacySession;
  if (!legacy) return null;
  try {
    const blob = JSON.parse(legacy) as StoredV2Legacy;
    const secretKey = await decryptBytes(
      { iv: blob.iv, salt: blob.salt, ciphertext: blob.ciphertext },
      blob.displayName,
    );
    const identity = buildLocalIdentity(
      blob.displayName,
      secretKey,
      blob.email,
      !legacyLocal && !!legacySession,
    );
    // Migrate forward — write v3 and remove v2.
    const encrypted = await encryptBytes(secretKey, blob.displayName);
    persist(
      { v: 3, signerType: "local", displayName: blob.displayName, email: blob.email, encrypted },
      identity.isGuest,
    );
    localStorage.removeItem(STORAGE_KEY_LEGACY);
    sessionStorage.removeItem(STORAGE_KEY_LEGACY);
    return identity;
  } catch {
    return null;
  }
}

async function restoreV3(stored: StoredV3, isGuest: boolean): Promise<VesselIdentity | null> {
  if (stored.signerType === "local") {
    const secretKey = await decryptBytes(stored.encrypted, stored.displayName);
    return buildLocalIdentity(stored.displayName, secretKey, stored.email, isGuest);
  }
  if (stored.signerType === "extension") {
    if (!isNostrExtensionAvailable()) {
      // Extension was uninstalled — clear stored state so we don't repeatedly
      // warn / fail-restore on every reload. User will re-sign in fresh.
      console.warn("Saved Nostr extension identity but no extension is installed.");
      clearStoredIdentity();
      return null;
    }
    const signer = new ExtensionSigner();
    // Verify the extension is still serving the same account it was when this
    // identity was first stored. If the user switched accounts inside their
    // extension, the stored pubkey is stale and we must force a fresh sign-in
    // rather than silently signing under a different identity.
    let livePubkey: string;
    try {
      livePubkey = await signer.getPublicKey();
    } catch (err) {
      console.warn("Couldn't read extension public key on restore:", err);
      clearStoredIdentity();
      return null;
    }
    if (livePubkey !== stored.pubkey) {
      console.warn(
        "Extension account changed since last sign-in (stored vs current pubkey differ); discarding stored identity.",
      );
      clearStoredIdentity();
      return null;
    }
    return buildExtensionIdentity(stored.displayName, stored.pubkey, signer);
  }
  if (stored.signerType === "remote") {
    ensureNostrConnectWired();
    const clientSecretKey = await decryptBytes(stored.clientSecret, stored.displayName);
    const clientSigner = new PrivateKeySigner(clientSecretKey);
    const signer = new NostrConnectSigner({
      relays: stored.relays,
      remote: stored.remotePubkey,
      signer: clientSigner,
      pubkey: stored.pubkey,
    });
    // Proactively re-open the relay subscription so signing requests land on
    // an already-listening transport instead of waiting for the first lazy
    // requireConnection() call. Failures here are non-fatal — the signer will
    // attempt to reconnect on first use and surface a clearer error there.
    try {
      await signer.open();
    } catch (err) {
      console.warn("Failed to re-open remote signer transport on restore:", err);
    }
    const meta: RemoteSignerMeta = {
      // Empty: original pairing URI is intentionally not persisted (see
      // StoredRemoteV3 note). After restore we don't need it anywhere.
      bunkerUri: "",
      relays: stored.relays,
      remotePubkey: stored.remotePubkey,
      clientSecretKeyHex: bytesToHex(clientSecretKey),
    };
    return buildRemoteIdentity(stored.displayName, stored.pubkey, signer, meta);
  }
  return null;
}

export function exportIdentityBackup(identity: VesselIdentity): string {
  if (identity.signerType !== "local" || !identity._secretKey) {
    throw new Error(
      "Backup keys are only available for studios secured by a local key. " +
        "When you sign in with a Nostr extension or remote signer, your key stays in that app.",
    );
  }
  return nip19.nsecEncode(identity._secretKey);
}

export function clearStoredIdentity(): void {
  localStorage.removeItem(STORAGE_KEY_V3);
  sessionStorage.removeItem(STORAGE_KEY_V3);
  localStorage.removeItem(STORAGE_KEY_LEGACY);
  sessionStorage.removeItem(STORAGE_KEY_LEGACY);
}

/**
 * Tear down any open transports / subscriptions held by an identity's signer.
 * Safe to call multiple times and on signers that don't need teardown.
 *
 * Specifically: a remote (NIP-46) signer keeps an open relay subscription so it
 * can receive responses from the bunker. We must close that before clearing
 * the identity, otherwise the subscription stays open until page reload.
 */
export async function tearDownSigner(identity: VesselIdentity | null): Promise<void> {
  if (!identity) return;
  if (identity.signerType !== "remote") return;
  const signer = identity._signer as NostrConnectSigner;
  if (typeof signer.close === "function") {
    try {
      await signer.close();
    } catch (err) {
      console.warn("Failed to close remote signer cleanly:", err);
    }
  }
}

/**
 * Update stored displayName for the current identity.
 *
 * The encryption envelope around any persisted secret material uses the
 * displayName as part of the passphrase seed (see {@link encryptBytes}), so a
 * rename must re-encrypt those blobs in the same atomic write — otherwise the
 * next reload tries to decrypt with the new name and fails.
 */
export async function persistDisplayNameChange(identity: VesselIdentity): Promise<void> {
  const v3 = localStorage.getItem(STORAGE_KEY_V3) ?? sessionStorage.getItem(STORAGE_KEY_V3);
  if (!v3) return;
  try {
    const parsed = JSON.parse(v3) as StoredV3;
    const newName = identity.displayName;

    if (parsed.signerType === "local") {
      if (!identity._secretKey) return;
      const reEncrypted = await encryptBytes(identity._secretKey, newName);
      persist(
        { ...parsed, displayName: newName, encrypted: reEncrypted },
        identity.isGuest,
      );
      return;
    }

    if (parsed.signerType === "remote") {
      if (!identity._remoteMeta) return;
      const clientSecretKey = hexToBytes(identity._remoteMeta.clientSecretKeyHex);
      const reEncrypted = await encryptBytes(clientSecretKey, newName);
      persist(
        { ...parsed, displayName: newName, clientSecret: reEncrypted },
        identity.isGuest,
      );
      return;
    }

    // Extension identities have no encrypted blob — just update the name.
    persist({ ...parsed, displayName: newName }, identity.isGuest);
  } catch (err) {
    console.error("Failed to persist display name change:", err);
  }
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

export function describeSignerType(type: SignerType): string {
  switch (type) {
    case "local":
      return "Local studio key";
    case "extension":
      return "Browser extension";
    case "remote":
      return "Remote signer";
  }
}

