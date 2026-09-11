# The cut landed at seven modules, and the boundary is indentation

The five predicted modules covered the suite's *top-level* grammars only.
Half the scanners were declared inside a `describe` — the orphan scan
(ORPHAN-ID-SINGLE-LINE-BLOCK's subject), the doc-claim region readers, the
worktree-base and `flumeDir`-children readers. Those ride forward in
red-on-base exactly like the top-level ones, so they moved too: `docClaims.ts`
(state-root claims) and `suiteShape.ts` (the extraction pin's own reader) are
the two extra modules.

Judgment call worth a decision: the pin's residue rule uses **indentation** as
the proxy for "outside an `it` body" — a declaration at column 0 or 2 is a
scanner, deeper is a driver the test owns and is meant to ride forward. It is
the right line today (every describe body sits at 2), but it is syntax, not
structure. If a future suite nests a `describe`, the rule reads its scanners as
drivers and goes quiet. An AST reader would be the rung above; not worth
building for one file.

Seven describe-local `const read = (...parts) => readFileSync(...)` copies of
one reader collapsed into `scanCorpus.readDoc` on the way through.
