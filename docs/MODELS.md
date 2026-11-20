# Models and roles

## Probe

**Probe** does a cheap chat call, then tries a tiny tool call, then optionally embeddings.

No tools → don’t put that key on an agent role. CelmBot will mark it degraded.

## Roles

Rough map (same idea as pstack’s role → model setup, much smaller):

| Role | Prefer |
|---|---|
| orchestrator | something that follows instructions |
| worker | whatever’s fast enough |
| verifier | a *different* provider when you can |

Budget (`large` / `medium` / `small`) mostly shortens how much skill text we stuff into the prompt. Free APIs rarely expose Cursor-style “reasoning effort” knobs.
