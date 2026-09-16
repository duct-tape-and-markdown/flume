/**
 * The environment a fixture's children run under: the FLUME_* strip that
 * keeps a spawned CLI inside the fixture (`hermeticEnv`), and the git config
 * every fixture repository's git inherits (`pinGitAutoGcOff`, armed through
 * `tests/helpers/vitestSetup.ts`).
 *
 * One job — what a child process is told, rather than how it is started:
 * both are env mutations the suite makes once and every descendant inherits,
 * and both exist because a creation site that had to remember them is a
 * creation site that will not.
 *
 * Not *.test.ts, so neither vitest lane (unit or integration) collects it as
 * a suite of its own.
 */

/**
 * The identity/provenance FLUME_* keys an outer flume harness is known to
 * set. `hermeticEnv()` does not strip by this list — it strips every
 * `/^FLUME_/` key (below) — so the list is seed input only: cli.test.ts sets
 * each one ambiently to prove the strip is non-vacuous without restating
 * the harness's vocabulary (`.claude/rules/engineering.md`, "Derived state
 * is computed, never restated beside its source").
 */
export const HERMETIC_ENV_STRIP_KEYS: readonly string[] = [
  "FLUME_DIR",
  "FLUME_CONFIG_DIR",
  "FLUME_JOB",
  "FLUME_DIR_RESOLVED_FOR",
  "FLUME_TIP_CLAIM_HELD",
];

/**
 * A copy of this process's env with every `FLUME_*` key stripped, so a
 * spawned CLI resolves the caller's own temp dir/repo default — or the
 * test's own explicit job resolution — instead of inheriting this process's.
 * Without this the suite is not hermetic: run under a flume harness (whose
 * canonicalized env, including a job resolution and its provenance stamp,
 * the vitest process inherits), the child would either escape the fixture
 * and operate on the outer state root/branch, or — once FLUME_DIR is
 * overridden per-test but the stale stamp survives — misfire
 * `CrossRepoFlumeDirError` against the outer repo it was actually stamped
 * for (CLI-FLUMEDIR-PROVENANCE-STAMP).
 *
 * By prefix, never by list: the supervisor adds vars a list falls behind
 * (`FLUME_QUARANTINED_SLUGS` after the first quarantine of a run), and this
 * suite runs as an afterMerge gate inside exactly that process. A test that
 * wants a `FLUME_*` var layers it on top of this function's output.
 */
export function hermeticEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^FLUME_/.test(key)) delete env[key];
  }
  return env;
}

/**
 * The config git must see in every fixture repository: auto gc off.
 *
 * Git runs `gc --auto` after ordinary write commands (commit, merge, am), and
 * `gc.autoDetach` defaults on, so the gc it starts is a **detached
 * grandchild that outlives the test that provoked it**. It then walks
 * `.git/objects` while the fixture's teardown is recursively removing the
 * same tree, and the remove reds with ENOTEMPTY — a failure in no assertion,
 * on whichever case happened to be holding the directory. Retrying the remove
 * would hide the same race behind a wait rather than stop the process.
 */
const GIT_AUTO_GC_OFF: readonly [key: string, value: string] = ["gc.auto", "0"];

/**
 * Pin auto gc off on `env`, for every git child that inherits it.
 *
 * Through git's `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n`
 * sequence rather than a `git config` call per fixture: the pin then reaches
 * every git process the run starts — the suite's own ~25 `git init` sites,
 * the git a spawned `flume` runs (`src/git.ts` inherits this process's
 * environment), and the git a spawned git runs — from one home, instead of
 * from each creation site remembering it (`.claude/rules/engineering.md`,
 * "The fix lands at the mechanism").
 *
 * Appends to whatever sequence the host already declared, and overwrites in
 * place when the host pinned this same key, so arming is idempotent — a
 * worker that loads the setup file once per test file does not grow the
 * sequence. A `GIT_CONFIG_COUNT` that is not a count refuses here rather than
 * reaching git as a clobbered sequence: git would reject the value we wrote
 * over, and the suite would read a git failure with no cause
 * (`.claude/rules/engineering.md`, "Loud or nothing").
 *
 * Held in `tests/gitEnv.test.ts` — the sequence arithmetic here, and the
 * `gc.auto` a real git resolves inside a fixture the suite created.
 */
export function pinGitAutoGcOff(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const [key, value] = GIT_AUTO_GC_OFF;
  const declared = env.GIT_CONFIG_COUNT ?? "0";
  if (!/^\d+$/.test(declared)) {
    throw new Error(
      `flume test harness: GIT_CONFIG_COUNT is not a count (${declared}), so ` +
        `this run cannot append \`${key}=${value}\` to the host's git config ` +
        `sequence without clobbering it. Unset GIT_CONFIG_COUNT, or set it to ` +
        `the number of GIT_CONFIG_KEY_n/GIT_CONFIG_VALUE_n pairs it declares.`,
    );
  }
  const count = Number(declared);
  for (let i = 0; i < count; i++) {
    if (env[`GIT_CONFIG_KEY_${i}`] === key) {
      env[`GIT_CONFIG_VALUE_${i}`] = value;
      return env;
    }
  }
  env[`GIT_CONFIG_KEY_${count}`] = key;
  env[`GIT_CONFIG_VALUE_${count}`] = value;
  env.GIT_CONFIG_COUNT = String(count + 1);
  return env;
}
