# Six shared blocks are one render; the two span carriers are a new key class

Shipped: the six blocks measured byte-identical across the three slice
prompts, plus the `project conventions` line all four phases spelled alike,
are now one render each in `harness/prompts.ts`. Verified byte-identical: the
old prompt files substituted with the old arg vocabulary against the new files
substituted with the new one, all four prompts, same bytes.

Two observations for the next tick.

1. **A new key class, not just a move.** `<pending-now>` and `<plan-state>`
   carry inline-exec spans the package needs run, so their args cannot be
   declared data — the engine neutralizes a data key's spans before it scans.
   They ship as `PLAN_SLICE_PROMPT_SPAN_KEYS`, deliberately absent from the
   phase's `promptDataKeys`, and `tests/harnessChain.test.ts` now pins both
   halves: a produced key off both rosters reds, and a span key that appears
   in `promptDataKeys` reds. That second pin is the only thing standing
   between a future edit and a plan tick shown command text where its queue
   should be — no placeholder is left unresolved when a span goes inert, so
   the render-time checks cannot see it.

2. **Five arg keys left the exported rosters**: `PENDING_DIR`,
   `QUESTIONS_DIR`, `RECORD_DIRS` (shared) and `PLAN_STATE_PATH`,
   `CLAIMED_TAGS` (slice). Each is now consumed by the block composer that
   needs it, and no package prompt named one afterwards. Consumer-visible in
   principle — a hand-rolled phase pairing these producers with its own prompt
   file would take a loud render refusal — and I wrote no `MIGRATING-0.21.md`,
   since 0.20.0 is cut and naming the next version is the release cut's call.
   Plan's to route if the next cut wants a note.

Not filed, below the three-prompt bar: the `Discipline: {{DISCIPLINE}} — read
it before writing the queue.` line is byte-identical in plan-derive and
plan-sweep but not inbox, so it stayed in the two files.
