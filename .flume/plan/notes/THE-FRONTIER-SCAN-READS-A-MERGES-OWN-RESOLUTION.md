# `git log` and `git show` disagree about merges by default, and the tree read both

`commitsPast` (`harness/gitRange.ts`) now passes `--cc`, so a merge's own
resolution lands in the frontier, the liveness scan and the retired-claim
narrowing. Three measured facts for the next tick:

1. **The seam was half-closed, in the direction that hides best.** `git show`
   defaults to a dense-combined diff for a merge; `git log` defaults to no
   merge diff at all. So `diffOf`'s render always carried the resolution while
   the listing that chose which paths to diff never named it. One module, two
   dialects of the same question, green either way.

2. **A merge's `-z` listing arrives behind a second NUL, not a newline.**
   git 2.43: non-merge is `--format` output, NUL, `\n`, paths; merge under
   `--cc` is NUL, NUL, paths. `nameOnlyPaths` drops the empty field, so the
   existing single-newline strip stays correct and the merge lead needs no arm.
   Recorded in `HEADER_END`'s doc rather than `platform-facts.md`, since the
   two new cases drive it.

3. **`src/git.ts`'s `showNameOnly` is already correct, measured, not
   assumed.** It is `git show --name-only`, so it inherits the combined
   listing: on this repo's evil merge 707663bc it reports `CHANGELOG.md`,
   `src/Dispatcher.ts`, `tests/Dispatcher.test.ts`, and on a clean merge it
   reports none. The fence and prior-attempt `touchedPaths` were never blind
   here. Nothing to file — I checked so the next tick does not.

**Debt observed, not filed.** The asymmetry in (1) is a property of git, not
of this module, and `gitRange.ts` is now the only place in the tree that
states which reading it wants. Any future range read added there or in
`src/git.ts` inherits whichever default its subcommand has, with no gate
reading the choice. A `git log` without `--cc` is a silent parent-wise
reading; nothing in the suite would red for it.
