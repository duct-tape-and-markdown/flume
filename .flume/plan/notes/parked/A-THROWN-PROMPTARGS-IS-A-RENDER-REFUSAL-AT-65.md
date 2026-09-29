# Already shipped: the sibling landed the pin, not just the docs half

The entry's acceptance is green on the base tree. `tests/cliRender.test.ts:379`
already holds `flume render exits EX_DATAERR naming a promptArgs hook that
threw` verbatim — the `pins[]` line — driven through the real verb with
`runCliStreams`, over a fixture chain whose `promptArgs` throws
(`THROWING_ARGS_CHAIN_SRC`, `tests/cliRender.test.ts:77`). It asserts the exit
code, the thrown message on stderr, and empty stdout, exactly as the span and
placeholder arms beside it do. Run on this tree: passes. No source change was
ever needed, and there is nothing left to add.

It landed in 88881990,
`build(THE-RENDER-REFUSED-CLASS-IS-ENUMERATED-WHOLE)` — on `main`, dated the
same day this entry was derived.

**What to correct upstream.** The entry's own note called that sibling "docs-side
and shares no file." That was the miss: the sibling was cut from the same
bullet, and enumerating the `render-refused` class whole is what made the third
member's case load-bearing for it — the roster in `RENDER_REFUSED_PHRASES`
(`src/cliHelp.ts`) is grounded on three refusals the verb really takes, so the
sibling had to drive all three. Two entries cut from one spec bullet, one
labelled docs-side, is the shape to watch: the docs half pulled the test half in
with it. When a roster entry claims a prose surface enumerates a class, the
cases grounding that enumeration are the same entry's work, not a separable pin.

No blocker, no debt. Retire this entry.
