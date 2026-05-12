/**
 * Cascade chain — the canonical workshop → specs → plan → code pipeline,
 * expressed as Flume Phases.
 *
 * This file is the load-bearing example: it demonstrates how the discipline
 * Cascade's current `.flume/prompts/{plan,build,spec}.md` carry in prose
 * decomposes into typed declarations the harness can enforce.
 *
 * Read this alongside `src/Phase.ts` and `src/PendingSchema.ts`.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { Chain, Phase, TickContext } from "../src/Phase.ts";
import type { Gate, GateContext, GateResult } from "../src/Gate.ts";
import { parsePending, renderSchemaForPrompt } from "../src/PendingSchema.ts";

const exec = promisify(execFile);

// ---------- ad-hoc gate factories ----------
//
// These are illustrative — the production harness will ship batteries-included
// gates for tsc/vitest/eslint. Inlined here so the example is self-contained
// and reviewable as one document.

function shellGate(opts: {
  name: string;
  when: Gate["when"]; // "afterCommit" | "afterMerge"
  cmd: string;
  args: string[];
  failHint?: string;
}): Gate {
  return {
    name: opts.name,
    when: opts.when,
    async run(ctx: GateContext): Promise<GateResult> {
      try {
        const { stdout, stderr } = await exec(opts.cmd, opts.args, {
          cwd: ctx.cwd,
          maxBuffer: 16 * 1024 * 1024,
        });
        return { ok: true, message: `${opts.name} green`, details: stdout || stderr };
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; message: string };
        return {
          ok: false,
          message: opts.failHint ?? `${opts.name} failed`,
          details: (e.stderr ?? "") + (e.stdout ?? "") || e.message,
        };
      }
    },
  };
}

const tscGate = shellGate({
  name: "tsc",
  when: "afterCommit",
  cmd: "pnpm",
  args: ["tsc", "--noEmit"],
  failHint: "TypeScript errors prevent commit",
});

const vitestGate = shellGate({
  name: "vitest",
  when: "afterCommit",
  cmd: "pnpm",
  args: ["test", "--run"],
  failHint: "Test failures prevent commit",
});

const lintGate = shellGate({
  name: "eslint",
  when: "afterCommit",
  cmd: "pnpm",
  args: ["lint"],
  failHint: "Lint errors prevent commit",
});

/**
 * Plan-output validation. Reads .flume/plan/pending.json and confirms every
 * entry conforms to the schema. If parse fails, the commit is reverted and
 * plan re-runs with the parse errors injected as additional context.
 */
const pendingParseGate: Gate = {
  name: "pending.json parses",
  when: "afterCommit",
  async run(ctx) {
    const { readFile } = await import("node:fs/promises");
    const path = `${ctx.cwd}/.flume/plan/pending.json`;
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      return {
        ok: false,
        message: "pending.json missing after plan commit",
      };
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

// ---------- phases ----------

const plan: Phase = {
  name: "plan",
  description:
    "Re-derive .flume/plan/pending.json + state.md from disk.",
  promptPath: "prompts/plan.md",
  concurrency: "singleton",
  writablePaths: [
    ".flume/plan/pending.json",
    ".flume/plan/state.md",
    ".flume/plan/open-questions.md",
    "specs/_aligned/**", // graduation moves files into here
    "specs/active/**", // graduation removes them from here
  ],
  gates: [pendingParseGate],
  promptArgs() {
    return { PENDING_SCHEMA: renderSchemaForPrompt() };
  },
  handoff(result) {
    const hasPickable = result.pendingAfter.some((e) => e.gate.kind === "open");
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
    "prisma/**",
    "tests/**",
    "package.json",
    "tsconfig.json",
    "eslint.config.mjs",
    ".gitignore",
    // NOTE: build does not touch .flume/plan/pending.json. The harness writes
    // a separate commit post-merge that removes shipped entries. This avoids
    // cherry-pick conflicts when N fanout worktrees each touch the same file.
  ],
  gates: [tscGate, vitestGate, lintGate],
  promptArgs(ctx: TickContext) {
    if (!ctx.assignedEntry) {
      throw new Error("build phase requires an assignedEntry in TickContext");
    }
    return {
      ENTRY_JSON: JSON.stringify(ctx.assignedEntry, null, 2),
      TAG: ctx.assignedEntry.tag,
      PER_PATH: ctx.assignedEntry.per.path,
      PER_SECTION: ctx.assignedEntry.per.section,
    };
  },
  handoff() {
    // Build always wakes plan so it reconciles against the new trunk state,
    // regardless of success, bail, or validation-fail.
    return ["plan"];
  },
};

const spec: Phase = {
  name: "spec",
  description:
    "Derive specs/active/ from workshop/; sweep drift; audit corpus health.",
  promptPath: "prompts/spec.md",
  concurrency: "singleton",
  writablePaths: [
    "specs/active/**",
    "specs/_aligned/**", // pull-back from aligned when workshop targets it
    "specs/09-spec-flags.md",
    "workshop/_archive/**", // absorbed sources move here
  ],
  gates: [], // spec doesn't gate on code validation; corpus audit lives inside the prompt
  handoff(result) {
    return result.committed ? ["plan"] : [];
  },
};

// ---------- chain ----------

export const cascadeChain: Chain = {
  phases: [plan, build, spec],
  humanOnly: ["spec"], // dispatcher cannot wake spec; humans do, after workshop sessions
};
