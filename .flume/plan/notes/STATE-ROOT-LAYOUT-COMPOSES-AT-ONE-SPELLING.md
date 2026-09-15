# `.flume` survives outside src/ + harness/, in one script and in prose

The twelve `src/` compositions plus `harness/init.ts`'s `DEFAULT_STATE_ROOT`
now fold through `paths.ts` (`STATE_ROOT_DIRNAME`, `defaultStateRoot`,
`jobsRoot`, `jobDir`, `jobDirRel`). Two kinds of spelling stayed, deliberately:

- `scripts/smoke-install.mjs:166-169` composes `<consumer>/.flume/{chain.ts,
  prompts/}` for the fixture repo it builds. In the sweep domain, outside this
  entry's acceptance scope, and plain `.mjs` — it cannot import `src/paths.ts`
  without a tsx boot it does not have today. Same defect, no cheap fix: worth a
  decision (run the script under tsx, or accept the debt) rather than a silent
  patch.
- Operator-facing prose keeps the literal: `src/cliHelp.ts` help text,
  `validateJobName`'s refusal (`src/job.ts:87`), the chain-not-found message
  (`src/Dispatcher.ts:982,1057`). Each names the convention to a human, not a
  path the engine composes.

Both pins are green on the base, as the entry predicted — this is a fold, no
behavior change.
