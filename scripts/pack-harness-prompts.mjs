#!/usr/bin/env node
/**
 * scripts/pack-harness-prompts.mjs — copy the harness package's prompts
 * beside the emitted `dist/harness/` (`spec/harness.md`, *Where it lives*).
 *
 * `tsc` emits no markdown, so without this step the emit carries
 * `dist/harness/prompts.js` with nothing beside it and every address
 * `promptPath()` resolves in a published install points at a file that is
 * not there. The copy is the second half of the build, not a packaging
 * afterthought.
 *
 * **One home, two callers.** `pnpm build` runs it after `tsc`, and
 * `tests/harnessPackaging.test.ts` runs this same file over the scratch emit
 * it builds — so the emitted prompts the suite judges are written by the
 * writer that writes the published ones, rather than by a copy of its logic
 * in the test (`.claude/rules/engineering.md`, *A seam gate reads what the
 * real writer wrote*).
 *
 * Usage: `node scripts/pack-harness-prompts.mjs [outDir]`, where `outDir` is
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

/** The prompts the package ships, in the checkout. */
const SOURCE = join(REPO_ROOT, "harness", "prompts");

/**
 * The emit's prompt directory, as `harness/prompts.ts` addresses it: the
 * same `prompts/` hop beside the emitted module, which is what makes one
 * `promptPath()` correct in both layouts.
 */
const EMIT_HOP = join("harness", "prompts");

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
      `pack-harness-prompts: cannot parse ${BUILD_TSCONFIG} to find the ` +
        `build's outDir: ${String(err)}`,
    );
  }
  const outDir = parsed?.compilerOptions?.outDir;
  if (typeof outDir !== "string" || outDir === "") {
    throw new Error(
      `pack-harness-prompts: ${BUILD_TSCONFIG} declares no ` +
        `compilerOptions.outDir, so there is no emit to copy the harness ` +
        `prompts beside. Pass the emit directory as an argument, or restore ` +
        `the field.`,
    );
  }
  return resolve(REPO_ROOT, outDir);
}

async function main() {
  const [argOutDir] = process.argv.slice(2);
  const outDir = argOutDir ? resolve(argOutDir) : await configuredOutDir();
  const destination = join(outDir, EMIT_HOP);

  // Refuse rather than copy into a tree tsc never wrote: prompts beside no
  // emitted module is a half-built package that only fails at a consumer's
  // import (`.claude/rules/engineering.md`, *Loud or nothing*).
  const emittedHarness = join(outDir, "harness");
  if (!existsSync(emittedHarness)) {
    throw new Error(
      `pack-harness-prompts: no emitted harness at ${emittedHarness} — run ` +
        `\`tsc -p tsconfig.build.json\` before the copy step, or pass the ` +
        `directory that build emitted into.`,
    );
  }

  const shipped = (await readdir(SOURCE)).filter((f) => f.endsWith(".md"));
  if (shipped.length === 0) {
    throw new Error(
      `pack-harness-prompts: ${SOURCE} holds no prompt to copy. The package ` +
        `addresses its prompts there (harness/prompts.ts), so an empty ` +
        `directory would emit a package whose every prompt address is dead.`,
    );
  }

  // The destination is build output entire, so it is replaced rather than
  // merged: a prompt renamed in the source would otherwise leave its old
  // name behind in an incremental emit, shipped and addressed by nothing.
  await rm(destination, { recursive: true, force: true });
  await cp(SOURCE, destination, { recursive: true });

  console.log(
    `[pack-harness-prompts] ${shipped.length} prompt(s) -> ${destination}`,
  );
}

main().catch((err) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
