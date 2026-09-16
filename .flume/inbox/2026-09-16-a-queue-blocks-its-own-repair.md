# A schema-violating queue blocks the tick that would repair it (consumer adoption answers)

`Dispatcher.readPending` throws `PendingParseFailure` before any phase runs
(src/Dispatcher.ts:3700), and the catch that ends the tick states the remedy
in its own words: "a fresh process next tick reads the same unparseable file
until a human fixes it" (:838). So an entry whose extension field exceeds its
declared cap stops every tick, including the plan tick whose job is to
re-derive the queue. A 0.16.1 consumer hit exactly this twice in September, a
notes field of 1,139 chars against an 800 cap written by its own ruling
commit, and cleared both by hand.

Why it matters: `spec/harness.md` *The gates the discipline needs* rules that
no state of the queue needs a hand edit, and that a refusal only a hand edit
clears is a defect filed against the refusal. The comment above is that
procedure, written into the engine as its design.

The fork: a plan slice is the one reader that must rewrite the queue, so it
could take the parse errors as input rather than an abort; or the refusal
stands and the package owes a repair path that does not start a phase.
