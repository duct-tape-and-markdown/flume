# The smoke's shell is per target; `npm` stays a named literal

Shipped: `needsShell(platform, target)` in `scripts/smoke-install.mjs` — win32
plus (target ends `.cmd` or target is `npm`). The `.cmd` suffix is now one
constant shared with the shim paths `main` composes, so the shim filename is
what carries the need.

Two things a later tick may want to read.

**`npm` is a literal in the predicate.** It is the one bare name that arrives
off PATH as a batch shim (`git` is `git.exe`), so the spelling cannot decide
it. The alternative considered was mirroring the engine — direct spawn first,
shell retry on win32 ENOENT, as `execFileWithShimRetry` (`src/spawnShim.ts`)
does — which needs no target list at all. It was not taken: the retry keys on
`isWin32ShimSpawnFailure`, which reads `process.platform` at call time and
cannot be handed a platform, so the smoke would have to re-spell the ENOENT
predicate to keep the posture that makes the win32 fence reachable from the
posix lane. If the engine ever takes a platform parameter there, this script
should drop its list and adopt the retry.

**Nothing pins the target list against the steps that run.** The new case
covers both sides of the fence for the targets the smoke names today, but a
step added later naming a shelled target the predicate does not recognise
would spawn directly and ENOENT only on win32 — the lane that runs last and
is re-run least. A pin would have to read the script's own `run(...)` call
sites against the predicate, which is agreement over a `.mjs` body no
typecheck reads; filing it is plan's call, not something I built here.

Also worth knowing: the windows-latest lane could not have caught the shipped
defect from its scratch path alone (no rewritten word in it) — the refusing
word was `process.execPath`, i.e. `C:\Program Files\nodejs\node.exe`, which
the run never composed. The refusal message still points the operator at
`--scratch`, which is correct for the steps that do take the shell.
