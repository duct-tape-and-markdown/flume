import { configDefaults, defineConfig } from "vitest/config";

// Two lanes (spec/worktrees.md: the integration lane). The default run is the FAST lane — unit + fast
// tests — and is exactly what the build's `afterMerge` gate (`pnpm test` =
// `vitest run`) invokes inside the fanout worktree, so it must stay fast and
// worktree-safe. The INTEGRATION lane (`*.integration.test.ts`) spawns real
// subprocesses and needs a warm host; it is excluded from the default run and
// runs at the host via `pnpm test:integration` (which sets VITEST_LANE).
const integration = process.env.VITEST_LANE === "integration";

export default defineConfig({
  test: {
    include: integration
      ? ["tests/**/*.integration.test.ts"]
      : ["tests/**/*.test.ts"],
    exclude: integration
      ? [...configDefaults.exclude]
      : [...configDefaults.exclude, "**/*.integration.test.ts"],
  },
});
