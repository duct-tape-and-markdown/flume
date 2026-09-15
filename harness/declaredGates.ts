/**
 * The gates a consumer declared, as `Gate`s a phase can run (`spec/harness.md`,
 * *What a consumer declares*) — the registry of builtins a name may reach, the
 * construction each declared kind takes, and the shell line the two command
 * kinds share.
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
import type { Gate, GatePhase } from "../src/Gate.js";

import { BUILD_PHASE, type Declaration } from "./declaration.js";

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
 * mechanism with two names: both run through `sh -c` in the gate's own tree,
 * which resolves a relative path against that tree and honours a script's
 * own shebang.
 */
export function constructGate(api: FlumeApi, declared: GateDeclaration): Gate {
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
      return shellCommand(api, declared.command, declared.when);
    case "script":
      return shellCommand(api, declared.path, declared.when);
  }
}

/** A command line as a gate, named by the line itself. */
function shellCommand(api: FlumeApi, command: string, when: GatePhase): Gate {
  return api.shellGate({ name: command, when, cmd: "sh", args: ["-c", command] });
}
