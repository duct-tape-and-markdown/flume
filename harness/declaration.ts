/**
 * The declaration a consumer writes to adopt the harness package
 * (`spec/harness.md`, *What a consumer declares*) — the fields that decide an
 * environment, and the strict schema that refuses anything else.
 *
 * Strict is the whole point of the shape. A field the package never reads is
 * a consumer's belief about its environment that nothing honours, and a
 * required one silently defaulted is the same belief inverted; both are read
 * back at load and refused by name (`.claude/rules/engineering.md`, *Loud or
 * nothing*). Refusal names the field, and for an unrecognized key the valid
 * set beside it, so a rename that lands in a release is a message a consumer
 * can act on rather than a default they never discover.
 *
 * Nothing here names an engine artifact path, a verdict field, or a
 * prior-attempt mode: those are facts the engine reports and the package
 * reads, never values an environment gets to choose.
 *
 * This module is the shape alone. Whether a declared `specLocus` glob
 * resolves a cite, whether a gate's registry name is one the package ships,
 * and how the fence becomes a phase's `writablePaths` belong to the resolver
 * and the chain factory that read this.
 */

import { z } from "zod";

import type { GatePhase } from "../src/Gate.js";
import type { Chain } from "../src/Phase.js";

import type { CiTitleReader } from "./ci.js";
import type { SectionResolver } from "./citeResolver.js";
import type { Handoff } from "./handoff.js";
import { parseOrThrow, strict } from "./refusal.js";
import type { RunnerFactory } from "./runner.js";

/** A non-empty list of path globs, in the engine's `matchesAny` dialect. */
const globs = z.array(z.string().min(1)).min(1);

/**
 * The shell a declared command line runs under where the declaration names
 * none — the one every POSIX host resolves.
 *
 * The schema below takes it as `shell`'s default, so the value is folded at
 * the parse and every reader of a parsed declaration holds a shell string
 * rather than a fallback each command site re-decides
 * (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*). Exported so a case naming the default names
 * this constant rather than respelling it.
 */
export const DEFAULT_SHELL = "sh";

/**
 * The plan slice that drains the records (`spec/harness.md`, *Records as one
 * file each*). Named here for the same reason {@link BUILD_PHASE} is: the
 * slice list below and the default handoff's refusal leg — which routes a
 * build refusal to whichever slice drains records — are the same fact, and a
 * rename moving only one would route refusals at a phase nothing runs.
 */
export const INBOX_PHASE = "plan-inbox" as const;

/**
 * The plan slices the package ships (`spec/harness.md`, *The phases*), in
 * the order that section lists them — which is also the order the ladder
 * consults their windows in (`windows.ts`): records first, since either an
 * operator's finding or a build refusal can invalidate anything below;
 * derive next, so intent is current before work is planned against it; the
 * posture sweep last, insurance behind product. Exported so the ladder reads
 * that order off this list rather than keeping a second one beside it
 * (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*).
 */
export const PLAN_SLICES = [INBOX_PHASE, "plan-derive", "plan-sweep"] as const;

/** One plan slice — every phase the package ships except {@link BUILD_PHASE}. */
export type PlanSlice = (typeof PLAN_SLICES)[number];

/**
 * The one fanout phase the package ships. Named here rather than spelled at
 * each reader: the phase list below and the records gate's build-versus-plan
 * branch are the same fact, and a rename that moved only one of them would
 * leave a gate judging a phase nothing runs.
 */
export const BUILD_PHASE = "build" as const;

/**
 * Those three plus the one fanout phase. Exported because the prompt
 * addresses are keyed by it (`prompts.ts`): the set of phases the package
 * constructs and the set of prompts it ships are one fact, and a second list
 * beside this one is a phase whose prompt nothing addresses
 * (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*).
 */
export const PHASES = [...PLAN_SLICES, BUILD_PHASE] as const;

/** One phase the package constructs. */
export type HarnessPhase = (typeof PHASES)[number];

/**
 * `{ [key]: value.optional() }` over a fixed key list — the shape `fence`,
 * `gates` and `agents` all key by. Three fields keyed "per phase" share one
 * notion of what the phases are rather than each carrying its own list
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 */
const optionalPer = <K extends string, T extends z.ZodTypeAny>(
  keys: readonly K[],
  value: T,
): { [P in K]: z.ZodOptional<T> } =>
  Object.fromEntries(keys.map((key) => [key, value.optional()])) as {
    [P in K]: z.ZodOptional<T>;
  };

/** A strict object keyed by every phase the package ships, each optional. */
const byPhase = <T extends z.ZodTypeAny>(value: T) =>
  strict(optionalPer(PHASES, value));

/**
 * The gate points, read off the engine's own `GatePhase` rather than copied
 * beside it. The `Record` is exhaustive in both directions, so a variant the
 * engine adds or renames fails typecheck here instead of narrowing a
 * consumer's declaration silently.
 */
const GATE_WHEN: Record<GatePhase, true> = {
  afterCommit: true,
  afterMerge: true,
};

const When = z.enum(Object.keys(GATE_WHEN) as [GatePhase, ...GatePhase[]]);

/**
 * One extra gate a consumer hangs on a phase: by the name of a gate the
 * package's registry ships, by an inline shell command, or by a script the
 * consumer commits. The package's own gates are not declarable: its
 * discipline gates are always present and always first, and its judge runs
 * after everything declared here at the same `when`.
 *
 * A registry `name` is any non-empty string here; whether the registry holds
 * it is the chain factory's refusal, at the same load.
 */
const GateDeclaration = z.discriminatedUnion("kind", [
  strict({ kind: z.literal("registry"), name: z.string().min(1), when: When }),
  strict({ kind: z.literal("shell"), command: z.string().min(1), when: When }),
  strict({ kind: z.literal("script"), path: z.string().min(1), when: When }),
]);

/**
 * The runner the judge drives (`spec/harness.md`, *The runner interface*) —
 * a **factory** over `{ api, provision }`, not a built value: the worktree
 * base its checkout is planted under is the engine's to hand out, and the
 * way that checkout is provisioned is this declaration's own `setup`
 * reduced by the chain factory. Neither exists yet when a consumer's
 * declaration module is evaluated. A consumer running cargo, dotnet or a
 * shell script declares its own factory over the same three operations;
 * only the vitest one ships.
 *
 * Checked as a function and nothing more, for the resolver's reason below:
 * what the factory returns is the runner interface's contract, and the only
 * thing that could check it here is calling it — which the chain factory
 * does, once, with a context this schema has never seen.
 */
const RunnerFactoryValue = z.custom<RunnerFactory>(
  (value): boolean => typeof value === "function",
  {
    error:
      "must be a factory over { api, provision } returning a runner that " +
      "supplies run(), runAtBase() and lanes — a built runner value is not " +
      "one (spec/harness.md, The runner interface)",
  },
);

/**
 * The consumer's own section resolver (`spec/harness.md`, *The cite
 * resolver*) — a declared value with behavior, beside the runner, and part
 * of why this declaration is a module rather than JSON.
 *
 * Checked as a function and nothing more: what it returns for a cite is the
 * cite resolver's contract, and a schema re-asserting it here would be the
 * same check in two places. Absent, the package resolves a section by
 * heading text.
 */
const ResolverValue = z.custom<SectionResolver>(
  (value): boolean => typeof value === "function",
  {
    error:
      "must be a function resolving a cite's section from the cited file's " +
      "text (spec/harness.md, The cite resolver)",
  },
);

/**
 * A consumer's own handoff for one phase (`spec/harness.md`, *The default
 * `handoff`*) — the third declared value with behavior, and the override
 * that means no consumer copies the package's ladder to change one leg of
 * it.
 *
 * Checked as a function and nothing more, for the resolver's reason: what a
 * handoff may return is the engine's contract, already typed at the phase it
 * is installed on, and re-asserting it here would be the same check twice.
 */
const HandoffValue = z.custom<Handoff>(
  (value): boolean => typeof value === "function",
  {
    error:
      "must be a function naming the phases to wake from a tick's result " +
      "(spec/harness.md, The default handoff)",
  },
);

/**
 * The engine's supervisor policy entire — not a subset of it. The alias is
 * the tie in both directions: `satisfies Record<keyof …>` below refuses a
 * shape missing a knob the engine names, and the object literal's excess
 * check refuses one the engine does not, so a knob the engine adds, renames
 * or retires fails typecheck here rather than leaving a consumer declaring a
 * value nothing reads — or unable to declare one the engine reads
 * (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*).
 */
type DeclaredSupervisor = NonNullable<Chain["supervisorPolicy"]>;

/**
 * The engine's own worktree-base field, aliased rather than respelled: what
 * a base is handed and what it must answer is the engine's contract
 * (`Chain.worktreesBase`, `src/Phase.ts`), so a change to either fails
 * typecheck at the consumers who declare one instead of leaving a
 * declaration the engine no longer calls that way.
 */
type DeclaredWorktreesBase = NonNullable<Chain["worktreesBase"]>;

/**
 * Where this consumer's worktrees are planted (`spec/worktrees.md`,
 * *Placement — the worktree base*) — a declared value with behavior beside
 * the runner, the resolver, the handoff and a lane's title reader, and a
 * function for the engine's own reason: placement is machine-local while a
 * `declaration.ts` is committed, so the base is computed at load from the
 * roots the runtime resolved rather than frozen as a path one host holds.
 *
 * Checked as a function and nothing more, for the resolver's reason: whether
 * what it answers is a non-empty absolute directory is the engine's refusal
 * at this same load (`resolveWorktreesBaseDeclaration`, `src/chainLoad.ts`),
 * which is the only thing that can tell — it runs the function once against
 * roots this schema has never seen — and re-deriving the walk here would be
 * the same guard in two places, disagreeing the day either moves.
 */
const WorktreesBaseValue = z.custom<DeclaredWorktreesBase>(
  (value): boolean => typeof value === "function",
  {
    error:
      "must be a function over the resolved roots answering an absolute " +
      "directory to plant worktrees under — a path string is not one " +
      "(spec/worktrees.md, Placement — the worktree base)",
  },
);

/**
 * `quarantineScope` names its two values rather than taking any string: the
 * engine's policy types it as a closed pair, so a third spelling is a
 * consumer's typo that would otherwise fall through to the engine's default
 * silently. `z.enum` over the pair puts both in the refusal message.
 */
const supervisorShape = {
  maxParallel: z.number().int().positive().optional(),
  tickTimeoutMs: z.number().int().positive().optional(),
  abortThreshold: z.number().int().positive().optional(),
  maxTicks: z.number().int().positive().optional(),
  killGraceMs: z.number().int().positive().optional(),
  quarantineScope: z.enum(["run", "none"]).optional(),
  partitionIgnore: z.array(z.string().min(1)).optional(),
} satisfies Record<keyof DeclaredSupervisor, z.ZodTypeAny>;

/**
 * Which plan slices run, and what the sweep reads. A sweep with no domain
 * has nothing to draw a frontier over, so declaring the slice without one is
 * refused rather than run vacuously.
 */
const Slices = strict({
  /** The plan slices this consumer runs. `build` is not optional and is not listed. */
  enabled: z.array(z.enum(PLAN_SLICES)),
  /** The sweep's own inputs. Required exactly when `plan-sweep` is enabled. */
  sweep: strict({
    /** Path globs the sweep draws its frontier from. */
    domain: globs,
    /** The posture pages whose sections the sweep applies. */
    posturePages: globs,
  }).optional(),
}).superRefine((value, ctx) => {
  const enabled = value.enabled.includes("plan-sweep");
  if (enabled && value.sweep === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["sweep"],
      message:
        "the sweep needs a domain and its posture pages while `plan-sweep` is enabled",
    });
  }
  if (!enabled && value.sweep !== undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["sweep"],
      message: "declared while `plan-sweep` is not enabled — nothing reads it",
    });
  }
});

/**
 * A lane's title reader — the fourth declared value with behavior, and the
 * one the package could not have supplied: what a failing title looks like
 * is the consumer's runner's grammar, not the package's
 * (`.claude/rules/engine-boundary.md`, *Told, not inferred*).
 *
 * Checked as a pattern or a function and nothing more, for the resolver's
 * reason: what a reader answers over one log is the lane reader's contract
 * (`ci.ts`, {@link CiTitleReader}), and the only thing that could check it
 * here is running it against a log this schema has never seen.
 */
const TitleReaderValue = z.custom<CiTitleReader>(
  (value): boolean => typeof value === "function" || value instanceof RegExp,
  {
    error:
      "must be a pattern, or a function over the failing job's log, " +
      "answering the failing titles that log states (spec/harness.md, CI " +
      "lanes as a findings source)",
  },
);

/**
 * One CI lane the inbox slice reads as a findings source
 * (`spec/harness.md`, *CI lanes as a findings source*): the workflow file
 * and job name that locate a run on the forge, the lane name the findings
 * that run yields are filed under, and how a failing run's titles read.
 *
 * The first three are required because all three are consumed: a lane
 * missing its workflow or job names no run to read, and one missing its name
 * yields findings with no key — the slice keys a finding by lane name and
 * title, so an unnamed lane is a finding that can never be recognized as
 * already filed. Strict, so a consumer who spells the job component by some
 * other name is told rather than silently left with a lane the slice cannot
 * locate.
 *
 * `titles` is optional, and its absence is a stated position rather than a
 * hole: a lane declaring no reader wakes the slice once per failing run,
 * which is what a lane has always done. A lane declaring one wakes on a
 * changed failing-title set instead, so a red that persists unchanged across
 * runs stops re-waking it.
 *
 * Not the runner's `Lane`, despite the word: that is a partition of the
 * consumer's *test suite*, read off `Runner.lanes` and consumed by the
 * judge. This is a partition of the consumer's *CI*, declared here and
 * consumed by the inbox slice. Nothing keys one by the other.
 */
const CiLane = strict({
  /** The lane name the findings this lane yields are keyed and filed under. */
  name: z.string().min(1),
  /** The workflow file holding the job, as the forge's CLI names one. */
  workflow: z.string().min(1),
  /** The job within that workflow whose run the slice reads. */
  job: z.string().min(1),
  /**
   * How this lane's failing titles read out of a failing job's log — a
   * pattern or a function, stating the grammar this consumer's runner emits.
   */
  titles: TitleReaderValue.optional(),
});

/**
 * The fields `spec/harness.md` names a consumer, one per row of *What a
 * consumer declares*' table. Four are required — the three a tick cannot run
 * without and the one that says which slices run; the rest are the package's
 * opinion until a consumer states otherwise.
 */
export const DeclarationSchema = strict({
  /**
   * Where a `per` cite may point, as path globs. Empty would resolve no cite
   * at all, so the list is non-empty.
   */
  specLocus: globs,
  /**
   * Build's `writablePaths`, and per plan slice the paths that slice may
   * write beyond the package's own plan artifacts.
   */
  fence: strict({ build: globs, ...optionalPer(PLAN_SLICES, globs) }),
  /** Build's `entryChannelPaths`. */
  channelPaths: globs.optional(),
  /**
   * Narrow a fanout tick's writes to its assigned entry. Off by default; the
   * package documents both arguments and takes no side.
   */
  scopeWritesToEntry: z.boolean().default(false),
  /**
   * The test runner the judge drives, as a factory the chain calls at load
   * with its own engine API and this declaration's `setup` reduced to a
   * provisioning function.
   */
  runner: RunnerFactoryValue,
  /**
   * How a `per` cite's section is found in the file it names. Absent, by
   * heading text; declared, by whatever key a typed spec is read with.
   */
  resolver: ResolverValue.optional(),
  /**
   * The handoff each phase runs with, where the package's default is not
   * what this consumer wants. Declared per phase and replacing outright:
   * overriding build's routing leaves the plan slices on the package's
   * ladder rather than forcing a copy of it.
   */
  handoff: byPhase(HandoffValue).optional(),
  /**
   * Extra gates per phase. The package's discipline gates are always
   * present and always first, so nothing here can displace one; the
   * package's judge trails whatever is declared at the same `when`, so a
   * seconds-long check reports before a minutes-long suite.
   */
  gates: byPhase(z.array(GateDeclaration)).optional(),
  /**
   * The shell every command line this declaration carries runs under — a
   * `shell` gate's command, a `script` gate's committed path, and
   * `setup.restore` — each spawned as `<shell> -c <line>` in the tree the
   * package runs it in. The gates are not the whole set: a restore is text
   * the consumer wrote too, and naming only the gates here would leave the
   * one line whose shell a wave's provisioning depends on unaccounted for.
   * Absent means {@link DEFAULT_SHELL}, folded here at the parse, so a
   * reader holding a parsed declaration reads the shell the spec's row
   * states rather than nothing. A consumer annotating
   * {@link DeclarationInput} still omits it: the default is on the parse's
   * output, not on its input.
   *
   * Declared rather than fixed because which shells a host resolves is the
   * consumer's environment, not the package's: on win32 `sh` resolves from
   * one launch shell and not another, so a package that spelled it would be
   * naming a host where it meant to name a mechanism
   * (`.claude/rules/engine-boundary.md`, *Surface, not prescription*). A
   * fallback is still mechanism — no declared line can be spawned without
   * some shell — so absence resolves rather than refuses.
   *
   * Whether the named shell is one *this* host resolves is not a claim a
   * string can carry, so it is probed at load by `runnableShell`
   * (`harness/declaredShell.ts`), which every command site spawns through,
   * and the refusal names the site that declared the line — the gate's
   * command, or the restore — rather than surfacing hours in as that gate
   * failing or as a worktree that would not provision.
   */
  shell: z.string().min(1).default(DEFAULT_SHELL),
  /**
   * Model per phase, extra agent arguments, and whether the tick inherits
   * the user's own MCP servers; absent means the package's default.
   *
   * `inheritUserMcp` is the engine's own knob (`ClaudeCodeOptions`), spelled
   * here because the schema is strict: without a field a consumer whose
   * ticks need their own MCP servers has no spelling at all, and the
   * declaration refuses the one they would reach for. Undeclared it stays
   * off, which is the engine's default rather than the package's opinion —
   * a tick loads only the MCP configuration the chain hands it.
   */
  agents: byPhase(
    strict({
      model: z.string().min(1).optional(),
      extraArgs: z.array(z.string().min(1)).optional(),
      inheritUserMcp: z.boolean().optional(),
    }),
  ).optional(),
  /**
   * The engine's supervisor policy, declared here so one file holds the
   * environment. Omitted fields fall through to the engine's own defaults.
   */
  supervisor: strict(supervisorShape).optional(),
  /**
   * Directories to install and a restore command, run in every provisioned
   * worktree, singleton and fanout alike — and in the base checkout the
   * runner judges at, which is provisioned through the same reduction.
   */
  setup: strict({
    /** Where to install, each relative to the checkout being provisioned. */
    directories: z.array(z.string().min(1)).min(1),
    /**
     * How, where the engine's lockfile-aware install is not it — a command
     * line the consumer wrote, run in each directory above under the shell
     * this declaration names.
     */
    restore: z.string().min(1).optional(),
    /**
     * Run the restore one worktree at a time across a fanout wave, for a
     * restore whose shared cache is not safe to warm concurrently.
     *
     * The restore alone. The wave's other provisioning stays parallel: the
     * engine's own installer is a lockfile-aware `pnpm`/`npm` run against a
     * store built to be written from several processes at once
     * (`spec/worktrees.md`, *Never symlink `node_modules` into a worktree*),
     * and every wave has always run it concurrently. What the package cannot
     * know is whether the command *this* consumer wrote is safe that way — a
     * cargo target dir, a NuGet cache, a script warming something shared — so
     * that is the one step this knob holds, and a declaration naming no
     * restore has nothing for it to hold.
     *
     * Absent is today's behavior rather than a position: restores run as
     * concurrently as the wave provisions.
     */
    serialize: z.boolean().optional(),
  }).optional(),
  /** Which plan slices run; the sweep's domain and posture pages. */
  slices: Slices,
  /**
   * Prompt slots the package renders into its prompts. Text only — a slot
   * carries context, never a directive the package's discipline already
   * states, and a slot the package does not render is refused rather than
   * ignored.
   */
  slots: strict({
    autonomy: z.string().min(1).optional(),
    domain: z.string().min(1).optional(),
  }).optional(),
  /**
   * The environment facts this repository asserts, passed through whole to
   * `Chain.capabilities`: an entry whose gate is `requiresCapability` is
   * pickable only where the chain names that capability, and `flume status`
   * names one held back. Absent asserts none, which is what a consumer with
   * no environment-gated work declares.
   *
   * Empty is admitted rather than refused, unlike the other list-valued
   * fields. A declaration is a TypeScript module, so this list is routinely
   * the return of a load-time probe — a daemon health check, a binary on
   * PATH — and a probe finding nothing is the environment reporting
   * correctly, not a declaration with a hole in it. Refusing it would fail
   * the load exactly where the gate is doing its job.
   *
   * Passed through whole: what a capability string means is the consumer's
   * and its queue's, and the engine only ever matches it against an entry's
   * gate, so the package neither reads nor normalizes the strings.
   */
  capabilities: z.array(z.string().min(1)).optional(),
  /**
   * The friction channel, passed through whole to `Chain.friction`: a
   * state-root-relative directory the engine guarantees the lifecycle of —
   * the revert note, the teardown harvest, the `friction: N` status line,
   * the `flume friction` read verb, the ignore line that keeps it untracked
   * (`spec/chain.md`, *`Chain.friction` — the declared friction channel*).
   *
   * Declared here because it is a **findings source**, not merely an engine
   * knob: the inbox slice reads it as it reads the inbox, one record per
   * file, so a consumer routing its own notes never writes the prompt
   * paragraph the package owes it (`spec/harness.md`, *Declared findings
   * sources*).
   *
   * Non-empty and nothing more. Whether the path escapes the state root is
   * the engine's own refusal at chain load
   * (`validateFrictionDeclaration`, `src/friction.ts`), and re-deriving that
   * walk here would be the same guard in two places, disagreeing the day
   * either moves. Absent disables the whole channel — the engine's reading,
   * not a default this schema supplies.
   */
  friction: z.string().min(1).optional(),
  /**
   * The directory this consumer's worktrees are planted under, passed
   * through whole to `Chain.worktreesBase` and evaluated by the engine once
   * per chain load.
   *
   * Declared here because a consumer whose worktrees belong off-repo has had
   * nowhere else to say so: the engine offers the field, and a package
   * consumer's whole authored surface is this module, so without a row the
   * only reach left is `FLUME_WORKTREES_DIR` — an operator's env var, per
   * host and per shell, where the placement is a property of the repository.
   *
   * Passed through whole, with no default: the engine's own
   * `<flumeDir>/worktrees` is what an undeclared base resolves to, and
   * `FLUME_WORKTREES_DIR` still outranks a declared one, because the
   * declaration is committed and the host is not
   * (`worktreesBase`, `src/paths.ts` — the one resolution every reader takes
   * the base from).
   */
  worktreesBase: WorktreesBaseValue.optional(),
  /**
   * The CI lanes the inbox slice reads as findings sources beside the
   * records. Optional — a consumer with no forge, or one whose CI it does
   * not want drained into the queue, declares nothing and the slice reads
   * records alone.
   *
   * Non-empty when declared, and lane names unique across the list: an empty
   * list is a findings source that sources nothing, and two lanes sharing a
   * name file findings under one key, so the second lane's failure reads as
   * the first's already-filed one.
   */
  ci: z
    .array(CiLane)
    .min(1)
    .superRefine((lanes, ctx) => {
      const seen = new Set<string>();
      lanes.forEach((lane, index) => {
        if (seen.has(lane.name)) {
          ctx.addIssue({
            code: "custom",
            path: [index, "name"],
            message: `lane name is already declared — findings are keyed by lane name, so two lanes named \`${lane.name}\` would file as one`,
          });
        }
        seen.add(lane.name);
      });
    })
    .optional(),
});

/** A validated declaration, as the chain factory reads it. */
export type Declaration = z.infer<typeof DeclarationSchema>;

/**
 * A declaration as a consumer writes one — the schema's **input** side, and
 * the type a `declaration.ts` literal annotates itself with.
 *
 * Not {@link Declaration}: that is the parse's output, where a defaulted
 * field is present because the parse put it there. `scopeWritesToEntry`
 * carries a default, so it is required on the output side and
 * `satisfies Declaration` does not compile over a literal that omits it —
 * the one field the package explicitly takes no side on would become the one
 * field every consumer has to spell. The input side accepts the literal a
 * consumer actually writes.
 *
 * Exported so the load refusal stops being the first thing that catches a
 * typo. A misspelled slice name, a fence keyed by a phase the package does
 * not ship, a supervisor knob that no longer exists: each is a refusal the
 * schema raises at chain load, and each is the same fact one rung up the
 * ladder — a typecheck a consumer's editor completes into and `tsc` refuses
 * before a tick runs (`.claude/rules/engineering.md`, *Narration is the
 * ladder's bottom rung*). The schema stays the authority at load; this is
 * the same shape read earlier.
 */
export type DeclarationInput = z.input<typeof DeclarationSchema>;

/**
 * Validate a declaration, or refuse the load naming every field at fault.
 *
 * Refuses rather than returns a verdict: this runs at chain load, where a
 * declaration that does not parse leaves nothing to run a tick against.
 */
export function parseDeclaration(value: unknown): Declaration {
  return parseOrThrow(DeclarationSchema, value, "harness declaration");
}
