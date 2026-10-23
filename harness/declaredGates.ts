/**
 * The gates a consumer declared, as `Gate`s a phase can run (`spec/harness.md`,
 * *What a consumer declares*) — the registry of builtins a name may reach, the
 * construction each declared kind takes, and the engine facts a command
 * gate's child reads. Which shell a command line runs under, and whether
 * this host runs it, is `declaredShell.ts`, where a declared `setup.restore`
 * asks the same question.
 *
 * **This module spawns nothing itself; it builds the gate that will.** The
 * engine's own `shellGate` is what runs a command, taken off the `FlumeApi`
 * the factory was handed rather than imported, for the reason a chain takes
 * it that way: a second physical engine in one process stays unreachable
 * (`src/flumeApi.ts`).
 *
 * Which phase hangs which of these, and in what order they sit beside the
 * package's own, is the chain factory's (`chain.ts`). What the package's
 * discipline demands regardless of any declaration is `gates.ts`.
 */

import type { ShellGateReader } from "../src/builtinGates.js";
import type { FlumeApi } from "../src/flumeApi.js";
import type {
  Gate,
  GateContext,
  GatePhase,
  GateResult,
  SingleSpanGate,
} from "../src/Gate.js";

import { BUILD_PHASE, type Declaration } from "./declaration.js";
import { runnableShell, shellArgs } from "./declaredShell.js";

/**
 * One gate a consumer declared, as the declaration's own union — read off
 * the schema's inferred type rather than respelled here, so a kind the
 * declaration adds is a typecheck failure at {@link constructGate} instead
 * of a shape that falls through its switch
 * (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*).
 */
type GateDeclaration = NonNullable<
  NonNullable<Declaration["gates"]>[typeof BUILD_PHASE]
>[number];

/**
 * The gates a consumer may hang on a phase by name — the engine's own
 * builtins that need nothing but a gate point, keyed by each one's own
 * `name` rather than by a second spelling of it.
 *
 * `chain-load` is spread rather than called: it is a plain `Gate`, so the
 * only thing a declaration can move on it is where it runs.
 */
function registry(api: FlumeApi): Record<string, (when: GatePhase) => Gate> {
  const entries: readonly [Gate, (when: GatePhase) => Gate][] = [
    [api.tscGate, (when) => api.tscGate({ when })],
    [api.vitestGate, (when) => api.vitestGate({ when })],
    [api.eslintGate, (when) => api.eslintGate({ when })],
    [api.chainLoadGate, (when) => ({ ...api.chainLoadGate, when })],
  ];
  return Object.fromEntries(entries.map(([gate, make]) => [gate.name, make]));
}

/**
 * One declared gate as the `Gate` the phase runs.
 *
 * A registry name the package does not ship is refused at load naming the
 * set it could have been — the other half of the declaration schema's
 * ruling that a name is any non-empty string until the factory reads it
 * (`declaration.ts`). A shell command and a committed script are one
 * mechanism with two names: both run through `<shell> -c` in the gate's own
 * tree, which resolves a relative path against that tree and honours a
 * script's own shebang, and both read the same gate facts from their
 * environment ({@link gateFacts}).
 *
 * `shell` is the parsed declaration's, which is the package's default where
 * the consumer named none — the parse folds that once, for every declared
 * command line alike (`declaration.ts`).
 *
 * A command gate's declared reader is handed to the engine's gate, which runs
 * it over the output it captured and reports what it returned; a kind that
 * carries no reader hands none, and the exit status is the verdict
 * (`ShellGateOptions`, `src/builtinGates.ts`). The package reads the report
 * nowhere itself — a second decode beside the engine's would be the chain
 * restating an engine fact (`.claude/rules/engineering.md`, *A fact the
 * engine holds is reported, never rediscovered*).
 */
export function constructGate(
  api: FlumeApi,
  declared: GateDeclaration,
  shell: string,
): Gate {
  switch (declared.kind) {
    case "registry": {
      const table = registry(api);
      const make = table[declared.name];
      if (make === undefined) {
        throw new Error(
          `gate "${declared.name}" is not one the harness package's registry ` +
            `ships — declare one of ${Object.keys(table)
              .map((name) => `\`${name}\``)
              .join(", ")}, or a \`shell\`/\`script\` gate ` +
            `(spec/harness.md, What a consumer declares)`,
        );
      }
      return make(declared.when);
    }
    case "shell":
      return shellCommand(api, shell, declared.command, declared.when, declared.read);
    case "script":
      return shellCommand(api, shell, declared.path, declared.when, declared.read);
  }
}

/**
 * The engine's gate facts as the environment a command gate's child reads
 * (`spec/harness.md`, *What a consumer declares*) — every value already on
 * the context the engine built, `FLUME_`-prefixed and never re-derived by
 * the command itself (`.claude/rules/engineering.md`, *A fact the engine
 * holds is reported, never rediscovered*). A gate measuring trunk across one
 * entry reads `FLUME_LANDED_ON_SHA` rather than `HEAD^`, which is right only
 * while a span lands as one commit.
 *
 * Two spellings are the spec's (`FLUME_BASE_SHA`, `FLUME_LANDED_ON_SHA`);
 * the rest are declared here, and each names the context field it carries.
 *
 * **Absence is a fact, not a gap.** `FLUME_LANDED_ON_SHA` is unset under
 * `afterCommit`, where no trunk is involved, and `FLUME_STATE_ROOT_REL` is
 * unset when the state root is relocated outside the repository — the same
 * meaning `GateContext` gives each field's own absence, so a gate branches
 * on the unset var instead of reading an empty string as a sha.
 *
 * `FLUME_TOUCHED_PATHS` is one path per line, in git's own alphabet, empty
 * when the span touched nothing: an environment value cannot carry a NUL, so
 * the NUL-delimited form the engine decoded from git has no encoding here,
 * and a tracked path containing a newline is the one shape this channel
 * cannot spell. {@link unspellableTouched} is the refusal that bounds it —
 * the gap is declared here and refused before any child reads it, never left
 * for a gate keying files to discover as two paths its span never touched
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
function gateFacts(ctx: GateContext): Record<string, string> {
  return {
    FLUME_COMMIT_SHA: ctx.commitSha,
    FLUME_BASE_SHA: ctx.baseSha,
    ...(ctx.landedOnSha === undefined
      ? {}
      : { FLUME_LANDED_ON_SHA: ctx.landedOnSha }),
    FLUME_STATE_ROOT: ctx.flumeDir,
    ...(ctx.stateRootRel === undefined
      ? {}
      : { FLUME_STATE_ROOT_REL: ctx.stateRootRel }),
    FLUME_TOUCHED_PATHS: ctx.touchedPaths.join("\n"),
  };
}

/**
 * The refusal a span this channel cannot spell earns, or `undefined` when
 * every touched path survives {@link gateFacts}'s one-path-per-line form.
 *
 * Git preserves a path carrying a newline and the engine decodes it from the
 * NUL-delimited listing it already reads
 * (`.claude/rules/platform-facts.md`, *Git quotes porcelain output per
 * subcommand and per config; `-z` is the one spelling right everywhere*), so
 * the span reaching here is real rather than hypothetical. The environment
 * has no second encoding to fall back to, and a gate reading the variable
 * one line at a time would key files on two paths the span never touched —
 * a confident wrong answer where this one says what it could not hand over.
 *
 * Reported the way `writablePathsGate` reports its own violating paths
 * (`src/builtinGates.ts`): the raw paths on `failingFiles` for a chain
 * reading the verdict row, and `details` as their rendering rather than a
 * second derivation. The rendering escapes each path, so one unspellable
 * path is one line of prose about it and not two.
 */
function unspellableTouched(
  touchedPaths: readonly string[],
): GateResult | undefined {
  const unspellable = touchedPaths.filter((path) => path.includes("\n"));
  if (unspellable.length === 0) return undefined;
  return {
    ok: false,
    message:
      `${unspellable.length} touched path(s) carry a newline, which ` +
      `FLUME_TOUCHED_PATHS cannot spell — this gate's command would read ` +
      `one of them as two paths the span never touched`,
    details: unspellable.map((path) => `  - ${JSON.stringify(path)}`).join("\n"),
    failingFiles: [...unspellable],
  };
}

/**
 * A command line as a gate, named by the line itself, run under the declared
 * shell with the gate facts in its environment.
 *
 * The shell is resolved and probed here rather than at {@link constructGate},
 * so the registry kinds — which spawn nothing — pay for no probe, and the
 * refusal names the command line that stranded the load.
 *
 * The facts are per-run and `shellGate`'s `env` is per-construction, so the
 * spawning gate is rebuilt for each context; what a failing tick reports —
 * the name, the `when`, the command line — is the same whatever the context,
 * and is taken from one construction rather than respelled here
 * (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*).
 *
 * **It overrides `shellGate`'s `batches: true` back to one span.** The
 * engine's gate declares it because a bare command reads nothing but its
 * `cwd`; this one wraps that command in {@link gateFacts}, which reports
 * `FLUME_BASE_SHA`, `FLUME_LANDED_ON_SHA` and `FLUME_TOUCHED_PATHS` off a
 * single-span context — exactly the facts a batch withholds, and ones this
 * channel has no batch spelling for, since one variable cannot carry N
 * spans' shas. So a phase hanging a declared command gate is held to one
 * span per merge whatever the consumer's `supervisor.mergeBatch` says
 * (`mergeBatchWidth`, `src/gateBatch.ts`), rather than handing a consumer's
 * command one span's base as the batch's (spec/worktrees.md, *Batched
 * merges*).
 */
function shellCommand(
  api: FlumeApi,
  shell: string,
  command: string,
  when: GatePhase,
  read: ShellGateReader | undefined,
): SingleSpanGate {
  const under = runnableShell(api, shell, `gate "${command}"`);
  const spawning = (env: Record<string, string>): Gate =>
    api.shellGate({
      name: command,
      when,
      cmd: under,
      args: shellArgs(command),
      env,
      ...(read === undefined ? {} : { read }),
    });
  return {
    ...spawning({}),
    batches: false,
    run: async (ctx: GateContext) =>
      unspellableTouched(ctx.touchedPaths) ?? spawning(gateFacts(ctx)).run(ctx),
  };
}
