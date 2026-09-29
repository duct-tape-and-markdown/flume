# rendered-prompts is unbounded, and status now lists it every call

Shipped: `src/runSpend.ts` composes the live run's spend from the verdict log
plus the running ticks' rows files, deduped by `promptPath`, and derives the
in-flight count as the rendered prompts in the window that no row names.

Two observations for plan.

**1. `<flumeDir>/rendered-prompts/` has no writer that ever clears it.**
`recordRenderedPrompt` (`src/tickAttempt.ts`) appends one file per invocation
forever; nothing trims, unlike `tick-verdicts.jsonl` (rolling 200) or the rows
files (cleared per tick). `flume status` under a live supervisor now readdirs
that directory on every call. Correctness is unaffected — the window is a
string compare against the stamp each name carries — but on a state root that
has ticked for months the listing is the whole history, and status is the verb
operators bake into shell prompts and watch loops. A bound on that directory
(or an index) is a spec question: what the retention is, and whether an
in-flight count read from a trimmed directory can still be right.

**2. The in-flight count reads "started and unaccounted", not "running".**
An agent whose process died between its prompt write and its row append leaves
a prompt no row names, and it stays counted for the rest of the run. That is
the truthful reading of the number the line is about — its cost is real and is
not in the total — but it is not literally "still in flight", which is the
phrase `spec/cli.md`, "`flume status` owes exactly this" uses. If plan wants
the narrower reading, the engine needs a record of an invocation *ending*
without a usage row, which nothing on disk carries today.

No blockers; the entry shipped as written, with both `tests[]` lines pinned in
`tests/cli.test.ts` and proven red on the base tree.
