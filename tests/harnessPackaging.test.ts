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
 * repo's own `dist/` so a parallel suite building there cannot race it.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterAll, beforeAll, expect, it } from "vitest";

import { resolvePackageJson } from "../src/cli.ts";
import { hermeticEnv, runCli, runNodeStreams } from "./helpers/subprocess.ts";

const exec = promisify(execFile);

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const TSC_BIN = fileURLToPath(
  new URL("../node_modules/typescript/bin/tsc", import.meta.url),
);

interface Manifest {
  readonly version: string;
  readonly main?: unknown;
  readonly types?: unknown;
  readonly exports?: unknown;
}

let scratch: string;
/** A package-shaped tree: the real manifest and bins over a real emit. */
let pkgDir: string;
/** A consumer that reaches `pkgDir` by the package name alone. */
let consumerDir: string;
let manifest: Manifest;
/** Every file the build emitted, as a path relative to `pkgDir`. */
let emitted: string[];

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
}, 180_000);

afterAll(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

/**
 * Node's own resolver over the real map, in a consumer that knows only the
 * package name — the only reader whose verdict matters, since tsc, vitest
 * and a relative import all resolve `harness/index.ts` without the map
 * existing at all. The deep-path arm holds `spec/chain.md`'s standing
 * acceptance: adding a subpath must not open the emit to arbitrary reach.
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
  // whole of it. Non-empty first: a map that resolved to an empty module
  // would otherwise pass the equality below by accident.
  const names = JSON.parse(resolved.stdout) as string[];
  expect(names.length).toBeGreaterThan(0);
  expect(names).toEqual(["resolveVitest", "vitestRunner"]);

  const deep = join(consumerDir, "deep.mjs");
  await writeFile(deep, `import "@dtmd/flume/dist/harness/index.js";\n`);
  const reached = await runNodeStreams(consumerDir, [deep]);
  expect(reached.code).not.toBe(0);
  expect(reached.stderr).toContain("ERR_PACKAGE_PATH_NOT_EXPORTED");
});

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
});

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
});
