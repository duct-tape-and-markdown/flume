# The prior revert was an unrelated timeout, and two sibling pins still assert arrays

**The revert to read past.** 4f1b8be5 was reverted at afterMerge on
tests/loopSupervisor.test.ts "a chain declaring neither supervisor knob
gets both defaults" timing out at 5000ms. That test is untouched by this
entry, and `pnpm test` is green on the base tip here (1659 passed) and
green with this change (1661). It is a 5s timeout under whatever load a
concurrent-merge wave puts on the box, not a defect this entry caused.
If it reverts again, the entry to file is against that test's budget, not
against this work.

**Measured toolchain fact.** Chai truncates the value it inspects into an
assertion message at 40 chars, so `expect(rendered).toBe(NO_FINDINGS)`
alone names only the first dangling site. The message argument chai
prepends is untruncated, so the verdict passes the rendering twice
(`expectNoFindings`, tests/commentCitations.test.ts). Probed on vitest
2.1.9: a real eight-site failure's first line now carries all eight. That
40 is external, so no test here pins it; it wants a line on
.claude/rules/platform-facts.md, which a build tick cannot write.

**Unswept siblings, same shape.** pageAnchors.test.ts:259, :313, :330 and
exportConsumers.test.ts:510, :538, :565 each assert a live-tree findings
array empty, so a revert there still reports `[ ...(n) ]` and the retry
re-runs the suite to learn the site. `renderFindings`
(tests/helpers/repoProgram.ts) is where I put the renderer rather than in
commentCitations.ts as the entry predicted, because that module's header
already claims the verdict vocabulary every scan reports in — so those six
can adopt it with an import and no new helper.
