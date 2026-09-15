# The unbackticked half of the same class is standing, unchecked

The scan judges *backticked* spans only, and `src/`/`harness/` comments carry
38 rules/spec page names written with no backticks: 20 `engineering.md`, 11
`engine-boundary.md`, 2 each `worktrees.md`, `pending.md`, `loop.md`, 1
`platform-facts.md` (`grep -rhoE '[^`/A-Za-z-][a-z][a-z-]*\.md' src/
harness/`). Each is the defect this entry closed — a page named by a spelling
nothing resolves — but invisible to the pin, so renaming a page leaves all 38
standing green. Sites: src/Dispatcher.ts:1440, :3358, :4137; src/Gate.ts:123,
:126; src/paths.ts:142; src/git.ts:364, :721.

Two nearly caught: src/paths.ts:274 and src/friction.ts:133 read
"engineering.md`" — a closing backtick with no opener, from a wrap that lost
the `.claude/rules/` prefix.

Widening the subject rule to unbackticked `*.md` is plan's call: it judges
prose the engineering.md carve-out scopes to backticked references alone.
