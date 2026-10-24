import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The browser security policy (CSP) is what stops injected code from
 * running. Vessel's own scripts all load from files, so the policy forbids
 * inline scripts, and production enforces it. The dev server sends the same
 * policy (report-only, since Vite's hot reload injects inline code).
 */

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function devPolicy(): string {
  const src = read("artifacts/vessel/vite.config.ts");
  const block = src.slice(src.indexOf("const cspDirectives = ["), src.indexOf("] as const"));
  return [...block.matchAll(/^\s*"([^"]+)",?\s*$/gm)].map((m) => m[1]).join("; ");
}

function productionPolicy(): string {
  const m = read("deploy/Caddyfile").match(/\{\$VESSEL_CSP_HEADER\} "([^"]+)"/);
  if (!m) throw new Error("No CSP in deploy/Caddyfile");
  return m[1]!;
}

const directive = (policy: string, name: string) =>
  policy.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? "";

describe("browser security policy", () => {
  it("is the same in development and production", () => {
    expect(productionPolicy()).toBe(devPolicy());
  });

  it("runs scripts only from Vessel's own files", () => {
    const scripts = directive(productionPolicy(), "script-src");
    expect(scripts).toContain("'self'");
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
  });

  it("has no inline code in the page", () => {
    const html = read("artifacts/vessel/index.html");
    const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(
      ([, attrs, body]) => !/\bsrc=/.test(attrs!) && !/type="application\/ld\+json"/.test(attrs!) && body!.trim(),
    );
    expect(inline.map(([tag]) => tag!.slice(0, 80))).toEqual([]);
  });

  it("is enforced in production unless an operator turns it off", () => {
    expect(read("deploy/compose.yaml")).toMatch(/VESSEL_CSP_ENFORCE: \$\{VESSEL_CSP_ENFORCE:-true\}/);
    expect(read("deploy/web-entrypoint.sh")).toMatch(/: "\$\{VESSEL_CSP_ENFORCE:=true\}"/);
    expect(read("deploy/.env.example")).toMatch(/^VESSEL_CSP_ENFORCE=true$/m);
  });
});
