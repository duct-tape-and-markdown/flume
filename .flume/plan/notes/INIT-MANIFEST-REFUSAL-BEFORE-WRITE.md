# The manifest refusal covers one case the entry did not name

`readConsumerManifest` (`harness/init.ts`) refuses two shapes, not one: a
`package.json` that is not parseable JSON — the entry's case — and one that
parses to a non-object (`null`, an array, a scalar). The second was the same
defect wearing a different exception: pre-fix, `null` reached
`(pkg["dependencies"])?.[name]` and escaped as a bare `TypeError`, after the
whole adoption had landed. Folding it into the one refusal rather than
leaving it to a later entry was a judgment call — both are "an input the
adoption is downstream of, unresolved", and splitting them would have put
half a refusal in the pre-write phase.

Only the entry's two titles are pinned; the non-object branch has no test of
its own. If plan wants it pinned, it is a one-case addition to
`tests/harnessInit.test.ts` beside the two that landed here.
