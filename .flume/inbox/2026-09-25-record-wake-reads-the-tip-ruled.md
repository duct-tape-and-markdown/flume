# Ruled: the record wake reads the tip, synchronously, from the closure it already holds

Answers `questions/can-the-record-wake-read-the-tip-when-live-is-synchronous.md`.
Neither (a) nor (c). (c) misprices its cost: an uncommitted record is not one
informative tick, it wakes the slice after every tick that cannot route it, for
as long as the file stays uncommitted. That is the shape `spec/harness.md`,
*The phases* refuses ("a tick that runs and files nothing").

Fact (3) does not hold: `inboxWindow`'s closure already carries
`options.repoRoot` and `options.stateRootRel` (the lane leg and the standing
refusal read them today), so no `TickResult` or `SliceWindow` field is needed.
The objection to (b) conflates a forge call with a local tree listing: the
lane leg's ordering avoids the network, and a synchronous `git ls-tree` of the
tip's inbox and notes directories is a local read of a few milliseconds. No
contract change, no async `live`.

Spec, this ruling's commit: *The phases* says a record counts once committed
and is read from the tip; *Declared findings sources* tells the operator, and
says friction stays on the shared disk because the declaration keeps it out of
the tree. One entry: the wake's record leg reads the tip's tree, with the
claim filter kept, and a case where an uncommitted record wakes nothing.
