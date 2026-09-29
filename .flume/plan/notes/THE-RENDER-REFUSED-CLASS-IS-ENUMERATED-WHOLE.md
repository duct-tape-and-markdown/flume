# The class has a fourth member the render verb cannot reach

`RENDER_REFUSED_PHRASES` (`src/cliHelp.ts`) is the render *verb*'s class:
three members, all the verb can refuse on. The *tick* path has a fourth —
a `shouldRun` hook that threw (`consultShouldRun`, `src/tickAttempt.ts`,
reaching `noCommit: "render-refused"` in `src/waveTick.ts`). The verb never
consults `shouldRun`, so the two CLI surfaces name three and
`docs/CHAIN-AUTHORING.md`'s bullet names four; the extra member there is
hand-spelled beside the roster, which is the shape this entry just fixed one
level up. If a fifth member lands on the tick path, that bullet drifts again
and nothing reds. A second roster for the tick-path class, with the bullet
rendered from it, is the fix — filed here rather than built, since it needs a
home decision (`src/Prompt.ts` beside `NO_COMMIT_MODES`, or `src/cliHelp.ts`
beside this one) and the entry's scope was the three-member enumeration.

Also widened while re-homing: the help's `65` row said "an inline-exec span
exited non-zero", but `InlineExecRenderError` (`src/Prompt.ts`) also refuses a
spawn that failed, an `sh` that is absent, and output past the cap. The
roster's phrase is now "an inline-exec span that would not resolve" with those
causes in its rest. No behavior changed; the prose had been the narrow one.

Grounding: `tests/cliRender.test.ts` now drives all three members to a real
`EX_DATAERR` — the `promptArgs`-threw arm had no case, so the roster was one
member short of behavioral coverage before this tick.
