# The claim check needed a placement knob, and the spec still says afterCommit

`spec/pending.md`, *`pendingGate` — validation and fence pre-check as an
opt-in builtin*, opens "is an `afterCommit` gate", then lists the claim check
as its third. The entry wants that check on the merged tree. One `Gate` has
one `when`, so this shipped `PendingGateOptions.when` (default `afterCommit`,
the same injection point `PkgManagerOverride` already carries) and the harness
attaches two instances on each plan slice. **The spec sentence is now the
default rather than the whole truth** — a human may want it to read that way.

Consequence plan should weigh: the merged-tree instance re-runs checks 1 and 2
over the merged queue. Never a duplicate refusal in practice (a span that
failed them at `afterCommit` never reaches the merge), but it is not a
claim-check-only gate, and it costs a queue parse per plan merge. A
claim-check-only gate would have been cheaper and would have wired uniformly;
it was declined because the spec numbers the check *inside* `pendingGate`.

That non-uniformity is the first in `harnessGates` — the module doc claimed
one set for every phase and now carves this member out by name. `build` gets
the `afterCommit` instance alone: its fence admits no entry file, so the
merged placement there would re-parse the whole queue to say nothing. Read off
`PLAN_SLICES`, so a fourth slice joins it automatically.

Drive-by, same function: `pendingGate` composed `join(ctx.stateRootRel,
displayPath)` and handed it straight to git — host-native, so backslashes on
win32 against a pathspec that matches nothing (`.claude/rules/posture-sweep.md`,
*A repo-relative path composed with `node:path`*). Folded once through
`gitPath` now, and the claim check reads the same value. No test pins the
win32 arm; the lane that would red is not this host's.

`EntryClaimStore.readLive` is now derived from a new `readHolders` — the gate
needs the pid, selection needs only the key.
