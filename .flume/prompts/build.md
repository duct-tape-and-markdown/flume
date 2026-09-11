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

- Write wherever the work needs to go within the build phase's `writablePaths` (`.flume/chain.ts`); anything outside them reverts the commit. `entry.files` is plan's prediction of where the work lands, read by the scheduler — not a fence, and not a plan you must follow. The architecture is plan's; the files are yours.
- **Your one note to plan is `.flume/plan/notes/{{TAG}}.md`** (`.flume/PROTOCOL.md`, *Records: one file each*). Something the next plan tick should know — debt observed, a surprising pattern, a blocker — goes there, never into `open-questions.md`. First line `# <title>`; then what you observed, where, and why it matters, within 1,200 bytes. The `records` gate reverts a commit that writes any other record, or one over the cap.
- If the entry cannot ship as written — its premise is contradicted by the tree, it needs a decision nobody has made, the work is already shipped — do not build around it. Park: say why in that note, and **commit the note, and nothing else, as the commit's only changed file** (`build:` prefix) before exiting. That shape *is* the park signal: this chain's `build.shipped` predicate (`.flume/chain.ts`) reads a commit whose sole touched path is your note and keeps the entry in the queue. Touch anything else in the same commit and it counts as a ship, so the entry leaves the queue with the work undone. An uncommitted park dies with the worktree and plan wakes blind. Write the note through its bare relative path only, never an absolute path you constructed (e.g. from `git worktree list` output): an absolute path can silently target the trunk checkout's copy instead of this worktree's, dirtying trunk and blocking the dispatcher's cherry-pick.
- The acceptance criterion (`entry.acceptance`) must turn green.
- The entry's `tests[]` and `pins[]` are judged by the `vitest` gate against the contract this chain declares for each field, quoted here from those declarations (a line's test is matched on its full name — describe titles plus its own):
  - `tests[]`: {{TESTS_HINT}}
  - `pins[]`: {{PINS_HINT}}

  A `tests[]` line that already passes on the pre-fix tree reverts the commit, and that is plan's to fix, not yours — do not restructure a test to fail on the base; ship the work as named and let the record reach plan.
- Search before assuming "not implemented" (`rg`, `grep`).
- New excluded directories update `tsconfig.json → exclude` AND `.gitignore` in the same commit.
- Do NOT write a changelog line. The release changelog is built from git history before a release cut, so your commit message *is* the record — write the body accordingly: what changed and why, in terms a release note can be derived from.

# OUTPUT

One commit on this worktree's branch, prefixed `build:`. Imperative mood. Body explains why; no spec restatement.

Validation gates (tsc, vitest, writable-paths) run automatically. If any gate fails, your commit is reverted and the entry stays in pending.

Do NOT touch `.flume/plan/pending.json` — the harness updates it post-merge.
Do NOT touch `spec/**` — spec is human-directed; it changes only in interactive sessions under explicit direction, never from a build tick.
