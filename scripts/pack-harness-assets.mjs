#!/usr/bin/env node
/**
 * scripts/pack-harness-assets.mjs — copy the harness package's non-TypeScript
 * content beside the emitted `dist/harness/` (`spec/harness.md`, *Where it
 * lives*).
 *
 * `tsc` emits only modules, so without this step the emit carries
 * `dist/harness/prompts.js` and `dist/harness/init.js` with nothing beside
 * them, and every address those modules resolve in a published install points
 * at a file that is not there. The copy is the second half of the build, not
 * a packaging afterthought.
 *
 * **The asset set is derived, never listed here.** Everything under
 * `harness/` is either a module `tsc` emits or a directory of package content
 * it does not, so the set copied is simply every directory beside the
 * modules: `prompts/` today, `templates/` beside it, and whatever a later
 * change adds without this file being touched
 * (`.claude/rules/engineering.md`, *Derived state is computed, never restated
 * beside its source*).
 *
 * **One home, two callers.** `pnpm build` runs it after `tsc`, and
 * `tests/harnessPackaging.test.ts` runs this same file over the scratch emit
 * it builds — so the emitted assets the suite judges are written by the
 * writer that writes the published ones, rather than by a copy of its logic
 * in the test (`.claude/rules/engineering.md`, *A seam gate reads what the
 * real writer wrote*).
 *
 * Usage: `node scripts/pack-harness-assets.mjs [outDir]`, where `outDir` is
 * the directory `tsc` emitted into. Omitted, it is read from
 * `tsconfig.build.json`'s own `outDir` rather than spelled here, so the two
 * cannot drift.
 */

import { existsSync } from "node:fs";
import { cp, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const BUILD_TSCONFIG = join(REPO_ROOT, "tsconfig.build.json");

/** The harness package's source directory, in the checkout. */
const SOURCE = join(REPO_ROOT, "harness");

/**
 * The hop the emit's modules address their assets by: the same directory
 * name beside the module, which is what makes one address correct in both
 * layouts.
 */
const EMIT_HOP = "harness";

/**
 * `tsconfig.build.json`'s `outDir`, resolved against the repo root.
 *
 * JSONC in principle; this file is plain JSON apart from the line comments
 * the repo writes in it, so the comment strip below is the whole of the
 * parse. A shape it cannot read is a refusal, never a guessed default.
 */
async function configuredOutDir() {
  const raw = await readFile(BUILD_TSCONFIG, "utf8");
  const stripped = raw.replace(/^\s*\/\/.*$/gm, "");
  let parsed;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    throw new Error(
      `pack-harness-assets: cannot parse ${BUILD_TSCONFIG} to find the ` +
        `build's outDir: ${String(err)}`,
    );
  }
  const outDir = parsed?.compilerOptions?.outDir;
  if (typeof outDir !== "string" || outDir === "") {
    throw new Error(
      `pack-harness-assets: ${BUILD_TSCONFIG} declares no ` +
        `compilerOptions.outDir, so there is no emit to copy the harness ` +
        `assets beside. Pass the emit directory as an argument, or restore ` +
        `the field.`,
    );
  }
  return resolve(REPO_ROOT, outDir);
}

async function main() {
  const [argOutDir] = process.argv.slice(2);
  const outDir = argOutDir ? resolve(argOutDir) : await configuredOutDir();

  // Refuse rather than copy into a tree tsc never wrote: assets beside no
  // emitted module is a half-built package that only fails at a consumer's
  // import (`.claude/rules/engineering.md`, *Loud or nothing*).
  const emittedHarness = join(outDir, EMIT_HOP);
  if (!existsSync(emittedHarness)) {
    throw new Error(
      `pack-harness-assets: no emitted harness at ${emittedHarness} — run ` +
        `\`tsc -p tsconfig.build.json\` before the copy step, or pass the ` +
        `directory that build emitted into.`,
    );
  }

  const assetDirs = (await readdir(SOURCE, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (assetDirs.length === 0) {
    throw new Error(
      `pack-harness-assets: ${SOURCE} holds no asset directory to copy. The ` +
        `package addresses its prompts and templates beside its own modules ` +
        `(harness/prompts.ts, harness/init.ts), so an emit without them is a ` +
        `package whose every asset address is dead.`,
    );
  }

  for (const name of assetDirs) {
    const destination = join(emittedHarness, name);
    // Each destination is build output entire, so it is replaced rather than
    // merged: a file renamed in the source would otherwise leave its old name
    // behind in an incremental emit, shipped and addressed by nothing.
    await rm(destination, { recursive: true, force: true });
    await cp(join(SOURCE, name), destination, { recursive: true });
  }

  console.log(
    `[pack-harness-assets] ${assetDirs.join(", ")} -> ${emittedHarness}`,
  );
}

main().catch((err) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
