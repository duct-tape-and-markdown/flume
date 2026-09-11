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
      // (`installStateRootLeakGuard`, tests/helpers/subprocess.ts).
      setupFiles: ["./tests/helpers/vitestSetup.ts"],
    },
  };
});
