import { useEffect, useCallback } from "react";
import { useCreateIdentity } from "@workspace/api-client-react";
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
  const createIdentityMutation = useCreateIdentity();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const persistOnServer = useCallback(
    async (id: VesselIdentity) => {
      if (id.isGuest) return;
      try {
        await createIdentityMutation.mutateAsync({
          data: { pubkey: id._pubkey, displayName: id.displayName },
        });
      } catch (err) {
        console.error("Failed to register identity with server:", err);
      }
    },
    [createIdentityMutation]
  );

  const createNewIdentity = useCallback(
    async (displayName: string, email?: string) => {
      const id = await createNewIdentityLib(displayName, email);
      setIdentity(id);
      await persistOnServer(id);
      return id;
    },
    [setIdentity, persistOnServer]
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
      await persistOnServer(id);
      return id;
    },
    [setIdentity, persistOnServer]
  );

  const signInWithExtension = useCallback(
    async (displayName: string) => {
      const id = await signInWithExtensionLib(displayName);
      setIdentity(id);
      await persistOnServer(id);
      return id;
    },
    [setIdentity, persistOnServer]
  );

  const signInWithRemoteSigner = useCallback(
    async (bunkerUri: string, displayName: string) => {
      const id = await signInWithRemoteSignerLib(bunkerUri, displayName);
      setIdentity(id);
      await persistOnServer(id);
      return id;
    },
    [setIdentity, persistOnServer]
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
      await persistOnServer(updated);
    },
    [identity, createNewIdentity, setIdentity, persistOnServer]
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
    isNostrExtensionAvailable,
    signOut,
  };
}
