# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-21

### Added

- Localhost-only agent playground with Monaco editor, file tree, and local git panel
- Folder jail + allowlisted verification recipes (not a free shell)
- Cloud/Local key pools with per-key rate queues, cooldown, capability probe, and **429 key failover**
- Solo runs and **orchestrated free-tier swarm**: per-agent transcripts, `activeAgentId`, sequential workers, aggregate `PASS`/`ISSUES`/`BLOCKED`/`GAP`, shared verify, optional verifier role
- SSE timeline with **event replay**, agent-scoped events, queue/cooldown banner, agent roster, recipes/skills pickers, run history
- Sample swarm skill under `skills/samples/swarm/`
- Unit, jail, fake-LLM integration, scheduler helpers, and Playwright API smoke tests
- Docs: TRUST, KEYS, MODELS, ROADMAP, LIVE_SMOKE, ARCHITECTURE, SWARM, ADR 0001
- CI workflow (typecheck, lint, unit, jail, e2e)

### Fixed

- Orchestrated runs no longer bill/write as the empty-scoped orchestrator row (`agents[0]`)
- pstack attribution URL points at Lauren Tan’s official tree under `cursor/plugins`

[0.1.0]: https://github.com/cdsw/celmbot/releases/tag/v0.1.0
