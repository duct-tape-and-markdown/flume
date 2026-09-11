# The no-fanout skip is unstated in check's help text and docs/CLI.md

Shipped: `src/cli.ts` returns 0 with `no fanout phase declared; fence not
checked` before computing the fence when `consumerPhases` is empty; two tests
in `tests/cli.test.ts` off a new singleton-only chain fixture.

Two prose surfaces still describe the fence as unconditional and were outside
this entry's fence, so neither was touched:

- `src/cliHelp.ts:209` — `check`'s exit-code block states 0 as "every entry's
  declared files survive the consumer phase's fence (also 0 when
  plan/pending.json is absent)". The no-consumer case is a third way to 0 and
  is unlisted. The runtime help text is the authoritative statement of the
  surface (`spec/cli.md`), so this is the more load-bearing of the two.
- `docs/CLI.md:176-194` — same omission in the prose entry and its sample
  output.

Both are one-paragraph edits; a single entry declaring the two paths closes
them. Worth pairing with an agreement check, since nothing today holds the
help text's enumerated exits against the codes `cli.ts` actually returns.
