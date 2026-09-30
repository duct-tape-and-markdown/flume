# The prompt filename has one composer; two arms now drive it

Shipped: `renderedPromptFileName(key, at?)` in `src/renderedPrompts.ts`, beside
the prefix and the two readers that decode the name — plus a module-private
`RENDERED_PROMPT_EXT` taken by the composer *and* the listing filter, so the
extension cannot move on one side. `recordRenderedPrompt`
(`src/tickAttempt.ts`) now takes the name and no longer imports `slugify`.

Probed both pins on a deliberately one-sided respell before committing: a
key-first name reds the window arm, a filter reading `.txt` over an `.md`
writer reds the listing arm. Behavior unchanged; full suite green.

Two things the next rotation may want:

1. **The history-window trim case is still half hand-authored.**
   `tests/Dispatcher.test.ts`, *a rendered prompt no retained verdict names is
   removed when the history window drops the verdict that named it* needs
   `MAX_TICK_VERDICTS + 1` invocations, so its verdict *rows* stay
   `verdictFixture`-written — real ticks would cost ~20 dispatcher runs. Its
   filenames now come from the composer, so the name seam is covered; the row
   seam there is not, and I judged the cost not worth filing. Noting it so a
   later read of that case does not mistake it for an unnoticed gap.

2. **The new window pin straddles two real ticks by wall clock.** It runs tick
   A, captures `Date.now()`, runs tick B, and claims the lock at that instant.
   `fsStamp` is millisecond-resolution and each tick makes a git commit, so the
   straddle is not tight — and the case asserts it explicitly
   (`before < startStamp`, `inWindow >= startStamp`) ahead of the claim, so a
   host fast enough to collapse it reds at the guard naming both names rather
   than failing the trim assertion mysteriously.
