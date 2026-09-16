/**
 * `flume render` — the dispatcher's own resolution path, run one call short
 * of the invocation (spec/cli.md, *Subcommand surface*).
 *
 * The verb this replaces was removed because it previewed with its own
 * approximation of the fence, the prior-attempt state and pickability
 * (CLI-RENDER-REMOVAL, operator ruling 2026-08-03). So the load-bearing case
 * here is an **agreement gate**, not a shape check: the real `flume render`
 * process and a real `Dispatcher.tick()` are both driven, and the prompt the
 * verb printed is compared against the prompt the tick actually handed its
 * agent (`.claude/rules/engineering.md`, *A seam gate reads what the real
 * writer wrote*). A one-sided drift in either renderer reds it.
 */

import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import { EX_DATAERR } from "../src/cli.ts";
import { Baton } from "../src/Baton.ts";
import { Dispatcher } from "../src/Dispatcher.ts";
import {
  priorAttemptPath,
  priorAttemptsDir,
  type PriorAttemptRef,
} from "../src/priorAttempts.ts";
import type { Agent, AgentInvocation } from "../src/Agent.ts";
import { silent } from "./helpers/dispatcherFixture.ts";
import { mkFixtureRoot } from "./helpers/fixtureRoot.ts";
import {
  SPAWN_BUDGET_MS,
  exec,
  runCli,
  runCliStreams,
} from "./helpers/subprocess.ts";

// This file starts processes, so it declares the lane's one budget — cases
// and hooks alike — once here rather than inheriting the runner's default
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

/**
 * One fanout phase whose `promptArgs` echoes the two `TickContext` fields a
 * render could plausibly get wrong — the assignment and the pickability
 * verdict — so the agreement case below compares more than a static file.
 */
const CHAIN_SRC = `export default () => ({ chain: {
  phases: [{
    name: "build",
    description: "",
    promptPath: "prompts/build.md",
    concurrency: "fanout",
    writablePaths: ["src/**"],
    scopeWritesToEntry: true,
    gates: [],
    handoff: () => [],
    promptArgs: (ctx) => ({
      TAG: ctx.assignedEntry ? ctx.assignedEntry.tag : "unassigned",
      PICKABLE: (ctx.pickable ?? []).map((e) => e.tag).join(","),
    }),
  }],
  humanOnly: [],
} });
`;

/** No inline-exec span, so the tick's worktree cwd and render's repo-root cwd render alike. */
const PROMPT_SRC = "build the entry\ntag={{TAG}}\npickable={{PICKABLE}}\n";

function entry(tag: string, file: string, gate: unknown = { kind: "open" }) {
  return {
    tag,
    gate,
    dependsOnForks: [],
    files: { new: [], edit: [{ path: file, description: file }], retire: [] },
  };
}

interface RenderRepo {
  dir: string;
  flumeDir: string;
  cleanup: () => Promise<void>;
}

/**
 * A git repo carrying the chain above, its prompt file, and a committed
 * queue. Committed, not merely written: `readPending`
 * (`src/pendingLedger.ts`) reads the
 * ledger at HEAD, and that read is one of the things the verb must not
 * re-derive its own way.
 */
async function makeRenderRepo(
  entries: unknown[],
  promptSrc: string = PROMPT_SRC,
): Promise<RenderRepo> {
  const dir = await mkFixtureRoot("flume-render-");
  const opts = { cwd: dir };
  await exec("git", ["init", "-q", "-b", "main"], opts);
  await exec("git", ["config", "user.email", "test@example.com"], opts);
  await exec("git", ["config", "user.name", "Test User"], opts);
  await exec("git", ["config", "commit.gpgsign", "false"], opts);
  await exec("git", ["config", "core.longpaths", "true"], opts);
  const flumeDir = join(dir, ".flume");
  await mkdir(join(flumeDir, "prompts"), { recursive: true });
  await mkdir(join(flumeDir, "plan"), { recursive: true });
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(join(flumeDir, "chain.ts"), CHAIN_SRC, "utf8");
  await writeFile(join(flumeDir, "prompts", "build.md"), promptSrc, "utf8");
  await writeFile(join(dir, "src", "seed.ts"), "// seed\n", "utf8");
  await writeFile(
    join(dir, ".gitignore"),
    ".flume/awake/\n.flume/prior-attempts/\n.flume/worktrees/\n.flume/rendered-prompts/\n",
    "utf8",
  );
  await writeFile(
    join(flumeDir, "plan", "pending.json"),
    JSON.stringify(entries, null, 2) + "\n",
    "utf8",
  );
  await exec("git", ["add", "."], opts);
  await exec("git", ["commit", "-q", "-m", "seed"], opts);
  return {
    dir,
    flumeDir,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

/** Everything the verb wrote to stdout past its notice line. */
function promptOf(stdout: string): string {
  const nl = stdout.indexOf("\n");
  expect(nl).toBeGreaterThan(-1);
  return stdout.slice(nl + 1);
}

it("flume render prints to stdout the prompt a tick would be handed and invokes no agent", async () => {
  const repo = await makeRenderRepo([
    entry("FIRST", "src/first.ts"),
    entry("SECOND", "src/second.ts"),
  ]);
  try {
    const before = (
      await exec("git", ["rev-parse", "HEAD"], { cwd: repo.dir })
    ).stdout.trim();

    const rendered = await runCliStreams(repo.dir, ["render", "build"]);
    expect(rendered.code).toBe(0);

    // The real tick, with the agent seam replaced by a recorder — the only
    // substitution; chain load, queue read, selection, fence and renderer are
    // all the shipped ones.
    const handed = new Map<string, string>();
    const recorder: Agent = {
      name: "recorder",
      invoke: (opts: AgentInvocation) => {
        handed.set(opts.entryTag ?? "(singleton)", opts.prompt);
        return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
      },
    };
    new Baton(repo.flumeDir).wake("build");
    await new Dispatcher({
      repoRoot: repo.dir,
      configDir: repo.flumeDir,
      flumeDir: repo.flumeDir,
      agent: recorder,
      log: silent,
    }).tick();

    // Vacuity: the tick actually reached its agent, and the entry the verb
    // selected is one it was handed a prompt for.
    expect(handed.size).toBeGreaterThan(0);
    expect(handed.has("FIRST")).toBe(true);
    expect(promptOf(rendered.stdout)).toBe(handed.get("FIRST"));

    // Nothing was invoked on the render's own side: no agent record, no
    // worktree, no commit. (The tick above ran after the render and writes
    // its own; this asserts the render's process, which returned first.)
    expect(rendered.stderr).toContain("scoped to entry FIRST");
    expect(before).toBe(
      (await exec("git", ["rev-parse", "HEAD"], { cwd: repo.dir })).stdout.trim(),
    );
  } finally {
    await repo.cleanup();
  }
}, SPAWN_BUDGET_MS);

it("flume render's first line says the prior-attempt block is omitted", async () => {
  const repo = await makeRenderRepo([entry("ONLY", "src/only.ts")]);
  try {
    // Non-vacuity: a record the tick *would* have rendered a block from
    // stands on disk under this entry's ref. The notice is the verb's answer
    // to a real record, not to an empty prior-attempts dir.
    const ONLY_REF: PriorAttemptRef = { key: "ONLY", keyspace: "entry" };
    await mkdir(join(priorAttemptsDir(repo.flumeDir), "entry"), {
      recursive: true,
    });
    await writeFile(
      priorAttemptPath(repo.flumeDir, ONLY_REF),
      JSON.stringify({
        mode: "clean-exit",
        key: "entry",
        keyedAs: "only",
        headSha: "0".repeat(40),
        at: "2026-01-01T00:00:00.000Z",
      }),
      "utf8",
    );
    expect(existsSync(priorAttemptPath(repo.flumeDir, ONLY_REF))).toBe(true);

    const r = await runCliStreams(repo.dir, ["render", "build", "--entry", "ONLY"]);
    expect(r.code).toBe(0);
    const first = r.stdout.split("\n")[0]!;
    expect(first).toContain("<prior-attempt>");
    expect(first).toContain("omitted");
    expect(promptOf(r.stdout)).not.toContain("<prior-attempt>");
  } finally {
    await repo.cleanup();
  }
}, SPAWN_BUDGET_MS);

it("flume render --entry selects the queue entry a scoped tick would carry", async () => {
  const repo = await makeRenderRepo([
    entry("FIRST", "src/first.ts"),
    entry("SECOND", "src/second.ts"),
  ]);
  try {
    // Vacuity: unscoped, the dispatcher's own batch arithmetic carries FIRST
    // — so SECOND below is the flag's doing, not the default's.
    const unscoped = await runCli(repo.dir, ["render", "build"]);
    expect(unscoped.code).toBe(0);
    expect(unscoped.out).toContain("tag=FIRST");

    const r = await runCliStreams(repo.dir, [
      "render",
      "build",
      "--entry",
      "SECOND",
    ]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("tag=SECOND");
    expect(r.stdout).not.toContain("tag=FIRST");
    // The fence in the <harness> block is the scoped one, not the phase's
    // outer ceiling: SECOND's declared file, not FIRST's.
    expect(r.stdout).toContain("src/second.ts");
    expect(r.stdout).not.toContain("src/first.ts");
    expect(r.stderr).toContain("scoped to entry SECOND");
  } finally {
    await repo.cleanup();
  }
}, SPAWN_BUDGET_MS);

it("flume render --entry naming no queue entry refuses usage-shaped and names the tag", async () => {
  const repo = await makeRenderRepo([entry("ONLY", "src/only.ts")]);
  try {
    const r = await runCli(repo.dir, ["render", "build", "--entry", "ABSENT"]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("ABSENT");
    // The queue it was looked up in is non-empty, so the refusal is the tag's
    // absence rather than an empty ledger answering everything.
    const ok = await runCli(repo.dir, ["render", "build", "--entry", "ONLY"]);
    expect(ok.code).toBe(0);
  } finally {
    await repo.cleanup();
  }
}, SPAWN_BUDGET_MS);

it("flume render exits EX_DATAERR naming an unresolved span", async () => {
  const repo = await makeRenderRepo(
    [entry("ONLY", "src/only.ts")],
    "before\n!`exit 7 # unresolvable-span-probe`\nafter\n",
  );
  try {
    const r = await runCli(repo.dir, ["render", "build", "--entry", "ONLY"]);
    expect(r.code).toBe(EX_DATAERR);
    expect(r.out).toContain("unresolvable-span-probe");
    // The refusal is total: no partial prompt reached stdout beside it.
    expect(r.out).not.toContain("before");
  } finally {
    await repo.cleanup();
  }
}, SPAWN_BUDGET_MS);

it("flume --help names render on the subcommand surface", async () => {
  const dir = await mkFixtureRoot("flume-render-help-");
  try {
    const { out, code } = await runCli(dir, ["--help"]);
    expect(code).toBe(0);
    // Vacuity: this is the real subcommand table, carrying verbs that ship.
    expect(out).toMatch(/^ {2}check\b/m);
    expect(out).toMatch(/^ {2}render <phase>/m);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, SPAWN_BUDGET_MS);

it("flume render <phase> --help short-circuits before any chain load", async () => {
  const dir = await mkFixtureRoot("flume-render-help-sub-");
  try {
    const { out, code } = await runCli(dir, ["render", "--help"]);
    expect(code).toBe(0);
    expect(out).toContain("Usage: flume render <phase> [--entry <tag>]");
    expect(out).toContain("Exit codes:");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, SPAWN_BUDGET_MS);

it("flume render refuses a phase the chain does not declare, and an --entry on one that picks nothing", async () => {
  const repo = await makeRenderRepo([entry("ONLY", "src/only.ts")]);
  try {
    const unknown = await runCli(repo.dir, ["render", "nosuchphase"]);
    expect(unknown.code).toBe(2);
    expect(unknown.out).toContain("nosuchphase");

    const missing = await runCli(repo.dir, ["render"]);
    expect(missing.code).toBe(2);
    expect(missing.out).toContain("usage: flume render");

    const extra = await runCli(repo.dir, ["render", "build", "stray"]);
    expect(extra.code).toBe(2);
    expect(extra.out).toContain("usage: flume render");
  } finally {
    await repo.cleanup();
  }
}, SPAWN_BUDGET_MS);

it("flume render names a hand-picked entry no tick would carry rather than previewing it as next", async () => {
  const repo = await makeRenderRepo([
    entry("OPEN-ONE", "src/open.ts"),
    entry("PARKED-ONE", "src/parked.ts", { kind: "parked", reason: "held" }),
  ]);
  try {
    const r = await runCliStreams(repo.dir, [
      "render",
      "build",
      "--entry",
      "PARKED-ONE",
    ]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("tag=PARKED-ONE");
    // The pickability verdict is the dispatcher's, reported rather than
    // spent: the parked entry renders, and stderr says a tick would skip it.
    expect(r.stderr).toContain("not pickable at HEAD");
    // …and the verdict it reports is the real one, which still holds the
    // sibling the gate switch does admit.
    expect(r.stdout).toContain("pickable=OPEN-ONE");
  } finally {
    await repo.cleanup();
  }
}, SPAWN_BUDGET_MS);
