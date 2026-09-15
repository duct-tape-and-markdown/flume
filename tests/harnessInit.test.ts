/**
 * `flume-harness init` (`spec/harness.md`, *Adoption and upgrade*) — the
 * artifacts adoption writes, and the refusal that keeps it from running twice.
 *
 * The cases here are agreement gates (`.claude/rules/engineering.md`, *A seam
 * gate reads what the real writer wrote*): the real writer is `harnessInit`
 * over a real temporary repository, and the readers are the real ones — the
 * package's own `DeclarationSchema` over the skeleton it wrote, `tsx`'s
 * module loader over that skeleton as a consumer's chain would load it, the
 * engine's own `loadChainModule` over the `chain.ts` it wrote, `tsc` over
 * both against the package's exported types, and `consumerIgnores` over the
 * `.gitignore` lines it merged. A hand-authored expectation of any of them
 * would re-author the writer's output by the tester's hand and let a
 * one-sided change ship green.
 *
 * The one thing simulated is the install: a temporary repository has no
 * `node_modules`, so the package specifier the skeleton imports is satisfied
 * by a shim that re-exports this checkout's `harness/index.ts` at runtime,
 * and by a `paths` entry pointing at the same file at typecheck. The bytes
 * being judged are still the writer's, and the schema and the type judging
 * them are still the package's.
 */

import { existsSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, beforeEach, expect, it } from "vitest";

import {
  consumerIgnores,
  harnessInit,
  protocolTemplatePath,
  type HarnessInitResult,
} from "../harness/index.ts";
import { HELP_JOB, HELP_TOP, isSubcommand } from "../src/cliHelp.ts";
import { TSX_CLI, runNodeStreams } from "./helpers/subprocess.ts";

/** This checkout's harness entry point — what the install shim re-exports. */
const HARNESS_INDEX = fileURLToPath(new URL("../harness/index.ts", import.meta.url));

/**
 * This checkout's engine entry point — the package root, which the written
 * `chain.ts` imports `ChainFactory` from. Type-only there, so it is the
 * typecheck that needs it and never the loader.
 */
const ENGINE_INDEX = fileURLToPath(new URL("../src/index.ts", import.meta.url));

/** The engine's real chain loader, for the probe that drives it in-process. */
const DISPATCHER = new URL("../src/Dispatcher.ts", import.meta.url).href;

let repoRoot: string;

beforeEach(async () => {
  // Plain `mkdtemp`, not `mkFixtureRoot`: the fixture's bay is the subject
  // here, and init refuses a state root that is already present.
  repoRoot = await mkdtemp(join(tmpdir(), "flume-harness-init-"));
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

/**
 * Satisfy the package specifier the skeleton imports, without an install:
 * `<root>/node_modules/<name>` re-exporting this checkout's harness entry
 * point through the same `./harness` subpath the published `exports` map
 * declares. The name comes off the init result rather than being spelled
 * here, so the shim answers whatever specifier the writer actually wrote.
 */
async function installShim(root: string, packageName: string): Promise<void> {
  const dir = join(root, "node_modules", ...packageName.split("/"));
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: packageName,
      type: "module",
      exports: { "./harness": "./harness.mjs" },
    }),
  );
  await writeFile(
    join(dir, "harness.mjs"),
    `export * from ${JSON.stringify(pathToFileURL(HARNESS_INDEX).href)};\n`,
  );
}

it("flume-harness init writes a declaration.ts skeleton the package's schema parses", async () => {
  const result = await harnessInit({ repoRoot });
  await installShim(repoRoot, result.packageName);

  // Non-vacuity: the file the loader is about to read is the one init wrote,
  // and it imports the package by the specifier init recorded.
  expect(result.written).toContain(`${result.stateRoot}/declaration.ts`);
  const source = await readFile(
    join(repoRoot, result.stateRoot, "declaration.ts"),
    "utf8",
  );
  expect(source).toContain(`from "${result.packageName}/harness"`);

  // Loaded the way a consumer's chain loads it — `tsx` over the `.ts` on
  // disk, in a process rooted at the consumer's repository, resolving the
  // bare specifier through its own `node_modules` — and parsed by the
  // package's real schema, which throws naming every field at fault. A
  // skeleton that does not compile, imports a name the package does not
  // export, or misses a required field reds here rather than at a
  // consumer's first tick.
  const probe = join(repoRoot, "parse-declaration.mjs");
  await writeFile(
    probe,
    `import { parseDeclaration } from ${JSON.stringify(`${result.packageName}/harness`)};\n` +
      `const module = await import("./${result.stateRoot}/declaration.ts");\n` +
      `const declaration = parseDeclaration(module.default);\n` +
      `process.stdout.write(JSON.stringify({\n` +
      `  specLocus: declaration.specLocus,\n` +
      `  fenceBuild: declaration.fence.build,\n` +
      `  slices: declaration.slices.enabled,\n` +
      `  runner: typeof declaration.runner,\n` +
      `}));\n`,
  );

  const parsed = await runNodeStreams(repoRoot, [TSX_CLI, probe]);
  expect({ code: parsed.code, stderr: parsed.stderr }).toEqual({ code: 0, stderr: "" });

  // The fields a tick cannot run without arrived as values, not as absences
  // a default filled in behind the parse.
  const declaration = JSON.parse(parsed.stdout) as {
    specLocus: string[];
    fenceBuild: string[];
    slices: string[];
    runner: string;
  };
  expect(declaration.specLocus.length).toBeGreaterThan(0);
  expect(declaration.fenceBuild.length).toBeGreaterThan(0);
  expect(declaration.slices.length).toBeGreaterThan(0);
  // The runner arrived as the factory the chain calls at load, not as a
  // built value the skeleton resolved without an API.
  expect(declaration.runner).toBe("function");
}, 60_000);

it("flume-harness init writes the state root and its derived ignore lines", async () => {
  // A `.gitignore` the consumer already maintains: the merge preserves it,
  // and its presence proves the lines below were appended rather than the
  // file being written from scratch.
  await writeFile(join(repoRoot, ".gitignore"), "node_modules/\ndist/\n", "utf8");

  const result = await harnessInit({ repoRoot });

  expect(statSync(join(repoRoot, result.stateRoot)).isDirectory()).toBe(true);

  // The real derivation, not a list by the tester's hand — and non-empty
  // first, since an empty set would satisfy every containment below.
  const derived = consumerIgnores(result.stateRoot);
  expect(derived.length).toBeGreaterThan(0);

  expect(result.ignoreLines).toEqual(derived);
  const written = await readFile(join(repoRoot, ".gitignore"), "utf8");
  expect(written.split(/\r?\n/).filter((line) => line !== "")).toEqual([
    "node_modules/",
    "dist/",
    ...derived,
  ]);

  // Idempotent in the only direction a consumer can reach it: a second
  // adoption into a fresh root beside the same `.gitignore` appends nothing
  // it already carries.
  await rm(join(repoRoot, result.stateRoot), { recursive: true });
  const again = await harnessInit({ repoRoot });
  expect(again.ignoreLines).toEqual([]);
});

it("flume-harness init writes PROTOCOL.md from the package's own template", async () => {
  const template = await readFile(protocolTemplatePath(), "utf8");

  // Non-vacuity, and the premise of the identity below: the shipped template
  // exists, has content, and carries the one placeholder init substitutes.
  expect(template.length).toBeGreaterThan(0);
  expect(template).toContain("{{STATE_ROOT}}");

  const defaulted = await harnessInit({ repoRoot });
  const other = await mkdtemp(join(tmpdir(), "flume-harness-init-alt-"));
  try {
    const relocated = await harnessInit({ repoRoot: other, stateRoot: ".harness" });

    const read = async (result: HarnessInitResult, root: string): Promise<string> =>
      readFile(join(root, result.stateRoot, "PROTOCOL.md"), "utf8");
    const written = {
      defaulted: await read(defaulted, repoRoot),
      relocated: await read(relocated, other),
    };

    // Both renders are the template with one token replaced by value: mask
    // each one's own state root back out and all three texts coincide. A
    // PROTOCOL.md composed in `init.ts` instead of read from the template,
    // or a state root baked into the template, breaks the identity.
    const mask = (text: string, token: string): string => text.split(token).join("\0");
    expect(mask(written.defaulted, defaulted.stateRoot)).toBe(
      mask(template, "{{STATE_ROOT}}"),
    );
    expect(mask(written.relocated, relocated.stateRoot)).toBe(
      mask(template, "{{STATE_ROOT}}"),
    );

    // And the substitution ran: the rendered file names the consumer's root
    // and carries no placeholder left for a reader to trip over.
    expect(written.relocated).toContain(".harness/plan/notes");
    expect(written.defaulted).not.toMatch(/\{\{[^}]*\}\}/);
  } finally {
    await rm(other, { recursive: true, force: true });
  }
});

it("flume-harness init refuses a state root that already exists rather than overwriting it", async () => {
  // A repository mid-life: a state root with a declaration its owner has
  // edited, and the two files init would otherwise merge into.
  const stateRoot = join(repoRoot, ".flume");
  await mkdir(stateRoot, { recursive: true });
  const edited = "export default { mine: true };\n";
  await writeFile(join(stateRoot, "declaration.ts"), edited, "utf8");
  const gitignore = "node_modules/\n";
  await writeFile(join(repoRoot, ".gitignore"), gitignore, "utf8");
  const manifest = `${JSON.stringify({ name: "consumer", version: "1.0.0" }, null, 2)}\n`;
  await writeFile(join(repoRoot, "package.json"), manifest, "utf8");

  await expect(harnessInit({ repoRoot })).rejects.toThrow(/already exists/);

  // The refusal is taken before the first byte: the consumer's declaration,
  // its `.gitignore` and its manifest are all exactly as they were, so a
  // second init cannot leave a half-adopted tree behind.
  expect(await readFile(join(stateRoot, "declaration.ts"), "utf8")).toBe(edited);
  expect(await readFile(join(repoRoot, ".gitignore"), "utf8")).toBe(gitignore);
  expect(await readFile(join(repoRoot, "package.json"), "utf8")).toBe(manifest);
  expect(existsSync(join(stateRoot, "PROTOCOL.md"))).toBe(false);
});

/**
 * The reason the verb lives on a bin of its own (`spec/harness.md`,
 * *Adoption and upgrade*): the engine's verb set is closed, so `flume` gains
 * no adoption verb however convenient one would be. The import direction
 * behind it — `src/` never importing `harness/` — is pinned separately
 * (`tests/harnessRunner.test.ts`); this is the surface a caller sees.
 */
it("the engine's flume bin exposes no harness verb", async () => {
  // Vacuity: the table is the engine's real one, and answers `true` for a
  // verb it does ship, before any absence is asserted over it.
  expect(isSubcommand("status")).toBe(true);

  expect(isSubcommand("init")).toBe(false);
  expect(isSubcommand("harness")).toBe(false);

  // Nor in the help text a caller reads to find the verbs: neither the top
  // table nor the job one lists an adoption command.
  for (const help of [HELP_TOP, HELP_JOB]) {
    expect(help.length).toBeGreaterThan(0);
    expect(help).not.toMatch(/^ {2}(init|harness)\b/m);
  }

  // And the engine's bin reaches the engine's entry alone — a shim that
  // routed a verb into the harness emit would name it here. Comment lines
  // drop out first: this shim's prose names its sibling, and what is being
  // read is the entry it executes.
  const shim = await readFile(
    fileURLToPath(new URL("../bin/flume.js", import.meta.url)),
    "utf8",
  );
  const code = shim
    .split(/\r?\n/)
    .filter((line) => line !== "" && !line.startsWith("//") && !line.startsWith("#!"))
    .join("\n");
  expect(code).toContain("cli.js");
  expect(code).not.toMatch(/harness/);
});

/**
 * The declaration's shape one rung up the ladder (`.claude/rules/engineering.md`,
 * *Narration is the ladder's bottom rung*): the schema refuses a bad
 * declaration at chain load, and `DeclarationInput` is that same refusal at
 * typecheck, where a consumer's editor can complete into it.
 *
 * An agreement gate like the parse case above, with the reader swapped: the
 * writer is still `harnessInit` over a real repository, and the reader is
 * the real `tsc` over the real exported type, resolving the package
 * specifier the skeleton imports to this checkout's entry point. A
 * hand-written literal here would re-author the skeleton by the tester's
 * hand, and a skeleton that dropped the annotation would still pass.
 */
const TSC_BIN = fileURLToPath(
  new URL("../node_modules/typescript/bin/tsc", import.meta.url),
);

/** This checkout's compiler options — the consumer's typecheck, not a looser one. */
const BASE_TSCONFIG = fileURLToPath(new URL("../tsconfig.json", import.meta.url));

/**
 * Where the ambient types live. `typeRoots` defaults to a walk up from the
 * *config's* directory, and the config below sits in a temporary repository
 * with no `node_modules` of its own — so without this, `@types/node` is out
 * of the program and every `node:` import under `src/` reds for a reason
 * that has nothing to do with the declaration being judged. A real consumer
 * has its own; the fixture borrows this checkout's.
 */
const TYPE_ROOTS = fileURLToPath(
  new URL("../node_modules/@types", import.meta.url),
);

/**
 * Typecheck the modules `result` wrote and nothing else: `files` names them,
 * `include: []` clears the base config's own roots, and `paths` answers both
 * bare specifiers the written files import — the package root and its
 * `/harness` subpath, the two halves of the published `exports` map —
 * without an install. Everything they reach — the package's entry points,
 * its exported types, the engine beneath both — is this checkout's real
 * source.
 */
async function typecheckWritten(
  root: string,
  result: HarnessInitResult,
  files: readonly string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  const config = join(root, "tsconfig.written.json");
  await writeFile(
    config,
    JSON.stringify({
      extends: BASE_TSCONFIG,
      compilerOptions: {
        paths: {
          [result.packageName]: [ENGINE_INDEX],
          [`${result.packageName}/harness`]: [HARNESS_INDEX],
        },
        typeRoots: [TYPE_ROOTS],
      },
      files,
      include: [],
    }),
    "utf8",
  );
  return runNodeStreams(root, [TSC_BIN, "-p", config]);
}

it("the declaration skeleton init writes typechecks against the package's exported input type", async () => {
  const result = await harnessInit({ repoRoot });
  const declarationPath = join(repoRoot, result.stateRoot, "declaration.ts");
  const source = await readFile(declarationPath, "utf8");

  // Non-vacuity: the bytes about to be typechecked are annotated ones. A
  // skeleton carrying no `satisfies` would compile below while checking
  // nothing, and a skeleton importing the type as a value would resolve
  // differently under a consumer's `verbatimModuleSyntax`.
  expect(source).toContain(
    `import { vitestRunner, type DeclarationInput } from "${result.packageName}/harness"`,
  );
  expect(source).toContain("} satisfies DeclarationInput;");

  const clean = await typecheckWritten(repoRoot, result, [
    `${result.stateRoot}/declaration.ts`,
  ]);
  expect({ code: clean.code, out: clean.stdout }).toEqual({ code: 0, out: "" });

  // And the annotation bears weight. The typo below is exactly what the
  // schema refuses at chain load today — a slice name the package does not
  // ship — so this is the load refusal arriving a rung earlier, naming the
  // field and the valid set the same way.
  const typo = source.replace(`"plan-inbox"`, `"plan-inbx"`);
  expect(typo).not.toBe(source);
  await writeFile(declarationPath, typo, "utf8");

  const broken = await typecheckWritten(repoRoot, result, [
    `${result.stateRoot}/declaration.ts`,
  ]);
  expect(broken.code).not.toBe(0);
  expect(broken.stdout).toContain("plan-inbx");
  expect(broken.stdout).toContain("plan-inbox");
}, 180_000);

/**
 * The hop that makes an adopted repository tickable (`spec/harness.md`,
 * *Adoption and upgrade*): the engine refuses a load with no
 * `<configDir>/chain.ts`, so adoption writes the one that applies the
 * package's factory to the declaration beside it.
 *
 * Two readers, both real: `tsc` over the written module against the
 * package's exported `ChainFactory`, and the engine's own `loadChainModule`
 * — the single load+validate path the runtime trusts — over the file on
 * disk, from the roots a consumer's tick resolves.
 */
it("init writes a chain.ts applying the package factory to the declaration beside it", async () => {
  const result = await harnessInit({ repoRoot });

  // Non-vacuity: the bytes typechecked below are the hop — the package's
  // factory, over the declaration init wrote beside this file, exported in
  // the shape the engine's loader demands.
  expect(result.written).toContain(`${result.stateRoot}/chain.ts`);
  const source = await readFile(
    join(repoRoot, result.stateRoot, "chain.ts"),
    "utf8",
  );
  expect(source).toContain(
    `import { harnessChain } from "${result.packageName}/harness"`,
  );
  expect(source).toContain("harnessChain({ api, declaration })");
  expect(source).toContain("export default factory;");

  // And it compiles against the real exported types, resolving both bare
  // specifiers to this checkout: a hop annotated `ChainFactory` whose return
  // is not a `ChainModule`, or one importing a name the package does not
  // export, reds here rather than at a consumer's first tick.
  const clean = await typecheckWritten(repoRoot, result, [
    `${result.stateRoot}/chain.ts`,
  ]);
  expect({ code: clean.code, out: clean.stdout }).toEqual({ code: 0, out: "" });
}, 180_000);

it("the chain.ts init writes loads through the engine's chain loader as a valid Chain", async () => {
  // A repository as the loader meets one: a manifest for init's dependency
  // clause to land in, and the package resolvable by the specifier the
  // written chain imports.
  await writeFile(
    join(repoRoot, "package.json"),
    `${JSON.stringify({ name: "consumer", version: "0.0.0", type: "module" }, null, 2)}\n`,
    "utf8",
  );
  const result = await harnessInit({ repoRoot });
  await installShim(repoRoot, result.packageName);
  expect(result.written).toContain(`${result.stateRoot}/chain.ts`);

  // `loadChainModule` is what every tick, `jobNew` and `chainLoadGate` reach
  // a chain through, so driving it over the adopted roots — repo root, and
  // the state root as both config dir and state dir, exactly as a consumer's
  // `flume tick` resolves them — is the load a first tick performs. It runs
  // in a child under `tsx` because the chain resolves its own bare imports
  // from the consumer's `node_modules`, not from this checkout's.
  const configDir = join(repoRoot, result.stateRoot);
  const probe = join(repoRoot, "load-chain.mjs");
  await writeFile(
    probe,
    `import { loadChainModule } from ${JSON.stringify(DISPATCHER)};\n` +
      `const configDir = ${JSON.stringify(configDir)};\n` +
      `const { chain } = await loadChainModule({\n` +
      `  repoRoot: ${JSON.stringify(repoRoot)},\n` +
      `  configDir,\n` +
      `  flumeDir: configDir,\n` +
      `});\n` +
      `const declaration = (await import("./${result.stateRoot}/declaration.ts")).default;\n` +
      `process.stdout.write(JSON.stringify({\n` +
      `  phases: chain.phases.map((p) => p.name),\n` +
      `  enabled: declaration.slices.enabled,\n` +
      `}));\n`,
    "utf8",
  );

  const loaded = await runNodeStreams(repoRoot, [TSX_CLI, probe]);
  expect({ code: loaded.code, stderr: loaded.stderr }).toEqual({
    code: 0,
    stderr: "",
  });

  // A `Chain` the engine validated — the loader throws on a factory shape it
  // cannot use, a promise, or a `phases[]` that is not an array — carrying
  // the phases this declaration asked for: every slice it enabled, and the
  // build phase the package always ships. The expectation comes off the
  // declaration on disk, so a skeleton that enables a different set moves
  // both sides together.
  const { phases, enabled } = JSON.parse(loaded.stdout) as {
    phases: string[];
    enabled: string[];
  };
  expect(enabled.length).toBeGreaterThan(0);
  expect([...phases].sort()).toEqual([...enabled, "build"].sort());
}, 60_000);
