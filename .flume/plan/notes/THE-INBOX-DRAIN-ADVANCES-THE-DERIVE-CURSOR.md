# The cursor-advance bounds are prose with nothing under them

Two slices now write `derivedThrough` (`harness/prompts/plan-inbox.md`,
the advance paragraph; `harness/prompts/plan-discipline.md`, the plan
state bullet). Both bounds on the inbox drain's advance -- only through a
leading run of listed commits, and only to a sha the rendered window
named -- live at the ladder's bottom rung. Nothing refuses a plan commit
that moves the cursor to a sha the block never listed, and a wrong
advance is silent: the derive slice simply never opens on the commits
stepped over.

A gate can hold the second bound decidably. `derivedThrough` in the
commit must be an ancestor of the tip and a descendant of (or equal to)
its pre-commit value; a stronger form reads the plan commit's own parent
and refuses a value outside `old..HEAD`. The first bound (did the routed
records really cover that commit) stays judgement.

Also amended: `plan-discipline.md` said a slice leaves every other field
byte-identical, which forbade this entry outright. Not in the entry's
`files` -- flagging so the contradiction is not re-derived as a finding.
