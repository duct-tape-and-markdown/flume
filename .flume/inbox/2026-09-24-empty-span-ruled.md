# Ruled: an empty span is a clean exit

Answers `questions/an-empty-span-is-not-a-merge-failure.md`: option 2.
`spec/loop.md`, *The no-commit taxonomy* now reads `clean-exit` as the agent
exiting without a usable commit — none at all, or a span whose diff against
its base is empty — so the union stays closed at four, the empty commit
dies with the worktree, a producer resolves it as it resolves any clean
exit, and nothing reaches the merge stage or its quarantine (this ruling's
commit). The span's shas on the record keep "declined" and "committed
nothing" tellable apart. File it.
