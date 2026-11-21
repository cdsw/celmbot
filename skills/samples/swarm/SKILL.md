---
name: swarm
description: "Frame, fan out scoped workers, aggregate PASS/ISSUES/BLOCKED/GAP, shared verify. Use for orchestrated multi-slice work on free-tier keys."
---

# Swarm (CelmBot)

Inspired by Lauren Tan’s pstack swarm skill (MIT) — adapted for CelmBot’s localhost jail, recipes, and key queues.

## Phases

1. **Frame** — done predicate, slice vs race, disjoint write globs per worker, verify recipe name.
2. **Fan out** — one worker brief per slice; each brief stands alone (goal, scope, how to verify, report shape).
3. **Aggregate** — collect PASS / ISSUES / BLOCKED; missing results are GAP (not a pass); retry once then record the gap.
4. **Report** — one table of results, issue one-liners, gaps, then shared `run_recipe` verify.

## Free-tier notes

- Prefer sequential workers when few keys; admission is `min(maxParallelWorkers, cool keys)`.
- On 429, CelmBot fails over keys — do not invent a second verify method per worker.
- End each worker turn with `PASS`, `ISSUES`, or `BLOCKED` and list every proven issue.
