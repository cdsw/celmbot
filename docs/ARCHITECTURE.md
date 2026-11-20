# Architecture

CelmBot is a local Node server + React UI. The browser talks only to `127.0.0.1`.

```mermaid
flowchart LR
  UI[React_Monaco_UI] -->|HTTP_SSE| API[Localhost_API]
  API --> Jail[pathGuard_recipes_runMode]
  API --> Keys[key_router_rateQueue]
  API --> Agent[solo_or_orchestrator]
  Jail --> FS[project_folder]
  Keys --> LLM[Cloud_or_Local_models]
  Agent --> Jail
  Agent --> Keys
```

## Modules

| Area | Path | Role |
| --- | --- | --- |
| CLI | `src/cli.ts` | Bind `127.0.0.1`, open UI, port fallback |
| HTTP | `src/server/` | REST + SSE run stream |
| Safety | `src/safety/` | Folder jail, recipes, approval modes |
| Keys | `src/keys/` | Multi-key pools, RPM/RPD queue, probe |
| Agent | `src/agent/` | Tool loop, persistence, sandbox orchestrator |
| Workspace | `src/workspace/` | Editor FS + local git helpers |
| Shared types | `src/shared/types.ts` | Contracts shared with the web app |
| UI | `web/src/` | Monaco editor, keys, runs, git panel |
| Skills | `skills/` | Markdown playbooks (pstack-style) |

## Trust boundary

Anything that can write files or run a recipe goes through safety first. See [TRUST.md](TRUST.md) and [adr/0001-folder-jail.md](adr/0001-folder-jail.md).

## Tests that encode the design

- `npm run test:jail` — path escape + recipe argv checks
- `npm test` — unit + fake-LLM integration
- `npm run test:e2e` — API/SPA smoke on a portable config dir
