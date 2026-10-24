/**
 * Check a pull request's title, description and commits against the
 * public-repository rules. CI passes them in:
 *   PR_TITLE, PR_BODY  the pull request's title and description
 *   BASE_SHA           commits after this one (up to HEAD) are checked
 */
import { execFileSync } from "node:child_process";
import { checkPublicText } from "./repo-hygiene";

const base = process.env["BASE_SHA"];
const commits = base
  ? execFileSync("git", ["log", "--format=%H%x1f%B%x1e", `${base}..HEAD`], { encoding: "utf8" })
      .split("\x1e")
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => {
        const [sha, message] = r.split("\x1f");
        return { sha: sha ?? "", message: message ?? "" };
      })
  : [];

const issues = checkPublicText({ title: process.env["PR_TITLE"], body: process.env["PR_BODY"], commits });
if (issues.length === 0) {
  console.log(`public text: title, description and ${commits.length} commit(s) are clean`);
} else {
  for (const i of issues) console.error(`${i.path}, line ${i.line}  ${i.rule}: ${i.message}`);
  console.error("\nEdit the pull request text, or reword the commits, then push again.");
  process.exit(1);
}
