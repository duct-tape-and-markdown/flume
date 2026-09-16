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
import { chmod, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { declaration } from "../.flume/declaration.ts";
import {
  SPAWN_BUDGET_MS,
  mkFixtureRoot,
  runCli,
} from "./helpers/subprocess.ts";

// This file starts processes, so it declares the lane's one budget — cases
// and hooks alike — once here rather than inheriting the runner's default
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

const exec = promisify(execFile);

const BIN_DIR = fileURLToPath(new URL("../bin", import.meta.url));
const BIN_FLUME = join(BIN_DIR, "flume");

// Stands in for the real build output: records argv and cwd as JSON so the
// test can assert bin/flume resolved *this* file (relative to the real
// script's directory, not the symlink's) with argv/cwd intact.
const FAKE_CLI_JS = `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }));
`;

describe.runIf(process.platform !== "win32")("bin/flume symlink walk", () => {
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

    // The whole `bin/` rather than the one shim: the shims import their
    // shared spawn helper (bin/execEntry.js) by a relative specifier, so a
    // package carrying only one file fails at module resolution instead of
    // on the property each case is about.
    await cp(BIN_DIR, join(pkgDir, "bin"), { recursive: true });
    const shim = join(pkgDir, "bin", "flume.js");
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
  }, SPAWN_BUDGET_MS);

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
  }, SPAWN_BUDGET_MS);

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
  }, SPAWN_BUDGET_MS);

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
  }, SPAWN_BUDGET_MS);

  it("bin/flume.js propagates the child's non-zero exit status", async () => {
    const shim = await makePackage(`process.exit(42);\n`);

    const result = runShim(shim, ["status"]);

    expect(result.status).toBe(42);
    expect(result.signal).toBeNull();
  }, SPAWN_BUDGET_MS);

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
    SPAWN_BUDGET_MS,
  );
});

/**
 * `package.json`'s `bin` map names two entries — the engine's `flume` and the
 * harness package's `flume-harness` (`spec/cli.md`, *Distribution*;
 * `spec/harness.md`, *Adoption and upgrade*) — and npm generates a working
 * shim per platform for each only because each is a Node script carrying the
 * env-node shebang. A `bin` entry pointing at a file without one installs
 * cleanly and fails at the consumer's first invocation, on every platform
 * whose shell reads the first line.
 *
 * Read off the map rather than from a list here, so a third entry added
 * without its shebang is caught by the same case
 * (`.claude/rules/engineering.md`, *Derived state is computed*).
 */
it("the flume-harness bin is a Node script whose first line is the env-node shebang", async () => {
  const manifest = JSON.parse(
    await readFile(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
  ) as { bin?: Record<string, string> };
  const bins = manifest.bin ?? {};

  // Non-vacuity, and the claim this case is named for: the harness bin is in
  // the map at all, beside the engine's.
  expect(Object.keys(bins).sort()).toContain("flume-harness");
  expect(Object.keys(bins).sort()).toContain("flume");

  const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
  for (const [name, entry] of Object.entries(bins)) {
    const source = await readFile(join(REPO_ROOT, entry), "utf8");
    expect({ name, first: source.split(/\r?\n/)[0] }).toEqual({
      name,
      first: "#!/usr/bin/env node",
    });
  }
});

/**
 * The chain-load verb, read off `scripts/smoke-install.mjs` rather than
 * restated beside it (`.claude/rules/engineering.md`, *Derived state is
 * computed, never restated beside its source*).
 */
async function declaredChainLoadVerb(): Promise<string> {
  const scriptPath = fileURLToPath(new URL("../scripts/smoke-install.mjs", import.meta.url));
  const source = await readFile(scriptPath, "utf8");

  const declared = /^const CHAIN_LOAD_VERB = "([a-z][a-z-]*)";$/m.exec(source);
  // Non-vacuity, twice over: the verb was really read off the script, and the
  // script really hands that constant to the shim rather than an inlined
  // copy these cases would then be judging nothing about.
  expect(
    declared?.[1],
    `${scriptPath} must name the verb its chain-load step drives the shim ` +
      `through, as \`const CHAIN_LOAD_VERB = "<verb>";\` — these cases read it ` +
      `from there rather than restating it`,
  ).toBeTypeOf("string");
  expect(source).toContain("[CHAIN_LOAD_VERB]");
  return declared![1]!;
}

/**
 * `scripts/smoke-install.mjs` scaffolds a `.flume/chain.ts` under its scratch
 * consumer and drives the installed shim at it — the only exercise anywhere
 * of "the installed CLI finds a consumer's chain where the consumer wrote
 * it", and the only thing making the script's `.flume` path literal loud.
 * That step is a check only while the verb it runs exits non-zero on a chain
 * it cannot load; under a best-effort observational verb it answers 0 whether
 * the fixture landed where the CLI looks or not
 * (`.claude/rules/engineering.md`, "A green verdict is proven non-vacuous").
 *
 * The smoke is not a vitest suite and costs a full pack+install, so the
 * property is held here instead — as an agreement case, not a restatement:
 * the verb is read out of the script that actually runs it and driven
 * through the real CLI over a chainless bay. A verb swapped in the script for
 * one that tolerates a failed load reds this, on the script's own word.
 */
it("the install smoke's chain-load fixture is verified by a CLI verb that exits non-zero when the chain is absent", async () => {
  const verb = await declaredChainLoadVerb();

  // A bay with no chain.ts — the shape the smoke's step exists to rule out.
  const dir = await mkFixtureRoot("flume-smoke-verb-");
  try {
    const r = await runCli(dir, [verb]);

    expect(r.out).toContain("chain failed to load");
    expect(r.code).not.toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, SPAWN_BUDGET_MS);

/**
 * ci.yml's "Consumer-install smoke" used to re-spell the script's steps
 * inline as a shell heredoc, and the two sides drifted exactly as a second
 * spelling does: the POSIX copy fell behind on the chain-load verb and never
 * carried the shim `--version` or `exports`-subpath steps at all, while
 * passing under the same name as the Windows lane's real one.
 *
 * The step is now the script, so the drift has nowhere to live — and this
 * case is what holds it there. It reads the step's body out of the workflow
 * and refuses anything but a single invocation of `scripts/smoke-install.mjs`
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*): a
 * re-inlined `npm pack`, a second chain heredoc, or a stray `npx flume <verb>`
 * is a command this case does not allow. It also holds the handoff the
 * collapse created — the `--scratch` root the smoke is given is the one the
 * type-resolution gate reads its consumer dir and tarball out of.
 */
it("the CI consumer-install smoke runs scripts/smoke-install.mjs rather than re-spelling its steps", async () => {
  const workflowPath = fileURLToPath(new URL("../.github/workflows/ci.yml", import.meta.url));
  const lines = (await readFile(workflowPath, "utf8")).split(/\r?\n/);

  /** The lines a named step owns: its own, up to the next sibling list item. */
  const stepBody = (name: string): string[] => {
    const start = lines.findIndex((l) => l.trimEnd() === `      - name: ${name}`);
    expect(
      start,
      `${workflowPath} must carry a step named "${name}" — this case reads ` +
        `what that step runs`,
    ).toBeGreaterThanOrEqual(0);
    const after = lines.findIndex((l, i) => i > start && /^      - /.test(l));
    return lines
      .slice(start + 1, after === -1 ? lines.length : after)
      .filter((l) => l.trim() !== "" && !/^\s*#/.test(l));
  };

  const smoke = stepBody("Consumer-install smoke");

  // Non-vacuity: the step runs something at all, so the equality below is
  // judging a command rather than an empty body.
  expect(smoke.length).toBeGreaterThan(0);

  // One command, and it is the shared script. A `run: |` block would land
  // here as many lines; an inlined `npm pack` or chain heredoc as lines that
  // are not this one.
  expect(smoke).toHaveLength(1);
  const invocation = /^\s*run: node (scripts\/smoke-install\.mjs)(?: (.*))?$/.exec(smoke[0]!);
  expect(
    invocation,
    `the "Consumer-install smoke" step must be a single ` +
      `\`run: node scripts/smoke-install.mjs …\` — found: ${smoke.join(" / ")}`,
  ).not.toBeNull();

  // The script it names is really there, so the step is not green over a
  // path that no longer resolves.
  await expect(
    readFile(fileURLToPath(new URL(`../${invocation![1]!}`, import.meta.url)), "utf8"),
  ).resolves.toContain("CHAIN_LOAD_VERB");

  // The scratch root the smoke is handed is the one the next step reads its
  // consumer dir and tarball out of — the handoff collapsing the step
  // created, and the one thing a rename would break silently.
  const scratch = /--scratch "([^"]+)"/.exec(invocation![2] ?? "");
  expect(
    scratch?.[1],
    `the smoke step must name the scratch root it keeps, as ` +
      `\`--scratch "<dir>"\`, for the type-resolution gate to read`,
  ).toBeTypeOf("string");

  const gate = stepBody("Consumer type-resolution gate");
  expect(gate.some((l) => l.includes(scratch![1]!))).toBe(true);
});

/**
 * `spec/cli.md`, *win32 is a supported host*, makes the support commitment
 * conditional on the Windows lane being read — and the condition is a fact
 * about a committed file that nothing above prose held. A workflow that
 * stopped firing on push to `main`, or a lane that quietly lost a step, would
 * source no findings while the section still read as current.
 *
 * Which job *is* the lane is `.flume/declaration.ts`'s to say, not this
 * file's: that entry is what the inbox slice polls (`spec/harness.md`, *CI
 * lanes as a findings source*), so a job renamed on one side only reds here
 * rather than sourcing silence. The step set resolves through `package.json`'s
 * scripts for the same reason — the manifest owns each command's spelling.
 */

const CI_WORKFLOW = fileURLToPath(new URL("../.github/workflows/ci.yml", import.meta.url));

/** A workflow with comments and blank lines dropped — every reader below is indentation-structural. */
async function workflowLines(path: string): Promise<string[]> {
  return (await readFile(path, "utf8"))
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "" && !/^\s*#/.test(l));
}

const indentOf = (line: string): number => line.search(/\S/);

/** The lines strictly inside the block `key:` opens at `indent`; undefined when there is no such key. */
function yamlBlock(lines: string[], key: string, indent: number): string[] | undefined {
  const start = lines.findIndex(
    (l) => indentOf(l) === indent && l.trimStart().startsWith(`${key}:`),
  );
  if (start === -1) return undefined;
  const out: string[] = [];
  for (let i = start + 1; i < lines.length && indentOf(lines[i]!) > indent; i++) out.push(lines[i]!);
  return out;
}

/** The scalar `key:` carries at `indent`; undefined when there is no such key. */
function yamlScalar(lines: string[], key: string, indent: number): string | undefined {
  const line = lines.find((l) => indentOf(l) === indent && l.trimStart().startsWith(`${key}:`));
  return line === undefined ? undefined : line.trimStart().slice(key.length + 1).trim();
}

const unquote = (s: string): string => s.trim().replace(/^["']|["']$/g, "");

/** The sequence `key:` carries at `indent`, in flow (`[a, b]`) or block (`- a`) form. */
function yamlSeq(lines: string[], key: string, indent: number): string[] | undefined {
  const inline = yamlScalar(lines, key, indent);
  if (inline === undefined) return undefined;
  const flow = /^\[(.*)\]$/.exec(inline);
  if (flow) return flow[1]!.split(",").map(unquote).filter((s) => s !== "");
  if (inline !== "") return undefined; // a scalar, not a sequence
  return (yamlBlock(lines, key, indent) ?? [])
    .filter((l) => l.trimStart().startsWith("- "))
    .map((l) => unquote(l.trimStart().slice(2)));
}

/** Every shell command a job's steps run, block scalars expanded line-wise. */
function runCommands(job: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < job.length; i++) {
    const run = /^\s*(?:- )?run:\s*(.*)$/.exec(job[i]!);
    if (!run) continue;
    const value = run[1]!.trim();
    if (!/^[|>][-+]?$/.test(value)) {
      out.push(value);
      continue;
    }
    const indent = indentOf(job[i]!);
    for (let j = i + 1; j < job.length && indentOf(job[j]!) > indent; j++) out.push(job[j]!.trim());
  }
  return out;
}

it("the CI workflow runs on every push to main", async () => {
  const lines = await workflowLines(CI_WORKFLOW);

  const triggers = yamlBlock(lines, "on", 0);
  expect(triggers, `${CI_WORKFLOW} must declare its triggers under \`on:\``).toBeDefined();

  const push = yamlBlock(triggers!, "push", 2);
  expect(
    push,
    `${CI_WORKFLOW} must carry a \`push:\` trigger — a loop committing straight ` +
      `to \`main\` has no merge gate to hang the lane off, so the push run is ` +
      `the only thing that sources findings`,
  ).toBeDefined();

  const branches = yamlSeq(push!, "branches", 4);
  expect(
    branches,
    `the \`push:\` trigger must name the branches it fires on as a sequence`,
  ).toBeDefined();

  // Non-vacuity: a branch filter that named nothing would fire on nothing,
  // and an empty list satisfies no membership claim worth making.
  expect(branches!.length).toBeGreaterThan(0);
  expect(branches).toContain("main");
});

it("the windows-latest lane runs typecheck, the default test lane, build and the install smoke", async () => {
  const lines = await workflowLines(CI_WORKFLOW);

  const lane = declaration.ci?.find((l) => l.workflow === basename(CI_WORKFLOW));
  expect(
    lane,
    `.flume/declaration.ts must declare the CI lane it reads findings from on ` +
      `${basename(CI_WORKFLOW)} — this case reads what that lane runs`,
  ).toBeDefined();

  const jobs = yamlBlock(lines, "jobs", 0);
  expect(jobs, `${CI_WORKFLOW} must declare \`jobs:\``).toBeDefined();

  const job = yamlBlock(jobs!, lane!.job, 2);
  expect(
    job,
    `the declared lane names job \`${lane!.job}\`, which ${CI_WORKFLOW} does not ` +
      `define — the inbox slice would poll a job that never runs`,
  ).toBeDefined();

  expect(yamlScalar(job!, "runs-on", 4)).toBe("windows-latest");

  const commands = runCommands(job!);

  // Non-vacuity: the lane runs something at all, so the membership checks
  // below are judging a step set rather than an empty job.
  expect(commands.length).toBeGreaterThan(0);

  const manifest = fileURLToPath(new URL("../package.json", import.meta.url));
  const scripts: Record<string, string> =
    JSON.parse(await readFile(manifest, "utf8")).scripts ?? {};

  /** Each step `spec/cli.md` names, keyed by the package script that owns its spelling. */
  const steps = [
    { step: "typecheck", script: "typecheck" },
    { step: "the default test lane", script: "test" },
    { step: "build", script: "build" },
    { step: "the install smoke", script: "smoke:install" },
  ];

  for (const { step, script } of steps) {
    const body = scripts[script];
    expect(body, `package.json must carry a \`${script}\` script`).toBeTypeOf("string");

    // Either spelling of the script invocation, or the script's own body run
    // inline — resolved against the manifest rather than a second copy of the
    // command text here.
    const runs = commands.some(
      (c) => c === `pnpm ${script}` || c === `pnpm run ${script}` || c === `pnpm ${body}`,
    );
    expect(
      runs,
      `the \`${lane!.job}\` lane must run ${step} (\`pnpm ${script}\`) — found: ` +
        commands.join(" / "),
    ).toBe(true);
  }
});

/**
 * `spec/cli.md`, *Versioning policy*: the push of a `v*` tag publishes. The
 * cut's irreversible step is a workflow no typecheck and no suite would
 * otherwise read, and its two failure modes are silent in opposite
 * directions — a trigger that matches no tag publishes nothing while the
 * policy still reads as current, and a smoke step drifting from the flag the
 * script parses reds a cut on its own plumbing. Both cases below are
 * indentation-structural readers over the committed yaml, and the second is
 * an agreement case: the flag is read out of the workflow and resolved
 * against what `scripts/smoke-install.mjs` actually parses.
 */

const RELEASE_WORKFLOW = fileURLToPath(new URL("../.github/workflows/release.yml", import.meta.url));

it("the release workflow publishes on a v-prefixed tag push under the repository's NPM_TOKEN", async () => {
  const lines = await workflowLines(RELEASE_WORKFLOW);

  const triggers = yamlBlock(lines, "on", 0);
  expect(triggers, `${RELEASE_WORKFLOW} must declare its triggers under \`on:\``).toBeDefined();

  const push = yamlBlock(triggers!, "push", 2);
  expect(
    push,
    `${RELEASE_WORKFLOW} must fire on \`push:\` — the tag push is what publishes`,
  ).toBeDefined();

  const tags = yamlSeq(push!, "tags", 4);
  expect(
    tags,
    `the \`push:\` trigger must name the tag patterns it fires on as a sequence — ` +
      `a push trigger with no \`tags:\` filter fires on branches instead, and ` +
      `would publish off every commit`,
  ).toBeDefined();

  // Non-vacuity: a pattern list that named nothing would match no tag, and
  // the membership claim below would hold over an empty filter.
  expect(tags!.length).toBeGreaterThan(0);
  expect(tags!.some((t) => t.startsWith("v"))).toBe(true);

  const commands = runCommands(lines);
  expect(commands.length).toBeGreaterThan(0);

  const publishes = commands.filter((c) => /^npm publish\b/.test(c));
  expect(
    publishes,
    `${RELEASE_WORKFLOW} must publish with \`npm publish\` — pnpm ignores the ` +
      `env-var auth form and falls through to ~/.npmrc — found: ${commands.join(" / ")}`,
  ).toHaveLength(1);

  // The credential is the repository secret the policy names, read from the
  // workflow rather than assumed: a publish step wired to some other secret
  // authenticates as something nobody rotated.
  expect(lines.some((l) => l.includes("secrets.NPM_TOKEN"))).toBe(true);
});

it("the release lane's registry smoke runs scripts/smoke-install.mjs through flags the script parses", async () => {
  const commands = runCommands(await workflowLines(RELEASE_WORKFLOW));

  const smoke = commands.filter((c) => c.includes("scripts/smoke-install.mjs"));
  expect(
    smoke,
    `${RELEASE_WORKFLOW} must run the shared install smoke — the registry leg ` +
      `is that script pointed at what was published, not a second spelling of it`,
  ).toHaveLength(1);

  const source = await readFile(
    fileURLToPath(new URL("../scripts/smoke-install.mjs", import.meta.url)),
    "utf8",
  );
  const parsed = new Set([...source.matchAll(/flagValue\("(--[a-z-]+)"\)/g)].map((m) => m[1]!));

  // Non-vacuity on both sides: the script parses flags at all, and the step
  // passes some — otherwise the agreement below holds over two empty sets.
  expect(parsed.size).toBeGreaterThan(0);
  const passed = [...smoke[0]!.matchAll(/(--[a-z-]+)/g)].map((m) => m[1]!);
  expect(passed.length).toBeGreaterThan(0);

  for (const flag of passed) {
    expect(
      parsed.has(flag),
      `the release smoke passes \`${flag}\`, which scripts/smoke-install.mjs does ` +
        `not parse — it would be ignored and the step would pass against the ` +
        `default pack target instead of the registry`,
    ).toBe(true);
  }

  // The registry target specifically: a run that lost the flag silently
  // re-smokes a pack of the checked-out tree, which proves nothing about
  // what the tag published.
  expect(passed).toContain("--from-registry");
});
