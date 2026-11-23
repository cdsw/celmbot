---
name: free-tier-thrift
description: "Keep free-tier swarms cheap: smallest change, one file when possible, write then verify, no speculative refactors, stop when blocked."
---

# Free-tier thrift

CelmBot runs on rate-limited free keys. Spend tokens on proof, not ceremony.

1. **Smallest change** — prefer one file / one function. No drive-by refactors.
2. **Write then verify** — after a write, run the verify recipe soon. Do not claim PASS without it.
3. **Few tools per turn** — read only what you need; avoid exploratory thrashing.
4. **Stop cleanly** — if blocked (missing deps, out of scope), report `BLOCKED` with evidence instead of looping.
5. **Shared verify wins** — in a swarm, one shared recipe is the gate; do not invent a second verify method per worker.

Inspired by pstack’s prove-it culture; tuned for CelmBot’s key queues and admission.
