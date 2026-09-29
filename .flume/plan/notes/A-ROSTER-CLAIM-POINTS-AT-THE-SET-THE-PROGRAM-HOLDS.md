# The roster family had one live staleness and one extra site

All five leads now point at the set the program holds. Two things the next
plan tick should know.

**One of the five was already stale, not merely fragile.** `operatorLog`
(`src/cliLog.ts`) said its between-refusals "are written from eight modules";
ten modules in `src/` import it today (`cli`, `cliBaton`, `cliChainLoad`,
`cliCheck`, `cliFriction`, `cliHistory`, `cliLoop`, `cliRender`, `cliStatus`,
`cliTick`). So this family is not purely cosmetic: a hand count of an import
set had already drifted, and the same lead's refusal roster named six of the
pre-branch refusals as if complete. Worth reading the *next* sighting of this
family as correctness-adjacent by default rather than shape.

**The named test site carried two roster claims, not one.** In
`tests/harnessGates.test.ts` the parked-note refusal case said "its two
notes" at its admit half (`:659`) as well as "both notes ... its own two" at
its refusal half (`:686`); both are over the three paths `notePaths` renders.
Both reworded.

**Left standing, for plan's call:** that refusal case asserts two of the
three paths `notePaths` puts into the detail (`own?.join(" or ")`,
`harness/gates.ts`) — the continuing note is in the refusal string and in
no assertion. The comment now says "spot-checked here at two of them" so the
prose is honest, but the pin is narrower than the producer's answer, which is
`engineering.md`, *A seam gate reads what the real writer wrote* ("the
fixture reaches the whole output the pin claims"). This entry was
comment-only with no assertion changes, so I did not widen it. If plan wants
the third leg asserted, that is a separate entry with a `pins[]` line.

No arm moved; typecheck and the full suite are green (74 files, 2171 passed).
