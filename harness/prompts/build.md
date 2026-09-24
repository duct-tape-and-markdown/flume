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
- **Your note to plan is `{{NOTE_PATH}}`** — one file, yours alone, and build's only channel to the next plan tick. Something that tick should know — debt observed, a surprising pattern, a blocker — goes there, never into the questions directory, which is plan's. First line `# <title>`; then what you observed, where, and why it matters, within {{RECORD_MAX_BYTES}} bytes — bytes, not characters: `wc -c` the file you wrote, since an em-dash is three. Over the cap is not a revert; it ships, and the tick that drains it names the overrun. That path, `{{PARK_NOTE_PATH}}` and `{{CONTINUING_NOTE_PATH}}` below are the only records this tick may write; the records gate reverts a commit that writes any other.
- If the entry cannot ship as written — its premise is contradicted by the tree, it needs a decision nobody has made, the work is already shipped — do not build around it. Park: say why in a note at **`{{PARK_NOTE_PATH}}`** instead of the path above, and commit it (`build:` prefix) before exiting. **That directory is the park signal**: the package's `shipped` predicate reads a commit carrying a note at that path and keeps the entry in the queue, whatever else the commit touched — so a refusal that could not help leaving a file behind is still a refusal, and you never strip a commit down to prove one. The converse holds too: a note at `{{NOTE_PATH}}` is an observation, and the entry leaves the queue as shipped. An uncommitted park dies with the worktree and plan wakes blind. Write whichever note you write through the path named here exactly as given, never one you construct yourself (e.g. from `git worktree list` output): a hand-built path can silently target the trunk checkout's copy instead of this worktree's, dirtying trunk and blocking the dispatcher's cherry-pick.
- The acceptance criterion (`entry.acceptance`) must turn green.
- **If the room is running out, put the work down rather than be cut off by it.** A budget line arrives after a tool call with context used against the model's window, elapsed wall clock, and tool calls so far — facts, and these are the thresholds. At **70% of the window**, open no new ground: land the segment you are already in. At **80%**, stop — commit the coherent, green segment you have and write a **continuing note** at `{{CONTINUING_NOTE_PATH}}`: what landed, what is next, and where the next tick should look, in the same `# <title>` shape and the same {{RECORD_MAX_BYTES}}-byte cap as the note above. The entry stays in the queue with your commit on the trunk, and the next tick on it is handed your note. **Continuing is your declaration, never something inferred from how far you got**: a tick that runs out of context, turns, or wall clock without writing the note is a preempt, and everything it had not committed dies with the worktree. The entry is the goal and the tick is not the bound — this is for an entry that will not fit, never a licence to stop while the room is there, and never a way to land work that is not green. Exactly one of the three note paths named here is yours to write: the one you wrote is the whole statement. No budget line at all means this chain declared no window, and the same call is yours to make on your own reading.
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
