#!/usr/bin/env -S node --experimental-strip-types --no-warnings

/**
 * `flume` — the command line's entry: the argv split, the two state roots
 * every verb runs under, and the dispatch to the module that holds the verb.
 *
 * No verb's body lives here. Each is a module named for its job —
 * `src/cliStatus.ts`, `src/cliBaton.ts`, `src/cliHistory.ts`,
 * `src/cliCheck.ts`, `src/cliFriction.ts`, `src/cliExclusive.ts`,
 * `src/cliRender.ts`,
 * `src/cliTick.ts` and `src/cliLoop.ts` — and what this file owes each of
 * them is the words behind the verb, the roots it runs under, and, for the
 * three that hold a dispatcher, the run context `src/cliRunContext.ts`
 * resolves. The stamped log each of them writes its own refusals through is
 * `src/cliLog.ts`'s `operatorLog`, reached there rather than handed down from
 * here — this file reaches for the same one, and hands it on only where a
 * `Logger` is a value something downstream takes (the run context's
 * `Dispatcher`). The flag readings more than one verb shares are
 * `src/cliArgs.ts`.
 *
 * The runtime usage text printed by `flume --help` / `flume <cmd> --help`
 * is the authoritative reference; the pages it prints are `HELP_TOP`
 * (`src/cliHelp.ts`) and whatever `helpPageFor` (`src/cliHelp.ts`) resolves
 * for a subcommand.
 *
 * The chain config is loaded from `./.flume/chain.ts` (resolved with tsx).
 * That file must default-export a factory — `(api) => ({ chain })` — whose
 * return may carry `agent` to override the default `claudeCode()`.
 */

import { dirname, toNamespacedPath } from "node:path";
import { fileURLToPath } from "node:url";

import { splitAtSeparator } from "./cliArgs.js";
import { batonVerb, stopVerb } from "./cliBaton.js";
import { checkVerb } from "./cliCheck.js";
import { exclusiveVerb } from "./cliExclusive.js";
import { frictionVerb } from "./cliFriction.js";
import { HELP_TOP, helpPageFor, wantsHelp } from "./cliHelp.js";
import { logVerb } from "./cliHistory.js";
import { operatorLog } from "./cliLog.js";
import { loopVerb } from "./cliLoop.js";
import { renderVerb } from "./cliRender.js";
import { resolveRunContext } from "./cliRunContext.js";
import {
  resolveRepoRoot,
  resolveStateDirs,
  StateRootResolutionError,
} from "./cliStateDirs.js";
import { statusVerb } from "./cliStatus.js";
import { tickVerb } from "./cliTick.js";
import { EX_IOERR } from "./exitCodes.js";
import type { FlumePaths } from "./flumeApi.js";
import { statLoud } from "./fsProbe.js";
import { gitToplevel } from "./git.js";
import { canonicalDir, onDiskIdentity } from "./pathIdentity.js";
import { readPackageVersion } from "./selfPackage.js";
import { StateRootAccessError } from "./stateRootAccess.js";
import { thrownMessage } from "./thrown.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The refusal message for a bay root that is not the root git names paths
 * from, or `undefined` when the two agree — or when git names no root at all,
 * which is no claim to disagree with ({@link gitToplevel}).
 *
 * Bay discovery answers the *nearest* `.flume` (spec/cli.md, "Bay discovery
 * walks up to the nearest `.flume`"), and nothing in that walk consults git.
 * A bay below the working-tree root therefore resolves a `repoRoot` git has
 * never heard of, and every path composed from it — `stateRootRel`, the fence
 * globs, the queue pathspec, the paths read back off `--name-only` — is
 * spelled in an alphabet git does not use: `<root>/sub/.flume/f` is
 * `.flume/f` to the engine and `sub/.flume/f` to git, so the fence matches
 * nothing and the queue read finds nothing, each quietly
 * (`.claude/rules/engineering.md`, *Loud or nothing*). Proven once, at the
 * one place the root is resolved, ahead of every path composed from it.
 *
 * The message names the top-level in the spelling the comparison folded it
 * to, never git's raw answer: git reports `C:/r` where the bay beside it in
 * the same sentence is `C:\r`, and one message naming two roots in two
 * alphabets reads as two disagreements. The fold is also what makes the two
 * remedies paste-able — `cd` and a move both take a host path.
 */
async function bayRootDisagreement(
  repoRoot: string,
): Promise<string | undefined> {
  const toplevel = await gitToplevel(repoRoot);
  if (toplevel === undefined) return undefined;
  const gitRoot = canonicalDir(toplevel);
  if (gitRoot === canonicalDir(repoRoot)) return undefined;
  return (
    `[flume] bay root ${repoRoot} is not the root git names paths from — ` +
    `git's top-level here is ${gitRoot}. Every path this run would hand ` +
    `git, and every path it would read back from git, is named from the ` +
    `top-level, so a state root composed against a different root loses ` +
    `that root's prefix on all of them: the fence globs, the queue ` +
    `pathspec, and the state root a hook reads. Refusing before any of them ` +
    `is composed. Run flume from ${gitRoot} — with FLUME_DIR naming the ` +
    `bay if the bay is not there — or move the bay to ${gitRoot}.`
  );
}

/**
 * The argv split, the roots resolved, and the verb's module called. Wrapped by
 * {@link main}, which owns the one arm that turns a refused state-root access
 * — a read and a write alike, which is the pair `StateRootAccessError` spells
 * — into this process's exit code.
 */
async function dispatch(): Promise<number> {
  const argv = process.argv.slice(2);

  // Bay discovery's own stat refusal, mapped at the same boundary as every
  // other one this CLI takes: `resolveRepoRoot` throws on a `.flume` that is
  // present but unstattable (src/cliStateDirs.ts), and this is the first
  // thing the CLI does, ahead of every other try/catch. Uncaught, the throw
  // reached `main().catch` and left the operator a raw stack and an exit 1 —
  // the one stat refusal in the CLI that could not be classified from the
  // exit status (`.claude/rules/platform-facts.md`, "Exit codes come from
  // `sysexits.h`"). The stat error carries the offending path; the cwd here
  // is the walk's origin, which it does not.
  let repoRoot: string;
  try {
    repoRoot = resolveRepoRoot(process.cwd());
  } catch (err) {
    operatorLog.error(
      `[flume] bay discovery from ${process.cwd()} failed to stat an ancestor bay: ${thrownMessage(err)}`,
    );
    return EX_IOERR;
  }

  const [firstArg, ...restArgs] = argv;

  // Top-level --help / --version short-circuit before subcommand dispatch
  // (and before any resolution or chain load) so they work in any cwd. The
  // bare `help` verb is one more arm on this same branch, never a usage text
  // of its own: it is the first thing an operator types at a command line
  // they have not run before, and the answer it gets is `--help`'s to the
  // byte.
  if (firstArg === "--help" || firstArg === "-h" || firstArg === "help") {
    // ...and a trailing name is that command's own `--help` page, whichever
    // spelling carried it: `flume help status`, `flume --help status` and
    // `flume -h status` are one question, so one arm answers all three off
    // the same decider. A name this surface holds no page for refuses
    // usage-shaped, echoing the spelling that was typed, rather than
    // answering the top-level page over an argument it dropped.
    if (restArgs.length > 0) {
      const page =
        restArgs.length === 1 ? helpPageFor(restArgs[0] as string) : undefined;
      if (page === undefined) {
        operatorLog.error(`no help page for: ${restArgs.join(" ")}`);
        operatorLog.error(`usage: flume ${firstArg} [<command>]`);
        return 2;
      }
      process.stdout.write(page);
      return 0;
    }
    process.stdout.write(HELP_TOP);
    return 0;
  }
  if (firstArg === "--version" || firstArg === "-v") {
    console.log(readPackageVersion(HERE));
    return 0;
  }

  // The bare `flume` is `flume tick` (spec/cli.md, *Subcommand surface*), and
  // what a verb does with the words behind it is that verb's own to read.
  const cmd = firstArg ?? "tick";
  const rest = restArgs;

  // Per-subcommand --help short-circuits before any side effects (chain load,
  // baton mutation, agent invocation).
  //
  // Read ahead of argv's own `--` alone (`splitAtSeparator`,
  // `src/cliArgs.ts`): a flag behind the separator belongs to whatever is
  // being carried past it, so `flume exclusive -- git push --help` runs git's
  // help rather than printing flume's and running nothing. Every other verb
  // consumes nothing behind a separator and is unaffected — a stray `--`
  // reaches its own trailing-positional refusal.
  const cmdHelp = helpPageFor(cmd);
  if (cmdHelp !== undefined && wantsHelp(splitAtSeparator(rest).ahead)) {
    process.stdout.write(cmdHelp);
    return 0;
  }

  // The root git names paths from is the root every path below is composed
  // against, so the two are proven equal here — after the pages that answer in
  // any cwd and before the first path derived from the root
  // (`bayRootDisagreement`, above). `EX_IOERR` with the rest of bay
  // discovery's refusals: this is the same walk answering, and what it
  // answered is unusable for the same reason an unstattable bay is.
  const disagreement = await bayRootDisagreement(repoRoot);
  if (disagreement !== undefined) {
    operatorLog.error(disagreement);
    return EX_IOERR;
  }

  // Resolve both state roots up front and canonicalize them back into the env.
  // `flumeDir` is the mutable-state root (baton, pending, worktrees,
  // prior-attempts); `configDir` is the chain+prompt dir. Both default to
  // `<repoRoot>/.flume`, and `FLUME_DIR` / `FLUME_CONFIG_DIR` are the only
  // things that relocate them. Resolving here (not constructing) lets the
  // values survive the `loop` → `tick` process boundary — children inherit
  // the (now absolute-canonical) env vars — and lets a chain loaded later in
  // this process read one authoritative state root.
  let flumeDir: string;
  let configDir: string;
  try {
    ({ flumeDir, configDir } = resolveStateDirs(process.env, repoRoot));
  } catch (err) {
    // Both of the resolution's refusals, at one arm: the inherited cross-repo
    // stamp and the second state root in this checkout. Each is a pair of
    // roots the caller named and the resolution will not compose, so each is
    // the operator's sentence and exit 2, never a stack
    // (`StateRootResolutionError`, `src/cliStateDirs.ts`).
    if (err instanceof StateRootResolutionError) {
      operatorLog.error(`[flume] ${err.message}`);
      return 2;
    }
    throw err;
  }

  // The one resolved-roots value every chain load in this process is built
  // from — `FlumeApi.paths` by reference, so a chain reads the same answer
  // `resolveStateDirs` reached rather than re-deriving one from the env.
  const paths: FlumePaths = { repoRoot, configDir, flumeDir };

  // The resolved state root proven **a directory**, once here rather than at
  // each verb's first touch of it — no more than a stat can prove, and never
  // that anything can be made under it. A plain file standing where the root
  // belongs stats clean — so bay discovery above stops at it and resolution
  // names it — and then every read or write beneath it fails: the baton's
  // listing of `awake/`, the `mkdir` the first `wake` makes of it, the stop
  // flag's write. Each of those threw past its verb into `main()`'s catch as a
  // raw stack and exit 1, which is the one exit none of these verbs may take
  // (`spec/loop.md`, *Exit codes — the run never lies to CI*). Refused at the
  // seam the roots resolve because the root is what is unusable, not any one
  // artifact under it: a per-verb copy is one verb behind the next verb added
  // (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
  //
  // What a stat cannot reach — a root that is a directory and still admits no
  // read or write beneath it, the plain file at `<flumeDir>/awake` this stat
  // walks straight past — is refused where the access fails, by
  // `StateRootAccessError` (`src/stateRootAccess.ts`), and reported with the
  // same root and the same `EX_IOERR` at `main`'s one arm below. So the
  // usability this seam claims is the usability it proves, and the rest is
  // proven by being attempted.
  //
  // Absence is never this refusal — a state root that is not there yet is
  // every verb's ordinary first run, and `statLoud` answers `undefined` for
  // exactly that. Everything else it can raise (a relocating `FLUME_DIR`
  // pointing through a symlink loop, a permission-denied parent — neither of
  // which bay discovery walked, since `FLUME_DIR` bypasses that walk) is the
  // same unusable root reported by the same line.
  let rootObstruction: string | undefined;
  try {
    const at = statLoud(toNamespacedPath(flumeDir));
    if (at !== undefined && !at.isDirectory())
      rootObstruction = "it is present and is not a directory";
  } catch (err) {
    rootObstruction = thrownMessage(err);
  }
  if (rootObstruction !== undefined) {
    // The root this process resolved, not the leaf an errno would have
    // carried: `<root>/.flume/awake` alone leaves the operator to infer which
    // state root a walk — or a relocating `FLUME_DIR` — picked.
    operatorLog.error(
      `[flume] state root at ${flumeDir} failed to open: ${rootObstruction}`,
    );
    return EX_IOERR;
  }

  if (cmd === "status") return statusVerb(paths);
  if (cmd === "wake") return batonVerb(paths, rest, "wake");
  if (cmd === "sleep") return batonVerb(paths, rest, "sleep");
  if (cmd === "stop") return stopVerb(paths, rest);
  if (cmd === "log") return logVerb(paths, rest);
  if (cmd === "check") return checkVerb(paths, rest);
  if (cmd === "friction") return frictionVerb(paths, rest);
  if (cmd === "exclusive") return exclusiveVerb(paths, rest);

  // Every verb past this point holds a dispatcher, so the supervisor's handoff
  // is decoded and that dispatcher built once here — at the position the
  // observational verbs above have already returned from, and ahead of the
  // unknown-command arm below, which is where the handoff's own refusal has
  // always been reached from (`src/cliRunContext.ts`).
  const context = resolveRunContext({ paths, rest, log: operatorLog });
  if (context.kind === "refused") return context.exitCode;

  if (cmd === "render") return renderVerb(context.run);
  if (cmd === "tick") return tickVerb(context.run);
  if (cmd === "loop") return loopVerb(context.run);

  operatorLog.error(`unknown command: ${cmd}`);
  operatorLog.error("Run `flume --help` for usage.");
  return 2;
}

/**
 * The CLI, plus the one arm that reports a failed read or write under the
 * resolved state root.
 *
 * Wrapped here rather than at each verb because the root the access failed
 * under is the same root at every one of them, and the next verb added reads
 * or writes under it too: a per-verb catch is one verb behind
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*). The
 * stat seam in {@link dispatch} proves the root is a directory and no more, so
 * this is where "a directory that admits no access" stops being a raw stack and
 * exit 1 — the one exit these verbs may not take (`spec/loop.md`, *Exit codes
 * — the run never lies to CI*) — and becomes the same `EX_IOERR` and the same
 * root that seam reports.
 *
 * One class only. Everything else still rides the raw-stack arm at the
 * invocation below, which is what an unclassified harness failure is for.
 */
async function main(): Promise<number> {
  try {
    return await dispatch();
  } catch (err) {
    if (err instanceof StateRootAccessError) {
      operatorLog.error(`[flume] ${err.message}`);
      return EX_IOERR;
    }
    throw err;
  }
}

/**
 * This module's own on-disk identity — the side of the check below that an
 * invoked path is compared against.
 *
 * Exported because it is the one side a caller cannot spell for itself: the
 * comparison answers against this module's import.meta.url, and any value
 * derived from another module's URL is the tester's re-derivation of the
 * writer's side rather than the writer's own
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*). A case that asserts on it reds naming the two answers one file was
 * read as — each spelling, and the error behind it where a side never
 * resolved — instead of naming a boolean.
 */
export const CLI_MODULE_IDENTITY = onDiskIdentity(fileURLToPath(import.meta.url));

// Run only when invoked as the binary, not when imported (tests reach in for
// `resolveStateDirs` at the resolution seam).
//
// import.meta.url resolves through junctions/symlinks to the file's realpath;
// process.argv[1] keeps the invoked path verbatim. Through a junction- or
// symlink-based install (pnpm's linked store) the two never match on a raw
// string comparison, so both sides go through {@link onDiskIdentity} and the
// comparison is made on what it answered. One derivation is not by itself one
// alphabet — the junction the check exists for is the very thing that moves
// one side out of it — which is why the fold is spent there rather than here.
export function isInvokedDirectly(argv1: string | undefined): boolean {
  if (argv1 === undefined) return false;
  return onDiskIdentity(argv1).identity === CLI_MODULE_IDENTITY.identity;
}

const invokedDirectly = isInvokedDirectly(process.argv[1]);

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

