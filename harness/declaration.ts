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

import type { SectionResolver } from "./citeResolver.js";
import type { Handoff } from "./handoff.js";
import { parseOrThrow, strict } from "./refusal.js";
import type { RunnerFactory } from "./runner.js";

/** A non-empty list of path globs, in the engine's `matchesAny` dialect. */
const globs = z.array(z.string().min(1)).min(1);

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
 * consumer commits. The package's own gates are not declarable — they are
 * always present and always first.
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
 * (`.claude/rules/engineering.md`, *Derived state is computed*).
 */
type DeclaredSupervisor = NonNullable<Chain["supervisorPolicy"]>;

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
 * The fields `spec/harness.md` names a consumer: the eleven in *What a
 * consumer declares*' table, plus the two that section and *The default
 * `handoff`* name in prose — the `resolver` and the `handoff`, the values
 * with behavior beside the runner. Four are required — the three a tick
 * cannot run without and the one that says which slices run; the rest are
 * the package's opinion until a consumer states otherwise.
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
   * Extra gates per phase. The package's own gates are always present and
   * always first, so nothing here can displace one.
   */
  gates: byPhase(z.array(GateDeclaration)).optional(),
  /** Model per phase and extra agent arguments; absent means the package's default. */
  agents: byPhase(
    strict({
      model: z.string().min(1).optional(),
      extraArgs: z.array(z.string().min(1)).optional(),
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
    directories: z.array(z.string().min(1)).min(1),
    restore: z.string().min(1).optional(),
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
