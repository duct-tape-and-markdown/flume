/**
 * The inbox slice's CI lane block (`spec/harness.md`, *CI lanes as a findings
 * source*): a declared lane's latest completed run, read through a forge CLI
 * on PATH and rendered under the lane's name.
 *
 * **The real reader over a real spawn.** Every case here plants an executable
 * named for the forge CLI on PATH and drives the shipped window's own `args`,
 * so the seam under test is the reader's argument vector against a CLI that
 * answers it — not a mocked `execFileSync` pinning this package's idea of what
 * it would have printed (`.claude/rules/engineering.md`, *A seam gate reads
 * what the real writer wrote*). The stub records every invocation, so a case
 * can assert what the forge was asked as well as what the window did with the
 * answer.
 *
 * The declaration goes through the package's own `parseDeclaration`, and the
 * repository is a real one: the branch the reader filters runs by is the
 * branch git reports for the tip, not a string this file hands it.
 */

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import { INBOX_PHASE } from "../harness/declaration.ts";
import {
  parseDeclaration,
  planSliceWindows,
  type PlanSliceWindow,
} from "../harness/index.ts";

import { SPAWN_BUDGET_MS } from "./helpers/subprocess.ts";

/** The repository the window reads its branch from; also its state root. */
let repo: string;
/** The directory placed on PATH, holding the forge stub a case planted. */
let binDir: string;
/** PATH as this process had it before a case rewrote it. */
let originalPath: string | undefined;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "flume-ci-"));
  binDir = mkdtempSync(join(tmpdir(), "flume-ci-bin-"));
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
  for (const dir of [repo, binDir]) {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}

/** The lane every case declares — one workflow, one job, one name. */
const LANE = { name: "windows", workflow: "ci.yml", job: "windows" } as const;

/** The runner factory a declaration carries; no case here drives the judge. */
const runner = () => ({
  run: async () => [],
  runAtBase: async () => [],
  lanes: [],
});

/**
 * The inbox window over a declaration naming {@link LANE}.
 *
 * `budget` is the package's own line budget unless a case names one — the
 * knob the window already carries, so a case can provoke the trim without
 * minting a thousand-line fixture to reach the default.
 */
function inboxWindow(budget?: number): PlanSliceWindow {
  const declaration = parseDeclaration({
    specLocus: ["spec/**"],
    fence: { build: ["src/**"] },
    runner,
    slices: { enabled: [INBOX_PHASE] },
    ci: [LANE],
  });
  const built = planSliceWindows({
    declaration,
    repoRoot: repo,
    ...(budget === undefined ? {} : { budget }),
  });
  const window = built.find((candidate) => candidate.name === INBOX_PHASE);
  if (window === undefined) throw new Error("the inbox slice built no window");
  return window;
}

/** The inbox window's rendered arguments for this tick. */
function inboxArgs(budget?: number): Record<string, string> {
  return inboxWindow(budget).args({ cwd: repo, flumeDir: join(repo, ".flume") });
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
 */
interface ForgeScenario {
  readonly runs: unknown[];
  readonly jobs?: unknown[];
  readonly log?: string;
}

/**
 * Plant a forge CLI on PATH answering `scenario`, and put its directory ahead
 * of everything else so a host that really has the CLI installed cannot
 * answer in its place.
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
      `if (args[0] === "run" && args[1] === "list") process.stdout.write(runs);`,
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
  process.env["PATH"] = `${binDir}${delimiter}${originalPath ?? ""}`;
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

/** Everything the rendered block says from the log header down. */
function loggedLines(rendered: string): string[] {
  const header = "--- the failing job's log ---";
  const at = rendered.indexOf(header);
  if (at < 0) throw new Error(`the block carries no log:\n${rendered}`);
  return rendered.slice(at + header.length + 1).split("\n");
}

it("the inbox window renders the declared lane's failing run under its lane name", () => {
  const failure = "FAIL tests/paths.test.ts > a long path is refused by name";
  plantForge({
    runs: [RUN],
    jobs: [job("failure")],
    log: `pnpm test\n${failure}\n2 failed | 40 passed\n`,
  });

  const args = inboxArgs();

  // The key is the window's own declared data, not text the prompt authored:
  // the arg map and the keys the phase hands the engine as data are the same
  // list (`harness/windows.ts`, SLICE_DATA_KEYS).
  expect(inboxWindow().dataKeys).toContain("CI_LANES");
  expect(Object.keys(args).sort()).toEqual([...inboxWindow().dataKeys].sort());

  // Vacuity: the forge was actually asked, and asked for this lane's workflow
  // on the branch git reports for the repository's tip — a render that
  // reached no CLI would satisfy every assertion below on an empty string.
  const asked = calls();
  expect(asked.length).toBeGreaterThan(0);
  expect(asked[0]?.join(" ")).toContain(`--workflow ${LANE.workflow}`);
  expect(asked[0]?.join(" ")).toContain("--branch main");
  expect(asked[0]?.join(" ")).toContain("--status completed");

  const rendered = args["CI_LANES"] ?? "";
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

it("the inbox window renders a lane whose latest completed run passed as green", () => {
  plantForge({ runs: [{ ...RUN, conclusion: "success" }], jobs: [job("success")] });

  const rendered = inboxArgs()["CI_LANES"] ?? "";

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

it("the inbox window renders a lane as unread when no completed run for the tip's branch exists", () => {
  plantForge({ runs: [] });

  const rendered = inboxArgs()["CI_LANES"] ?? "";

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
 * what sits behind it. git is symlinked into that directory because the
 * reader still has a branch to name, and a symlink is a POSIX spelling: a
 * win32 git found through one resolves its own install layout from the link's
 * directory, so the case is not written for that host.
 */
it.runIf(process.platform !== "win32")(
  "the inbox window renders a lane as unread when the forge CLI is absent",
  () => {
    const realGit = execFileSync("/bin/sh", ["-c", "command -v git"], {
      encoding: "utf8",
    }).trim();
    expect(realGit).not.toBe("");
    symlinkSync(realGit, join(binDir, "git"));
    process.env["PATH"] = binDir;

    // Vacuity: the CLI really is unreachable from this PATH, and git really
    // is — so the reason below is the forge's absence and not git's.
    expect(() =>
      execFileSync("gh", ["--version"], { stdio: "ignore" }),
    ).toThrow();
    expect(execFileSync("git", ["--version"], { encoding: "utf8" })).toContain(
      "git version",
    );

    const rendered = inboxArgs()["CI_LANES"] ?? "";
    expect(rendered).toContain(`lane \`${LANE.name}\``);
    expect(rendered).toContain("UNREAD");
    expect(rendered).toContain("gh");
    expect(rendered).toContain("PATH");
    expect(rendered).not.toContain("GREEN");
    expect(rendered).not.toContain("FAILING");
  },
  SPAWN_BUDGET_MS,
);

it("the inbox window renders a lane as unread when the declared job is not in the run", () => {
  plantForge({ runs: [RUN], jobs: [{ ...job("success"), name: "posix" }] });

  const rendered = inboxArgs()["CI_LANES"] ?? "";

  expect(calls().length).toBe(2);
  expect(rendered).toContain("UNREAD");
  expect(rendered).toContain(LANE.job);
  expect(rendered).toContain("posix");
  expect(rendered).not.toContain("GREEN");
}, SPAWN_BUDGET_MS);

it("the inbox window renders a lane as unread when the forge CLI refuses", () => {
  // The launcher this plants stays; its script is replaced by a CLI that
  // refuses every question the way an unauthenticated one does — a non-zero
  // exit carrying its reason on stderr.
  plantForge({ runs: [RUN] });
  writeFileSync(
    join(binDir, "gh.mjs"),
    `process.stderr.write("gh: could not authenticate to the forge");\nprocess.exit(4);\n`,
  );

  const rendered = inboxArgs()["CI_LANES"] ?? "";

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

  const rendered = inboxArgs()["CI_LANES"] ?? "";

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

  const rendered = inboxArgs()["CI_LANES"] ?? "";

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

it("the inbox window spends a failing lane's line budget on log lines, not the forge's framing", () => {
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

  const rendered = inboxArgs(budget)["CI_LANES"] ?? "";

  expect(rendered).toContain("FAILING");
  expect(loggedLines(rendered)).toEqual(
    titles.flatMap((title) => ["one failing case", title]),
  );
  expect(rendered).not.toContain("above this tick's budget");
}, SPAWN_BUDGET_MS);
