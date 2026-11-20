# ADR 0001: Folder jail + recipe allowlist

- **Status:** Accepted
- **Date:** 2026-11-21

## Context

CelmBot lets free-tier models edit a local project. A raw shell or unbounded filesystem access would turn a playground into a liability on day one — especially with keys, `.env`, and sibling folders nearby.

## Decision

1. **Path jail** (`src/safety/pathGuard.ts`): resolve paths under the chosen `projectRoot`, reject symlink escapes, protect credential-like globs, fail closed when the write allowlist is empty.
2. **Recipes, not a free shell** (`src/safety/recipes.ts`): agents may only run fixed command templates (`npm test`, etc.) with argv path checks and no shell metacharacters.
3. **Approval modes** (`src/safety/runMode.ts`): default **Ask**; optional allowlist; **Run Everything** is explicit and discouraged.

Honest limits (what recipes can still do) live in [TRUST.md](../TRUST.md).

## Consequences

- Agents cannot casually `rm -rf ~` or read `../secrets` through tools.
- Verification is visible and allowlisted — the product story (“prove it works”) matches the code.
- Windows npm still goes through `cmd /c` for `.cmd` shims; we validate args first instead of pretending we have an OS sandbox.
- Power users who want a full shell must opt into a more dangerous mode deliberately.
