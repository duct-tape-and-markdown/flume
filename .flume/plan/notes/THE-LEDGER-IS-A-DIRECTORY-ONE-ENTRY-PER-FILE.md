# This repo's own queue is not cut over yet — the loop is dead until it is

`.flume/` is outside every phase's fence, so this ship could not move this
repo's queue. On trunk right now: `.flume/plan/pending.json` (a file the
engine no longer reads) and no `.flume/plan/pending/`. Until an operator
splits it, every read sees an empty queue and `pending-gate` fails every plan
commit with `plan/pending missing after commit`. The steps are
`docs/MIGRATING-0.19.md` § 5, verbatim; `legacyQueuePath` rides
`planArtifacts` so a plan tick can `git rm` the old file itself if the split
lands as a `plan:` commit instead.

**A `.gitkeep` is load-bearing, not tidiness.** Git holds no empty directory
and `pendingGate` fails an absent one, so a queue drained to zero entries
would vanish from the tree and revert the very commit that drained it.
`flume-harness init` seeds `.flume/plan/pending/.gitkeep`; the fence glob is
`plan/pending/*.json`, so no slice can write or drain it. The cutover here
needs the same file.

**Retirements the next rotation owns.** `LEGACY_QUEUE_REL` and
`LEGACY_PLAN_STATE_REL` (`harness/layout.ts`), their accessors and their
fence lines go with the release after `docs/MIGRATING-0.19.md`, like
`LEGACY_QUESTIONS_REL` before it. Both are named there as one allowance.

**`docs/MIGRATING-0.19.md` is a two-change page now.** § 6 walks the
plan-state split (`b6f882c3`): the accessors' slice arg, `planArtifacts` per
slice, `PLAN_STATE_PATH` leaving `SHARED_PROMPT_DATA_KEYS`, the
`plan/state.json` cutover. A further break joins as its own section.

**Debt observed, not filed.** `readQueueAtRef` (`src/pendingLedger.ts`)
spends one `git show` per entry behind one `ls-tree` — O(n) processes at a
large queue. `git cat-file --batch` is the fix if a consumer feels it.

**`ParseError.index` became `ParseError.file`.** Anything downstream
rendering queue parse errors by index — a prompt block, a chain's gate — is
reading a field that no longer exists.
