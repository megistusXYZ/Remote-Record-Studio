/**
 * Public-repository hygiene rules.
 *
 * Vessel is developed in the open. Everything committed, and every pull
 * request title, description and commit message, is public and permanent.
 * These rules keep out what does not belong there: internal working files,
 * secrets, personal details and internal audit labels. Security problems
 * are reported privately (SECURITY.md), never described in public text
 * before a fix ships.
 */

export type Issue = { path: string; line?: number; rule: string; message: string };
export type TrackedFile = { path: string; content: string };

/** Paths that only ever hold internal working material. */
const FORBIDDEN_PATHS: Array<{ test: RegExp; message: string }> = [
  { test: /^attached_assets\//, message: "internal working files (prompts, screenshots) do not belong in the repo" },
  { test: /(^|\/)replit\.md$/, message: "internal assistant notes do not belong in the repo" },
  { test: /(^|\/)\.env(\.(?!example$)[^/]+)?$/, message: "environment files hold secrets; commit only .env.example" },
  { test: /\.(pem|key|p12|pfx)$/, message: "key and certificate files must never be committed" },
  { test: /(^|\/)id_(rsa|ed25519|ecdsa)$/, message: "private SSH keys must never be committed" },
];

/** Content rules, applied line by line to files and to public text. */
const CONTENT_RULES: Array<{ rule: string; test: RegExp; message: string }> = [
  { rule: "secret", test: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}/, message: "GitHub token" },
  { rule: "secret", test: /\bAKIA[0-9A-Z]{16}\b/, message: "AWS access key" },
  { rule: "secret", test: /\bsk-(ant-|proj-)?[A-Za-z0-9_-]{20,}/, message: "API secret key" },
  { rule: "secret", test: /\bxox[abprs]-[A-Za-z0-9-]{10,}/, message: "Slack token" },
  { rule: "secret", test: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, message: "private key" },
  { rule: "secret", test: /\bnsec1[02-9ac-hj-np-z]{58}\b/, message: "private signing key" },
  { rule: "personal-path", test: /\/(Users|home)\/(?!runner\b|node\b)[a-z][a-z0-9._-]*\//i, message: "a path from someone's machine" },
  { rule: "internal-label", test: /\bP[0-3]-\d{1,3}\b/, message: "an internal audit label; describe the change instead" },
];

/** Problems in a piece of public text (a file, a PR description, a commit message). */
export function findTextIssues(text: string, where: string): Issue[] {
  const issues: Issue[] = [];
  text.split("\n").forEach((line, i) => {
    for (const r of CONTENT_RULES) {
      if (r.test.test(line)) issues.push({ path: where, line: i + 1, rule: r.rule, message: r.message });
    }
  });
  return issues;
}

export function findFileIssues(files: TrackedFile[]): Issue[] {
  const issues: Issue[] = [];
  for (const file of files) {
    for (const rule of FORBIDDEN_PATHS) {
      if (rule.test.test(file.path)) issues.push({ path: file.path, rule: "forbidden-path", message: rule.message });
    }
    issues.push(...findTextIssues(file.content, file.path));
  }
  return issues;
}

/** Rules applied to a pull request's title and description and its commits. */
export function checkPublicText(input: {
  title?: string;
  body?: string;
  commits?: Array<{ sha: string; message: string }>;
}): Issue[] {
  return [
    ...findTextIssues(input.title ?? "", "pull request title"),
    ...findTextIssues(input.body ?? "", "pull request description"),
    ...(input.commits ?? []).flatMap((c) => findTextIssues(c.message, `commit ${c.sha.slice(0, 7)}`)),
  ];
}
