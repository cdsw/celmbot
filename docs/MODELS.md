# Models and roles

## Probe

**Probe** does a cheap chat call, then tries a tiny tool call, then optionally embeddings.

No tools → don’t put that key on an agent role. CelmBot will mark it degraded.

## Roles

Rough map (same idea as pstack’s role → model setup, much smaller):

| Role | Prefer |
|---|---|
| orchestrator | framing only (metadata in v0.1; workers do the cooking) |
| worker | whatever’s fast enough; failover uses any cool tools-capable key |
| verifier | a *different* provider when you can (`cfg.roles.verifier`) |

Budget (`large` / `medium` / `small`) mostly shortens how much skill text we stuff into the prompt. Free APIs rarely expose Cursor-style “reasoning effort” knobs. On 429 CelmBot cools the key and tries another before parking the run.
