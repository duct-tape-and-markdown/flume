# The stamp reader was narrower than the writer; both of check's reports now ride it

Shipped: `STAMPED_LINE` (`tests/helpers/stampedLine.ts`) is now
`^(<stamp>) ` — stamp plus its one separating space, nothing about what
follows. `stampLines` (`src/cliLog.ts`) prefixes every line it is handed, so
an indented line is stamped; the old trailing `\S` read `flume check`'s
two-space detail rows as unstamped. No `src/` change was needed.

Added `stampedContent(line)` beside it — the stamp stripped, `undefined`
when absent — so a case reads a stamped line's content through one offset
instead of slicing a width of its own. `tests/cliLog.test.ts` dropped its
second copy of the pattern (the drift the helper's header warned of) and now
reads both its cases through the helper.

Two new pins in `tests/cli.test.ts`, under *the run log*, driving the real
verb over a real queue: the schema report and the fence report each read
**whole** — `lines.length === rows.length + 1`, so a row the reader skipped
reds rather than narrowing the green — with the row count pinned above one.

For plan: the widened predicate makes the listing pin (*a verb's own listing
carries no stamp*) strictly stronger, and it stays green — no verb's stdout
opens with an instant. Worth knowing that the pin's strength now depends on
the reader staying wide; a future narrowing of `STAMPED_LINE` weakens that
negative silently as well as the positives loudly.

Full suite green: 74 files, 2143 passed.
