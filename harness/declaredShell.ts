/**
 * The shell a command line a consumer wrote is spawned under
 * (`spec/harness.md`, *What a consumer declares*) — the invocation form
 * every such line takes, and the load-time refusal of a shell this host will
 * not run. Which shell that is was settled at the parse, where an absent
 * `shell` took the schema's default (`declaration.ts`).
 *
 * **One mechanism, every declared line.** A `shell` gate's command, a
 * `script` gate's committed path (`declaredGates.ts`) and a `setup.restore`
 * (`chain.ts`) are the same thing said in three places: text the consumer
 * wrote, run by the package in a tree of the package's choosing. The two
 * decisions they share are made here once, so a command site cannot be the
 * one left spawning under a name of its own
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 *
 * **Nothing here spawns a consumer's line**; it says what will, and proves
 * the host can.
 */

import type { FlumeApi } from "../src/flumeApi.js";

import { captureSync, detailOf } from "./exec.js";

/**
 * A consumer's command line as the argv its shell takes.
 *
 * The form is `-c <line>`, which every shell the declaration can name reads
 * the same way, and which resolves a relative path against the tree the
 * child runs in and honours a script's own shebang — so a committed script
 * needs no second spelling here.
 */
export function shellArgs(line: string): string[] {
  return ["-c", line];
}

/**
 * The shell `line` runs under — the parsed declaration's, which is the
 * package's default where the consumer named none (`DEFAULT_SHELL`,
 * `harness/declaration.ts`) — refused here when this host will not run it.
 *
 * Probed by running the shell exactly as the caller will — `<shell> -c` over
 * a command that does nothing — so what is proven is the invocation the
 * spawn takes rather than a path lookup standing in for it. It goes through
 * the package's shared sync spawn, which carries the same win32 shim retry
 * the real spawns do (`exec.ts`, `src/spawnShim.ts`), so the probe and the
 * spawn agree about what this host resolves rather than each deciding.
 *
 * At load, and not at the tick that first needed the line: a shell the host
 * cannot run makes every declared command unrunnable, and reporting that as
 * a gate failure — or as a worktree that would not provision — hours into a
 * run is the degraded-but-proceeding path the posture refuses
 * (`.claude/rules/engineering.md`, *Loud or nothing*). The tree is the
 * repository root the engine resolved, which is the one tree that exists at
 * load — a gate's own worktree does not yet.
 *
 * `site` is how the refusal names the declaration that stranded it: a
 * consumer with several command gates and a restore beside them is told
 * which line it wrote is the one with nothing to run it.
 */
export function runnableShell(api: FlumeApi, shell: string, site: string): string {
  try {
    captureSync(shell, shellArgs("exit 0"), { cwd: api.paths.repoRoot });
  } catch (err) {
    throw new Error(
      `${site} runs under the shell \`${shell}\`, which this host ` +
        `did not run: ${detailOf(err)} — declare a \`shell\` this host ` +
        `resolves (spec/harness.md, What a consumer declares)`,
    );
  }
  return shell;
}
