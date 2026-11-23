# Trust

CelmBot listens on **127.0.0.1** only. It doesn’t phone home.

## Folder jail

By default, file tools can’t read or write outside the project folder you pick. Symlinks that point outside are rejected. If the write allowlist is empty, nothing gets written.

Recipes run with a fixed command list (e.g. `npm test`), not a free-typing shell. On Windows, npm still goes through `cmd /c` because that’s how `.cmd` shims work — args are checked for path escapes and nasty metacharacters first.

**Still your problem:** if `npm test` itself writes to `$HOME` or downloads the internet, CelmBot can’t stop that script. Skim what your recipes actually run.

Freeform shell stays off unless you turn on something dangerous on purpose. Even then, Windows isn’t getting a real OS sandbox in v0.

## Write policy

- **Approve writes** (stored as `ask`) — default. Writes and recipes wait for you.
- **Allowlist** — recipes you’ve blessed can run without a click.
- **Run everything** — you asked for it; don’t.

## Keys

Keys are stored in this install’s `.celmbot/config.json` (not a machine-wide home folder). They only go to the base URL you set. Cloud and Local tabs are kept separate so it’s obvious what’s leaving the machine.
