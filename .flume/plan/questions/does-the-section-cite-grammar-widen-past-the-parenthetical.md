# Does the section-cite grammar widen past the parenthetical?

**Section:** `.claude/rules/engineering.md`, *Narration is the ladder's
bottom rung* — the citation paragraph, which admits "the section half of a
`` (`page.md`, *Section*) `` or `` (`page.md`, "Section") `` pair,
italicized or quoted, resolved against that page's headings".

Raised by the note under `A-SHIPPED-HELP-LITERALS-SECTION-CITES-RESOLVE`
(shipped 14d27986), class 1; re-measured this drain.

## What the repo actually spells

Measured over `src/`, `harness/` and `tests/`, with comment wraps collapsed
the way the reader collapses them:

- **748** spans in the drawn spelling — the parenthetical pair the paragraph
  names. These are judged today.
- **355** spans in the comma-less, paren-less spelling: `spec/loop.md "Crash
  equals stop"`, `spec/pending.md, *Queue reads are strict*`. `SECTION_CITE`
  (`tests/helpers/commentCitations.ts:723`) requires the parens, so the
  section half of every one of them is unjudged. The page half is judged —
  `BARE_PAGE` (`:361`) reads a page name in any spelling.
- Of those 355, **298 name a heading their cited page holds** and **57 do
  not**. The 57 are near-uniformly abbreviations of a real heading:
  `spec/loop.md "Tip verify"` for *Tip verify — one writer per branch,
  absorption at the merge*, `spec/loop.md "Repeated identical failures"` for
  *…— quarantine, then abort*. The paragraph already rules on that shape:
  "no prefix arm, so an abbreviation is a rewrite, not a match".
- Exactly **one** of the 355 looks like a non-cite (an emphasis run in
  `harness/sweepWindow.ts` catching a bare `+`), so the false-positive cost
  of widening is measured at roughly one site in 355 — not a hypothetical.

## Why this is yours and not an entry

The site declares today's narrowness on purpose. `SECTION_CITE`'s doc
(`tests/helpers/commentCitations.ts:711`-`:722`) states: "The parenthetical
closes on the emphasized half, so a sentence that merely follows a page with
an aside draws no cite and a comment that claimed no section is never held to
one." And the paragraph on the page spells the pair with its parens. Widening
the drawn grammar puts the suite ahead of the page, which the sweep's own
authority rule forbids (`.claude/rules/posture-sweep.md`, *The pages are the
authority as they read this tick*).

## The fork

- **(a) Widen the phrase, then the regex.** Page name, optional comma,
  emphasized or quoted phrase, parens optional. One regex; 298 spans become
  judged the first run, ~57 stale halves red and are respelled to the full
  heading. The aside risk is the measured one site, and it is answerable in
  the same phrase (require the emphasis to sit adjacent to the page name).
- **(b) Keep the phrase; respell the sites.** The same 57 corrections plus
  355 rewrites into the parenthetical form, across ~40 files, and nothing
  mechanical stops the comma-less spelling being written again tomorrow.
- **(c) Leave it.** The majority spelling stays unjudged and drifts — the 57
  already have.

**Recommendation: (a).** The cost that decides it is the 57: they are stale
today under a rule the page already states, and only (a) finds the next one.
(b) buys the same correctness for eight times the diff and no standing check;
(c) is the status quo the note measured.

If (a) is ratified, the entry falls out mechanically — the regex plus the
respellings — and the sweep's phrase delta arms the domain for the stale
halves on its own.
