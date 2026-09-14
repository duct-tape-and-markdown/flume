/**
 * The two bin entries spec/cli.md, "Distribution" declares: the published
 * `bin.flume` (bin/flume.js, second describe) and the POSIX shell script kept
 * for direct callers (bin/flume, first describe).
 *
 * spec/cli.md, "Distribution" — bin/flume "walks its own symlink chain
 * before computing the package dir". That walk was added by c336ead to fix
 * a real bug (dirname($0) resolved the *symlink's* directory, not the real
 * script's, so the computed dist/src/cli.js path pointed at a nonexistent
 * node_modules/dist/src/cli.js) but has carried zero coverage since — the only
 * install-shaped exercise, scripts/smoke-install.mjs, drives npm's generated
 * shim, which wraps bin/flume.js (the Node counterpart) per package.json's
 * `bin` field, never bin/flume itself.
 *
 * Both cases here exec bin/flume through a real symlink (or chain of them),
 * matching npm's (single-hop) and pnpm's (multi-hop, through .pnpm/<hash>/)
 * install shapes. A fake dist/src/cli.js records argv and cwd; if the walk
 * regresses to the pre-c336ead dirname-only computation, the resolved path
 * points at a nonexistent file and the exec itself fails (ENOENT) before
 * either assertion runs.
 */

import { execFile, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const exec = promisify(execFile);

const BIN_FLUME = fileURLToPath(new URL("../bin/flume", import.meta.url));
const BIN_FLUME_JS = fileURLToPath(new URL("../bin/flume.js", import.meta.url));

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
    await mkdir(join(pkgDir, "dist", "src"), { recursive: true });

    const realBin = await readFile(BIN_FLUME);
    const binPath = join(pkgDir, "bin", "flume");
    await writeFile(binPath, realBin);
    await chmod(binPath, 0o755);

    const cliPath = join(pkgDir, "dist", "src", "cli.js");
    await writeFile(cliPath, FAKE_CLI_JS);
    await chmod(cliPath, 0o755);

    return pkgDir;
  }

  it("resolves through a single-hop symlink (npm-style) to the real script and execs dist/src/cli.js relative to it", async () => {
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

  it("resolves through a multi-hop symlink chain (pnpm .pnpm/<hash>/-style) to the real script and execs dist/src/cli.js relative to it", async () => {
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

/**
 * bin/flume.js is `bin.flume` in package.json — the only entry a consumer
 * invokes, since npm's generated shims (including the Windows `.cmd`/`.ps1`)
 * wrap it. scripts/smoke-install.mjs drives it off a full pack+install but
 * asserts exit 0 on success paths only, so most of what spec/cli.md,
 * "Distribution" declares of it had no check at all. The cases below hold
 * that list whole: argv preserved, the exit code or terminating signal
 * propagated, stdio inherited on all three fds, and no environment opinion.
 *
 * Each case lays the real shim into a package-shaped temp dir beside a fake
 * dist/src/cli.js that does exactly the one thing the case is about, and spawns
 * the shim as node would.
 */
describe("bin/flume.js — the published bin.flume entry", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "flume-bin-node-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /**
   * The real shim's bytes at `<pkg>/bin/flume.js`, with `cli` as the body of
   * the `<pkg>/dist/src/cli.js` it resolves. The package.json is the published
   * package's `"type": "module"`, without which node reads the shim's ESM
   * imports as CJS and the case fails on syntax rather than on its property.
   * Returns the shim path.
   */
  async function makePackage(cli: string): Promise<string> {
    const pkgDir = join(root, "pkg");
    await mkdir(join(pkgDir, "bin"), { recursive: true });
    await mkdir(join(pkgDir, "dist", "src"), { recursive: true });
    await writeFile(join(pkgDir, "package.json"), JSON.stringify({ type: "module" }));

    const shim = join(pkgDir, "bin", "flume.js");
    await writeFile(shim, await readFile(BIN_FLUME_JS));
    await chmod(shim, 0o755);
    await writeFile(join(pkgDir, "dist", "src", "cli.js"), cli);

    return shim;
  }

  // As npm's shims invoke it: node.exe on the script, argv after it. The
  // shim's own stdio defaults to pipes, so what `stdio: "inherit"` hands the
  // grandchild lands back here per-fd — which is what the stdio cases read.
  const runShim = (
    shim: string,
    args: string[],
    opts: { input?: string; env?: NodeJS.ProcessEnv } = {},
  ) => spawnSync(process.execPath, [shim, ...args], { encoding: "utf8", ...opts });

  it("bin/flume.js execs dist/src/cli.js with argv preserved", async () => {
    // Identifies itself, so a shim that resolved some *other* file (or
    // failed to resolve one and exited non-zero) cannot pass this.
    const shim = await makePackage(
      `process.stdout.write(JSON.stringify({ entry: "dist/src/cli.js", argv: process.argv.slice(2) }));\n`,
    );

    // Flags, a subcommand, and a `--` passthrough: anything the shim parsed
    // or re-quoted instead of forwarding shows up here.
    const argv = ["tick", "--phase", "build", "--", "-x", "a b"];
    const result = runShim(shim, argv);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ entry: "dist/src/cli.js", argv });
  });

  /**
   * Distinct markers per fd, and a non-zero exit — the path where a chatty
   * shim would be most tempted to add a diagnostic of its own. Exact
   * equality on both streams is the whole assertion: a shim that merged the
   * two fds, buffered and re-emitted them, or prefixed either one fails.
   * `process.exitCode` rather than `process.exit()` so the writes flush —
   * exiting outright can truncate a pipe write mid-flight.
   */
  it("bin/flume.js passes the child's stdout and stderr through unmixed and adds no bytes of its own", async () => {
    const shim = await makePackage(
      `process.stdout.write("OUT:dist/src/cli.js");\nprocess.stderr.write("ERR:dist/src/cli.js");\nprocess.exitCode = 3;\n`,
    );

    const result = runShim(shim, ["status"]);

    // The child ran and ran to completion, so the stream assertions below
    // are judging something.
    expect(result.status).toBe(3);
    expect(result.stdout).toBe("OUT:dist/src/cli.js");
    expect(result.stderr).toBe("ERR:dist/src/cli.js");
  });

  /**
   * `stdio: "inherit"` gives fd 0 to the child too: the shim never reads it,
   * so everything spawnSync writes into the pipe is the child's to consume.
   * Multi-line and with a trailing newline, since a shim that round-tripped
   * stdin through a line reader would drop or normalize those.
   */
  it("bin/flume.js passes stdin through to the child", async () => {
    const shim = await makePackage(
      `import { readFileSync } from "node:fs";\nprocess.stdout.write(JSON.stringify({ stdin: readFileSync(0, "utf8") }));\n`,
    );

    const input = "first line\nsecond line\n";
    const result = runShim(shim, ["tick"], { input });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ stdin: input });
  });

  /**
   * The shim passes no `env` to spawnSync, so the child's environment is the
   * shim's verbatim. Deep equality against the exact env handed in catches
   * both directions — a var injected (a NODE_OPTIONS, a FLUME_* default) and
   * one rewritten on the way through.
   */
  it("bin/flume.js adds nothing to the child's environment", async () => {
    const shim = await makePackage(`process.stdout.write(JSON.stringify(process.env));\n`);

    // Built off the real env so node.exe still finds what it needs on the
    // Windows lane; the sentinel proves the environment reached the child at
    // all, so the equality below is not being judged over an empty set.
    const env = { ...process.env, FLUME_BIN_SENTINEL: "sentinel-value" };
    const result = runShim(shim, ["status"], { env });

    expect(result.status).toBe(0);
    const childEnv = JSON.parse(result.stdout) as NodeJS.ProcessEnv;
    expect(childEnv["FLUME_BIN_SENTINEL"]).toBe("sentinel-value");
    expect(childEnv).toEqual(env);
  });

  it("bin/flume.js propagates the child's non-zero exit status", async () => {
    const shim = await makePackage(`process.exit(42);\n`);

    const result = runShim(shim, ["status"]);

    expect(result.status).toBe(42);
    expect(result.signal).toBeNull();
  });

  /**
   * win32 has no signal delivery: a child that self-kills with SIGTERM there
   * yields a status, so there is no signal for the shim to re-raise and the
   * property is POSIX's alone. Declared skip, not a silent pass — the two
   * cases above still run on the Windows lane.
   */
  it.skipIf(process.platform === "win32")(
    "bin/flume.js re-raises the child's terminating signal",
    async () => {
      // The timer keeps the child alive past the kill, so a shim that
      // mistook a clean exit for a signal cannot pass by accident.
      const shim = await makePackage(
        `process.kill(process.pid, "SIGTERM");\nsetTimeout(() => {}, 10_000);\n`,
      );

      const result = runShim(shim, ["loop"]);

      expect(result.signal).toBe("SIGTERM");
      expect(result.status).toBeNull();
    },
  );
});
