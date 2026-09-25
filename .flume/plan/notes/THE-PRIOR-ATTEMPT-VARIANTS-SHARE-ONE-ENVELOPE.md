# The envelope ships, but no entry module names it

`PriorAttemptEnvelope` (`src/Prompt.ts`) now holds the five fields the six
mode variants respelled; each variant extends it and declares only its own
facts. Typecheck and the full suite are green with no test edit, which is
what a behavior-free move should look like.

Two things the next plan tick may want:

1. `src/index.ts` re-exports `PriorAttempt` and `PriorAttemptKeyspace`, not
   the six variants and not the envelope. So a chain author whose `shouldRun`
   wants to write `(a: PriorAttemptEnvelope) => ...` cannot import that name,
   even though the hover text on every variant now shows it. The
   `unnamable` arm of `tests/exportConsumers.test.ts` stayed green — a
   heritage clause is not a signature or property position, so the scan does
   not reach it. That is a real hole in that pin's claim, not a pass: the
   name a chain author reads in hover is exactly what `unnamable` exists to
   catch, and inheritance is now a way past it. Either the envelope joins
   `src/index.ts`, or the scan learns to walk `extends`. I did neither — both
   widen the entry past "one declaration the variants extend".

2. The extraction removed 228 lines and added 54. The six copies were
   byte-identical, so nothing was judged: the replacement was mechanical and
   the diff is verifiable as such.
