import { describe, it, expect } from "vitest";
import { checkPublicText } from "./repo-hygiene";

/**
 * Pull request titles and descriptions and commit messages are public the
 * moment they are pushed. The same rules apply to them as to files.
 */
// Sample labels are assembled so this file passes the scan it tests.
const label = (p: number, n: number) => `P${p}-${n}`;

describe("public text check", () => {
  it("names where an internal label or secret appears in a pull request or commit", () => {
    const issues = checkPublicText({
      title: `Encrypt uploads (${label(0, 3)})`,
      body: "Summary\n\nCloses the gap.",
      commits: [
        { sha: "abc1234", message: `feat: encrypt uploads\n\nFixes ${label(1, 14)}.` },
        { sha: "def5678", message: "docs: tidy" },
      ],
    });
    expect(issues.map((i) => [i.path, i.line, i.rule])).toEqual([
      ["pull request title", 1, "internal-label"],
      ["commit abc1234", 3, "internal-label"],
    ]);
  });

  it("passes ordinary, well-written text", () => {
    expect(
      checkPublicText({
        title: "Encrypt recordings before upload",
        body: "## Summary\nEvery file is encrypted on the device.",
        commits: [{ sha: "abc1234", message: "feat(storage): encrypt recordings before upload" }],
      }),
    ).toEqual([]);
  });
});
