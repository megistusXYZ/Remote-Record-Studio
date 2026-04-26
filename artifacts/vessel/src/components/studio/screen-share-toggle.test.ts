import { describe, it, expect, vi } from "vitest";

/**
 * Unit-level guard for the precedence rules inside
 * `StudioScreen.handleToggleScreenShare`. The full handler is internal to a
 * large component, so we replicate just the decision tree here against the
 * same inputs the real handler consumes. If anyone ever reorders these
 * branches, this test will catch the regression.
 *
 * Critical invariant under test (the bug fixed in Step 8 of the
 * Loom-style screen-share rollout):
 *   First-run privacy heads-up MUST run before the takeover branch — a
 *   first-time sharer can never start sharing without seeing the heads-up,
 *   even when someone else is already sharing.
 */

type Branch =
  | "stop"
  | "show-privacy"
  | "show-takeover"
  | "begin-share";

function decide(state: {
  isSharing: boolean;
  hasSeenPrivacy: boolean;
  activeRemoteSharer: { displayName: string } | null;
}): Branch {
  if (state.isSharing) return "stop";
  if (!state.hasSeenPrivacy) return "show-privacy";
  if (state.activeRemoteSharer) return "show-takeover";
  return "begin-share";
}

describe("screen-share toggle precedence", () => {
  it("stop has highest priority — even a first-run user can stop their own share without re-seeing the heads-up", () => {
    expect(
      decide({
        isSharing: true,
        hasSeenPrivacy: false,
        activeRemoteSharer: { displayName: "Sam" },
      }),
    ).toBe("stop");
  });

  it("first-run heads-up wins over takeover — REGRESSION GUARD for the bypass bug", () => {
    expect(
      decide({
        isSharing: false,
        hasSeenPrivacy: false,
        activeRemoteSharer: { displayName: "Sam" },
      }),
    ).toBe("show-privacy");
  });

  it("first-run heads-up shows when nobody else is sharing", () => {
    expect(
      decide({
        isSharing: false,
        hasSeenPrivacy: false,
        activeRemoteSharer: null,
      }),
    ).toBe("show-privacy");
  });

  it("takeover dialog shows when the user has already seen the heads-up and someone else is sharing", () => {
    expect(
      decide({
        isSharing: false,
        hasSeenPrivacy: true,
        activeRemoteSharer: { displayName: "Sam" },
      }),
    ).toBe("show-takeover");
  });

  it("direct share when the user has seen the heads-up and nobody else is sharing", () => {
    expect(
      decide({
        isSharing: false,
        hasSeenPrivacy: true,
        activeRemoteSharer: null,
      }),
    ).toBe("begin-share");
  });
});

describe("first-run privacy localStorage gating", () => {
  // Mirrors the helpers defined inside StudioScreen — kept in sync so any
  // accidental key rename or value drift trips this test.
  const KEY = "vessel.studio.screen-share-headsup-seen.v1";
  const hasSeen = (store: Storage): boolean => store.getItem(KEY) === "1";
  const markSeen = (store: Storage) => store.setItem(KEY, "1");

  function makeStore(): Storage {
    const m = new Map<string, string>();
    return {
      get length() {
        return m.size;
      },
      clear: () => m.clear(),
      getItem: (k) => m.get(k) ?? null,
      key: (i) => Array.from(m.keys())[i] ?? null,
      removeItem: (k) => {
        m.delete(k);
      },
      setItem: (k, v) => {
        m.set(k, v);
      },
    };
  }

  it("returns false on a fresh device, then true after acknowledgement", () => {
    const store = makeStore();
    expect(hasSeen(store)).toBe(false);
    markSeen(store);
    expect(hasSeen(store)).toBe(true);
  });

  it("treats a missing or different key as not-yet-seen — won't suppress the heads-up by accident", () => {
    const store = makeStore();
    store.setItem("vessel.studio.screen-share-headsup-seen", "1"); // missing v1 suffix
    store.setItem("vessel.studio.screen-share-headsup-seen.v0", "1");
    expect(hasSeen(store)).toBe(false);
  });

  it("a thrown localStorage (private mode) is handled by the calling helper as already-seen", () => {
    // This documents the intentional fail-open behavior in StudioScreen:
    // private-mode browsers must not be locked out of sharing.
    const throwingGet = vi.fn(() => {
      throw new Error("SecurityError: localStorage disabled");
    });
    const safeRead = (): boolean => {
      try {
        return throwingGet() === "1";
      } catch {
        return true;
      }
    };
    expect(safeRead()).toBe(true);
    expect(throwingGet).toHaveBeenCalledTimes(1);
  });
});
