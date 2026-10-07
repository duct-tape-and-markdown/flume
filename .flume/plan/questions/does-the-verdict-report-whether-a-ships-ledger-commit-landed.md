# Does the verdict report whether a ship's ledger commit landed?

From the build note on `A-SHIP-THAT-LANDED-NO-COMMIT-STILL-REPORTS-ITS-GATED-TIP`
(2026-10-07), which met this while arming the gated-tip cases and said the
acceptance's wording had assumed otherwise. Routed here rather than to the
queue because the field would sit on an artifact whose roster is enumerated in
`spec/loop.md`, *The tick verdict — one facts artifact* — and because *which*
fact it should carry is a shape choice, not a gap to fill.

## What is true on this tip

A fanout wave lands one pending-ledger commit per pick, and the rewrite has
four exits. One writes a commit; three do not (`commitAttemptLedger`,
`src/waveMerge.ts`). Where the shas go:

| surface | reader | carries the ledger shas? |
| ------- | ------ | ------------------------ |
| `TickResult.ledgerCommitShas` | `handoff`, in-process | yes, the whole set (`src/Phase.ts`) |
| the operator log | a human tailing the run | the exit in words (`noCommitLine`, `src/waveMerge.ts`) |
| `TickVerdict` on disk | `shouldRun`, `flume status`, `flume history`, the supervisor | **no field at all** |

So the verdict's shipping arms report `committed: true` (it is
`shipped.length > 0`), `shippedTags`, a `gatedTip` and a `headSha`, with
nothing saying whether this tick's own bookkeeping commit landed. A reader
holding the artifact alone cannot separate a ship whose rewrite committed from
one that exited `nothing-to-write` or `dock-outside-repo`. The note's three
cases are the measurement: all three had to reach `outcome.result` for that
half, because the verdict could not answer it.

The adjacent field already has its twin. `TickResult.gatedTip`'s doc names it
— "`gatedTip` (`src/tickVerdict.ts`), which carries the same value onto disk" —
and `Dispatcher.tick()` copies it across in one line beside the fields above.
`ledgerCommitShas` has no such line and no such pointer.

## Why it is worth your attention rather than a debt line

`Phase.shouldRun` is synchronous by contract and reads verdicts off disk
through `readLatestVerdictsSync`, a declared export. So the reader with no
access to this fact is a **chain**, not only an operator — and
`engine-boundary.md`, *Told, not inferred* names what a chain reaches for
instead: inferring whether a phase's work completed from the shape of its
commits.

The `dock-outside-repo` arm is a chain's own declared choice, so a chain that
docked its queue outside the repo already knows no chore commit can land. The
arm that bites is `nothing-to-write` **over a non-empty shipped set**: the
queue no longer carried the shipped entries' files when the rewrite re-read it,
which means something outside this tick removed them. That is a divergence in
the queue's own bookkeeping, and today it reaches the log and nothing else.

## Options

1. **A `ledgerCommitShas` twin on the verdict**, copied off `result` in the one
   `Dispatcher.tick()` line that already does this for `gatedTip`. Answers the
   binary question the note asked — did the bookkeeping land — in the
   vocabulary the handoff already uses, with one source and no second
   derivation. Costs: it does not say *which* no-commit exit, so a reader sees
   an absent set and still cannot tell a benign out-of-tree dock from the
   `nothing-to-write` surprise. Three or four files, one optional field.
2. **Report the exit itself**, per land, as a row or a per-outcome field. Says
   the thing the operator line says, to the artifact's readers, and separates
   the two arms the `noCommitLine` doc calls "the two states an operator has to
   tell apart". Costs: a new reported vocabulary (`PendingRewriteNoCommitExit`
   reaching the public artifact), and it is a wider surface than the note's
   finding asked for.
3. **Neither — the log is the right home.** A ledger rewrite that writes no
   commit is not a failure in two of its three arms, and no shipped consumer
   keys on this today. Costs: the one arm that *is* a surprise stays visible
   only to whoever was watching stderr, and the engineering rule's "the tick
   verdict for disk" clause stays unmet for this fact.

(1) and (2) compose: the shas answer "landed", the exit answers "why not".

## Why this is not already an entry

`.claude/rules/engineering.md`, *A fact the engine holds is reported, never
rediscovered* is a clean cite and names the verdict as the disk surface, so the
cite is not what is missing. What is missing is your sentence. The directly
analogous field went spec-first: `05c673df` (`spec: report the gated trunk tip
a tick's last ship left`) wrote the `gatedTip` bullet into
`spec/loop.md`, *The tick verdict — one facts artifact*, and
`THE-VERDICT-REPORTS-THE-GATED-TRUNK-TIP-A-TICKS-LAST-SHIP-LEFT` was derived
against it the same day. Plan filing a new public field on that artifact ahead
of its bullet would invert that order and leave the section's roster
disagreeing with `src/`. A bullet there — whichever option it states — makes
this derive's work, and this file goes away.
