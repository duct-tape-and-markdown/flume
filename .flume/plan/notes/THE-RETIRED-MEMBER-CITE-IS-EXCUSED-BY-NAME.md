# The exclusion list now carries a third reason class

The retired-member cite moved under the list: `tests/chain.test.ts:386`
spells `Chain.seedDir`, the member arm reports it gone, and
`tests/helpers/external-vocabulary.json` excuses it by name and reason. Both
non-vacuity arms count it (`tests/commentCitations.test.ts:1807` containment,
`:1815` the override set), so the exemption is now the mechanism's rather
than a paragraph's.

Two things the next plan tick may want:

1. The list's reason classes are now three — external owner, fixture source
   text, retired surface — and the third is the only one with no owner at
   all. The helper header and the roster above `EXTERNAL_VOCABULARY` both
   state it. The page-scan verdict at
   `tests/commentCitations.test.ts:2007` still names one class ("the
   vocabulary an example chain writes only into a consumer's repo") and was
   left alone deliberately: that scan judges page names, and a retired
   member is not a page. If a retired *page* ever needs excusing, that
   sentence is the one that goes stale.

2. `tests/chain.test.ts` still spells `seedDir` bare in its `it` title and
   inside code literals. Titles carry the page-name arm alone, so neither is
   a citation the suite reads — no drift, but it means this file now names
   the retired key in three spellings and only one of them is checked.
