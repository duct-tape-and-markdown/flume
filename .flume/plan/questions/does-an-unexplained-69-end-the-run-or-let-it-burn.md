# Does a 69 the supervisor's re-read cannot explain end the run, or let it burn?

A build tick's note (2026-10-07, `A-MOUNT-DEAD-69-ABORTS-ONLY-WHILE-THE-MOUNT-IS-STILL-DEAD`)
found the re-read one leg short of `src/`'s 69 producers and asked for a spec
edit. Re-verified on this tip, the gap is structural rather than one missing
leg, so it comes here rather than straight to the queue.

## What is on the tree

`spec/loop.md`, *Exit codes — the run never lies to CI* names two legs for the
re-read — "the chain's resolution and the queue's parse" — and the same
section's 69 row lists chain load, missing state root, invalid declaration and
ledger parse. The shipped supervisor reads **three**: the entry added the
exiting phase's declared prompt template (`readPhaseTemplate`, `src/Prompt.ts`)
because without it `flume loop` stopped halting on an absent prompt file and
spent every remaining `--max` child on one unreadable file — a halt pinned end
to end ("flume loop halts on a phase whose declared prompt file is absent
rather than spending its remaining ticks", `tests/cli.test.ts`).

Two measured facts make that one instance of a shape rather than one omission:

- **69 is the fallback class, not a roster.** `TICK_EXIT_ARMS`
  (`src/cliVerdict.ts`) holds the shaped arms; everything matching none of them
  lands on `TICK_EXIT_OTHERWISE` — "the arm with no shape of its own" — which is
  69. The producer set is open by construction, so the re-read can only hold
  legs for the causes someone has already met.
- **The consecutive-failure backstop cannot cover for it.** The streak is folded
  from the tick's *verdict* — `provisionFailures` … `platformFailures`
  (`src/loopSupervisor.ts`) — and a refusal that exits before writing a verdict
  contributes nothing to it. So for a 69 raised before the verdict exists, the
  re-read is the only defence there is, which is why the prompt-file run burned
  every child instead of aborting at `abortThreshold`.

## Options

1. **Grow the spec's two legs to three and leave the default as it is.** What
   shipped, and the cheapest: the sentence and the 69 row name the declared
   prompt template, and an unexplained 69 keeps the run going. Costs the next
   fallback-69 cause the same burned run, found the same way — by a build tick
   measuring it.
2. **Invert the default: abort unless a leg explains the 69.** The re-read
   answers "which leg is still dead" *or* "no leg owns this 69", and only the
   first-plus-cleared case lets the run go on. Closes the open producer set in
   one move and keeps the recoverable case, which always has a leg that explains
   it. Costs an operator the runs that today continue past a cause the
   supervisor cannot name — a visible behavior change, and the arm is
   unreachable from the three legs, so it needs a cause with no leg to pin it.
   A narrower variant: let the streak count a verdictless child by its exit
   code, so the backstop catches the repeat even where the re-read cannot name
   it.
3. **Give the fallback a shape of its own.** An unclassified tick failure stops
   being 69, so "mount dead" means exactly the legs the re-read reads. Most
   honest about what 69 claims and the largest change: the exit-code table is a
   CLI contract (`spec/cli.md`, *Versioning policy*), and the prompt refusal
   needs its own placement — 78 `EX_CONFIG` reads like the right home for a
   phase naming a prompt file that will not read, except that 78 propagates
   unconditionally, so the re-read that rescues an operator's mid-run fix would
   no longer reach it.

Meanwhile `THE-MOUNT-DEAD-NARRATION-STATES-THE-RETIRED-ABORT` states the tree's
three legs on the help page and in `docs/CLI.md`, so the shipped narration is
true under option 1 or 2 and is re-derived under 3.
