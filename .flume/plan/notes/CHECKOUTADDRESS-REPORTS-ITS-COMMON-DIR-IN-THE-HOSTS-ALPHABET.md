# checkoutAddress folds both sides; the sibling reporter was already folded

The fold landed in `checkoutAddress` (`src/git.ts`): `resolve` over both
`--git-dir` and `--git-common-dir` before the segment equality and before
reporting, so `checkoutSegment`'s two sides stay on one hand and `commonDir`
reaches `entryClaimPath` / `tipClaimPath` composable as it stands.

Two observations for the next plan tick:

- `gitCommonDir` (same module) already folded - `resolve(cwd, stdout)` - so
  the repo carried two reporters of one directory in two alphabets. The
  linked-checkout test compared `checkoutAddress` against itself
  (`a.commonDir` vs `primary.commonDir`) and only the primary against
  `gitCommonDir`, which is why the win32 lane found it before the suite did.
  The case now asks `gitCommonDir` from the linked checkout too. Green on
  posix pre-fix and post-fix, hence no `tests[]` line to claim.
- Two reporters of one fact is the shape under it: `gitCommonDir` and
  `checkoutAddress` both spawn `rev-parse` for the common dir, and every
  consumer of the pair (`src/tipVerify.ts`, `src/cliStatus.ts`,
  `src/entryClaims.ts`) picks one by habit. Worth a cohesion read
  (`engineering.md`, *A module is one job*) - one reporter for the common
  dir, the segment as its second field - rather than a second alphabet bug
  waiting on the next surface.
