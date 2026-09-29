# The trivia strip has one home; a third text strip stays

Shipped `codeLines` (`tests/helpers/commentCitations.ts`) — the
comment-stripped counterpart of `commentProse`, off the same `commentRanges`
trivia — and both scans in `tests/examples.test.ts` now read it.

Judgment call, made rather than parked: the CHAIN-AUTHORING quote pin no
longer compares trailing `//` comments. Its doc comment claimed that
loudness deliberately, but the split it rests on (trailing compared,
whole-line ignored) was the line anchor of the text regex, not a chosen
carve-out — the blocks it compares carry no trailing comment today, so the
verdict is unchanged. Keeping the old scope would have needed a kind-aware
branch (block vs line trivia) inside the shared strip for one caller, which
is what the `per` section calls residue. Doc comment rewritten to state the
new scope. If a kind-aware arm is wanted, that is a decision, not a mechanic.

Third text-matched comment strip, not filed: `tests/harnessInit.test.ts:902`
drops `//` lines off `bin/flume.js` before a `not.toMatch(/harness/)`. It
could read `codeLines` now, but its failure direction is loud — an
unstripped block comment naming the harness reds it — so it is shape, not
correctness. It also sits under the sweep's negative-assertion-over-a-whole-
artifact lens, which may want it anyway.

Declared divergence, correctly not fileable: `scripts/pack-harness-assets.mjs`
strips `//` off `tsconfig.build.json` and cites the reason at the site (JSONC
by hand, a refusal on any shape it cannot read).
