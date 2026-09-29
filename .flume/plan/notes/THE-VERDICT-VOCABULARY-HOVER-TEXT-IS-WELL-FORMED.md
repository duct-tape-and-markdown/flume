# Shipped hover text now has a block-syntax reader, and two malformations it caught

Both defects were singletons: the stray-opener scan over `src/` and
`harness/` (1,100+ doc blocks) found only `src/tickVerdict.ts:35`, and no
other shipped union states a bullet roster the way `MergeOutcome` does.

Two things a later rotation may want to weigh.

**The opener arm reads the head of a body only.** A second `/**` further
down a block still ships — the emit carries it as prose mid-sentence rather
than as the body's first word, which is the shape measured on the tree. Per
the ladder rule's "a class with no measured drift stays unresolved", the arm
was not widened; if a mid-body opener is ever measured, widening is a one
predicate change in `opensWithSecondOpener`
(`tests/docComments.test.ts`).

**The roster arm is one subject, not a lens.** It reads `MergeOutcome`'s
members off the declaration and compares them to the block's bullet heads,
in order. Generalizing it to "every shipped union whose block bullets its
members" is buildable — `unionMembers` already takes a name — but no second
union was observed with a drifted roster, so it stayed a call site. That is
the same measured-drift bar, and the entry would be cheap if one turns up.

**New shared helper:** `docCommentBlocks`
(`tests/helpers/commentCitations.ts`) hands out a block's own source text
off the parser's trivia. It is the first reader in the suite whose subject
is a comment's *syntax* rather than its prose, and it is why
`harness/init.ts`'s emitted declaration — whose template text spells doc
comments — is out by construction rather than by an exclusion list.
