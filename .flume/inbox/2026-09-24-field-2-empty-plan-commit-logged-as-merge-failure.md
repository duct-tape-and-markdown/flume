# An empty plan commit is logged as a failed merge, and a merge failure can quarantine

Downstream field report, 0.19. A plan tick with nothing to drain commits
nothing of substance; the cherry-pick of the empty span fails (`Command
failed: git cherry-pick A..B`), is logged as a merge-stage failure, and a
merge-stage failure quarantines. Seen twice. Suggested: an empty span is
"no commit". Engine; the no-commit taxonomy (`spec/loop.md`) is where the
class lands.
