# State

Phase: **v0.3 SHIPPED + FROZEN** (`0db0500` cut 0.3.0; §§1-17 shipped + audited). **No active spec line** — v0.1/v0.2/v0.3 frozen; no `RELEASE-v0.4.md`. Mode this tick: **audit**.

## This tick — audit win32-shim ship delta (clean)

Delta = 3 commits (2 `build:` shipping the queued defect repairs, 1 `chore(flume):` ship-drain), empty spec-delta, empty inbox, empty pending.

**Audit** (`372ba0a`..`93c852a`):
- `d869a87` build: ships `AGENT-SPAWN-WIN32-SHIM` → **conforms**. Files match entry exactly; both specced assertions present (win32 ENOENT → exactly one shell:true retry, identical argv, resolves with retried proc's output + stdin prompt; linux ENOENT rejects unchanged) plus bonus cases (retry-also-ENOENTs rejects with no third spawn; win32 EACCES no retry). Abandoned-proc guard tested against the error+late-close double-emit. Behavior shift — truly-missing claude on win32 now reads as non-zero shell exit, not ENOENT reject — is the e360352 tradeoff the entry's notes pre-accepted; dispatcher treats both as failure. No scope creep.
- `a6c4046` build: ships `GATE-EXECGATE-FALLBACK-TEST` → **conforms**. `runIf(win32)` temp-dir .cmd fixture green via shell retry; bonus red-through-retry case (exit 7, stderr propagated) exceeds the entry's minimum — fallback provably can't mask red. PATH mutation file-local under vitest worker isolation.
- `93c852a` chore(flume): mechanical drain of both tags → `[]`. Clean.

Spawn-site sweep unchanged from last tick (no new spawn/execFile in delta). **No findings filed.**

**Drain:** none (inbox empty). **Derive:** none (spec-delta empty). **Promote:** none (pending empty).

## Queue (0)

Empty. Win32-sweep line fully shipped and audited.

## Active plan target

None — no live spec line. Three v0.4 candidate themes parked in open-questions.md (orphaned-baton Axis-C, per-phase agent assignment, entry-scoped write guard); opening `spec/RELEASE-v0.4.md` is a human call. New derivable surface requires spec movement, an inbox entry, or an OQ resolution.

## Open questions

**5 (all PARKED, unchanged this tick)**: orphaned-baton Axis-C (v0.4 landing), §7a chain.ts gate-move, teardownWorktree/NEEDS-AMENDMENT unspecced surface, per-phase agent assignment, entry-scoped fanout write guard.

## Writable-paths / trunk

- Wrote `.flume/plan/state.md` only. pending.json already `[]` (unchanged); open-questions.md + inbox.md untouched (no movement, inbox empty). All on-allowlist.
- Trunk: HEAD `93c852a` at tick start. tsc green (harness block empty). Suite green on this win32 host; both new win32 suites exercised here.

Plan continues: no
