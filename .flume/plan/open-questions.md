# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## Does the spec's helper-name ban bite the bare name, or only the qualified one?

**Status: PARKED** — `.claude/rules/spec-writing.md`, *A claim names behavior,
never location*.

The clause says a spec sentence may not name "an internal helper", with the
test: could build rename this without changing observable behavior? Read
literally that condemns roughly thirty sites across `spec/*.md` —
`superviseLoop` (8), `createWorktree` (6), `runFanout`, `removeWorktree`,
`writeTickVerdict`, `readPendingTolerant`, `substitutePlaceholders`,
`loadChainModule`, `buildFlumeApi`, `defaultTickRunner`, `harvestFriction`,
`writeRevertNote` and the rest. Verified: none of those ten resolve in
`src/index.ts` or `harness/index.ts`, so none is public surface under the
clause's own carve-out.

The 2d376b1d ruling de-named three sentences, and all three shared a form the
rest do not: **`Dispatcher.`-qualified** (`Dispatcher.AgentTermination`,
`Dispatcher.invokeAgent`, `Dispatcher.writeRevertNote`), each falsified by the
extraction that moved the symbol to `src/tickAttempt.ts`. The same commit left
`spec/worktrees.md`'s bare `writeRevertNote` (:279, :333) standing while
rewriting the qualified one in `spec/pending.md` — which reads as intent, not
oversight.

**Options.**

- **(a) The qualified form is the defect; the bare name is permitted
  shorthand.** `Type.member` claims a home, and homes are build's lane; a bare
  name is shorthand for the behavior the symbol produces and survives any
  move that keeps the name. Costs one clarifying sentence in spec-writing.md.
  Buys a *checkable* clause: a pin can resolve qualified cites in `spec/`
  against the declarations, which the bare form could never support.
- **(b) The clause binds as written.** Thirty-odd sentences want restating as
  behavior — a corpus-wide spec edit, human-authored, and every derive tick
  until it lands re-files the same finding.
- **(c) Scope the ban to symbols that moved.** Matches the ruling's observed
  behavior exactly but is undecidable at read time: nothing in the sentence
  says whether its symbol has moved.

**Recommended: (a).** It is the only option that leaves the clause mechanical,
it matches what the ruling actually did on both sides, and it keeps the
corpus's readable shorthand. If (b) is wanted instead, the edit is the
human's and wants its own landing — derive cannot write `spec/`.
