# Field: two loops in one repository collide in the branch namespace

Downstream report, 0.19, item 4. Priority 30. A tick's branch is always
`flume/<slug>` (`src/worktrees.ts`, the branch composition), and a singleton
phase's slug is its phase name, so a second state root in the same clone
fails to provision: "'flume/plan-derive' is already used by worktree at …".
The consumer runs three efforts in one clone, each with its own `FLUME_DIR`.

The engine holds the fact that separates them, the state root, so the fix is
mechanism: a branch composed under a namespace derived from the state root
the run resolved, or a declared prefix. Repro to reduce: two state roots in
one repository, one singleton tick each, the second refused at provision.
Route as an entry if the spec's worktree section already names the branch
shape, or as a question naming both forks if choosing needs a ruling.
