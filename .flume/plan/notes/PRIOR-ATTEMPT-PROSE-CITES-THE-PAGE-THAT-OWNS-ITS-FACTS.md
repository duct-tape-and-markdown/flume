# Two of the four sites had moved; one shrink orphaned a sibling's cite

The entry located `isDirectoryOrAbsent`'s doc at `src/priorAttempts.ts` ~104.
MERGING-MARKERS had already moved the helper to `src/fsProbe.ts` (~68) and
given it the platform-facts cite; what was left there was the restatement
beside the cite, so the shrink landed in `src/fsProbe.ts`, not
`src/priorAttempts.ts`. `statLoud` (~14) stays as the entry scoped it.

Worth a lens: shrinking a doc comment can orphan a cite a *sibling* site was
leaning on. `refusalOf`'s doc in `tests/priorAttempts.test.ts` carried the
only cite of *chmod denies nothing on win32* in that file, while the case at
~390 stated that fact uncited. Retargeting `refusalOf` at the owning section
would have left the case restating an uncited fact, so the chmod cite moved
down to the case that makes the decision. A shrink is not complete until the
facts the removed prose was covering for are re-homed.
