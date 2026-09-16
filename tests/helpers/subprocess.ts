/**
 * Starting a child process from a suite: the tsx/src/cli.ts entry paths the
 * spawns go through, the `exec`/`runCli`/`runNodeStreams`/`gitOut` wrappers
 * that cli.test.ts, job.test.ts, job.integration.test.ts and
 * loop-process-boundary.integration.test.ts each hand-rolled a copy of, their
 * blocking siblings (`gitOutSync`/`spawnCaptureSync`) that the harness suites
 * driving real git repositories each hand-rolled again, the two numbers every
 * one of those spawns runs under — the output cap (`SPAWN_OUTPUT_CAP_BYTES`)
 * and the wall-clock budget the spawning file declares (`SPAWN_BUDGET_MS`) —
 * and the liveness probe (`processAlive`) that reads a child back
 * afterwards.
 *
 * What a child is *told* is `tests/helpers/gitEnv.ts`, and where it runs is
 * `tests/helpers/fixtureRoot.ts`; this module starts it.
 *
 * Not *.test.ts, so neither vitest lane (unit or integration) collects it
 * as a suite of its own.
 */

import {
  execFile,
  execFileSync,
  spawnSync,
  type PromiseWithChild,
  type SpawnSyncReturns,
} from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { hermeticEnv } from "./gitEnv.ts";

const execFileAsync = promisify(execFile);

/**
 * How much of one child's stdout — and of its stderr — this harness keeps.
 *
 * Declared rather than inherited (`.claude/rules/platform-facts.md`, *Node
 * caps a captured child stream at 1 MiB, and reports the overrun as a spawn
 * failure*); {@link exitStatusOf} carries the refusal that keeps an overrun
 * under this number from reading as a child that never ran.
 *
 * Sized off the engine's own spawns rather than off any one case's fixture:
 * every spawn site in `src/` declares a cap — 16 MiB at `src/git.ts`,
 * `src/job.ts`, `src/worktrees.ts` and `src/builtinGates.ts`, 4 MiB at
 * `src/Dispatcher.ts` and `src/priorAttempts.ts` — and this is the ceiling of
 * that range, so output the engine was willing to capture from a child cannot
 * overrun the harness that spawned the engine. The one `src/`-adjacent spawn
 * above it reads a git log under `maxBuffer: Infinity`
 * (`scripts/build-changelog.mjs`), and what this harness captures there is the
 * draft that read produces, not the log itself.
 */
export const SPAWN_OUTPUT_CAP_BYTES = 16 * 1024 * 1024;

/**
 * Node's own `code` on an async overrun (`.claude/rules/platform-facts.md`,
 * *Node caps a captured child stream at 1 MiB, and reports the overrun as a
 * spawn failure*).
 */
const MAXBUFFER_CODE = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";

/**
 * What a suite hands one spawn beyond the binary and its argv. Narrower than
 * node's own options bag by intent: `maxBuffer` is absent because {@link exec}
 * owns it, and a site able to name it could take back the 1 MiB default this
 * module exists to keep off the lane.
 */
export interface SpawnOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** win32 needs one to invoke a `.cmd` shim — `npm`, `pnpm`, `npx`. */
  readonly shell?: boolean | string;
  readonly timeout?: number;
}

/**
 * `execFile` under {@link SPAWN_OUTPUT_CAP_BYTES}. Every spawn this suite
 * makes goes through it, so the cap is declared once instead of at each call
 * site — where a site that forgot would inherit node's default silently, and
 * buy an overrun that arrives where an exit status belongs.
 *
 * Exported rather than module-private: every suite and fixture that spawned
 * anything had spelled `promisify(execFile)` for itself and named no cap, so
 * the declaration above governed this module's own spawns and nothing else.
 * `tests/subprocessHelper.test.ts` holds the scan that keeps the wrapper
 * count at one (`.claude/rules/engineering.md`, *A module is one job*: a
 * helper spelled in three modules has one home).
 *
 * The child rides the promise, as it does on node's own promisified form: a
 * case asserting on a spawned process — its pid, a signal it was sent — reads
 * it off `.child`, and dropping it here is what would send that case back to
 * a capless wrapper of its own.
 */
export function exec(
  file: string,
  args: readonly string[],
  options: SpawnOptions = {},
): PromiseWithChild<{ stdout: string; stderr: string }> {
  return execFileAsync(file, [...args], {
    ...options,
    maxBuffer: SPAWN_OUTPUT_CAP_BYTES,
  });
}

/**
 * The wall-clock budget a default-lane file declares, at file scope, when any
 * of its cases or hooks starts a process — a node launcher, a shell, or `git`
 * (spec/worktrees.md, "The default test lane must stay fast").
 *
 * Without one a site inherits vitest's 5s default, and no spawn is a
 * 5s-shaped subject, whichever binary it starts: a `cliHelp.test.ts` case that
 * passes alone timed out at 5000ms under the afterMerge gate's full-suite
 * contention, and a case spawning nothing but `git` timed out on that same
 * default on the windows lane — its teardown then failed EBUSY on the fixture
 * repository the timed-out case was still holding, so one slow spawn reds two
 * cases. A gate timeout there reverts an innocent entry. The budget is a
 * ceiling, not a cost — a passing site never pays it — so it is sized off the
 * slowest spawning case this lane has measured (~16s: `flume loop --max 5` against a real chain,
 * timed inside a full parallel run) with room for a host slower than the one
 * that measured it. A hung child still reds its own case rather than hanging
 * the run.
 *
 * One number, one home: every spawning file imports it, so the lane's budget
 * moves in a single edit, and `tests/subprocessHelper.test.ts` holds the scan
 * that proves every spawning file declares it — at file scope, where the
 * declaration reaches the file's hooks and the cases it has yet to grow,
 * rather than restating numbers of its own.
 */
export const SPAWN_BUDGET_MS = 120_000;

/**
 * Refuse when a spawned-CLI entry point is not on disk, naming the path and
 * the provisioning that supplies it.
 *
 * Both entry points below are repo-root-adjacent absolute paths with no
 * upward walk, so either can miss while Node's own resolution — which does
 * walk up — still finds a parent checkout's copy and starts vitest. `node
 * <missing>.mjs` then exits 1 without ever reaching flume, and that 1 is
 * indistinguishable from the exit code the suite's `code).toBe(1)`
 * assertions exist to check: a whole CLI suite passes over a CLI that never
 * started (`.claude/rules/engineering.md`, "A green verdict is proven
 * non-vacuous").
 *
 * The guard wraps the constants rather than `runCli`, because the two
 * integration suites spawn `[TSX_CLI, CLI, ...]` themselves; an unresolvable
 * entry point cannot be exported past this point by any caller.
 */
export function requireEntryPoint(path: string, remedy: string): string {
  if (existsSync(path)) return path;
  throw new Error(
    `flume test harness: CLI entry point missing: ${path}\n` +
      `The CLI cannot start, so every exit code this suite asserts would be ` +
      `node's, not flume's. Fix: ${remedy}`,
  );
}

// Run the source CLI through the project's own `tsx` (no build step in this
// repo) — via `node <tsx cli.mjs>`, not the `.bin/tsx` shim: the shim is a
// shell script (`.cmd` on win32) that `execFile` cannot spawn without a
// shell (spawn discipline). Absolute paths so cwd can be any caller's
// temp repo; tsx resolves cli.ts's own imports relative to cli.ts,
// independent of cwd.
export const CLI = requireEntryPoint(
  fileURLToPath(new URL("../../src/cli.ts", import.meta.url)),
  "restore src/cli.ts — this checkout is missing the CLI source",
);
export const TSX_CLI = requireEntryPoint(
  fileURLToPath(
    new URL("../../node_modules/tsx/dist/cli.mjs", import.meta.url),
  ),
  "run `pnpm install --frozen-lockfile` in this worktree — a parent " +
    "checkout's node_modules does not satisfy this path",
);

/**
 * The exit status carried by a rejected `execFile`, or a refusal.
 *
 * `execFile` rejects for three unrelated reasons: the child ran and exited
 * non-zero (numeric `code`); the child outran this harness's output cap and
 * node killed it (`code` is {@link MAXBUFFER_CODE}); or the child never
 * produced an exit status at all — spawn failure (`code` is an errno
 * *string*) or a kill (`code` absent, `signal` set). Defaulting the last case
 * to 1 reports a status no process returned, into assertions that check for
 * exactly 1.
 *
 * The overrun is named apart from the others because its cause is this
 * harness's own number rather than anything the child did wrong: read as a
 * spawn failure it says the subject never ran, which is the one thing an
 * overrun proves false (`.claude/rules/engineering.md`, *Loud or nothing*).
 * Every code an overrun can arrive as is node's own, and none of them is a
 * truncation a caller could have read instead
 * (`.claude/rules/platform-facts.md`, *Node caps a captured child stream at
 * 1 MiB, and reports the overrun as a spawn failure*).
 */
export function exitStatusOf(err: unknown): number {
  const e = err as { code?: unknown; signal?: unknown };
  if (typeof e.code === "number") return e.code;
  if (e.code === MAXBUFFER_CODE) {
    throw new Error(
      `flume test harness: a child outran the ${SPAWN_OUTPUT_CAP_BYTES}-byte ` +
        `output cap this harness declares (\`SPAWN_OUTPUT_CAP_BYTES\`, ` +
        `tests/helpers/subprocess.ts), so node killed it mid-stream and it ` +
        `has no exit status of its own. The child ran — this is the cap, not ` +
        `a failed spawn. Fix: shrink what the fixture makes the child print, ` +
        `or raise the cap at its one home. Underlying failure: ${String(err)}`,
    );
  }
  throw new Error(
    `flume test harness: the CLI subprocess produced no exit status ` +
      `(code=${String(e.code)}, signal=${String(e.signal)}) — it never ran, ` +
      `or it was killed. Underlying failure: ${String(err)}`,
  );
}

/**
 * Spawn one node entry point in `cwd`; collect the two streams apart, plus
 * the exit status read through `exitStatusOf`.
 *
 * The shape under every suite that runs a real process — the source CLI
 * (`runCliStreams` below), the built `dist/src/cli.js`, a `scripts/*.mjs`, a
 * `flume tick` spawned for the process boundary. Each of those hand-rolled
 * its own spawn-and-catch, and every copy read the status itself, so every
 * copy turned a child that never ran into an ordinary exit 1
 * (`.claude/rules/engineering.md`, "The fix lands at the mechanism":
 * detection a sibling surface already performs is shared, never re-derived).
 *
 * `env` omitted inherits this process's environment — what a script spawned
 * outside the CLI's hermetic fixture wants. A CLI spawn passes
 * `hermeticEnv()`.
 */
export async function runNodeStreams(
  cwd: string,
  argv: readonly string[],
  env?: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await exec(process.execPath, [...argv], {
      cwd,
      ...(env ? { env } : {}),
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      code: exitStatusOf(err),
    };
  }
}

/**
 * Spawn one real `flume <args>`; collect the two streams apart, plus the
 * exit code. For assertions that turn on *which* stream carried a line — an
 * observational verb whose stdout must stay unchanged while a failure report
 * rides stderr. `runCli` is this with the streams concatenated.
 */
export function runCliStreams(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv = hermeticEnv(),
): Promise<{ stdout: string; stderr: string; code: number }> {
  return runNodeStreams(cwd, [TSX_CLI, CLI, ...args], env);
}

/** Spawn one real `flume <args>`; collect combined output + exit code. */
export async function runCli(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv = hermeticEnv(),
): Promise<{ out: string; code: number }> {
  const { stdout, stderr, code } = await runCliStreams(cwd, args, env);
  return { out: stdout + stderr, code };
}

/** Run a git subprocess in `cwd`; return its trimmed stdout. */
export async function gitOut(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd });
  return stdout.trimEnd();
}

/**
 * Node's own `code` on a *sync* overrun. The async forms reject with
 * {@link MAXBUFFER_CODE}; the sync forms report `ENOBUFS` with `status: null`
 * and `signal: "SIGTERM"` — the shape of a child that never exited
 * (`.claude/rules/platform-facts.md`, *Node caps a captured child stream at
 * 1 MiB, and reports the overrun as a spawn failure*). Two codes for one
 * event, so the refusals below name the event rather than either code.
 */
const SYNC_MAXBUFFER_CODE = "ENOBUFS";

/** Whether a sync failure is this harness's cap rather than the child's. */
const isSyncOverrun = (err: unknown): boolean =>
  (err as NodeJS.ErrnoException | null | undefined)?.code ===
  SYNC_MAXBUFFER_CODE;

/**
 * Refuse a sync overrun by name, for the reason {@link exitStatusOf} refuses
 * the async one: read as node hands it over, the overrun says the child never
 * ran, which is the one thing it did do. `spawnSync` does not even throw it —
 * it returns truncated streams with `error` set — so a caller reading
 * `result.stdout` past one is reading a prefix nothing told it about
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
function refuseSyncOverrun(file: string, err: unknown): never {
  throw new Error(
    `flume test harness: \`${file}\` outran the ` +
      `${SPAWN_OUTPUT_CAP_BYTES}-byte output cap this harness declares ` +
      `(\`SPAWN_OUTPUT_CAP_BYTES\`, tests/helpers/subprocess.ts), so node ` +
      `killed it mid-stream and the ` +
      `status and signal it reports are node's, not the child's. The child ` +
      `ran — this is the cap, not a failed spawn. Fix: shrink what the ` +
      `fixture makes the child print, or raise the cap at its one home. ` +
      `Underlying failure: ${String(err)}`,
  );
}

/**
 * `execFileSync` under {@link SPAWN_OUTPUT_CAP_BYTES} — {@link exec}'s
 * blocking sibling, for the suites whose fixtures are built by a sequence of
 * git commands that has nothing to await.
 *
 * `stdio` is this module's rather than a caller's: node leaves a sync child's
 * stderr on the *parent's* stderr unless the call says otherwise, so a
 * fixture command that failed printed its sentence into the lane's output and
 * left the thrown error saying only `Command failed`. Piped, that sentence
 * rides the error to the case that has to explain it — and stdin is closed,
 * because a sync spawn that blocks on a prompt blocks the whole lane.
 */
function captureSync(
  file: string,
  args: readonly string[],
  options: SpawnOptions = {},
): string {
  try {
    return execFileSync(file, [...args], {
      ...options,
      encoding: "utf8",
      maxBuffer: SPAWN_OUTPUT_CAP_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    if (isSyncOverrun(err)) refuseSyncOverrun(file, err);
    throw err;
  }
}

/**
 * Run a git subprocess in `cwd` and block on it; return its trimmed stdout,
 * and throw what git said when git refused.
 *
 * {@link gitOut}'s blocking sibling, and the shape seven files under `tests/`
 * had each spelled for themselves — every copy on node's 1 MiB default
 * (`.claude/rules/engineering.md`, *A module is one job*: a helper spelled in
 * three modules has one home). `tests/subprocessHelper.test.ts` holds the
 * scan that keeps the count at one.
 *
 * A file whose own helper closes over its fixture repository keeps that
 * helper — the argument order and the trimming are a suite's ergonomics —
 * and reaches the child through this one.
 */
export function gitOutSync(cwd: string, args: readonly string[]): string {
  return captureSync("git", args, { cwd }).trimEnd();
}

/**
 * What a suite hands one blocking spawn beyond {@link SpawnOptions}: stdin,
 * which only a sync spawn can hand over as a value.
 */
export interface SyncSpawnOptions extends SpawnOptions {
  /** Written to the child's stdin, which is then closed. */
  readonly input?: string;
}

/**
 * `spawnSync` under {@link SPAWN_OUTPUT_CAP_BYTES}, streams decoded as text.
 *
 * {@link captureSync}'s counterpart for the one question `execFileSync`
 * cannot answer: what a child that exited *non-zero* wrote, per stream, with
 * the status it chose — which is the subject of every case that drives a
 * published shim. The result is node's own, so a case reads `status`,
 * `stdout`, `stderr` and `error` off it as it always did; the overrun is the
 * one failure this refuses on, because node reports that one in `error` and
 * hands back a prefix of the output regardless.
 */
export function spawnCaptureSync(
  file: string,
  args: readonly string[],
  options: SyncSpawnOptions = {},
): SpawnSyncReturns<string> {
  const result = spawnSync(file, [...args], {
    ...options,
    encoding: "utf8",
    maxBuffer: SPAWN_OUTPUT_CAP_BYTES,
  });
  if (isSyncOverrun(result.error)) refuseSyncOverrun(file, result.error);
  return result;
}

/**
 * Whether `pid` names a live process, by the probe signal every liveness
 * check in the engine uses. ESRCH is the only reading of "gone": EPERM says
 * the process is there and simply not ours to signal, and anything else is
 * the caller's to see rather than a quiet `false`
 * (`.claude/rules/engineering.md`, "Loud or nothing").
 *
 * Shared rather than restated per suite: the teardown suites assert over
 * whole process *trees* (a tick child, the agent it spawned), so more than
 * one file reads a pid this way and one errno decision governs them all.
 */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    throw err;
  }
}
