# State

Phase: v0.7 shipped (§§1-17); v0.8 shipped (§§2-10); v0.9 "the doctrine
line" spec authored this delta, now derived into the queue below.

Mode: derive (spec-delta was the heavy dimension — new
`spec/RELEASE-v0.9.md`, §§2-5 decomposed into 4 entries). Light audit
alongside: `3170113` (SHELLGATE-ENV-OPTION build, v0.1 §2) checked
against its `per` cite — additive `env?` on `shellGate`/`execGate`,
merge-over-`process.env` only when supplied, tests cover
unchanged/with-env/merge-not-replace; matches declared files exactly,
no drift. Inbox empty, nothing to drain; pending-now was `[]`, nothing
to promote.

## Queue (4)

1. EXEC-LOCAL-HANDSHAKE-REMOVAL (open, top) — delete `engineHandshake`
   + apparatus from `src/cli.ts`, v0.9 §2.
2. EXEC-LOCAL-JOBLINK-REMOVAL (open) — delete `ensureFlumeLink` from
   `src/job.ts`, v0.9 §3.
3. EXEC-LOCAL-DOCS (open) — README/CLI.md/MIGRATING-0.8/
   CHAIN-AUTHORING teach the doctrine, v0.9 §4.
4. EXEC-LOCAL-CHANGELOG (open) — `[Unreleased]` Breaking/Removed
   entries, v0.9 §5.

All four touch disjoint files (fence pre-checked against build's
`buildFence` directly — see commit body); no `blockedBy` needed.

## Open questions (4)

Old-engine blind spot in the pin handshake — unchanged, still PARKED.
Bay-manifest pin placement — unchanged, PARKED (carto residual).
pendingGate dual-violation report — unchanged, PARKED (recommend
leave-as-is unless proven costly).
setupWorktree/gate manager-detection sharing — unchanged, PARKED (needs
a spec touch either way).

## Trunk

HEAD `af3a16c` (spec: v0.9 authored). A prior attempt at this same
derivation (`29286dc`) was reverted by `pending-gate`: it declared
removed symbols (`engineHandshake`, `readLocalInstall`, …) as bare
strings under `files.retire`, which the gate's `touchedPaths` treats as
literal paths — none matched the fence. This tick's entries instead
declare the real file paths (`src/cli.ts`, `src/job.ts`, …) under
`files.edit`, `retire` left `[]`; pre-validated against `buildFence`
directly before commit.

Plan continues: no
