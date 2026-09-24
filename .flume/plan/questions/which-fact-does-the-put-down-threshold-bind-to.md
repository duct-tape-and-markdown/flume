# Which fact does the put-down threshold bind to?

**Section:** `spec/harness.md`, *A tick puts work down* — "the build prompt
names the thresholds at which an agent lands what is green and writes the
note". The section says the prompt names them; it does not say against which
of the line's three facts.

`harness/prompts/build.md`, the put-down bullet, names two: **70% of the
window** and **80% of the window**. Both are percentages of a context window.

## What the tree carries, verified this drain

- The composed line offers three facts, and the percentage is the optional
  one: `src/budgetLine.ts:186`-`:200` pushes the context part only where a
  window was declared, then always pushes `elapsed` and the tool-call count.
- **No chain can declare a window today.** `contextWindow` reaches
  `readBudgetLine` through `BudgetLineOptions`, and no declaration surface
  carries it — that forwarding is queued as
  `THE-DECLARATION-FORWARDS-THE-CONTEXT-WINDOW`. So every build tick this
  loop has run read a line stating elapsed and calls, under a paragraph whose
  only thresholds are percentages of a window that line never printed.
- The absence clause meant to cover that — "No budget line at all means this
  chain declared no window" — describes a case the engine does not produce:
  a missing line is one of three *transcript* failures
  (`src/budgetLine.ts:146`-`:171`), never a declaration. That half is
  decidable and is filed as `THE-PUT-DOWN-PROMPT-NAMES-THE-LINE-THE-ENGINE-SENDS`;
  this question is only about which dial the thresholds turn on.

## The inbox finding behind it

`.flume/inbox/2026-09-24-the-context-arm-of-the-budget-line-is-inert-at-1m.md`
reports `claude-opus-5` carrying a 1,000,000-token window by default (platform
docs, *Context window sizes by model*; no flag, standard pricing) — an
external fact, so no test here pins it and `.claude/rules/platform-facts.md`
has no section for it. If it holds, declaring this repo's real window puts
70% at 700k against a measured heaviest session of 225k and a median build
tick under 100k: the arm is declared and still never fires. What bound the
ticks observed on 2026-09-24 was the clock and the spend — 76 minutes, $8 —
not the context.

## The fork

1. **Elapsed is the dial.** The prompt names an elapsed threshold beside (or
   instead of) the percentage, and the chain declares the minutes the way it
   would declare the window. Costs: a wall-clock number nobody has chosen
   yet, and it is host- and entry-dependent in a way a percentage is not.
2. **Keep the percentage, leave the window undeclared.** The line reads
   elapsed and calls alone and the prompt's closing "the same call is yours
   to make on your own reading" carries the whole judgement. Costs: the two
   thresholds the prompt states are then dead text in every tick, which is
   the state we are in now — it just stops being an accident.
3. **Both, named against whichever fact the line carries.** The prompt states
   a threshold per fact and the agent reads the ones its line printed; the
   chain declares the window when it wants the percentage arm live. Costs:
   the most prompt prose, and two numbers to choose instead of one.

## Also for the ruling

Should *A tick puts work down* say the thresholds are named against whichever
fact the line carries, rather than leaving the prompt to pick? The section is
the only place that obliges the prompt to name any, and today the prompt
names one the line may not print.

Whichever way this goes, the platform fact wants a home: a
`.claude/rules/platform-facts.md` section for the model's window, or the
number living in `.flume/declaration.ts` alone as the one file that holds
this environment. Both are the human's lane.
