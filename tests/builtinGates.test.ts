/**
 * pendingGate lazy-fence coverage (inbox: pendingGate eager capture).
 * `Gate.test.ts` covers pendingGate's composed validation and fence pre-check
 * against a static targetFence; this file is scoped to the one behavior those
 * tests don't exercise: a targetFence whose writablePaths/entryChannelPaths
 * are populated (or change) *after* `pendingGate(...)` is called — the
 * declaration-driven-fence case (the second-implementation shape) that a plain
 * object literal can't surface.
 *
 * Also covers the tscGate/vitestGate/eslintGate pnpm cmd override
 * (BUILTINGATES-PNPM-HARDCODED-NO-OVERRIDE, .claude/rules/engine-boundary.md
 * "Capability vs convention"): the injection point a non-pnpm chain needs, and
 * that omitting it stays byte-identical to before the override existed. And the
 * args override that rides alongside it (BUILTINGATES-CMD-OVERRIDE-PNPM-
 * SHAPED-ARGS): cmd alone only swaps the binary while args stay pnpm-shaped,
 * which silently misreports an npm chain's gate (npm has no bare `npm tsc`
 * verb) as "TypeScript errors" when npm never ran tsc at all. And the
 * gate-placement override (BUILTINGATES-WHEN-OVERRIDE): placement is the
 * chain's decision, so relocating a builtin to afterMerge must not cost the
 * chain a hand-rolled shellGate restating the builtin's own command.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  chainLoadGate,
  eslintGate,
  pendingGate,
  shellGate,
  tscGate,
  vitestGate,
  writablePathsGate,
} from "../src/builtinGates.ts";
import { Dispatcher } from "../src/Dispatcher.ts";
import { computeStateRootRel } from "../src/paths.ts";
import type { Agent } from "../src/Agent.ts";
import { Baton } from "../src/Baton.ts";
import type { Chain, Phase } from "../src/Phase.ts";
import {
  makeFixture,
  silent,
  type Fixture,
} from "./helpers/dispatcherFixture.ts";
import { entryFileName } from "../src/PendingSchema.ts";
import { entryClaimPath, entryClaimSlug } from "../src/entryClaims.ts";
import { checkoutAddress } from "../src/git.ts";
import { renderPidClaim } from "../src/pidClaim.ts";
import { deadPid } from "./helpers/deadPid.ts";
import type { Gate, GateContext } from "../src/Gate.ts";
// Barrel-export pin (.claude/rules/engineering.md "An export earns its
// consumer", CHAIN-EXPORT-GATE-OPTION-TYPES): a consumer can call
// shellGate/tscGate/ vitestGate/eslintGate but, pre-fix, could not name the
// shape it passes them — ShellGateOptions wasn't exported at all, and
// PkgManagerOverride / PkgManagerGate weren't re-exported from src/index.ts
// alongside PendingGateOptions. This import fails tsc if any of the three drops
// from src/index.ts.
import type {
  ShellGateOptions,
  PkgManagerOverride,
  PkgManagerGate,
} from "../src/index.ts";

import { mkTempDir } from "./helpers/fixtureRoot.ts";
import { SPAWN_BUDGET_MS, exec } from "./helpers/subprocess.ts";

// This file starts processes, so it declares the lane's one budget — cases
// and hooks alike — once here rather than inheriting the runner's default
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

function ctx(cwd: string, overrides: Partial<GateContext> = {}): GateContext {
  const repoRoot = overrides.repoRoot ?? cwd;
  const flumeDir = overrides.flumeDir ?? join(cwd, ".flume");
  return {
    cwd,
    flumeDir,
    // Default fixture shape has flumeDir nested under repoRoot (the
    // afterMerge/no-worktree shape) — computeStateRootRel handles it the
    // same as the dispatcher-built case. The dedicated "real afterCommit
    // shape" regression test below overrides both explicitly.
    stateRootRel: computeStateRootRel(repoRoot, flumeDir),
    pendingDir: join(flumeDir, "plan", "pending"),
    configDir: join(cwd, ".flume"),
    repoRoot,
    phaseName: "test-phase",
    // The dispatcher states the span's endpoints and its diff on every
    // context it builds; a fixture with no particular span states a
    // placeholder pair and the empty list rather than leaving the fields
    // off. Cases that resolve either sha, or turn on the list, override.
    commitSha: "c".repeat(40),
    baseSha: "b".repeat(40),
    touchedPaths: [],
    log: () => {},
    ...overrides,
  };
}

// pendingGate reads the gated commit via `git.readFileAtRef`
// (PENDING-GATE-STALE-TIP-READ), so its tests need a real repo and a real
// commit sha rather than a bare temp dir.
async function createBootstrappedRepo(prefix: string): Promise<string> {
  const repo = await mkTempDir(prefix);
  const opts = { cwd: repo };
  await exec("git", ["init", "-q"], opts);
  await exec("git", ["config", "user.email", "test@example.com"], opts);
  await exec("git", ["config", "user.name", "Test User"], opts);
  await exec("git", ["config", "commit.gpgsign", "false"], opts);
  await exec("git", ["config", "core.autocrlf", "false"], opts);
  await writeFile(join(repo, ".seed"), "");
  await exec("git", ["add", "."], opts);
  await exec("git", ["commit", "-q", "-m", "seed"], opts);
  return repo;
}

async function commitFiles(
  repo: string,
  files: Record<string, string>,
  msg = "candidate",
): Promise<string> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(repo, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
  const opts = { cwd: repo };
  await exec("git", ["add", "."], opts);
  await exec("git", ["commit", "-q", "-m", msg], opts);
  const { stdout } = await exec("git", ["rev-parse", "HEAD"], opts);
  return stdout.trim();
}

/**
 * A queue directory as a commit holds it: one `<tag>.json` per entry, plus the
 * `.gitkeep` adoption seeds (`harness/init.ts`) — git holds no empty
 * directory, so a drained queue needs a file of its own to stay *present* and
 * empty rather than missing.
 */
function queueFiles(
  entries: readonly unknown[],
  dirRel = ".flume/plan/pending",
): Record<string, string> {
  const files: Record<string, string> = { [`${dirRel}/.gitkeep`]: "" };
  for (const entry of entries) {
    const tag = (entry as { tag?: unknown }).tag;
    files[
      `${dirRel}/${entryFileName(typeof tag === "string" ? tag : "SOME-TAG")}`
    ] = JSON.stringify(entry);
  }
  return files;
}

/**
 * The name `pendingGate` calls the queue by in the whole-message assertions
 * below — `GatedQueue.rel`, which `readGatedQueue` (`src/pendingLedger.ts`)
 * folds into git's alphabet once, before any message quotes it.
 *
 * Spelled with `/` rather than composed through `node:path`: composing it
 * would demand the host's separator from a value that never carries one, so
 * the two cases would be green on posix by accident and red on win32 for the
 * fold working (`.claude/rules/posture-sweep.md`, *A repo-relative path
 * composed with `node:path`*).
 */
const QUEUE_REL = "plan/pending";

const validEntry = {
  tag: "SOME-TAG",
  gate: { kind: "open" },
  dependsOnForks: [],
  files: {
    new: [],
    edit: [{ path: "src/foo.ts", description: "edit" }],
    retire: [],
  },
};

describe("pendingGate — lazy fence read (targetFence populated after construction)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await createBootstrappedRepo("flume-pendinggate-lazy-");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writePending(
    entries: readonly unknown[],
  ): Promise<string> {
    return commitFiles(dir, queueFiles(entries));
  }

  it("passes when a getter-backed writablePaths is only populated after pendingGate(...) is called", async () => {
    const sha = await writePending([validEntry]);
    // Simulates a declaration-driven Phase: writablePaths is a getter whose
    // backing value isn't set until after the chain wires the gate — e.g.
    // read from a per-job declaration.json resolved later in chain setup.
    let backing: string[] = [];
    const targetFence = {
      get writablePaths() {
        return backing;
      },
    };
    const gate = pendingGate({ targetFence });
    backing = ["src/**"];
    const result = await gate.run(ctx(dir, { commitSha: sha }));
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/fence pre-check passed/);
  });

  it("fails, naming the path, when a getter-backed writablePaths narrows after pendingGate(...) is called", async () => {
    const sha = await writePending([
      {
        ...validEntry,
        files: {
          new: [],
          edit: [{ path: "docs/nope.md", description: "not allowed" }],
          retire: [],
        },
      },
    ]);
    let backing = ["src/**", "docs/**"];
    const targetFence = {
      get writablePaths() {
        return backing;
      },
    };
    const gate = pendingGate({ targetFence });
    // Fence narrows after construction; run() must see the current value.
    backing = ["src/**"];
    const result = await gate.run(ctx(dir, { commitSha: sha }));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/outside the target fence/);
    expect(result.details ?? "").toContain("docs/nope.md");
  });

  it("reflects a getter-backed entryChannelPaths populated after pendingGate(...) is called", async () => {
    const sha = await writePending([
      {
        tag: "OTHER-TAG",
        gate: { kind: "open" },
        dependsOnForks: [],
        files: {
          new: [{ path: "tests/foo.test.ts", description: "test" }],
          edit: [],
          retire: [],
        },
      },
    ]);
    let backing: string[] = [];
    const targetFence = {
      writablePaths: ["src/**"],
      get entryChannelPaths() {
        return backing;
      },
    };
    const gate = pendingGate({ targetFence });
    backing = ["tests/**"];
    const result = await gate.run(ctx(dir, { commitSha: sha }));
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/fence pre-check passed/);
  });

  it("re-reads the fence on every run(), not just once after the first call", async () => {
    const sha = await writePending([validEntry]);
    let backing = ["src/**"];
    const targetFence = {
      get writablePaths() {
        return backing;
      },
    };
    const gate = pendingGate({ targetFence });

    const first = await gate.run(ctx(dir, { commitSha: sha }));
    expect(first.ok).toBe(true);

    backing = [];
    const second = await gate.run(ctx(dir, { commitSha: sha }));
    expect(second.ok).toBe(false);
    expect(second.details ?? "").toContain("src/foo.ts");
  });
});

describe("pendingGate — fence pre-check reads declared files, not observedFiles (.claude/rules/engineering.md § The fix lands at the mechanism)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await createBootstrappedRepo("flume-pendinggate-declared-");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writePending(
    entries: readonly unknown[],
  ): Promise<string> {
    return commitFiles(dir, queueFiles(entries));
  }

  it("passes an entry whose declared files all sit inside the fence but whose observedFiles names a path outside it", async () => {
    const sha = await writePending([
      {
        ...validEntry,
        // A prior tick's dispatcher-observed footprint, outside the fence.
        // This is not a declaration the authoring phase could have avoided —
        // touchedPaths() folding it into the fence pre-check would report a
        // fence violation the authoring phase has no way to fix.
        observedFiles: ["docs/unrelated.md"],
      },
    ]);
    const targetFence = { writablePaths: ["src/**"] };
    const gate = pendingGate({ targetFence });
    const result = await gate.run(ctx(dir, { commitSha: sha }));
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/fence pre-check passed/);
  });
});

describe("pendingGate — hint option (PENDING-GATE-HINT-OPTION, .claude/rules/engine-boundary.md § Capability vs convention)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await createBootstrappedRepo("flume-pendinggate-hint-");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writePending(
    entries: readonly unknown[],
  ): Promise<string> {
    return commitFiles(dir, queueFiles(entries));
  }

  const outsideFenceEntry = {
    ...validEntry,
    files: {
      new: [],
      edit: [{ path: "docs/nope.md", description: "not allowed" }],
      retire: [],
    },
  };

  it("appends the hint to the schema-violation message when supplied", async () => {
    const sha = await writePending([{ ...validEntry, mystery: "field" }]);
    const gate = pendingGate({
      targetFence: { writablePaths: ["src/**"] },
      hint: "park it, never re-scope",
    });
    const result = await gate.run(ctx(dir, { commitSha: sha }));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/schema violation/);
    expect(result.message).toContain("park it, never re-scope");
  });

  it("leaves the schema-violation message unchanged when the hint is omitted", async () => {
    const sha = await writePending([{ ...validEntry, mystery: "field" }]);
    const gate = pendingGate({ targetFence: { writablePaths: ["src/**"] } });
    const result = await gate.run(ctx(dir, { commitSha: sha }));
    expect(result.ok).toBe(false);
    expect(result.message).toBe(`${QUEUE_REL} has 1 schema violation(s)`);
  });

  it("appends the hint to the fence-violation message when supplied", async () => {
    const sha = await writePending([outsideFenceEntry]);
    const gate = pendingGate({
      targetFence: { writablePaths: ["src/**"] },
      hint: "park it, never re-scope",
    });
    const result = await gate.run(ctx(dir, { commitSha: sha }));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/outside the target fence/);
    expect(result.message).toContain("park it, never re-scope");
  });

  it("leaves the fence-violation message unchanged when the hint is omitted", async () => {
    const sha = await writePending([outsideFenceEntry]);
    const gate = pendingGate({ targetFence: { writablePaths: ["src/**"] } });
    const result = await gate.run(ctx(dir, { commitSha: sha }));
    expect(result.ok).toBe(false);
    expect(result.message).toBe(
      "1 pending entry declare files outside the target fence",
    );
  });
});

describe("pendingGate — reads ctx.pendingDir, not an option of its own (CHAIN-PENDINGPATH)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await createBootstrappedRepo("flume-pendinggate-ctxpath-");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads a custom ctx.pendingDir instead of the default plan/pending location", async () => {
    const sha = await commitFiles(
      dir,
      queueFiles([validEntry], ".flume/custom/queue"),
    );
    // PendingGateOptions carries no pendingDir field at all (acceptance:
    // "PendingGateOptions no longer has a pendingDir field") — the gate
    // and the dispatcher can no longer check two different queues.
    const gate = pendingGate({ targetFence: { writablePaths: ["src/**"] } });
    const result = await gate.run(
      ctx(dir, {
        commitSha: sha,
        pendingDir: join(dir, ".flume", "custom", "queue"),
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/fence pre-check passed/);
  });

  it("undeclared ctx.pendingDir (the default fixture shape) still resolves to plan/pending", async () => {
    const sha = await commitFiles(dir, queueFiles([validEntry]));
    const gate = pendingGate({ targetFence: { writablePaths: ["src/**"] } });
    const result = await gate.run(ctx(dir, { commitSha: sha }));
    expect(result.ok).toBe(true);
    expect(result.message).toBe(
      `${QUEUE_REL} valid (1 entries), fence pre-check passed`,
    );
  });
});

describe("pendingGate — stale-tip read (PENDING-GATE-STALE-TIP-READ)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await createBootstrappedRepo("flume-pendinggate-staletip-");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const offFenceEntry = {
    ...validEntry,
    files: {
      new: [],
      edit: [{ path: "spec/loop.md", description: "off-fence" }],
      retire: [],
    },
  };

  it("reverts the commit that introduces an off-fence declaration, not the next one", async () => {
    await commitFiles(dir, queueFiles([validEntry]));
    const violatingSha = await commitFiles(dir, queueFiles([offFenceEntry]));
    // The disk/working-tree copy still shows the clean, pre-violation
    // state — as it would for a fanout worktree commit whose branch hasn't
    // merged onto whatever tree `ctx.flumeDir` resolves to. Pre-fix,
    // `readFile(join(ctx.flumeDir, pendingDir))` reads exactly this stale
    // copy and wrongly passes the commit that introduced the violation —
    // the violation would only surface once some later write finally
    // synced the disk, misattributing it to whatever commit came next.
    await writeFile(
      join(dir, ".flume", "plan", "pending", entryFileName(validEntry.tag)),
      JSON.stringify(validEntry),
      "utf8",
    );
    const gate = pendingGate({ targetFence: { writablePaths: ["src/**"] } });
    const result = await gate.run(ctx(dir, { commitSha: violatingSha }));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/outside the target fence/);
  });

  it("passes a commit that removes a prior off-fence declaration, on its own commit", async () => {
    await commitFiles(dir, queueFiles([offFenceEntry]));
    const fixSha = await commitFiles(dir, queueFiles([validEntry]));
    // Mirror of the test above: the disk copy now races *ahead* of the
    // gated commit, reintroducing the violation the fix commit itself
    // removed. Pre-fix, the stale disk read sees this and wrongly reverts
    // the commit that fixed the violation (observed: 70f4632 -> c168d3b).
    await writeFile(
      join(dir, ".flume", "plan", "pending", entryFileName(validEntry.tag)),
      JSON.stringify(offFenceEntry),
      "utf8",
    );
    const gate = pendingGate({ targetFence: { writablePaths: ["src/**"] } });
    const result = await gate.run(ctx(dir, { commitSha: fixSha }));
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/fence pre-check passed/);
  });

  it("reads a relocated flumeDir (pendingDir outside repoRoot) from disk, unchanged", async () => {
    const outside = await mkTempDir("flume-pendinggate-relocated-");
    try {
      const pendingDir = join(outside, "plan", "pending");
      await mkdir(pendingDir, { recursive: true });
      await writeFile(
        join(pendingDir, entryFileName(validEntry.tag)),
        JSON.stringify(validEntry),
        "utf8",
      );
      // A commit must still exist to gate — the relocated queue lives
      // entirely outside git, so the gated commit's own content is
      // irrelevant to this read.
      const sha = await commitFiles(dir, { "src/foo.ts": "x" });
      const gate = pendingGate({ targetFence: { writablePaths: ["src/**"] } });
      const result = await gate.run(
        ctx(dir, { commitSha: sha, flumeDir: outside }),
      );
      expect(result.ok).toBe(true);
      expect(result.message).toMatch(/fence pre-check passed/);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

/**
 * The claim check — `pendingGate`'s third (`spec/pending.md`, *Claims — an
 * entry in flight is left alone*): while a build tick holds an entry, a
 * ledger commit leaves that entry's file byte-identical or is refused naming
 * the entry and its holder.
 *
 * Every case gates a **real commit** and plants its claim through the
 * engine's own statement at the engine's own address — `renderPidClaim` under
 * `entryClaimPath`, composed from the pair git answers for this checkout
 * (`checkoutAddress`, `src/git.ts`). A fixture
 * spelling either would re-author, by the tester's hand, the two seams the
 * check rides: what git calls changed, and where a claim lives
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*).
 */
describe("pendingGate — claim check over the merged tree (spec/pending.md 'Claims — an entry in flight is left alone')", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await createBootstrappedRepo("flume-pendinggate-claim-");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // The bare core alone — this describe declares no extension, so a field
  // beyond it is a schema violation and not the claim verdict under test.
  // `description` is what a re-scope actually rewrites.
  const entry = (tag: string, description = "as queued") => ({
    ...validEntry,
    tag,
    files: {
      new: [],
      edit: [{ path: "src/foo.ts", description }],
      retire: [],
    },
  });

  /** The queue path one entry's file sits at, as the commit spells it. */
  const entryPath = (tag: string): string =>
    `.flume/plan/pending/${entryFileName(tag)}`;

  /** Where this checkout's claim on `tag` lives, through the engine's own address. */
  async function claimPath(tag: string): Promise<string> {
    const { commonDir, segment } = await checkoutAddress(dir);
    return entryClaimPath(commonDir, segment, entryClaimSlug(tag));
  }

  /** A live claim on `tag`, staked at the address the engine addresses. */
  async function claim(tag: string, pid = process.pid): Promise<void> {
    const path = await claimPath(tag);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, renderPidClaim(pid, new Date()), "utf8");
  }

  /** A commit and the span git reports for it, as the dispatcher would. */
  async function commitSpan(
    files: Record<string, string>,
    removed: readonly string[] = [],
  ): Promise<Pick<GateContext, "baseSha" | "commitSha" | "touchedPaths">> {
    const opts = { cwd: dir };
    const baseSha = (await exec("git", ["rev-parse", "HEAD"], opts)).stdout.trim();
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(dir, rel);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content);
    }
    for (const rel of removed) await rm(join(dir, rel), { force: true });
    await exec("git", ["add", "-A"], opts);
    await exec("git", ["commit", "-q", "-m", "ledger"], opts);
    const commitSha = (await exec("git", ["rev-parse", "HEAD"], opts)).stdout.trim();
    const touchedPaths = (
      await exec("git", ["diff", "--name-only", `${baseSha}..${commitSha}`], opts)
    ).stdout
      .split("\n")
      .filter(Boolean);
    return { baseSha, commitSha, touchedPaths };
  }

  /** The gate as the harness wires the merged-tree placement. */
  const merged = (hint?: string): Gate =>
    pendingGate({
      targetFence: { writablePaths: ["src/**"] },
      ...(hint !== undefined ? { hint } : {}),
      when: "afterMerge",
    });

  it("pendingGate refuses a commit that edits a claimed entry's file, naming the entry and the holder", async () => {
    await commitFiles(dir, queueFiles([entry("HELD"), entry("FREE")]));
    await claim("HELD");
    const span = await commitSpan({
      [entryPath("HELD")]: JSON.stringify(entry("HELD", "re-scoped mid-flight")),
    });
    // Non-vacuity: the span is the one entry file, so the verdict below is
    // the claim check's and not a schema or fence refusal riding along.
    expect(span.touchedPaths).toEqual([entryPath("HELD")]);

    const result = await merged().run(ctx(dir, span));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/1 entry another tick holds a claim on/);
    expect(result.details).toContain("[HELD]");
    expect(result.details).toContain(`claimed by pid ${process.pid}`);
  });

  it("pendingGate refuses a commit that removes a claimed entry's file", async () => {
    await commitFiles(dir, queueFiles([entry("HELD"), entry("FREE")]));
    await claim("HELD");
    const span = await commitSpan({}, [entryPath("HELD")]);
    // Non-vacuity: the removal is what git reported, and the entry is gone
    // from the commit's tree — so nothing the gate parses can name it, and
    // the refusal below can only have come off the touched path.
    expect(span.touchedPaths).toEqual([entryPath("HELD")]);

    const result = await merged().run(ctx(dir, span));
    expect(result.ok).toBe(false);
    expect(result.details).toContain("[HELD]");
    expect(result.details).toContain(`claimed by pid ${process.pid}`);
  });

  it("pendingGate passes a commit that edits an unclaimed entry", async () => {
    await commitFiles(dir, queueFiles([entry("HELD"), entry("FREE")]));
    await claim("HELD");
    const gate = merged();

    // The vacuity pin (`.claude/rules/engineering.md`, *A green verdict is
    // proven non-vacuous*): the same gate over the same shape of span
    // refuses when the claim names the edited entry, so the green below is a
    // check that was armed and looked, not one that was never run.
    const armed = await commitSpan({
      [entryPath("HELD")]: JSON.stringify(entry("HELD", "re-scoped")),
    });
    expect((await gate.run(ctx(dir, armed))).ok).toBe(false);

    const span = await commitSpan({
      [entryPath("FREE")]: JSON.stringify(entry("FREE", "re-scoped freely")),
    });
    expect(span.touchedPaths).toEqual([entryPath("FREE")]);
    const result = await gate.run(ctx(dir, span));
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/fence pre-check passed/);
  });

  it("opts.hint appends to the claim-check violation message", async () => {
    await commitFiles(dir, queueFiles([entry("HELD")]));
    await claim("HELD");
    const span = await commitSpan({
      [entryPath("HELD")]: JSON.stringify(entry("HELD", "re-scoped")),
    });

    const hinted = await merged("wait for the build tick to land").run(
      ctx(dir, span),
    );
    expect(hinted.ok).toBe(false);
    expect(hinted.message).toMatch(/ — wait for the build tick to land$/);

    // And omitted, the message reads exactly as it does without the option
    // — the hint is the only difference between the two.
    const bare = await merged().run(ctx(dir, span));
    expect(hinted.message).toBe(
      `${bare.message} — wait for the build tick to land`,
    );
  });

  it("a claim held by a dead pid leaves the entry editable", async () => {
    await commitFiles(dir, queueFiles([entry("STALE")]));
    await claim("STALE", deadPid());
    const span = await commitSpan({
      [entryPath("STALE")]: JSON.stringify(entry("STALE", "re-scoped")),
    });
    // Non-vacuity: the claim file is on disk for this read, so the pass is
    // the liveness verdict and not an empty claims directory.
    expect(existsSync(await claimPath("STALE"))).toBe(true);

    expect((await merged().run(ctx(dir, span))).ok).toBe(true);
  });

  it("a commit that touches no entry file is not judged against the claims at all", async () => {
    await commitFiles(dir, queueFiles([entry("HELD")]));
    await claim("HELD");
    const span = await commitSpan({ "src/foo.ts": "export const x = 1;\n" });
    expect(span.touchedPaths).toEqual(["src/foo.ts"]);

    // Vacuous by design and spelled as such: a claim stands, and the commit
    // changed no entry file, so there is nothing for the check to refuse.
    const result = await merged().run(ctx(dir, span));
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/fence pre-check passed/);
  });

  /**
   * The records half of the claim check (`spec/pending.md`, *A claim covers
   * the entry's records*). The paths are the chain's — this case declares the
   * note layout a second implementation would, and the engine supplies the
   * tags, the claims walk and the refusal.
   */
  const withNotes = (): Gate =>
    pendingGate({
      targetFence: { writablePaths: ["src/**"] },
      when: "afterMerge",
      entryRecords: (tag, root) => [
        `${root}/plan/notes/${tag}.md`,
        `${root}/plan/notes/parked/${tag}.md`,
      ],
    });

  it("pendingGate refuses a commit that changes a claimed entry's note file", async () => {
    await commitFiles(dir, {
      ...queueFiles([entry("HELD"), entry("FREE")]),
      ".flume/plan/notes/HELD.md": "# Held\n\nmid-flight\n",
      ".flume/plan/notes/FREE.md": "# Free\n\ndrainable\n",
    });
    await claim("HELD");
    // The drain: both notes folded away, neither entry file touched.
    const span = await commitSpan({}, [
      ".flume/plan/notes/HELD.md",
      ".flume/plan/notes/FREE.md",
    ]);
    // Non-vacuity: the span is the two notes and no entry file, so the
    // verdict below is the records half of the check and not the ledger half
    // riding along.
    expect(span.touchedPaths.sort()).toEqual([
      ".flume/plan/notes/FREE.md",
      ".flume/plan/notes/HELD.md",
    ]);

    const result = await withNotes().run(ctx(dir, span));
    expect(result.ok).toBe(false);
    // Named the same way a re-scoped ledger file is: the entry, the path,
    // and the holder.
    expect(result.message).toMatch(/1 entry another tick holds a claim on/);
    expect(result.details).toContain(
      `  [HELD] .flume/plan/notes/HELD.md is claimed by pid ${process.pid}`,
    );
    // And the unclaimed sibling's note is no part of the refusal.
    expect(result.details).not.toContain("FREE");

    // The control, over the same declared layout: with the claim lifted the
    // identical drain passes, so the refusal is the claim's and not the note
    // path's.
    await rm(await claimPath("HELD"), { force: true });
    expect((await withNotes().run(ctx(dir, span))).ok).toBe(true);
  });

  it("a chain that declares no entry records leaves a claimed entry's note editable", async () => {
    await commitFiles(dir, {
      ...queueFiles([entry("HELD")]),
      ".flume/plan/notes/HELD.md": "# Held\n\nmid-flight\n",
    });
    await claim("HELD");
    const span = await commitSpan({}, [".flume/plan/notes/HELD.md"]);
    expect(span.touchedPaths).toEqual([".flume/plan/notes/HELD.md"]);

    // Vacuous by design and spelled as such (`.claude/rules/engineering.md`,
    // *A green verdict is proven non-vacuous*): the same span over the same
    // claim refuses once a resolver names that path, so the green here is the
    // omitted option's and not an unarmed check's.
    expect((await withNotes().run(ctx(dir, span))).ok).toBe(false);
    const result = await merged().run(ctx(dir, span));
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/fence pre-check passed/);
  });

  it("pendingGate stays at afterCommit unless the chain places it", () => {
    expect(pendingGate({ targetFence: { writablePaths: [] } }).when).toBe(
      "afterCommit",
    );
    expect(merged().when).toBe("afterMerge");
  });
});

describe("pendingGate — real afterCommit shape (GATE-CONTEXT-STATE-ROOT-REL, .claude/rules/engineering.md 'A seam gate reads what the real writer wrote')", () => {
  // Every other pendingGate test in this file builds its GateContext by
  // hand, with flumeDir *nested under* repoRoot (`ctx()`'s default) — the
  // afterMerge/no-worktree shape. That is not the shape
  // `runAfterCommitGates` actually builds: there, flumeDir is the *primary*
  // checkout's state root and repoRoot is a fanout worktree living *inside*
  // it (`<flumeDir>/worktrees/<slug>`), the reverse nesting. Pre-fix,
  // pendingGate derived its own relative offset from `ctx.repoRoot` and
  // `ctx.flumeDir` — correct only under the inverted fixture shape, and
  // misreading a real worktree's offset as a relocated state root, silently
  // falling back to the primary checkout's on-disk (pre-cherry-pick) copy.
  //
  // Both sides of that seam run for real here: a `Dispatcher` tick builds
  // the GateContext (the producer) and a chain-declared `pendingGate`
  // instance decodes it (the consumer). A hand-authored ctx re-authors the
  // producer's vocabulary by the tester's hand, so a one-sided change to
  // what the dispatcher passes would ship green.
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it("pendingGate reads the gated commit's queue from a GateContext a real Dispatcher tick built, not a hand-authored one", async () => {
    const flumeDir = join(fx.repo, ".flume");
    const entryRel = `.flume/plan/pending/${entryFileName("SRR-SEAM")}`;
    await commitFiles(
      fx.repo,
      {
        ".flume/plan/pending/.gitkeep": "",
        [entryRel]:
          JSON.stringify({ ...validEntry, tag: "SRR-SEAM" }, null, 2) + "\n",
      },
      "test: a queue entry",
    );
    new Baton(flumeDir).wake("build");

    const phase: Phase = {
      name: "build",
      description: "test phase",
      promptPath: "prompt.md",
      concurrency: "fanout",
      writablePaths: ["**"],
      // The chain declares the real gate — no test double stands in for
      // either side of the seam.
      gates: [pendingGate({ targetFence: { writablePaths: ["src/**"] } })],
      handoff: () => [],
    };
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent: Agent = {
      name: "fake-fanout",
      async invoke(inv) {
        // Committed inside the entry's worktree only: the primary
        // checkout's own disk copy of the queue (under `flumeDir`, the
        // path a stale read resolves) still holds the on-fence entry
        // asserted below, so an off-fence verdict can only have come from
        // the gated commit.
        const pj = join(inv.cwd, entryRel);
        await mkdir(dirname(pj), { recursive: true });
        await writeFile(
          pj,
          JSON.stringify(
            {
              ...validEntry,
              tag: "SRR-SEAM",
              files: {
                new: [],
                edit: [{ path: "spec/loop.md", description: "off-fence" }],
                retire: [],
              },
            },
            null,
            2,
          ) + "\n",
        );
        await exec("git", ["add", "--", entryRel], { cwd: inv.cwd });
        await exec(
          "git",
          ["commit", "-q", "-m", "build(SRR-SEAM): off-fence queue"],
          { cwd: inv.cwd },
        );
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const beforeTick = JSON.parse(
      await readFile(join(fx.repo, entryRel), "utf8"),
    ) as typeof validEntry;
    expect(beforeTick.files.edit[0]?.path).toBe("src/foo.ts");

    const dispatcher = new Dispatcher({
      chainLoader: () => Promise.resolve({ chain }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    const pendingResults = (outcome.verdict?.gateResults ?? []).filter(
      (g) => g.gate === "pending-gate",
    );
    // Vacuity pin (.claude/rules/engineering.md "A green verdict is proven
    // non-vacuous"): the dispatcher really ran the declared gate — without
    // this, every assertion below passes over an empty filter.
    expect(pendingResults).toHaveLength(1);
    expect(pendingResults[0]?.ok).toBe(false);
    expect(pendingResults[0]?.message).toMatch(/outside the target fence/);
    expect(pendingResults[0]?.details ?? "").toContain("spec/loop.md");
    // The gate's verdict is the tick's: the entry never shipped.
    expect(outcome.result?.shippedTags).toEqual([]);
  });
});

describe("tscGate / vitestGate / eslintGate — pnpm cmd override (BUILTINGATES-PNPM-HARDCODED-NO-OVERRIDE)", () => {
  it.each([
    ["tscGate", "tsc", tscGate],
    ["vitestGate", "vitest", vitestGate],
    ["eslintGate", "eslint", eslintGate],
  ] as const)(
    "%s stays a bare Gate (name=%s, when=afterCommit) whether used directly or called with no override",
    (_label, name, gate) => {
      expect(gate.name).toBe(name);
      expect(gate.when).toBe("afterCommit");
      const called = gate();
      expect(called.name).toBe(name);
      expect(called.when).toBe("afterCommit");
      expect(gate({}).name).toBe(name);
    },
  );

  it.each([
    ["tscGate", tscGate, "TypeScript errors — commit reverted"],
    ["vitestGate", vitestGate, "Tests failed — commit reverted"],
    ["eslintGate", eslintGate, "Lint errors — commit reverted"],
  ] as const)(
    "%s({ cmd }) actually swaps the invoked binary away from pnpm",
    async (_label, gate, failHint) => {
      // Overriding to "node" and keeping the gate's own fixed args (e.g.
      // ["tsc", "--noEmit"]) makes node try to load the first arg as its
      // entry script — Node's own MODULE_NOT_FOUND, not a pnpm/shell
      // "not recognized" failure, is proof the override binary actually ran.
      const result = await gate({ cmd: "node" }).run(ctx(process.cwd()));
      expect(result.ok).toBe(false);
      expect(result.message).toBe(failHint);
      expect(result.details ?? "").toContain("MODULE_NOT_FOUND");
    },
    SPAWN_BUDGET_MS,
  );
});

/**
 * A self-contained tsc project in a temp dir: its own tsconfig, one source
 * file, no reference to this repo's sources or its tsconfig. Lets a gate
 * case drive the real tsc without its verdict being the repo's typecheck.
 */
async function makeTsProject(source: string): Promise<string> {
  const dir = await mkTempDir("flume-tsc-project-");
  await writeFile(
    join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, types: [] },
      include: ["*.ts"],
    }),
    "utf8",
  );
  await writeFile(join(dir, "main.ts"), source, "utf8");
  return dir;
}

describe("tscGate / vitestGate / eslintGate — args override (BUILTINGATES-CMD-OVERRIDE-PNPM-SHAPED-ARGS)", () => {
  it.each([
    ["tscGate", tscGate],
    ["vitestGate", vitestGate],
    ["eslintGate", eslintGate],
  ] as const)(
    "%s({ cmd, args }) runs the overridden args instead of the pnpm-shaped default",
    async (_label, gate) => {
      // On the pre-fix tree PkgManagerOverride carries no `args` field, so
      // this override's `args` is silently dropped and the gate still runs
      // `<node> tsc --noEmit` (etc, the gate's own fixed pnpm-shaped args) —
      // node tries to load "tsc"/"test"/"lint" as an entry script and fails
      // with MODULE_NOT_FOUND, exactly like the cmd-only override proven
      // above. Only once `args` is actually threaded into `build()` does
      // this trivial `-e` script run instead and the gate goes green.
      const result = await gate({
        cmd: process.execPath,
        args: ["-e", "process.exit(0)"],
      }).run(ctx(process.cwd()));
      expect(result.ok).toBe(true);
    },
    SPAWN_BUDGET_MS,
  );

  it("tscGate({ cmd: 'npm' }) (cmd-only) fails with npm's own \"Unknown command\" — npm has no bare-bin tsc verb", async () => {
    const result = await tscGate({ cmd: "npm" }).run(ctx(process.cwd()));
    expect(result.ok).toBe(false);
    expect(result.details ?? "").toContain("Unknown command");
  }, SPAWN_BUDGET_MS);

  it(
    "tscGate({ cmd: 'npm', args: [...] }) composes a working npm invocation and actually runs tsc",
    async () => {
      // The gate still runs at the repo root, so `npm exec` resolves tsc
      // from this repo's node_modules with no network. tsc itself is
      // pointed at a throwaway project: what this case judges is whether
      // the composed invocation ran, and asserting the repo's own type
      // health here reds it for whatever an unrelated entry broke.
      const clean = await makeTsProject("export const n: number = 1;\n");
      const broken = await makeTsProject('export const n: number = "no";\n');
      try {
        const npmExec = (project: string) =>
          tscGate({
            cmd: "npm",
            args: [
              "exec",
              "--",
              "tsc",
              "--noEmit",
              "--project",
              join(project, "tsconfig.json"),
            ],
          }).run(ctx(process.cwd()));

        const green = await npmExec(clean);
        expect(green.ok).toBe(true);

        // Non-vacuity (.claude/rules/engineering.md "A green verdict is proven
        // non-vacuous"): green over the clean project is evidence tsc *ran*
        // only if the same composed invocation reports the one error the
        // other project carries. An npm that silently no-op'd — which is
        // the failure this case exists to catch — reads identically
        // otherwise.
        const red = await npmExec(broken);
        expect(red.ok).toBe(false);
        expect(red.message).toBe("TypeScript errors — commit reverted");
        expect(red.details ?? "").toContain("TS2322");
      } finally {
        await rm(clean, { recursive: true, force: true });
        await rm(broken, { recursive: true, force: true });
      }
    },
    SPAWN_BUDGET_MS,
  );
});

describe("tscGate / vitestGate / eslintGate — gate-placement override (BUILTINGATES-WHEN-OVERRIDE)", () => {
  it("tscGate({ when: 'afterMerge' }) returns a gate whose phase is afterMerge", () => {
    // Placement is the chain's decision (spec/chain.md, "Gate placement is
    // the chain's decision"). Pre-fix, `when` was hardcoded to afterCommit
    // inside pkgManagerGate, so a chain wanting tsc over the merged tree had
    // to restate the builtin's own cmd/args in a hand-rolled shellGate.
    const merged = tscGate({ when: "afterMerge" });
    expect(merged.when).toBe("afterMerge");
    // Same check, only relocated: the command line is untouched.
    expect(merged.command).toBe("pnpm tsc --noEmit");
    expect(merged.name).toBe("tsc");
  });

  it.each([
    ["vitestGate", vitestGate, "vitest", "pnpm test --run"],
    ["eslintGate", eslintGate, "eslint", "pnpm lint"],
  ] as const)(
    "%s({ when: 'afterMerge' }) relocates without restating its command",
    (_label, gate, name, command) => {
      const merged = gate({ when: "afterMerge" });
      expect(merged.when).toBe("afterMerge");
      expect(merged.name).toBe(name);
      expect(merged.command).toBe(command);
    },
  );

  it("when composes with the cmd/args override rather than replacing it", () => {
    const merged = tscGate({
      cmd: "npm",
      args: ["exec", "--", "tsc", "--noEmit"],
      when: "afterMerge",
    });
    expect(merged.when).toBe("afterMerge");
    expect(merged.command).toBe("npm exec -- tsc --noEmit");
  }, SPAWN_BUDGET_MS);

  it("tscGate, vitestGate and eslintGate stay at afterCommit when called with no override", () => {
    // The default survives every shape of the injection point: the bare gate
    // object, the empty call, and a partial override that names cmd/args but
    // not `when`.
    for (const gate of [tscGate, vitestGate, eslintGate]) {
      expect(gate.when).toBe("afterCommit");
      expect(gate().when).toBe("afterCommit");
      expect(gate({}).when).toBe("afterCommit");
      expect(gate({ cmd: "npm" }).when).toBe("afterCommit");
      expect(gate({ args: ["run", "check"] }).when).toBe("afterCommit");
    }
  }, SPAWN_BUDGET_MS);

  it("an explicit when: 'afterCommit' override is byte-identical to omitting it", () => {
    const explicit = tscGate({ when: "afterCommit" });
    expect(explicit.when).toBe(tscGate.when);
    expect(explicit.command).toBe(tscGate.command);
    expect(explicit.name).toBe(tscGate.name);
  });
});

// win32-only: proves the *default* (omitted cmd) invocation is literally
// "pnpm" — a fake pnpm.cmd shimmed ahead on PATH is what a bare/no-override
// call resolves to, and an explicit override bypasses it entirely. Mirrors
// the win32 .cmd shim fixture in Gate.test.ts (same CVE-2024-27980 shim
// resolution this repo already tests against).
describe.runIf(process.platform === "win32")(
  "tscGate — pnpm shim proves the default cmd (win32)",
  () => {
    let shimDir: string;
    let originalPath: string | undefined;

    beforeEach(async () => {
      shimDir = await mkTempDir("flume-pnpm-shim-");
      await writeFile(
        join(shimDir, "pnpm.cmd"),
        "@echo off\r\necho pnpm-shim %*\r\n",
      );
      originalPath = process.env.PATH;
      process.env.PATH = `${shimDir};${process.env.PATH ?? ""}`;
    });

    afterEach(async () => {
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
      await rm(shimDir, { recursive: true, force: true });
    });

    it("bare tscGate (no override) resolves to the pnpm shim", async () => {
      const result = await tscGate.run(ctx(process.cwd()));
      expect(result.ok).toBe(true);
      expect(result.details).toContain("pnpm-shim tsc --noEmit");
    });

    it("tscGate() called with no override is byte-identical to the bare gate", async () => {
      const result = await tscGate().run(ctx(process.cwd()));
      expect(result.ok).toBe(true);
      expect(result.details).toContain("pnpm-shim tsc --noEmit");
    });

    it("tscGate({ cmd }) bypasses the pnpm shim entirely", async () => {
      await writeFile(
        join(shimDir, "other-pm.cmd"),
        "@echo off\r\necho other-pm-shim %*\r\n",
      );
      const result = await tscGate({ cmd: "other-pm" }).run(
        ctx(process.cwd()),
      );
      expect(result.ok).toBe(true);
      expect(result.details).toContain("other-pm-shim tsc --noEmit");
    });
  },
);

describe("src/index.ts — ShellGateOptions/PkgManagerOverride/PkgManagerGate barrel export (CHAIN-EXPORT-GATE-OPTION-TYPES)", () => {
  it("re-exports ShellGateOptions, PkgManagerOverride, and PkgManagerGate as named types a chain author can consume", () => {
    // The imported types (line 41, from src/index.ts rather than
    // src/builtinGates.ts) are what a chain author would actually reach for
    // to name the shape it passes to shellGate/tscGate/vitestGate/eslintGate
    // — if any drops from the barrel this fails tsc, not just an LSP
    // references check.
    const shellOpts: ShellGateOptions = {
      name: "custom",
      when: "afterCommit",
      cmd: process.execPath,
      args: ["-e", "process.exit(0)"],
    };
    const override: PkgManagerOverride = { cmd: "npm", args: ["run", "tsc"] };
    const gate: PkgManagerGate = tscGate;

    expect(shellOpts.name).toBe("custom");
    expect(override.cmd).toBe("npm");
    expect(gate.name).toBe("tsc");
  }, SPAWN_BUDGET_MS);
});

// ---------- GateResult.skipped on the one builtin that skips
// (GATE-RESULT-SKIPPED, spec/chain.md "What a gate returns") ----------

const SKIP_TEST_CHAIN =
  `export default () => ({ chain: { phases: [{ name: "a", description: "", ` +
  `promptPath: "p.md", concurrency: "singleton", writablePaths: ["**"], ` +
  `gates: [], handoff: () => [] }], humanOnly: [] } });\n`;

describe("chainLoadGate — a green it did not earn is declared, not spelled into message", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await createBootstrappedRepo("flume-gate-skipped-");
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("`chainLoadGate` over a commit that touched no chain file returns `ok: true` with a `skipped` reason", async () => {
    const sha = await commitFiles(
      repo,
      { "src/unrelated.ts": "export const x = 1;\n" },
      "build: nothing to do with the chain",
    );
    // Vacuity pin: the gate judged a populated touched-path list and found no
    // chain file in it — not an empty commit skipping by accident.
    const touchedPaths = ["src/unrelated.ts"];

    const result = await chainLoadGate.run(
      ctx(repo, { commitSha: sha, touchedPaths }),
    );

    expect(result.ok).toBe(true);
    expect(typeof result.skipped).toBe("string");
    expect(result.skipped).toContain(".flume/chain.ts");
  });

  it("chainLoadGate that actually loaded the chain leaves skipped absent", async () => {
    const sha = await commitFiles(
      repo,
      { ".flume/chain.ts": SKIP_TEST_CHAIN },
      "build: rewrite chain",
    );

    const result = await chainLoadGate.run(
      ctx(repo, { commitSha: sha, touchedPaths: [".flume/chain.ts"] }),
    );

    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/valid Chain/);
    expect(result.skipped).toBeUndefined();
  });
});

describe("Gate.command — shellGate renders cmd+args as one line (spec/chain.md 'The builtin gates')", () => {
  it("shellGate declares command as cmd followed by args, space-joined", () => {
    const gate = shellGate({
      name: "custom",
      when: "afterCommit",
      cmd: "tsc",
      args: ["--noEmit", "-p", "tsconfig.json"],
    });
    expect(gate.command).toBe("tsc --noEmit -p tsconfig.json");
  });

  it("shellGate with no args renders the bare cmd", () => {
    const gate = shellGate({
      name: "bare",
      when: "afterCommit",
      cmd: "pnpm",
      args: [],
    });
    expect(gate.command).toBe("pnpm");
  }, SPAWN_BUDGET_MS);

  it("tscGate/vitestGate/eslintGate declare their pnpm-flavored command bare", () => {
    expect(tscGate.command).toBe("pnpm tsc --noEmit");
    expect(vitestGate.command).toBe("pnpm test --run");
    expect(eslintGate.command).toBe("pnpm lint");
  });

  it("a pkgManagerGate override renders the overridden command, not the pnpm default", () => {
    const overridden = tscGate({
      cmd: "npm",
      args: ["exec", "--", "tsc", "--noEmit"],
    });
    expect(overridden.command).toBe("npm exec -- tsc --noEmit");
    expect(tscGate.command).toBe("pnpm tsc --noEmit");
  }, SPAWN_BUDGET_MS);

  it("chainLoadGate declares no command — no single command line to run", () => {
    expect(chainLoadGate.command).toBeUndefined();
  });

  it("writablePathsGate declares no command — no single command line to run", () => {
    expect(writablePathsGate(["**"]).command).toBeUndefined();
  });

  it("pendingGate declares no command — no single command line to run", () => {
    const gate = pendingGate({
      targetFence: { writablePaths: ["**"] },
    });
    expect(gate.command).toBeUndefined();
  });
});

// ---------- the fence gate over a real tick's list
// (GATECONTEXT-TOUCHEDPATHS-REQUIRED, .claude/rules/engineering.md "A seam gate
// reads what the real writer wrote") ----------

describe("builtin gates take the touched-path list they are handed, with no private derivation beside it", () => {
  it("src/builtinGates.ts carries no git show --name-only fallback for a commit's touched paths", async () => {
    const src = await readFile(
      fileURLToPath(new URL("../src/builtinGates.ts", import.meta.url)),
      "utf8",
    );
    // Non-vacuity: the module really was read, and it really is the one whose
    // gates key off the list (.claude/rules/engineering.md "A green verdict is
    // proven non-vacuous").
    expect(src).toContain("ctx.touchedPaths");
    // A second derivation beside the dispatcher's is what let every gate
    // fixture here drive the fence gate over a list no tick ever produced.
    expect(src).not.toContain("--name-only");
  });
});

describe("writablePathsGate — the fence seam, both sides real", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it("writablePathsGate judges exactly the touched-path list a real dispatcher tick hands its gates", async () => {
    const flumeDir = join(fx.repo, ".flume");
    await commitFiles(
      fx.repo,
      {
        ".flume/plan/pending/.gitkeep": "",
        [`.flume/plan/pending/${entryFileName("FENCE-SEAM")}`]:
          JSON.stringify({ ...validEntry, tag: "FENCE-SEAM" }, null, 2) + "\n",
      },
      "test: a queue entry",
    );
    new Baton(flumeDir).wake("build");

    // The producer's output, captured off a context the dispatcher built —
    // not restated here. The gate loop hands every gate the same list, so
    // what this probe records is what the fence gate judged.
    let handed: string[] | undefined;
    const probe: Gate = {
      name: "touched-probe",
      when: "afterCommit",
      run: async (ctx) => {
        handed = [...ctx.touchedPaths];
        return { ok: true, message: "probed" };
      },
    };

    const phase: Phase = {
      name: "build",
      description: "test phase",
      promptPath: "prompt.md",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      // The fence gate itself is the dispatcher's own attachment — no test
      // double stands in for either side of the seam.
      gates: [probe],
      handoff: () => [],
    };
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const commit = async (cwd: string, rel: string, body: string) => {
      const abs = join(cwd, rel);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, body);
      await exec("git", ["add", "--", rel], { cwd });
      await exec("git", ["commit", "-q", "-m", `build(FENCE-SEAM): ${rel}`], {
        cwd,
      });
    };

    const agent: Agent = {
      name: "fake-fanout",
      async invoke(inv) {
        // Two commits, so the span's diff is provably not the tip commit's
        // own `git show --name-only`: the off-fence path rides the *first*
        // commit, and a gate deriving its own list from the tip would never
        // see it.
        await commit(inv.cwd, "spec/off-fence.md", "out of bounds\n");
        await commit(inv.cwd, "src/ok.ts", "export const ok = 1;\n");
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: () => Promise.resolve({ chain }),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    // Vacuity pin: the probe ran, and over a populated list — every
    // comparison below is empty otherwise.
    expect(handed).toBeDefined();
    expect([...handed!].sort()).toEqual(["spec/off-fence.md", "src/ok.ts"]);

    const fenceResults = (outcome.verdict?.gateResults ?? []).filter(
      (g) => g.gate === "writable-paths",
    );
    expect(fenceResults).toHaveLength(1);
    expect(fenceResults[0]?.ok).toBe(false);

    // The gate faulted exactly the members of the handed list its globs
    // exclude — no path it was never given, and none it was given and
    // silently dropped.
    const faulted = (fenceResults[0]?.details ?? "")
      .split("\n")
      .map((l) => l.replace(/^\s*-\s*/, "").split(" ")[0] ?? "")
      .filter((l) => l.length > 0);
    expect(faulted).toEqual(handed!.filter((p) => !p.startsWith("src/")));

    // The fence gate's verdict is the tick's: nothing shipped.
    expect(outcome.result?.shippedTags).toEqual([]);
  });
});
