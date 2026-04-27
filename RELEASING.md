# Releasing Vessel

Cutting a release is just **pushing a tag**. A GitHub Actions workflow takes
it from there: it builds the project, generates release notes from the PRs
merged since the previous tag, and publishes a GitHub Release.

This document is for maintainers. If you're a contributor, you don't need
to do anything here — your PR title and labels are what end up in the
release notes, so see [Writing release-friendly PRs](#writing-release-friendly-prs)
below.

## Versioning

Vessel follows [Semantic Versioning](https://semver.org/):

- `MAJOR` — incompatible / breaking changes (config format, public API,
  on-disk formats).
- `MINOR` — new functionality, backward-compatible.
- `PATCH` — backward-compatible bug fixes.

Pre-releases use a hyphen suffix and are published as GitHub "pre-releases":

```
v0.4.0-rc.1
v0.4.0-beta.2
```

Until we ship `v1.0.0`, breaking changes may land in a `MINOR` bump. We
will call those out clearly in the release notes.

## How to cut a release

You'll need:

- Push access to the repo (specifically: permission to push tags to `main`).
- A clean local checkout of `main`.

Steps:

1. **Pull the latest `main`** and confirm CI is green for the commit you
   intend to release:

   ```bash
   git checkout main
   git pull --ff-only origin main
   ```

2. **Pick the version.** Look at the merged PRs since the last tag:

   ```bash
   git describe --tags --abbrev=0           # previous tag
   git log $(git describe --tags --abbrev=0)..HEAD --oneline
   ```

   Apply [SemVer](#versioning) to decide whether it's `PATCH`, `MINOR`,
   or `MAJOR`.

3. **Tag the release.** Tags must be `vMAJOR.MINOR.PATCH` (optionally with
   a `-prerelease` suffix). Use an annotated, signed tag so the release is
   auditable:

   ```bash
   git tag -s v0.4.0 -m "v0.4.0"
   git push origin v0.4.0
   ```

   > Don't have GPG/SSH signing set up? `git tag -a v0.4.0 -m "v0.4.0"`
   > also works, but signed tags are strongly preferred for releases.

4. **Watch the workflow.** The
   [`Release`](./.github/workflows/release.yml) workflow will:
   - Verify the tag is on `main` (it refuses to release commits that
     haven't landed).
   - Run `pnpm run build` so we don't tag a broken commit.
   - Auto-generate release notes from the PRs merged since the previous
     tag, categorized using [`.github/release.yml`](./.github/release.yml).
   - Publish a GitHub Release. Tags with a `-suffix` are marked as
     pre-releases automatically.

5. **Sanity-check the published release.** Open the new release on the
   [Releases page](https://github.com/megistusXYZ/Remote-Record-Studio/releases)
   and skim the generated notes. If a PR landed in the wrong category,
   relabel the PR and click **Edit → Update release notes** on GitHub —
   you don't need to retag.

That's it. The README's "latest release" badge updates automatically.

## Fixing a bad release

Tags are immutable in spirit — don't rewrite a tag once it's been pushed.
If a release has the wrong commit or won't build, cut a new patch release
instead:

```bash
# v0.4.0 was bad — ship v0.4.1 with the fix.
git tag -s v0.4.1 -m "v0.4.1"
git push origin v0.4.1
```

If the bad release is genuinely unusable (e.g. the workflow published
broken artifacts), you may also mark it as a pre-release on the GitHub
UI and add a note pointing users to the replacement.

## Writing release-friendly PRs

Release notes are auto-generated from merged PR titles, grouped by label.
To make the changelog readable for users:

- **Write a clear, user-facing PR title.** "Stop the recorder from eating
  the last 200ms" beats "fix recorder bug".
- **Apply one of these labels** so the PR ends up in the right section
  (configured in [`.github/release.yml`](./.github/release.yml)):
  - `breaking` — incompatible change.
  - `feature` / `enhancement` — new functionality.
  - `bug` / `fix` — bug fix.
  - `performance` — speed / memory improvement.
  - `security` — security fix.
  - `documentation` / `docs` — docs-only change.
  - `chore`, `dependencies`, or `ignore-for-release` — **excluded** from
    release notes (use this for dependency bumps and internal cleanups).

Unlabeled PRs land in a generic "Other changes" section, so labelling
isn't required — it just makes the release notes nicer to read.
