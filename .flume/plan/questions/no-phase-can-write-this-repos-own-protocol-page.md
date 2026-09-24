# `.flume/PROTOCOL.md` is stale on the note homes, and no phase can write it

From note `A-CONTINUING-NOTE-IS-A-THIRD-NOTE-HOME`. Verified on disk this
tick, all three halves.

## The stale line

`.flume/PROTOCOL.md:77` ("Build notes") names two note homes —
`.flume/plan/notes/<TAG>.md` and `.flume/plan/notes/parked/<TAG>.md`. There
are three since `a7873c4a`: `harness/templates/PROTOCOL.md:71` carries the
"Build continuations" bullet, `harness/layout.ts:147` carries
`CONTINUING_NOTES_REL`, and `harness/prompts/build.md:31` tells the agent
"Exactly one of the three note paths named here is yours to write."

So a build agent that follows `CLAUDE.md` to this repo's PROTOCOL for "project
conventions for the chain" reads a two-home list that its own prompt
contradicts.

## Nothing in the loop can fix it

`.flume/PROTOCOL.md` is in no fence. Build's is `.flume/declaration.ts:17`
(`src/**`, `harness/**`, `docs/**`, `tests/**`, … and no `.flume/` path);
the plan slices write only `.flume/plan/**` and `.flume/inbox/**`. So this
is not a pending entry — the discipline file is explicit that a path outside
build's fence is a question proposing a fence amendment, never an entry.

## The recurring shape, which is the actual question

This page drifts every time the harness gains a record home, a phase, or a
gate, and nothing detects it. The fix for today's line is one human edit; the
fork is what stops the next one.

1. **Leave it manual.** An interactive session edits the page when the
   harness changes. Honest about who owns it; the failure mode is exactly
   what happened here — the harness commit shipped and the page did not, and
   only a build agent's incidental note caught it.
2. **Widen build's fence to `.flume/PROTOCOL.md`.** Then the commit that
   adds a note home updates the page in the same tick. Cost: it puts a
   chain-convention document, which `CLAUDE.md` and `memory.md` both treat
   as the human's inter-phase surface, inside an autonomous phase's reach.
3. **Pin the two pages against each other** — this repo's PROTOCOL against
   `harness/templates/PROTOCOL.md`. I think this one is closed off, and it is
   worth saying why: `.claude/rules/engineering.md`, *Narration is the
   ladder's bottom rung* rules that a suite reading prose against prose is
   harness governance wearing engine discipline, and the three carve-outs
   (the `.d.ts` hover text, a page stating what a shipped interface does, a
   resolvable token) reach none of this. A pin here would be the page's
   authors' own rule turned against them.

A fourth, narrower than 2: admit the page to the fence **only** for the
harness's own commits (`chore(flume):`), which is where the drift is born.
Whether the fence can express that is yours — I did not check.

My read: 1 plus a lens, if a lens can be written that does not read prose
against prose. If not, 2 is the honest one, and the page's ownership line in
`memory.md` moves with it.
