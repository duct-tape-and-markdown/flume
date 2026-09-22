# Two help-block readers disagreed; the fold picked the block walk

The two readers of the `Exit codes:` block were not the same read.
`helpExitCodeRow` (tests/cli.test.ts) scanned for `\n  <code>  `, kept the
code in the row it returned, and collapsed internal whitespace;
`documentedExitCodeRows` (tests/cliHelp.test.ts) walked the block and
returned the row text alone. Folded onto the block walk, so the single-row
read is now a lookup and `helpExitCodeRow` hands back the text without the
code. Both callers assert with toContain, so nothing turned on it -- but a
future caller comparing a row exactly sees the newer shape.

Beyond the entry's file list I adopted two further copies of the same
sequence in tests/cliHelp.test.ts: the friction --help chain (now
`minimalChainSrc({ friction })`) and the no-fanout clause fixture (its chain
source stays local -- it declares its own fence, which the shared source
fixes at `["**"]`).

Still uncollected: tests/loop-process-boundary.integration.test.ts writes a
flat `.flume/prompt.md` layout of its own. Different layout, not the same
fixture, so left alone.
