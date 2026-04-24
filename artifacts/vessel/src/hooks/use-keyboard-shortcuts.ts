import { useEffect } from "react";

export type Shortcut = {
  key: string;            // single char ("m") or "Escape" or " " for space
  handler: (e: KeyboardEvent) => void;
  preventDefault?: boolean;
  // If true, fires even when an input/textarea/contentEditable is focused.
  whenTyping?: boolean;
};

function normalizeKey(k: string): string {
  if (k === " " || k === "Spacebar") return " ";
  return k.length === 1 ? k.toLowerCase() : k;
}

/**
 * Returns true when this keystroke would natively belong to the focused element
 * (typing into a text field, or activating a focused button/link with Space/Enter).
 * Such keystrokes should not be intercepted as global shortcuts.
 */
function isNativeKeyTarget(target: EventTarget | null, normalizedKey: string): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  // Space + Enter natively activate buttons, links, summary, role="button", etc.
  // Letting native behavior win prevents the global shortcut from "stealing" the keystroke.
  if (normalizedKey === " " || normalizedKey === "enter") {
    if (tag === "BUTTON" || tag === "A" || tag === "SUMMARY") return true;
    const role = target.getAttribute("role");
    if (role === "button" || role === "link" || role === "menuitem" || role === "tab") return true;
  }
  return false;
}

/**
 * Bind a list of keyboard shortcuts to the document. Ignores keystrokes that
 * belong to the focused element (text input, or Space/Enter on a focused
 * button/link), unless the shortcut explicitly opts in via `whenTyping`.
 */
export function useKeyboardShortcuts(shortcuts: Shortcut[], enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    function handler(e: KeyboardEvent) {
      // Ignore key combinations with modifier keys — those belong to the OS / browser.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const pressed = normalizeKey(e.key);
      const native = isNativeKeyTarget(e.target, pressed);

      for (const s of shortcuts) {
        const target = normalizeKey(s.key);
        if (target !== pressed) continue;
        if (native && !s.whenTyping) continue;
        if (s.preventDefault) e.preventDefault();
        s.handler(e);
        return;
      }
    }

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [shortcuts, enabled]);
}
