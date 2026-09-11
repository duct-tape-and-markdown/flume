# Parked: four spec cites are genuinely stale, and only spec/ can fix them

Premise fails. 72 path-carrying cites in `spec/`, not 71 — and four name a
module that does not *declare* the symbol:

- `spec/prompt.md:148` `src/Dispatcher.ts:slugify` -> `src/paths.ts`
- `spec/chain.md:167` `src/cli.ts:tickExitCode` -> `src/cliVerdict.ts`
- `spec/chain.md:195,203` `src/cli.ts:resolveStateDirs` ->
  `src/cliJobResolution.ts`, which `spec/chain.md:633` itself already names.

The repoint is a `spec/` edit — human-only, outside build's fence — so the
pin cannot go green from a build tick.

The looser reading ("the module *references* the symbol") does go green, and
is ceremony: measured on `a18b40e^`, `src/Dispatcher.ts` still imported
`superviseLoop`, `createWorktree` and `harvestFriction`, so it would have
passed over the exact stranding a18b40e repointed. Only "declares" catches
that class.

Re-file once a human repoints the four. `src/cli.ts:686` (`defaultTickRunner`
is `src/loopSupervisor.ts`) is still unshipped — :697 and :746 are correct
already, and a src/-side scan would have caught :686.
