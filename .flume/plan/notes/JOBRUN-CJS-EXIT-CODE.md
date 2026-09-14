# The tick arm stays a fifth site, by shape

`refuseCjsContextHost` (src/cliChainLoad.ts) now owns the
CjsContextLoadError -> headline + exit 2 contract for the four surfaces that
own an exit code: `check`, `friction`, `job new`, `job run`.

`Dispatcher.tick` (src/Dispatcher.ts, the `chainLoader()` catch) holds the
same contract but cannot reach that arm: it reports through `this.log.error`
(the chain-injected logger, not `console`) and returns
`TickOutcome.usageError` for `tickExitCode` to map, not a number. Sharing
would mean passing a logger and an outcome-vs-code mode into the helper —
more moving parts than the two lines it saves. Left as a declared divergence,
cited in both doc comments, rather than generalized.

If a future surface needs the refusal as an *outcome* rather than an exit
code, that is the point where the predicate (`err instanceof
CjsContextLoadError`) wants extracting from both — not before.

Also observed: `dist/cli.js` is the only way to exercise this refusal (it
needs tsx's real ESM loader against a `type: commonjs` host), so all four
cases pay one `tsconfig.build.json` compile in a shared `beforeAll`.
