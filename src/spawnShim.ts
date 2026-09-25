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
 * The characters a `cmd /d /s /c` line does not hand the binary back
 * unchanged: whitespace, which splits one word into several; the quote every
 * Windows command line is split on; and the metacharacters `cmd.exe` acts
 * on before the binary sees anything — redirection, the pipe, grouping, the
 * caret escape, `%VAR%` expansion, and `!VAR!` on a host whose delayed
 * expansion is on.
 */
const REWRITTEN_BY_CMD = /[\s"^&|<>()%!]/;

/**
 * The first word of `argv` the shell retry below would not hand the binary
 * intact, or `undefined` when every word survives it.
 *
 * `shell: true` is not a quoting request. Node joins the command and its
 * arguments with single spaces into one line for `cmd /d /s /c` and quotes
 * none of it, so a word carrying a space arrives as two, a word carrying a
 * quote arrives without it, and a word carrying `&` is not argv at all by
 * the time the binary runs. An empty word is the same defect with nothing to
 * point at: the join drops it and the binary reads an argv one word short.
 *
 * The command is a word of that line too, so a caller hands it in with the
 * rest.
 *
 * This is the shim retry's own bound rather than a general quoting question:
 * the fallback exists to reach a `.cmd` shim, and an argv it would rewrite
 * reaches the shim as some other command
 * (`.claude/rules/engineering.md`, "Loud or nothing").
 */
export function wordShimRetryWouldRewrite(
  argv: readonly string[],
): string | undefined {
  return argv.find((word) => word === "" || REWRITTEN_BY_CMD.test(word));
}

/**
 * The refusal that bounds the shell retry: an argv this fallback cannot
 * carry, raised where it is detected and naming the word that stopped it.
 *
 * Refusal rather than quoting, because the fence such a word needs is the one
 * `cmd.exe` applies over a batch shim, and no host this package is tested on
 * can measure it. A quoting rule nobody has run would be the confident wrong
 * answer this refusal exists to refuse — and the wrong answer here is a
 * command the caller never wrote, run in the caller's tree.
 *
 * The spawn failure rides as `cause`: what the caller is looking at is still
 * a shim that could not be spawned.
 */
export function shimRetryRefusal(
  command: string,
  word: string,
  cause: unknown,
): Error {
  const named = word === "" ? "an empty word" : `the word \`${word}\``;
  return new Error(
    `\`${command}\` could not be spawned directly on win32, and the shell ` +
      `retry that would reach a .cmd shim cannot carry this argv: ${named} ` +
      `would not survive cmd.exe's re-parse. Spawn a binary node resolves ` +
      `without a shell, or hand it an argv whose every word is free of ` +
      `whitespace, quotes and cmd metacharacters.`,
    { cause },
  );
}

/**
 * `execFile` with the shim fallback applied: direct spawn first, so args
 * keep exact quoting semantics, then one shell retry on
 * `isWin32ShimSpawnFailure` — over an argv `wordShimRetryWouldRewrite` says
 * `cmd.exe` would hand on unchanged, and a refusal naming the word where it
 * would not. The retry's own failure is what the caller sees.
 *
 * For a spawn whose retry cannot be a second `await` — a streaming child
 * that must be abandoned and re-run (`claudeCode`, `src/claudeCode.ts`) — take
 * the predicate and the refusal alone and keep the mechanics local.
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
    const rewritten = wordShimRetryWouldRewrite([cmd, ...args]);
    if (rewritten !== undefined) throw shimRetryRefusal(cmd, rewritten, err);
    return await execFileP(cmd, args, { ...direct, shell: true });
  }
}
