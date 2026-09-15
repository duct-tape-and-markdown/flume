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

{{DOMAIN}}

# TASK

Execute the assigned entry. Implement completely — no placeholders, no stubs.

- Write wherever the work needs to go within the writable paths the `<harness>` block above states; anything outside them reverts the commit. `entry.files` is plan's prediction of where the work lands, read by the scheduler — not a fence, and not a plan you must follow. The architecture is plan's; the files are yours.
- **Your one note to plan is `{{NOTE_PATH}}`** — one file, yours alone, and build's only channel to the next plan tick. Something that tick should know — debt observed, a surprising pattern, a blocker — goes there, never into the open-questions file, which is plan's. First line `# <title>`; then what you observed, where, and why it matters, within {{RECORD_MAX_BYTES}} bytes. The records gate reverts a commit that writes any other record, or one over the cap.
- If the entry cannot ship as written — its premise is contradicted by the tree, it needs a decision nobody has made, the work is already shipped — do not build around it. Park: say why in that note, and **commit the note, and nothing else, as the commit's only changed file** (`build:` prefix) before exiting. That shape *is* the park signal: the package's `shipped` predicate reads a commit whose sole touched path is your note and keeps the entry in the queue. Touch anything else in the same commit and it counts as a ship, so the entry leaves the queue with the work undone. An uncommitted park dies with the worktree and plan wakes blind. Write the note through the path named above exactly as given, never one you construct yourself (e.g. from `git worktree list` output): a hand-built path can silently target the trunk checkout's copy instead of this worktree's, dirtying trunk and blocking the dispatcher's cherry-pick.
- The acceptance criterion (`entry.acceptance`) must turn green.
- The entry's `tests[]` and `pins[]` are judged against the contract the package declares for each field, quoted here from those declarations (a line's test is matched on its full name — describe titles plus its own):
  - `tests[]`: {{TESTS_HINT}}
  - `pins[]`: {{PINS_HINT}}

  A `tests[]` line that already passes on the pre-fix tree reverts the commit, and that is plan's to fix, not yours — do not restructure a test to fail on the base; ship the work as named and let the record reach plan.
- Search the tree before assuming "not implemented".
- Do NOT write a changelog line. The release changelog is built from git history before a release cut, so your commit message *is* the record — write the body accordingly: what changed and why, in terms a release note can be derived from.

{{TURN_BOUNDARY}}

{{AUTONOMY}}

# OUTPUT

One commit on this worktree's branch, prefixed `build:`. Imperative mood. Body explains why; no spec restatement.

The gates the `<harness>` block names run automatically. If any fails, your commit is reverted and the entry stays in pending.

Do NOT touch the pending queue — the harness updates it after the merge.
Do NOT touch anything inside the spec locus ({{SPEC_LOCUS}}), the file your `per` cites included: the spec is human-directed and changes only under explicit direction, never from a build tick.
