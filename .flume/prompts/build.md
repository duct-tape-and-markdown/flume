# ASSIGNED ENTRY

<entry>
{{ENTRY_JSON}}
</entry>

# THE WHY

Find the section named `{{PER_SECTION}}` in the spec. The rest of the spec is context for the broader ship target; cross-reference adjacent sections as needed.

<spec path="{{PER_PATH}}">
!`cat {{PER_PATH}} 2>/dev/null || echo "(spec not found: {{PER_PATH}})"`
</spec>

# CONTEXT

<recent-commits>
!`git log -n 5 --oneline`
</recent-commits>

# TASK

Execute the assigned entry. Implement completely — no placeholders, no stubs.

- Touch only the files declared in `entry.files`. Anything else reverts the commit.
- If `entry.files` names paths outside the build phase's `writablePaths` in `.flume/chain.ts`, do not attempt to ship and do not pivot to a different path. Exit without committing; state the path / writablePaths gap in your final message. Plan re-derives next tick and routes it as an open question.
- The acceptance criterion (`entry.acceptance`) must turn green.
- Search before assuming "not implemented" (`rg`, `grep`).
- New excluded directories update `tsconfig.json → exclude` AND `.gitignore` in the same commit.

# OUTPUT

One commit on this worktree's branch, prefixed `build:`. Imperative mood. Body explains why; no spec restatement.

Validation gates (tsc, vitest, writable-paths) run automatically. If any gate fails, your commit is reverted and the entry stays in pending.

Do NOT touch `.flume/plan/pending.json` — the harness updates it post-merge.
Do NOT touch `spec/**` — the spec corpus is human-curated.
