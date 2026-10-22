# The steps block nests, and its tests were already in the other file

Plan's `files.edit` named `tests/harnessPrompts.test.ts` as the block's first
home. It is not: `tests/harnessBuildArgs.test.ts` already drove the `<steps>`
block through the real renderer (the step-tags case and the no-steps case),
and that is where the three lines landed. `harnessPrompts.test.ts` covers the
shared and slice args; build's per-tick args have their own file. "Named
nowhere in the file today" was true of the file plan named, false of the block.

One assertion left the tree: the `Finished:` example line was matched as a
string literal in the existing case. Gone, replaced by the pin, which runs the
whole rendered steps region through `namedSteps` (`harness/putDown.ts`) and
asserts the decode is exactly the entry's steps. Exact, so a future block
paragraph opening with the lead reds it too.

Debt observed, not filed: the closure rule the block now states is enforced in
`unshippableTags` (`src/waveMerge.ts`), and nothing reads the two against each
other. They agree by inspection today. If the refusal's shape moves — it
starts narrowing a list rather than refusing it whole — the prompt keeps
giving the old advice and no test notices. Closing it wants a case driving the
real refusal over the list the block's own advice composes, which needs a
dispatcher-wave fixture; that is why this tick did not build it.

`subtreeOf` already carried the depth, so the block reads the engine's descent
rather than walking `parent` again. The guard beside it throws when the
reported steps do not all descend from the assignment — a contradiction
between two surfaces the engine hands the prompt, unreachable from any queue
the forest read admits.
