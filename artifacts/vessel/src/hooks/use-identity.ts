import { useEffect, useCallback, useRef } from "react";
import { useIdentityStore } from "../store/identityStore";
import {
  createNewIdentity as createNewIdentityLib,
  createGuestIdentity as createGuestIdentityLib,
  importIdentityFromBackup as importIdentityFromBackupLib,
  signInWithExtension as signInWithExtensionLib,
  signInWithRemoteSigner as signInWithRemoteSignerLib,
  isNostrExtensionAvailable,
  persistDisplayNameChange,
  tearDownSigner,
  type VesselIdentity,
} from "../lib/identity";
import { applyRemoteStorageChoiceIfMissing } from "../lib/storage-config";

export {
  startNostrConnectInvite,
  type NostrConnectInvite,
} from "../lib/identity";

export type { VesselIdentity };

export type Identity = {
  pubkey: string;
  displayName: string;
};

export function useIdentity() {
  const identity = useIdentityStore((s) => s.identity);
  const isLoaded = useIdentityStore((s) => s.isLoaded);
  const setIdentity = useIdentityStore((s) => s.setIdentity);
  const clearIdentity = useIdentityStore((s) => s.clearIdentity);
  const hydrate = useIdentityStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Once identity is loaded (either from sign-in or restored from local
  // storage), best-effort fetch any published storage server list and apply
  // it iff this device has no local choice yet. Local choice always wins —
  // never silently overwritten. Runs at most once per pubkey per session.
  const remoteStorageAppliedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!identity || identity.isGuest) return;
    const pk = identity._pubkey;
    if (remoteStorageAppliedRef.current.has(pk)) return;
    remoteStorageAppliedRef.current.add(pk);
    void applyRemoteStorageChoiceIfMissing(pk).catch(() => {
      // Best-effort only; never block the UI on relay availability.
    });
  }, [identity]);

  const createNewIdentity = useCallback(
    async (displayName: string) => {
      const id = await createNewIdentityLib(displayName);
      setIdentity(id);
      return id;
    },
    [setIdentity]
  );

  const createGuestIdentity = useCallback(
    async (displayName: string) => {
      const id = await createGuestIdentityLib(displayName);
      setIdentity(id);
      return id;
    },
    [setIdentity]
  );

  const importFromBackup = useCallback(
    async (nsec: string, displayName: string) => {
      const id = await importIdentityFromBackupLib(nsec, displayName);
      setIdentity(id);
      return id;
    },
    [setIdentity]
  );

  const signInWithExtension = useCallback(
    async (displayName: string) => {
      const id = await signInWithExtensionLib(displayName);
      setIdentity(id);
      return id;
    },
    [setIdentity]
  );

  const signInWithRemoteSigner = useCallback(
    async (bunkerUri: string, displayName: string) => {
      const id = await signInWithRemoteSignerLib(bunkerUri, displayName);
      setIdentity(id);
      return id;
    },
    [setIdentity]
  );

  /**
   * Adopt an identity that the caller has already constructed (e.g. via
   * `startNostrConnectInvite()` → `awaitConnection()`). Stores the identity
   * in the Zustand store. Vessel does not register identities with any
   * backend — there's no central account directory by design.
   */
  const adoptIdentity = useCallback(
    async (id: VesselIdentity) => {
      setIdentity(id);
      return id;
    },
    [setIdentity]
  );

  const setDisplayName = useCallback(
    async (name: string) => {
      if (!identity) {
        await createNewIdentity(name);
        return;
      }
      const updated: VesselIdentity = { ...identity, displayName: name };
      setIdentity(updated);
      await persistDisplayNameChange(updated);
    },
    [identity, createNewIdentity, setIdentity]
  );

  const signOut = useCallback(async () => {
    // Close any active signer transports (e.g. NIP-46 relay subscription)
    // before clearing identity. Local recordings stored elsewhere are untouched.
    await tearDownSigner(identity ?? null);
    clearIdentity();
  }, [identity, clearIdentity]);

  return {
    identity,
    pubkey: identity?._pubkey,
    displayName: identity?.displayName,
    avatarColor: identity?.avatarColor,
    isGuest: identity?.isGuest ?? false,
    signerType: identity?.signerType,
    isLoaded,
    setDisplayName,
    createNewIdentity,
    createGuestIdentity,
    importFromBackup,
    signInWithExtension,
    signInWithRemoteSigner,
    adoptIdentity,
    isNostrExtensionAvailable,
    signOut,
  };
}
