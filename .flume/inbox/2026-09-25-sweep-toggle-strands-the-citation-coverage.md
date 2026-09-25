# The sweep cannot be switched off without breaking the citation suite

Observed interactively, priority 20. Disabling `plan-sweep` in
`.flume/declaration.ts` makes the harness refuse a leftover `slices.sweep`
(the dead-declaration rule, correctly), and dropping the block then breaks
`tests/commentCitations.test.ts`: its coverage case reads the repository's
trees off `declaration.slices.sweep.domain` (`declaredSweepTrees`), and
`tests/chain.test.ts` pins the four-phase shape by hand. An operator toggle
the package offers is one this repository cannot use.

The trees the citation scan covers are this repository's fact, not the
sweep's; the pin borrowed the sweep's declaration for them. Route as an
entry: the coverage reads a home that exists whether or not the sweep runs,
and the chain test reads the enabled list off the declaration.
