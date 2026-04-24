import { create } from "zustand";
import type { VesselIdentity } from "../lib/identity";
import { clearStoredIdentity, loadSavedIdentity } from "../lib/identity";

interface IdentityStore {
  identity: VesselIdentity | null;
  isLoaded: boolean;
  setIdentity: (identity: VesselIdentity) => void;
  clearIdentity: () => void;
  hydrate: () => Promise<void>;
}

let hydratePromise: Promise<void> | null = null;

export const useIdentityStore = create<IdentityStore>((set, get) => ({
  identity: null,
  isLoaded: false,
  setIdentity: (identity) => set({ identity, isLoaded: true }),
  clearIdentity: () => {
    clearStoredIdentity();
    set({ identity: null, isLoaded: true });
  },
  hydrate: async () => {
    if (get().isLoaded) return;
    if (hydratePromise) return hydratePromise;
    hydratePromise = (async () => {
      const identity = await loadSavedIdentity();
      set({ identity, isLoaded: true });
    })();
    return hydratePromise;
  },
}));
