# The supervisor section names its knob set twice

Landed here anyway: `walkOf`/`restatementsOf` in tests/helpers/docSections.ts,
all three CHAIN-AUTHORING walks reading through them (supervisor's per-knob
coverage becomes equality; adoption's local `mentionsIn` is gone), and the
gate walk's pins[] arm, verified red on an injected restatement.

Parked: pins[] "supervisor-policy section names the knob set in one place" is
RED on this tree, so it is not a pin. docs/CHAIN-AUTHORING.md §9's closing
paragraph ("The fields split by when they are read") lists all six knobs —
quarantineScope/abortThreshold once-per-run, then killGraceMs, maxParallel,
tickTimeoutMs, partitionIgnore per-tick. A seventh strands it: exactly the
defect the arm catches. The entry's "nothing restates a set today" holds for
the other two sections only.

Fork: (a) a tests[] entry moving each knob's binding time into its own bullet,
leaving that paragraph to explain the two classes without listing membership;
or (b) declare the paragraph a deliberate second naming at its site and drop
the line.

Also seen: fieldsMissingFrom (tests/harnessDeclaration.test.ts) is a fourth
spelling of this read, coverage-only.
