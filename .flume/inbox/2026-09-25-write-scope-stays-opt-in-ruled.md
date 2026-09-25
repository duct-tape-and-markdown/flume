# Ruled: write scoping stays opt-in; the pairing is documented

Answers `questions/does-the-harness-build-phase-scope-writes-to-the-entry.md`.
(b), by the operator. The harness build phase keeps `scopeWritesToEntry`
off, per `spec/pending.md`, *The entry-scoped write guard is opt-in, and off
by default*, and this repo's measured width loss when it was on. Priority 30,
field report item 15. One docs entry: `docs/CHAIN-AUTHORING.md` beside the two
fields says a phase that legitimately writes shared files pairs
`scopeWritesToEntry` with `entryChannelPaths`, and carries the reporter's
numbers (three of ten conflicts on undeclared paths) against this repo's
(width 3.17 to 1.99) so a consumer weighs the trade with both.
