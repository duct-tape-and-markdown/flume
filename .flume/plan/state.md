# State

Phase: v0.9 "the doctrine line" shipped and audited. One commit landed
since the last `plan:` commit (`ad87a6f`): `76b6ab9` (`chore(flume):`,
human/interactive, landed mid-tick — see below).

Mode: audit. `76b6ab9` reviewed: direct rules+chain.ts edit (not a build
entry, no `per` cite expected — same lane as `2874c2c`). It adds the
`engineering.md` "names its retiring actor" / "condition not era" bullets
and the `posture-sweep.md` expired-narration lens, and fixes the exact
specimen this tick's own sweep had independently found (chain.ts:425-429's
v0.6-era model-pin comment) by splitting the pin per phase via the
pre-existing `Phase.agent` capability — no engine change, confirmed
against `src/Phase.ts:115`. No drift, no action needed; an open question
I'd drafted for that same finding was retracted as moot once the commit
surfaced (net no-op on open-questions.md). spec-delta, inbox, and
unblock-promote stay empty. `pending-now` re-verified against disk,
unchanged.

## Queue (5)

Head: GITIGNORE-RUNTIME-ARTIFACTS. Then CHANGELOG-0.9.0-BACKFILL,
SCHEMA-PROMPT-AGREEMENT-GATE, PARSEPENDINGLOOSE-WRITE-PATH-PIN,
PENDING-GATE-HINT-OPTION — unchanged, ascending priority.

## Open questions (4)

Unchanged: pendingGate dual-violation report; setupWorktree/gate
manager-detection sharing; win32 inline-exec argv mangling; `<exec-failed>`
loud-or-nothing.

## Posture sweep

Posture swept through: `2874c2c` (carried forward; rotation open — not
advanced, since the frontier hasn't emptied).

`76b6ab9` is a phrase delta (touches `.claude/rules/{engineering,
posture-sweep}.md` directly): per posture-sweep.md, this re-arms the
*entire* sweep domain, since the new bullets/lens have been applied to
nothing yet. `src/Gate.ts` and `src/PendingSchema.ts`'s prior "covered"
marks predate this phrase and re-enter the frontier.

Covered this tick, against the current (post-`76b6ab9`) phrasing:
`src/Baton.ts` (leaf, zero internal imports) — clean, already
well-tested. Also checked the lens's named extra domain: `.flume/chain.ts`
(the one finding, already fixed by `76b6ab9` itself) and
`.flume/PROTOCOL.md` (clean — its inline-exec "Interim." section already
names both trigger and retiring commit).

Remaining frontier: 13 of 14 `src/` modules (all except `Baton.ts`,
including `Gate.ts`/`PendingSchema.ts` per the re-arm above), all of
`tests/`, `bin/`, `examples/`.

## Trunk

HEAD `76b6ab9`. Next tick: continue the sweep frontier, or derive/audit
if new commits or a `spec/` change land first.

Plan continues: yes — sweep frontier open (13+ modules remain)
