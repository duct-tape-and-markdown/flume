/**
 * Cascade chain — the canonical spec → plan → build pipeline, expressed as
 * Flume Phases. The spec corpus is a human maintenance surface, so the chain
 * itself is the two machine phases that derive from it:
 *
 *   - plan: re-derives pending.json + state.md from the spec corpus + src
 *     (singleton).
 *   - build: ships pending entries to the trunk (fanout).
 *
 * This file is the load-bearing example: it demonstrates the shape a chain
 * takes when derivation splits across a singleton deriver and a fanout
 * shipper. Read it alongside the JSDoc on `Phase`, `Gate`, and the
 * pending-schema exports.
 *
 * Imports come from `../src/index.ts` — the same public surface a consumer
 * sees as `import { ... } from "flume"`. Path is relative because this file
 * lives inside the flume repo; in a host repo, swap `../src/index.ts` for
 * `flume`. See the trailing block.
 */

import { z } from "zod";
import type {
  Chain,
  ChainFactory,
  EntryExtension,
  Gate,
  Phase,
  TickContext,
} from "../src/index.ts";


// ---------- entry extension (v0.8 §2) ----------

/**
 * This project's pending-entry fields beyond the engine core
 * (tag/gate/dependsOnForks/files). Declared once — the same record drives
 * the parse-gate validator (`pendingGate({ extension: entryExtension, ... })`)
 * and the prompt schema (`renderSchemaForPrompt(entryExtension)`), so the
 * prompt and the parser cannot drift. The engine consumes none of these
 * fields; they are this chain's spec→plan→build workflow.
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


// ---------- chain factory (RELEASE-v0.11 §6) ----------

/**
 * The default export is a factory the engine calls with its own API. Every
 * engine value this chain composes with — gates, the schema renderer —
 * arrives as a parameter, so the chain resolves no engine copy of its own
 * and a second physical engine cannot enter the process. The only engine
 * import above is import type, which is erased at runtime.
 */
const factory: ChainFactory = (api) => {
  const {
    pendingGate,
    renderSchemaForPrompt,
    shellGate,
    tscGate,
    eslintGate,
  } = api;
  // ---------- project-specific gates ----------

  /**
   * The test suite, at `afterMerge` — the merged trunk is the only tree
   * anything validates as a whole, and this is the gate that says it is
   * still correct.
   *
   * Why `shellGate` and not the `vitestGate` builtin: that builtin fixes
   * `when: "afterCommit"` and takes no placement override, so composing the
   * public escape hatch is how a chain moves a language check to the trunk.
   * Same command, different gate point.
   */
  const vitestOnTrunk: Gate = shellGate({
    name: "vitest",
    when: "afterMerge",
    cmd: "pnpm",
    args: ["test", "--run"],
    failHint: "Tests failed — entry reverted from the trunk",
  });

  // ---------- phases ----------

  /**
   * Build phase — ships one or more disjoint pending entries to the trunk.
   *
   * Fanout: the dispatcher picks N entries that don't touch the same files and
   * runs N agent invocations in parallel worktrees. Each tick handles one
   * `assignedEntry`. Worktree branches merge serially after their afterCommit
   * gates pass; the afterMerge gates then run per entry on the trunk, after
   * that entry's cherry-pick, and a failure there reverts only that entry —
   * the rest of the wave stays shipped.
   *
   * Gates split by cost. Cheap structural checks stay `afterCommit`, inside
   * the worktree, so a type or lint error never reaches the trunk at all:
   * `tscGate` first, then `eslintGate`; failure reverts the worktree commit
   * and the entry stays pickable for the next tick. The suite runs
   * `afterMerge` (`vitestOnTrunk` above), because the merged tree is the one
   * no afterCommit gate ever saw — the trunk may have moved under the wave,
   * and two siblings that each passed in isolation can compose into a tree
   * neither worktree held. Running it N-wide in parallel worktrees would
   * also buy nothing but host contention, where a timeout reverts a clean
   * commit.
   *
   * Always hands off to plan so pending.json reconciles against the new trunk
   * state, regardless of success, bail, or validation-fail.
   *
   * Declared above `plan` (rather than in the plan/build reading order)
   * so `plan.gates` can reference `build` directly as `pendingGate`'s
   * `targetFence` — `build.writablePaths` is a static array literal here, not
   * declaration-driven, so no `get gates()` deferral is needed (contrast the
   * getter-backed pattern in `docs/CHAIN-AUTHORING.md`'s `pendingGate` section
   * for a chain where the fence resolves lazily).
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
    gates: [tscGate, eslintGate, vitestOnTrunk],
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

  /**
   * Plan phase — re-derives `.flume/plan/pending.json` and `state.md` from the
   * spec corpus + current src state, every tick from scratch.
   *
   * Singleton: pending.json and state.md are shared artifacts; two concurrent
   * planners would race. Gates the output through `pendingGate` so a
   * malformed pending.json, or an entry whose declared `files` can't survive
   * build's fence, reverts the commit instead of poisoning build.
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
    ],
    gates: [pendingGate({ targetFence: build, extension: entryExtension })],
    promptArgs() {
      return { PENDING_SCHEMA: renderSchemaForPrompt(entryExtension) };
    },
    handoff(result) {
      const hasPickable = result.pendingAfter.some((e) => e.gate.kind === "open");
      return hasPickable ? ["build"] : [];
    },
  };

  // ---------- chain ----------

  const cascadeChain: Chain = {
    phases: [plan, build],
    entryExtension,
    humanOnly: [], // both phases are machine-woken; the spec corpus a human edits is not a phase
  };

  return { chain: cascadeChain };
};

export default factory;

/* --------------------------------------------------------------------------
 * Plugging this into a host repo's `.flume/chain.ts`
 *
 * The flume CLI loads `<repo>/.flume/chain.ts` and calls its default export:
 * a factory `(api) => ({ chain })`, which is what `export default factory`
 * above hands it. To use this file as a starting point in a consumer repo:
 *
 *   1. Copy this file to `<your-repo>/.flume/chain.ts`.
 *
 *   2. Replace the `../src/index.ts` import path with `"flume"` — the
 *      package's single public entry point. The engine values this chain
 *      composes with arrive on the factory's `api` parameter, so the only
 *      engine import is `import type`:
 *
 *          import type {
 *            Chain,
 *            ChainFactory,
 *            EntryExtension,
 *            Gate,
 *            Phase,
 *            TickContext,
 *          } from "flume";
 *
 *   3. Adapt the phases to your project:
 *      - Trim phases you don't need (e.g. drop `build` for a single-phase
 *        chain, or add one of your own).
 *      - Update `writablePaths` to match your repo layout.
 *      - Swap in your own custom gates; drop the built-ins you don't use —
 *        they are destructured off `api` at the top of the factory.
 *      - Point `promptPath` at prompts that live next to chain.ts (e.g.
 *        `.flume/prompts/build.md`).
 *
 *   4. To customize the provider seam (`claudeCode` + decorators), return an
 *      `agent` from the factory alongside the chain — `{ chain, agent }`, not
 *      a module export; a named export cannot receive the API. Same for a
 *      `forkResolver`. See `flume/.flume/chain.ts` in this repo for the
 *      pattern.
 *
 * Run `pnpm exec flume status` to confirm the harness loaded your chain.
 * -------------------------------------------------------------------------- */
