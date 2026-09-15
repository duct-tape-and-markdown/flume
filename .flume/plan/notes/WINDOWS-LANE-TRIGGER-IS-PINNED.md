# tests/bin.test.ts now holds two ci.yml readers with different parsers

The existing "Consumer-install smoke" case reads ci.yml through a local
`stepBody()` that slices a *named* step's lines. The two cases this entry
added needed indentation-structural readers instead (`yamlBlock`,
`yamlScalar`, `yamlSeq`, `runCommands`) to reach `on:`, `jobs:`, a job's
`runs-on`, and its unnamed `- run:` steps. Two partial YAML decoders for
one document now sit in one file.

Neither is wrong today — they answer different questions — but a third
workflow assertion should not add a third parser. Shape to consider: one
ci.yml reader under `tests/helpers/`, with `stepBody()` re-expressed on
it (`engineering.md`, *The fix lands at the mechanism*). Wants its own
entry; the fix touches a passing case.

Also: the windows lane spells its typecheck `pnpm tsc --noEmit`, the
ubuntu lane `pnpm typecheck`. The new pin resolves both through
package.json's `typecheck` script, so the divergence passes green.
