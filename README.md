# CelmBot

A small local web app for practicing verification-first agent workflows on free (or local) models. No Cursor. No account. Not meant for serious unattended coding.

Inspired by [Lauren Tan](https://github.com/poteto)’s [pstack](https://github.com/backnotprop/pstack) (MIT) — the prove-it-works mindset, skills/playbooks, and multi-agent ideas — but as a free-tier playground you can run yourself.

```bash
npm install
npm run build
npx tsx src/cli.ts
# → http://127.0.0.1:7429
```

## Features

- Opens on localhost only (`127.0.0.1:7429`)
- Separate **Cloud** and **Local** key lists; per-key rate limits; skips keys that just hit 429
- Agents stay inside a project folder + write allowlist; verify via allowlisted recipes (not a raw shell)
- Solo or simple orchestrator/worker runs, approval cards, timeline, local usage/latency stats
- Drop in markdown skills (pstack-style `SKILL.md` works)

## Honest limits

Free models are slow and capped. That’s the point — you feel the queues. This is not OpenHands or Cursor, and it won’t babysit a repo overnight in the cloud.

## Docs

- [TRUST.md](docs/TRUST.md) — what the jail actually guarantees
- [KEYS.md](docs/KEYS.md) — where to get keys
- [MODELS.md](docs/MODELS.md) — probes and roles
- [ROADMAP.md](docs/ROADMAP.md) — what’s done / what’s next
- [LIVE_SMOKE.md](docs/LIVE_SMOKE.md) — checklist once you have keys

## Tests

```bash
npm test
npm run test:e2e
CELMBOT_LIVE=1 npm run test:live   # only after you’ve added keys
```

## Similar tools

Aider, Cline, OpenHands, GCode, and [oh-my-free-models](https://github.com/hakilee/oh-my-free-models) cover overlapping ground. CelmBot is specifically a pstack-flavored gym for free tiers + multi-key rate limits + a visible verification trail.

## License

MIT. Sample skills borrow ideas (and some wording) from Lauren Tan’s pstack — keep attribution if you vendor original pstack files. See [NOTICE](NOTICE).
