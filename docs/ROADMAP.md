# Roadmap

## v0.1 — shipped

Solo + free-tier swarm on localhost: jail, multi-key queues with failover, orchestrated workers with isolated transcripts, aggregate `PASS`/`ISSUES`/`BLOCKED`/`GAP`, shared verify, roster/queue/timeline UI, SSE replay.

Design notes: [SWARM.md](SWARM.md). Flags: [`src/features/flags.ts`](../src/features/flags.ts).

| Piece | Notes |
|---|---|
| Folder jail + recipes | done |
| Cloud/Local keys, queues, cooldown, failover | done |
| Solo agent + stats + approvals | done |
| Orchestrated swarm (sequential + admission) | done |
| Agent roster / queue banner / timeline filter | done |
| Editor shell (Monaco + git) | done |

## v0.2 — backlog

| Piece | Notes |
|---|---|
| Arena | multi-model candidates + graft (`V01.arena`) |
| Interrogate | structured review pass |
| Auto-review | post-diff checks |
| Embeddings search | semantic file/skill retrieval |
| OS jail | stronger isolation than path+recipe |
| Dark theme | UI theme toggle |

Port defaults to **7429**. Override with `--port` or `CELMBOT_PORT`. Data stays under `freecel/.celmbot/`. Optional `--project` / `CELMBOT_PROJECT` only sets the initial editor workspace.
