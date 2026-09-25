# The refusal narrows what spec/cli.md says about nested bays

Shipped the refusal arm of the fork the entry named: a resolved bay root
that is not `git rev-parse --show-toplevel` exits `EX_IOERR` naming both,
before `resolveStateDirs` composes the first root-derived path. The other
arm — fold `stateRootRel` onto git's top-level, keeping a nested bay
working — is still the human's to rule.

Two things for the next tick.

**A spec sentence is now narrower than it reads.** `spec/cli.md`, *Bay
discovery walks up to the nearest `.flume`* ends "Nested bays are not
disambiguated: the walk picks the nearest, same as git." After this
commit the walk still picks the nearest, but a nearest that sits below
the working-tree root is refused rather than used. That sentence was
already describing a broken path (the `sub/.flume` case reproduced in the
entry), so the refusal did not take a working behavior away — but the
sentence no longer states what the verb does, and only a human edits it.
The remedy the message gives is real and worth a spec line if the refusal
stands: run from the top level with `FLUME_DIR` naming the nested bay,
which resolves `stateRootRel` as `sub/.flume` and is correct in git's
alphabet.

**Doc cost of a second shared start-up refusal.** `74`'s cause clause is
rendered once in `src/cliHelp.ts` (one edit, every page) but hand-copied
six times in `docs/CLI.md` — status, tick, wake, sleep, stop, check,
render. All seven were widened here, but the shape is the one
`engineering.md`, *Derived state is computed, never restated beside its
source* names: the next change to a shared CLI refusal pays the same
seven-site tax. A single rendered clause `docs/CLI.md` includes, or a pin
comparing each section's cause list against the shared help clause, would
close it. Filed as an observation, not a queue entry — no behavior turns
on it today.
