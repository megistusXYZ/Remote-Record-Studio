import { describe, it, expect } from "vitest";
import { findFileIssues, findTextIssues } from "./repo-hygiene";

/**
 * The public repository must only contain what belongs in an open-source
 * product: no internal working files, no secrets, no personal details, no
 * internal audit labels.
 */
describe("repo hygiene scan", () => {
  it("flags internal working files that should never be committed", () => {
    const issues = findFileIssues([
      { path: "attached_assets/prompt.txt", content: "" },
      { path: "replit.md", content: "" },
      { path: "README.md", content: "# Vessel" },
    ]);
    expect(issues.map((i) => i.path)).toEqual(["attached_assets/prompt.txt", "replit.md"]);
  });

  it("flags environment and key files but allows the documented .example templates", () => {
    const issues = findFileIssues([
      { path: ".env", content: "" },
      { path: "artifacts/vessel/.env.local", content: "" },
      { path: "deploy/server.pem", content: "" },
      { path: "keys/id_rsa", content: "" },
      { path: ".env.example", content: "" },
      { path: "deploy/.env.example", content: "" },
    ]);
    expect(issues.map((i) => i.path)).toEqual([".env", "artifacts/vessel/.env.local", "deploy/server.pem", "keys/id_rsa"]);
  });

  it("finds tokens and private keys inside files, with the line", () => {
    // Built from parts so this test file does not itself look like a leak.
    const token = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
    const key = "-----BEGIN " + "OPENSSH PRIVATE KEY-----";
    const issues = findFileIssues([{ path: "src/config.ts", content: `const a = 1;\nconst t = "${token}";\n${key}\n` }]);
    expect(issues.map((i) => [i.line, i.rule])).toEqual([
      [2, "secret"],
      [3, "secret"],
    ]);
  });

  it("finds personal machine paths and internal audit labels", () => {
    const home = "/Users/" + "alex/Desktop/project";
    const label = "P" + "0-3";
    const issues = findFileIssues([
      { path: "docs/setup.md", content: `Run it from ${home}.\nFixes the ${label} finding.\n` },
    ]);
    expect(issues.map((i) => i.rule)).toEqual(["personal-path", "internal-label"]);
  });

  it("leaves ordinary code and the local development defaults alone", () => {
    expect(
      findTextIssues("DATABASE_URL=postgresql://vessel:vessel@127.0.0.1:5434/vessel\nconst P0 = 1; // version P-1 of the plan\n", "x"),
    ).toEqual([]);
  });
});
