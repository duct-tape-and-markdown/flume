# Does an ancestor's `dependsOnForks` hold its subtree, the way its gate does?

A build tick's note (2026-10-07, `AN-ENTRY-INHERITS-ITS-ANCESTORS-GATES`) hit
this mid-run, read the spec literally, and pinned that reading at the site. It
asked for the human's word on the asymmetry, so it comes here.

## What shipped, and what the spec says

`spec/pending.md`, *Pickability* now reads "**An entry inherits its ancestors'
gates.** … an entry is pickable only when every ancestor's gate would pass too,
so a `blockedBy` declared once on a goal holds its whole subtree". The same
section's last paragraph explains that `dependsOnForks` is deliberately "a
side-array and not a gate kind", because one entry has exactly one gate state
while it may rest on several forks.

So the build tick read *gates* as excluding the side-array, and the shipped
fold climbs ancestors for the gate switch alone:

- the fork check runs over `entry.dependsOnForks` and precedes the climb;
- the gate switch runs over the entry and every ancestor its `parent` chain
  names.

The reading is stated in the `isPickableNow` doc comment: "The governor reads
the entry's own declaration: `dependsOnForks` is a side-array and not a gate
kind … so it is not what an ancestor hands down."

## The asymmetry

Two ways of writing one intent now behave differently:

| declared on a goal | effect on the subtree beneath it |
| ------------------ | -------------------------------- |
| `gate: parked` / `blockedBy` | holds the whole subtree |
| `dependsOnForks: ["x"]` while `x` is unresolved | holds nothing beneath it |

A goal that rests on an unresolved foundation therefore has its work picked and
shipped while the goal itself is unpickable — and a goal is never picked at all,
since `work` is the only kind selection picks. So declaring a fork at a goal is
today a declaration with no effect on anything that runs.

## The fork

1. **Inherit it.** The fold climbs ancestors for the fork check as it does for
   the gate, so "the foundation this whole goal rests on" is declared once, at
   the goal — which is the reason the gate climb exists, and the plan discipline
   already states for `blockedBy` ("a dependency the whole goal waits on is
   declared once, at the goal"). Costs: the spec sentence grows past "gates",
   and a consumer that had declared a fork on a group to document it rather
   than to gate it starts holding work back.
2. **Keep it on the entry, and say so.** The section states that a fork is the
   declaring entry's own, so a fork a subtree rests on is declared on each work
   entry that rests on it. Costs: the verbatim-copy detector — a slug repeated
   on every entry under one goal — and a group-level `dependsOnForks` that
   governs nothing stays declarable, which is the quiet half.
3. **Refuse it where it governs nothing** — a `group` carrying
   `dependsOnForks` is a queue-read refusal. Composes with (2) and closes the
   silent-declaration half; nothing to do under (1).

The lean is (1) + the spec sentence respelled: the goal of the ancestor climb
was that "tooling and selection give one answer", and a foundation is the one
thing more clearly subtree-wide than a blocker. But the side-array's own
paragraph is the human's statement of intent, and it is what the build tick
read, so the call is not the queue's to make.
