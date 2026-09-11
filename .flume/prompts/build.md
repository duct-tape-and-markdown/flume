# ASSIGNED ENTRY

<entry>
{{ENTRY_JSON}}
</entry>

# THE WHY

The section the entry's `per` cites, from `{{PER_PATH}}` as this tick's tree holds it. The rest of that file is context for the broader ship target — open it when an adjacent section matters.

<spec path="{{PER_PATH}}" section="{{PER_SECTION}}">
{{PER_SECTION_TEXT}}
</spec>

# CONTEXT

<recent-commits>
!`git log -n 5 --oneline`
</recent-commits>

# TASK

Execute the assigned entry. Implement completely — no placeholders, no stubs.

- Touch only the files declared in `entry.files` ∪ the phase's `entryChannelPaths` (`.flume/chain.ts`) — the effective fence. Anything else reverts the commit.
- **Your one note to plan is `.flume/plan/notes/{{TAG}}.md`** (`.flume/PROTOCOL.md`, *Records: one file each*). Something the next plan tick should know — debt observed, a surprising pattern, a blocker — goes there, never into `open-questions.md`. First line `# <title>`; then what you observed, where, and why it matters, within 1,200 bytes. The `records` gate reverts a commit that writes any other record, or one over the cap.
- If edits the work genuinely requires fall outside that fence, do not commit the work into a guaranteed revert. Park the conflict in that note — the violating paths and why the entry cannot ship without them — and **commit the note, and nothing else, as the commit's only changed file** (`build:` prefix) before exiting. That shape *is* the park signal: this chain's `build.shipped` predicate (`.flume/chain.ts`) reads a commit whose sole touched path is your note and keeps the entry in the queue. Touch anything else in the same commit and it counts as a ship, so the entry leaves the queue with the work undone. An uncommitted park dies with the worktree and plan wakes blind. Plan widens the declaration or splits the entry next tick. (`spec/worktrees.md`, *In-worktree gate reverts leave a trunk footprint*) Write the note — and every channel path — through its bare relative path only, never an absolute path you constructed (e.g. from `git worktree list` output): an absolute path can silently target the trunk checkout's copy instead of this worktree's, dirtying trunk and blocking the dispatcher's cherry-pick.
- If `entry.files` names paths outside the build phase's `writablePaths` in `.flume/chain.ts`, do not attempt to ship and do not pivot to a different path. Park the path / writablePaths gap in your note the same way — a single-file committed park — then exit. Plan re-derives next tick and routes it.
- The acceptance criterion (`entry.acceptance`) must turn green.
- Each `tests[]` line names a behavior. Title one passing test with that line verbatim — the test's full name (describe titles plus its own) must contain the line. The `vitest` gate reverts a commit whose named behaviors have no passing test.
- Search before assuming "not implemented" (`rg`, `grep`).
- New excluded directories update `tsconfig.json → exclude` AND `.gitignore` in the same commit.
- Do NOT write a changelog line. The release changelog is built from git history before a release cut, so your commit message *is* the record — write the body accordingly: what changed and why, in terms a release note can be derived from.

# OUTPUT

One commit on this worktree's branch, prefixed `build:`. Imperative mood. Body explains why; no spec restatement.

Validation gates (tsc, vitest, writable-paths) run automatically. If any gate fails, your commit is reverted and the entry stays in pending.

Do NOT touch `.flume/plan/pending.json` — the harness updates it post-merge.
Do NOT touch `spec/**` — spec is human-directed; it changes only in interactive sessions under explicit direction, never from a build tick.
