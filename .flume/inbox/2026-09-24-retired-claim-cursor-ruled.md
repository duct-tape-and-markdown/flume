# Ruled: the sweep carries a retired-claim cursor beside the stamp

Answers `questions/where-does-a-closed-retired-claim-delta-get-recorded.md`:
(1). `retiredThrough` in sweep's state file, advanced by the tick that
searched the deleted lines while the stamp stays put, with its may-move
rule in the slice-state table; `spec/harness.md`, *Plan state as declared
state* and `.claude/rules/posture-sweep.md`, *The stamp* name it (this
ruling's commit). File it.
