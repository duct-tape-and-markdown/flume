/**
 * `flume exclusive` — the operator's own command run with the ship lock held
 * (spec/cli.md, *Subcommand surface*).
 *
 * The one verb that takes a lock. Everything else about the two
 * git-common-dir locks is engine-created, engine-consumed and
 * engine-released (spec/loop.md, *The ship lock and the worktree lock —
 * sibling ticks take turns at git*); this is the declared exception, and it
 * exists because the window tip verify refuses — a trunk whose tip moved
 * under a live run — is a window only an operator can close. The fetch, the
 * merge, the hand fix stay the operator's command: the engine learns no
 * remote, no branch policy and no merge strategy from this verb, it only
 * serializes whatever was typed against the ticks that are merging
 * (`.claude/rules/engine-boundary.md`, *Engine/Implementation Boundary*).
 *
 * The lock is taken the way a sibling tick takes it — the same wait, the
 * same reclaim, the same file (`acquireShipLock`, `src/git.ts`) — so a tick
 * mid-merge is waited on rather than cut in front of, and a tick that wants
 * to merge while this command runs waits in turn. The worktree lock is not
 * taken: an operator command is not a `.git/worktrees` mutation, and taking
 * it would stall every tick's provisioning for the length of a fetch.
 */

import { spawn } from "node:child_process";
import { constants } from "node:os";

import { splitAtSeparator } from "./cliArgs.js";
import { operatorLog } from "./cliLog.js";
import { EX_MOUNT_DEAD } from "./exitCodes.js";
import type { FlumePaths } from "./flumeApi.js";
import { acquireShipLock } from "./git.js";
import { thrownMessage } from "./thrown.js";
import type { WaitLock } from "./waitLock.js";

/** What this verb refuses an argv it cannot honor as typed with. */
const USAGE = "usage: flume exclusive -- <command> [args...]";

/**
 * How the command ended: the code it exited with, or the signal that ended
 * it. Exactly what node's `close` event carries, named so the exit
 * arithmetic below reads off one shape.
 */
interface CommandEnd {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

/**
 * The exit code this process takes from `end`.
 *
 * A command that exited carries its own code, which is the whole promise of
 * the verb: a wrapper whose exit differs from its command's is a wrapper no
 * script can read through. A command a signal ended exited with nothing, so
 * it takes the convention `src/cliTeardown.ts` already spells for this
 * process's own signals — 128 plus the signal's number, read off the host's
 * own table rather than a copy of it.
 *
 * A number the host's table does not hand back is reported rather than
 * folded silently into 128: the number is what the convention is made of,
 * and a missing one is a code naming a different signal
 * (`.claude/rules/engineering.md`, *Loud or nothing*). The same arm covers
 * the shape node does not produce — neither a code nor a signal — spelled
 * rather than cast away, since what would be cast away is the whole of what
 * this function has to answer from.
 */
function exitCodeFor(end: CommandEnd): number {
  if (end.code !== null) return end.code;
  const numbered: Record<string, number | undefined> = constants.signals;
  const number = end.signal === null ? undefined : numbered[end.signal];
  if (number === undefined) {
    operatorLog.error(
      `[flume] exclusive: the command exited with no code, under ` +
        `${end.signal ?? "no signal"}, which this host's table does not ` +
        `number — exiting 128, the convention without its signal`,
    );
    return 128;
  }
  return 128 + number;
}

/**
 * Run `argv` to completion with its streams this process's own, answering
 * how it ended.
 *
 * `stdio: "inherit"` rather than a capture: the operator is at the terminal
 * this verb was typed into, and a `git fetch` whose progress arrived only
 * after it finished — or not at all, past an output cap — is a command run
 * somewhere else. The working directory is this process's, untouched: the
 * directory the command runs in is the one the operator typed it from, never
 * a root this verb resolved for its own purposes
 * (`.claude/rules/engine-boundary.md`, *Told, not inferred*).
 *
 * No shell, so the argv the operator typed is the argv the command gets —
 * which is also why a win32 `.cmd` shim is not reached from here
 * (`.claude/rules/platform-facts.md`, *Node refuses to spawn a `.cmd` shim
 * without a shell*): the retry that reaches one rewrites the line it carries,
 * and an operator command is not a line this verb may rewrite. A shim is
 * spawned by naming its interpreter in the command.
 */
function runCommand(argv: readonly string[]): Promise<CommandEnd> {
  return new Promise<CommandEnd>((resolve, reject) => {
    const child = spawn(argv[0] as string, argv.slice(1), {
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

/**
 * Take the ship lock, run the operator's command, release, and answer with
 * the command's own exit code.
 *
 * The release is a `finally`, so it runs whether the command exited, never
 * started, or threw past either. A signal that ends *this* process ahead of
 * that `finally` — node's default disposition for a Ctrl-C, which runs no
 * handler — leaves the lock file standing with this pid recorded, and the
 * next acquirer reclaims it by the same liveness probe every stale holder
 * gets (spec/loop.md, *The ship lock and the worktree lock — sibling ticks
 * take turns at git*). That is the bound: a dead holder is never waited on.
 * A second `process.on` for the signals here would be the install site
 * `src/cliTeardown.ts` owns, spelled twice for a verb that has no agent tree
 * to wind down.
 */
export async function exclusiveVerb(
  paths: FlumePaths,
  rest: string[],
): Promise<number> {
  // The separator is the whole argument grammar: everything behind it is the
  // command, and this verb consumes nothing ahead of it. A word ahead is a
  // trailing positional past what the verb takes (spec/cli.md, *Subcommand
  // surface*), and a separator naming nothing is a command this verb cannot
  // run — both are argv it cannot honor as typed.
  const { ahead, behind } = splitAtSeparator(rest);
  if (ahead.length > 0 || behind === undefined || behind.length === 0) {
    operatorLog.error(USAGE);
    return 2;
  }

  // The lock file lives under git's own common dir, so a working directory
  // git holds no repository for leaves nothing to lock — and then the
  // command does not run, rather than running unlocked, which is the one
  // thing it was asked not to do (`.claude/rules/engineering.md`, *Loud or
  // nothing*). `EX_UNAVAILABLE` for a resolution failure, carrying git's own
  // sentence (`.claude/rules/platform-facts.md`, *Exit codes come from
  // `sysexits.h`*).
  let lock: WaitLock;
  try {
    // The wait announcement — the lock's own narration, and the only line
    // this verb writes that is not a refusal — goes out the same door as
    // every other operator line, which is stderr at every level
    // (`operatorLog`, `src/cliLog.ts`). Stdout is the command's: a flume
    // sentence inside `flume exclusive -- git rev-parse HEAD > sha` is the
    // one stream this verb promises the operator gets whole.
    lock = await acquireShipLock(paths.repoRoot, operatorLog);
  } catch (err) {
    operatorLog.error(
      `[flume] exclusive refuses: the ship lock did not resolve under ` +
        `${paths.repoRoot}: ${thrownMessage(err)}`,
    );
    return EX_MOUNT_DEAD;
  }

  try {
    return exitCodeFor(await runCommand(behind));
  } catch (err) {
    // A command that never started has no exit status to carry, so this verb
    // answers with its own rather than inventing one for it: the same
    // resolution-failure code the lock takes, and the command's words in the
    // line, since the usual cause is a binary PATH does not hold.
    operatorLog.error(
      `[flume] exclusive: '${behind.join(" ")}' did not start: ` +
        `${thrownMessage(err)}`,
    );
    return EX_MOUNT_DEAD;
  } finally {
    lock.release();
  }
}
