# bulletOf fixed at the helper; the live hole was omittedPaths, not threw

Fixed in `bulletOf` (`tests/helpers/docSections.ts`), not at the caller: the
entry's acceptance is one of four call sites, and the footgun was held only by
prose in `bulletsOf`'s doc comment steering callers away from `bulletOf`
(`.claude/rules/engineering.md`, *Narration is the ladder's bottom rung*). The
cut now stops at the earlier of the next same-opening lead and the blank line
closing the list; that prose shrank to a pointer, and `modeBullet`
(`tests/priorAttempts.test.ts`) — a second copy of the same workaround — is
gone, its two callers now on `bulletOf`.

Measured correction to the entry's acceptance wording. The swallowed tail of the
prior-attempt section in `docs/CHAIN-AUTHORING.md` names `omittedPaths` and *not* `mergedSha`,
`touchedPaths` or `threw`, so only `omittedPaths` was actually passing
vacuously: with the bullet's `omittedPaths` deleted, the Prompt.test case was
green pre-fix and reds post-fix. A bullet silent on the other three already
red. Plan's three field names were the widest reading of the swallow, not the
measured one; the mechanism now holds all four either way.

Debt observed, not filed: the same vacuity shape reaches any per-bullet read
whose section continues past its list, and three other `bulletOf` callers
(`tests/cliHelp.test.ts`, `tests/examples.test.ts`,
`tests/harnessEntryExtension.test.ts`) were relying on their bullet being
mid-list. They are correct today and correct by mechanism now, but none of them
stated that dependence — `bulletOf` was the only home for it and did not carry
it. Nothing further to file: the helper now holds the rule and
`tests/docSections.test.ts` pins both arms of the cut.
