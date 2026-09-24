/**
 * This repository's chain is the harness package's factory applied to its
 * declaration (`spec/harness.md`, *What this repo is*). The package's own
 * suites pin the mechanics; what this file pins is the composition — that
 * the chain the engine loads for this repo is the one the declaration
 * describes, and that the engine accepts it — plus the `FlumeApi` values a
 * chain reaches the engine through.
 */

import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

import { loadChainModule } from "../src/chainLoad.ts";
import type { Chain, Phase } from "../src/Phase.ts";
import { slugify } from "../src/paths.ts";
import {
  entryAttemptKey,
  phaseAttemptKey,
  priorAttemptPath,
  recordAttemptKey,
} from "../src/priorAttempts.ts";
import { buildFlumeApi, type FlumePaths } from "../src/flumeApi.ts";
import { readFileAtRef } from "../src/git.ts";
import { gitPath, matchesAny } from "../src/paths.ts";
import chainFactory from "../.flume/chain.ts";
import { declaration } from "../.flume/declaration.ts";
import { mkTempDir } from "./helpers/fixtureRoot.ts";
import { SPAWN_BUDGET_MS, gitOutSync } from "./helpers/subprocess.ts";

// This file's cases drive real git repositories, and a git spawn is a spawn
// like any other: the lane's one budget, for its cases and its hooks alike,
// declared once for the file rather than inherited from the runner
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

function git(repo: string, args: string[]): string {
  return gitOutSync(repo, args).trim();
}

async function initRepo(prefix: string): Promise<string> {
  const repo = await mkTempDir(prefix);
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
  it("are the same functions src/paths.ts and src/priorAttempts.ts export, not second copies a chain's shouldRun would drift from", () => {
    const api = buildFlumeApi(REPO_PATHS);
    expect(api.slugify).toBe(slugify);
    expect(api.priorAttemptPath).toBe(priorAttemptPath);
  });
});

/**
 * A chain takes every engine *value* off the `api` — its only engine import is
 * `import type`, erased at runtime (`src/flumeApi.ts`). So a keyer a chain
 * cannot reach there is a keyer a chain composes by hand, whatever the package
 * root exports (`.claude/rules/engineering.md`, *A fact the engine holds is
 * reported, never rediscovered*). One keyer per value a hook holds — the
 * entry, the phase, the record — and each by reference, since a second copy on
 * the api is the drift the surface exists to prevent.
 */
describe("buildFlumeApi() — the prior-attempt keyers (.claude/rules/engineering.md 'A fact the engine holds is reported, never rediscovered')", () => {
  it("hands a chain the engine's own keyer for every value a prior-attempt lookup starts from", () => {
    const api = buildFlumeApi(REPO_PATHS);
    expect(api.entryAttemptKey).toBe(entryAttemptKey);
    expect(api.phaseAttemptKey).toBe(phaseAttemptKey);
    expect(api.recordAttemptKey).toBe(recordAttemptKey);
    // Identity is the claim; one probe per keyspace says which rule it is —
    // the tag slugged, the phase name kept as the chain spells it, which a
    // chain-local join applying one rule to both would get half-right.
    expect(
      api.entryAttemptKey({
        tag: "PLAN-SWEEP",
        gate: { kind: "open" },
        dependsOnForks: [],
        priority: 0,
        files: { new: [], edit: [], retire: [] },
      }),
    ).toBe("entry:plan-sweep");
    expect(api.phaseAttemptKey({ name: "plan_sweep" } as Phase)).toBe(
      "phase:plan_sweep",
    );
  });
});

describe("buildFlumeApi().gitPath (.claude/rules/engineering.md 'A fact the engine holds is reported, never rediscovered')", () => {
  it("buildFlumeApi().gitPath is the engine's own gitPath, by reference", () => {
    const api = buildFlumeApi(REPO_PATHS);
    expect(api.gitPath).toBe(gitPath);
    // Identity is the claim, so one behavioral probe is enough to say which
    // rule it is: both separators fold, which a chain-local respelling keyed
    // on the host `sep` would get half-right.
    expect(api.gitPath(String.raw`a\b/c`)).toBe("a/b/c");
  });
});

/**
 * The offset a chain roots a committed path at — a fence glob, a `pendingGate`
 * target, a pathspec at a sha — reported at chain load rather than re-derived
 * by every chain that needs one (`.claude/rules/engineering.md`, *A fact the
 * engine holds is reported, never rediscovered*). Driven through the real
 * `buildFlumeApi`, the seam a chain factory is handed.
 */
describe("buildFlumeApi().paths.stateRootRel (.claude/rules/engineering.md 'A fact the engine holds is reported, never rediscovered')", () => {
  it("buildFlumeApi reports the state root's repo-relative offset on api.paths.stateRootRel", () => {
    // The default root, and a root relocated two levels down: an offset that
    // is not the `.flume` literal is what says the value is computed from
    // the roots rather than spelled.
    expect(buildFlumeApi(REPO_PATHS).paths.stateRootRel).toBe(".flume");

    const nestedDir = join(REPO_PATHS.repoRoot, "state", "alpha", ".flume");
    const nested = buildFlumeApi({ ...REPO_PATHS, flumeDir: nestedDir });
    // Git's alphabet, whatever the host's separator — the dialect every
    // fence glob and pathspec composed from it is matched in.
    expect(nested.paths.stateRootRel).toBe("state/alpha/.flume");
    expect(nested.paths.stateRootRel).toBe(
      gitPath(relative(REPO_PATHS.repoRoot, nestedDir)),
    );

    // The three roots still arrive by reference; only the offset is added.
    expect(nested.paths.repoRoot).toBe(REPO_PATHS.repoRoot);
    expect(nested.paths.configDir).toBe(REPO_PATHS.configDir);
    expect(nested.paths.flumeDir).toBe(nestedDir);
  });

  it("api.paths.stateRootRel is absent when the state root resolves outside the repository", () => {
    const outside = join(REPO_PATHS.repoRoot, "..", "flume-state-elsewhere");
    const relocated = buildFlumeApi({ ...REPO_PATHS, flumeDir: outside });

    // Vacuity pin (.claude/rules/engineering.md, "A green verdict is proven
    // non-vacuous"): an api that carries no such field at all answers
    // `undefined` to every reading below, so the key's presence is asserted
    // before its absence means anything — and the in-repo sibling proves the
    // same builder does report an offset when there is one.
    expect("stateRootRel" in relocated.paths).toBe(true);
    expect(relocated.paths.stateRootRel).toBeUndefined();
    expect(buildFlumeApi(REPO_PATHS).paths.stateRootRel).toBeDefined();
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

describe("this repo's chain is the harness factory applied to its declaration (spec/harness.md 'What this repo is')", () => {
  const { chain } = chainFactory(buildFlumeApi(REPO_PATHS));
  const byName = Object.fromEntries(chain.phases.map((p) => [p.name, p]));

  it("declares build ahead of the three plan slices, and nothing else", () => {
    expect(chain.phases.map((p) => p.name)).toEqual(["build", "plan-inbox", "plan-derive", "plan-sweep"]);
    expect(chain.phases.map((p) => p.concurrency)).toEqual(["fanout", "singleton", "singleton", "singleton"]);
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
      // Plan state is one file per writer, so each slice's fence names its
      // own and no sibling's (`spec/harness.md`, *Plan state as declared
      // state*).
      expect(paths, name).toContain(`.flume/plan/state/${name}.json`);
      for (const other of ["plan-inbox", "plan-derive", "plan-sweep"]) {
        if (other === name) continue;
        expect(paths, `${name} may not write ${other}'s state`).not.toContain(
          `.flume/plan/state/${other}.json`,
        );
      }
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

/**
 * `Chain.seedDir` declared a directory `flume job new` copied into a fresh
 * job dir. The engine seeds no second state root beneath a checkout
 * (spec/jobs.md, *The checkout is the unit of isolation*), so there is no
 * value for a chain to hand it: the field is gone from the declared surface,
 * not merely unread.
 *
 * Judged through the real compiler over the real `src/Phase.ts`, not by a
 * conditional type alone. A conditional type is erased before vitest runs, so
 * a suite that only asserted `true` would pass against a tree that still
 * declares the field — green over the exact absence it names. The excess
 * property check is what makes the absence observable at runtime here, and
 * the control literal beside it is what keeps the refusal the field's rather
 * than the fixture's (`.claude/rules/engineering.md`, *A green verdict is
 * proven non-vacuous*).
 */
describe("Chain declarations — the job seed is off the surface", () => {
  const PHASE_SRC = fileURLToPath(new URL("../src/Phase.ts", import.meta.url));

  /** Type-check one `Chain` literal against the real `src/Phase.ts`. */
  async function diagnose(fields: string): Promise<string> {
    const dir = await mkTempDir("flume-chain-seeddir-type-");
    try {
      const file = join(dir, "fixture.ts");
      await writeFile(
        file,
        `import type { Chain } from ${JSON.stringify(PHASE_SRC)};\n` +
          `export const chain: Chain = { ${fields} };\n`,
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

  const REQUIRED = "phases: [], humanOnly: []";

  it("Chain no longer carries seedDir (type-level)", async () => {
    // Control first: the same literal without the field compiles clean, so
    // the refusal below is the field's and not the fixture's.
    expect(await diagnose(REQUIRED)).toBe("");

    // And a sibling optional the chain surface still declares compiles too,
    // so the refusal is this field's rather than every optional's.
    expect(await diagnose(`${REQUIRED}, friction: "friction"`)).toBe("");

    expect(await diagnose(`${REQUIRED}, seedDir: "job-seed"`)).toContain(
      "seedDir",
    );

    // And the key itself is gone from the interface, which is what a
    // `keyof` consumer would see. Erased at runtime, held by `pnpm tsc`.
    type SeedDirPurged = "seedDir" extends keyof Chain ? never : true;
    const purged: SeedDirPurged = true;
    expect(purged).toBe(true);
  });
});
