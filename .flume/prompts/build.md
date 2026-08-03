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

- Touch only the files declared in `entry.files` ∪ the phase's `entryChannelPaths` (`.flume/chain.ts`) — the effective fence. Anything else reverts the commit.
- If edits the work genuinely requires fall outside that fence, do not commit the work into a guaranteed revert. Park the conflict in `.flume/plan/open-questions.md` — the violating paths and why the entry cannot ship without them — and **commit that single-file park** (`build:` prefix; the channel allows the path, and ship-detection keeps a channel-only commit from clearing the entry) before exiting. An uncommitted park dies with the worktree and plan wakes blind. Plan widens the declaration or splits the entry next tick. (spec v0.7 §13)
- If `entry.files` names paths outside the build phase's `writablePaths` in `.flume/chain.ts`, do not attempt to ship and do not pivot to a different path. Park the path / writablePaths gap in `.flume/plan/open-questions.md` the same way — a single-file committed park — then exit. Plan re-derives next tick and routes it.
- The acceptance criterion (`entry.acceptance`) must turn green.
- Search before assuming "not implemented" (`rg`, `grep`).
- New excluded directories update `tsconfig.json → exclude` AND `.gitignore` in the same commit.
- If this commit touches `src/`, write your changelog record to **`.changeset/{{TAG}}.md`** — not `CHANGELOG.md`. Same content you would have added under `[Unreleased]` (a `### Breaking` heading when it belongs there). One file per entry is what lets a wave run parallel: a shared `CHANGELOG.md` makes every entry collide with every other at partition time and conflict at cherry-pick. It rides the channel, so it needs no declaration in `entry.files`.

# OUTPUT

One commit on this worktree's branch, prefixed `build:`. Imperative mood. Body explains why; no spec restatement.

Validation gates (tsc, vitest, writable-paths) run automatically. If any gate fails, your commit is reverted and the entry stays in pending.

Do NOT touch `.flume/plan/pending.json` — the harness updates it post-merge.
Do NOT touch `spec/**` — spec is human-directed; it changes only in interactive sessions under explicit direction, never from a build tick.
