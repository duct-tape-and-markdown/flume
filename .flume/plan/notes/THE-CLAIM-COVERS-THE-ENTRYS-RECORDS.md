# The record resolver is wired to producers, not to every phase

The spec section says the claim check reads a claimed entry's note files as
it reads its ledger file. Read literally over every phase, that refuses
build's own commit: a build tick *holds* the claim on the entry whose note it
writes, and `harnessGates` attaches the afterCommit `pendingGate` to build
too. So `harness/gates.ts` declares `entryRecords` only when
`producesQueue(phase.name)` — the drains — and never on build. The reasoning
is at the wiring site and pinned in `tests/harnessGates.test.ts` ("the
package's claim check covers a claimed entry's note, and build's own set
leaves it alone"). If a future reading wants the check armed on build as
well, it needs a holder-identity test the engine does not have today (the
claim carries a pid; whether that pid is this process is not a fact any
reporting surface states).

Two smaller things:

- `recordFiles`/`recordsPending` (`harness/records.ts`, both re-exported from
  `harness/index.ts`) took a second parameter, `claimed`, defaulting to the
  empty set. The default is how the existing callers stayed as they were, but
  it is also how a future caller silently un-arms the withholding. A required
  parameter would have cost ~14 call-site edits in two test files; I took the
  default. Worth a shape line if it ever grows a third caller.
- `dirListing.ts` gained `fileUnderStateRoot`, the composer `listUnderStateRoot`
  now maps through, so "is this listed file a claimed entry's note" is
  spelled the same on both sides of the comparison rather than agreeing on
  posix by accident. `NOTE_DIR_RELS` is exported from `layout.ts` for the same
  comparison.
