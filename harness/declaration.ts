/**
 * The declaration a consumer writes to adopt the harness package
 * (`spec/harness.md`, *What a consumer declares*) — the eleven fields that
 * decide an environment, and the strict schema that refuses anything else.
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

import type { Runner } from "./runner.js";

/**
 * Builds a strict object whose unrecognized-key refusal carries its own
 * valid set. One home for the refusal's vocabulary, so a nested object
 * names its own fields rather than the outermost one's — zod consults the
 * innermost schema's error first, and the issue's path locates it.
 *
 * Every other issue falls through to zod's own message; only the valid set
 * is knowledge this helper holds.
 */
const strict = <T extends z.ZodRawShape>(shape: T) => {
  const valid = Object.keys(shape).join(", ");
  return z.strictObject(shape, {
    error: (issue) =>
      issue.code === "unrecognized_keys"
        ? `valid fields are: ${valid}`
        : undefined,
  });
};

/** A non-empty list of path globs, in the engine's `matchesAny` dialect. */
const globs = z.array(z.string().min(1)).min(1);

/** The plan slices the package ships (`spec/harness.md`, *The phases*). */
const PLAN_SLICES = ["plan-inbox", "plan-derive", "plan-sweep"] as const;

/** Those three plus the one fanout phase. */
const PHASES = [...PLAN_SLICES, "build"] as const;

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
 * a value, not a name: a consumer running cargo, dotnet or a shell script
 * supplies the three operations itself, and only the vitest one ships.
 *
 * Checked structurally rather than by class, since the interface is the
 * contract and any object satisfying it is a runner.
 */
const RunnerValue = z.custom<Runner>(
  (value): boolean => {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as Partial<Runner>;
    return (
      typeof candidate.run === "function" &&
      typeof candidate.runAtBase === "function" &&
      Array.isArray(candidate.lanes)
    );
  },
  {
    error:
      "must be a runner supplying run(), runAtBase() and lanes " +
      "(spec/harness.md, The runner interface)",
  },
);

/**
 * The four supervisor knobs the declaration exposes, named as the engine
 * names them. `Pick` is the tie: a knob the engine renames or retires stops
 * being a key of its policy and fails typecheck here, rather than leaving a
 * consumer declaring a value nothing reads
 * (`.claude/rules/engineering.md`, *Derived state is computed*).
 */
type DeclaredSupervisor = Pick<
  NonNullable<Chain["supervisorPolicy"]>,
  "maxParallel" | "tickTimeoutMs" | "abortThreshold" | "partitionIgnore"
>;

const supervisorShape = {
  maxParallel: z.number().int().positive().optional(),
  tickTimeoutMs: z.number().int().positive().optional(),
  abortThreshold: z.number().int().positive().optional(),
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
 * The eleven fields, as `spec/harness.md`, *What a consumer declares* lists
 * them. Four are required — the three a tick cannot run without and the one
 * that says which slices run; the rest are the package's opinion until a
 * consumer states otherwise.
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
  /** The test runner the judge drives. */
  runner: RunnerValue,
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
   * worktree, singleton and fanout alike.
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

/** The value at `path` in `root`, or `undefined` if any step is absent. */
const valueAt = (root: unknown, path: readonly PropertyKey[]): unknown =>
  path.reduce<unknown>(
    (node, key) =>
      node === null || node === undefined
        ? undefined
        : (node as Record<PropertyKey, unknown>)[key],
    root,
  );

/**
 * One line per issue, each opening with the dotted path of the field it is
 * about — the field name is the part a consumer acts on, so it leads.
 *
 * An unrecognized key is reported at the key itself rather than at the
 * object holding it, and a missing field is told apart from a malformed one
 * by reading the input at the issue's path, never by matching zod's prose.
 */
const fieldLines = (
  input: unknown,
  issues: readonly z.core.$ZodIssue[],
): string[] =>
  issues.flatMap((issue) => {
    if (issue.code === "unrecognized_keys") {
      return issue.keys.map(
        (key) =>
          `${[...issue.path, key].join(".")}: unknown field — ${issue.message}`,
      );
    }
    const path = issue.path.join(".");
    if (valueAt(input, issue.path) !== undefined) {
      return [`${path}: ${issue.message}`];
    }
    // Absent, so absence leads. A refinement that fired on the absence
    // already said why it mattered; zod's own "expected X, received
    // undefined" adds nothing the path has not.
    return [
      issue.code === "custom"
        ? `${path}: required field is missing — ${issue.message}`
        : `${path}: required field is missing`,
    ];
  });

/**
 * Validate a declaration, or refuse the load naming every field at fault.
 *
 * Throws rather than returning a verdict: this runs at chain load, where a
 * declaration that does not parse leaves nothing to run a tick against, and
 * a caller holding a half-read environment is the degraded-but-proceeding
 * path the posture refuses.
 */
export function parseDeclaration(value: unknown): Declaration {
  const result = DeclarationSchema.safeParse(value);
  if (result.success) return result.data;

  const lines = fieldLines(value, result.error.issues);
  throw new Error(
    `invalid harness declaration:\n${lines.map((line) => `  ${line}`).join("\n")}`,
  );
}
