# Should `per cites resolve` refuse a span that neither wrote the stranded cite nor can repair it?

Four friction notes, 2026-10-07 12:52–13:13, all one cause. Routed here rather
than to the queue because both arms below are placements `spec/harness.md`,
*The gates the discipline needs* describes, and that page is the human's.

## What happened, measured on this tip

`8752bec5` (12:31, interactive `chore(flume)`, "trim posture-sweep.md to this
repo's lenses") deleted the `## Routing` heading from
`.claude/rules/posture-sweep.md` and touched no queue file.
`SEVEN-STRANDED-WARRANTS-NAME-THE-SHAPE-ON-DISK` cited it. For the next 35
minutes the `afterCommit` `per cites resolve` gate reverted **every** tick of
**every** phase, because the gate judges the whole queue at the gated commit:

| tick | span | base | outcome |
| ---- | ---- | ---- | ------- |
| plan-inbox 12:52 | — | tip (cite broken) | reverted; whole drain re-done at `3357c357` |
| build 12:59 | `9084ba90` | `bf169a18` (cite broken) | reverted |
| build 13:10 | `3ab3ac96` | `5e7c9d1a` | reverted — **cite repaired at the tip 4 min earlier** (`0d0ea1d3`, 13:06) |
| build 13:13 | `950a45bb` | `081e9bc1` | reverted — **repaired 7 min earlier** |

The repair was `plan-derive`'s at `0d0ea1d3`, which re-homed the cite to
`spec/harness.md`, *The sweep procedure*. The wall is gone at the tip, so all
three build entries re-pick cleanly; the question is the shape, not the fire.

## The two arms

**Build cannot pay this bill.** `.flume/declaration.ts` fences build to
`src/**`, `harness/**`, `tests/**`, `docs/**` and friends — no
`.flume/plan/**`. A build span refused over a queue entry it never read has
no move: the queue is unchanged, so the next build tick hits the same wall. The
package already knows this shape — `goalRankGate` and the `afterMerge` claim
check are wired to producers alone in the same `return`, the latter with the
reason spelled at the site ("a claim check armed over build's own note homes
would refuse the very commit the claim was staked for").

**`afterCommit` judges the span's base, not the merged tree.** `readGatedQueue`
reads at `ctx.commitSha`, whose tree is base + span, so a span based before a
repair is refused over a queue state `main` no longer has. The claim check sits
at `afterMerge` for the converse reason, stated in the same spec section: "a
pre-merge read passes over exactly the tree the collision is not in."

## Options

1. **Wire `perGate` to producers alone**, as `goalRankGate` already is. One
   line, existing mechanism, and it ends the build collateral entirely. Costs:
   a build commit no longer re-checks the queue's cites — which buys nothing
   today, since build can neither cause nor clear a stranding, and the entry
   build *picked* had its cite rendered into the prompt already.
2. **Move it to `afterMerge`.** Judges the real queue, so a since-repaired cite
   stops reverting anything. Costs: feedback to a producer arrives after merge
   rather than after commit, and an `afterMerge` gate interacts with merge width
   (`spec/worktrees.md`, *Batched merges*; the open question
   `does-a-declared-command-gate-say-it-holds-its-phase-to-one-span-per-merge.md`
   is the adjacent one). Does not fix the build arm on its own: a build span
   merging onto a tip whose cite is *genuinely* broken still reverts.
3. **Report a stranded cite instead of refusing it.** The engine already
   reports an unparseable queue on `TickContext.queueParseFailure`, and the
   inbox prompt makes that this tick's whole job ahead of everything else. A
   stranded cite is the same class — an inherited queue defect only a producer
   can clear — so reporting it would make the next inbox tick repair it with
   nothing reverted at all. Costs: a new reported field and a prompt paragraph,
   and the refusal stops being a refusal, so a producer that writes a bad cite
   learns one tick later than today.

(1) and (3) compose and together cover every row in the table. (2) covers the
two stale-base rows alone.

## A second instance, at a different gate

Same shape, 2026-10-07 14:24, caught by the `afterMerge` suite gate instead:
build's `a80bd58e` for `A-GOALS-ROW-NAMES-THREE-WORK-ENTRIES-AND-COUNTS-THE-REST`
reverted over a red `tests/pageAnchors.test.ts` the span never touched — the
engine's own verdict said so ("the same 1 file(s) ran green at `e67997a`").
The red was `705aaefb` (`chore(release): cut 0.22.0`), which wrote
`` `docs/CHAIN-AUTHORING.md` § 14 `` onto `docs/MIGRATING-0.22.md`: a `§ N`
naming *another* page's section, where the pin resolves `§ N` against the
carrying page's own numbered headings (1–11 there). `c8e7d5d3` repaired it
five minutes after the revert by respelling it as a `` (`page.md`, *Section*) ``
pair, and the file is green on this tip. The span's three `tests[]` and its one
`pins[]` all carried per the judge, so the entry is not mis-declared and
re-picks unchanged.

Options 1–3 above do not reach this row, and that is the point. A red suite is
a *correct* revert — nothing may merge onto it — and `docs/**` is inside
build's fence, so build could even have repaired this defect, had its span not
already been written against the tree that held it. What generalizes across
both rows is only the author's side: an operator commit landing a tree defect
that costs the next producer its whole span, whichever gate notices. Two gates,
one cause, two measured instances in one afternoon.

## The stranding end, for completeness

`spec-writing.md`, *A heading is an identifier* already owns the author's side —
"renaming or splitting a heading re-homes every entry and question that cites
it, and no gate reads those surfaces — do it, but in the same commit sweep
them" — and names the gap out loud. `8752bec5` is that directive not followed,
and the page is explicit that only its authors hold it. Worth asking whether it
stays prose: the queue's cites are tokens the working tree can answer, which is
the carve-out `engineering.md`, *Narration is the ladder's bottom rung* already
admits for comments, and the suite resolves `(page.md, *Section*)` pairs against
disk today. A case pinning "every standing `per` resolves on the working tree"
would red for the author who deleted the heading — but it would also red the
default lane for every build tick while a plan defect stands, which is option
(1)'s collateral wearing a different hat. Named, not proposed.
