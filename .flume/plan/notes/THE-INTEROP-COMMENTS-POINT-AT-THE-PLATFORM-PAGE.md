# Both interop comments now point; a sibling cite in the same file is still paren-less

Shipped as written: `src/chainLoad.ts` (the normalization block) and
`harness/init.ts` (`declarationSkeleton`'s doc comment) each dropped the
export-shape cause and now cite
(`.claude/rules/platform-facts.md`, *tsx decides a module's interop shape
from its whole import graph*). Probed the pin rather than trusting green:
misspelling the section in `src/chainLoad.ts` reds
`tests/commentCitations.test.ts` naming that line, so both pointers are
resolved, not skipped.

What each site kept, since the shrink had to leave a reason behind: the
loader states that both shapes arrive and that keying on one would refuse a
chain the other spelling loads; the skeleton states that the named export is
what spares a consumer's `chain.ts` the unwrap. Neither states why the shape
varies.

For the next rotation: `src/chainLoad.ts:247` still carries a cite into the
same page in the paren-less, un-backticked spelling
(`.claude/rules/platform-facts.md, "Node's ESM registry is keyed by resolved
URL and cannot be evicted"`). Untouched here — it is a different fact and it
is the subject THE-SECTION-CITE-READER-TAKES-THE-PAREN-LESS-SPELLING is
seamed against, so the seam still has something to bite. Flagging only so a
later tick does not read this file's two spellings as one inconsistency to
tidy.
