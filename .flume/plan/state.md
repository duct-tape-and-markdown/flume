# State

Phase: v0.7 fully shipped (§§1-17); v0.8 fully shipped (§§2-10). No v0.9
spec yet.

Mode: audit (commit-delta was the only meaningful dimension — 3 commits,
2 build + 1 ship-chore; spec-delta empty; inbox empty, nothing to drain;
pending-now had no `blockedBy` entries, nothing to promote).

## Queue (1)

SHELLGATE-ENV-OPTION (open, top) — additive `env?` option on
`shellGate`/`execGate`, v0.1 §2.

## Open questions (4)

Old-engine blind spot in the pin handshake — unchanged, still PARKED.
Bay-manifest pin placement — unchanged, PARKED (carto residual).
pendingGate dual-violation report — unchanged, PARKED (recommend
leave-as-is unless proven costly).
setupWorktree/gate manager-detection sharing — unchanged, PARKED (needs a
spec touch either way).

## Trunk

HEAD `186d372` (ship-chore, cleared WIN32-INLINE-EXEC-SHELL-FALLBACK and
MIGRATING-0.8-FENCEWHEN-MENTION from pending.json). Audited both build
commits against their `per` cites: `58be15d` (win32 inline-exec fallback,
v0.4 §6) correctly reuses the now-exported `execGate` rather than
duplicating the direct-spawn→ENOENT→shell-retry pattern, tests cover
POSIX-unchanged / win32-retry / win32-double-fail / non-win32-not-retried;
confirmed `tests/**` is an always-open `entryChannelPaths` channel so the
entry not declaring `tests/Prompt.test.ts` under `files.edit` was not a
fence gap. `68ea38e` (fenceWhen doc mention, v0.8 §10) verified accurate
against `CHAIN-AUTHORING.md:309` and `Dispatcher.ts`'s `isPickable` —
parked/deferred entries are never fanout-assigned, so `fenceWhen`'s
pre-check exemption mirrors real build-time behavior. No drift found,
nothing routed.

Plan continues: no
