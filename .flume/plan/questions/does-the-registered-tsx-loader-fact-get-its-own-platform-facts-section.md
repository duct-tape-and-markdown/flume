# Does the registered-tsx-loader fact get its own platform-facts section?

A build tick measured a toolchain fact while choosing a CJS-context fixture,
and the only copy of it is a doc comment. `CLAUDE.md` says that is the wrong
home — "a code comment carrying one is a copy the harness should own instead,
seen only by an agent that already opened that file" — but
`.claude/rules/platform-facts.md` is yours, not any autonomous phase's, so
this needs your ruling before anything moves.

## The fact

Once tsx's ESM loader is registered process-wide, a `.ts` module it resolves
**parses as a module whatever the nearest `package.json` `type` says**. Only
the esbuild transform reads the manifest, because it picks its own output
format from it.

Measured, tsx 4.21 under node 22: a chain under `{"name": "..."}` with no
`"type"` and a real `import` statement loads clean and reaches the
factory-shape check (exit 69) rather than the CJS-context refusal. Under the
same manifest, a chain carrying a top-level await does refuse — the transform
arm, which reads the manifest itself.

The consequence for this repo: the test lane spawns the CLI as
`node <tsx/dist/cli.mjs> src/cli.ts`, so the import-statement arm of
`isCjsContextLoadFailure` (`src/chainLoad.ts`) is **unreachable through any CLI
this repo spawns**. In production the CLI runs under plain node off `dist/`,
where `tsImport` does the loading and that arm is reachable — which is why
`tests/Dispatcher.test.ts` drives it at the loader directly rather than through
a verb.

## Where the copy lives now

`tests/cli.test.ts:1624`-`:1631`, in the doc comment on
`CJS_CONTEXT_CHAIN_SRC`, as the warrant for picking the transform arm over the
import-statement one.

## The fork

**(a) Its own section on `.claude/rules/platform-facts.md`.** Recommended.
The page already carries *tsx decides a module's interop shape from the nearest
`package.json` `type`*, and this is a different claim: that one is about the
interop shape of a load that succeeds, this one about whether the manifest is
consulted for resolution at all. They also expire on different triggers — that
section retires when "tsx returns one shape regardless of `type`"; this one
retires when a registered loader starts honouring `type`. Two expiry predicates
in one section is a section the sweep's expired-narration lens cannot retire by
halves.

**(b) A paragraph inside that existing section.** One home for everything about
tsx and the manifest `type`, at the cost above. Cheaper to write, and defensible
if you read the two as one behavior seen from two sides.

Either way, nothing pins it — it is an external tool's behavior, so it lands as
prose by construction, like every other section on that page.

## What your ruling unblocks

Once a heading exists, the comment above shrinks to a pointer at it, in `tests/`,
which build can write. That is a queue entry the next drain files — it cannot be
written before the heading it has to name, because the citation pin resolves the
`*Section*` half against the page's real headings.

## Not part of this question

The same record noted that `refuseCjsContextHost` (`src/cliChainLoad.ts:62`)
prints `[flume] <message>` with no surface name, so the CJS headline is
byte-identical at every verb while the mount-dead line names the verb. That is
consistent with `spec/cli.md`, *A CJS-context host is refused, never relayed*
(the section's requirement is that the refusal is the headline), and it was
accepted as debt rather than filed. Raise it separately if you want an operator
to be able to tell which verb refused.
