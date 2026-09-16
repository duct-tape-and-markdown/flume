/**
 * The inbox slice's CI lane leg (`spec/harness.md`, *CI lanes as a findings
 * source*): a declared lane's latest completed run, read through a forge CLI
 * on PATH, turned into a wake verdict against the lane's stamp and rendered
 * under the lane's name.
 *
 * **The lane module, not the slice around it.** Every case drives
 * `laneLeg` (`harness/ciLane.ts`) — the module that owns both halves — rather
 * than the inbox window's rendered arg, so a case names the subject it
 * asserts. The one case that is about the wiring says so in its title and
 * drives the window.
 *
 * **The real reader over a real spawn.** Every case here plants an executable
 * named for the forge CLI on PATH, so the seam under test is the reader's
 * argument vector against a CLI that answers it — not a mocked `execFileSync`
 * pinning this package's idea of what it would have printed
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*). The stub records every invocation, so a case can assert what the
 * forge was asked as well as what the leg did with the answer.
 *
 * The declaration goes through the package's own `parseDeclaration`, and the
 * repository is a real one: the branch the reader filters runs by is the
 * branch git reports for the tip, not a string this file hands it.
 */

// The one child this file starts outside `gitOutSync`: a probe run for its
// exit status alone, with every stream unpiped, so nothing is captured and
// no output cap governs it (`tests/helpers/spawnCaps.ts`).
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { delimiter, join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { laneLeg, type LaneLeg } from "../harness/ciLane.ts";
import { INBOX_PHASE } from "../harness/declaration.ts";
import {
  WINDOW_LINE_BUDGET,
  parseDeclaration,
  planSliceWindows,
  writePlanState,
} from "../harness/index.ts";

import { mkTempDirSync } from "./helpers/fixtureRoot.ts";
import { SPAWN_BUDGET_MS, gitOutSync } from "./helpers/subprocess.ts";

// This file starts processes, so it declares the lane's one budget — cases
// and hooks alike — once here rather than inheriting the runner's default
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

/** The repository the window reads its branch from; also its state root. */
let repo: string;
/** The directory placed on PATH, holding the forge stub a case planted. */
let binDir: string;
/** PATH as this process had it before a case rewrote it. */
let originalPath: string | undefined;
/** Directories a case staged on PATH to stand in for a host's own install. */
let stagedDirs: string[];

beforeEach(() => {
  repo = mkTempDirSync("flume-ci-");
  binDir = mkTempDirSync("flume-ci-bin-");
  stagedDirs = [];
  originalPath = process.env["PATH"];
  git("init", "-q", "-b", "main");
  git("config", "user.email", "ci@example.test");
  git("config", "user.name", "CI Fixture");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "a.txt"), "seed\n");
  git("add", "-A");
  git("commit", "-q", "-m", "seed");
});

afterEach(() => {
  if (originalPath === undefined) delete process.env["PATH"];
  else process.env["PATH"] = originalPath;
  for (const dir of [repo, binDir, ...(stagedDirs ?? [])]) {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function git(...args: string[]): string {
  return gitOutSync(repo, args);
}

/** The lane every case declares — one workflow, one job, one name. */
const LANE = { name: "windows", workflow: "ci.yml", job: "windows" } as const;

/** The runner factory a declaration carries; no case here drives the judge. */
const runner = () => ({
  run: async () => [],
  runAtBase: async () => [],
  lanes: [],
});

/** A second lane, for a case whose claim is per-lane rather than per-tick. */
const SECOND_LANE = { name: "posix", workflow: "ci.yml", job: "windows" } as const;

/**
 * A declaration naming `lanes`, through the package's own schema — the lanes
 * a leg reads are the ones a consumer could actually declare.
 *
 * `lanes` is the declared list, one lane unless a case names more — the stub
 * answers by question rather than by workflow, so a second lane is a second
 * full read of the same fixture, which is what a per-lane count needs.
 */
const declarationFor = (
  lanes: readonly (typeof LANE | typeof SECOND_LANE)[] = [LANE],
) =>
  parseDeclaration({
    specLocus: ["spec/**"],
    fence: { build: ["src/**"] },
    runner,
    slices: { enabled: [INBOX_PHASE] },
    ci: [...lanes],
  });

/**
 * The lane leg the inbox window builds for one tick, over that declaration.
 *
 * `budget` is the package's own line budget unless a case names one — the
 * knob the leg already carries, so a case can provoke the trim without
 * minting a thousand-line fixture to reach the default.
 */
function lane(
  budget?: number,
  lanes: readonly (typeof LANE | typeof SECOND_LANE)[] = [LANE],
): LaneLeg {
  return laneLeg({
    lanes: declarationFor(lanes).ci,
    repoRoot: repo,
    budget: budget ?? WINDOW_LINE_BUDGET,
  });
}

/** The state root the leg reads the lane stamp from. */
const stateRoot = (): string => join(repo, ".flume");

/** The lane block this tick renders. */
const laneBlock = (budget?: number): string => lane(budget).render(stateRoot());

/**
 * Whether the lane leg reports the inbox slice live. The state root holds no
 * record and no prior attempt reaches this leg at all, so the verdict is the
 * lane's and nothing else's.
 */
const laneLive = (): boolean => lane().live(stateRoot());

/**
 * A plan state under that root stamping each named lane at a run.
 *
 * Written through the package's own writer rather than as hand-shaped JSON —
 * the artifact the liveness leg reads is the one a plan tick would have left
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*). The cursors are this repository's own tip, which is the only sha
 * the schema's object-name shape accepts here.
 */
function stampLanes(drainedRuns: Record<string, string>): void {
  const tip = git("rev-parse", "HEAD").trim();
  writePlanState(stateRoot(), {
    derivedThrough: tip,
    sweptThrough: tip,
    rotation: { kind: "closed" },
    drainedRuns,
  });
}

/** Where the stub appends one JSON line per invocation. */
const callLog = (): string => join(binDir, "calls.jsonl");

/** Every argument vector the forge stub was invoked with, in order. */
function calls(): string[][] {
  if (!existsSync(callLog())) return [];
  return readFileSync(callLog(), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as string[]);
}

/**
 * What the stub answers each of the reader's three questions with: the run
 * listing, the run's jobs, and the failing job's log. Absent means the case
 * expects the reader never to ask.
 *
 * `logRefusal` is the third question answered the way a forge that holds the
 * run but will not hand over its log answers — a non-zero exit carrying its
 * reason on stderr, after the first two questions succeeded. Set, it replaces
 * `log`.
 */
interface ForgeScenario {
  readonly runs: unknown[];
  readonly jobs?: unknown[];
  readonly log?: string;
  readonly logRefusal?: string;
}

/** The name the reader spawns a lane's forge through (`harness/ci.ts`). */
const FORGE = "gh";

/**
 * The first file a PATH search for `command` would turn up on `path`, or
 * `undefined` where none would.
 *
 * Deliberately wider than a spawn's own search on win32: every `PATHEXT`
 * spelling counts, and so does the bare name. The question every caller here
 * asks is whether a copy of the CLI *lives* in a directory at all, not which
 * spelling a given spawn would reach — a `.cmd` a direct spawn skips is still
 * a copy a shell retry finds.
 */
function onPath(command: string, path: string): string | undefined {
  const extensions =
    process.platform === "win32"
      ? (process.env["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD")
          .split(";")
          .filter((extension) => extension !== "")
          .map((extension) => extension.toLowerCase())
      : [];
  for (const dir of path.split(delimiter)) {
    if (dir === "") continue;
    for (const name of [command, ...extensions.map((ext) => command + ext)]) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

/**
 * Link the host's own git into the stub's directory.
 *
 * The reader names the tip's branch through git (`harness/ci.ts`), so a case
 * that takes the host's directories off PATH has to hand git back. A symlink
 * is a POSIX spelling — a win32 git reached through one resolves its install
 * layout from the link's directory — so on win32 the fixture refuses out loud
 * rather than planting a git that would answer wrongly
 * (`.claude/rules/engineering.md`, *Loud or nothing*). That refusal needs a
 * host that installs the forge CLI and git in one directory, which the hosts
 * the win32 lane runs on do not.
 */
function linkGit(): void {
  const real = onPath("git", originalPath ?? "");
  if (real === undefined) throw new Error("this host has no git on PATH");
  if (process.platform === "win32") {
    throw new Error(
      `this host keeps git (${real}) in a directory holding a forge CLI, so ` +
        `the fixture cannot hide the forge without hiding git`,
    );
  }
  symlinkSync(real, join(binDir, "git"));
}

/**
 * Plant a forge CLI on PATH answering `scenario`, on a PATH no *other* forge
 * CLI is reachable on: the stub's directory first, and every host directory
 * holding a copy of the CLI dropped.
 *
 * Prepending alone does not hide what sits behind it, and on win32 nothing
 * hides behind the stub — the launcher there is a `.cmd`, which a direct
 * spawn refuses, so the search walks past it to whatever the host installed
 * (`spec/cli.md`, *win32 is a supported host*). Dropping those directories is
 * what makes the direct spawn reach the stub or nothing, and nothing is the
 * `ENOENT` the reader's own shell retry answers with the stub.
 *
 * The launcher hands the absolute `process.execPath` the script, so the stub
 * runs whatever else PATH holds — which is what lets the absent-CLI case
 * below strip PATH down to a single directory.
 */
function plantForge(scenario: ForgeScenario): void {
  const script = join(binDir, "gh.mjs");
  writeFileSync(
    script,
    [
      `import { appendFileSync } from "node:fs";`,
      `const args = process.argv.slice(2);`,
      `appendFileSync(${JSON.stringify(callLog())}, JSON.stringify(args) + "\\n");`,
      `const runs = ${JSON.stringify(JSON.stringify(scenario.runs))};`,
      `const jobs = ${JSON.stringify(JSON.stringify({ jobs: scenario.jobs ?? [] }))};`,
      `const log = ${JSON.stringify(scenario.log ?? "")};`,
      `const logRefusal = ${JSON.stringify(scenario.logRefusal ?? "")};`,
      `if (args[0] === "run" && args[1] === "list") process.stdout.write(runs);`,
      `else if (args[0] === "run" && args[1] === "view" && args.includes("--log-failed") && logRefusal !== "") { process.stderr.write(logRefusal); process.exit(1); }`,
      `else if (args[0] === "run" && args[1] === "view" && args.includes("--log-failed")) process.stdout.write(log);`,
      `else if (args[0] === "run" && args[1] === "view") process.stdout.write(jobs);`,
      `else { process.stderr.write("stub: unexpected " + args.join(" ")); process.exit(9); }`,
      ``,
    ].join("\n"),
  );

  if (process.platform === "win32") {
    writeFileSync(
      join(binDir, "gh.cmd"),
      `@echo off\r\n"${process.execPath}" "%~dp0gh.mjs" %*\r\n`,
    );
  } else {
    const launcher = join(binDir, "gh");
    writeFileSync(launcher, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
    chmodSync(launcher, 0o755);
  }
  const host = (process.env["PATH"] ?? "")
    .split(delimiter)
    .filter((dir) => dir !== "" && onPath(FORGE, dir) === undefined);
  process.env["PATH"] = [binDir, ...host].join(delimiter);

  // The filter can take git's own directory with it, on a host that installs
  // both in one — `/usr/bin` on the POSIX lane's runner.
  if (onPath("git", process.env["PATH"]) === undefined) linkGit();
}

/** One completed run, shaped as the forge's own `run list --json` prints it. */
const RUN = {
  databaseId: 17420993001,
  displayTitle: "build: pin the CI push trigger",
  url: "https://forge.test/flume/actions/runs/17420993001",
  conclusion: "failure",
  createdAt: "2026-09-14T09:12:33Z",
};

/** The declared job within that run, as `run view --json jobs` prints it. */
const job = (conclusion: string) => ({
  databaseId: 49551122,
  name: LANE.job,
  conclusion,
});

/** The ESC every ANSI sequence opens with, spelled once. */
const ESC = "\u001B";

/**
 * One log line as the forge itself frames it: the job name and the step name
 * tab-separated, then the runner's timestamp, then what the log's author
 * actually wrote. The fixtures below are written in this shape rather than in
 * bare content because the framing is exactly what is under test — a bare
 * fixture would be the tester re-authoring the forge's vocabulary
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*).
 */
const framed = (content: string): string =>
  `${LANE.job}\tRun tests\t2026-09-15T09:12:33.1234567Z ${content}`;

/**
 * The same frame the forge writes when the runner stamped no timestamp on the
 * line: the two tab-separated names, then the content directly. One job's
 * `--log-failed` output carries both shapes, so both are fixture vocabulary
 * here rather than one being the tester's invention.
 */
const unstamped = (content: string): string => `${LANE.job}\tRun tests\t${content}`;

/** Everything the rendered block says from the log header down. */
function loggedLines(rendered: string): string[] {
  const header = "--- the failing job's log ---";
  const at = rendered.indexOf(header);
  if (at < 0) throw new Error(`the block carries no log:\n${rendered}`);
  return rendered.slice(at + header.length + 1).split("\n");
}

it("the lane block renders the declared lane's failing run under its lane name", () => {
  const failure = "FAIL tests/paths.test.ts > a long path is refused by name";
  plantForge({
    runs: [RUN],
    jobs: [job("failure")],
    log: `pnpm test\n${failure}\n2 failed | 40 passed\n`,
  });

  const rendered = laneBlock();

  // Vacuity: the forge was actually asked, and asked for this lane's workflow
  // on the branch git reports for the repository's tip — a render that
  // reached no CLI would satisfy every assertion below on an empty string.
  const asked = calls();
  expect(asked.length).toBeGreaterThan(0);
  expect(asked[0]?.join(" ")).toContain(`--workflow ${LANE.workflow}`);
  expect(asked[0]?.join(" ")).toContain("--branch main");
  expect(asked[0]?.join(" ")).toContain("--status completed");

  expect(rendered).toContain(`lane \`${LANE.name}\``);
  expect(rendered).toContain("FAILING");
  expect(rendered).toContain(String(RUN.databaseId));
  expect(rendered).toContain(RUN.url);
  expect(rendered).toContain(failure);

  // The log came from the declared job, by the id the forge gave it — not
  // from the run at large.
  expect(
    asked.some(
      (call) =>
        call.includes("--log-failed") &&
        call.includes(String(job("failure").databaseId)),
    ),
  ).toBe(true);
}, SPAWN_BUDGET_MS);

it("the lane block renders a lane whose latest completed run passed as green", () => {
  plantForge({ runs: [{ ...RUN, conclusion: "success" }], jobs: [job("success")] });

  const rendered = laneBlock();

  // Vacuity: the same fixture as the failing case up to the job's conclusion,
  // and the forge answered both questions.
  expect(calls().length).toBe(2);
  expect(rendered).toContain(`lane \`${LANE.name}\``);
  expect(rendered).toContain("GREEN");
  expect(rendered).toContain(String(RUN.databaseId));
  expect(rendered).not.toContain("FAILING");
  expect(rendered).not.toContain("UNREAD");
  // A green lane has no material, so no log is fetched for it.
  expect(calls().some((call) => call.includes("--log-failed"))).toBe(false);
}, SPAWN_BUDGET_MS);

it("the lane block renders a lane as unread when no completed run for the tip's branch exists", () => {
  plantForge({ runs: [] });

  const rendered = laneBlock();

  // Vacuity: the forge was reached and answered — this is an empty listing,
  // not a CLI that never ran.
  expect(calls().length).toBe(1);
  expect(rendered).toContain(`lane \`${LANE.name}\``);
  expect(rendered).toContain("UNREAD");
  expect(rendered).toContain(LANE.workflow);
  expect(rendered).toContain("main");
  expect(rendered).not.toContain("GREEN");
  expect(rendered).not.toContain("FAILING");
}, SPAWN_BUDGET_MS);

/**
 * PATH is stripped to a single directory here, which is the only way to prove
 * the CLI is absent on a host that has it installed — prepending cannot hide
 * what sits behind it. The reader still has a branch to name, so git comes
 * back through {@link linkGit}, whose spelling is why this case declares a
 * host.
 */
it.runIf(process.platform !== "win32")(
  "the lane block renders a lane as unread when the forge CLI is absent",
  () => {
    linkGit();
    process.env["PATH"] = binDir;

    // Vacuity: the CLI really is unreachable from this PATH, and git really
    // is — so the reason below is the forge's absence and not git's. The
    // probe captures nothing: what it proves is the spawn failing, and its
    // streams go nowhere.
    expect(() =>
      execFileSync("gh", ["--version"], { stdio: "ignore" }),
    ).toThrow();
    expect(git("--version")).toContain("git version");

    const rendered = laneBlock();
    expect(rendered).toContain(`lane \`${LANE.name}\``);
    expect(rendered).toContain("UNREAD");
    expect(rendered).toContain("gh");
    expect(rendered).toContain("PATH");
    expect(rendered).not.toContain("GREEN");
    expect(rendered).not.toContain("FAILING");
  },
  SPAWN_BUDGET_MS,
);

it("the lane block renders a lane as unread when the declared job is not in the run", () => {
  plantForge({ runs: [RUN], jobs: [{ ...job("success"), name: "posix" }] });

  const rendered = laneBlock();

  expect(calls().length).toBe(2);
  expect(rendered).toContain("UNREAD");
  expect(rendered).toContain(LANE.job);
  expect(rendered).toContain("posix");
  expect(rendered).not.toContain("GREEN");
}, SPAWN_BUDGET_MS);

it("the lane block renders a lane as unread when the forge CLI refuses", () => {
  // The launcher this plants stays; its script is replaced by a CLI that
  // refuses every question the way an unauthenticated one does — a non-zero
  // exit carrying its reason on stderr.
  plantForge({ runs: [RUN] });
  writeFileSync(
    join(binDir, "gh.mjs"),
    `process.stderr.write("gh: could not authenticate to the forge");\nprocess.exit(4);\n`,
  );

  const rendered = laneBlock();

  expect(rendered).toContain("UNREAD");
  expect(rendered).toContain("could not authenticate");
  expect(rendered).not.toContain("GREEN");
  expect(rendered).not.toContain("FAILING");
}, SPAWN_BUDGET_MS);

it("a failing lane's log arrives without the forge's per-line job and step framing", () => {
  const failure = "FAIL tests/paths.test.ts > a long path is refused by name";
  plantForge({
    runs: [RUN],
    jobs: [job("failure")],
    log: [
      framed("##[group]Run pnpm test"),
      framed(""),
      framed(failure),
      framed("##[endgroup]"),
      framed("##[error]Process completed with exit code 1."),
      "",
    ].join("\n"),
  });

  const rendered = laneBlock();

  // Vacuity: the forge answered all three questions and the log reached the
  // block — the assertions below are over material, not over an empty string.
  expect(calls().length).toBe(3);
  expect(rendered).toContain("FAILING");
  expect(rendered).toContain(failure);

  // What the forge wrote around each line is gone — no job/step tabs, no
  // runner timestamp, no workflow-command marker — and the lines that carried
  // nothing but that frame have dropped, while every word the log's own
  // author wrote survives.
  expect(loggedLines(rendered)).toEqual([
    "Run pnpm test",
    failure,
    "Process completed with exit code 1.",
  ]);
}, SPAWN_BUDGET_MS);

it("a failing lane's log arrives without ANSI escape sequences", () => {
  const failure = "FAIL tests/paths.test.ts > a long path is refused by name";
  plantForge({
    runs: [RUN],
    jobs: [job("failure")],
    log: [
      framed(`${ESC}[31m${ESC}[1m${failure}${ESC}[22m${ESC}[39m`),
      framed(`${ESC}]0;vitest\u0007  Tests  2 failed | 40 passed`),
      "",
    ].join("\n"),
  });

  const rendered = laneBlock();

  // Vacuity: the coloured lines reached the block, so the ESC assertion below
  // is over a log that really carried them.
  expect(calls().length).toBe(3);
  expect(rendered).toContain("FAILING");
  expect(loggedLines(rendered)).toEqual([
    failure,
    "  Tests  2 failed | 40 passed",
  ]);
  expect(rendered).not.toContain(ESC);
}, SPAWN_BUDGET_MS);

it("the lane block spends a failing lane's line budget on log lines, not the forge's framing", () => {
  const titles = Array.from(
    { length: 4 },
    (_, index) => `FAIL tests/case${index}.test.ts > case ${index} is refused`,
  );
  const log = titles
    .flatMap((title) => [
      framed("##[group]one failing case"),
      framed(""),
      framed(title),
      framed("##[endgroup]"),
    ])
    .join("\n");
  plantForge({ runs: [RUN], jobs: [job("failure")], log });

  // Vacuity: the budget really bites on what the forge printed — twice over —
  // so a block carrying every title is the shed's doing and not slack.
  const budget = 8;
  expect(log.split("\n").length).toBeGreaterThan(budget);

  const rendered = laneBlock(budget);

  expect(rendered).toContain("FAILING");
  expect(loggedLines(rendered)).toEqual(
    titles.flatMap((title) => ["one failing case", title]),
  );
  expect(rendered).not.toContain("above this tick's budget");
}, SPAWN_BUDGET_MS);

it("the shed strips the forge's frame from a log line the job name frames without a timestamp", () => {
  const failure = "FAIL tests/paths.test.ts > a long path is refused by name";
  // Real suite output whose own content carries tabs: the frame comes off it,
  // and its leading column does not go with the frame.
  const columns = "tests/paths.test.ts\t2\tfailed";
  plantForge({
    runs: [RUN],
    jobs: [job("failure")],
    log: [unstamped(failure), unstamped(columns), ""].join("\n"),
  });

  const rendered = laneBlock();

  // Vacuity: the forge answered all three questions and the log reached the
  // block, so the lines asserted below are over material.
  expect(calls().length).toBe(3);
  expect(rendered).toContain("FAILING");

  expect(loggedLines(rendered)).toEqual([failure, columns]);
  expect(rendered).not.toContain(`${LANE.job}\tRun tests`);
}, SPAWN_BUDGET_MS);

it("the shed drops a log line the forge framed around an empty message", () => {
  const titles = [
    "FAIL tests/a.test.ts > the first case is refused",
    "FAIL tests/b.test.ts > the second case is refused",
  ];
  const log = [
    unstamped(""),
    unstamped(titles[0] ?? ""),
    unstamped(""),
    unstamped(""),
    unstamped(titles[1] ?? ""),
    unstamped(""),
    "",
  ].join("\n");
  plantForge({ runs: [RUN], jobs: [job("failure")], log });

  // Vacuity: the budget is smaller than what the forge printed, so a block
  // carrying both titles untrimmed is the drop's doing and not slack.
  const budget = 2;
  expect(log.split("\n").length).toBeGreaterThan(budget);

  const rendered = laneBlock(budget);

  expect(rendered).toContain("FAILING");
  expect(loggedLines(rendered)).toEqual(titles);
  expect(rendered).not.toContain("above this tick's budget");
}, SPAWN_BUDGET_MS);

it("the lane leg reports live when a declared lane's latest completed run failed past the lane's stamp", () => {
  plantForge({ runs: [RUN], jobs: [job("failure")] });
  // Stamped at an older run of the same lane, so the verdict below turns on
  // the comparison rather than on a map that holds nothing for this lane.
  stampLanes({ [LANE.name]: "17420000000" });

  expect(laneLive()).toBe(true);

  // Vacuity: the forge really was asked for this lane on the repository's
  // branch — a leg that never spawned would be answering from nothing.
  const asked = calls();
  expect(asked.length).toBeGreaterThan(0);
  expect(asked[0]?.join(" ")).toContain(`--workflow ${LANE.workflow}`);
  expect(asked[0]?.join(" ")).toContain("--branch main");

  // The selection path buys the run's identity and its job's conclusion, and
  // never the failing job's log: the verdict is a comparison, and a
  // multi-megabyte fetch to answer a boolean would be paid on every tick.
  expect(asked.some((call) => call.includes("--log-failed"))).toBe(false);

  // A lane the state has never been stamped for is undrained too — the
  // absent map is a state, not a repair (`harness/planState.ts`).
  rmSync(join(stateRoot(), "plan"), { recursive: true, force: true });
  expect(laneLive()).toBe(true);
}, SPAWN_BUDGET_MS);

it("the lane leg does not report live when the lane's failing run is the one already stamped", () => {
  plantForge({ runs: [RUN], jobs: [job("failure")] });
  stampLanes({ [LANE.name]: String(RUN.databaseId) });

  expect(laneLive()).toBe(false);

  // Vacuity twice: the forge was asked, and the lane it answered for is red —
  // the stamp is what closed the window, not an unread or green lane.
  expect(calls().length).toBeGreaterThan(0);
  expect(laneBlock()).toContain("FAILING");

  // And the stamp alone: the same red run under a different stamp re-opens it.
  stampLanes({ [LANE.name]: "17420000000" });
  expect(laneLive()).toBe(true);
}, SPAWN_BUDGET_MS);

it("the lane leg does not report live when the lane's latest completed run passed", () => {
  plantForge({ runs: [{ ...RUN, conclusion: "success" }], jobs: [job("success")] });
  stampLanes({});

  expect(laneLive()).toBe(false);

  // Vacuity: the forge answered both of the leg's questions, and answered
  // green — a green run needs no drain, so no stamp is required to close it.
  expect(calls().length).toBe(2);
  expect(laneBlock()).toContain("GREEN");
}, SPAWN_BUDGET_MS);

it("the lane leg does not report live when the forge CLI cannot read the lane", () => {
  // The launcher plantForge leaves stays; its script becomes a CLI that
  // records the question and then refuses it, the way an unauthenticated one
  // does — so the call log proves the leg reached the forge.
  plantForge({ runs: [RUN], jobs: [job("failure")] });
  writeFileSync(
    join(binDir, "gh.mjs"),
    [
      `import { appendFileSync } from "node:fs";`,
      `appendFileSync(${JSON.stringify(callLog())}, JSON.stringify(process.argv.slice(2)) + "\\n");`,
      `process.stderr.write("gh: could not authenticate to the forge");`,
      `process.exit(4);`,
      ``,
    ].join("\n"),
  );
  stampLanes({});

  expect(laneLive()).toBe(false);

  // Vacuity: the forge was asked and refused, and the lane renders unread —
  // unread is live for nothing, and is not green.
  expect(calls().length).toBeGreaterThan(0);
  const rendered = laneBlock();
  expect(rendered).toContain("UNREAD");
  expect(rendered).not.toContain("GREEN");
}, SPAWN_BUDGET_MS);

/**
 * The wake marker's own fixture line — a failing job's log with one title in
 * it, so a case about the marker still renders a whole FAILING block.
 */
const FAILING_LOG = "FAIL tests/paths.test.ts > a long path is refused by name\n";

it("the lane block names the lane whose undrained failing run made the slice live", () => {
  plantForge({ runs: [RUN], jobs: [job("failure")], log: FAILING_LOG });
  // Stamped at an older run of the same lane, so this lane is undrained by the
  // comparison rather than by a map holding nothing for it.
  stampLanes({ [LANE.name]: "17420000000" });

  const rendered = laneBlock();

  // Vacuity: the forge answered all three questions, so what is asserted below
  // is a reading of a real red lane and not an empty string.
  expect(calls().length).toBe(3);
  expect(rendered).toContain(`lane \`${LANE.name}\``);
  expect(rendered).toContain("FAILING");

  expect(rendered).toContain("Woke this slice:");
  expect(rendered).toContain(`drainedRuns.${LANE.name}`);
  expect(rendered).not.toContain("Not what woke this slice");
}, SPAWN_BUDGET_MS);

/** The refusal a forge that holds the run but not its log answers with. */
const LOG_REFUSAL = "gh: the forge would not hand over this job's log";

it("a lane woken by a run whose log the forge refuses renders unread over that run, not over nothing", () => {
  plantForge({ runs: [RUN], jobs: [job("failure")], logRefusal: LOG_REFUSAL });
  stampLanes({});

  // Vacuity: this lane really is what makes the slice live — nothing else on
  // this disk opens it — so the block below renders over a wake and not over
  // an unread nobody was woken by.
  expect(laneLive()).toBe(true);

  const rendered = laneBlock();

  // Vacuity again: the log really was asked for, and really was refused.
  expect(calls().some((call) => call.includes("--log-failed"))).toBe(true);
  expect(rendered).toContain("UNREAD");
  expect(rendered).toContain(LOG_REFUSAL);

  // The wake, and the run it was woken over — named, not dropped with the
  // status the read degraded from.
  expect(rendered).toContain("Woke this slice:");
  expect(rendered).toContain(String(RUN.databaseId));
  expect(rendered).toContain(RUN.url);
  expect(rendered).toContain(RUN.displayTitle);
  expect(rendered).not.toContain("GREEN");
}, SPAWN_BUDGET_MS);

it("the unread block over the run a lane woke on names the stamp that closes that lane", () => {
  plantForge({ runs: [RUN], jobs: [job("failure")], logRefusal: LOG_REFUSAL });
  stampLanes({});

  // Vacuity: this lane is what makes the slice live, so what is asserted below
  // is the directive on a wake and not on an unread nobody was woken by.
  expect(laneLive()).toBe(true);

  const rendered = laneBlock();
  expect(rendered).toContain("UNREAD");
  expect(rendered).toContain(LOG_REFUSAL);

  // The stamp named with the run it closes — not the bare field name the wake
  // marker already carries with no run beside it.
  expect(rendered).toContain(`drainedRuns.${LANE.name}\` at \`${RUN.databaseId}\``);
}, SPAWN_BUDGET_MS);

it("a lane stamped at the run whose log the forge refused no longer reports live", () => {
  plantForge({ runs: [RUN], jobs: [job("failure")], logRefusal: LOG_REFUSAL });

  // Vacuity: unstamped, this is a live lane whose log the forge really did
  // refuse — so the verdict below is the stamp's doing, not an unread the
  // liveness leg was never going to open for.
  stampLanes({});
  expect(laneLive()).toBe(true);
  const unstamped = laneBlock();
  expect(unstamped).toContain("UNREAD");
  expect(unstamped).toContain(LOG_REFUSAL);

  stampLanes({ [LANE.name]: String(RUN.databaseId) });
  expect(laneLive()).toBe(false);
}, SPAWN_BUDGET_MS);

it("a failing lane already stamped at its latest run renders without the wake marker its unstamped self carries", () => {
  plantForge({ runs: [RUN], jobs: [job("failure")], log: FAILING_LOG });
  stampLanes({ [LANE.name]: String(RUN.databaseId) });

  const stamped = laneBlock();
  expect(stamped).toContain("FAILING");
  expect(stamped).not.toContain("Woke this slice");
  expect(stamped).toContain("Not what woke this slice");

  // Vacuity: the marker exists at all, and the stamp alone is what withheld
  // it — the same red run under an older stamp carries it.
  stampLanes({ [LANE.name]: "17420000000" });
  const unstamped = laneBlock();
  expect(unstamped).toContain("FAILING");
  expect(unstamped).toContain("Woke this slice");
}, SPAWN_BUDGET_MS);

it("one tick's liveness leg and render ask the forge once per lane between them", () => {
  plantForge({ runs: [RUN], jobs: [job("failure")], log: FAILING_LOG });
  stampLanes({});

  // One lane leg is one tick: the chain factory builds the windows once and
  // each tick is a fresh child (`harness/chain.ts`), so the two calls below
  // are the two readers of a single tick's leg.
  const lanes = [LANE, SECOND_LANE];
  const leg = lane(undefined, lanes);
  expect(leg.live(stateRoot())).toBe(true);
  const rendered = leg.render(stateRoot());

  // Vacuity: both declared lanes reached the forge and rendered from its
  // answer, so the counts below are over two lanes actually read.
  for (const declared of lanes) {
    expect(rendered).toContain(`lane \`${declared.name}\``);
  }
  expect(rendered).toContain("FAILING");
  expect(rendered).not.toContain("UNREAD");

  const asked = calls();
  const count = (matches: (call: string[]) => boolean): number =>
    asked.filter(matches).length;
  expect(count((call) => call[0] === "run" && call[1] === "list")).toBe(lanes.length);
  expect(
    count(
      (call) =>
        call[0] === "run" && call[1] === "view" && !call.includes("--log-failed"),
    ),
  ).toBe(lanes.length);
  expect(count((call) => call.includes("--log-failed"))).toBe(lanes.length);
  expect(asked.length).toBe(3 * lanes.length);
}, SPAWN_BUDGET_MS);

/**
 * The one case about the wiring rather than about the lane: the slice's window
 * is where a lane block reaches a prompt, and the block it carries is this
 * module's subject rendered by the module that owns it (`harness/ciLane.ts`).
 * Every other case here drives that module directly.
 */
it("the inbox window's CI lane block is the lane leg's own render", () => {
  plantForge({ runs: [RUN], jobs: [job("failure")], log: FAILING_LOG });
  stampLanes({});

  const built = planSliceWindows({
    declaration: declarationFor(),
    repoRoot: repo,
  }).find((candidate) => candidate.name === INBOX_PHASE);
  if (built === undefined) throw new Error("the inbox slice built no window");
  const args = built.args({ cwd: repo, flumeDir: stateRoot() });

  // The key is the window's own declared data, not text the prompt authored:
  // the arg map and the keys the phase hands the engine as data are one list.
  expect(built.dataKeys).toContain("CI_LANES");
  expect(Object.keys(args).sort()).toEqual([...built.dataKeys].sort());

  // Vacuity: a real reading of a red lane reached the arg — an empty string or
  // the no-lanes spelling would satisfy the equality below on nothing.
  expect(args["CI_LANES"]).toContain(`lane \`${LANE.name}\``);
  expect(args["CI_LANES"]).toContain("FAILING");

  expect(args["CI_LANES"]).toBe(laneBlock());
}, SPAWN_BUDGET_MS);

/**
 * Stage a forge CLI on PATH ahead of anything a case plants, standing in for
 * the one a host has installed of its own. Planted rather than looked for, so
 * the case below proves the same thing on a host that has no forge CLI at
 * all. The win32 spelling is the `.cmd` a direct spawn skips and a shell
 * retry reaches — the same shape the stub's own launcher takes there, so a
 * PATH that still carried this directory would answer from it.
 */
function stageHostForge(): string {
  const dir = mkTempDirSync("flume-ci-host-");
  stagedDirs.push(dir);
  if (process.platform === "win32") {
    writeFileSync(
      join(dir, `${FORGE}.cmd`),
      `@echo off\r\necho host forge, not the stub 1>&2\r\nexit /b 9\r\n`,
    );
  } else {
    const launcher = join(dir, FORGE);
    writeFileSync(launcher, `#!/bin/sh\necho "host forge, not the stub" >&2\nexit 9\n`);
    chmodSync(launcher, 0o755);
  }
  process.env["PATH"] = `${dir}${delimiter}${process.env["PATH"] ?? ""}`;
  return dir;
}

it("every lane-reader case reads its planted forge stub, with the host's own forge CLI off PATH", () => {
  const staged = stageHostForge();

  // Vacuity: the host's copy really is reachable, and ahead of everything, so
  // what the assertions below read is a filter and not an accident of order.
  expect(onPath(FORGE, process.env["PATH"] ?? "")?.startsWith(staged)).toBe(true);

  plantForge({ runs: [RUN], jobs: [job("failure")] });

  // One directory on the PATH every case is handed holds a forge CLI, and it
  // is the stub's own — wherever the host's copy sat, it is off.
  const dirs = (process.env["PATH"] ?? "").split(delimiter).filter((dir) => dir !== "");
  expect(dirs.filter((dir) => onPath(FORGE, dir) !== undefined)).toEqual([binDir]);

  // And the reading really went through it: the stub answered all three
  // questions, and the lane renders from its answer on the branch git — still
  // reachable — named for the tip.
  const rendered = laneBlock();
  expect(calls().length).toBe(3);
  expect(calls()[0]?.join(" ")).toContain("--branch main");
  expect(rendered).toContain("FAILING");
  expect(rendered).toContain(String(RUN.databaseId));
}, SPAWN_BUDGET_MS);

/**
 * The filter above takes git with it on a host that installs git and the
 * forge CLI in one directory — `/usr/bin` on the POSIX lane's runner. Staged
 * rather than waited for: PATH is cut to a single directory holding both, so
 * the fixture is in that position on every host. POSIX-declared for
 * {@link linkGit}'s reason, which is the same one the absent-CLI case above
 * declares a host for.
 */
it.runIf(process.platform !== "win32")(
  "the lane block names the tip's branch when the forge filter took git's own directory",
  () => {
    const mixed = stageHostForge();
    symlinkSync(String(onPath("git", originalPath ?? "")), join(mixed, "git"));
    process.env["PATH"] = mixed;

    // Vacuity: the one directory PATH names holds both, so the filter really
    // has to drop git to drop the forge.
    expect(onPath(FORGE, mixed)).toBe(join(mixed, FORGE));
    expect(onPath("git", mixed)).toBe(join(mixed, "git"));

    plantForge({ runs: [RUN], jobs: [job("failure")] });

    expect((process.env["PATH"] ?? "").split(delimiter)).toEqual([binDir]);

    const rendered = laneBlock();
    expect(calls().length).toBe(3);
    expect(calls()[0]?.join(" ")).toContain("--branch main");
    expect(rendered).toContain("FAILING");
  },
  SPAWN_BUDGET_MS,
);
