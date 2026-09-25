# Two state roots in one clone: enforce the checkout rule, or namespace the branch?

A downstream 0.19 report (item 4) runs three efforts in one clone, each with
its own `FLUME_DIR`. A tick's branch is `flume/<slug>`
(`src/worktrees.ts:471`) and a singleton phase's slug is its phase name, so the
second state root's `plan-derive` tick fails to provision: `'flume/plan-derive'
is already used by worktree at …` — git's words, not flume's.

## The spec already rules, and the consumer is outside it

`spec/jobs.md`, *The checkout is the unit of isolation*: "One state root per
checkout, and a repository running several efforts at once gives each one a
checkout of its own… The engine partitions no state below the checkout: it
mints no per-effort namespace, seeds no second root, and offers no selector
that retargets one." `spec/worktrees.md`, *Placement — the worktree base*
repeats it: "The engine mints no namespace beneath the base. Two efforts are
two checkouts."

So the reported fix — a branch namespaced by the resolved state root — is a
spec change, not an entry. **But the gap is real in the other direction**:
`FLUME_DIR` is an engine-supported relocation knob, nothing refuses a second
state root in a clone at the moment one is resolved, and the collision instead
surfaces several steps later, in git's vocabulary, at provisioning time. The
engine permits a shape its spec declines, and says so only by failing.

## The fork

**(a) Enforce the ruling where it is broken.** A tick whose resolved state root
is not the one this checkout's other flume state names refuses at resolution,
naming both roots and the checkout — the shape `spec/worktrees.md` already uses
for a shared `FLUME_WORKTREES_DIR` ("refuses the tick naming the path… loud,
and the operator's to resolve by not sharing the base"). Keeps the isolation
ruling; turns a late git error into an early flume one. Cost: an operator with
a legitimate transient second root is refused.

**(b) Relax the ruling and namespace the branch.** The state root is a fact the
engine holds, so `flume/<root-namespace>/<slug>` is mechanism, not convention.
Cost: it contradicts the "Why" in *The checkout is the unit of isolation* —
"everything the engine keys by is already the checkout's — the tip a claim is
taken on, the branch a worktree is minted from, the install a setup provisions,
the tree a gate reads. A second axis beneath it names the same work twice and
separates none of it." Namespacing the branch fixes the *name* collision while
the two efforts still share one tip and one tip claim, so they still serialize.
That looks like a fix and is not one.

**(c) Neither — document it.** The consumer's configuration is unsupported;
`docs/` gains the sentence, and the report closes.

## Why this is the human's

(b) reverses a stated architectural ruling on the strength of one consumer's
setup, and by the spec's own "Why" would not buy them parallelism anyway — that
is the architectural-misstep flag, not a solution to pick. (a) is the change I
would propose if the ruling stands; it is still a new refusal on every tick's
path and wants a ruling before it is filed.

**Repro to reduce if (a) is chosen:** two state roots in one repository, one
singleton tick each, the second refused at resolution rather than at provision.
