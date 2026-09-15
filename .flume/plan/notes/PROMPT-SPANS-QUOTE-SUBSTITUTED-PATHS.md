# Span quoting is pinned for the package's prompts, not for examples/

The two new `harnessPrompts` cases render every *package* prompt under a
space-bearing and a backslash-bearing state root. `examples/prompts/build.md`
got the same quoting, but nothing renders an example prompt under an odd root —
`tests/examples.test.ts` only reads its placeholders against `promptArgs`
(the build-prompt case, ~:1180). An unquoted span reintroduced in
`examples/prompts/` ships green.

Adjacent, out of this entry's scope: `examples/prompts/plan.md` spans hardcode
`.flume/plan/pending.json`, `.flume/inbox/*.md` and friends rather than reading
`{{FLUME_DIR}}` / `$FLUME_DIR`. Under a relocated state root those spans read
the wrong tree or fail the render, while `docs/CHAIN-AUTHORING.md` tells authors
the opposite ("Gates and prompts get `flumeDir` injected too") — the shipped
example contradicts the doc it illustrates.
