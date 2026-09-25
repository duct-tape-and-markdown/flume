/**
 * Backlog groomer — the second reference chain: single-phase, no
 * plan/build split, no spec corpus. One phase reads `BACKLOG.json`, picks
 * the highest-priority pickable item, ships it, and commits — all in one
 * tick.
 *
 * Where `cascade-chain.ts` is the flagship spec→plan→build derivation
 * pipeline, this is the peer that proves the engine isn't shaped around
 * that pipeline. It has no fanout, no pending queue, no multi-phase
 * handoff — just one `Phase` — but it wires into the same PendingSchema
 * mechanics cascade uses, declared as its own small extension and its own
 * tag convention, applied to a completely different queue.
 *
 * The `groom` phase runs on a deterministic (non-LLM) agent: reading a
 * backlog, filtering by gate/capability, and picking the top pickable item
 * is exactly the kind of task that doesn't need a model in the loop. That
 * also keeps this example runnable end-to-end with zero external
 * dependencies — `pnpm exec flume tick` works with no API key, which is
 * what lets `tests/examples.integration.test.ts` drive it in CI on the
 * unpatched engine. The `Agent` interface doesn't care either way: swap
 * `claudeCode()` in for `groomAgent` below to hand grooming judgment to an
 * LLM instead — everything else on this phase, session capture included,
 * stays the same.
 *
 * Imports come from `../src/index.ts` — the same public surface a consumer
 * sees as `import type { ... } from "flume"`. Type-only: every engine value
 * this chain composes with arrives on the factory's `api`. See
 * cascade-chain.ts's trailing block for the host-repo swap; it applies here
 * unchanged.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { z } from "zod";
import type {
  Agent,
  Chain,
  ChainFactory,
  EntryExtension,
  Gate,
  PendingEntry,
  Phase,
} from "../src/index.ts";


const BACKLOG_PATH = "BACKLOG.json";
const SHIPPED_PATH = "SHIPPED.md";

/**
 * How much of a child's output either git call below may buffer, in bytes.
 *
 * Both are quiet and neither's output is read, so the number is not the
 * point — declaring one is. Node keeps 1 MiB per stream unless a call says
 * otherwise and reports an overrun as a killed child rather than a
 * truncation, so a chain that inherits the default has a spawn failure
 * waiting on whichever of its commands one day prints more than it used to
 * (`.claude/rules/platform-facts.md`, *Node caps a captured child stream at
 * 1 MiB, and reports the overrun as a spawn failure*). A chain of your own
 * picks its own number here; what it does not do is leave the choice
 * unstated.
 */
const GIT_OUTPUT_CAP_BYTES = 8 << 20;

// ---------- entry extension + tag refinement ----------

/**
 * This chain's pending-entry fields beyond the engine core
 * (tag/gate/dependsOnForks/files): one field, `reason` — a one-line "why
 * this ships next". Small on purpose, to contrast with cascade's five-field
 * extension: the engine composes either shape identically.
 *
 * "One line" is a bound the schema holds, not a convention the writer
 * remembers. `reason` is interpolated into `SHIPPED.md`'s ledger line
 * (`- <tag>: <reason>`), and `readShippedTags` reads that file back line by
 * line to decide which `blockedBy` items have unblocked. An embedded newline
 * would write a second line shaped exactly like a ledger entry — forging a
 * shipped tag nothing shipped, and unblocking a backlog item silently.
 * Refusing it at parse is the one place the writer and the reader cannot
 * disagree.
 *
 * `tag` is refined to a lowercase-kebab convention — the opposite of
 * cascade's ALL-CAPS grammar — proving the refinement is this chain's
 * choice, not the engine's: both compose against the same mechanical floor
 * (`TAG_PATTERN`, src/PendingSchema.ts) and neither can widen past it.
 */
const entryExtension = {
  reason: {
    schema: z
      .string()
      .min(1)
      .max(280)
      .regex(/^[^\r\n]*$/, "reason is one line: no line break"),
    hint: `"why this item ships next (one line, ≤280 chars)"`,
  },
  tag: {
    schema: z
      .string()
      .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, "backlog tags are lowercase-kebab"),
    hint: `"lowercase-kebab, e.g. \\"trim-readme-intro\\""`,
  },
} satisfies EntryExtension;


// ---------- chain factory ----------

/**
 * The default export is a factory the engine calls with its own API. The
 * schema helpers this chain uses arrive as parameters rather than through an
 * engine import, so the chain resolves no engine copy of its own.
 */
const factory: ChainFactory = (api) => {
  const {
    composePendingEntry,
    isPickableNow,
    namespacedJoin,
    renderSchemaForPrompt,
    withSessionCapture,
  } = api;

  // ---------- paths for fs calls ----------
  //
  // Every path below reaches an fs call through `namespacedJoin`, never a bare
  // `join`, because the root it extends is not this chain's to bound: a groom
  // tick's `cwd` is a worktree the dispatcher provisioned under a base a chain
  // or `FLUME_WORKTREES_DIR` may have moved, so `<cwd>/BACKLOG.json` can pass
  // win32's ~260-character total-path limit with no component anywhere near it
  // (`.claude/rules/platform-facts.md`, *Windows MAX_PATH (~260 chars) breaks
  // fs calls with no long component*). The fold is the engine's own — the idiom
  // every path it hands an fs call is composed through — so it arrives on the
  // api rather than being re-paired out of `join` and `toNamespacedPath` here
  // (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
  // never rediscovered*). It is a no-op off win32, which is why the shape of
  // the call site, and not a green tick on your host, is what carries it.

  // ---------- the groom agent ----------

  /** Tags already shipped, read back from `SHIPPED.md` so a `blockedBy` item unblocks across ticks. */
  function readShippedTags(cwd: string): Set<string> {
    const path = namespacedJoin(cwd, SHIPPED_PATH);
    if (!existsSync(path)) return new Set();
    const tags = new Set<string>();
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = /^- ([a-z0-9-]+):/.exec(line);
      if (m) tags.add(m[1]!);
    }
    return tags;
  }

  /**
   * `BACKLOG.json`'s own parse, shared by the groom agent and the gate below
   * so the two can never disagree about what a valid backlog is.
   *
   * The engine's queue is a directory of one entry per file
   * (`spec/pending.md`, *The ledger is a directory — one entry per file*);
   * this backlog is one array in one file, which is this chain's own shape.
   * So the chain takes the engine's *entry* validator
   * (`composePendingEntry`) and applies it to each element itself, rather
   * than the engine growing a second file shape for a convention no mechanic
   * of its own reads.
   */
  const entrySchema = composePendingEntry(entryExtension);
  function parseBacklog(
    raw: string,
  ): { ok: true; entries: PendingEntry[] } | { ok: false; problems: string[] } {
    let items: unknown;
    try {
      items = JSON.parse(raw);
    } catch (err) {
      return {
        ok: false,
        problems: [`  invalid JSON: ${(err as Error).message}`],
      };
    }
    if (!Array.isArray(items)) {
      return { ok: false, problems: ["  expected an array of entries"] };
    }
    const outcomes = items.map((item) => entrySchema.safeParse(item));
    const problems = outcomes.flatMap((outcome, index) =>
      outcome.success
        ? []
        : outcome.error.issues.map(
            (issue) => `  [${index}] ${issue.path.join(".")}: ${issue.message}`,
          ),
    );
    if (problems.length > 0) return { ok: false, problems };
    return { ok: true, entries: outcomes.map((outcome) => outcome.data!) };
  }

  /**
   * Deterministic groomer: parse `BACKLOG.json` against core + this chain's
   * extension, pick the first pickable entry in array order — this backlog's
   * own convention, and this agent's to choose: the engine's queue orders on
   * the entry's `priority`, and nothing hands that ordering to an agent
   * picking out of a file it owns. Then remove it from the backlog, log it to
   * `SHIPPED.md`, and commit both files itself — one tick, one commit, the
   * same contract an LLM-backed agent honors.
   *
   * `capabilities` is hardcoded empty here to mirror `Chain.capabilities`
   * below (this chain asserts none); a chain that probes real capabilities at
   * load time would thread the same set through instead of the literal.
   */
  const groomAgent: Agent = {
    name: "backlog-groomer",
    async invoke(inv) {
      const { cwd } = inv;
      /**
       * Tee this tick's line to `onStdout` as well as returning it. A
       * capture decorator sees the *stream*, never the returned
       * `AgentResult`, so an agent that only returns its line captures an
       * empty file — an LLM-backed agent streams as it goes and gets this
       * for free.
       */
      const say = (line: string): string => {
        inv.onStdout?.(`${line}\n`);
        return line;
      };
      const backlogPath = namespacedJoin(cwd, BACKLOG_PATH);
      let raw: string;
      try {
        raw = readFileSync(backlogPath, "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        return { exitCode: 0, stdout: say("no BACKLOG.json; nothing to groom"), stderr: "" };
      }

      const backlog = parseBacklog(raw);
      if (!backlog.ok) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `BACKLOG.json invalid:\n${backlog.problems.join("\n")}`,
        };
      }
      const entries = backlog.entries;

      const shippedTags = readShippedTags(cwd);
      const pick = entries.find((entry) =>
        isPickableNow(entry, shippedTags, undefined, new Set()),
      );
      if (!pick) {
        return { exitCode: 0, stdout: say("no pickable backlog item"), stderr: "" };
      }

      const remaining = entries.filter((entry) => entry !== pick);
      writeFileSync(backlogPath, `${JSON.stringify(remaining, null, 2)}\n`);

      // Narrows the parsed payload's `unknown` to `string`, and re-asserts
      // the one-line bound at the interpolation it protects: a `reason` that
      // reached here carrying a newline throws rather than writing a ledger
      // line `readShippedTags` would read as a second tag.
      const reason = entryExtension.reason.schema.parse(pick.reason);
      const shippedPath = namespacedJoin(cwd, SHIPPED_PATH);
      const prior = existsSync(shippedPath) ? readFileSync(shippedPath, "utf8") : "";
      writeFileSync(shippedPath, `${prior}- ${pick.tag}: ${reason}\n`);

      execFileSync("git", ["add", BACKLOG_PATH, SHIPPED_PATH], {
        cwd,
        maxBuffer: GIT_OUTPUT_CAP_BYTES,
      });
      execFileSync("git", ["commit", "-q", "-m", `groom: ship ${pick.tag}`], {
        cwd,
        maxBuffer: GIT_OUTPUT_CAP_BYTES,
      });

      return { exitCode: 0, stdout: say(`shipped ${pick.tag}`), stderr: "" };
    },
  };

  /**
   * Whether to keep transcripts is this chain's call; where they land is
   * not. `api.paths.flumeDir` is the state root the runtime resolved and
   * handed this factory — absolute, and the one directory a teardown `rm`
   * removes. A singleton groom tick runs inside its own worktree
   * (`<flumeDir>/worktrees/groom/`), so a relative `"sessions"` would file
   * the transcript into a checkout git later deletes; resolving against the
   * handed root writes up into the state dir instead. The chain never reads
   * `process.env.FLUME_DIR` and carries no `?? __dirname` fallback — the
   * engine already resolved this.
   */
  const capturingGroomAgent = withSessionCapture(groomAgent, {
    dir: resolve(api.paths.flumeDir, "sessions"),
  });

  // ---------- gate ----------

  /**
   * Re-validates `BACKLOG.json` post-commit against core + `entryExtension`
   * — the agent's own `parseBacklog`, so the gate and the leg it judges read
   * one parse, the way cascade's `pendingGate` and its dispatcher do. Absence is fine
   * (a tick with nothing pickable makes no changes at all).
   */
  const backlogParseGate: Gate = {
    name: "BACKLOG.json parses",
    when: "afterCommit",
    async run(ctx) {
      let raw: string;
      try {
        raw = readFileSync(namespacedJoin(ctx.cwd, BACKLOG_PATH), "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        return { ok: true, message: "BACKLOG.json absent (nothing groomed this tick)" };
      }
      const result = parseBacklog(raw);
      if (result.ok) {
        return {
          ok: true,
          message: `BACKLOG.json parses (${result.entries.length} item(s) remaining)`,
        };
      }
      return {
        ok: false,
        message: `BACKLOG.json has ${result.problems.length} schema violations`,
        details: result.problems.join("\n"),
      };
    },
  };

  // ---------- phase ----------

  /**
   * Singleton: one groom tick at a time, same reasoning as cascade's plan
   * phase — `BACKLOG.json` is a single shared artifact. No fanout, no
   * `assignedEntry`, no pending queue — the backlog this phase reads and
   * writes is `BACKLOG.json`, entirely of this chain's own naming.
   */
  const groom: Phase = {
    name: "groom",
    description: `Read ${BACKLOG_PATH}, ship the top pickable item, commit.`,
    promptPath: "prompts/backlog-groomer.md",
    concurrency: "singleton",
    agent: capturingGroomAgent,
    writablePaths: [BACKLOG_PATH, SHIPPED_PATH],
    gates: [backlogParseGate],
    /**
     * The schema block, and the two artifact paths the prompt names. Both
     * paths are constants this chain already holds — the fence above, the
     * parse gate and the ledger writer all read them from there — so the
     * template renders them rather than spelling them a second time
     * (`.claude/rules/engineering.md`, *Derived state is computed, never
     * restated beside its source*). A consumer renaming either artifact edits
     * one line at the top of this file, and the prompt follows. What stays
     * spelled in the template is what this chain holds no value for: the
     * `groom:` commit prefix, and the ledger line's own shape.
     */
    promptArgs() {
      return {
        BACKLOG_SCHEMA: renderSchemaForPrompt(entryExtension),
        BACKLOG_PATH,
        SHIPPED_PATH,
      };
    },
    // One phase, no sibling to hand off to — the chain hibernates after every
    // tick, same as minimal-chain's `notes`.
    handoff: () => [],
  };

  // ---------- chain ----------

  const backlogGroomerChain: Chain = {
    phases: [groom],
    entryExtension,
    humanOnly: [],
    // No environment facts asserted: a backlog item gated
    // `requiresCapability` stays parked until a deployment of this chain
    // names the capability here.
    capabilities: [],
  };

  return { chain: backlogGroomerChain };
};

export default factory;

/* --------------------------------------------------------------------------
 * Plugging this into a host repo's `.flume/chain.ts`
 *
 *   1. Copy this file to `<your-repo>/.flume/chain.ts` and
 *      `examples/prompts/backlog-groomer.md` to
 *      `<your-repo>/.flume/prompts/backlog-groomer.md`.
 *
 *   2. Replace the `../src/index.ts` import path with the bare specifier.
 *      It stays `import type` — `composePendingEntry`, `isPickableNow`,
 *      `renderSchemaForPrompt` and `withSessionCapture` are every runtime
 *      value this file uses, each destructured off the factory's `api`
 *      below, so nothing here resolves a second engine:
 *
 *          import type { Agent, Chain, EntryExtension, Gate, Phase } from "flume";
 *
 *   3. Seed `<your-repo>/BACKLOG.json` with a JSON array conforming to
 *      `entryExtension` above (core `tag`/`gate`/`dependsOnForks`/`files`
 *      plus this chain's `reason`) — this is the "TODO file" a human or an
 *      upstream process maintains; the groom phase never invents entries.
 *
 *   4. Run `pnpm exec flume tick` (or `npx flume tick`). No agent CLI or API
 *      key needed — `groom.agent` is the deterministic groomer above. Swap
 *      in `claudeCode()` there to let an LLM pick instead.
 *
 * See `docs/CHAIN-AUTHORING.md` for the full walkthrough, and
 * `examples/cascade-chain.ts` for the multi-phase, fanout, pending-queue
 * shape this chain deliberately does without.
 * -------------------------------------------------------------------------- */