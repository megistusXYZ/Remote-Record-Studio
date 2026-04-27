# Security Policy

The Vessel team takes security seriously. Vessel handles real recordings,
real identities, and real network sessions, so we treat any vulnerability
as a first-class issue.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, email **`security@vessel.example`** with:

- A clear description of the issue and its impact.
- Steps to reproduce, or a proof-of-concept if you have one.
- The version, commit hash, or deployment URL where you observed it.
- Whether you would like to be credited in the eventual advisory (and
  the name / handle to credit).

If you would like to encrypt your report, request our PGP key in your
first message and we will send it back to you out of band.

## What to expect

- **Acknowledgement** within **3 business days** of your report.
- **Initial assessment** (severity, scope, reproducibility) within
  **7 business days**.
- **Coordinated disclosure** once a fix is available. We aim to ship a
  patch within **90 days** for high-severity issues, sooner for the
  worst categories (account takeover, RCE, recording exfiltration).
- A **public advisory** in this repository's `Security` tab once the
  patch is released, crediting the reporter unless they prefer to stay
  anonymous.

## Scope

In scope:

- The Vessel server (`artifacts/api-server`).
- The Vessel web client (`artifacts/vessel`).
- Shared packages under `lib/`.
- The session orchestration and identity protocol as implemented in
  this repository.

Out of scope (please report to the upstream project, not us):

- Vulnerabilities in third-party dependencies — please report those to
  the dependency's own maintainers. We will pick up the fix when it
  ships.
- Issues that require physical access to a participant's device.
- Self-inflicted issues from running modified or unsupported code.

## Safe-harbour

We will not pursue legal action against good-faith security research
that:

- Does not access or modify data belonging to other users.
- Does not degrade service for other users (no DoS testing against
  shared infrastructure — please run a local instance).
- Stops as soon as a vulnerability is identified and reports it
  privately under this policy.

Thanks for helping keep Vessel safe.

## For maintainers

Operating a public Vessel deployment? See
[`OPERATIONS.md`](./OPERATIONS.md) for the runbook covering CDN/WAF
setup, the rate-limit and feature-flag rollback switches, abuse
response, and the curl recipes for verifying security posture after
each deploy.
