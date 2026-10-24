import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Screens colour themselves with theme tokens (bg-vessel-surface,
 * text-vessel-text-secondary, var(--vessel-accent)) so they work in light
 * and dark. A raw colour like #0f1318 or rgba(255,255,255,0.1) is right in
 * one theme only. Colours that are the same in both themes (a dark scrim
 * over video, a person's avatar tint) belong in EXEMPT with the reason.
 */

const SRC = __dirname;
const RAW_COLOUR = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])|rgba?\(\s*\d/;

/** Lines whose raw colours are deliberately the same in both themes. */
const EXEMPT: Array<{ file: string; contains: string; why: string }> = [
  ...["components/lobby/InviteModal.tsx", "components/onboarding/NostrSignInModal.tsx", "components/vault/BackupKeyModal.tsx"].flatMap((file) => [
    { file, contains: 'bgColor="#ffffff"', why: "QR codes scan best dark on white" },
    { file, contains: 'fgColor="#080b0f"', why: "QR codes scan best dark on white" },
  ]),
  { file: "components/studio/SessionComplete.tsx", contains: '|| "#00d4aa"', why: "confetti fallback when the theme can't be read" },
  { file: "components/vault/SettingsScreen.tsx", contains: "const SWATCH_COLORS", why: "avatar colours people pick" },
  { file: "components/vault/SettingsScreen.tsx", contains: 'label: "White"', why: "background colours people pick" },
  { file: "components/vault/SettingsScreen.tsx", contains: 'label: "Cream"', why: "background colours people pick" },
  { file: "components/vault/SettingsScreen.tsx", contains: 'label: "Ink"', why: "background colours people pick" },
  { file: "components/vault/SettingsScreen.tsx", contains: 'label: "Accent"', why: "background colours people pick" },
];

function* screens(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "ui") yield* screens(full); // components/ui uses shadcn tokens
      continue;
    }
    if (entry.endsWith(".tsx") && !entry.includes(".test.")) yield full;
  }
}

describe("theme tokens", () => {
  it("keeps raw colours out of screens", () => {
    const found: string[] = [];
    for (const dir of ["components", "pages"]) {
      for (const file of screens(join(SRC, dir))) {
        const rel = relative(SRC, file);
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
            if (EXEMPT.some((e) => e.file === rel && line.includes(e.contains))) return;
            const m = line.match(RAW_COLOUR);
            if (m) found.push(`${rel}:${i + 1}  ${m[0]}`);
          });
      }
    }
    expect(found.join("\n"), `Use a theme token instead:\n${found.join("\n")}`).toBe("");
  });
});
