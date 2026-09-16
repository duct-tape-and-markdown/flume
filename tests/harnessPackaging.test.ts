/**
 * Packaging seam for the two things `@dtmd/flume` ships (`spec/harness.md`,
 * *Where it lives*): the engine at `.` and the harness package at
 * `./harness`, one npm package, one version, one `exports` map.
 *
 * Every case here is an agreement gate (`.claude/rules/engineering.md`, *A
 * seam gate reads what the real writer wrote*): the real writer is `tsc -p
 * tsconfig.build.json`, and the real readers are Node's `exports` resolver,
 * the published bin shim, and the CLI's own manifest hop. A hand-authored
 * fixture tree would re-author the emit layout by the tester's hand and let
 * a one-sided change — an include root added without the map following —
 * ship green, which is exactly the change this file exists to hold.
 *
 * The build runs once for the file, into a scratch dir rather than the
 * repo's own `dist/` so a parallel suite building there cannot race it. Its
 * two steps are the two `pnpm build` runs — `tsc`, then the asset copy —
 * each invoked as the manifest invokes it.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterAll, beforeAll, expect, it, vi } from "vitest";

import * as harnessSource from "../harness/index.ts";
import { consumerIgnores } from "../harness/ignores.ts";
import { harnessInit, protocolTemplatePath } from "../harness/init.ts";
import { PROMPT_NAMES, promptPath } from "../harness/prompts.ts";
import { resolvePackageJson } from "../src/selfPackage.ts";
import {
  SPAWN_BUDGET_MS,
  hermeticEnv,
  runCli,
  runNodeStreams,
} from "./helpers/subprocess.ts";

// This file starts processes, so it declares the lane's one budget — cases
// and hooks alike — once here rather than inheriting the runner's default
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

const exec = promisify(execFile);

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const TSC_BIN = fileURLToPath(
  new URL("../node_modules/typescript/bin/tsc", import.meta.url),
);
/** The build's second step, run here exactly as `pnpm build` runs it. */
const PACK_ASSETS = fileURLToPath(
  new URL("../scripts/pack-harness-assets.mjs", import.meta.url),
);
/** The path `pnpm build`'s own script must name for this file to be judging it. */
const PACK_ASSETS_REL = "scripts/pack-harness-assets.mjs";

interface Manifest {
  readonly version: string;
  readonly main?: unknown;
  readonly types?: unknown;
  readonly exports?: unknown;
  readonly files?: unknown;
  readonly scripts?: Record<string, string>;
  readonly engines?: Record<string, string>;
}

/** The label the README's prerequisite paragraph opens with. */
const PREREQUISITE_LABEL = "**Prerequisites:**";

/**
 * That paragraph, joined to one string: markdown wraps it across source
 * lines, so the claim under test is the block from its label to the next
 * blank line rather than whichever line the wrap happened to land on. An
 * absent label yields the empty string, which the cases below refuse before
 * asserting anything over it.
 */
async function prerequisiteClaim(): Promise<string> {
  const lines = (await readFile(join(REPO_ROOT, "README.md"), "utf8")).split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(PREREQUISITE_LABEL));
  if (start === -1) return "";
  const blank = lines.findIndex((line, i) => i > start && line.trim() === "");
  return lines.slice(start, blank === -1 ? undefined : blank).join(" ");
}

/** The README heading the adoption command has to lead. */
const QUICKSTART_HEADING = "## Quickstart";

/**
 * One `##` section of a markdown page, from its heading to the next `##`
 * one — its own `###` subsections included, since a verb demoted into one is
 * still inside the section a reader is in. An absent heading yields the
 * empty string, which every case below refuses before asserting anything
 * over it.
 */
function sectionOf(page: string, heading: string): string {
  const lines = page.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trimEnd() === heading);
  if (start === -1) return "";
  const end = lines.findIndex((line, i) => i > start && /^## /.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

/** The README's Quickstart section. */
async function quickstartSection(): Promise<string> {
  return sectionOf(await readFile(join(REPO_ROOT, "README.md"), "utf8"), QUICKSTART_HEADING);
}

/**
 * A section's lead passage: everything from its heading up to its first
 * `###` subsection, or the whole section when it has none.
 *
 * For the Quickstart that is the adoption path — the verb, what it writes,
 * what a consumer runs next. Its `### The engine-level path` subsection is
 * the alternative for a consumer who wants no harness package at all, and a
 * claim about what the adoption path names has to stop short of it: read
 * over the whole section, a verb named only under the alternative satisfies
 * the claim while the adoption paragraph never mentions it.
 */
function leadPassage(section: string): string {
  const lines = section.split(/\r?\n/);
  const end = lines.findIndex((line) => /^### /.test(line));
  return lines.slice(0, end === -1 ? undefined : end).join("\n");
}

/** The heading `docs/CLI.md` gives one verb of the harness bin. */
function harnessVerbHeading(verb: string): string {
  return `## \`flume-harness ${verb}\``;
}

/**
 * Every consumer-facing page a verb can be named on: the README and every
 * markdown page under `docs/`, read off the tree rather than listed here so
 * a page added to the set is scanned without this file being touched
 * (`.claude/rules/engineering.md`, *Derived state is computed*).
 */
async function consumerDocPages(): Promise<{ page: string; body: string }[]> {
  const pages = [
    "README.md",
    ...(await filesUnder(join(REPO_ROOT, "docs"), "docs")).filter((p) => p.endsWith(".md")),
  ];
  return Promise.all(
    pages.map(async (page) => ({
      page,
      body: await readFile(join(REPO_ROOT, ...page.split("/")), "utf8"),
    })),
  );
}

/**
 * The two pages a consumer arrives on. Everything under `docs/` is reached
 * by following a link out of one of them; a `docs/` page linked only from a
 * sibling `docs/` page is reachable only by a reader already inside the
 * directory.
 */
const DOC_ROOTS = ["README.md", "CHANGELOG.md"];

/**
 * Every link destination a markdown page states — inline `[text](target)`
 * and the reference definition `[label]: target` — with any `#anchor`
 * dropped. A destination that names nothing on the tree (a URL, a bare
 * anchor) is left in rather than filtered: the caller resolves, and a
 * target naming no file simply matches no page.
 */
function markdownLinkTargets(body: string): string[] {
  const targets = [
    ...[...body.matchAll(/\[[^\]]*\]\(\s*([^)\s]+)/g)].map((m) => m[1] ?? ""),
    ...[...body.matchAll(/^\[[^\]]+\]:\s*(\S+)/gm)].map((m) => m[1] ?? ""),
  ];
  return targets.map((t) => t.split("#")[0] ?? "").filter((t) => t !== "");
}

/**
 * A page's code voice: the body of every fenced block, plus every inline
 * code span in what is left. Prose *about* the bin ("the `flume-harness`
 * bin dispatches one verb") is not a command; a page names a command in code
 * voice, and that is the only place the scan below reads one from.
 */
function codeVoice(body: string): string[] {
  const chunks: string[] = [];
  const prose = body.replace(/```[^\n]*\n([\s\S]*?)```/g, (_match, block: string) => {
    chunks.push(block);
    return "\n";
  });
  for (const match of prose.matchAll(/`([^`\n]+)`/g)) {
    const span = match[1];
    if (span !== undefined) chunks.push(span);
  }
  return chunks;
}

/**
 * Every verb a page names on the harness bin, in page order. A token opening
 * on `-` is an option rather than a verb; trailing punctuation is the
 * sentence's or the sample output's, never the verb's.
 */
function harnessVerbTokens(body: string): string[] {
  const named: string[] = [];
  for (const chunk of codeVoice(body)) {
    for (const match of chunk.matchAll(/\bflume-harness\s+(\S+)/g)) {
      const verb = (match[1] ?? "").replace(/[.,;:!?)\]]+$/, "");
      if (verb === "" || verb.startsWith("-")) continue;
      named.push(verb);
    }
  }
  return named;
}

/**
 * Whether a passage names `path` in code voice — a file a page points a
 * reader at is a path they will look for on disk, and prose that merely
 * gestures at one ("the declaration") is not that. Containment rather than
 * span equality, so a bullet naming two files in one span still counts;
 * a path no chunk carries is named nowhere.
 */
function namesPath(passage: string, path: string): boolean {
  return codeVoice(passage).some((chunk) => chunk.includes(path));
}

/**
 * The bullet list a section's first fenced block is followed by, or the
 * empty string — for the Quickstart, what running the adoption command
 * leaves behind.
 *
 * Addressed by position rather than by the sentence that introduces it: the
 * neighbouring case already pins that first block to the adoption verb the
 * bin dispatches, so "the list under the command" is a handle no rewording
 * of the lead-in breaks. Scoped to the list because the section runs on into
 * its `###` engine-level subsection, which names some of the same files for
 * reasons of its own — a claim read over the whole section would hold with
 * the list's bullet gone.
 *
 * A list runs from its first `- ` line through the last bullet or indented
 * continuation, so a wrapped bullet stays whole and the paragraph after the
 * list is out.
 */
function listUnderFirstBlock(section: string): string {
  const fence = /```[^\n]*\n[\s\S]*?```/.exec(section);
  if (fence === null) return "";
  const lines = section.slice(fence.index + fence[0].length).split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith("- "));
  if (start === -1) return "";
  let end = start + 1;
  while (end < lines.length && /^(- |\s+\S)/.test(lines[end] ?? "")) end += 1;
  return lines.slice(start, end).join("\n");
}

/** The body of a markdown section's first shell block, or the empty string. */
function firstShellBlock(section: string): string {
  return /```bash\n([\s\S]*?)```/.exec(section)?.[1] ?? "";
}

/**
 * Every verb a `--help` text lists under its `Commands:` block, read the way
 * `tests/cliHelp.test.ts` reads the engine's exit-code block: off the real
 * output, so the set comes from the bin rather than from a spelling here.
 * A continuation line is indented past its verb and carries none.
 */
function listedVerbs(help: string): string[] {
  const start = help.indexOf("Commands:\n");
  expect(start).toBeGreaterThan(-1);
  const verbs: string[] = [];
  for (const line of help.slice(start).split("\n").slice(1)) {
    if (line.trim() === "") continue;
    if (!line.startsWith("  ")) break;
    const listed = /^ {2}(\S+) {2,}\S/.exec(line);
    if (listed?.[1] !== undefined) verbs.push(listed[1]);
  }
  return verbs;
}

let scratch: string;
/** A package-shaped tree: the real manifest and bins over a real emit. */
let pkgDir: string;
/** A consumer that reaches `pkgDir` by the package name alone. */
let consumerDir: string;
let manifest: Manifest;
/** Every file the build emitted, as a path relative to `pkgDir`. */
let emitted: string[];
/**
 * What the build's asset-copy step reported.
 *
 * Captured rather than thrown on, and bounded by the refusals in the asset
 * cases below, which assert it before anything it wrote: a step that failed
 * should red the cases that judge its output, not erase every unrelated case
 * in this file behind a `beforeAll` stack.
 */
let packAssets: { stdout: string; stderr: string; code: number };

async function filesUnder(dir: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  for (const dirent of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? dirent.name : `${prefix}/${dirent.name}`;
    if (dirent.isDirectory()) out.push(...(await filesUnder(join(dir, dirent.name), rel)));
    else out.push(rel);
  }
  return out;
}

/**
 * Every path the manifest points a consumer at: `main`, `types`, and each
 * string leaf of the `exports` map, whatever subpaths and conditions it
 * grows. Read off the manifest rather than listed here, so a subpath added
 * without its emit following is caught by the same assertion
 * (`.claude/rules/engineering.md`, *Derived state is computed*).
 */
function entryPathsOf(pkg: Manifest): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === "string") {
      out.push(node);
    } else if (node !== null && typeof node === "object") {
      for (const value of Object.values(node)) walk(value);
    }
  };
  walk(pkg.exports);
  walk(pkg.main);
  walk(pkg.types);
  return [...new Set(out)];
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "flume-packaging-"));
  pkgDir = join(scratch, "pkg");
  await mkdir(pkgDir, { recursive: true });

  await exec(
    process.execPath,
    [TSC_BIN, "-p", "tsconfig.build.json", "--outDir", join(pkgDir, "dist")],
    { cwd: REPO_ROOT },
  );
  // tsc emits no markdown, so the prompts and templates arrive by the
  // build's second step.
  packAssets = await runNodeStreams(REPO_ROOT, [PACK_ASSETS, join(pkgDir, "dist")]);

  // The tarball's non-emitted half, verbatim: the manifest whose map is
  // under test and the bins that resolve into the emit.
  await cp(join(REPO_ROOT, "package.json"), join(pkgDir, "package.json"));
  await cp(join(REPO_ROOT, "bin"), join(pkgDir, "bin"), { recursive: true });
  // The CLI statically imports `tsx` and `zod`; an installed package reaches
  // them through its own node_modules, so the scratch package needs one too
  // or every bin case below fails at module resolution instead of on its
  // property.
  await symlink(join(REPO_ROOT, "node_modules"), join(pkgDir, "node_modules"), "junction");

  manifest = JSON.parse(await readFile(join(pkgDir, "package.json"), "utf8")) as Manifest;
  emitted = await filesUnder(join(pkgDir, "dist"), "dist");

  consumerDir = join(scratch, "consumer");
  await mkdir(join(consumerDir, "node_modules", "@dtmd"), { recursive: true });
  await writeFile(
    join(consumerDir, "package.json"),
    JSON.stringify({ name: "packaging-consumer", type: "module" }),
  );
  await symlink(pkgDir, join(consumerDir, "node_modules", "@dtmd", "flume"), "junction");
}, SPAWN_BUDGET_MS);

afterAll(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

/**
 * Node's own resolver over the real map, in a consumer that knows only the
 * package name — the only reader whose verdict matters, since tsc, vitest
 * and a relative import all resolve `harness/index.ts` without the map
 * existing at all. Both sides are the real thing: the surface asked for is
 * the source module's own, so the case judges what the map reaches rather
 * than which exports the harness happens to have today. The deep-path arm
 * holds `spec/chain.md`'s standing acceptance: adding a subpath must not
 * open the emit to arbitrary reach.
 */
it("the package exports map resolves ./harness to the built harness entry point", async () => {
  const probe = join(consumerDir, "probe.mjs");
  await writeFile(
    probe,
    `import * as harness from "@dtmd/flume/harness";\n` +
      `process.stdout.write(JSON.stringify(Object.keys(harness).sort()));\n`,
  );

  const resolved = await runNodeStreams(consumerDir, [probe]);
  expect(resolved.stderr).toBe("");
  expect(resolved.code).toBe(0);

  // The value surface of harness/index.ts — types erase, so this is the
  // whole of it — read off the module itself rather than restated here: a
  // list by the tester's hand makes every harness export a packaging
  // failure, and says nothing about the map either way. Non-empty first: a
  // map that resolved to an empty module would otherwise pass the equality
  // below by accident.
  const names = JSON.parse(resolved.stdout) as string[];
  expect(names.length).toBeGreaterThan(0);
  expect(names).toEqual(Object.keys(harnessSource).sort());

  const deep = join(consumerDir, "deep.mjs");
  await writeFile(deep, `import "@dtmd/flume/dist/harness/index.js";\n`);
  const reached = await runNodeStreams(consumerDir, [deep]);
  expect(reached.code).not.toBe(0);
  expect(reached.stderr).toContain("ERR_PACKAGE_PATH_NOT_EXPORTED");
}, SPAWN_BUDGET_MS);

/**
 * `flume --version` reads flume's own manifest, and the hop to it differs
 * per layout: a checkout runs `src/cli.ts` one directory below the manifest,
 * the published tarball runs `dist/src/cli.js` two below. Both arms run the
 * real entry; the unit arms below them pin the resolver's own refusal, which
 * no `--version` run can reach.
 */
it("the cli resolves its own package.json under both the checkout and the published layout", async () => {
  const checkout = await runCli(REPO_ROOT, ["--version"]);
  expect(checkout.code).toBe(0);
  expect(checkout.out.trim()).toBe(manifest.version);

  const published = await runNodeStreams(
    pkgDir,
    [join(pkgDir, "dist", "src", "cli.js"), "--version"],
    hermeticEnv(),
  );
  expect(published.code).toBe(0);
  expect(published.stdout.trim()).toBe(manifest.version);

  // Both hops off a tree built for the purpose, so the resolver is judged on
  // the layouts it declares rather than on whichever one this checkout is.
  const layouts = join(scratch, "layouts");
  await mkdir(join(layouts, "checkout", "src"), { recursive: true });
  await mkdir(join(layouts, "published", "dist", "src"), { recursive: true });
  await writeFile(join(layouts, "checkout", "package.json"), "{}");
  await writeFile(join(layouts, "published", "package.json"), "{}");

  expect(resolvePackageJson(join(layouts, "checkout", "src"))).toBe(
    join(layouts, "checkout", "package.json"),
  );
  expect(resolvePackageJson(join(layouts, "published", "dist", "src"))).toBe(
    join(layouts, "published", "package.json"),
  );

  // Neither hop resolving is loud, never a placeholder version.
  const barren = join(layouts, "barren", "a", "b");
  await mkdir(barren, { recursive: true });
  expect(() => resolvePackageJson(barren)).toThrow(/no package.json at any of/);
}, SPAWN_BUDGET_MS);

/**
 * The layout is one decision with five dependents — the manifest's `main`,
 * `types` and every `exports` leaf, and the `dist/…` path each bin shim
 * computes — and nothing but this holds them together. The emit is the
 * authority: paths are checked against what tsc just wrote, never against a
 * spelling restated here.
 */
it("every shipped entry path resolves inside the layout the build tsconfig emits", async () => {
  expect(emitted.length).toBeGreaterThan(0);

  const entryPaths = entryPathsOf(manifest);
  expect(entryPaths.length).toBeGreaterThan(0);

  const emitRoot = join(pkgDir, "dist");
  for (const entry of entryPaths) {
    const absolute = resolve(pkgDir, entry);
    expect(
      { entry, insideEmit: absolute.startsWith(emitRoot + sep), exists: existsSync(absolute) },
    ).toEqual({ entry, insideEmit: true, exists: true });
  }

  // The bin shims name their target in their own bytes rather than reading
  // the manifest, so the only way to ask where they land is to run them: a
  // shim left on the old layout exits non-zero at module resolution.
  const shim = await runNodeStreams(pkgDir, [join(pkgDir, "bin", "flume.js"), "--version"], hermeticEnv());
  expect(shim.code).toBe(0);
  expect(shim.stdout.trim()).toBe(manifest.version);

  // bin/flume is POSIX sh; the Windows lane has no interpreter for it, and
  // npm's generated .cmd/.ps1 shims wrap bin/flume.js there anyway.
  if (process.platform !== "win32") {
    const { stdout } = await exec(join(pkgDir, "bin", "flume"), ["--version"], {
      cwd: pkgDir,
      env: hermeticEnv(),
    });
    expect(stdout.trim()).toBe(manifest.version);
  }
}, SPAWN_BUDGET_MS);

/**
 * The emitted half of `spec/harness.md`'s *Where it lives*: `harness/prompts.ts`
 * addresses each prompt by a `prompts/` hop beside its own module, which is
 * only true in the emit if the build put the files there — and `tsc` emits no
 * markdown.
 *
 * Both sides are real. The writer is `scripts/pack-harness-assets.mjs`, the
 * same file `pnpm build` runs, over the same emit. The reader is the emitted
 * `promptPath()` itself, reached through Node's `exports` resolver in a
 * consumer that knows only the package name — so the case judges the
 * addresses a published install computes, rather than a spelling of the emit
 * layout by the tester's hand. Nothing here lists the prompts: the set comes
 * off `PROMPT_NAMES`, which is derived from the phase list the package
 * constructs.
 */
it("the build emits every prompt the package addresses beside dist/harness", async () => {
  expect({ code: packAssets.code, stderr: packAssets.stderr }).toEqual({ code: 0, stderr: "" });

  // Non-vacuity: an empty address set would make every assertion below pass
  // over nothing at all.
  expect(PROMPT_NAMES.length).toBeGreaterThan(0);

  const probe = join(consumerDir, "prompts.mjs");
  await writeFile(
    probe,
    `import { readFileSync, existsSync } from "node:fs";\n` +
      `import { PROMPT_NAMES, promptPath } from "@dtmd/flume/harness";\n` +
      `process.stdout.write(JSON.stringify(PROMPT_NAMES.map((name) => {\n` +
      `  const address = promptPath(name);\n` +
      `  return { name, address, body: existsSync(address) ? readFileSync(address, "utf8") : null };\n` +
      `})));\n`,
  );

  const resolved = await runNodeStreams(consumerDir, [probe]);
  expect(resolved.stderr).toBe("");
  expect(resolved.code).toBe(0);

  const addressed = JSON.parse(resolved.stdout) as {
    name: string;
    address: string;
    body: string | null;
  }[];
  // The emit's own notion of which prompts exist, against the checkout's:
  // a phase whose prompt the build failed to carry over shows up here as a
  // name the emit addresses and cannot read.
  expect(addressed.map((p) => p.name).sort()).toEqual([...PROMPT_NAMES].sort());

  const emitRoot = join(pkgDir, "dist");
  for (const { name, address, body } of addressed) {
    const source = await readFile(promptPath(name as (typeof PROMPT_NAMES)[number]), "utf8");
    expect({
      name,
      besideTheEmit: address.startsWith(join(emitRoot, "harness") + sep),
      body,
    }).toEqual({ name, besideTheEmit: true, body: source });
  }

  // And the other direction: the emitted directory holds no prompt the
  // package stopped addressing, which a copy that merges instead of
  // replacing would leave behind on a rename.
  const emittedPrompts = await readdir(join(emitRoot, "harness", "prompts"));
  expect(emittedPrompts.sort()).toEqual(PROMPT_NAMES.map((name) => `${name}.md`).sort());

  // This file ran the copy step directly, so one thing is still unjudged:
  // that `pnpm build` reaches it at all. A `build` script that dropped the
  // step would otherwise leave every assertion above green over an emit no
  // release ever produces.
  expect(manifest.scripts?.build ?? "").toContain(PACK_ASSETS_REL);
}, SPAWN_BUDGET_MS);

/**
 * The other half of the same emit hop: `flume-harness init` addresses the
 * protocol page it writes by a `templates/` hop beside its own module
 * (`harness/init.ts`), so an emit without it is an adoption verb that fails
 * at a consumer's first `flume-harness init` — after the state root exists.
 *
 * Read through the published surface rather than off the scratch tree: the
 * reader is the emitted `protocolTemplatePath()` reached through Node's
 * `exports` resolver, and the case compares the bytes it resolves against
 * the checkout's template, so a copy step that reached the wrong directory
 * or shipped stale bytes reds here.
 */
it("the build emits the PROTOCOL template flume-harness init writes from", async () => {
  expect({ code: packAssets.code, stderr: packAssets.stderr }).toEqual({ code: 0, stderr: "" });

  const probe = join(consumerDir, "template.mjs");
  await writeFile(
    probe,
    `import { readFileSync, existsSync } from "node:fs";\n` +
      `import { protocolTemplatePath } from "@dtmd/flume/harness";\n` +
      `const address = protocolTemplatePath();\n` +
      `process.stdout.write(JSON.stringify({ address, body: existsSync(address) ? readFileSync(address, "utf8") : null }));\n`,
  );

  const resolved = await runNodeStreams(consumerDir, [probe]);
  expect(resolved.stderr).toBe("");
  expect(resolved.code).toBe(0);

  const addressed = JSON.parse(resolved.stdout) as { address: string; body: string | null };
  const source = await readFile(protocolTemplatePath(), "utf8");

  // Non-vacuity: the checkout's template has bytes to agree with, so the
  // equality below cannot pass over two empty reads.
  expect(source.length).toBeGreaterThan(0);
  expect({
    besideTheEmit: addressed.address.startsWith(join(pkgDir, "dist", "harness") + sep),
    body: addressed.body,
  }).toEqual({ besideTheEmit: true, body: source });
}, SPAWN_BUDGET_MS);

/**
 * `bin.flume-harness` end to end over the published layout: the shim spawns
 * `dist/harness/cli.js`, the verb resolves its template beside the emitted
 * module, and a repository that had nothing comes out adopted
 * (`spec/harness.md`, *Adoption and upgrade*).
 *
 * The one case that runs the bin rather than reading it. Every part is the
 * shipped one — npm would link this same file, and the emit under it is the
 * build's — so a shim aimed at the wrong entry, an emit missing the template,
 * or a verb that resolves package content from a cwd all red here instead of
 * at a consumer's first adoption.
 */
it("the flume-harness bin adopts an empty repository against the published emit", async () => {
  const adopt = join(scratch, "adopt");
  await mkdir(adopt, { recursive: true });

  const run = await runNodeStreams(
    adopt,
    [join(pkgDir, "bin", "flume-harness.js"), "init"],
    hermeticEnv(),
  );
  expect({ code: run.code, stderr: run.stderr }).toEqual({ code: 0, stderr: "" });

  // The artifacts *Adoption and upgrade* names, read off disk rather than
  // off what the verb printed.
  const stateRoot = join(adopt, ".flume");
  expect(existsSync(stateRoot)).toBe(true);
  const declaration = await readFile(join(stateRoot, "declaration.ts"), "utf8");
  expect(declaration).toContain('"@dtmd/flume/harness"');
  const chain = await readFile(join(stateRoot, "chain.ts"), "utf8");
  expect(chain).toContain("harnessChain({ api, declaration })");
  expect(await readFile(join(stateRoot, "PROTOCOL.md"), "utf8")).toBe(
    (await readFile(protocolTemplatePath(), "utf8")).split("{{STATE_ROOT}}").join(".flume"),
  );
  const ignores = (await readFile(join(adopt, ".gitignore"), "utf8")).split(/\r?\n/);
  expect(ignores).toEqual(expect.arrayContaining(consumerIgnores(".flume")));
}, SPAWN_BUDGET_MS);

/**
 * `files` decides what leaves the tarball, and the harness assets — the
 * prompts and the `harness/templates/PROTOCOL.md` template — are the part of
 * the emit that is not a `tsc` output. A `files` list narrowed to the
 * compiled shapes, or a
 * copy step aimed outside `dist`, would publish a harness whose every asset
 * address is dead.
 *
 * The asset set is read off the emit by what it is *not* — a compiled
 * output — rather than by a list of directory names here, so an asset
 * directory added to the package is covered by this case without it being
 * touched (`.claude/rules/engineering.md`, *Derived state is computed*).
 *
 * npm's own packer is the reader: its ignore semantics (the `files`
 * allowlist, the always-excluded set, the negations) are not something a
 * prefix check by hand reproduces, and a hand-rolled one would agree with
 * itself rather than with the tool that builds the tarball.
 */
it("the package's files allowlist covers the emitted harness assets", async () => {
  const COMPILED = /\.(js|d\.ts|js\.map|d\.ts\.map)$/;
  const emittedAssets = emitted.filter(
    (p) => p.startsWith(["dist", "harness"].join("/") + "/") && !COMPILED.test(p),
  );
  // Non-vacuity: with no emitted assets the containment below holds for
  // free, and the allowlist would go unjudged. Every prompt, plus at least
  // the template `flume-harness init` writes from.
  expect(emittedAssets.length).toBeGreaterThan(PROMPT_NAMES.length);
  expect(Array.isArray(manifest.files) && manifest.files.length > 0).toBe(true);

  // `--ignore-scripts`: `prepack` is `pnpm build`, which would rebuild into
  // the repo's own `dist/` and race a parallel suite. win32 needs a shell to
  // invoke `npm.cmd`; the args are fixed and carry nothing user-supplied.
  const { stdout } = await exec("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: pkgDir,
    env: hermeticEnv(),
    shell: process.platform === "win32",
    maxBuffer: 16 << 20,
  });
  const [packed] = JSON.parse(stdout) as { files: { path: string }[] }[];
  const tarball = new Set((packed?.files ?? []).map((f) => f.path));
  expect(tarball.size).toBeGreaterThan(0);

  for (const asset of emittedAssets) {
    expect({ asset, packed: tarball.has(asset) }).toEqual({ asset, packed: true });
  }
}, SPAWN_BUDGET_MS);

/**
 * The install floors a consumer reads before running any of the above. Both
 * are packaging policy (`spec/chain.md`, *The package a chain loads
 * through*), and the README states them where the install command is — the
 * one place a reader is looking when the answer still matters.
 *
 * The node half is an agreement gate (`.claude/rules/engineering.md`, *A
 * seam gate reads what the real writer wrote*): the real writer is the
 * manifest npm enforces `engines` from, the reader is the README's own
 * sentence, so a bumped floor that stops at the manifest reds here rather
 * than sending a consumer at an unsupported runtime.
 */
it("the README prerequisite line names the node floor package.json engines declares", async () => {
  // Non-vacuity, both sides: an undeclared floor or a missing paragraph
  // would leave the containment below asserting a substring of nothing.
  const declared = manifest.engines?.node ?? "";
  const major = /(\d+)/.exec(declared)?.[1];
  expect({ declared, major }).toEqual({ declared, major: expect.any(String) });

  const claim = await prerequisiteClaim();
  expect(claim).toContain(PREREQUISITE_LABEL);
  expect(claim).toContain(`Node ${major}`);
});

/**
 * The git half has no manifest to agree with — npm's `engines` speaks only
 * of runtimes — so the floor is named on both sides rather than derived.
 * `worktree list --porcelain -z` is the 2.36 feature
 * (`src/worktrees.ts`, `readWorktreeRegistry`); below it, worktree
 * reclamation degrades loudly and nothing else does, which is a thing to
 * learn before installing rather than at the first stranded worktree.
 */
it("the README prerequisite line names the git floor", async () => {
  const claim = await prerequisiteClaim();
  expect(claim).toContain(PREREQUISITE_LABEL);
  expect(claim).toMatch(/\bgit 2\.36\b/i);
});

/**
 * The install floor's neighbour claim: what a reader is told to *run* first.
 * Adoption is a verb on the package's own bin (`spec/harness.md`, *Adoption
 * and upgrade*), and a Quickstart that opens on a hand-written `chain.ts`
 * sends every new consumer down the engine-level path with the package they
 * just installed unmentioned.
 *
 * An agreement gate, and the reason the verb is not spelled here: the real
 * writer is the shipped `bin/flume-harness.js` over the build's own emit, the
 * reader is the Quickstart's adoption passage, so a verb renamed or added in
 * `harness/cli.ts` reds this rather than leaving the README naming a command
 * the bin no longer dispatches. That the listed verb is one the bin really
 * runs is carried end to end by the adoption case above; what is pinned here
 * is that the block is the dispatcher's set rather than decorative prose.
 *
 * The reader stops at the section's first `###` for the same reason the
 * neighbouring list does: the Quickstart runs on into an engine-level
 * subsection that is explicitly not the harness path, so a verb named only
 * down there is a verb the adoption paragraph never hands anyone.
 */
it("the README adoption passage names every verb the flume-harness bin dispatches", async () => {
  const bin = join(pkgDir, "bin", "flume-harness.js");
  const help = await runNodeStreams(pkgDir, [bin, "--help"], hermeticEnv());
  expect({ code: help.code, stderr: help.stderr }).toEqual({ code: 0, stderr: "" });

  // Non-vacuity: a Commands block that parsed to nothing would leave every
  // containment below iterating an empty set.
  const verbs = listedVerbs(help.stdout);
  expect(verbs.length).toBeGreaterThan(0);

  const outside = "adopt-everything";
  expect(verbs).not.toContain(outside);
  const refused = await runNodeStreams(scratch, [bin, outside], hermeticEnv());
  expect(refused.code).not.toBe(0);
  expect(refused.stderr).toContain(`unknown command \`${outside}\``);

  const quickstart = await quickstartSection();
  expect(quickstart).toContain(QUICKSTART_HEADING);
  const adoption = leadPassage(quickstart);
  expect(adoption).toContain(QUICKSTART_HEADING);

  // The handle's own detection, before the verdict: a verb named only under
  // the engine-level subsection is one the adoption passage does not hand a
  // reader, and a handle that ran to the end of the section would count it.
  const demoted =
    `${QUICKSTART_HEADING}\n\nAdopting the harness is one command.\n\n` +
    `### The engine-level path: a chain you write\n\n\`flume-harness ${outside}\`\n`;
  expect(sectionOf(demoted, QUICKSTART_HEADING)).toContain(`flume-harness ${outside}`);
  expect(leadPassage(sectionOf(demoted, QUICKSTART_HEADING))).not.toContain(
    `flume-harness ${outside}`,
  );

  for (const verb of verbs) {
    expect({ verb, named: adoption.includes(`flume-harness ${verb}`) }).toEqual({
      verb,
      named: true,
    });
  }

  // And it *leads*: the first command the passage hands a reader is the
  // adoption verb, not the engine-level install under it.
  const opener = firstShellBlock(adoption);
  expect(opener.trim().length).toBeGreaterThan(0);
  expect(verbs.some((verb) => opener.includes(`flume-harness ${verb}`))).toBe(true);
}, SPAWN_BUDGET_MS);

/**
 * The enumerable half of that same paragraph. The Quickstart names the verb
 * above and then lists what running it leaves in the repository — a landing
 * page a consumer reads before they have anything to compare it against, and
 * the list they will look for on disk once the verb has run.
 *
 * An agreement gate (`.claude/rules/engineering.md`, *A seam gate reads what
 * the real writer wrote*): the writer is `harnessInit` over a real empty
 * repository, and the set is the `written` list it reports — the same fact a
 * consumer commits their adoption from (`tests/harnessInit.test.ts`,
 * *flume-harness init seeds an empty queue in the state root*). A file added
 * to the write set, or renamed in it, reds here rather than leaving the front
 * door listing a file init no longer writes. The default state root is the
 * one under test because it is the root the README's paths are spelled in.
 *
 * One direction only, and deliberately: what the page should *say* about each
 * file — which are the consumer's to edit, which are not — is the human's,
 * and the clauses beside the list (the ignore lines, the manifest line, the
 * second-`init` refusal) are prose no writer enumerates. What is pinned is
 * that every file init writes is named at all.
 */
it("the README adoption section names every file flume-harness init writes", async () => {
  const adopt = join(scratch, "readme-adoption");
  await mkdir(adopt, { recursive: true });
  const { written } = await harnessInit({ repoRoot: adopt });

  // Non-vacuity, both sides: an init reporting nothing, or a list that parsed
  // to nothing, would leave the loop below judging an empty set.
  expect(written.length).toBeGreaterThan(0);
  const quickstart = await quickstartSection();
  expect(quickstart).toContain(QUICKSTART_HEADING);
  const adoption = listUnderFirstBlock(quickstart);
  expect(adoption.split("\n").filter((line) => line.startsWith("- ")).length).toBeGreaterThan(0);

  // The scan's own detection, before the verdict: a path this adoption did
  // not write is one the list does not name, so a matcher that answered
  // `true` for everything cannot pass for agreement.
  const outside = `${written[0]}.backup`;
  expect(written).not.toContain(outside);
  expect(namesPath(adoption, outside)).toBe(false);

  for (const path of written) {
    expect({ path, named: namesPath(adoption, path) }).toEqual({ path, named: true });
  }
});

/**
 * The per-verb contract page, against the bin it describes. The README sends
 * a reader to `docs/CLI.md` for "full per-verb contracts — steps, refusals,
 * exit codes", and that page is written for `flume`'s verb set; the harness
 * package ships a second bin (`spec/harness.md`, *Adoption and upgrade*)
 * whose verbs are contract surface the same way.
 *
 * An agreement gate, and the reason no verb is spelled here: the real writer
 * is the shipped `bin/flume-harness.js` over the build's own emit, the reader
 * is the doc page, so a verb added in `harness/cli.ts` reds this rather than
 * shipping undocumented. The exit codes are measured off the same bin —
 * the success code of a run that mutates nothing and the code of the usage
 * refusal every verb's argv passes through — so a section that names codes
 * of the tester's own invention cannot pass for a contract.
 */
it("docs/CLI.md names every verb the flume-harness bin dispatches", async () => {
  const bin = join(pkgDir, "bin", "flume-harness.js");
  const help = await runNodeStreams(pkgDir, [bin, "--help"], hermeticEnv());
  expect({ code: help.code, stderr: help.stderr }).toEqual({ code: 0, stderr: "" });

  // Non-vacuity: a Commands block that parsed to nothing would leave the
  // loop below iterating an empty set and the page unjudged.
  const verbs = listedVerbs(help.stdout);
  expect(verbs.length).toBeGreaterThan(0);

  // The usage class, measured rather than spelled: this is the code any
  // verb's argv refusal exits with, and what each section has to state.
  const refused = await runNodeStreams(scratch, [bin, "adopt-everything"], hermeticEnv());
  expect(refused.code).toBeGreaterThan(0);

  const page = await readFile(join(REPO_ROOT, "docs", "CLI.md"), "utf8");
  for (const verb of verbs) {
    const section = sectionOf(page, harnessVerbHeading(verb));
    expect({ verb, sectioned: section !== "" }).toEqual({ verb, sectioned: true });
    expect({
      verb,
      names: {
        success: section.includes(`\`${help.code}\``),
        usageRefusal: section.includes(`\`${refused.code}\``),
      },
    }).toEqual({ verb, names: { success: true, usageRefusal: true } });
  }
}, SPAWN_BUDGET_MS);

/**
 * The other direction, across every page a consumer reads: a command named
 * in code voice is a command someone will run, and one the bin does not
 * dispatch sends them to a usage refusal with the page still reading as
 * current. Renaming a verb in `harness/cli.ts` reds here, naming the page.
 *
 * The scan's own detection is proven before the verdict: a no-hits pass over
 * every page is what a matcher that silently stopped matching produces, and
 * it is indistinguishable from agreement.
 */
it("no README or docs page names a flume-harness verb the bin does not dispatch", async () => {
  const bin = join(pkgDir, "bin", "flume-harness.js");
  const help = await runNodeStreams(pkgDir, [bin, "--help"], hermeticEnv());
  expect({ code: help.code, stderr: help.stderr }).toEqual({ code: 0, stderr: "" });
  const verbs = listedVerbs(help.stdout);
  expect(verbs.length).toBeGreaterThan(0);

  // The scanner, over a page that names a verb in both voices it reads.
  const outside = "adopt-everything";
  expect(verbs).not.toContain(outside);
  expect(
    harnessVerbTokens(
      `\`\`\`sh\nnpx --package @dtmd/flume flume-harness ${outside}\n\`\`\`\n\n` +
        `and \`flume-harness ${outside}\` inline, and \`flume-harness --help\` which is not a verb.\n`,
    ),
  ).toEqual([outside, outside]);

  // And that the bin really refuses one, so the verdict below is about a
  // command line that would fail rather than about a string.
  const refused = await runNodeStreams(scratch, [bin, outside], hermeticEnv());
  expect(refused.code).not.toBe(0);
  expect(refused.stderr).toContain(`unknown command \`${outside}\``);

  const pages = await consumerDocPages();
  expect(pages.length).toBeGreaterThan(0);
  const named = pages.flatMap(({ page, body }) =>
    harnessVerbTokens(body).map((verb) => ({ page, verb })),
  );
  // Non-vacuity: with nothing named anywhere, agreement holds for free.
  expect(named.length).toBeGreaterThan(0);

  for (const { page, verb } of named) {
    expect({ page, verb, dispatched: verbs.includes(verb) }).toEqual({
      page,
      verb,
      dispatched: true,
    });
  }
}, SPAWN_BUDGET_MS);

/**
 * The upgrade half of adoption (`spec/harness.md`, *Adoption and upgrade*):
 * one version bump plus the release's migration note. The note is only half
 * of that if a consumer can find it, and the pages a consumer arrives on are
 * the two roots above — a note written for a cut and linked from neither
 * ships unreachable, which is the state this case was written over.
 *
 * Not a claim about what a link says: the scan resolves each destination
 * against the working tree, the token rather than its meaning, so the
 * verdict is that a file on disk has an inbound edge from a root. Which root
 * carries a given note is free — the changelog links the notes it cut, the
 * README carries the current line — because either is a place a reader is
 * already standing.
 *
 * The scanner's own detection is proven before the verdict: a no-hits pass
 * over both roots is what a matcher that stopped matching produces, and it
 * is indistinguishable from a page that links nothing.
 */
it("every docs/MIGRATING page is linked from README.md or CHANGELOG.md", async () => {
  // The scanner, over a body naming a page in each voice it has to tell
  // apart: an anchored link, a reference definition, an off-tree URL, and a
  // bare code-voice mention, which is not an edge.
  expect(
    markdownLinkTargets(
      "see [`docs/MIGRATING-9.9.md`](docs/MIGRATING-9.9.md#section-3) and\n" +
        "[home](https://example.test/x), while `docs/MIGRATING-9.7.md` is only named.\n\n" +
        "[ref]: docs/MIGRATING-9.8.md\n",
    ),
  ).toEqual(["docs/MIGRATING-9.9.md", "https://example.test/x", "docs/MIGRATING-9.8.md"]);

  const notes = (await filesUnder(join(REPO_ROOT, "docs"), "docs")).filter((p) =>
    /^docs\/MIGRATING-[^/]+\.md$/.test(p),
  );
  // Non-vacuity: with no note on the tree the loop below judges nothing.
  expect(notes.length).toBeGreaterThan(0);

  const linked = new Set<string>();
  for (const root of DOC_ROOTS) {
    const body = await readFile(join(REPO_ROOT, root), "utf8");
    for (const target of markdownLinkTargets(body)) {
      linked.add(resolve(REPO_ROOT, dirname(root), target));
    }
  }
  expect(linked.size).toBeGreaterThan(0);

  for (const note of notes) {
    expect({ note, linked: linked.has(resolve(REPO_ROOT, ...note.split("/"))) }).toEqual({
      note,
      linked: true,
    });
  }
});
