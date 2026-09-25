import { configDefaults, defineConfig } from "vitest/config";

// Two lanes (spec/worktrees.md: the integration lane). The default run is the FAST lane — unit + fast
// tests — and is exactly what the build's `afterMerge` gate (`pnpm test` =
// `vitest run`) invokes on the trunk once each entry's cherry-pick has landed,
// so its cost multiplies with wave width and it must stay fast. The
// INTEGRATION lane (`*.integration.test.ts`) spawns real subprocesses and
// needs a warm host; it is excluded from the default run and runs at the host
// via `pnpm test:integration`, which selects the lane through vitest's own
// `--mode` flag — a portable CLI argument, not a POSIX-only env-var prefix.
export default defineConfig(({ mode }) => {
  const integration = mode === "integration";
  return {
    test: {
      include: integration
        ? ["tests/**/*.integration.test.ts"]
        : ["tests/**/*.test.ts"],
      exclude: integration
        ? [...configDefaults.exclude]
        : [...configDefaults.exclude, "**/*.integration.test.ts"],
      // Both lanes, because the writer is unknown: a state root planted above
      // the fixtures captures every unrooted fixture below it, and the suite
      // that plants it is the one a per-suite guard would be missing
      // (`installStateRootLeakGuard`, tests/helpers/fixtureRoot.ts).
      setupFiles: ["./tests/helpers/vitestSetup.ts"],
      // Four, bounded well below the core count, because this is the price
      // of one suite and one suite is what runs: the ship lock serializes the
      // judge whatever the wave's width (`spec/loop.md`, *The ship lock and
      // the worktree lock — sibling ticks take turns at git*). At four the
      // suite peaks near 3.2 GB across ~40 processes for ~3 min — more than
      // twice the whole loop tree beside it — on the 11 GB host these
      // figures were measured on (`docs/CHAIN-AUTHORING.md`, *What a wave
      // costs in memory*), which also carries another project's loop. That
      // other load gone, and a merge's suite wall clock hurting more than its
      // headroom, is the condition for raising it; a measured ceiling, not a
      // tuning. The floor rides with it, since vitest's default minimum is
      // derived from the core count and refuses a lower ceiling.
      minWorkers: 1,
      maxWorkers: 4,
    },
  };
});
