# layout.ts's roll calls were contradictory, not merely stale

Two of the caller lists trimmed from `harness/layout.ts` were wrong about the
program, not just out of date:

- `notePath`'s "two readers" named the records gate. The gate calls
  `notePaths` (`harness/gates.ts`), never `notePath`; the accessor's only
  caller is the build prompt's `NOTE_PATH` slot.
- `parkedNotePath` opened "the same three readers as its sibling" while that
  sibling named two. A roll call citing another roll call goes stale twice.

Plus the two plan had verified: "five surfaces" against nine importers of
`layout.js`, and `questionsDir`'s "Three readers share it", whose first reader
(`harness/questions.ts`) composes host-native from `QUESTIONS_DIR_REL` and
never calls the accessor.

Nothing was stranded. Every site already states at its own decision point why
it reaches the layout instead of spelling a path — `init.ts` for the queue,
`gates.ts` for `underStateRoot`, `recordGlobs` and the tag-scoped note pair,
and `chain.ts`'s `isPark` doc, which owns the "where a tick wrote is the whole
statement" fact layout.ts was restating beside it.

For plan: the same idiom is live and *accurate* in `src/selfPackage.ts` — "Two
readers, one derivation", naming `src/cli.ts` and `harness/init.ts`, both real
today. Same class as what this entry retired, and no pin reads either. Whether
a correct roll call is still residue under *Derived state is computed* is a
call I did not make; if it is, it is one entry naming both sites, not a
per-site sweep finding.
