/**
 * This repository's harness declaration (`spec/harness.md`, *What a consumer
 * declares*). Flume is the harness package's reference consumer: everything
 * the package owns — the slices, the prompts, the entry extension, the
 * judges, the discipline gates, the records, the plan state, the default
 * handoff — comes from `harness/`; this file states only the environment.
 */

import { vitestRunner, type DeclarationInput } from "../harness/index.ts";

export const declaration: DeclarationInput = {
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

  // Wave width bounded to two: each entry's gates run the suite, and two
  // four-wide waves on this host have reached the OOM edge. Two phase ticks
  // at once — a build wave beside one plan slice, three agents at most —
  // now that the ship lock serializes the judge suites (spec/loop.md, *The
  // ship lock and the worktree lock — sibling ticks take turns at git*).
  // Every other supervisor knob is the engine's default.
  supervisor: { maxParallel: 2, maxTicks: 2 },

  // Every provisioned worktree gets the engine's own lockfile-aware install
  // at its root, singleton and fanout alike.
  setup: { directories: ["."] },

  // The CI lanes the inbox slice reads as findings sources (spec/harness.md,
  // *CI lanes as a findings source*). The Windows job's failing titles are
  // how win32 support stays real (spec/cli.md, *win32 is a supported host*);
  // the POSIX job carries the integration lane and the publish-acceptance
  // steps, which no tick runs and nothing else reads.
  // The friction channel, so the reference consumer runs the one findings
  // source the package reads that fixtures alone had exercised: revert notes
  // and the teardown harvest land here, and the inbox slice drains them
  // (spec/harness.md, *Declared findings sources*).
  friction: "friction",
  ci: [
    {
      name: "windows",
      workflow: "ci.yml",
      job: "windows",
      // vitest prints one line per failing case; the capture is the title.
      // `posix` declares no reader: its job also runs steps that fail without
      // a title, and an empty set over a real red would read as drained.
      titles: /^\s*FAIL\s+\S+ > (.+)$/gm,
    },
    { name: "posix", workflow: "ci.yml", job: "ci" },
  ],

  slices: {
    enabled: ["plan-inbox", "plan-derive", "plan-sweep"],
    sweep: {
      domain: ["src/**", "harness/**", "tests/**", "bin/**", "examples/**", "scripts/**"],
      posturePages: [".claude/rules/engineering.md", ".claude/rules/engine-boundary.md"],
    },
  },
};
