import { existsSync, lstatSync, readdirSync } from "node:fs";
import { mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// Partial mock: everything passes through to the real tsImport except in the
// one test below that simulates tsx 4.23's ERR_MODULE_NOT_FOUND/namespace-
// query signature — a shape this installed tsx (4.21) never
// produces on its own, so it can only be exercised by injection.
vi.mock("tsx/esm/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("tsx/esm/api")>();
  return { ...actual, tsImport: vi.fn(actual.tsImport) };
});

import ts from "typescript";
import { tsImport } from "tsx/esm/api";
import {
  CjsContextLoadError,
  loadChainModule,
  type ChainModule,
} from "../src/chainLoad.ts";
import { Dispatcher, type DispatcherOptions } from "../src/Dispatcher.ts";
import { tickExitCode } from "../src/cliVerdict.ts";
import { EX_MOUNT_DEAD } from "../src/exitCodes.ts";
import { PendingParseFailure as realPendingParseFailure } from "../src/PendingSchema.ts";
import { entryClaimPath, entryClaimSlug } from "../src/entryClaims.ts";
import { entryDeclaredKey } from "../src/entryKey.ts";
import type { Logger } from "../src/log.ts";
import { readMergingMarkers } from "../src/mergingMarkers.ts";
import {
  writeTickVerdict,
  clearTickVerdict,
  readTickVerdict,
  readTickVerdicts,
  readLatestVerdictsSync,
  tickVerdictPath,
  tickVerdictsLogPath,
  gateFailureSignature,
  type TickVerdict,
} from "../src/tickVerdict.ts";
import { frictionCountLine } from "../src/friction.ts";
import {
  readWorktreeRegistry,
  stampWorktree,
  worktreeDirName,
} from "../src/worktrees.ts";
import {
  defaultStateRoot,
  mergingDir,
  slugify,
  worktreesBase,
} from "../src/paths.ts";
import {
  entryAttemptKey,
  priorAttemptPath,
  priorAttemptRef,
  priorAttemptsDir,
  type PriorAttemptRef,
} from "../src/priorAttempts.ts";
import type { Agent } from "../src/Agent.ts";
import { extractFinalMessage, withTerminalRenderer } from "../src/Agent.ts";
import { Baton } from "../src/Baton.ts";
import { superviseLoop } from "../src/loopSupervisor.ts";
import {
  chainLoadGate,
  // Identity pin: the engine's own gate object, compared by reference
  // against what a chain factory receives.
  tscGate as realTscGate,
} from "../src/builtinGates.ts";
import {
  buildFlumeApi,
  type FlumeApiPaths,
  type FlumePaths,
} from "../src/flumeApi.ts";
import type {
  Gate,
  GateContext,
  GatePhase,
  GateResult,
} from "../src/Gate.ts";
import type {
  Chain,
  Phase,
  ShipContext,
  TickContext,
  TickResult,
  WorktreeSetupContext,
} from "../src/Phase.ts";
import {
  entryFileName,
  parsePendingQueue,
  TAG_MAX_LENGTH,
  type PendingEntry,
} from "../src/PendingSchema.ts";
import { readQueueAtRef, readQueueOnDisk } from "../src/pendingLedger.ts";
import {
  InlineExecRenderError as realInlineExecRenderError,
  type PriorAttempt,
} from "../src/Prompt.ts";
import { loopExitCode } from "../src/cliVerdict.ts";
import * as git from "../src/git.ts";
import { parsePidClaim, renderPidClaim } from "../src/pidClaim.ts";
import { waitFor } from "./helpers/waitFor.ts";
// Barrel-export pin (.claude/rules/engineering.md "An export earns its
// consumer"): both types are field types on the already-public
// TickVerdict/TickOutcome, so a chain author needs to be able to name them from
// the package entry point. This import fails tsc if either drops from
// src/index.ts.
import type { ProvisionFailure, TerminalMisconfiguration } from "../src/index.ts";

// Barrel-export pin (.claude/rules/engineering.md "An export earns its
// consumer"): NoCommitMode is the field type of TickVerdict.noCommit /
// TickOutcome .noCommit / TickResult.noCommit, so a chain author needs to be
// able to name it from the package entry point. This import fails tsc if it
// drops from src/index.ts.
import type { NoCommitMode } from "../src/index.ts";

// Barrel-export pin (.claude/rules/engineering.md "An export earns its
// consumer"): PriorAttemptKeyspace is the field type of every PriorAttempt
// variant's .key, and QuarantinedTag the element type of
// TickResult.quarantinedTags, so a chain author needs to name both from the
// package entry point. These imports fail tsc if either drops from
// src/index.ts.
import type { PriorAttemptKeyspace, QuarantinedTag } from "../src/index.ts";

// Barrel-export pin (.claude/rules/engineering.md "An export earns its
// consumer"): EntryRefusalContext is what `Chain.refusesEntry` is handed, so a
// chain author declaring that predicate as a named function needs to name it
// from the package entry point. This import fails tsc if it drops from
// src/index.ts.
import type { EntryRefusalContext } from "../src/index.ts";

// Barrel-export pin (.claude/rules/engineering.md "An export earns its
// consumer"): slugify/priorAttemptPath are the chain-facing exported rule
// (spec/loop.md "Prior-outcome feedback to the retrying tick"), so a chain
// author needs to reach them from the package entry point, not just the module
// that defines each.
import {
  slugify as indexSlugify,
  priorAttemptPath as indexPriorAttemptPath,
} from "../src/index.ts";
import { deadPid } from "./helpers/deadPid.ts";
import { denyDirectory, denyFile } from "./helpers/denial.ts";
import {
  makeFixture,
  silent,
  verdictFixture,
  writeMinimalChain,
  type Fixture,
} from "./helpers/dispatcherFixture.ts";
import { mkTempDir } from "./helpers/fixtureRoot.ts";
import { SPAWN_BUDGET_MS, exec } from "./helpers/subprocess.ts";

// This file starts processes, so it declares the lane's one budget — cases
// and hooks alike — once here rather than inheriting the runner's default
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

/**
 * The ref one prior-attempt record is written under, derived through the
 * engine's own rule rather than a second spelling of it here: a singleton's
 * record is keyed by the phase name, a fanout entry's by its tag
 * (`src/priorAttempts.ts`, `priorAttemptRef`). Every path assertion below
 * composes one of these with `priorAttemptPath`, so a keying change lands in
 * one place on this side too.
 */
const phaseRef = (name: string): PriorAttemptRef =>
  priorAttemptRef({ name } as Phase);
const entryRef = (tag: string): PriorAttemptRef =>
  priorAttemptRef({ name: "build" } as Phase, { tag } as PendingEntry);

/**
 * Inject a fixed chain as the per-tick resolver — the `chainLoader` test
 * seam (DispatcherOptions no longer takes a prebuilt `Chain`). Returns the
 * same chain every tick unless the test mutates a closed-over reference.
 */
function staticLoader(chain: Chain): () => Promise<ChainModule> {
  return () => Promise.resolve({ chain });
}

// ---------- temp-repo fixture ----------

let fx: Fixture;

beforeEach(async () => {
  fx = await makeFixture();
});

afterEach(async () => {
  await fx.cleanup();
});

// ---------- helpers ----------

async function head(cwd: string): Promise<string> {
  const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd });
  return stdout.trim();
}

/**
 * Every path git registers as a worktree of the fixture repo, the primary
 * checkout aside, sorted — asked of the engine's own registry probe rather
 * than re-spelled here. Every worktree verdict in this file is exact
 * membership over this array: a second decoder beside
 * `readWorktreeRegistry` would judge the paths by a different reading of
 * git's output than the code it is ruling on
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*), and a
 * substring verdict over raw `worktree list` output is worse still — git
 * prints its paths with forward slashes on every platform, so a
 * `not.toContain(join(...))` needle is a string git never emits on win32
 * and the absence goes green over nothing
 * (`.claude/rules/engineering.md`, *A green verdict is proven
 * non-vacuous*). `resolve` folds git's spelling back to the host's, so
 * these paths compare against `join`-built ones on either platform.
 *
 * `read: false` throws rather than reading as an empty set: "the registry
 * could not be read" is not "git registers no worktree", and an absence
 * assertion handed the former would pass on a spawn that failed
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
async function registeredWorktrees(): Promise<string[]> {
  const registry = await readWorktreeRegistry(fx.repo);
  if (!registry.read) {
    throw new Error(`worktree registry unreadable: ${registry.reason}`);
  }
  return [...registry.worktrees.keys()]
    .filter((p) => p !== resolve(fx.repo))
    .sort();
}

async function writeAndCommit(
  cwd: string,
  rel: string,
  content: string,
  message: string,
): Promise<void> {
  const abs = join(cwd, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content);
  await exec("git", ["add", "--", rel], { cwd });
  await exec("git", ["commit", "-q", "-m", message], { cwd });
}

/** The queue directory these fixtures write, absolute. */
function queueDirOf(repo: string): string {
  return join(repo, ".flume", "plan", "pending");
}

/**
 * Write one entry file's raw content under the queue directory and commit it
 * — every strict read the dispatcher acts on resolves the committed `HEAD`
 * tip, never the working tree (spec/pending.md "Dispatch reads come from the
 * tip, not the tree"), so a fixture that only writes to disk is invisible to
 * it. Swallows exit `1` ("nothing to commit") for a caller that re-writes
 * byte-identical content — the established `isAncestor`/`getLocalConfig`
 * exit-code-as-data pattern (src/git.ts), not a text match on git's own
 * wording.
 */
async function commitEntryFile(
  repo: string,
  file: string,
  content: string,
): Promise<void> {
  const path = join(queueDirOf(repo), file);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  await exec("git", ["add", "--", `.flume/plan/pending/${file}`], { cwd: repo });
  try {
    await exec("git", ["commit", "-q", "-m", `test: pending/${file}`], {
      cwd: repo,
    });
  } catch (err) {
    if ((err as { code?: unknown }).code !== 1) throw err;
  }
}

/**
 * The whole queue as `entries` spells it: one `<tag>.json` per entry, every
 * other entry file removed, committed as one. The listing is the queue
 * (spec/pending.md, *The ledger is a directory — one entry per file*), so a
 * fixture that sets the queue sets the directory.
 */
async function writePending(
  repo: string,
  entries: PendingEntry[],
): Promise<void> {
  const dir = queueDirOf(repo);
  await mkdir(dir, { recursive: true });
  const wanted = new Set(entries.map((e) => entryFileName(e.tag)));
  for (const name of await readdir(dir)) {
    if (name.endsWith(".json") && !wanted.has(name)) {
      await rm(join(dir, name), { force: true });
    }
  }
  for (const entry of entries) {
    await writeFile(
      join(dir, entryFileName(entry.tag)),
      JSON.stringify(entry, null, 2) + "\n",
      "utf8",
    );
  }
  await exec("git", ["add", "-A", "--", ".flume/plan/pending"], { cwd: repo });
  try {
    await exec("git", ["commit", "-q", "-m", "test: pending queue"], {
      cwd: repo,
    });
  } catch (err) {
    if ((err as { code?: unknown }).code !== 1) throw err;
  }
}

function readPendingFromDisk(repo: string): PendingEntry[] {
  const files = readQueueOnDisk(queueDirOf(repo));
  const r = parsePendingQueue(files ?? []);
  if (!r.ok) throw new Error("the queue failed to parse");
  return r.entries;
}

/**
 * Every `<flumeDir>/merging/*.json` as it stands right now, name → contents
 * (spec/loop.md "Crash equals stop", "A merge the crash interrupted is
 * refused, never resumed").
 */
async function markersNow(repo: string): Promise<Map<string, unknown>> {
  const dir = join(repo, ".flume", "merging");
  const out = new Map<string, unknown>();
  if (!existsSync(dir)) return out;
  for (const name of (await readdir(dir)).sort()) {
    out.set(name, JSON.parse(await readFile(join(dir, name), "utf8")));
  }
  return out;
}

function makeEntry(tag: string, editPaths: string[]): PendingEntry {
  return {
    tag,
    gate: { kind: "open" },
    dependsOnForks: [],
    priority: 0,
    files: {
      new: [],
      edit: editPaths.map((p) => ({ path: p, description: "edit" })),
      retire: [],
    },
  };
}

function makePhase(overrides: Partial<Phase>): Phase {
  return {
    name: "plan",
    description: "test phase",
    promptPath: "prompt.md",
    concurrency: "singleton",
    writablePaths: ["**"],
    gates: [],
    handoff: () => [],
    ...overrides,
  };
}

function singleAgent(action: (cwd: string) => Promise<void>): Agent {
  return {
    name: "fake-singleton",
    async invoke(inv) {
      await action(inv.cwd);
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  };
}

/**
 * Fanout agent that dispatches to a per-worktree action by the cwd basename
 * (which equals `worktreeDirName(tag)` — the dispatcher's slug,
 * `tag.toLowerCase().replace(/[^a-z0-9-]+/g, "-")`, unchanged for a tag
 * short enough not to need its length bound).
 */
function fanoutAgent(
  bySlug: Record<string, (cwd: string) => Promise<void>>,
): Agent {
  return {
    name: "fake-fanout",
    async invoke(inv) {
      const slug = basename(inv.cwd);
      const action = bySlug[slug];
      if (!action) {
        throw new Error(`fanoutAgent: no action registered for slug '${slug}'`);
      }
      await action(inv.cwd);
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  };
}

/**
 * Fixture roots for a bare `loadChainModule` unit. The temp config dir is
 * standing in for a whole checkout, so all three roots are the same
 * directory — the load path only needs them to build the `FlumeApi` it hands
 * the factory, and these chains never read `api.paths`. The suite below
 * that *does* assert on `api.paths` drives the real Dispatcher instead.
 */
function chainPaths(cfg: string): FlumePaths {
  return { repoRoot: cfg, configDir: cfg, flumeDir: cfg };
}

// ---------- singleton ----------

describe("Dispatcher singleton — commit detected", () => {
  it("returns committed=true and the agent's new SHA, gates green", async () => {
    const preHead = await head(fx.repo);
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/plan-output.ts", "ok\n", "plan: derive");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.hibernated).toBe(false);
    expect(outcome.phaseName).toBe("plan");
    expect(outcome.result?.committed).toBe(true);
    expect(outcome.result?.commitSha).toBeDefined();
    expect(outcome.result?.commitSha).not.toBe(preHead);

    const trunkHead = await head(fx.repo);
    expect(outcome.result?.commitSha).toBe(trunkHead);
    expect(outcome.result?.gateResults.length).toBeGreaterThan(0);
    expect(outcome.result?.gateResults.every((g) => g.ok)).toBe(true);
    // writable-paths gate is auto-attached even when phase.gates is empty.
    expect(
      outcome.result?.gateResults.some((g) => g.gate === "writable-paths"),
    ).toBe(true);

    // A committed tick's verdict carries the same facts — no
    // interpretation, and `tags` is empty (a singleton phase has no entries).
    expect(outcome.verdict).toBeDefined();
    expect(outcome.verdict?.phaseName).toBe("plan");
    expect(outcome.verdict?.tags).toEqual([]);
    expect(outcome.verdict?.committed).toBe(true);
    expect(outcome.verdict?.noCommit).toBeUndefined();
    expect(outcome.verdict?.shippedTags).toEqual([]);
    // The phase's own single span — tagless (no entry to name), both shas
    // present so the commit is re-cherry-pickable from the verdict alone.
    expect(outcome.verdict?.mergeOutcomes).toEqual([
      {
        outcome: "merged",
        baseSha: expect.stringMatching(/^[0-9a-f]{40}$/),
        headSha: expect.stringMatching(/^[0-9a-f]{40}$/),
      },
    ]);
    expect(
      outcome.verdict?.gateResults.some((g) => g.gate === "writable-paths"),
    ).toBe(true);
  });

  it("reports committed=false (no commit) when the agent does nothing", async () => {
    const preHead = await head(fx.repo);
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    // Agent that never commits.
    const agent: Agent = {
      name: "noop",
      async invoke() {
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(false);
    expect(outcome.result?.commitSha).toBeUndefined();
    expect(await head(fx.repo)).toBe(preHead);
    expect(outcome.result?.gateResults).toEqual([]);
  });
});

// spec/worktrees.md "Singleton runs in a worktree": a singleton tick now
// provisions and runs in a `flume/<phase>` worktree, exactly the machinery a
// one-entry wave uses — provisioned before the agent runs, torn down
// (worktree + branch) after the merge step, regardless of outcome.
describe("Dispatcher singleton — runs in a flume/<phase> worktree (WORKTREE-CORE)", () => {
  async function branchIn(cwd: string): Promise<string> {
    const { stdout } = await exec(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd },
    );
    return stdout.trim();
  }

  it("agent runs on branch flume/<phase>, not the primary checkout; the branch is deleted and a tick's teardown leaves the repo's worktree registry holding only the primary checkout", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");
    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    let observedCwd: string | undefined;
    let observedBranch: string | undefined;
    let registeredMidTick: string[] | undefined;
    const agent = singleAgent(async (cwd) => {
      observedCwd = cwd;
      observedBranch = await branchIn(cwd);
      // The worktree exists, mid-tick, alongside the primary checkout —
      // registered with git, not merely a directory on disk, so the
      // teardown verdict below is the absence of something really there.
      registeredMidTick = await registeredWorktrees();
      expect(existsSync(join(fx.repo, ".flume", "worktrees", "plan"))).toBe(
        true,
      );
      await writeAndCommit(cwd, "src/plan-output.ts", "ok\n", "plan: derive");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    expect(observedCwd).not.toBe(fx.repo);
    expect(observedCwd).toContain(join(".flume", "worktrees", "plan"));
    expect(observedBranch).toBe("flume/plan");

    // Teardown left git's worktree registry and the branch list clean —
    // same one-`rm` promise a fanout wave's worktree gives. The registry
    // named exactly the tick's worktree mid-run, and names only the
    // primary checkout now.
    expect(registeredMidTick).toEqual([
      resolve(join(fx.repo, ".flume", "worktrees", "plan")),
    ]);
    expect(await registeredWorktrees()).toEqual([]);
    expect(existsSync(join(fx.repo, ".flume", "worktrees", "plan"))).toBe(
      false,
    );
    const { stdout: branches } = await exec(
      "git",
      ["branch", "--list", "flume/plan"],
      { cwd: fx.repo },
    );
    expect(branches.trim()).toBe("");
  });

  it("a singleton decline creates no worktree", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");
    // The two worktree hooks are the only witnesses a worktree ever
    // existed: teardown removes the directory and the branch, so a
    // post-tick `existsSync` cannot tell "never provisioned" from
    // "provisioned and cleaned up".
    let setupCalls = 0;
    let teardownCalls = 0;
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      shouldRun: () => false,
      setupWorktree: async () => {
        setupCalls++;
        return undefined;
      },
      teardownWorktree: async () => {
        teardownCalls++;
      },
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    let invoked = false;
    const agent: Agent = {
      name: "must-not-run",
      async invoke() {
        invoked = true;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(invoked).toBe(false);
    expect(outcome.declined).toBe(true);
    expect(setupCalls).toBe(0);
    expect(teardownCalls).toBe(0);
    expect(existsSync(join(fx.repo, ".flume", "worktrees", "plan"))).toBe(
      false,
    );
    const { stdout: branches } = await exec(
      "git",
      ["branch", "--list", "flume/plan"],
      { cwd: fx.repo },
    );
    expect(branches.trim()).toBe("");
  });

  it("an operator commit landing on trunk mid-tick is never touched — absorbed at merge like a wave's foreign commit, not soft-reset", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");
    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    let operatorSha = "";
    const agent = singleAgent(async (cwd) => {
      // The operator commits straight to the primary checkout while the
      // agent is mid-tick in its own worktree — legal at every moment of a
      // run now that the two never share a ref (spec/worktrees.md
      // "Singleton runs in a worktree").
      await writeAndCommit(
        fx.repo,
        "src/operator.ts",
        "operator\n",
        "operator: concurrent commit",
      );
      operatorSha = await head(fx.repo);
      await writeAndCommit(cwd, "src/plan-output.ts", "agent-work\n", "plan: derive");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    // The operator's commit was never reset — trunk still carries it, and
    // the agent's own commit cherry-picks cleanly on top of it.
    expect(outcome.result?.committed).toBe(true);
    expect(outcome.tipMoved).toBeUndefined();
    expect(outcome.noCommit).toBeUndefined();
    const { stdout: log } = await exec(
      "git",
      ["log", "--format=%H", "-n", "2"],
      { cwd: fx.repo },
    );
    const shas = log.trim().split("\n");
    expect(shas).toContain(operatorSha);
    expect(shas[shas.length - 1]).toBe(operatorSha);
    expect(existsSync(join(fx.repo, "src", "operator.ts"))).toBe(true);
    expect(await readFile(join(fx.repo, "src", "plan-output.ts"), "utf8")).toBe(
      "agent-work\n",
    );
  });

  it("invokes setupWorktree before the agent and teardownWorktree after the gates", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const order: string[] = [];
    const probe = (name: string, when: Gate["when"]): Gate => ({
      name,
      when,
      async run() {
        order.push(name);
        return { ok: true, message: `${name} ok` };
      },
    });
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [
        probe("probe-commit", "afterCommit"),
        probe("probe-merge", "afterMerge"),
      ],
      setupWorktree: async () => {
        order.push("setup");
        return undefined;
      },
      teardownWorktree: async () => {
        order.push("teardown");
      },
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = singleAgent(async (cwd) => {
      order.push("agent");
      await writeAndCommit(cwd, "src/plan-output.ts", "ok\n", "plan: derive");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    // The tick actually ran and gated — without this the ordering below
    // would hold vacuously over a tick that never reached the hooks.
    expect(outcome.result?.committed).toBe(true);
    expect(
      outcome.result?.gateResults
        .map((g) => g.gate)
        .filter((n) => n.startsWith("probe-")),
    ).toEqual(["probe-commit", "probe-merge"]);
    // Setup precedes the agent; teardown trails both gate stages, so a
    // hook releasing a resource cannot pull it out from under a gate.
    expect(order).toEqual([
      "setup",
      "agent",
      "probe-commit",
      "probe-merge",
      "teardown",
    ]);
  });

  it("the singleton hook's ctx.worktreeKey is the phase name and ctx.worktreePath is the provisioned worktree", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const setupCtxs: WorktreeSetupContext[] = [];
    const teardownCtxs: WorktreeSetupContext[] = [];
    let worktreeExistedAtSetup: boolean | undefined;
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      setupWorktree: async (ctx) => {
        setupCtxs.push(ctx);
        // Already provisioned: the hook can install into it.
        worktreeExistedAtSetup = existsSync(join(ctx.worktreePath, ".git"));
        return undefined;
      },
      teardownWorktree: async (ctx) => {
        teardownCtxs.push(ctx);
      },
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    let agentCwd: string | undefined;
    const agent = singleAgent(async (cwd) => {
      agentCwd = cwd;
      await writeAndCommit(cwd, "src/plan-output.ts", "ok\n", "plan: derive");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    // A singleton tick carries no entry, so the key is the phase name —
    // the same key `createWorktree` derived the directory and branch from.
    expect(setupCtxs).toHaveLength(1);
    expect(setupCtxs[0]!.worktreeKey).toBe("plan");
    expect(setupCtxs[0]!.repoRoot).toBe(fx.repo);
    expect(setupCtxs[0]!.worktreePath).toBe(agentCwd);
    expect(setupCtxs[0]!.worktreePath).toContain(
      join(".flume", "worktrees", "plan"),
    );
    expect(worktreeExistedAtSetup).toBe(true);
    // Teardown is handed the same key and path, so a hook pair can match
    // what it provisioned to what it releases.
    expect(teardownCtxs).toEqual(setupCtxs);
  });

  it("a singleton setupWorktree's extraEnv reaches the agent invocation", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      setupWorktree: async (ctx) => ({
        extraEnv: { WT_TAG: ctx.worktreeKey, WT_HANDLE: "singleton-handle" },
      }),
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    let seenExtraEnv: Record<string, string> | undefined;
    const agent: Agent = {
      name: "singleton-extraenv-capture",
      async invoke(inv) {
        seenExtraEnv = inv.extraEnv;
        await writeAndCommit(
          inv.cwd,
          "src/plan-output.ts",
          "ok\n",
          "plan: derive",
        );
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    // The invocation happened at all — without this the env assertion below
    // would pass over an agent that never ran.
    expect(outcome.result?.committed).toBe(true);
    // A singleton tick provisions one worktree and runs the hook against it,
    // exactly as a fanout wave does per entry, so the vars the hook returned
    // reach the agent process env instead of being dropped on the way.
    expect(seenExtraEnv).toEqual({
      WT_TAG: "plan",
      WT_HANDLE: "singleton-handle",
    });
  });
});

describe("Dispatcher singleton — afterCommit gate failure reverts the commit", () => {
  it("drops the agent's commit and reports the failing gate", async () => {
    const preHead = await head(fx.repo);
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const failingGate: Gate = {
      name: "intentional-fail",
      when: "afterCommit",
      async run() {
        return { ok: false, message: "boom", details: "stderr-context" };
      },
    };

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [failingGate],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/output.ts", "x\n", "plan: derive");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(false);
    expect(outcome.result?.commitSha).toBeUndefined();
    // Trunk is back to preHead — the commit was reverted.
    expect(await head(fx.repo)).toBe(preHead);
    // Working tree is clean (dropLastCommit was a hard reset).
    expect(existsSync(join(fx.repo, "src", "output.ts"))).toBe(false);

    const reported = outcome.result?.gateResults ?? [];
    expect(reported.length).toBe(1);
    expect(reported[0]).toMatchObject({
      gate: "intentional-fail",
      ok: false,
      message: "boom",
    });
    // Loop short-circuits on first failure — writable-paths never ran.
    expect(reported.some((g) => g.gate === "writable-paths")).toBe(false);

    // The verdict carries the same gate-revert facts, `details`
    // included verbatim — a chain reading history sees exactly what the
    // gate reported, not a re-derived summary.
    expect(outcome.verdict?.committed).toBe(false);
    expect(outcome.verdict?.noCommit).toBe("gate-revert");
    expect(outcome.verdict?.gateResults).toEqual([
      { gate: "intentional-fail", ok: false, message: "boom", details: "stderr-context" },
    ]);

    // Generalized past provisioning (spec/loop.md "Repeated identical
    // failures"): a gate-stage failure is recorded with a signature derived
    // from the gate's own name plus its failure output. A singleton phase has
    // no entry to blame, so `tag` is absent — this failure falls to the
    // consecutive-failure backstop alone, never the quarantine leg.
    expect(outcome.verdict?.gateFailures).toEqual([
      { signature: "intentional-fail: boom", message: "boom" },
    ]);
    expect(outcome.gateFailures).toEqual([
      { signature: "intentional-fail: boom", message: "boom" },
    ]);
  });
});

// ---------- GateResult.skipped → ReportedGateResult.skipped
// (GATE-RESULT-SKIPPED, spec/chain.md "What a gate returns") ----------

describe("ReportedGateResult.skipped — a verdict row states a green no judge earned", () => {
  it("a gate returning `skipped` lands its reason on the tick verdict's gate row unchanged", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const reason = "no TypeScript among the touched paths — judge not run";
    const skippingGate: Gate = {
      name: "vacuous-by-design",
      when: "afterCommit",
      async run() {
        return { ok: true, message: "type-check skipped", skipped: reason };
      },
    };

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [skippingGate],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async (cwd) => {
        await writeAndCommit(cwd, "docs/note.md", "x\n", "plan: derive");
      }),
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    const rows = outcome.verdict?.gateResults ?? [];
    // Vacuity pin: the gate loop really ran and really produced this row.
    expect(rows.length).toBeGreaterThan(0);
    const row = rows.find((g) => g.gate === "vacuous-by-design");
    expect(row).toEqual({
      gate: "vacuous-by-design",
      ok: true,
      message: "type-check skipped",
      skipped: reason,
    });
    // The whole point: the fact is readable as a field, not pattern-matched
    // out of `message`.
    expect(row?.skipped).toBe(reason);
  });

  it("a gate that returned `ok: true` without `skipped` leaves no `skipped` on its verdict row", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const ranGate: Gate = {
      name: "really-ran",
      when: "afterCommit",
      async run() {
        return { ok: true, message: "type-check clean" };
      },
    };

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [ranGate],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async (cwd) => {
        await writeAndCommit(cwd, "docs/note.md", "x\n", "plan: derive");
      }),
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    const rows = outcome.verdict?.gateResults ?? [];
    expect(rows.length).toBeGreaterThan(0);
    const row = rows.find((g) => g.gate === "really-ran");
    expect(row).toEqual({ gate: "really-ran", ok: true, message: "type-check clean" });
    expect(row).not.toHaveProperty("skipped");
    // The auto-attached writable-paths gate ran too, and claims it ran.
    const auto = rows.find((g) => g.gate === "writable-paths");
    expect(auto).toBeDefined();
    expect(auto).not.toHaveProperty("skipped");
  });
});

// ---------- GateResult.verdict → ReportedGateResult.verdict + the
// gate-revert record (GATE-VERDICT-FIELD, spec/chain.md "What a gate
// returns") ----------

describe("ReportedGateResult.verdict — a chain's own reason, carried not re-parsed", () => {
  it("a gate's verdict lands on the tick verdict's gate row verbatim", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const greenVerdict = "every-cite-resolved";
    const redVerdict = "cite-unresolved";
    const prose = "2 of 3 cites unresolved: §Fences, §Baton";

    // Two gates, both authoring a verdict: the passing one proves the field
    // is not a failure-only channel, the failing one is the acceptance case
    // (a chain reading *why* a gate refused). Order matters — the loop stops
    // at the first refusal.
    const gates: Gate[] = [
      {
        name: "cites-parse",
        when: "afterCommit",
        async run() {
          return { ok: true, message: "3 cites parsed", verdict: greenVerdict };
        },
      },
      {
        name: "cites-resolve",
        when: "afterCommit",
        async run() {
          return {
            ok: false,
            message: prose,
            verdict: redVerdict,
            details: "spec/chain.md: no section named 'Fences'",
          };
        },
      },
    ];

    const phase = makePhase({ name: "plan", concurrency: "singleton", gates });
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async (cwd) => {
        await writeAndCommit(cwd, "docs/note.md", "x\n", "plan: derive");
      }),
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.verdict?.noCommit).toBe("gate-revert");
    const rows = outcome.verdict?.gateResults ?? [];
    // Vacuity pin: the gate loop really ran and really produced both rows.
    expect(rows.map((g) => g.gate)).toEqual(["cites-parse", "cites-resolve"]);
    expect(rows.find((g) => g.gate === "cites-parse")).toEqual({
      gate: "cites-parse",
      ok: true,
      message: "3 cites parsed",
      verdict: greenVerdict,
    });
    expect(rows.find((g) => g.gate === "cites-resolve")).toEqual({
      gate: "cites-resolve",
      ok: false,
      message: prose,
      details: "spec/chain.md: no section named 'Fences'",
      verdict: redVerdict,
    });

    // Persisted, not merely in-memory: the real writer's output through the
    // real artifact (`.claude/rules/engineering.md`, "A seam gate reads what
    // the real writer wrote") — this is the surface a later tick reads.
    const flumeDir = join(fx.repo, ".flume");
    await writeTickVerdict(flumeDir, outcome.verdict!);
    const onDisk = JSON.parse(
      await readFile(
        tickVerdictPath(flumeDir, outcome.verdict!.phaseName),
        "utf8",
      ),
    ) as TickVerdict;
    expect(
      onDisk.gateResults.map((g) => [g.gate, g.verdict]),
    ).toEqual([
      ["cites-parse", greenVerdict],
      ["cites-resolve", redVerdict],
    ]);

    // The acceptance's second half: the same reason reaches the retry through
    // the gate-revert record, beside `message` rather than inside it.
    const record = JSON.parse(
      await readFile(priorAttemptPath(flumeDir, phaseRef("plan")), "utf8"),
    ) as PriorAttempt;
    expect(record.mode).toBe("gate-revert");
    expect(record).toMatchObject({
      gate: "cites-resolve",
      message: prose,
      verdict: redVerdict,
    });
  });

  it("a gate that returned no verdict leaves no verdict on its tick verdict row", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const quietGate: Gate = {
      name: "states-no-reason",
      when: "afterCommit",
      async run() {
        return { ok: true, message: "clean" };
      },
    };

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [quietGate],
    });
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async (cwd) => {
        await writeAndCommit(cwd, "docs/note.md", "x\n", "plan: derive");
      }),
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    const rows = outcome.verdict?.gateResults ?? [];
    expect(rows.length).toBeGreaterThan(0);
    // Absence is a fact, not an empty string standing in for one — on the
    // chain's own gate and on the auto-attached builtin alike.
    for (const row of rows) expect(row).not.toHaveProperty("verdict");
  });
});

// ---------- the reported gate-result row reaches the hooks
// (HOOK-GATE-RESULTS-CARRY-WHAT-THE-ENGINE-HANDS-OUT, spec/chain.md "What a
// hook receives") ----------

describe("hook-side gate results — the reported row, not a narrowed copy", () => {
  it("a handoff's gate results carry a failing gate's details", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const detail = "docs/note.md, docs/other.md";
    const failing: Gate = {
      name: "writable-paths-mirror",
      when: "afterCommit",
      async run() {
        return { ok: false, message: "2 paths outside the fence", details: detail };
      },
    };

    let seen: TickResult["gateResults"] | undefined;
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [failing],
      handoff: (r) => {
        seen = r.gateResults;
        return [];
      },
    });
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async (cwd) => {
        await writeAndCommit(cwd, "docs/note.md", "x\n", "plan: derive");
      }),
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.verdict?.noCommit).toBe("gate-revert");
    // Vacuity pin: handoff really ran and really saw the gate loop's rows.
    expect(seen).toBeDefined();
    expect(seen!.length).toBeGreaterThan(0);
    const row = seen!.find((g) => g.gate === "writable-paths-mirror");
    expect(row).toEqual({
      gate: "writable-paths-mirror",
      ok: false,
      message: "2 paths outside the fence",
      details: detail,
    });
    // The point of the row: the evidence is a field, not something a chain
    // re-derives by splitting `message`.
    expect(row?.details).toBe(detail);
  });

  it("a handoff's gate results carry the gate's own verdict", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const greenVerdict = "every-cite-resolved";
    const gate: Gate = {
      name: "cites-parse",
      when: "afterCommit",
      async run() {
        return { ok: true, message: "3 cites parsed", verdict: greenVerdict };
      },
    };

    let seen: TickResult["gateResults"] | undefined;
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [gate],
      handoff: (r) => {
        seen = r.gateResults;
        return [];
      },
    });
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async (cwd) => {
        await writeAndCommit(cwd, "docs/note.md", "x\n", "plan: derive");
      }),
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    expect(seen).toBeDefined();
    expect(seen!.length).toBeGreaterThan(0);
    expect(seen!.find((g) => g.gate === "cites-parse")).toEqual({
      gate: "cites-parse",
      ok: true,
      message: "3 cites parsed",
      verdict: greenVerdict,
    });
    // A gate that authored none leaves the field absent — the auto-attached
    // builtin ran on this same tick and says so.
    const auto = seen!.find((g) => g.gate === "writable-paths");
    expect(auto).toBeDefined();
    expect(auto).not.toHaveProperty("verdict");
  });

  it("a handoff's gate results carry a skipped gate's reason", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const reason = "no TypeScript among the touched paths — judge not run";
    const gate: Gate = {
      name: "vacuous-by-design",
      when: "afterCommit",
      async run() {
        return { ok: true, message: "type-check skipped", skipped: reason };
      },
    };

    let seen: TickResult["gateResults"] | undefined;
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [gate],
      handoff: (r) => {
        seen = r.gateResults;
        return [];
      },
    });
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async (cwd) => {
        await writeAndCommit(cwd, "docs/note.md", "x\n", "plan: derive");
      }),
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    expect(seen).toBeDefined();
    expect(seen!.length).toBeGreaterThan(0);
    expect(seen!.find((g) => g.gate === "vacuous-by-design")).toEqual({
      gate: "vacuous-by-design",
      ok: true,
      message: "type-check skipped",
      skipped: reason,
    });
    // A green a judge did earn is told apart from this one by the field, not
    // by reading `message`.
    const auto = seen!.find((g) => g.gate === "writable-paths");
    expect(auto).toBeDefined();
    expect(auto).not.toHaveProperty("skipped");
  });

  it("a shipped predicate's gate results carry details, verdict and skipped", async () => {
    await writePending(fx.repo, [makeEntry("ROW-RIDES", ["src/row-rides.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const reason = "nothing merged that this judge reads";
    const detail = "src/row-rides.ts:1 — advisory only";
    const talkative: Gate = {
      name: "talkative",
      when: "afterMerge",
      async run() {
        return {
          ok: true,
          message: "merged tree inspected",
          details: detail,
          verdict: "advisory-clean",
          skipped: reason,
        };
      },
    };

    let seen: ShipContext["gateResults"] | undefined;
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [talkative],
      shipped: (ctx) => {
        seen = ctx.gateResults;
        return true;
      },
    });
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({
        "row-rides": async (cwd) => {
          await writeAndCommit(cwd, "src/row-rides.ts", "x\n", "build(ROW-RIDES)");
        },
      }),
      log: silent,
      maxParallel: 1,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual(["ROW-RIDES"]);
    // Vacuity pin: the predicate really ran and really saw this entry's rows.
    expect(seen).toBeDefined();
    expect(seen!.length).toBeGreaterThan(0);
    const row = seen!.find((g) => g.gate === "talkative");
    expect(row).toEqual({
      gate: "talkative",
      ok: true,
      message: "merged tree inspected",
      details: detail,
      verdict: "advisory-clean",
      skipped: reason,
    });
    // All three reachable as fields — `shipped` is the seam most tempted to
    // pattern-match, since it is the one deciding whether the entry leaves
    // the queue.
    expect(row?.details).toBe(detail);
    expect(row?.verdict).toBe("advisory-clean");
    expect(row?.skipped).toBe(reason);
  });
});

// ---------- ShipContext's key set (spec/pending.md "Ship detection trusts
// the agent's own account") ----------

describe("ShipContext — the facts the engine hands the ship predicate, and no more", () => {
  it("ShipContext carries no field holding the agent's final message or termination", async () => {
    await writePending(fx.repo, [makeEntry("SAYS-SO", ["src/says-so.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    // The agent closes with an account of its own — the one thing the
    // predicate must not be able to read, since "nothing is inferred ... not
    // from the agent's output stream" is what the seam rests on.
    const account = "Parked: the entry's premise is contradicted by the tree.";
    let agentSaid: string | undefined;
    const talkative: Agent = {
      name: "fake-fanout-with-an-account",
      async invoke(inv) {
        await writeAndCommit(inv.cwd, "src/says-so.ts", "x\n", "build(SAYS-SO)");
        agentSaid = account;
        return { exitCode: 0, stdout: account, stderr: "", finalMessage: account };
      },
    };

    let seenKeys: string[] | undefined;
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      shipped: (ctx) => {
        seenKeys = Object.keys(ctx).sort();
        return true;
      },
    });
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: talkative,
      log: silent,
      maxParallel: 1,
    });

    const outcome = await dispatcher.tick();

    // Vacuity pins: the agent really ran and really closed with prose, and
    // the predicate really was handed a landed commit to classify.
    expect(agentSaid).toBe(account);
    expect(outcome.result?.shippedTags).toEqual(["SAYS-SO"]);
    expect(seenKeys).toBeDefined();
    // Exhaustive rather than a spot check: naming the whole key set is what
    // makes this decidable — a `finalMessage` or `termination` field added
    // to the shape cannot reach the predicate without reddening this line.
    expect(seenKeys).toEqual([
      "baseSha",
      "entry",
      "gateResults",
      "mergedSha",
      "repoRoot",
      "touchedPaths",
      "worktreePath",
    ]);
  });
});

// ---------- GateResult.failingFiles → ReportedGateResult.failingFiles
// (VERDICT-GATE-ROW-CARRIES-THE-GATES-FAILING-FILES, spec/loop.md "The tick
// verdict — one facts artifact") ----------

describe("ReportedGateResult.failingFiles — what the gate blamed, reported not rebuilt", () => {
  it("a gate's failingFiles ride the reported gate result", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    // Disjoint from what the commit touches, so the engine's own
    // suspect-flake derivation fires off the same list — the fact is one the
    // engine already decoded, and the row is where a chain reads it instead
    // of re-parsing the gate's output beside it.
    const blamed = ["tests/unrelated.test.ts", "tests/also-unrelated.test.ts"];
    const failing: Gate = {
      name: "suite",
      when: "afterCommit",
      async run() {
        return {
          ok: false,
          message: "2 failing files",
          details: blamed.join("\n"),
          verdict: "suite-red",
          failingFiles: blamed,
        };
      },
    };

    let seen: TickResult["gateResults"] | undefined;
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [failing],
      handoff: (r) => {
        seen = r.gateResults;
        return [];
      },
    });
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async (cwd) => {
        await writeAndCommit(cwd, "docs/note.md", "x\n", "plan: derive");
      }),
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.verdict?.noCommit).toBe("gate-revert");
    const rows = outcome.verdict?.gateResults ?? [];
    // Vacuity pin: the gate loop really ran and really produced this row.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.find((g) => g.gate === "suite")).toEqual({
      gate: "suite",
      ok: false,
      message: "2 failing files",
      details: blamed.join("\n"),
      verdict: "suite-red",
      failingFiles: blamed,
    });

    // The handoff surface carries the same row — one builder, so a field
    // cannot reach the verdict and be dropped on the way to a hook.
    expect(seen).toBeDefined();
    expect(seen!.length).toBeGreaterThan(0);
    expect(seen!.find((g) => g.gate === "suite")?.failingFiles).toEqual(blamed);

    // Persisted, not merely in-memory: the real writer's output through the
    // real artifact (`.claude/rules/engineering.md`, "A seam gate reads what
    // the real writer wrote").
    const flumeDir = join(fx.repo, ".flume");
    await writeTickVerdict(flumeDir, outcome.verdict!);
    const onDisk = JSON.parse(
      await readFile(
        tickVerdictPath(flumeDir, outcome.verdict!.phaseName),
        "utf8",
      ),
    ) as TickVerdict;
    expect(onDisk.gateResults.find((g) => g.gate === "suite")?.failingFiles).toEqual(
      blamed,
    );

    // The same list rides the prior-attempt record too, verbatim and
    // uninterpreted: the row is an additional reader of the fact, never a
    // replacement for it.
    const record = JSON.parse(
      await readFile(priorAttemptPath(flumeDir, phaseRef("plan")), "utf8"),
    ) as PriorAttempt;
    expect(record).toMatchObject({
      mode: "gate-revert",
      gate: "suite",
      failingFiles: blamed,
    });
  });

  it("a gate that named no failingFiles leaves the field absent on its row", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const quiet: Gate = {
      name: "unattributed",
      when: "afterCommit",
      async run() {
        return { ok: false, message: "something broke" };
      },
    };

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [quiet],
    });
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async (cwd) => {
        await writeAndCommit(cwd, "docs/note.md", "x\n", "plan: derive");
      }),
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.verdict?.noCommit).toBe("gate-revert");
    const rows = outcome.verdict?.gateResults ?? [];
    expect(rows.length).toBeGreaterThan(0);
    // Absence is a fact: no attribution, no empty list standing in for one.
    for (const row of rows) expect(row).not.toHaveProperty("failingFiles");
  });
});

/**
 * spec/loop.md "Baton — presence wakes, absence hibernates": the flag is a
 * queue of depth one. A tick reads its phase's token at the start and sleeps
 * only while that token still stands, so a sibling's wake landing while the
 * agent runs is a run this phase still owes rather than a level this tick
 * clears on its way to handoff.
 */
describe("Dispatcher singleton — the post-work sleep is scoped to the token the tick read", () => {
  it("a wake landing mid-tick survives that tick's own sleep", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");
    const startToken = baton.token("plan");

    // An empty handoff: nothing this tick decides wakes anything, so the only
    // flag standing afterwards is the one the mid-tick wake left.
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      handoff: () => [],
    });

    let tokenDuringTick: string | undefined;
    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/derived.ts", "y\n", "plan: derive");
      // A sibling waking this phase while it runs — its own Baton over the
      // same disk, which is the only channel two ticks share.
      new Baton(join(fx.repo, ".flume")).wake("plan");
      tokenDuringTick = baton.token("plan");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    // Vacuity pins: the tick really read a token, and the mid-tick wake
    // really left a different one. Without both, "still awake" below could
    // pass over a tick that never slept anything.
    expect(startToken).toBeTypeOf("string");
    expect(tokenDuringTick).toBeTypeOf("string");
    expect(tokenDuringTick).not.toBe(startToken);

    // The work still landed — the kept wake is a queued re-run, not a
    // refusal of this tick.
    expect(outcome.result?.committed).toBe(true);
    expect(baton.isAwake("plan")).toBe(true);
    expect(outcome.awakeAfter).toEqual(["plan"]);
    // And what stands is the sibling's own token, untouched: the sleep
    // declined rather than clearing and re-waking.
    expect(baton.token("plan")).toBe(tokenDuringTick);
  });

  it("a tick sleeps its phase when the flag still carries the token it read at start", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");
    const startToken = baton.token("plan");

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      handoff: () => [],
    });

    // Nothing wakes this phase mid-tick, so the token standing at the sleep
    // is the one the tick read. Captured rather than asserted in the agent:
    // a throw inside the invocation is a failed tick, not a failed assertion.
    let tokenDuringTick: string | undefined;
    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/derived.ts", "y\n", "plan: derive");
      tokenDuringTick = baton.token("plan");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    // Vacuity pin: a flag really stood, really carried a token, and it was
    // still that token when the tick's work finished.
    expect(startToken).toBeTypeOf("string");
    expect(tokenDuringTick).toBe(startToken);

    expect(outcome.result?.committed).toBe(true);
    expect(baton.isAwake("plan")).toBe(false);
    expect(baton.token("plan")).toBeUndefined();
    expect(outcome.awakeAfter).toEqual([]);
  });
});

describe("Dispatcher singleton — handoff wakes the successor", () => {
  it("sleeps the running phase and wakes only the named successor", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      handoff: (r) => (r.committed ? ["build"] : []),
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/derived.ts", "y\n", "plan: derive");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    expect(baton.awake()).toEqual(["plan"]);
    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    expect(outcome.awakeAfter).toEqual(["build"]);
    expect(baton.isAwake("plan")).toBe(false);
    expect(baton.isAwake("build")).toBe(true);
  });

  it("respects chain.humanOnly — does not wake handoff targets on the list", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "singleton",
      handoff: () => ["spec", "plan"],
    });
    const chain: Chain = { phases: [phase], humanOnly: ["spec"] };

    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/done.ts", "z\n", "build: do");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.awakeAfter).toEqual(["plan"]);
    expect(baton.isAwake("spec")).toBe(false);
    expect(baton.isAwake("plan")).toBe(true);
    expect(baton.isAwake("build")).toBe(false);
  });

  it("hibernates when no phases are awake", async () => {
    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async () => {}),
      log: silent,
    });

    const outcome = await dispatcher.tick();
    expect(outcome.hibernated).toBe(true);
    expect(outcome.phaseName).toBeUndefined();
    expect(outcome.terminal).toBeUndefined();
    expect(outcome.awakeAfter).toEqual([]);
  });
});

// ---------- Axis-C terminal misconfiguration ----------

describe("Dispatcher — orphaned awake flags → Axis-C terminal", () => {
  it("returns terminal.kind='orphaned-awake' naming the phases, leaves the flags on disk, runs no agent", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("ghost");
    baton.wake("wraith");

    // The chain declares only "plan" — neither awake flag matches.
    const phase = makePhase({ name: "plan" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    let invoked = false;
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async () => {
        invoked = true;
      }),
      log: silent,
    });

    const outcome = await dispatcher.tick();

    // Axis C, not Axis B (hibernated) and not Axis A (noCommit): no agent
    // ran, nothing exists to retry.
    expect(outcome.terminal).toEqual({
      kind: "orphaned-awake",
      phases: ["ghost", "wraith"],
    });
    expect(outcome.hibernated).toBe(false);
    expect(outcome.failed).toBeUndefined();
    expect(outcome.noCommit).toBeUndefined();
    expect(invoked).toBe(false);
    expect(outcome.summary).toMatch(/ghost, wraith/);

    // Silent-ack anti-pattern guard: the flags must survive the tick.
    expect(baton.isAwake("ghost")).toBe(true);
    expect(baton.isAwake("wraith")).toBe(true);
    expect(outcome.awakeAfter).toEqual(["ghost", "wraith"]);
  });

  it("a declared awake phase still runs when an orphaned flag rides alongside it", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");
    baton.wake("ghost");

    const phase = makePhase({ name: "plan" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async () => {}),
      log: silent,
    });

    const outcome = await dispatcher.tick();

    // Terminal fires only when *every* awake flag is orphaned; a runnable
    // phase runs and the stray flag persists for the next tick to classify.
    expect(outcome.terminal).toBeUndefined();
    expect(outcome.phaseName).toBe("plan");
    expect(baton.isAwake("ghost")).toBe(true);
  });
});

// ---------- fanout ----------

describe("Dispatcher fanout — two disjoint entries both ship", () => {
  it("cherry-picks both worktree commits onto trunk, drains the queue, sets shippedTags", async () => {
    const entries = [
      makeEntry("TEST-A", ["src/a.ts"]),
      makeEntry("TEST-B", ["src/b.ts"]),
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const preHead = await head(fx.repo);

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "test-a": (cwd) =>
        writeAndCommit(cwd, "src/a.ts", "from-A\n", "build(TEST-A): ship"),
      "test-b": (cwd) =>
        writeAndCommit(cwd, "src/b.ts", "from-B\n", "build(TEST-B): ship"),
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    expect(outcome.result?.shippedTags).toEqual(["TEST-A", "TEST-B"]);

    // Trunk advanced past preHead — two cherry-picks + chore commit.
    const trunkHead = await head(fx.repo);
    expect(trunkHead).not.toBe(preHead);

    // Both target files were written into trunk by the cherry-picks.
    expect(await readFile(join(fx.repo, "src/a.ts"), "utf8")).toBe("from-A\n");
    expect(await readFile(join(fx.repo, "src/b.ts"), "utf8")).toBe("from-B\n");

    // The queue on disk is empty (both entries shipped).
    expect(readPendingFromDisk(fx.repo)).toEqual([]);
    expect(outcome.result?.pendingAfter).toEqual([]);

    // Worktree dirs were cleaned up.
    expect(existsSync(join(fx.repo, ".flume", "worktrees", "test-a"))).toBe(
      false,
    );
    expect(existsSync(join(fx.repo, ".flume", "worktrees", "test-b"))).toBe(
      false,
    );
  });
});

/**
 * The ship's own footprint on the queue directory (`spec/pending.md`, *The
 * ledger is a directory — one entry per file*): `git rm` of exactly what
 * shipped, and every other file in the directory left byte-identical.
 *
 * That last half is what makes two producers' commits merge at all, and it is
 * the half a whole-array rewrite could never have. It is asserted over both
 * kinds of bystander the directory can hold: a sibling entry the wave did not
 * pick, and a sidecar that is not an entry at all.
 */
describe("Dispatcher fanout — the ship removes the shipped entries' files alone", () => {
  it("a ship removes exactly the shipped entries' files and edits no other entry", async () => {
    const shipped = makeEntry("SHIPS-ONE", ["src/one.ts"]);
    const bystander: PendingEntry = {
      ...makeEntry("STAYS-PUT", ["src/two.ts"]),
      gate: { kind: "parked", reason: "not this wave" },
    };
    await writePending(fx.repo, [shipped, bystander]);

    // A sidecar beside the entries — not a `*.json`, so the engine never
    // reads it as work, and the ship must not touch it either.
    const queueDir = queueDirOf(fx.repo);
    const sidecar = join(queueDir, "NOTES.md");
    await writeFile(sidecar, "a chain's own note\n", "utf8");
    await exec("git", ["add", "--", relative(fx.repo, sidecar)], {
      cwd: fx.repo,
    });
    await exec("git", ["commit", "-q", "-m", "test: a sidecar"], {
      cwd: fx.repo,
    });

    // The bytes each bystander carries going in — the ship is judged against
    // these rather than against a re-serialization the tester chose.
    const bystanderPath = join(queueDir, entryFileName(bystander.tag));
    const bystanderBefore = await readFile(bystanderPath, "utf8");
    const sidecarBefore = await readFile(sidecar, "utf8");
    // Non-vacuity: both entry files really are on disk before the wave, so an
    // absent one below is a removal rather than a fixture that never wrote it.
    expect(
      existsSync(join(queueDir, entryFileName(shipped.tag))),
    ).toBe(true);

    new Baton(join(fx.repo, ".flume")).wake("build");
    const outcome = await new Dispatcher({
      chainLoader: staticLoader({
        phases: [makePhase({ name: "build", concurrency: "fanout", gates: [] })],
        humanOnly: [],
      }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({
        "ships-one": (cwd) =>
          writeAndCommit(cwd, "src/one.ts", "one\n", "build(SHIPS-ONE): ship"),
      }),
      log: silent,
    }).tick();

    expect(outcome.result?.shippedTags).toEqual([shipped.tag]);

    // Exactly the shipped entry's file is gone.
    expect(existsSync(join(queueDir, entryFileName(shipped.tag)))).toBe(false);

    // And nothing else in the directory moved — byte-identical, not merely
    // still parsing to the same entry.
    expect(await readFile(bystanderPath, "utf8")).toBe(bystanderBefore);
    expect(await readFile(sidecar, "utf8")).toBe(sidecarBefore);

    // The removal is committed, not just on disk: the ledger commit names the
    // shipped entry's file and no other path under the directory.
    const touched = await git.diffNameOnly(
      fx.repo,
      `${await head(fx.repo)}^`,
      await head(fx.repo),
    );
    const queueRel = relative(fx.repo, queueDir).split(/[\\/]/).join("/");
    expect(touched.filter((p) => p.startsWith(`${queueRel}/`))).toEqual([
      `${queueRel}/${entryFileName(shipped.tag)}`,
    ]);
  });
});

/**
 * AGENT-INVOCATION-CARRIES-ENTRY-TAG — the entry tag reaches the agent seam.
 * A decorator (`withTerminalRenderer`, a chain's own metrics wrapper) is
 * composed from a `Phase.agent` getter that holds no `TickContext`, so
 * `AgentInvocation` is the only surface it can read the running entry off.
 * Without the field the tag is recoverable only by regexing the rendered
 * prompt the harness authored — a chain restating a fact the engine holds
 * (`.claude/rules/engineering.md`, "A fact the engine holds is reported").
 */
describe("Dispatcher — the agent invocation states which entry it is running", () => {
  it("a fanout agent invocation carries the provisioned entry's tag", async () => {
    const entries = [
      makeEntry("TAG-CARRY-A", ["src/a.ts"]),
      makeEntry("TAG-CARRY-B", ["src/b.ts"]),
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    // Keyed by the worktree slug, which is derived from the tag by a rule
    // this field exists to replace — so a field wired to the wrong entry
    // shows up as a slug/tag mismatch rather than passing on a bare count.
    const seenTagBySlug: Record<string, string | undefined> = {};
    const agent: Agent = {
      name: "entry-tag-capture",
      async invoke(inv) {
        const slug = basename(inv.cwd);
        seenTagBySlug[slug] = inv.entryTag;
        await writeAndCommit(
          inv.cwd,
          slug === "tag-carry-a" ? "src/a.ts" : "src/b.ts",
          `${slug}\n`,
          `build(${inv.entryTag}): ship`,
        );
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    // Vacuity pin: both entries reached `agent.invoke` at all, so the tag
    // assertions below cannot pass over a wave that never ran.
    expect(Object.keys(seenTagBySlug).sort()).toEqual([
      "tag-carry-a",
      "tag-carry-b",
    ]);
    expect(seenTagBySlug["tag-carry-a"]).toBe("TAG-CARRY-A");
    expect(seenTagBySlug["tag-carry-b"]).toBe("TAG-CARRY-B");
    expect(outcome.result?.shippedTags?.slice().sort()).toEqual([
      "TAG-CARRY-A",
      "TAG-CARRY-B",
    ]);
  });

  it("a singleton agent invocation carries no entry tag", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    let invoked = false;
    let seenEntryTag: string | undefined;
    let seenKeys: string[] = [];
    const agent: Agent = {
      name: "singleton-entry-tag-capture",
      async invoke(inv) {
        invoked = true;
        seenEntryTag = inv.entryTag;
        seenKeys = Object.keys(inv);
        await writeAndCommit(
          inv.cwd,
          "src/plan-output.ts",
          "ok\n",
          "plan: derive",
        );
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    // Vacuity pin: the agent ran, so the absence below is the dispatcher's
    // choice and not an invocation that never happened.
    expect(invoked).toBe(true);
    expect(outcome.result?.committed).toBe(true);
    // A singleton tick provisions no entry, so there is no tag to state —
    // absent rather than the phase name the worktree key falls back to
    // (`WorktreeSetupContext.worktreeKey`), the same rule the verdict's
    // `TickVerdictInvocation.entryTag` row follows.
    expect(seenEntryTag).toBeUndefined();
    expect(seenKeys).not.toContain("entryTag");
  });
});

describe("Dispatcher — Chain.pendingDir (CHAIN-PENDINGPATH, spec/pending.md 'The pending queue')", () => {
  /**
   * Commits one entry file under an arbitrary flumeDir-relative queue
   * directory — the same tip-committing shape `commitEntryFile` gives the
   * default `plan/pending` location, generalized so a declared
   * `Chain.pendingDir` has something to resolve against.
   */
  async function commitEntryFileAt(
    repo: string,
    dirRel: string,
    entry: PendingEntry,
  ): Promise<void> {
    const rel = join(dirRel, entryFileName(entry.tag));
    const path = join(repo, ".flume", rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(entry, null, 2) + "\n", "utf8");
    await exec("git", ["add", "--", join(".flume", rel)], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", "test: a queue entry"], {
      cwd: repo,
    });
  }

  it("a chain-declared pendingDir is honored by fanout selection, the wave-end rewrite, and a gate reading ctx.pendingDir", async () => {
    const customRel = join("custom", "queue");
    await commitEntryFileAt(
      fx.repo,
      customRel,
      makeEntry("CUSTOM-PATH", ["src/custom.ts"]),
    );
    new Baton(join(fx.repo, ".flume")).wake("build");

    let capturedPendingDir: string | undefined;
    const capturingGate: Gate = {
      name: "capture-pendingpath",
      when: "afterCommit",
      run(ctx) {
        capturedPendingDir = ctx.pendingDir;
        return Promise.resolve({ ok: true, message: "captured" });
      },
    };

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [capturingGate],
    });
    const chain: Chain = {
      phases: [phase],
      humanOnly: [],
      pendingDir: customRel,
    };

    const agent = fanoutAgent({
      "custom-path": (cwd) =>
        writeAndCommit(cwd, "src/custom.ts", "from-custom\n", "build(CUSTOM-PATH): ship"),
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    // Fanout selection picked the entry from the declared location, and the
    // wave-end rewrite ships it there — not at the default plan/pending.
    expect(outcome.result?.shippedTags).toEqual(["CUSTOM-PATH"]);
    expect(
      readQueueOnDisk(join(fx.repo, ".flume", customRel)),
    ).toEqual([]);
    expect(existsSync(join(fx.repo, ".flume", "plan", "pending"))).toBe(false);

    // The afterCommit gate saw the same resolved, absolute path.
    expect(capturedPendingDir).toBe(join(fx.repo, ".flume", customRel));
  });

  it("undeclared pendingDir defaults to .flume/plan/pending", async () => {
    const entries = [makeEntry("DEFAULT-PATH", ["src/default.ts"])];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    let capturedPendingDir: string | undefined;
    const capturingGate: Gate = {
      name: "capture-pendingpath",
      when: "afterCommit",
      run(ctx) {
        capturedPendingDir = ctx.pendingDir;
        return Promise.resolve({ ok: true, message: "captured" });
      },
    };

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [capturingGate],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "default-path": (cwd) =>
        writeAndCommit(cwd, "src/default.ts", "x\n", "build(DEFAULT-PATH): ship"),
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual(["DEFAULT-PATH"]);
    expect(capturedPendingDir).toBe(join(fx.repo, ".flume", "plan", "pending"));
  });
});

describe("Dispatcher fanout — wave auto-unblock (spec/pending.md § Wave auto-unblock)", () => {
  it("a multi-parent blockedBy entry flips to open once every named parent ships in the same wave", async () => {
    const entries = [
      makeEntry("PARENT-A", ["src/a.ts"]),
      makeEntry("PARENT-B", ["src/b.ts"]),
      {
        ...makeEntry("CHILD-MULTI", ["src/c.ts"]),
        gate: { kind: "blockedBy" as const, tags: ["PARENT-A", "PARENT-B"] },
      },
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "parent-a": (cwd) =>
        writeAndCommit(cwd, "src/a.ts", "from-A\n", "build(PARENT-A): ship"),
      "parent-b": (cwd) =>
        writeAndCommit(cwd, "src/b.ts", "from-B\n", "build(PARENT-B): ship"),
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    // CHILD-MULTI wasn't pickable this wave (both parents still pending at
    // pick time) — only the two parents shipped.
    expect([...(outcome.result?.shippedTags ?? [])].sort()).toEqual([
      "PARENT-A",
      "PARENT-B",
    ]);

    const onDisk = readPendingFromDisk(fx.repo);
    expect(onDisk).toEqual([
      {
        ...makeEntry("CHILD-MULTI", ["src/c.ts"]),
        gate: { kind: "open" },
      },
    ]);
  });

  it("stays blockedBy with the shorter list when only some named parents ship", async () => {
    const entries = [
      makeEntry("PARENT-A", ["src/a.ts"]),
      {
        ...makeEntry("CHILD-PARTIAL", ["src/c.ts"]),
        gate: {
          kind: "blockedBy" as const,
          tags: ["PARENT-A", "PARENT-B-NEVER-QUEUED"],
        },
      },
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "parent-a": (cwd) =>
        writeAndCommit(cwd, "src/a.ts", "from-A\n", "build(PARENT-A): ship"),
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual(["PARENT-A"]);

    const onDisk = readPendingFromDisk(fx.repo);
    expect(onDisk).toEqual([
      {
        ...makeEntry("CHILD-PARTIAL", ["src/c.ts"]),
        gate: {
          kind: "blockedBy",
          tags: ["PARENT-B-NEVER-QUEUED"],
        },
      },
    ]);
  });
});

/**
 * CHAIN-MAXPARALLEL-CHAIN-OVERRIDABLE — `Chain.supervisorPolicy.maxParallel`
 * (`src/Phase.ts`) joins `quarantineScope`/`abortThreshold` as a
 * chain-overridable default for `runFanout`'s batch width
 * (`partitionByFileOverlap`, `src/partition.ts`). Unlike those two knobs this
 * needs no `superviseLoop`/CLI pre-read: it is tick-scoped, not run-scoped —
 * `runFanout` reads it straight off the chain the tick already resolved.
 * Three disjoint, single-file entries make the batch-1 boundary observable
 * via `shippedTags`/`pendingAfter`, the same seam the "two disjoint entries
 * both ship" suite above exercises.
 */
describe("Dispatcher fanout — supervisorPolicy.maxParallel overrides the batch width (CHAIN-MAXPARALLEL-CHAIN-OVERRIDABLE)", () => {
  it("a chain declaring supervisorPolicy.maxParallel: 2 ships only the first two of three disjoint entries", async () => {
    const entries = [
      makeEntry("MP-A", ["src/mp-a.ts"]),
      makeEntry("MP-B", ["src/mp-b.ts"]),
      makeEntry("MP-C", ["src/mp-c.ts"]),
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = {
      phases: [phase],
      humanOnly: [],
      supervisorPolicy: { maxParallel: 2 },
    };

    const agent = fanoutAgent({
      "mp-a": (cwd) =>
        writeAndCommit(cwd, "src/mp-a.ts", "from-A\n", "build(MP-A): ship"),
      "mp-b": (cwd) =>
        writeAndCommit(cwd, "src/mp-b.ts", "from-B\n", "build(MP-B): ship"),
      "mp-c": (cwd) =>
        writeAndCommit(cwd, "src/mp-c.ts", "from-C\n", "build(MP-C): ship"),
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      // DispatcherOptions.maxParallel deliberately unset — the chain's
      // declaration is what's under test, not the embedder fallback.
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    // Batch 1 closes on capacity (2) even though a third disjoint entry was
    // pickable — it stays pending for the next tick's fresh partition.
    expect(outcome.result?.shippedTags).toEqual(["MP-A", "MP-B"]);
    expect(outcome.result?.pendingAfter.map((e) => e.tag)).toEqual(["MP-C"]);
    expect((readPendingFromDisk(fx.repo)).map((e) => e.tag)).toEqual([
      "MP-C",
    ]);
  });

  it("a chain declaring nothing gets maxParallel: 4", async () => {
    const entries = [
      makeEntry("MPD-A", ["src/mpd-a.ts"]),
      makeEntry("MPD-B", ["src/mpd-b.ts"]),
      makeEntry("MPD-C", ["src/mpd-c.ts"]),
      makeEntry("MPD-D", ["src/mpd-d.ts"]),
      makeEntry("MPD-E", ["src/mpd-e.ts"]),
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    // No supervisorPolicy at all — the undeclared-fields-fall-through case.
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "mpd-a": (cwd) =>
        writeAndCommit(cwd, "src/mpd-a.ts", "from-A\n", "build(MPD-A): ship"),
      "mpd-b": (cwd) =>
        writeAndCommit(cwd, "src/mpd-b.ts", "from-B\n", "build(MPD-B): ship"),
      "mpd-c": (cwd) =>
        writeAndCommit(cwd, "src/mpd-c.ts", "from-C\n", "build(MPD-C): ship"),
      "mpd-d": (cwd) =>
        writeAndCommit(cwd, "src/mpd-d.ts", "from-D\n", "build(MPD-D): ship"),
      "mpd-e": (cwd) =>
        writeAndCommit(cwd, "src/mpd-e.ts", "from-E\n", "build(MPD-E): ship"),
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      // No DispatcherOptions.maxParallel either — proving the built-in
      // default (4) survives both undeclared surfaces unchanged.
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    expect(outcome.result?.shippedTags).toEqual([
      "MPD-A",
      "MPD-B",
      "MPD-C",
      "MPD-D",
    ]);
    expect(outcome.result?.pendingAfter.map((e) => e.tag)).toEqual(["MPD-E"]);
  });
});

/**
 * SUPERVISORPOLICY-TICKTIMEOUTMS — `Chain.supervisorPolicy.tickTimeoutMs`
 * (`src/Phase.ts`) joins `maxParallel` as a per-tick chain-overridable
 * default: the one `invokeAgent` call site both concurrencies reach through
 * (`runAttempt`) reads it straight off the tick's own resolved chain, rather
 * than binding it once per run like `quarantineScope`/`abortThreshold`. The
 * override doesn't gate ship/no-ship, so it's observed the only way it can
 * be — a recording agent captures the `timeoutMs` `agent.invoke` actually
 * received.
 */
describe("Dispatcher — supervisorPolicy.tickTimeoutMs overrides the per-invocation cap (SUPERVISORPOLICY-TICKTIMEOUTMS)", () => {
  it("a chain-declared supervisorPolicy.tickTimeoutMs overrides DispatcherOptions.tickTimeoutMs for a singleton phase's agent invocation", async () => {
    const phase = makePhase({
      name: "build",
      concurrency: "singleton",
      gates: [],
    });
    const chain: Chain = {
      phases: [phase],
      humanOnly: [],
      supervisorPolicy: { tickTimeoutMs: 999 },
    };
    new Baton(join(fx.repo, ".flume")).wake("build");

    let seenTimeoutMs: number | undefined;
    const agent: Agent = {
      name: "timeout-capture-singleton",
      async invoke(inv) {
        seenTimeoutMs = inv.timeoutMs;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      // DispatcherOptions.tickTimeoutMs deliberately set to something else —
      // the chain's declaration must win, not this fallback.
      tickTimeoutMs: 5_000,
    });

    await dispatcher.tick();

    expect(seenTimeoutMs).toBe(999);
  });

  it("a chain-declared supervisorPolicy.tickTimeoutMs overrides DispatcherOptions.tickTimeoutMs for a fanout entry's agent invocation", async () => {
    const entries = [makeEntry("TTMS-A", ["src/ttms-a.ts"])];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = {
      phases: [phase],
      humanOnly: [],
      supervisorPolicy: { tickTimeoutMs: 777 },
    };

    let seenTimeoutMs: number | undefined;
    const agent: Agent = {
      name: "timeout-capture-fanout",
      async invoke(inv) {
        seenTimeoutMs = inv.timeoutMs;
        await writeAndCommit(
          inv.cwd,
          "src/ttms-a.ts",
          "from-A\n",
          "build(TTMS-A): ship",
        );
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      // DispatcherOptions.tickTimeoutMs deliberately set to something else —
      // the chain's declaration must win, not this fallback.
      tickTimeoutMs: 5_000,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual(["TTMS-A"]);
    expect(seenTimeoutMs).toBe(777);
  });

  it("a chain declaring neither maxParallel nor tickTimeoutMs still gets the DispatcherOptions defaults, byte-identical", async () => {
    const phase = makePhase({
      name: "build",
      concurrency: "singleton",
      gates: [],
    });
    // No supervisorPolicy at all — the undeclared-fields-fall-through case.
    const chain: Chain = { phases: [phase], humanOnly: [] };
    new Baton(join(fx.repo, ".flume")).wake("build");

    let seenTimeoutMs: number | undefined;
    const agent: Agent = {
      name: "timeout-capture-default",
      async invoke(inv) {
        seenTimeoutMs = inv.timeoutMs;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      tickTimeoutMs: 4_242,
    });

    await dispatcher.tick();

    // No chain override, so DispatcherOptions.tickTimeoutMs survives
    // unchanged — the same fallback `maxParallel`'s "declaring nothing"
    // case above pins.
    expect(seenTimeoutMs).toBe(4_242);
  });
});

/**
 * The tick's teardown reaching the agent seam: `DispatcherOptions.stopSignal`
 * is what a signalled `flume tick` aborts, and the chain's
 * `supervisorPolicy.killGraceMs` (`src/Phase.ts`) is what bounds the wait the
 * abort commits the provider to (spec/loop.md, "The loop lock and the tip
 * claim"). Both ride the invocation the same way `tickTimeoutMs` above does —
 * off the tick's own resolved chain, at the `invokeAgent` call site — so a
 * recording agent is how they are observed here too. What the provider then
 * does with them is `tests/Agent.test.ts`'s subject.
 */
describe("Dispatcher — the stop signal and kill grace reach the agent invocation", () => {
  it("the dispatcher's stopSignal is the signal a singleton phase's agent invocation receives", async () => {
    const phase = makePhase({
      name: "build",
      concurrency: "singleton",
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    new Baton(join(fx.repo, ".flume")).wake("build");

    const stop = new AbortController();
    let seenSignal: AbortSignal | undefined;
    const agent: Agent = {
      name: "stop-signal-capture",
      async invoke(inv) {
        seenSignal = inv.signal;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      stopSignal: stop.signal,
    });

    await dispatcher.tick();

    // Identity, not merely an AbortSignal: the invocation must abort when
    // *this* controller does, which is the one the CLI's signal handlers
    // hold.
    expect(seenSignal).toBe(stop.signal);
    expect(seenSignal?.aborted).toBe(false);
    stop.abort();
    expect(seenSignal?.aborted).toBe(true);
  });

  it("the dispatcher's stopSignal is the signal a fanout entry's agent invocation receives", async () => {
    const entries = [makeEntry("STOP-A", ["src/stop-a.ts"])];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const stop = new AbortController();
    let seenSignal: AbortSignal | undefined;
    const agent: Agent = {
      name: "stop-signal-capture-fanout",
      async invoke(inv) {
        seenSignal = inv.signal;
        await writeAndCommit(
          inv.cwd,
          "src/stop-a.ts",
          "from-A\n",
          "build(STOP-A): ship",
        );
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      stopSignal: stop.signal,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual(["STOP-A"]);
    expect(seenSignal).toBe(stop.signal);
  });

  it("a chain-declared supervisorPolicy.killGraceMs is the grace the agent invocation is given", async () => {
    const phase = makePhase({
      name: "build",
      concurrency: "singleton",
      gates: [],
    });
    const chain: Chain = {
      phases: [phase],
      humanOnly: [],
      supervisorPolicy: { killGraceMs: 321 },
    };
    new Baton(join(fx.repo, ".flume")).wake("build");

    let seenGraceMs: number | undefined;
    const agent: Agent = {
      name: "grace-capture",
      async invoke(inv) {
        seenGraceMs = inv.killGraceMs;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    await dispatcher.tick();

    expect(seenGraceMs).toBe(321);
  });

  it("an invocation carries neither field when the chain declares no grace and nothing wired a stop signal", async () => {
    const phase = makePhase({
      name: "build",
      concurrency: "singleton",
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    new Baton(join(fx.repo, ".flume")).wake("build");

    let seen: Record<string, unknown> | undefined;
    const agent: Agent = {
      name: "absence-capture",
      async invoke(inv) {
        seen = inv as unknown as Record<string, unknown>;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    await dispatcher.tick();

    // Absent, never present-and-undefined: a provider reading `"signal" in
    // inv` must see an invocation nobody can stop, and the engine's own
    // `exactOptionalPropertyTypes` posture is what that spells.
    expect(seen).toBeDefined();
    expect("signal" in seen!).toBe(false);
    expect("killGraceMs" in seen!).toBe(false);
  });
});

/**
 * CHAIN-PARTITIONIGNORE — `Chain.supervisorPolicy.partitionIgnore`
 * (`src/Phase.ts`) joins `maxParallel`/`tickTimeoutMs` as a per-tick
 * chain-overridable default: `runFanout` reads it straight off the tick's
 * own resolved chain and threads it into `partitionByFileOverlap`
 * (`src/partition.ts`). spec/pending.md "Fanout partition — disjoint
 * touched paths": it narrows the partition's collision set only —
 * `declaredPaths` (the fence, the write guard, ship detection) is
 * untouched, so a wave that widens on the ignored path still gates and
 * ships each entry against its real declared files.
 */
describe("Dispatcher fanout — supervisorPolicy.partitionIgnore narrows the collision set (CHAIN-PARTITIONIGNORE)", () => {
  it("two entries colliding only on an ignored path ship in the same wave", async () => {
    const entries = [
      makeEntry("PI-A", ["shared-lock.json", "src/pi-a.ts"]),
      makeEntry("PI-B", ["shared-lock.json", "src/pi-b.ts"]),
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout", gates: [] });
    const chain: Chain = {
      phases: [phase],
      humanOnly: [],
      supervisorPolicy: { partitionIgnore: ["shared-lock.json"] },
    };

    const agent = fanoutAgent({
      "pi-a": (cwd) =>
        writeAndCommit(cwd, "src/pi-a.ts", "from-A\n", "build(PI-A): ship"),
      "pi-b": (cwd) =>
        writeAndCommit(cwd, "src/pi-b.ts", "from-B\n", "build(PI-B): ship"),
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    // Both entries only ever touch src/pi-a.ts / src/pi-b.ts + the ignored
    // shared-lock.json, so with the ignore in effect they're disjoint and
    // both ship in wave 1 — no cherry-pick conflict on the ignored file.
    expect(outcome.result?.shippedTags).toEqual(["PI-A", "PI-B"]);
    expect(outcome.result?.pendingAfter).toEqual([]);
  });

  it("still splits two entries that collide on a non-ignored path in addition to the ignored one", async () => {
    const entries = [
      makeEntry("PIC-A", ["shared-lock.json", "src/shared.ts"]),
      makeEntry("PIC-B", ["shared-lock.json", "src/shared.ts"]),
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout", gates: [] });
    const chain: Chain = {
      phases: [phase],
      humanOnly: [],
      supervisorPolicy: { partitionIgnore: ["shared-lock.json"] },
    };

    const agent = fanoutAgent({
      "pic-a": (cwd) =>
        writeAndCommit(cwd, "src/shared.ts", "from-A\n", "build(PIC-A): ship"),
      "pic-b": (cwd) =>
        writeAndCommit(cwd, "src/shared.ts", "from-B\n", "build(PIC-B): ship"),
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    // src/shared.ts is not ignored, so PIC-A and PIC-B still collide and
    // only the first ships this wave — the ignore widened nothing here.
    expect(outcome.result?.shippedTags).toEqual(["PIC-A"]);
    expect(outcome.result?.pendingAfter.map((e) => e.tag)).toEqual(["PIC-B"]);
  });

  it("a chain declaring no partitionIgnore still collides on the shared path", async () => {
    const entries = [
      makeEntry("PID-A", ["shared-lock.json"]),
      makeEntry("PID-B", ["shared-lock.json"]),
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout", gates: [] });
    // No supervisorPolicy at all — the undeclared-fields-fall-through case.
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "pid-a": (cwd) =>
        writeAndCommit(cwd, "shared-lock.json", "from-A\n", "build(PID-A): ship"),
      "pid-b": (cwd) =>
        writeAndCommit(cwd, "shared-lock.json", "from-B\n", "build(PID-B): ship"),
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual(["PID-A"]);
    expect(outcome.result?.pendingAfter.map((e) => e.tag)).toEqual(["PID-B"]);
  });

  it("declaredPaths / write guard / ship detection are unaffected — an ignored path still fails writablePaths outside the phase's ceiling", async () => {
    // partitionIgnore widens the wave only; it must not act as a second
    // permission. An entry declaring a path outside writablePaths still
    // reverts on the write guard even though that same path is ignored by
    // the partition.
    const entries = [makeEntry("PIG-A", ["shared-lock.json", "forbidden/out.ts"])];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**", ".flume/plan/pending.json"],
      gates: [],
    });
    const chain: Chain = {
      phases: [phase],
      humanOnly: [],
      supervisorPolicy: { partitionIgnore: ["shared-lock.json"] },
    };

    const agent = fanoutAgent({
      "pig-a": (cwd) =>
        writeAndCommit(
          cwd,
          "forbidden/out.ts",
          "nope\n",
          "build(PIG-A): ship",
        ),
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual([]);
    expect(outcome.result?.pendingAfter.map((e) => e.tag)).toEqual(["PIG-A"]);
  });
});

describe("Dispatcher fanout — commitPendingUpdate rewrite reads fresh, not a tick-start snapshot (regression)", () => {
  it("ships one entry without clobbering a concurrent edit landed on an untouched entry mid-wave", async () => {
    // SHIP-PENDING-CLOBBER-BUG repro: a ship commit reintroduced a retired
    // field into entries it never shipped. Root cause was commitPendingUpdate
    // deriving its rewrite from the `pending` snapshot the dispatcher read at
    // tick start, before the wave's (possibly long-running) worktree/agent
    // work — so any write another process landed on trunk's pending.json in
    // that window got silently overwritten by the stale snapshot once this
    // wave finally wrote back. KEEP-B is parked (never picked this wave) so
    // it stands in for "an entry this wave doesn't touch"; the fanout
    // agent's action commits a concurrent edit to trunk's pending.json
    // mid-wave, standing in for that concurrent write — committed, since the
    // rewrite read now resolves the committed tip rather than the working
    // tree (spec/pending.md "Dispatch reads come from the tip, not the
    // tree"), so an uncommitted disk write would be invisible to it.
    const keepB: PendingEntry = {
      ...makeEntry("KEEP-B", ["src/b.ts"]),
      gate: { kind: "parked", reason: "not picked this wave" },
    };
    await writePending(fx.repo, [makeEntry("SHIP-A", ["src/a.ts"]), keepB]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout", gates: [] });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const concurrentKeepB: PendingEntry = {
      ...keepB,
      observedFiles: ["src/concurrent-marker.ts"],
    };

    const agent = fanoutAgent({
      "ship-a": async (cwd) => {
        // Only KEEP-B's own file: a concurrent producer edits the entry it
        // is about and nothing else in the directory, which is the whole
        // reason the queue is one file per entry.
        await commitEntryFile(
          fx.repo,
          entryFileName("KEEP-B"),
          JSON.stringify(concurrentKeepB, null, 2) + "\n",
        );
        await writeAndCommit(cwd, "src/a.ts", "from-A\n", "build(SHIP-A): ship");
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();
    expect(outcome.result?.shippedTags).toEqual(["SHIP-A"]);

    const after = readPendingFromDisk(fx.repo);
    // The concurrent write's field survived, byte-for-byte — proof the
    // rewrite was derived from the queue's state at write time, not the
    // stale pre-wave snapshot that never saw it. No reintroduced or
    // foreign keys, no lost edits.
    expect(after).toEqual([concurrentKeepB]);
  });
});

describe("Dispatcher — dispatch reads resolve from the committed tip, not the working tree (spec/pending.md \"Dispatch reads come from the tip, not the tree\")", () => {
  it("a decide-read reflects the committed tip, ignoring an uncommitted working-tree edit to an entry file", async () => {
    await writePending(fx.repo, [makeEntry("TIP-A", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    // Dirty the working tree without committing — a scratch edit no commit
    // owns. Parks the only entry, so a tree-read would see nothing pickable;
    // the decide-read must resolve HEAD's committed content instead, where
    // TIP-A is still open.
    const dirtyEntry: PendingEntry = {
      ...makeEntry("TIP-A", ["src/a.ts"]),
      gate: { kind: "parked", reason: "uncommitted tree edit" },
    };
    await writeFile(
      join(queueDirOf(fx.repo), entryFileName("TIP-A")),
      JSON.stringify(dirtyEntry, null, 2) + "\n",
      "utf8",
    );

    const phase = makePhase({ name: "build", concurrency: "fanout", gates: [] });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const agent = fanoutAgent({
      "tip-a": (cwd) =>
        writeAndCommit(cwd, "src/a.ts", "shipped\n", "build(TIP-A): ship"),
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    // TIP-A shipped — the working-tree edit that parked it never reached
    // the decide-read, which resolved the committed tip where it's open.
    expect(outcome.result?.shippedTags).toEqual(["TIP-A"]);
  });

  it("PendingParseFailure still throws when the tip's committed content fails to parse", async () => {
    await commitEntryFile(
      fx.repo,
      entryFileName("CORRUPT"),
      "{ this is not valid json",
    );
    new Baton(join(fx.repo, ".flume")).wake("build");

    // A fence that admits no queue path: the strict read's carve-out is for
    // the phase that rewrites the queue (spec/pending.md "Queue reads are
    // strict"), and this phase is not it, so the refusal stands. `makePhase`'s
    // default `["**"]` would carve it out.
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const agent = fanoutAgent({});

    const errors: string[] = [];
    const rec: Logger = {
      info: () => {},
      warn: () => {},
      error: (l) => errors.push(l),
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: rec,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.failed).toBe(true);
    expect(errors.some((e) => /plan\/pending/.test(e) && /parse/.test(e))).toBe(
      true,
    );
  });
});

describe("Dispatcher fanout — two consecutive ship waves leave an untouched entry byte-identical", () => {
  it("KEEP survives two ship waves with exactly its pre-wave field set", async () => {
    const keep: PendingEntry = {
      ...makeEntry("KEEP", ["src/keep.ts"]),
      gate: { kind: "parked", reason: "not picked this run" },
    };
    await writePending(fx.repo, [makeEntry("SHIP-1", ["src/one.ts"]), keep]);
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout", gates: [] });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "ship-1": (cwd) =>
        writeAndCommit(cwd, "src/one.ts", "one\n", "build(SHIP-1): ship"),
      "ship-2": (cwd) =>
        writeAndCommit(cwd, "src/two.ts", "two\n", "build(SHIP-2): ship"),
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    const first = await dispatcher.tick();
    expect(first.result?.shippedTags).toEqual(["SHIP-1"]);
    const afterFirst = readPendingFromDisk(fx.repo);
    expect(afterFirst).toEqual([keep]);

    // A second entry lands between waves, as a plan tick would — `writePending`
    // commits it, so wave 2's rewrite (which reverts pending.json back to
    // just `keep`, byte-identical to wave 1's commit) has a real diff
    // against HEAD for git to commit.
    await writePending(fx.repo, [
      ...afterFirst,
      makeEntry("SHIP-2", ["src/two.ts"]),
    ]);
    baton.wake("build");
    const second = await dispatcher.tick();
    expect(second.result?.shippedTags).toEqual(["SHIP-2"]);

    const afterSecond = readPendingFromDisk(fx.repo);
    expect(afterSecond).toEqual([keep]);
  });
});

// ---------- trunk contract ----------

/**
 * The engine mints no namespace beneath the worktree base
 * (`spec/worktrees.md`, *Placement — the worktree base*), so there is no
 * value for a chain or the CLI to hand it: the option is gone from the
 * declared surface, not merely unread.
 *
 * Judged through the real compiler over the real `src/Dispatcher.ts`, not by
 * a conditional type alone. A conditional type is erased before vitest runs,
 * so a suite that only asserted `true` would pass against a tree that still
 * declares the field — green over the exact regression it names. The excess
 * property check is what makes the absence observable at runtime here, and
 * the control literal beside it is what keeps the refusal the field's rather
 * than the fixture's (`.claude/rules/engineering.md`, *A green verdict is
 * proven non-vacuous*).
 */
describe("Dispatcher options — the fanout namespace is off the surface", () => {
  const DISPATCHER_SRC = fileURLToPath(
    new URL("../src/Dispatcher.ts", import.meta.url),
  );
  const AGENT_SRC = fileURLToPath(new URL("../src/Agent.ts", import.meta.url));

  /** Type-check one `DispatcherOptions` literal against the real `src/`. */
  async function diagnose(fields: string): Promise<string> {
    const dir = await mkTempDir("flume-dispatcher-opts-type-");
    try {
      const file = join(dir, "fixture.ts");
      await writeFile(
        file,
        `import type { Agent } from ${JSON.stringify(AGENT_SRC)};\n` +
          `import type { DispatcherOptions } from ${JSON.stringify(DISPATCHER_SRC)};\n` +
          `declare const agent: Agent;\n` +
          `export const opts: DispatcherOptions = { ${fields} };\n`,
        "utf8",
      );
      // The repo's own strictness, so the excess-property check reads the
      // same way `pnpm tsc` does.
      const program = ts.createProgram([file], {
        target: ts.ScriptTarget.ES2023,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        strict: true,
        exactOptionalPropertyTypes: true,
        allowImportingTsExtensions: true,
        skipLibCheck: true,
        noEmit: true,
      });
      return program
        .getSemanticDiagnostics(program.getSourceFile(file))
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "))
        .join("\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  const REQUIRED = 'repoRoot: "", configDir: "", agent';

  it("DispatcherOptions no longer carries a fanout namespace (type-level)", async () => {
    // Control first: the same literal without the field compiles clean, so
    // the refusal below is the field's and not the fixture's.
    expect(await diagnose(REQUIRED)).toBe("");

    expect(await diagnose(`${REQUIRED}, namespace: "alpha"`)).toContain(
      "namespace",
    );

    // And the key itself is gone from the interface, which is what a
    // `keyof` consumer would see. Erased at runtime, held by `pnpm tsc`.
    type NamespacePurged = "namespace" extends keyof DispatcherOptions
      ? never
      : true;
    const purged: NamespacePurged = true;
    expect(purged).toBe(true);
  });
});

describe("Trunk contract — HEAD-is-truth, trunkBranch purged", () => {
  it("DispatcherOptions no longer carries trunkBranch (type-level)", () => {
    // Resolves to `never` (unassignable) if the key ever returns.
    type TrunkBranchPurged = "trunkBranch" extends keyof DispatcherOptions
      ? never
      : true;
    const purged: TrunkBranchPurged = true;
    expect(purged).toBe(true);
  });

  it("ships onto the checked-out branch — HEAD is the trunk", async () => {
    // Move the fixture off its init branch; the ship path must follow HEAD,
    // not any recorded branch name.
    const initBranch = (
      await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: fx.repo })
    ).stdout.trim();
    const initTip = await head(fx.repo);
    await exec("git", ["checkout", "-q", "-b", "job/elsewhere"], {
      cwd: fx.repo,
    });

    await writePending(fx.repo, [makeEntry("TRUNK-HEAD", ["src/t.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const agent = fanoutAgent({
      "trunk-head": (cwd) =>
        writeAndCommit(cwd, "src/t.ts", "on-head\n", "build(TRUNK-HEAD): ship"),
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();
    expect(outcome.result?.shippedTags).toEqual(["TRUNK-HEAD"]);

    // Landed on the checked-out branch; the runtime never switched away.
    const onBranch = (
      await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: fx.repo })
    ).stdout.trim();
    expect(onBranch).toBe("job/elsewhere");
    expect(await readFile(join(fx.repo, "src/t.ts"), "utf8")).toBe("on-head\n");

    // The branch we left behind did not move.
    const initTipAfter = (
      await exec("git", ["rev-parse", initBranch], { cwd: fx.repo })
    ).stdout.trim();
    expect(initTipAfter).toBe(initTip);
  });
});

/**
 * Worktree base resolution:
 * `FLUME_WORKTREES_DIR ?? join(flumeDir, "worktrees")`. The override exists
 * so ephemeral worktrees can relocate outside every repo-path prefix (the
 * observed stray-write vector); the default tracks the state root, which is
 * itself relocatable via `flumeDir`. `createWorktree` reads the env var at
 * call time, so these tests stash/restore it around each case.
 */
describe("Dispatcher fanout — worktree base resolution", () => {
  const savedOverride = process.env.FLUME_WORKTREES_DIR;

  afterEach(() => {
    if (savedOverride === undefined) delete process.env.FLUME_WORKTREES_DIR;
    else process.env.FLUME_WORKTREES_DIR = savedOverride;
  });

  it("FLUME_WORKTREES_DIR set → worktree lands under resolve(override), default base never materializes", async () => {
    const container = await mkTempDir("flume-wt-override-");
    try {
      // Absolute override — its own resolve() fixed point, so asserting
      // placement under it asserts the resolved base verbatim.
      const base = join(container, "wt-base");
      process.env.FLUME_WORKTREES_DIR = base;

      await writePending(fx.repo, [makeEntry("WT-OVER", ["src/wt-over.ts"])]);
      new Baton(join(fx.repo, ".flume")).wake("build");

      const phase = makePhase({ name: "build", concurrency: "fanout" });
      const chain: Chain = { phases: [phase], humanOnly: [] };

      let observedCwd: string | undefined;
      const agent = fanoutAgent({
        "wt-over": async (cwd) => {
          observedCwd = cwd;
          await writeAndCommit(cwd, "src/wt-over.ts", "over\n", "build(WT-OVER): ship");
        },
      });

      const dispatcher = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        agent,
        log: silent,
      });

      const outcome = await dispatcher.tick();

      expect(outcome.result?.committed).toBe(true);
      expect(outcome.result?.shippedTags).toEqual(["WT-OVER"]);
      // The agent ran inside `<resolve(override)>/<slug>` …
      expect(observedCwd).toBe(join(base, "wt-over"));
      // … and the default `<flumeDir>/worktrees` base was never created.
      expect(existsSync(join(fx.repo, ".flume", "worktrees"))).toBe(false);
      // Teardown cleaned the relocated worktree too.
      expect(existsSync(join(base, "wt-over"))).toBe(false);
    } finally {
      await rm(container, { recursive: true, force: true });
    }
  });

  it("no override → worktree lands under join(flumeDir, 'worktrees')", async () => {
    delete process.env.FLUME_WORKTREES_DIR;
    const flumeDir = join(fx.repo, ".flume");

    await writePending(fx.repo, [makeEntry("WT-DEF", ["src/wt-def.ts"])]);
    new Baton(flumeDir).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    let observedCwd: string | undefined;
    const agent = fanoutAgent({
      "wt-def": async (cwd) => {
        observedCwd = cwd;
        await writeAndCommit(cwd, "src/wt-def.ts", "def\n", "build(WT-DEF): ship");
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    expect(outcome.result?.shippedTags).toEqual(["WT-DEF"]);
    // The agent ran inside `<flumeDir>/worktrees/<slug>` — the base tracks
    // the state root, not a hardcoded repo-relative location.
    expect(observedCwd).toBe(join(flumeDir, "worktrees", "wt-def"));
    // Teardown cleaned the slug dir under the state root.
    expect(existsSync(join(flumeDir, "worktrees", "wt-def"))).toBe(false);
  });

  // spec/worktrees.md "Placement — the worktree base":
  // the third input to the same resolution — a chain declaring *how* to
  // compute its base, evaluated once at chain load against the roots the
  // runtime resolved. Driven through the real dispatcher with a real
  // declaration rather than by calling `worktreesBase` with a string: what
  // the entry buys is that a chain can move placement with no environment
  // variable set before the engine's own module loads, and only the tick
  // path proves that.
  it("a chain-declared worktreesBase places the tick's worktree", async () => {
    delete process.env.FLUME_WORKTREES_DIR;
    const container = await mkTempDir("flume-wt-declared-");
    try {
      const flumeDir = join(fx.repo, ".flume");
      // A function of the roots, not a committed path literal: the chain
      // composes the base from what it was handed at load.
      const base = join(container, "declared-base");
      const rootsSeen: FlumePaths[] = [];

      await writePending(fx.repo, [makeEntry("WT-DECL", ["src/wt-decl.ts"])]);
      new Baton(flumeDir).wake("build");

      const phase = makePhase({ name: "build", concurrency: "fanout" });
      const chain: Chain = {
        phases: [phase],
        humanOnly: [],
        worktreesBase: (paths) => {
          rootsSeen.push(paths);
          return base;
        },
      };

      let observedCwd: string | undefined;
      const agent = fanoutAgent({
        "wt-decl": async (cwd) => {
          observedCwd = cwd;
          await writeAndCommit(cwd, "src/wt-decl.ts", "decl\n", "build(WT-DECL): ship");
        },
      });

      const dispatcher = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        agent,
        log: silent,
      });

      const outcome = await dispatcher.tick();

      expect(outcome.result?.committed).toBe(true);
      expect(outcome.result?.shippedTags).toEqual(["WT-DECL"]);
      // The agent ran inside `<declared>/<slug>` …
      expect(observedCwd).toBe(join(base, "wt-decl"));
      // … the declaration was called with the runtime's own resolved roots,
      // once for the tick's one chain load — not once per worktree …
      expect(rootsSeen).toEqual([
        { repoRoot: fx.repo, configDir: fx.configDir, flumeDir },
      ]);
      // … the default `<flumeDir>/worktrees` base never materialized …
      expect(existsSync(join(flumeDir, "worktrees"))).toBe(false);
      // … and teardown found the relocated worktree, so the wave left no
      // residue at the base creation actually used.
      expect(existsSync(join(base, "wt-decl"))).toBe(false);
    } finally {
      await rm(container, { recursive: true, force: true });
    }
  });

  it("FLUME_WORKTREES_DIR outranks a chain-declared base", async () => {
    const container = await mkTempDir("flume-wt-rank-");
    try {
      const override = join(container, "operator-base");
      const declared = join(container, "chain-base");
      process.env.FLUME_WORKTREES_DIR = override;

      await writePending(fx.repo, [makeEntry("WT-RANK", ["src/wt-rank.ts"])]);
      new Baton(join(fx.repo, ".flume")).wake("build");

      const phase = makePhase({ name: "build", concurrency: "fanout" });
      const chain: Chain = {
        phases: [phase],
        humanOnly: [],
        worktreesBase: () => declared,
      };

      let observedCwd: string | undefined;
      const agent = fanoutAgent({
        "wt-rank": async (cwd) => {
          observedCwd = cwd;
          await writeAndCommit(cwd, "src/wt-rank.ts", "rank\n", "build(WT-RANK): ship");
        },
      });

      const dispatcher = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        agent,
        log: silent,
      });

      const outcome = await dispatcher.tick();

      expect(outcome.result?.shippedTags).toEqual(["WT-RANK"]);
      // The operator's host wins over the chain's commit.
      expect(observedCwd).toBe(join(override, "wt-rank"));
      expect(existsSync(declared)).toBe(false);
    } finally {
      await rm(container, { recursive: true, force: true });
    }
  });

  it("a chain whose worktreesBase returns a relative path is refused, and no tick work happens", async () => {
    delete process.env.FLUME_WORKTREES_DIR;
    await writePending(fx.repo, [makeEntry("WT-REL", ["src/wt-rel.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout" });
    const chain: Chain = {
      phases: [phase],
      humanOnly: [],
      // Relative reads as "under whatever the cwd happens to be", which is
      // the repo root for a tick and a worktree for a gate.
      worktreesBase: () => join("..", "wt-base"),
    };

    let agentRan = false;
    const agent = fanoutAgent({
      "wt-rel": async () => {
        agentRan = true;
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.failed).toBe(true);
    expect(outcome.summary).toContain("worktreesBase");
    expect(agentRan).toBe(false);
  });
});

/**
 * An out-of-tree dock is invisible to git by construction.
 * Ship bookkeeping must not `git add` a pendingDir outside repoRoot (the add
 * fatals *after* entries already merged); the disk write alone carries the
 * auto-unblock and observedFiles forward.
 */
describe("Dispatcher fanout — relocated flumeDir: ship bookkeeping skips the chore commit", () => {
  it("merges the entry to trunk, updates pending at the relocated path, no chore commit, no git fatal", async () => {
    const dock = await mkTempDir("flume-dock-");
    try {
      const pendingDir = join(dock, "plan", "pending");
      await mkdir(pendingDir, { recursive: true });
      await writeFile(
        join(pendingDir, entryFileName("RELOC-A")),
        JSON.stringify(makeEntry("RELOC-A", ["src/reloc-a.ts"]), null, 2) +
          "\n",
        "utf8",
      );
      new Baton(dock).wake("build");

      const phase = makePhase({ name: "build", concurrency: "fanout" });
      const chain: Chain = { phases: [phase], humanOnly: [] };

      const agent = fanoutAgent({
        "reloc-a": (cwd) =>
          writeAndCommit(cwd, "src/reloc-a.ts", "reloc\n", "build(RELOC-A): ship"),
      });

      const dispatcher = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        flumeDir: dock,
        agent,
        log: silent,
      });

      const preHead = await head(fx.repo);
      const outcome = await dispatcher.tick();

      // The entry merged to trunk.
      expect(outcome.result?.committed).toBe(true);
      expect(outcome.result?.shippedTags).toEqual(["RELOC-A"]);
      expect(await readFile(join(fx.repo, "src/reloc-a.ts"), "utf8")).toBe(
        "reloc\n",
      );

      // Trunk gained exactly the cherry-picked entry commit — no chore
      // commit rides on top, and none is reported as this wave's commit.
      const { stdout: count } = await exec(
        "git",
        ["rev-list", "--count", `${preHead}..HEAD`],
        { cwd: fx.repo },
      );
      expect(count.trim()).toBe("1");
      const { stdout: subject } = await exec(
        "git",
        ["log", "-1", "--format=%s"],
        { cwd: fx.repo },
      );
      expect(subject.trim()).toBe("build(RELOC-A): ship");
      expect(outcome.result?.commitSha).toBeUndefined();

      // Pending was updated on disk at the relocated path: the shipped
      // entry's file is gone, which is what an empty queue is now.
      const parsed = parsePendingQueue(readQueueOnDisk(pendingDir) ?? []);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.entries).toEqual([]);
      expect(existsSync(join(pendingDir, entryFileName("RELOC-A")))).toBe(false);
      expect(outcome.result?.pendingAfter).toEqual([]);

      // No state bled into the default in-repo location.
      expect(existsSync(join(fx.repo, ".flume"))).toBe(false);
    } finally {
      await rm(dock, { recursive: true, force: true });
    }
  });
});

/**
 * The relocated branch of the strict `readPending()` is the one dispatch read
 * that still probes disk — an out-of-tree state root has no tip to read. Its
 * existence probe must split absent from unreachable: `existsSync` collapses
 * every stat failure to `false`, so a ledger that is present but unstattable
 * dispatched the tick over an empty queue — nothing pickable, a clean
 * hibernation, and a queue full of work the operator can still see on disk
 * (`.claude/rules/engineering.md`, "Loud or nothing").
 */
describe("Dispatcher — relocated pendingDir existence probe", () => {
  it("readPending throws when a relocated pendingDir is present but unstattable", async () => {
    const dock = await mkTempDir("flume-dock-unstattable-");
    try {
      const pendingDir = join(dock, "plan", "pending");
      await mkdir(dirname(pendingDir), { recursive: true });
      // A self-referential symlink reproduces a non-ENOENT listing failure
      // (ELOOP) without relying on permission bits a root-run test could
      // bypass — the shape the CLI's and supervisor's probes are pinned on.
      await symlink("pending", pendingDir);
      new Baton(dock).wake("build");

      const phase = makePhase({ name: "build", concurrency: "fanout" });
      const dispatcher = new Dispatcher({
        chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        flumeDir: dock,
        // Registered for no slug: reaching this agent at all is a selection
        // made over the empty queue the probe must refuse to report.
        agent: fanoutAgent({}),
        log: silent,
      });

      const preHead = await head(fx.repo);
      await expect(dispatcher.tick()).rejects.toThrow(/ELOOP/);
      // The refusal landed before any work: trunk is untouched and the
      // ledger is still exactly the file the operator left there.
      expect(await head(fx.repo)).toBe(preHead);
      expect(existsSync(join(dock, "worktrees"))).toBe(false);
    } finally {
      await rm(dock, { recursive: true, force: true });
    }
  });

  it("an absent relocated pendingDir still reads as an empty queue, not a refusal", async () => {
    const dock = await mkTempDir("flume-dock-absent-");
    try {
      // Nothing written under `dock` at all — ENOENT is the one stat failure
      // the probe is allowed to read as absence, and the tick must still
      // reach its ordinary nothing-pickable hibernation.
      expect(existsSync(join(dock, "plan", "pending"))).toBe(false);
      new Baton(dock).wake("build");

      const phase = makePhase({ name: "build", concurrency: "fanout" });
      const dispatcher = new Dispatcher({
        chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        flumeDir: dock,
        agent: fanoutAgent({}),
        log: silent,
      });

      const outcome = await dispatcher.tick();

      expect(outcome.failed).toBeFalsy();
      expect(outcome.result?.nothingPickable).toBe(true);
      expect(outcome.result?.pendingAfter).toEqual([]);
    } finally {
      await rm(dock, { recursive: true, force: true });
    }
  });
});

describe('Dispatcher fanout — commitMessage override (.claude/rules/engine-boundary.md "Capability vs convention")', () => {
  it("a commitMessage override lands verbatim on the ledger ship commit, receiving the shipped tags", async () => {
    await writePending(fx.repo, [makeEntry("SHIP-MSG", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout", gates: [] });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "ship-msg": (cwd) =>
        writeAndCommit(cwd, "src/a.ts", "a\n", "build(SHIP-MSG): ship"),
    });

    let captured: [readonly string[], readonly string[]] | undefined;
    const commitMessage = (
      shippedTags: readonly string[],
      footprintTags: readonly string[],
    ): string => {
      captured = [shippedTags, footprintTags];
      return `chain-custom: shipped=${shippedTags.join(",")} footprint=${footprintTags.join(",")}`;
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      commitMessage,
    });

    const outcome = await dispatcher.tick();
    expect(outcome.result?.shippedTags).toEqual(["SHIP-MSG"]);

    const { stdout: subject } = await exec(
      "git",
      ["log", "-1", "--format=%s"],
      { cwd: fx.repo },
    );
    expect(subject.trim()).toBe(
      "chain-custom: shipped=SHIP-MSG footprint=",
    );
    expect(captured).toEqual([["SHIP-MSG"], []]);
  });

  it("omitting commitMessage reproduces today's exact ship-commit text", async () => {
    await writePending(fx.repo, [makeEntry("SHIP-DEFAULT", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout", gates: [] });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "ship-default": (cwd) =>
        writeAndCommit(cwd, "src/a.ts", "a\n", "build(SHIP-DEFAULT): ship"),
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();
    expect(outcome.result?.shippedTags).toEqual(["SHIP-DEFAULT"]);

    const { stdout: subject } = await exec(
      "git",
      ["log", "-1", "--format=%s"],
      { cwd: fx.repo },
    );
    expect(subject.trim()).toBe("chore(flume): ship SHIP-DEFAULT");
  });

  it("omitting commitMessage reproduces today's exact merge-failure-footprint text", async () => {
    // Same FOOT-STRAY shape as the trunk-footprint regression test above: an
    // entry-fence overreach reverts the whole in-worktree commit, but the
    // footprint still rides commitPendingUpdate's shippedTags=[] branch.
    await writePending(fx.repo, [makeEntry("FOOT-DEFAULT", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      scopeWritesToEntry: true,
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "foot-default": async (cwd) => {
        await writeFile(join(cwd, "src", "a.ts"), "a\n");
        await writeFile(join(cwd, "src", "stray.ts"), "stray\n");
        await exec("git", ["add", "."], { cwd });
        await exec(
          "git",
          ["commit", "-q", "-m", "build(FOOT-DEFAULT): overreach"],
          { cwd },
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();
    expect(outcome.result?.shippedTags).toEqual([]);

    const { stdout: subject } = await exec(
      "git",
      ["log", "-1", "--format=%s"],
      { cwd: fx.repo },
    );
    expect(subject.trim()).toBe(
      "chore(flume): record merge-failure footprints for FOOT-DEFAULT",
    );
  });
});

describe("Dispatcher fanout — stale-slug N≥2 wave: serialized worktree create/teardown", () => {
  it("creates every worktree + ships every entry despite seeded stale slugs; a fanout wave's teardown leaves the repo's worktree registry holding only the primary checkout", async () => {
    const entries = [
      makeEntry("RACE-A", ["src/race-a.ts"]),
      makeEntry("RACE-B", ["src/race-b.ts"]),
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const repoOpts = { cwd: fx.repo };

    // Seed a stale slug for BOTH entries, exactly as a prior crashed run
    // leaves it: a *registered* `git worktree` at `.flume/worktrees/<slug>`
    // (so both `.git/worktrees/<slug>/` metadata and the dir exist),
    // carrying this state root's own provisioning stamp — the evidence
    // `createWorktree` clears an occupied path on, beside the registry
    // (`spec/worktrees.md`, *Placement — the worktree base*). Written by the
    // real `stampWorktree` rather than spelled here
    // (`.claude/rules/engineering.md`, *A seam gate reads what the real
    // writer wrote*). The wave's createWorktree must
    // `git worktree remove --force` each, then re-`add` — the precise
    // remove+add pair that, run N-wide in parallel against the shared
    // `.git/worktrees/` dir, fails a sibling's add mid-validation.
    // Serialized, every add lands.
    for (const slug of ["race-a", "race-b"]) {
      const wtPath = join(fx.repo, ".flume", "worktrees", slug);
      await mkdir(dirname(wtPath), { recursive: true });
      await exec(
        "git",
        ["worktree", "add", "-B", `stale/${slug}`, wtPath, "HEAD"],
        repoOpts,
      );
      await stampWorktree(wtPath, defaultStateRoot(fx.repo));
    }
    // Precondition: the stale worktrees are genuinely registered with git
    // (not just bare dirs) — proving the wave exercises the
    // `git worktree remove --force` path, not the rm-fallback. Exact
    // membership, so this is the pair of registered paths rather than two
    // fragments that happen to occur somewhere in a blob.
    expect(await registeredWorktrees()).toEqual(
      ["race-a", "race-b"]
        .map((slug) => resolve(join(fx.repo, ".flume", "worktrees", slug)))
        .sort(),
    );

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "race-a": (cwd) =>
        writeAndCommit(cwd, "src/race-a.ts", "A\n", "build(RACE-A): ship"),
      "race-b": (cwd) =>
        writeAndCommit(cwd, "src/race-b.ts", "B\n", "build(RACE-B): ship"),
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    // Every worktree was created over its stale slug and every entry
    // shipped — no `git worktree add` failed on a sibling's concurrent
    // remove (the stale-slug N≥2 wave completes).
    expect(outcome.result?.committed).toBe(true);
    expect(outcome.result?.shippedTags).toEqual(["RACE-A", "RACE-B"]);
    expect(await readFile(join(fx.repo, "src/race-a.ts"), "utf8")).toBe("A\n");
    expect(await readFile(join(fx.repo, "src/race-b.ts"), "utf8")).toBe("B\n");
    expect(readPendingFromDisk(fx.repo)).toEqual([]);

    // Teardown left git's worktree registry clean: no `.flume/worktrees/`
    // entry survives, neither registered with git nor on disk.
    expect(await registeredWorktrees()).toEqual([]);
    expect(existsSync(join(fx.repo, ".flume", "worktrees", "race-a"))).toBe(
      false,
    );
    expect(existsSync(join(fx.repo, ".flume", "worktrees", "race-b"))).toBe(
      false,
    );
  });
});

/**
 * spec/worktrees.md "Startup sweep — a dead wave's residue is removed at
 * the next start": per-wave stale-slug removal (`createWorktree`, above)
 * only ever covers an entry being re-provisioned; an entry that left the
 * queue entirely leaked its worktree and branch indefinitely. `flume loop`
 * closes that gap by calling
 * `Dispatcher.sweepStaleWorktrees()` once, after the tip claim, before the
 * first tick (`src/cli.ts`). These tests call the method directly — the
 * CLI wiring is a one-line call site, and this is where the removal
 * mechanics actually live.
 */
describe('Dispatcher — startup sweep (spec/worktrees.md "Startup sweep — a dead wave\'s residue is removed at the next start")', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Residue a killed tick left at `path`, on `branch`: a registered worktree
   * carrying the stamp of the state root these dispatchers sweep for. The
   * registry alone cannot say who provisioned a directory — it names every
   * worktree of the *repository*, a second checkout's live trees included —
   * so the stamp is what the sweep removes on (`spec/worktrees.md`, *Startup
   * sweep — a dead wave's residue is removed at the next start*). Written by
   * the real `stampWorktree` rather than spelled here, so a fixture cannot
   * agree with a reader that drifted (`.claude/rules/engineering.md`, *A seam
   * gate reads what the real writer wrote*).
   */
  async function plantResidue(path: string, branch: string): Promise<void> {
    await exec("git", ["worktree", "add", "-B", branch, path, "HEAD"], {
      cwd: fx.repo,
    });
    await stampWorktree(path, defaultStateRoot(fx.repo));
  }

  it("a worktree/branch abandoned by a killed tick, whose entry is no longer pending, is removed at the next loop start: the startup sweep leaves the orphan's path out of the repo's worktree registry", async () => {
    const repoOpts = { cwd: fx.repo };
    const wtPath = join(fx.repo, ".flume", "worktrees", "orphan");
    await mkdir(dirname(wtPath), { recursive: true });
    // Exactly what a killed fanout tick leaves behind: a registered git
    // worktree on a flume/** branch, teardown never having run, and no
    // pending entry naming it (a dropped entry left the queue entirely).
    await plantResidue(wtPath, "flume/orphan");
    // Vacuity pin: the orphan is really in the registry going in, so the
    // absence asserted after the sweep is a removal and not a path git
    // never named.
    expect(await registeredWorktrees()).toEqual([resolve(wtPath)]);

    const dispatcher = new Dispatcher({
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async () => {}),
      log: silent,
    });

    await dispatcher.sweepStaleWorktrees();

    expect(existsSync(wtPath)).toBe(false);
    expect(await registeredWorktrees()).toEqual([]);
    const { stdout: branches } = await exec(
      "git",
      ["branch", "--list", "flume/orphan"],
      repoOpts,
    );
    expect(branches.trim()).toBe("");
  });

  // spec/worktrees.md "Placement": *the base is resolved once* — creation
  // and the sweep read one resolution, the chain's declaration included.
  // The failure this pins is the one field-traced four times: a sweep that
  // bases on the default reads an empty directory and removes nothing,
  // leaving every worktree still standing at the real base — and, since the
  // branch leg reaps only what the directory leg removed, every branch those
  // worktrees hold. Residue is planted by hand rather than by a prior tick because
  // what the sweep exists for is a run that died before teardown.
  it("the startup sweep reads the chain-declared base", async () => {
    const savedOverride = process.env.FLUME_WORKTREES_DIR;
    delete process.env.FLUME_WORKTREES_DIR;
    const container = await mkTempDir("flume-sweep-declared-");
    const repoOpts = { cwd: fx.repo };
    const base = join(container, "declared-base");
    const orphan = join(base, "orphan");
    try {
      await mkdir(base, { recursive: true });
      await plantResidue(orphan, "flume/orphan");

      // Vacuity pin (`.claude/rules/engineering.md`, "A green verdict is
      // proven non-vacuous"): the residue is really there, really
      // registered, and really outside the default base — so the removals
      // asserted below are removals rather than three things that were
      // never created.
      expect(existsSync(orphan)).toBe(true);
      expect(await registeredWorktrees()).toEqual([resolve(orphan)]);
      expect(existsSync(join(fx.repo, ".flume", "worktrees"))).toBe(false);

      const chain: Chain = {
        phases: [makePhase({ name: "build", concurrency: "fanout" })],
        humanOnly: [],
        worktreesBase: () => base,
      };
      const dispatcher = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        agent: singleAgent(async () => {}),
        log: silent,
      });

      await dispatcher.sweepStaleWorktrees();

      expect(existsSync(orphan)).toBe(false);
      expect(await registeredWorktrees()).toEqual([]);
      const { stdout: branches } = await exec(
        "git",
        ["branch", "--list", "flume/orphan"],
        repoOpts,
      );
      expect(branches.trim()).toBe("");
    } finally {
      if (savedOverride === undefined) delete process.env.FLUME_WORKTREES_DIR;
      else process.env.FLUME_WORKTREES_DIR = savedOverride;
      await exec("git", ["worktree", "remove", "--force", orphan], repoOpts).catch(
        () => {},
      );
      await rm(container, { recursive: true, force: true });
      await exec("git", ["worktree", "prune"], repoOpts).catch(() => {});
      await exec("git", ["branch", "-D", "flume/orphan"], repoOpts).catch(() => {});
    }
  });

  it("the sweep leaves a directory git does not register as a worktree standing, and still removes this run's own registered residue beside it", async () => {
    const savedOverride = process.env.FLUME_WORKTREES_DIR;
    const container = await mkTempDir("flume-sweep-unregistered-");
    const repoOpts = { cwd: fx.repo };
    const base = join(container, "wt-base");
    const foreignPath = join(base, "not-ours");
    try {
      process.env.FLUME_WORKTREES_DIR = base;

      // A directory at the exact level the sweep reads that git disclaims:
      // an operator's own tree under a relocated base, or residue whose
      // worktree registration git has already pruned. Indistinguishable by
      // name from one of this run's own bounded `dirName` entries, so a
      // `readdir` + blind removal would take it.
      await mkdir(foreignPath, { recursive: true });
      await writeFile(join(foreignPath, "keep.txt"), "not flume's to delete\n");

      // This run's own abandoned residue, at the same level — what the sweep
      // IS here for.
      const ownPath = join(base, "own-orphan");
      await plantResidue(ownPath, "flume/own-orphan");
      // Vacuity pin: the registered tree really is registered and the
      // disclaimed one really is not, so the survives/removed split asserted
      // below is a split rather than two paths the registry never held.
      expect(await registeredWorktrees()).toEqual([resolve(ownPath)]);
      expect(existsSync(foreignPath)).toBe(true);

      const dispatcher = new Dispatcher({
        repoRoot: fx.repo,
        configDir: fx.configDir,
        agent: singleAgent(async () => {}),
        log: silent,
      });

      await dispatcher.sweepStaleWorktrees();

      // The disclaimed directory survives, contents intact.
      expect(await readFile(join(foreignPath, "keep.txt"), "utf8")).toBe(
        "not flume's to delete\n",
      );

      // This run's own residue is removed, directory and branch alike.
      expect(existsSync(ownPath)).toBe(false);
      expect(await registeredWorktrees()).toEqual([]);
      const { stdout: ownBranches } = await exec(
        "git",
        ["branch", "--list", "flume/own-orphan"],
        repoOpts,
      );
      expect(ownBranches.trim()).toBe("");
    } finally {
      if (savedOverride === undefined) delete process.env.FLUME_WORKTREES_DIR;
      else process.env.FLUME_WORKTREES_DIR = savedOverride;
      await rm(container, { recursive: true, force: true });
      await exec("git", ["worktree", "prune"], repoOpts).catch(() => {});
    }
  });

  it("an empty worktree base sweeps silently", async () => {
    // No `.flume/worktrees` dir was ever created — the normal case for a
    // fresh checkout or a run that never provisioned a worktree.
    const warnings: string[] = [];
    const log: Logger = {
      info: () => {},
      warn: (l) => warnings.push(l),
      error: () => {},
    };
    const dispatcher = new Dispatcher({
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async () => {}),
      log,
    });

    await expect(dispatcher.sweepStaleWorktrees()).resolves.toBeUndefined();
    expect(warnings).toEqual([]);
  });

  it("a directory that cannot be removed (EBUSY) warns once at run level and does not abort the run", async () => {
    const wtPath = join(fx.repo, ".flume", "worktrees", "stuck");
    await mkdir(dirname(wtPath), { recursive: true });
    // Must be a registered worktree, not a bare directory — the sweep only
    // attempts removal on paths git itself lists ("the sweep leaves a
    // directory git does not register as a worktree standing…", above), so
    // an unregistered directory would never reach the mocked
    // `removeWorktree` below.
    await plantResidue(wtPath, "flume/stuck");

    // Stands in for the win32 EBUSY/locked-handle class the real
    // removal-fallback exhausts on (`removeWorktree`) — the sweep
    // never distinguishes *why* removal failed, only that it did.
    vi.spyOn(git, "removeWorktree").mockRejectedValue(
      new Error("worktree directory survived removal fallback: " + wtPath),
    );

    const warnings: string[] = [];
    const log: Logger = {
      info: () => {},
      warn: (l) => warnings.push(l),
      error: () => {},
    };
    const dispatcher = new Dispatcher({
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async () => {}),
      log,
    });

    await expect(dispatcher.sweepStaleWorktrees()).resolves.toBeUndefined();

    // Never aborted — the directory is left exactly as it was, not
    // half-cleaned, and the call returned rather than throwing.
    expect(existsSync(wtPath)).toBe(true);
    // Deliberately narrowed to the "survived removal" message: it is the one
    // report a surviving directory earns. Its branch is not reaped at all —
    // the leg reaps what the directory leg removed, and this directory stands
    // with the ref still checked out in it.
    const survivalWarnings = warnings.filter(
      (w) => w.includes(wtPath) && w.includes("survived removal"),
    );
    expect(survivalWarnings).toHaveLength(1);
    expect(survivalWarnings[0]).toContain("survived removal");
  });
});

/**
 * Replays the incident shape (the loop log of 2026-07-29, batch
 * 3): a deterministic pre-tick worktree provisioning failure on ONE entry's
 * slug must not crash the whole fanout wave when its siblings are perfectly
 * pickable. `git.addWorktree` is spied to fail for exactly one slug — the
 * dispatcher never distinguishes *which* git call inside `createWorktree`
 * threw, so this stands in for the incident's `git worktree remove`/`rm`
 * EBUSY wall without depending on genuine OS-level file locking.
 */
describe("Dispatcher fanout — pre-tick worktree provisioning failure isolates one entry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the held slug's entry stays pending with a signature; siblings still ship to batch completion", async () => {
    const entries = [
      makeEntry("HELD-ENTRY", ["src/held.ts"]),
      makeEntry("OK-A", ["src/ok-a.ts"]),
      makeEntry("OK-B", ["src/ok-b.ts"]),
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const realAddWorktree = git.addWorktree;
    vi.spyOn(git, "addWorktree").mockImplementation(async (opts) => {
      if (opts.path.includes("held-entry")) {
        throw new Error(
          "worktree directory survived removal fallback: " + opts.path,
        );
      }
      return realAddWorktree(opts);
    });

    const phase = makePhase({ name: "build", concurrency: "fanout" });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const agent = fanoutAgent({
      "ok-a": (cwd) =>
        writeAndCommit(cwd, "src/ok-a.ts", "A\n", "build(OK-A): ship"),
      "ok-b": (cwd) =>
        writeAndCommit(cwd, "src/ok-b.ts", "B\n", "build(OK-B): ship"),
    });

    const warnings: string[] = [];
    const log: Logger = {
      info: () => {},
      warn: (l) => warnings.push(l),
      error: () => {},
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log,
    });

    const outcome = await dispatcher.tick();

    // The other two entries batch-completed this same tick — the held
    // entry's failure never reached them.
    expect(outcome.result?.committed).toBe(true);
    expect(outcome.result?.shippedTags?.slice().sort()).toEqual([
      "OK-A",
      "OK-B",
    ]);

    // The held entry carries a comparable signature and stays pending —
    // pending.json itself is never touched for a provisioning failure.
    expect(outcome.provisionFailures).toEqual([
      expect.objectContaining({
        tag: "HELD-ENTRY",
        signature: expect.stringContaining("worktree directory survived"),
      }),
    ]);
    const pendingTags = (readPendingFromDisk(fx.repo)).map(
      (e) => e.tag,
    );
    expect(pendingTags).toEqual(["HELD-ENTRY"]);

    expect(
      warnings.some(
        (w) => w.includes("HELD-ENTRY") && w.includes("provisioning failed"),
      ),
    ).toBe(true);
  });
});

/**
 * WORKTREES-SETUPHOOK-ISOLATION — mirrors the `createWorktree` isolation test
 * above, one seam later: `phase.setupWorktree` throwing for one entry must
 * not reject the `Promise.all` and crash the whole wave. Before this fix the
 * hook ran unguarded, so this throw would propagate straight out of
 * `runFanout` and fail the tick even though the sibling was perfectly
 * pickable.
 */
describe("Dispatcher fanout — setupWorktree hook throw isolates one entry (WORKTREES-SETUPHOOK-ISOLATION)", () => {
  it("the throwing entry is recorded in provisionFailures and stays pending; the other proceeds to runFanoutEntry", async () => {
    const entries = [
      makeEntry("FAIL-HOOK", ["src/fail-hook.ts"]),
      makeEntry("OK-A", ["src/ok-a.ts"]),
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      setupWorktree: async (ctx) => {
        if (ctx.worktreeKey === "FAIL-HOOK") {
          throw new Error("setupWorktree boom for FAIL-HOOK");
        }
        return undefined;
      },
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    // `fanoutAgent` throws if invoked for a slug with no registered action —
    // FAIL-HOOK's worktree must never reach the agent, so only "ok-a" is
    // registered.
    const agent = fanoutAgent({
      "ok-a": (cwd) =>
        writeAndCommit(cwd, "src/ok-a.ts", "A\n", "build(OK-A): ship"),
    });

    const warnings: string[] = [];
    const log: Logger = {
      info: () => {},
      warn: (l) => warnings.push(l),
      error: () => {},
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log,
    });

    const outcome = await dispatcher.tick();

    // The sibling shipped — the hook throw for FAIL-HOOK never reached it.
    expect(outcome.result?.committed).toBe(true);
    expect(outcome.result?.shippedTags).toEqual(["OK-A"]);

    // FAIL-HOOK is parked via provisionFailures exactly like a createWorktree
    // failure — tagged, with a comparable signature — and stays pending.
    expect(outcome.provisionFailures).toEqual([
      expect.objectContaining({
        tag: "FAIL-HOOK",
        signature: expect.stringContaining("setupWorktree boom"),
      }),
    ]);
    const pendingTags = (readPendingFromDisk(fx.repo)).map(
      (e) => e.tag,
    );
    expect(pendingTags).toEqual(["FAIL-HOOK"]);

    expect(
      warnings.some(
        (w) => w.includes("FAIL-HOOK") && w.includes("setupWorktree hook failed"),
      ),
    ).toBe(true);
  });

  it("worktree/extraEnv indices stay aligned to the surviving entries after a sibling's hook failure is spliced out", async () => {
    const entries = [
      makeEntry("ENTRY-A", ["src/a.ts"]),
      makeEntry("ENTRY-B", ["src/b.ts"]),
      makeEntry("ENTRY-C", ["src/c.ts"]),
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      // ENTRY-B's hook throws; A and C each get an extraEnv value keyed to
      // their own tag, so a misaligned splice (surviving entry fed the
      // wrong neighbor's extraEnv/worktree) shows up as a mismatch below.
      setupWorktree: async (ctx) => {
        if (ctx.worktreeKey === "ENTRY-B") {
          throw new Error("setupWorktree boom for ENTRY-B");
        }
        return { extraEnv: { WT_TAG: ctx.worktreeKey } };
      },
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const invokedSlugs: string[] = [];
    const seenExtraEnv: Record<string, string | undefined> = {};
    const agent: Agent = {
      name: "align-check-agent",
      async invoke(inv) {
        const slug = basename(inv.cwd);
        invokedSlugs.push(slug);
        seenExtraEnv[slug] = inv.extraEnv?.WT_TAG;
        if (slug === "entry-a") {
          await writeAndCommit(inv.cwd, "src/a.ts", "A\n", "build(ENTRY-A): ship");
        } else if (slug === "entry-c") {
          await writeAndCommit(inv.cwd, "src/c.ts", "C\n", "build(ENTRY-C): ship");
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(invokedSlugs.slice().sort()).toEqual(["entry-a", "entry-c"]);
    expect(seenExtraEnv["entry-a"]).toBe("ENTRY-A");
    expect(seenExtraEnv["entry-c"]).toBe("ENTRY-C");

    expect(outcome.result?.shippedTags?.slice().sort()).toEqual([
      "ENTRY-A",
      "ENTRY-C",
    ]);
    expect(outcome.provisionFailures).toEqual([
      expect.objectContaining({ tag: "ENTRY-B" }),
    ]);
    const pendingTags = (readPendingFromDisk(fx.repo)).map(
      (e) => e.tag,
    );
    expect(pendingTags).toEqual(["ENTRY-B"]);
  });
});

/**
 * TICKRESULT-PROVISION-FAILURES — the reporting half of the isolation above.
 * The dispatcher already drops a provision-failed entry from the wave; these
 * pin where the chain learns of it: on the `TickResult` `handoff` receives,
 * under the entry's own tag, and *not* as an `entries` record with every flag
 * false (spec/chain.md "What a hook receives"). Nothing else on that surface
 * names it — it is absent from every tag list and unchanged in `pendingAfter`
 * — so before this the only way to reconcile a dropped entry was to re-derive
 * the batch the chain never saw.
 */
describe("Dispatcher fanout — a dropped entry is named on TickResult.provisionFailures (TICKRESULT-PROVISION-FAILURES)", () => {
  /** Runs one wave whose middle entry's setup hook throws; yields what `handoff` was handed. */
  async function waveWithFailingHook(): Promise<TickResult> {
    await writePending(fx.repo, [
      makeEntry("FAIL-HOOK", ["src/fail-hook.ts"]),
      makeEntry("OK-A", ["src/ok-a.ts"]),
      makeEntry("OK-B", ["src/ok-b.ts"]),
    ]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    let handedToHandoff: TickResult | undefined;
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      setupWorktree: async (ctx) => {
        if (ctx.worktreeKey === "FAIL-HOOK") {
          throw new Error("setupWorktree boom for FAIL-HOOK");
        }
        return undefined;
      },
      handoff: (r) => {
        handedToHandoff = r;
        return [];
      },
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      // `fanoutAgent` throws for an unregistered slug — FAIL-HOOK's worktree
      // must never reach the agent, so only the two siblings are registered.
      agent: fanoutAgent({
        "ok-a": (cwd) =>
          writeAndCommit(cwd, "src/ok-a.ts", "A\n", "build(OK-A): ship"),
        "ok-b": (cwd) =>
          writeAndCommit(cwd, "src/ok-b.ts", "B\n", "build(OK-B): ship"),
      }),
      log: silent,
    });
    await dispatcher.tick();

    expect(handedToHandoff).toBeDefined();
    return handedToHandoff!;
  }

  it("a fanout entry whose `setupWorktree` hook throws reaches `handoff` under `provisionFailures` with its tag, and is absent from `entries`", async () => {
    const result = await waveWithFailingHook();

    expect(result.provisionFailures).toEqual([
      expect.objectContaining({
        tag: "FAIL-HOOK",
        signature: expect.stringContaining("setupWorktree boom"),
        message: expect.stringContaining("setupWorktree boom"),
      }),
    ]);

    // Non-vacuity: the wave really did report per-entry records — the
    // absence below is FAIL-HOOK's alone, not an empty `entries`.
    expect(result.entries).toBeDefined();
    expect(result.entries!.length).toBe(2);
    expect(result.entries!.map((e) => e.tag)).not.toContain("FAIL-HOOK");

    // And no other field on this surface names it: it is in no tag list, and
    // `pendingAfter` carries it exactly as an unpicked entry would look.
    expect(result.shippedTags).not.toContain("FAIL-HOOK");
    expect(result.revertedTags).not.toContain("FAIL-HOOK");
    expect(result.pendingAfter.map((e) => e.tag)).toEqual(["FAIL-HOOK"]);
  });

  it("its siblings still run, ship, and appear in `entries`", async () => {
    const result = await waveWithFailingHook();

    expect(result.shippedTags.slice().sort()).toEqual(["OK-A", "OK-B"]);
    const byTag = new Map((result.entries ?? []).map((e) => [e.tag, e]));
    expect([...byTag.keys()].sort()).toEqual(["OK-A", "OK-B"]);
    expect(byTag.get("OK-A")).toEqual({
      tag: "OK-A",
      extension: {},
      committed: true,
      shipped: true,
      reverted: false,
      mergeOutcome: "merged",
    });
    expect(byTag.get("OK-B")).toEqual({
      tag: "OK-B",
      extension: {},
      committed: true,
      shipped: true,
      reverted: false,
      mergeOutcome: "merged",
    });
  });

  it("a singleton whose setupWorktree hook throws carries the same record on the TickResult handoff receives", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    let handedToHandoff: TickResult | undefined;
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      setupWorktree: async () => {
        throw new Error("setupWorktree boom for the singleton");
      },
      handoff: (r) => {
        handedToHandoff = r;
        return [];
      },
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      // The hook throws before the agent — invoking it at all is a failure.
      agent: {
        name: "never-invoked",
        async invoke() {
          throw new Error("agent invoked after a failed setupWorktree hook");
        },
      },
      log: silent,
    });
    const outcome = await dispatcher.tick();

    // A singleton has no entry tag, so the record is untagged — the fact the
    // chain reads is that provisioning failed at all, which `committed: false`
    // alone cannot distinguish from a tick that ran and did nothing.
    expect(handedToHandoff?.committed).toBe(false);
    expect(handedToHandoff?.provisionFailures).toEqual([
      expect.objectContaining({
        signature: expect.stringContaining("setupWorktree boom"),
        message: expect.stringContaining("setupWorktree boom"),
      }),
    ]);
    expect(outcome.provisionFailures).toEqual(
      handedToHandoff?.provisionFailures,
    );
  });
});

/**
 * TICKRESULT-PRIOR-ATTEMPTS — the prior-attempt store on the surface a
 * `handoff` reads. The engine already hands the map to `promptArgs` through
 * `TickContext.priorAttempts`, but that read is taken *before* the agent
 * runs: the store is written during a tick (a clean exit, a refused render,
 * a gate revert, a park) and retired for every tag the ledger rewrite
 * dropped. A handoff asking "is a standing refusal waiting on a producer"
 * therefore had only the tick's own `noCommit`/`mergeOutcome` to rebuild the
 * answer from — the engine's classification respelled by a chain, over an
 * evidence that reaches one tick back (`.claude/rules/engineering.md`, "A
 * fact the engine holds is reported, never rediscovered").
 *
 * Both halves of "as the tick left them" are driven here by the engine's own
 * writes, never a hand-planted file: one wave walls both entries so the
 * store opens the second wave populated, and the second wave ships one of
 * them and walls the other.
 */
describe("Dispatcher fanout — the record store as the tick left it (TICKRESULT-PRIOR-ATTEMPTS)", () => {
  it("TickResult carries the standing prior-attempt records as the tick left them", async () => {
    const flumeDir = join(fx.repo, ".flume");
    const ships = makeEntry("SHIPS-CLEAN", ["src/ships-clean.ts"]);
    const walls = makeEntry("WALLS-AGAIN", ["src/walls-again.ts"]);
    await writePending(fx.repo, [ships, walls]);

    let openedWith: ReadonlyMap<string, PriorAttempt> | undefined;
    let handedToHandoff: TickResult | undefined;
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      promptArgs: (ctx) => {
        openedWith = ctx.priorAttempts;
        return {};
      },
      handoff: (r) => {
        handedToHandoff = r;
        return [];
      },
    });
    const dispatcher = (bySlug: Record<string, (cwd: string) => Promise<void>>) =>
      new Dispatcher({
        chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        agent: fanoutAgent(bySlug),
        log: silent,
        maxParallel: 4,
      });

    // Wave one: neither agent commits, so the engine files a clean-exit
    // record for each and both entries stay queued.
    const nothing = async (): Promise<void> => {};
    new Baton(flumeDir).wake("build");
    await dispatcher({ "ships-clean": nothing, "walls-again": nothing }).tick();
    expect(existsSync(priorAttemptPath(flumeDir, entryRef("SHIPS-CLEAN")))).toBe(true);
    expect(existsSync(priorAttemptPath(flumeDir, entryRef("WALLS-AGAIN")))).toBe(true);

    // Wave two: one entry ships — which retires its record — and the other
    // walls again, which rewrites its own.
    new Baton(flumeDir).wake("build");
    await dispatcher({
      "ships-clean": (cwd) =>
        writeAndCommit(cwd, "src/ships-clean.ts", "A\n", "build(SHIPS-CLEAN): ship"),
      "walls-again": nothing,
    }).tick();

    expect(handedToHandoff).toBeDefined();
    const result = handedToHandoff!;

    // Non-vacuity, and the two facts that make the comparison mean
    // something: this wave really did ship one entry and wall the other, and
    // the store it *opened* on carried a record for both.
    expect(result.shippedTags).toEqual(["SHIPS-CLEAN"]);
    expect(openedWith).toBeDefined();
    expect([...openedWith!.keys()].sort()).toEqual(
      [entryAttemptKey(ships), entryAttemptKey(walls)].sort(),
    );

    // The reported map is the store as this wave left it: the shipped
    // entry's record is gone, the walled entry's stands, and each is under
    // the engine's own key for it.
    expect([...result.priorAttempts.keys()]).toEqual([entryAttemptKey(walls)]);
    expect(result.priorAttempts.get(entryAttemptKey(walls))?.mode).toBe("clean-exit");
    expect(result.priorAttempts.get(entryAttemptKey(ships))).toBeUndefined();

    // ... and the map agrees with the disk the next tick will read.
    expect(existsSync(priorAttemptPath(flumeDir, entryRef("SHIPS-CLEAN")))).toBe(false);
    expect(existsSync(priorAttemptPath(flumeDir, entryRef("WALLS-AGAIN")))).toBe(true);
  });
});

/**
 * TICK-RESULT-REPORTS-THE-WAVES-GATE-FAILURES — `gateResults` carries one
 * row per gate run, untagged and in run order, so a `handoff` asking which
 * of a wave's entries a gate reverted, and how many fell to one gate on one
 * message, had to re-pair failing rows against the tag lists and re-derive
 * the signature beside the engine. The wave's own `GateFailure` records are
 * that fact, already built for the verdict
 * (`.claude/rules/engineering.md`, "A fact the engine holds is reported,
 * never rediscovered").
 */
describe("Dispatcher fanout — the wave's gate failures reach handoff (TICK-RESULT-REPORTS-THE-WAVES-GATE-FAILURES)", () => {
  it("a fanout wave's TickResult reports each entry's gate failure with the signature the tick verdict recorded", async () => {
    await writePending(fx.repo, [
      makeEntry("GATE-FAIL-A", ["src/gate-fail-a.ts"]),
      makeEntry("GATE-FAIL-B", ["src/gate-fail-b.ts"]),
    ]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    // One gate, one message, both entries — the repeat a chain counts, and
    // the case `gateResults` alone cannot report: two identical failing
    // rows that name neither entry.
    const veto: Gate = {
      name: "wave-veto",
      when: "afterCommit",
      run: async () => ({ ok: false, message: "wave veto" }),
    };

    let handedToHandoff: TickResult | undefined;
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      gates: [veto],
      handoff: (r) => {
        handedToHandoff = r;
        return [];
      },
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({
        "gate-fail-a": (cwd) =>
          writeAndCommit(
            cwd,
            "src/gate-fail-a.ts",
            "A\n",
            "build(GATE-FAIL-A): ship",
          ),
        "gate-fail-b": (cwd) =>
          writeAndCommit(
            cwd,
            "src/gate-fail-b.ts",
            "B\n",
            "build(GATE-FAIL-B): ship",
          ),
      }),
      log: silent,
      maxParallel: 4,
    });
    const outcome = await dispatcher.tick();

    expect(handedToHandoff).toBeDefined();
    const reported = [...(handedToHandoff!.gateFailures ?? [])].sort((a, b) =>
      (a.tag ?? "").localeCompare(b.tag ?? ""),
    );
    // Non-vacuity: the wave really did revert both entries, so what follows
    // is judged over two blamed records and not over an empty list.
    expect(reported).toHaveLength(2);

    // The signature is the engine's own rule over the gate that failed —
    // read through `gateFailureSignature`, never re-spelled here, so the
    // claim is agreement rather than a second derivation by the tester.
    const signature = gateFailureSignature({
      gate: "wave-veto",
      message: "wave veto",
    });
    expect(reported).toEqual([
      expect.objectContaining({
        tag: "GATE-FAIL-A",
        signature,
        message: "wave veto",
      }),
      expect.objectContaining({
        tag: "GATE-FAIL-B",
        signature,
        message: "wave veto",
      }),
    ]);

    // Each record is held under the entry's own quarantine key, as the
    // engine's rule computes it from the queue the wave read — the two
    // entries are both still pending, the afterCommit revert having kept
    // their commits off trunk.
    const stillPending = readPendingFromDisk(fx.repo);
    expect(stillPending.map((e) => e.tag)).toEqual([
      "GATE-FAIL-A",
      "GATE-FAIL-B",
    ]);
    expect(reported.map((f) => f.quarantineKey)).toEqual(
      stillPending.map((e) => entryDeclaredKey(e)),
    );

    // One set of facts, two surfaces: what `handoff` read is what the
    // verdict persisted and what the outcome carries, byte for byte.
    expect(handedToHandoff!.gateFailures).toEqual(outcome.verdict?.gateFailures);
    expect(handedToHandoff!.gateFailures).toEqual(outcome.gateFailures);
    expect(outcome.result?.gateFailures).toEqual(handedToHandoff!.gateFailures);

    // And `gateResults` — the surface a chain would otherwise re-pair —
    // still carries the rows it always did, naming neither entry.
    const failingRows = (handedToHandoff!.gateResults ?? []).filter(
      (g) => g.gate === "wave-veto" && !g.ok,
    );
    expect(failingRows).toHaveLength(2);
    for (const row of failingRows) {
      expect(Object.keys(row)).not.toContain("tag");
    }
  });
});

/**
 * TICK-RESULT-REPORTS-THE-WAVES-MERGE-FAILURES — an entry whose cherry-pick
 * conflicted showed to `handoff` only as `committed: true` with no tag in
 * `shippedTags`, plus a `mergeOutcome` naming the fate and the span. Neither
 * says why git refused, and neither carries the signature or quarantine key
 * the engine already built for the verdict — so a chain counting repeats of
 * one collision had to re-derive both beside the engine
 * (`.claude/rules/engineering.md`, "A fact the engine holds is reported,
 * never rediscovered").
 */
describe("Dispatcher fanout — the wave's merge failures reach handoff (TICK-RESULT-REPORTS-THE-WAVES-MERGE-FAILURES)", () => {
  it("a fanout wave's TickResult reports each entry's merge failure with the signature the tick verdict recorded", async () => {
    // Three entries with disjoint declared files, all three also writing the
    // shared channel file. A's pick lands 'from-A' on trunk; B's and C's
    // diffs both expect 'baseline' there and conflict — two merge failures
    // in one wave, which is the plural case `mergeOutcome` reports one row
    // at a time and the tag lists cannot express at all.
    await mkdir(join(fx.repo, "src"), { recursive: true });
    await writeFile(join(fx.repo, "src", "shared.ts"), "baseline\n");
    await exec("git", ["add", "--", "src/shared.ts"], { cwd: fx.repo });
    await exec("git", ["commit", "-q", "-m", "seed shared"], { cwd: fx.repo });

    await writePending(fx.repo, [
      makeEntry("MERGE-FAIL-A", ["src/merge-fail-a.ts"]),
      makeEntry("MERGE-FAIL-B", ["src/merge-fail-b.ts"]),
      makeEntry("MERGE-FAIL-C", ["src/merge-fail-c.ts"]),
    ]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const writeBoth = (declared: string, mark: string) => async (cwd: string) => {
      await mkdir(join(cwd, "src"), { recursive: true });
      await writeFile(join(cwd, "src", declared), `${mark}\n`);
      await writeFile(join(cwd, "src", "shared.ts"), `from-${mark}\n`);
      await exec("git", ["add", "."], { cwd });
      await exec("git", ["commit", "-q", "-m", `build: ${mark}`], { cwd });
    };

    let handedToHandoff: TickResult | undefined;
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      entryChannelPaths: ["src/shared.ts"],
      gates: [],
      handoff: (r) => {
        handedToHandoff = r;
        return [];
      },
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({
        "merge-fail-a": writeBoth("merge-fail-a.ts", "A"),
        "merge-fail-b": writeBoth("merge-fail-b.ts", "B"),
        "merge-fail-c": writeBoth("merge-fail-c.ts", "C"),
      }),
      log: silent,
      maxParallel: 4,
    });
    const outcome = await dispatcher.tick();

    expect(handedToHandoff).toBeDefined();
    const reported = [...(handedToHandoff!.mergeFailures ?? [])].sort((a, b) =>
      (a.tag ?? "").localeCompare(b.tag ?? ""),
    );
    // Non-vacuity: the wave really did leave two spans off trunk, so what
    // follows is judged over two blamed records and not over an empty list.
    expect(reported).toHaveLength(2);
    expect(reported.map((f) => f.tag)).toEqual([
      "MERGE-FAIL-B",
      "MERGE-FAIL-C",
    ]);
    // Only A's work landed — the wave committed, so `committed`/`shippedTags`
    // alone say nothing about the two that did not.
    expect(handedToHandoff!.shippedTags).toEqual(["MERGE-FAIL-A"]);
    expect(handedToHandoff!.committed).toBe(true);

    // Each record carries git's own refusal and a signature derived from it
    // — the value the consecutive-failure backstop compares repeats by,
    // which no field on the handoff surface previously carried.
    for (const failure of reported) {
      expect(failure.message).toMatch(/conflict/i);
      expect(failure.signature.length).toBeGreaterThan(0);
    }

    // Held under each entry's own quarantine key, as the engine's rule
    // computes it from the queue the wave read: both entries are still
    // pending, their commits having stayed off trunk.
    const stillPending = readPendingFromDisk(fx.repo);
    expect(stillPending.map((e) => e.tag)).toEqual([
      "MERGE-FAIL-B",
      "MERGE-FAIL-C",
    ]);
    expect(reported.map((f) => f.quarantineKey)).toEqual(
      stillPending.map((e) => entryDeclaredKey(e)),
    );

    // One set of facts, three surfaces: what `handoff` read is what the
    // verdict persisted and what the outcome carries, byte for byte — so a
    // signature a chain routes on and a signature the run's backstop
    // compares cannot drift apart.
    expect(handedToHandoff!.mergeFailures).toEqual(
      outcome.verdict?.mergeFailures,
    );
    expect(handedToHandoff!.mergeFailures).toEqual(outcome.mergeFailures);
    expect(outcome.result?.mergeFailures).toEqual(
      handedToHandoff!.mergeFailures,
    );

    // And the per-entry outcomes — the surface a chain would otherwise read
    // instead — still name the fate and the span alone, with no signature
    // and no quarantine key on them.
    const conflicted = (outcome.verdict?.mergeOutcomes ?? []).filter(
      (m) => m.outcome === "cherry-pick-conflict",
    );
    expect(conflicted.map((m) => m.entryTag).sort()).toEqual([
      "MERGE-FAIL-B",
      "MERGE-FAIL-C",
    ]);
    for (const row of conflicted) {
      expect(Object.keys(row)).not.toContain("signature");
      expect(Object.keys(row)).not.toContain("quarantineKey");
    }
  });
});

/**
 * SINGLETON-PRUNE-PROVISION-FAILURE — `runSingleton`'s pre-tick
 * `pruneWorktrees` used to warn and drop the throw on the floor, so a
 * deterministic prune wall on a singleton-only chain repeated every tick
 * with the consecutive-failure backstop blind to it (spec/loop.md "Repeated
 * identical failures": the accounting covers every per-entry failure fact
 * the verdict records, and prune is one of the three provision-stage
 * sources it names). `runFanout` already accumulated its wave-level prune
 * throw; these pin the same shape on the singleton path, including the leg
 * that costs nothing today — creation succeeding afterwards.
 */
describe("Dispatcher singleton — a worktree-prune throw is recorded, not just logged (SINGLETON-PRUNE-PROVISION-FAILURE)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a singleton whose worktree prune throws and whose creation then succeeds still reports the prune failure", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    vi.spyOn(git, "pruneWorktrees").mockImplementation(async () => {
      throw new Error("prune wall: .git/worktrees metadata is unreadable");
    });

    let handedToHandoff: TickResult | undefined;
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      handoff: (r) => {
        handedToHandoff = r;
        return [];
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent((cwd) =>
        writeAndCommit(cwd, "src/pruned.ts", "landed\n", "plan: ship"),
      ),
      log: silent,
    });

    const outcome = await dispatcher.tick();

    // Non-vacuity, and the whole point of this leg: creation survived the
    // prune wall and the tick shipped. Before the fix this was the exact
    // shape that recorded nothing at all.
    expect(outcome.result?.committed).toBe(true);
    expect(outcome.verdict?.committed).toBe(true);

    const expected = [
      expect.objectContaining({
        signature: expect.stringContaining("prune wall"),
        message: expect.stringContaining("prune wall"),
      }),
    ];
    expect(outcome.provisionFailures).toEqual(expected);
    expect(outcome.result?.provisionFailures).toEqual(expected);
    expect(handedToHandoff?.provisionFailures).toEqual(expected);
    // The verdict is what `superviseLoop`'s backstop reads off disk — a
    // record that stops here is a streak that never accumulates.
    expect(outcome.verdict?.provisionFailures).toEqual(expected);
    // Repo-level: there is no entry to blame on a singleton, so nothing
    // quarantinable rides the record.
    expect(outcome.provisionFailures?.[0]?.tag).toBeUndefined();
  });

  it("a singleton's worktree-prune failure reaches both the tick result and the outcome envelope", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    vi.spyOn(git, "pruneWorktrees").mockImplementation(async () => {
      throw new Error("prune wall: .git/worktrees metadata is unreadable");
    });
    vi.spyOn(git, "addWorktree").mockImplementation(async () => {
      throw new Error("worktree directory survived removal fallback");
    });

    let handedToHandoff: TickResult | undefined;
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      handoff: (r) => {
        handedToHandoff = r;
        return [];
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: {
        name: "never-invoked",
        async invoke() {
          throw new Error("agent invoked after a failed worktree provision");
        },
      },
      log: silent,
    });

    const outcome = await dispatcher.tick();

    // Both provision-stage throws ride, in the order they happened — the
    // prune record is not swallowed by the create record that follows it.
    const expected = [
      expect.objectContaining({
        signature: expect.stringContaining("prune wall"),
      }),
      expect.objectContaining({
        signature: expect.stringContaining("survived removal fallback"),
      }),
    ];
    expect(outcome.result?.committed).toBe(false);
    expect(outcome.provisionFailures).toEqual(expected);
    expect(outcome.result?.provisionFailures).toEqual(expected);
    expect(handedToHandoff?.provisionFailures).toEqual(expected);
    expect(outcome.verdict?.provisionFailures).toEqual(expected);
  });
});

/**
 * GITDELETEBRANCH-BROAD-SWALLOW — the teardown loop wraps `git.deleteBranch`
 * in the same removeWorktree/teardownWorktree pattern: a non-benign
 * failure (branch.ts now rethrows past the "not found" case) is logged by
 * branch name rather than lost, and the wave still ships.
 */
describe("Dispatcher fanout — teardown loop warns on deleteBranch failure (GITDELETEBRANCH-BROAD-SWALLOW)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs a warning naming the branch when deleteBranch rejects for a non-benign reason", async () => {
    const entries = [makeEntry("BRANCH-WARN", ["src/branch-warn.ts"])];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    vi.spyOn(git, "deleteBranch").mockRejectedValue(
      new Error(
        "Cannot delete branch 'flume/branch-warn' checked out at '/some/path'",
      ),
    );

    const phase = makePhase({ name: "build", concurrency: "fanout" });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const agent = fanoutAgent({
      "branch-warn": (cwd) =>
        writeAndCommit(
          cwd,
          "src/branch-warn.ts",
          "x\n",
          "build(BRANCH-WARN): ship",
        ),
    });

    const warnings: string[] = [];
    const log: Logger = {
      info: () => {},
      warn: (l) => warnings.push(l),
      error: () => {},
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log,
    });

    const outcome = await dispatcher.tick();

    // The teardown loop's deleteBranch failure never blocks the ship.
    expect(outcome.result?.committed).toBe(true);
    expect(outcome.result?.shippedTags).toEqual(["BRANCH-WARN"]);

    expect(
      warnings.some((w) => w.includes("flume/branch-warn")),
    ).toBe(true);
  });
});

/**
 * Fanout worktree naming. The engine mints no namespace beneath the
 * worktree base (`spec/worktrees.md`, *Placement — the worktree base*): a
 * fanout branch is `flume/<slug>` and its directory is `<base>/<dirName>`,
 * under every resolution of that base. Two efforts are two checkouts, each
 * with its own state root and so its own base, so identical tag slugs in two
 * efforts address two directories without a level between them.
 */
describe("Dispatcher fanout — branch and path take no level beneath the base", () => {
  const savedOverride = process.env.FLUME_WORKTREES_DIR;

  afterEach(() => {
    if (savedOverride === undefined) delete process.env.FLUME_WORKTREES_DIR;
    else process.env.FLUME_WORKTREES_DIR = savedOverride;
  });

  async function branchIn(cwd: string): Promise<string> {
    const { stdout } = await exec(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd },
    );
    return stdout.trim();
  }

  it("a fanout entry runs on flume/<slug> and teardown deletes that branch", async () => {
    await writePending(fx.repo, [makeEntry("FAN-BRANCH", ["src/fan-branch.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    let observedBranch: string | undefined;
    const agent = fanoutAgent({
      "fan-branch": async (cwd) => {
        observedBranch = await branchIn(cwd);
        await writeAndCommit(
          cwd,
          "src/fan-branch.ts",
          "fan\n",
          "build(FAN-BRANCH): ship",
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    expect(outcome.result?.shippedTags).toEqual(["FAN-BRANCH"]);
    expect(observedBranch).toBe("flume/fan-branch");
    // Teardown deleted the branch under the name creation gave it.
    const { stdout: branches } = await exec(
      "git",
      ["branch", "--list", "flume/fan-branch"],
      { cwd: fx.repo },
    );
    expect(branches.trim()).toBe("");
  });

  it("a fanout entry's worktree sits directly under a relocated base", async () => {
    const container = await mkTempDir("flume-fanpath-");
    try {
      const base = join(container, "wt-base");
      process.env.FLUME_WORKTREES_DIR = base;

      await writePending(fx.repo, [makeEntry("FAN-PATH", ["src/fan-path.ts"])]);
      new Baton(join(fx.repo, ".flume")).wake("build");

      const phase = makePhase({ name: "build", concurrency: "fanout" });
      const chain: Chain = { phases: [phase], humanOnly: [] };

      let observedCwd: string | undefined;
      const agent = fanoutAgent({
        "fan-path": async (cwd) => {
          observedCwd = cwd;
          await writeAndCommit(
            cwd,
            "src/fan-path.ts",
            "fan\n",
            "build(FAN-PATH): ship",
          );
        },
      });

      const dispatcher = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        agent,
        log: silent,
      });

      const outcome = await dispatcher.tick();

      expect(outcome.result?.shippedTags).toEqual(["FAN-PATH"]);
      // The base itself, with nothing between it and the entry's directory.
      expect(observedCwd).toBe(join(base, "fan-path"));
      // … and teardown cleans it.
      expect(existsSync(join(base, "fan-path"))).toBe(false);
    } finally {
      await rm(container, { recursive: true, force: true });
    }
  });
});

describe("Dispatcher fanout — cherry-pick conflict leaves the conflicting entry in pending", () => {
  it("ships the first entry; second cherry-pick aborts; entry persists in pending", async () => {
    // Both fake agents write their declared file plus a shared baseline file
    // with different content. Declared paths are disjoint so partition packs
    // them together; the shared file is an entryChannelPaths allowance — the
    // surviving conflict vector, since disjoint declared files can no longer
    // collide directly. The first cherry-pick succeeds; the second conflicts
    // because trunk now has 'from-A' where B's diff expects 'baseline'.
    await mkdir(join(fx.repo, "src"), { recursive: true });
    await writeFile(join(fx.repo, "src", "shared.ts"), "baseline\n");
    const repoOpts = { cwd: fx.repo };
    await exec("git", ["add", "--", "src/shared.ts"], repoOpts);
    await exec("git", ["commit", "-q", "-m", "seed shared"], repoOpts);

    const entries = [
      makeEntry("CONFLICT-A", ["src/decoy-a.ts"]),
      makeEntry("CONFLICT-B", ["src/decoy-b.ts"]),
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      entryChannelPaths: ["src/shared.ts"],
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "conflict-a": async (cwd) => {
        await mkdir(join(cwd, "src"), { recursive: true });
        await writeFile(join(cwd, "src", "decoy-a.ts"), "a\n");
        await writeFile(join(cwd, "src", "shared.ts"), "from-A\n");
        await exec("git", ["add", "."], { cwd });
        await exec("git", ["commit", "-q", "-m", "build: A"], { cwd });
      },
      "conflict-b": async (cwd) => {
        await mkdir(join(cwd, "src"), { recursive: true });
        await writeFile(join(cwd, "src", "decoy-b.ts"), "b\n");
        await writeFile(join(cwd, "src", "shared.ts"), "from-B\n");
        await exec("git", ["add", "."], { cwd });
        await exec("git", ["commit", "-q", "-m", "build: B"], { cwd });
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    // Only A made it onto trunk.
    expect(outcome.result?.shippedTags).toEqual(["CONFLICT-A"]);
    expect(outcome.result?.committed).toBe(true);
    expect(await readFile(join(fx.repo, "src/shared.ts"), "utf8")).toBe(
      "from-A\n",
    );

    // pending.json now has only the un-shipped entry.
    const onDisk = readPendingFromDisk(fx.repo);
    expect(onDisk.map((e) => e.tag)).toEqual(["CONFLICT-B"]);
    expect(outcome.result?.pendingAfter.map((e) => e.tag)).toEqual([
      "CONFLICT-B",
    ]);

    // The verdict's per-entry merge outcomes distinguish the two
    // fates — A merged cleanly, B's cherry-pick itself failed.
    expect(outcome.verdict?.tags.sort()).toEqual(["CONFLICT-A", "CONFLICT-B"]);
    expect(
      [...(outcome.verdict?.mergeOutcomes ?? [])].sort((a, b) =>
        (a.entryTag ?? "").localeCompare(b.entryTag ?? ""),
      ),
    ).toEqual([
      {
        entryTag: "CONFLICT-A",
        outcome: "merged",
        baseSha: expect.stringMatching(/^[0-9a-f]{40}$/),
        headSha: expect.stringMatching(/^[0-9a-f]{40}$/),
      },
      {
        entryTag: "CONFLICT-B",
        outcome: "cherry-pick-conflict",
        footprint: ["src/decoy-b.ts", "src/shared.ts"],
        baseSha: expect.stringMatching(/^[0-9a-f]{40}$/),
        headSha: expect.stringMatching(/^[0-9a-f]{40}$/),
      },
    ]);

    // Generalized past provisioning (spec/loop.md "Repeated identical
    // failures"): a merge-stage cherry-pick conflict is recorded on the
    // verdict with a stage-tagged signature — always entry-scoped, unlike a
    // provisioning failure, so superviseLoop's quarantine leg can isolate it.
    expect(outcome.verdict?.mergeFailures).toEqual([
      expect.objectContaining({
        tag: "CONFLICT-B",
        signature: expect.any(String),
      }),
    ]);
    expect(outcome.mergeFailures).toEqual([
      expect.objectContaining({ tag: "CONFLICT-B" }),
    ]);

    // No lingering cherry-pick state in the worktree — the dispatcher
    // aborted it so the next tick starts clean. Tracked state only: the
    // claim is about the aborted pick, not about what runtime records the
    // tick left under the state root.
    const { stdout: status } = await exec(
      "git",
      ["status", "--porcelain", "--untracked-files=no"],
      { cwd: fx.repo },
    );
    expect(status.trim()).toBe("");
  });
});

// spec/loop.md "Crash equals stop", "A merge the crash interrupted is refused,
// never resumed": the merge stage stakes `<flumeDir>/merging/<slug>.json`
// before it picks an entry's span onto trunk and retires it once the queue
// rewrite lands, so a death anywhere in between leaves the fact on disk for
// the next start to refuse over (`src/cli.ts`; pinned in tests/cli.test.ts).
/**
 * SIBLING-TICKS-TAKE-TURNS-AT-GIT — the two guards a tick takes around a git
 * mutation, seen from the tick that takes them (spec/loop.md, "The ship lock
 * and the worktree lock — sibling ticks take turns at git").
 *
 * Both cases read the guard file's *holder*, never its mere presence: a file
 * left by an earlier run names a pid, and only "this process" distinguishes a
 * lock this tick is holding from residue it never touched.
 *
 * The fixture repo is a plain checkout, so its git-common-dir is `.git` and
 * both locks sit at a path the case can name without asking git again.
 */
describe("Dispatcher — the ship lock and the worktree lock (SIBLING-TICKS-TAKE-TURNS-AT-GIT)", () => {
  /** Who the guard file at `path` names, or `null` when there is no file. */
  async function holderAt(path: string): Promise<number | null> {
    if (!existsSync(path)) return null;
    return parsePidClaim(await readFile(path, "utf8"))?.pid ?? null;
  }

  it("the ship lock is held across the cherry-pick, the afterMerge gates and the ledger commit", async () => {
    await writePending(fx.repo, [makeEntry("SHIP-SPAN", ["src/ship-span.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");
    const lockPath = join(fx.repo, ".git", "flume", "ship.lock");

    // One observation per stop the spec names. Each records who held the
    // lock at that moment and then calls the real thing through, so the
    // wave runs its ordinary course around the probes.
    const heldBy: Record<string, number | null> = {};
    const realPick = git.cherryPickRange;
    vi.spyOn(git, "cherryPickRange").mockImplementation(async (...args) => {
      heldBy["cherry-pick"] = await holderAt(lockPath);
      return realPick(...args);
    });
    const realCommitPaths = git.commitPaths;
    vi.spyOn(git, "commitPaths").mockImplementation(async (opts) => {
      heldBy["ledger commit"] = await holderAt(lockPath);
      return realCommitPaths(opts);
    });
    const probe: Gate = {
      name: "ship-lock-probe",
      when: "afterMerge",
      async run() {
        heldBy["afterMerge gate"] = await holderAt(lockPath);
        return { ok: true, message: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({
        phases: [
          makePhase({ name: "build", concurrency: "fanout", gates: [probe] }),
        ],
        humanOnly: [],
      }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({
        "ship-span": (cwd) =>
          writeAndCommit(cwd, "src/ship-span.ts", "s\n", "build: SHIP-SPAN"),
      }),
      log: silent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    // Vacuity: the entry really shipped, so all three stops were reached —
    // a wave that conflicted would record a subset and "held at every stop"
    // would be a claim over one.
    expect(outcome.result?.shippedTags).toEqual(["SHIP-SPAN"]);
    expect(Object.keys(heldBy).sort()).toEqual([
      "afterMerge gate",
      "cherry-pick",
      "ledger commit",
    ]);
    expect(heldBy).toEqual({
      "cherry-pick": process.pid,
      "afterMerge gate": process.pid,
      "ledger commit": process.pid,
    });
    // Released when the span ended: a lock naming a pid that is still alive
    // would stall every sibling tick for the rest of the run.
    expect(existsSync(lockPath)).toBe(false);
  });

  it("the agent, setupWorktree and the gates run outside the worktree lock", async () => {
    await writePending(fx.repo, [makeEntry("OUTSIDE", ["src/outside.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");
    const lockPath = join(fx.repo, ".git", "flume", "worktrees.lock");

    // The arm that makes the scope claim mean anything: this tick *does*
    // take the worktree lock. Planted live before the wave, so the wave's
    // own pre-provisioning prune blocks on it and announces the wait;
    // released the moment it has, from the same promise that read the line.
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(lockPath, renderPidClaim(process.pid, new Date()), "utf8");
    const lines: string[] = [];
    const log: Logger = {
      info: (l) => lines.push(l),
      warn: () => {},
      error: () => {},
    };
    const waveWaited = waitFor(
      `the wave's wait on the worktree lock at ${lockPath}`,
      () => lines.find((l) => l.includes("waiting for the worktree lock")),
    ).then(async (line) => {
      await rm(lockPath);
      return line;
    });

    const heldDuring: Record<string, number | null> = {};
    const probe = (name: string, when: GatePhase): Gate => ({
      name,
      when,
      async run() {
        heldDuring[when] = await holderAt(lockPath);
        return { ok: true, message: "" };
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({
        phases: [
          makePhase({
            name: "build",
            concurrency: "fanout",
            setupWorktree: async () => {
              heldDuring["setupWorktree"] = await holderAt(lockPath);
              return undefined;
            },
            gates: [
              probe("outside-after-commit", "afterCommit"),
              probe("outside-after-merge", "afterMerge"),
            ],
          }),
        ],
        humanOnly: [],
      }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({
        outside: async (cwd) => {
          heldDuring["agent"] = await holderAt(lockPath);
          await writeAndCommit(cwd, "src/outside.ts", "o\n", "build: OUTSIDE");
        },
      }),
      log,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    // The wave waited on the planted holder and named the file — without
    // this, "nothing held it at the four stops below" is an absence rather
    // than a scope.
    expect(await waveWaited).toContain(lockPath);
    expect(outcome.result?.shippedTags).toEqual(["OUTSIDE"]);
    expect(Object.keys(heldDuring).sort()).toEqual([
      "afterCommit",
      "afterMerge",
      "agent",
      "setupWorktree",
    ]);
    // Provisioning holds it for the one command; everything a tick does
    // *around* a worktree is outside, or one entry's agent would queue
    // every sibling's provisioning behind it.
    expect(heldDuring).toEqual({
      setupWorktree: null,
      agent: null,
      afterCommit: null,
      afterMerge: null,
    });
  });
});

describe("Dispatcher fanout — the merge-stage crash marker", () => {
  it("the merge stage writes a merging marker naming the branch, the base sha and the entry before the pick", async () => {
    // Three entries, picked in batch order. MARK-B's pick *conflicts* and is
    // aborted — it never reaches an afterMerge gate, never lands on trunk,
    // never ships. So MARK-B's marker being on disk when MARK-C's gate runs
    // is only explicable by it having been written ahead of B's own pick:
    // no later point in B's life had the chance. (The shared file is an
    // entryChannelPaths allowance, the only way disjoint declared files can
    // still collide — same vector as the cherry-pick-conflict test above.)
    await mkdir(join(fx.repo, "src"), { recursive: true });
    await writeFile(join(fx.repo, "src", "shared.ts"), "baseline\n");
    await exec("git", ["add", "--", "src/shared.ts"], { cwd: fx.repo });
    await exec("git", ["commit", "-q", "-m", "seed shared"], { cwd: fx.repo });

    const entries = [
      makeEntry("MARK-A", ["src/decoy-a.ts"]),
      makeEntry("MARK-B", ["src/decoy-b.ts"]),
      makeEntry("MARK-C", ["src/decoy-c.ts"]),
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const preHead = await head(fx.repo);

    // Runs between each entry's pick and the wave's queue rewrite — the one
    // window the marker is supposed to be observable in.
    const seen: Array<Map<string, unknown>> = [];
    const probe: Gate = {
      name: "marker-probe",
      when: "afterMerge",
      async run() {
        seen.push(await markersNow(fx.repo));
        return { ok: true, message: "probed" };
      },
    };

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      entryChannelPaths: ["src/shared.ts"],
      gates: [probe],
    });

    const writeEntry =
      (decoy: string, shared?: string) => async (cwd: string) => {
        await mkdir(join(cwd, "src"), { recursive: true });
        await writeFile(join(cwd, "src", decoy), "x\n");
        if (shared) await writeFile(join(cwd, "src", "shared.ts"), shared);
        await exec("git", ["add", "."], { cwd });
        await exec("git", ["commit", "-q", "-m", `build: ${decoy}`], { cwd });
      };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({
        "mark-a": writeEntry("decoy-a.ts", "from-A\n"),
        "mark-b": writeEntry("decoy-b.ts", "from-B\n"),
        "mark-c": writeEntry("decoy-c.ts"),
      }),
      log: silent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    // The fates this pin depends on: all three agents committed under their
    // own gates, B's pick then conflicted (so B never reached the probe), A
    // and C picked clean (so the probe ran exactly twice).
    //
    // Read the per-entry fate off `result.entries` first, before any merge
    // row below derives from it (.claude/rules/engineering.md, "A fact the
    // engine holds is reported, never rediscovered"): a B that never
    // committed — a gate revert, a clean exit, a platform preempt — writes
    // no `mergeOutcomes` row at all, so the conflict assertion alone would
    // red with `undefined` where the engine already named the no-commit
    // class. `?? null` because `toEqual` reads an absent key and an
    // `undefined` one alike, and the class is the whole point of the line.
    expect(
      outcome.result?.entries?.map((e) => ({
        tag: e.tag,
        committed: e.committed,
        noCommit: e.noCommit ?? null,
      })),
    ).toEqual([
      { tag: "MARK-A", committed: true, noCommit: null },
      { tag: "MARK-B", committed: true, noCommit: null },
      { tag: "MARK-C", committed: true, noCommit: null },
    ]);
    expect(outcome.result?.shippedTags).toEqual(["MARK-A", "MARK-C"]);
    expect(
      outcome.verdict?.mergeOutcomes.find((m) => m.entryTag === "MARK-B")?.outcome,
    ).toBe("cherry-pick-conflict");
    // Vacuity (.claude/rules/engineering.md, "A green verdict is proven
    // non-vacuous"): a probe that never ran would leave every assertion below
    // reading an empty snapshot list.
    expect(seen, "the afterMerge probe never ran").toHaveLength(2);

    // Each entry stakes its own marker immediately before its own pick, not
    // the wave's worth up front: at A's gate only A's is on disk.
    expect([...seen[0]!.keys()]).toEqual(["mark-a.json"]);
    // At C's gate, B's marker stands alongside — written before the pick
    // that then conflicted and was aborted.
    expect([...seen[1]!.keys()]).toEqual([
      "mark-a.json",
      "mark-b.json",
      "mark-c.json",
    ]);
    expect(seen[1]!.get("mark-b.json")).toEqual({
      tag: "MARK-B",
      branch: "flume/mark-b",
      baseSha: preHead,
    });
    expect(seen[1]!.get("mark-a.json")).toEqual({
      tag: "MARK-A",
      branch: "flume/mark-a",
      baseSha: preHead,
    });
  });

  it("the merging marker is gone once the ship bookkeeping has landed", async () => {
    const entries = [makeEntry("GONE-A", ["src/gone-a.ts"])];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    let duringWave: string[] = [];
    const probe: Gate = {
      name: "marker-probe",
      when: "afterMerge",
      async run() {
        duringWave = [...(await markersNow(fx.repo)).keys()];
        return { ok: true, message: "probed" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({
        phases: [
          makePhase({ name: "build", concurrency: "fanout", gates: [probe] }),
        ],
        humanOnly: [],
      }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({
        "gone-a": async (cwd) => {
          await mkdir(join(cwd, "src"), { recursive: true });
          await writeFile(join(cwd, "src", "gone-a.ts"), "a\n");
          await exec("git", ["add", "."], { cwd });
          await exec("git", ["commit", "-q", "-m", "build: A"], { cwd });
        },
      }),
      log: silent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual(["GONE-A"]);
    // Vacuity: "gone afterwards" says nothing unless the marker was ever
    // there — the wave must have staked it mid-flight for the removal below
    // to be a removal rather than an absence.
    expect(duringWave, "no marker was staked mid-wave").toEqual([
      "gone-a.json",
    ]);
    expect([...(await markersNow(fx.repo)).keys()]).toEqual([]);
    // The queue rewrite is what the removal waits on — and it landed.
    expect((readPendingFromDisk(fx.repo)).map((e) => e.tag)).toEqual([]);
  });
});

/**
 * The one consumer of `readMergingMarkers` is the CLI's startup refusal
 * (`flume loop`), where an empty read means *start*. So
 * the listing's ENOENT-vs-other split is load-bearing: absent is the honest
 * empty answer, and anything else must escape rather than read as "no
 * interrupted merge" (`.claude/rules/engineering.md`, "Loud or nothing").
 *
 * The denial is structural, not a permission bit (`tests/helpers/denial.ts`):
 * a plain file stands where the listing wants a directory, so the read
 * refuses — and not as ENOENT — on every host and under a root-run, where a
 * mode denies nothing.
 * Same fixture shape `countFrictionFiles` and `PriorAttemptStore.readAll`
 * are pinned with. Each unreadable leg reads its fixture once *before*
 * denying it, so the throw afterwards is judged against a dir that really
 * held a marker rather than a mistyped path
 * (`.claude/rules/engineering.md`, "A green verdict is proven non-vacuous").
 *
 * Two denials, because the split is proven from the path rather than from an
 * errno: one at the dir the listing names, one at the *ancestor* above it —
 * the shape a fixture normally must not use, since a lookup through a plain
 * file answers `ENOENT` on win32 and takes an errno-keyed reader's absent arm
 * (`.claude/rules/platform-facts.md`, *win32 reports a path through a
 * non-directory as not found*). Here that is precisely the subject: the
 * descent is what makes the ancestor case refuse on both hosts, so the arm
 * asserts the reader's own refusal and never the errno underneath it.
 */
describe("readMergingMarkers — the merging dir's absent-vs-unreachable split", () => {
  it("readMergingMarkers reads an absent merging dir as no interrupted merge", async () => {
    const flumeDir = await mkTempDir("flume-mm-absent-");
    try {
      expect(existsSync(mergingDir(flumeDir))).toBe(false);
      expect(await readMergingMarkers(flumeDir)).toEqual([]);
    } finally {
      await rm(flumeDir, { recursive: true, force: true });
    }
  });

  it("readMergingMarkers throws when the merging dir cannot be read for a reason other than absence", async () => {
    const flumeDir = await mkTempDir("flume-mm-sealed-");
    const dir = mergingDir(flumeDir);
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "sealed.json"),
        JSON.stringify({
          tag: "SEALED",
          branch: "flume/sealed",
          baseSha: "0".repeat(40),
        }),
        "utf8",
      );
      // Vacuity: the marker is readable *now*, so the refusal below is the
      // seal talking and not an empty dir.
      expect(await readMergingMarkers(flumeDir)).toHaveLength(1);

      // Deny the merging dir structurally: readdir now fails ENOTDIR — the
      // path is there, but it is not a dir the listing can read — not
      // ENOENT.
      denyDirectory(dir);

      let caught: NodeJS.ErrnoException | undefined;
      try {
        await readMergingMarkers(flumeDir);
      } catch (err) {
        caught = err as NodeJS.ErrnoException;
      }
      expect(
        caught,
        "the sealed merging dir read as no interrupted merge",
      ).toBeDefined();
      expect(caught?.code).not.toBe("ENOENT");
      // The reader's own reading of the path, not the host's spelling of the
      // failure: the errno a plain file raises here is `ENOTDIR` on posix and
      // `ENOENT` on win32, and neither is the property.
      expect(caught?.message).toContain(
        `${dir} is present but is not a directory`,
      );
    } finally {
      await rm(flumeDir, { recursive: true, force: true });
    }
  });

  it("readMergingMarkers refuses an obstructed merging dir with a reading of its own, naming the path that is not a directory", async () => {
    const root = await mkTempDir("flume-mm-obstructed-");
    const flumeDir = join(root, ".flume");
    const dir = mergingDir(flumeDir);
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "obstructed.json"),
        JSON.stringify({
          tag: "OBSTRUCTED",
          branch: "flume/obstructed",
          baseSha: "0".repeat(40),
        }),
        "utf8",
      );
      // Vacuity: the marker really is reachable while the state root is a
      // directory, so the refusal below is the obstruction talking.
      expect(await readMergingMarkers(flumeDir)).toHaveLength(1);

      // The obstruction sits one level *above* the dir the listing names, so
      // nothing beneath it exists to stat: the listing raises ENOTDIR on
      // posix and ENOENT on win32, and an errno-keyed absent arm would start
      // a loop over a marker it could not see on exactly one of them.
      denyDirectory(flumeDir);
      expect(existsSync(flumeDir)).toBe(true);
      expect(lstatSync(flumeDir).isDirectory()).toBe(false);
      expect(existsSync(dir)).toBe(false);

      const caught = await readMergingMarkers(flumeDir).then(
        () => undefined,
        (err: unknown) => err as Error,
      );
      expect(
        caught,
        "the obstructed state root read as no interrupted merge",
      ).toBeInstanceOf(Error);
      // The path that is not a directory is the obstructing *ancestor* — the
      // one an operator has to go fix — named by the reader itself rather
      // than by whichever errno this host happened to raise beneath it.
      expect(caught?.message).toContain(
        `${flumeDir} is present but is not a directory`,
      );
      expect((caught as NodeJS.ErrnoException).code).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("Dispatcher fanout — afterMerge gate failure reverts only the offending entry", () => {
  it("ships the N−1 clean siblings, reverts only the offending entry, keeps it pending with the prior-attempt block; per-entry agent fanout stays parallel", async () => {
    // ISO-PASS and ISO-FAIL fan out concurrently (disjoint declared files →
    // same batch). The afterMerge gate vetoes any merged trunk carrying
    // ISO-FAIL's file, so it fails for ISO-FAIL's commit and passes for
    // ISO-PASS's — independent of cherry-pick order.
    const entries = [
      makeEntry("ISO-PASS", ["src/iso-pass.ts"]),
      makeEntry("ISO-FAIL", ["src/iso-fail.ts"]),
    ];
    await writePending(fx.repo, entries);
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const preHead = await head(fx.repo);

    const isoVeto: Gate = {
      name: "iso-veto",
      when: "afterMerge",
      async run({ cwd }) {
        // Per-entry: the gate sees the trunk with exactly one more entry
        // cherry-picked. Veto iff that entry is the offending one.
        return existsSync(join(cwd, "src", "iso-fail.ts"))
          ? {
              ok: false,
              message: "iso veto",
              details: "ISO-FAIL-DETAIL-QQQ",
            }
          : { ok: true, message: "clean" };
      },
    };

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [isoVeto],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    // Parallelism probe: per-entry afterMerge isolation must not serialize
    // the agent fanout. Rather than holding both invocations open for a
    // fixed real-time window (flaky under CPU contention — the window can
    // elapse before a delayed second invocation even starts), gate release
    // on a barrier that only opens once `entries.length` invocations have
    // started. A genuinely parallel fanout opens it every time; a serialized
    // one leaves the first invocation waiting on a barrier the second never
    // reaches, which fails the test's own timeout instead of quietly
    // reporting a low-but-plausible maxInFlight.
    let inFlight = 0;
    let maxInFlight = 0;
    let started = 0;
    let releaseBarrier: () => void;
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    const promptsBySlug: Record<string, string[]> = {};
    const agent: Agent = {
      name: "recording-fanout",
      async invoke(inv) {
        const slug = basename(inv.cwd);
        (promptsBySlug[slug] ??= []).push(inv.prompt);
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        started++;
        if (started >= entries.length) releaseBarrier();
        await barrier;
        inFlight--;
        const file =
          slug === "iso-pass" ? "src/iso-pass.ts" : "src/iso-fail.ts";
        await writeAndCommit(inv.cwd, file, `${slug}\n`, `build(${slug})`);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    const first = await dispatcher.tick();

    // Both agents ran concurrently — the fanout is still parallel.
    expect(maxInFlight).toBe(2);

    // Only ISO-PASS shipped; the offending entry's change is NOT on trunk.
    expect(first.result?.committed).toBe(true);
    expect(first.result?.shippedTags).toEqual(["ISO-PASS"]);
    expect(await readFile(join(fx.repo, "src/iso-pass.ts"), "utf8")).toBe(
      "iso-pass\n",
    );
    expect(existsSync(join(fx.repo, "src", "iso-fail.ts"))).toBe(false);

    // Trunk advanced past preHead (ISO-PASS cherry-pick + ship chore), NOT
    // reset to preHead — the whole-wave blast radius is gone.
    expect(await head(fx.repo)).not.toBe(preHead);

    // ISO-FAIL stays pending; ISO-PASS removed by the ship chore.
    const onDisk = readPendingFromDisk(fx.repo);
    expect(onDisk.map((e) => e.tag)).toEqual(["ISO-FAIL"]);
    expect(first.result?.pendingAfter.map((e) => e.tag)).toEqual(["ISO-FAIL"]);

    // The reverted entry's *actual* commit footprint is recorded on the
    // entry, so the next partition separates the retry from whatever it
    // collided with even where declared `files` under-stated the reach.
    expect(onDisk[0]!.observedFiles).toEqual(["src/iso-fail.ts"]);

    // The offending entry's afterMerge gate failure is recorded; the clean
    // sibling's passing run is too.
    const gr = first.result?.gateResults ?? [];
    expect(gr.some((g) => g.gate === "iso-veto" && !g.ok)).toBe(true);
    expect(gr.some((g) => g.gate === "iso-veto" && g.ok)).toBe(true);

    // The verdict's merge outcomes distinguish "merged" from
    // "afterMerge-reverted" per entry, and the failing gate's own detail
    // (the fact behind the revert) rides along verbatim.
    expect(
      [...(first.verdict?.mergeOutcomes ?? [])].sort((a, b) =>
        (a.entryTag ?? "").localeCompare(b.entryTag ?? ""),
      ),
    ).toEqual([
      {
        entryTag: "ISO-FAIL",
        outcome: "afterMerge-reverted",
        footprint: ["src/iso-fail.ts"],
        baseSha: expect.stringMatching(/^[0-9a-f]{40}$/),
        headSha: expect.stringMatching(/^[0-9a-f]{40}$/),
      },
      {
        entryTag: "ISO-PASS",
        outcome: "merged",
        baseSha: expect.stringMatching(/^[0-9a-f]{40}$/),
        headSha: expect.stringMatching(/^[0-9a-f]{40}$/),
      },
    ]);
    const verdictVeto = first.verdict?.gateResults.find(
      (g) => g.gate === "iso-veto" && !g.ok,
    );
    expect(verdictVeto?.details).toBe("ISO-FAIL-DETAIL-QQQ");

    // Generalized past provisioning: a gate revert is recorded with a
    // signature derived from the gate's own name plus its failure output —
    // the `details` above is a separate, richer channel; the signature is
    // the bounded comparison key superviseLoop's backstop keys off.
    expect(first.verdict?.gateFailures).toEqual([
      {
        tag: "ISO-FAIL",
        quarantineKey: expect.stringMatching(/^iso-fail@[0-9a-f]{10}$/),
        signature: "iso-veto: iso veto",
        message: "iso veto",
      },
    ]);

    // Retry wave: only ISO-FAIL is still pickable. Its prompt carries the
    // gate-revert block (afterMerge); ISO-PASS never runs again.
    baton.wake("build");
    await dispatcher.tick();

    const passPrompts = promptsBySlug["iso-pass"] ?? [];
    const failPrompts = promptsBySlug["iso-fail"] ?? [];
    expect(passPrompts.length).toBe(1); // shipped — never retried
    expect(passPrompts[0]).not.toContain("<prior-attempt>");
    expect(failPrompts.length).toBe(2); // reverted — retried
    // First attempt: no false signal.
    expect(failPrompts[0]).not.toContain("<prior-attempt>");
    // Retry: the gate-revert block, afterMerge, with the gate detail.
    expect(failPrompts[1]).toContain("<prior-attempt>");
    expect(failPrompts[1]).toContain("Failing gate: iso-veto");
    expect(failPrompts[1]).toContain("Reverted at: afterMerge");
    expect(failPrompts[1]).toContain("ISO-FAIL-DETAIL-QQQ");
  });
});

// ---------- a gate that throws is a gate that failed (GATE-THROW-IS-A-GATE-
// FAILURE, spec/chain.md "What a gate returns") ----------

describe("Dispatcher — a gate that throws is a gate that failed", () => {
  /** An `Error` a gate raises instead of returning its refusal. */
  const BOOM = "gate runner died: ENOENT spawning vitest";
  /**
   * The `details` a throw records: the raised error's own stack — its message
   * line followed by at least one frame. Matched rather than compared, since
   * the frames are the running file's real ones.
   */
  const STACK = expect.stringMatching(
    new RegExp(`^Error: ${BOOM.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*\\n\\s+at `),
  );

  function throwingGate(name: string, when: Gate["when"]): Gate {
    return {
      name,
      when,
      async run() {
        throw new Error(BOOM);
      },
    };
  }

  it("a gate that throws is recorded as that gate's failure carrying the error's message", async () => {
    const preHead = await head(fx.repo);
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [throwingGate("explodes", "afterCommit")],
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async (cwd) => {
        await writeAndCommit(cwd, "src/output.ts", "x\n", "plan: derive");
      }),
      log: silent,
    });

    const outcome = await dispatcher.tick();

    // Vacuity (.claude/rules/engineering.md "A green verdict is proven
    // non-vacuous"): the gate loop really reached the throwing gate and really
    // produced a row.
    const reported = outcome.result?.gateResults ?? [];
    expect(reported, "the gate loop produced no rows").not.toHaveLength(0);
    // The throw is the gate's refusal, verbatim — no wrapper prose, no
    // synthesized message the chain never authored.
    expect(reported[0]).toEqual({
      gate: "explodes",
      ok: false,
      message: BOOM,
      details: STACK,
    });
    // …and the tick took the returned-refusal path from there: commit
    // reverted, verdict written, failure signature derived the same way.
    expect(outcome.result?.committed).toBe(false);
    expect(await head(fx.repo)).toBe(preHead);
    expect(existsSync(join(fx.repo, "src", "output.ts"))).toBe(false);
    expect(outcome.verdict?.noCommit).toBe("gate-revert");
    expect(outcome.verdict?.gateResults).toEqual([
      { gate: "explodes", ok: false, message: BOOM, details: STACK },
    ]);
    expect(outcome.verdict?.gateFailures).toEqual([
      { signature: `explodes: ${BOOM}`, message: BOOM },
    ]);
    // Short-circuit is unchanged: writable-paths never ran.
    expect(reported.some((g) => g.gate === "writable-paths")).toBe(false);
  });

  it("a gate that throws records its stack as that gate's details", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [throwingGate("explodes", "afterCommit")],
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async (cwd) => {
        await writeAndCommit(cwd, "src/output.ts", "x\n", "plan: derive");
      }),
      log: silent,
    });

    const outcome = await dispatcher.tick();

    // Vacuity (.claude/rules/engineering.md "A green verdict is proven
    // non-vacuous"): the throwing gate really produced a row on the verdict —
    // the surface that keeps `details` at all.
    const rows = outcome.verdict?.gateResults ?? [];
    expect(rows, "the gate loop produced no rows").not.toHaveLength(0);
    const row = rows.find((g) => g.gate === "explodes");
    expect(row, "no row for the throwing gate").toBeDefined();

    // The stack, not a second copy of the message: the message is one line,
    // the details open with it and continue into the frames that raised it.
    const details = row?.details;
    expect(details, "the throw recorded no details").toBeTypeOf("string");
    expect(details).not.toBe(row?.message);
    expect(details).toMatch(/\n\s+at /);
    expect(details!.split("\n").length).toBeGreaterThan(1);
    expect(details).toContain(BOOM);
    // The raising frame is this file's gate body, not a dispatcher frame
    // synthesized where the throw was caught.
    expect(details).toContain("Dispatcher.test.ts");
  });

  it("a gate that throws a non-Error records the value as its message and no details", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    // No stack exists to record, so nothing is recorded — a `details` echoing
    // `message` would read as evidence while carrying none.
    const throwsAString: Gate = {
      name: "explodes",
      when: "afterCommit",
      async run() {
        throw "gate runner died, stackless";
      },
    };

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [throwsAString],
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async (cwd) => {
        await writeAndCommit(cwd, "src/output.ts", "x\n", "plan: derive");
      }),
      log: silent,
    });

    const outcome = await dispatcher.tick();

    const rows = outcome.verdict?.gateResults ?? [];
    expect(rows, "the gate loop produced no rows").not.toHaveLength(0);
    expect(rows).toContainEqual({
      gate: "explodes",
      ok: false,
      message: "gate runner died, stackless",
    });
    expect(outcome.verdict?.noCommit).toBe("gate-revert");
  });

  it("a tick whose gate throws writes its verdict instead of dying at the crash marker", async () => {
    await writePending(fx.repo, [makeEntry("THROW-M", ["src/throw-m.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    // The marker window: this gate runs between THROW-M's pick onto trunk
    // and the wave's queue rewrite, so a throw escaping here is exactly the
    // death that would strand `merging/throw-m.json` and refuse the next
    // `loop` start (spec/loop.md "A merge the crash interrupted is refused").
    let staked: string[] = [];
    const probeThenThrow: Gate = {
      name: "merge-explodes",
      when: "afterMerge",
      async run() {
        staked = [...(await markersNow(fx.repo)).keys()];
        throw new Error(BOOM);
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({
        phases: [
          makePhase({
            name: "build",
            concurrency: "fanout",
            gates: [probeThenThrow],
          }),
        ],
        humanOnly: [],
      }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({
        "throw-m": async (cwd) => {
          await writeAndCommit(cwd, "src/throw-m.ts", "m\n", "build: M");
        },
      }),
      log: silent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    // Vacuity: the throw happened mid-merge, with this entry's marker staked
    // — otherwise "no marker afterwards" would be an absence, not a removal.
    expect(staked, "the afterMerge gate never ran mid-merge").toEqual([
      "throw-m.json",
    ]);
    // The tick's facts survive the gate's exception.
    expect(outcome.verdict).toBeDefined();
    expect(outcome.verdict?.gateResults).toContainEqual({
      gate: "merge-explodes",
      ok: false,
      message: BOOM,
      details: STACK,
    });
    // Nothing is left behind for the next start to refuse over: the wave
    // reached its bookkeeping and retired the marker it staked.
    expect([...(await markersNow(fx.repo)).keys()]).toEqual([]);
  });

  it("an afterMerge gate that throws reverts the merge as a returned refusal would", async () => {
    await writePending(fx.repo, [makeEntry("THROW-R", ["src/throw-r.ts"])]);
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const prompts: string[] = [];
    const agent: Agent = {
      name: "recording-fanout",
      async invoke(inv) {
        prompts.push(inv.prompt);
        await writeAndCommit(inv.cwd, "src/throw-r.ts", "r\n", "build: R");
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({
        phases: [
          makePhase({
            name: "build",
            concurrency: "fanout",
            gates: [throwingGate("merge-explodes", "afterMerge")],
          }),
        ],
        humanOnly: [],
      }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    // Vacuity: the entry really was picked and really was gated.
    expect(outcome.verdict?.mergeOutcomes ?? []).not.toHaveLength(0);
    // The merge came back off trunk, and the entry stayed in the queue.
    expect(outcome.result?.shippedTags ?? []).toEqual([]);
    expect(existsSync(join(fx.repo, "src", "throw-r.ts"))).toBe(false);
    expect((readPendingFromDisk(fx.repo)).map((e) => e.tag)).toEqual([
      "THROW-R",
    ]);
    expect(outcome.verdict?.mergeOutcomes).toContainEqual({
      entryTag: "THROW-R",
      outcome: "afterMerge-reverted",
      footprint: ["src/throw-r.ts"],
      baseSha: expect.stringMatching(/^[0-9a-f]{40}$/),
      headSha: expect.stringMatching(/^[0-9a-f]{40}$/),
    });
    expect(outcome.verdict?.gateFailures).toEqual([
      {
        tag: "THROW-R",
        quarantineKey: expect.stringMatching(/^throw-r@[0-9a-f]{10}$/),
        signature: `merge-explodes: ${BOOM}`,
        message: BOOM,
      },
    ]);

    // The retry carries the same gate-revert block a returned refusal
    // would have written — the throw reached the agent as a gate failure.
    baton.wake("build");
    await dispatcher.tick();
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).not.toContain("<prior-attempt>");
    expect(prompts[1]).toContain("<prior-attempt>");
    expect(prompts[1]).toContain("Failing gate: merge-explodes");
    expect(prompts[1]).toContain("Reverted at: afterMerge");
    expect(prompts[1]).toContain(BOOM);
    // …including the details a returned refusal's would carry: the stack,
    // not the one message line.
    expect(prompts[1]).toContain("Gate details:");
    expect(prompts[1]).toMatch(/\n\s+at /);
  });

  it("a singleton phase's afterMerge gate that throws reverts the merged commit off trunk", async () => {
    const preHead = await head(fx.repo);
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [throwingGate("merge-explodes", "afterMerge")],
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async (cwd) => {
        await writeAndCommit(cwd, "src/plan-out.ts", "content\n", "plan: derive");
      }),
      log: silent,
    });

    const outcome = await dispatcher.tick();

    const reported = outcome.verdict?.gateResults ?? [];
    expect(reported, "the afterMerge gate loop produced no rows").not.toHaveLength(0);
    expect(reported).toContainEqual({
      gate: "merge-explodes",
      ok: false,
      message: BOOM,
      details: STACK,
    });
    expect(outcome.result?.committed).toBe(false);
    expect(outcome.verdict?.noCommit).toBe("gate-revert");
    expect(await head(fx.repo)).toBe(preHead);
    expect(existsSync(join(fx.repo, "src", "plan-out.ts"))).toBe(false);
  });
});

// ---------- shared-checkout keep-semantics revert (spec/loop.md "Tip
// verify", "dropping it must not take bystanders") ----------

describe("Dispatcher — an afterMerge revert on the primary checkout preserves bystander state", () => {
  // A brand-new staged file — or a staged modification to any tracked file,
  // touched by the entry's span or not — makes git refuse the cherry-pick
  // itself ("your local changes would be overwritten by cherry-pick"),
  // before the dispatcher ever reaches the afterMerge-revert this entry
  // changes. So the staged bystander edit here lands from *inside* the
  // afterMerge gate's own callback — after the cherry-pick has already
  // landed cleanly, simulating an operator staging something mid-tick —
  // which is exactly the window the revert (not the cherry-pick) has to
  // respect.
  it("fanout: an afterMerge revert on the trunk leaves an operator's unrelated staged/unstaged edit intact", async () => {
    await writePending(fx.repo, [makeEntry("REVERT-ME", ["src/thing.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const alwaysVeto: Gate = {
      name: "always-veto",
      when: "afterMerge",
      async run({ cwd }) {
        await writeFile(
          join(cwd, "operator-staged.txt"),
          "staged work",
        );
        await exec("git", ["add", "operator-staged.txt"], { cwd });
        return { ok: false, message: "veto", details: "REVERT-ME-DETAIL" };
      },
    };
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [alwaysVeto],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "revert-me": async (cwd) => {
        await writeAndCommit(cwd, "src/thing.ts", "content\n", "build(REVERT-ME)");
      },
    });

    // The operator has unrelated unstaged work sitting on the primary
    // checkout while the tick runs, untouched by the entry's own files.
    await writeFile(join(fx.repo, "operator-unstaged.txt"), "unstaged work");

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    // The entry's afterMerge gate always fails, so nothing ships and it
    // stays pending — the reset carried it back off trunk.
    expect(outcome.result?.committed).toBe(false);
    expect(existsSync(join(fx.repo, "src/thing.ts"))).toBe(false);
    expect(readPendingFromDisk(fx.repo)).toEqual([
      { ...makeEntry("REVERT-ME", ["src/thing.ts"]), observedFiles: ["src/thing.ts"] },
    ]);

    // The operator's bystander state — one staged mid-tick, one unstaged
    // before the tick — survived the revert untouched. A `--hard` reset
    // would have wiped both.
    expect(
      await readFile(join(fx.repo, "operator-unstaged.txt"), "utf8"),
    ).toBe("unstaged work");
    expect(
      await readFile(join(fx.repo, "operator-staged.txt"), "utf8"),
    ).toBe("staged work");
    const { stdout: status } = await exec(
      "git",
      ["status", "--porcelain"],
      { cwd: fx.repo },
    );
    expect(status).toContain("operator-staged.txt");
    expect(status).toContain("operator-unstaged.txt");
  });

  it("singleton: an afterMerge revert on the trunk leaves an operator's unrelated staged/unstaged edit intact", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const alwaysVeto: Gate = {
      name: "always-veto",
      when: "afterMerge",
      async run({ cwd }) {
        await writeFile(
          join(cwd, "operator-staged.txt"),
          "staged work",
        );
        await exec("git", ["add", "operator-staged.txt"], { cwd });
        return { ok: false, message: "veto" };
      },
    };
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [alwaysVeto],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/plan-out.ts", "content\n", "plan: attempt");
    });

    await writeFile(join(fx.repo, "operator-unstaged.txt"), "unstaged work");

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(false);
    expect(existsSync(join(fx.repo, "src/plan-out.ts"))).toBe(false);

    expect(
      await readFile(join(fx.repo, "operator-unstaged.txt"), "utf8"),
    ).toBe("unstaged work");
    expect(
      await readFile(join(fx.repo, "operator-staged.txt"), "utf8"),
    ).toBe("staged work");
    const { stdout: status } = await exec(
      "git",
      ["status", "--porcelain"],
      { cwd: fx.repo },
    );
    expect(status).toContain("operator-staged.txt");
    expect(status).toContain("operator-unstaged.txt");
  });
});

// ---------- bystander checkpoint before the primary-checkout merge stage
// (spec/loop.md "Crash equals stop": "Staged bystander state is
// checkpointed before a pick range begins") ----------

describe("Dispatcher — staged bystander state is checkpointed to a recoverable sha before the merge stage", () => {
  it("fanout: a staged bystander edit that blocks the wave's own cherry-pick is still recoverable from the verdict's checkpoint sha", async () => {
    await writePending(fx.repo, [makeEntry("SHIP-IT", ["src/thing.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout", gates: [] });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "ship-it": async (cwd) => {
        await writeAndCommit(cwd, "src/thing.ts", "content\n", "build(SHIP-IT)");
      },
    });

    // The operator has staged unrelated work on the primary checkout before
    // this tick's merge stage begins. Git refuses *any* cherry-pick outright
    // while the checkout carries staged content, disjoint or not ("your
    // local changes would be overwritten by cherry-pick") — so the wave's
    // own pick never lands and the entry stays pending. That pre-flight
    // refusal still leaves the multi-commit range's sequencer state on disk
    // (git's own bookkeeping, ahead of applying any commit), so the guarded
    // `cherryPickAbort` legitimately fires and can still take the staged
    // file with it. Recovery, not prevention of the abort, is what the
    // checkpoint buys (spec/loop.md "Crash equals stop", "Never-destroy-
    // always-leave-a-sha").
    await writeFile(join(fx.repo, "operator-staged.txt"), "bystander content\n");
    await exec("git", ["add", "operator-staged.txt"], { cwd: fx.repo });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(false);
    const onDisk = readPendingFromDisk(fx.repo);
    expect(onDisk.map((e) => e.tag)).toEqual(["SHIP-IT"]);

    const sha = outcome.verdict?.bystanderCheckpointSha;
    expect(sha).toEqual(expect.stringMatching(/^[0-9a-f]{40}$/));

    // Recoverable from the checkpoint sha alone — `git stash create`'s
    // shape, an object in the store independent of whatever the failed
    // pick and its abort did to the working tree.
    const { stdout } = await exec(
      "git",
      ["show", `${sha}:operator-staged.txt`],
      { cwd: fx.repo },
    );
    expect(stdout).toBe("bystander content\n");
  });

  it("singleton: absent when the primary checkout was clean at merge time", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const phase = makePhase({ name: "plan", concurrency: "singleton", gates: [] });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/plan-out.ts", "content\n", "plan: attempt");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    expect(outcome.verdict?.bystanderCheckpointSha).toBeUndefined();
  });
});

// ---------- resetKeepTo collision at the primary-checkout revert site
// (audit finding against shared-checkout-keep-reset 6cb9948: resetKeepTo's
// own refusal was left uncaught by both its callers) ----------

describe("Dispatcher — a resetKeepTo collision at the primary-checkout afterMerge-revert site does not crash the tick", () => {
  it("fanout: a collision reverting one entry does not crash the wave; an already-merged sibling still ships and the pending-ledger rewrite still runs", async () => {
    // SHIP-CLEAN declares the higher `priority`: this case turns on its
    // merge completing ahead of COLLIDE-BAD's, and the wave's order is that
    // field rather than the array's (`spec/pending.md`, *The entry core*).
    const entries = [
      { ...makeEntry("SHIP-CLEAN", ["src/clean.ts"]), priority: 1 },
      makeEntry("COLLIDE-BAD", ["src/collide.ts"]),
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const collideVeto: Gate = {
      name: "collide-veto",
      when: "afterMerge",
      async run({ cwd }) {
        if (!existsSync(join(cwd, "src", "collide.ts"))) {
          return { ok: true, message: "clean" };
        }
        // A bystander editing the exact path the revert needs to touch, in
        // the window between cherry-pick and this gate's revert —
        // resetKeepTo's own collision refusal (spec/loop.md "Tip verify",
        // "dropping it must not take bystanders").
        await writeFile(
          join(cwd, "src", "collide.ts"),
          "bystander collision\n",
        );
        return { ok: false, message: "collide veto" };
      },
    };
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [collideVeto],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "ship-clean": async (cwd) => {
        await writeAndCommit(cwd, "src/clean.ts", "clean\n", "build(SHIP-CLEAN)");
      },
      "collide-bad": async (cwd) => {
        await writeAndCommit(cwd, "src/collide.ts", "collide\n", "build(COLLIDE-BAD)");
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    // Must resolve, not reject — the crash this fix closes. `perEntry` is
    // `Promise.all`-ordered, so SHIP-CLEAN's merge/gate/ship completes ahead
    // of COLLIDE-BAD's in the loop; only *not* throwing on COLLIDE-BAD's
    // refused revert lets the loop reach `commitPendingUpdate` at all.
    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    expect(outcome.result?.shippedTags).toEqual(["SHIP-CLEAN"]);
    expect(await readFile(join(fx.repo, "src/clean.ts"), "utf8")).toBe(
      "clean\n",
    );

    // pending.json rewrite ran despite COLLIDE-BAD's refused revert:
    // SHIP-CLEAN removed, COLLIDE-BAD stays pending.
    const onDisk = readPendingFromDisk(fx.repo);
    expect(onDisk.map((e) => e.tag)).toEqual(["COLLIDE-BAD"]);

    // COLLIDE-BAD's commit stays on trunk — the revert itself was refused,
    // unlike a clean afterMerge-reverted entry.
    expect(existsSync(join(fx.repo, "src/collide.ts"))).toBe(true);
    expect(await readFile(join(fx.repo, "src/collide.ts"), "utf8")).toBe(
      "bystander collision\n",
    );

    const mo = outcome.verdict?.mergeOutcomes.find(
      (m) => m.entryTag === "COLLIDE-BAD",
    );
    expect(mo?.outcome).toBe("afterMerge-revert-refused");
    expect(mo?.footprint).toEqual(["src/collide.ts"]);

    const gf = outcome.verdict?.gateFailures ?? [];
    expect(
      gf.some((g) => g.tag === "COLLIDE-BAD" && g.message === "collide veto"),
    ).toBe(true);
    expect(
      gf.some(
        (g) => g.tag === "COLLIDE-BAD" && g.message.includes("stays on trunk"),
      ),
    ).toBe(true);
  });

  it("singleton: a collision on the tick's own afterMerge revert surfaces as a handled outcome, not an uncaught process crash", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const collideVeto: Gate = {
      name: "collide-veto",
      when: "afterMerge",
      async run({ cwd }) {
        // Same bystander-collision simulation as the fanout case above, on
        // the singleton's own primary-checkout revert.
        await writeFile(
          join(cwd, "src", "plan-out.ts"),
          "bystander collision\n",
        );
        return { ok: false, message: "collide veto" };
      },
    };
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [collideVeto],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/plan-out.ts", "content\n", "plan: attempt");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    // Must resolve, not reject — an uncaught ResetKeepRefusedError here
    // would previously crash the whole tick.
    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(false);
    expect(outcome.noCommit).toBe("gate-revert");

    // The offending commit stays on trunk — the collision refused the
    // revert, unlike a clean afterMerge revert.
    expect(existsSync(join(fx.repo, "src/plan-out.ts"))).toBe(true);
    expect(await readFile(join(fx.repo, "src/plan-out.ts"), "utf8")).toBe(
      "bystander collision\n",
    );

    const gf = outcome.verdict?.gateFailures ?? [];
    expect(gf.some((g) => g.message === "collide veto")).toBe(true);
    expect(gf.some((g) => g.message.includes("stays on trunk"))).toBe(true);
  });
});

// ---------- AFTERMERGE-REVERT-TIP-CHECK: a foreign commit landing atop the
// merged span refuses the afterMerge revert instead of resetting over it
// (spec/loop.md "Tip verify", "one window stays a refusal, deliberately")
// ----------

describe("Dispatcher — afterMerge revert refuses over a foreign commit landed atop the cherry-pick", () => {
  it("fanout: a foreign commit landing on trunk while the afterMerge gate runs refuses the revert, naming both shas, and leaves the foreign commit on trunk", async () => {
    await writePending(fx.repo, [makeEntry("TIP-DRIFT", ["src/tip-drift.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const foreignCommitVeto: Gate = {
      name: "foreign-commit-veto",
      when: "afterMerge",
      async run({ cwd }) {
        if (!existsSync(join(cwd, "src", "tip-drift.ts"))) {
          return { ok: true, message: "clean" };
        }
        // Simulate an operator committing directly to trunk in the window
        // between this entry's cherry-pick and this gate's own revert — a
        // foreign commit is legal history the wave would otherwise absorb
        // (spec/loop.md "Tip verify"), but not something the afterMerge
        // revert may reset over.
        await writeFile(join(cwd, "src", "foreign.ts"), "foreign\n");
        await exec("git", ["add", "."], { cwd });
        await exec(
          "git",
          ["commit", "-q", "-m", "operator: foreign commit"],
          { cwd },
        );
        return { ok: false, message: "foreign veto" };
      },
    };
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [foreignCommitVeto],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "tip-drift": async (cwd) => {
        await writeAndCommit(
          cwd,
          "src/tip-drift.ts",
          "drift\n",
          "build(TIP-DRIFT)",
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    // Nothing shipped — the entry stays pending, refused rather than reset.
    expect(outcome.result?.committed).toBe(false);

    // Both the entry's own cherry-picked commit and the foreign commit stay
    // on trunk — the revert refused instead of resetting either away.
    expect(existsSync(join(fx.repo, "src/tip-drift.ts"))).toBe(true);
    expect(existsSync(join(fx.repo, "src/foreign.ts"))).toBe(true);

    const onDisk = readPendingFromDisk(fx.repo);
    expect(onDisk.map((e) => e.tag)).toEqual(["TIP-DRIFT"]);

    const mo = outcome.verdict?.mergeOutcomes.find(
      (m) => m.entryTag === "TIP-DRIFT",
    );
    expect(mo?.outcome).toBe("afterMerge-revert-refused");

    const gf = outcome.verdict?.gateFailures ?? [];
    expect(
      gf.some((g) => g.tag === "TIP-DRIFT" && g.message === "foreign veto"),
    ).toBe(true);
    const tipRefusal = gf.find(
      (g) =>
        g.tag === "TIP-DRIFT" &&
        g.message.includes("afterMerge revert refused"),
    );
    expect(tipRefusal).toBeDefined();
    // Names both shas: the merged commit this call expected, and the
    // foreign trunk tip it actually found.
    expect(tipRefusal?.message).toMatch(/merged commit [0-9a-f]{7,40}/);
    expect(tipRefusal?.message).toContain("trunk tip");
  });

  it("singleton: same refusal on the phase's own primary-checkout revert", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const foreignCommitVeto: Gate = {
      name: "foreign-commit-veto",
      when: "afterMerge",
      async run({ cwd }) {
        // Same foreign-commit simulation as the fanout case above, on the
        // singleton's own primary-checkout revert.
        await writeFile(join(cwd, "src", "foreign.ts"), "foreign\n");
        await exec("git", ["add", "."], { cwd });
        await exec(
          "git",
          ["commit", "-q", "-m", "operator: foreign commit"],
          { cwd },
        );
        return { ok: false, message: "foreign veto" };
      },
    };
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [foreignCommitVeto],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/plan-out.ts", "content\n", "plan: attempt");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(false);
    expect(outcome.noCommit).toBe("gate-revert");

    // Both the agent's own commit and the foreign commit stay on trunk — the
    // revert refused instead of resetting either away.
    expect(existsSync(join(fx.repo, "src/plan-out.ts"))).toBe(true);
    expect(existsSync(join(fx.repo, "src/foreign.ts"))).toBe(true);

    const gf = outcome.verdict?.gateFailures ?? [];
    expect(gf.some((g) => g.message === "foreign veto")).toBe(true);
    const tipRefusal = gf.find((g) =>
      g.message.includes("afterMerge revert refused"),
    );
    expect(tipRefusal).toBeDefined();
    expect(tipRefusal?.message).toMatch(/merged commit [0-9a-f]{7,40}/);
    expect(tipRefusal?.message).toContain("trunk tip");
  });
});

// ---------- entry-scoped write guard ----------

describe("Dispatcher fanout — entry-scoped write guard", () => {
  it("ships a scoped commit that stays inside entry.files ∪ entryChannelPaths", async () => {
    await writePending(fx.repo, [makeEntry("SCOPE-OK", ["src/ok.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**", "notes/**"],
      entryChannelPaths: ["notes/**"],
      scopeWritesToEntry: true,
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    // One commit touching the declared file AND an undeclared channel path.
    const agent = fanoutAgent({
      "scope-ok": async (cwd) => {
        await writeFile(join(cwd, "src", "ok.ts"), "ok\n");
        await mkdir(join(cwd, "notes"), { recursive: true });
        await writeFile(join(cwd, "notes", "finding.md"), "cross-tick\n");
        await exec("git", ["add", "."], { cwd });
        await exec("git", ["commit", "-q", "-m", "build(SCOPE-OK): ship"], {
          cwd,
        });
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual(["SCOPE-OK"]);
    expect(await readFile(join(fx.repo, "src/ok.ts"), "utf8")).toBe("ok\n");
    expect(await readFile(join(fx.repo, "notes/finding.md"), "utf8")).toBe(
      "cross-tick\n",
    );
    expect(readPendingFromDisk(fx.repo)).toEqual([]);
  });

  it("scopeWritesToEntry undeclared: a fanout tick's write allowance is byte-identical to a singleton tick's — writablePaths ceiling only, entry.files ignored", async () => {
    await writePending(fx.repo, [makeEntry("SCOPE-UNDECLARED", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      // scopeWritesToEntry not set — default false.
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    // Commit touches the declared file AND an undeclared sibling that is
    // inside phase.writablePaths but outside entry.files — ships because
    // narrowing to the entry never engages without the opt-in.
    const agent = fanoutAgent({
      "scope-undeclared": async (cwd) => {
        await writeFile(join(cwd, "src", "a.ts"), "a\n");
        await writeFile(join(cwd, "src", "stray.ts"), "stray\n");
        await exec("git", ["add", "."], { cwd });
        await exec(
          "git",
          ["commit", "-q", "-m", "build(SCOPE-UNDECLARED): ship"],
          { cwd },
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual(["SCOPE-UNDECLARED"]);
    expect(await readFile(join(fx.repo, "src/a.ts"), "utf8")).toBe("a\n");
    expect(await readFile(join(fx.repo, "src/stray.ts"), "utf8")).toBe(
      "stray\n",
    );
    expect(readPendingFromDisk(fx.repo)).toEqual([]);
  });

  it("reverts a path outside entry scope but inside phase globs; the retry prompt names it", async () => {
    await writePending(fx.repo, [makeEntry("SCOPE-STRAY", ["src/a.ts"])]);
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      scopeWritesToEntry: true,
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const prompts: string[] = [];
    const agent: Agent = {
      name: "recording-fanout",
      async invoke(inv) {
        prompts.push(inv.prompt);
        if (prompts.length === 1) {
          // Attempt 1: one commit touching the declared file AND a stray
          // sibling that is inside phase globs but undeclared by the entry.
          await writeFile(join(inv.cwd, "src", "a.ts"), "a\n");
          await writeFile(join(inv.cwd, "src", "stray.ts"), "stray\n");
          await exec("git", ["add", "."], { cwd: inv.cwd });
          await exec(
            "git",
            ["commit", "-q", "-m", "build(SCOPE-STRAY): overreach"],
            { cwd: inv.cwd },
          );
        } else {
          // Retry: stays inside the declared scope.
          await writeAndCommit(
            inv.cwd,
            "src/a.ts",
            "clean\n",
            "build(SCOPE-STRAY): retry",
          );
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const first = await dispatcher.tick();

    // Whole-commit revert: nothing shipped, neither file reached trunk, the
    // entry stays pending.
    expect(first.result?.shippedTags).toEqual([]);
    expect(existsSync(join(fx.repo, "src", "a.ts"))).toBe(false);
    expect(existsSync(join(fx.repo, "src", "stray.ts"))).toBe(false);
    expect((readPendingFromDisk(fx.repo)).map((e) => e.tag)).toEqual([
      "SCOPE-STRAY",
    ]);
    const gr = first.result?.gateResults ?? [];
    expect(gr.some((g) => g.gate === "writable-paths" && !g.ok)).toBe(true);

    // The wave's verdict carries this entry's tag and the
    // writable-paths gate's own violating-path detail — a chain reading
    // last-N verdicts sees `src/stray.ts` named, verbatim, no re-derivation.
    expect(first.verdict?.tags).toEqual(["SCOPE-STRAY"]);
    expect(first.verdict?.committed).toBe(false);
    expect(first.verdict?.noCommit).toBe("gate-revert");
    const verdictGate = first.verdict?.gateResults.find(
      (g) => g.gate === "writable-paths",
    );
    expect(verdictGate?.ok).toBe(false);
    expect(verdictGate?.details).toContain(
      "src/stray.ts (inside phase writablePaths but outside",
    );

    // Retry: the prior-attempt block names the out-of-scope path.
    baton.wake("build");
    const second = await dispatcher.tick();

    expect(prompts.length).toBe(2);
    expect(prompts[0]).not.toContain("<prior-attempt>");
    expect(prompts[1]).toContain("<prior-attempt>");
    expect(prompts[1]).toContain("Failing gate: writable-paths");
    expect(prompts[1]).toContain("entry-scoped write allowance");
    // The gate's own detail line — not merely the diffStat — names the path.
    expect(prompts[1]).toContain(
      "src/stray.ts (inside phase writablePaths but outside",
    );
    // entry.files legitimately appearing in the harness block (the effective
    // fence) is correct behavior, not a leak — only pin
    // that a.ts (in-scope) is never named as the out-of-scope offender.
    expect(prompts[1]).not.toContain(
      "src/a.ts (inside phase writablePaths but outside",
    );

    // The in-scope retry ships.
    expect(second.result?.shippedTags).toEqual(["SCOPE-STRAY"]);
    expect(await readFile(join(fx.repo, "src/a.ts"), "utf8")).toBe("clean\n");
  });

  it("reverts a path inside entry.files but outside phase globs — the ceiling still binds", async () => {
    await writePending(fx.repo, [
      makeEntry("SCOPE-CEIL", ["src/c.ts", "outside/d.ts"]),
    ]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      scopeWritesToEntry: true,
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "scope-ceil": async (cwd) => {
        await writeFile(join(cwd, "src", "c.ts"), "c\n");
        await mkdir(join(cwd, "outside"), { recursive: true });
        await writeFile(join(cwd, "outside", "d.ts"), "d\n");
        await exec("git", ["add", "."], { cwd });
        await exec("git", ["commit", "-q", "-m", "build(SCOPE-CEIL): ship"], {
          cwd,
        });
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual([]);
    expect(existsSync(join(fx.repo, "outside", "d.ts"))).toBe(false);
    expect((readPendingFromDisk(fx.repo)).map((e) => e.tag)).toEqual([
      "SCOPE-CEIL",
    ]);

    // The persisted prior-attempt record names the ceiling violation, path
    // included.
    const record = JSON.parse(
      await readFile(
        join(fx.repo, ".flume", "prior-attempts", "entry", "scope-ceil.json"),
        "utf8",
      ),
    ) as { mode: string; gate: string; details?: string };
    expect(record.mode).toBe("gate-revert");
    expect(record.gate).toBe("writable-paths");
    expect(record.details).toContain("outside/d.ts");
    expect(record.details).toContain("outside phase writablePaths");
  });

  it("an in-worktree afterCommit gate revert leaves the same trunk footprint an afterMerge revert does", async () => {
    // Same shape as "reverts a path outside entry scope but inside phase
    // globs" above — a writable-paths gate revert that never reaches
    // cherry-pick — but this asserts the trunk footprint, not just the revert
    // itself.
    await writePending(fx.repo, [makeEntry("FOOT-STRAY", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      scopeWritesToEntry: true,
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const preHead = await head(fx.repo);

    const agent = fanoutAgent({
      "foot-stray": async (cwd) => {
        await writeFile(join(cwd, "src", "a.ts"), "a\n");
        await writeFile(join(cwd, "src", "stray.ts"), "stray\n");
        await exec("git", ["add", "."], { cwd });
        await exec(
          "git",
          ["commit", "-q", "-m", "build(FOOT-STRAY): overreach"],
          { cwd },
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    // Whole-commit revert: nothing shipped, neither file reached trunk via
    // the entry's own commit, entry stays pending.
    expect(outcome.result?.shippedTags).toEqual([]);
    expect(existsSync(join(fx.repo, "src", "a.ts"))).toBe(false);
    expect(existsSync(join(fx.repo, "src", "stray.ts"))).toBe(false);
    expect((readPendingFromDisk(fx.repo)).map((e) => e.tag)).toEqual([
      "FOOT-STRAY",
    ]);

    // Unlike a bare in-worktree revert, trunk still advances: the footprint
    // rides the existing footprint-commit mechanism (commitPendingUpdate),
    // the same one afterMerge failures use — this is the trunk footprint
    // the next plan tick's commit-delta needs, not just the gitignored
    // prior-attempt record.
    expect(await head(fx.repo)).not.toBe(preHead);

    const onDisk = readPendingFromDisk(fx.repo);
    expect(onDisk[0]!.observedFiles).toEqual(
      expect.arrayContaining(["src/a.ts", "src/stray.ts"]),
    );

    // The footprint commit's file list is not a second, independent
    // capture — it traces straight back to this tick's own TickVerdict
    // record (mergeOutcomes), the same one `commitPendingUpdate` read to
    // build the footprint commit above.
    expect(outcome.verdict?.mergeOutcomes).toEqual([
      {
        entryTag: "FOOT-STRAY",
        outcome: "afterCommit-reverted",
        footprint: expect.arrayContaining(["src/a.ts", "src/stray.ts"]),
        baseSha: expect.stringMatching(/^[0-9a-f]{40}$/),
        headSha: expect.stringMatching(/^[0-9a-f]{40}$/),
      },
    ]);
    expect(onDisk[0]!.observedFiles!.sort()).toEqual(
      [...outcome.verdict!.mergeOutcomes[0]!.footprint!].sort(),
    );

    // Generalized past provisioning: unlike the singleton afterCommit
    // revert, a fanout entry's own afterCommit gate revert carries the
    // entry's tag — the tagged failure superviseLoop's quarantine leg can
    // isolate for the rest of the run.
    expect(outcome.verdict?.gateFailures).toEqual([
      expect.objectContaining({ tag: "FOOT-STRAY", signature: expect.any(String) }),
    ]);
  });

  it("an in-worktree afterCommit gate revert derives the footprint from runAfterCommitGates' own gate-loop capture, not a second git show (.claude/rules/engineering.md 'the fix lands at the mechanism')", async () => {
    // Same FOOT-STRAY shape as the footprint test above, but pinned on the
    // git call count: runAfterCommitGates already shells out to `git diff
    // --name-only` once per entry to build the whole-span touchedPaths every
    // afterCommit gate reads (spec/loop.md "Tip verify", per-entry leg — the
    // span's cumulative footprint, not just the newest commit's). The
    // fanout caller re-deriving the identical span's footprint via a second
    // diffNameOnly call is the duplicate this test catches if it's ever
    // reintroduced.
    await writePending(fx.repo, [makeEntry("FOOT-STRAY", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      scopeWritesToEntry: true,
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "foot-stray": async (cwd) => {
        await writeFile(join(cwd, "src", "a.ts"), "a\n");
        await writeFile(join(cwd, "src", "stray.ts"), "stray\n");
        await exec("git", ["add", "."], { cwd });
        await exec(
          "git",
          ["commit", "-q", "-m", "build(FOOT-STRAY): overreach"],
          { cwd },
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const diffNameOnlySpy = vi.spyOn(git, "diffNameOnly");

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual([]);
    expect(outcome.verdict?.mergeOutcomes).toEqual([
      {
        entryTag: "FOOT-STRAY",
        outcome: "afterCommit-reverted",
        footprint: expect.arrayContaining(["src/a.ts", "src/stray.ts"]),
        baseSha: expect.stringMatching(/^[0-9a-f]{40}$/),
        headSha: expect.stringMatching(/^[0-9a-f]{40}$/),
      },
    ]);

    // The reverted commit's touched paths are computed exactly once — inside
    // runAfterCommitGates' own gate-loop capture — and reused by the fanout
    // caller's trunk-footprint grab, not re-derived via a second git call.
    expect(diffNameOnlySpy).toHaveBeenCalledTimes(1);
  });

  it("singleton ticks keep phase-wide scope — undeclared paths inside globs still ship", async () => {
    // Pending declares a different file; a singleton tick is not entry-scoped,
    // so writing elsewhere inside writablePaths ships. entryChannelPaths on a
    // singleton phase is inert.
    await writePending(fx.repo, [makeEntry("SINGLETON-IGNORES", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      writablePaths: ["src/**", ".flume/**"],
      entryChannelPaths: ["notes/**"],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/unrelated.ts", "u\n", "plan: derive");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    expect(
      outcome.result?.gateResults.some(
        (g) => g.gate === "writable-paths" && g.ok,
      ),
    ).toBe(true);
  });
});

it("a tick's non-ASCII committed path reaches GateContext.touchedPaths unquoted", async () => {
  // The seam between `git.diffNameOnly` and every gate that reads
  // `ctx.touchedPaths`: git's default `--name-only` output octal-escapes a
  // non-ASCII path inside double quotes, and that spelling matches no fence
  // glob — so the path the tick was told to write reads as out-of-fence and the
  // commit reverts (`.claude/rules/engineering.md`, *Loud or nothing*). Driven
  // through the real dispatcher against a real commit rather than a hand-built
  // context, so the writer's own bytes reach the reader
  // (.claude/rules/engineering.md, *A seam gate reads what the real writer
  // wrote*).
  new Baton(join(fx.repo, ".flume")).wake("plan");

  const seen: string[][] = [];
  const capture: Gate = {
    name: "capture-touched-paths",
    when: "afterCommit",
    run: (ctx) => {
      seen.push([...ctx.touchedPaths]);
      return Promise.resolve({ ok: true, message: "captured" });
    },
  };

  const phase = makePhase({
    name: "plan",
    concurrency: "singleton",
    writablePaths: ["src/**"],
    gates: [capture],
  });
  const chain: Chain = { phases: [phase], humanOnly: [] };

  const agent = singleAgent(async (cwd) => {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "café.ts"), "export const x = 1;\n");
    // Staged with `-A`, never by naming the path in argv: git-for-windows
    // re-parses its own command line through MSYS2, which mangles non-ASCII
    // arguments (`.claude/rules/platform-facts.md`).
    await exec("git", ["add", "-A"], { cwd });
    await exec("git", ["commit", "-q", "-m", "plan: non-ascii path"], {
      cwd,
    });
  });

  const dispatcher = new Dispatcher({
    chainLoader: staticLoader(chain),
    repoRoot: fx.repo,
    configDir: fx.configDir,
    agent,
    log: silent,
  });

  const outcome = await dispatcher.tick();

  expect(seen).toEqual([["src/café.ts"]]);
  // And the fence judged that spelling: nothing reverted, the file landed
  // on trunk under the name git committed it as.
  expect(outcome.result?.committed).toBe(true);
  expect(outcome.result?.gateResults.every((g) => g.ok)).toBe(true);
  expect(existsSync(join(fx.repo, "src", "café.ts"))).toBe(true);
});

describe("Dispatcher fanout — ship classification is the chain's call, not the engine's (spec/pending.md \"Ship detection trusts the agent's own account\")", () => {
  it("a commit touching no declared file still ships when the phase declares no `shipped` predicate", async () => {
    // A commit outside the entry's declared files once stayed pending
    // forever. No path predicate remains, and an undeclared `shipped` means
    // shipped regardless of what the diff touches.
    await writePending(fx.repo, [makeEntry("NOTE-ONLY-SHIPS", ["src/ok.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**", "notes/**"],
      entryChannelPaths: ["notes/**"],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    // Commit touches only the channel path, never src/ok.ts — and the
    // agent's (default, empty) termination says nothing about parking.
    const agent = fanoutAgent({
      "note-only-ships": async (cwd) => {
        await mkdir(join(cwd, "notes"), { recursive: true });
        await writeFile(join(cwd, "notes", "finding.md"), "context\n");
        await exec("git", ["add", "."], { cwd });
        await exec(
          "git",
          ["commit", "-q", "-m", "build(NOTE-ONLY-SHIPS): finding"],
          { cwd },
        );
      },
    });

    const warnings: string[] = [];
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: { info: () => {}, warn: (l) => warnings.push(l), error: () => {} },
    });

    const outcome = await dispatcher.tick();

    expect(await readFile(join(fx.repo, "notes/finding.md"), "utf8")).toBe(
      "context\n",
    );
    expect(outcome.result?.shippedTags).toEqual(["NOTE-ONLY-SHIPS"]);
    expect(readPendingFromDisk(fx.repo)).toEqual([]);
    expect(warnings.some((w) => w.includes("shipped returned false"))).toBe(
      false,
    );
  });

  it("a normal ship that also touches channels/CHANGELOG is unaffected", async () => {
    await writePending(fx.repo, [makeEntry("NORMAL-SHIP", ["src/ok.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**", "notes/**"],
      entryChannelPaths: ["notes/**"],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    // Ships the declared file and also touches an undeclared channel path —
    // with no `shipped` predicate, neither bears on the outcome.
    const agent = fanoutAgent({
      "normal-ship": async (cwd) => {
        await writeFile(join(cwd, "src", "ok.ts"), "ok\n");
        await mkdir(join(cwd, "notes"), { recursive: true });
        await writeFile(join(cwd, "notes", "finding.md"), "context\n");
        await exec("git", ["add", "."], { cwd });
        await exec(
          "git",
          ["commit", "-q", "-m", "build(NORMAL-SHIP): ship"],
          { cwd },
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual(["NORMAL-SHIP"]);
    expect(await readFile(join(fx.repo, "src/ok.ts"), "utf8")).toBe("ok\n");
    expect(await readFile(join(fx.repo, "notes/finding.md"), "utf8")).toBe(
      "context\n",
    );
    expect(readPendingFromDisk(fx.repo)).toEqual([]);
  });

  it("an agent whose final message says it parked still ships when no predicate is declared — the engine reads no prose (.claude/rules/engine-boundary.md \"Told, not inferred\")", async () => {
    // Fails on the pre-fix tree: a retired prose detector matched
    // /\bpark(?:ed|ing)?\b/i against this message and classified a genuine
    // ship as channel-only, so the entry never left the queue. The instructed
    // workflow produces exactly this message — harness/prompts/build.md tells
    // an agent to park an open question, .claude/rules/collaboration.md tells
    // it to raise judgment calls that way.
    await writePending(fx.repo, [makeEntry("SHIPS-AND-MENTIONS-PARK", ["src/ok.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**", "notes/**"],
      entryChannelPaths: ["notes/**"],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent: Agent = {
      name: "ships-and-mentions-park",
      async invoke(inv) {
        await writeFile(join(inv.cwd, "src", "ok.ts"), "done\n");
        await exec("git", ["add", "."], { cwd: inv.cwd });
        await exec(
          "git",
          ["commit", "-q", "-m", "build(SHIPS-AND-MENTIONS-PARK): ship it"],
          { cwd: inv.cwd },
        );
        return {
          exitCode: 0,
          stdout:
            "Shipped the acceptance criteria. Also parked a follow-up question in open-questions.md.\n",
          stderr: "",
        };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual(["SHIPS-AND-MENTIONS-PARK"]);
    expect(readPendingFromDisk(fx.repo)).toEqual([]);
  });

  it("an entry the phase's own `shipped` predicate rejects is not classified shipped, even though its commit landed and gates passed", async () => {
    await writePending(fx.repo, [makeEntry("STATED-PARK", ["src/ok.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**", "notes/**"],
      entryChannelPaths: ["notes/**"],
      // The chain's convention, not the engine's: this one calls a commit
      // touching only the entry's note channel unfinished. The engine has no
      // such notion and never inspects the message below.
      shipped: ({ touchedPaths }) =>
        !(
          touchedPaths.length > 0 &&
          touchedPaths.every((p) => p === "notes/park.md")
        ),
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    // The agent's final message says "Parked" in prose — deliberately, to
    // prove the engine no longer reads it. What keeps the entry pending is
    // the chain's predicate reading the commit's own shape.
    const agent: Agent = {
      name: "parking-fanout",
      async invoke(inv) {
        const slug = basename(inv.cwd);
        if (slug !== "stated-park") {
          throw new Error(`parking-fanout: no action for slug '${slug}'`);
        }
        await mkdir(join(inv.cwd, "notes"), { recursive: true });
        await writeFile(join(inv.cwd, "notes", "park.md"), "blocked\n");
        await exec("git", ["add", "."], { cwd: inv.cwd });
        await exec(
          "git",
          ["commit", "-q", "-m", "build(STATED-PARK): park the conflict"],
          { cwd: inv.cwd },
        );
        return {
          exitCode: 0,
          stdout:
            "Parked: entry needs a design decision outside this tick's scope.\n",
          stderr: "",
        };
      },
    };

    const warnings: string[] = [];
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: { info: () => {}, warn: (l) => warnings.push(l), error: () => {} },
    });

    const outcome = await dispatcher.tick();

    // Lands on trunk regardless — the predicate changes classification, not
    // landing (spec/worktrees.md "In-worktree gate reverts leave a trunk
    // footprint" makes the same landed/classified split).
    expect(await readFile(join(fx.repo, "notes/park.md"), "utf8")).toBe(
      "blocked\n",
    );
    expect(outcome.result?.shippedTags).toEqual([]);
    expect((readPendingFromDisk(fx.repo)).map((e) => e.tag)).toEqual([
      "STATED-PARK",
    ]);
    expect(
      warnings.some(
        (w) => w.includes("STATED-PARK") && w.includes("shipped returned false"),
      ),
    ).toBe(true);
  });

  it("a wave's second entry's ShipContext.gateResults never carries an earlier sibling's afterMerge results", async () => {
    // Two disjoint entries in one wave, both passing the same afterMerge
    // gate. Pre-fix, `mergeGateResults` is a single wave-level accumulator
    // never reset between entries, so by the time the second-processed
    // entry's `shipped` predicate runs, the array already carries the first
    // entry's afterMerge result too — ShipContext.gateResults docstring says
    // "this entry's own", not "the wave's so far".
    const entries = [
      makeEntry("LEAK-FIRST", ["src/leak-first.ts"]),
      makeEntry("LEAK-SECOND", ["src/leak-second.ts"]),
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const recordGate: Gate = {
      name: "record-gate",
      when: "afterMerge",
      async run() {
        return { ok: true, message: "recorded" };
      },
    };

    const seenGateResults: Record<string, unknown[]> = {};
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [recordGate],
      shipped: (ctx) => {
        seenGateResults[ctx.entry.tag] = [...ctx.gateResults];
        return true;
      },
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "leak-first": async (cwd) => {
        await writeAndCommit(
          cwd,
          "src/leak-first.ts",
          "leak-first\n",
          "build(LEAK-FIRST)",
        );
      },
      "leak-second": async (cwd) => {
        await writeAndCommit(
          cwd,
          "src/leak-second.ts",
          "leak-second\n",
          "build(LEAK-SECOND)",
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    // Both entries shipped — the predicate accepted both.
    expect([...(outcome.result?.shippedTags ?? [])].sort()).toEqual([
      "LEAK-FIRST",
      "LEAK-SECOND",
    ]);

    // Every entry the predicate saw — first-processed or not — carries
    // exactly its own gate results (its own afterCommit writable-paths
    // check plus its own single afterMerge result), never a sibling's
    // afterMerge result folded in too.
    for (const tag of ["LEAK-FIRST", "LEAK-SECOND"]) {
      const gr = seenGateResults[tag] as
        | { gate: string; ok: boolean }[]
        | undefined;
      expect(gr).toBeDefined();
      expect(gr!.filter((g) => g.gate === "record-gate")).toEqual([
        { gate: "record-gate", ok: true, message: "recorded" },
      ]);
    }
  });
});

describe("Dispatcher fanout — empty pickable set", () => {
  it("returns no-commit when nothing in pending is pickable", async () => {
    // Single entry blocked by an upstream that's still in pending.
    const entries: PendingEntry[] = [
      {
        ...makeEntry("DOWN", ["src/down.ts"]),
        gate: { kind: "blockedBy", tags: ["UP"] },
      },
      {
        ...makeEntry("UP", ["src/up.ts"]),
        gate: { kind: "parked", reason: "human needed" },
      },
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({});

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const preHead = await head(fx.repo);
    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(false);
    expect(outcome.result?.shippedTags).toEqual([]);
    expect(await head(fx.repo)).toBe(preHead);
    // pendingAfter unchanged.
    expect(outcome.result?.pendingAfter.map((e) => e.tag).sort()).toEqual([
      "DOWN",
      "UP",
    ]);
  });
});

describe("Dispatcher fanout — quarantine visibility on TickResult (dispatcher-quarantine-visibility)", () => {
  it("a fanout tick with every open entry quarantined reports nothingPickable:true, and a quarantined tag is reported with the key its hold stands under", async () => {
    const entries: PendingEntry[] = [
      makeEntry("QUARANTINED-A", ["src/a.ts"]),
      makeEntry("QUARANTINED-B", ["src/b.ts"]),
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const agent = fanoutAgent({});

    const preHead = await head(fx.repo);

    // Quarantine keys are read off the queue as the dispatcher parses it —
    // the same `parsePendingQueue` it uses, so the two sides cannot disagree on
    // what an entry's bytes hash to.
    const onDisk = readPendingFromDisk(fx.repo);
    const keys = onDisk.map((e) => entryDeclaredKey(e));

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      quarantinedSlugs: new Set(keys),
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(false);
    expect(outcome.result?.nothingPickable).toBe(true);
    expect(
      [...(outcome.result?.quarantinedTags ?? [])].sort((a, b) =>
        a.tag.localeCompare(b.tag),
      ),
    ).toEqual([
      { tag: "QUARANTINED-A", key: keys[0] },
      { tag: "QUARANTINED-B", key: keys[1] },
    ]);
    // pending.json itself is untouched — the entries still read `open`.
    expect(outcome.result?.pendingAfter.map((e) => e.tag).sort()).toEqual([
      "QUARANTINED-A",
      "QUARANTINED-B",
    ]);
    expect(await head(fx.repo)).toBe(preHead);
  });

  it("quarantinedTags is empty (not absent) on a nothing-pickable tick with no quarantine", async () => {
    const entries: PendingEntry[] = [
      {
        ...makeEntry("DOWN", ["src/down.ts"]),
        gate: { kind: "blockedBy", tags: ["UP"] },
      },
      {
        ...makeEntry("UP", ["src/up.ts"]),
        gate: { kind: "parked", reason: "human needed" },
      },
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const agent = fanoutAgent({});

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.nothingPickable).toBe(true);
    expect(outcome.result?.quarantinedTags).toEqual([]);
  });

  it("both fields are absent on a tick that provisioned an entry", async () => {
    const entries = [makeEntry("SHIPS", ["src/ships.ts"])];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      ships: (cwd) =>
        writeAndCommit(cwd, "src/ships.ts", "from-ships\n", "build(SHIPS): ship"),
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    expect(outcome.result?.shippedTags).toEqual(["SHIPS"]);
    expect(outcome.result?.nothingPickable).toBeUndefined();
    expect(outcome.result?.quarantinedTags).toBeUndefined();
  });
});

/**
 * THE-PICKABLE-SET-CARRIES-A-CHAIN-DECLARED-REFUSAL (`spec/harness.md`, *The
 * default `handoff`*): a chain that must decline one entry could previously
 * only decline the whole phase. `Chain.refusesEntry` is the injection point;
 * the engine enforces it on every pickable set it reports and names what it
 * held back on `TickResult.refusedTags`
 * (`.claude/rules/engine-boundary.md`, *Capability vs convention*).
 *
 * Every case below drives the real predicate through the real selection —
 * a whole `Dispatcher.tick()` — rather than calling `pickableSelection`
 * beside it, because the claim is that the engine's *reported* sets carry
 * the refusal, and a set asserted at its own producer proves only
 * self-agreement (`.claude/rules/engineering.md`, *A seam gate reads what
 * the real writer wrote*).
 *
 * The agents here commit nothing, so every entry the wave did carry stays in
 * the queue and the post-tick sets are read over a queue that still holds
 * both the picked and the refused — which is what makes "missing from
 * `pickableAfter`" a refusal rather than a ship.
 */
describe("Dispatcher fanout — the pickable set carries a chain-declared per-entry refusal", () => {
  /**
   * Two open entries, disjoint by files. `PICKED` declares the higher
   * `priority`, because the assertions below name the reported sets in
   * order and the queue's order is that field, never the position an
   * entry was written at (`spec/pending.md`, *The entry core*).
   */
  const twoOpen = (): PendingEntry[] => [
    { ...makeEntry("PICKED", ["src/picked.ts"]), priority: 1 },
    makeEntry("HELD", ["src/held.ts"]),
  ];

  /** A fanout `build` phase and the baton woken for it. */
  const wakeBuild = (): Phase => {
    new Baton(join(fx.repo, ".flume")).wake("build");
    return makePhase({ name: "build", concurrency: "fanout", gates: [] });
  };

  it("a chain-declared per-entry refusal removes an entry from the reported pickable set", async () => {
    await writePending(fx.repo, twoOpen());
    const phase = wakeBuild();

    const chain: Chain = {
      phases: [phase],
      humanOnly: [],
      refusesEntry: (ctx) => ctx.entry.tag === "HELD",
    };

    // Registered for `PICKED` alone: the wave throwing "no action registered
    // for slug 'held'" is this case's loudest possible failure, so the
    // refusal is proven at dispatch as well as in the reported set.
    const outcome = await new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({ picked: async () => {} }),
      log: silent,
    }).tick();

    // Non-vacuity: both entries are still queued and still `open`, so the
    // set below is a refusal and not a drained queue. `pendingAfter` is the
    // directory's listing, which carries no order of its own; the queue's
    // order is what `pickableAfter` is reported in.
    expect(outcome.result?.pendingAfter.map((e) => e.tag).sort()).toEqual([
      "HELD",
      "PICKED",
    ]);
    expect(outcome.result?.pickableAfter.map((e) => e.tag)).toEqual(["PICKED"]);
    // Held back at selection, so it never reached an agent at all.
    expect(outcome.result?.entries?.map((e) => e.tag)).toEqual(["PICKED"]);
  });

  it("the engine reports each entry a chain-declared refusal held back", async () => {
    await writePending(fx.repo, [
      makeEntry("PICKED", ["src/picked.ts"]),
      makeEntry("HELD-ONE", ["src/one.ts"]),
      makeEntry("HELD-TWO", ["src/two.ts"]),
    ]);
    const phase = wakeBuild();

    const chain: Chain = {
      phases: [phase],
      humanOnly: [],
      refusesEntry: (ctx) => ctx.entry.tag.startsWith("HELD-"),
    };

    const outcome = await new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({ picked: async () => {} }),
      log: silent,
    }).tick();

    // Non-vacuity: three entries were judged, and the two named below are
    // the ones missing from the pickable set the same tick reported.
    expect(outcome.result?.pendingAfter).toHaveLength(3);
    expect(outcome.result?.pickableAfter.map((e) => e.tag)).toEqual(["PICKED"]);
    expect(outcome.result?.refusedTags).toEqual(["HELD-ONE", "HELD-TWO"]);
    // The engine's own hold is a separate fact and is not borrowed for this
    // one: nothing quarantined this run.
    expect(outcome.result?.quarantinedTags).toBeUndefined();
  });

  it("a chain declaring no per-entry refusal leaves the pickable set unchanged", async () => {
    await writePending(fx.repo, twoOpen());
    const phase = wakeBuild();

    // The same queue and the same phase as the first case, declaring no
    // refusal: both entries are carried, and the reported hold is empty
    // rather than absent, so a chain reads "nothing refused" as a fact.
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const outcome = await new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({ picked: async () => {}, held: async () => {} }),
      log: silent,
    }).tick();

    // `pendingAfter` is the directory's listing, which carries no order;
    // `pickableAfter` is the queue's own order, which is the claim here.
    expect(outcome.result?.pendingAfter.map((e) => e.tag).sort()).toEqual([
      "HELD",
      "PICKED",
    ]);
    expect(outcome.result?.pickableAfter.map((e) => e.tag)).toEqual([
      "PICKED",
      "HELD",
    ]);
    expect(outcome.result?.entries?.map((e) => e.tag).sort()).toEqual([
      "HELD",
      "PICKED",
    ]);
    expect(outcome.result?.refusedTags).toEqual([]);
  });

  it("a chain-declared refusal is handed each entry, its own standing record and the tip the selection was taken at", async () => {
    await writePending(fx.repo, twoOpen());
    const flumeDir = join(fx.repo, ".flume");
    await mkdir(join(flumeDir, "prior-attempts", "entry"), { recursive: true });
    const held = twoOpen().find((e) => e.tag === "HELD")!;
    const record: PriorAttempt = {
      mode: "clean-exit",
      finalMessage: "nothing to do here",
      key: "entry",
      keyedAs: slugify("HELD"),
      declaredAs: entryDeclaredKey(held),
      headSha: "0".repeat(40),
      at: "2024-01-01T00:00:00.000Z",
    };
    await writeFile(
      join(flumeDir, "prior-attempts", "entry", `${slugify("HELD")}.json`),
      JSON.stringify(record),
    );

    const phase = wakeBuild();
    const seen: EntryRefusalContext[] = [];
    const chain: Chain = {
      phases: [phase],
      humanOnly: [],
      refusesEntry: (ctx) => {
        seen.push(ctx);
        return ctx.entry.tag === "HELD";
      },
    };

    const preHead = await head(fx.repo);
    await new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({ picked: async () => {} }),
      log: silent,
    }).tick();

    // The wave's opening selection, before the post-tick re-derivation adds
    // its own consults: one per entry the gate switch cleared, in queue
    // order, each carrying the entry as read.
    const opening = seen.slice(0, 2);
    expect(opening.map((ctx) => ctx.entry.tag)).toEqual(["PICKED", "HELD"]);
    expect(opening[0]!.entry).toEqual(twoOpen()[0]);
    // The record standing for `HELD` reaches the predicate; `PICKED` has
    // none, and absent is absent rather than a record that failed to decode.
    expect(opening[0]!.priorAttempt).toBeUndefined();
    expect(opening[1]!.priorAttempt).toEqual(record);
    // The tip the selection was taken at — the engine's own number, not the
    // anchor the record carries.
    expect(opening.map((ctx) => ctx.headSha)).toEqual([preHead, preHead]);
    expect(preHead).not.toBe(record.headSha);
    // …and each entry's own declaration key beside it, so a predicate asking
    // "is that record still about this entry" compares two values the engine
    // derived rather than respelling either (`EntryRefusalContext.declaredAs`,
    // `src/Phase.ts`). For `HELD` it is the key the standing record carries.
    expect(opening.map((ctx) => ctx.declaredAs)).toEqual(
      twoOpen().map((e) => entryDeclaredKey(e)),
    );
    expect(opening[1]!.declaredAs).toBe(record.declaredAs);
  });

  it("a singleton hook's TickContext.pickable carries the same chain-declared refusal a wave applies", async () => {
    await writePending(fx.repo, twoOpen());

    let captured: readonly PendingEntry[] | undefined;
    const planPhase = makePhase({
      name: "plan",
      concurrency: "singleton",
      // Declines every time — this case wants the selection the dispatcher
      // handed the hook, not a committed tick.
      shouldRun: (ctx) => {
        captured = ctx.pickable;
        return false;
      },
    });
    const chain: Chain = {
      phases: [planPhase],
      humanOnly: [],
      refusesEntry: (ctx) => ctx.entry.tag === "HELD",
    };

    new Baton(join(fx.repo, ".flume")).wake("plan");
    const outcome = await new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async () => {}),
      log: silent,
    }).tick();

    // Non-vacuity: the hook ran and was handed a set, over a queue that
    // still carries both entries.
    expect(captured).toBeDefined();
    expect(outcome.result?.pendingAfter.map((e) => e.tag).sort()).toEqual([
      "HELD",
      "PICKED",
    ]);
    expect(captured!.map((e) => e.tag)).toEqual(["PICKED"]);
    expect(outcome.result?.refusedTags).toEqual(["HELD"]);
  });
});

/**
 * QUARANTINE-KEYS-THE-ENTRY-AS-READ (spec/loop.md "Repeated identical
 * failures — quarantine, then abort"): the run-scoped quarantine holds an
 * entry **as read** — slug plus a hash of its bytes in `pending.json` — so an
 * edit on trunk mints a new key and lifts the hold inside the same run. A
 * slug-only key survived a re-scope and forced stop-and-relaunch (field
 * report, 0.12.0).
 *
 * Both cases drive the real writer into the real reader: the key the
 * dispatcher reports on its own failure record is the one fed back to the
 * next tick's drop filter, rather than a shape re-authored here.
 */
describe("Dispatcher — the run-scoped quarantine keys the entry as read (QUARANTINE-KEYS-THE-ENTRY-AS-READ)", () => {
  const alwaysVeto: Gate = {
    name: "always-veto",
    when: "afterCommit",
    async run() {
      return { ok: false, message: "veto" };
    },
  };

  it("a quarantine key is the entry's slug and a hash of its bytes in the queue", async () => {
    await writePending(fx.repo, [makeEntry("REKEY-ME", ["src/rekey.ts"])]);
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [alwaysVeto],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const agent = fanoutAgent({
      "rekey-me": (cwd) =>
        writeAndCommit(cwd, "src/rekey.ts", "v1\n", "build(REKEY-ME): attempt"),
    });
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const first = await dispatcher.tick();
    const firstFailure = (first.verdict?.gateFailures ?? [])[0];
    expect(firstFailure?.tag).toBe("REKEY-ME");
    // Slug half, then a hash half — the entry is blamed by name *and* by the
    // read it was blamed under.
    expect(firstFailure?.quarantineKey).toMatch(/^rekey-me@[0-9a-f]{10}$/);
    // And that hash is of the entry as the dispatcher parsed it, not of some
    // other rendering of the same tag. Note the wave has since merged the
    // reverted attempt's footprint onto the entry — `observedFiles` is the
    // engine's own accretion and is excluded from the hash by name, so the
    // key the blame was filed under still identifies the entry on disk.
    const afterBlame = readPendingFromDisk(fx.repo);
    expect(afterBlame[0]?.observedFiles).toEqual(["src/rekey.ts"]);
    expect(firstFailure?.quarantineKey).toBe(entryDeclaredKey(afterBlame[0]!));

    // Same tag, different bytes: re-scoped on trunk, gate still vetoes.
    await writePending(fx.repo, [
      makeEntry("REKEY-ME", ["src/rekey.ts", "src/widened.ts"]),
    ]);
    baton.wake("build");
    const second = await dispatcher.tick();
    const secondFailure = (second.verdict?.gateFailures ?? [])[0];

    expect(secondFailure?.tag).toBe("REKEY-ME");
    expect(secondFailure?.quarantineKey).toMatch(/^rekey-me@[0-9a-f]{10}$/);
    // Slug half unchanged, hash half moved — the key tracks the bytes.
    expect(secondFailure?.quarantineKey).not.toBe(firstFailure?.quarantineKey);
  });

  it("an entry re-scoped on trunk is pickable again without a relaunch", async () => {
    await writePending(fx.repo, [makeEntry("RESCOPED", ["src/rescoped.ts"])]);
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const agent = fanoutAgent({
      rescoped: (cwd) =>
        writeAndCommit(
          cwd,
          "src/rescoped.ts",
          "shipped\n",
          "build(RESCOPED): ship",
        ),
    });
    const dispatcherOpts = {
      chainLoader: staticLoader({
        phases: [phase],
        humanOnly: [],
      } satisfies Chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    };

    // The hold the supervisor would be carrying — taken from the real writer
    // (a tick that blamed this entry through a vetoing gate), not re-derived
    // here, so the drop filter below is read against exactly what the engine
    // reports. The same Set instance then crosses both ticks: this is one
    // run, and a relaunch is precisely what must not be needed.
    const blaming = await new Dispatcher({
      ...dispatcherOpts,
      chainLoader: staticLoader({
        phases: [makePhase({ ...phase, gates: [alwaysVeto] })],
        humanOnly: [],
      } satisfies Chain),
    }).tick();
    const heldKey = (blaming.verdict?.gateFailures ?? [])[0]?.quarantineKey;
    const held = new Set([heldKey!]);
    baton.wake("build");

    const blocked = await new Dispatcher({
      ...dispatcherOpts,
      quarantinedSlugs: held,
    }).tick();
    // Non-vacuity: the hold really is in force before the re-scope.
    expect(blocked.result?.nothingPickable).toBe(true);
    expect(blocked.result?.shippedTags).toEqual([]);
    expect(blocked.result?.quarantinedTags).toEqual([
      { tag: "RESCOPED", key: [...held][0] },
    ]);

    // The operator widens the entry's scope on trunk — new bytes, new key.
    await writePending(fx.repo, [
      makeEntry("RESCOPED", ["src/rescoped.ts", "src/widened.ts"]),
    ]);
    baton.wake("build");

    const after = await new Dispatcher({
      ...dispatcherOpts,
      quarantinedSlugs: held,
    }).tick();

    expect(after.result?.nothingPickable).toBeUndefined();
    expect(after.result?.quarantinedTags).toBeUndefined();
    expect(after.result?.shippedTags).toEqual(["RESCOPED"]);
  });
});

describe("Dispatcher fanout — a corrupt entry file refuses instead of reading as empty (PENDING-PARSE-FAILURE-REFUSES)", () => {
  it("a tick whose queue fails to parse invokes no agent and returns failed, instead of nothing-pickable plus a clean hibernation", async () => {
    const corruptEntry = join(queueDirOf(fx.repo), entryFileName("CORRUPT"));
    // Committed, not left on disk uncommitted — the decide-read now resolves
    // the committed tip (spec/pending.md "Dispatch reads come from the tip,
    // not the tree"), so an uncommitted corrupt file would be invisible to
    // it and the tick would see an empty queue instead of refusing.
    await commitEntryFile(
      fx.repo,
      entryFileName("CORRUPT"),
      "{ this is not valid json",
    );
    new Baton(join(fx.repo, ".flume")).wake("build");

    // Not the queue's writer: the carve-out (spec/pending.md "Queue reads are
    // strict") turns on the declared fence, and `src/**` names no queue path.
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    let invoked = false;
    const agent: Agent = {
      name: "fake-fanout",
      async invoke() {
        invoked = true;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const errors: string[] = [];
    const rec: Logger = { info: () => {}, warn: () => {}, error: (l) => errors.push(l) };

    const preHead = await head(fx.repo);
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: rec,
    });

    const outcome = await dispatcher.tick();

    expect(invoked).toBe(false);
    expect(outcome.failed).toBe(true);
    expect(outcome.ledgerRefusal).toBe("parse-failure");
    expect(tickExitCode(outcome)).toBe(EX_MOUNT_DEAD);
    expect(outcome.hibernated).toBe(false);
    expect(outcome.result).toBeUndefined();
    expect(
      errors.some((e) => /plan\/pending/.test(e) && /parse/.test(e)),
    ).toBe(true);
    // No further commit was made — the corrupt tip is untouched.
    expect(await head(fx.repo)).toBe(preHead);
    expect(await readFile(corruptEntry, "utf8")).toBe("{ this is not valid json");
  });

  it("a wave whose queue is corrupted after tick start leaves the entry file byte-identical rather than draining it", async () => {
    const entries = [makeEntry("SHIP-A", ["src/a.ts"])];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout", gates: [] });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const corruptEntry = join(queueDirOf(fx.repo), entryFileName("CORRUPT"));

    // Stands in for a concurrent process corrupting pending.json mid-wave —
    // same mechanism the sibling "commitPendingUpdate rewrite reads fresh"
    // suite above uses to simulate a race, but this time the concurrent
    // write is unparseable rather than a valid concurrent edit. Committed,
    // since the rewrite read now resolves the committed tip rather than the
    // working tree.
    const corrupt = "{ corrupted mid-wave, not json";
    const agent = fanoutAgent({
      "ship-a": async (cwd) => {
        await commitEntryFile(fx.repo, entryFileName("CORRUPT"), corrupt);
        await writeAndCommit(cwd, "src/a.ts", "from-A\n", "build(SHIP-A): ship");
      },
    });

    const errors: string[] = [];
    const rec: Logger = { info: () => {}, warn: () => {}, error: (l) => errors.push(l) };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: rec,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.failed).toBe(true);
    // The rewrite never derived `[]` from the corrupted read and overwrote
    // it — the concurrent corruption survives byte-for-byte.
    expect(await readFile(corruptEntry, "utf8")).toBe(corrupt);
  });

  it("LOOP-WAVE-VERDICT-LOST-ON-LEDGER-PARSEFAILURE: a wave that cherry-picks and gates entries clean, then fails commitPendingUpdate's rewrite read, still writes a tick verdict recording the shipped tags", async () => {
    const entries = [makeEntry("SHIP-A", ["src/a.ts"])];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout", gates: [] });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const corruptEntry = join(queueDirOf(fx.repo), entryFileName("CORRUPT"));

    // Same mechanism as the sibling test above: the agent corrupts
    // pending.json mid-wave, after the decide-read that picked SHIP-A but
    // before commitPendingUpdate's rewrite read runs. The cherry-pick and
    // afterMerge gate (none declared, so trivially clean) both land before
    // the corruption is ever read. Committed, since the rewrite read now
    // resolves the committed tip rather than the working tree.
    const corrupt = "{ corrupted mid-wave, not json";
    const agent = fanoutAgent({
      "ship-a": async (cwd) => {
        await commitEntryFile(fx.repo, entryFileName("CORRUPT"), corrupt);
        await writeAndCommit(cwd, "src/a.ts", "from-A\n", "build(SHIP-A): ship");
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    // The refusal itself is unchanged: exit-69-worthy failure, ledger left
    // corrupt rather than overwritten with a rewrite derived from `[]`.
    expect(outcome.failed).toBe(true);
    expect(outcome.ledgerRefusal).toBe("parse-failure");
    expect(tickExitCode(outcome)).toBe(EX_MOUNT_DEAD);
    expect(await readFile(corruptEntry, "utf8")).toBe(corrupt);

    // The defect this test pins: the wave's shipped tags used to vanish
    // with the thrown PendingParseFailure instead of reaching a verdict.
    expect(outcome.verdict).toBeDefined();
    expect(outcome.verdict?.shippedTags).toEqual(["SHIP-A"]);
    expect(outcome.verdict?.committed).toBe(true);
    expect(outcome.verdict?.tags).toEqual(["SHIP-A"]);
    expect(outcome.verdict?.phaseName).toBe("build");
  });

  it("LOOP-WAVE-VERDICT-LOST-ON-LEDGER-PARSEFAILURE (multi-entry): a wave with one shipped and one declined entry still folds both facts into the verdict when the ledger rewrite fails", async () => {
    const entries = [
      makeEntry("SHIP-A", ["src/a.ts"]),
      makeEntry("DECLINE-B", ["src/b.ts"]),
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const corruptEntry = join(queueDirOf(fx.repo), entryFileName("CORRUPT"));

    // Same corruption mechanism as the single-entry sibling above, but the
    // wave now carries a second, declined entry (the shouldRun seam)
    // alongside the shipping one — the shape spec/loop.md "The tick verdict"
    // drift (b) actually describes: `waveDeclined`, computed from the
    // per-entry loop before `commitPendingUpdate` runs, must survive
    // onto `WaveLedgerRefusal`'s carried verdict exactly like
    // `shippedTags` does, not just the trivial single-entry case.
    const corrupt = "{ corrupted mid-wave, not json";
    const invoked: string[] = [];
    const agent = fanoutAgent({
      "ship-a": async (cwd) => {
        invoked.push("SHIP-A");
        await commitEntryFile(fx.repo, entryFileName("CORRUPT"), corrupt);
        await writeAndCommit(cwd, "src/a.ts", "from-A\n", "build(SHIP-A): ship");
      },
      "decline-b": async () => {
        invoked.push("DECLINE-B");
      },
    });

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
      shouldRun: (ctx) => ctx.assignedEntry?.tag !== "DECLINE-B",
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    // DECLINE-B never reached the agent; SHIP-A did and shipped.
    expect(invoked).toEqual(["SHIP-A"]);

    // The refusal itself is unchanged: exit-69-worthy failure, ledger left
    // corrupt rather than overwritten with a rewrite derived from `[]`.
    expect(outcome.failed).toBe(true);
    expect(outcome.ledgerRefusal).toBe("parse-failure");
    expect(tickExitCode(outcome)).toBe(EX_MOUNT_DEAD);
    expect(await readFile(corruptEntry, "utf8")).toBe(corrupt);

    // The defect this test pins: a multi-entry wave's mixed outcomes —
    // one shipped, one declined — must both fold into the verdict carried
    // on the thrown `WaveLedgerRefusal`, not just the shipped tag.
    expect(outcome.verdict).toBeDefined();
    expect(outcome.verdict?.shippedTags).toEqual(["SHIP-A"]);
    expect(outcome.verdict?.committed).toBe(true);
    expect(outcome.verdict?.tags).toEqual(
      expect.arrayContaining(["SHIP-A", "DECLINE-B"]),
    );
    expect(outcome.verdict?.tags).toHaveLength(2);
    expect(outcome.verdict?.declined).toBe(true);
    expect(outcome.verdict?.phaseName).toBe("build");
  });

  it("a ledger-rewrite refusal over a wave that shipped nothing carries the wave's gate-revert cause on its verdict", async () => {
    // The refusal-site verdict reads its no-commit cause through
    // `waveNoCommitCause`, whose first line short-circuits on `committedWave`.
    // Every other exercise of that site ships an entry, so the precedence chain
    // below the short-circuit has never run there (.claude/rules/engineering.md
    // "A green verdict is proven non-vacuous"): a wave that ships nothing is
    // the only shape that evaluates it.
    //
    // Reaching it needs both halves at once — shipped=0 *and* a recorded
    // footprint, since `commitPendingUpdate` (and so the rewrite read that
    // refuses) is skipped entirely when the wave has neither. An in-worktree
    // afterCommit writable-paths revert supplies exactly that: nothing
    // reaches cherry-pick, the entry's captured footprint still needs a
    // trunk commit, and the entry's own cause is `gate-revert`.
    await writePending(fx.repo, [makeEntry("REVERT-ONLY", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      scopeWritesToEntry: true,
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const corruptEntry = join(queueDirOf(fx.repo), entryFileName("CORRUPT"));

    // Same mid-wave corruption mechanism as the shipping siblings above: a
    // concurrent writer lands unparseable bytes on trunk after this wave's
    // decide-read and before `commitPendingUpdate`'s rewrite read.
    const corrupt = "{ corrupted mid-wave, not json";
    const agent = fanoutAgent({
      "revert-only": async (cwd) => {
        await commitEntryFile(fx.repo, entryFileName("CORRUPT"), corrupt);
        await writeFile(join(cwd, "src", "a.ts"), "a\n");
        await writeFile(join(cwd, "src", "stray.ts"), "stray\n");
        await exec("git", ["add", "."], { cwd });
        await exec(
          "git",
          ["commit", "-q", "-m", "build(REVERT-ONLY): overreach"],
          { cwd },
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    // The refusal itself, unchanged from the shipping siblings: failed tick,
    // ledger left byte-identical rather than overwritten with a rewrite
    // derived from `[]`.
    expect(outcome.failed).toBe(true);
    expect(await readFile(corruptEntry, "utf8")).toBe(corrupt);

    const verdict = outcome.verdict;
    expect(verdict).toBeDefined();
    // …and this verdict is the refusal site's, not a clean completion's:
    // only the `WaveLedgerRefusal` leg summarizes a wave this way.
    expect(verdict?.summary).toContain("pending-ledger rewrite refused");

    // Vacuity pins for the leg this test exists to judge — without all
    // three, the `noCommit` assertion below would pass over a wave that
    // never reached the precedence chain at all:
    //   1. the wave shipped nothing, so `waveNoCommitCause`'s
    //      `committedWave` short-circuit did NOT fire;
    expect(verdict?.shippedTags).toEqual([]);
    expect(verdict?.committed).toBe(false);
    //   2. the entry was afterCommit-gate-reverted with a real footprint —
    //      the only reason `commitPendingUpdate` ran at all with shipped=0,
    //      and so the only reason the rewrite read refused;
    expect(verdict?.mergeOutcomes).toEqual([
      {
        entryTag: "REVERT-ONLY",
        outcome: "afterCommit-reverted",
        footprint: expect.arrayContaining(["src/a.ts", "src/stray.ts"]),
        baseSha: expect.stringMatching(/^[0-9a-f]{40}$/),
        headSha: expect.stringMatching(/^[0-9a-f]{40}$/),
      },
    ]);
    //   3. the wave really did carry the entry, and the gate really failed.
    expect(verdict?.tags).toEqual(["REVERT-ONLY"]);
    expect(verdict?.gateFailures).toEqual([
      expect.objectContaining({ tag: "REVERT-ONLY" }),
    ]);

    // The claim: the refusal-site verdict reports the same cause a clean
    // completion would have (.claude/rules/engineering.md "Derived state is
    // computed, never restated beside its source") — not `undefined` from a
    // short-circuit that never ran, and not a cause invented at the refusal
    // site.
    expect(verdict?.noCommit).toBe("gate-revert");

    // Nothing shipped: the entry is still queued under the corrupt bytes
    // the refusal preserved, and neither written file reached trunk.
    expect(existsSync(join(fx.repo, "src", "a.ts"))).toBe(false);
    expect(existsSync(join(fx.repo, "src", "stray.ts"))).toBe(false);
  });

  /**
   * A one-entry wave that cherry-picks and gates clean, and then meets a
   * ledger commit git refuses for a reason that is **not** a parse failure.
   *
   * The arming is an afterMerge gate that leaves a paused merge standing in
   * the primary checkout — a `MERGE_HEAD` beside the tip, exactly the state an
   * operator's own interrupted `git merge` or `git cherry-pick` leaves behind.
   * `commitPendingUpdate`'s commit is a `git commit --only` over the one named
   * ledger path, and git fatals on a partial commit while a merge is in
   * progress (measured, git 2.43). The queue's own bytes parse on both sides
   * of the refusal, which is what puts this outside `PendingParseFailure` and
   * on the arm that used to re-throw bare.
   *
   * Returns the tick settled either way — outcome or throw — because whether
   * it throws at all is one of the two properties under test.
   */
  async function waveRefusedByPausedMerge(): Promise<{
    outcome: Awaited<ReturnType<Dispatcher["tick"]>> | undefined;
    thrown: unknown;
    armed: boolean;
  }> {
    await writePending(fx.repo, [makeEntry("SHIP-A", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    let armed = false;
    const pauseMerge: Gate = {
      name: "pause-merge",
      when: "afterMerge",
      async run() {
        await writeFile(
          join(fx.repo, ".git", "MERGE_HEAD"),
          `${await head(fx.repo)}\n`,
        );
        armed = true;
        return { ok: true, message: "merge paused in the primary checkout" };
      },
    };

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [pauseMerge],
    });
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({
        "ship-a": (cwd) =>
          writeAndCommit(cwd, "src/a.ts", "from-A\n", "build(SHIP-A): ship"),
      }),
      log: silent,
      maxParallel: 4,
    });

    let thrown: unknown;
    const outcome = await dispatcher.tick().catch((err: unknown) => {
      thrown = err;
      return undefined;
    });
    return { outcome, thrown, armed };
  }

  /**
   * The queue as trunk holds it after the refusal, parsed. Two facts in one
   * read: the rewrite's commit never landed (SHIP-A is still queued), and the
   * bytes it would have parsed are valid — so nothing here could have thrown
   * `PendingParseFailure`, which is what makes these two cases the arm outside
   * it rather than the one the sibling suites above already cover.
   */
  async function tipQueueTags(): Promise<string[]> {
    const files = await readQueueAtRef(
      fx.repo,
      "HEAD",
      ".flume/plan/pending",
    );
    expect(files).not.toBeNull();
    const parsed = parsePendingQueue(files ?? []);
    expect(parsed.ok).toBe(true);
    return parsed.ok ? parsed.entries.map((e) => e.tag) : [];
  }

  it("a ledger commit refusing outside a parse failure still carries the wave's shipped tags in its verdict", async () => {
    const { outcome, thrown, armed } = await waveRefusedByPausedMerge();

    // Vacuity pins for the arm this case exists to judge: the paused merge
    // was really staked, the tick really refused, and the ledger it refused
    // over really parses — without all three the verdict assertions below
    // would pass over the parse-failure arm the siblings above cover.
    expect(armed).toBe(true);
    expect(thrown).toBeUndefined();
    expect(outcome?.failed).toBe(true);
    expect(await tipQueueTags()).toEqual(["SHIP-A"]);

    // The claim: SHIP-A is on trunk — cherry-picked and afterMerge-gated
    // before the ledger commit was ever attempted — so the verdict says so.
    expect(existsSync(join(fx.repo, "src", "a.ts"))).toBe(true);
    const verdict = outcome?.verdict;
    expect(verdict).toBeDefined();
    expect(verdict?.shippedTags).toEqual(["SHIP-A"]);
    expect(verdict?.committed).toBe(true);
    expect(verdict?.tags).toEqual(["SHIP-A"]);
    expect(verdict?.phaseName).toBe("build");
    // …and it is the refusal site's verdict, not a clean completion's.
    expect(verdict?.summary).toContain("pending-ledger rewrite refused");
  });

  it("a ledger-commit refusal outside a parse failure is a failed tick, not a throw out of Dispatcher.tick", async () => {
    const { outcome, thrown, armed } = await waveRefusedByPausedMerge();

    // Same two vacuity pins: the refusal was armed, and it was git's rather
    // than the parser's.
    expect(armed).toBe(true);
    expect(await tipQueueTags()).toEqual(["SHIP-A"]);

    // The claim: `tick()` returns. A bare re-throw here escaped the
    // dispatcher entirely, taking the wave's verdict — and the CLI's own
    // exit-code classification — with it.
    expect(thrown).toBeUndefined();
    expect(outcome).toBeDefined();
    expect(outcome?.failed).toBe(true);
    expect(outcome?.hibernated).toBe(false);
    // The refusal is reported, never softened: the summary is git's own
    // refusal, carried up as the tick's.
    expect(outcome?.summary).toMatch(/partial commit/);
  });

  it("a ledger-commit refusal outside a parse failure names its class, and the process classifier exits 1 over it", async () => {
    const { outcome, thrown, armed } = await waveRefusedByPausedMerge();

    // The same two vacuity pins the siblings carry: the refusal was armed,
    // and it was git's rather than the parser's — without the second the
    // class asserted below would be the one the parse arm already produces.
    expect(armed).toBe(true);
    expect(thrown).toBeUndefined();
    expect(outcome?.failed).toBe(true);
    expect(await tipQueueTags()).toEqual(["SHIP-A"]);

    // The claim, in two halves. The refusing site states its class on the
    // outcome…
    expect(outcome?.ledgerRefusal).toBe("commit-refusal");
    // …and the real classifier reads it: a wave whose entries are on trunk
    // and whose only casualty is the queue rewrite's own commit is an
    // ordinary harness error, so `flume loop` logs it and takes a fresh
    // process — never the mount-dead fail-fast that burns the rest of the
    // run against a wall that is not there (spec/loop.md, "Exit codes — the
    // run never lies to CI").
    expect(tickExitCode(outcome!)).toBe(1);
    expect(tickExitCode(outcome!)).not.toBe(EX_MOUNT_DEAD);
  });

  it("a ledger-commit refusal names the queue path whose rewrite stands on disk uncommitted", async () => {
    const { outcome, thrown, armed } = await waveRefusedByPausedMerge();

    // Vacuity pins for the arm this case exists to judge. The paused merge
    // was really staked and the tick really refused…
    expect(armed).toBe(true);
    expect(thrown).toBeUndefined();
    expect(outcome?.failed).toBe(true);
    // …the commit really never landed — SHIP-A is still queued at the tip…
    expect(await tipQueueTags()).toEqual(["SHIP-A"]);
    // …and the rewrite really is standing in the tree, drained of the tag the
    // tip still carries. Without this the message asserted below would be a
    // claim about a file that matches its tip, which is the tip-claim arm's
    // shape, not this one.
    expect((readPendingFromDisk(fx.repo)).map((e) => e.tag)).toEqual([]);

    // The claim: the refusal states that divergence itself, at the path it is
    // standing at, rather than leaving an operator to find a modified queue in
    // `git status` and attribute it (.claude/rules/engineering.md, "A fact the
    // engine holds is reported, never rediscovered"). The path is git's own
    // spelling of the ledger the chain declared — not a name a reader would
    // have to guess a directory for.
    expect(outcome?.summary).toContain(
      "the rewritten queue stands on disk at .flume/plan/pending, uncommitted",
    );
    // Both operator-facing surfaces carry it: the tick's summary above, and
    // the verdict written for the next process to read.
    expect(outcome?.verdict?.summary).toContain(
      "the rewritten queue stands on disk at .flume/plan/pending, uncommitted",
    );
    // …and git's own refusal is still quoted inside it, never replaced by it.
    expect(outcome?.summary).toMatch(/partial commit/);
  });

  it("a tip-claim refusal reports no uncommitted rewrite, having refused before the write", async () => {
    await writePending(fx.repo, [makeEntry("SHIP-A", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    // The sibling refusal on the same call, taken one step earlier: a live
    // foreign tip claim, checked before the rewrite is written. The claim path
    // comes from the engine's own accessors — a second spelling of the
    // tip-claims layout here would pass while the engine looked somewhere else
    // entirely.
    const ref = await git.currentRefPath(fx.repo);
    expect(ref.kind).toBe("ref");
    const claimPath = git.tipClaimPath(
      await git.gitCommonDir(fx.repo),
      ref.kind === "ref" ? ref.path : "",
    );

    let armed = false;
    const claimTip: Gate = {
      name: "claim-tip",
      when: "afterMerge",
      async run() {
        await mkdir(dirname(claimPath), { recursive: true });
        // The vitest worker plays the live holder, exactly as the CLI's own
        // held-claim case does: this Dispatcher declares no `ownTipClaimPid`,
        // so any live pid reads as a concurrent engine instance. Staked from
        // an afterMerge gate so it lands *after* the cherry-pick's own tip
        // check — otherwise nothing ships and the ledger call is never
        // reached at all.
        await writeFile(claimPath, String(process.pid), "utf8");
        armed = true;
        return { ok: true, message: "tip claimed by a foreign engine" };
      },
    };

    const warnings: string[] = [];
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({
        phases: [makePhase({ name: "build", concurrency: "fanout", gates: [claimTip] })],
        humanOnly: [],
      }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({
        "ship-a": (cwd) =>
          writeAndCommit(cwd, "src/a.ts", "from-A\n", "build(SHIP-A): ship"),
      }),
      log: { info: () => {}, warn: (l) => warnings.push(l), error: () => {} },
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    // Vacuity pins: the claim was really staked, the entry really shipped
    // before it, and the ledger call really refused over it — without all
    // three the report asserted below would be a line no refusal produced.
    expect(armed).toBe(true);
    expect(outcome.verdict?.shippedTags).toEqual(["SHIP-A"]);
    expect(outcome.verdict?.tipMoved).toBe(true);
    expect(await tipQueueTags()).toEqual(["SHIP-A"]);
    // The disk says the same thing the report will: the refusal came before
    // the write, so the queue in the tree is byte-identical to the tip's.
    expect((readPendingFromDisk(fx.repo)).map((e) => e.tag)).toEqual([
      "SHIP-A",
    ]);

    // The claim: this refusal's report names the same path its sibling above
    // does, and states the queue standing there is unchanged — so the one
    // fact that separates the two refusals reaches the operator from the call
    // that holds it, never from the file's mtime
    // (.claude/rules/engineering.md, "A fact the engine holds is reported,
    // never rediscovered").
    const line = warnings.find((l) =>
      l.includes("tip claimed before the pending-ledger commit"),
    );
    expect(line).toBeDefined();
    expect(line).toContain(
      ".flume/plan/pending is unchanged on disk, no rewrite written",
    );
  });
});

// ---------- foundations governor ----------

describe("Dispatcher fanout — foundations governor skips fork-blocked entries", () => {
  it("builds the foundation-settled sibling and skips the one whose fork is open", async () => {
    const entries = [
      {
        ...makeEntry("BLOCKED", ["src/blocked.ts"]),
        dependsOnForks: ["open-fork"],
      },
      {
        ...makeEntry("SETTLED", ["src/settled.ts"]),
        dependsOnForks: ["done-fork"],
      },
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      settled: (cwd) =>
        writeAndCommit(cwd, "src/settled.ts", "ok\n", "build(SETTLED): ship"),
      // No action registered for `blocked` — if it were selected, the agent
      // throws.
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      // "done-fork" resolves, "open-fork" does not.
      forkResolver: () => (slug) => slug === "done-fork",
    });

    const outcome = await dispatcher.tick();

    // Only the settled entry shipped; the fork-blocked one was never built.
    expect(outcome.result?.shippedTags).toEqual(["SETTLED"]);
    expect(readPendingFromDisk(fx.repo)).toEqual([
      expect.objectContaining({ tag: "BLOCKED" }),
    ]);
  });
});

describe("Dispatcher fanout — all entries fork-blocked", () => {
  it("idles with no commit rather than building on an open foundation", async () => {
    const entries = [
      { ...makeEntry("A", ["src/a.ts"]), dependsOnForks: ["open-fork"] },
      { ...makeEntry("B", ["src/b.ts"]), dependsOnForks: ["open-fork"] },
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({}),
      log: silent,
      forkResolver: () => () => false, // nothing resolved
    });

    const preHead = await head(fx.repo);
    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(false);
    expect(outcome.result?.shippedTags).toEqual([]);
    expect(await head(fx.repo)).toBe(preHead);
    expect(outcome.result?.pendingAfter.map((e) => e.tag).sort()).toEqual([
      "A",
      "B",
    ]);
  });
});

describe("Dispatcher fanout — gate=requiresCapability", () => {
  it("builds an entry gated on a capability the chain asserts", async () => {
    const entries: PendingEntry[] = [
      {
        ...makeEntry("GATED", ["src/gated.ts"]),
        gate: { kind: "requiresCapability", capability: "docker-host" },
      },
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = {
      phases: [phase],
      humanOnly: [],
      capabilities: ["docker-host"],
    };

    const agent = fanoutAgent({
      gated: (cwd) =>
        writeAndCommit(cwd, "src/gated.ts", "ok\n", "build(GATED): ship"),
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual(["GATED"]);
    expect(readPendingFromDisk(fx.repo)).toEqual([]);
  });

  it("skips an entry gated on a capability the chain does not assert", async () => {
    const entries: PendingEntry[] = [
      {
        ...makeEntry("GATED", ["src/gated.ts"]),
        gate: { kind: "requiresCapability", capability: "docker-host" },
      },
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    // No `capabilities` declared — "docker-host" is not asserted.
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const preHead = await head(fx.repo);
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({}), // never invoked — GATED must not be selected
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(false);
    expect(outcome.result?.shippedTags).toEqual([]);
    expect(await head(fx.repo)).toBe(preHead);
    expect(outcome.result?.pendingAfter.map((e) => e.tag)).toEqual(["GATED"]);
  });
});

describe("Dispatcher fanout — chain.ts forkResolver export gates selection", () => {
  it("a chain-module forkResolver overrides the constructor default per tick", async () => {
    const entries = [
      { ...makeEntry("ONLY", ["src/only.ts"]), dependsOnForks: ["open-fork"] },
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    // The chain module supplies its own resolver — the stock-CLI adoption
    // path. It marks nothing resolved, so the only entry is fork-blocked.
    const loader = (): Promise<ChainModule> =>
      Promise.resolve({ chain, forkResolver: () => () => false });

    const dispatcher = new Dispatcher({
      chainLoader: loader,
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({}),
      log: silent,
    });

    const preHead = await head(fx.repo);
    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(false);
    expect(await head(fx.repo)).toBe(preHead);
    expect(readPendingFromDisk(fx.repo)).toEqual([
      expect.objectContaining({ tag: "ONLY" }),
    ]);
  });

  it("loadChainModule surfaces a chain.ts forkResolver export → governs selection, overrides the constructor default", async () => {
    // The closure-loader test above proves a ChainModule.forkResolver gates
    // selection, but bypasses loadChainModule — the stock-CLI bridge.
    // This exercises the real extraction: a chain.ts that *exports*
    // forkResolver must have it picked up on disk, exactly as `agent` is.
    const cfg = await mkTempDir("flume-cfg-forkresolver-");
    try {
      await writeFile(join(cfg, "prompt.md"), "dummy\n", "utf8");
      await writeFile(
        join(cfg, "chain.ts"),
        `export default () => ({ chain: { phases: [{ name: "build", description: "", ` +
          `promptPath: "prompt.md", concurrency: "fanout", ` +
          `writablePaths: ["**"], gates: [], handoff: () => [] }], ` +
          `humanOnly: [] },\n` +
          // Nothing resolved — the only entry rests on an open fork.
          `forkResolver: () => () => false });\n`,
        "utf8",
      );

      const entries = [
        {
          ...makeEntry("ONLY", ["src/only.ts"]),
          dependsOnForks: ["open-fork"],
        },
      ];
      await writePending(fx.repo, entries);
      new Baton(join(fx.repo, ".flume")).wake("build");

      // The agent must never run: a fork-blocked entry is filtered before
      // selection, so invocation here would mean the chain export was dropped.
      let invoked = false;
      const agent: Agent = {
        name: "never",
        async invoke() {
          invoked = true;
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      };

      const preHead = await head(fx.repo);
      const dispatcher = new Dispatcher({
        // No chainLoader → real diskChainLoader(cfg) runs loadChainModule.
        repoRoot: fx.repo,
        configDir: cfg,
        // Constructor default resolves everything; the chain export (which
        // resolves nothing) must override it, leaving the entry fork-blocked.
        forkResolver: () => () => true,
        agent,
        log: silent,
      });

      const outcome = await dispatcher.tick();

      expect(invoked).toBe(false);
      expect(outcome.result?.committed).toBe(false);
      expect(await head(fx.repo)).toBe(preHead);
      expect(readPendingFromDisk(fx.repo)).toEqual([
        expect.objectContaining({ tag: "ONLY" }),
      ]);
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  });
});

describe("Dispatcher — per-phase agent resolution", () => {
  function recordingAgent(name: string, ran: string[]): Agent {
    return {
      name,
      async invoke() {
        ran.push(name);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };
  }

  it("phase.agent runs that phase's tick; a silent sibling falls back to chainModule.agent over opts.agent", async () => {
    const ran: string[] = [];
    const phaseAgent = recordingAgent("phase-agent", ran);
    const chainAgent = recordingAgent("chain-agent", ran);
    const optsAgent = recordingAgent("opts-agent", ran);

    const withOwn = makePhase({ name: "plan", agent: phaseAgent });
    const silentPhase = makePhase({ name: "review" });
    const chain: Chain = { phases: [withOwn, silentPhase], humanOnly: [] };

    const loader = (): Promise<ChainModule> =>
      Promise.resolve({ chain, agent: chainAgent });

    const dispatcher = new Dispatcher({
      chainLoader: loader,
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: optsAgent,
      log: silent,
    });

    const baton = new Baton(join(fx.repo, ".flume"));

    // Innermost scope: the phase's own agent wins even with a chain-level
    // override present.
    baton.wake("plan");
    await dispatcher.tick();
    expect(ran).toEqual(["phase-agent"]);

    // Silent phase: the chain > constructor precedence is unchanged.
    baton.wake("review");
    await dispatcher.tick();
    expect(ran).toEqual(["phase-agent", "chain-agent"]);
  });

  it("opts.agent remains the default when phase and chain are both silent", async () => {
    const ran: string[] = [];
    const optsAgent = recordingAgent("opts-agent", ran);

    const chain: Chain = {
      phases: [makePhase({ name: "plan" })],
      humanOnly: [],
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: optsAgent,
      log: silent,
    });

    new Baton(join(fx.repo, ".flume")).wake("plan");
    await dispatcher.tick();
    expect(ran).toEqual(["opts-agent"]);
  });
});

describe("Dispatcher fanout — fork-blocked entry becomes pickable when the predicate flips", () => {
  it("skips the entry while its fork is open, then builds it once the fork resolves", async () => {
    const entries = [
      { ...makeEntry("GATED", ["src/gated.ts"]), dependsOnForks: ["the-fork"] },
    ];
    await writePending(fx.repo, entries);
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      gated: (cwd) =>
        writeAndCommit(cwd, "src/gated.ts", "ok\n", "build(GATED): ship"),
    });

    // Mutable resolver state: the fork is unresolved on tick 1, resolved on 2.
    let resolved = false;
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      forkResolver: () => () => resolved,
    });

    // Tick 1: fork open → entry skipped, nothing ships, entry stays pending.
    const preHead = await head(fx.repo);
    const first = await dispatcher.tick();
    expect(first.result?.committed).toBe(false);
    expect(first.result?.shippedTags).toEqual([]);
    expect(await head(fx.repo)).toBe(preHead);
    expect(readPendingFromDisk(fx.repo)).toEqual([
      expect.objectContaining({ tag: "GATED" }),
    ]);

    // Predicate flips; re-wake the phase the idle handoff slept (() => []).
    resolved = true;
    baton.wake("build");

    // Tick 2: fork resolved → the same entry is now pickable and ships.
    const second = await dispatcher.tick();
    expect(second.result?.shippedTags).toEqual(["GATED"]);
    expect(readPendingFromDisk(fx.repo)).toEqual([]);
  });
});

describe("Dispatcher fanout — no forkResolver supplied never blocks selection", () => {
  it("builds an entry that declares dependsOnForks because the default predicate resolves every slug", async () => {
    const entries = [
      { ...makeEntry("ONLY", ["src/only.ts"]), dependsOnForks: ["some-fork"] },
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      only: (cwd) =>
        writeAndCommit(cwd, "src/only.ts", "ok\n", "build(ONLY): ship"),
    });

    // No forkResolver on the constructor and none on the chain module: the
    // governor's always-resolved default applies, so a declared dependsOnForks
    // never blocks — selection ignores dependsOnForks entirely.
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual(["ONLY"]);
    expect(readPendingFromDisk(fx.repo)).toEqual([]);
  });
});

describe("Dispatcher fanout — forkResolver invoked once per tick with the repo root", () => {
  it("calls the resolver once with repoRoot and lets its predicate govern selection", async () => {
    const entries = [
      { ...makeEntry("OPEN", ["src/open.ts"]), dependsOnForks: ["open-fork"] },
      { ...makeEntry("DONE", ["src/done.ts"]), dependsOnForks: ["done-fork"] },
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      done: (cwd) =>
        writeAndCommit(cwd, "src/done.ts", "ok\n", "build(DONE): ship"),
      // No action for `open` — selecting it would throw.
    });

    const repoRootCalls: string[] = [];
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      forkResolver: (repoRoot) => {
        repoRootCalls.push(repoRoot);
        return (slug) => slug === "done-fork";
      },
    });

    const outcome = await dispatcher.tick();

    // Invoked exactly once for the tick, with the dispatcher's repo root.
    expect(repoRootCalls).toEqual([fx.repo]);
    // The injected predicate governs selection: only the resolved entry ships.
    expect(outcome.result?.shippedTags).toEqual(["DONE"]);
    expect(readPendingFromDisk(fx.repo)).toEqual([
      expect.objectContaining({ tag: "OPEN" }),
    ]);
  });
});

// ---------- gate-failure feedback to the retrying tick ----------

describe("Dispatcher — gate-failure feedback to the retrying tick", () => {
  it("afterCommit gate-revert → next singleton tick's prompt carries gate name + full details + marker; first attempt absent", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");

    const failing: Gate = {
      name: "boom-gate",
      when: "afterCommit",
      async run() {
        return {
          ok: false,
          message: "boom-msg",
          details: "boom-details-XYZ\nsecond line of details",
        };
      },
    };
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [failing],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const prompts: string[] = [];
    const agent: Agent = {
      name: "recording-singleton",
      async invoke(inv) {
        const n = prompts.length;
        prompts.push(inv.prompt);
        await writeAndCommit(
          inv.cwd,
          "src/o.ts",
          `attempt-${n}\n`,
          "plan: attempt",
        );
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    await dispatcher.tick(); // attempt 1 → committed then reverted
    baton.wake("plan"); // re-wake (handoff () => [] slept it)
    await dispatcher.tick(); // attempt 2 → prompt carries the block

    expect(prompts.length).toBe(2);
    // First attempt: no false signal. (gate name/when also live in the
    // <harness> block, so assert on block-only substrings.)
    expect(prompts[0]).not.toContain("<prior-attempt>");
    expect(prompts[0]).not.toContain("boom-details-XYZ");
    // Retry: full block — marker, gate name, FULL details, when.
    expect(prompts[1]).toContain("<prior-attempt>");
    expect(prompts[1]).toContain("Failing gate: boom-gate");
    expect(prompts[1]).toContain("Reverted at: afterCommit");
    expect(prompts[1]).toContain("boom-details-XYZ");
    expect(prompts[1]).toContain("second line of details");
    expect(prompts[1]).toContain("boom-msg");
  });

  it("afterCommit gate-revert whose raw details exceed MAX_PRIOR_DETAILS keeps the failing-test lines AND the closing counts, eliding only the middle (PRIORATTEMPT-GATE-DETAILS-KEEPS-FAILURES)", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");

    // Byte-for-byte the layout this repo's own vitest afterMerge gate emits
    // (measured on a 22 KB capture, 2026-09-06): the `Failed Tests` section
    // — the only place a failing test is *named* — inside the first KB, then
    // ~20 KB of per-test pass lines, then the counts in the last ~200 bytes.
    // Supersedes the tail-only pin this case used to carry, whose fixture put
    // the failure block at the end and was never checked against a reporter.
    const failedTestLine =
      "FAIL  tests/Dispatcher.test.ts > Dispatcher singleton — commit detected > gates green";
    const assertionLine =
      "AssertionError: expected { a: 1, b: 'hello' } to deeply equal { a: 2, b: 'world' }";
    const middleMarker = "MIDDLE-PASS-LIST-MARKER";
    const countsLine = " Test Files  1 failed | 20 passed (21)";
    const passLines = (n: number) => "   ✓ a passing test 3ms\n".repeat(n);
    const details =
      [
        "⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯",
        "",
        ` ${failedTestLine}`,
        assertionLine,
        "",
      ].join("\n") +
      passLines(400) +
      `   ✓ ${middleMarker} 3ms\n` +
      passLines(400) +
      [countsLine, "      Tests  1 failed | 764 passed (791)", ""].join("\n");
    // Vacuity pin: the cap must actually bind, and each end must be far
    // enough from the other that no single-ended slice could keep both.
    expect(details.length).toBeGreaterThan(2 * 8 * 1024);

    const failing: Gate = {
      name: "boom-gate",
      when: "afterCommit",
      async run() {
        return { ok: false, message: "boom-msg", details };
      },
    };
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [failing],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const prompts: string[] = [];
    const agent: Agent = {
      name: "recording-singleton-details-digest",
      async invoke(inv) {
        const n = prompts.length;
        prompts.push(inv.prompt);
        await writeAndCommit(
          inv.cwd,
          "src/o.ts",
          `attempt-${n}\n`,
          "plan: attempt",
        );
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    await dispatcher.tick(); // attempt 1 → committed then reverted
    baton.wake("plan");
    await dispatcher.tick(); // attempt 2 → prompt carries the (truncated) block

    expect(prompts.length).toBe(2);
    expect(prompts[0]).not.toContain("<prior-attempt>");

    const retry = prompts[1]!;
    expect(retry).toContain("<prior-attempt>");
    // The head: *which* test failed and why — the fact a retry diagnoses
    // from, and the one a tail-only slice dropped.
    expect(retry).toContain(failedTestLine);
    expect(retry).toContain(assertionLine);
    // The tail: the closing counts still survive.
    expect(retry).toContain(countsLine);
    // The middle is what pays for both, and the elision is marked.
    expect(retry).not.toContain(middleMarker);
    expect(retry).toContain("truncated");

    // The digest is bounded, not merely reordered.
    const record = JSON.parse(
      await readFile(
        join(fx.repo, ".flume", "prior-attempts", "phase", "plan.json"),
        "utf8",
      ),
    ) as { mode: string; details: string };
    expect(record.mode).toBe("gate-revert");
    expect(record.details.length).toBeLessThan(details.length);
    expect(record.details.length).toBeLessThan(9 * 1024);
  });

  it("afterMerge gate-revert → each reverted fanout entry's next prompt carries the block; first attempt absent", async () => {
    const entries = [
      makeEntry("WAVE-A", ["src/wa.ts"]),
      makeEntry("WAVE-B", ["src/wb.ts"]),
    ];
    await writePending(fx.repo, entries);
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const failingMerge: Gate = {
      name: "merge-veto",
      when: "afterMerge",
      async run() {
        return {
          ok: false,
          message: "merge-msg",
          details: "merge-details-QQQ",
        };
      },
    };
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [failingMerge],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const promptsBySlug: Record<string, string[]> = {};
    const agent: Agent = {
      name: "recording-fanout",
      async invoke(inv) {
        const slug = basename(inv.cwd);
        (promptsBySlug[slug] ??= []).push(inv.prompt);
        const file = slug === "wave-a" ? "src/wa.ts" : "src/wb.ts";
        await writeAndCommit(inv.cwd, file, `${slug}\n`, `build(${slug})`);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    await dispatcher.tick(); // wave cherry-picked then reverted at afterMerge
    baton.wake("build"); // re-wake for the retry wave
    await dispatcher.tick(); // retry wave: each prompt carries the block

    for (const slug of ["wave-a", "wave-b"]) {
      const ps = promptsBySlug[slug] ?? [];
      expect(ps.length).toBe(2);
      // First attempt: silent (this path surfaced nothing before
      // prior-attempt feedback).
      expect(ps[0]).not.toContain("<prior-attempt>");
      expect(ps[0]).not.toContain("merge-details-QQQ");
      // Retry: afterMerge failure forwarded symmetrically.
      expect(ps[1]).toContain("<prior-attempt>");
      expect(ps[1]).toContain("Failing gate: merge-veto");
      expect(ps[1]).toContain("Reverted at: afterMerge");
      expect(ps[1]).toContain("merge-details-QQQ");
    }
  });

  it("clears the prior-attempt slot once a later attempt ships clean", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");

    let calls = 0;
    const flaky: Gate = {
      name: "flaky-gate",
      when: "afterCommit",
      async run() {
        calls++;
        return calls === 1
          ? { ok: false, message: "first fail", details: "DETAIL-ONCE" }
          : { ok: true, message: "ok now" };
      },
    };
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [flaky],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const prompts: string[] = [];
    const agent: Agent = {
      name: "recording-singleton",
      async invoke(inv) {
        const n = prompts.length;
        prompts.push(inv.prompt);
        await writeAndCommit(
          inv.cwd,
          "src/o.ts",
          `attempt-${n}\n`,
          "plan: attempt",
        );
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    await dispatcher.tick(); // attempt 1 → reverted, slot written
    baton.wake("plan");
    await dispatcher.tick(); // attempt 2 → ships clean, slot cleared
    baton.wake("plan");
    await dispatcher.tick(); // attempt 3 → slot gone, no block

    expect(prompts.length).toBe(3);
    expect(prompts[0]).not.toContain("<prior-attempt>");
    expect(prompts[1]).toContain("<prior-attempt>");
    expect(prompts[1]).toContain("DETAIL-ONCE");
    // Cleared on the clean ship → attempt 3 starts with no stale signal.
    expect(prompts[2]).not.toContain("<prior-attempt>");
    expect(
      existsSync(join(fx.repo, ".flume", "prior-attempts", "phase", "plan.json")),
    ).toBe(false);
  });

  // ---------- a gate's own attribution (spec/chain.md "What a gate
  // returns", spec/loop.md "Prior-outcome feedback") ----------
  //
  // `GateResult.blamesSpan: false` is the gate stating that a failure is not
  // the gated span's — the suite red at the base, a resource the span never
  // touched. The engine withholds the entry-scoped half of the stage failure
  // and stamps the declaration onto the gate-revert record; the revert and
  // the failed-tick count stand either way. Nothing is derived: the
  // disjointness rule `failingFiles` once fed is retired, because a span's
  // edits can red a file they never touched.

  async function readPlanPriorAttempt(): Promise<Record<string, unknown>> {
    return JSON.parse(
      await readFile(
        priorAttemptPath(join(fx.repo, ".flume"), phaseRef("plan")),
        "utf8",
      ),
    ) as Record<string, unknown>;
  }

  async function readEntryPriorAttempt(
    tag: string,
  ): Promise<Record<string, unknown>> {
    return JSON.parse(
      await readFile(
        priorAttemptPath(join(fx.repo, ".flume"), entryRef(tag)),
        "utf8",
      ),
    ) as Record<string, unknown>;
  }

  /** A gate refusing on something it says the span did not cause. */
  const disowningGate: Gate = {
    name: "suite",
    when: "afterCommit",
    async run() {
      return {
        ok: false,
        message: "suite red at the base",
        verdict: "base-red",
        failingFiles: ["tests/unrelated.test.ts"],
        blamesSpan: false,
      };
    },
  };

  /** The same refusal with no attribution declared — the ordinary revert. */
  const silentGate: Gate = {
    name: "suite",
    when: "afterCommit",
    async run() {
      return { ok: false, message: "suite red", verdict: "base-red" };
    },
  };

  function fanoutOver(tag: string, gate: Gate): Dispatcher {
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [gate],
    });
    const slug = tag.toLowerCase();
    return new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({
        [slug]: (cwd) =>
          writeAndCommit(cwd, `src/${slug}.ts`, "x\n", `build(${tag}): attempt`),
      }),
      log: silent,
    });
  }

  it("a gate-revert stage failure is unblamed when the gate declares blamesSpan false", async () => {
    await writePending(fx.repo, [makeEntry("DISOWNED", ["src/disowned.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const outcome = await fanoutOver("DISOWNED", disowningGate).tick();

    const gf = outcome.verdict?.gateFailures ?? [];
    // Non-vacuity: one gate failure, and it is this gate's refusal — the
    // withholding below is asserted over a populated set, never over none.
    expect(gf.length).toBe(1);
    expect(gf[0]?.message).toBe("suite red at the base");

    // Both halves withheld, never one (`StageFailureEntry`, src/tickVerdict.ts):
    // the supervisor's quarantine leg can read neither, so the failed tick
    // falls to the consecutive-failure backstop exactly as a singleton's own
    // revert already does.
    expect(gf[0]).not.toHaveProperty("tag");
    expect(gf[0]).not.toHaveProperty("quarantineKey");
  });

  it("a gate declaring blamesSpan false still reverts its span and still records the gate failure", async () => {
    await writePending(fx.repo, [makeEntry("STANDS", ["src/stands.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const outcome = await fanoutOver("STANDS", disowningGate).tick();

    // Non-vacuity: the declaration reached the engine. Without this the case
    // reads green over a tree that drops the field, where the revert below
    // is the ordinary blamed one wearing this title
    // (`.claude/rules/engineering.md`, *A green verdict is proven
    // non-vacuous*).
    const row = (outcome.verdict?.gateResults ?? []).find(
      (g) => g.gate === "suite",
    );
    expect(row?.ok).toBe(false);
    expect(row?.blamesSpan).toBe(false);

    // Reverted: a span that cannot be judged does not land. Nothing reached
    // trunk and the entry is still queued for the next wave.
    expect(existsSync(join(fx.repo, "src/stands.ts"))).toBe(false);
    expect(outcome.result?.shippedTags ?? []).toEqual([]);
    expect((readPendingFromDisk(fx.repo)).map((e) => e.tag)).toEqual([
      "STANDS",
    ]);

    // And the failure is recorded on both surfaces the next tick reads: the
    // verdict's own list, which the consecutive-failure backstop counts, and
    // the entry's prior-attempt record.
    expect((outcome.verdict?.gateFailures ?? []).length).toBe(1);
    const record = await readEntryPriorAttempt("STANDS");
    expect(record.mode).toBe("gate-revert");
    expect(record.gate).toBe("suite");
    expect(record.message).toBe("suite red at the base");
  });

  it("a gate-revert record carries the gate's declared attribution rather than a derived flake marker", async () => {
    // Singleton, the shortest path to `buildGateRevert`. The gate names a
    // file the span never touched — exactly the disjointness the retired
    // marker was computed from — and states the attribution itself.
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [disowningGate],
    });
    await new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async (cwd) => {
        await writeAndCommit(cwd, "src/o.ts", "x\n", "plan: attempt");
      }),
      log: silent,
    }).tick();

    const record = await readPlanPriorAttempt();
    // Non-vacuity: the real revert leg wrote the mode under judgement.
    expect(record.mode).toBe("gate-revert");
    expect(record.gate).toBe("suite");

    // The gate's own two statements, copied verbatim: what it blamed, and
    // that it did not blame the span. Nothing on the record is derived from
    // either — the disjointness these paths once fed is gone, and the
    // attribution beside them is the gate's word.
    expect(record.failingFiles).toEqual(["tests/unrelated.test.ts"]);
    expect(record.blamesSpan).toBe(false);
  });

  it("a gate that declares no attribution leaves its fanout revert blamed", async () => {
    await writePending(fx.repo, [makeEntry("BLAMED", ["src/blamed.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const outcome = await fanoutOver("BLAMED", silentGate).tick();

    const gf = outcome.verdict?.gateFailures ?? [];
    expect(gf.length).toBe(1);
    expect(gf[0]?.tag).toBe("BLAMED");
    expect(gf[0]?.quarantineKey).toMatch(/^blamed@[0-9a-f]{10}$/);

    // Absence is the default arm, spelled here rather than inherited: the
    // record states nothing about attribution, and neither does its row.
    const record = await readEntryPriorAttempt("BLAMED");
    expect(record.mode).toBe("gate-revert");
    expect(record).not.toHaveProperty("blamesSpan");
    expect(record).not.toHaveProperty("failingFiles");
    const row = (outcome.verdict?.gateResults ?? []).find(
      (g) => g.gate === "suite",
    );
    expect(row?.ok).toBe(false);
    expect(row).not.toHaveProperty("blamesSpan");
  });

  // The builtin that names its violating paths, driven through the real
  // revert rather than a hand-built gate result: it attributes files, and
  // attributing files is not disowning the span — a writable-paths refusal
  // is the span's by construction, and the record says so by declaring
  // nothing.
  it("a writable-paths gate-revert record carries the paths it blamed and no disavowal", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      writablePaths: ["src/**"],
    });

    const outcome = await new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async (cwd) => {
        await writeAndCommit(cwd, "outside/d.ts", "d\n", "plan: overreach");
      }),
      log: silent,
    }).tick();

    // Non-vacuity: the writable-paths gate is what refused, and it named the
    // path it refused on — otherwise the assertions below would pass over a
    // record no gate wrote anything to.
    const row = outcome.verdict?.gateResults.find(
      (g) => g.gate === "writable-paths",
    );
    expect(row?.ok).toBe(false);
    expect(row?.failingFiles).toEqual(["outside/d.ts"]);

    const record = await readPlanPriorAttempt();
    expect(record.mode).toBe("gate-revert");
    expect(record.gate).toBe("writable-paths");
    expect(record.failingFiles).toEqual(["outside/d.ts"]);
    expect(record).not.toHaveProperty("blamesSpan");
  });
});

// ---------- no-commit outcome taxonomy ----------

// One test per causally-distinct no-commit mode. Each asserts (a) the
// distinct classification on `TickOutcome.noCommit` for the producing tick,
// and (b) that the next tick's rendered prompt carries the matching
// prior-attempt variant and *only* that variant (the three are mutually
// distinguishable, not one block with a label). Singleton path: a tick is one
// agent invocation, so "exactly one mode per no-commit tick" is exact and
// directly observable on the outcome. First attempt carries no
// <prior-attempt> — no false signal.

const GATE_REVERT_INTRO = "committed and was REVERTED by a gate";
const CLEAN_EXIT_INTRO = "exited cleanly and committed";
const PREEMPT_INTRO = "cut short by a PLATFORM failure";
const RENDER_REFUSED_INTRO = "refused BEFORE the agent was invoked";
const TIP_MOVED_INTRO = "was DISCARDED because the base its";

describe("Dispatcher — no-commit outcome taxonomy", () => {
  it("gate-revert: TickOutcome.noCommit==='gate-revert'; retry prompt carries only the gate-revert variant; first attempt empty", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");

    const failing: Gate = {
      name: "revert-gate",
      when: "afterCommit",
      async run() {
        return {
          ok: false,
          message: "gate said no",
          details: "GATE-DETAIL-ZZZ",
        };
      },
    };
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [failing],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const prompts: string[] = [];
    const agent: Agent = {
      name: "recording-singleton",
      async invoke(inv) {
        prompts.push(inv.prompt);
        await writeAndCommit(inv.cwd, "src/o.ts", "x\n", "plan: attempt");
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const first = await dispatcher.tick();
    expect(first.result?.committed).toBe(false);
    expect(first.noCommit).toBe("gate-revert");

    baton.wake("plan");
    await dispatcher.tick();

    expect(prompts.length).toBe(2);
    expect(prompts[0]).not.toContain("<prior-attempt>");
    // Distinct gate-revert variant, with the gate's full detail + when.
    expect(prompts[1]).toContain("<prior-attempt>");
    expect(prompts[1]).toContain(GATE_REVERT_INTRO);
    expect(prompts[1]).toContain("Failing gate: revert-gate");
    expect(prompts[1]).toContain("Reverted at: afterCommit");
    expect(prompts[1]).toContain("GATE-DETAIL-ZZZ");
    // …and ONLY that variant — not the other two modes' phrasing.
    expect(prompts[1]).not.toContain(CLEAN_EXIT_INTRO);
    expect(prompts[1]).not.toContain(PREEMPT_INTRO);
  });

  it("a clean exit with no commit is classified clean-exit; the retry prompt quotes its final message verbatim; first attempt empty", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");

    // No gates. The agent exits cleanly (exit 0) WITHOUT committing, and
    // says why in its final message. The engine records that it exited and
    // quotes the message; what the exit meant stays the chain's reading.
    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const CONSTRAINT =
      "BAILED: entry.files names spec/loop.md, outside the build " +
      "phase writablePaths; not pivoting. Route as an open question.";

    const prompts: string[] = [];
    const agent: Agent = {
      name: "bailing-singleton",
      async invoke(inv) {
        prompts.push(inv.prompt);
        // Clean exit, no commit, the reason stated in the final message.
        // `finalMessage` stands in for what claudeCode's own extraction
        // would produce for this plain-text transcript (Agent.ts,
        // extractFinalMessage) — the Dispatcher no longer re-derives it.
        const stdout = `working…\n\n${CONSTRAINT}\n`;
        return {
          exitCode: 0,
          stdout,
          stderr: "",
          finalMessage: extractFinalMessage(stdout),
        };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const first = await dispatcher.tick();
    expect(first.result?.committed).toBe(false);
    expect(first.noCommit).toBe("clean-exit");
    // The verdict carries the same no-commit fact — no shipped
    // tags, no gates ran (the agent never committed), nothing to
    // cherry-pick/merge.
    expect(first.verdict?.committed).toBe(false);
    expect(first.verdict?.noCommit).toBe("clean-exit");
    expect(first.verdict?.shippedTags).toEqual([]);
    expect(first.verdict?.gateResults).toEqual([]);
    expect(first.verdict?.mergeOutcomes).toEqual([]);

    baton.wake("plan");
    await dispatcher.tick();

    expect(prompts.length).toBe(2);
    expect(prompts[0]).not.toContain("<prior-attempt>");
    // Distinct clean-exit variant, quoting the message under a neutral
    // label rather than calling it a refused constraint.
    expect(prompts[1]).toContain("<prior-attempt>");
    expect(prompts[1]).toContain(CLEAN_EXIT_INTRO);
    expect(prompts[1]).toContain("Prior attempt's final message");
    expect(prompts[1]).toContain(
      "spec/loop.md, outside the build phase writablePaths",
    );
    // …and ONLY that variant.
    expect(prompts[1]).not.toContain(GATE_REVERT_INTRO);
    expect(prompts[1]).not.toContain(PREEMPT_INTRO);
  });

  it("clean-exit under a stream-json agent: the prior-attempt block quotes the final message legibly, free of NDJSON/cost noise; plain-text path is the test above", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");

    // The dogfood chain runs the agent under
    // withTerminalRenderer(withSessionCapture(claudeCode({stream-json}))):
    // the decorators pass stdout through raw, so AgentResult.stdout is the
    // stream-json NDJSON transcript. Tailing it raw would forward
    // escaped-JSON assistant/result events + cost/usage metadata — the noise
    // this entry replaces with the agent's own final message.
    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const CONSTRAINT =
      "BAILED: entry.files names spec/loop.md and " +
      ".claude/rules/spec-plan-build.md, both outside the build phase " +
      "writablePaths. Not pivoting to a different path. Route as an open " +
      "question for a human.";

    // A realistic `claude -p --output-format stream-json --verbose`
    // transcript: system/init, an interim assistant turn, a tool_use +
    // tool_result pair, the final assistant text, and the terminal result
    // event carrying cost/usage. JSON.stringify so the test exercises the
    // genuine escaped-JSON shape, not a hand-written approximation.
    const ndjson =
      [
        {
          type: "system",
          subtype: "init",
          session_id: "s1",
          model: "claude",
          tools: ["Read", "Edit"],
        },
        {
          type: "assistant",
          message: {
            id: "m1",
            role: "assistant",
            content: [
              {
                type: "text",
                text: "Inspecting the assigned entry's writable paths.",
              },
            ],
          },
        },
        {
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "t1",
                name: "Read",
                input: { file_path: ".flume/chain.ts" },
              },
            ],
          },
        },
        {
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "t1",
                content: "writablePaths: src/**, tests/**",
              },
            ],
          },
        },
        {
          type: "assistant",
          message: { content: [{ type: "text", text: CONSTRAINT }] },
        },
        {
          type: "result",
          subtype: "success",
          is_error: false,
          duration_ms: 81234,
          duration_api_ms: 79000,
          num_turns: 6,
          result: CONSTRAINT,
          session_id: "s1",
          total_cost_usd: 0.4213,
          usage: {
            input_tokens: 12000,
            output_tokens: 800,
            cache_read_input_tokens: 250000,
            cache_creation_input_tokens: 1800,
          },
        },
      ]
        .map((o) => JSON.stringify(o))
        .join("\n") + "\n";

    const prompts: string[] = [];
    const agent: Agent = {
      name: "bailing-stream-json-singleton",
      async invoke(inv) {
        prompts.push(inv.prompt);
        // Clean exit, no commit; the closing prose is the final message,
        // delivered only inside the stream-json transcript. `finalMessage`
        // stands in for claudeCode's own extraction (Agent.ts,
        // extractFinalMessage) — the Dispatcher no longer re-parses stdout.
        return {
          exitCode: 0,
          stdout: ndjson,
          stderr: "",
          finalMessage: extractFinalMessage(ndjson),
        };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const first = await dispatcher.tick();
    expect(first.result?.committed).toBe(false);
    expect(first.noCommit).toBe("clean-exit");

    baton.wake("plan");
    await dispatcher.tick();

    expect(prompts.length).toBe(2);
    expect(prompts[0]).not.toContain("<prior-attempt>");

    const retry = prompts[1]!;
    // The final message is forwarded as clean prose, in the clean-exit
    // variant only.
    expect(retry).toContain("<prior-attempt>");
    expect(retry).toContain(CLEAN_EXIT_INTRO);
    expect(retry).toContain("Prior attempt's final message");
    expect(retry).toContain(
      "spec/loop.md and .claude/rules/spec-plan-build.md",
    );
    expect(retry).not.toContain(GATE_REVERT_INTRO);
    expect(retry).not.toContain(PREEMPT_INTRO);

    // …and the raw NDJSON / cost-usage noise the pre-fix tail forwarded is
    // gone: no event envelopes, no escaped JSON, no cost/usage metadata.
    expect(retry).not.toContain('"type":"result"');
    expect(retry).not.toContain('"type":"assistant"');
    expect(retry).not.toContain('"type":"system"');
    expect(retry).not.toContain("tool_use");
    expect(retry).not.toContain("total_cost_usd");
    expect(retry).not.toContain("cache_read_input_tokens");
    expect(retry).not.toContain("duration_ms");
    expect(retry).not.toContain('\\"text\\"');
  });

  it("clean-exit under a stream-json agent with no result/assistant event: falls back to the bounded raw transcript, never an empty final message", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");

    // A stdout that parses as stream-json (every line has a `type` field, so
    // sawStreamJson flips true) but never emits a `result` or `assistant`
    // event — e.g. the process was cut off after the `system`/`init` line.
    // DISPATCHER-FINALAGENTMESSAGE-STREAMJSON-SILENT-EMPTY: pre-fix,
    // finalAgentMessage (now Agent.ts's extractFinalMessage) tailBound'd the
    // empty string here, and the retry prompt lost the message entirely.
    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const ndjson =
      [
        {
          type: "system",
          subtype: "init",
          session_id: "s1",
          model: "claude",
          tools: ["Read", "Edit"],
        },
      ]
        .map((o) => JSON.stringify(o))
        .join("\n") + "\n";

    const prompts: string[] = [];
    const agent: Agent = {
      name: "bailing-stream-json-no-text-singleton",
      async invoke(inv) {
        prompts.push(inv.prompt);
        return {
          exitCode: 0,
          stdout: ndjson,
          stderr: "",
          finalMessage: extractFinalMessage(ndjson),
        };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const first = await dispatcher.tick();
    expect(first.result?.committed).toBe(false);
    expect(first.noCommit).toBe("clean-exit");

    baton.wake("plan");
    await dispatcher.tick();

    expect(prompts.length).toBe(2);
    const retry = prompts[1]!;
    expect(retry).toContain("<prior-attempt>");
    expect(retry).toContain(CLEAN_EXIT_INTRO);
    expect(retry).toContain("Prior attempt's final message");
    // The raw transcript tail reached the retry prompt…
    expect(retry).toContain('"type":"system"');
    expect(retry).toContain("s1");
    // …instead of the silent-empty placeholder the pre-fix tree produced.
    expect(retry).not.toContain(
      "agent exited cleanly without committing and produced no final message",
    );
  });

  it("platform-preempt: TickOutcome.noCommit==='platform-preempt'; retry prompt marks it not-a-defect with the failure class; first attempt empty", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");

    // No gates. The agent process fails for non-work reasons — a non-zero
    // exit (137 = SIGKILL / OOM / dispatcher-killed) with no commit.
    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const prompts: string[] = [];
    const agent: Agent = {
      name: "preempted-singleton",
      async invoke(inv) {
        prompts.push(inv.prompt);
        return { exitCode: 137, stdout: "", stderr: "Killed" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const first = await dispatcher.tick();
    expect(first.result?.committed).toBe(false);
    expect(first.noCommit).toBe("platform-preempt");

    baton.wake("plan");
    await dispatcher.tick();

    expect(prompts.length).toBe(2);
    expect(prompts[0]).not.toContain("<prior-attempt>");
    // Distinct platform-preempt variant: explicitly NOT a defect, with the
    // non-work failure class forwarded.
    expect(prompts[1]).toContain("<prior-attempt>");
    expect(prompts[1]).toContain(PREEMPT_INTRO);
    expect(prompts[1]).toContain("NOT a");
    expect(prompts[1]).toContain("Failure class");
    expect(prompts[1]).toContain("exited with code 137");
    // …and ONLY that variant.
    expect(prompts[1]).not.toContain(GATE_REVERT_INTRO);
    expect(prompts[1]).not.toContain(CLEAN_EXIT_INTRO);
  });

  it("render-refused: an unresolved inline-exec span aborts the render — the agent is never invoked, and the mode is distinguishable from clean-exit", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");

    const promptPath = join(fx.configDir, "prompt.md");
    await writeFile(
      promptPath,
      "digest: !`echo boom-detail 1>&2; exit 3`\n",
      "utf8",
    );

    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const prompts: string[] = [];
    const agent: Agent = {
      name: "must-not-run-while-render-fails",
      async invoke(inv) {
        prompts.push(inv.prompt);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const first = await dispatcher.tick();

    // No agent invocation at all — the render never got far enough to hand
    // the agent a prompt.
    expect(prompts.length).toBe(0);
    expect(first.result?.committed).toBe(false);
    expect(first.noCommit).toBe("render-refused");
    expect(first.noCommit).not.toBe("clean-exit");
    expect(first.verdict?.committed).toBe(false);
    expect(first.verdict?.noCommit).toBe("render-refused");
    expect(first.verdict?.gateResults).toEqual([]);
    expect(first.verdict?.shippedTags).toEqual([]);
    expect(first.verdict?.mergeOutcomes).toEqual([]);

    // Fix the span so the second tick's render succeeds — only then can the
    // agent actually be invoked, and its prompt inspected for the retry's
    // <prior-attempt> block.
    await writeFile(promptPath, "digest: fixed\n", "utf8");
    baton.wake("plan");
    await dispatcher.tick();

    expect(prompts.length).toBe(1);
    expect(prompts[0]).toContain("<prior-attempt>");
    expect(prompts[0]).toContain(RENDER_REFUSED_INTRO);
    expect(prompts[0]).toContain("echo boom-detail 1>&2; exit 3");
    expect(prompts[0]).toContain("boom-detail");
    // …and ONLY that variant.
    expect(prompts[0]).not.toContain(GATE_REVERT_INTRO);
    expect(prompts[0]).not.toContain(CLEAN_EXIT_INTRO);
    expect(prompts[0]).not.toContain(PREEMPT_INTRO);
  });
});

// ---------- fanout wave-level noCommit precedence (mixed causes) ----------

// `Dispatcher.waveNoCommitCause`: when a fanout wave ships nothing, the single
// wave-level `noCommit` label is picked from the set of per-entry causes by
// precedence gate-revert > render-refused > platform-preempt > clean-exit.
// Every other test above drives one mode per wave in isolation, so a swapped or
// dropped precedence branch is invisible to the suite
// (.claude/rules/engineering.md "A green verdict is proven non-vacuous"). These
// tests build waves whose entries fail via ≥2 distinct causes at once and pin
// the label at each boundary of the chain.
//
// `CMD` drives the shared prompt's inline-exec span per entry (rendered
// before the agent is invoked): every tag except RENDER-FOUR resolves to a
// no-op; RENDER-FOUR resolves to a command that fails, aborting only that
// entry's render.
function mixedCausePromptArgs(ctx: TickContext): Record<string, string> {
  return {
    CMD: ctx.assignedEntry?.tag === "RENDER-FOUR" ? "echo boom-detail 1>&2; exit 3" : "exit 0",
  };
}

// A fanout agent whose behavior is keyed by slug, producing gate-revert
// (commits, then the always-failing gate reverts it), platform-preempt
// (non-zero exit), and clean-exit (clean exit, no commit). RENDER-FOUR
// never reaches the agent — its render aborts first — so no case is
// registered for it; an accidental invocation throws.
const mixedCauseAgent: Agent = {
  name: "mixed-cause-fanout",
  async invoke(inv) {
    const slug = basename(inv.cwd);
    switch (slug) {
      case "gate-one":
        await writeAndCommit(inv.cwd, "src/a.ts", "x\n", "build(GATE-ONE): attempt");
        return { exitCode: 0, stdout: "", stderr: "" };
      case "preempt-two":
        return { exitCode: 137, stdout: "", stderr: "Killed" };
      case "bail-three":
        return { exitCode: 0, stdout: "bailing, nothing to commit\n", stderr: "" };
      default:
        throw new Error(`mixedCauseAgent: unexpected invocation for slug '${slug}'`);
    }
  },
};

const alwaysRevert: Gate = {
  name: "always-revert",
  when: "afterCommit",
  async run() {
    return { ok: false, message: "gate said no", details: "MIXED-CAUSE-REVERT" };
  },
};

describe("Dispatcher fanout — wave-level noCommit precedence across mixed per-entry causes (DISPATCHER-WAVE-NOCOMMIT-PRECEDENCE-TEST)", () => {
  it("gate-revert + render-refused + platform-preempt + clean-exit in one wave → wave-level noCommit is gate-revert (top precedence)", async () => {
    await writePending(fx.repo, [
      makeEntry("GATE-ONE", ["src/a.ts"]),
      makeEntry("RENDER-FOUR", ["src/d.ts"]),
      makeEntry("PREEMPT-TWO", ["src/b.ts"]),
      makeEntry("BAIL-THREE", ["src/c.ts"]),
    ]);
    new Baton(join(fx.repo, ".flume")).wake("build");
    await writeFile(join(fx.configDir, "prompt.md"), "digest: !`{{CMD}}`\n", "utf8");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      gates: [alwaysRevert],
      promptArgs: mixedCausePromptArgs,
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const warnings: string[] = [];
    const log: Logger = { info: () => {}, warn: (l) => warnings.push(l), error: () => {} };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: mixedCauseAgent,
      log,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    // Non-vacuity: all four distinct causes actually fired this wave, not
    // just the winning one — otherwise "gate-revert wins" would be true
    // vacuously of a wave that only ever produced gate-revert.
    expect(warnings.some((w) => w.includes("GATE-ONE") && w.includes("commit reverted"))).toBe(true);
    expect(warnings.some((w) => w.includes("RENDER-FOUR") && w.includes("render-refused"))).toBe(true);
    expect(warnings.some((w) => w.includes("PREEMPT-TWO") && w.includes("platform-preempt"))).toBe(true);
    expect(warnings.some((w) => w.includes("BAIL-THREE") && w.includes("clean-exit"))).toBe(true);

    expect(outcome.result?.committed).toBe(false);
    expect(outcome.result?.shippedTags).toEqual([]);
    expect(outcome.noCommit).toBe("gate-revert");
    expect(outcome.verdict?.noCommit).toBe("gate-revert");
    expect(readPendingFromDisk(fx.repo)).toHaveLength(4);
  });

  it("render-refused + platform-preempt + clean-exit, no gate-revert → wave-level noCommit is render-refused", async () => {
    await writePending(fx.repo, [
      makeEntry("RENDER-FOUR", ["src/d.ts"]),
      makeEntry("PREEMPT-TWO", ["src/b.ts"]),
      makeEntry("BAIL-THREE", ["src/c.ts"]),
    ]);
    new Baton(join(fx.repo, ".flume")).wake("build");
    await writeFile(join(fx.configDir, "prompt.md"), "digest: !`{{CMD}}`\n", "utf8");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      promptArgs: mixedCausePromptArgs,
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const warnings: string[] = [];
    const log: Logger = { info: () => {}, warn: (l) => warnings.push(l), error: () => {} };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: mixedCauseAgent,
      log,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    expect(warnings.some((w) => w.includes("RENDER-FOUR") && w.includes("render-refused"))).toBe(true);
    expect(warnings.some((w) => w.includes("PREEMPT-TWO") && w.includes("platform-preempt"))).toBe(true);
    expect(warnings.some((w) => w.includes("BAIL-THREE") && w.includes("clean-exit"))).toBe(true);

    expect(outcome.result?.committed).toBe(false);
    expect(outcome.noCommit).toBe("render-refused");
    expect(outcome.verdict?.noCommit).toBe("render-refused");
    expect(readPendingFromDisk(fx.repo)).toHaveLength(3);
  });

  it("platform-preempt + clean-exit, no gate-revert/render-refused → wave-level noCommit is platform-preempt", async () => {
    await writePending(fx.repo, [
      makeEntry("PREEMPT-TWO", ["src/b.ts"]),
      makeEntry("BAIL-THREE", ["src/c.ts"]),
    ]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const warnings: string[] = [];
    const log: Logger = { info: () => {}, warn: (l) => warnings.push(l), error: () => {} };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: mixedCauseAgent,
      log,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    expect(warnings.some((w) => w.includes("PREEMPT-TWO") && w.includes("platform-preempt"))).toBe(true);
    expect(warnings.some((w) => w.includes("BAIL-THREE") && w.includes("clean-exit"))).toBe(true);

    expect(outcome.result?.committed).toBe(false);
    expect(outcome.noCommit).toBe("platform-preempt");
    expect(outcome.verdict?.noCommit).toBe("platform-preempt");
    expect(readPendingFromDisk(fx.repo)).toHaveLength(2);
  });
});

describe("Dispatcher — tip verify: commit only onto the tick's starting tip", () => {
  it("singleton: an agent invocation that makes two commits ships the whole span as one completion — ancestry holds, no full-span soft-reset (LOOP-TIPVERIFY-PERENTRY-ANCESTRY)", async () => {
    // spec/worktrees.md "Singleton runs in a worktree": the agent now commits
    // on this tick's own private worktree branch, exactly like a fanout
    // entry — the ancestry check (ex `checkTipMovedPerEntry`) replaces the
    // retired parent-equality leg, so an agent that commits, keeps working,
    // and commits again has produced a completed multi-commit tick, not
    // interference. Both commits cherry-pick onto trunk as one span.
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(
        cwd,
        "src/step-one.ts",
        "one\n",
        "plan: step one",
      );
      await writeAndCommit(cwd, "src/step-two.ts", "two\n", "plan: step two");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    expect(outcome.tipMoved).toBeUndefined();
    expect(outcome.noCommit).toBeUndefined();
    expect(outcome.verdict?.tipMoved).toBeUndefined();

    // Both commits landed on trunk, cherry-picked in order beneath the
    // cherry-picked tip `outcome.result.commitSha` names.
    expect(existsSync(join(fx.repo, "src", "step-one.ts"))).toBe(true);
    expect(existsSync(join(fx.repo, "src", "step-two.ts"))).toBe(true);
    const { stdout: log } = await exec(
      "git",
      ["log", "--format=%s", "-n", "2"],
      { cwd: fx.repo },
    );
    expect(log.trim().split("\n")).toEqual(["plan: step two", "plan: step one"]);
  });

  it("singleton: a worktree branch rewritten out from under the agent (base is no longer an ancestor of HEAD) refuses, names both shas, and never touches trunk", async () => {
    // Mirrors the fanout per-entry ancestry-violation shape: the worktree
    // branch is rewritten onto an orphan history and built on — the
    // recorded base is no longer an ancestor of the observed HEAD. Unlike
    // the retired singleton-on-trunk leg, trunk itself is never touched:
    // the whole check and its soft-reset happen inside the private worktree
    // branch, which teardown then discards regardless.
    const preHead = await head(fx.repo);
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    let recordedBase = "";
    let observedHead = "";
    const agent = singleAgent(async (cwd) => {
      recordedBase = await head(cwd);
      await exec("git", ["checkout", "--orphan", "rewritten"], { cwd });
      await exec("git", ["reset", "--hard"], { cwd });
      await writeAndCommit(cwd, "src/plan-output.ts", "agent-work\n", "plan: derive");
      observedHead = await head(cwd);
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(false);
    expect(outcome.result?.commitSha).toBeUndefined();
    expect(outcome.tipMoved).toBe(true);
    expect(outcome.noCommit).toBeUndefined();
    expect(outcome.summary).toContain("tip-moved");

    // Trunk never moved — the whole check ran on the private worktree
    // branch, which the tick tears down regardless of outcome.
    expect(await head(fx.repo)).toBe(preHead);
    expect(recordedBase).toBe(preHead);

    // Both shas named — the recorded base and the observed HEAD, never the
    // HEAD's parent alone (which would read the agent's own top commit as
    // the intruder, or not exist at all on an orphan branch).
    const record = await readFile(
      join(fx.repo, ".flume", "prior-attempts", "phase", "plan.json"),
      "utf8",
    );
    const parsed = JSON.parse(record);
    expect(parsed.mode).toBe("tip-moved");
    expect(parsed.expectedTip).toBe(recordedBase);
    expect(parsed.observedTip).toBe(observedHead);
  });

  it("singleton: an unmoved tip commits exactly as before — no tip-moved fact", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");
    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/plan-output.ts", "ok\n", "plan: derive");
    });
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    expect(outcome.tipMoved).toBeUndefined();
    expect(outcome.verdict?.tipMoved).toBeUndefined();
  });

  it("singleton: the retry's prompt carries the tip-moved prior-attempt block, and only that variant — the retry against the new tip then commits clean", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");
    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const prompts: string[] = [];
    let firstAttempt = true;
    const agent: Agent = {
      name: "recording-singleton",
      async invoke(inv) {
        prompts.push(inv.prompt);
        if (firstAttempt) {
          firstAttempt = false;
          // Rewrite the worktree branch out from under itself — an ancestry
          // violation, the only way this leg now refuses (spec/worktrees.md
          // "Singleton runs in a worktree").
          await exec("git", ["checkout", "--orphan", "rewritten"], {
            cwd: inv.cwd,
          });
          await exec("git", ["reset", "--hard"], { cwd: inv.cwd });
        }
        await writeAndCommit(inv.cwd, "src/plan-output.ts", "x\n", "plan: attempt");
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const first = await dispatcher.tick();
    expect(first.tipMoved).toBe(true);

    baton.wake("plan");
    const second = await dispatcher.tick();
    expect(second.result?.committed).toBe(true);
    expect(second.tipMoved).toBeUndefined();

    expect(prompts.length).toBe(2);
    expect(prompts[0]).not.toContain("<prior-attempt>");
    expect(prompts[1]).toContain("<prior-attempt>");
    expect(prompts[1]).toContain(TIP_MOVED_INTRO);
    // …and ONLY that variant.
    expect(prompts[1]).not.toContain(GATE_REVERT_INTRO);
    expect(prompts[1]).not.toContain(CLEAN_EXIT_INTRO);
    expect(prompts[1]).not.toContain(PREEMPT_INTRO);
  });

  it("fanout: an entry's worktree commit stacks two commits, both descending from the recorded base — ancestry holds, whole span ships (LOOP-TIPVERIFY-PERENTRY-ANCESTRY)", async () => {
    // Pre-fix bug (field report, inbox 2026-08-05): the per-entry leg used
    // to apply the singleton's parent-equality check to this private
    // worktree branch, which misread an agent that commits, keeps working,
    // and commits again as an interloper's own commit — soft-resetting a
    // completed entry and letting teardown destroy all trace. Ancestry
    // (spec/loop.md "Tip verify", per-entry leg) reads this correctly: the
    // recorded base is still an ancestor of the observed HEAD, so the whole
    // two-commit span is a completed entry, not interference.
    await writePending(fx.repo, [makeEntry("TEST-A", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");
    const phase = makePhase({ name: "build", concurrency: "fanout", gates: [] });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "test-a": async (cwd) => {
        await writeAndCommit(
          cwd,
          "src/interloper.ts",
          "external\n",
          "external: concurrent commit",
        );
        await writeAndCommit(cwd, "src/a.ts", "from-A\n", "build(TEST-A): ship");
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    expect(outcome.result?.shippedTags).toEqual(["TEST-A"]);
    expect(outcome.tipMoved).toBeUndefined();
    expect(outcome.verdict?.tipMoved).toBeUndefined();
    expect(outcome.verdict?.noCommit).toBeUndefined();
    expect(outcome.verdict?.mergeOutcomes).toEqual([
      {
        entryTag: "TEST-A",
        outcome: "merged",
        baseSha: expect.stringMatching(/^[0-9a-f]{40}$/),
        headSha: expect.stringMatching(/^[0-9a-f]{40}$/),
      },
    ]);

    // Entry shipped — gone from pending.json, both commits landed on trunk,
    // both files present (gates ran over the whole span's footprint, and
    // cherry-pick carried both commits, in order).
    expect(readPendingFromDisk(fx.repo)).toEqual([]);
    expect(existsSync(join(fx.repo, "src", "interloper.ts"))).toBe(true);
    expect(existsSync(join(fx.repo, "src", "a.ts"))).toBe(true);
    expect(await readFile(join(fx.repo, "src", "a.ts"), "utf8")).toBe(
      "from-A\n",
    );
    // The newest commit is the wave's own pending-ledger update; the two
    // commits beneath it are the entry's whole span, cherry-picked in order.
    const { stdout: log } = await exec(
      "git",
      ["log", "--format=%s", "-n", "3"],
      { cwd: fx.repo },
    );
    expect(log.trim().split("\n").slice(1)).toEqual([
      "build(TEST-A): ship",
      "external: concurrent commit",
    ]);
  });

  it("fanout: an entry's worktree commit is rewritten out from under the agent (base is no longer an ancestor of HEAD) — refuses, naming both shas, and a fanout wave whose entry fails the per-entry tip verify records exactly one mergeOutcomes entry for that tag (LOOP-TIPVERIFY-PERENTRY-ANCESTRY)", async () => {
    await writePending(fx.repo, [makeEntry("TEST-A", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");
    const phase = makePhase({ name: "build", concurrency: "fanout", gates: [] });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    let recordedBase = "";
    let observedHead = "";
    const agent = fanoutAgent({
      "test-a": async (cwd) => {
        recordedBase = await head(cwd);
        // The worktree branch is hard-reset to an unrelated commit and then
        // built on — the recorded base is no longer an ancestor of the
        // observed HEAD, unlike the "stacks two commits" case above where
        // the base stays reachable throughout.
        await exec("git", ["checkout", "--orphan", "rewritten"], { cwd });
        await exec("git", ["reset", "--hard"], { cwd });
        await writeAndCommit(cwd, "src/a.ts", "from-A\n", "build(TEST-A): ship");
        observedHead = await head(cwd);
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(false);
    expect(outcome.result?.shippedTags).toEqual([]);
    expect(outcome.tipMoved).toBe(true);
    expect(outcome.verdict?.tipMoved).toBe(true);
    expect(outcome.verdict?.noCommit).toBeUndefined();
    // The dropped-work fact, distinguishable from a parked/no-op entry —
    // never silence a partial ship summary papers over. headSha is the
    // observed HEAD the ancestry check rejected — the dangling commit a
    // human could still recover before gc.
    expect(outcome.verdict?.mergeOutcomes).toEqual([
      {
        entryTag: "TEST-A",
        outcome: "dropped-work",
        baseSha: recordedBase,
        headSha: observedHead,
      },
    ]);

    // One record for this tag, and the per-entry surface reads it. The
    // `dropped-work` push does not `continue`, so it falls through into the
    // `afterCommit-reverted` push guarded on `footprint` — single-valued
    // only because the tip-moved return carries none. `mergeOutcome`
    // resolves by `find`, so a second record would have it report the first
    // of two while the verdict carried both.
    const forTag = (outcome.verdict?.mergeOutcomes ?? []).filter(
      (m) => m.entryTag === "TEST-A",
    );
    expect(forTag.length).toBe(1);
    const entry = outcome.result?.entries?.find((e) => e.tag === "TEST-A");
    expect(entry).toBeDefined();
    expect(entry?.mergeOutcome).toBe("dropped-work");

    // Both shas named — the recorded base and the observed HEAD, never the
    // HEAD's parent alone (which would read the agent's own top commit as
    // the intruder).
    const record = await readFile(
      join(fx.repo, ".flume", "prior-attempts", "entry", "test-a.json"),
      "utf8",
    );
    const parsed = JSON.parse(record);
    expect(parsed.mode).toBe("tip-moved");
    expect(parsed.expectedTip).toBe(recordedBase);
    expect(parsed.observedTip).toBe(observedHead);

    // Entry stays pending, byte-identical — nothing shipped or cherry-picked.
    expect(readPendingFromDisk(fx.repo)).toEqual([
      makeEntry("TEST-A", ["src/a.ts"]),
    ]);
  });

  it("fanout: a foreign non-engine commit lands on trunk mid-wave — the cherry-pick absorbs it instead of refusing tipMoved", async () => {
    // spec/loop.md "Tip verify", "Harness-driven commits carry no
    // expected-tip bookkeeping": no live claim on the ref means whatever
    // moved trunk was not an engine, so the wave cherry-picks onto whatever
    // tip is current instead of refusing on sha mismatch.
    await writePending(fx.repo, [makeEntry("TEST-A", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");
    const phase = makePhase({ name: "build", concurrency: "fanout", gates: [] });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "test-a": async (cwd) => {
        // A concurrent actor commits directly to trunk while this entry's
        // agent is still running in its own worktree — the wave only
        // discovers it once cherry-picking starts, after every agent this
        // wave has already finished.
        await writeAndCommit(
          fx.repo,
          "src/interloper.ts",
          "external\n",
          "external: concurrent commit",
        );
        await writeAndCommit(cwd, "src/a.ts", "from-A\n", "build(TEST-A): ship");
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    expect(outcome.result?.shippedTags).toEqual(["TEST-A"]);
    expect(outcome.tipMoved).toBeUndefined();
    expect(outcome.verdict?.tipMoved).toBeUndefined();
    expect(outcome.verdict?.mergeOutcomes).toEqual([
      {
        entryTag: "TEST-A",
        outcome: "merged",
        baseSha: expect.stringMatching(/^[0-9a-f]{40}$/),
        headSha: expect.stringMatching(/^[0-9a-f]{40}$/),
      },
    ]);

    // Both the interloper's commit and the entry's cherry-picked commit
    // land — the foreign commit sits under the entry's, exactly as if it
    // had landed between ticks.
    expect(readPendingFromDisk(fx.repo)).toEqual([]);
    expect(await readFile(join(fx.repo, "src/interloper.ts"), "utf8")).toBe(
      "external\n",
    );
    expect(await readFile(join(fx.repo, "src/a.ts"), "utf8")).toBe(
      "from-A\n",
    );
  });

  it("fanout: a foreign non-engine commit lands before the wave's own pending-ledger commit — commitPendingUpdate recommits the footprint on whatever tip is current", async () => {
    await writePending(fx.repo, [makeEntry("TEST-A", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const failingGate: Gate = {
      name: "always-fail",
      when: "afterCommit",
      async run() {
        return { ok: false, message: "boom" };
      },
    };
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [failingGate],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "test-a": async (cwd) => {
        // The entry's own afterCommit gate always fails, so this wave's
        // only trunk-touching action is the trailing footprint-only
        // pending-ledger commit — exactly where a concurrent actor's commit,
        // landed here while the agent still runs in its own worktree, used
        // to be silently overwritten under sha-equality refusal.
        await writeAndCommit(
          fx.repo,
          "src/interloper.ts",
          "external\n",
          "external: concurrent commit",
        );
        await writeAndCommit(cwd, "src/a.ts", "from-A\n", "build(TEST-A): attempt");
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(false);
    expect(outcome.tipMoved).toBeUndefined();
    expect(outcome.verdict?.tipMoved).toBeUndefined();
    // The entry's own afterCommit gate-revert is unaffected.
    expect(outcome.noCommit).toBe("gate-revert");

    // The footprint lands on pending.json anyway — commitPendingUpdate
    // recommitted on top of the interloper's commit rather than refusing.
    const onDisk = readPendingFromDisk(fx.repo);
    expect(onDisk).toEqual([
      { ...makeEntry("TEST-A", ["src/a.ts"]), observedFiles: ["src/a.ts"] },
    ]);
    expect(await readFile(join(fx.repo, "src/interloper.ts"), "utf8")).toBe(
      "external\n",
    );
  });

  describe("a live foreign tip claim still refuses (spec/loop.md 'Tip verify')", () => {
    async function claimPathFor(repo: string): Promise<string> {
      const ref = await git.currentRefPath(repo);
      if (ref.kind !== "ref") throw new Error("fixture HEAD is not a ref");
      const commonDir = await git.gitCommonDir(repo);
      return git.tipClaimPath(commonDir, ref.path);
    }

    async function plantClaim(repo: string, pid: number): Promise<string> {
      const claimPath = await claimPathFor(repo);
      await mkdir(dirname(claimPath), { recursive: true });
      await writeFile(claimPath, String(pid), "utf8");
      return claimPath;
    }

    it("refuses the cherry-pick, leaving the entry pending", async () => {
      await writePending(fx.repo, [makeEntry("TEST-A", ["src/a.ts"])]);
      new Baton(join(fx.repo, ".flume")).wake("build");
      const phase = makePhase({ name: "build", concurrency: "fanout", gates: [] });
      const chain: Chain = { phases: [phase], humanOnly: [] };

      const agent = fanoutAgent({
        "test-a": async (cwd) => {
          await writeAndCommit(cwd, "src/a.ts", "from-A\n", "build(TEST-A): ship");
        },
      });

      // The vitest worker's own pid plays the live concurrent engine's
      // holder — planted before the tick runs, so every entry's
      // pre-cherry-pick check sees it.
      await plantClaim(fx.repo, process.pid);

      const dispatcher = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        agent,
        log: silent,
        maxParallel: 4,
      });

      const outcome = await dispatcher.tick();

      expect(outcome.result?.committed).toBe(false);
      expect(outcome.result?.shippedTags).toEqual([]);
      expect(outcome.tipMoved).toBe(true);
      expect(outcome.verdict?.tipMoved).toBe(true);
      expect(outcome.verdict?.mergeOutcomes).toEqual([
        {
          entryTag: "TEST-A",
          outcome: "tip-moved",
          baseSha: expect.stringMatching(/^[0-9a-f]{40}$/),
          headSha: expect.stringMatching(/^[0-9a-f]{40}$/),
        },
      ]);

      expect(readPendingFromDisk(fx.repo)).toEqual([
        makeEntry("TEST-A", ["src/a.ts"]),
      ]);
      expect(existsSync(join(fx.repo, "src/a.ts"))).toBe(false);
    });

    it("refuses only the pending-ledger commit when the claim appears after a clean cherry-pick — shipped work stays shipped", async () => {
      await writePending(fx.repo, [makeEntry("TEST-A", ["src/a.ts"])]);
      new Baton(join(fx.repo, ".flume")).wake("build");

      // Plants the claim from inside an afterMerge gate — the first point
      // after this entry's clean cherry-pick and before commitPendingUpdate's
      // own check, so the entry's commit itself lands untouched and only the
      // trailing ledger rewrite hits the refusal.
      const plantClaimGate: Gate = {
        name: "plant-claim",
        when: "afterMerge",
        async run() {
          await plantClaim(fx.repo, process.pid);
          return { ok: true, message: "ok" };
        },
      };
      const phase = makePhase({
        name: "build",
        concurrency: "fanout",
        gates: [plantClaimGate],
      });
      const chain: Chain = { phases: [phase], humanOnly: [] };

      const agent = fanoutAgent({
        "test-a": async (cwd) => {
          await writeAndCommit(cwd, "src/a.ts", "from-A\n", "build(TEST-A): ship");
        },
      });

      const dispatcher = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        agent,
        log: silent,
        maxParallel: 4,
      });

      const claimPath = await claimPathFor(fx.repo);
      try {
        const outcome = await dispatcher.tick();

        expect(outcome.result?.committed).toBe(true);
        expect(outcome.result?.shippedTags).toEqual(["TEST-A"]);
        expect(outcome.tipMoved).toBe(true);
        expect(outcome.verdict?.tipMoved).toBe(true);

        // The entry's own commit landed and stayed — only the ledger rewrite
        // that would have removed it from pending.json refused.
        expect(await readFile(join(fx.repo, "src/a.ts"), "utf8")).toBe(
          "from-A\n",
        );
        expect(readPendingFromDisk(fx.repo)).toEqual([
          makeEntry("TEST-A", ["src/a.ts"]),
        ]);
      } finally {
        await rm(claimPath, { force: true });
      }
    });
  });
});

describe("Dispatcher tip-moved — singleton/fanout record+log shape agreement, same ancestry check both concurrencies (LOOP-TIPVERIFY-PERENTRY-ANCESTRY)", () => {
  it("both legs run the identical ancestry check and persist byte-identical prior-attempt records through the same log template", async () => {
    // spec/worktrees.md "Singleton runs in a worktree" retired the singleton
    // leg's own parent-equality check: a singleton tick now commits on a
    // private worktree branch exactly like a fanout entry, so both legs run
    // `checkTipMovedPerEntry` — ancestry, naming the observed HEAD itself,
    // never its parent. Same rewritten-branch shape on both sides proves it.
    const singletonPreHead = await head(fx.repo);
    new Baton(join(fx.repo, ".flume")).wake("plan");
    const singletonPhase = makePhase({ name: "plan", concurrency: "singleton" });
    const singletonChain: Chain = { phases: [singletonPhase], humanOnly: [] };
    let singletonRecordedBase = "";
    let singletonObservedHead = "";
    const singletonAgent = singleAgent(async (cwd) => {
      singletonRecordedBase = await head(cwd);
      await exec("git", ["checkout", "--orphan", "rewritten"], { cwd });
      await exec("git", ["reset", "--hard"], { cwd });
      await writeAndCommit(cwd, "src/plan-output.ts", "agent-work\n", "plan: derive");
      singletonObservedHead = await head(cwd);
    });
    const singletonWarnings: string[] = [];
    const singletonLog: Logger = {
      info: () => {},
      warn: (l) => singletonWarnings.push(l),
      error: () => {},
    };
    const singletonDispatcher = new Dispatcher({
      chainLoader: staticLoader(singletonChain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singletonAgent,
      log: singletonLog,
    });
    const singletonOutcome = await singletonDispatcher.tick();

    expect(singletonOutcome.tipMoved).toBe(true);
    expect(singletonRecordedBase).toBe(singletonPreHead);
    const singletonRecord = await readFile(
      join(fx.repo, ".flume", "prior-attempts", "phase", "plan.json"),
      "utf8",
    );
    // The ancestry check's "found" is the observed HEAD itself — the
    // agent's own top commit — never its parent, which on an orphan branch
    // doesn't even exist.
    expect(JSON.parse(singletonRecord).observedTip).toBe(singletonObservedHead);
    // Trunk itself never moved — the private worktree branch absorbed the
    // whole check and its revert; the tick tears it down regardless.
    expect(await head(fx.repo)).toBe(singletonPreHead);

    // ---- fanout — same shape, on a per-entry worktree branch.
    const fx2 = await makeFixture();
    try {
      await writePending(fx2.repo, [makeEntry("FANOUT-TWIN", ["src/a.ts"])]);
      new Baton(join(fx2.repo, ".flume")).wake("build");
      const fanoutPhase = makePhase({
        name: "build",
        concurrency: "fanout",
        gates: [],
      });
      const fanoutChain: Chain = { phases: [fanoutPhase], humanOnly: [] };
      const fanoutPreHead = await head(fx2.repo);
      let fanoutRecordedBase = "";
      let fanoutObservedHead = "";
      const fanoutAgentInst = fanoutAgent({
        "fanout-twin": async (cwd) => {
          fanoutRecordedBase = await head(cwd);
          await exec("git", ["checkout", "--orphan", "rewritten"], { cwd });
          await exec("git", ["reset", "--hard"], { cwd });
          await writeAndCommit(cwd, "src/a.ts", "from-A\n", "build(FANOUT-TWIN): ship");
          fanoutObservedHead = await head(cwd);
        },
      });
      const fanoutWarnings: string[] = [];
      const fanoutLog: Logger = {
        info: () => {},
        warn: (l) => fanoutWarnings.push(l),
        error: () => {},
      };
      const fanoutDispatcher = new Dispatcher({
        chainLoader: staticLoader(fanoutChain),
        repoRoot: fx2.repo,
        configDir: fx2.configDir,
        agent: fanoutAgentInst,
        log: fanoutLog,
        maxParallel: 4,
      });
      const fanoutOutcome = await fanoutDispatcher.tick();

      expect(fanoutOutcome.tipMoved).toBe(true);
      expect(fanoutRecordedBase).toBe(fanoutPreHead);
      const fanoutRecord = await readFile(
        join(fx2.repo, ".flume", "prior-attempts", "entry", "fanout-twin.json"),
        "utf8",
      );
      expect(JSON.parse(fanoutRecord).observedTip).toBe(fanoutObservedHead);

      // Prior-attempt record shape (mode + field names + JSON formatting) is
      // byte-identical for equivalent input — a one-sided edit to either
      // callsite's persisted record breaks this pin once the two sides'
      // real, necessarily-distinct SHAs are normalized out. `at` is wall-
      // clock and necessarily distinct between the two dispatcher runs, so
      // it is normalized the same way (spec/loop.md "Every record is
      // anchored": the field exists on both sides, its exact value is not
      // what this pin is about).
      const normalize = (raw: string, expectedTip: string, observedTip: string) =>
        raw
          .split(expectedTip)
          .join("<EXPECTED>")
          .split(observedTip)
          .join("<OBSERVED>")
          .replace(/"at": "[^"]*"/, '"at": "<AT>"')
          // The keyspace and the written identity are the fields that
          // legitimately differ between the legs (spec/loop.md "No false
          // signal") — normalized out of the byte pin and asserted on their
          // own below. The declaration key is the entry keyspace's alone —
          // a phase has no declaration to hash — so the whole line goes,
          // not just its value.
          .replace(/"key": "[^"]*"/, '"key": "<KEYSPACE>"')
          .replace(/"keyedAs": "[^"]*"/, '"keyedAs": "<KEYED-AS>"')
          .replace(/\n *"declaredAs": "[^"]*",?/, "");
      expect(normalize(fanoutRecord, fanoutPreHead, fanoutObservedHead)).toBe(
        normalize(singletonRecord, singletonPreHead, singletonObservedHead),
      );
      expect(JSON.parse(singletonRecord).key).toBe("phase");
      expect(JSON.parse(fanoutRecord).key).toBe("entry");
      // …and each leg's identity is the one its own keyspace names: the
      // phase's name as the chain spells it, the entry's tag slug.
      expect(JSON.parse(singletonRecord).keyedAs).toBe("plan");
      expect(JSON.parse(fanoutRecord).keyedAs).toBe(slugify("FANOUT-TWIN"));
      // …and the declaration key rides the entry keyspace alone.
      expect(JSON.parse(singletonRecord).declaredAs).toBeUndefined();
      expect(JSON.parse(fanoutRecord).declaredAs).toBe(
        entryDeclaredKey((readPendingFromDisk(fx2.repo))[0]!),
      );
      expect(JSON.parse(singletonRecord).mode).toBe("tip-moved");
      expect(JSON.parse(fanoutRecord).mode).toBe("tip-moved");

      // Both legs log through the same template —
      // "[flume] <label>: tip moved (no commit) — expected <sha>, found <sha>"
      // — with only the label (phase name vs. entry tag) differing.
      expect(singletonWarnings).toHaveLength(1);
      expect(fanoutWarnings).toHaveLength(1);
      const shape =
        /^\[flume\] (.+): tip moved \(no commit\) — expected (\S+), found (\S+)$/;
      const singletonMatch = singletonWarnings[0]!.match(shape);
      const fanoutMatch = fanoutWarnings[0]!.match(shape);
      expect(singletonMatch).not.toBeNull();
      expect(fanoutMatch).not.toBeNull();
      expect(singletonMatch![1]).toBe("plan");
      expect(fanoutMatch![1]).toBe("FANOUT-TWIN");
      expect(singletonMatch![2]).toBe(singletonPreHead);
      expect(singletonMatch![3]).toBe(singletonObservedHead);
      expect(fanoutMatch![2]).toBe(fanoutPreHead);
      expect(fanoutMatch![3]).toBe(fanoutObservedHead);
    } finally {
      await fx2.cleanup();
    }
  });
});

/**
 * `writeTickVerdict`/`clearTickVerdict`/`readTickVerdicts` are the
 * primitives the CLI's `tick` command calls around `dispatcher.tick()`
 * (never `Dispatcher.tick()` itself — a plain unit test constructing a
 * `Dispatcher` directly, as every test above does, must not gain an
 * untracked `<flumeDir>/tick-verdict.json` side effect underfoot;
 * `superviseLoop`'s own accumulation from this same artifact is proved
 * in `tests/loopSupervisor.test.ts`, via a stub `runTick` that writes it
 * directly, the way a real `flume tick` child process would). This suite
 * proves the primitives' own round-trip, clear behavior, and bounded
 * history — and that the shape carries no interpretation field (no
 * `errored`; the read site derives that instead). That last claim is
 * an agreement claim, so it alone drives real dispatcher ticks and persists
 * what they built through `writeTickVerdict`, standing in for the CLI
 * (`.claude/rules/engineering.md`, "A seam gate reads what the real writer
 * wrote"); the round-trip and history tests keep `verdictFixture`, whose
 * shape they are not the judge of.
 */
describe("writeTickVerdict / clearTickVerdict / readTickVerdicts — the tick-verdict artifact", () => {
  // Keyed by the phase `verdictFixture` reports, which is the phase the real
  // writer files a verdict under.
  const latestPath = (): string =>
    tickVerdictPath(join(fx.repo, ".flume"), verdictFixture().phaseName);
  const historyPath = (): string =>
    tickVerdictsLogPath(join(fx.repo, ".flume"));

  it("writes a record readable back verbatim, appends it to the bounded history log", async () => {
    const v = verdictFixture({ shippedTags: ["TEST-A"] });
    await writeTickVerdict(join(fx.repo, ".flume"), v);

    const onDisk = JSON.parse(await readFile(latestPath(), "utf8"));
    expect(onDisk).toEqual(v);
    expect(existsSync(historyPath())).toBe(true);
    expect(await readTickVerdicts(join(fx.repo, ".flume"))).toEqual([v]);
  });

  it("a dispatcher-produced tick verdict carries only declared fact fields, never an interpretation field", async () => {
    const flumeDir = join(fx.repo, ".flume");

    // Every field name `TickVerdict` declares — the refusal list this claim
    // is judged against. A field the engine grows is either a fact that
    // belongs on this list or the interpretation the shape's own doc refuses
    // (`src/Dispatcher.ts`, "No interpretation fields"); until someone
    // decides which, a real tick emitting it fails below.
    const FACT_FIELDS = [
      "phaseName",
      "tags",
      "committed",
      "noCommit",
      "tipMoved",
      "declined",
      "bystanderCheckpointSha",
      "gateResults",
      "shippedTags",
      "mergeOutcomes",
      "invocations",
      "provisionFailures",
      "mergeFailures",
      "gateFailures",
      "clearedPriorAttempts",
      "summary",
      "headSha",
      "at",
    ];

    /**
     * Persist a verdict the dispatcher built exactly the way the CLI's
     * `tick` command does, and read back the keys that landed — the real
     * writer's output through the real artifact, never a hand-authored
     * literal (`.claude/rules/engineering.md`, "A seam gate reads what the
     * real writer wrote").
     */
    const persistedKeys = async (
      v: TickVerdict | undefined,
    ): Promise<string[]> => {
      expect(v).toBeDefined();
      await writeTickVerdict(flumeDir, v!);
      // Read back at the phase's own file, the way the supervisor does: the
      // two verdicts folded below come from two phases, and a single path
      // would have the second's keys read as the first's.
      const onDisk = JSON.parse(
        await readFile(tickVerdictPath(flumeDir, v!.phaseName), "utf8"),
      ) as Record<string, unknown>;
      return Object.keys(onDisk);
    };

    const fanoutBuild = (phase: Partial<Phase>, agent: Agent): Dispatcher =>
      new Dispatcher({
        chainLoader: staticLoader({
          phases: [
            makePhase({
              name: "build",
              concurrency: "fanout",
              writablePaths: ["src/**"],
              ...phase,
            }),
          ],
          humanOnly: [],
        }),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        agent,
        log: silent,
        maxParallel: 4,
      });

    // A prior attempt filed under a tag the judged wave's queue no longer
    // carries, so that wave retires it and says which (`clearedPriorAttempts`).
    await writePending(fx.repo, [makeEntry("STALE-ONE", ["src/stale-one.ts"])]);
    new Baton(flumeDir).wake("build");
    await fanoutBuild(
      {},
      fanoutAgent({
        "stale-one": async (cwd) => {
          await writeAndCommit(cwd, "stale.txt", "x\n", "build: STALE-ONE");
        },
      }),
    ).tick();
    expect(existsSync(priorAttemptPath(flumeDir, entryRef("STALE-ONE")))).toBe(true);

    // The judged wave, shaped to reach past the always-present fields: one
    // entry ships, one trips the real writable-paths gate, one is declined
    // by `shouldRun`, STALE-ONE has left the queue, and an unstaged
    // bystander edit on the primary checkout forces the pre-merge checkpoint.
    await writePending(fx.repo, [
      makeEntry("SHIP-IT", ["src/ship-it.ts"]),
      makeEntry("GATE-FAIL", ["src/gate-fail.ts"]),
      makeEntry("DECLINE-ME", ["src/decline-me.ts"]),
    ]);
    await writeFile(join(fx.repo, "README.md"), "operator's own edit\n");
    new Baton(flumeDir).wake("build");
    const wave = await fanoutBuild(
      { shouldRun: (ctx) => ctx.assignedEntry?.tag !== "DECLINE-ME" },
      // No action registered for `decline-me`: `fanoutAgent` throws if the
      // declined entry ever reaches the agent.
      fanoutAgent({
        "ship-it": async (cwd) => {
          await writeAndCommit(cwd, "src/ship-it.ts", "ok\n", "build: SHIP-IT");
        },
        "gate-fail": async (cwd) => {
          await writeAndCommit(cwd, "outside.txt", "no\n", "build: GATE-FAIL");
        },
      }),
    ).tick();

    expect(wave.verdict?.shippedTags).toEqual(["SHIP-IT"]);
    const waveKeys = await persistedKeys(wave.verdict);

    // A second, quiet tick: `noCommit` classifies a tick that produced no
    // usable commit, so the shipping wave above can never carry it.
    new Baton(flumeDir).wake("plan");
    const quiet = await new Dispatcher({
      chainLoader: staticLoader({
        phases: [makePhase({ name: "plan", concurrency: "singleton" })],
        humanOnly: [],
      }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async () => {}),
      log: silent,
    }).tick();
    expect(quiet.verdict?.committed).toBe(false);
    const quietKeys = await persistedKeys(quiet.verdict);

    const emitted = [...new Set([...waveKeys, ...quietKeys])];

    // Non-vacuity (`.claude/rules/engineering.md`, "A green verdict is
    // proven non-vacuous"): the judged set is a real writer's, and it
    // reaches the conditional fields. A subset check over the eleven
    // always-present names alone would pass over an engine that emits an
    // undeclared field only on the paths this test never drove.
    for (const always of [
      "phaseName",
      "tags",
      "committed",
      "gateResults",
      "shippedTags",
      "mergeOutcomes",
      "invocations",
      "summary",
      "headSha",
      "at",
    ]) {
      expect(emitted).toContain(always);
    }
    for (const conditional of [
      "noCommit",
      "declined",
      "bystanderCheckpointSha",
      "gateFailures",
      "clearedPriorAttempts",
    ]) {
      expect(emitted).toContain(conditional);
    }

    // The claim: every key the engine actually wrote is a declared fact …
    expect(emitted.filter((k) => !FACT_FIELDS.includes(k)).sort()).toEqual([]);
    // … and the name the shape's own doc refuses stays off the list above,
    // so widening the allowlist can never be how `errored` gets in.
    expect(FACT_FIELDS).not.toContain("errored");

    // The violating path is a fact in the real gate's own captured
    // `details`, not a re-derived summary — a chain reading history sees
    // what the gate said, verbatim.
    const violation = wave.verdict?.gateResults.find(
      (g) => g.gate === "writable-paths" && !g.ok,
    );
    expect(violation?.details).toContain("outside.txt");
  });

  it("clearTickVerdict removes the latest record without touching history; no-ops when absent", async () => {
    await writeTickVerdict(join(fx.repo, ".flume"), verdictFixture());
    expect(existsSync(latestPath())).toBe(true);

    await clearTickVerdict(join(fx.repo, ".flume"));
    expect(existsSync(latestPath())).toBe(false);
    expect(await readTickVerdicts(join(fx.repo, ".flume"))).toHaveLength(1);

    // No pre-existing file (fresh flumeDir, never ticked) — still a no-op.
    await expect(
      clearTickVerdict(join(fx.repo, ".flume", "never-created")),
    ).resolves.not.toThrow();
  });

  /**
   * LOOP-WAVE-VERDICT-PER-PHASE (spec/loop.md, *The tick verdict — one facts
   * artifact*): the supervisor holds one child per awake phase at once, so a
   * single verdict path made every child but the last one lossy — and lossy
   * silently, since the supervisor read a well-formed verdict that simply
   * belonged to a sibling. The write and the read both key by phase here, so
   * two children of one run can never share a path.
   */
  it("two ticks of different phases each leave their own verdict file", async () => {
    const flumeDir = join(fx.repo, ".flume");
    const plan = verdictFixture({
      phaseName: "plan",
      summary: "plan shipped nothing",
      shippedTags: [],
    });
    const build = verdictFixture({
      phaseName: "build",
      summary: "build shipped ENTRY-ONE",
      shippedTags: ["ENTRY-ONE"],
    });
    // The real writer, twice, in the order a supervisor's two children would
    // finish — nothing hand-authored between them
    // (`.claude/rules/engineering.md`, *A seam gate reads what the real
    // writer wrote*).
    await writeTickVerdict(flumeDir, plan);
    await writeTickVerdict(flumeDir, build);

    // Two files, not one: the second write did not land where the first did.
    expect(tickVerdictPath(flumeDir, "plan")).not.toBe(
      tickVerdictPath(flumeDir, "build"),
    );
    expect(existsSync(tickVerdictPath(flumeDir, "plan"))).toBe(true);
    expect(existsSync(tickVerdictPath(flumeDir, "build"))).toBe(true);

    // And the real reader, handed the phase the supervisor named each child
    // by, gets that child's own facts back — the plan verdict survives the
    // build tick that followed it.
    expect(await readTickVerdict(flumeDir, "plan")).toEqual(plan);
    expect(await readTickVerdict(flumeDir, "build")).toEqual(build);

    // Clearing one phase's verdict leaves the other's standing, which is what
    // a child's pre-tick clear must not take from its sibling.
    await clearTickVerdict(flumeDir, "build");
    expect(await readTickVerdict(flumeDir, "build")).toBeUndefined();
    expect((await readTickVerdict(flumeDir, "plan"))?.summary).toBe(
      "plan shipped nothing",
    );

    // History is untouched by either: both records are in the log, in order.
    expect((await readTickVerdicts(flumeDir)).map((v) => v.phaseName)).toEqual([
      "plan",
      "build",
    ]);
  });

  it("readTickVerdicts serves the last N, oldest first, for a chain to render recent history", async () => {
    for (let i = 0; i < 5; i++) {
      await writeTickVerdict(
        join(fx.repo, ".flume"),
        verdictFixture({ summary: `tick ${i}` }),
      );
    }
    const last2 = await readTickVerdicts(join(fx.repo, ".flume"), 2);
    expect(last2.map((v) => v.summary)).toEqual(["tick 3", "tick 4"]);
  });

  it("readTickVerdicts refuses a verdict history log that is present and unreadable", async () => {
    const flumeDir = join(fx.repo, ".flume");
    await writeTickVerdict(flumeDir, verdictFixture({ summary: "tick 0" }));
    // Non-vacuity: the log reads, and carries the row, before it is denied.
    expect(await readTickVerdicts(flumeDir)).toHaveLength(1);

    // Denied structurally at the read path itself (`tests/helpers/denial.ts`)
    // — a stat still finds the entry, the read fails EISDIR. Denying the
    // parent instead would answer ENOENT on win32 and the probe would take
    // its absent arm there.
    denyFile(historyPath());

    let caught: NodeJS.ErrnoException | undefined;
    try {
      await readTickVerdicts(flumeDir);
    } catch (err) {
      caught = err as NodeJS.ErrnoException;
    }
    expect(caught).toBeDefined();
    expect(caught?.code).not.toBe("ENOENT");

    // The absent arm is untouched: a flumeDir that never ticked still reads
    // as empty history, so the refusal above is the present-but-unreadable
    // case alone and not a reader that stopped folding ENOENT.
    expect(
      await readTickVerdicts(join(fx.repo, ".flume", "never-ticked")),
    ).toEqual([]);
  });

  it("readTickVerdict refuses a latest-tick verdict file that is present and unreadable", async () => {
    const flumeDir = join(fx.repo, ".flume");
    await writeTickVerdict(flumeDir, verdictFixture({ summary: "tick 0" }));
    // Non-vacuity: the latest-tick file reads back before it is denied.
    expect((await readTickVerdict(flumeDir, "build"))?.summary).toBe("tick 0");

    denyFile(latestPath());

    let caught: NodeJS.ErrnoException | undefined;
    try {
      await readTickVerdict(flumeDir, "build");
    } catch (err) {
      caught = err as NodeJS.ErrnoException;
    }
    expect(caught).toBeDefined();
    expect(caught?.code).not.toBe("ENOENT");

    // `clearTickVerdict` leaves nothing behind, and that absence still reads
    // as "nothing to report" — the one silent arm this reader keeps.
    await rm(latestPath(), { recursive: true, force: true });
    expect(await readTickVerdict(flumeDir, "build")).toBeUndefined();
  });
});

/**
 * spec/loop.md "The tick verdict — one facts artifact", "Every verdict is
 * anchored": `headSha` is the trunk tip and `at` an ISO timestamp, so "has
 * the world moved since this phase last ran" is a comparison against engine
 * state rather than an inference from touched paths — and a quiet
 * (no-commit) tick still leaves an anchor behind.
 */
describe("TickVerdict anchoring — headSha/at (spec/loop.md 'The tick verdict')", () => {
  it("a committed tick's verdict headSha matches the trunk tip once written; at is a valid ISO timestamp", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");
    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/plan-output.ts", "ok\n", "plan: derive");
    });
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();
    expect(outcome.verdict).toBeDefined();

    await writeTickVerdict(join(fx.repo, ".flume"), outcome.verdict!);
    const [written] = await readTickVerdicts(join(fx.repo, ".flume"));

    expect(written!.headSha).toBe(await head(fx.repo));
    expect(new Date(written!.at).toISOString()).toBe(written!.at);
  });

  it("a quiet (no-commit) tick's verdict still carries headSha/at", async () => {
    const preHead = await head(fx.repo);
    new Baton(join(fx.repo, ".flume")).wake("plan");
    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const agent: Agent = {
      name: "noop",
      async invoke() {
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();
    expect(outcome.result?.committed).toBe(false);
    expect(outcome.verdict).toBeDefined();

    // Nothing shipped, so the trunk tip is unchanged — but the anchor is
    // present regardless, never conditioned on a commit having happened.
    expect(outcome.verdict!.headSha).toBe(preHead);
    expect(new Date(outcome.verdict!.at).toISOString()).toBe(
      outcome.verdict!.at,
    );
  });
});

/**
 * `readLatestVerdictsSync` — the synchronous sibling `Phase.shouldRun`/
 * `Phase.handoff` (both synchronous by contract) read for the anchor above,
 * since neither can take `readTickVerdicts`'s `await`.
 */
describe("readLatestVerdictsSync — synchronous per-phase anchor read", () => {
  it("returns the most recent verdict per phase name from the verdict log", async () => {
    const flumeDir = join(fx.repo, ".flume");
    await writeTickVerdict(
      flumeDir,
      verdictFixture({ phaseName: "plan", summary: "plan tick 1" }),
    );
    await writeTickVerdict(
      flumeDir,
      verdictFixture({ phaseName: "build", summary: "build tick 1" }),
    );
    await writeTickVerdict(
      flumeDir,
      verdictFixture({ phaseName: "plan", summary: "plan tick 2" }),
    );

    const latest = readLatestVerdictsSync(flumeDir);

    expect(Object.keys(latest).sort()).toEqual(["build", "plan"]);
    expect(latest["plan"]!.summary).toBe("plan tick 2");
    expect(latest["build"]!.summary).toBe("build tick 1");
  });

  it("returns an empty result when the verdict log does not exist yet", () => {
    expect(readLatestVerdictsSync(join(fx.repo, ".flume", "never-ticked"))).toEqual(
      {},
    );
  });

  it("readLatestVerdictsSync refuses a verdict history log that is present and unreadable", async () => {
    const flumeDir = join(fx.repo, ".flume");
    await writeTickVerdict(
      flumeDir,
      verdictFixture({ phaseName: "plan", summary: "plan tick 1" }),
    );
    // Non-vacuity: the anchor set is populated before the log is denied —
    // an empty result here is exactly what this reader must never report
    // over an unread log.
    expect(Object.keys(readLatestVerdictsSync(flumeDir))).toEqual(["plan"]);

    denyFile(tickVerdictsLogPath(flumeDir));

    let caught: NodeJS.ErrnoException | undefined;
    try {
      readLatestVerdictsSync(flumeDir);
    } catch (err) {
      caught = err as NodeJS.ErrnoException;
    }
    expect(caught).toBeDefined();
    expect(caught?.code).not.toBe("ENOENT");
  });
});

describe("TickVerdict invocations — usage/cost facts (spec/loop.md 'Every agent invocation leaves a usage row')", () => {
  it("a singleton tick's verdict carries one invocations[] row with no entryTag; a field the agent didn't report is absent, not zero", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");
    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const agent: Agent = {
      name: "usage-singleton",
      async invoke(inv) {
        await writeAndCommit(inv.cwd, "src/plan-output.ts", "ok\n", "plan: derive");
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          usage: {
            model: "claude-fable-5-1",
            turns: 2,
            inputTokens: 10,
            outputTokens: 20,
          },
        };
      },
    };
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();
    expect(outcome.result?.committed).toBe(true);
    expect(outcome.verdict!.invocations).toHaveLength(1);

    const { promptPath, uncommittedTracked: _u, ...row } =
      outcome.verdict!.invocations[0]!;
    expect(promptPath).toMatch(/^rendered-prompts\/.+-plan\.md$/);
    expect(row).toEqual({
      model: "claude-fable-5-1",
      turns: 2,
      inputTokens: 10,
      outputTokens: 20,
    });
    // Absent, not zero/undefined-as-a-key: the agent's usage never named
    // these fields, so the row carries no key for them at all.
    expect("entryTag" in row).toBe(false);
    expect("durationMs" in row).toBe(false);
    expect("cacheCreationInputTokens" in row).toBe(false);
    expect("cacheReadInputTokens" in row).toBe(false);
  });

  it("a tick verdict's invocation row carries the agent's reported costUsd", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");
    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    // Agreement, not a hand-set field: the real stream-json `result` event
    // goes through the real decode (`withTerminalRenderer`), and the verdict
    // row is read for what that decode produced.
    const stream =
      [
        JSON.stringify({ type: "system", subtype: "init" }),
        JSON.stringify({
          type: "result",
          num_turns: 3,
          duration_ms: 1200,
          total_cost_usd: 1.2345,
          usage: { input_tokens: 10, output_tokens: 20 },
          modelUsage: { "claude-fable-5-1": {} },
        }),
      ].join("\n") + "\n";
    const inner: Agent = {
      name: "emits-cost",
      async invoke(inv) {
        await writeAndCommit(inv.cwd, "src/plan-output.ts", "ok\n", "plan: derive");
        inv.onStdout?.(stream);
        return { exitCode: 0, stdout: stream, stderr: "" };
      },
    };
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: withTerminalRenderer(inner),
      log: silent,
    });

    const outcome = await dispatcher.tick();
    expect(outcome.result?.committed).toBe(true);
    expect(outcome.verdict!.invocations).toHaveLength(1);

    const row = outcome.verdict!.invocations[0]!;
    expect(row.costUsd).toBe(1.2345);
    // The cost rides beside the token split it is unrecoverable without,
    // off the one decode — not a second reading of the same stream.
    expect(row.inputTokens).toBe(10);
    expect(row.outputTokens).toBe(20);
    expect(row.turns).toBe(3);
  });

  it("a fanout tick's verdict carries one invocations[] row per provisioned entry, each tagged", async () => {
    const entries = [
      makeEntry("TEST-A", ["src/a.ts"]),
      makeEntry("TEST-B", ["src/b.ts"]),
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout", gates: [] });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent: Agent = {
      name: "usage-fanout",
      async invoke(inv) {
        const slug = basename(inv.cwd);
        if (slug === "test-a") {
          await writeAndCommit(inv.cwd, "src/a.ts", "from-A\n", "build(TEST-A): ship");
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            usage: { model: "claude-fable-5-1", turns: 1, inputTokens: 100 },
          };
        }
        if (slug === "test-b") {
          await writeAndCommit(inv.cwd, "src/b.ts", "from-B\n", "build(TEST-B): ship");
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            usage: { model: "claude-haiku-4-5", turns: 3, outputTokens: 50 },
          };
        }
        throw new Error(`usage-fanout: no fixture for slug '${slug}'`);
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();
    expect(outcome.result?.shippedTags).toEqual(["TEST-A", "TEST-B"]);

    const invocations = outcome.verdict!.invocations;
    expect(invocations).toHaveLength(2);
    for (const i of invocations) {
      expect(i.promptPath).toMatch(/^rendered-prompts\/.+\.md$/);
    }
    const byTag = Object.fromEntries(
      invocations.map(({ promptPath: _p, uncommittedTracked: _u, ...i }) => [
        i.entryTag,
        i,
      ]),
    );
    expect(byTag["TEST-A"]).toEqual({
      entryTag: "TEST-A",
      model: "claude-fable-5-1",
      turns: 1,
      inputTokens: 100,
    });
    expect(byTag["TEST-B"]).toEqual({
      entryTag: "TEST-B",
      model: "claude-haiku-4-5",
      turns: 3,
      outputTokens: 50,
    });
  });
});

describe("Uncommitted tracked edits ride the tick verdict (spec/loop.md 'Tip verify — one writer per branch, absorption at the merge')", () => {
  it("a tick that commits nothing reports the tracked paths it modified before teardown", async () => {
    // A tracked path the default porcelain form would double-quote. The
    // report has to name the path as it sits on disk, not git's escaped
    // spelling of it — the same `-z` requirement every other listing reader
    // in `src/git.ts` carries.
    await writeAndCommit(
      fx.repo,
      "src/needs quoting.ts",
      "// seed\n",
      "seed: a path the default porcelain form quotes",
    );
    new Baton(join(fx.repo, ".flume")).wake("plan");
    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    // Real work, never committed: exactly the shape teardown destroys.
    const agent = singleAgent(async (cwd) => {
      await writeFile(join(cwd, "src", "seed.ts"), "// edited, never committed\n");
      await writeFile(join(cwd, "src", "needs quoting.ts"), "// also uncommitted\n");
      await writeFile(join(cwd, "scratch.txt"), "untracked scratch\n");
    });
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(false);
    expect(outcome.verdict!.noCommit).toBe("clean-exit");
    // Vacuity pin: an agent ran, so there is a row for the assertion below
    // to be about.
    const rows = outcome.verdict!.invocations;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.uncommittedTracked).toEqual([
      "src/needs quoting.ts",
      "src/seed.ts",
    ]);
    // Untracked output is not a loss the tick can be said to have modified
    // away from — and a real worktree's untracked set is build noise.
    expect(rows[0]!.uncommittedTracked).not.toContain("scratch.txt");
    // Before teardown, and provably so: the worktree those paths lived in
    // no longer exists by the time the verdict is readable.
    expect(existsSync(join(fx.repo, ".flume", "worktrees", "plan"))).toBe(false);
  });

  it("a tick that left no tracked modification reports an empty set", async () => {
    await writePending(fx.repo, [makeEntry("TEST-CLEAN", ["src/clean.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout", gates: [] });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const agent = fanoutAgent({
      "test-clean": async (cwd) => {
        await writeAndCommit(cwd, "src/clean.ts", "shipped\n", "build(TEST-CLEAN): ship");
      },
    });
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual(["TEST-CLEAN"]);
    const rows = outcome.verdict!.invocations;
    expect(rows).toHaveLength(1);
    // Present and empty, not absent: "nothing was lost" is a fact the tick
    // states, and an absent key would read the same as a read that never ran.
    expect(rows[0]!.uncommittedTracked).toEqual([]);
    expect("uncommittedTracked" in rows[0]!).toBe(true);
  });

  it("under fanout each entry's leftovers ride that entry's own invocation row", async () => {
    await writePending(fx.repo, [
      makeEntry("TEST-A", ["src/a.ts"]),
      makeEntry("TEST-B", ["src/b.ts"]),
    ]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout", gates: [] });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const agent = fanoutAgent({
      "test-a": async (cwd) => {
        await writeAndCommit(cwd, "src/a.ts", "from-A\n", "build(TEST-A): ship");
        // Half-finished follow-on work the agent never committed.
        await writeFile(join(cwd, "src", "seed.ts"), "// A's leftovers\n");
      },
      "test-b": async (cwd) => {
        await writeAndCommit(cwd, "src/b.ts", "from-B\n", "build(TEST-B): ship");
      },
    });
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual(["TEST-A", "TEST-B"]);
    const byTag = new Map(
      outcome.verdict!.invocations.map((i) => [i.entryTag, i.uncommittedTracked]),
    );
    expect(byTag.size).toBe(2);
    // Each worktree is read on its own — a sibling's clean tree never
    // launders the entry that actually lost work, and vice versa.
    expect(byTag.get("TEST-A")).toEqual(["src/seed.ts"]);
    expect(byTag.get("TEST-B")).toEqual([]);
  });
});


describe("The rendered prompt is persisted before the agent runs (spec/prompt.md)", () => {
  /** Files under `<flumeDir>/rendered-prompts/`, or [] when the dir is absent. */
  async function renderedFiles(): Promise<string[]> {
    const dir = join(fx.repo, ".flume", "rendered-prompts");
    return existsSync(dir) ? readdir(dir) : [];
  }

  it("singleton: the file the row names holds the exact bytes the agent was handed, and exists before invoke is called", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");
    await writeFile(
      join(fx.configDir, "prompt.md"),
      "digest: !`printf 'live-%s' rendered`\nnon-ascii: —\n",
      "utf8",
    );
    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    let handed: string | undefined;
    let onDiskAtInvoke: string[] = [];
    let bytesAtInvoke: string | undefined;
    const agent: Agent = {
      name: "captures-prompt",
      async invoke(inv) {
        handed = inv.prompt;
        // The record is durable before the agent starts, not after it ends.
        onDiskAtInvoke = await renderedFiles();
        if (onDiskAtInvoke.length === 1) {
          bytesAtInvoke = await readFile(
            join(fx.repo, ".flume", "rendered-prompts", onDiskAtInvoke[0]!),
            "utf8",
          );
        }
        await writeAndCommit(inv.cwd, "src/out.ts", "x\n", "plan: derive");
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();
    expect(outcome.result?.committed).toBe(true);

    // Non-vacuous: the real renderer produced a prompt with the inline-exec
    // digest resolved, and that is what reached the agent.
    expect(handed).toBeDefined();
    expect(handed).toContain("digest: live-rendered");
    expect(handed).toContain("<harness>");

    const row = outcome.verdict!.invocations[0]!;
    expect(row.promptPath).toMatch(/^rendered-prompts\/[^/]+-plan\.md$/);
    const recorded = await readFile(
      join(fx.repo, ".flume", row.promptPath),
      "utf8",
    );
    // Agreement: the real writer's bytes through the real reader — the
    // file the verdict names is byte-identical to `inv.prompt`.
    expect(recorded).toBe(handed);
    expect(onDiskAtInvoke).toEqual([
      row.promptPath.slice("rendered-prompts/".length),
    ]);
    expect(bytesAtInvoke).toBe(handed);
  });

  it("fanout: each entry's row names its own file, and each file matches the prompt that entry's agent received", async () => {
    const entries = [
      makeEntry("REC-A", ["src/a.ts"]),
      makeEntry("REC-B", ["src/b.ts"]),
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");
    await writeFile(join(fx.configDir, "prompt.md"), "entry: {{TAG}}\n", "utf8");
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
      promptArgs: (ctx) => ({ TAG: ctx.assignedEntry!.tag }),
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const handed = new Map<string, string>();
    const agent: Agent = {
      name: "captures-per-entry",
      async invoke(inv) {
        const slug = basename(inv.cwd);
        const file = slug === "rec-a" ? "src/a.ts" : "src/b.ts";
        handed.set(slug, inv.prompt);
        await writeAndCommit(inv.cwd, file, `${slug}\n`, `build: ${slug}`);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();
    expect(outcome.result?.shippedTags).toEqual(["REC-A", "REC-B"]);
    expect(handed.size).toBe(2);

    const rows = outcome.verdict!.invocations;
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.promptPath)).size).toBe(2);
    for (const row of rows) {
      const slug = row.entryTag!.toLowerCase();
      expect(row.promptPath).toMatch(
        new RegExp(`^rendered-prompts/[^/]+-${slug}\\.md$`),
      );
      const recorded = await readFile(
        join(fx.repo, ".flume", row.promptPath),
        "utf8",
      );
      expect(recorded).toContain(`entry: ${row.entryTag}`);
      expect(recorded).toBe(handed.get(slug));
    }
    expect((await renderedFiles()).length).toBe(2);
  });

  it("declined and render-refused ticks write nothing: the record exists iff an agent ran", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");
    const chain: Chain = {
      phases: [
        makePhase({
          name: "plan",
          concurrency: "singleton",
          shouldRun: () => false,
        }),
      ],
      humanOnly: [],
    };
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async () => {}),
      log: silent,
    });
    const declined = await dispatcher.tick();
    expect(declined.declined).toBe(true);
    expect(declined.verdict?.invocations).toEqual([]);
    expect(await renderedFiles()).toEqual([]);

    // render-refused: the span fails, the agent never runs, no file.
    new Baton(join(fx.repo, ".flume")).wake("plan");
    await writeFile(join(fx.configDir, "prompt.md"), "digest: !`exit 3`\n", "utf8");
    const refusing = new Dispatcher({
      chainLoader: staticLoader({
        phases: [makePhase({ name: "plan", concurrency: "singleton" })],
        humanOnly: [],
      }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async () => {}),
      log: silent,
    });
    const refused = await refusing.tick();
    expect(refused.noCommit).toBe("render-refused");
    expect(refused.verdict?.invocations).toEqual([]);
    expect(await renderedFiles()).toEqual([]);
  });

  it("the longest tag parsePendingQueue accepts yields a filename within NAME_MAX — the schema's ceiling driven through the real writer", async () => {
    const tag = "A".repeat(TAG_MAX_LENGTH);
    await writePending(fx.repo, [makeEntry(tag, ["src/tag-len.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");
    const phase = makePhase({ name: "build", concurrency: "fanout", gates: [] });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const agent = fanoutAgent({
      [worktreeDirName(tag)]: async (cwd) => {
        await writeAndCommit(cwd, "src/tag-len.ts", "ok\n", "build: ship");
      },
    });
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();
    expect(outcome.result?.shippedTags).toEqual([tag]);
    const row = outcome.verdict!.invocations[0]!;
    expect(basename(row.promptPath).length).toBeLessThanOrEqual(255);
    expect(existsSync(join(fx.repo, ".flume", row.promptPath))).toBe(true);
  });
});

describe("PriorAttempt anchoring — exported priorAttemptPath/slugify, headSha/at on every variant (spec/loop.md 'Prior-outcome feedback to the retrying tick')", () => {
  it("src/index.ts re-exports the same slugify/priorAttemptPath functions, not second copies", () => {
    expect(indexSlugify).toBe(slugify);
    expect(indexPriorAttemptPath).toBe(priorAttemptPath);
  });

  it("priorAttemptPath(flumeDir, ref) sits under the ref's own keyspace directory inside priorAttemptsDir(flumeDir)", () => {
    const flumeDir = join(fx.repo, ".flume");
    const tag = "Weird.Tag_Name(1)";
    // The two keyspaces are two directories, so an identity that slugs alike
    // in both still names two files.
    expect(dirname(priorAttemptPath(flumeDir, entryRef(tag)))).toBe(
      join(priorAttemptsDir(flumeDir), "entry"),
    );
    expect(dirname(priorAttemptPath(flumeDir, phaseRef(tag)))).toBe(
      join(priorAttemptsDir(flumeDir), "phase"),
    );
    expect(priorAttemptPath(flumeDir, entryRef(tag))).not.toBe(
      priorAttemptPath(flumeDir, phaseRef(tag)),
    );
  });

  it("priorAttemptPath(flumeDir, tag) matches the path the dispatcher itself reads/writes for a fanout entry's record", async () => {
    // A tag exercising real slugification (uppercase, '.', '_', '(', ')' —
    // all TAG_PATTERN-legal but none of them slug-safe on their own).
    const tag = "Weird.Tag_Name(1)";
    await writePending(fx.repo, [makeEntry(tag, ["src/o.ts"])]);
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const failing: Gate = {
      name: "revert-gate",
      when: "afterCommit",
      async run() {
        return { ok: false, message: "no" };
      },
    };
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [failing],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const agent: Agent = {
      name: "fanout-agent",
      async invoke(inv) {
        await writeAndCommit(inv.cwd, "src/o.ts", "x\n", "build: attempt");
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    await dispatcher.tick();

    const flumeDir = join(fx.repo, ".flume");
    const derived = priorAttemptPath(flumeDir, entryRef(tag));
    expect(derived).toBe(
      join(flumeDir, "prior-attempts", "entry", `${slugify(tag)}.json`),
    );
    expect(existsSync(derived)).toBe(true);
    expect(JSON.parse(await readFile(derived, "utf8")).mode).toBe(
      "gate-revert",
    );
  });

  it("priorAttemptPath(flumeDir, phase.name) matches the path the dispatcher itself reads/writes for a singleton phase's record", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");
    const agent: Agent = {
      name: "bailing-singleton",
      async invoke() {
        return { exitCode: 0, stdout: "bailed\n", stderr: "" };
      },
    };
    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    await dispatcher.tick();

    const flumeDir = join(fx.repo, ".flume");
    const derived = priorAttemptPath(flumeDir, phaseRef("plan"));
    expect(existsSync(derived)).toBe(true);
    expect(derived).toBe(join(flumeDir, "prior-attempts", "phase", "plan.json"));
  });

  /**
   * None of the five modes below land anything on trunk (afterCommit
   * gate-revert and tip-moved both revert/discard on the private worktree
   * branch; clean-exit/platform-preempt/render-refused never commit at
   * all) — so `headSha` on every one of them is the pre-tick trunk tip.
   */
  it("gate-revert record carries headSha (pre-tick trunk tip) and a self-consistent ISO at", async () => {
    const preHead = await head(fx.repo);
    new Baton(join(fx.repo, ".flume")).wake("plan");
    const failing: Gate = {
      name: "revert-gate",
      when: "afterCommit",
      async run() {
        return { ok: false, message: "no" };
      },
    };
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [failing],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/o.ts", "x\n", "plan: attempt");
    });
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    await dispatcher.tick();

    const record = JSON.parse(
      await readFile(
        priorAttemptPath(join(fx.repo, ".flume"), phaseRef("plan")),
        "utf8",
      ),
    );
    expect(record.mode).toBe("gate-revert");
    expect(record.headSha).toBe(preHead);
    expect(new Date(record.at).toISOString()).toBe(record.at);
  });

  it("clean-exit record carries headSha (pre-tick trunk tip) and a self-consistent ISO at", async () => {
    const preHead = await head(fx.repo);
    new Baton(join(fx.repo, ".flume")).wake("plan");
    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const agent: Agent = {
      name: "bailing-singleton",
      async invoke() {
        return { exitCode: 0, stdout: "BAILED: no.\n", stderr: "" };
      },
    };
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    await dispatcher.tick();

    const record = JSON.parse(
      await readFile(
        priorAttemptPath(join(fx.repo, ".flume"), phaseRef("plan")),
        "utf8",
      ),
    );
    expect(record.mode).toBe("clean-exit");
    expect(record.headSha).toBe(preHead);
    expect(new Date(record.at).toISOString()).toBe(record.at);
  });

  it("platform-preempt record carries headSha (pre-tick trunk tip) and a self-consistent ISO at", async () => {
    const preHead = await head(fx.repo);
    new Baton(join(fx.repo, ".flume")).wake("plan");
    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const agent: Agent = {
      name: "preempted-singleton",
      async invoke() {
        return { exitCode: 137, stdout: "", stderr: "Killed" };
      },
    };
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    await dispatcher.tick();

    const record = JSON.parse(
      await readFile(
        priorAttemptPath(join(fx.repo, ".flume"), phaseRef("plan")),
        "utf8",
      ),
    );
    expect(record.mode).toBe("platform-preempt");
    expect(record.headSha).toBe(preHead);
    expect(new Date(record.at).toISOString()).toBe(record.at);
  });

  it("render-refused record carries headSha (pre-tick trunk tip) and a self-consistent ISO at", async () => {
    const preHead = await head(fx.repo);
    new Baton(join(fx.repo, ".flume")).wake("plan");
    await writeFile(
      join(fx.configDir, "prompt.md"),
      "digest: !`echo boom-detail 1>&2; exit 3`\n",
      "utf8",
    );
    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const agent: Agent = {
      name: "never-invoked",
      async invoke() {
        throw new Error("must not be invoked — render refused first");
      },
    };
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    await dispatcher.tick();

    const record = JSON.parse(
      await readFile(
        priorAttemptPath(join(fx.repo, ".flume"), phaseRef("plan")),
        "utf8",
      ),
    );
    expect(record.mode).toBe("render-refused");
    expect(record.headSha).toBe(preHead);
    expect(new Date(record.at).toISOString()).toBe(record.at);
  });

  it("tip-moved record carries headSha (pre-tick trunk tip) and a self-consistent ISO at", async () => {
    const preHead = await head(fx.repo);
    new Baton(join(fx.repo, ".flume")).wake("plan");
    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const agent: Agent = {
      name: "rewriting-singleton",
      async invoke(inv) {
        // Rewrite the worktree branch out from under itself — the only way
        // this leg refuses (spec/worktrees.md "Singleton runs in a
        // worktree").
        await exec("git", ["checkout", "--orphan", "rewritten"], {
          cwd: inv.cwd,
        });
        await exec("git", ["reset", "--hard"], { cwd: inv.cwd });
        await writeAndCommit(inv.cwd, "src/o.ts", "x\n", "plan: attempt");
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();
    expect(outcome.tipMoved).toBe(true);

    const record = JSON.parse(
      await readFile(
        priorAttemptPath(join(fx.repo, ".flume"), phaseRef("plan")),
        "utf8",
      ),
    );
    expect(record.mode).toBe("tip-moved");
    expect(record.headSha).toBe(preHead);
    expect(new Date(record.at).toISOString()).toBe(record.at);
  });
});

describe("PriorAttempt keyspace + the wave's stale-record clear (spec/loop.md 'No false signal')", () => {
  const revertGate: Gate = {
    name: "revert-gate",
    when: "afterCommit",
    async run() {
      return { ok: false, message: "no" };
    },
  };

  const buildDispatcher = (agent: Agent, gates: Gate[] = []): Dispatcher =>
    new Dispatcher({
      chainLoader: staticLoader({
        phases: [makePhase({ name: "build", concurrency: "fanout", gates })],
        humanOnly: [],
      }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

  /** Commits each named entry's own declared file, so the wave reaches its gates. */
  const committingAgent = (slugs: string[]): Agent =>
    fanoutAgent(
      Object.fromEntries(
        slugs.map((slug) => [
          slug,
          async (cwd: string) => {
            await writeAndCommit(cwd, `src/${slug}.ts`, "x\n", `build: ${slug}`);
          },
        ]),
      ),
    );

  /** Exits clean without committing — a clean-exit, so nothing ships. */
  const bailingAgent = (slugs: string[]): Agent =>
    fanoutAgent(Object.fromEntries(slugs.map((slug) => [slug, async () => {}])));

  const entryFor = (slug: string): PendingEntry =>
    makeEntry(slug.toUpperCase(), [`src/${slug}.ts`]);

  /**
   * Run one wave over `slugs` under a gate that reverts every commit, so the
   * real writer leaves a gate-revert record under each entry's key. Returns
   * once those records are on disk.
   */
  const waveLeavingRecords = async (slugs: string[]): Promise<void> => {
    await writePending(fx.repo, slugs.map(entryFor));
    new Baton(join(fx.repo, ".flume")).wake("build");
    await buildDispatcher(committingAgent(slugs), [revertGate]).tick();
    for (const slug of slugs) {
      expect(
        existsSync(priorAttemptPath(join(fx.repo, ".flume"), entryRef(slug))),
      ).toBe(true);
    }
  };

  it("a prior-attempt record names the keyspace its key belongs to", async () => {
    const flumeDir = join(fx.repo, ".flume");

    // Fanout: the record is filed under the entry's tag slug.
    await waveLeavingRecords(["keyed-entry"]);
    const entryRecord = JSON.parse(
      await readFile(priorAttemptPath(flumeDir, entryRef("KEYED-ENTRY")), "utf8"),
    ) as Record<string, unknown>;
    expect(entryRecord.mode).toBe("gate-revert");
    expect(entryRecord.key).toBe("entry");

    // Singleton: the record is filed under the phase name. Same writer, and
    // the key's own text is the only thing that differs on disk — which is
    // exactly why the keyspace has to be stated rather than read off it.
    new Baton(flumeDir).wake("plan");
    await new Dispatcher({
      chainLoader: staticLoader({
        phases: [makePhase({ name: "plan", concurrency: "singleton" })],
        humanOnly: [],
      }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: {
        name: "bailing-singleton",
        async invoke() {
          return { exitCode: 0, stdout: "bailed\n", stderr: "" };
        },
      },
      log: silent,
    }).tick();
    const phaseRecord = JSON.parse(
      await readFile(priorAttemptPath(flumeDir, phaseRef("plan")), "utf8"),
    ) as Record<string, unknown>;
    expect(phaseRecord.mode).toBe("clean-exit");
    expect(phaseRecord.key).toBe("phase");
  });

  it("a wave clears a prior-attempt record whose entry tag the queue no longer carries", async () => {
    const flumeDir = join(fx.repo, ".flume");
    await waveLeavingRecords(["stale-one", "live-one"]);

    // STALE-ONE leaves the queue without ever shipping — a plan tick
    // retiring it, a human editing the ledger. Its record can never be read
    // on its own terms again.
    await writePending(fx.repo, [entryFor("live-one")]);
    new Baton(flumeDir).wake("build");
    await buildDispatcher(bailingAgent(["live-one"])).tick();

    expect(existsSync(priorAttemptPath(flumeDir, entryRef("STALE-ONE")))).toBe(false);
    // The entry still queued keeps its record — the clear is keyed on the
    // queue, not on age.
    expect(existsSync(priorAttemptPath(flumeDir, entryRef("LIVE-ONE")))).toBe(true);
  });

  it("a wave leaves a phase-keyed prior-attempt record standing", async () => {
    const flumeDir = join(fx.repo, ".flume");
    await waveLeavingRecords(["retired-one", "live-one"]);

    // A singleton phase's own record, filed under a phase name the queue
    // never carries — indistinguishable from a retired tag by key text.
    new Baton(flumeDir).wake("plan");
    await new Dispatcher({
      chainLoader: staticLoader({
        phases: [makePhase({ name: "plan", concurrency: "singleton" })],
        humanOnly: [],
      }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: {
        name: "bailing-singleton",
        async invoke() {
          return { exitCode: 0, stdout: "bailed\n", stderr: "" };
        },
      },
      log: silent,
    }).tick();
    expect(existsSync(priorAttemptPath(flumeDir, phaseRef("plan")))).toBe(true);

    await writePending(fx.repo, [entryFor("live-one")]);
    new Baton(flumeDir).wake("build");
    await buildDispatcher(bailingAgent(["live-one"])).tick();

    // The sweep ran on this wave — the retired tag's record is gone …
    expect(existsSync(priorAttemptPath(flumeDir, entryRef("RETIRED-ONE")))).toBe(false);
    // … and the phase's record survived it intact.
    expect(existsSync(priorAttemptPath(flumeDir, phaseRef("plan")))).toBe(true);
    const phaseRecord = JSON.parse(
      await readFile(priorAttemptPath(flumeDir, phaseRef("plan")), "utf8"),
    ) as Record<string, unknown>;
    expect(phaseRecord.key).toBe("phase");
    expect(phaseRecord.mode).toBe("clean-exit");
  });

  it("the tick verdict reports the prior-attempt keys the wave cleared", async () => {
    const flumeDir = join(fx.repo, ".flume");
    await writePending(fx.repo, [
      entryFor("stale-a"),
      entryFor("stale-b"),
      entryFor("live-one"),
    ]);
    new Baton(flumeDir).wake("build");
    const first = await buildDispatcher(
      committingAgent(["stale-a", "stale-b", "live-one"]),
      [revertGate],
    ).tick();
    // Nothing had left the queue yet, so the field is absent rather than
    // an empty list — a wave that cleared nothing claims nothing.
    expect(first.verdict?.clearedPriorAttempts).toBeUndefined();

    await writePending(fx.repo, [entryFor("live-one")]);
    new Baton(flumeDir).wake("build");
    const second = await buildDispatcher(bailingAgent(["live-one"])).tick();

    // Named by the same key `TickContext.priorAttempts` files them under,
    // keyspace included — one vocabulary for the record across both surfaces.
    expect(second.verdict?.clearedPriorAttempts).toEqual([
      `entry:${slugify("STALE-A")}`,
      `entry:${slugify("STALE-B")}`,
    ]);
    expect(existsSync(priorAttemptPath(flumeDir, entryRef("LIVE-ONE")))).toBe(true);
  });
});

describe("TickContext.pickable / priorAttempts — dispatcher-computed facts a hook reads instead of re-deriving (spec/chain.md 'What a hook receives')", () => {
  it("singleton shouldRun's TickContext.pickable agrees with the next fanout tick's own selection", async () => {
    const entries: PendingEntry[] = [
      makeEntry("OPEN-A", ["src/a.ts"]),
      makeEntry("OPEN-B", ["src/b.ts"]),
      {
        ...makeEntry("BLOCKED", ["src/c.ts"]),
        gate: { kind: "blockedBy", tags: ["OPEN-A"] },
      },
      {
        ...makeEntry("PARKED", ["src/d.ts"]),
        gate: { kind: "parked", reason: "human needed" },
      },
    ];
    await writePending(fx.repo, entries);

    let capturedPickable: readonly PendingEntry[] | undefined;
    const planPhase = makePhase({
      name: "plan",
      concurrency: "singleton",
      // Declines every time — this test only wants the selection the
      // dispatcher handed the hook, not a committed tick.
      shouldRun: (ctx) => {
        capturedPickable = ctx.pickable;
        return false;
      },
    });
    const buildPhase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = { phases: [planPhase, buildPhase], humanOnly: [] };

    new Baton(join(fx.repo, ".flume")).wake("plan");
    const planDispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async () => {}),
      log: silent,
    });
    await planDispatcher.tick();

    expect(capturedPickable).toBeDefined();
    expect(capturedPickable!.map((e) => e.tag).sort()).toEqual([
      "OPEN-A",
      "OPEN-B",
    ]);

    new Baton(join(fx.repo, ".flume")).wake("build");
    const buildAgent = fanoutAgent({
      "open-a": (cwd) =>
        writeAndCommit(cwd, "src/a.ts", "a\n", "build(OPEN-A): ship"),
      "open-b": (cwd) =>
        writeAndCommit(cwd, "src/b.ts", "b\n", "build(OPEN-B): ship"),
    });
    const buildDispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: buildAgent,
      log: silent,
    });
    const outcome = await buildDispatcher.tick();

    // The next fanout tick's own selection ships exactly the tags the
    // singleton hook's ctx.pickable named — the two reads cannot disagree
    // because both are the same `isPickable` computation over the same
    // on-disk pending.json.
    expect([...(outcome.result?.shippedTags ?? [])].sort()).toEqual(
      capturedPickable!.map((e) => e.tag).sort(),
    );
  });

  it("TickContext.priorAttempts is keyed by keyspace and identity as the on-disk layout is, and a corrupt record reads as absent", async () => {
    const entries: PendingEntry[] = [makeEntry("SHIPS", ["src/ships.ts"])];
    await writePending(fx.repo, entries);

    const flumeDir = join(fx.repo, ".flume");
    await mkdir(join(flumeDir, "prior-attempts", "entry"), { recursive: true });
    const validRecord: PriorAttempt = {
      mode: "clean-exit",
      finalMessage: "off-writablePaths edit",
      key: "entry",
      keyedAs: slugify("SHIPS"),
      declaredAs: entryDeclaredKey(entries[0]!),
      headSha: "0".repeat(40),
      at: "2024-01-01T00:00:00.000Z",
    };
    // Written where the dispatcher itself would put it: under the entry
    // keyspace's own directory, at the slug it derives from the tag — not
    // the raw tag, and not the flat dir the two keyspaces used to share.
    await writeFile(
      join(flumeDir, "prior-attempts", "entry", `${slugify("SHIPS")}.json`),
      JSON.stringify(validRecord),
    );
    // Malformed JSON — PriorAttemptStore.read's own tolerance ("a garbled
    // record must not crash the tick") should drop this key, not surface it or
    // throw.
    await writeFile(
      join(flumeDir, "prior-attempts", "entry", "corrupt.json"),
      "{ not valid json",
    );

    let captured: ReadonlyMap<string, PriorAttempt> | undefined;
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      shouldRun: (ctx) => {
        captured = ctx.priorAttempts;
        return false;
      },
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    new Baton(flumeDir).wake("build");
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({}),
      log: silent,
    });
    await dispatcher.tick();

    expect(captured).toBeDefined();
    expect(captured!.get(`entry:${slugify("SHIPS")}`)).toEqual(validRecord);
    // The identity alone is not a key: the keyspace rides it.
    expect(captured!.has(slugify("SHIPS"))).toBe(false);
    expect(captured!.has("entry:corrupt")).toBe(false);
    expect(captured!.size).toBe(1);
  });

  /**
   * Drop `records` (raw JSON, whatever shape) under the phase keyspace's own
   * directory and return the `TickContext.priorAttempts` map a phase hook is
   * handed for them — the only surface a chain reads a record through. Phase-
   * keyed throughout: these stems name no queue entry, and the wave's stale
   * sweep retires entry-keyed records whose tag the queue no longer carries.
   */
  const priorAttemptsSeenBy = async (
    records: Record<string, unknown>,
  ): Promise<ReadonlyMap<string, PriorAttempt>> => {
    await writePending(fx.repo, [makeEntry("SHIPS", ["src/ships.ts"])]);
    const flumeDir = join(fx.repo, ".flume");
    await mkdir(join(flumeDir, "prior-attempts", "phase"), { recursive: true });
    for (const [key, rec] of Object.entries(records)) {
      await writeFile(
        join(flumeDir, "prior-attempts", "phase", `${key}.json`),
        JSON.stringify(rec),
      );
    }

    let captured: ReadonlyMap<string, PriorAttempt> | undefined;
    const chain: Chain = {
      phases: [
        makePhase({
          name: "build",
          concurrency: "fanout",
          shouldRun: (ctx) => {
            captured = ctx.priorAttempts;
            return false;
          },
        }),
      ],
      humanOnly: [],
    };
    new Baton(flumeDir).wake("build");
    await new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({}),
      log: silent,
    }).tick();
    expect(captured).toBeDefined();
    return captured!;
  };

  it("a record carrying a recognized `mode` but no `headSha` is absent from `TickContext.priorAttempts`, the degrade an unrecognized `mode` already earns", async () => {
    const captured = await priorAttemptsSeenBy({
      "un-anchored": { mode: "clean-exit", finalMessage: "no anchor", key: "phase", keyedAs: "un-anchored", at: "2024-01-01T00:00:00.000Z" },
      "bad-mode": { mode: "who-knows", headSha: "0".repeat(40), key: "phase", keyedAs: "bad-mode", at: "2024-01-01T00:00:00.000Z" },
    });

    // The un-anchored record is refused exactly as the unrecognized-mode one
    // is: a chain reading `headSha` off a `priorAttempts` value never gets
    // `undefined` through a field the type declares required.
    expect(captured.has("phase:un-anchored")).toBe(false);
    expect(captured.has("phase:bad-mode")).toBe(false);
    expect(captured.size).toBe(0);
  });

  it("a record missing only `at` is refused too — the anchor is both fields", async () => {
    const captured = await priorAttemptsSeenBy({
      "no-at": { mode: "tip-moved", expectedTip: "a".repeat(40), observedTip: "b".repeat(40), key: "phase", keyedAs: "no-at", headSha: "0".repeat(40) },
    });

    expect(captured.has("phase:no-at")).toBe(false);
    expect(captured.size).toBe(0);
  });

  it("an anchored record of each union variant still reads back, so the refusal is not swallowing the map", async () => {
    // `key: "phase"` on every arm, matching the directory the helper writes
    // them to: these stems name no queue entry, and the wave's stale sweep
    // retires entry-keyed records whose tag the queue no longer carries — a
    // keyspace this test is not about would delete its own subject before the
    // hook ever sees it.
    const anchor = {
      key: "phase",
      headSha: "0".repeat(40),
      at: "2024-01-01T00:00:00.000Z",
    } as const;
    // One record per arm of the union, so a refusal that over-fired on any
    // single variant's own fields shows up as a missing key rather than
    // hiding behind a sibling that happened to survive. Each `keyedAs` is
    // the record's own stem, which the keyspace then prefixes into the map
    // key a hook looks it up by.
    const anchored: Record<string, PriorAttempt> = {
      "gate-revert": { mode: "gate-revert", when: "afterCommit", gate: "tsc", message: "failed", diffStat: " src/a.ts | 1 +", keyedAs: "gate-revert", ...anchor },
      "clean-exit": { mode: "clean-exit", finalMessage: "off-writablePaths edit", keyedAs: "clean-exit", ...anchor },
      "platform-preempt": { mode: "platform-preempt", failureClass: "rate-limit", keyedAs: "platform-preempt", ...anchor },
      "render-refused": { mode: "render-refused", failures: "! `git log`: exit 128", keyedAs: "render-refused", ...anchor },
      "tip-moved": { mode: "tip-moved", expectedTip: "a".repeat(40), observedTip: "b".repeat(40), keyedAs: "tip-moved", ...anchor },
      "not-shipped": { mode: "not-shipped", mergedSha: "c".repeat(40), touchedPaths: ["src/a.ts"], keyedAs: "not-shipped", ...anchor },
    };

    const captured = await priorAttemptsSeenBy(anchored);

    expect(Object.keys(anchored).length).toBe(6);
    for (const [key, rec] of Object.entries(anchored)) {
      expect(captured.get(`phase:${key}`)).toEqual(rec);
    }
    expect(captured.size).toBe(6);
  });

});

describe("TickResult.pickableAfter / entries — dispatcher-computed facts a handoff reads instead of re-deriving (spec/chain.md 'What a hook receives')", () => {
  it("pickableAfter is pendingAfter filtered by the same verdict as TickContext.pickable, taken post-tick", async () => {
    await writePending(fx.repo, [
      makeEntry("OPEN-A", ["src/a.ts"]),
      {
        ...makeEntry("BLOCKED-B", ["src/b.ts"]),
        gate: { kind: "blockedBy", tags: ["OPEN-A"] },
      },
    ]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({
        "open-a": (cwd) =>
          writeAndCommit(cwd, "src/a.ts", "a\n", "build(OPEN-A): ship"),
      }),
      log: silent,
    });
    const outcome = await dispatcher.tick();

    // OPEN-A shipped and left pendingAfter; BLOCKED-B's dependency is gone,
    // so it is pickable in the exact post-tick state pickableAfter reads.
    expect(outcome.result?.pendingAfter.map((e) => e.tag)).toEqual([
      "BLOCKED-B",
    ]);
    expect(outcome.result?.pickableAfter.map((e) => e.tag)).toEqual([
      "BLOCKED-B",
    ]);
    expect(outcome.result?.flumeDir).toBe(join(fx.repo, ".flume"));
    expect(outcome.result?.configDir).toBe(fx.configDir);

    // Proven against a fresh tick's own pre-tick `ctx.pickable` over the same
    // on-disk pending.json, never a second `isPickable` call inlined here —
    // the same agreement shape as the singleton/fanout pair above.
    let capturedPickable: readonly PendingEntry[] | undefined;
    new Baton(join(fx.repo, ".flume")).wake("build");
    const nextPhase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      shouldRun: (ctx) => {
        capturedPickable = ctx.pickable;
        return false;
      },
    });
    const nextChain: Chain = { phases: [nextPhase], humanOnly: [] };
    const nextDispatcher = new Dispatcher({
      chainLoader: staticLoader(nextChain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({}),
      log: silent,
    });
    await nextDispatcher.tick();

    expect(capturedPickable).toBeDefined();
    expect(capturedPickable!.map((e) => e.tag)).toEqual(
      outcome.result?.pickableAfter.map((e) => e.tag),
    );
  });

  it("a fanout wave with a shipped entry and a clean-exit sibling reports that sibling's mode in entries[] while shippedTags/noCommit stay the existing wave-summary shape", async () => {
    await writePending(fx.repo, [
      makeEntry("SHIPS", ["src/a.ts"]),
      makeEntry("BAILS", ["src/b.ts"]),
    ]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({
        ships: (cwd) =>
          writeAndCommit(cwd, "src/a.ts", "a\n", "build(SHIPS): ship"),
        // Clean exit, no commit — the clean-exit leg.
        bails: async () => {},
      }),
      log: silent,
      maxParallel: 4,
    });
    const outcome = await dispatcher.tick();

    // The existing wave-summary shape is unchanged: a sibling shipped, so the
    // wave-level noCommit reads absent even though BAILS exited clean.
    expect(outcome.result?.shippedTags).toEqual(["SHIPS"]);
    expect(outcome.result?.committed).toBe(true);
    expect(outcome.result?.noCommit).toBeUndefined();
    expect(outcome.noCommit).toBeUndefined();

    const entries = outcome.result?.entries;
    expect(entries).toBeDefined();
    // Non-vacuity: both entries this wave provisioned are actually present,
    // not just the shipped one.
    expect(entries!.map((e) => e.tag).sort()).toEqual(["BAILS", "SHIPS"]);
    const byTag = new Map(entries!.map((e) => [e.tag, e]));
    expect(byTag.get("SHIPS")).toEqual({
      tag: "SHIPS",
      extension: {},
      committed: true,
      shipped: true,
      reverted: false,
      mergeOutcome: "merged",
    });
    // A clean exit never reached a merge stage and captured no footprint, so
    // it carries no merge outcome at all — absence is "nothing to merge".
    expect(byTag.get("BAILS")).toEqual({
      tag: "BAILS",
      extension: {},
      committed: false,
      shipped: false,
      reverted: false,
      noCommit: "clean-exit",
    });
  });

  // The two fates below are byte-identical in `committed`/`shipped`/
  // `reverted` — `{ committed: true, shipped: false, reverted: false }` in
  // both — which is exactly why a `handoff` routing a park had to read the
  // verdict log to avoid waking plan on a conflict. Each test pins that
  // collapse alongside the outcome that resolves it.
  const COLLAPSED = {
    extension: {},
    committed: true,
    shipped: false,
    reverted: false,
  };

  it("TickResult.entries reports the merge outcome of an entry whose cherry-pick conflicted", async () => {
    // Same conflict vector as the cherry-pick-conflict suite above: disjoint
    // declared files, a shared entryChannelPaths file both agents rewrite,
    // so the second pick lands on trunk content its diff does not expect.
    await mkdir(join(fx.repo, "src"), { recursive: true });
    await writeFile(join(fx.repo, "src", "shared.ts"), "baseline\n");
    await exec("git", ["add", "--", "src/shared.ts"], { cwd: fx.repo });
    await exec("git", ["commit", "-q", "-m", "seed shared"], { cwd: fx.repo });

    await writePending(fx.repo, [
      makeEntry("PICKS-CLEAN", ["src/decoy-a.ts"]),
      makeEntry("PICKS-DIRTY", ["src/decoy-b.ts"]),
    ]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      entryChannelPaths: ["src/shared.ts"],
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const collide = (decoy: string, mine: string) => async (cwd: string) => {
      await mkdir(join(cwd, "src"), { recursive: true });
      await writeFile(join(cwd, "src", decoy), `${mine}\n`);
      await writeFile(join(cwd, "src", "shared.ts"), `from-${mine}\n`);
      await exec("git", ["add", "."], { cwd });
      await exec("git", ["commit", "-q", "-m", `build: ${mine}`], { cwd });
    };

    const outcome = await new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({
        "picks-clean": collide("decoy-a.ts", "A"),
        "picks-dirty": collide("decoy-b.ts", "B"),
      }),
      log: silent,
      maxParallel: 4,
    }).tick();

    // Non-vacuity: the conflict leg really ran — one entry landed, the other
    // stayed queued because its pick aborted.
    expect(outcome.result?.shippedTags).toEqual(["PICKS-CLEAN"]);
    expect(outcome.result?.pendingAfter.map((e) => e.tag)).toEqual([
      "PICKS-DIRTY",
    ]);

    const entries = outcome.result?.entries;
    expect(entries).toBeDefined();
    expect(entries!.map((e) => e.tag).sort()).toEqual([
      "PICKS-CLEAN",
      "PICKS-DIRTY",
    ]);
    const dirty = entries!.find((e) => e.tag === "PICKS-DIRTY");
    expect(dirty).toEqual({
      tag: "PICKS-DIRTY",
      ...COLLAPSED,
      mergeOutcome: "cherry-pick-conflict",
    });
    // Reported, not re-derived: the same record the verdict persists.
    expect(
      outcome.verdict?.mergeOutcomes.find((m) => m.entryTag === "PICKS-DIRTY")
        ?.outcome,
    ).toBe("cherry-pick-conflict");
  });

  it("TickResult.entries reports the merge outcome of an entry the chain declined to ship", async () => {
    await writePending(fx.repo, [makeEntry("PARKED", ["src/parked.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      gates: [],
      shipped: () => false,
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const outcome = await new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({
        parked: (cwd) =>
          writeAndCommit(
            cwd,
            "src/parked.ts",
            "landed\n",
            "build(PARKED): land it",
          ),
      }),
      log: silent,
    }).tick();

    // Non-vacuity: the commit reached trunk and the chain's predicate is what
    // kept it queued — not a bail that never committed.
    expect(outcome.result?.shippedTags).toEqual([]);
    expect(outcome.result?.pendingAfter.map((e) => e.tag)).toEqual(["PARKED"]);

    const entries = outcome.result?.entries;
    expect(entries).toEqual([
      { tag: "PARKED", ...COLLAPSED, mergeOutcome: "not-shipped" },
    ]);
    expect(
      outcome.verdict?.mergeOutcomes.find((m) => m.entryTag === "PARKED")?.outcome,
    ).toBe("not-shipped");
  });

  it("a fanout wave reports the shipped entry's payload beside its tag", async () => {
    // A shipped entry leaves the queue, so `pendingAfter`/`pickableAfter` no
    // longer carry what it declared. Without the payload on its own record, a
    // `handoff` routing on a chain-declared field has nowhere to read it but
    // `pending.json` at `baseSha`, re-parsed with the chain's own extension.
    const shipsPer = { path: "spec/loop.md", section: "Graceful stop" };
    const bailsPer = { path: "spec/chain.md", section: "What a hook receives" };
    await writePending(fx.repo, [
      { ...makeEntry("SHIPS-RICH", ["src/a.ts"]), per: shipsPer, risk: "high" },
      { ...makeEntry("BAILS-RICH", ["src/b.ts"]), per: bailsPer, risk: "low" },
    ]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      gates: [],
    });
    const chain: Chain = {
      phases: [phase],
      humanOnly: [],
      entryExtension: {
        per: {
          schema: z.strictObject({
            path: z.string().min(1),
            section: z.string().min(1),
          }),
          hint: `{ "path": "...", "section": "..." }`,
        },
        risk: { schema: z.string().min(1), hint: `"high|low"` },
      },
    };

    const outcome = await new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({
        "ships-rich": (cwd) =>
          writeAndCommit(cwd, "src/a.ts", "a\n", "build(SHIPS-RICH): ship"),
        // Clean exit: the sibling's payload rides its record too, so the
        // claim is not "the shipped one happens to be the only record".
        "bails-rich": async () => {},
      }),
      log: silent,
      maxParallel: 4,
    }).tick();

    // Non-vacuity, twice over: the entry really shipped, and having shipped it
    // is gone from every other surface this result carries.
    expect(outcome.result?.shippedTags).toEqual(["SHIPS-RICH"]);
    expect(
      outcome.result?.pendingAfter.find((e) => e.tag === "SHIPS-RICH"),
    ).toBeUndefined();

    const byTag = new Map(
      (outcome.result?.entries ?? []).map((e) => [e.tag, e]),
    );
    expect([...byTag.keys()].sort()).toEqual(["BAILS-RICH", "SHIPS-RICH"]);

    const ships = byTag.get("SHIPS-RICH")!;
    expect(ships.shipped).toBe(true);
    // The payload, beside the tag: the chain-declared fields as parsed —
    // `per` as the object the chain's schema accepted, not its source text.
    expect(ships.extension).toEqual({ per: shipsPer, risk: "high" });
    // Chain-declared fields only. A core field leaking in would make a
    // consumer's `Object.keys(extension)` a different set than the one it
    // declared.
    expect(Object.keys(ships.extension).sort()).toEqual(["per", "risk"]);

    // The sibling that never committed carries its own payload, not the
    // shipped one's.
    expect(byTag.get("BAILS-RICH")!.extension).toEqual({
      per: bailsPer,
      risk: "low",
    });
  });
});

// ---------- plan-tick prose durability ----------

// Plan is a singleton phase. When its pending.json fails the chain-local
// pendingParseGate, the whole commit is `git reset --hard`-ed away — the
// plan prose in that same commit dies with it, recoverable, before the
// durable snapshot, only by a human reading session logs. The contract mandates the findings stay recoverable without session
// logs. This asserts the chosen mechanism: a verbatim, durable,
// reset-surviving on-disk snapshot.

describe("Dispatcher — plan-tick prose durability", () => {
  it("gate-reverted plan tick: the reverted commit's prose is recoverable on disk w/o session logs; cleared on a later clean ship", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");

    // Stands in for the chain-local pendingParseGate: an afterCommit gate
    // that vetoes a schema-invalid pending.json on the first attempt only.
    // The durability property is gate-agnostic — the dispatcher snapshots
    // whatever the reverted commit touched, with no "which file is prose"
    // knowledge.
    let calls = 0;
    const pendingParses: Gate = {
      name: "pending.json parses",
      when: "afterCommit",
      async run() {
        calls++;
        return calls === 1
          ? {
              ok: false,
              message: "pending.json has 1 schema violation",
              details: "[0] gate.kind: invalid discriminant",
            }
          : { ok: true, message: "pending.json parsed (0 entries)" };
      },
    };
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [pendingParses],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const FINDING_OQ =
      "OPEN QUESTION: CLI-SEARCH-WALK — should `flume render` walk skill " +
      "paths? Needs a human call before plan can derive an entry.";
    const FINDING_STATE =
      "Plan continues: yes\nAudited bd5e6f4; filed the skill-path finding.";

    let attempt = 0;
    const agent: Agent = {
      name: "plan-prose-singleton",
      async invoke(inv) {
        const n = attempt++;
        const oq = join(inv.cwd, ".flume", "plan", "open-questions.md");
        const st = join(inv.cwd, ".flume", "plan", "state.md");
        const pj = join(inv.cwd, ".flume", "plan", "pending.json");
        await mkdir(dirname(oq), { recursive: true });
        await writeFile(oq, `# Open Questions\n\n${FINDING_OQ}\n`);
        await writeFile(st, `${FINDING_STATE}\n`);
        // Attempt 0's pending.json is schema-invalid (gate vetoes it);
        // attempt 1's is clean. Commit scoped to .flume/plan, exactly as
        // plan does — the harness writes the snapshot to gitignored
        // .flume/prior-attempts/, never into the agent's commit.
        await writeFile(pj, n === 0 ? "[ broken json " : "[]\n");
        await exec("git", ["add", "--", ".flume/plan"], { cwd: inv.cwd });
        await exec("git", ["commit", "-q", "-m", `plan: attempt ${n}`], {
          cwd: inv.cwd,
        });
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const preHead = await head(fx.repo);
    const first = await dispatcher.tick(); // attempt 0 → committed, reverted

    // The broken pending.json never ships: commit reverted to preHead.
    expect(first.result?.committed).toBe(false);
    expect(first.noCommit).toBe("gate-revert");
    expect(await head(fx.repo)).toBe(preHead);
    // The prose is GONE from the worktree (git reset --hard) — proving the
    // loss the snapshot closes is real, and recovery cannot come from the
    // worktree.
    expect(
      existsSync(join(fx.repo, ".flume", "plan", "open-questions.md")),
    ).toBe(false);

    // Durability acceptance: findings recoverable WITHOUT session logs —
    // verbatim on disk in the durable, reset-surviving snapshot mirror.
    const snapDir = join(fx.repo, ".flume", "prior-attempts", "phase", "plan.reverted");
    const recoveredOQ = await readFile(
      join(snapDir, ".flume", "plan", "open-questions.md"),
      "utf8",
    );
    const recoveredState = await readFile(
      join(snapDir, ".flume", "plan", "state.md"),
      "utf8",
    );
    expect(recoveredOQ).toContain(FINDING_OQ);
    expect(recoveredState).toContain(FINDING_STATE);

    // A later clean ship clears the recovery artifact — no stale prose
    // outliving the entry it belonged to (mirrors the prior-attempt slot
    // invariant).
    baton.wake("plan");
    const second = await dispatcher.tick(); // attempt 1 → ships clean
    expect(second.result?.committed).toBe(true);
    expect(existsSync(snapDir)).toBe(false);
  });
});

describe("Dispatcher fanout — render-refused: an unresolved inline-exec span aborts one entry's render", () => {
  it("no agent invocation for the affected entry; the wave's TickOutcome.noCommit is 'render-refused', the entry stays pending", async () => {
    await writePending(fx.repo, [makeEntry("RENDER-BOOM", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    await writeFile(join(fx.configDir, "prompt.md"), "digest: !`exit 3`\n", "utf8");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    let invoked = false;
    const agent = fanoutAgent({
      "render-boom": async () => {
        invoked = true;
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(invoked).toBe(false);
    expect(outcome.result?.committed).toBe(false);
    expect(outcome.noCommit).toBe("render-refused");
    expect(outcome.noCommit).not.toBe("clean-exit");
    expect(outcome.verdict?.noCommit).toBe("render-refused");
    expect(outcome.verdict?.gateResults).toEqual([]);
    // Never reached cherry-pick/merge — the entry stays pending for a retry
    // once the span is fixed.
    expect(readPendingFromDisk(fx.repo)).toHaveLength(1);
  });
});

describe("Dispatcher render-refused — singleton/fanout agreement (DISPATCHER-RENDER-REFUSED-CATCH-UNSHARED)", () => {
  it("both callsites persist byte-identical prior-attempt record content and emit a same-shaped log line for equivalent input, driven through the one shared persist+log method", async () => {
    await writeFile(
      join(fx.configDir, "prompt.md"),
      "digest: !`echo boom-detail 1>&2; exit 3`\n",
      "utf8",
    );

    // ---- singleton ----
    new Baton(join(fx.repo, ".flume")).wake("plan");
    const singletonPhase = makePhase({ name: "plan", concurrency: "singleton" });
    const singletonChain: Chain = { phases: [singletonPhase], humanOnly: [] };
    let singletonInvoked = false;
    const singletonAgent: Agent = {
      name: "must-not-run-singleton",
      async invoke() {
        singletonInvoked = true;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };
    const singletonWarnings: string[] = [];
    const singletonLog: Logger = {
      info: () => {},
      warn: (l) => singletonWarnings.push(l),
      error: () => {},
    };
    const singletonDispatcher = new Dispatcher({
      chainLoader: staticLoader(singletonChain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singletonAgent,
      log: singletonLog,
    });
    const singletonOutcome = await singletonDispatcher.tick();

    expect(singletonInvoked).toBe(false);
    expect(singletonOutcome.noCommit).toBe("render-refused");
    const singletonRecord = await readFile(
      join(fx.repo, ".flume", "prior-attempts", "phase", "plan.json"),
      "utf8",
    );

    // ---- fanout — same repo, own tag so its prior-attempt slot never shares
    // a path with the singleton's above.
    await writePending(fx.repo, [makeEntry("FANOUT-TWIN", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");
    const fanoutPhase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
    });
    const fanoutChain: Chain = { phases: [fanoutPhase], humanOnly: [] };
    let fanoutInvoked = false;
    const fanoutAgentInst = fanoutAgent({
      "fanout-twin": async () => {
        fanoutInvoked = true;
      },
    });
    const fanoutWarnings: string[] = [];
    const fanoutLog: Logger = {
      info: () => {},
      warn: (l) => fanoutWarnings.push(l),
      error: () => {},
    };
    const fanoutDispatcher = new Dispatcher({
      chainLoader: staticLoader(fanoutChain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgentInst,
      log: fanoutLog,
    });
    const fanoutOutcome = await fanoutDispatcher.tick();

    expect(fanoutInvoked).toBe(false);
    expect(fanoutOutcome.noCommit).toBe("render-refused");
    const fanoutRecord = await readFile(
      join(fx.repo, ".flume", "prior-attempts", "entry", "fanout-twin.json"),
      "utf8",
    );

    // Prior-attempt record content (mode + failures) is byte-identical for
    // equivalent input — a one-sided edit to either callsite's persisted
    // record breaks this pin, once `headSha`/`at` are normalized out: the
    // fanout tick runs after a real trunk commit (writePending, below) and at
    // a later wall-clock instant, so both anchor fields are legitimately
    // distinct between the two records (spec/loop.md "Every record is
    // anchored").
    const normalizeAnchor = (raw: string) =>
      raw
        .replace(/"headSha": "[^"]*"/, '"headSha": "<HEAD>"')
        .replace(/"at": "[^"]*"/, '"at": "<AT>"')
        // The keyspace legitimately differs — singleton records are
        // phase-keyed, fanout records entry-keyed (spec/loop.md "No false
        // signal") — as does the identity written under it, so both are
        // normalized out here and asserted directly.
        .replace(/"key": "[^"]*"/, '"key": "<KEYSPACE>"')
        .replace(/"keyedAs": "[^"]*"/, '"keyedAs": "<KEYED-AS>"')
        // The declaration key is the entry keyspace's alone, so the whole
        // line is normalized out rather than its value.
        .replace(/\n *"declaredAs": "[^"]*",?/, "");
    expect(normalizeAnchor(fanoutRecord)).toBe(normalizeAnchor(singletonRecord));
    expect(JSON.parse(singletonRecord).key).toBe("phase");
    expect(JSON.parse(fanoutRecord).key).toBe("entry");
    expect(JSON.parse(singletonRecord).keyedAs).toBe("plan");
    expect(JSON.parse(fanoutRecord).keyedAs).toBe(slugify("FANOUT-TWIN"));
    expect(JSON.parse(singletonRecord).declaredAs).toBeUndefined();
    expect(JSON.parse(fanoutRecord).declaredAs).toBe(
      entryDeclaredKey((readPendingFromDisk(fx.repo))[0]!),
    );

    // Both callsites log through the same template —
    // "[flume] <label>: render-refused (no commit): <message>" — with only
    // the label (phase name vs. entry tag) differing; the message text
    // itself agrees for equivalent input.
    expect(singletonWarnings).toHaveLength(1);
    expect(fanoutWarnings).toHaveLength(1);
    const shape = /^\[flume\] (.+): render-refused \(no commit\): ([\s\S]+)$/;
    const singletonMatch = singletonWarnings[0]!.match(shape);
    const fanoutMatch = fanoutWarnings[0]!.match(shape);
    expect(singletonMatch).not.toBeNull();
    expect(fanoutMatch).not.toBeNull();
    expect(singletonMatch![1]).toBe("plan");
    expect(fanoutMatch![1]).toBe("FANOUT-TWIN");
    expect(fanoutMatch![2]).toBe(singletonMatch![2]);
  });
});

describe("Dispatcher — Phase.shouldRun: decline before the invocation", () => {
  it("singleton: shouldRun=false skips the agent entirely, produces no commit, and still hands off", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");
    const preHead = await head(fx.repo);

    let invoked = false;
    const agent: Agent = {
      name: "must-not-run-when-declined",
      async invoke() {
        invoked = true;
        throw new Error("shouldRun=false must never reach the agent");
      },
    };

    let handoffCalls = 0;
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      shouldRun: () => false,
      handoff: () => {
        handoffCalls++;
        return ["build"];
      },
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(invoked).toBe(false);
    expect(outcome.result?.committed).toBe(false);
    expect(outcome.result?.commitSha).toBeUndefined();
    expect(await head(fx.repo)).toBe(preHead);
    expect(outcome.result?.gateResults).toEqual([]);

    // Declined is its own fact — never folded into noCommit/clean-exit.
    expect(outcome.declined).toBe(true);
    expect(outcome.noCommit).toBeUndefined();
    expect(outcome.noCommit).not.toBe("clean-exit");
    expect(outcome.verdict?.declined).toBe(true);
    expect(outcome.verdict?.noCommit).toBeUndefined();
    expect(outcome.verdict?.committed).toBe(false);
    expect(outcome.verdict?.gateResults).toEqual([]);

    // Baton mechanics unchanged: handoff still runs on the declined result,
    // sleeps this phase, wakes whatever handoff names.
    expect(handoffCalls).toBe(1);
    expect(outcome.awakeAfter).toEqual(["build"]);
    expect(baton.isAwake("plan")).toBe(false);
    expect(baton.isAwake("build")).toBe(true);
  });

  it("singleton: shouldRun=true is byte-identical (mod content-addressed shas) to a phase declaring no shouldRun", async () => {
    async function runOnce(shouldRun?: () => boolean) {
      const local = await makeFixture();
      try {
        new Baton(join(local.repo, ".flume")).wake("plan");
        const phase = makePhase({
          name: "plan",
          concurrency: "singleton",
          ...(shouldRun ? { shouldRun } : {}),
        });
        const chain: Chain = { phases: [phase], humanOnly: [] };
        const agent = singleAgent(async (cwd) => {
          await writeAndCommit(cwd, "src/plan-output.ts", "ok\n", "plan: derive");
        });
        const dispatcher = new Dispatcher({
          chainLoader: staticLoader(chain),
          repoRoot: local.repo,
          configDir: local.configDir,
          agent,
          log: silent,
        });
        return await dispatcher.tick();
      } finally {
        await local.cleanup();
      }
    }

    const declaredTrue = await runOnce(() => true);
    const undeclared = await runOnce(undefined);

    // Every fact both ticks produce is deterministic except the
    // content-addressed commit sha (author/committer timestamps differ
    // between the two independent commits), the verdict's own `at`
    // (wall-clock at the moment each `dispatcher.tick()` call built its
    // verdict), and TickResult.flumeDir/configDir (each `runOnce` call gets
    // its own fresh temp fixture) — blank those out before comparing the
    // rest byte-for-byte.
    const normalize = (o: unknown) =>
      JSON.parse(
        JSON.stringify(o)
          .replace(/\b[0-9a-f]{7,40}\b/g, "<SHA>")
          // ISO form on the verdict, `fsStamp` form (src/paths.ts) in the
          // rendered-prompt filename — one instant, two spellings.
          .replace(
            /\d{4}-\d{2}-\d{2}T\d{2}[:-]\d{2}[:-]\d{2}[.-]\d{3}Z/g,
            "<TIMESTAMP>",
          )
          .replace(/flume-dispatcher-(repo|cfg)-[A-Za-z0-9]+/g, "flume-dispatcher-$1-<TMP>"),
      );

    expect(normalize(declaredTrue)).toEqual(normalize(undeclared));
    expect(declaredTrue.declined).toBeUndefined();
    expect(undeclared.declined).toBeUndefined();
  });

  it("singleton: an undeclared shouldRun leaves declined absent on both TickOutcome and TickVerdict", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");
    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/out.ts", "x\n", "plan: derive");
    });
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    expect(outcome.declined).toBeUndefined();
    expect(outcome.verdict?.declined).toBeUndefined();
  });

  it("a singleton shouldRun receives ctx.cwd at the repo root", async () => {
    await writePending(fx.repo, [makeEntry("CTX-CHECK", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("plan");

    let shouldRunCtx: TickContext | undefined;
    let promptArgsCtx: TickContext | undefined;
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      shouldRun: (ctx) => {
        shouldRunCtx = ctx;
        return true;
      },
      promptArgs: (ctx) => {
        promptArgsCtx = ctx;
        return {};
      },
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/out.ts", "x\n", "plan: derive");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    await dispatcher.tick();

    // Consulted before anything is provisioned, so the only cwd there is to
    // hand it is the repo root; `promptArgs`, which runs after, sees the
    // worktree the tick went on to build.
    expect(shouldRunCtx?.cwd).toBe(fx.repo);
    expect(promptArgsCtx?.cwd).toBe(
      join(fx.repo, ".flume", "worktrees", "plan"),
    );
  });

  it("shouldRun sees the same TickContext promptArgs sees (singleton: pending)", async () => {
    await writePending(fx.repo, [makeEntry("CTX-CHECK", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("plan");

    let shouldRunCtx: TickContext | undefined;
    let promptArgsCtx: TickContext | undefined;
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      shouldRun: (ctx) => {
        shouldRunCtx = ctx;
        return true;
      },
      promptArgs: (ctx) => {
        promptArgsCtx = ctx;
        return {};
      },
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/out.ts", "x\n", "plan: derive");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    await dispatcher.tick();

    expect(shouldRunCtx).toBeDefined();
    expect(promptArgsCtx).toBeDefined();
    // `cwd` is the one field the two calls disagree on (the decline runs
    // before the worktree exists) — every other field is the same value,
    // handed out from one object.
    const { cwd: _srCwd, ...shouldRunRest } = shouldRunCtx!;
    const { cwd: _paCwd, ...promptArgsRest } = promptArgsCtx!;
    expect(Object.keys(shouldRunRest).sort()).toEqual(
      Object.keys(promptArgsRest).sort(),
    );
    for (const k of Object.keys(shouldRunRest) as (keyof typeof shouldRunRest)[]) {
      expect(shouldRunRest[k], k).toBe(promptArgsRest[k]);
    }
    expect(shouldRunCtx?.pending?.map((e) => e.tag)).toEqual(["CTX-CHECK"]);
  });

  it("fanout: shouldRun=false on the assigned entry skips only that entry's agent invocation; entry stays pending, wave still hands off", async () => {
    await writePending(fx.repo, [makeEntry("SHOULDRUN-FALSE", ["src/a.ts"])]);
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    let invoked = false;
    const agent = fanoutAgent({
      "shouldrun-false": async () => {
        invoked = true;
      },
    });

    let handoffCalls = 0;
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      shouldRun: () => false,
      handoff: () => {
        handoffCalls++;
        return ["plan"];
      },
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(invoked).toBe(false);
    expect(outcome.result?.committed).toBe(false);
    expect(outcome.declined).toBe(true);
    expect(outcome.noCommit).toBeUndefined();
    expect(outcome.noCommit).not.toBe("clean-exit");
    expect(outcome.verdict?.declined).toBe(true);
    expect(outcome.verdict?.noCommit).toBeUndefined();
    expect(outcome.verdict?.shippedTags).toEqual([]);

    // Never invoked, never shipped — the entry stays pending.
    expect(readPendingFromDisk(fx.repo)).toHaveLength(1);

    expect(handoffCalls).toBe(1);
    expect(outcome.awakeAfter).toEqual(["plan"]);
    expect(baton.isAwake("build")).toBe(false);
    expect(baton.isAwake("plan")).toBe(true);
  });

  it("fanout: shouldRun is consulted per assigned entry — one entry declines while its sibling ships normally", async () => {
    await writePending(fx.repo, [
      makeEntry("SHOULDRUN-DECLINE", ["src/a.ts"]),
      makeEntry("SHOULDRUN-SHIP", ["src/b.ts"]),
    ]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const invoked: string[] = [];
    const agent = fanoutAgent({
      "shouldrun-decline": async () => {
        invoked.push("SHOULDRUN-DECLINE");
      },
      "shouldrun-ship": async (cwd) => {
        invoked.push("SHOULDRUN-SHIP");
        await writeAndCommit(cwd, "src/b.ts", "ok\n", "build: ship");
      },
    });

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      shouldRun: (ctx) => ctx.assignedEntry?.tag !== "SHOULDRUN-DECLINE",
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(invoked).toEqual(["SHOULDRUN-SHIP"]);
    expect(outcome.result?.committed).toBe(true);
    expect(outcome.result?.shippedTags).toEqual(["SHOULDRUN-SHIP"]);
    // A wave that ships can still carry `declined` for a declined sibling —
    // the same coexistence `tipMoved` already establishes.
    expect(outcome.declined).toBe(true);
    expect(outcome.verdict?.declined).toBe(true);
    expect(outcome.verdict?.shippedTags).toEqual(["SHOULDRUN-SHIP"]);

    const remaining = readPendingFromDisk(fx.repo);
    expect(remaining.map((e) => e.tag)).toEqual(["SHOULDRUN-DECLINE"]);
  });

  it("fanout: shouldRun sees the same TickContext promptArgs sees (assignedEntry)", async () => {
    await writePending(fx.repo, [makeEntry("CTX-CHECK-FANOUT", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    let shouldRunCtx: TickContext | undefined;
    let promptArgsCtx: TickContext | undefined;
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      shouldRun: (ctx) => {
        shouldRunCtx = ctx;
        return true;
      },
      promptArgs: (ctx) => {
        promptArgsCtx = ctx;
        return {};
      },
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const agent = fanoutAgent({
      "ctx-check-fanout": async (cwd) => {
        await writeAndCommit(cwd, "src/a.ts", "x\n", "build: do");
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    await dispatcher.tick();

    expect(shouldRunCtx).toBeDefined();
    expect(shouldRunCtx?.assignedEntry?.tag).toBe("CTX-CHECK-FANOUT");
    expect(shouldRunCtx).toBe(promptArgsCtx);
  });
});

// ---------- TickResult carries the no-commit classification ----------

// SETUP-WORKTREE-HELPER bailed twice against the build fence and no plan tick
// woke: `Dispatcher.tick` computed the no-commit classification but discarded
// it before calling `phase.handoff(result)`, so no chain's handoff could ever
// distinguish a clean-exit from a genuine nothing-pickable no-op. These
// assert the fix at the one seam that matters: what `handoff` itself
// receives.

describe("Dispatcher — TickResult.noCommit reaches phase.handoff", () => {
  it("clean-exit: the TickResult handed to handoff carries noCommit: 'clean-exit'", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");

    const handoffResults: TickResult[] = [];
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      handoff: (r) => {
        handoffResults.push(r);
        return [];
      },
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent: Agent = {
      name: "bailing-singleton",
      async invoke() {
        // Clean exit, no commit — a clean-exit in the no-commit taxonomy.
        return { exitCode: 0, stdout: "BAILED: no path forward\n", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(false);
    expect(outcome.noCommit).toBe("clean-exit");
    expect(handoffResults).toHaveLength(1);
    expect(handoffResults[0]?.noCommit).toBe("clean-exit");
  });

  it("committed tick: the TickResult handed to handoff has no noCommit field", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");

    const handoffResults: TickResult[] = [];
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      handoff: (r) => {
        handoffResults.push(r);
        return [];
      },
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/derived.ts", "y\n", "plan: derive");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    expect(outcome.noCommit).toBeUndefined();
    expect(handoffResults).toHaveLength(1);
    expect(handoffResults[0]?.noCommit).toBeUndefined();
    expect("noCommit" in handoffResults[0]!).toBe(false);
  });
});

// ---------- per-tick chain re-resolution ----------

describe("Dispatcher — per-tick chain re-resolution", () => {
  // The cross-tick rewrite guarantee is a *process boundary*, not an
  // in-process re-eval (Node's ESM registry is non-evictable; see
  // loadChainModule). A fake/closure loader cannot exercise it and is
  // explicitly insufficient for the re-resolution claim — that leg is covered
  // by the real integration test in tests/loop-process-boundary.test.ts (two
  // real `flume tick` subprocesses vs a chain.ts mutated on disk between
  // them). The unit-level guarantee here is narrower: a `Dispatcher`
  // constructed with only `configDir` resolves the on-disk chain.ts itself,
  // in-process, with no subprocess.

  it("constructs with only configDir → resolves the on-disk chain.ts", async () => {
    const cfg = await mkTempDir("flume-cfg-ondisk-");
    try {
      await writeFile(join(cfg, "prompt.md"), "dummy\n", "utf8");
      await writeFile(
        join(cfg, "chain.ts"),
        `export default () => ({ chain: { phases: [{ name: "ondisk", description: "", ` +
          `promptPath: "prompt.md", concurrency: "singleton", ` +
          `writablePaths: ["**"], gates: [], handoff: () => [] }], ` +
          `humanOnly: [] } });\n`,
        "utf8",
      );

      new Baton(join(fx.repo, ".flume")).wake("ondisk");

      // No chainLoader → default diskChainLoader(configDir).
      const dispatcher = new Dispatcher({
        repoRoot: fx.repo,
        configDir: cfg,
        agent: singleAgent(async (cwd) => {
          await writeAndCommit(cwd, "src/ondisk.ts", "x\n", "build: ondisk");
        }),
        log: silent,
      });

      const outcome = await dispatcher.tick();
      expect(outcome.hibernated).toBe(false);
      expect(outcome.phaseName).toBe("ondisk");
      expect(outcome.result?.committed).toBe(true);
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  });
});

// ---------- FlumeApi.paths (spec/chain.md "Per-run artifacts belong under
// `FLUME_DIR`") ----------

/**
 * The roots reach the chain factory *by reference from the dispatcher's own
 * resolution*, which is the whole claim: a chain placing a per-run artifact
 * resolves it against `api.paths.flumeDir` rather than reading
 * `process.env.FLUME_DIR` with a `?? CHAIN_DIR` fallback.
 *
 * Both cases drive the real `diskChainLoader` — no injected `chainLoader` —
 * because the value under test is what the *Dispatcher* resolved, not what a
 * fixture handed `loadChainModule` directly.
 */
describe(
  "Dispatcher — FlumeApi.paths carries the dispatcher's own resolved roots (FLUMEAPI-PATHS)",
  () => {
    /** Chain source whose factory records `api.paths` at `recordPath`. */
    function recordingChain(recordPath: string, phaseName: string): string {
      return (
        `import { writeFileSync } from "node:fs";\n` +
        `export default (api) => {\n` +
        `  writeFileSync(${JSON.stringify(recordPath)}, JSON.stringify(api.paths), "utf8");\n` +
        `  return { chain: { phases: [{ name: ${JSON.stringify(phaseName)}, ` +
        `description: "", promptPath: "prompt.md", concurrency: "singleton", ` +
        `writablePaths: ["**"], gates: [], handoff: () => [] }], ` +
        `humanOnly: [] } };\n` +
        `};\n`
      );
    }

    it("a relocated state root reaches the factory: the chain writes its per-run artifact under api.paths.flumeDir", async () => {
      const cfg = await mkTempDir("flume-cfg-apipaths-");
      const stateRoot = await mkTempDir("flume-state-apipaths-");
      try {
        // Pairwise-distinct roots are what gives the assertion teeth: with
        // repoRoot === configDir === flumeDir, a chain that ignored
        // `api.paths` and used its own directory would pass identically.
        expect(new Set([fx.repo, cfg, stateRoot]).size).toBe(3);

        await writeFile(join(cfg, "prompt.md"), "dummy\n", "utf8");
        // The artifact path is *derived by the chain* from api.paths.flumeDir
        // — the acceptance shape, not a path the test baked in.
        await writeFile(
          join(cfg, "chain.ts"),
          `import { writeFileSync } from "node:fs";\n` +
            `import { resolve } from "node:path";\n` +
            `export default (api) => {\n` +
            `  writeFileSync(resolve(api.paths.flumeDir, "artifact.json"), ` +
            `JSON.stringify(api.paths), "utf8");\n` +
            `  return { chain: { phases: [{ name: "apipaths", description: "", ` +
            `promptPath: "prompt.md", concurrency: "singleton", ` +
            `writablePaths: ["**"], gates: [], handoff: () => [] }], ` +
            `humanOnly: [] } };\n` +
            `};\n`,
          "utf8",
        );

        new Baton(stateRoot).wake("apipaths");

        const dispatcher = new Dispatcher({
          repoRoot: fx.repo,
          configDir: cfg,
          flumeDir: stateRoot,
          agent: singleAgent(async (cwd) => {
            await writeAndCommit(cwd, "src/apipaths.ts", "x\n", "build: apipaths");
          }),
          log: silent,
        });

        const outcome = await dispatcher.tick();
        expect(outcome.result?.committed).toBe(true);

        // The artifact landed in the relocated state root — not beside
        // chain.ts, and not under `<repoRoot>/.flume`.
        expect(existsSync(join(cfg, "artifact.json"))).toBe(false);
        const recorded = JSON.parse(
          await readFile(join(stateRoot, "artifact.json"), "utf8"),
        ) as FlumePaths;
        expect(recorded).toEqual({
          repoRoot: fx.repo,
          configDir: cfg,
          flumeDir: stateRoot,
        });
      } finally {
        await rm(cfg, { recursive: true, force: true });
        await rm(stateRoot, { recursive: true, force: true });
      }
    });

    it("an undeclared flumeDir reaches the factory already defaulted to <repoRoot>/.flume, not undefined", async () => {
      const cfg = await mkTempDir("flume-cfg-apipaths-default-");
      const scratch = await mkTempDir("flume-rec-apipaths-");
      try {
        const recordPath = join(scratch, "paths.json");
        await writeFile(join(cfg, "prompt.md"), "dummy\n", "utf8");
        await writeFile(
          join(cfg, "chain.ts"),
          recordingChain(recordPath, "apipaths-default"),
          "utf8",
        );

        new Baton(join(fx.repo, ".flume")).wake("apipaths-default");

        // No `flumeDir` option: the dispatcher's own default is what the
        // factory must see. Passing `opts.flumeDir` through unresolved would
        // hand the chain `undefined` here.
        const dispatcher = new Dispatcher({
          repoRoot: fx.repo,
          configDir: cfg,
          agent: singleAgent(async (cwd) => {
            await writeAndCommit(cwd, "src/apipaths-d.ts", "x\n", "build: d");
          }),
          log: silent,
        });

        const outcome = await dispatcher.tick();
        expect(outcome.result?.committed).toBe(true);

        const recorded = JSON.parse(
          await readFile(recordPath, "utf8"),
        ) as FlumeApiPaths;
        // The defaulted root, and the offset the engine computed from it —
        // the fence-and-pathspec spelling of the same answer, reported
        // beside the roots so the chain never folds a `relative()` of its
        // own (spec/chain.md, *Per-run artifacts belong under `FLUME_DIR`*).
        expect(recorded).toEqual({
          repoRoot: fx.repo,
          configDir: cfg,
          flumeDir: join(fx.repo, ".flume"),
          stateRootRel: ".flume",
        });
      } finally {
        await rm(cfg, { recursive: true, force: true });
        await rm(scratch, { recursive: true, force: true });
      }
    });
  },
);

// ---------- chain-load gate + engine fallback ----------

describe("Dispatcher — chainLoadGate reverts a broken self-edited chain", () => {
  it("broken chain.ts with chainLoadGate declared → tick reverted, chain restored, loop continues", async () => {
    // Last-good chain.ts on trunk; the broken rewrite must revert to this.
    const goodChain =
      `export default () => ({ chain: { phases: [{ name: "build", description: "", ` +
      `promptPath: "prompt.md", concurrency: "singleton", ` +
      `writablePaths: ["**"], gates: [], handoff: () => [] }], ` +
      `humanOnly: [] } });\n`;
    await writeAndCommit(fx.repo, ".flume/chain.ts", goodChain, "seed chain");
    const preHead = await head(fx.repo);
    // chainLoadGate now keys off `configDir`, not a hardcoded `.flume`
    // (ENGINE-BOUNDARY "Told, not inferred") — so this fixture points
    // `configDir` at the repo's own default `.flume` (where the agent below
    // actually rewrites chain.ts), rather than the fixture's normally-
    // external `fx.configDir` scratch dir, which the gate would correctly
    // never see as touched.
    const configDir = join(fx.repo, ".flume");
    await writeFile(join(configDir, "prompt.md"), "dummy prompt\n", "utf8");

    new Baton(join(fx.repo, ".flume")).wake("build");

    // The dispatcher resolves via the test seam (staticLoader); the on-disk
    // chain.ts is what the agent rewrites and chainLoadGate validates.
    const phase = makePhase({
      name: "build",
      concurrency: "singleton",
      gates: [chainLoadGate],
      handoff: () => [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(
        cwd,
        ".flume/chain.ts",
        "export default { phases: [",
        "build: rewrite chain (broken)",
      );
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    // Producing tick reverted: trunk back at preHead, no commit reported.
    expect(outcome.result?.committed).toBe(false);
    expect(outcome.result?.commitSha).toBeUndefined();
    expect(await head(fx.repo)).toBe(preHead);
    // chain.ts restored to the last-good version.
    expect(await readFile(join(fx.repo, ".flume", "chain.ts"), "utf8")).toBe(
      goodChain,
    );
    // chain-load is the recorded failure (it runs before writable-paths).
    const gr = outcome.result?.gateResults ?? [];
    expect(gr.some((g) => g.gate === "chain-load" && !g.ok)).toBe(true);
    expect(gr.some((g) => g.gate === "writable-paths")).toBe(false);
    // Loop survives the bad self-edit — tick() returned normally.
    expect(outcome.hibernated).toBe(false);
  });
});

// The chain-load gate's recovery clause: a chainLoadGate revert is only
// *recovery* (not just containment) because the next tick's prompt carries
// the chain-load failure (chainLoadGate without feedback = a blind chain.ts
// revert loop). The chain-load test above stops at the recorded-failure
// check, which predates prior-attempt feedback; this asserts the composite
// end-to-end. That forwarding is gate-uniform — no src/ change, only the
// asserting test.
describe("Dispatcher — chainLoadGate revert forwards the chain-load failure to the next tick", () => {
  it("broken chain.ts reverted by chainLoadGate → next tick's prompt carries <prior-attempt> naming chain-load + its detail; chain.ts restored to last-good", async () => {
    // Last-good chain.ts on trunk; the broken rewrite must revert to this.
    const goodChain =
      `export default () => ({ chain: { phases: [{ name: "build", description: "", ` +
      `promptPath: "prompt.md", concurrency: "singleton", ` +
      `writablePaths: ["**"], gates: [], handoff: () => [] }], ` +
      `humanOnly: [] } });\n`;
    await writeAndCommit(fx.repo, ".flume/chain.ts", goodChain, "seed chain");
    // chainLoadGate now keys off `configDir`, not a hardcoded `.flume`
    // (ENGINE-BOUNDARY "Told, not inferred") — so this fixture points
    // `configDir` at the repo's own default `.flume` (where the agent below
    // actually rewrites chain.ts), rather than the fixture's normally-
    // external `fx.configDir` scratch dir, which the gate would correctly
    // never see as touched.
    const configDir = join(fx.repo, ".flume");
    await writeFile(join(configDir, "prompt.md"), "dummy prompt\n", "utf8");

    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "singleton",
      gates: [chainLoadGate],
      handoff: () => [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const prompts: string[] = [];
    const agent: Agent = {
      name: "recording-chain-rewriter",
      async invoke(inv) {
        // Capture the rendered prompt *before* acting — the assertion is
        // on what the dispatcher handed this tick, not on its output.
        const n = prompts.length;
        prompts.push(inv.prompt);
        if (n === 0) {
          // Attempt 1: self-edit chain.ts into a syntactically-broken
          // state → chainLoadGate fails afterCommit → revert + restore.
          await writeAndCommit(
            inv.cwd,
            ".flume/chain.ts",
            "export default { phases: [",
            "build: rewrite chain (broken)",
          );
        } else {
          // Attempt 2: innocuous commit (chain.ts untouched → gate skips).
          await writeAndCommit(
            inv.cwd,
            "src/o.ts",
            "recovered\n",
            "build: recover",
          );
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir,
      agent,
      log: silent,
    });

    await dispatcher.tick(); // attempt 1 → broken chain.ts committed, reverted
    baton.wake("build"); // re-wake (handoff () => [] slept it)
    await dispatcher.tick(); // attempt 2 → prompt carries the chain-load block

    expect(prompts.length).toBe(2);

    // First attempt: no false prior-attempt signal.
    expect(prompts[0]).not.toContain("<prior-attempt>");

    // Retry: the prior-attempt block names the *chain-load* gate, reverted at
    // afterCommit, and forwards its full loader failure — not just the
    // one-line verdict — so the next tick does not blindly re-author the
    // same broken chain.ts.
    expect(prompts[1]).toContain("<prior-attempt>");
    expect(prompts[1]).toContain("Reverted at: afterCommit");
    expect(prompts[1]).toContain("Failing gate: chain-load");
    expect(prompts[1]).toContain(
      "Verdict: chain.ts is broken — commit reverted",
    );
    // The raw esbuild transform failure (chainLoadGate's `details`) is
    // forwarded, bounded but verbatim.
    expect(prompts[1]).toContain("Transform failed");
    expect(prompts[1]).toContain("Unexpected end of file");

    // chain.ts is back at the last-good version after the revert.
    expect(await readFile(join(fx.repo, ".flume", "chain.ts"), "utf8")).toBe(
      goodChain,
    );
  });
});

describe("Dispatcher — ungated chain resolution failure → loud no-work outcome", () => {
  it("tick() with a rejecting chainLoader returns a failed no-work outcome, logs loudly, does not throw", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const errors: string[] = [];
    const rec: Logger = {
      info: () => {},
      warn: () => {},
      error: (l) => errors.push(l),
    };

    const dispatcher = new Dispatcher({
      repoRoot: fx.repo,
      configDir: fx.configDir,
      chainLoader: () => Promise.reject(new Error("simulated broken chain.ts")),
      agent: singleAgent(async () => {}),
      log: rec,
    });

    // No retain-last-good in-process (moot under process-per-tick): a tick
    // whose chain won't resolve does no work and returns a `failed` outcome
    // rather than throwing or hibernating. Recovery is structural — the next
    // tick is a fresh process reading the (gate-restored, or human-fixed)
    // chain.ts.
    const outcome = await dispatcher.tick();

    expect(outcome.failed).toBe(true);
    expect(outcome.hibernated).toBe(false);
    expect(outcome.result).toBeUndefined();
    expect(outcome.phaseName).toBeUndefined();
    expect(errors.some((e) => /chain resolution failed/.test(e))).toBe(true);
    expect(errors.some((e) => /simulated broken chain\.ts/.test(e))).toBe(true);
  });
});

describe("Dispatcher — flumeDir exposed to gates & promptArgs", () => {
  it("threads the resolved flumeDir into GateContext and TickContext (default location)", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    let gateFlumeDir: string | undefined;
    let ctxFlumeDir: string | undefined;

    const capturingGate: Gate = {
      name: "capture-flumedir",
      when: "afterCommit",
      run(ctx) {
        gateFlumeDir = ctx.flumeDir;
        return Promise.resolve({ ok: true, message: "captured" });
      },
    };

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [capturingGate],
      promptArgs: (ctx) => {
        ctxFlumeDir = ctx.flumeDir;
        return {};
      },
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/out.ts", "ok\n", "plan: derive");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    await dispatcher.tick();

    // Default flumeDir is <repoRoot>/.flume, and the same resolved value
    // reaches both the prompt-arg builder (pre-agent) and the gate
    // (post-commit).
    expect(ctxFlumeDir).toBe(join(fx.repo, ".flume"));
    expect(gateFlumeDir).toBe(join(fx.repo, ".flume"));
  });

  it("honors a relocated flumeDir option in GateContext", async () => {
    const dock = join(fx.repo, "dock-state");
    new Baton(dock).wake("plan");

    let gateFlumeDir: string | undefined;
    const capturingGate: Gate = {
      name: "capture-flumedir",
      when: "afterCommit",
      run(ctx) {
        gateFlumeDir = ctx.flumeDir;
        return Promise.resolve({ ok: true, message: "captured" });
      },
    };

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [capturingGate],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/out.ts", "ok\n", "plan: derive");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      flumeDir: dock,
      agent,
      log: silent,
    });

    await dispatcher.tick();

    expect(gateFlumeDir).toBe(dock);
  });
});

describe("Dispatcher — GateContext.repoRoot", () => {
  it("singleton tick: afterCommit gate's repoRoot is the worktree root; afterMerge gate's repoRoot is the trunk (spec/worktrees.md 'Singleton runs in a worktree')", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    let commitRepoRoot: string | undefined;
    let commitCwd: string | undefined;
    const captureCommit: Gate = {
      name: "capture-commit-reporoot",
      when: "afterCommit",
      run(ctx) {
        commitRepoRoot = ctx.repoRoot;
        commitCwd = ctx.cwd;
        return Promise.resolve({ ok: true, message: "captured" });
      },
    };

    let mergeRepoRoot: string | undefined;
    let mergeCwd: string | undefined;
    const captureMerge: Gate = {
      name: "capture-merge-reporoot",
      when: "afterMerge",
      run(ctx) {
        mergeRepoRoot = ctx.repoRoot;
        mergeCwd = ctx.cwd;
        return Promise.resolve({ ok: true, message: "captured" });
      },
    };

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [captureCommit, captureMerge],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/out.ts", "ok\n", "plan: derive");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);

    // afterCommit runs on the worktree branch, before cherry-pick: its
    // repoRoot is that worktree's root, not the trunk repo.
    expect(commitRepoRoot).toBeDefined();
    expect(commitRepoRoot).toBe(commitCwd);
    expect(commitRepoRoot).not.toBe(fx.repo);
    expect(commitRepoRoot).toContain("plan");

    // afterMerge runs on the trunk after the cherry-pick lands.
    expect(mergeRepoRoot).toBe(fx.repo);
    expect(mergeRepoRoot).toBe(mergeCwd);
  });

  it("fanout tick: afterCommit gate's repoRoot is the worktree root; afterMerge gate's repoRoot is the trunk", async () => {
    await writePending(fx.repo, [makeEntry("RR-FANOUT", ["src/rr.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    let commitRepoRoot: string | undefined;
    let commitCwd: string | undefined;
    const captureCommit: Gate = {
      name: "capture-commit-reporoot",
      when: "afterCommit",
      run(ctx) {
        commitRepoRoot = ctx.repoRoot;
        commitCwd = ctx.cwd;
        return Promise.resolve({ ok: true, message: "captured" });
      },
    };

    let mergeRepoRoot: string | undefined;
    let mergeCwd: string | undefined;
    const captureMerge: Gate = {
      name: "capture-merge-reporoot",
      when: "afterMerge",
      run(ctx) {
        mergeRepoRoot = ctx.repoRoot;
        mergeCwd = ctx.cwd;
        return Promise.resolve({ ok: true, message: "captured" });
      },
    };

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [captureCommit, captureMerge],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "rr-fanout": async (cwd) => {
        await writeAndCommit(
          cwd,
          "src/rr.ts",
          "ok\n",
          "build(RR-FANOUT): ship",
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual(["RR-FANOUT"]);

    // afterCommit runs on the worktree branch, before cherry-pick: its
    // repoRoot is that worktree's root, not the trunk repo.
    expect(commitRepoRoot).toBeDefined();
    expect(commitRepoRoot).toBe(commitCwd);
    expect(commitRepoRoot).not.toBe(fx.repo);
    expect(commitRepoRoot).toContain("rr-fanout");

    // afterMerge runs on the trunk after the cherry-pick lands.
    expect(mergeRepoRoot).toBe(fx.repo);
    expect(mergeRepoRoot).toBe(mergeCwd);
  });
});

describe("Dispatcher — the span base is reported: GateContext.baseSha, TickResult.baseSha, ShipContext.baseSha (SPAN-BASE-SHA-ON-GATE-AND-HOOK, spec/chain.md 'What a gate receives')", () => {
  it("fanout: an afterCommit gate and an afterMerge gate on the same span both receive the sha the span branched from", async () => {
    // The field shape this closes: a trunk commit lands *after* the tick
    // branched, and an afterMerge gate reading trunk must not charge the
    // entry with ignoring it. Without `baseSha` the gate has no engine-given
    // number to diff from and rebuilds one from a worktree path convention.
    await writeAndCommit(fx.repo, "notes/claim.md", "old\n", "seed: claim");
    await writePending(fx.repo, [makeEntry("BASE-FANOUT", ["src/base.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");
    const branchedFrom = await head(fx.repo);

    let commitBase: string | undefined;
    const captureCommit: Gate = {
      name: "capture-commit-base",
      when: "afterCommit",
      run(ctx) {
        commitBase = ctx.baseSha;
        return Promise.resolve({ ok: true, message: "captured" });
      },
    };

    let mergeBase: string | undefined;
    let landedAfterBranch: string[] | undefined;
    let claimAtBase: string | undefined;
    const captureMerge: Gate = {
      name: "capture-merge-base",
      when: "afterMerge",
      async run(ctx) {
        mergeBase = ctx.baseSha;
        // The acceptance shape: answer "what landed that this tick could
        // not have seen" from the context alone — no worktree path, no
        // reflog.
        const { stdout } = await exec(
          "git",
          ["log", "--format=%s", `${ctx.baseSha}..HEAD`, "--", "notes/"],
          { cwd: ctx.cwd },
        );
        landedAfterBranch = stdout.trim().split("\n").filter(Boolean);
        const shown = await exec("git", ["show", `${ctx.baseSha}:notes/claim.md`], {
          cwd: ctx.cwd,
        });
        claimAtBase = shown.stdout;
        return { ok: true, message: "captured" };
      },
    };

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [captureCommit, captureMerge],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "base-fanout": async (cwd) => {
        await writeAndCommit(cwd, "src/base.ts", "ok\n", "build(BASE-FANOUT): ship");
        // A concurrent writer moves trunk while this tick is mid-flight —
        // the entry's agent never saw this commit.
        await writeAndCommit(fx.repo, "notes/late.md", "late\n", "docs: late note");
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    // Non-vacuity: both gates actually ran on a span that actually shipped.
    expect(outcome.result?.shippedTags).toEqual(["BASE-FANOUT"]);
    expect(
      outcome.result?.gateResults.map((g) => g.gate),
    ).toEqual(expect.arrayContaining(["capture-commit-base", "capture-merge-base"]));

    // Both stages see the same number: the tip the worktree branched from.
    expect(commitBase).toBe(branchedFrom);
    expect(mergeBase).toBe(branchedFrom);

    // And it is usable as a range base on trunk: the note that landed after
    // the branch point is named, the one that predates it is not.
    expect(landedAfterBranch).toEqual(["docs: late note"]);
    expect(claimAtBase).toBe("old\n");
  });

  it("singleton: an afterCommit gate and an afterMerge gate on the same span both receive the sha the span branched from", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");
    const branchedFrom = await head(fx.repo);

    let commitBase: string | undefined;
    let mergeBase: string | undefined;
    const captureCommit: Gate = {
      name: "capture-commit-base",
      when: "afterCommit",
      run(ctx) {
        commitBase = ctx.baseSha;
        return Promise.resolve({ ok: true, message: "captured" });
      },
    };
    const captureMerge: Gate = {
      name: "capture-merge-base",
      when: "afterMerge",
      run(ctx) {
        mergeBase = ctx.baseSha;
        return Promise.resolve({ ok: true, message: "captured" });
      },
    };

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [captureCommit, captureMerge],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/out.ts", "ok\n", "plan: derive");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    expect(
      outcome.result?.gateResults.map((g) => g.gate),
    ).toEqual(expect.arrayContaining(["capture-commit-base", "capture-merge-base"]));
    // The afterMerge stage reports the span's base, never the pre-cherry-pick
    // trunk tip — here they coincide only because nothing else moved trunk.
    expect(commitBase).toBe(branchedFrom);
    expect(mergeBase).toBe(branchedFrom);
  });

  it("handoff receives baseSha on TickResult under both concurrencies", async () => {
    // Singleton leg.
    new Baton(join(fx.repo, ".flume")).wake("plan");
    const planBranchedFrom = await head(fx.repo);

    let planResult: TickResult | undefined;
    const planPhase = makePhase({
      name: "plan",
      concurrency: "singleton",
      handoff: (r) => {
        planResult = r;
        return [];
      },
    });

    const planDispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [planPhase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async (cwd) => {
        await writeAndCommit(cwd, "src/plan-out.ts", "ok\n", "plan: derive");
      }),
      log: silent,
    });
    const planOutcome = await planDispatcher.tick();

    expect(planOutcome.result?.committed).toBe(true);
    expect(planResult).toBeDefined();
    expect(planResult?.baseSha).toBe(planBranchedFrom);

    // Fanout leg, on the tree the singleton leg just moved.
    await writePending(fx.repo, [makeEntry("BASE-HANDOFF", ["src/handoff.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");
    const waveBranchedFrom = await head(fx.repo);

    let waveResult: TickResult | undefined;
    const buildPhase = makePhase({
      name: "build",
      concurrency: "fanout",
      handoff: (r) => {
        waveResult = r;
        return [];
      },
    });

    const buildDispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [buildPhase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({
        "base-handoff": async (cwd) => {
          await writeAndCommit(
            cwd,
            "src/handoff.ts",
            "ok\n",
            "build(BASE-HANDOFF): ship",
          );
        },
      }),
      log: silent,
    });
    const waveOutcome = await buildDispatcher.tick();

    expect(waveOutcome.result?.shippedTags).toEqual(["BASE-HANDOFF"]);
    expect(waveResult).toBeDefined();
    expect(waveResult?.baseSha).toBe(waveBranchedFrom);
    // Not the post-tick tip: the wave's own commits are inside the range.
    expect(waveResult?.baseSha).not.toBe(await head(fx.repo));
  });

  it("the shipped hook receives the span base beside the merged sha", async () => {
    await writePending(fx.repo, [makeEntry("BASE-SHIP", ["src/ship.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");
    const branchedFrom = await head(fx.repo);

    let seen: { baseSha: string; mergedSha: string } | undefined;
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      shipped: (ctx) => {
        seen = { baseSha: ctx.baseSha, mergedSha: ctx.mergedSha };
        return true;
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({
        "base-ship": async (cwd) => {
          await writeAndCommit(
            cwd,
            "src/ship.ts",
            "ok\n",
            "build(BASE-SHIP): ship",
          );
        },
      }),
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual(["BASE-SHIP"]);
    expect(seen).toBeDefined();
    expect(seen?.baseSha).toBe(branchedFrom);
    expect(seen?.mergedSha).not.toBe(branchedFrom);
    // The pair brackets exactly this entry's span on trunk.
    const { stdout } = await exec(
      "git",
      ["log", "--format=%s", `${seen!.baseSha}..${seen!.mergedSha}`],
      { cwd: fx.repo },
    );
    expect(stdout.trim().split("\n").filter(Boolean)).toEqual([
      "build(BASE-SHIP): ship",
    ]);
  });
});

describe("Dispatcher — GateContext.stateRootRel (GATE-CONTEXT-STATE-ROOT-REL, spec/chain.md 'What a gate receives')", () => {
  it("singleton tick: an afterCommit gate's stateRootRel is flumeDir's offset from repoRoot, with the worktree nested inside flumeDir (the real afterCommit shape)", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    let commitStateRootRel: string | undefined;
    let commitRepoRoot: string | undefined;
    const captureCommit: Gate = {
      name: "capture-commit-staterootrel",
      when: "afterCommit",
      run(ctx) {
        commitStateRootRel = ctx.stateRootRel;
        commitRepoRoot = ctx.repoRoot;
        return Promise.resolve({ ok: true, message: "captured" });
      },
    };

    let mergeStateRootRel: string | undefined;
    const captureMerge: Gate = {
      name: "capture-merge-staterootrel",
      when: "afterMerge",
      run(ctx) {
        mergeStateRootRel = ctx.stateRootRel;
        return Promise.resolve({ ok: true, message: "captured" });
      },
    };

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [captureCommit, captureMerge],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/out.ts", "ok\n", "plan: derive");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();
    expect(outcome.result?.committed).toBe(true);

    const flumeDir = join(fx.repo, ".flume");
    const expected = relative(fx.repo, flumeDir);
    // Not the inverted shape a hand-built fixture might assume (flumeDir
    // nested under repoRoot): here the worktree (afterCommit's repoRoot)
    // is nested *inside* flumeDir, and stateRootRel is still flumeDir's
    // own offset from the primary repoRoot, not derived from the worktree.
    expect(commitRepoRoot).toBeDefined();
    expect(commitRepoRoot as string).toContain(flumeDir);
    expect(commitStateRootRel).toBe(expected);
    expect(mergeStateRootRel).toBe(expected);
  });

  it("fanout tick: stateRootRel is undefined when flumeDir is relocated outside repoRoot", async () => {
    const dock = await mkTempDir("flume-dock-staterootrel-");
    try {
      const pendingDir = join(dock, "plan", "pending");
      await mkdir(pendingDir, { recursive: true });
      await writeFile(
        join(pendingDir, entryFileName("SRR-RELOC")),
        JSON.stringify(makeEntry("SRR-RELOC", ["src/srr-reloc.ts"]), null, 2) +
          "\n",
        "utf8",
      );
      new Baton(dock).wake("build");

      let gateRan = false;
      let commitStateRootRel: string | undefined;
      const captureCommit: Gate = {
        name: "capture-commit-staterootrel-reloc",
        when: "afterCommit",
        run(ctx) {
          gateRan = true;
          commitStateRootRel = ctx.stateRootRel;
          return Promise.resolve({ ok: true, message: "captured" });
        },
      };

      const phase = makePhase({
        name: "build",
        concurrency: "fanout",
        gates: [captureCommit],
      });
      const chain: Chain = { phases: [phase], humanOnly: [] };

      const agent = fanoutAgent({
        "srr-reloc": (cwd) =>
          writeAndCommit(
            cwd,
            "src/srr-reloc.ts",
            "reloc\n",
            "build(SRR-RELOC): ship",
          ),
      });

      const dispatcher = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        flumeDir: dock,
        agent,
        log: silent,
      });

      const outcome = await dispatcher.tick();
      expect(outcome.result?.shippedTags).toEqual(["SRR-RELOC"]);
      // The gate ran — its captured value is explicitly `undefined`, not
      // merely never invoked.
      expect(gateRan).toBe(true);
      expect(commitStateRootRel).toBeUndefined();
    } finally {
      await rm(dock, { recursive: true, force: true });
    }
  });
});

describe("Dispatcher — TickContext.stateRootRel (TICKCONTEXT-STATE-ROOT-REL, spec/chain.md 'What a hook receives')", () => {
  it("a dispatcher-built TickContext carries the state root's path relative to the repo root, on the singleton consult and on a fanout entry's tick alike", async () => {
    const flumeDir = join(fx.repo, ".flume");
    const expected = relative(fx.repo, flumeDir);
    // Non-vacuity: the offset under test is a real path segment, not the
    // empty string a state root sitting at the repo root would produce.
    expect(expected.length).toBeGreaterThan(0);

    // --- singleton: the decline consult and promptArgs read one object.
    await writePending(fx.repo, [makeEntry("TCSRR", ["src/tcsrr.ts"])]);
    new Baton(flumeDir).wake("plan");

    let planShouldRun: TickContext | undefined;
    let planPromptArgs: TickContext | undefined;
    const plan = makePhase({
      name: "plan",
      concurrency: "singleton",
      shouldRun: (ctx) => {
        planShouldRun = ctx;
        return true;
      },
      promptArgs: (ctx) => {
        planPromptArgs = ctx;
        return {};
      },
    });

    await new Dispatcher({
      chainLoader: staticLoader({ phases: [plan], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async (cwd) => {
        await writeAndCommit(cwd, "src/out.ts", "x\n", "plan: derive");
      }),
      log: silent,
    }).tick();

    expect(planShouldRun?.stateRootRel).toBe(expected);
    expect(planPromptArgs?.stateRootRel).toBe(expected);

    // --- fanout: the entry's own context, whose `cwd` is the worktree and
    // whose `flumeDir` is not an ancestor of it — the shape in which no hook
    // could derive this offset for itself.
    new Baton(flumeDir).wake("build");

    let buildCtx: TickContext | undefined;
    const build = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      promptArgs: (ctx) => {
        buildCtx = ctx;
        return {};
      },
    });

    const outcome = await new Dispatcher({
      chainLoader: staticLoader({ phases: [build], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({
        tcsrr: (cwd) =>
          writeAndCommit(cwd, "src/tcsrr.ts", "y\n", "build(TCSRR): ship"),
      }),
      log: silent,
    }).tick();

    expect(outcome.result?.shippedTags).toEqual(["TCSRR"]);
    expect(buildCtx?.stateRootRel).toBe(expected);
    // The premise the field exists for: the worktree is not under the state
    // root's parent in a way a hook could invert, and `flumeDir` is absolute.
    expect(buildCtx?.cwd).not.toBe(fx.repo);
    expect(buildCtx?.flumeDir).toBe(flumeDir);
  });

  it("fanout: TickContext.stateRootRel is undefined when flumeDir is relocated outside repoRoot", async () => {
    const dock = await mkTempDir("flume-dock-tcsrr-");
    try {
      const pendingDir = join(dock, "plan", "pending");
      await mkdir(pendingDir, { recursive: true });
      await writeFile(
        join(pendingDir, entryFileName("TCSRR-RELOC")),
        JSON.stringify(makeEntry("TCSRR-RELOC", ["src/tcsrr-reloc.ts"]), null, 2) +
          "\n",
        "utf8",
      );
      new Baton(dock).wake("build");

      let seen: TickContext | undefined;
      const build = makePhase({
        name: "build",
        concurrency: "fanout",
        writablePaths: ["src/**"],
        promptArgs: (ctx) => {
          seen = ctx;
          return {};
        },
      });

      const outcome = await new Dispatcher({
        chainLoader: staticLoader({ phases: [build], humanOnly: [] }),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        flumeDir: dock,
        agent: fanoutAgent({
          "tcsrr-reloc": (cwd) =>
            writeAndCommit(
              cwd,
              "src/tcsrr-reloc.ts",
              "z\n",
              "build(TCSRR-RELOC): ship",
            ),
        }),
        log: silent,
      }).tick();

      expect(outcome.result?.shippedTags).toEqual(["TCSRR-RELOC"]);
      // The hook ran, so the value below is a reported absence and not a
      // context that was never built.
      expect(seen).toBeDefined();
      expect("stateRootRel" in seen!).toBe(true);
      expect(seen!.stateRootRel).toBeUndefined();
    } finally {
      await rm(dock, { recursive: true, force: true });
    }
  });
});

describe("Dispatcher — GateContext.configDir rebase (GATECTX-CONFIGDIR-ESCAPE)", () => {
  /**
   * Drive one singleton tick whose afterCommit gate captures `ctx.configDir`,
   * `ctx.repoRoot` (the worktree the gate ran in), and — from inside the
   * gate, while that worktree still exists — whether the config dir it was
   * handed actually resolves onto the prompt file. `configDir` varies per
   * case; everything else is the shared shape.
   */
  async function captureAfterCommitConfigDir(configDir: string): Promise<{
    configDir: string;
    worktree: string;
    promptResolves: boolean;
  }> {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    let gateRan = false;
    let seenConfigDir: string | undefined;
    let seenWorktree: string | undefined;
    let promptResolves = false;
    const capture: Gate = {
      name: "capture-commit-configdir",
      when: "afterCommit",
      run(ctx) {
        gateRan = true;
        seenConfigDir = ctx.configDir;
        seenWorktree = ctx.repoRoot;
        // Evaluated here, not after the tick: a singleton worktree is torn
        // down before `tick()` returns.
        promptResolves = existsSync(join(ctx.configDir, "prompt.md"));
        return Promise.resolve({ ok: true, message: "captured" });
      },
    };

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [capture],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/out.ts", "ok\n", "plan: derive");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();
    expect(outcome.result?.committed).toBe(true);
    // Non-vacuity: the captured values come from a gate that actually ran,
    // not from a never-invoked `undefined`.
    expect(gateRan).toBe(true);
    expect(seenConfigDir).toBeDefined();
    expect(seenWorktree).toBeDefined();
    // The gate really did run somewhere other than the primary checkout —
    // otherwise the rebase under test would be a no-op either way.
    expect(seenWorktree).not.toBe(fx.repo);
    return {
      configDir: seenConfigDir as string,
      worktree: seenWorktree as string,
      promptResolves,
    };
  }

  /** Track a config dir at `rel` so the worktree checkout carries its mirror. */
  async function commitConfigDir(rel: string): Promise<string> {
    const dir = join(fx.repo, rel);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "prompt.md"), "dummy prompt\n", "utf8");
    await exec("git", ["add", "--", rel], { cwd: fx.repo });
    await exec("git", ["commit", "-q", "-m", `add ${rel}`], { cwd: fx.repo });
    return dir;
  }

  it("passes a configDir relocated outside the repo through verbatim — no worktree mirror exists to rebase onto", async () => {
    // `fx.configDir` is its own tmpdir, a sibling of the repo: `relative()`
    // from repoRoot climbs out via `..`, so a bare join yields
    // `<worktree>/../../flume-dispatcher-cfg-XXXX`, which from a worktree
    // nested two levels deep under `.flume/worktrees/` normalizes onto a
    // path that holds nothing.
    const seen = await captureAfterCommitConfigDir(fx.configDir);

    expect(seen.configDir).toBe(fx.configDir);
    // The verbatim path is the real config dir, prompt file and all — the
    // property the rebased one loses.
    expect(seen.promptResolves).toBe(true);
  });

  it("rebases the default in-repo configDir onto the worktree", async () => {
    const cfg = await commitConfigDir(".flume");

    const seen = await captureAfterCommitConfigDir(cfg);

    expect(seen.configDir).toBe(join(seen.worktree, ".flume"));
    expect(seen.configDir).not.toBe(cfg);
    expect(seen.promptResolves).toBe(true);
  });

  it("rebases a configDir relocated within the repo onto the worktree, at its own offset", async () => {
    const cfg = await commitConfigDir("cfg");

    const seen = await captureAfterCommitConfigDir(cfg);

    expect(seen.configDir).toBe(join(seen.worktree, "cfg"));
    expect(seen.configDir).not.toBe(cfg);
    expect(seen.promptResolves).toBe(true);
  });
});

describe("Dispatcher — GateContext.touchedPaths (GATECONTEXT-TOUCHED-PATHS-DEDUP)", () => {
  it("singleton tick: every afterCommit gate receives the identical touchedPaths array for the commit", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    let firstTouched: string[] | undefined;
    let secondTouched: string[] | undefined;
    const gateA: Gate = {
      name: "capture-touched-a",
      when: "afterCommit",
      run(ctx) {
        firstTouched = ctx.touchedPaths;
        return Promise.resolve({ ok: true, message: "captured" });
      },
    };
    const gateB: Gate = {
      name: "capture-touched-b",
      when: "afterCommit",
      run(ctx) {
        secondTouched = ctx.touchedPaths;
        return Promise.resolve({ ok: true, message: "captured" });
      },
    };

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [gateA, gateB],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/out.ts", "ok\n", "plan: derive");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    await dispatcher.tick();

    expect(firstTouched).toEqual(["src/out.ts"]);
    // Same array instance reaches both gates — computed once before the
    // loop, not re-derived (shelled out to git) per gate.
    expect(secondTouched).toBe(firstTouched);
  });

  it("fanout tick: afterCommit and afterMerge gates both see the commit's touched paths, each loop's own shared computation", async () => {
    await writePending(fx.repo, [makeEntry("TP-FANOUT", ["src/tp.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    let commitTouched: string[] | undefined;
    const captureCommit: Gate = {
      name: "capture-commit-touched",
      when: "afterCommit",
      run(ctx) {
        commitTouched = ctx.touchedPaths;
        return Promise.resolve({ ok: true, message: "captured" });
      },
    };

    let mergeTouched: string[] | undefined;
    const captureMerge: Gate = {
      name: "capture-merge-touched",
      when: "afterMerge",
      run(ctx) {
        mergeTouched = ctx.touchedPaths;
        return Promise.resolve({ ok: true, message: "captured" });
      },
    };

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [captureCommit, captureMerge],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "tp-fanout": async (cwd) => {
        await writeAndCommit(
          cwd,
          "src/tp.ts",
          "ok\n",
          "build(TP-FANOUT): ship",
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual(["TP-FANOUT"]);
    expect(commitTouched).toEqual(["src/tp.ts"]);
    expect(mergeTouched).toEqual(["src/tp.ts"]);
  });
});

describe("Dispatcher — Chain.friction load-time validation", () => {
  it("rejects an absolute-path friction declaration with a usage-shaped error", async () => {
    const cfg = await mkTempDir("flume-cfg-friction-abs-");
    try {
      const abs = resolve(tmpdir(), "flume-friction-abs-target");
      await writeMinimalChain(cfg, { friction: abs });

      await expect(loadChainModule(chainPaths(cfg))).rejects.toThrow(
        /friction .* as an absolute path/,
      );
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  });

  // The chain is a plugin, not a consumer.
  //
  // The assertion is **identity** (`toBe`), and that is the whole point: a
  // chain that resolved its own second copy of the engine would hand back
  // objects structurally identical to these, so a deep-equal check would
  // pass under exactly the condition this section exists to prevent. Only
  // reference equality distinguishes "the engine handed me its gate" from
  // "I resolved a gate that looks like it".
  it("hands the chain factory the identity-same engine objects the dispatcher holds", async () => {
    const cfg = await mkTempDir("flume-cfg-api-identity-");
    try {
      await mkdir(cfg, { recursive: true });
      await writeFile(join(cfg, "prompt.md"), "dummy\n", "utf8");
      // The factory stashes what it was handed on the returned chain, so the
      // test can compare against the engine's own exports.
      await writeFile(
        join(cfg, "chain.ts"),
        `export default (api) => ({ chain: { phases: [{ name: "build", ` +
          `description: "", promptPath: "prompt.md", concurrency: "singleton", ` +
          `writablePaths: ["**"], gates: [api.tscGate], handoff: () => [] }], ` +
          `humanOnly: [] } });\n`,
        "utf8",
      );

      const mod = await loadChainModule(chainPaths(cfg));

      const gate = mod.chain.phases[0]!.gates[0];
      expect(gate).toBeDefined();
      expect(gate).toBe(realTscGate);
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  });

  // The error classes a chain branches on with
  // `instanceof` must ride the api parameter too, or a chain catching one
  // has no way to identify it without a value import of its own. The
  // factory stashes each into the phase's gates[] (a real ChainModule
  // field that survives `loadChainModule`'s return, unlike an ad hoc key)
  // so the test can compare against the engine's own exports by reference.
  it("hands the chain factory the identity-same error classes the engine throws", async () => {
    const cfg = await mkTempDir("flume-cfg-api-errors-");
    try {
      await mkdir(cfg, { recursive: true });
      await writeFile(join(cfg, "prompt.md"), "dummy\n", "utf8");
      await writeFile(
        join(cfg, "chain.ts"),
        `export default (api) => ({ chain: { phases: [{ name: "build", ` +
          `description: "", promptPath: "prompt.md", concurrency: "singleton", ` +
          `writablePaths: ["**"], gates: [api.CjsContextLoadError, ` +
          `api.PendingParseFailure, api.InlineExecRenderError, ` +
          `api.TipClaimHeldError], handoff: () => [] }], humanOnly: [] } });\n`,
        "utf8",
      );

      const mod = await loadChainModule(chainPaths(cfg));

      const gates = mod.chain.phases[0]!.gates;
      expect(gates[0]).toBe(CjsContextLoadError);
      expect(gates[1]).toBe(realPendingParseFailure);
      expect(gates[2]).toBe(realInlineExecRenderError);
      expect(gates[3]).toBe(git.TipClaimHeldError);
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  });

  // Every engine value a chain composes with rides the api param;
  // `readTickVerdicts` is the one that claim doesn't name explicitly but the
  // same rule covers (FLUMEAPI-READTICKVERDICTS-MISSING).
  it("hands the chain factory the identity-same readTickVerdicts the engine exports", async () => {
    const cfg = await mkTempDir("flume-cfg-api-readtickverdicts-");
    try {
      await mkdir(cfg, { recursive: true });
      await writeFile(join(cfg, "prompt.md"), "dummy\n", "utf8");
      await writeFile(
        join(cfg, "chain.ts"),
        `export default (api) => ({ chain: { phases: [{ name: "build", ` +
          `description: "", promptPath: "prompt.md", concurrency: "singleton", ` +
          `writablePaths: ["**"], gates: [api.readTickVerdicts], ` +
          `handoff: () => [] }], humanOnly: [] } });\n`,
        "utf8",
      );

      const mod = await loadChainModule(chainPaths(cfg));

      const gates = mod.chain.phases[0]!.gates;
      expect(gates[0]).toBe(readTickVerdicts);
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  });

  it("refuses a default export that is not a function, naming the migration", async () => {
    const cfg = await mkTempDir("flume-cfg-nonfactory-");
    try {
      await mkdir(cfg, { recursive: true });
      await writeFile(join(cfg, "prompt.md"), "dummy\n", "utf8");
      // The pre-0.11 shape: a Chain object rather than a factory.
      await writeFile(
        join(cfg, "chain.ts"),
        `export default { phases: [{ name: "build", description: "", ` +
          `promptPath: "prompt.md", concurrency: "singleton", ` +
          `writablePaths: ["**"], gates: [], handoff: () => [] }], ` +
          `humanOnly: [] };\n`,
        "utf8",
      );

      await expect(loadChainModule(chainPaths(cfg))).rejects.toThrow(
        /must default-export a chain factory/,
      );
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  });

  it("rejects a friction declaration that resolves outside the state root", async () => {
    const cfg = await mkTempDir("flume-cfg-friction-escape-");
    try {
      await writeMinimalChain(cfg, { friction: "../escaped-friction" });

      await expect(loadChainModule(chainPaths(cfg))).rejects.toThrow(
        /friction .* resolves outside the state root/,
      );
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  });

  it("accepts a valid state-root-relative friction declaration", async () => {
    const cfg = await mkTempDir("flume-cfg-friction-valid-");
    try {
      await writeMinimalChain(cfg, { friction: "friction" });

      const mod = await loadChainModule(chainPaths(cfg));

      expect(mod.chain.friction).toBe("friction");
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  });

  it("treats an undeclared friction field as a strict no-op — chain loads unaffected", async () => {
    const cfg = await mkTempDir("flume-cfg-friction-undeclared-");
    try {
      await writeMinimalChain(cfg);

      const mod = await loadChainModule(chainPaths(cfg));

      expect(mod.chain.friction).toBeUndefined();
      expect(mod.chain.phases).toHaveLength(1);
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  });
});

/**
 * `Chain.pendingDir` is the second consumer of `assertStateRootRelative`
 * (`src/paths.ts`), and the refusal it buys is the queue's containment: a
 * declaration that escapes puts the file every engine read resolves —
 * fanout selection, the wave-end rewrite, `flume status`, `pendingGate` —
 * outside the state root the tick owns. Both legs are pinned here, mirroring
 * the `Chain.friction` block above, so dropping either side of the shared
 * check goes red rather than silently widening where the queue may live
 * (`.claude/rules/engineering.md`, "Loud or nothing").
 */
describe("Dispatcher — Chain.pendingDir load-time validation (spec/pending.md 'The pending queue')", () => {
  it("the chain load refuses a pendingDir declared as an absolute path", async () => {
    const cfg = await mkTempDir("flume-cfg-pendingpath-abs-");
    try {
      const abs = resolve(tmpdir(), "flume-pendingpath-abs-target", "pending.json");
      await writeMinimalChain(cfg, { pendingDir: abs });

      await expect(loadChainModule(chainPaths(cfg))).rejects.toThrow(
        /pendingDir .* as an absolute path/,
      );
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  });

  it("the chain load refuses a pendingDir that resolves outside the state root", async () => {
    const cfg = await mkTempDir("flume-cfg-pendingpath-escape-");
    try {
      await writeMinimalChain(cfg, {
        pendingDir: "../escaped/pending",
      });

      await expect(loadChainModule(chainPaths(cfg))).rejects.toThrow(
        /pendingDir .* resolves outside the state root/,
      );
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  });
});

/**
 * `supervisorPolicy.maxTicks` is how many `flume tick` children the loop
 * supervisor holds at once (`src/Phase.ts`), and the one value in that block
 * whose out-of-range setting is a run that cannot happen: a supervisor that
 * may hold no child starts none, and the flags left standing would come back
 * as an orphaned baton rather than as the declaration that caused it. Refused
 * at the load, where the declaration is (`.claude/rules/engineering.md`,
 * *Loud or nothing*).
 */
describe("Dispatcher — Chain.supervisorPolicy.maxTicks load-time validation (spec/chain.md 'Supervisor policy is a chain-overridable default')", () => {
  const chainDeclaring = (maxTicks: string): string =>
    `export default () => ({ chain: { phases: [{ name: "build", ` +
    `description: "", promptPath: "prompt.md", concurrency: "fanout", ` +
    `writablePaths: ["**"], gates: [], handoff: () => [] }], ` +
    `humanOnly: [], supervisorPolicy: { maxTicks: ${maxTicks} } } });\n`;

  async function chainDir(slug: string, maxTicks: string): Promise<string> {
    const cfg = await mkTempDir(`flume-cfg-maxticks-${slug}-`);
    await mkdir(cfg, { recursive: true });
    await writeFile(join(cfg, "prompt.md"), "dummy\n", "utf8");
    await writeFile(join(cfg, "chain.ts"), chainDeclaring(maxTicks), "utf8");
    return cfg;
  }

  for (const [slug, declared] of [
    ["zero", "0"],
    ["negative", "-1"],
    ["fractional", "1.5"],
  ] as const) {
    it(`the chain load refuses supervisorPolicy.maxTicks declared as ${declared}`, async () => {
      const cfg = await chainDir(slug, declared);
      try {
        await expect(loadChainModule(chainPaths(cfg))).rejects.toThrow(
          /supervisorPolicy\.maxTicks.*must be a positive integer/s,
        );
      } finally {
        await rm(cfg, { recursive: true, force: true });
      }
    });
  }

  it("the chain load accepts a positive integer, and an undeclared maxTicks, alike", async () => {
    const declared = await chainDir("two", "2");
    const undeclaredCfg = await mkTempDir("flume-cfg-maxticks-undeclared-");
    try {
      await writeMinimalChain(undeclaredCfg);

      expect(
        (await loadChainModule(chainPaths(declared))).chain.supervisorPolicy
          ?.maxTicks,
      ).toBe(2);
      // Undeclared stays undeclared: the engine reads an omitted field as
      // "use my default", and a value substituted here would be a second
      // home for it (`.claude/rules/engineering.md`, *Derived state is
      // computed, never restated beside its source*).
      expect(
        (await loadChainModule(chainPaths(undeclaredCfg))).chain
          .supervisorPolicy?.maxTicks,
      ).toBeUndefined();
    } finally {
      await rm(declared, { recursive: true, force: true });
      await rm(undeclaredCfg, { recursive: true, force: true });
    }
  });
});

describe("Dispatcher — dead declaration refused at load (DEADDECL-LOAD-REFUSAL)", () => {
  it("refuses entryChannelPaths declared without scopeWritesToEntry: true, naming the field", async () => {
    const cfg = await mkTempDir("flume-cfg-deaddecl-channel-");
    try {
      await mkdir(cfg, { recursive: true });
      await writeFile(join(cfg, "prompt.md"), "dummy\n", "utf8");
      await writeFile(
        join(cfg, "chain.ts"),
        `export default () => ({ chain: { phases: [{ name: "build", ` +
          `description: "", promptPath: "prompt.md", concurrency: "fanout", ` +
          `writablePaths: ["**"], entryChannelPaths: [".flume/plan/open-questions.md"], ` +
          `gates: [], handoff: () => [] }], humanOnly: [] } });\n`,
        "utf8",
      );

      await expect(loadChainModule(chainPaths(cfg))).rejects.toThrow(
        /'build'.*entryChannelPaths.*scopeWritesToEntry/,
      );
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  });

  it("loads an afterMerge gate on a concurrency: singleton phase — no longer a dead declaration (spec/worktrees.md 'Singleton runs in a worktree')", async () => {
    const cfg = await mkTempDir("flume-cfg-deaddecl-aftermerge-");
    try {
      await mkdir(cfg, { recursive: true });
      await writeFile(join(cfg, "prompt.md"), "dummy\n", "utf8");
      await writeFile(
        join(cfg, "chain.ts"),
        `export default () => ({ chain: { phases: [{ name: "plan", ` +
          `description: "", promptPath: "prompt.md", concurrency: "singleton", ` +
          `writablePaths: ["**"], gates: [{ name: "live-merge-gate", ` +
          `when: "afterMerge", run: async () => ({ ok: true, message: "x" }) }], ` +
          `handoff: () => [] }], humanOnly: [] } });\n`,
        "utf8",
      );

      const mod = await loadChainModule(chainPaths(cfg));

      expect(mod.chain.phases).toHaveLength(1);
      expect(mod.chain.phases[0]!.gates[0]!.when).toBe("afterMerge");
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  });

  it("still loads the two live shapes: entryChannelPaths on a scoped phase, and an afterMerge gate on a fanout phase", async () => {
    const cfg = await mkTempDir("flume-cfg-deaddecl-live-");
    try {
      await mkdir(cfg, { recursive: true });
      await writeFile(join(cfg, "prompt.md"), "dummy\n", "utf8");
      await writeFile(
        join(cfg, "chain.ts"),
        `export default () => ({ chain: { phases: [` +
          `{ name: "build", description: "", promptPath: "prompt.md", ` +
          `concurrency: "fanout", writablePaths: ["**"], entryChannelPaths: [], ` +
          `scopeWritesToEntry: true, gates: [{ name: "live-merge-gate", ` +
          `when: "afterMerge", run: async () => ({ ok: true, message: "x" }) }], ` +
          `handoff: () => [] }` +
          `], humanOnly: [] } });\n`,
        "utf8",
      );

      const mod = await loadChainModule(chainPaths(cfg));

      expect(mod.chain.phases).toHaveLength(1);
      expect(mod.chain.phases[0]!.entryChannelPaths).toEqual([]);
      expect(mod.chain.phases[0]!.gates[0]!.when).toBe("afterMerge");
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  });
});

/**
 * A CJS-context host (package.json lacking `"type": "module"`)
 * must refuse chain load with a usage-shaped `CjsContextLoadError`, not
 * relay tsx's raw loader stack. Two empirical signatures (build's own
 * `isCjsContextLoadFailure` (`src/chainLoad.ts`)): tsx 4.21's CJS-fallback
 * parse failure ("Cannot use import statement outside a module") — real,
 * this installed tsx (4.21.0) reproduces it directly — and tsx 4.23's
 * `ERR_MODULE_NOT_FOUND` against a path carrying its `?namespace=` query,
 * which this installed tsx never emits on its own and so is exercised via
 * the `tsx/esm/api` partial mock declared at the top of this file. That
 * query arrives in either spelling — a win32 consumer reported the literal
 * one, node percent-encodes it where the specifier round-tripped through a
 * URL — so each spelling gets its own case. A final case proves the
 * detector isn't trigger-happy: a genuinely missing dependency (plain
 * `ERR_MODULE_NOT_FOUND`, no namespace artifact) must surface unshadowed.
 */
describe("Dispatcher — CJS-context host chain-load refusal", () => {
  async function writeCfg(cfg: string, chainSrc: string): Promise<void> {
    await writeFile(join(cfg, "chain.ts"), chainSrc, "utf8");
  }

  it("tsx 4.21 signature — a CJS-context package.json plus a real import statement throws CjsContextLoadError naming the fix", async () => {
    const cfg = await mkTempDir("flume-cfg-cjs-import-");
    try {
      // Explicit "commonjs" (not merely absent "type") is what actually
      // routes tsx into its CJS-fallback parse path — verified by hand
      // against this installed tsx before locking the test.
      await writeFile(
        join(cfg, "package.json"),
        JSON.stringify({ name: "cjs-host", type: "commonjs" }),
        "utf8",
      );
      await writeCfg(
        cfg,
        `import { join as pathJoin } from "node:path";\nexport default { pathJoin };\n`,
      );

      await expect(loadChainModule(chainPaths(cfg))).rejects.toMatchObject({
        name: "CjsContextLoadError",
        message: expect.stringContaining('"type": "module"'),
      });
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  });

  it("tsx 4.23 signature — ERR_MODULE_NOT_FOUND with a percent-encoded ?namespace= query throws CjsContextLoadError naming the fix", async () => {
    const cfg = await mkTempDir("flume-cfg-cjs-namespace-");
    try {
      await writeCfg(cfg, `export default {};\n`);
      const namespaceErr = Object.assign(
        new Error(
          `Cannot find module '${join(cfg, "chain.ts")}%3Fnamespace%3D1234567890' ` +
            `imported from somewhere`,
        ),
        { code: "ERR_MODULE_NOT_FOUND" },
      );
      vi.mocked(tsImport).mockRejectedValueOnce(namespaceErr);

      await expect(loadChainModule(chainPaths(cfg))).rejects.toMatchObject({
        name: "CjsContextLoadError",
        message: expect.stringContaining('"type": "module"'),
      });
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  });

  it("tsx 4.23 signature — ERR_MODULE_NOT_FOUND with a literal ?namespace= query throws CjsContextLoadError naming the fix", async () => {
    const cfg = await mkTempDir("flume-cfg-cjs-namespace-literal-");
    try {
      await writeCfg(cfg, `export default {};\n`);
      // The spelling the win32 consumer reported on 0.17.0: the resolver
      // names the specifier as tsx appended it, unencoded.
      const namespaceErr = Object.assign(
        new Error(
          `Cannot find module '${join(cfg, "chain.ts")}?namespace=1234567890' ` +
            `imported from somewhere`,
        ),
        { code: "ERR_MODULE_NOT_FOUND" },
      );
      vi.mocked(tsImport).mockRejectedValueOnce(namespaceErr);

      await expect(loadChainModule(chainPaths(cfg))).rejects.toMatchObject({
        name: "CjsContextLoadError",
        message: expect.stringContaining('"type": "module"'),
      });
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  });

  it("a genuinely missing dependency (plain ERR_MODULE_NOT_FOUND, no namespace-query artifact) passes through unchanged", async () => {
    const cfg = await mkTempDir("flume-cfg-cjs-genuine-");
    try {
      await writeCfg(
        cfg,
        `import { missing } from "./does-not-exist.js";\nexport default { missing };\n`,
      );

      let caught: unknown;
      try {
        await loadChainModule(chainPaths(cfg));
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(CjsContextLoadError);
      expect((caught as NodeJS.ErrnoException).code).toBe("ERR_MODULE_NOT_FOUND");
      expect((caught as Error).message).toContain("does-not-exist");
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  });
});

/**
 * Teardown harvest. Only the engine is present when a fanout
 * worktree dies, so wave-end teardown must move a worktree-local friction
 * note into the primary friction dir, tag-prefixed, before the worktree is
 * removed. Content-opaque: files only, no read of contents.
 */
describe("Dispatcher fanout — teardown friction harvest", () => {
  it("moves worktree-local friction files into the primary dir, tag-prefixed, before worktree removal", async () => {
    await writePending(fx.repo, [makeEntry("FRICTION-A", ["src/friction-a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout" });
    const chain: Chain = { phases: [phase], humanOnly: [], friction: "friction" };

    const agent = fanoutAgent({
      "friction-a": async (cwd) => {
        await mkdir(join(cwd, ".flume", "friction"), { recursive: true });
        await writeFile(
          join(cwd, ".flume", "friction", "note.md"),
          "the loop wants owner input\n",
        );
        await writeAndCommit(
          cwd,
          "src/friction-a.ts",
          "ok\n",
          "build(FRICTION-A): ship",
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();
    expect(outcome.result?.shippedTags).toEqual(["FRICTION-A"]);

    const frictionDir = join(fx.repo, ".flume", "friction");
    const files = await readdir(frictionDir);
    expect(files.length).toBe(1);
    // Tag-prefixed, timestamp-stamped, source-filename-suffixed — the stamp
    // is what makes a same-named retry land beside this file instead of
    // overwriting it.
    expect(files[0]).toMatch(/^FRICTION-A--\d{4}-\d{2}-\d{2}T.*--note\.md$/);
    expect(await readFile(join(frictionDir, files[0]!), "utf8")).toBe(
      "the loop wants owner input\n",
    );

    // Harvested out before removal — the worktree itself is fully gone.
    expect(
      existsSync(join(fx.repo, ".flume", "worktrees", "friction-a")),
    ).toBe(false);
  });

  it("a per-file harvest failure logs and continues rather than aborting the wave", async () => {
    await writePending(fx.repo, [makeEntry("FRICTION-B", ["src/friction-b.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout" });
    const chain: Chain = { phases: [phase], humanOnly: [], friction: "friction" };

    const primaryFrictionDir = join(fx.repo, ".flume", "friction");
    // The destination filename is now stamped (this entry) with the tick's
    // clock, so a frozen clock is what makes the exact destination
    // predictable enough to pre-seed a collision at it.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    const destName = "FRICTION-B--2024-01-01T00-00-00-000Z--note.md";
    // Pre-seed a directory at the exact destination the harvest would rename
    // into — rename(file, existing-dir) fails deterministically, standing in
    // for the locked-file / unreadable-dir class the harvest calls out.
    await mkdir(join(primaryFrictionDir, destName), {
      recursive: true,
    });

    const warnings: string[] = [];
    const log: Logger = {
      info: () => {},
      warn: (l) => warnings.push(l),
      error: () => {},
    };

    const agent = fanoutAgent({
      "friction-b": async (cwd) => {
        await mkdir(join(cwd, ".flume", "friction"), { recursive: true });
        await writeFile(join(cwd, ".flume", "friction", "note.md"), "blocked\n");
        await writeAndCommit(
          cwd,
          "src/friction-b.ts",
          "ok\n",
          "build(FRICTION-B): ship",
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log,
    });

    let outcome: Awaited<ReturnType<typeof dispatcher.tick>>;
    try {
      outcome = await dispatcher.tick();
    } finally {
      vi.useRealTimers();
    }

    // The wave still ships despite the harvest failure.
    expect(outcome.result?.shippedTags).toEqual(["FRICTION-B"]);
    expect(warnings.some((w) => w.includes("note.md"))).toBe(true);
    // The pre-seeded destination is untouched — the failed move left it as-is.
    expect(
      existsSync(join(primaryFrictionDir, destName)),
    ).toBe(true);
  });

  it("an unreadable friction dir is logged, not silently swallowed", async () => {
    await writePending(fx.repo, [makeEntry("FRICTION-C", ["src/friction-c.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout" });
    const chain: Chain = { phases: [phase], humanOnly: [], friction: "friction" };

    const warnings: string[] = [];
    const log: Logger = {
      info: () => {},
      warn: (l) => warnings.push(l),
      error: () => {},
    };

    const agent = fanoutAgent({
      "friction-c": async (cwd) => {
        // Stand in for an unreadable dir (permissions, mid-write race, etc.):
        // a plain *file* at the mirror path means `readdir` on it rejects
        // with ENOTDIR rather than the absent-dir ENOENT the harvest treats
        // as a silent no-op.
        await mkdir(join(cwd, ".flume"), { recursive: true });
        await writeFile(join(cwd, ".flume", "friction"), "not a directory\n");
        await writeAndCommit(
          cwd,
          "src/friction-c.ts",
          "ok\n",
          "build(FRICTION-C): ship",
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log,
    });

    const outcome = await dispatcher.tick();

    // The wave still ships — harvest failure must not abort it.
    expect(outcome.result?.shippedTags).toEqual(["FRICTION-C"]);
    expect(
      warnings.some((w) => w.includes("friction harvest") && w.includes("could not read")),
    ).toBe(true);
    // Nothing landed in the primary dir — there was nothing readable to move.
    expect(existsSync(join(fx.repo, ".flume", "friction"))).toBe(false);
  });

  it("an undeclared chain.friction is a no-op — no primary friction dir is created", async () => {
    await writePending(fx.repo, [makeEntry("FRICTION-D", ["src/friction-d.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout" });
    // No `friction` field on the chain — the harvest is entirely off.
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "friction-d": async (cwd) => {
        // Even if a worktree happens to hold a dir at the conventional
        // path, an undeclared channel must not be harvested.
        await mkdir(join(cwd, ".flume", "friction"), { recursive: true });
        await writeFile(join(cwd, ".flume", "friction", "note.md"), "orphan\n");
        await writeAndCommit(
          cwd,
          "src/friction-d.ts",
          "ok\n",
          "build(FRICTION-D): ship",
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual(["FRICTION-D"]);
    expect(existsSync(join(fx.repo, ".flume", "friction"))).toBe(false);
  });

  it("a relocated state root has no worktree-local mirror to harvest from — no-op", async () => {
    const dock = await mkTempDir("flume-dock-friction-");
    try {
      const pendingDir = join(dock, "plan", "pending");
      await mkdir(pendingDir, { recursive: true });
      await writeFile(
        join(pendingDir, entryFileName("FRICTION-E")),
        JSON.stringify(makeEntry("FRICTION-E", ["src/friction-e.ts"]), null, 2) +
          "\n",
        "utf8",
      );
      new Baton(dock).wake("build");

      const phase = makePhase({ name: "build", concurrency: "fanout" });
      const chain: Chain = { phases: [phase], humanOnly: [], friction: "friction" };

      const agent = fanoutAgent({
        "friction-e": async (cwd) => {
          // A worktree still has *a* `.flume/friction` under its own
          // repo-relative path, but the state root itself resolves outside
          // the repo tree — there is no mirror at the relocated dock path
          // for the harvest to read.
          await mkdir(join(cwd, ".flume", "friction"), { recursive: true });
          await writeFile(
            join(cwd, ".flume", "friction", "note.md"),
            "unreachable\n",
          );
          await writeAndCommit(
            cwd,
            "src/friction-e.ts",
            "ok\n",
            "build(FRICTION-E): ship",
          );
        },
      });

      const dispatcher = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        flumeDir: dock,
        agent,
        log: silent,
      });

      const outcome = await dispatcher.tick();

      expect(outcome.result?.shippedTags).toEqual(["FRICTION-E"]);
      expect(existsSync(join(dock, "friction"))).toBe(false);
      expect(existsSync(join(fx.repo, ".flume"))).toBe(false);
    } finally {
      await rm(dock, { recursive: true, force: true });
    }
  });

  it("two harvests for the same tag with the same agent-chosen source filename land as two distinct files, neither overwriting the other", async () => {
    const phase = makePhase({ name: "build", concurrency: "fanout" });
    const chain: Chain = { phases: [phase], humanOnly: [], friction: "friction" };
    const frictionDir = join(fx.repo, ".flume", "friction");

    // Two separate waves for the same tag (a re-derived retry, or simply the
    // tag recurring), each writing a friction note under one identical
    // agent-chosen filename. Frozen at two distinct instants so the resulting
    // stamps are deterministic and provably different — the collision this
    // entry closes is exactly two such notes landing on the same destination.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
      await writePending(fx.repo, [
        makeEntry("FRICTION-RETRY", ["src/friction-retry.ts"]),
      ]);
      new Baton(join(fx.repo, ".flume")).wake("build");

      const agentFirst = fanoutAgent({
        "friction-retry": async (cwd) => {
          await mkdir(join(cwd, ".flume", "friction"), { recursive: true });
          await writeFile(
            join(cwd, ".flume", "friction", "note.md"),
            "first attempt's note\n",
          );
          await writeAndCommit(
            cwd,
            "src/friction-retry.ts",
            "one\n",
            "build(FRICTION-RETRY): first attempt",
          );
        },
      });

      const dispatcherFirst = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        agent: agentFirst,
        log: silent,
      });
      const outcomeFirst = await dispatcherFirst.tick();
      expect(outcomeFirst.result?.shippedTags).toEqual(["FRICTION-RETRY"]);

      vi.setSystemTime(new Date("2024-01-02T00:00:00.000Z"));
      // Land as a plan tick would — `writePending` commits it, so wave 2's
      // rewrite (which reverts pending.json back to `[]`, byte-identical to
      // wave 1's ship commit) has a real diff against HEAD to commit.
      await writePending(fx.repo, [
        makeEntry("FRICTION-RETRY", ["src/friction-retry-2.ts"]),
      ]);
      new Baton(join(fx.repo, ".flume")).wake("build");

      const agentSecond = fanoutAgent({
        "friction-retry": async (cwd) => {
          await mkdir(join(cwd, ".flume", "friction"), { recursive: true });
          await writeFile(
            join(cwd, ".flume", "friction", "note.md"),
            "second attempt's note\n",
          );
          await writeAndCommit(
            cwd,
            "src/friction-retry-2.ts",
            "two\n",
            "build(FRICTION-RETRY): second attempt",
          );
        },
      });

      const dispatcherSecond = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        agent: agentSecond,
        log: silent,
      });
      const outcomeSecond = await dispatcherSecond.tick();
      expect(outcomeSecond.result?.shippedTags).toEqual(["FRICTION-RETRY"]);
    } finally {
      vi.useRealTimers();
    }

    const files = (await readdir(frictionDir)).sort();
    expect(files.length).toBe(2);
    for (const f of files) {
      expect(f).toMatch(/^FRICTION-RETRY--\d{4}-\d{2}-\d{2}T.*--note\.md$/);
    }
    // Distinct destinations — neither harvest overwrote the other.
    expect(files[0]).not.toBe(files[1]);

    const contents = await Promise.all(
      files.map((f) => readFile(join(frictionDir, f), "utf8")),
    );
    expect(contents).toContain("first attempt's note\n");
    expect(contents).toContain("second attempt's note\n");
  });

  it("a friction note the tick's own agent commits is harvested zero times, not delivered twice under a stamped name (dispatcher-worktree-harvest-tracked-at-head)", async () => {
    await writePending(fx.repo, [makeEntry("FRICTION-D", ["src/friction-d.ts"])]);
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout" });
    const chain: Chain = { phases: [phase], humanOnly: [], friction: "friction" };
    const frictionDir = join(fx.repo, ".flume", "friction");

    const agentFirst = fanoutAgent({
      "friction-d": async (cwd) => {
        // Against convention: the agent commits its friction note instead
        // of leaving it untracked. That commit is itself the delivery — a
        // harvested copy under a stamped name would be a duplicate the
        // operator has to reconcile by hand.
        await writeAndCommit(
          cwd,
          ".flume/friction/note.md",
          "the loop wants owner input\n",
          "chore: friction note",
        );
        await writeAndCommit(
          cwd,
          "src/friction-d.ts",
          "ok\n",
          "build(FRICTION-D): ship",
        );
      },
    });

    const dispatcherFirst = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: agentFirst,
      log: silent,
    });

    const first = await dispatcherFirst.tick();
    expect(first.result?.shippedTags).toEqual(["FRICTION-D"]);

    // The committed note landed on trunk as tracked content...
    expect(
      await readFile(join(frictionDir, "note.md"), "utf8"),
    ).toBe("the loop wants owner input\n");
    // ...and nothing else — no FRICTION-D--stamped duplicate. The note was
    // tracked at the worktree's own HEAD (this tick's agent committed it),
    // so the tracked-at-HEAD bound left it unharvested.
    const afterFirst = await readdir(frictionDir);
    expect(afterFirst).toEqual(["note.md"]);

    // A sibling entry lands in a later wave, as a plan tick would. Its
    // worktree branches from the new trunk tip, so its checkout inherits the
    // harvested note as ordinary tracked content — not anything its own agent
    // produced this tick.
    const afterFirstPending = readPendingFromDisk(fx.repo);
    await writePending(fx.repo, [
      ...afterFirstPending,
      makeEntry("FRICTION-E", ["src/friction-e.ts"]),
    ]);
    baton.wake("build");

    const agentSecond = fanoutAgent({
      "friction-e": (cwd) =>
        writeAndCommit(
          cwd,
          "src/friction-e.ts",
          "ok\n",
          "build(FRICTION-E): ship",
        ),
    });

    const dispatcherSecond = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: agentSecond,
      log: silent,
    });

    const second = await dispatcherSecond.tick();
    expect(second.result?.shippedTags).toEqual(["FRICTION-E"]);

    // Unchanged: the inherited note is left in place, not re-copied with a
    // FRICTION-E-- prefix.
    const afterSecond = await readdir(frictionDir);
    expect(afterSecond.sort()).toEqual(afterFirst.sort());
    expect(afterSecond.some((f) => f.startsWith("FRICTION-E--"))).toBe(false);
  });

  it("a readFileAtRef failure during the tracked-at-HEAD probe is logged and does not abort teardown of the wave's remaining worktrees", async () => {
    await writePending(fx.repo, [
      makeEntry("FRICTION-PROBE-1", ["src/friction-probe-1.ts"]),
      makeEntry("FRICTION-PROBE-2", ["src/friction-probe-2.ts"]),
    ]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout" });
    const chain: Chain = { phases: [phase], humanOnly: [], friction: "friction" };
    const frictionDir = join(fx.repo, ".flume", "friction");

    const warnings: string[] = [];
    const log: Logger = {
      info: () => {},
      warn: (l) => warnings.push(l),
      error: () => {},
    };

    // Only the tracked-at-HEAD probe against a worktree's own friction
    // mirror fails — every other readFileAtRef call (pending.json's HEAD
    // read, the second worktree's probe) runs for real. The first probe
    // call is the one under test; teardown processes worktrees in batch
    // order, so it lands on FRICTION-PROBE-1.
    const realReadFileAtRef = git.readFileAtRef;
    let frictionProbeCalls = 0;
    const readFileAtRefSpy = vi
      .spyOn(git, "readFileAtRef")
      .mockImplementation(async (repoRoot, ref, relPath) => {
        if (relPath.endsWith(join("friction", "note.md"))) {
          frictionProbeCalls++;
          if (frictionProbeCalls === 1) {
            throw new Error("simulated git failure");
          }
        }
        return realReadFileAtRef(repoRoot, ref, relPath);
      });

    const agent = fanoutAgent({
      "friction-probe-1": async (cwd) => {
        await mkdir(join(cwd, ".flume", "friction"), { recursive: true });
        await writeFile(
          join(cwd, ".flume", "friction", "note.md"),
          "probe-1\n",
        );
        await writeAndCommit(
          cwd,
          "src/friction-probe-1.ts",
          "ok\n",
          "build(FRICTION-PROBE-1): ship",
        );
      },
      "friction-probe-2": async (cwd) => {
        await mkdir(join(cwd, ".flume", "friction"), { recursive: true });
        await writeFile(
          join(cwd, ".flume", "friction", "note.md"),
          "probe-2\n",
        );
        await writeAndCommit(
          cwd,
          "src/friction-probe-2.ts",
          "ok\n",
          "build(FRICTION-PROBE-2): ship",
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log,
    });

    let outcome: Awaited<ReturnType<typeof dispatcher.tick>>;
    try {
      outcome = await dispatcher.tick();
    } finally {
      readFileAtRefSpy.mockRestore();
    }

    // Both entries still ship — a probe failure on one candidate must not
    // fail the entries whose commits already landed.
    expect(outcome.result?.shippedTags?.slice().sort()).toEqual([
      "FRICTION-PROBE-1",
      "FRICTION-PROBE-2",
    ]);
    expect(
      warnings.some(
        (w) => w.includes("friction harvest") && w.includes("could not probe HEAD"),
      ),
    ).toBe(true);

    // Teardown of both worktrees proceeded despite the first one's probe
    // failure.
    expect(
      existsSync(join(fx.repo, ".flume", "worktrees", "friction-probe-1")),
    ).toBe(false);
    expect(
      existsSync(join(fx.repo, ".flume", "worktrees", "friction-probe-2")),
    ).toBe(false);

    // The probe-failed candidate is left unharvested (fail-closed); the
    // sibling whose probe succeeded is delivered normally.
    const files = await readdir(frictionDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^FRICTION-PROBE-2--/);
  });
});

/**
 * Revert note. Only the engine is present when an afterCommit
 * gate discards a fanout entry's commit, so it must write the operator's
 * copy of the verdict — the gate's own name/message/details plus the
 * reverted commit's subject+body — to the primary friction dir before
 * `dropLastCommit` erases the evidence. Undeclared `chain.friction` keeps
 * the note off; a note-write failure must never block the revert itself.
 */
describe("Dispatcher fanout — revert note to the friction channel", () => {
  it("an afterCommit gate revert with Chain.friction declared writes a dated note carrying the gate's verdict and the reverted commit's subject+body", async () => {
    await writePending(fx.repo, [makeEntry("REVERT-NOTE-A", ["src/rna.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const failing: Gate = {
      name: "boom-gate",
      when: "afterCommit",
      async run() {
        return {
          ok: false,
          message: "boom said no",
          details: "boom-details-123",
        };
      },
    };
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [failing],
    });
    const chain: Chain = {
      phases: [phase],
      humanOnly: [],
      friction: "friction",
    };

    const agent = fanoutAgent({
      "revert-note-a": async (cwd) => {
        await writeAndCommit(
          cwd,
          "src/rna.ts",
          "ok\n",
          "build(REVERT-NOTE-A): ship\n\nThis is the body of the commit.",
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    // Whole-commit revert: nothing shipped, the entry stays pending.
    expect(outcome.result?.shippedTags).toEqual([]);
    expect((readPendingFromDisk(fx.repo)).map((e) => e.tag)).toEqual([
      "REVERT-NOTE-A",
    ]);

    const frictionDir = join(fx.repo, ".flume", "friction");
    const files = await readdir(frictionDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(
      /^\d{4}-\d{2}-\d{2}T.*--REVERT-NOTE-A--reverted\.md$/,
    );

    const note = await readFile(join(frictionDir, files[0]!), "utf8");
    expect(note).toContain("boom-gate");
    expect(note).toContain("boom said no");
    expect(note).toContain("boom-details-123");
    expect(note).toContain("build(REVERT-NOTE-A): ship");
    expect(note).toContain("This is the body of the commit.");
  });

  it("a write-gate revert (entry-scope stray path) carries the offending path list in the note's details", async () => {
    await writePending(fx.repo, [makeEntry("REVERT-NOTE-B", ["src/rnb.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      scopeWritesToEntry: true,
    });
    const chain: Chain = {
      phases: [phase],
      humanOnly: [],
      friction: "friction",
    };

    const agent = fanoutAgent({
      "revert-note-b": async (cwd) => {
        // A stray sibling inside the phase's writablePaths but outside the
        // entry's declared files — the built-in writable-paths gate reverts
        // this, and the note calls out the write-gate's offending path list.
        await writeFile(join(cwd, "src", "rnb.ts"), "ok\n");
        await writeFile(join(cwd, "src", "stray.ts"), "stray\n");
        await exec("git", ["add", "."], { cwd });
        await exec(
          "git",
          ["commit", "-q", "-m", "build(REVERT-NOTE-B): overreach"],
          { cwd },
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual([]);

    const frictionDir = join(fx.repo, ".flume", "friction");
    const files = await readdir(frictionDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/--REVERT-NOTE-B--reverted\.md$/);

    const note = await readFile(join(frictionDir, files[0]!), "utf8");
    expect(note).toContain("writable-paths");
    expect(note).toContain(
      "src/stray.ts (inside phase writablePaths but outside",
    );
    expect(note).not.toContain("- src/rnb.ts");
    expect(note).toContain("build(REVERT-NOTE-B): overreach");
  });

  it("an undeclared Chain.friction is a no-op — no note is written on revert", async () => {
    await writePending(fx.repo, [makeEntry("REVERT-NOTE-C", ["src/rnc.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const failing: Gate = {
      name: "boom-gate",
      when: "afterCommit",
      async run() {
        return { ok: false, message: "boom said no", details: "d" };
      },
    };
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [failing],
    });
    // No `friction` field on the chain — the revert note is entirely off.
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "revert-note-c": async (cwd) => {
        await writeAndCommit(
          cwd,
          "src/rnc.ts",
          "ok\n",
          "build(REVERT-NOTE-C): ship",
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual([]);
    expect(existsSync(join(fx.repo, ".flume", "friction"))).toBe(false);
  });

  it("a note-write failure (unwritable friction dir) logs and does not block the revert", async () => {
    await writePending(fx.repo, [makeEntry("REVERT-NOTE-D", ["src/rnd.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    // Pre-seed a plain file at the exact primary friction dir path so the
    // note write's `mkdir(primaryDir, { recursive: true })` fails — standing
    // in for the locked-dir/permission class the note write calls out.
    await mkdir(join(fx.repo, ".flume"), { recursive: true });
    await writeFile(join(fx.repo, ".flume", "friction"), "not a directory\n");

    const failing: Gate = {
      name: "boom-gate",
      when: "afterCommit",
      async run() {
        return { ok: false, message: "boom said no", details: "d" };
      },
    };
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [failing],
    });
    const chain: Chain = {
      phases: [phase],
      humanOnly: [],
      friction: "friction",
    };

    const warnings: string[] = [];
    const log: Logger = {
      info: () => {},
      warn: (l) => warnings.push(l),
      error: () => {},
    };

    const agent = fanoutAgent({
      "revert-note-d": async (cwd) => {
        await writeAndCommit(
          cwd,
          "src/rnd.ts",
          "ok\n",
          "build(REVERT-NOTE-D): ship",
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log,
    });

    const outcome = await dispatcher.tick();

    // The revert still proceeds despite the note-write failure.
    expect(outcome.result?.shippedTags).toEqual([]);
    expect((readPendingFromDisk(fx.repo)).map((e) => e.tag)).toEqual([
      "REVERT-NOTE-D",
    ]);
    expect(
      warnings.some(
        (w) =>
          w.includes("REVERT-NOTE-D") &&
          w.includes("revert note write failed"),
      ),
    ).toBe(true);
  });

  // Runs on every platform: createWorktree derives the fanout
  // worktree directory from a length-bounded name, not the raw tag slug, so
  // a TAG_MAX_LENGTH tag no longer hits git's own ~200-char win32 worktree-
  // path refusal ("fatal: '$GIT_DIR' too big"). The fanoutAgent key below
  // is `worktreeDirName(tag)` — the bounded directory name — not the raw
  // slug the tag would otherwise produce.
  it("a gate-revert on the longest tag parsePendingQueue accepts writes a revert-note filename within NAME_MAX — the schema's ceiling driven through the real writer (TAG-LENGTH-BOUND-AGREEMENT-PIN)", async () => {
    const tag = "A".repeat(TAG_MAX_LENGTH);
    await writePending(fx.repo, [makeEntry(tag, ["src/tag-len.ts"])]);
    // The real reader accepts the boundary tag — a value one over would
    // fail TAG_PATTERN and never reach the writer this test pins.
    expect((readPendingFromDisk(fx.repo)).map((e) => e.tag)).toEqual([
      tag,
    ]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const failing: Gate = {
      name: "boom-gate",
      when: "afterCommit",
      async run() {
        return { ok: false, message: "boom said no", details: "d" };
      },
    };
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [failing],
    });
    const chain: Chain = {
      phases: [phase],
      humanOnly: [],
      friction: "friction",
    };

    const dirName = worktreeDirName(tag);
    const agent = fanoutAgent({
      [dirName]: async (cwd) => {
        await writeAndCommit(
          cwd,
          "src/tag-len.ts",
          "ok\n",
          `build(${tag}): ship`,
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();
    expect(outcome.result?.shippedTags).toEqual([]);

    // The real writer, driven by the real schema's own accepted maximum: if
    // either side's arithmetic moves without the other, writeRevertNote's
    // filename exceeds NAME_MAX, the write throws, and no note lands.
    const frictionDir = join(fx.repo, ".flume", "friction");
    const files = await readdir(frictionDir);
    expect(files.length).toBe(1);
    expect(files[0]!.length).toBeLessThanOrEqual(255);
    expect(files[0]).toContain(tag);
  });

  it("two tags sharing a long common prefix provision distinct worktree directories (WORKTREE-DIRNAME-LENGTH-BOUND)", async () => {
    const prefix = "SHARED-PREFIX-".repeat(10);
    const tagA = `${prefix}A`;
    const tagB = `${prefix}B`;
    await writePending(fx.repo, [
      makeEntry(tagA, ["src/dirname-a.ts"]),
      makeEntry(tagB, ["src/dirname-b.ts"]),
    ]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const dirA = worktreeDirName(tagA);
    const dirB = worktreeDirName(tagB);
    expect(dirA).not.toBe(dirB);

    const agent = fanoutAgent({
      [dirA]: async (cwd) => {
        await writeAndCommit(
          cwd,
          "src/dirname-a.ts",
          "ok\n",
          `build(${tagA}): ship`,
        );
      },
      [dirB]: async (cwd) => {
        await writeAndCommit(
          cwd,
          "src/dirname-b.ts",
          "ok\n",
          `build(${tagB}): ship`,
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();
    expect(new Set(outcome.result?.shippedTags)).toEqual(
      new Set([tagA, tagB]),
    );
  });
});

// win32 lane: fanout worktree paths nest as deep as the state roots they
// are cloned for and hit the identical MAX_PATH gap the state root's own
// reads are pinned against (`tests/pidClaim.test.ts`,
// `tests/friction.test.ts`; mirrored coverage in tests/git.test.ts for the
// shared helper itself).
// TAG-LENGTH-BOUND-AGREEMENT-PIN above now runs on win32 too:
// createWorktree's fanout worktree directory is length-bounded, so a
// long-tag fanout path stays clear of the ~200-char wall `git worktree add`
// itself refuses at — below MAX_PATH and unaffected by core.longpaths. The
// createWorktree/prior-attempt cases below stay deep only via
// chain.friction nesting that fs operations (not `git worktree add` itself)
// walk, which core.longpaths does cover.
describe.runIf(process.platform === "win32")(
  "Dispatcher fanout — createWorktree pins core.longpaths",
  () => {
    // What this body reads is the end state — `core.longpaths` true on
    // repoRoot once the tick has run — which is the only thing a config read
    // can say: it cannot see when the pin happened relative to the add. That
    // ordering is the sibling claim, pinned on every host as a call sequence
    // in tests/worktrees.test.ts ("worktrees — the longpaths pin precedes the
    // add"), so this title claims the effect alone
    // (`.claude/rules/engineering.md`, *A green verdict is proven
    // non-vacuous*: a title is a claim its body asserts).
    it("leaves core.longpaths pinned repo-locally once a fanout tick has provisioned its worktree", async () => {
      const entries = [makeEntry("W32-WT", ["src/w32.ts"])];
      await writePending(fx.repo, entries);
      new Baton(join(fx.repo, ".flume")).wake("build");

      const phase = makePhase({ name: "build", concurrency: "fanout" });
      const chain: Chain = { phases: [phase], humanOnly: [] };
      const agent = fanoutAgent({
        "w32-wt": (cwd) =>
          writeAndCommit(cwd, "src/w32.ts", "ok\n", "build(W32-WT): ship"),
      });

      const dispatcher = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        agent,
        log: silent,
      });

      const outcome = await dispatcher.tick();
      expect(outcome.result?.shippedTags).toEqual(["W32-WT"]);

      const { stdout } = await exec(
        "git",
        ["config", "--local", "--get", "core.longpaths"],
        { cwd: fx.repo },
      );
      expect(stdout.trim()).toBe("true");
    });

    it("writeRevertNote lands the note when the friction dir's own total path exceeds win32's ~260-char limit (WRITEREVERTNOTE-WIN32-PATH-TOTAL-LIMIT)", async () => {
      const tag = "LONGFRICTION-A";
      await writePending(fx.repo, [
        makeEntry(tag, ["src/longfriction-a.ts"]),
      ]);
      new Baton(join(fx.repo, ".flume")).wake("build");

      const failing: Gate = {
        name: "boom-gate",
        when: "afterCommit",
        async run() {
          return { ok: false, message: "boom said no" };
        },
      };
      const phase = makePhase({
        name: "build",
        concurrency: "fanout",
        gates: [failing],
      });
      // A friction channel nested deep enough that <flumeDir>/<friction>
      // alone clears win32's ~260-char total-path limit, independent of
      // the host tmpdir's own depth — TAG_MAX_LENGTH bounds only the
      // note's filename component (TAG-LENGTH-BOUND-AGREEMENT-PIN above),
      // never the friction dir's own depth.
      const deepFriction = join(
        "friction",
        ...Array.from({ length: 6 }, (_, i) => `seg-${i}-`.padEnd(50, "x")),
      );
      const chain: Chain = {
        phases: [phase],
        humanOnly: [],
        friction: deepFriction,
      };

      const slug = tag.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
      const agent = fanoutAgent({
        [slug]: async (cwd) => {
          await writeAndCommit(
            cwd,
            "src/longfriction-a.ts",
            "ok\n",
            `build(${tag}): ship`,
          );
        },
      });

      const dispatcher = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        agent,
        log: silent,
      });

      const outcome = await dispatcher.tick();
      expect(outcome.result?.shippedTags).toEqual([]);

      const frictionDir = join(fx.repo, ".flume", deepFriction);
      expect(frictionDir.length).toBeGreaterThan(260);
      const files = await readdir(frictionDir);
      expect(files.length).toBe(1);
      expect(files[0]).toContain(tag);
    });

    it("harvestFriction moves the worktree-local file into the primary dir when the friction channel nests past win32's ~260-char limit (HARVESTFRICTION-WIN32-PATH-TOTAL-LIMIT)", async () => {
      const tag = "LONGFRICTION-B";
      await writePending(fx.repo, [
        makeEntry(tag, ["src/longfriction-b.ts"]),
      ]);
      new Baton(join(fx.repo, ".flume")).wake("build");

      const phase = makePhase({ name: "build", concurrency: "fanout" });
      // Same deep-friction shape as WRITEREVERTNOTE-WIN32-PATH-TOTAL-LIMIT
      // above: <flumeDir>/<friction> alone clears win32's ~260-char total-
      // path limit, and harvestFriction's mirrorDir nests the (already deep,
      // per createWorktree's own MAX_PATH comment) worktree path under the
      // same friction value, so it clears the limit by an even wider margin.
      const deepFriction = join(
        "friction",
        ...Array.from({ length: 6 }, (_, i) => `seg-${i}-`.padEnd(50, "x")),
      );
      const chain: Chain = {
        phases: [phase],
        humanOnly: [],
        friction: deepFriction,
      };

      const slug = tag.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
      const agent = fanoutAgent({
        [slug]: async (cwd) => {
          const mirrorDir = join(cwd, ".flume", deepFriction);
          await mkdir(mirrorDir, { recursive: true });
          await writeFile(
            join(mirrorDir, "note.md"),
            "the loop wants owner input\n",
          );
          await writeAndCommit(
            cwd,
            "src/longfriction-b.ts",
            "ok\n",
            `build(${tag}): ship`,
          );
        },
      });

      const dispatcher = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        agent,
        log: silent,
      });

      const outcome = await dispatcher.tick();
      expect(outcome.result?.shippedTags).toEqual([tag]);

      const primaryFrictionDir = join(fx.repo, ".flume", deepFriction);
      expect(primaryFrictionDir.length).toBeGreaterThan(260);
      const files = await readdir(primaryFrictionDir);
      expect(files.length).toBe(1);
      expect(files[0]).toMatch(new RegExp(`^${tag}--\\d{4}-\\d{2}-\\d{2}T.*--note\\.md$`));
      expect(await readFile(join(primaryFrictionDir, files[0]!), "utf8")).toBe(
        "the loop wants owner input\n",
      );
    });

    it("frictionCountLine resolves a real count when chain.friction nests past win32's ~260-char limit (FRICTIONCOUNT-WIN32-PATH-TOTAL-LIMIT)", async () => {
      const stateRoot = await mkTempDir("flume-fcl-w32-");
      try {
        // Same deep-friction shape as WRITEREVERTNOTE-WIN32-PATH-TOTAL-LIMIT
        // / HARVESTFRICTION-WIN32-PATH-TOTAL-LIMIT above: join(stateRoot,
        // chain.friction) alone clears win32's ~260-char total-path limit.
        const deepFriction = join(
          "friction",
          ...Array.from({ length: 6 }, (_, i) => `seg-${i}-`.padEnd(50, "x")),
        );
        const frictionDir = join(stateRoot, deepFriction);
        await mkdir(frictionDir, { recursive: true });
        await writeFile(join(frictionDir, "a.md"), "x\n");
        await writeFile(join(frictionDir, "b.md"), "y\n");

        expect(frictionDir.length).toBeGreaterThan(260);
        const chain: Chain = { phases: [], humanOnly: [], friction: deepFriction };
        expect(await frictionCountLine(stateRoot, chain)).toBe(
          "friction: 2 note(s) await routing",
        );
      } finally {
        await rm(stateRoot, { recursive: true, force: true });
      }
    });

    it("PriorAttemptStore.snapshotReverted lands the snapshot when the reverted commit's own diff path pushes prior-attempts/<key>.reverted/<rel> past win32's ~260-char limit (SNAPSHOTREVERTEDFILES-WIN32-PATH-TOTAL-LIMIT)", async () => {
      // snapshotReverted runs on the singleton afterCommit-revert path
      // (e.g. a plan tick's schema-invalid pending.json) — unlike
      // WRITEREVERTNOTE-A/HARVESTFRICTION-B above (fanout, depth from
      // chain.friction), the depth driver here is the reverted commit's own
      // diff path: snapshotReverted joins prior-attempts/<key>.reverted
      // with whatever `git show --name-only` reports, unwrapped.
      const baton = new Baton(join(fx.repo, ".flume"));
      baton.wake("plan");

      const failing: Gate = {
        name: "boom-gate",
        when: "afterCommit",
        async run() {
          return { ok: false, message: "boom said no" };
        },
      };
      const phase = makePhase({
        name: "plan",
        concurrency: "singleton",
        gates: [failing],
      });
      const chain: Chain = { phases: [phase], humanOnly: [] };

      const deepRel = join(
        "src",
        ...Array.from({ length: 6 }, (_, i) => `seg-${i}-`.padEnd(50, "x")),
        "deep.ts",
      );
      const agent: Agent = {
        name: "deep-diff-singleton",
        async invoke(inv) {
          await writeAndCommit(
            inv.cwd,
            deepRel,
            "ok\n",
            "plan: touch a deeply-nested path",
          );
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      };

      const dispatcher = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        agent,
        log: silent,
      });

      const preHead = await head(fx.repo);
      const outcome = await dispatcher.tick();
      expect(outcome.result?.committed).toBe(false);
      expect(outcome.noCommit).toBe("gate-revert");
      expect(await head(fx.repo)).toBe(preHead);

      const snapshotPath = join(
        fx.repo,
        ".flume",
        "prior-attempts",
        "phase",
        "plan.reverted",
        deepRel,
      );
      expect(snapshotPath.length).toBeGreaterThan(260);
      expect(existsSync(snapshotPath)).toBe(true);
      expect(await readFile(snapshotPath, "utf8")).toBe("ok\n");
    });

    it("PriorAttemptStore.snapshotReverted clears a deep-path stale snapshot before rewriting on a repeat revert under the same key (SNAPSHOTREVERTEDFILES-RM-WIN32-PATH-TOTAL-LIMIT: repeat revert)", async () => {
      // Same singleton/afterCommit-revert shape as SNAPSHOTREVERTEDFILES-
      // WIN32-PATH-TOTAL-LIMIT above, but ticked twice under the same
      // priorAttemptKey ("plan"): snapshotReverted's own stale-snapshot
      // `rm(dir, ...)` runs before it rewrites, unwrapped — on a real win32
      // host that rm throws ENAMETOOLONG walking attempt 0's deep tree,
      // silently swallowed by the best-effort catch, so attempt 1 never
      // updates the snapshot at all: attempt 0's stale file survives and
      // attempt 1's is never written.
      const baton = new Baton(join(fx.repo, ".flume"));
      baton.wake("plan");

      const failing: Gate = {
        name: "boom-gate",
        when: "afterCommit",
        async run() {
          return { ok: false, message: "boom said no" };
        },
      };
      const phase = makePhase({
        name: "plan",
        concurrency: "singleton",
        gates: [failing],
      });
      const chain: Chain = { phases: [phase], humanOnly: [] };

      const deepRelA = join(
        "src",
        ...Array.from({ length: 6 }, (_, i) => `sega-${i}-`.padEnd(50, "x")),
        "deep.ts",
      );
      const deepRelB = join(
        "src",
        ...Array.from({ length: 6 }, (_, i) => `segb-${i}-`.padEnd(50, "x")),
        "deep.ts",
      );

      let attempt = 0;
      const agent: Agent = {
        name: "deep-diff-repeat-revert",
        async invoke(inv) {
          const n = attempt++;
          const rel = n === 0 ? deepRelA : deepRelB;
          const content = n === 0 ? "first\n" : "second\n";
          await writeAndCommit(inv.cwd, rel, content, `plan: attempt ${n}`);
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      };

      const dispatcher = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        agent,
        log: silent,
      });

      const first = await dispatcher.tick();
      expect(first.result?.committed).toBe(false);
      expect(first.noCommit).toBe("gate-revert");

      const snapDir = join(fx.repo, ".flume", "prior-attempts", "phase", "plan.reverted");
      const pathA = join(snapDir, deepRelA);
      expect(pathA.length).toBeGreaterThan(260);
      expect(existsSync(pathA)).toBe(true);
      expect(await readFile(pathA, "utf8")).toBe("first\n");

      baton.wake("plan");
      const second = await dispatcher.tick();
      expect(second.result?.committed).toBe(false);
      expect(second.noCommit).toBe("gate-revert");

      const pathB = join(snapDir, deepRelB);
      expect(pathB.length).toBeGreaterThan(260);
      expect(existsSync(pathB)).toBe(true);
      expect(await readFile(pathB, "utf8")).toBe("second\n");
      // Attempt 0's stale tree is gone, not merged alongside attempt 1's.
      expect(existsSync(pathA)).toBe(false);
    });

    it("PriorAttemptStore.clear clears a deep-path stale snapshot on a clean ship without the tick throwing (SNAPSHOTREVERTEDFILES-RM-WIN32-PATH-TOTAL-LIMIT: clean ship)", async () => {
      // PriorAttemptStore.clear's own `rm(snapshotDir(key), ...)` is
      // unwrapped and runs with no surrounding try/catch on its caller path
      // (runSingleton's clean-ship branch) — on a real win32 host, clearing
      // a deep snapshot left by a prior deep-path revert throws ENAMETOOLONG
      // out of the tick instead of just leaving the recovery artifact stale.
      const baton = new Baton(join(fx.repo, ".flume"));
      baton.wake("plan");

      let calls = 0;
      const failing: Gate = {
        name: "boom-gate",
        when: "afterCommit",
        async run() {
          calls++;
          return calls === 1
            ? { ok: false, message: "boom said no" }
            : { ok: true, message: "pending.json parsed (0 entries)" };
        },
      };
      const phase = makePhase({
        name: "plan",
        concurrency: "singleton",
        gates: [failing],
      });
      const chain: Chain = { phases: [phase], humanOnly: [] };

      const deepRel = join(
        "src",
        ...Array.from({ length: 6 }, (_, i) => `seg-${i}-`.padEnd(50, "x")),
        "deep.ts",
      );

      let attempt = 0;
      const agent: Agent = {
        name: "deep-diff-clean-ship",
        async invoke(inv) {
          const n = attempt++;
          if (n === 0) {
            await writeAndCommit(
              inv.cwd,
              deepRel,
              "ok\n",
              "plan: touch a deeply-nested path",
            );
          } else {
            await writeAndCommit(
              inv.cwd,
              "src/shallow.ts",
              "ok\n",
              "plan: clean ship",
            );
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      };

      const dispatcher = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        agent,
        log: silent,
      });

      const first = await dispatcher.tick();
      expect(first.result?.committed).toBe(false);
      expect(first.noCommit).toBe("gate-revert");

      const snapDir = join(fx.repo, ".flume", "prior-attempts", "phase", "plan.reverted");
      const snapPath = join(snapDir, deepRel);
      expect(snapPath.length).toBeGreaterThan(260);
      expect(existsSync(snapPath)).toBe(true);

      baton.wake("plan");
      const second = await dispatcher.tick();
      expect(second.result?.committed).toBe(true);
      expect(existsSync(snapDir)).toBe(false);
    });

    // createWorktree's fanout worktree path is now bounded by
    // worktreeDirName, so a TAG_MAX_LENGTH tag no longer hits git's own
    // ~200-char win32 worktree-path refusal — this test reaches the
    // prior-attempt round-trip it exists to pin instead of failing on git's
    // refusal first.
    it("PriorAttemptStore read/write/clear round-trip a prior-attempt record when priorAttemptPath itself nests past win32's ~260-char limit (PRIORATTEMPT-WIN32-PATH-TOTAL-LIMIT)", async () => {
      // Unlike SNAPSHOTREVERTEDFILES-WIN32-PATH-TOTAL-LIMIT above (depth
      // from the reverted commit's own diff path), the depth driver here is
      // the record's own filename: priorAttemptPath is
      // `<flumeDir>/prior-attempts/<keyspace>/<key>.json`, one fixed segment
      // of nesting and no more, so
      // only the fanout key (slugify(entry.tag), bounded by the real
      // TAG_PATTERN/TAG_MAX_LENGTH schema gate) can push it past 260 — the
      // longest tag the schema accepts, driven through the real writer.
      // priorAttemptKey keeps the untruncated slug even though
      // createWorktree's own directory name is now bounded, so this path is
      // still as deep as before.
      const tag = "A".repeat(TAG_MAX_LENGTH);
      await writePending(fx.repo, [
        makeEntry(tag, ["src/priorattempt-w32.ts"]),
      ]);
      new Baton(join(fx.repo, ".flume")).wake("build");

      let calls = 0;
      const gate: Gate = {
        name: "boom-gate",
        when: "afterCommit",
        async run() {
          calls++;
          return calls === 1
            ? { ok: false, message: "boom said no" }
            : { ok: true, message: "second attempt passes" };
        },
      };
      const phase = makePhase({
        name: "build",
        concurrency: "fanout",
        gates: [gate],
      });
      const chain: Chain = { phases: [phase], humanOnly: [] };

      const slug = tag.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
      let attempt = 0;
      const prompts: string[] = [];
      const agent: Agent = {
        name: "priorattempt-w32-agent",
        async invoke(inv) {
          prompts.push(inv.prompt);
          const n = attempt++;
          await writeAndCommit(
            inv.cwd,
            "src/priorattempt-w32.ts",
            n === 0 ? "first\n" : "second\n",
            `build(${tag}): attempt ${n}`,
          );
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      };

      const dispatcher = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        agent,
        log: silent,
      });

      const first = await dispatcher.tick();
      expect(first.result?.shippedTags).toEqual([]);

      const priorAttemptPath = join(
        fx.repo,
        ".flume",
        "prior-attempts",
        "entry",
        `${slug}.json`,
      );
      expect(priorAttemptPath.length).toBeGreaterThan(260);
      // PriorAttemptStore.write's mkdir/writeFile landed the record instead of
      // throwing ENAMETOOLONG.
      expect(existsSync(priorAttemptPath)).toBe(true);

      new Baton(join(fx.repo, ".flume")).wake("build");
      const second = await dispatcher.tick();
      expect(second.result?.shippedTags).toEqual([tag]);

      // PriorAttemptStore.read actually decoded the deep-path record rather
      // than existsSync silently reporting "no prior attempt": the gate-revert
      // block, carrying the first gate's own failure message, lands in the
      // second attempt's rendered prompt.
      expect(prompts[1]).toContain("<prior-attempt>");
      expect(prompts[1]).toContain("boom said no");

      // PriorAttemptStore.clear removed the deep-path record after the clean
      // ship-and-merge.
      expect(existsSync(priorAttemptPath)).toBe(false);
    });

    // WORKTREE-WIN32-PATH-TOTAL-LIMIT (fresh create + stale cleanup)
    // retired: operator ruling on a real win32 host found `git worktree
    // add` itself refusing a worktree path around ~200 chars
    // ("fatal: '$GIT_DIR' too big"), below win32's ~260-char total-path
    // limit and unaffected by core.longpaths — the exact depth these two
    // cases drove the base to in order to exercise createWorktree's
    // deep-path handling. The claim they pinned (createWorktree succeeds
    // past 260 chars) is untestable through real fanout on win32; kept in
    // the suite the two cases would run zero-width on any other platform
    // (this describe block is win32-only), which is the vacuity the
    // "green verdict is non-vacuous" standard rules out rather than files.
  },
);

// Same deep-nesting shape as the win32 lane above, applied to the two remaining
// bare-join fs-call sites this file carried: loadChainModule's existence probe
// (the single fix point every chain-load caller reaches through) and the
// pendingDir reads/writes readPending, readPendingTolerant, and
// commitPendingUpdate share. Pre-fix, each silently misread a genuinely
// existing/writable path as absent past win32's ~260-char total-path limit
// instead of failing loud (.claude/rules/platform-facts.md "Windows MAX_PATH
// (~260 chars) breaks fs calls with no long component").
describe.runIf(process.platform === "win32")(
  "Dispatcher — loadChainModule/pendingDir win32 total-path limit (DISPATCHER-NAMESPACEDJOIN-WIN32-PATH-TOTAL-LIMIT)",
  () => {
    it("loadChainModule doesn't misread an existing chain.ts as absent when its resolved path exceeds win32's ~260-char limit", async () => {
      const base = await mkTempDir("flume-chain-w32-");
      try {
        const cfg = join(
          base,
          ...Array.from({ length: 6 }, (_, i) => `seg-${i}-`.padEnd(50, "x")),
        );
        await writeMinimalChain(cfg);

        const chainPath = join(cfg, "chain.ts");
        expect(chainPath.length).toBeGreaterThan(260);

        // Pre-fix, the bare-join existence probe here silently read this
        // chain.ts as absent and threw "chain config not found" even though
        // it genuinely exists.
        const mod = await loadChainModule(chainPaths(cfg));
        expect(mod.chain.phases).toHaveLength(1);
      } finally {
        await rm(base, { recursive: true, force: true });
      }
    });

    it("readPending/readPendingTolerant/commitPendingUpdate don't misread an existing or writable queue as absent when pendingDir exceeds win32's ~260-char limit", async () => {
      const dock = await mkTempDir("flume-dock-w32-");
      // An operator override outranks the chain's declared base
      // (`worktreesBase`, src/paths.ts), and the base below is load-bearing
      // here — clear it for the duration so the declaration governs.
      const savedOverride = process.env.FLUME_WORKTREES_DIR;
      delete process.env.FLUME_WORKTREES_DIR;
      try {
        const deepDock = join(
          dock,
          ...Array.from({ length: 6 }, (_, i) => `seg-${i}-`.padEnd(50, "x")),
        );
        const pendingDir = join(deepDock, "plan", "pending");
        await mkdir(pendingDir, { recursive: true });
        const entryFile = join(pendingDir, entryFileName("RELOC-W32"));
        await writeFile(
          entryFile,
          JSON.stringify(makeEntry("RELOC-W32", ["src/reloc-w32.ts"]), null, 2) +
            "\n",
          "utf8",
        );
        expect(entryFile.length).toBeGreaterThan(260);
        new Baton(deepDock).wake("build");

        // The deep path is `pendingDir`'s alone. The worktree base is
        // declared back onto the shallow dock: left at its default,
        // `<flumeDir>/worktrees/<slug>` under `deepDock`, `git worktree add`
        // refuses with `fatal: '$GIT_DIR' too big` around 200 chars — a limit
        // below MAX_PATH that `core.longpaths` does not lift and
        // `toNamespacedPath` cannot reach, because git builds that path
        // itself (`.claude/rules/platform-facts.md`, *`git worktree add`
        // refuses long paths on win32, below MAX_PATH*). The wave would ship
        // nothing and the case would red on its fixture rather than on the
        // `readPending`/`commitPendingUpdate` calls it names.
        const wtBase = join(dock, "wt");
        const phase = makePhase({ name: "build", concurrency: "fanout" });
        const chain: Chain = {
          phases: [phase],
          humanOnly: [],
          worktreesBase: () => wtBase,
        };

        let observedCwd: string | undefined;
        const agent = fanoutAgent({
          "reloc-w32": (cwd) => {
            observedCwd = cwd;
            return writeAndCommit(
              cwd,
              "src/reloc-w32.ts",
              "reloc\n",
              "build(RELOC-W32): ship",
            );
          },
        });

        const dispatcher = new Dispatcher({
          chainLoader: staticLoader(chain),
          repoRoot: fx.repo,
          configDir: fx.configDir,
          flumeDir: deepDock,
          agent,
          log: silent,
        });

        // Pre-fix, readPending's bare-join existsSync check on the
        // relocated pendingDir silently read it as absent — the pickable
        // entry vanished and the tick shipped nothing.
        const outcome = await dispatcher.tick();
        expect(outcome.result?.shippedTags).toEqual(["RELOC-W32"]);

        // commitPendingUpdate's own bare-join reads/writes (the no-op-diff
        // check and the rewrite itself) also landed at the deep path.
        const parsed = parsePendingQueue(readQueueOnDisk(pendingDir) ?? []);
        expect(parsed.ok).toBe(true);
        if (parsed.ok) expect(parsed.entries).toEqual([]);
        // readPendingTolerant hits the same deep path for pendingAfter.
        expect(outcome.result?.pendingAfter).toEqual([]);
        // The wave really did run off the shallow base — the default one
        // under the deep dock never materialized.
        expect(observedCwd).toBe(join(wtBase, "reloc-w32"));
        expect(existsSync(join(deepDock, "worktrees"))).toBe(false);
      } finally {
        if (savedOverride === undefined) delete process.env.FLUME_WORKTREES_DIR;
        else process.env.FLUME_WORKTREES_DIR = savedOverride;
        await rm(dock, { recursive: true, force: true });
      }
    });
  },
);

describe("src/index.ts — ProvisionFailure/TerminalMisconfiguration barrel export (DISPATCHER-PROVISIONFAILURE-TERMINALMISCONFIG-UNEXPORTED)", () => {
  it("re-exports ProvisionFailure and TerminalMisconfiguration as named types a chain author can consume", () => {
    // The imported types (line 58, from src/index.ts rather than
    // src/Dispatcher.ts) are what a chain author would actually reach for to
    // type their own handling of TickVerdict.provisionFailures / TickOutcome
    // .terminal — if either drops from the barrel this fails tsc, not just
    // an LSP references check.
    const provisionFailure: ProvisionFailure = {
      tag: "SOME-ENTRY",
      quarantineKey: "some-entry@00112233aa",
      signature: "worktree-create-failed",
      message: "git worktree add failed: ...",
    };
    const terminalMisconfiguration: TerminalMisconfiguration = {
      kind: "orphaned-awake",
      phases: ["build"],
    };

    expect(provisionFailure.tag).toBe("SOME-ENTRY");
    expect(terminalMisconfiguration.kind).toBe("orphaned-awake");
  });
});

describe("src/index.ts — NoCommitMode barrel export (PROMPT-NOCOMMITMODE-UNEXPORTED)", () => {
  it("re-exports NoCommitMode as a named type a chain author can consume", () => {
    // The imported type (line 65, from src/index.ts rather than
    // src/Prompt.ts) is what a chain author would actually reach for to
    // type their own handling of TickVerdict.noCommit / TickOutcome.noCommit
    // / TickResult.noCommit — if it drops from the barrel this fails tsc,
    // not just an LSP references check.
    const noCommit: NoCommitMode = "gate-revert";

    expect(noCommit).toBe("gate-revert");
  });
});

describe("src/index.ts — PriorAttemptKeyspace barrel export (INDEX-EXPORTS-ORPHANED-TYPES)", () => {
  it("re-exports PriorAttemptKeyspace as a named type a chain author can consume", () => {
    // The imported type comes from src/index.ts rather than src/Prompt.ts,
    // so it is what a chain author would actually reach for to type their
    // own handling of a PriorAttempt's .key — if it drops from the barrel
    // this fails tsc, not just an LSP references check.
    const entryKeyed: PriorAttemptKeyspace = "entry";
    const phaseKeyed: PriorAttemptKeyspace = "phase";

    expect([entryKeyed, phaseKeyed]).toEqual(["entry", "phase"]);
  });
});

describe("src/index.ts — QuarantinedTag barrel export (INDEX-EXPORTS-ORPHANED-TYPES)", () => {
  it("re-exports QuarantinedTag as a named type a chain author can consume", () => {
    // The imported type comes from src/index.ts rather than src/Phase.ts, so
    // it is what a chain author would actually reach for to type their own
    // handling of TickResult.quarantinedTags — if it drops from the barrel
    // this fails tsc, not just an LSP references check.
    const held: QuarantinedTag = {
      tag: "SOME-ENTRY",
      key: "some-entry@00112233aa",
    };

    expect(held.tag).toBe("SOME-ENTRY");
    expect(held.key).toBe("some-entry@00112233aa");
  });
});

describe("GateContext.entry — the gated span's own entry (spec/chain.md 'What a gate receives')", () => {
  const capture = (when: "afterCommit" | "afterMerge", seen: Record<string, string | null>): Gate => ({
    name: `see-${when}`,
    when,
    async run(ctx) {
      seen[when] = "entry" in ctx ? ctx.entry!.tag : null;
      return { ok: true, message: "seen" };
    },
  });

  it("fanout: both stages receive the entry the wave provisioned, by identity of tag", async () => {
    await writePending(fx.repo, [makeEntry("CTX-ENTRY", ["src/e.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");
    const seen: Record<string, string | null> = {};
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [capture("afterCommit", seen), capture("afterMerge", seen)],
    });
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({
        "ctx-entry": async (cwd) => {
          await writeAndCommit(cwd, "src/e.ts", "e\n", "build: e");
        },
      }),
      log: silent,
    });
    const outcome = await dispatcher.tick();
    expect(outcome.result?.shippedTags).toEqual(["CTX-ENTRY"]);
    expect(seen).toEqual({ afterCommit: "CTX-ENTRY", afterMerge: "CTX-ENTRY" });
  });

  it("singleton: the key is absent at both stages — no entry exists to report", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");
    const seen: Record<string, string | null> = {};
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [capture("afterCommit", seen), capture("afterMerge", seen)],
    });
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async (cwd) => {
        await writeAndCommit(cwd, "src/p.ts", "p\n", "plan: p");
      }),
      log: silent,
    });
    const outcome = await dispatcher.tick();
    expect(outcome.result?.committed).toBe(true);
    expect(seen).toEqual({ afterCommit: null, afterMerge: null });
  });
});

describe("not-shipped PriorAttempt — the chain's `shipped: false` on the channel `TickContext.priorAttempts` already carries (spec/loop.md 'Prior-outcome feedback to the retrying tick')", () => {
  /**
   * A declined commit leaves the entry queued, so its next tick is a retry —
   * and before this, the only trace was the verdict log, which a chain could
   * reach only by re-deriving "was the last attempt declined" from history.
   * The record carries what the engine already held at the ship decision (the
   * merged sha, the commit's paths) and no reason: the predicate returned a
   * boolean, and the engine holds no vocabulary for why.
   */
  it("a `shipped: false` verdict leaves a `not-shipped` prior-attempt record under the entry's key, carrying the merged sha and touched paths", async () => {
    await writePending(fx.repo, [
      makeEntry("DECLINED-ONCE", ["src/declined.ts"]),
    ]);
    const flumeDir = join(fx.repo, ".flume");
    new Baton(flumeDir).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      shipped: () => false,
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({
        "declined-once": (cwd) =>
          writeAndCommit(
            cwd,
            "src/declined.ts",
            "landed\n",
            "build(DECLINED-ONCE): land it",
          ),
      }),
      log: silent,
    });

    const outcome = await dispatcher.tick();
    const trunkTip = await head(fx.repo);

    // Non-vacuity: the leg under test really ran — the commit landed on trunk
    // (no ledger commit follows a wave that shipped nothing) and the chain's
    // predicate declined it.
    expect(outcome.result?.shippedTags).toEqual([]);
    expect(outcome.verdict?.mergeOutcomes).toEqual([
      {
        entryTag: "DECLINED-ONCE",
        outcome: "not-shipped",
        baseSha: expect.stringMatching(/^[0-9a-f]{40}$/),
        headSha: trunkTip,
      },
    ]);
    expect((readPendingFromDisk(fx.repo)).map((e) => e.tag)).toEqual([
      "DECLINED-ONCE",
    ]);

    const record = JSON.parse(
      await readFile(priorAttemptPath(flumeDir, entryRef("DECLINED-ONCE")), "utf8"),
    ) as Record<string, unknown>;
    expect(record.mode).toBe("not-shipped");
    expect(record.mergedSha).toBe(trunkTip);
    expect(record.touchedPaths).toEqual(["src/declined.ts"]);
    // Anchored like every other variant (spec/loop.md "Every record is
    // anchored"), and carrying nothing else: the exact key set is the pin on
    // "no reason vocabulary" — a `reason`/`why` field cannot appear without
    // failing here.
    expect(Object.keys(record).sort()).toEqual([
      "at",
      "declaredAs",
      "headSha",
      "key",
      "keyedAs",
      "mergedSha",
      "mode",
      "touchedPaths",
    ]);
    expect(record.key).toBe("entry");
    expect(record.keyedAs).toBe(slugify("DECLINED-ONCE"));
    expect(record.declaredAs).toBe(
      entryDeclaredKey((readPendingFromDisk(fx.repo))[0]!),
    );
    expect(record.headSha).toBe(trunkTip);
  });

  it("the next tick's `TickContext.priorAttempts` carries it, and a later clean ship clears the slot", async () => {
    await writePending(fx.repo, [
      makeEntry("DECLINED-THEN-SHIPS", ["src/twice.ts"]),
    ]);
    const flumeDir = join(fx.repo, ".flume");
    const baton = new Baton(flumeDir);
    baton.wake("build");

    let decline = true;
    const seen: Array<ReadonlyMap<string, PriorAttempt> | undefined> = [];
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      promptArgs: (ctx) => {
        seen.push(ctx.priorAttempts);
        return {};
      },
      shipped: () => !decline,
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const prompts: string[] = [];
    const agent: Agent = {
      name: "declines-then-ships",
      async invoke(inv) {
        prompts.push(inv.prompt);
        await writeAndCommit(
          inv.cwd,
          "src/twice.ts",
          `attempt-${prompts.length}\n`,
          "build(DECLINED-THEN-SHIPS): land it",
        );
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    await dispatcher.tick(); // attempt 1 → landed, declined
    const declinedSha = await head(fx.repo);
    // The entry the first attempt was declined over is still in the queue,
    // declared exactly as it was — the key the record below stands against.
    const stillQueued = readPendingFromDisk(fx.repo);
    expect(stillQueued.map((e) => e.tag)).toEqual(["DECLINED-THEN-SHIPS"]);
    baton.wake("build"); // re-wake (handoff () => [] slept it)
    decline = false;
    const second = await dispatcher.tick(); // attempt 2 → ships clean

    expect(prompts).toHaveLength(2);
    // No false signal on the first attempt — neither on the hook's map nor
    // in the rendered prompt.
    expect(seen[0]?.has(`entry:${slugify("DECLINED-THEN-SHIPS")}`)).toBe(false);
    expect(prompts[0]).not.toContain("<prior-attempt>");

    // The retry reads the fact off `TickContext.priorAttempts` — no verdict
    // log, no directory walk of its own.
    const carried = seen[1]?.get(`entry:${slugify("DECLINED-THEN-SHIPS")}`);
    expect(carried).toEqual({
      mode: "not-shipped",
      mergedSha: declinedSha,
      touchedPaths: ["src/twice.ts"],
      key: "entry",
      keyedAs: slugify("DECLINED-THEN-SHIPS"),
      declaredAs: entryDeclaredKey(stillQueued[0]!),
      headSha: declinedSha,
      at: expect.any(String),
    });
    // …and the same record renders into the retry's prompt.
    expect(prompts[1]).toContain("<prior-attempt>");
    expect(prompts[1]).toContain(`Landed commit: ${declinedSha}`);
    expect(prompts[1]).toContain("src/twice.ts");

    // A clean ship clears the slot by the existing shipped-entry path.
    expect(second.result?.shippedTags).toEqual(["DECLINED-THEN-SHIPS"]);
    expect(
      existsSync(priorAttemptPath(flumeDir, entryRef("DECLINED-THEN-SHIPS"))),
    ).toBe(false);
  });

  /**
   * Agreement pin (.claude/rules/engineering.md "A seam gate reads what the
   * real writer wrote"): the verdict handed to `superviseLoop` is the one a
   * real declined wave produced, not a fixture. A chain declining a landed
   * commit is that chain's verdict, never a failure of the tick that produced
   * it — the same reason `clean-exit` stays out of the errored derivation.
   */
  it("a run whose only no-commit fact is `not-shipped` is not derived as errored", async () => {
    await writePending(fx.repo, [
      makeEntry("DECLINED-RUN", ["src/declined-run.ts"]),
    ]);
    const flumeDir = join(fx.repo, ".flume");
    const baton = new Baton(flumeDir);
    baton.wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      shipped: () => false,
    });
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({
        "declined-run": (cwd) =>
          writeAndCommit(
            cwd,
            "src/declined-run.ts",
            "landed\n",
            "build(DECLINED-RUN): land it",
          ),
      }),
      log: silent,
    });

    const verdict = (await dispatcher.tick()).verdict;
    expect(verdict).toBeDefined();
    // Non-vacuity: this run's only queue-unchanged fact is the decline —
    // nothing shipped, no no-commit mode, no provision/merge/gate failure for
    // the derivation to key off instead.
    expect(verdict!.shippedTags).toEqual([]);
    expect(verdict!.committed).toBe(false);
    expect(verdict!.mergeOutcomes.map((m) => m.outcome)).toEqual([
      "not-shipped",
    ]);
    expect(verdict!.noCommit).toBeUndefined();
    expect(verdict!.provisionFailures ?? []).toEqual([]);
    expect(verdict!.mergeFailures ?? []).toEqual([]);

    baton.wake("build");
    const res = await superviseLoop({
      repoRoot: fx.repo,
      tickBudget: 3,
      runTick: async () => {
        await writeTickVerdict(flumeDir, verdict!);
        baton.sleep("build");
        return { exitCode: 0 };
      },
      log: silent,
    });

    expect(res.ticks).toBe(1);
    expect(res.erroredTicks).toEqual([]);
    expect(loopExitCode(res)).toBe(0);
  });
});

/**
 * spec/loop.md "The tick verdict — one facts artifact": a span row is
 * recovery, not decoration — "re-cherry-pickable from the verdict alone,
 * never re-run at full agent price". `headSha` alone cannot do that: a span
 * may hold several commits (spec/loop.md "N commits are completion"), so
 * picking its head re-applies the last commit and loses the rest. Both tests
 * below therefore prove recovery by actually replaying `baseSha..headSha`
 * onto trunk after the tick tore the worktree down, and both drive a
 * two-commit span so the replay is load-bearing.
 */
describe("TickVerdict span rows — base beside head", () => {
  /** `git rev-list --count base..head` in `repo`. */
  async function spanLength(
    repo: string,
    base: string,
    head: string,
  ): Promise<number> {
    const { stdout } = await exec(
      "git",
      ["rev-list", "--count", `${base}..${head}`],
      { cwd: repo },
    );
    return Number(stdout.trim());
  }

  it("a fanout entry's span row carries the base it branched from beside its head sha", async () => {
    await writePending(fx.repo, [makeEntry("SPAN-BASE", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      scopeWritesToEntry: true,
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const preHead = await head(fx.repo);

    // Two commits: the entry's declared file, then one outside its scope —
    // the whole span is gated, so the writable-paths gate reverts both.
    const agent = fanoutAgent({
      "span-base": async (cwd) => {
        await writeAndCommit(cwd, "src/a.ts", "a\n", "build(SPAN-BASE): one");
        await writeAndCommit(
          cwd,
          "src/stray.ts",
          "stray\n",
          "build(SPAN-BASE): two",
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    // Non-vacuity: the reverted-span leg really ran — nothing shipped, and
    // neither file reached trunk on the entry's own commits.
    expect(outcome.result?.shippedTags).toEqual([]);
    expect(existsSync(join(fx.repo, "src", "a.ts"))).toBe(false);
    expect(existsSync(join(fx.repo, "src", "stray.ts"))).toBe(false);

    const rows = outcome.verdict?.mergeOutcomes ?? [];
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.entryTag).toBe("SPAN-BASE");
    expect(row.outcome).toBe("afterCommit-reverted");
    // The base is the tip the worktree branched from — trunk as it stood
    // when the entry was provisioned, not the head's parent.
    expect(row.baseSha).toBe(preHead);
    expect(row.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(row.headSha).not.toBe(row.baseSha);
    // Two commits, so `headSha` alone would recover only the second.
    expect(await spanLength(fx.repo, row.baseSha!, row.headSha!)).toBe(2);

    // Recovery: the worktree and its branch are gone, but the span replays
    // from the verdict's two shas alone — no agent re-run.
    expect(existsSync(join(fx.repo, ".flume", "worktrees", "span-base"))).toBe(
      false,
    );
    await exec("git", ["cherry-pick", `${row.baseSha}..${row.headSha}`], {
      cwd: fx.repo,
    });
    expect(await readFile(join(fx.repo, "src", "a.ts"), "utf8")).toBe("a\n");
    expect(await readFile(join(fx.repo, "src", "stray.ts"), "utf8")).toBe(
      "stray\n",
    );
  });

  it("a singleton tick reverted by an afterCommit gate leaves a span row naming both shas", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      writablePaths: ["src/**"],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const preHead = await head(fx.repo);

    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/plan-a.ts", "a\n", "plan: one");
      await writeAndCommit(cwd, "outside/b.ts", "b\n", "plan: two");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    // Non-vacuity: the gate really reverted a real commit — the tick is a
    // gate-revert, nothing landed on trunk, and `commitSha` (set only on a
    // clean ship) is exactly the field that cannot carry the sha here.
    expect(outcome.noCommit).toBe("gate-revert");
    expect(outcome.result?.committed).toBe(false);
    expect(outcome.result?.commitSha).toBeUndefined();
    expect(await head(fx.repo)).toBe(preHead);
    expect(existsSync(join(fx.repo, "src", "plan-a.ts"))).toBe(false);

    const rows = outcome.verdict?.mergeOutcomes ?? [];
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    // No entry to name — the verdict's own `phaseName` already says which
    // phase this span belongs to.
    expect(row.entryTag).toBeUndefined();
    expect(outcome.verdict?.phaseName).toBe("plan");
    expect(row.outcome).toBe("afterCommit-reverted");
    expect(row.footprint?.sort()).toEqual(["outside/b.ts", "src/plan-a.ts"]);
    expect(row.baseSha).toBe(preHead);
    expect(row.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(row.headSha).not.toBe(row.baseSha);
    expect(await spanLength(fx.repo, row.baseSha!, row.headSha!)).toBe(2);

    await exec("git", ["cherry-pick", `${row.baseSha}..${row.headSha}`], {
      cwd: fx.repo,
    });
    expect(await readFile(join(fx.repo, "src/plan-a.ts"), "utf8")).toBe("a\n");
    expect(await readFile(join(fx.repo, "outside/b.ts"), "utf8")).toBe("b\n");
  });
});

// `existsSync` collapsed every stat failure to `false`, so a queue that is on
// disk but unlistable read as absent and `pendingAfter` came back looking
// like a drained queue with nothing said — and a chain hibernates off exactly
// that (`.flume/chain.ts`: `pickableAfter.length > 0`). The listing now splits
// ENOENT from the rest (`readQueueOnDisk`, src/pendingLedger.ts); this reader
// cannot refuse the way its strict twin does — it runs after the tick's work
// landed, so a throw would lose the TickResult — so it announces, then
// degrades, exactly as the parse branch beside it already did.
describe("Dispatcher — a queue the post-tick re-read cannot resolve is loud", () => {
  /**
   * The vacuity guard both cases below take: the queue the re-read failed
   * over really holds its entry at the tip, so the `[]` each asserts is a
   * degradation and not the truth about this repo's queue.
   */
  async function expectTipQueue(tags: string[]): Promise<void> {
    const files = await readQueueAtRef(fx.repo, "HEAD", ".flume/plan/pending");
    const tipPending = parsePendingQueue(files ?? []);
    expect(tipPending.ok).toBe(true);
    if (tipPending.ok) {
      expect(tipPending.entries.map((e) => e.tag)).toEqual(tags);
    }
  }

  it("readPendingTolerant warns naming the listing error when the queue directory is present but unlistable", async () => {
    await writePending(fx.repo, [makeEntry("PTSL-A", ["src/ptsl-a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const pendingDir = join(fx.repo, ".flume", "plan", "pending");
    const warnings: string[] = [];

    // Broken mid-tick, not before it: the strict decide-read resolves the
    // committed tip rather than the tree (spec/pending.md "Dispatch reads
    // come from the tip, not the tree"), so the tick still dispatches over a
    // real queue and only the post-tick disk re-read meets the bad path. The
    // agent commits nothing, so no cherry-pick range opens over the dirtied
    // trunk — the re-read is the only thing under test here.
    const agent: Agent = {
      name: "breaks-the-queue-path",
      async invoke() {
        await rm(pendingDir, { recursive: true });
        // ELOOP — present, unlistable. Not a permission bit: a root-run
        // test would bypass that.
        await symlink(basename(pendingDir), pendingDir);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: { info: () => {}, warn: (l) => warnings.push(l), error: () => {} },
    });

    const outcome = await dispatcher.tick();

    await expectTipQueue(["PTSL-A"]);

    expect(warnings).toContainEqual(
      expect.stringMatching(
        /plan\/pending could not be read \(.*ELOOP/,
      ),
    );
    // Declared degradation, not a refusal: the TickResult still lands, and
    // the empty queue it reports is the thing the warn above accounts for.
    expect(outcome.result).toBeDefined();
    expect(outcome.result?.pendingAfter).toEqual([]);
    expect(outcome.result?.pickableAfter).toEqual([]);
  });

  // The listing catch above was the first half: past it the per-file read
  // was bare, so an entry the listing names but nothing can read — a
  // directory at the name, a mode denying the file itself, a delete racing
  // the listing — threw out of a reader that runs after the tick's work
  // landed, losing the TickResult the strict twin deliberately cannot lose.
  it("readPendingTolerant warns and reports an empty pendingAfter when an entry file lists but cannot be read", async () => {
    await writePending(fx.repo, [makeEntry("PTRD-A", ["src/ptrd-a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const pendingDir = join(fx.repo, ".flume", "plan", "pending");
    const entryPath = join(pendingDir, entryFileName("PTRD-A"));
    const warnings: string[] = [];

    // Same mid-tick timing as the ELOOP case: the strict decide-read comes
    // from the committed tip, so only the post-tick disk re-read meets the
    // bad path, and the agent commits nothing.
    const agent: Agent = {
      name: "breaks-the-queue-file",
      async invoke() {
        await rm(entryPath);
        // ELOOP — lists fine, reads never. Not a permission bit (a root-run
        // test would bypass one) and not a directory either: the listing
        // skips a subdirectory by contract, so it would never reach the read
        // this case is about.
        await symlink(basename(entryPath), entryPath);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: { info: () => {}, warn: (l) => warnings.push(l), error: () => {} },
    });

    const outcome = await dispatcher.tick();

    await expectTipQueue(["PTRD-A"]);
    // The directory really listed — the listing branch beside this one is
    // not what fired, the per-file read is.
    expect(existsSync(pendingDir)).toBe(true);
    expect(readdirSync(pendingDir)).toContain(entryFileName("PTRD-A"));

    expect(warnings).toContainEqual(
      expect.stringMatching(/plan\/pending could not be read \(.*ELOOP/),
    );
    // Declared degradation, not a refusal: the TickResult still lands, and
    // the empty queue it reports is the thing the warn above accounts for.
    expect(outcome.result).toBeDefined();
    expect(outcome.result?.pendingAfter).toEqual([]);
    expect(outcome.result?.pickableAfter).toEqual([]);
  });
});

// ---------- promptPath is an address, not a path beneath the chain ----------

describe('phase.promptPath resolves against configDir (spec/chain.md "Chain residency")', () => {
  let fx: Fixture;
  /** A package-shaped directory outside the chain, holding a shipped prompt. */
  let pkg: string;
  /** Absolute path of the prompt that package ships. */
  let shipped: string;

  beforeEach(async () => {
    fx = await makeFixture();
    pkg = await mkTempDir("flume-prompt-pkg-");
    shipped = join(pkg, "prompts", "shipped.md");
    await mkdir(dirname(shipped), { recursive: true });
    await writeFile(shipped, "shipped-by-the-package\n", "utf8");
  });

  afterEach(async () => {
    await fx.cleanup();
    await rm(pkg, { recursive: true, force: true });
  });

  it("a singleton tick reads an absolute promptPath as the prompt file's address", async () => {
    // Vacuity guard: the address really is outside the chain, so joining it
    // beneath configDir could only miss.
    expect(relative(fx.configDir, shipped).startsWith("..")).toBe(true);

    new Baton(join(fx.repo, ".flume")).wake("plan");
    const chain: Chain = {
      phases: [
        makePhase({ name: "plan", concurrency: "singleton", promptPath: shipped }),
      ],
      humanOnly: [],
    };

    const prompts: string[] = [];
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: {
        name: "captures-prompt",
        async invoke(inv) {
          prompts.push(inv.prompt);
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      },
      log: silent,
    });

    const outcome = await dispatcher.tick();
    expect(outcome.declined).toBeFalsy();
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("shipped-by-the-package");
  });

  it("a fanout tick reads an absolute promptPath as the prompt file's address", async () => {
    expect(relative(fx.configDir, shipped).startsWith("..")).toBe(true);

    await writePending(fx.repo, [makeEntry("ADDR-A", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");
    const chain: Chain = {
      phases: [
        makePhase({ name: "build", concurrency: "fanout", promptPath: shipped }),
      ],
      humanOnly: [],
    };

    const prompts: string[] = [];
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: {
        name: "captures-prompt-per-entry",
        async invoke(inv) {
          prompts.push(inv.prompt);
          await writeAndCommit(inv.cwd, "src/a.ts", "a\n", "build: a");
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      },
      log: silent,
      maxParallel: 2,
    });

    const outcome = await dispatcher.tick();
    expect(outcome.result?.shippedTags).toEqual(["ADDR-A"]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("shipped-by-the-package");
  });

  it("a relative promptPath resolves beneath the chain's config directory", async () => {
    // The same basename exists inside the chain and inside the package; a
    // relative promptPath must find the chain's copy, never the address.
    await mkdir(join(fx.configDir, "prompts"), { recursive: true });
    await writeFile(
      join(fx.configDir, "prompts", "shipped.md"),
      "authored-beside-the-chain\n",
      "utf8",
    );

    new Baton(join(fx.repo, ".flume")).wake("plan");
    const chain: Chain = {
      phases: [
        makePhase({
          name: "plan",
          concurrency: "singleton",
          promptPath: join("prompts", "shipped.md"),
        }),
      ],
      humanOnly: [],
    };

    const prompts: string[] = [];
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: {
        name: "captures-prompt",
        async invoke(inv) {
          prompts.push(inv.prompt);
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      },
      log: silent,
    });

    await dispatcher.tick();
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("authored-beside-the-chain");
    expect(prompts[0]).not.toContain("shipped-by-the-package");
  });
});

// ---------- a hook that throws (spec/chain.md "What a hook receives")
// ----------

describe("Dispatcher — a hook that throws is answered the way its sibling seam already answers", () => {
  /** What each hook raises instead of returning. */
  const BOOM = "hook read a half-written file";

  /**
   * Every `render-refused` prior-attempt record under `<flumeDir>/
   * prior-attempts/`, by filename stem — the durable channel a refused tick
   * leaves for its retry. Read off disk rather than off the outcome, because
   * "persisted as for any other render refusal" is a claim about the file.
   */
  async function renderRefusedRecords(
    repo: string,
  ): Promise<Map<string, { mode: string; failures: string }>> {
    const root = priorAttemptsDir(join(repo, ".flume"));
    const out = new Map<string, { mode: string; failures: string }>();
    // Both keyspaces: a hook refusal is persisted for a singleton phase and
    // for a fanout entry alike, and each lands under its own directory.
    for (const keyspace of ["entry", "phase"]) {
      const dir = join(root, keyspace);
      if (!existsSync(dir)) continue;
      for (const name of (await readdir(dir)).sort()) {
        const rec = JSON.parse(await readFile(join(dir, name), "utf8")) as {
          mode: string;
          failures: string;
        };
        if (rec.mode === "render-refused") out.set(basename(name, ".json"), rec);
      }
    }
    return out;
  }

  it("a throwing promptArgs is a render-refused no-commit outcome", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      promptArgs: () => {
        throw new Error(BOOM);
      },
    });

    const prompts: string[] = [];
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: {
        name: "must-not-run-while-promptargs-throws",
        async invoke(inv) {
          prompts.push(inv.prompt);
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      },
      log: silent,
    });

    const preHead = await head(fx.repo);
    const outcome = await dispatcher.tick();

    // Non-vacuity (.claude/rules/engineering.md "A green verdict is proven
    // non-vacuous"): the phase really ran — the tick reached a result rather
    // than hibernating past the seam under test.
    expect(outcome.hibernated).toBe(false);
    expect(outcome.result?.phaseName).toBe("plan");

    // The prompt never resolved, so the agent was never invoked.
    expect(prompts).toHaveLength(0);
    expect(outcome.noCommit).toBe("render-refused");
    expect(outcome.result?.committed).toBe(false);
    expect(await head(fx.repo)).toBe(preHead);

    // The verdict is written and the bookkeeping is complete — the whole
    // point of answering the throw instead of losing the tick.
    expect(outcome.verdict?.noCommit).toBe("render-refused");
    expect(outcome.verdict?.committed).toBe(false);
    expect(outcome.verdict?.shippedTags).toEqual([]);
    expect(outcome.verdict?.headSha).toBe(preHead);

    // …and the record is the one any other render refusal persists, naming
    // the hook and the frame that raised so the retry is not blind.
    const records = await renderRefusedRecords(fx.repo);
    expect([...records.keys()]).toEqual(["plan"]);
    const failures = records.get("plan")!.failures;
    expect(failures).toContain("promptArgs hook threw");
    expect(failures).toContain(BOOM);
    expect(failures).toContain("Dispatcher.test.ts");
  });

  it("a throwing shouldRun refuses the tick rather than declining it", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      shouldRun: () => {
        throw new Error(BOOM);
      },
    });

    const prompts: string[] = [];
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: {
        name: "must-not-run-while-shouldrun-throws",
        async invoke(inv) {
          prompts.push(inv.prompt);
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      },
      log: silent,
    });

    const preHead = await head(fx.repo);
    const outcome = await dispatcher.tick();

    // Non-vacuity: the phase really ran, so the consult really happened.
    expect(outcome.hibernated).toBe(false);
    expect(outcome.result?.phaseName).toBe("plan");
    expect(prompts).toHaveLength(0);

    // The distinction under test: a hook that could not decide has not
    // decided to skip, so the verdict records a refusal and *not* a decline
    // the chain never reached.
    expect(outcome.declined).toBeUndefined();
    expect(outcome.verdict?.declined).toBeUndefined();
    expect(outcome.noCommit).toBe("render-refused");
    expect(outcome.result?.noCommit).toBe("render-refused");
    expect(outcome.verdict?.noCommit).toBe("render-refused");

    // Verdict written, bookkeeping complete, nothing on trunk.
    expect(outcome.verdict?.committed).toBe(false);
    expect(outcome.verdict?.headSha).toBe(preHead);
    expect(await head(fx.repo)).toBe(preHead);

    const records = await renderRefusedRecords(fx.repo);
    expect([...records.keys()]).toEqual(["plan"]);
    expect(records.get("plan")!.failures).toContain("shouldRun hook threw");
    expect(records.get("plan")!.failures).toContain(BOOM);
  });

  it("a declining shouldRun is still a decline, not a refusal", async () => {
    // The other direction of the pin above: the guard added for the throw
    // leaves the returned `false` exactly where it was.
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      shouldRun: () => false,
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async () => {}),
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.declined).toBe(true);
    expect(outcome.verdict?.declined).toBe(true);
    expect(outcome.noCommit).toBeUndefined();
    expect(await renderRefusedRecords(fx.repo)).toEqual(new Map());
  });

  it("the fanout copies of both pre-invocation seams answer a throw the same way", async () => {
    // One guard per seam, reached by both concurrencies
    // (.claude/rules/engineering.md "The fix lands at the mechanism"): the same
    // throw isolates one entry here exactly as it refuses the singleton tick
    // above.
    await writePending(fx.repo, [
      makeEntry("SHOULDRUN-THROWS", ["src/a.ts"]),
      makeEntry("PROMPTARGS-THROWS", ["src/b.ts"]),
    ]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      shouldRun: (ctx) => {
        if (ctx.assignedEntry?.tag === "SHOULDRUN-THROWS") throw new Error(BOOM);
        return true;
      },
      promptArgs: (ctx) => {
        if (ctx.assignedEntry?.tag === "PROMPTARGS-THROWS") throw new Error(BOOM);
        return {};
      },
    });

    const prompts: string[] = [];
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: {
        name: "must-not-run-for-either-entry",
        async invoke(inv) {
          prompts.push(inv.prompt);
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      },
      log: silent,
    });

    const outcome = await dispatcher.tick();

    // Non-vacuity: the wave really provisioned both entries, so both seams
    // were really reached.
    expect(outcome.verdict?.tags?.sort()).toEqual([
      "PROMPTARGS-THROWS",
      "SHOULDRUN-THROWS",
    ]);
    expect(prompts).toHaveLength(0);
    expect(outcome.noCommit).toBe("render-refused");
    expect(outcome.declined).toBeUndefined();
    expect(outcome.result?.shippedTags).toEqual([]);
    // Both entries stay queued for a retry that can read what raised.
    expect((readPendingFromDisk(fx.repo)).map((e) => e.tag).sort()).toEqual(
      ["PROMPTARGS-THROWS", "SHOULDRUN-THROWS"],
    );
    const records = await renderRefusedRecords(fx.repo);
    expect([...records.keys()].sort()).toEqual([
      "promptargs-throws",
      "shouldrun-throws",
    ]);
    expect(records.get("shouldrun-throws")!.failures).toContain(
      "shouldRun hook threw",
    );
    expect(records.get("promptargs-throws")!.failures).toContain(
      "promptArgs hook threw",
    );
  });

  it("the render-refused prior-attempt block does not send a hook-refused retry to fix an inline-exec span", async () => {
    // The agreement case for the block's one shared arm
    // (.claude/rules/engineering.md "A seam gate reads what the real writer
    // wrote"): the record is written by the real hook-refusal writer and read
    // back through the real renderer, because the two writers share one
    // `failures` string and the rendered prose is the only place the reader can
    // be told the wrong thing. The span writer's own side is pinned by the
    // no-commit taxonomy test above, which still asserts its failing span and
    // stderr reach the retry.
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");

    // Spelled in the span writer's vocabulary on purpose. The quoted record
    // is the one place in the block where these words legitimately appear,
    // so a negative that reads the whole rendered prompt reds here on every
    // host — instead of only when the tick's own worktree path happens to
    // spell one of them, which is what a worktree named after an entry tag
    // eventually does.
    const THROWN =
      "promptArgs hit a half-written inline-exec span; fix or remove the failing command in the failing span";

    // Throws on the first tick only, so the retry's render succeeds and its
    // prompt — the artifact under test — can be inspected.
    let calls = 0;
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      promptArgs: () => {
        if (calls++ === 0) throw new Error(THROWN);
        return {};
      },
    });

    const prompts: string[] = [];
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: {
        name: "reads-the-hook-refusal",
        async invoke(inv) {
          prompts.push(inv.prompt);
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      },
      log: silent,
    });

    const first = await dispatcher.tick();
    expect(first.noCommit).toBe("render-refused");
    expect(prompts).toHaveLength(0);

    // The record as the refusing writer left it, read before the retry
    // consumes it: the exact text the renderer quotes back below.
    const quoted = (await renderRefusedRecords(fx.repo)).get("plan")!.failures;
    expect(quoted).toContain(THROWN);

    baton.wake("plan");
    await dispatcher.tick();

    // Non-vacuity: the retry really rendered, and really carries the record
    // the hook refusal wrote — nothing below is asserted over an absent block.
    expect(prompts).toHaveLength(1);
    const retry = prompts[0]!;
    expect(retry).toContain("<prior-attempt>");
    expect(retry).toContain(RENDER_REFUSED_INTRO);
    expect(retry).toContain("promptArgs hook threw");
    expect(retry).toContain(THROWN);

    // The subject the negatives below name: the arm's own prose — the
    // `<prior-attempt>` block with the verbatim record it quotes excised,
    // line by line. That quote is the writer's text and its stack, whose
    // absolute frames are this tick's worktree path, so anything asserted
    // over it judges what the tick is called rather than what the arm says.
    const open = retry.indexOf("<prior-attempt>");
    const close = retry.indexOf("</prior-attempt>");
    expect(close).toBeGreaterThan(open);
    const quotedLines = new Set(
      quoted
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0),
    );
    const arm = retry
      .slice(open, close)
      .split("\n")
      .filter((l) => !quotedLines.has(l.trim()))
      .join("\n");

    // Non-vacuity, both directions: the arm's prose survived the excision and
    // the quote did not, so the negatives run over a populated subject that
    // no longer contains the record.
    expect(arm).toContain(RENDER_REFUSED_INTRO);
    expect(arm).not.toContain(THROWN);

    // What the arm must not tell this retry: that a span it never had failed,
    // and that removing a command it never ran is the fix.
    expect(arm).not.toMatch(/inline-exec/i);
    expect(arm).not.toMatch(/failing span/i);
    expect(arm).not.toMatch(/failing command/i);
    expect(arm).not.toMatch(/fix or remove/i);
  });

  it("a throwing handoff is logged and the tick's facts stand", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      handoff: () => {
        throw new Error(BOOM);
      },
    });

    const warnings: string[] = [];
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async (cwd) => {
        await writeAndCommit(cwd, "src/derived.ts", "y\n", "plan: derive");
      }),
      log: { info: () => {}, warn: (l) => warnings.push(l), error: () => {} },
    });

    const preHead = await head(fx.repo);
    const outcome = await dispatcher.tick();
    const tip = await head(fx.repo);

    // The facts are written before the hook runs, so they stand: the commit
    // is on trunk and the verdict names it.
    expect(tip).not.toBe(preHead);
    expect(outcome.result?.committed).toBe(true);
    expect(outcome.result?.commitSha).toBe(tip);
    expect(await readFile(join(fx.repo, "src/derived.ts"), "utf8")).toBe("y\n");
    expect(outcome.verdict?.committed).toBe(true);
    expect(outcome.verdict?.headSha).toBe(tip);
    expect(outcome.verdict?.noCommit).toBeUndefined();

    // The throw costs exactly the wakes the hook never got to name: the
    // phase is asleep (that happens before the hook runs) and nothing else
    // woke.
    expect(outcome.awakeAfter).toEqual([]);
    expect(baton.awake()).toEqual([]);

    // …and it is logged, not swallowed (.claude/rules/engineering.md "Loud or
    // nothing").
    expect(
      warnings.some((w) => w.includes("handoff threw") && w.includes(BOOM)),
    ).toBe(true);
  });

  it("a throwing shipped leaves the entry pending and names the throw on the verdict", async () => {
    await writePending(fx.repo, [makeEntry("SHIPPED-THROWS", ["src/s.ts"])]);
    const flumeDir = join(fx.repo, ".flume");
    new Baton(flumeDir).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      shipped: () => {
        throw new Error(BOOM);
      },
    });

    const warnings: string[] = [];
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({
        "shipped-throws": (cwd) =>
          writeAndCommit(
            cwd,
            "src/s.ts",
            "landed\n",
            "build(SHIPPED-THROWS): land it",
          ),
      }),
      log: { info: () => {}, warn: (l) => warnings.push(l), error: () => {} },
    });

    const outcome = await dispatcher.tick();

    // Non-vacuity: the entry's commit really reached trunk, so the ship
    // predicate really ran — a throw before cherry-pick would leave the same
    // "stays pending" verdict for a different reason.
    expect(await readFile(join(fx.repo, "src/s.ts"), "utf8")).toBe("landed\n");

    // Not `false`, but the same outcome `false` already has: entry queued,
    // commit left on trunk.
    expect(outcome.result?.shippedTags).toEqual([]);
    expect((readPendingFromDisk(fx.repo)).map((e) => e.tag)).toEqual([
      "SHIPPED-THROWS",
    ]);

    // The verdict names the throw, so a broken predicate never reads back as
    // a deliberate park.
    const rows = outcome.verdict?.mergeOutcomes ?? [];
    expect(rows, "the wave recorded no merge outcome").not.toHaveLength(0);
    const row = rows.find((m) => m.entryTag === "SHIPPED-THROWS");
    expect(row?.outcome).toBe("not-shipped");
    expect(row?.threw).toBe(BOOM);
    expect(
      warnings.some((w) => w.includes("shipped threw") && w.includes(BOOM)),
    ).toBe(true);

    // The retry channel is the one a declined ship already writes.
    const record = JSON.parse(
      await readFile(priorAttemptPath(flumeDir, entryRef("SHIPPED-THROWS")), "utf8"),
    ) as Record<string, unknown>;
    expect(record.mode).toBe("not-shipped");
  });

  it("a `shipped` predicate that returns false records no throw on the verdict", async () => {
    // The other direction: `threw` is present only when a throw produced the
    // `not-shipped` outcome, so the two never collapse into one record.
    await writePending(fx.repo, [makeEntry("SHIPPED-DECLINES", ["src/d.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      shipped: () => false,
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({
        "shipped-declines": (cwd) =>
          writeAndCommit(
            cwd,
            "src/d.ts",
            "landed\n",
            "build(SHIPPED-DECLINES): land it",
          ),
      }),
      log: silent,
    });

    const outcome = await dispatcher.tick();

    const rows = outcome.verdict?.mergeOutcomes ?? [];
    expect(rows, "the wave recorded no merge outcome").not.toHaveLength(0);
    expect(rows[0]?.outcome).toBe("not-shipped");
    expect(rows[0]?.threw).toBeUndefined();
  });
});

describe("Dispatcher — a differential gate's checkout: api.git.checkoutAt, reclaimed by the engine at the gate boundary (API-CHECKOUT-AT-FOR-A-DIFFERENTIAL-GATE, spec/chain.md 'What a gate receives')", () => {
  /**
   * One afterCommit gate that asks the API for the tree at its own
   * `baseSha`, hands the planted path back through `onPlanted`, and then does
   * whatever `then` says — return a verdict or throw. The three tests below
   * differ only in that last step, so the provisioning half is stated once.
   */
  function differentialGate(
    onPlanted: (path: string, ctx: GateContext) => Promise<void> | void,
    then: () => GateResult,
  ): Gate {
    return {
      name: "differential",
      when: "afterCommit",
      async run(ctx) {
        // Through the API a chain factory is handed, not through the module:
        // `api.git.checkoutAt` is the surface the spec names, and a chain has
        // no other way to reach it.
        const api = buildFlumeApi({
          repoRoot: fx.repo,
          configDir: fx.configDir,
          flumeDir: ctx.flumeDir,
        });
        const planted = await api.git.checkoutAt({
          repoRoot: ctx.repoRoot,
          flumeDir: ctx.flumeDir,
          sha: ctx.baseSha,
        });
        await onPlanted(planted, ctx);
        return then();
      },
    };
  }

  /**
   * Is `path` a tree git currently registers as a worktree of the fixture
   * repo? One reading of the registry serves the whole file
   * (`registeredWorktrees`); a second probe beside it is the duplication
   * this suite exists to avoid.
   */
  async function registered(path: string): Promise<boolean> {
    return (await registeredWorktrees()).includes(resolve(path));
  }

  it("api.git.checkoutAt plants a detached checkout under the state root's worktree base", async () => {
    // The tree at `baseSha`, not a file out of it: a differential gate wants
    // the bytes the tick branched from laid out on disk to run something in,
    // and provisions nothing of its own to get them.
    await writeAndCommit(fx.repo, "src/widget.ts", "base\n", "seed: widget");
    new Baton(join(fx.repo, ".flume")).wake("plan");
    const branchedFrom = await head(fx.repo);

    let planted: string | undefined;
    let flumeDirSeen: string | undefined;
    let headThere: string | undefined;
    let detached: boolean | undefined;
    let bytesThere: string | undefined;
    let registeredDuringGate: boolean | undefined;

    const gate = differentialGate(
      async (path, ctx) => {
        planted = path;
        flumeDirSeen = ctx.flumeDir;
        headThere = (
          await exec("git", ["rev-parse", "HEAD"], { cwd: path })
        ).stdout.trim();
        // No ref to clean up: `symbolic-ref HEAD` exits non-zero on a
        // detached head, which is the whole claim.
        detached = await exec("git", ["symbolic-ref", "-q", "HEAD"], {
          cwd: path,
        }).then(
          () => false,
          () => true,
        );
        bytesThere = await readFile(join(path, "src", "widget.ts"), "utf8");
        registeredDuringGate = await registered(path);
      },
      () => ({ ok: true, message: "differed" }),
    );

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({
        phases: [makePhase({ name: "plan", gates: [gate] })],
        humanOnly: [],
      }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent((cwd) =>
        writeAndCommit(cwd, "src/widget.ts", "merged\n", "plan: move the widget"),
      ),
      log: silent,
    });

    const outcome = await dispatcher.tick();

    // Non-vacuity: the gate actually ran, on a span that actually committed.
    expect(outcome.result?.committed).toBe(true);
    expect(outcome.result?.gateResults.map((g) => g.gate)).toContain("differential");

    expect(planted).toBeDefined();
    // Under the state root's worktree base — the engine's own resolution,
    // honoring an operator's relocation of it — not a temp dir of the gate's.
    expect(flumeDirSeen).toBe(join(fx.repo, ".flume"));
    expect(dirname(planted!)).toBe(worktreesBase(flumeDirSeen!));
    // A real checkout git owns, at the sha the span branched from, detached.
    expect(registeredDuringGate).toBe(true);
    expect(headThere).toBe(branchedFrom);
    expect(detached).toBe(true);
    // And it carries the base's bytes, not the tick's — which is the only
    // reason a differential gate wanted a second tree at all.
    expect(bytesThere).toBe("base\n");
  });

  it("the engine removes a gate's checkout when the gate returns", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    let planted: string | undefined;
    let presentDuringGate: boolean | undefined;

    const gate = differentialGate(
      async (path) => {
        planted = path;
        presentDuringGate = existsSync(path) && (await registered(path));
      },
      () => ({ ok: true, message: "differed" }),
    );

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({
        phases: [makePhase({ name: "plan", gates: [gate] })],
        humanOnly: [],
      }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent((cwd) =>
        writeAndCommit(cwd, "src/out.ts", "ok\n", "plan: derive"),
      ),
      log: silent,
    });

    const outcome = await dispatcher.tick();

    // Non-vacuity: a checkout existed to be reclaimed, and the gate returned
    // a verdict the tick acted on.
    expect(planted).toBeDefined();
    expect(presentDuringGate).toBe(true);
    expect(outcome.result?.gateResults).toContainEqual(
      expect.objectContaining({ gate: "differential", ok: true }),
    );
    expect(outcome.result?.committed).toBe(true);

    // The gate wrote no `finally` of its own: the directory is gone and git
    // no longer registers it.
    expect(existsSync(planted!)).toBe(false);
    expect(await registered(planted!)).toBe(false);
  });

  it("the engine removes a gate's checkout when the gate throws", async () => {
    // The leg a gate's own cleanup is most likely to miss: it crashed
    // mid-differential, so nothing it wrote ran.
    new Baton(join(fx.repo, ".flume")).wake("plan");

    let planted: string | undefined;
    let presentDuringGate: boolean | undefined;

    const gate = differentialGate(
      async (path) => {
        planted = path;
        presentDuringGate = existsSync(path) && (await registered(path));
      },
      () => {
        throw new Error("the differential blew up mid-run");
      },
    );

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader({
        phases: [makePhase({ name: "plan", gates: [gate] })],
        humanOnly: [],
      }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent((cwd) =>
        writeAndCommit(cwd, "src/out.ts", "ok\n", "plan: derive"),
      ),
      log: silent,
    });

    const outcome = await dispatcher.tick();

    // Non-vacuity: the checkout existed, and the throw is what ended the gate.
    expect(planted).toBeDefined();
    expect(presentDuringGate).toBe(true);
    expect(outcome.result?.gateResults).toContainEqual(
      expect.objectContaining({
        gate: "differential",
        ok: false,
        message: "the differential blew up mid-run",
      }),
    );

    expect(existsSync(planted!)).toBe(false);
    expect(await registered(planted!)).toBe(false);
  });
});

// ---------- `landedOnSha`: the trunk tip a gated span landed onto ----------

/**
 * `baseSha` is what the tick *saw* when it branched, and every sibling in a
 * fanout wave shares it. `landedOnSha` is where trunk actually stood when
 * this entry's span was carried across — a place the sibling picked ahead of
 * it has already moved. A cumulative afterMerge gate, one measuring a set on
 * trunk before and after this entry, needs the second and had no way to read
 * it but `HEAD^`, which is right only while a span lands as one commit
 * (spec/chain.md "What a gate receives").
 */
describe("Dispatcher — the trunk tip an afterMerge span landed onto", () => {
  /** A gate that records every context it is handed, key presence included. */
  function ctxProbe(
    name: string,
    when: GatePhase,
    seen: GateContext[],
  ): Gate {
    return {
      name,
      when,
      run(ctx) {
        seen.push({ ...ctx });
        return Promise.resolve({ ok: true, message: `${name} probed` });
      },
    };
  }

  /** An agent leg that commits one file into its own worktree. */
  const commitsFile = (rel: string) => (cwd: string) =>
    writeAndCommit(cwd, rel, "landed\n", `build: ${rel}`);

  function fanoutDispatcher(
    gates: Gate[],
    bySlug: Record<string, (cwd: string) => Promise<void>>,
  ): Dispatcher {
    return new Dispatcher({
      chainLoader: staticLoader({
        phases: [
          makePhase({ name: "build", concurrency: "fanout", gates }),
        ],
        humanOnly: [],
      }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent(bySlug),
      log: silent,
      maxParallel: 4,
    });
  }

  it("an afterMerge gate context carries the trunk tip the span landed onto", async () => {
    await writePending(fx.repo, [
      makeEntry("LANDED-ONE", ["src/landed-one.ts"]),
    ]);
    new Baton(join(fx.repo, ".flume")).wake("build");
    // Nothing lands on trunk between here and the pick — the wave's own
    // queue rewrite comes after every gate — so this *is* the tip the span
    // is about to be carried onto.
    const preHead = await head(fx.repo);

    const seen: GateContext[] = [];
    const outcome = await fanoutDispatcher(
      [ctxProbe("merge-probe", "afterMerge", seen)],
      { "landed-one": commitsFile("src/landed-one.ts") },
    ).tick();

    expect(outcome.result?.shippedTags).toEqual(["LANDED-ONE"]);
    // Vacuity: every assertion below reads a context the probe captured.
    expect(seen, "the afterMerge probe never ran").toHaveLength(1);
    const ctx = seen[0]!;

    expect(ctx.landedOnSha).toBe(preHead);
    expect(ctx.landedOnSha).not.toBe(ctx.commitSha);
    // "Landed onto", read off git rather than off the same field: this span
    // reached trunk as one commit, so its parent is the tip it landed on.
    const { stdout: parent } = await exec(
      "git",
      ["rev-parse", `${ctx.commitSha}^`],
      { cwd: fx.repo },
    );
    expect(ctx.landedOnSha).toBe(parent.trim());
  });

  it("an afterCommit gate context carries no landedOnSha", async () => {
    await writePending(fx.repo, [
      makeEntry("LANDED-BOTH", ["src/landed-both.ts"]),
    ]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const atCommit: GateContext[] = [];
    const atMerge: GateContext[] = [];
    const outcome = await fanoutDispatcher(
      [
        ctxProbe("commit-probe", "afterCommit", atCommit),
        ctxProbe("merge-probe", "afterMerge", atMerge),
      ],
      { "landed-both": commitsFile("src/landed-both.ts") },
    ).tick();

    expect(outcome.result?.shippedTags).toEqual(["LANDED-BOTH"]);
    expect(atCommit, "the afterCommit probe never ran").toHaveLength(1);
    expect(atMerge, "the afterMerge probe never ran").toHaveLength(1);
    // Control first, so the absence below is the *stage's* and not the
    // field's: the same tick set it on the other stage
    // (.claude/rules/engineering.md "A green verdict is proven non-vacuous").
    expect(atMerge[0]!.landedOnSha).toMatch(/^[0-9a-f]{40}$/);

    expect("landedOnSha" in atCommit[0]!).toBe(false);
    expect(atCommit[0]!.landedOnSha).toBeUndefined();
  });

  it("landedOnSha is the lower end of the range touchedPaths is diffed over", async () => {
    // Two entries with disjoint declared files fan out into one batch and
    // are picked one after the other, so the second lands onto a trunk the
    // first has already moved — the case a wave-shared `baseSha` cannot see.
    await writePending(fx.repo, [
      makeEntry("LANDED-FIRST", ["src/landed-first.ts"]),
      makeEntry("LANDED-SECOND", ["src/landed-second.ts"]),
    ]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const seen: GateContext[] = [];
    const outcome = await fanoutDispatcher(
      [ctxProbe("merge-probe", "afterMerge", seen)],
      {
        "landed-first": commitsFile("src/landed-first.ts"),
        "landed-second": commitsFile("src/landed-second.ts"),
      },
    ).tick();

    expect(outcome.result?.shippedTags?.slice().sort()).toEqual([
      "LANDED-FIRST",
      "LANDED-SECOND",
    ]);
    expect(seen, "the afterMerge probe ran for fewer than both entries")
      .toHaveLength(2);

    // The range each context reports is exactly the one its own
    // `touchedPaths` was diffed over — driven through the engine's own diff
    // helper, not a second spelling of it here.
    for (const ctx of seen) {
      expect(ctx.landedOnSha).toMatch(/^[0-9a-f]{40}$/);
      expect(
        await git.diffNameOnly(fx.repo, ctx.landedOnSha!, ctx.commitSha),
      ).toEqual(ctx.touchedPaths);
    }

    // Read in pick order, whichever entry each turned out to be: both
    // branched from one tip, and the second landed onto where the first
    // left trunk.
    const [first, second] = seen as [GateContext, GateContext];
    expect(second.baseSha).toBe(first.baseSha);
    expect(second.landedOnSha).toBe(first.commitSha);
    expect(second.landedOnSha).not.toBe(second.baseSha);
    // And the shared base is the wrong lower end: over it the second
    // entry's range carries its sibling's file as well as its own.
    expect(
      await git.diffNameOnly(fx.repo, second.baseSha, second.commitSha),
    ).toEqual(["src/landed-first.ts", "src/landed-second.ts"]);
  });
});

/**
 * spec/pending.md "Queue reads are strict": the strict read's one carve-out.
 * A refusal that also stops the phase whose rewrite is the repair leaves an
 * unparseable queue clearable only by hand, so the refusal is keyed on the
 * phase's **declared** fence — the same `writablePaths` the write guard
 * enforces, never an intent inferred from the phase's name or its last commit
 * (`.claude/rules/engine-boundary.md`, *Told, not inferred*).
 *
 * The queue is committed rather than left on disk: every decide-read resolves
 * the committed `HEAD` tip (spec/pending.md, "Dispatch reads come from the
 * tip, not the tree"), so an uncommitted corrupt file would be invisible to
 * the read under test and each case below would pass over a clean queue.
 */
describe("Dispatcher — the queue's declared writer runs over an unparseable queue", () => {
  /** What every case here corrupts the committed queue with. */
  const CORRUPT = "{ this is not valid json";
  /** The queue directory, repo-relative in git's alphabet — what a refusal names. */
  const QUEUE_REL = ".flume/plan/pending";
  /** The fence a queue's writer declares: the entry files, never the directory. */
  const QUEUE_GLOB = `${QUEUE_REL}/*.json`;
  /** The one corrupt entry every case here commits, repo-relative. */
  const CORRUPT_REL = `${QUEUE_REL}/${entryFileName("CORRUPT")}`;

  it("a phase whose writable paths include the queue is invoked over an unparseable queue", async () => {
    await commitEntryFile(fx.repo, entryFileName("CORRUPT"), CORRUPT);
    new Baton(join(fx.repo, ".flume")).wake("plan");

    // Repaired in place, under the name it is reachable by: the filename and
    // the tag agree, so the repair is an edit to the file that did not parse.
    const repaired: PendingEntry[] = [makeEntry("CORRUPT", ["src/a.ts"])];
    let invoked = false;
    const agent: Agent = {
      name: "fake-queue-writer",
      async invoke(inv) {
        invoked = true;
        // The rewrite *is* the repair: this phase's whole output is the
        // queue, so it writes a parseable one over the corrupt tip.
        await writeAndCommit(
          inv.cwd,
          CORRUPT_REL,
          JSON.stringify(repaired[0], null, 2) + "\n",
          "plan: re-derive the queue",
        );
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      writablePaths: [QUEUE_GLOB],
      gates: [],
    });

    const outcome = await new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    }).tick();

    expect(invoked).toBe(true);
    expect(outcome.failed).toBeUndefined();
    expect(outcome.result?.committed).toBe(true);
    // The repair reached trunk, so the next tick's strict read resolves.
    expect(readPendingFromDisk(fx.repo)).toEqual(repaired);
  });

  it("a phase that cannot write the queue is refused over an unparseable one", async () => {
    await commitEntryFile(fx.repo, entryFileName("CORRUPT"), CORRUPT);
    new Baton(join(fx.repo, ".flume")).wake("build");

    let invoked = false;
    const agent: Agent = {
      name: "fake-non-writer",
      async invoke() {
        invoked = true;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    // `src/**` names no queue path, so this phase could not rewrite the queue
    // even if it ran — the refusal stands exactly as it did before the
    // carve-out existed.
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      gates: [],
    });

    const errors: string[] = [];
    const rec: Logger = {
      info: () => {},
      warn: () => {},
      error: (l) => errors.push(l),
    };

    const preHead = await head(fx.repo);
    const outcome = await new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: rec,
    }).tick();

    expect(invoked).toBe(false);
    expect(outcome.failed).toBe(true);
    expect(outcome.result).toBeUndefined();
    // The refusal names the fence verdict that kept it standing, not just the
    // broken file: with a carve-out in place, "why was this tick refused" is a
    // fact the engine decided on and therefore reports
    // (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
    // never rediscovered*).
    expect(errors.length).toBeGreaterThan(0);
    const refusal = errors.find((e) => e.includes("failed to parse"));
    expect(refusal).toBeDefined();
    expect(refusal).toContain("'build' does not declare");
    // The file the repair would write, not the directory: the fence verdict
    // is over exactly the entries that did not parse.
    expect(refusal).toContain(CORRUPT_REL);
    expect(outcome.summary).toContain(QUEUE_REL);
    // Nothing was written over the corrupt tip by the refusal itself.
    expect(await head(fx.repo)).toBe(preHead);
    expect(await readFile(join(fx.repo, CORRUPT_REL), "utf8")).toBe(CORRUPT);
  });

  it("the tick context carries the queue's parse failure as a fact", async () => {
    await commitEntryFile(fx.repo, entryFileName("CORRUPT"), CORRUPT);
    new Baton(join(fx.repo, ".flume")).wake("plan");

    let seen: TickContext | undefined;
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      writablePaths: [QUEUE_GLOB],
      gates: [],
      promptArgs: (ctx) => {
        seen = ctx;
        return {};
      },
    });

    const agent: Agent = {
      name: "fake-queue-writer",
      async invoke() {
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const outcome = await new Dispatcher({
      chainLoader: staticLoader({ phases: [phase], humanOnly: [] }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    }).tick();

    expect(seen).toBeDefined();
    // Non-vacuity: the parse really did fail, and the errors really are the
    // parse's own — a green over an empty error list would prove nothing
    // (`.claude/rules/engineering.md`, *A green verdict is proven
    // non-vacuous*).
    expect(seen!.queueParseFailure?.errors.length).toBeGreaterThan(0);
    expect(seen!.queueParseFailure?.path).toBe(QUEUE_REL);
    expect(seen!.queueParseFailure?.errors[0]?.message).toContain(
      "invalid JSON",
    );
    // `pending` is empty because nothing resolved, never because the queue is
    // drained — this field is what tells the two apart, on the context the
    // agent's prompt is built from and on the result the handoff reads.
    expect(seen!.pending).toEqual([]);
    expect(outcome.result?.queueParseFailure?.path).toBe(QUEUE_REL);
  });
});

/**
 * ENTRY-PRIORITY-ORDERS-THE-QUEUE (`spec/pending.md`, *The entry core*): the
 * queue's order is a field, never a position — `priority` descending, then
 * tag ascending, at every surface that selects.
 *
 * Each case writes a queue whose own order agrees with the queue's ordering
 * on neither axis, then reads the order back off the engine's *reported*
 * surfaces — the wave's batch, `TickResult.pickableAfter`, and `render`'s
 * preview — rather than off the comparator beside them: a sort asserted at
 * its own producer proves self-agreement and nothing about what a tick picks
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*).
 *
 * The agents here commit nothing, so every entry stays queued and the
 * post-tick sets are read over the queue the pre-tick selection saw.
 */
describe("Dispatcher — `priority` is the order every selection takes", () => {
  /**
   * Three open entries, disjoint by files, in an order no ordering would
   * produce: the top priority is written last, and the two that tie on
   * priority are written in descending tag order.
   */
  const scrambled = (): PendingEntry[] => [
    { ...makeEntry("BETA", ["src/beta.ts"]), priority: 1 },
    { ...makeEntry("ALPHA", ["src/alpha.ts"]), priority: 1 },
    { ...makeEntry("GAMMA", ["src/gamma.ts"]), priority: 5 },
  ];

  /** The order those three sort into: 5 first, then the tie broken on tag. */
  const ordered = ["GAMMA", "ALPHA", "BETA"];

  /** A fanout `build` phase, the baton woken for it, and a chain carrying it. */
  const wakeBuild = (): Chain => {
    new Baton(join(fx.repo, ".flume")).wake("build");
    return {
      phases: [makePhase({ name: "build", concurrency: "fanout", gates: [] })],
      humanOnly: [],
    };
  };

  /** An agent that runs for each of the three slugs and commits nothing. */
  const noopWave = (): Agent =>
    fanoutAgent({
      alpha: async () => {},
      beta: async () => {},
      gamma: async () => {},
    });

  it("selection orders entries by priority descending, then tag ascending", async () => {
    await writePending(fx.repo, scrambled());
    const chain = wakeBuild();
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: noopWave(),
      log: silent,
    });

    // `render`'s preview, taken before the tick it previews: the same
    // selection, one call short of invoking an agent.
    const preview = await dispatcher.render({ phase: "build" });
    expect(preview.pickable.map((e) => e.tag)).toEqual(ordered);
    expect(preview.entry?.tag).toBe("GAMMA");

    const outcome = await dispatcher.tick();

    // Non-vacuity: the directory's own listing order is alphabetical and all
    // three entries are still in it — so the order above is the selection's,
    // and not the order the queue was read in.
    expect(readPendingFromDisk(fx.repo).map((e) => e.tag)).toEqual([
      "ALPHA",
      "BETA",
      "GAMMA",
    ]);
    expect(outcome.result?.pendingAfter.map((e) => e.tag)).toEqual([
      "ALPHA",
      "BETA",
      "GAMMA",
    ]);
    // The wave's batch, in the order the wave carried it.
    expect(outcome.result?.entries?.map((e) => e.tag)).toEqual(ordered);
    // The post-tick re-derivation the handoff routes on.
    expect(outcome.result?.pickableAfter.map((e) => e.tag)).toEqual(ordered);
  });

  it("an entry declaring no priority sorts as zero", async () => {
    // One entry above the default, one below, and one declaring nothing at
    // all: the undeclared entry lands between them, which it can only do by
    // being read as 0 rather than as absent.
    const { priority: _default, ...declaresNone } = makeEntry("BETA", [
      "src/beta.ts",
    ]);
    await writePending(fx.repo, [
      { ...makeEntry("ALPHA", ["src/alpha.ts"]), priority: -1 },
      declaresNone as PendingEntry,
      { ...makeEntry("GAMMA", ["src/gamma.ts"]), priority: 1 },
    ]);
    const chain = wakeBuild();

    const outcome = await new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: noopWave(),
      log: silent,
    }).tick();

    // Non-vacuity: the entry that declares nothing really is on the queue,
    // and really declares no priority on disk.
    const onDisk = readPendingFromDisk(fx.repo);
    expect(onDisk.map((e) => e.tag)).toContain("BETA");
    const raw = JSON.parse(
      await readFile(
        join(queueDirOf(fx.repo), entryFileName("BETA")),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(raw).not.toHaveProperty("priority");

    expect(outcome.result?.pickableAfter.map((e) => e.tag)).toEqual([
      "GAMMA",
      "BETA",
      "ALPHA",
    ]);
    expect(outcome.result?.entries?.map((e) => e.tag)).toEqual([
      "GAMMA",
      "BETA",
      "ALPHA",
    ]);
  });
});

/**
 * The per-entry claim (`spec/pending.md`, *Claims — an entry in flight is
 * left alone*): the file a build tick stakes before it provisions an entry's
 * worktree, the set every selection reads it as, and the drop that ends it.
 *
 * Both sides of the seam are the real writers: the claims a case plants are
 * written with the engine's own statement (`renderPidClaim`,
 * `src/pidClaim.ts`) at the engine's own address (`entryClaimPath`,
 * `src/entryClaims.ts`), and the claims a case reads back are the ones a real
 * wave staked (`.claude/rules/engineering.md`, *A seam gate reads what the
 * real writer wrote*).
 */
describe("Dispatcher fanout — the per-entry claim", () => {
  /** Where this repository's claim for `tag` lives, through the engine's own address. */
  const claimPathFor = async (tag: string): Promise<string> =>
    entryClaimPath(await git.gitCommonDir(fx.repo), entryClaimSlug(tag));

  /** Plant a claim on `tag` held by `pid`, as a sibling tick would have written it. */
  async function plantClaim(tag: string, pid: number): Promise<string> {
    const path = await claimPathFor(tag);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, renderPidClaim(pid, new Date()), "utf8");
    return path;
  }

  /** A fanout `build` phase and the baton woken for it. */
  const wakeBuild = (): Phase => {
    new Baton(join(fx.repo, ".flume")).wake("build");
    return makePhase({ name: "build", concurrency: "fanout", gates: [] });
  };

  it("a build tick stakes its entry's claim before provisioning the worktree", async () => {
    // BLOCKED's worktree path is occupied by a plain file git registers as
    // nothing, so `createWorktree` refuses it — the entry reaches the
    // provisioning loop and leaves it with no worktree at all. Its claim can
    // therefore only stand if the stake ran ahead of the provisioning, which
    // is the ordering under test.
    const blockedPath = join(
      worktreesBase(join(fx.repo, ".flume")),
      worktreeDirName("BLOCKED"),
    );
    await mkdir(dirname(blockedPath), { recursive: true });
    await writeFile(blockedPath, "not a worktree\n", "utf8");

    await writePending(fx.repo, [
      makeEntry("BLOCKED", ["src/blocked.ts"]),
      makeEntry("OBSERVER", ["src/observer.ts"]),
    ]);
    const chain: Chain = { phases: [wakeBuild()], humanOnly: [] };

    // Read mid-wave, from inside the sibling entry's agent: a claim asserted
    // after the tick would be asserting the drop, not the stake.
    let midWave: { claim: string | null; worktree: boolean } | undefined;
    const agent = fanoutAgent({
      observer: async (cwd) => {
        const path = await claimPathFor("BLOCKED");
        midWave = {
          claim: existsSync(path) ? await readFile(path, "utf8") : null,
          worktree: existsSync(blockedPath) && lstatSync(blockedPath).isDirectory(),
        };
        await writeAndCommit(cwd, "src/observer.ts", "ok\n", "build: OBSERVER");
      },
    });

    const outcome = await new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    }).tick();

    // Non-vacuity: the wave really did reach the provisioning loop for
    // BLOCKED and really did fail it, so the claim below is one staked for an
    // entry whose worktree was never created.
    expect(outcome.result?.provisionFailures?.map((f) => f.tag)).toEqual([
      "BLOCKED",
    ]);
    expect(midWave, "the observer entry's agent never ran").toBeDefined();
    expect(midWave!.worktree).toBe(false);
    // The claim stood, and it names this process — the tick's own holder,
    // read back through the engine's own decode.
    expect(midWave!.claim).not.toBeNull();
    expect(parsePidClaim(midWave!.claim!)?.pid).toBe(process.pid);
  });

  it("the claim is removed when an attempt ends without shipping", async () => {
    await writePending(fx.repo, [makeEntry("NOSHIP", ["src/noship.ts"])]);
    const chain: Chain = { phases: [wakeBuild()], humanOnly: [] };

    // Non-vacuity for the removal below: the claim is read while the attempt
    // is live, so a tick that never staked one would red here rather than
    // pass the absence assertion by having nothing to drop.
    let standingMidAttempt: boolean | undefined;
    const agent = fanoutAgent({
      noship: async () => {
        standingMidAttempt = existsSync(await claimPathFor("NOSHIP"));
      },
    });

    const outcome = await new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    }).tick();

    expect(standingMidAttempt).toBe(true);
    // The attempt ended with the teardown rather than a ship: nothing
    // committed, and the entry is still queued.
    expect(outcome.result?.committed).toBe(false);
    expect(outcome.result?.shippedTags).toEqual([]);
    expect(outcome.result?.pendingAfter.map((e) => e.tag)).toEqual(["NOSHIP"]);
    expect(existsSync(await claimPathFor("NOSHIP"))).toBe(false);
  });

  it("selection skips an entry another tick holds a claim on", async () => {
    // The vitest worker plays the sibling tick — its pid is alive for the
    // duration of the case, the convention every liveness case here uses.
    const held = await plantClaim("HELD", process.pid);

    await writePending(fx.repo, [
      makeEntry("FREE", ["src/free.ts"]),
      makeEntry("HELD", ["src/held.ts"]),
    ]);
    const chain: Chain = { phases: [wakeBuild()], humanOnly: [] };

    // Registered for `FREE` alone: the wave throwing "no action registered
    // for slug 'held'" is this case's loudest possible failure, so the skip
    // is proven at dispatch as well as in the reported sets.
    const outcome = await new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({
        free: async (cwd) =>
          writeAndCommit(cwd, "src/free.ts", "ok\n", "build: FREE"),
      }),
      log: silent,
    }).tick();

    // The unclaimed entry shipped; the claimed one never reached an agent and
    // is still `open` on disk, since the claim touches no queue.
    expect(outcome.result?.shippedTags).toEqual(["FREE"]);
    expect(outcome.result?.entries?.map((e) => e.tag)).toEqual(["FREE"]);
    expect(outcome.result?.pendingAfter.map((e) => e.tag)).toEqual(["HELD"]);
    expect(outcome.result?.pickableAfter.map((e) => e.tag)).toEqual([]);
    // And the wave dropped only what it staked: a sibling's claim outlives a
    // tick that merely read it.
    expect(existsSync(held)).toBe(true);
  });

  it("TickResult.claimedTags reports the claims the tick read", async () => {
    await plantClaim("HELD-ONE", process.pid);
    await plantClaim("HELD-TWO", process.pid);

    await writePending(fx.repo, [
      { ...makeEntry("FREE", ["src/free.ts"]), priority: 1 },
      makeEntry("HELD-ONE", ["src/one.ts"]),
      makeEntry("HELD-TWO", ["src/two.ts"]),
    ]);
    const chain: Chain = { phases: [wakeBuild()], humanOnly: [] };

    const outcome = await new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({ free: async () => {} }),
      log: silent,
    }).tick();

    // Both held entries, by tag, in the queue's own order — beside a pickable
    // set that carries neither, which is the pairing the field exists for.
    expect(outcome.result?.claimedTags).toEqual(["HELD-ONE", "HELD-TWO"]);
    expect(outcome.result?.pickableAfter.map((e) => e.tag)).toEqual(["FREE"]);
    // Non-vacuity: all three are still queued, so the set above is a hold and
    // not a drained queue.
    expect(outcome.result?.pendingAfter.map((e) => e.tag).sort()).toEqual([
      "FREE",
      "HELD-ONE",
      "HELD-TWO",
    ]);
  });

  it("the claimed set the engine reports is the one it hands the tick's own context", async () => {
    await plantClaim("HELD", process.pid);
    await writePending(fx.repo, [
      { ...makeEntry("FREE", ["src/free.ts"]), priority: 1 },
      makeEntry("HELD", ["src/held.ts"]),
    ]);
    const seen: (readonly string[] | undefined)[] = [];
    const phase = {
      ...wakeBuild(),
      promptArgs: (ctx: TickContext) => {
        seen.push(ctx.claimed);
        return {};
      },
    };
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const outcome = await new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({ free: async () => {} }),
      log: silent,
    }).tick();

    expect(seen).toEqual([["HELD"]]);
    expect(outcome.result?.claimedTags).toEqual(["HELD"]);
  });

  it("a claim held by a dead pid is reclaimed by the next selection", async () => {
    const stale = await plantClaim("STALE", deadPid());
    // Non-vacuity: the file really is on disk and really names the dead
    // holder, so what the tick does below is a reclaim rather than a read of
    // an empty directory.
    expect(parsePidClaim(await readFile(stale, "utf8"))?.pid).not.toBe(
      process.pid,
    );

    await writePending(fx.repo, [makeEntry("STALE", ["src/stale.ts"])]);
    const chain: Chain = { phases: [wakeBuild()], humanOnly: [] };

    const outcome = await new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({
        stale: async (cwd) =>
          writeAndCommit(cwd, "src/stale.ts", "ok\n", "build: STALE"),
      }),
      log: silent,
    }).tick();

    // The stale file held nothing back: the entry was selected, carried and
    // shipped, and the claim it left behind is gone.
    expect(outcome.result?.claimedTags).toEqual([]);
    expect(outcome.result?.shippedTags).toEqual(["STALE"]);
    expect(existsSync(stale)).toBe(false);
  });
});
