# Should an entry that changes an exported surface state the interface it intends?

From an interactive design review (2026-10-05, observed at `7538fb31`).
`harness/prompts/build.md` tells build "The architecture is plan's; the
files are yours", but no entry field records that architecture. An entry
carries `summary`, `per`, a free-text `acceptance`, and `tests[]` / `pins[]`
/ `laneTests[]` (`harness/entryExtension.ts`). So nothing checks a delivery
against the shape plan intended, and plan is never asked to weigh a second
shape before committing to the first, which is cheap at plan time and
expensive after build. No `spec/` section covers this, so it is a question
rather than an entry.

**The proposal:** an `interface` field on the harness entry extension
(`spec/harness.md`, *The entry extension*), never on the engine's
`pendingGate`. A required field is a convention, and the engine validates
only what its mechanics consume (`engine-boundary.md`). The field states:

- what is added or changed
- what it hides from its callers
- the alternative shape rejected, with one line on why

Build renders it beside `acceptance`, and a pre-merge review (the sibling
question `should-a-fresh-context-review-gate-judge-design-before-merge.md`)
reads the delivery against it.

## Forks

1. **What decides that the field is required.**
   - (a) Plan's prediction: the schema requires `interface` when `files`
     names a module the `exports` map reaches. This is checkable at the
     pending gate, but it is a guess, and `files` is a prediction the
     scheduler consumes, not a fence (`spec/pending.md`, *`files` is a prediction the scheduler consumes*).
   - (b) The actual surface: an `afterCommit` check diffs what the `exports`
     map reaches, base against the commit, and refuses a changed surface
     whose entry has no `interface`. This is decidable, but the refusal
     lands after build has spent the tick, and the fix is plan's, not
     build's.
   - (c) Both: (a) prompts plan, and (b) catches a miss by parking the
     entry back to plan rather than reverting it for build to retry.
2. **Whether "the alternative shape rejected" is required or optional.** If
   required, plan writes a real second design for every surface change. If
   optional, it is the first line plan drops.

**Proposed by the reviewing session:** the surface is "judged by the
export map", which reads as (b) or (c). My read is (c). Shared with the
sibling question: "changed a surface" should be one predicate with one home,
read by both the field requirement and the review gate's scope, never
spelled twice.

Once the forks are ruled, the answer becomes a section of `spec/harness.md`,
which plan can then cite.
