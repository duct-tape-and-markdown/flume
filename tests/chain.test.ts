/**
 * This repository's chain is the harness package's factory applied to its
 * declaration (`spec/harness.md`, *What this repo is*). The package's own
 * suites pin the mechanics; what this file pins is the composition — that
 * the chain the engine loads for this repo is the one the declaration
 * describes, and that the engine accepts it — plus the `FlumeApi` values a
 * chain reaches the engine through.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadChainModule } from "../src/Dispatcher.ts";
import { slugify } from "../src/paths.ts";
import { priorAttemptPath } from "../src/priorAttempts.ts";
import { buildFlumeApi, type FlumePaths } from "../src/flumeApi.ts";
import { readFileAtRef } from "../src/git.ts";
import { gitPath, matchesAny } from "../src/paths.ts";
import chainFactory from "../.flume/chain.ts";
import { declaration } from "../.flume/declaration.ts";

function git(repo: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

async function initRepo(prefix: string): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), prefix));
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "t@example.com"]);
  git(repo, ["config", "user.name", "t"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  return repo;
}

const REPO_PATHS: FlumePaths = {
  repoRoot: fileURLToPath(new URL("..", import.meta.url)),
  configDir: fileURLToPath(new URL("../.flume", import.meta.url)),
  flumeDir: fileURLToPath(new URL("../.flume", import.meta.url)),
};

describe("buildFlumeApi().matchesAny", () => {
  it("is the same matcher src/paths.ts exports, not a second copy", () => {
    expect(buildFlumeApi(REPO_PATHS).matchesAny).toBe(matchesAny);
  });
});

describe("buildFlumeApi().slugify / .priorAttemptPath (spec/loop.md 'Prior-outcome feedback to the retrying tick')", () => {
  it("are the same functions src/Dispatcher.ts exports, not second copies a chain's shouldRun would drift from", () => {
    const api = buildFlumeApi(REPO_PATHS);
    expect(api.slugify).toBe(slugify);
    expect(api.priorAttemptPath).toBe(priorAttemptPath);
  });
});

describe("buildFlumeApi().gitPath (engineering.md 'A fact the engine holds is reported, never rediscovered')", () => {
  it("buildFlumeApi().gitPath is the engine's own gitPath, by reference", () => {
    const api = buildFlumeApi(REPO_PATHS);
    expect(api.gitPath).toBe(gitPath);
    // Identity is the claim, so one behavioral probe is enough to say which
    // rule it is: both separators fold, which a chain-local respelling keyed
    // on the host `sep` would get half-right.
    expect(api.gitPath(String.raw`a\b/c`)).toBe("a/b/c");
  });
});

describe("buildFlumeApi().git.readFileAtRef", () => {
  it("is the engine's own reader on the api a chain factory receives, reading a tracked path's bytes at a given sha", async () => {
    const api = buildFlumeApi(REPO_PATHS);
    expect(api.git.readFileAtRef).toBe(readFileAtRef);

    const repo = await initRepo("flume-api-readfileatref-");
    try {
      await writeFile(join(repo, "queue.json"), "committed bytes\n");
      git(repo, ["add", "."]);
      git(repo, ["commit", "-q", "-m", "seed"]);
      const sha = git(repo, ["rev-parse", "HEAD"]);
      await writeFile(join(repo, "queue.json"), "dirty working tree\n");
      expect(await api.git.readFileAtRef(repo, sha, "queue.json")).toBe(
        "committed bytes\n",
      );
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

/**
 * Acceptance-driven backpressure (`.flume/vitestJudge.ts`): the real
 * reporter's JSON, produced by running vitest itself, through the real judge
 * — never a hand-authored report.
 */

describe("this repo's chain is the harness factory applied to its declaration (spec/harness.md 'What this repo is')", () => {
  const { chain } = chainFactory(buildFlumeApi(REPO_PATHS));
  const byName = Object.fromEntries(chain.phases.map((p) => [p.name, p]));

  it("declares the three plan slices ahead of build, and nothing else", () => {
    expect(chain.phases.map((p) => p.name)).toEqual(["plan-inbox", "plan-derive", "plan-sweep", "build"]);
    expect(chain.phases.map((p) => p.concurrency)).toEqual(["singleton", "singleton", "singleton", "fanout"]);
  });

  it("every phase's prompt is an absolute path into the package that exists on disk", () => {
    // Vacuity pin: four phases, four prompts.
    expect(chain.phases).toHaveLength(4);
    for (const p of chain.phases) {
      expect(isAbsolute(p.promptPath), p.name).toBe(true);
      expect(p.promptPath, p.name).toContain(join("harness", "prompts"));
      expect(existsSync(p.promptPath), p.name).toBe(true);
    }
  });

  it("build's fence is the declaration's, widened only by the package's own note channel", () => {
    const fence = byName["build"]!.writablePaths;
    for (const glob of declaration.fence.build) expect(fence, glob).toContain(glob);
    const extra = fence.filter((g) => !declaration.fence.build.includes(g));
    expect(extra.length).toBeGreaterThan(0);
    for (const g of extra) expect(g, "the only paths beyond the declaration are the package's").toMatch(/plan\/notes/);
  });

  it("build runs the package's discipline gates plus the declared typecheck at both gate points", () => {
    const gates = byName["build"]!.gates.map((g) => `${g.name}@${g.when}`);
    expect(gates).toContain("records@afterCommit");
    expect(gates).toContain("clean-tree@afterCommit");
    expect(gates).toContain("tsc@afterCommit");
    expect(gates).toContain("tsc@afterMerge");
  });

  it("every plan slice may write the package's plan artifacts and nothing of the consumer's", () => {
    for (const name of ["plan-inbox", "plan-derive", "plan-sweep"]) {
      const paths = byName[name]!.writablePaths;
      expect(paths, name).toContain(".flume/plan/pending.json");
      expect(paths, name).toContain(".flume/plan/state.json");
      expect(paths.some((p) => p.startsWith(".flume/inbox/")), name).toBe(true);
      expect(paths.some((p) => p.startsWith("src/")), name).toBe(false);
    }
  });

  it("the engine's own loader accepts this repo's chain", async () => {
    // `scopeWritesToEntry` is off here, so the factory must declare no
    // channel paths: the engine refuses a channel where nothing consults it
    // at chain load, and a refusal at load is a chain that cannot tick at
    // all. The real loader, over this repo's own roots, is the load a tick
    // performs.
    expect(declaration.scopeWritesToEntry).toBe(false);
    const loaded = await loadChainModule(REPO_PATHS);
    expect(loaded.chain.phases.map((p) => p.name)).toEqual(chain.phases.map((p) => p.name));
  });
});
