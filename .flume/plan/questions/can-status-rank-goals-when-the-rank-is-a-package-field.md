# Can `flume status` print goals in rank order when the rank is a package field?

`spec/cli.md`, *`flume status` owes exactly this* adds item 9: "**Goals** — one
line per goal, in rank order: its remaining `work` entries and how long it has
stood." Item 10, Flow, is derived (STATUS-REPORTS-THE-QUEUES-FLOW); Goals is
not, because the engine cannot read the number the line is ordered by.

**Why.** `spec/pending.md`, *The entry core* takes `priority` out of the core,
and `spec/harness.md`, *Goals and decomposition* puts the rank on the goal:
"plan-inbox files it as a root `group` carrying that rank". A rank the engine
never consumes is convention, so its home is the package's entry extension
(THE-GOAL-RANK-IS-THE-ONLY-RANK-AND-ONLY-INBOX-SETS-IT files it there). But
`flume status` is engine code, and an extension field reaches it only as
`unknown` under a key the engine does not own — reading it would be the engine
keying on a name a chain authored (`.claude/rules/engine-boundary.md`, *Told,
not inferred*).

So status can find the goals — a root `group` is core, `kind` and `parent` are
core — and can say how long each has stood and which `work` entries remain
beneath it. It cannot put them in rank order.

- **(a) Status prints goals in the queue's own order, not rank order.** One
  word of the spec changes. The engine prints every root `group` in the order
  the default queue order gives (oldest filing, then tag), with its remaining
  work and its age. For: no new surface; everything printed is core. Against:
  the operator's own ranking is the one fact they came to the line for, and the
  printed order would silently disagree with the order the queue is served in.
- **(b) A chain hook orders what status prints.** `Chain.order` already exists
  for pickable `work`; a sibling — or `order` called over the groups — lets the
  package rank them and the engine stay ignorant. For: the rank stays the
  package's, the line stays ranked. Against: a second ordering hook for one
  CLI line, and `Chain.order`'s own contract is "pickable `work` entries"
  (`spec/chain.md`), so widening it rewrites that section.
- **(c) The goal rank is core after all.** A small typed `rank` on `group`
  entries, consumed by nothing but this line and whatever `order` a chain
  writes. For: the line is trivially right and the gate stays as spec'd.
  Against: it is exactly the field the spec just deleted, re-entering under a
  new name — the engine would hold a number it does not act on, which is the
  convention-policing `engine-boundary.md` fences.

My read is **(b)** if the Goals line is worth a hook and **(a)** if it is not;
(c) re-opens the decision `255db50c` just made. What I would not do is have
status pattern-match a package field name, which is the only way to get the
line as written without one of the three.

**Blocking on:** nothing. STATUS-REPORTS-THE-QUEUES-FLOW ships item 10 on its
own and does not touch the Goals half.
