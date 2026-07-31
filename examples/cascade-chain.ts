/**
 * Cascade chain — the canonical workshop → spec → plan → code pipeline,
 * expressed as Flume Phases.
 *
 * Three phases:
 *   - plan: re-derives pending.json + state.md from the spec corpus + src
 *     (singleton).
 *   - build: ships pending entries to the trunk (fanout).
 *   - spec: derives an aligned spec corpus from a workshop draft (singleton,
 *     human-woken).
 *
 * This file is the load-bearing example: it demonstrates the shape a chain
 * takes when it spans the full derivation pipeline. Read it alongside the
 * JSDoc on `Phase`, `Gate`, and the pending-schema exports.
 *
 * Imports come from `../src/index.ts` — the same public surface a consumer
 * sees as `import { ... } from "flume"`. Path is relative because this file
 * lives inside the flume repo; in a host repo, swap `../src/index.ts` for
 * `flume`. See the trailing block.
 */

import { z } from "zod";
import type {
  Chain,
  EntryExtension,
  Gate,
  Phase,
  TickContext,
} from "../src/index.ts";
import {
  parsePending,
  renderSchemaForPrompt,
  shellGate,
  tscGate,
  vitestGate,
  eslintGate,
} from "../src/index.ts";

// ---------- entry extension (v0.8 §2) ----------

/**
 * This project's pending-entry fields beyond the engine core
 * (tag/gate/dependsOnForks/files). Declared once — the same record drives
 * the parse-gate validator (`parsePending(raw, entryExtension)`) and the
 * prompt schema (`renderSchemaForPrompt(entryExtension)`), so the prompt and
 * the parser cannot drift. The engine consumes none of these fields; they
 * are this chain's spec→plan→build workflow.
 */
const entryExtension = {
  summary: {
    schema: z.string().min(1).max(200),
    hint: `"one-line what (≤200 chars)"`,
  },
  per: {
    schema: z.strictObject({
      path: z.string().min(1),
      section: z.string().min(1),
    }),
    hint: `{ "path": "specs/.../foo.md (the spec or rule that justifies this work)", "section": "Section heading text, no leading '## '" }`,
  },
  tests: {
    schema: z
      .array(
        z.strictObject({
          path: z.string().min(1),
          asserts: z.string().min(1),
        }),
      )
      .default([]),
    hint: `[ { "path": "...", "asserts": "behavior" } ]`,
  },
  acceptance: {
    schema: z.string().min(1),
    hint: `"what turns green when this is done"`,
  },
  notes: {
    schema: z.string().max(500).optional(),
    hint: `"≤500 chars; optional context not in the spec"`,
  },
} satisfies EntryExtension;

// ---------- project-specific gates ----------

/**
 * Plan-output validation. Reads `.flume/plan/pending.json` and confirms every
 * entry conforms to the schema. If parse fails, the commit is reverted and
 * plan re-runs with the parse errors injected as context.
 *
 * Why custom: the schema gate is project-shaped, not language-shaped — the
 * built-in gates (`tscGate`, `vitestGate`, `eslintGate`) cover language
 * correctness; this one covers the plan ↔ build contract specific to chains
 * that use the pending-schema surface. Inlined here so the example is
 * self-contained.
 */
const pendingParseGate: Gate = {
  name: "pending.json parses",
  when: "afterCommit",
  async run(ctx) {
    const { readFile } = await import("node:fs/promises");
    let raw: string;
    try {
      raw = await readFile(`${ctx.cwd}/.flume/plan/pending.json`, "utf8");
    } catch {
      return { ok: false, message: "pending.json missing after plan commit" };
    }
    const result = parsePending(raw, entryExtension);
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
 * Corpus-health audit run after the spec phase commits. Asserts the aligned
 * corpus is internally consistent — no orphaned cites, no duplicate entries
 * — before the new spec state propagates to plan.
 *
 * Why custom: spec drift is corpus-shaped and project-defined; no language
 * tool catches it. We use `shellGate` (the public escape hatch) to delegate
 * the actual audit to a project-owned script, keeping the gate-as-data
 * boundary clean.
 */
const specAuditGate: Gate = shellGate({
  name: "spec audit",
  when: "afterCommit",
  cmd: "pnpm",
  args: ["spec:audit"],
  failHint: "Spec corpus audit failed — commit reverted",
});

// ---------- phases ----------

/**
 * Spec phase — derives `specs/active/` from a workshop draft, sweeps drift,
 * audits corpus health.
 *
 * Singleton: the spec corpus is a single shared artifact that doesn't admit
 * concurrent edits. Human-woken (see `humanOnly` on the chain): the
 * dispatcher cannot wake spec from another phase's handoff, because spec
 * input is human-authored workshop content, not machine-derived signal.
 *
 * Gates the corpus through `specAuditGate` before yielding to plan; on green
 * it hands off to plan so pending.json refreshes against the new spec state.
 */
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
  gates: [specAuditGate],
  handoff(result) {
    return result.committed ? ["plan"] : [];
  },
};

/**
 * Plan phase — re-derives `.flume/plan/pending.json` and `state.md` from the
 * spec corpus + current src state, every tick from scratch.
 *
 * Singleton: pending.json and state.md are shared artifacts; two concurrent
 * planners would race. Gates the output through `pendingParseGate` so a
 * malformed pending.json reverts the commit instead of poisoning build.
 *
 * Hands off to build when at least one entry is `gate.kind === "open"`
 * (pickable); otherwise hibernates and waits for human signal.
 */
const plan: Phase = {
  name: "plan",
  description: "Re-derive .flume/plan/pending.json + state.md from disk.",
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
    return { PENDING_SCHEMA: renderSchemaForPrompt(entryExtension) };
  },
  handoff(result) {
    const hasPickable = result.pendingAfter.some((e) => e.gate.kind === "open");
    return hasPickable ? ["build"] : [];
  },
};

/**
 * Build phase — ships one or more disjoint pending entries to the trunk.
 *
 * Fanout: the dispatcher picks N entries that don't touch the same files and
 * runs N agent invocations in parallel worktrees. Each tick handles one
 * `assignedEntry`. Worktree branches merge serially after their afterCommit
 * gates pass; an afterMerge failure (none here, but the lifecycle supports
 * it) reverts the wave on the trunk.
 *
 * Gates with the language-level built-ins: `tscGate` first (cheap, catches
 * type errors before `vitestGate` even loads the module), then `vitestGate`,
 * then `eslintGate`. All afterCommit; failure reverts the worktree commit
 * and the entry stays pickable for the next tick.
 *
 * Always hands off to plan so pending.json reconciles against the new trunk
 * state, regardless of success, bail, or validation-fail.
 */
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
  gates: [tscGate, vitestGate, eslintGate],
  promptArgs(ctx: TickContext) {
    if (!ctx.assignedEntry) {
      throw new Error("build phase requires an assignedEntry in TickContext");
    }
    // `per` is this chain's declared extension field — narrow it through the
    // same schema the parse gate validated it with.
    const per = entryExtension.per.schema.parse(ctx.assignedEntry.per);
    return {
      ENTRY_JSON: JSON.stringify(ctx.assignedEntry, null, 2),
      TAG: ctx.assignedEntry.tag,
      PER_PATH: per.path,
      PER_SECTION: per.section,
    };
  },
  handoff() {
    return ["plan"];
  },
};

// ---------- chain ----------

export const cascadeChain: Chain = {
  phases: [plan, build, spec],
  entryExtension,
  humanOnly: ["spec"], // dispatcher cannot wake spec; humans do, after workshop sessions
};

/* --------------------------------------------------------------------------
 * Plugging this into a host repo's `.flume/chain.ts`
 *
 * The flume CLI loads `<repo>/.flume/chain.ts` and expects a default export
 * of `Chain`. To use this file as a starting point in a consumer repo:
 *
 *   1. Copy this file to `<your-repo>/.flume/chain.ts`.
 *
 *   2. Replace the `../src/index.ts` import paths with `"flume"` — the
 *      package's single public entry point:
 *
 *          import type { Chain, Gate, Phase, TickContext } from "flume";
 *          import {
 *            parsePending,
 *            renderSchemaForPrompt,
 *            shellGate,
 *            tscGate,
 *            vitestGate,
 *            eslintGate,
 *          } from "flume";
 *
 *   3. Adapt the phases to your project:
 *      - Trim phases you don't need (e.g. drop `spec` for a two-phase chain).
 *      - Update `writablePaths` to match your repo layout.
 *      - Swap in your own custom gates; drop the built-ins you don't use.
 *      - Point `promptPath` at prompts that live next to chain.ts (e.g.
 *        `.flume/prompts/build.md`).
 *
 *   4. Change the named export `cascadeChain` to a default export:
 *
 *          export default cascadeChain;
 *
 *      The CLI imports the default export when loading chain.ts.
 *
 *   5. Optionally export an `agent` alongside the chain to customize the
 *      provider seam (`claudeCode` + decorators); the dispatcher picks it up
 *      automatically. See `flume/.flume/chain.ts` in this repo for the
 *      pattern.
 *
 * Run `pnpm exec flume status` to confirm the harness loaded your chain.
 * -------------------------------------------------------------------------- */
