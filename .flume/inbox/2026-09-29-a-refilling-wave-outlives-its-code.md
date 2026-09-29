# A refilling build wave outlives the code it launched with, and dies with no verdict

Observed this run (loop started 2026-09-28T22:59Z). Build tick #2 refilled its
slots for ~4h, landing ~58 entries, then exited 1. Three defects, one cause:
since the refill, one build tick lives as long as the queue does.

1. **A slot's render throw tears down the wave with no verdict.** Log tail:
   `Error: prompt references missing args: PROTOCOL_LINE` at
   `substitutePlaceholders` ← `renderPrompt` ← `runAttempt` ← `runFanoutEntry`
   ← `runSlot` (`src/waveTick.ts`), then `tick process exited with code 1`.
   No verdict row was written for the whole wave: `tick-verdicts.jsonl` holds
   one build row since the lock's start against 61 build agent results in the
   log (~$204 unaccounted). `spec/chain.md`, *What a hook receives*: a render
   that does not resolve is `render-refused` for that entry, and "in every case
   the verdict is written and the merge bookkeeping completes". Shipped entries
   and ship commits are intact; the verdict and usage are what was lost. Likely
   the bare `slotError` rethrow the plan-inbox drain at d980c022 already noted,
   plus a placeholder miss not classified as a render refusal at all.
2. **Version skew inside one tick.** 564940fd
   (THE-THREE-PROMPTS-SHARE-ONE-RENDER-OF-EACH-SPAN) landed mid-wave and added
   `{{PROTOCOL_LINE}}` to `harness/prompts/build.md` and its arg to
   `harness/prompts.ts`. The next refilled slot's worktree, cut from the tip,
   carried the new template; the tick process still held the old args code.
   The skew defences — fresh process per tick, the contract-touching stop the
   supervisor reads between children (`spec/loop.md`, *One tick is one fresh
   process*) — all sit at the child boundary, which a refilling wave never
   reaches. Probably a spec question: does a wave stop refilling once it lands
   a commit touching what the tick process itself loaded (chain, harness,
   `src/`), or once a contract-touching entry ships, or at a bound?
3. **`flume status` spend is blind to the in-flight wave.** Row 7 totals
   verdict rows, per `spec/cli.md`; with hours-long waves that read $6.93 for
   build against ~$211 spent. Correct by the letter; misleading exactly when
   the number decides whether a loop keeps running. Whether the in-flight
   tick's usage reaches that row is a spec question.

Also worth a line in the drain: plan was ~44% of this run's spend
(plan-inbox 37 ticks, ~$2.30 each, most draining one or two build notes).
