# Contributing

Thanks for poking at CelmBot. Keep the verification-first / localhost-only posture intact.

## Setup

```bash
git clone https://github.com/cdsw/celmbot.git
cd celmbot
npm install
npm run build
npx tsx src/cli.ts
# → http://127.0.0.1:7429
```

Node **20+** (see `.nvmrc`). Optional env vars: [`.env.example`](.env.example).

## Checks before a PR

```bash
npm run typecheck
npm run lint
npm test
npm run test:jail
npm run test:e2e
```

CI runs the same suite on every push/PR.

## Live smoke (optional)

Needs real provider keys in the UI first. Never commit keys or `.celmbot/`.

```bash
CELMBOT_LIVE=1 npm run test:live
```

Checklist: [docs/LIVE_SMOKE.md](docs/LIVE_SMOKE.md).

## Design notes

- Prefer fixing/extending `src/safety/` over bypassing it.
- Shared API shapes live in `src/shared/types.ts` (imported by the web app via `@shared/*`).
- Architecture overview: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- Folder-jail rationale: [docs/adr/0001-folder-jail.md](docs/adr/0001-folder-jail.md).

## License

MIT. If you vendor original pstack skill wording, keep attribution per [NOTICE](NOTICE).
