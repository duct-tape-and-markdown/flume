/**
 * The gates a consumer declared, as `Gate`s a phase can run (`spec/harness.md`,
 * *What a consumer declares*) — the registry of builtins a name may reach, the
 * construction each declared kind takes, and the shell line the two command
 * kinds share under the shell the declaration named.
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

import {
  BUILD_PHASE,
  DEFAULT_SHELL,
  type Declaration,
} from "./declaration.js";
import { captureSync, detailOf } from "./exec.js";

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
 * `shell` is the declaration's, taken as it was declared — absent included,
 * which is where {@link DEFAULT_SHELL} applies. The fallback lands here, at
 * the one site that spawns under it, rather than at each caller
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 */
export function constructGate(
  api: FlumeApi,
  declared: GateDeclaration,
  shell: string | undefined,
): Gate {
  const under = shell ?? DEFAULT_SHELL;
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
      return shellCommand(api, under, declared.command, declared.when);
    case "script":
      return shellCommand(api, under, declared.path, declared.when);
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
 * Refuse the chain load when the host will not run `shell`, naming the gate
 * that declared a command for it.
 *
 * Probed by running the shell exactly as the gate will — `<shell> -c` over a
 * command that does nothing — so what is proven is the invocation the gates
 * take rather than a path lookup standing in for it. It goes through the
 * package's shared sync spawn, which carries the same win32 shim retry the
 * gate's own spawn does (`exec.ts`, `src/spawnShim.ts`), so the probe and
 * the gate agree about what this host resolves rather than each deciding.
 *
 * At load, and not at the tick that first needed the gate: a shell the host
 * cannot run makes every command gate unrunnable, and reporting that as a
 * gate failure hours into a run is the degraded-but-proceeding path the
 * posture refuses (`.claude/rules/engineering.md`, *Loud or nothing*). The
 * tree is the repository root the engine resolved, which is the one tree
 * that exists at load — a gate's own worktree does not yet.
 */
function requireRunnableShell(api: FlumeApi, shell: string, gate: string): void {
  try {
    captureSync(shell, ["-c", "exit 0"], { cwd: api.paths.repoRoot });
  } catch (err) {
    throw new Error(
      `gate "${gate}" runs under the shell \`${shell}\`, which this host ` +
        `did not run: ${detailOf(err)} — declare a \`shell\` this host ` +
        `resolves (spec/harness.md, What a consumer declares)`,
    );
  }
}

/**
 * A command line as a gate, named by the line itself, run under `shell` with
 * the gate facts in its environment.
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
  requireRunnableShell(api, shell, command);
  const spawning = (env: Record<string, string>): Gate =>
    api.shellGate({ name: command, when, cmd: shell, args: ["-c", command], env });
  return {
    ...spawning({}),
    run: (ctx) => spawning(gateFacts(ctx)).run(ctx),
  };
}
