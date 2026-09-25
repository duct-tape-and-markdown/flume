# Five entries shipped to trunk and kept their queue files — hand-shipped, or a ledger leak?

Measured this tick against base `e785360c`, one state root (`.flume/`), no
second `FLUME_DIR` on disk or in `.env`:

| tag | build commit |
| --- | --- |
| `THE-TICK-EXIT-CODE-CAUSE-IS-LABELLED-AT-ITS-ARM` | `49618846` |
| `THE-TICK-BRANCH-AND-ENTRY-CLAIM-CARRY-THE-CHECKOUT` | `a73970d4` |
| `THE-SWEEP-CARRIES-A-RETIRED-CLAIM-CURSOR` | `99ed4a72` |
| `THE-CITATION-COVERAGE-READS-A-HOME-THE-SWEEP-OWNS` | `6010667d` |
| `THE-VERDICT-CARRIES-A-TIMING-PER-GATE-RUN-AND-MERGE` | `12d08c25` |

For each: the `build(<TAG>)` commit is an ancestor of the tip, and every
`tests[]` line the entry declared resolves to a test of that exact title on
the tree. The work is shipped.

And yet:

- `git log --diff-filter=D` over `.flume/plan/pending/` finds **no commit
  deleting any of the five files**. They stood in the queue continuously.
- The newest `chore(flume): ship ...` commit is `2518e473`, older than all
  five, and it names two other tags.
- `.flume/tick-verdicts.jsonl` carries **no row naming any of the five**. The
  log is not stale behind them: its last row is the `plan-derive` tick that
  wrote `e785360c`, the tip itself.

I dropped all five this tick and promoted
`THE-CLI-PAGE-IS-PINNED-PER-EXIT-CODE-ARM` off the blocker that left with
them. That part is unambiguous — a shipped entry left standing is re-picked
over work already on trunk, which is a whole agent span burned for a
`clean-exit` record.

## What I cannot decide from disk

**(a) They were hand-shipped.** An interactive session writes the code and
the build note but rewrites no ledger and writes no verdict row — which is
exactly the trace I see. Then the engine is fine, the queue simply needs
draining whenever you ship an entry by hand, and the open decision is
whether you want that drain to be something better than a plan tick
noticing.

**(b) They were build ticks and the ledger rewrite never landed.** Then
every wave leaks re-picks, the verdict row is missing too (so `flume status`
and the supervisor's own anchors saw nothing for five ticks), and
`THE-LEDGER-COMMIT-LANDS-WITH-ITS-OWN-MERGE` — standing in the queue, about
*when* that commit lands — is sharpening the timing of a commit that in this
window did not land at all.

The two leave an identical tree; the distinguishing evidence is what you
ran, which is why this is yours and not a derived entry. If (a), say so and
I will treat a build commit with no verdict row as the hand-shipped
signature from here. If (b), it outranks everything in the queue, and the
missing verdict row is the sharper end of it — the ledger is one artifact,
but a tick that leaves no verdict is invisible to the supervisor.

## One consequence either way

Three standing entries cite line numbers in files `99ed4a72` and `12d08c25`
have since moved: `THE-SWEEP-WINDOW-LISTS-THE-DOMAIN-A-PHRASE-DELTA-ARMS`
and `THE-SWEEP-PROMPT-POINTS-AT-THE-PAGES-IT-RESTATES`
(`harness/sweepWindow.ts`, `harness/prompts/plan-sweep.md`), and
`THE-LEDGER-COMMIT-LANDS-WITH-ITS-OWN-MERGE` (`src/waveMerge.ts`). Their
findings may well still hold — the cites are in `notes`, which no gate reads
— but they were taken against a tree five build commits ago and nothing
re-read them, because the normal re-derivation trigger is the entry leaving
the queue.
