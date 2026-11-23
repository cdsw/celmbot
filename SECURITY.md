# Security Policy

CelmBot is a **localhost-only** agent sandbox. It is not a multi-tenant cloud service.

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |

## What we try to guarantee

- Listen address is `127.0.0.1` only (not LAN/public bind by default).
- File tools stay inside the chosen project folder (symlink escape rejected).
- Empty write allowlist → no writes.
- Recipes are a fixed allowlist, not a free-typing shell.
- API keys are stored under the CelmBot install’s `.celmbot/` config dir with restrictive file mode where the OS allows it.

Full threat model and honest limits: [docs/TRUST.md](docs/TRUST.md).

## Reporting a vulnerability

Please **do not** open a public issue for security-sensitive findings.

1. Email the maintainer via the address on the [GitHub profile](https://github.com/cdsw) that owns this repository, with subject `CelmBot security`.
2. Include: CelmBot version / commit, OS, steps to reproduce, and impact (path escape, key leakage, remote bind, etc.).
3. Allow a reasonable window for a fix before public disclosure.

## Out of scope (by design)

- Harm done by allowlisted recipes themselves (e.g. `npm test` writing outside the project).
- Abuse of provider API keys you paste into the UI.
- Running with **Run Everything** mode or intentionally empty safety controls.
