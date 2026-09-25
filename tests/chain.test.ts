/**
 * This repository's chain is the harness package's factory applied to its
 * declaration (`spec/harness.md`, *What this repo is*). The package's own
 * suites pin the mechanics; what this file pins is the composition — that
 * the chain the engine loads for this repo is the one the declaration
 * describes, and that the engine accepts it — plus the `FlumeApi` values a
 * chain reaches the engine through.
 */

import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
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
import {
  isDirectoryOrAbsent,
  isDirectoryOrAbsentUnder,
} from "../src/fsProbe.ts";
import { readFileAtRef } from "../src/git.ts";
import { gitPath, matchesAny, namespacedJoin } from "../src/paths.ts";
import chainFactory from "../.flume/chain.ts";
import { declaration } from "../.flume/declaration.ts";
import { mkTempDir } from "./helpers/fixtureRoot.ts";
import { pageIdentifiers } from "./helpers/pageAnchors.ts";
import { REPO_ROOT } from "./helpers/repoProgram.ts";
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

describe("buildFlumeApi().namespacedJoin (.claude/rules/engineering.md 'A fact the engine holds is reported, never rediscovered')", () => {
  it("buildFlumeApi().namespacedJoin is the engine's own win32 path fold, by reference", () => {
    const api = buildFlumeApi(REPO_PATHS);
    // Identity is the whole claim here, and it is the only reachable one: the
    // fold is `toNamespacedPath(join(...))` and identity off win32, so a
    // behavioral probe on this host would compare the body against itself
    // (tests/paths.test.ts, header). What the chain gets is *this* function —
    // the same one the engine composes its own fs paths through, and the one
    // the source scan over `examples/` holds those chains to
    // (tests/namespacedFsPaths.test.ts).
    expect(api.namespacedJoin).toBe(namespacedJoin);
  });
});

/**
 * A chain gating on a directory of its own — an inbox, a findings queue, a
 * scratch store — holds a root it answers for and the directory beneath it,
 * never the rungs in between; those are the engine's to walk
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported, never
 * rediscovered*). Handing out the variadic spelling alone leaves every such
 * chain composing its own descent, which is right at the one segment it was
 * written over and wrong at the first queue seated deeper — and the rung it
 * skips is the ancestor its silent arm rests on, answering `ENOENT` on win32
 * where the queue is read **drained** (`.claude/rules/platform-facts.md`,
 * *win32 reports a path through a non-directory as not found*).
 *
 * Driven through the real `buildFlumeApi`, the seam a chain factory is handed:
 * an engine export a chain cannot reach there is one it composes by hand,
 * whatever the package root also names.
 */
describe("buildFlumeApi().isDirectoryOrAbsentUnder (.claude/rules/engineering.md 'A fact the engine holds is reported, never rediscovered')", () => {
  it("buildFlumeApi hands out the rooted absence descent, by reference", async () => {
    const api = buildFlumeApi(REPO_PATHS);
    expect(api.isDirectoryOrAbsentUnder).toBe(isDirectoryOrAbsentUnder);
    // The rungs form stays for the fan it answers — siblings under a root
    // already proven — so the claim is that both shapes are reachable, not
    // that the composer replaced the list.
    expect(api.isDirectoryOrAbsent).toBe(isDirectoryOrAbsent);

    // Identity is the claim; one behavioral probe says which rule it is. The
    // directory sits two segments under the root, so an answer at all is the
    // engine composing the rungs — the shape a chain handing `(root, dir)` to
    // the variadic form would leave with its middle segment never probed.
    const root = await mkTempDir("chain-rooted-descent-");
    const dir = join(root, "queue", "inbox");
    expect(api.isDirectoryOrAbsentUnder("inbox queue", root, dir)).toBe(false);
    await mkdir(dir, { recursive: true });
    expect(api.isDirectoryOrAbsentUnder("inbox queue", root, dir)).toBe(true);
    await rm(root, { recursive: true, force: true });
  });

  it("the api's rooted descent refuses a directory whose intermediate rung is present and is not a directory", async () => {
    const api = buildFlumeApi(REPO_PATHS);
    const root = await mkTempDir("chain-rooted-descent-obstructed-");
    // The obstruction sits *between* the root and the directory — the rung a
    // chain naming `(root, dir)` itself never probes. Both hosts stat that
    // rung and find a plain file, so this refusal is portable; what is not is
    // the leaf's own stat, ENOTDIR on posix and ENOENT on win32, which is the
    // reading the skipped rung would have left standing.
    await writeFile(join(root, "queue"), "not a directory\n");
    expect(() =>
      api.isDirectoryOrAbsentUnder("inbox queue", root, join(root, "queue", "inbox")),
    ).toThrow(/inbox queue is unreadable: .*queue is present but is not a directory/);
    await rm(root, { recursive: true, force: true });
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

/** The consumer surface that teaches the api a chain composes with. */
const AUTHORING_PAGE = "docs/CHAIN-AUTHORING.md";

/**
 * The converse of the arm `tests/pageAnchors.test.ts` already holds that page
 * to. There, every backticked identifier the page states must name a symbol
 * the package ships — which says nothing at all about a member the page states
 * nowhere. A chain takes every engine *value* off this object
 * (`src/flumeApi.ts`), so a member no consumer surface names is a capability a
 * chain author cannot find: the hover text is reachable only once you know
 * what to hover, and what gets composed by hand instead is the fact the
 * engine already holds (`.claude/rules/engineering.md`, *A fact the engine
 * holds is reported, never rediscovered*).
 *
 * Judged off the real producer's own keys rather than a list kept beside them,
 * and over the page's prose spans rather than its samples: a fenced block is
 * code the page is showing, so a member named only inside one was never
 * taught. The `api.`-prefixed spelling counts — `paths` is stated as
 * `api.paths` and nowhere bare, which is how a reader meets it.
 */
it("docs/CHAIN-AUTHORING.md names every member buildFlumeApi ships", () => {
  const read = pageIdentifiers({
    root: REPO_ROOT,
    domain: { trees: [], files: [AUTHORING_PAGE] },
  });
  // Every span the page states, a wrap closed the way its author spelled it:
  // a member named across a line break is named.
  const spans = [
    ...read.backticked.map((site) => site.text),
    ...read.wraps.scanned.map((site) => site.closed),
  ];
  const named = new Set(
    spans.flatMap((span) => span.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? []),
  );
  const members = Object.keys(buildFlumeApi(REPO_PATHS));

  // Non-vacuity on both sides, before the emptiness is read off either: the
  // producer was built and the keys are the whole object rather than one
  // branch of it, and the page was read with its prose spans populated.
  expect(read.pages).toEqual([AUTHORING_PAGE]);
  expect(members.length).toBeGreaterThan(30);
  expect(members).toEqual(
    expect.arrayContaining(["paths", "git", "Baton", "TipClaimHeldError"]),
  );
  expect(spans.length).toBeGreaterThan(500);

  // And the span rule discriminates: each of these the page states only
  // inside a fenced sample, so the verdict below is read over what the page
  // teaches rather than over every byte it carries.
  for (const sample of [
    "pendingParseGate",
    "dockerHostAvailable",
    "effortFence",
  ]) {
    expect(`${sample} -> ${named.has(sample)}`).toBe(`${sample} -> false`);
  }

  expect({
    page: AUTHORING_PAGE,
    missing: members.filter((member) => !named.has(member)),
  }).toEqual({ page: AUTHORING_PAGE, missing: [] });
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
 * `Chain.seedDir` once named a directory `flume job new` copied into a fresh
 * job dir. The engine seeds no second state root beneath a checkout
 * (spec/jobs.md, *The checkout is the unit of isolation*), so there is no
 * value for a chain to hand it: the key is gone from the declared surface,
 * not merely unread. Cited as the member it names, so the member arm reads it
 * and reports it gone; the citation stands because the exclusion list
 * (`tests/helpers/external-vocabulary.json`) excuses it by name and by
 * reason. That list is the one channel an overridden verdict travels on, and
 * it counts what it overrides — a spelling the arm declined would leave this
 * exemption asserted by a paragraph nothing reads.
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
