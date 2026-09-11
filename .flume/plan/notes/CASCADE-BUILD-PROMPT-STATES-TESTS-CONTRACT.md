# Flume's own build prompt restates the tests[]/pins[] contract by hand

The entry's defect exists one layer over, in this repo's own chain, outside
build's fence.

`.flume/prompts/build.md:30` hand-writes a paragraph stating the tests[] title
discipline, the vitest gate's revert, the pre-fix-tree re-run, and that pins[]
is judged green only. `.flume/chain.ts:138` and `:149` already declare those
same rules as the `tests`/`pins` hints, and `renderSchemaForPrompt` renders
them into plan's prompt. Two copies of a rule the gate reverts commits over;
the prompt copy is the one nothing checks.

Same fix shape as this entry: build's `promptArgs` in `.flume/chain.ts` renders
`entryExtension.tests.hint` / `.pins.hint` into placeholders, and the prompt
paragraph shrinks to the framing around them. Needs a pin — the example's
agreement pin (`tests/examples.test.ts`, "build's prompt quotes the declaration
it is judged by") is the pattern: real template off disk, real promptArgs.

Both files are harness paths (`chore(flume):`), so this is plan's to file, not
a build fence widening.
