# Can the record wake read the tip, when `live` is synchronous?

`THE-RECORD-WINDOW-READS-THE-TICKS-OWN-TREE` moved the inbox slice's
*render* to the tick's own tree and left its *wake* on the shared one. Its
note called the close a follow-on entry. It is not: the close is blocked on a
contract, and which way to unblock it is a decision.

## The disagreement, verified on this tree

- Wake: `recordsPending(inputs.flumeDir, ...)` (`harness/inboxWindow.ts:119`)
  — the primary checkout's *working tree*.
- Render: `renderRecords(treeStateRoot(ctx.cwd, options.stateRootRel), ...)`
  (`:126`) — the tick's worktree, i.e. the base commit the drain's own commit
  will descend from.

So a record the shared disk holds and a fresh worktree's base does not — an
operator's inbox file still uncommitted, a build note that landed after this
worktree was cut — wakes the slice, and `renderRecords` returns a bare
`"(no records)"` (`:252`). One tick spent, and the render says nothing about
what woke it.

The direction is the safe one: this over-wakes, never under-wakes. It is
still a dispatch read from the tree, which `spec/pending.md`, *Dispatch reads
come from the tip, not the tree* urges chain-side predicates away from — "as
guidance rather than enforcement", which is why this is a question and not a
defect with a cite.

## Why the note's fix is not available as written

The note proposed counting records at `HEAD:<stateRootRel>/<dir>` off
`options.repoRoot`. Three facts block it, each checked this tick:

1. `live` is **synchronous and pure over its inputs** —
   `readonly live: (window: SliceWindow) => boolean` (`harness/handoff.ts:158`),
   called from a synchronous `phase.handoff` (`src/Dispatcher.ts:1027`,
   `let handoff: string[]`).
2. The one tree listing the engine has, `listTreeBlobNames`
   (`src/git.ts:589`), is `async`.
3. `SliceWindow` carries `flumeDir` alone — no `repoRoot`, no
   `stateRootRel` — and neither does `TickResult` (`src/Phase.ts:331`), so
   the predicate cannot compose the ref-read even if it could run one.

(3) alone would be a reporting-surface entry (`engineering.md`, *A fact the
engine holds is reported, never rediscovered*; `SliceWindow`'s own doc says
as much). (1) and (2) together are the fork.

## Three forks

**(a) `live` becomes async** — `HandoffSlice.live`, `Handoff`, and the
dispatcher's callsite. Cleanest at the seam: the predicate then reads the tip
the way every other dispatch read does. Against it: it widens an engine
contract (`src/Phase.ts`'s `Handoff`) to buy one harness slice's read, and
`Dispatcher.ts:997` leans on the synchrony by name. This is an `src/` change
whose second-implementation warrant is not obvious — would an unrelated chain
want an async handoff, or is this flume's own convenience?

**(b) `TickResult` gains `repoRoot`/`stateRootRel`, and the predicate spawns
a synchronous `ls-tree`.** No contract change. Against it: a subprocess on
the selection path, which `inboxWindow.ts`'s own doc orders the lane leg last
precisely to avoid — "a tick the disk already woke needs no forge answer to
know the slice runs". This puts the cost back on every tick, unconditionally.

**(c) Declare the divergence and bound it — my recommendation.** The wake
deliberately reads the shared tree because it is the *superset*, and
`renderRecords` stops returning a bare `(no records)`: holding both roots
already (`frictionRoot` **is** `ctx.flumeDir`), it names the records the
shared root holds that this tree's base does not, and says they are
uncommitted. `engineering.md`, *Loud or nothing* — "a degraded-but-proceeding
path is declared and cited at the site, with the refusal that bounds it
named" — is satisfied by that render rather than by closing the gap.

Cost of (c): one informative tick per uncommitted record, instead of one
silent one. Against it: the divergence stands, and a reader of
`spec/pending.md`'s guidance finds the package's own slice declining it.

## What I need

A ruling on the fork. If (c), the render arm is a mechanical entry I will
file on the next drain — it is only correct under (c), which is why nothing
is queued for it today.

And a second-order item the same note raised, for the human rather than the
queue: under (c) an operator's inbox finding is invisible to the drain until
it is **committed**. `.claude/rules/spec-plan-build.md` already files inbox
records under a commit prefix, so this is that rule made mechanical — but
nothing states it anywhere an operator dropping a file into `.flume/inbox/`
would read it. Worth a line in `spec/harness.md`, *Declared findings
sources*, or in the README's contributor path?
