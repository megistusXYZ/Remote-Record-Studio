import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import ts from "typescript";

/**
 * Copy guard: protocol and implementation jargon must never reach a user.
 *
 * Earlier, only the solo-record screen had a guard (rendered in jsdom). This
 * test covers every screen by reading the source instead: it parses each
 * module under `src/` and checks the strings that can reach the screen, which
 * are JSX text, user-facing JSX attributes (placeholder, aria-label, title,
 * alt), and any string literal that reads like a sentence (contains a space)
 * and is not a console/logger argument.
 *
 * A failure prints `file:line` and the offending text. Fix the copy; do not
 * widen the allowlist unless the string is genuinely developer-facing.
 */

const SRC_ROOT = __dirname;

const FORBIDDEN: Array<{ term: RegExp; say: string }> = [
  { term: /\bnostr\b/i, say: "say 'key app', or nothing" },
  { term: /\bnpub\b/i, say: "say 'Studio ID'" },
  { term: /\bnsec\b/i, say: "say 'recovery key'" },
  { term: /\bnip-?\d+\b/i, say: "do not name protocol specs" },
  { term: /\bsigners?\b/i, say: "say 'key app'" },
  { term: /\bbunker\b/i, say: "say 'connection link'" },
  { term: /\brelays?\b/i, say: "say 'sync servers', or 'published'" },
  { term: /\bblossom\b/i, say: "say 'storage'" },
  { term: /\bpubkeys?\b/i, say: "say 'Studio ID'" },
  { term: /\bbackup keys?\b/i, say: "say 'recovery key'" },
  { term: /\bnetwork endpoints?\b/i, say: "say 'sync servers'" },
  { term: /\bsharing servers?\b/i, say: "say 'published' or 'the link'" },
  { term: /\bpreflight\b/i, say: "say 'Checks'" },
  { term: /\bsiblings?\b/i, say: "say 'audio only' or 'video only'" },
  { term: /\breading code\b/i, say: "say 'the link holds the key'" },
  { term: /\barchive (id|info)\b/i, say: "say 'Share ID' or 'Details'" },
  {
    term: /\btakedown credentials\b/i,
    say: "say 'this device's record of the link'",
  },
];

/** Exact user-facing strings that are allowed despite matching a term. */
const ALLOWLIST: string[] = [];

/** Directories whose code never renders UI copy. */
const SKIP_DIRS = new Set(["workers"]);

/** JSX attributes whose string values users can see. */
const VISIBLE_ATTRIBUTES = new Set([
  "placeholder",
  "aria-label",
  "aria-description",
  "title",
  "alt",
  "label",
  "description",
]);

interface Violation {
  where: string;
  text: string;
  say: string;
}

function* walkFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = relative(SRC_ROOT, full);
    if (SKIP_DIRS.has(rel.split("/")[0]!)) continue;
    const info = statSync(full);
    if (info.isDirectory()) {
      yield* walkFiles(full);
      continue;
    }
    const ext = extname(entry);
    if (ext !== ".ts" && ext !== ".tsx") continue;
    if (/\.test\.tsx?$/.test(entry) || /\.d\.ts$/.test(entry)) continue;
    yield full;
  }
}

function isConsoleOrLoggerCall(node: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current && !ts.isSourceFile(current)) {
    if (ts.isCallExpression(current)) {
      const callee = current.expression.getText();
      if (/^(console|logger|log)\./.test(callee)) return true;
    }
    current = current.parent;
  }
  return false;
}

function isModuleSpecifier(node: ts.Node): boolean {
  const parent = node.parent;
  return (
    !!parent &&
    (ts.isImportDeclaration(parent) ||
      ts.isExportDeclaration(parent) ||
      (ts.isCallExpression(parent) &&
        parent.expression.kind === ts.SyntaxKind.ImportKeyword))
  );
}

function looksLikeSentence(text: string): boolean {
  return /\s/.test(text.trim()) && !/:\/\//.test(text);
}

function check(
  text: string,
  file: string,
  pos: number,
  source: ts.SourceFile,
  out: Violation[],
): void {
  const trimmed = text.trim();
  if (!trimmed || ALLOWLIST.includes(trimmed)) return;
  for (const { term, say } of FORBIDDEN) {
    if (term.test(trimmed)) {
      const { line } = source.getLineAndCharacterOfPosition(pos);
      out.push({
        where: `${relative(SRC_ROOT, file)}:${line + 1}`,
        text: trimmed.length > 90 ? `${trimmed.slice(0, 87)}...` : trimmed,
        say,
      });
      return;
    }
  }
}

function scanFile(file: string, out: Violation[]): void {
  const code = readFileSync(file, "utf8");
  const source = ts.createSourceFile(
    file,
    code,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      check(node.getText(source), file, node.getStart(source), source, out);
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(source);
      const init = node.initializer;
      if (init && VISIBLE_ATTRIBUTES.has(name)) {
        if (ts.isStringLiteral(init)) {
          check(init.text, file, init.getStart(source), source, out);
        } else if (
          ts.isJsxExpression(init) &&
          init.expression &&
          (ts.isStringLiteral(init.expression) ||
            ts.isNoSubstitutionTemplateLiteral(init.expression))
        ) {
          check(init.expression.text, file, init.getStart(source), source, out);
        }
      }
      // Attribute values are handled here; do not descend into them again.
      return;
    } else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node)
    ) {
      if (
        looksLikeSentence(node.text) &&
        !isModuleSpecifier(node) &&
        !isConsoleOrLoggerCall(node)
      ) {
        check(node.text, file, node.getStart(source), source, out);
      }
    } else if (ts.isTemplateExpression(node) && !isConsoleOrLoggerCall(node)) {
      const parts = [
        node.head.text,
        ...node.templateSpans.map((s) => s.literal.text),
      ];
      for (const part of parts) {
        if (looksLikeSentence(part)) {
          check(part, file, node.getStart(source), source, out);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
}

describe("copy guard", () => {
  it("keeps protocol and implementation jargon out of every screen", () => {
    const violations: Violation[] = [];
    for (const file of walkFiles(SRC_ROOT)) {
      scanFile(file, violations);
    }
    const report = violations
      .map((v) => `${v.where}  "${v.text}"  (${v.say})`)
      .join("\n");
    expect(report, `Jargon reached user-facing copy:\n${report}`).toBe("");
  });
});
