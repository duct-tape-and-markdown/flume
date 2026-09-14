# Dead guards left in .flume/chain.ts, outside build's fence

Both fields are now required on `GateContext`, and every absence guard in
`src/` and `examples/` is gone. Four remain in `.flume/chain.ts`, which build
cannot write:

- L267 `records gate requires commitSha`
- L389 `per gate requires commitSha`
- L785 `red-on-base needs baseSha and commitSha`
- L272 `ctx.baseSha ? [baseSha, sha] : ["--root", sha]`, plus the L256-260
  narration that names the hand-built-fixture case it existed for

All four are unconstructable now — dead plumbing (`posture-sweep.md`) and
expired narration for the L256 paragraph. `tests/chain.test.ts`'s records
fixture states `${sha}^` as the base, so the `--root` branch is also
unexercised.

Route as a harness commit (`chore(flume):`) or an interactive fix; a build
entry cannot reach it.

Separately: `TickResult.commitSha`/`baseSha` (`src/Phase.ts` L193/L228) stay
optional and are correct so — a no-commit tick has neither. Only the gate
surface changed.
