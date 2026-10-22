/**
 * `.claude/rules/platform-facts.md` *Node caps a captured child stream at
 * 1 MiB, and reports the overrun as a spawn failure* says every spawn site
 * declares its cap. This file is the rung above that sentence: the capturing
 * spawns this repo ships or runs, held to it mechanically.
 *
 * The repo pin asserts an absence, so it comes after its detector shown
 * working — a domain whose capped, capless, forwarding and non-capturing
 * spawns are known by construction, written in both alphabets the trees are
 * written in and reached through both arms the domain has. Without that,
 * "every spawn declares its cap" is a claim no failing run has ever backed,
 * and it stays green however narrow the subject rule drifts.
 *
 * The scanner is the same one in both, so the fixture cannot drift into
 * testing a second implementation of the verdict.
 *
 * Two verdicts ride that one fixture: the cap each capturing call declares,
 * and what each spawn *home* leaves its child's stdin as. They are separate
 * scans over separate judged sets — a cap can be named by whoever calls a
 * wrapper, a child's stdin only where the child is started — so the cases
 * below carry both answers, and a case is written for the arm it is named
 * for.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterAll, beforeAll, expect, it } from "vitest";

import { mkTempDir } from "./helpers/fixtureRoot.ts";
import { REPO_ROOT, expectNoFindings } from "./helpers/repoProgram.ts";
import {
  REPO_DOMAIN,
  SHIPPED_SPAWN_HOMES,
  SPAWN_STDIN_ENDER,
  formatPromisifiedSpawnSite,
  formatSpawnCapSite,
  formatSpawnStdinSite,
  formatSyncSpawnSite,
  scanPromisifiedSpawns,
  scanSpawnCaps,
  scanSpawnStdin,
  scanSyncSpawns,
  type SpawnCapScan,
} from "./helpers/spawnCaps.ts";

// --- the detector, over a tree whose spawns are known by construction ---

/**
 * One module per case, so a module name is the case it stands for and no
 * expectation below is a line number waiting to move.
 *
 * Capless and capped calls through an alias; a cap named in an options
 * object built above the call rather than at it; a wrapper that hands its
 * caller's options bag through, judged at its two call sites instead of its
 * own; an `execFileSync` and a `spawnSync` each piping nothing; a `spawnSync`
 * piping and capping nothing; and a streaming spawn, which has no cap to
 * declare.
 *
 * Two more carry the stdin verdict's own answers, which no case above
 * spells: a home that hands its promise to the ender, and one that pipes
 * stdin in so many words. Each declares a cap, so neither moves the capless
 * verdict below.
 *
 * One case sits outside the swept tree, at the path this repo's own chain
 * is named by, so the domain's named-file arm is judged by the same verdicts
 * as its trees rather than by its own assertion.
 */
const CASES: Record<string, string> = {
  ".flume/chain.ts": [
    `import { execFileSync } from "node:child_process";`,
    `export const head = (cwd: string) =>`,
    `  execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" });`,
    ``,
  ].join("\n"),

  "src/capless.ts": [
    `import { execFile } from "node:child_process";`,
    `import { promisify } from "node:util";`,
    `const run = promisify(execFile);`,
    `export const list = (cwd: string) => run("git", ["log"], { cwd });`,
    ``,
  ].join("\n"),

  "src/capped.ts": [
    `import { execFile } from "node:child_process";`,
    `import { promisify } from "node:util";`,
    `const run = promisify(execFile);`,
    `export const list = (cwd: string) =>`,
    `  run("git", ["log"], { cwd, maxBuffer: 16 << 20 });`,
    ``,
  ].join("\n"),

  "src/builtOptions.ts": [
    `import { execFileSync } from "node:child_process";`,
    `export function list(cwd: string): string {`,
    `  const options = { cwd, encoding: "utf8" as const, maxBuffer: 16 << 20 };`,
    `  return execFileSync("git", ["log"], options);`,
    `}`,
    ``,
  ].join("\n"),

  "src/wrapper.ts": [
    `import { execFileSync, type ExecFileSyncOptions } from "node:child_process";`,
    `export function capture(`,
    `  cmd: string,`,
    `  args: string[],`,
    `  options: ExecFileSyncOptions,`,
    `): Buffer {`,
    `  return execFileSync(cmd, args, { ...options, shell: false });`,
    `}`,
    ``,
  ].join("\n"),

  "src/consumer.ts": [
    `import { capture } from "./wrapper.ts";`,
    `export const list = (cwd: string) => capture("git", ["log"], { cwd });`,
    ``,
  ].join("\n"),

  "src/cappedConsumer.ts": [
    `import { capture } from "./wrapper.ts";`,
    `export const list = (cwd: string) =>`,
    `  capture("git", ["log"], { cwd, maxBuffer: 16 << 20 });`,
    ``,
  ].join("\n"),

  "src/probe.ts": [
    `import { execFileSync } from "node:child_process";`,
    `export const present = (): boolean => {`,
    `  execFileSync("git", ["--version"], { stdio: "ignore" });`,
    `  return true;`,
    `};`,
    ``,
  ].join("\n"),

  "src/inherit.mjs": [
    `import { spawnSync } from "node:child_process";`,
    `export const gc = (cwd) =>`,
    `  spawnSync("git", ["gc"], { cwd, stdio: "inherit" });`,
    ``,
  ].join("\n"),

  "src/piped.mjs": [
    `import { spawnSync } from "node:child_process";`,
    `export const log = (cwd) =>`,
    `  spawnSync("git", ["log"], { cwd, stdio: ["ignore", "pipe", "pipe"] });`,
    ``,
  ].join("\n"),

  "src/streaming.ts": [
    `import { spawn } from "node:child_process";`,
    `export const log = (cwd: string) => spawn("git", ["log"], { cwd });`,
    ``,
  ].join("\n"),

  "src/ended.ts": [
    `import { execFile } from "node:child_process";`,
    `import { promisify } from "node:util";`,
    `import { ${SPAWN_STDIN_ENDER} } from "./spawnShim.js";`,
    `const run = promisify(execFile);`,
    `export const list = (cwd: string) =>`,
    `  ${SPAWN_STDIN_ENDER}(run("git", ["log"], { cwd, maxBuffer: 16 << 20 }));`,
    ``,
  ].join("\n"),

  "src/pipedStdin.ts": [
    `import { execFileSync } from "node:child_process";`,
    `export const list = (cwd: string) =>`,
    `  execFileSync("git", ["log"], {`,
    `    cwd,`,
    `    maxBuffer: 16 << 20,`,
    `    stdio: "pipe",`,
    `  });`,
    ``,
  ].join("\n"),
};

/** The tree the fixture's cases are swept as, and the files it names. */
const FIXTURE_DOMAIN = { trees: ["src"], files: [".flume/chain.ts"] } as const;

/** The modules holding a capturing call the scan owes a verdict on. */
const JUDGED: readonly string[] = [
  ".flume/chain.ts",
  "src/builtOptions.ts",
  "src/capless.ts",
  "src/capped.ts",
  "src/cappedConsumer.ts",
  "src/consumer.ts",
  "src/ended.ts",
  "src/piped.mjs",
  "src/pipedStdin.ts",
];

/**
 * The capturing calls that name no cap, as `formatSpawnCapSite` cites them.
 *
 * Rendered rather than named by module, because the repo verdict below reads
 * its findings through that same formatter and finds none: a formatter only
 * ever run over an empty list has produced no site name at all, and the
 * detail a reverted tick would read off it would itself be unproven
 * (`.claude/rules/engineering.md`, *A green verdict is proven non-vacuous*).
 */
const CAPLESS: readonly string[] = [
  ".flume/chain.ts:3 execFileSync",
  "src/capless.ts:4 run",
  "src/consumer.ts:2 capture",
  "src/piped.mjs:3 spawnSync",
];

/**
 * The spawn homes that leave their child's stdin open, as
 * `formatSpawnStdinSite` cites them — the sites with a cap and no stdin
 * answer, the one that pipes stdin by name, and the wrapper whose options bag
 * is its caller's, which is no answer this scan can read.
 *
 * Rendered rather than named by module, for the reason {@link CAPLESS} is.
 */
const OPEN_STDIN: readonly string[] = [
  ".flume/chain.ts:3 execFileSync",
  "src/builtOptions.ts:4 execFileSync",
  "src/capless.ts:4 run",
  "src/capped.ts:5 run",
  "src/pipedStdin.ts:3 execFileSync",
  "src/wrapper.ts:7 execFileSync",
];

let fixtureRoot = "";
let fixture: SpawnCapScan;

beforeAll(async () => {
  fixtureRoot = await mkTempDir("flume-spawn-caps-");
  for (const [module, source] of Object.entries(CASES)) {
    const segments = module.split("/");
    const path = join(fixtureRoot, ...segments);
    await mkdir(join(fixtureRoot, ...segments.slice(0, -1)), {
      recursive: true,
    });
    await writeFile(path, source, "utf8");
  }
  fixture = scanSpawnCaps(fixtureRoot, FIXTURE_DOMAIN);
});

afterAll(async () => {
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
});

it("the scan reds a capturing spawn written without a cap", () => {
  expect(fixture.scanned.length).toBeGreaterThan(0);
  expect(fixture.findings.map(formatSpawnCapSite).sort()).toEqual([...CAPLESS]);
});

it("the scan judges a forwarder's callers and skips what captures nothing", () => {
  const judged = [...new Set(fixture.scanned.map((s) => s.module))].sort();
  expect(judged).toEqual([...JUDGED]);
});

/**
 * The wrapper verdict, over the same fixture: `capless.ts`, `capped.ts` and
 * `ended.ts` each build one `promisify(execFile)`, so a domain declaring
 * `capped.ts` its home has exactly two findings by construction. The repo
 * pin this backs (`tests/subprocessHelper.test.ts`) asserts an absence,
 * which is green over a needle that reads nothing — this is the run where
 * the needle bites.
 */
it("the wrapper scan reds a promisified spawn built outside the declared home", () => {
  const scan = scanPromisifiedSpawns(fixtureRoot, FIXTURE_DOMAIN, [
    "src/capped.ts",
  ]);
  expect(scan.scanned.map(formatPromisifiedSpawnSite).sort()).toEqual([
    "src/capless.ts:3 promisify(execFile)",
    "src/capped.ts:3 promisify(execFile)",
    "src/ended.ts:4 promisify(execFile)",
  ]);
  expect(scan.findings.map(formatPromisifiedSpawnSite).sort()).toEqual([
    "src/capless.ts:3 promisify(execFile)",
    "src/ended.ts:4 promisify(execFile)",
  ]);
});

/**
 * The sync verdict, over the same fixture: five of its cases reach a sync
 * capturing API directly, named below rather than here, and a domain
 * declaring one of them its home has exactly four findings by construction.
 * The wrapper the case holding the home spells takes its options bag from a
 * caller, which is a forwarder to the cap scan and a capture to this one —
 * the two scans ask different questions of one call.
 *
 * The repo pin this backs (`tests/subprocessHelper.test.ts`) asserts an
 * absence, which is green over a needle that reads nothing — this is the run
 * where the needle bites.
 */
it("the sync scan reds a capturing sync spawn written outside the declared home", () => {
  const scan = scanSyncSpawns(fixtureRoot, FIXTURE_DOMAIN, ["src/wrapper.ts"]);
  expect(scan.scanned.map(formatSyncSpawnSite).sort()).toEqual([
    ".flume/chain.ts:3 execFileSync",
    "src/builtOptions.ts:4 execFileSync",
    "src/piped.mjs:3 spawnSync",
    "src/pipedStdin.ts:3 execFileSync",
    "src/wrapper.ts:7 execFileSync",
  ]);
  expect(scan.findings.map(formatSyncSpawnSite).sort()).toEqual([
    ".flume/chain.ts:3 execFileSync",
    "src/builtOptions.ts:4 execFileSync",
    "src/piped.mjs:3 spawnSync",
    "src/pipedStdin.ts:3 execFileSync",
  ]);
});

/**
 * The exemption the repo pin rests on, shown on cases built to carry it: a
 * call piping nothing captures nothing, and the fixture spells one with
 * `execFileSync` and one with `spawnSync`, so neither half of the family is
 * excused by the other's reading. The third case below is an async spawn,
 * which is no sync capture whatever it buffers.
 *
 * Each module is read and still holds a capturing name, so the absences are
 * exclusions rather than a domain that missed them.
 */
it("the sync scan exempts a capture-free sync spawn and reads no async one", () => {
  const scan = scanSyncSpawns(fixtureRoot, FIXTURE_DOMAIN, []);
  const exempt = ["src/probe.ts", "src/inherit.mjs", "src/capless.ts"];
  for (const module of exempt) {
    expect(scan.modules).toContain(module);
    expect(CASES[module]).toMatch(/exec|spawn/);
  }
  const judged = new Set(scan.scanned.map((site) => site.module));
  expect([...judged].length).toBeGreaterThan(0);
  for (const module of exempt) expect(judged).not.toContain(module);
});

it("the scan refuses a child_process import it cannot read", async () => {
  const root = await mkTempDir("flume-spawn-caps-opaque-");
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(
      join(root, "src", "opaque.ts"),
      [
        `import cp from "node:child_process";`,
        `export const log = (cwd: string) =>`,
        `  cp.execFileSync("git", ["log"], { cwd });`,
        ``,
      ].join("\n"),
      "utf8",
    );
    expect(() => scanSpawnCaps(root, { trees: ["src"] })).toThrow(
      /named bindings/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("the scan refuses a tree holding no module at all", async () => {
  const root = await mkTempDir("flume-spawn-caps-empty-");
  try {
    await mkdir(join(root, "src"), { recursive: true });
    expect(() => scanSpawnCaps(root, { trees: ["src"] })).toThrow(
      /no source module under/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("the scan refuses a named file that is not on disk", async () => {
  const root = await mkTempDir("flume-spawn-caps-gone-");
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(
      join(root, "src", "present.ts"),
      `export const nothing = 0;\n`,
      "utf8",
    );
    expect(() =>
      scanSpawnCaps(root, { trees: ["src"], files: [".flume/chain.ts"] }),
    ).toThrow(/no source module at \.flume\/chain\.ts/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * The home verdict's finding, over the same fixture and shown against the cap
 * verdict that passes the same site: the built-options case names its cap in
 * an options object built above the call and says nothing about its child's
 * stdin, which is the shape the two scans answer differently — and the shape
 * the field instance had, a declared shell gate under a declared cap whose
 * child sat on an open pipe for hours.
 */
it("a spawn home declaring its cap and not its stdin is a finding", () => {
  const CAPPED_OPEN = "src/builtOptions.ts";
  const stdin = scanSpawnStdin(fixtureRoot, FIXTURE_DOMAIN);

  expect(stdin.scanned.length).toBeGreaterThan(0);
  // The cap verdict reads this site and passes it, so the finding below is
  // the stdin question being asked rather than the cap question restated.
  expect(fixture.scanned.map((site) => site.module)).toContain(CAPPED_OPEN);
  expect(fixture.findings.map((site) => site.module)).not.toContain(
    CAPPED_OPEN,
  );
  expect(stdin.findings.map((site) => site.module)).toContain(CAPPED_OPEN);
  expect(stdin.findings.map(formatSpawnStdinSite).sort()).toEqual([
    ...OPEN_STDIN,
  ]);
});

/**
 * The two answers a home can give, each on a case built to give it, and the
 * two exclusions the verdict rests on. Without this the absence asserted over
 * the shipped trees below is green over a scan that reds everything it reads
 * (`.claude/rules/engineering.md`, *A green verdict is proven non-vacuous*).
 */
it("the home verdict reads an ended promise and a declared stdio as answers", () => {
  const stdin = scanSpawnStdin(fixtureRoot, FIXTURE_DOMAIN);
  const fateOf = (module: string): string | undefined =>
    stdin.scanned.find((site) => site.module === module)?.fate;

  expect(fateOf("src/ended.ts")).toBe("ended");
  expect(fateOf("src/piped.mjs")).toBe("closed");
  expect(fateOf("src/pipedStdin.ts")).toBe("open");

  // A call piping nothing opens no stdin, and a wrapper's call site is not a
  // home — each module is read, and holds a capturing name, so these are
  // exclusions rather than a domain that missed them.
  for (const module of ["src/probe.ts", "src/inherit.mjs", "src/consumer.ts"]) {
    expect(stdin.modules).toContain(module);
    expect(CASES[module]).toMatch(/exec|spawn|capture/);
    expect(fateOf(module)).toBeUndefined();
  }
});

// --- this repo's own spawns ---

it("every capturing spawn outside tests/ declares its output cap", () => {
  const scan = scanSpawnCaps();
  expect(scan.scanned.length).toBeGreaterThan(0);
  expectNoFindings(scan.findings.map(formatSpawnCapSite));
});

/**
 * The chain is a consumer like any other, and the one whose spawns run on
 * this machine every tick — but it holds no capturing call today, so the
 * verdict above says nothing about it either way. What is assertable is that
 * the domain reached it: a capturing spawn written into either file is judged
 * where it is written rather than never read.
 */
it("the spawn-cap scan judges this repo's own chain and declaration", () => {
  const scan = scanSpawnCaps();
  expect(scan.modules.length).toBeGreaterThan(0);
  expect(scan.modules).toContain(".flume/chain.ts");
  expect(scan.modules).toContain(".flume/declaration.ts");
});

/**
 * The wrapper verdict over the same domain, and the reason it is a scan of
 * its own rather than a reading of the cap verdict above: a wrapper declares
 * its cap at the module that builds it, so a second `promisify(execFile)`
 * written beside the homes passes the cap verdict at every call it makes —
 * each one naming a cap the wrapper's own construction never had. Three
 * modules under `src/` each carried one until 110d81a9, with this suite
 * green throughout, and a git spawner among them takes git's default
 * pathspec parse as well, which the dialect pin (`tests/git.test.ts`) reads
 * over `src/git.ts` alone.
 */
const wrappers = scanPromisifiedSpawns(
  REPO_ROOT,
  REPO_DOMAIN,
  SHIPPED_SPAWN_HOMES,
);

/** The home whose construction site the vacuity pin below is read off. */
const GIT_HOME = "src/git.ts";

// Vacuity pin (`.claude/rules/engineering.md`, "A green verdict is proven
// non-vacuous"): the verdict below is an absence, and a domain that walked no
// module, or a needle that stopped reading a `promisify` call, would report it
// exactly as a clean domain does. Pinned on a home's own construction line,
// the way the `tests/` arm's is (`tests/subprocessHelper.test.ts`).
it("the shipped-tree wrapper scan reads src/git.ts's own promisified spawn", () => {
  expect(SHIPPED_SPAWN_HOMES).toContain(GIT_HOME);
  expect(wrappers.modules.length).toBeGreaterThan(0);
  expect(wrappers.modules).toContain(GIT_HOME);
  expect(
    wrappers.scanned
      .filter((site) => site.module === GIT_HOME)
      .map((site) => site.api),
  ).toEqual(["execFile"]);
});

it("no module in the shipped trees promisifies a capturing spawn outside a declared home", () => {
  expectNoFindings(wrappers.findings.map(formatPromisifiedSpawnSite));
});

/**
 * The home verdict over this repo's own domain: every site that starts a
 * capturing child ends that child's stdin, by the ender on the promise or by
 * `stdio` where the API forwards one.
 *
 * The two engine doors are named rather than left to the absence: an absence
 * is how a domain that read neither door reports, and these two are the ones
 * every gate, runner operation and git read in this package goes through
 * (`endChildStdin`, `src/spawnShim.ts`). What they do with a real child is
 * driven in `tests/spawnStdin.test.ts`; this is the pin that keeps a third
 * door from being written without either.
 */
it("no spawn home in the shipped trees leaves its child's stdin open", () => {
  const stdin = scanSpawnStdin();
  const ended = stdin.scanned
    .filter((site) => site.fate === "ended")
    .map((site) => site.module);

  expect(stdin.modules.length).toBeGreaterThan(0);
  expect(stdin.scanned.length).toBeGreaterThan(0);
  expect(new Set(ended)).toEqual(new Set(SHIPPED_SPAWN_HOMES));
  expectNoFindings(stdin.findings.map(formatSpawnStdinSite));
});
