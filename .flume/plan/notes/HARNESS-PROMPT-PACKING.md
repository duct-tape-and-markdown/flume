# scripts/ is load-bearing build surface but outside both typecheck and the sweep

`scripts/pack-harness-prompts.mjs` is now the second half of `pnpm build` —
without it the published `dist/harness/prompts.js` addresses five files that
are not there. But `scripts/` is in neither `tsconfig.json`'s `include` nor
the posture sweep's domain (`.claude/rules/posture-sweep.md`, *The pages are
the authority*: `src/`, `harness/`, `tests/`, `bin/`, `examples/`). Three
`.mjs` files now sit there — changelog, smoke-install, and this one — and
nothing typechecks them or reads them for posture. Worth a decision: widen
the sweep domain, or say out loud that `scripts/` is judged by its tests
alone.

Accepted debt in this entry: `tests/harnessPackaging.test.ts` runs the two
build steps itself (tsc, then the copy) rather than `pnpm build`, because it
needs a scratch `--outDir` and the manifest's `build` string takes no
argument. The gap — a `build` script that drops the copy step — is closed by
a substring assertion on `manifest.scripts.build`, which means the script's
path is spelled in two places. A `pnpm build` that accepted an outDir would
retire both.
