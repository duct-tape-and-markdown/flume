# Ruled: the seven over-budget ceilings take the file's budget — measured

Closes *A default-lane case may need a ceiling above the lane's one budget*
(open-questions, 26ee047). The question's premise — that the
`harnessRunner.test.ts` cases carrying `180_000` and `240_000` "plausibly
need more than the lane's number" — was measured on posix before ruling:

    vitest run tests/harnessRunner.test.ts — 12 passed, 6.54 s
    the two 240 000 cases: 1038 ms and ~1000 ms; the 180 000 cases: 513–576 ms

The ceilings are unsized numbers, a hundred times over the measured cost.
Ruling: none of the three dispositions. `spec/worktrees.md` *The default
test lane must stay fast* stands as written — the file declares the lane's
one budget, a registrar literal is not a declaration, and these seven are
the same finding as the 243 below it. `A-SPAWNING-SITE-TAKES-THE-FILES-
BUDGET` widens from at-or-below to every registrar literal on a spawning
site; the declared-divergence cite at those seven sites goes with them.

If a lane ever measures a case past the lane's budget, that is a cost
driver the page already names, and the case moves to the integration lane
— never a second constant, never the one number raised.
