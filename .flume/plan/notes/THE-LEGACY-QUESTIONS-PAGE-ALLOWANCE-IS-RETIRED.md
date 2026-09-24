# The two sibling allowances are now due at the next cut

The 0.17 questions-page allowance is gone: constant, accessor, `planArtifacts`
line and the `renderQuestions` arm all removed, and `harness/questions.ts` is
back to listing-or-none-open with no legacy import.

What the next plan tick should know: the two remaining allowances used to
retire *with* this one, so removing it left them without a trigger. They now
name their own — `LEGACY_QUEUE_REL` cites `docs/MIGRATING-0.19.md` § 5 and
`LEGACY_PLAN_STATE_REL` cites § 6, each "retired by the maintainer cutting the
release after" that page. 0.19.0 is the shipped line (package.json reads
0.18.0 at this tick's tree, so the 0.19 page is ahead of the version), which
means both triggers fire at the next release cut, not now. Expect the
expired-narration lens to re-arm on `harness/layout.ts` then, and both
retirements are one entry: the two doc comments state the same cutover shape
and their fence lines sit adjacent in `planArtifacts`.

One thing deliberately left alone: `examples/cascade-chain.ts` and
`examples/prompts/plan.md` still declare and cat `plan/open-questions.md`.
That is the example chain's own park file, not the harness package's layout —
a chain that does not use the package's plan slices keeps whatever park file
it declared, which § 3 of the 0.17 page says outright. Not a stranded
citation, so not filed.

Also unchanged: `docs/MIGRATING-0.19.md` § 5 still cites the 0.17 allowance as
precedent ("the same one-time allowance `plan/open-questions.md` took"). Past
tense, and a migration guide naming retired surface on purpose is out of the
citation pin by construction, so it reads correctly with the allowance gone.
