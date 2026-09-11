# A live run's quarantine was lifted by the re-keying entry landing mid-run (human)

Loop of 2026-09-11, 15 ticks. MERGE-INTERRUPTED-MARKER and
WORKTREE-BASE-DOCS-PINNED were quarantined "for the rest of this run" at
wave 4. QUARANTINE-KEYS-THE-ENTRY-AS-READ shipped in wave 6; wave 7 picked
both quarantined entries again. The supervisor started on the slug-only
contract and kept passing slug-only values in FLUME_QUARANTINED_SLUGS; the
new child code keys on `slug@hash` and matched nothing. Harmless here, but
it is *A run finishes on the contract it started with* (`spec/loop.md`)
failing silently, and `.flume/PROTOCOL.md` rule 6 (contract couplings are
ordered) was not applied: plan filed no note that the entry's effect is
deferred to the next run. Either the child honors the old key form for one
run, or the spec states that a contract change lands at the next start and
plan's discipline says so. Observed at `bec94406`.
