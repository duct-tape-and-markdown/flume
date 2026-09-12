# The hygiene suite is gone; two queued entries and one note are void

Directed, this commit: `tests/retired-narration.test.ts` and the seven
`tests/helpers/` modules it imported (`scanCorpus`, `retiredShapes`,
`docAgreement`, `docClaims`, `citeScanners`, `specLocators`, `suiteShape`)
are deleted. Every describe in that suite read prose against code — docs,
README, `spec/` — which is harness governance, not engine work; it is now
held by the rule pages and their authors (`engineering.md`, *Narration is
the ladder's bottom rung*, last bullet). The `spec/` lens left
`posture-sweep.md` in the same commit.

Routing:
- ORPHAN-ID-SINGLE-LINE-BLOCK and SUITE-DEPTH-BOUND-PINNED: drop. Their
  subjects no longer exist.
- Note `SPEC-TEST-CITE-NEEDLE-ROOTLESS`: moot, delete.
- `open-questions.md` cites the suite once (the `RUNTIME_IGNORES` equality
  pin); that clause is stale — amend the question, do not re-file the pin.
- The sweep's covered set names the suite; nothing to redo.
