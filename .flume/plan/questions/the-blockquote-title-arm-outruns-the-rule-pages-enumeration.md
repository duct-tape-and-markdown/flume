# The blockquote title arm ships ahead of the rule page's enumeration

`sectionTitles` (`tests/helpers/docSections.ts`) now mints a title from a
bolded lead opening a blockquote line, so a `` (`docs/CLI.md`, *Reading the
exit codes*) `` pair resolves against a page's banner instead of pointing at
it in prose. `.claude/rules/engineering.md`, *Narration is the ladder's
bottom rung* still enumerates the section arm as "that page's headings and
bolded bullet leads", and it frames that list as "the classes the suite
resolves today" — so the page now understates its own suite. Your surface; no
autonomous tick can edit it.

What the arm admitted, read off the tree this tick (all new titles, none
retired):

- `> **Current reference.**` / `> **Dated record.**` banners on `docs/INTENT.md`,
  `docs/CLI.md`, `docs/CHAIN-AUTHORING.md`, and nine `docs/MIGRATING-*.md` pages.
- `> **§N verdict: …**` leads under `docs/surveys/consumer-chains/`.
- One-word leads in the spec corpus: *Gap* (`spec/prompt.md`), *Drift*
  (`spec/pending.md`, `spec/worktrees.md`), *Note* (`spec/loop.md`, twice).

The second of those is the only thing worth a decision. Resolution is a set
membership test (`sectionReader`, `tests/helpers/commentCitations.ts`), so two
*Note* leads on one page red nothing — but a cite reading
`` (`spec/loop.md`, *Note*) `` resolves to either of them and documents
neither.

## Options

1. **Widen the phrase to name the blockquote lead; accept the one-word
   titles.** Cheapest, and the page follows the suite it describes. Costs
   nothing today — no cite in the tree names a one-word lead — and leaves the
   citable set carrying titles that say little if one ever does.
2. **Widen the phrase, and state a floor the suite enforces**: a lead of one
   word mints no title, or a title a page carries twice mints none. Keeps the
   citable set informative, and costs one sentence on the page plus one case
   in `tests/docSections.test.ts`. It retires no cite that exists.
3. **Narrow the arm back to the banner shape it was built for**, leaving the
   page as written. I would not: the arm's rule is anchoring (a bolded run
   opening a line), and "banner only" needs a definition of banner the reader
   does not have — position on the page, or the first quote, both arbitrary.
   `collaboration.md`, *Complexity is a signal, not a challenge*.

I'd take 1 now and 2 the first time a cite wants a one-word lead; the floor is
a rule with no instance to govern yet.

Either way, `tests/commentCitations.test.ts:901` titles its case with the
page's enumeration verbatim ("…the page's headings and bolded bullet leads"),
so the settled wording wants a plan entry widening that title beside it. The
build tick left it alone rather than widen a claim plan had not filed.

Filed from the build note on `CITATION-TITLES-ADMIT-A-BLOCKQUOTE-LEAD`.
