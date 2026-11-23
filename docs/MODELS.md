# Models and roles

## Provider keys vs models

**Provider keys** (`credentials`) hold the secret, base URL, and RPM/RPD. You can save one or more keys per provider.

- **Unlocked** (no model lock): any imported model for that provider may use the key.
- **Locked** (`modelLock`): only that model id may use the key.

**Imported models** (`keys`) are routable agent entries. They reference a `credentialId` — you do **not** paste the API key again when adding or changing models. Rate limits are shared per credential.

## Browse / import

**Browse models** calls the provider’s OpenAI-compatible `GET /models` using the selected provider key, maps capability metadata (tools, free, vision, embeddings), and caches the list under `<freecel>/.celmbot/models-cache/` (1h TTL).

By default only **agent-compatible** models are shown: chat models with tool support. Embedding / image-only / non-tool rows are filtered so imports do not create routes that later fail with “No enabled tool-capable keys”.

Already-imported rows show an **Imported** badge. Batch import **probes** each model (concurrency 2) and skips anything that is not tool-capable.

## Probe

**Probe** does a cheap chat call, then tries a tiny tool call, then optionally embeddings.

No tools → don’t put that key on an agent role. CelmBot marks it degraded and **disables** the key so the router will not pick it.

## Roles

Rough map (same idea as pstack’s role → model setup, much smaller):

| Role | Prefer |
|---|---|
| orchestrator | framing only (metadata in v0.1; workers do the cooking) |
| worker | whatever’s fast enough; failover uses any cool tools-capable key |
| verifier | a *different* provider when you can (`cfg.roles.verifier`) |

Budget (`large` / `medium` / `small`) mostly shortens how much skill text we stuff into the prompt. Free APIs rarely expose Cursor-style “reasoning effort” knobs. On 429 CelmBot cools the key and tries another before parking the run.
