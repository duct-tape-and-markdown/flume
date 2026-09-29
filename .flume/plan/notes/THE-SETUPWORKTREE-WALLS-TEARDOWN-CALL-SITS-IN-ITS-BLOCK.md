# The formatting-residue family is empty; nothing mechanical keeps it that way

Shipped: the `teardownWorktreeInstance` call in the `setupWorktree`-hook catch
(`src/singletonTick.ts`) now indents its five arguments to their own block.
Whitespace-only — `git diff -w` is empty, tsc clean, 2172 tests pass.

Two things for the next rotation.

**The family reads empty on disk this tick.** The entry's notes said three of
the four named sites were already gone; I checked the whole family rather than
just those. A scan of `src/`, `harness/`, `tests/`, `examples/` and
`scripts/` for a call whose first argument line is indented at or below its
opening line turns up exactly one further hit, and it is a false positive:
`src/terminalRender.ts:42`, an indented code block inside a doc comment, where
the ` * ` margin is the block's own indentation and the example is correctly
formed. So this family has no remaining body, and re-noting it as debt should
stop.

**It is empty by hand, not by gate.** This repo ships no prettier config and
no formatter in `package.json`, so the only lens that ever sees this shape is
a sweep reading code by eye — the bottom rung, and the reason one site
survived three rotations of accepted-debt lines. A formatter gate in the
declaration would move the whole family to a rung where it cannot recur, and
would retire this lens from the sweep's attention entirely. Whether that is
worth a gate on a tree with no formatter today is a decision I did not make
here: adding one would reformat far beyond this entry's acceptance, which is
formatting-only at one call. Filing it as the question or entry it deserves is
plan's, and the cheap version — a gate asserting `git diff` is empty after a
formatter run — needs the formatter chosen first.
