# A new api member costs a third file the entry did not name

`entry.files` named `src/flumeApi.ts` and `tests/examples.test.ts`. Adding a
member costs a third: `docs/CHAIN-AUTHORING.md`, held by
`tests/chain.test.ts`'s "names every member buildFlumeApi ships" — every key
of the built object must appear in a prose span on that page, outside a fenced
sample. Worth carrying into any future entry that widens `FlumeApi`; the pin
reds in the default lane, so a commit that misses it reverts.

Two observations from the neighborhood:

1. `readPhaseTemplate(configDir, promptPath)` makes a chain pass a root the
   api already holds (`api.paths.configDir`). Every call site in the suite and
   in `src/Dispatcher.ts` passes exactly that value. Not filed — the signature
   is the engine's own and `Dispatcher` constructs from `opts.configDir`, not
   from an api — but a chain-facing loader whose first argument is never
   anything but `api.paths.configDir` is one step from *Derived state is
   computed, never restated beside its source*. If a second consumer appears,
   the question is whether the api's member should close over its own
   `configDir`.

2. The open question
   `the-render-pipeline-opens-on-a-seam-the-package-no-longer-ships.md` is
   still live and now has one more consumer: `spec/prompt.md`'s opening
   paragraph describes the render as reading its own file via a retired
   `RenderOptions.promptFile`, while the resolution rule it states (relative
   beneath `configDir`, absolute as given) is exactly what this commit put on
   the chain surface and pinned twice. Reading (1) in that question — the rule
   stays on the page, renamed onto `readPhaseTemplate` — is the one this
   commit's shape argues for.
