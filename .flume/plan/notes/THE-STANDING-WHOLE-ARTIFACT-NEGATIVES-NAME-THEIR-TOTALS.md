# The whole-render subject stands in Prompt.test.ts, needle and all

Scope note: the entry named 14 assertions in harnessWindows and 2 in
cliRender, but the acceptance's last clause ("none of the surviving negatives
takes a whole render as its subject") reaches 9 more in the same two files —
the `REFUSAL_LEAD` / `bootstrapLead` ones the last filing left standing after
fixing their needles (old lines 978, 1051, 1115, 1582, 1645, 1713, 2560, 2563
and cliRender 225). A producer-owned marker phrase cannot red for a quoted
path, but its subject is still the whole artifact. All nine converted or
deleted; the two files now hold one negative — harnessWindows 1693, over a
sliced cause clause the case declares — and one in a doc comment (1960).

The family is not contained. Verified on disk this tick, `tests/Prompt.test.ts`:
line 110 `not.toContain("{{FLUME_DIR}}")`, 126 `"chain-supplied-WRONG"`,
174/175 and 199/200 `"Effective fence"` / `"Outer ceiling"`, 850
`"more path(s)"`, 886/887 `"<prior-attempt>"` / `"Recorded "` — each over a
whole rendered prompt, and 886 is the same needle this tick converted in
cliRender. 446 `not.toContain`/`not.toMatch` lines stand across the suite
outside these two files; how many take a whole render is unmeasured.

Two cuts now exist for that work: `priorAttemptBlockIfAny`
(`tests/helpers/priorAttemptBlock.ts`) answers `undefined` for a prompt that
must omit the block, and harnessWindows' `renderedLines` family is the shape
a per-file cut takes (a total per arm: heads, added lines, diff paths, shas,
backticked names, a block-if-any).

Suggest filing the Prompt.test.ts set as its own entry rather than widening
this one further: it is one file, the needles are measured above, and the
fence-lead pair (174/199) wants the same `listingUnder` cut cliRender grew.
