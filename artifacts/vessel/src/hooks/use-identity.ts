import { useState, useEffect, useCallback } from "react";
import { useCreateIdentity } from "@workspace/api-client-react";

export type Identity = {
  pubkey: string;
  displayName: string;
};

const IDENTITY_KEY = "vessel_identity";

function generatePubkey() {
  const array = new Uint8Array(32);
  window.crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function useIdentity() {
  const [identity, setIdentityState] = useState<Identity | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const createIdentityMutation = useCreateIdentity();

  useEffect(() => {
    const stored = localStorage.getItem(IDENTITY_KEY);
    if (stored) {
      try {
        setIdentityState(JSON.parse(stored));
      } catch (e) {
        // ignore
      }
    }
    setIsLoaded(true);
  }, []);

  const setDisplayName = useCallback(async (name: string) => {
    let currentPubkey = identity?.pubkey;
    
    if (!currentPubkey) {
      currentPubkey = generatePubkey();
    }
    
    const newIdentity = { pubkey: currentPubkey, displayName: name };
    
    try {
      await createIdentityMutation.mutateAsync({
        data: {
          pubkey: currentPubkey,
          displayName: name
        }
      });
      
      localStorage.setItem(IDENTITY_KEY, JSON.stringify(newIdentity));
      setIdentityState(newIdentity);
    } catch (error) {
      console.error("Failed to save identity:", error);
      // Still save locally even if sync fails
      localStorage.setItem(IDENTITY_KEY, JSON.stringify(newIdentity));
      setIdentityState(newIdentity);
    }
  }, [identity, createIdentityMutation]);

  return {
    pubkey: identity?.pubkey,
    displayName: identity?.displayName,
    setDisplayName,
    isLoaded
  };
}
