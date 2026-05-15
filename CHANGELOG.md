# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Pre-1.0: minor versions may introduce breaking changes to the public API surface
(see `spec/RELEASE-v0.1.md` §2). Breaking changes land under a `### Breaking`
subheading per `spec/RELEASE-v0.1.md` §9.

## [Unreleased]

## [0.1.0] - 2026-05-15

First public release. Published to npm as `@dtmd/flume` (the unscoped
`flume` is an unrelated package). ESM-only, Node 22+.

### Added

- Core harness contracts: `Phase`, `Chain`, `Gate`, and the pending-entry
  schema (`PendingEntry`/`PendingList`, `parsePending`,
  `renderSchemaForPrompt`, `touchedPaths`, `isPickableNow`).
- `Dispatcher` runtime: stateless ticks, singleton + git-worktree fanout
  concurrency, afterCommit/afterMerge gates, writable-paths enforcement,
  cherry-pick merge with stale-worktree pruning.
- `Baton` filesystem-flag phase signalling.
- Agent seam: `claudeCode` provider with `timeoutMs` + `outputFormat`,
  composable `withSessionCapture` and `withTerminalRenderer` decorators.
- Built-in gates: `shellGate`, `tscGate`, `vitestGate`, `eslintGate`,
  `writablePathsGate`.
- `renderPrompt` template renderer (substitution + inline-exec).
- CLI `flume`: `status`, `tick`, `loop`, `wake`, `sleep`, `render`, with
  `--help` per subcommand and `--version`.
- Distribution: compiled `dist/` (`.js` + `.d.ts`), strict single-entry
  `exports` map, `tsImport`-based consumer chain loading.
- CI publish-acceptance gates: `attw --profile esm-only`,
  consumer-install smoke, `npm pack` file-set guard.
- Documentation: `README.md`, `docs/CLI.md`, `docs/CHAIN-AUTHORING.md`,
  `docs/INTENT.md`; `examples/cascade-chain.ts` and
  `examples/minimal-chain.ts`.
- MIT license.
