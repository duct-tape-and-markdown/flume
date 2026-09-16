/**
 * Where a fixture sits on disk: the temp root a suite composes its paths
 * from (`mkTempDir`, `mkTempDirSync`), the root that owns its own bay
 * (`mkFixtureRoot`), and
 * the suite-wide refusal that keeps a state root from appearing above either
 * (`installStateRootLeakGuard`, wired through `vitest.config.ts`).
 *
 * One job, read two ways. Rooting decides which directory a fixture's
 * assertions are about — the spelling git will report for it, and the `.flume`
 * that stops bay discovery at it — and the guard is that same decision held
 * over the run: a bay above the fixtures retargets every fixture that did not
 * plant its own, which is the rooting rule failing rather than a separate
 * concern.
 *
 * Not *.test.ts, so neither vitest lane (unit or integration) collects it as
 * a suite of its own.
 */

import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, beforeAll, expect } from "vitest";

/**
 * A fresh temp directory under `parent`, named by the spelling the host
 * reports for it: `mkdtemp`, folded through `realpath`.
 *
 * The fold is the point, and `tests/fixtureRoots.test.ts` is where it is
 * held — the case driving a fixture through a link the suite plants, and the
 * scan that makes this function the suite's only maker of a temp root. Spend
 * it once, at creation: a fold per comparison is the same fact restated at
 * every site composing a path from the root, and the site that forgets is
 * the one that reds.
 */
export async function mkTempDir(
  prefix: string,
  parent: string = tmpdir(),
): Promise<string> {
  return realpath(await mkdtemp(join(parent, prefix)));
}

/**
 * {@link mkTempDir} for a caller that cannot await — same directory, same
 * fold, same guarantee.
 *
 * `realpathSync.native`, never the bare `realpathSync`: node's JS walk
 * rebuilds its answer out of the components it was handed, so it resolves a
 * link and leaves win32's 8.3 alias exactly as it found it — and the alias is
 * the spelling the runner's temp dir arrives in
 * (`.claude/rules/platform-facts.md`, *`tmpdir()` can return an 8.3 short
 * path git never spells*). Only the libuv form asks the OS for the name it
 * holds, which is the name git will report
 * (`.claude/rules/platform-facts.md`, *`realpathSync` keeps the `\\?\`
 * prefix only where nothing resolved*) — and is the binding `mkTempDir`
 * already reaches, `node:fs/promises`'s `realpath` being native too.
 */
export function mkTempDirSync(
  prefix: string,
  parent: string = tmpdir(),
): string {
  return realpathSync.native(mkdtempSync(join(parent, prefix)));
}

/**
 * A fresh temp fixture directory that **owns its own bay** — a
 * {@link mkTempDir} root, plus an empty `.flume` planted at it.
 *
 * Bay discovery walks up from cwd to the nearest `.flume` and only falls back
 * to cwd at the filesystem root (spec/cli.md, "Bay discovery walks up to the
 * nearest `.flume`"). A fixture rooted straight under the host temp dir
 * therefore resolves through `/tmp`'s ancestors: any `.flume` a crashed run, another
 * suite, or an unrelated process leaves at `/tmp` — or above it — captures
 * every fixture below and silently retargets `repoRoot`, every state-dir
 * resolution, and every `job` verb at the litter. The suite then asserts a
 * verdict the CLI reached about a directory the test never wrote
 * (`.claude/rules/engineering.md`, "A green verdict is proven non-vacuous").
 *
 * The planted `.flume` stops the walk at the fixture, so no ancestor can
 * change a verdict regardless of who wrote the litter. It is behaviour-inert
 * for the fixture itself: an empty bay is what `<dir>/.flume` resolution
 * already assumed, and nothing reads a directory that holds no chain, no
 * baton markers, and no queue.
 *
 * `parent` exists for the tests that plant the ancestor litter deliberately —
 * they need a fixture underneath a directory they control. Fixtures that are
 * never a CLI cwd (a scratch output dir, a worktree base handed over by env)
 * do not need rooting and stay on {@link mkTempDir}.
 *
 * The root itself is `mkTempDir`'s, so the bay and everything composed from
 * it are spelled the way git spells them.
 *
 * Not rootable: a fixture whose subject **is** the no-ancestor fallback. It
 * must reach the filesystem root without meeting a `.flume`, which no fixture
 * can guarantee — `resolveRepoRoot`'s fallback case in
 * `tests/cliJobResolution.test.ts` is the one such site in this suite.
 */
export async function mkFixtureRoot(
  prefix: string,
  parent: string = tmpdir(),
): Promise<string> {
  const dir = await mkTempDir(prefix, parent);
  await mkdir(join(dir, ".flume"), { recursive: true });
  return dir;
}

/**
 * The `.flume` paths that sit **above** every fixture created under
 * `fixtureParent` — the parent's own bay and each ancestor's, to the
 * filesystem root. Exactly the set `resolveRepoRoot`'s walk
 * (`src/cliJobResolution.ts`) meets after it leaves the fixture, derived by
 * the same walk rather than by a list of hosts' temp dirs.
 */
function stateRootsAbove(fixtureParent: string): string[] {
  const scope: string[] = [];
  let dir = resolve(fixtureParent);
  for (;;) {
    scope.push(join(dir, ".flume"));
    const parent = dirname(dir);
    if (parent === dir) return scope;
    dir = parent;
  }
}

/** The watched set, plus the members that were already there when it opened. */
export interface StateRootWatch {
  /** Every ancestor bay a fixture under the watched parent could resolve to. */
  readonly scope: readonly string[];
  /**
   * Members present when the watch opened — not this run's doing, and
   * absorbed again as each is reported so one leak names one offender rather
   * than reddening every test that follows it.
   */
  readonly known: Set<string>;
}

/** Open a watch over the bays above `fixtureParent` (default: the host temp dir). */
export function watchStateRoots(
  fixtureParent: string = tmpdir(),
): StateRootWatch {
  const scope = stateRootsAbove(fixtureParent);
  return { scope, known: new Set(scope.filter((p) => existsSync(p))) };
}

/**
 * Refuse a run that starts with litter already above its fixtures.
 *
 * A fixture that plants its own bay (`mkFixtureRoot`) survives it; the one
 * that cannot — `resolveRepoRoot`'s no-ancestor fallback, whose subject *is*
 * the walk reaching the filesystem root — reds with no stated cause. Refusing
 * up front states the cause once, instead of leaving a marker downstream
 * assertions must remember to interpret (`.claude/rules/engineering.md`,
 * "Loud or nothing").
 */
export function refusePreexistingStateRoots(watch: StateRootWatch): void {
  if (watch.known.size === 0) return;
  const paths = [...watch.known];
  throw new Error(
    `flume test harness: a flume state root is already present above this ` +
      `run's fixtures:\n` +
      paths.map((p) => `  ${p}`).join("\n") +
      `\nIt is not this run's doing — an earlier run leaked it, or it belongs ` +
      `to an unrelated repo. Bay discovery walks up from a fixture to the ` +
      `nearest \`.flume\` (spec/cli.md), so it captures every fixture below ` +
      `that does not plant its own. Refusing rather than running over it. ` +
      `Remove it: rm -rf ${paths.join(" ")}`,
  );
}

/**
 * Refuse — naming `offender` — when a state root appeared in `watch.scope`
 * since the watch opened.
 *
 * `offender` is the test that was running in *this* worker when the directory
 * was first seen. Vitest runs test files in parallel, so a concurrent file
 * can be the real writer; that is the declared bound on the attribution, and
 * the message says so along with the flag that removes the ambiguity. The
 * refusal itself is exact — a state root above the fixtures is always this
 * run's defect, whichever test planted it.
 */
export function refuseLeakedStateRoots(
  watch: StateRootWatch,
  offender: string,
): void {
  const leaked = watch.scope.filter(
    (p) => !watch.known.has(p) && existsSync(p),
  );
  if (leaked.length === 0) return;
  for (const p of leaked) watch.known.add(p);
  throw new Error(
    `flume test harness: a flume state root appeared above this run's ` +
      `fixtures:\n` +
      leaked.map((p) => `  ${p}`).join("\n") +
      `\nFirst observed after: ${offender}\n` +
      `Bay discovery walks up from a fixture to the nearest \`.flume\` ` +
      `(spec/cli.md), so this directory retargets \`repoRoot\`, every ` +
      `state-dir resolution, and every \`job\` verb for fixtures below it ` +
      `that do not plant their own bay — later runs then assert verdicts ` +
      `about a directory no test wrote. Vitest runs test files in parallel, ` +
      `so the name above is the test this worker was running when the ` +
      `directory first appeared; re-run with \`--no-file-parallelism\` to ` +
      `pin the writer exactly. Remove it: rm -rf ${leaked.join(" ")}`,
  );
}

/**
 * Arm both refusals for the calling suite file: the pre-existing check once
 * before its tests, the leak check after each one.
 *
 * Wired suite-wide through the `setupFiles` entry `vitest.config.ts` names,
 * which is `tests/helpers/vitestSetup.ts`, rather than per suite, because the
 * writer is unknown — a guard only the CLI suites installed would watch every
 * file except the one that leaks.
 */
export function installStateRootLeakGuard(
  fixtureParent: string = tmpdir(),
): StateRootWatch {
  const watch = watchStateRoots(fixtureParent);
  beforeAll(() => refusePreexistingStateRoots(watch));
  afterEach(() =>
    refuseLeakedStateRoots(
      watch,
      expect.getState().currentTestName ?? "(unnamed test)",
    ),
  );
  return watch;
}
