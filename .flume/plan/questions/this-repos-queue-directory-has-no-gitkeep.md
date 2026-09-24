# This repo's `.flume/plan/pending/` has no `.gitkeep`, and the next drain deletes it

Verified on disk this tick: after `bc0166a3` split the queue and `71d432d4`
shipped the last two entries, `.flume/plan/pending/` **does not exist at
HEAD**. Git holds no empty directory, so the commit that drained the queue
took the directory with it.

That is the hazard `THE-LEDGER-IS-A-DIRECTORY-ONE-ENTRY-PER-FILE`'s note
named and could not fix: `pendingGate` fails an absent queue directory
(`spec/pending.md`, *`pendingGate` — validation and fence pre-check as an
opt-in builtin*: "an absent queue directory fails it — `<pendingDir> missing
after commit` — which reverts the commit"). So the next plan tick that drains
the queue to zero **reverts the very commit that drained it**, and every plan
tick after it fails the same way until an operator intervenes.

Nothing broke this tick only because this commit adds entry files.

**Not a fork — an operator action.** `flume-harness init` already seeds
`.flume/plan/pending/.gitkeep` for a fresh adopter (`QUEUE_KEEP`,
`harness/init.ts`), and the fence glob is `plan/pending/*.json`, so no slice
can write or drain it. This repo's cutover needs the same file and no phase
can add it:

```
touch .flume/plan/pending/.gitkeep && git add -f .flume/plan/pending/.gitkeep
```

The only judgement here is whether the reference consumer should instead
carry a `chore(flume)` step that re-seeds it, so a hand-deleted keep cannot
recur. A one-time file is the simple answer and the one `init` already
ships.
