/**
 * v0.8 §7 — second reference chain smoke test.
 *
 * Drives `examples/backlog-groomer-chain.ts` through one full tick cycle on
 * the unpatched engine: fixture repo, real chain + real prompt file (loaded
 * unmodified — no rewritten fixture chain source, unlike the job.*.test.ts
 * stub-chain pattern), `Dispatcher` wired in-process via the documented
 * `chainLoader` test-injection seam (`src/Dispatcher.ts` `DispatcherOptions
 * .chainLoader`). The chain's own `groom.agent` is deterministic (no LLM),
 * which is what makes this runnable in CI at all — see the chain file's
 * header for why that's in-scope for a reference example, not a test-only
 * shortcut.
 *
 * Asserts the acceptance in spec/RELEASE-v0.8.md §7: the example completes
 * a tick cycle against a fixture repo with zero `src/` changes attributable
 * to it.
 */

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import type { Agent } from "../src/Agent.ts";
import type { GateContext } from "../src/Gate.ts";
import type { Chain } from "../src/Phase.ts";
import { Baton } from "../src/Baton.ts";
import { Dispatcher } from "../src/Dispatcher.ts";
import { buildFlumeApi } from "../src/flumeApi.ts";
import backlogGroomerFactory from "../examples/backlog-groomer-chain.ts";
import cascadeFactory from "../examples/cascade-chain.ts";
import minimalFactory from "../examples/minimal-chain.ts";

const exec = promisify(execFile);

// v0.11 §6: examples default-export a factory, so the chains under test are
// built the same way a real tick builds them — through the real API object,
// not a hand-assembled stand-in.
const { chain: backlogGroomerChain } = backlogGroomerFactory(buildFlumeApi());
const { chain: cascadeChain } = cascadeFactory(buildFlumeApi());
const { chain: minimalChain } = minimalFactory(buildFlumeApi());

/**
 * `examples/`, resolved from this test file's own URL — `configDir` for the
 * dispatcher below, so `Phase.promptPath` ("prompts/backlog-groomer.md")
 * resolves to the real, committed prompt file rather than a copy.
 */
const EXAMPLES_DIR = fileURLToPath(new URL("../examples", import.meta.url));

/** Scratch git repo on `main` with one seed commit. */
async function makeRepo(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "flume-examples-"));
  const opts = { cwd: dir };
  await exec("git", ["init", "-q", "-b", "main"], opts);
  await exec("git", ["config", "user.email", "test@example.com"], opts);
  await exec("git", ["config", "user.name", "Test User"], opts);
  await exec("git", ["config", "commit.gpgsign", "false"], opts);
  await writeFile(join(dir, "README.md"), "seed\n");
  await exec("git", ["add", "."], opts);
  await exec("git", ["commit", "-q", "-m", "seed"], opts);
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/**
 * `phase.agent` (the chain's deterministic groomer) must win the resolution
 * order (`phase.agent ?? chainModule.agent ?? DispatcherOptions.agent`) —
 * this stands in for the dispatcher default and throws if it's ever reached,
 * so a resolution regression fails loudly instead of silently invoking a
 * real `claude` binary.
 */
const neverAgent: Agent = {
  name: "never",
  async invoke() {
    throw new Error(
      "DispatcherOptions.agent invoked; Phase.agent should have taken precedence",
    );
  },
};

describe("v0.8 §7 — second reference chain (backlog-groomer-chain.ts)", () => {
  it(
    "completes one tick cycle: skips a capability-gated item, ships the top open one, commits, hibernates",
    async () => {
      const repo = await makeRepo();
      try {
        const backlog = [
          {
            tag: "rotate-secrets",
            gate: { kind: "requiresCapability", capability: "ops-access" },
            dependsOnForks: [],
            files: {},
            reason: "needs ops access this chain does not assert",
          },
          {
            tag: "trim-notes-intro",
            gate: { kind: "open" },
            dependsOnForks: [],
            files: {},
            reason: "intro paragraph restates the title",
          },
        ];
        await writeFile(
          join(repo.dir, "BACKLOG.json"),
          `${JSON.stringify(backlog, null, 2)}\n`,
        );
        await exec("git", ["add", "BACKLOG.json"], { cwd: repo.dir });
        await exec("git", ["commit", "-q", "-m", "seed backlog"], {
          cwd: repo.dir,
        });
        const preHead = (
          await exec("git", ["rev-parse", "HEAD"], { cwd: repo.dir })
        ).stdout.trim();

        const flumeDir = join(repo.dir, ".flume");
        new Baton(flumeDir).wake("groom");

        const dispatcher = new Dispatcher({
          repoRoot: repo.dir,
          configDir: EXAMPLES_DIR,
          flumeDir,
          agent: neverAgent,
          chainLoader: async () => ({ chain: backlogGroomerChain }),
        });

        const outcome = await dispatcher.tick();

        expect(outcome.hibernated).toBe(false);
        expect(outcome.failed).toBeUndefined();
        expect(outcome.result?.committed).toBe(true);
        // Vacuity pin (engineering.md "A green verdict is proven
        // non-vacuous"): prove the gate set judged below isn't empty before
        // trusting its every(ok) verdict.
        expect(outcome.result?.gateResults.length).toBeGreaterThan(0);
        expect(outcome.result?.gateResults.every((g) => g.ok)).toBe(true);
        // handoff() => [] and nothing re-woke `groom`: the system hibernates
        // after this one tick — no plan/build split, single phase.
        expect(outcome.awakeAfter).toEqual([]);

        const shipped = await readFile(join(repo.dir, "SHIPPED.md"), "utf8");
        expect(shipped).toContain("trim-notes-intro");
        expect(shipped).not.toContain("rotate-secrets");

        const remaining = JSON.parse(
          await readFile(join(repo.dir, "BACKLOG.json"), "utf8"),
        );
        expect(remaining).toHaveLength(1);
        expect(remaining[0].tag).toBe("rotate-secrets");

        const log = await exec("git", ["log", "-1", "--pretty=%s"], {
          cwd: repo.dir,
        });
        expect(log.stdout.trim()).toBe("groom: ship trim-notes-intro");

        // §7 acceptance: zero src/ changes attributable to this example.
        const diff = await exec(
          "git",
          ["diff", "--name-only", preHead, "HEAD"],
          { cwd: repo.dir },
        );
        const touched = diff.stdout.split("\n").filter(Boolean);
        expect(touched.sort()).toEqual(["BACKLOG.json", "SHIPPED.md"]);
        expect(touched.some((p) => p.startsWith("src/"))).toBe(false);
      } finally {
        await repo.cleanup();
      }
    },
    30_000,
  );

  it("leaves the backlog untouched and reports no commit when nothing is pickable", async () => {
    const repo = await makeRepo();
    try {
      const backlog = [
        {
          tag: "rotate-secrets",
          gate: { kind: "requiresCapability", capability: "ops-access" },
          dependsOnForks: [],
          files: {},
          reason: "needs ops access this chain does not assert",
        },
      ];
      const backlogContent = `${JSON.stringify(backlog, null, 2)}\n`;
      await writeFile(join(repo.dir, "BACKLOG.json"), backlogContent);
      await exec("git", ["add", "BACKLOG.json"], { cwd: repo.dir });
      await exec("git", ["commit", "-q", "-m", "seed backlog"], {
        cwd: repo.dir,
      });

      const flumeDir = join(repo.dir, ".flume");
      new Baton(flumeDir).wake("groom");

      const dispatcher = new Dispatcher({
        repoRoot: repo.dir,
        configDir: EXAMPLES_DIR,
        flumeDir,
        agent: neverAgent,
        chainLoader: async () => ({ chain: backlogGroomerChain }),
      });

      const outcome = await dispatcher.tick();

      expect(outcome.result?.committed).toBe(false);
      expect(outcome.noCommit).toBe("voluntary-bail");

      // The title's claim ("leaves the backlog untouched") asserted
      // directly: byte-identical BACKLOG.json, no SHIPPED.md written.
      const remaining = await readFile(
        join(repo.dir, "BACKLOG.json"),
        "utf8",
      );
      expect(remaining).toBe(backlogContent);
      await expect(
        readFile(join(repo.dir, "SHIPPED.md"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await repo.cleanup();
    }
  }, 30_000);

  it("surfaces a non-ENOENT BACKLOG.json read failure instead of reporting 'nothing to groom'", async () => {
    const repo = await makeRepo();
    try {
      // BACKLOG_PATH exists as a directory: readFileSync fails with EISDIR,
      // a real I/O failure distinct from "file absent" (ENOENT). Pre-fix,
      // the bare catch swallowed this as a clean "nothing to groom" bail
      // (engineering.md "Loud or nothing").
      await mkdir(join(repo.dir, "BACKLOG.json"));

      const flumeDir = join(repo.dir, ".flume");
      new Baton(flumeDir).wake("groom");

      const dispatcher = new Dispatcher({
        repoRoot: repo.dir,
        configDir: EXAMPLES_DIR,
        flumeDir,
        agent: neverAgent,
        chainLoader: async () => ({ chain: backlogGroomerChain }),
      });

      const outcome = await dispatcher.tick();

      expect(outcome.result?.committed).toBe(false);
      // Pre-fix: EISDIR swallowed, agent exits clean with nothing done —
      // classified "voluntary-bail". Post-fix: the read error propagates out
      // of the agent, classified "platform-preempt" — a non-work failure,
      // not a deliberate no-op.
      expect(outcome.noCommit).toBe("platform-preempt");
    } finally {
      await repo.cleanup();
    }
  }, 30_000);

  it("backlogParseGate rejects a non-ENOENT BACKLOG.json read failure instead of reporting it absent", async () => {
    // The gate runs `afterCommit` (Dispatcher.ts) and the agent test above
    // never reaches it: groomAgent.invoke throws on the same EISDIR before
    // any commit lands, so dispatcher.tick() bails pre-gate. Only a direct
    // gate.run() call exercises the gate's own catch site
    // (BACKLOG-GROOMER-GATE-ENOENT-UNTESTED).
    const backlogParseGate = backlogGroomerChain.phases[0]!.gates[0]!;
    const repo = await makeRepo();
    try {
      await mkdir(join(repo.dir, "BACKLOG.json"));

      const ctx: GateContext = {
        cwd: repo.dir,
        flumeDir: join(repo.dir, ".flume"),
        repoRoot: repo.dir,
        phaseName: "groom",
        log: () => {},
      };

      // Pre-fix: the bare catch swallowed EISDIR as ENOENT and resolved
      // `{ ok: true, message: "BACKLOG.json absent ..." }`. Post-fix: the
      // read error propagates out of the gate.
      await expect(backlogParseGate.run(ctx)).rejects.toMatchObject({
        code: "EISDIR",
      });
    } finally {
      await repo.cleanup();
    }
  }, 30_000);
});

/**
 * `flume job run` wakes `phases[0]` unconditionally on a cold job (v0.5
 * decision 6, `src/job.ts` `jobRun`) — it has no notion of `humanOnly` at
 * that call site. A chain whose entry phase is also in its own `humanOnly`
 * list declares a job that can never cold-start on its own machinery; a
 * human has to intervene on tick one, every time. Every chain under
 * `examples/` is a "read this to learn the shape" artifact (v0.1 §7 /
 * v0.8 §7), so this pins the entry-phase/humanOnly relationship across all
 * of them, not just cascade.
 */
describe("example chains — entry phase is machine-wakeable", () => {
  const chains: Array<{ name: string; chain: Chain }> = [
    { name: "cascade-chain.ts", chain: cascadeChain },
    { name: "backlog-groomer-chain.ts", chain: backlogGroomerChain },
    { name: "minimal-chain.ts", chain: minimalChain },
  ];

  it.each(chains)(
    "$name: phases[0] is absent from its own humanOnly list",
    ({ chain }) => {
      const entryPhase = chain.phases[0];
      expect(entryPhase).toBeDefined();
      expect(chain.humanOnly).not.toContain(entryPhase!.name);
    },
  );
});

/**
 * v0.8 §6 / engineering.md "The fix lands at the mechanism" — the flagship
 * example hand-rolled a "does pending.json parse" gate that
 * `docs/CHAIN-AUTHORING.md` itself documents as predating the `pendingGate`
 * builtin. Pins the swap: plan's gate list carries `pendingGate`'s identity
 * (`"pending-gate"`), not the hand-rolled gate's name.
 */
describe("cascade-chain.ts — plan phase gates through the pendingGate builtin", () => {
  it("plan.gates contains a gate named 'pending-gate'", () => {
    const planPhase = cascadeChain.phases.find((p) => p.name === "plan");
    expect(planPhase).toBeDefined();
    expect(planPhase!.gates.map((g) => g.name)).toContain("pending-gate");
  });
});
