/**
 * Flume's own Flume chain — four plan slices → build. Loaded by the flume CLI from
 * `.flume/chain.ts`; the default export is the Chain.
 *
 * Dogfood note: chain.ts imports the in-repo runtime (`../src/`), not the
 * published dep — a breaking runtime change pairs with a chain.ts update in
 * the same commit (CLAUDE.md, "Source of truth"). Layer lanes and spec
 * ownership: `.claude/rules/spec-plan-build.md`.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

/**
 * Does inbox.md carry an undrained finding? Entries are `##` subsections
 * below the file's own marker; everything above it is format documentation
 * that also uses `##`, hence the slice.
 *
 * Read synchronously and cheaply (one small file) per `shouldRun`'s contract —
 * the same idiom the slices' cursor reads use for state.md. Any failure
 * returns `true`: plan's `shouldRun` treats an unreadable inbox as a reason
 * to run the tick, never to skip it.
 */
function inboxHasEntries(flumeDir: string): boolean {
  try {
    const text = readFileSync(resolve(flumeDir, "inbox.md"), "utf8");
    const marker = text.indexOf("<!-- entries below this line");
    return /^## /m.test(marker === -1 ? text : text.slice(marker));
  } catch {
    return true;
  }
}

/**
 * Any persisted prior-attempt record whose mode is `voluntary-bail` means a
 * build agent looked at an entry and refused it — "acceptance already holds"
 * being the field-traced case (an entry whose fix landed out-of-band via the
 * verdict-sha recovery flow bails forever, with no failure signature for the
 * quarantine brake — the 2026-08-17 decline/bail livelock). That verdict is
 * plan's to reconcile, so `shouldRun` treats it as a reason to run plan even
 * while the entry stays pickable. Same read-small-files contract as
 * `inboxHasEntries`; a corrupt record reads as absent, matching the engine's
 * own treatment (`spec/loop.md`, *Prior-outcome feedback*).
 */
function anyVoluntaryBailRecord(
  priorAttemptsDir: FlumeApi["priorAttemptsDir"],
  flumeDir: string,
): boolean {
  try {
    const dir = priorAttemptsDir(flumeDir);
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      try {
        const rec = JSON.parse(readFileSync(resolve(dir, name), "utf8"));
        if (rec?.mode === "voluntary-bail") return true;
      } catch {
        // unreadable record is not evidence of a bail
      }
    }
  } catch {
    // no prior-attempts dir — no records
  }
  return false;
}

import type {
  Chain,
  Phase,
  TickContext,
  WorktreeSetupContext,
} from "../src/Phase.ts";
import type { Gate } from "../src/Gate.ts";
import type { ChainFactory } from "../src/Dispatcher.ts";
import type { FlumeApi } from "../src/flumeApi.ts";

import { z } from "zod";
import type { EntryExtension } from "../src/PendingSchema.ts";





/**
 * The body of the markdown section whose heading text is exactly `heading`
 * (any `#` depth, no trailing decoration), up to the next heading of the
 * same or shallower depth — or `undefined` when no such heading exists.
 *
 * One grammar, two consumers: build's `promptArgs` renders the section a
 * pending entry's `per` cites as prompt data, and plan's `per cites
 * resolve` gate refuses a commit whose cite this function cannot resolve.
 * Because both read through here, what plan is held to is exactly what
 * build will be handed (`engineering.md`, *A seam gate reads what the real
 * writer wrote*).
 */
function sectionOf(text: string, heading: string): string | undefined {
  const lines = text.split("\n");
  let depth = 0;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*?)\s*$/.exec(lines[i]!);
    if (!m) continue;
    if (start === -1) {
      if (m[2] === heading) {
        depth = m[1]!.length;
        start = i;
      }
    } else if (m[1]!.length <= depth) {
      return lines.slice(start, i).join("\n").trimEnd();
    }
  }
  return start === -1 ? undefined : lines.slice(start).join("\n").trimEnd();
}

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
   * The single-file park build commits when an entry cannot ship — read back
   * by `build.shipped` below, written per `prompts/build.md`. One constant so
   * the instruction and the predicate cannot name different files.
   */
  const PARK_FILE = ".flume/plan/open-questions.md";

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
   * Every entry's `per` cite resolves: the path is in the gated commit and
   * the section is a heading in it, by the same resolver build renders the
   * section with. Promotes the plan prompt's "the cite must resolve in the
   * file it names" from prose to a gate (`engineering.md`, *Narration is the
   * ladder's bottom rung*) — and retires the build-side "nearest equivalent
   * heading" fallback, which was a plan-side error read as build's latitude.
   *
   * Reads through the engine's own at-sha reader (`api.git.readFileAtRef`):
   * a missing path is `null`, an unresolvable ref throws — never confused.
   * The queue read is the same one `pendingGate` makes (spec/pending.md,
   * *Dispatch reads come from the tip*); declared after it, so the JSON is
   * already known to parse when this runs. `per` is this chain's extension
   * field, so the check is the chain's — the engine never reads it.
   */
  const perResolvesGate: Gate = {
    name: "per cites resolve",
    when: "afterCommit",
    async run(ctx) {
      if (!ctx.commitSha) {
        return { ok: false, message: "per gate requires commitSha" };
      }
      const sha = ctx.commitSha;
      const queueRel = relative(ctx.flumeDir, ctx.pendingPath);
      const raw =
        ctx.stateRootRel === undefined
          ? readFileSync(ctx.pendingPath, "utf8")
          : await api.git.readFileAtRef(ctx.repoRoot, sha, join(ctx.stateRootRel, queueRel));
      if (raw === null) {
        return { ok: false, message: `${queueRel} missing at ${sha.slice(0, 7)}` };
      }
      const cites = (JSON.parse(raw) as { tag: string; per?: unknown }[]).map((e) => ({
        tag: e.tag,
        per: entryExtension.per.schema.parse(e.per),
      }));
      // One read per distinct path, concurrently — a queue cites a handful
      // of files many times over.
      const texts = new Map(
        await Promise.all(
          [...new Set(cites.map((c) => c.per.path))].map(
            async (p) => [p, await api.git.readFileAtRef(ctx.repoRoot, sha, p)] as const,
          ),
        ),
      );
      const unresolved: string[] = [];
      for (const { tag, per } of cites) {
        const text = texts.get(per.path);
        if (text === null || text === undefined) {
          unresolved.push(`${tag}: ${per.path} is not in the commit`);
        } else if (sectionOf(text, per.section) === undefined) {
          unresolved.push(`${tag}: no heading "${per.section}" in ${per.path}`);
        }
      }
      if (unresolved.length > 0) {
        return {
          ok: false,
          message: `${unresolved.length} per cite(s) do not resolve`,
          details: unresolved.join("\n"),
        };
      }
      return { ok: true, message: `${cites.length} per cite(s) resolve` };
    },
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
          model,
          extraArgs: [
            // Stabilize the system prompt for cache reuse: moves per-machine
            // sections (cwd, env, git status) into the first user message.
            // Within an active cache window, consecutive ticks can hit the
            // cached system prefix instead of rebuilding it.
            "--exclude-dynamic-system-prompt-sections",
          ],
        }),
        {
          // Sessions live under the flume state dir, so a relocated,
          // ephemeral dock owns its transcripts too and one `rm` removes the
          // whole footprint (spec/cli.md: state-root resolution). The root is
          // the dispatcher's own resolved value (spec/chain.md, *Per-run
          // artifacts belong under FLUME_DIR*), absolute, so build (which
          // runs in <flumeDir>/worktrees/<tag>/) writes up into the state
          // dir's sessions/ rather than a worktree git eats.
          dir: resolve(api.paths.flumeDir, "sessions"),
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
   * currently Opus, pinned by id rather than the `opus` alias so a run is
   * reproducible across Claude Code releases that move the alias.
   *
   * Re-pinning, and who acts on it: chain.ts is outside every phase lane,
   * so **the operator re-pins here, in an interactive `chore(flume):`
   * commit** — no tick can. The condition to re-read this on is observable
   * in the session capture under `<FLUME_DIR>/sessions/`: the usage lines
   * there carry cost per tick, so a step down is a budget ruling made on
   * measured spend, and a step up is build ticks reverting on work whose
   * entry was unambiguous.
   */
  const planAgent = phaseAgent("claude-opus-5");
  const buildAgent = phaseAgent("claude-opus-5");

  // ---------- plan slices (one job per tick; liveness is a fact of disk) ----------

  /**
   * Plan is four singleton slices, each owning one cursor in state.md and one
   * prompt that carries only that slice's material. Which slice is live is
   * computed here from disk — the inbox, a cursor against git, the queue —
   * never asked of the model: dispatch is the same kind of verdict
   * `shouldRun` exists for (`spec/loop.md`, *Declining a tick before the
   * invocation*), one level down. The continuation marker this replaces was
   * the model's claim about the same fact.
   *
   * Ladder order is priority: an operator's inbox note first; then
   * reconciling what landed (audit) before deriving new intent on top of it
   * (derive); the posture sweep last, insurance behind product. Pickable
   * work preempts audit, derive, and sweep — their windows are deferred,
   * never lost — and never preempts the inbox or a build refusal that only
   * plan can resolve.
   */
  const { repoRoot } = api.paths;
  const BUILD = "build";
  const INBOX = "plan-inbox";
  const AUDIT = "plan-audit";
  const DERIVE = "plan-derive";
  const SWEEP = "plan-sweep";

  const statePath = (flumeDir: string) => resolve(flumeDir, "plan", "state.md");

  /** The sha on a cursor line of state.md, or undefined when the line is absent. */
  function stampOf(flumeDir: string, label: string): string | undefined {
    try {
      const text = readFileSync(statePath(flumeDir), "utf8");
      return new RegExp(`^${label}\\s*\`?([0-9a-f]{7,40})`, "m").exec(text)?.[1];
    } catch {
      return undefined;
    }
  }

  /** The posture sweep records an open rotation as a paragraph opening `Rotation open`. */
  function rotationOpen(flumeDir: string): boolean {
    try {
      return /^Rotation open/m.test(readFileSync(statePath(flumeDir), "utf8"));
    } catch {
      return false;
    }
  }

  /**
   * Any commit past `stamp` touching `pathspec` — the window a slice would
   * process. One synchronous `git log -n 1`, because `shouldRun` and
   * `handoff` are synchronous by contract and this is the fact they decide
   * on. Fails open: an unreadable window (a stamp that does not resolve)
   * runs the slice, whose prompt refuses and says what to repair.
   */
  function commitsPast(stamp: string, pathspec: string[]): boolean {
    try {
      const out = execFileSync(
        "git",
        ["log", "--format=%H", "-n", "1", `${stamp}..HEAD`, "--", ...pathspec],
        { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
      return out.trim().length > 0;
    } catch {
      return true;
    }
  }

  /** Same domain `.flume/delta-window.mjs sweep` renders, plus spec/ for the retired-claim delta. */
  const SWEEP_DOMAIN = [
    "src", "tests", "bin", "examples",
    ".claude/rules/engineering.md", ".claude/rules/engine-boundary.md",
    "spec",
  ];

  /**
   * A build refusal only plan can resolve: a standing voluntary-bail record,
   * or a park in the last build wave (a committed `not-shipped` outcome,
   * which writes no prior-attempt record and is visible only on the
   * verdict). Without this leg a parked entry stays pickable, plan yields to
   * build, and build re-parks against the same fence forever (four attempts,
   * 2026-09-07). Read at `shouldRun` only — it is a reason to be woken, never
   * a reason for a slice to re-wake itself, since only a build wave clears it.
   */
  function reconcileDue(flumeDir: string): boolean {
    if (anyVoluntaryBailRecord(api.priorAttemptsDir, flumeDir)) return true;
    const lastBuild = api.readLatestVerdictsSync(flumeDir)[BUILD];
    return lastBuild?.mergeOutcomes?.some((o) => o.outcome === "not-shipped") ?? false;
  }

  interface SliceInputs {
    flumeDir: string;
    pickable: boolean;
  }
  interface Slice {
    name: string;
    description: string;
    /** The slice's window is non-empty on disk. Pure over its inputs; no side effects. */
    live: (inputs: SliceInputs) => boolean;
  }

  const SLICES: Slice[] = [
    {
      name: INBOX,
      description: "Drain .flume/inbox.md: route each finding to an entry, a question, or accepted debt.",
      live: ({ flumeDir }) => inboxHasEntries(flumeDir),
    },
    {
      name: AUDIT,
      description: "Cross-check commits past `Audited through:` against the sections they cite; reconcile build's bails and parks.",
      live: ({ flumeDir, pickable }) => {
        if (pickable) return false;
        const stamp = stampOf(flumeDir, "Audited through:");
        // Plan-artifact-only commits are not auditable work; they are passed
        // by the cursor when a real window is processed.
        return stamp === undefined || commitsPast(stamp, [".", ":!.flume/plan", ":!.flume/inbox.md"]);
      },
    },
    {
      name: DERIVE,
      description: "Derive spec/ changes past `Spec derived through:` into pending entries.",
      live: ({ flumeDir, pickable }) => {
        if (pickable) return false;
        const stamp = stampOf(flumeDir, "Spec derived through:");
        return stamp === undefined || commitsPast(stamp, ["spec/"]);
      },
    },
    {
      name: SWEEP,
      description: "One neighborhood of the posture sweep (`.claude/rules/posture-sweep.md`).",
      live: ({ flumeDir, pickable }) => {
        if (pickable) return false;
        const stamp = stampOf(flumeDir, "Posture swept through:");
        return stamp === undefined || rotationOpen(flumeDir) || commitsPast(stamp, SWEEP_DOMAIN);
      },
    },
  ];

  /**
   * Pickability at `shouldRun`: the dispatcher's own verdict when it handed
   * one (`ctx.pickable`, spec/chain.md *What a hook receives*); the bare
   * gate-kind check only for a hand-built context that carries none.
   */
  const pickableIn = (ctx: TickContext): boolean =>
    ctx.pickable
      ? ctx.pickable.length > 0
      : (ctx.pending ?? []).some((e) => isPickableNow(e, new Set()));

  /**
   * The next phase after a plan slice or a build wave: the first live slice,
   * else build if anything is pickable, else hibernate. `exclude` is the
   * slice that just ran without committing — no progress, no self-rewake, so
   * an unroutable inbox note or a refused render costs one tick, not a loop.
   * A slice that committed and is still live (a window larger than one
   * tick's budget, an open rotation) re-wakes itself.
   */
  function nextPhase(flumeDir: string, pickable: boolean, exclude?: string): string[] {
    const slice = SLICES.find((s) => s.name !== exclude && s.live({ flumeDir, pickable }));
    if (slice) return [slice.name];
    return pickable ? [BUILD] : [];
  }

  const planWritablePaths = [
    ".flume/plan/pending.json",
    ".flume/plan/state.md",
    ".flume/plan/open-questions.md",
    ".flume/inbox.md",
    // spec/ is human-directed and edited in-session, never by a phase; a
    // slice that finds ambiguity parks it in open-questions.md. Plan's own
    // findings never pass through the inbox — that is the external surface
    // the inbox slice drains.
  ];

  const slicePhase = (slice: Slice): Phase => ({
    name: slice.name,
    description: slice.description,
    promptPath: `prompts/${slice.name}.md`,
    concurrency: "singleton",
    agent: planAgent,
    writablePaths: planWritablePaths,
    // Every slice writes the queue, so every slice is held to its shape, the
    // fence pre-check, and its cites resolving.
    gates: [
      pendingGate({ extension: entryExtension, targetFence: buildFence }),
      perResolvesGate,
    ],
    shouldRun: (ctx) =>
      (slice.name === AUDIT && reconcileDue(ctx.flumeDir)) ||
      slice.live({ flumeDir: ctx.flumeDir, pickable: pickableIn(ctx) }),
    promptArgs: () => ({ PENDING_SCHEMA: renderSchemaForPrompt(entryExtension) }),
    handoff: (result) =>
      nextPhase(
        result.flumeDir,
        result.pickableAfter.length > 0,
        result.committed ? undefined : slice.name,
      ),
  });

  const planSlices = SLICES.map(slicePhase);

  /**
   * The full suite, scoped to commits that touch code. A build commit that
   * touches only plan artifacts (a park written to open-questions.md) has
   * nothing for the suite to judge, and running it anyway exposes that
   * commit to whatever the host is doing at the time — a sibling loop's
   * cargo builds slowed vitest's transform 7× and two 8s-timeout tests
   * reverted a park (2026-09-07). Declared skip, never inferred: the paths
   * are the commit's own touched list from the dispatcher, and the skip is
   * reported as its own message so a verdict reader can tell it from green.
   * An empty touched list (unknown) runs the suite.
   */
  const vitestSuite = shellGate({
    name: "vitest",
    when: "afterMerge",
    cmd: "pnpm",
    args: ["test", "--run"],
    failHint: "Tests failed — wave reverted",
  });
  const codePath =
    /^(src|tests|examples|bin)\/|^\.flume\/chain\.ts$|^(package\.json|pnpm-lock\.yaml|tsconfig[^/]*\.json|vitest\.config\.ts)$/;
  const vitestOnCode: typeof vitestSuite = {
    ...vitestSuite,
    run: async (ctx) => {
      const touched = ctx.touchedPaths ?? [];
      if (touched.length > 0 && !touched.some((p) => codePath.test(p))) {
        return {
          ok: true,
          message: `vitest not run — no code path among ${touched.length} touched path(s)`,
        };
      }
      return vitestSuite.run(ctx);
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
    gates: [tscGate, vitestOnCode],
    setupWorktree: setupBuildWorktree,
    promptArgs(ctx: TickContext) {
      if (!ctx.assignedEntry) {
        throw new Error("build phase requires an assignedEntry");
      }
      // `per` is this chain's own declared extension field — narrow it through
      // the same schema the parse gate validated it with.
      const per = entryExtension.per.schema.parse(ctx.assignedEntry.per);
      // The cited section, rendered as data rather than an errand over the
      // whole file (inbox 2026-09-10, *the tick's read set is prose*). Read
      // from this tick's own tree. Plan's `per cites resolve` gate holds
      // every queued cite to this resolver, so a miss here is a cite that
      // changed under the entry — loud, never a stand-in section.
      const section = sectionOf(
        readFileSync(join(ctx.cwd, per.path), "utf8"),
        per.section,
      );
      if (section === undefined) {
        throw new Error(
          `build: ${ctx.assignedEntry.tag} cites "${per.section}" in ${per.path}, which has no such heading`,
        );
      }
      return {
        ENTRY_JSON: JSON.stringify(ctx.assignedEntry, null, 2),
        TAG: ctx.assignedEntry.tag,
        PER_PATH: per.path,
        PER_SECTION: per.section,
        PER_SECTION_TEXT: section,
      };
    },
    handoff(result) {
      // A refusal only plan can resolve wakes the audit slice regardless of
      // what is pickable: a voluntary bail, or a commit that landed and this
      // chain's `shipped` declined (a park) — else build re-picks the same
      // entry into the same wall. Otherwise the ladder decides: the first
      // live slice, or build while anything is pickable, or hibernate.
      const refused =
        result.noCommit === "voluntary-bail" ||
        (result.entries ?? []).some(
          (e) => e.noCommit === "voluntary-bail" || (e.committed && !e.shipped && !e.reverted),
        );
      if (refused) return [AUDIT];
      return nextPhase(result.flumeDir, result.pickableAfter.length > 0);
    },
  };

  const flumeChain: Chain = {
    phases: [...planSlices, build],
    entryExtension,
    humanOnly: [], // no spec phase; spec corpus (spec/*.md) edited in-session, never by a phase
  };

  return { chain: flumeChain };
};

export default factory;
