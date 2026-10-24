import { create } from "zustand";

/**
 * Whether any recording is in progress in this tab. Anything disruptive
 * (applying an app update, for instance) checks this first.
 */
type RecordingActivityState = {
  activeCount: number;
  begin: () => void;
  end: () => void;
};

export const useRecordingActivity = create<RecordingActivityState>((set) => ({
  activeCount: 0,
  begin: () => set((s) => ({ activeCount: s.activeCount + 1 })),
  end: () => set((s) => ({ activeCount: Math.max(0, s.activeCount - 1) })),
}));

export function isRecordingActive(): boolean {
  return useRecordingActivity.getState().activeCount > 0;
}
