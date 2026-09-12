/**
 * spawnShim — the win32 `.cmd`-shim spawn retry, held in one place so every
 * site that spawns a possibly-shimmed binary spells the detection the same
 * way (`.claude/rules/engineering.md`, "The fix lands at the mechanism").
 * Sibling to `fsProbe.ts`: nothing beyond `node:child_process` here, so any
 * module that spawns can reach it without a cycle.
 *
 * The fact itself — why a win32 spawn of an npm-installed binary ENOENTs,
 * and why the shell retry goes second rather than first — is
 * `.claude/rules/platform-facts.md`, "Node refuses to spawn a `.cmd` shim
 * without a shell". This module is where that fact becomes code, once.
 */

import { execFile, type ExecFileOptions } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

/**
 * `true` iff `err` is the shim case — a win32 spawn that failed with
 * `ENOENT`, the failure a shell retry can still turn green. Every other
 * spawn failure, and every `ENOENT` off win32, is real and propagates.
 *
 * Reads `process.platform` at call time rather than at module load, so a
 * caller (and this repo's suite) can exercise the decision on any host.
 */
export function isWin32ShimSpawnFailure(err: unknown): boolean {
  return (
    process.platform === "win32" &&
    (err as NodeJS.ErrnoException | null)?.code === "ENOENT"
  );
}

/**
 * `execFile` with the shim fallback applied: direct spawn first, so args
 * keep exact quoting semantics, then one shell retry on
 * `isWin32ShimSpawnFailure` — where `cmd.exe` re-parses argv, the tradeoff a
 * caller accepts to reach a shimmed binary at all. The retry's own failure
 * is what the caller sees.
 *
 * For a spawn whose retry cannot be a second `await` — a streaming child
 * that must be abandoned and re-run (`claudeCode`, `src/Agent.ts`) — take
 * the predicate alone and keep the mechanics local.
 */
export async function execFileWithShimRetry(
  cmd: string,
  args: string[],
  opts: ExecFileOptions,
): Promise<{ stdout: string; stderr: string }> {
  // `encoding` is spelled rather than defaulted: it is already execFile's
  // own default, and naming it is what picks the string-typed overload
  // instead of the `string | Buffer` union every caller would then narrow.
  const direct = { ...opts, encoding: "utf8" as const };
  try {
    return await execFileP(cmd, args, direct);
  } catch (err) {
    if (!isWin32ShimSpawnFailure(err)) throw err;
    return await execFileP(cmd, args, { ...direct, shell: true });
  }
}
