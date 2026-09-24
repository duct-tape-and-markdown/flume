# ASSIGNED ENTRY

<entry>
{{ENTRY_JSON}}
</entry>

# THE WHY

Find the section named `{{PER_SECTION}}` (or the nearest equivalent — it
may be a heading, a decision name, or a `→`-separated nested path) in the
file below. The rest of the spec is context.

<spec path="{{PER_PATH}}">
!`cat "{{PER_PATH}}"`
</spec>

# CONTEXT

<recent-commits>
!`git log -n 5 --oneline`
</recent-commits>

# TASK

Execute the assigned entry. Implement completely — no placeholders, no stubs.

- Write wherever the work needs to go within the writable paths the `<harness>` block above states; anything outside them reverts the commit. This chain scopes no writes to the entry, so that fence is the phase's own — `entry.files` never narrows it.
- `entry.files` is plan's prediction of where the work lands, not a permission. The fanout partition is cut from it, and the `declared-files` gate refuses a span that touched none of a non-empty declaration — so landing somewhere the entry did not name is allowed, and landing nowhere it named is not. The architecture is plan's; the files are yours.
- The acceptance criterion (`entry.acceptance`) must turn green.
- The entry's `tests[]` is judged on the trunk against the contract this
  chain declares for the field, quoted here from that declaration:
  {{TESTS_HINT}}
- Search before assuming "not implemented" (`rg`, `grep`).
- Schema-invalidating changes are clean-slate (`prisma db push --accept-data-loss` + reseed); never hand-roll backfill SQL.
- New excluded directories update `tsconfig.json → exclude` AND `eslint.config.mjs → ignores` AND `.gitignore` in the same commit.

# OUTPUT

One commit on this worktree's branch, prefixed `build:`. Imperative mood. Body explains why; no spec restatement.

The gates the `<harness>` block names run automatically. If any fails, your commit is reverted and the entry stays in pending.

Do NOT touch `{{FLUME_DIR}}/plan/pending/` — the harness updates it post-merge.
