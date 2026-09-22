# `.claude/rules/engineering.md`, *Narration is the ladder's bottom rung*: the
# section half of a comment citation resolves against nothing

**Ask:** does the carve-out admit a prose token that names a heading as a
resolution arm, and on what spelling rule? `.claude/rules/` is yours. Two
families ask it, and one ruling settles both: the *section* half of a comment
citation (below), and a `§ N` cross-reference on a `docs/` page (last
section).

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

## Second family: a `§ N` cross-reference on a `docs/` page

Raised by `THE-WORKTREE-STAMP-EARNS-ITS-OWN-MIGRATION-SECTION`'s build note.
Adding § 10 to `docs/MIGRATING-0.17.md` meant hand-editing three places that
agree only by discipline — the intro's break tally, its API/CLI/neither
taxonomy, and the routing block's grep-to-§ list — and nothing reads any of
them against the page's headings.

**The tally half is not pinnable, and the note's proposed check would red on
a correct page.** Verified this tick: the page carries ten `^## N.` headings
and states "Eight breaking changes". Both are right — § 1 is the upgrade
procedure and § 4 is a new behavior, neither a break. The count is a semantic
classification, so a heading count cannot hold it and nothing below prose can.
Dropped; not part of this ask.

**The reference half is decidable**, and it is the same shape as the arm
`tests/pageAnchors.test.ts` already runs for a markdown link's `#fragment`:
a token naming a heading, resolved against headings that exist. It is not
that arm — a `§ N` is body prose, not a link — so it enters only if this
carve-out admits it.

### The fork here is *which page* a `§ N` resolves against

Scanned every page in the anchor domain. Under the bare "its own page" rule,
four sites red and every one is correct prose naming **another** page's
section: `docs/MIGRATING-0.17.md:8` and `docs/MIGRATING-0.15.md:21,488` cite
the previous note's § 0 (which exists); `docs/LAYERS.md:131` and
`docs/PRD-dock-collapse.md:78` cite pages with no numbered headings at all.
`CHANGELOG.md` is the extreme: 74 refs, zero own-page numbered headings —
every one names a migration note's section.

Options:

1. **Own-page only, on pages that have numbered headings.** A page with none
   is skipped whole. Cheap; silently covers nothing on `CHANGELOG.md`, the
   densest site, and still reds the three correct previous-note cites.
2. **Own-page by default, another page when the sentence names one.** Matches
   how every red above actually reads. Needs a stated rule for "names one" —
   nearest preceding `MIGRATING-N.md` mention in the same paragraph is the
   shape the tree supports — and that rule is the thing to weigh: it is an
   inference over prose, which is the form `engine-boundary.md`'s *Told, not
   inferred* fences in the engine.
3. **Decline.** `§ N` stays prose; a renumbered or deleted section leaves its
   cross-references pointing at nothing, as it does today.

**Recommended: 1** — it buys the migration notes, which is where sections get
added and renumbered, without spending an inference rule on prose to reach
`CHANGELOG.md`. If you want 2, the amendment to make is to the same sentence
of *Narration is the ladder's bottom rung* that family one edits.
