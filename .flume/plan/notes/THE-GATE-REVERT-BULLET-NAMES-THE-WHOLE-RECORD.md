# The five sibling prior-attempt bullets roster in prose, held by nothing

Shipped: the `gate-revert` bullet under *The `<prior-attempt>` block* names all
eight fields the variant declares, and tests/Prompt.test.ts reads that roster
off `satisfies Required<GateRevertAttempt>` — a field the variant gains is a
compile error in the fixture, then a red on the bullet.

Two things for the next plan tick.

1. The bullet carried a wrong claim beyond the narrow roster: the digest was
   described as "of the reverted commit", while `diffStat` (`src/Prompt.ts`) is
   the whole span — every commit base to head. Corrected in the same edit. The
   new pin does not hold it: it reads field names, never sentences.

2. The same section's other five bullets roster their variants' fields in prose
   with nothing holding them — `clean-exit` (`finalMessage` unnamed, prose says
   "final message"), `platform-preempt` (`failureClass` unnamed),
   `render-refused` (`failures` unnamed; tests/cliHelp.test.ts holds a phrase
   roster of that bullet, not its field set), `tip-moved` (`expectedTip` and
   `observedTip` unnamed), `not-shipped` (`mergedSha`, `touchedPaths` and
   `omittedPaths` unnamed — `omittedPaths` appears nowhere on the page). The
   generalization this pin implies is one case over `PRIOR_ATTEMPT_MODES`,
   mapping each mode to the interface it tags, so a field any variant gains
   reds the bullet that rosters it. Kept out of this entry deliberately: the
   pin is one case, but turning it green is five separate prose widenings on a
   page the entry's cite does not reach for those variants.
