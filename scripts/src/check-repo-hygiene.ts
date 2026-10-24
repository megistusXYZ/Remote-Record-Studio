/**
 * Scan every tracked file against the public-repository hygiene rules.
 * Exits non-zero with a list of problems. Runs in CI and locally:
 *   pnpm --filter @workspace/scripts run hygiene
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { findFileIssues, type TrackedFile } from "./repo-hygiene";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);

/** Generated or binary files whose bytes are not prose anyone wrote. */
const SKIP = /(^|\/)pnpm-lock\.yaml$|\.(png|jpe?g|webp|avif|gif|ico|mp4|webm|wav|tflite|onnx|wasm|woff2?|ttf|pdf|zip)$/i;

const files: TrackedFile[] = [];
for (const rel of tracked) {
  if (SKIP.test(rel)) {
    files.push({ path: rel, content: "" }); // still checked by path
    continue;
  }
  let content = "";
  try {
    content = readFileSync(path.join(root, rel), "utf8");
  } catch {
    continue; // deleted in the working tree
  }
  files.push({ path: rel, content: content.includes("\0") ? "" : content });
}

const issues = findFileIssues(files);
if (issues.length === 0) {
  console.log(`hygiene: ${files.length} tracked files, no problems`);
} else {
  for (const i of issues) console.error(`${i.path}${i.line ? `:${i.line}` : ""}  ${i.rule}: ${i.message}`);
  console.error(`\nhygiene: ${issues.length} problem(s). See CONTRIBUTING.md, "What goes in the public repo".`);
  process.exit(1);
}
