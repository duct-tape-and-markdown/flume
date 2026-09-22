# A ledger-commit refusal now fail-fasts the loop as mount-dead

`WAVE-VERDICT-SURVIVES-ANY-LEDGER-COMMIT-REFUSAL` widened
`Dispatcher.tick()`'s carry so a wave's verdict survives *any* refusal out of
`commitPendingUpdate`, not just the rewrite read's parse failure. The tags
already on trunk, the gate results and the usage rows now reach the verdict
instead of vanishing into an unhandled rejection. That part is right and is
shipped.

The build tick flagged the reading it had to pick. `tickExitCode` maps every
`failed: true` to `EX_MOUNT_DEAD`, so the widened arm exits **69** too — and
`spec/loop.md`, *Exit codes — the run never lies to CI* makes 69 fail-fast
`flume loop` unconditionally: "A mount-dead chain is exactly as dead next tick
as this one."

That premise does not hold for the causes the widened arm now admits. The
commit body names them: `git commit --only` fatals while a merge or
cherry-pick is paused in the *primary checkout*, refuses a named path it finds
unchanged, or loses `index.lock`. Each is transient operator state that a
later tick could well clear — and none is one of the 69 row's stated causes
(chain module unloadable, state root missing, declaration invalid, or
`pending.json` unparseable). Before the widening these exited 1 and the run
continued.

So spec and `src/` disagree, and which one is the defect is yours
(`CLAUDE.md`: a section that no longer matches `src/` is a defect in one of
them).

## Options

1. **Widen the spec row.** 69 gains "or a wave's ledger rewrite refused", and
   the fail-fast rationale is restated to cover a refusal that may clear. Zero
   code. Costs: a paused cherry-pick in the primary checkout now kills a whole
   autonomous run, and the operator reads "mount dead" for a tree they can fix
   in one command.
2. **A distinct exit class for the ledger refusal.** The tick still fails and
   still carries its verdict, but the loop logs it and proceeds rather than
   aborting. Reaches `TickOutcome`, `cli.ts` and `loopSupervisor` — a build
   entry, not a spec edit, and it needs a code: reuse 1 (the pre-widening
   behavior) or mint a new one.
3. **Fail-fast, but on the durable subset only.** Keep 69 for the unparseable
   ledger and drop the rest to 1. Reads the refusal's cause to decide, which
   is what the widening deliberately stopped doing — and re-keying on a cause
   is the shape the commit body rejected.

I'd take 2 with the code as **1**: it restores exactly the pre-widening loop
behavior for causes that were never mount-dead, keeps the verdict carry that
was the entry's whole point, and asks nothing of the refusal's prose.

Filed from the build note on
`WAVE-VERDICT-SURVIVES-ANY-LEDGER-COMMIT-REFUSAL`.
