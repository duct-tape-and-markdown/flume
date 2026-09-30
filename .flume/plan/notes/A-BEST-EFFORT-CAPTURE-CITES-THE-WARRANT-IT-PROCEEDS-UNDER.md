# A third arm in the same family cites "by spec" without naming a section

Both named sites now carry the warrant plus the artifact the placeholder
lands in visibly: `capturedCommitMessage` (`src/tickAttempt.ts`) cites
`spec/worktrees.md`, *The revert note - the operator's copy of the verdict*
and names the note's "Reverted commit" section; `capturedDiffStat`
(`src/priorAttempts.ts`) cites `spec/loop.md`, *Prior-outcome feedback to the
retrying tick* and names the retry's `<prior-attempt>` block. Prose only; no
string, test, or verdict moved. tsc, suite (2181 passed), export and citation
pins green.

Observed while verifying, same family, not in this entry's `files`: the
reverted-prose snapshot's catch in `src/priorAttempts.ts` (the arm just above
`capturedDiffStat`, `// Recovery is best-effort by spec; never block or fail
the revert path.`) declares its warrant as "by spec" and names no section.
The section exists - `spec/worktrees.md`, *Reverted prose survives the reset*
rules it in a sentence - so the cite is a one-word fix, not a decision. It
differs from the two shipped here in that it substitutes nothing: a snapshot
failure drops files silently and there is no placeholder to bound, which is
why the site reads as a plain swallow rather than a degradation. Whether an
unnamed "by spec" plus a silent drop belongs in this family or is its own
finding is plan's call. One note, so it does not cross a third body on its
own.
