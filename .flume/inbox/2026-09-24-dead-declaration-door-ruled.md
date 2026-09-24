# Ruled: the dead-declaration rule holds wherever a declaration is first read

Answers `questions/does-the-dead-declaration-rule-hold-past-the-loader.md`:
(a). `spec/chain.md`, *A dead declaration is refused at load* now says the
loader is the rule's usual door, not its boundary: a value a chain composes
per tick is refused where it is first assembled, and the budget's
thresholds-without-a-window is the second instance (this ruling's commit).
No entry; the refusal already ships.
