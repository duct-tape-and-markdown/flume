/**
 * Flume's own Flume chain — plan → build.
 *
 * Loaded by the flume CLI from `.flume/chain.ts`. The default export is the
 * Chain.
 *
 * Two phases (no spec): the spec corpus (`spec/RELEASE-*.md`) is human-directed, not phase-written.
 * Plan derives pending.json from it + current src state; build ships entries.
 *
 * Spec edits flow through normal commits, not through a flume phase. If an
 * entry surfaces real spec ambiguity, hand-edit the spec file as a separate
 * commit and run `flume tick` (plan) to refresh.
 *
 * Dogfood note: this is flume operating on flume. chain.ts imports from
 * `../src/` (the in-repo runtime) rather than `flume/src/` (the published
 * dep). Any breaking runtime change must be paired with a chain.ts update
 * in the same commit.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

/** Absolute path to this chain.ts directory (.flume/), regardless of cwd. */
const CHAIN_DIR = dirname(fileURLToPath(import.meta.url));

import type {
  Chain,
  Phase,
  TickContext,
  WorktreeSetupContext,
} from "../src/Phase.ts";
import type { Gate } from "../src/Gate.ts";
import {
  claudeCode,
  withSessionCapture,
  withTerminalRenderer,
} from "../src/Agent.ts";
import {
  parsePending,
  renderSchemaForPrompt,
} from "../src/PendingSchema.ts";
import { tscGate, shellGate } from "../src/builtinGates.ts";

// ---------- project-specific gates ----------

/** pending.json conforms to the schema. Reverts plan's commit on violation. */
const pendingParseGate: Gate = {
  name: "pending.json parses",
  when: "afterCommit",
  async run(ctx) {
    let raw: string;
    try {
      // §16 reference use: read pending from the resolved state root the
      // dispatcher hands in, not a hardcoded `.flume/` — so this gate is
      // correct under a relocated flumeDir.
      raw = await readFile(join(ctx.flumeDir, "plan", "pending.json"), "utf8");
    } catch {
      return { ok: false, message: "pending.json missing after plan commit" };
    }
    const result = parsePending(raw);
    if (result.ok) {
      return {
        ok: true,
        message: `pending.json parsed (${result.entries.length} entries)`,
      };
    }
    return {
      ok: false,
      message: `pending.json has ${result.errors.length} schema violations`,
      details: result.errors
        .map((e) => `  [${e.index}] ${e.path}: ${e.message}`)
        .join("\n"),
    };
  },
};

/**
 * Materialize node_modules in a fresh build worktree.
 *
 * `git worktree add` shares .git and the tracked tree but not gitignored
 * files; node_modules is gitignored and tsc/vitest need it. We do NOT
 * symlink repoRoot/node_modules: pnpm deletes a symlinked node_modules on
 * install (pnpm/pnpm#9973). Instead we install fresh — pnpm hardlinks from
 * its global content-addressable store, so this is seconds, not a refetch.
 * `enableGlobalVirtualStore` (pnpm-workspace.yaml, https://pnpm.io/git-worktrees)
 * is the experimental opt-in optimization; the dogfood chain uses the
 * robust default flume's docs teach (docs/CHAIN-AUTHORING.md, spec §6/§11).
 */
const buildSetupWorktree = async (
  ctx: WorktreeSetupContext,
): Promise<void> => {
  await execFileP("pnpm", ["install", "--frozen-lockfile"], {
    cwd: ctx.worktreePath,
  });
};

/**
 * Defense-in-depth (spec §6): a worktree with un-materialized deps makes
 * tscGate/vitestGate fail with confusing "cannot find module" noise. Fail
 * loud and specific instead. Strategy-agnostic — asserts the outcome (a
 * sentinel dep resolves from the worktree root), not the mechanism, so it
 * stays valid if setupWorktree's strategy changes.
 */
const worktreeDepsGate: Gate = {
  name: "worktree deps resolve",
  when: "afterCommit",
  async run(ctx) {
    const sentinel = join(ctx.cwd, "node_modules", "zod", "package.json");
    if (existsSync(sentinel)) {
      return { ok: true, message: "worktree node_modules resolves (zod sentinel)" };
    }
    return {
      ok: false,
      message:
        "worktree node_modules missing sentinel 'zod' — setupWorktree dependency materialization failed",
    };
  },
};

// ---------- phases ----------

const plan: Phase = {
  name: "plan",
  description:
    "Re-derive .flume/plan/{pending.json,state.md,open-questions.md} from spec/ + current src state; drain .flume/inbox.md.",
  promptPath: "prompts/plan.md",
  concurrency: "singleton",
  writablePaths: [
    ".flume/plan/pending.json",
    ".flume/plan/state.md",
    ".flume/plan/open-questions.md",
    ".flume/inbox.md",
    // NOTE: plan does NOT touch spec/. The spec corpus
    // (spec/RELEASE-*.md) is human-directed, edited in-session not by a phase;
    // if plan discovers ambiguity, it surfaces it via open-questions.md
    // for a human to fold back into the spec.
    //
    // .flume/inbox.md IS writable: plan drains it each tick by routing
    // each entry into pending.json, open-questions.md, or accepted-debt
    // (recorded in the commit body). External writers (humans, future
    // review skills) append; plan removes after routing. Plan's own audit
    // findings do NOT pass through inbox — they're written directly to
    // pending.json / open-questions.md, with narrative in the commit body.
  ],
  gates: [pendingParseGate],
  promptArgs() {
    return { PENDING_SCHEMA: renderSchemaForPrompt() };
  },
  handoff(result) {
    // Plan re-wakes itself when state.md ends with `Plan continues: yes`.
    // This is the vertical-slice signal: plan does one focused mode per tick
    // (audit / derive / maintain) and tells the harness whether more plan
    // work remains. If yes, the harness keeps the baton on plan; if no, hand
    // off to build (if pickable) or hibernate. The prompt mandates the final
    // state.md line, so absence here = stable.
    let planContinues = false;
    try {
      const stateText = readFileSync(
        resolve(CHAIN_DIR, "plan", "state.md"),
        "utf8",
      );
      planContinues = /^Plan continues:\s*yes\b/im.test(stateText);
    } catch {
      // state.md missing — treat as stable; build (if pickable) or hibernate.
    }

    if (planContinues) return ["plan"];

    const hasPickable = result.pendingAfter.some(
      (e) => e.gate.kind === "open",
    );
    return hasPickable ? ["build"] : [];
  },
};

const build: Phase = {
  name: "build",
  description: "Ship one (or N disjoint) pending entries to the trunk.",
  promptPath: "prompts/build.md",
  concurrency: "fanout",
  writablePaths: [
    // Source, tests, bin, examples, docs, ad-hoc scripts
    "src/**",
    "tests/**",
    "bin/**",
    "examples/**",
    "docs/**",
    "scripts/**",

    // Package metadata
    "package.json",
    "pnpm-lock.yaml",

    // TS / test / lint / formatter / bundler configs — variants common
    // (tsconfig.build.json, vitest.config.mjs, eslint.config.ts, etc.)
    "tsconfig*.json",
    "vitest.config.*",
    "*.config.ts",
    "*.config.js",
    "*.config.mjs",
    "*.config.cjs",
    ".prettierrc",
    ".prettierrc.*",

    // Dotfiles for editor / runtime / npm
    ".gitignore",
    ".editorconfig",
    ".nvmrc",
    ".node-version",
    ".npmrc",
    ".env.example",

    // User-facing root docs
    "README.md",
    "LICENSE",
    "LICENSE.*",
    "CHANGELOG.md",
    "CONTRIBUTING.md",
    "CODE_OF_CONDUCT.md",
    "SECURITY.md",
    "AUTHORS.md",

    // CI + dev-tooling dirs
    ".github/**",
    ".changeset/**",
    ".husky/**",
    ".devcontainer/**",

    // NOTE: build does NOT touch .flume/plan/pending.json. Harness writes
    // the ship commit post-merge to avoid cherry-pick conflicts.
    // NOTE: build does NOT touch spec/**. The spec corpus is human-curated;
    // if a build entry needs spec clarification, the entry should be blocked
    // and an open question surfaced.
    // NOTE: build does NOT touch .flume/{chain.ts,prompts/**,plan/**} or
    // .claude/{rules,settings*.json}. Those are harness/human territory;
    // edits flow through `chore(flume):` commits, not build ticks.
  ],
  // §7a (RELEASE-v0.2.md): vitest runs afterMerge, not afterCommit. Under
  // fanout, N parallel afterCommit suites contend and flaky-timeout-revert
  // clean commits; afterMerge revert is now per-entry (§7b). tscGate stays
  // afterCommit — cheap, structural, catches type errors before merge.
  gates: [
    worktreeDepsGate,
    tscGate,
    shellGate({
      name: "vitest",
      when: "afterMerge",
      cmd: "pnpm",
      args: ["test", "--run"],
      failHint: "Tests failed — wave reverted",
    }),
  ],
  setupWorktree: buildSetupWorktree,
  promptArgs(ctx: TickContext) {
    if (!ctx.assignedEntry) {
      throw new Error("build phase requires an assignedEntry");
    }
    return {
      ENTRY_JSON: JSON.stringify(ctx.assignedEntry, null, 2),
      TAG: ctx.assignedEntry.tag,
      PER_PATH: ctx.assignedEntry.per.path,
      PER_SECTION: ctx.assignedEntry.per.section,
    };
  },
  handoff(result) {
    // Wake plan when the wave actually produced signal for it to audit:
    // shipped commits to reconcile, or gate fires that imply MAINTAIN
    // entries. A true no-op wave (nothing pickable, or all picked entries
    // exited cleanly per the writablePaths directive) carries no signal —
    // hibernate. Operator can `flume wake plan` to force a tick.
    if (result.shippedTags.length === 0 && result.gateResults.length === 0) {
      return [];
    }
    return ["plan"];
  },
};

const flumeChain: Chain = {
  phases: [plan, build],
  humanOnly: [], // no spec phase; spec corpus (spec/RELEASE-*.md) edited in-session, never by a phase
};

export default flumeChain;

/**
 * Per-tick session capture + condensed terminal output.
 *
 * `claude -p --output-format stream-json --verbose` emits NDJSON per turn
 * (tool calls, content, token usage). withSessionCapture (innermost) tees
 * the raw stream into `<FLUME_DIR>/sessions/<timestamp>-<cwd>.jsonl` for cost
 * analysis and replay. withTerminalRenderer (outermost) consumes the same
 * stream and forwards a one-line-per-tool-call summary to the dispatcher's
 * stdout instead of the raw JSON wall.
 */
export const agent = withTerminalRenderer(
  withSessionCapture(
    claudeCode({
      outputFormat: "stream-json",
      extraArgs: [
        // Stabilize the system prompt for cache reuse: moves per-machine
        // sections (cwd, env, git status) into the first user message.
        // Within an active 5-min cache window, consecutive ticks can hit
        // the cached system prefix instead of rebuilding it.
        "--exclude-dynamic-system-prompt-sections",
      ],
    }),
    {
      // Sessions track the flume state dir (FLUME_DIR), so a relocated,
      // ephemeral dock owns its transcripts too and one `rm` removes the whole
      // footprint (RELEASE-v0.3 §12). The CLI canonicalizes the resolved root
      // into FLUME_DIR; the `?? CHAIN_DIR` fallback is defensive only. Absolute
      // either way, so build (which runs in <flumeDir>/worktrees/<tag>/) writes
      // up into the state dir's sessions/ rather than a worktree git eats.
      dir: resolve(process.env.FLUME_DIR ?? CHAIN_DIR, "sessions"),
      filename: (inv) => {
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const cwdName = basename(inv.cwd) || "tick";
        return `${ts}-${cwdName}.jsonl`;
      },
    },
  ),
);
