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

import type { FlumeApi } from "../src/flumeApi.js";
import type { Gate, GateContext, GatePhase } from "../src/Gate.js";

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
      return shellCommand(api, shell, declared.command, declared.when);
    case "script":
      return shellCommand(api, shell, declared.path, declared.when);
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
 * cannot spell.
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
 */
function shellCommand(
  api: FlumeApi,
  shell: string,
  command: string,
  when: GatePhase,
): Gate {
  const under = runnableShell(api, shell, `gate "${command}"`);
  const spawning = (env: Record<string, string>): Gate =>
    api.shellGate({
      name: command,
      when,
      cmd: under,
      args: shellArgs(command),
      env,
    });
  return {
    ...spawning({}),
    run: (ctx) => spawning(gateFacts(ctx)).run(ctx),
  };
}
