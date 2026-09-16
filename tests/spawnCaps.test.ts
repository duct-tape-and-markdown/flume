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
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, expect, it } from "vitest";

import {
  formatSpawnCapSite,
  scanSpawnCaps,
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
 * own; a `spawnSync` piping nothing; one piping and capping nothing; and a
 * streaming spawn, which has no cap to declare.
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
  "src/piped.mjs",
];

/** The modules whose capturing call names no cap. */
const CAPLESS: readonly string[] = [
  ".flume/chain.ts",
  "src/capless.ts",
  "src/consumer.ts",
  "src/piped.mjs",
];

let fixtureRoot = "";
let fixture: SpawnCapScan;

beforeAll(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), "flume-spawn-caps-"));
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
  const reported = [...new Set(fixture.findings.map((s) => s.module))].sort();
  expect(reported).toEqual([...CAPLESS]);
});

it("the scan judges a forwarder's callers and skips what captures nothing", () => {
  const judged = [...new Set(fixture.scanned.map((s) => s.module))].sort();
  expect(judged).toEqual([...JUDGED]);
});

it("the scan refuses a child_process import it cannot read", async () => {
  const root = await mkdtemp(join(tmpdir(), "flume-spawn-caps-opaque-"));
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
  const root = await mkdtemp(join(tmpdir(), "flume-spawn-caps-empty-"));
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
  const root = await mkdtemp(join(tmpdir(), "flume-spawn-caps-gone-"));
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

// --- this repo's own spawns ---

it("every capturing spawn outside tests/ declares its output cap", () => {
  const scan = scanSpawnCaps();
  expect(scan.scanned.length).toBeGreaterThan(0);
  expect(scan.findings.map(formatSpawnCapSite)).toEqual([]);
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
