# `spec/cli.md`'s `render` bullet spends its `EX_DATAERR` arm on one span

The bullet's exit-code sentence (`spec/cli.md:56`) reads:

> An unresolved span exits `EX_DATAERR` naming it, the refusal a tick would
> have bought with an invocation.

One instance, stated as the arm. The shipped arm is a class of three.
`THE-PLACEHOLDER-REFUSAL-IS-A-RENDER-REFUSAL` made `RenderRefusal`
(`src/Prompt.ts`) the base both stage refusals extend, and `src/cliRender.ts`
now branches on the base: an unresolved inline-exec span, a `{{KEY}}` no arg
filled, and a `promptArgs` hook that threw all exit `65`. The placeholder case
exited `69` before that ship and is pinned at `65` now ("flume render exits
EX_DATAERR naming a placeholder no arg filled", `tests/cliRender.test.ts`);
nothing pinned the old code, so no test moved.

**There is no fork, which is why this is a request rather than a question.**
The engine already gives the three one name — `render-refused`, one member of
`NO_COMMIT_MODES` (`src/Prompt.ts`) — and both the code comment at the branch
and `docs/CLI.md`'s own `65` sentence say so. The spec sentence is the only
copy that picks one member instead. The edit we would propose: name the
`render-refused` class and let the span be an instance of it, the way the
`docs/` sentence already does.

**Why it cannot route any other way.** No code is waiting on this — the
behavior shipped and is pinned. `spec/**` is the human's lane, so it cannot be
a pending entry; and an accepted-debt line dead-ends, because the
family-files-once escape hatch would file an entry build is fenced out of
writing. The questions directory is the only channel a spec-lane prose finding
has.

**One thing follows it.** `docs/CLI.md:255` names the class but enumerates two
of its three members before doing so ("an inline-exec span that exited
non-zero … or a `promptArgs` hook that threw"). That half is build's lane and
takes an entry once the spec sentence rules the class — filed then, not now,
so the page is not written against a sentence that may be worded differently.
