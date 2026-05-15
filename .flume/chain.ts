/**
 * Flume's own Flume chain — plan → build.
 *
 * Loaded by the flume CLI from `.flume/chain.ts`. The default export is the
 * Chain.
 *
 * Two phases (no spec): `spec/RELEASE-v0.1.md` is human-curated and stable.
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

import { readFile, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
import { tscGate, vitestGate } from "../src/builtinGates.ts";

// ---------- project-specific gates ----------

/** pending.json conforms to the schema. Reverts plan's commit on violation. */
const pendingParseGate: Gate = {
  name: "pending.json parses",
  when: "afterCommit",
  async run(ctx) {
    let raw: string;
    try {
      raw = await readFile(`${ctx.cwd}/.flume/plan/pending.json`, "utf8");
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
 * Materialize gitignored-but-required files in a fresh build worktree.
 *
 * `git worktree add` shares .git and tracked working tree but does NOT copy
 * untracked or gitignored files. node_modules is gitignored; tsc and vitest
 * need it. A symlink suffices because the worktree shares pnpm-lock.yaml
 * with the main repo.
 */
const buildSetupWorktree = async (
  ctx: WorktreeSetupContext,
): Promise<void> => {
  const linkables = ["node_modules"];
  for (const name of linkables) {
    const target = join(ctx.repoRoot, name);
    const linkPath = join(ctx.worktreePath, name);
    if (existsSync(target) && !existsSync(linkPath)) {
      await symlink(target, linkPath);
    }
  }
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
    // (spec/RELEASE-v0.1.md and any future spec files) is human-curated;
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
    "src/**",
    "tests/**",
    "bin/**",
    "examples/**",
    "docs/**",
    "package.json",
    "pnpm-lock.yaml",
    "tsconfig.json",
    "vitest.config.ts",
    ".gitignore",
    ".env.example",
    "README.md",
    "LICENSE",
    "CHANGELOG.md",
    ".github/**",
    // NOTE: build does NOT touch .flume/plan/pending.json. Harness writes
    // the ship commit post-merge to avoid cherry-pick conflicts.
    // NOTE: build does NOT touch spec/**. The spec corpus is human-curated;
    // if a build entry needs spec clarification, the entry should be blocked
    // and an open question surfaced.
  ],
  gates: [tscGate, vitestGate],
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
  humanOnly: [], // no spec phase; spec/RELEASE-v0.1.md is edited via normal commits
};

export default flumeChain;

/**
 * Per-tick session capture + condensed terminal output.
 *
 * `claude -p --output-format stream-json --verbose` emits NDJSON per turn
 * (tool calls, content, token usage). withSessionCapture (innermost) tees
 * the raw stream into `.flume/sessions/<timestamp>-<cwd>.jsonl` for cost
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
      // Absolute path so build (which runs in .flume/worktrees/<tag>/) still
      // writes into the main repo's .flume/sessions/. Worktree cleanup would
      // otherwise eat the build transcripts.
      dir: resolve(CHAIN_DIR, "sessions"),
      filename: (inv) => {
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const cwdName = inv.cwd.split("/").pop() ?? "tick";
        return `${ts}-${cwdName}.jsonl`;
      },
    },
  ),
);
