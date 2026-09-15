/**
 * This repository's harness declaration (`spec/harness.md`, *What a consumer
 * declares*). Flume is the harness package's reference consumer: everything
 * the package owns — the slices, the prompts, the entry extension, the
 * judges, the discipline gates, the records, the plan state, the default
 * handoff — comes from `harness/`; this file states only the environment.
 */

import { vitestRunner, type Declaration } from "../harness/index.ts";

export const declaration: Declaration = {
  // Where a `per` cite may point: the engine contract and the rule pages.
  specLocus: ["spec/**", ".claude/rules/**"],

  fence: {
    // Build's writable paths. Plan slices write only the package's own plan
    // artifacts here, so no slice fence is declared.
    build: [
      "src/**",
      "harness/**",
      "bin/**",
      "examples/**",
      "docs/**",
      "scripts/**",
      "tests/**",

      "package.json",
      "pnpm-lock.yaml",

      "tsconfig*.json",
      "vitest.config.*",
      "*.config.ts",
      "*.config.js",
      "*.config.mjs",
      "*.config.cjs",
      ".prettierrc",
      ".prettierrc.*",

      ".gitignore",
      ".editorconfig",
      ".nvmrc",
      ".node-version",
      ".npmrc",
      ".env.example",

      "CHANGELOG.md",
      "README.md",
      "LICENSE",
      "LICENSE.*",
      "CONTRIBUTING.md",
      "CODE_OF_CONDUCT.md",
      "SECURITY.md",
      "AUTHORS.md",

      ".github/**",
    ],
  },

  // The phase fence is the whole fence; an entry's `files` is a prediction
  // the partitioner reads, never an allowance (spec/pending.md).
  scopeWritesToEntry: false,

  runner: vitestRunner({
    // vitest.config.ts: the default run excludes the integration lane. The
    // running lane's exclusions are rendered into plan's named-line hints, so
    // plan is told at authorship which globs no judge reaches — informed,
    // never refused for a prediction.
    lanes: [
      { name: "default", excludes: ["**/*.integration.test.ts"], runs: true },
      { name: "integration", excludes: [], runs: false },
    ],
  }),

  // The typecheck at both gate points, from the package registry. The
  // package's discipline gates always run first; its judge runs after these
  // at the same `when`, so the seconds-long typecheck reports before the
  // minutes-long suite (spec/harness.md, *What a consumer declares*).
  gates: {
    build: [
      { kind: "registry", name: "tsc", when: "afterCommit" },
      { kind: "registry", name: "tsc", when: "afterMerge" },
    ],
  },

  agents: {
    "plan-inbox": { model: "claude-opus-5", extraArgs: ["--exclude-dynamic-system-prompt-sections"] },
    "plan-derive": { model: "claude-opus-5", extraArgs: ["--exclude-dynamic-system-prompt-sections"] },
    "plan-sweep": { model: "claude-opus-5", extraArgs: ["--exclude-dynamic-system-prompt-sections"] },
    build: { model: "claude-opus-5", extraArgs: ["--exclude-dynamic-system-prompt-sections"] },
  },

  // Engine defaults for the supervisor; nothing overridden here.

  // Every provisioned worktree gets the engine's own lockfile-aware install
  // at its root, singleton and fanout alike.
  setup: { directories: ["."] },

  slices: {
    enabled: ["plan-inbox", "plan-derive", "plan-sweep"],
    sweep: {
      domain: ["src/**", "harness/**", "tests/**", "bin/**", "examples/**", "scripts/**"],
      posturePages: [".claude/rules/engineering.md", ".claude/rules/engine-boundary.md"],
    },
  },
};
