# Contributing to Vessel

Thanks for taking the time to make Vessel better. Vessel is a small project
with big ambitions, and every PR — bug fix, doc tweak, feature, or
question — moves it forward.

## Ground rules

- **Be kind in code reviews. Be specific in commit messages. Be the
  contributor you wish you had.**
- For small fixes (typos, obvious bugs, doc improvements), open a PR
  directly.
- For anything bigger than a paragraph of code, please open an issue first
  so we can sketch it out together. This saves you wasted effort if the
  approach needs to change.
- New to the codebase? Look for issues tagged
  [`good first issue`](https://github.com/megistusXYZ/Remote-Record-Studio/labels/good%20first%20issue).

## License & the DCO sign-off

Vessel is licensed under [AGPL-3.0-or-later](./LICENSE). By submitting a
contribution, you agree that your contribution will be licensed under the
same license.

We use the **Developer Certificate of Origin (DCO)** instead of a CLA.
Every commit must be signed off, which is your assertion that you wrote
the code (or have the right to submit it) and that you're licensing it
under the project's license. The full text of the DCO is at
<https://developercertificate.org/>.

To sign off a commit, just add `-s` to your `git commit`:

```bash
git commit -s -m "fix: stop the recorder from eating the last 200ms"
```

This appends a line to your commit message:

```
Signed-off-by: Your Name <your.email@example.com>
```

Forgot to sign off? Amend the last commit with `git commit --amend -s`,
or reword multiple commits with `git rebase --signoff`.

## Code style

- TypeScript everywhere. No `any` unless you can defend it in the PR.
- Follow the existing structure — the monorepo is laid out by artifact
  (`artifacts/api-server`, `artifacts/vessel`, etc.) with shared code in
  `lib/`. New code goes in the artifact it belongs to.
- Prettier handles formatting. Just run `pnpm exec prettier --write .`
  before pushing if you're unsure.
- TypeScript typecheck and tests must pass: `pnpm run typecheck` and
  `pnpm test`.

## Pull request checklist

Before opening a PR, please check:

- [ ] Branch is rebased on the latest `main`
- [ ] All commits are signed off (DCO)
- [ ] `pnpm run typecheck` and `pnpm test` pass
- [ ] PR description explains the **why**, not just the **what**
- [ ] If the change affects users, you've updated `README.md` or relevant
      docs
- [ ] Screenshots or a short clip for any UI change
- [ ] `pnpm --filter @workspace/scripts run hygiene` passes

## What goes in the public repo

This repository, its commit messages and its pull requests are public and
permanent. Keep them to code, user-facing documentation and the reasoning a
reviewer needs.

- **No internal working material.** Planning notes, AI prompts, screenshots,
  market or business thinking, and private task or ticket labels stay out of
  files, commits and PR descriptions. Local-only notes belong in the
  git-ignored `attached_assets/` folder.
- **No vulnerability details in public.** Fix security problems through the
  private process in [`SECURITY.md`](./SECURITY.md). Commit messages and PR
  descriptions describe the change in neutral terms ("Bind signed requests to
  their payload"), not the attack.
- **No secrets or personal data.** No keys, tokens, `.env` files, private
  keys or paths from your own machine. Use `.env.example` files with
  placeholder values.
- **Docs describe what the code does today.** Plans belong in issues.

CI enforces the mechanical part: the Hygiene job rejects forbidden files,
secrets, personal paths and internal labels in files, commit messages and the
PR text, and gitleaks scans the history for credentials. Run the file check
locally with:

```bash
pnpm --filter @workspace/scripts run hygiene
```

## Cutting a release

If you're a maintainer shipping a new version, see
[`RELEASING.md`](./RELEASING.md). Contributors don't need to do anything
special — your PR title and labels become the release notes, so write
user-facing titles and label PRs as `feature`, `bug`, `breaking`,
`docs`, etc. so they end up in the right section of the changelog.

## Reporting security issues

Please do **not** open a public issue for security vulnerabilities.
See [`SECURITY.md`](./SECURITY.md) for the disclosure process.

## Code of Conduct

This project and everyone participating in it is governed by the
[Vessel Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you are
expected to uphold it.
