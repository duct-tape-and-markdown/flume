/**
 * spec/cli.md, "Distribution" — bin/flume "walks its own symlink chain
 * before computing the package dir". That walk was added by c336ead to fix
 * a real bug (dirname($0) resolved the *symlink's* directory, not the real
 * script's, so the computed dist/cli.js path pointed at a nonexistent
 * node_modules/dist/cli.js) but has carried zero coverage since — the only
 * install-shaped exercise, scripts/smoke-install.mjs, drives npm's generated
 * shim, which wraps bin/flume.js (the Node counterpart) per package.json's
 * `bin` field, never bin/flume itself.
 *
 * Both cases here exec bin/flume through a real symlink (or chain of them),
 * matching npm's (single-hop) and pnpm's (multi-hop, through .pnpm/<hash>/)
 * install shapes. A fake dist/cli.js records argv and cwd; if the walk
 * regresses to the pre-c336ead dirname-only computation, the resolved path
 * points at a nonexistent file and the exec itself fails (ENOENT) before
 * either assertion runs.
 */

import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const exec = promisify(execFile);

const BIN_FLUME = fileURLToPath(new URL("../bin/flume", import.meta.url));

// Stands in for the real build output: records argv and cwd as JSON so the
// test can assert bin/flume resolved *this* file (relative to the real
// script's directory, not the symlink's) with argv/cwd intact.
const FAKE_CLI_JS = `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }));
`;

describe("bin/flume symlink walk", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "flume-bin-symlink-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function makePackage(): Promise<string> {
    const pkgDir = join(root, "pkg");
    await mkdir(join(pkgDir, "bin"), { recursive: true });
    await mkdir(join(pkgDir, "dist"), { recursive: true });

    const realBin = await readFile(BIN_FLUME);
    const binPath = join(pkgDir, "bin", "flume");
    await writeFile(binPath, realBin);
    await chmod(binPath, 0o755);

    const cliPath = join(pkgDir, "dist", "cli.js");
    await writeFile(cliPath, FAKE_CLI_JS);
    await chmod(cliPath, 0o755);

    return pkgDir;
  }

  it("resolves through a single-hop symlink (npm-style) to the real script and execs dist/cli.js relative to it", async () => {
    const pkgDir = await makePackage();

    // npm's real shape: node_modules/.bin/flume is a single relative
    // symlink straight into the installed package.
    const binDir = join(root, "consumer", "node_modules", ".bin");
    await mkdir(binDir, { recursive: true });
    const link = join(binDir, "flume");
    await symlink(relative(binDir, join(pkgDir, "bin", "flume")), link);

    const cwd = join(root, "consumer");
    const { stdout } = await exec(link, ["status", "--foo"], { cwd });

    expect(JSON.parse(stdout)).toEqual({ argv: ["status", "--foo"], cwd });
  });

  it("resolves through a multi-hop symlink chain (pnpm .pnpm/<hash>/-style) to the real script and execs dist/cli.js relative to it", async () => {
    const pkgDir = await makePackage();

    // pnpm's real shape chains two hops before the real script:
    // node_modules/.bin/flume -> node_modules/.pnpm/<hash>/node_modules/@dtmd/flume/bin/flume
    // (itself a symlink) -> the real script in the content-addressable store.
    const pnpmBinDir = join(
      root,
      "consumer",
      "node_modules",
      ".pnpm",
      "@dtmd+flume@0.0.0",
      "node_modules",
      "@dtmd",
      "flume",
      "bin",
    );
    await mkdir(pnpmBinDir, { recursive: true });
    const hop2 = join(pnpmBinDir, "flume");
    // Absolute target, exercising the walk's absolute-target branch.
    await symlink(join(pkgDir, "bin", "flume"), hop2);

    const binDir = join(root, "consumer", "node_modules", ".bin");
    await mkdir(binDir, { recursive: true });
    const hop1 = join(binDir, "flume");
    // Relative target, exercising the walk's relative-target branch.
    await symlink(relative(binDir, hop2), hop1);

    const cwd = join(root, "consumer");
    const { stdout } = await exec(hop1, ["tick"], { cwd });

    expect(JSON.parse(stdout)).toEqual({ argv: ["tick"], cwd });
  });
});
