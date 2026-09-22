# `.claude/rules/engineering.md`, *Narration is the ladder's bottom rung*: the
# section half of a comment citation resolves against nothing

**Ask:** does the carve-out admit the *section* half of a comment citation as
a resolution arm, and on what spelling rule? `.claude/rules/` is yours.

**Why now.** `THE-BUILT-INS-INSTANCES-TABLE-CITES-ITS-EXCEPTION` shipped a
declared-divergence paragraph — the marker that stops a sweep re-filing a
site — and its build note observed the marker is held by discipline alone:
delete it and every gate stays green. The note guessed a sweep lens; the
ladder says a pin if the thing is decidable, and the citation is that part.

**Held today:** the page half (`tests/helpers/commentCitations.ts` resolves a
`*.md` name on disk). **Not held:** the section half — that helper names
`` (`spec/loop.md`, *Section*) `` and reads it as context. A renamed heading
orphans its citations silently. The mechanism exists elsewhere:
`harness/citeResolver.ts` resolves a `per` cite by **exact heading text**.

## The fork: four spellings live in the tree

306 occurrences, 54 distinct pairs across the sweep domain. 42 name a heading
exactly. 9 abbreviate by prefix (`*Derived state is computed*` for
`## Derived state is computed, never restated beside its source`). 1 drops the
heading's backticks (`tests/priorAttempts.test.ts`). 1 cites a **bolded
bullet, not a heading** — `*No false signal*` in `harness/inboxWindow.ts`
points at `spec/loop.md:566`, a `- **…**` lead. Nothing is orphaned today, so
this is prevention.

## Options

1. **Exact heading text, reusing the `per` resolver.** One rule, one
   resolver. Costs a rewrite of the 9 abbreviations, and **reds the bullet
   cite**, which names a real claim that is not a heading.
2. **Exact after backtick normalization, over headings and bolded bullet
   leads.** No prefix arm — a prefix would resolve *The stamp* against a
   heading beginning "The stamped…". Covers all four families; still needs the
   abbreviations rewritten; adds "a bullet lead is citable" to the vocabulary.
3. **Decline.** Section cites stay prose, and the declared-divergence marker
   at five sites (`src/Dispatcher.ts`, `src/builtinGates.ts`,
   `src/selection.ts`, `scripts/build-changelog.mjs`,
   `tests/examples.test.ts`) keeps no mechanical defence.

**Recommended: 2** — the reading the tree already uses, one exactness rule
rather than a fuzzy second one, and the rewrite is mechanical. Under 1 or 2
that rewrite is a build entry this question unblocks, and the scanner's own
`*Section*` example needs an exemption or a rewrite.
