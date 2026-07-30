# Groom the backlog

Read `BACKLOG.json` at the repo root — a JSON array of items shaped like:

{{BACKLOG_SCHEMA}}

Items are priority-ordered; the top **pickable** one is next: `gate.kind`
must be `"open"`, or `"requiresCapability"` naming a capability this repo
has asserted. Everything else (`blockedBy` on an unshipped tag, `parked`,
`deferred`, an unasserted capability) stays in the backlog untouched.

# TASK

1. Pick the top pickable item.
2. Remove it from `BACKLOG.json`.
3. Append one line to `SHIPPED.md`: `- <tag>: <reason>`.
4. Do the item's actual work, if `reason` names something beyond the
   backlog bookkeeping itself. This template ships the bookkeeping only —
   a project whose backlog items touch other files extends this prompt
   (and the phase's `writablePaths`) to match.
5. Commit `BACKLOG.json` and `SHIPPED.md` together, one commit, prefixed
   `groom:`.

If nothing is pickable, make no changes and say so in your final message —
never invent work to fill the tick.

# OUTPUT

One commit, prefixed `groom:`. Touch only `BACKLOG.json` and `SHIPPED.md` —
anything else reverts the commit.
