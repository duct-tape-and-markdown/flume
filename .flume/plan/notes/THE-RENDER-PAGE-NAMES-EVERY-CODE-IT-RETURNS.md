# Five verbs now have a driven range pin; five sections still have none

Shipped: `docs/CLI.md` § `flume render` states each of 0, 2, 65, 69, 74 under
its own introducing verb, and two cases in `tests/cliHelp.test.ts` drive the
real process over five arms (render, `--entry` on a singleton, a failing
inline-exec span, a throwing chain factory, an unstattable ancestor bay) and
compare the section both ways.

Observed, and the reason this entry existed at all: the page's
one-verb-per-code convention is enforced per verb by hand-written range pins
— `tick`, `loop`, `status`, `log`, and now `render`. Every other section
(`wake`, `sleep`, `stop`, `check`, `friction`) is covered only by
EVERY-VERBS-HELP-NAMES-THE-IO-REFUSAL, which asserts 74 is *in* the read set
and nothing about the rest. A later code buried under a leading "Exits" in
one of those five is exactly as invisible today as 65 and 69 were here, and
no pin would red. The generalizing shape exists already: `driveRunExitCodes`
plus a per-verb arm table. A section-agnostic pin cannot be written — the
arms are the per-verb work — so this is five entries' worth, not one.

Smaller finding at the site: unlike `tick`/`loop`/`log`, the `render` section
carries no non-code backticked integer, so the `backtickedIntegers(section)
.length > named.length` denominator those pins assert is vacuous-by-
construction here and is deliberately absent, declared in a comment. If a
`--max`-shaped default ever lands in that section, the pin reds as "a code
the verb cannot return" rather than silently widening.

`check` and `friction` were re-read this tick: each code in both carries its
own verb already, so neither needs the prose half of this fix — only the
driven pin.
