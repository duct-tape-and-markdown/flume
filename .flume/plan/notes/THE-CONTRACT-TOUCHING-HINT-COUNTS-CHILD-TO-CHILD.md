# The hint now carries both kinds; the marking is still judgment alone

Shipped: the `contractTouching` hint and the doc above
`CONTRACT_TOUCHING_FIELD` count the child-to-child contracts (entry
claims, locks, branch grammar) beside the supervisor-to-child ones, and
`tests/harnessEntryExtension.test.ts` pins the rendered hint on both
sides. Red on the base at the "two tick children" phrase.

Two observations for the next plan tick.

`harness/handoff.ts` carried the same one-sided reason in the
`beneathTheFloor` doc ("a supervisor resident at a contract that commit
just changed"). Reworded to name a process still running against the
changed contract, supervisor or sibling alike, rather than restating the
rule a third time - `CONTRACT_TOUCHING_FIELD`'s doc is its home. Worth
knowing the prose lived in two files, since a further rewording will
want the same sweep.

Nothing mechanical changed. The hint is now the longest the package
ships, and the only one carrying a two-clause rule - the cost of a field
set by plan's judgment alone with no gate behind it. If a second
livelock arrives, the engine-fence question the spec parks is the one to
reopen; until then the only defence against an unmarked child-to-child
move is that a plan tick reads this hint.
