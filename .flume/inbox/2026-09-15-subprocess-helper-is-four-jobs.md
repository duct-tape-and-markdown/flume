# `tests/helpers/subprocess.ts` is four jobs under one name

Filed from a structural review at 57bd960, under
`.claude/rules/engineering.md` *A module is one job*. The header (`:1–14`)
lists its contents as "also home to…", which is the smell stated in prose;
52% of the file is comment, most of it per-job rationale.

Exports by job:

- Spawn wrappers: `runNodeStreams`, `runCliStreams`, `runCli`, `gitOut`
  (`:361–410`); the CLI entry-point constants and `requireEntryPoint`
  (`:65–90`); `SPAWN_BUDGET_MS` (`:46`).
- Env hygiene: `hermeticEnv`, `HERMETIC_ENV_STRIP_KEYS`, `pinGitAutoGcOff`
  (`:100–131`, `:444–466`).
- Fixture rooting: `mkTempDir`, `mkFixtureRoot` (`:155–202`).
- The state-root leak guard: `watchStateRoots`, `refusePreexistingStateRoots`,
  `refuseLeakedStateRoots`, `installStateRootLeakGuard` (`:211–324`).

`dispatcherFixture.ts` imports only `mkTempDir` from it (`:188`), and
`spawnBudget.ts` hardcodes this file as *the* harness module (`:38`, `:41`),
so the leak guard and the git pin are read as "spawn wrappers" by the scan
that enumerates the file's exports.

Target: `subprocess.ts` keeps spawn, entry points and `SPAWN_BUDGET_MS`;
`fixtureRoot.ts` takes `mkTempDir`, `mkFixtureRoot` and the leak guard;
`gitEnv.ts` takes `pinGitAutoGcOff` and `hermeticEnv`. `spawnBudget.ts`'s
harness-module constant follows the spawn wrappers, not the file.
