---
name: principle-prove-it-works
description: "Apply after completing a task, before declaring done. Verify against the real artifact (run the feature, read the actual value, inspect the diff), not a proxy, self-report, or 'it compiles.'"
---

# Prove It Works

Verify every output by checking the real thing directly: run the feature, read the actual value, inspect the diff. Proxies (file mtimes, self-reports, cached output, "it compiles") do not count. When a check fails, suspect the observation method before the system.

Script the check when you can. A deterministic script that reruns the comparison beats a one-time look.

**CelmBot gate:** do not claim `PASS` until you have run the verify recipe and it exited 0. Without that evidence, report `ISSUES` or `BLOCKED`. Host shared verify is the swarm source of truth.

Inspired by Lauren Tan's pstack (MIT).
