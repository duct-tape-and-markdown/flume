# ASSIGNED ENTRY

<entry>
{{ENTRY_JSON}}
</entry>

# THE WHY

<per>
!`sed -n '/^#\+ {{PER_SECTION}}/,/^#\+ /p' {{PER_PATH}} 2>/dev/null | head -80`
</per>

# CONTEXT

<recent-commits>
!`git log -n 5 --oneline`
</recent-commits>

# TASK

Execute the assigned entry. Implement completely — no placeholders, no stubs.

- Touch only the files declared in `entry.files`. Anything else reverts the commit.
- The acceptance criterion (`entry.acceptance`) must turn green.
- Search before assuming "not implemented" (`rg`, `grep`).
- Schema-invalidating changes are clean-slate (`prisma db push --accept-data-loss` + reseed); never hand-roll backfill SQL.
- New excluded directories update `tsconfig.json → exclude` AND `eslint.config.mjs → ignores` AND `.gitignore` in the same commit.

# OUTPUT

One commit on this worktree's branch, prefixed `build:`. Imperative mood. Body explains why; no spec restatement.

Validation gates (tsc, tests, lint, writable-paths) run automatically. If any gate fails, your commit is reverted and the entry stays in pending.

Do NOT touch `.flume/plan/pending.json` — the harness updates it post-merge.
