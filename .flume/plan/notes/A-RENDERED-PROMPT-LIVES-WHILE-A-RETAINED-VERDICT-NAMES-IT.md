# The rendered-prompts trim landed; the directory's job now has a file

Shipped as written. The trim runs at `writeTickVerdict`'s window slice, over
the `bounded` *lines* (a line `isTickVerdict` declines still names its
prompts), and the live-run window is read from the loop lock's claim instant.

Two things plan may want to know.

**A new module, `src/renderedPrompts.ts`.** The window edge could not be
shared in place: `runSpend.ts` already imports `tickVerdict.ts`, so the trim
importing back would have been a cycle. The directory's read side — the
listing, `RENDERED_PROMPT_PREFIX`, the stamp/compare pair — moved there out of
`runSpend.ts`, and both callers now take one spelling. `recordRenderedPrompt`
(`src/tickAttempt.ts`) stayed where it is: it is the dispatcher's write, and
moving it was outside this entry. That leaves the directory's job split across
two files — a cohesion note, debt not a defect, worth a sweep read if
`tickAttempt.ts` is ever cut.

**Two withholds, both silent by design, both declared at the site.** The trim
keeps everything rather than guessing an edge when (a) the loop lock states no
claim instant (pre-0.17 lock — `flume status` already says so on stderr for
the same reason), or (b) a history line will not JSON-parse, so the retained
set cannot be enumerated. Both fail toward over-keeping, never toward losing a
prompt. The trim also never throws: it follows a verdict whose tick has
already reported, and `flume status` still refuses `EX_IOERR` over the same
directory, which is the refusal that bounds the silence. If plan wants either
withhold *reported* rather than merely bounded, that is a surface change on
`TickResult`/the verdict — not filed, because no consumer asks for it yet.

`MAX_TICK_VERDICTS` is now exported from `src/tickVerdict.ts` so the retention
test drives the window past its own edge instead of restating `200`.
