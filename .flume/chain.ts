/**
 * Flume's own Flume chain — plan → build. Loaded by the flume CLI from
 * `.flume/chain.ts`; the default export is the Chain.
 *
 * Dogfood note: chain.ts imports the in-repo runtime (`../src/`), not the
 * published dep — a breaking runtime change pairs with a chain.ts update in
 * the same commit (CLAUDE.md, "Source of truth"). Layer lanes and spec
 * ownership: `.claude/rules/spec-plan-build.md`.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to this chain.ts directory (.flume/), regardless of cwd. */
const CHAIN_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Does inbox.md carry an undrained finding? Entries are `##` subsections
 * below the file's own marker; everything above it is format documentation
 * that also uses `##`, hence the slice.
 *
 * Read synchronously and cheaply (one small file) per `shouldRun`'s contract —
 * the same idiom `plan.handoff` already uses for state.md. Any failure
 * returns `true`: plan's `shouldRun` treats an unreadable inbox as a reason
 * to run the tick, never to skip it.
 */
function inboxHasEntries(): boolean {
  try {
    const text = readFileSync(
      resolve(process.env.FLUME_DIR ?? CHAIN_DIR, "inbox.md"),
      "utf8",
    );
    const marker = text.indexOf("<!-- entries below this line");
    return /^## /m.test(marker === -1 ? text : text.slice(marker));
  } catch {
    return true;
  }
}

import type {
  Chain,
  Phase,
  TickContext,
  WorktreeSetupContext,
} from "../src/Phase.ts";
import type { ChainFactory } from "../src/Dispatcher.ts";

import { z } from "zod";
import type { EntryExtension } from "../src/PendingSchema.ts";





// ---------- chain factory (spec/chain.md: The chain is a plugin) ----------

/**
 * The engine calls this with its own API. Every engine value below arrives
 * as a parameter — the chain imports only types, which are erased at
 * runtime. That is what makes a second physical engine unreachable in one
 * process, rather than merely detected after the fact.
 *
 * Dogfood note: the type imports above still point at ../src/, so a
 * breaking runtime change pairs with a chain.ts update in the same commit
 * (CLAUDE.md, "Source of truth").
 */
const factory: ChainFactory = (api) => {
  const {
    claudeCode,
    withSessionCapture,
    withTerminalRenderer,
    isPickableNow,
    renderSchemaForPrompt,
    tscGate,
    shellGate,
    pendingGate,
    setupWorktree: installWorktreeDeps,
  } = api;
  // ---------- entry extension (spec/pending.md: the chain-declared extension) ----------

  /**
   * Dogfood pending-entry fields beyond the engine core. Declared once: the
   * `schema` side validates at parse/gate time, the `hint` side renders into
   * the plan prompt via renderSchemaForPrompt — no drift possible. The engine
   * consumes none of these; they are this chain's workflow (spec→plan→build).
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
      hint: `{ "path": "spec/{loop,chain,prompt,pending,cli,jobs,worktrees}.md or .claude/rules/*.md — whichever justifies this work", "section": "exact heading, no leading '## '" }`,
    },
    /**
     * Acceptance decomposed: one line per behavior the work must pin. The
     * behavior only — which file the test lands in is build's call, and a
     * declared path was both a second copy of `files` (91% overlap across the
     * historical queue) and plan prescribing inside build's lane
     * (`.claude/rules/spec-plan-build.md`). See `.flume/PROTOCOL.md`,
     * *What an entry carries*.
     */
    tests: {
      schema: z.array(z.string().min(1)).default([]),
      hint: `[ "behavior this pins" ] — one per behavior; build picks the file`,
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

  // ---------- build fence ----------

  /**
   * Mandatory-on-every-entry surfaces ride the channel instead of per-entry
   * declarations: every behavior-changing entry edits tests, and
   * open-questions.md is the always-writable parking lane (collaboration
   * rule). Requiring these in entry.files turns one under-declaration into a
   * fence revert on otherwise-correct work; cross-entry collisions stay
   * covered by per-entry afterMerge revert (spec/worktrees.md).
   *
   * CHANGELOG.md is deliberately NOT here. It is not mandatory on every
   * entry — no gate demands it — so it stays an ordinary declared path: an
   * entry that edits it says so, and serializes against other entries that
   * do, which is correct.
   */
  /**
   * The single-file park build commits when an entry cannot ship — read back
   * by `build.shipped` below, written per `prompts/build.md`. One constant so
   * the instruction and the predicate cannot name different files.
   */
  const PARK_FILE = ".flume/plan/open-questions.md";

  const channelPaths = [PARK_FILE, "tests/**"];

  /**
   * Build's fence, hoisted so plan's `pendingGate` can pre-check
   * every derived entry's declared files against the fence build will
   * actually enforce — an entry that can't survive it fails at plan time,
   * naming the paths, instead of burning a build tick into a revert.
   * On a fanout tick the write guard narrows to the entry's declared files ∪
   * channelPaths; the phase globs below stay the outer ceiling
   * (spec/pending.md: the entry-scoped write guard).
   */
  const buildFence = {
    writablePaths: [
      // Source, bin, examples, docs, ad-hoc scripts (tests/** rides the channel)
      "src/**",
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
      "CHANGELOG.md",
      "README.md",
      "LICENSE",
      "LICENSE.*",
      "CONTRIBUTING.md",
      "CODE_OF_CONDUCT.md",
      "SECURITY.md",
      "AUTHORS.md",

      // CI
      ".github/**",

      // Mandatory per-entry surfaces — one declaration, shared with
      // entryChannelPaths (the engine requires channel ⊆ writable).
      ...channelPaths,

      // NOTE: pending.json is harness-written post-merge (the ship commit);
      // spec/** and harness surfaces (.flume/{chain.ts,prompts/**},
      // .claude/**) are outside every phase lane —
      // `.claude/rules/spec-plan-build.md`.
    ],
    entryChannelPaths: channelPaths,
  };

  /**
   * Materialize node_modules in a fresh build worktree, then assert it, so
   * missing deps fail here rather than surfacing post-agent as confusing
   * tsc/vitest "cannot find module" noise.
   *
   * The assertion throws, and a throw from this hook parks just this entry —
   * the dispatcher's per-entry provisioning isolation covers chain
   * `setupWorktree` hooks as well as `createWorktree`, so a failed provision
   * records a ProvisionFailure and the rest of the wave continues
   * (`spec/worktrees.md`, *Provisioning failure is isolated to the entry that
   * hit it*). The engine helper is
   * lockfile-aware (src/setupWorktree.ts; dogfood discipline
   * spec/worktrees.md); we do NOT symlink repoRoot/node_modules — pnpm
   * deletes a symlinked node_modules on install (pnpm/pnpm#9973). The
   * sentinel derives from the worktree's own manifest, not a hardcoded dep.
   */
  const setupBuildWorktree = async (
    ctx: WorktreeSetupContext,
  ): Promise<void> => {
    await installWorktreeDeps(ctx.worktreePath);
    const manifest = JSON.parse(
      readFileSync(join(ctx.worktreePath, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    const sentinel = Object.keys(manifest.dependencies ?? {})[0];
    if (
      sentinel &&
      !existsSync(
        join(ctx.worktreePath, "node_modules", sentinel, "package.json"),
      )
    ) {
      throw new Error(
        `setupWorktree: node_modules/${sentinel} missing after install — dependency materialization failed`,
      );
    }
  };

  // ---------- agents ----------

  /**
   * Per-tick session capture + condensed terminal output, pinned to `model`.
   *
   * `claude -p --output-format stream-json --verbose` emits NDJSON per turn
   * (tool calls, content, token usage). withSessionCapture (innermost) tees
   * the raw stream into `<FLUME_DIR>/sessions/<timestamp>-<cwd>.jsonl` for cost
   * analysis and replay. withTerminalRenderer (outermost) consumes the same
   * stream and forwards a one-line-per-tool-call summary to the dispatcher's
   * stdout instead of the raw JSON wall.
   */
  const phaseAgent = (model: string) =>
    withTerminalRenderer(
      withSessionCapture(
        claudeCode({
          outputFormat: "stream-json",
          extraArgs: [
            // Stabilize the system prompt for cache reuse: moves per-machine
            // sections (cwd, env, git status) into the first user message.
            // Within an active cache window, consecutive ticks can hit the
            // cached system prefix instead of rebuilding it.
            "--exclude-dynamic-system-prompt-sections",
            "--model",
            model,
          ],
        }),
        {
          // Sessions track the flume state dir (FLUME_DIR), so a relocated,
          // ephemeral dock owns its transcripts too and one `rm` removes the
          // whole footprint (spec/cli.md: state-root resolution). The CLI canonicalizes the
          // resolved root into FLUME_DIR; the `?? CHAIN_DIR` fallback is
          // defensive only. Absolute either way, so build (which runs in
          // <flumeDir>/worktrees/<tag>/) writes up into the state dir's
          // sessions/ rather than a worktree git eats.
          dir: resolve(process.env.FLUME_DIR ?? CHAIN_DIR, "sessions"),
          filename: (inv) => {
            const ts = new Date().toISOString().replace(/[:.]/g, "-");
            const cwdName = basename(inv.cwd) || "tick";
            return `${ts}-${cwdName}.jsonl`;
          },
        },
      ),
    );

  /**
   * Model pinned per phase: the seam exists so the tiers can diverge (plan
   * carries open-ended judgment; build executes decided entries). Both
   * currently sonnet — a usage-budget ruling, not a collapse of the seam.
   *
   * Retiring condition, and who acts on it: chain.ts is outside every phase
   * lane, so **the operator re-pins here, in an interactive `chore(flume):`
   * commit** — no tick can. The condition to re-read this on is observable
   * in the session capture under `<FLUME_DIR>/sessions/`: plan ticks
   * retrying past a gate, or build ticks reverting on work whose entry was
   * unambiguous. Neither is a budget problem; both are a tier problem.
   */
  const planAgent = phaseAgent("sonnet");
  const buildAgent = phaseAgent("sonnet");

  // ---------- phases ----------

  const plan: Phase = {
    name: "plan",
    description:
      "Re-derive .flume/plan/{pending.json,state.md,open-questions.md} from spec/ + current src state; drain .flume/inbox.md.",
    promptPath: "prompts/plan.md",
    concurrency: "singleton",
    agent: planAgent,
    writablePaths: [
      ".flume/plan/pending.json",
      ".flume/plan/state.md",
      ".flume/plan/open-questions.md",
      ".flume/inbox.md",
      // NOTE: plan does NOT touch spec/. The spec corpus
      // (spec/*.md) is human-directed, edited in-session not by a phase;
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
    // The builtin composes core + this chain's extension for
    // validation and pre-checks every entry's declared files against build's
    // fence at plan time.
    gates: [pendingGate({ extension: entryExtension, targetFence: buildFence })],
    /**
     * Decline only a tick that provably has nothing to do but pass
     * the baton: the queue already carries pickable work, so the sweep yields
     * by rule (`posture-sweep.md`, *The sweep yields to pickable work*), and
     * the inbox is empty, so there is nothing to drain.
     *
     * Audit and derive are **deferred, never lost**. A declined tick makes no
     * commit, so `<commit-delta>`'s last-`plan:` window and `<spec-delta>`'s
     * derive stamp both stay exactly where they were; the next tick that runs
     * sees the whole backlog. Deferral is bounded — build drains the queue,
     * nothing stays pickable forever, and the empty-queue tick runs in full.
     *
     * Not checked here: promotable `blockedBy` entries. An entry whose blocker
     * has shipped reads as unpickable to the line below (its blocker is not in
     * this tick's shipped set), so a queue of nothing but promotable entries
     * takes the `return true` and plan runs. Adding a promote check would only
     * make the predicate decline less often, for no correctness gain.
     *
     * Fails open everywhere it is unsure: an unreadable inbox runs the tick.
     */
    shouldRun(ctx: TickContext) {
      const pending = ctx.pending ?? [];
      if (!pending.some((e) => isPickableNow(e, new Set()))) return true;
      return inboxHasEntries();
    },
    promptArgs() {
      return { PENDING_SCHEMA: renderSchemaForPrompt(entryExtension) };
    },
    handoff(result) {
      // Plan re-wakes itself while state.md carries `Plan continues: yes` —
      // the vertical-slice signal (one focused mode per tick). The prompt
      // mandates the marker; absence = stable. state.md lives under the
      // relocatable state root (FLUME_DIR), not the config dir — same idiom
      // as the sessions dir above.
      let planContinues = false;
      try {
        const stateText = readFileSync(
          resolve(process.env.FLUME_DIR ?? CHAIN_DIR, "plan", "state.md"),
          "utf8",
        );
        planContinues = /^Plan continues:\s*yes\b/im.test(stateText);
      } catch {
        // state.md missing — treat as stable; build (if pickable) or hibernate.
      }

      // Same pickability verdict the dispatcher will reach (blockedBy with
      // shipped blockers, fork gates, capabilities) — not a hand-rolled
      // subset that drifts as gate variants are added.
      //
      // Pickable work preempts the continue-marker (posture-sweep.md, "The
      // sweep yields to pickable work"): a sweep tick that files an entry
      // and leaves `Plan continues: yes` must still hand to build, or the
      // baton loops on a declining plan (shouldRun defers to build while
      // handoff defers to the marker) and build never runs.
      const shipped = new Set(result.shippedTags);
      const hasPickable = result.pendingAfter.some((e) =>
        isPickableNow(e, shipped),
      );
      if (hasPickable) return [build.name];
      return planContinues ? [plan.name] : [];
    },
  };

  const build: Phase = {
    name: "build",
    description: "Ship one (or N disjoint) pending entries to the trunk.",
    promptPath: "prompts/build.md",
    concurrency: "fanout",
    agent: buildAgent,
    // Fence hoisted to `buildFence` above so plan's pendingGate pre-checks
    // against the same object build enforces — one declaration, no drift.
    writablePaths: buildFence.writablePaths,
    entryChannelPaths: buildFence.entryChannelPaths,
    // Entry-scoped narrowing on, completing this chain's own migration
    // across the flip that made it opt-in — buildFence's comment and the
    // pendingGate pre-check were both written assuming it; without the flag
    // the channel declaration above is the dead config the load refusal
    // (spec/chain.md, *A dead declaration is refused at load*) exists to
    // catch.
    scopeWritesToEntry: true,
    /**
     * This chain's own answer to "did that commit finish the work?"
     * (`spec/pending.md`, *Ship detection trusts the agent's own account*).
     * The engine reports facts and holds no notion of a park — the vocabulary
     * and the convention are ours, and `prompts/build.md` is the other half:
     * it instructs a **single-file committed park** into open-questions.md
     * when an entry cannot ship, and this reads exactly that shape back.
     *
     * Deliberately not "touched only `entryChannelPaths`": `tests/**` is a
     * channel, so that predicate would misclassify an entry whose work *is*
     * tests — a real case (CHAINTS-PREDICATE-COVERAGE shipped that way).
     * Only the park file itself, and nothing else, is a park.
     */
    shipped: ({ touchedPaths }) =>
      !(
        touchedPaths.length > 0 &&
        touchedPaths.every((p) => p === PARK_FILE)
      ),
    // spec/chain.md (gate placement): vitest runs afterMerge, not afterCommit. Under
    // fanout, N parallel afterCommit suites contend and flaky-timeout-revert
    // clean commits; afterMerge revert is now per-entry (§7b). tscGate stays
    // afterCommit — cheap, structural, catches type errors before merge.
    gates: [
      tscGate,
      shellGate({
        name: "vitest",
        when: "afterMerge",
        cmd: "pnpm",
        args: ["test", "--run"],
        failHint: "Tests failed — wave reverted",
      }),
    ],
    setupWorktree: setupBuildWorktree,
    promptArgs(ctx: TickContext) {
      if (!ctx.assignedEntry) {
        throw new Error("build phase requires an assignedEntry");
      }
      // `per` is this chain's own declared extension field — narrow it through
      // the same schema the parse gate validated it with.
      const per = entryExtension.per.schema.parse(ctx.assignedEntry.per);
      return {
        ENTRY_JSON: JSON.stringify(ctx.assignedEntry, null, 2),
        TAG: ctx.assignedEntry.tag,
        PER_PATH: per.path,
        PER_SECTION: per.section,
      };
    },
    handoff(result) {
      // Wake plan when the wave actually produced signal for it to audit:
      // shipped commits to reconcile, gate fires that imply MAINTAIN
      // entries, or a voluntary bail — the build prompt promises
      // "plan re-derives next tick" on a park-and-bail, so plan must see it.
      // A true no-op wave (nothing pickable) carries no signal — hibernate.
      // Operator can `flume wake plan` to force a tick.
      if (
        result.shippedTags.length === 0 &&
        result.gateResults.length === 0 &&
        result.noCommit !== "voluntary-bail"
      ) {
        return [];
      }
      return [plan.name];
    },
  };

  const flumeChain: Chain = {
    phases: [plan, build],
    entryExtension,
    humanOnly: [], // no spec phase; spec corpus (spec/*.md) edited in-session, never by a phase
  };

  return { chain: flumeChain };
};

export default factory;
