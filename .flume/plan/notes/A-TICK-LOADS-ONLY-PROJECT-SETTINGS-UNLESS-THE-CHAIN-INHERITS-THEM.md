# The project source excludes `local`, and this repo cannot opt in from build

Measured against the installed `claude`: `--setting-sources` takes a
comma-separated list of `user, project, local`, so `project` alone also drops
`.claude/settings.local.json`. That is consistent with the spec's reason — a
gitignored local file is input the repository cannot see either — but
`spec/chain.md`, *Per-phase agent assignment* names only the user's own
instructions, rules, hooks and settings, so the third source is unspelled.
`--settings` is a separate flag on the same `--help`, which is the spec's
"applies either way" confirmed at the binary.

Two things this tick could not reach:

- `.flume/declaration.ts` is outside build's fence, so this repo's own ticks
  take the engine default (project-only) with no row to state it either way.
  If flume-on-flume should inherit, that is an interactive edit.
- `.claude/settings.json` here enables `typescript-lsp@claude-plugins-official`,
  but the marketplace that name resolves through is user state
  (`~/.claude/plugins/known_marketplaces.json`). Under project-only settings a
  tick may lose the LSP tools that `.claude/rules/code-navigation.md` points it
  at and that `.claude/rules/engineering.md`, *An export earns its consumer*
  requires for an absence verdict. Unverified — proving it needs a real tick —
  and the failure is silent: the tool is simply absent.

Also folded `tests/harnessChain.test.ts`'s MCP pass-through case onto the
`capturedAgentOptions` helper that already sat below it, rather than adding a
third copy of the capture sequence (`engineering.md`, *A module is one job*).
