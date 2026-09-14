/**
 * `flume-harness init` (`spec/harness.md`, *Adoption and upgrade*) — the four
 * artifacts adoption writes, and the refusal that keeps it from running twice.
 *
 * The cases here are agreement gates (`.claude/rules/engineering.md`, *A seam
 * gate reads what the real writer wrote*): the real writer is `harnessInit`
 * over a real temporary repository, and the readers are the real ones — the
 * package's own `DeclarationSchema` over the skeleton it wrote, `tsx`'s
 * module loader over that skeleton as a consumer's chain would load it, and
 * `consumerIgnores` over the `.gitignore` lines it merged. A hand-authored
 * expectation of any of the three would re-author the writer's output by the
 * tester's hand and let a one-sided change ship green.
 *
 * The one thing simulated is the install: a temporary repository has no
 * `node_modules`, so the package specifier the skeleton imports is satisfied
 * by a shim that re-exports this checkout's `harness/index.ts`. The bytes
 * being judged are still the writer's, and the schema judging them is still
 * the package's.
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
      `  runner: typeof declaration.runner.run,\n` +
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
