/**
 * Cascade chain — the canonical spec → plan → build pipeline, expressed as
 * Flume Phases. The spec corpus is a human maintenance surface, so the chain
 * itself is the two machine phases that derive from it:
 *
 *   - plan: re-derives pending.json + state.md from the spec corpus + src
 *     (singleton).
 *   - build: ships pending entries to the trunk (fanout).
 *
 * This file is the load-bearing example: it demonstrates the shape a chain
 * takes when derivation splits across a singleton deriver and a fanout
 * shipper. Read it alongside the JSDoc on `Phase`, `Gate`, and the
 * pending-schema exports.
 *
 * Imports come from `../src/index.ts` — the same public surface a consumer
 * sees as `import { ... } from "flume"`. Path is relative because this file
 * lives inside the flume repo; in a host repo, swap `../src/index.ts` for
 * `flume`. See the trailing block.
 */

import { z } from "zod";
import type {
  Chain,
  ChainFactory,
  EntryExtension,
  FlumeApi,
  Gate,
  GateResult,
  Phase,
  TickContext,
} from "../src/index.ts";


// ---------- entry extension ----------

/**
 * This project's pending-entry fields beyond the engine core
 * (tag/gate/dependsOnForks/files). Declared once — the same record drives
 * the parse-gate validator (`pendingGate({ extension: entryExtension, ... })`),
 * the prompt schema plan writes against (`renderSchemaForPrompt(entryExtension)`),
 * the gates that judge the fields (`judgedByEntryTests`, `declaredFilesGate`)
 * and the hints build's prompt quotes back to the agent held to them — so no
 * surface can drift from the rule another one enforces. The engine consumes
 * none of these fields; they are this chain's spec→plan→build workflow.
 */
const entryExtension = {
  summary: {
    schema: z.string().min(1).max(200),
    hint: `"one-line what (≤200 chars)"`,
  },
  per: {
    schema: z.strictObject({
      path: z.string().min(1),
      section: z.string().min(1),
    }),
    hint: `{ "path": "specs/.../foo.md (the spec or rule that justifies this work)", "section": "Section heading text, no leading '## '" }`,
  },
  tests: {
    schema: z
      .array(
        z.strictObject({
          path: z.string().min(1),
          asserts: z.string().min(1),
        }),
      )
      .default([]),
    hint: `[ { "path": "tests/foo.test.ts", "asserts": "behavior this entry introduces" } ] — build titles a passing test in that file with the \`asserts\` line verbatim (its full name must contain it); the vitest gate reads the reporter's output and reverts the entry when a line has no such test`,
  },
  acceptance: {
    schema: z.string().min(1),
    hint: `"what turns green when this is done"`,
  },
  notes: {
    schema: z.string().max(500).optional(),
    hint: `"≤500 chars; optional context not in the spec"`,
  },
} satisfies EntryExtension;


// ---------- the entry's tests[] as a gate ----------

/**
 * The slice of vitest's `--reporter=json` output this chain reads: the file
 * each test came from, its full name, and whether it passed.
 */
interface TestReport {
  testResults: Array<{
    name: string;
    assertionResults: Array<{ fullName: string; status: string }>;
  }>;
}

/**
 * The JSON report embedded in a gate's captured output, or `undefined` when
 * none parses. The runner writes the report to stdout alongside whatever else
 * it prints, so the object is found rather than assumed to be the whole text.
 */
function parseTestReport(details: string | undefined): TestReport | undefined {
  if (!details) return undefined;
  const start = details.indexOf('{"numTotalTestSuites"');
  if (start === -1) return undefined;
  try {
    return JSON.parse(
      details.slice(start, details.lastIndexOf("}") + 1),
    ) as TestReport;
  } catch {
    return undefined;
  }
}

/** Does the reporter's absolute file path name the repo-relative path the entry declared? */
function isDeclaredFile(reported: string, declared: string): boolean {
  const norm = reported.split("\\").join("/");
  return norm === declared || norm.endsWith(`/${declared}`);
}

/**
 * Wrap a suite gate so the entry's `tests[]` is judged from the run the gate
 * already paid for: every declared `{ path, asserts }` must have a **passing**
 * test in that file whose full name carries the `asserts` line verbatim.
 *
 * This is what makes `tests[]` load-bearing rather than decorative. Plan names
 * the behavior an entry introduces, build titles a test with the line, and the
 * gate proves the name has a test — so "was it tested" is a gate's answer
 * instead of a reviewer's reading of the commit body. The engine reads none of
 * `tests[]`; a declared extension field is judged by the chain that declared
 * it, and the engine supplies the injection points this needs
 * (`GateContext.entry`, `GateResult.details`) rather than the policy.
 *
 * Takes the suite gate as a parameter — any gate whose `details` carry a
 * vitest JSON report composes, and the wrapper is drivable over a report the
 * caller supplies.
 */
export function judgedByEntryTests(suite: Gate): Gate {
  return {
    ...suite,
    async run(ctx): Promise<GateResult> {
      // `tests[]` is this chain's declared extension field — narrow it through
      // the same schema the parse gate validated it with. Absent parses to the
      // schema's `[]` default: an entry naming no behavior has none to judge.
      const named = entryExtension.tests.schema.parse(ctx.entry?.tests);
      const result = await suite.run(ctx);
      if (!result.ok || named.length === 0) return result;

      const report = parseTestReport(result.details);
      if (!report) {
        // Green over an unreadable report would pass every named line
        // vacuously — the one failure that hides longest.
        return {
          ok: false,
          message: `${suite.name} exited green but wrote no JSON report — ${named.length} named behavior(s) unjudged`,
          ...(result.details ? { details: result.details } : {}),
        };
      }
      const unpinned = named.filter(
        (t) =>
          !report.testResults.some(
            (f) =>
              isDeclaredFile(f.name, t.path) &&
              f.assertionResults.some(
                (a) => a.status === "passed" && a.fullName.includes(t.asserts),
              ),
          ),
      );
      if (unpinned.length > 0) {
        return {
          ok: false,
          message: `${unpinned.length} of ${named.length} named behavior(s) have no passing test — entry reverted from the trunk`,
          details: [
            "Title a passing test with each line verbatim, in the file the entry names:",
            ...unpinned.map((t) => `- ${t.path}: ${t.asserts}`),
          ].join("\n"),
        };
      }
      return {
        ...result,
        message: `${result.message}; ${named.length} named behavior(s) each have a passing test`,
      };
    },
  };
}


// ---------- the entry's files[] as a gate ----------

/** How an entry classified a path. */
type DeclaredKind = "new" | "edit" | "retire";

/** Whether the path exists at each end of the span the gate is judging. */
interface SpanShape {
  atBase: boolean;
  atTip: boolean;
}

/** What each class claims about the path across the span. */
const SPAN_SHAPE: Record<DeclaredKind, SpanShape> = {
  new: { atBase: false, atTip: true },
  edit: { atBase: true, atTip: true },
  retire: { atBase: true, atTip: false },
};

const inWords = (s: SpanShape): string =>
  `${s.atBase ? "present" : "absent"} at the base, ` +
  `${s.atTip ? "present" : "absent"} at the commit`;

/**
 * Hold the span to the entry's own file declaration: a path plan filed under
 * `new` was not in the tree the tick branched from, one filed under `edit`
 * was, and one filed under `retire` is gone by the end of the span.
 *
 * The engine reads `files` for the fence union and the fanout partition; what
 * the three classes *mean* about the tree is nobody's rule but this chain's,
 * so the judgement lives here. Every fact it needs is one the engine already
 * reported on `GateContext` (spec/chain.md, *What a gate receives*) and none
 * is re-derived: `entry` is the pick the span was provisioned for,
 * `touchedPaths` is what the commit changed, `baseSha` is the tip the tick
 * branched from — the one value that separates "the tick created this" from
 * "it was already there", and the reason this gate never shells its own
 * `git merge-base` or guesses the base from a worktree path.
 *
 * Only declared paths the span actually touched are judged — a deliberate
 * narrowing, declared here with the refusal that bounds it
 * (`.claude/rules/engineering.md`, *Loud or nothing*): a tick that shipped
 * part of its declaration is plan's problem on the next re-derive, but a span
 * touching *none* of a non-empty declaration is refused rather than skipped.
 * This chain's build declares no `entryChannelPaths` and no `shipped`
 * predicate, so every commit it makes retires the entry; a green over the
 * zero-judged span would retire an entry whose whole file prediction — the
 * same prediction the fanout partition was cut from — went unmet, with the
 * one gate that could have said so reporting success. The empty case that is
 * legitimate is the entry declaring no files at all, and it is spelled
 * separately rather than inherited.
 *
 * Existence at a ref comes from the engine's own at-sha reader rather than a
 * hand-rolled `git cat-file`: it answers "absent from that commit" with
 * `null` and lets a bad ref throw, where a reimplementation reads the second
 * as the first (`src/flumeApi.ts`, `git.readFileAtRef`). Taken as a
 * parameter so the gate is drivable over a stub reader.
 */
export function declaredFilesGate(
  readFileAtRef: FlumeApi["git"]["readFileAtRef"],
): Gate {
  return {
    name: "declared-files",
    when: "afterCommit",
    async run(ctx): Promise<GateResult> {
      const entry = ctx.entry;
      if (!entry) {
        return {
          ok: true,
          message: "no entry on this tick",
          skipped:
            "a singleton tick carries no entry, so there is no declaration to judge",
        };
      }
      const { baseSha, commitSha, touchedPaths } = ctx;
      if (!baseSha || !commitSha || !touchedPaths) {
        return {
          ok: false,
          message: `${entry.tag}: declared-files needs baseSha, commitSha and touchedPaths on the gate context`,
        };
      }
      const span = `${baseSha.slice(0, 7)}..${commitSha.slice(0, 7)}`;
      const declared = new Map<string, DeclaredKind>([
        ...entry.files.new.map((f) => [f.path, "new"] as const),
        ...entry.files.edit.map((f) => [f.path, "edit"] as const),
        ...entry.files.retire.map((p) => [p, "retire"] as const),
      ]);
      const judged = touchedPaths.filter((p) => declared.has(p));
      if (judged.length === 0) {
        if (declared.size === 0) {
          return {
            ok: true,
            message: `${entry.tag}: declares no files, so the span ${span} has no class to judge`,
            skipped:
              "an entry with an empty files declaration contradicts nothing",
          };
        }
        return {
          ok: false,
          message: `${entry.tag}: the span ${span} touched none of the ${declared.size} path(s) the entry declared`,
          details: [
            "The commit ships the entry, so a declaration met by nothing retires unmet work. Produce the declared paths, or leave the entry for plan to re-file:",
            ...[...declared].map(([path, kind]) => `- ${path}: declared ${kind}, untouched`),
          ].join("\n"),
        };
      }

      const wrong: string[] = [];
      for (const path of judged) {
        const kind = declared.get(path)!;
        const [atBase, atTip] = await Promise.all([
          readFileAtRef(ctx.repoRoot, baseSha, path),
          readFileAtRef(ctx.repoRoot, commitSha, path),
        ]);
        const saw: SpanShape = { atBase: atBase !== null, atTip: atTip !== null };
        const want = SPAN_SHAPE[kind];
        if (saw.atBase !== want.atBase || saw.atTip !== want.atTip) {
          wrong.push(
            `- ${path}: declared ${kind} (${inWords(want)}), span has it ${inWords(saw)}`,
          );
        }
      }
      if (wrong.length > 0) {
        return {
          ok: false,
          message: `${entry.tag}: ${wrong.length} of ${judged.length} declared path(s) contradict the span ${span}`,
          details: [
            "Re-file the path under the class the span actually produced, or produce the class the entry declared:",
            ...wrong,
          ].join("\n"),
        };
      }
      return {
        ok: true,
        message: `${entry.tag}: ${judged.length} declared path(s) match the span ${span}`,
      };
    },
  };
}


// ---------- chain factory ----------

/**
 * The default export is a factory the engine calls with its own API. Every
 * engine value this chain composes with — gates, the schema renderer —
 * arrives as a parameter, so the chain resolves no engine copy of its own
 * and a second physical engine cannot enter the process. The only engine
 * import above is import type, which is erased at runtime.
 */
const factory: ChainFactory = (api) => {
  const {
    pendingGate,
    renderSchemaForPrompt,
    shellGate,
    tscGate,
    eslintGate,
  } = api;
  // ---------- project-specific gates ----------

  /**
   * The test suite, at `afterMerge` — the merged trunk is the only tree
   * anything validates as a whole, and this is the gate that says it is
   * still correct — judged twice: the suite is green, and every behavior the
   * entry's `tests[]` names has a passing test (`judgedByEntryTests` above).
   *
   * Why `shellGate` and not the `vitestGate` builtin: that builtin fixes
   * `when: "afterCommit"` and takes no placement override, so composing the
   * public escape hatch is how a chain moves a language check to the trunk.
   * Same command, different gate point — and the escape hatch is also what
   * lets the command ask for `--reporter=json`, which is the second claim's
   * whole input.
   */
  const vitestOnTrunk: Gate = judgedByEntryTests(
    shellGate({
      name: "vitest",
      when: "afterMerge",
      cmd: "pnpm",
      args: ["vitest", "run", "--reporter=json"],
      failHint: "Tests failed — entry reverted from the trunk",
    }),
  );

  /**
   * The entry's own `files` declaration, judged against the span it produced
   * (`declaredFilesGate` above). Cheap — three existence reads per declared
   * path the commit touched — so it sits `afterCommit`, where a mis-filed
   * declaration never reaches the trunk. Handed the engine's at-sha reader
   * off the factory's `api`, the same way every other engine value this
   * chain composes with arrives.
   */
  const declaredFilesMatchSpan: Gate = declaredFilesGate(api.git.readFileAtRef);

  // ---------- phases ----------

  /**
   * Build phase — ships one or more disjoint pending entries to the trunk.
   *
   * Fanout: the dispatcher picks N entries that don't touch the same files and
   * runs N agent invocations in parallel worktrees. Each tick handles one
   * `assignedEntry`. Worktree branches merge serially after their afterCommit
   * gates pass; the afterMerge gates then run per entry on the trunk, after
   * that entry's cherry-pick, and a failure there reverts only that entry —
   * the rest of the wave stays shipped.
   *
   * Gates split by cost. Cheap structural checks stay `afterCommit`, inside
   * the worktree, so a type or lint error never reaches the trunk at all:
   * `tscGate` first, then `eslintGate`, then the entry's own file
   * declaration against the span it produced (`declaredFilesMatchSpan`);
   * failure reverts the worktree commit and the entry stays pickable for the
   * next tick. The suite runs
   * `afterMerge` (`vitestOnTrunk` above), because the merged tree is the one
   * no afterCommit gate ever saw — the trunk may have moved under the wave,
   * and two siblings that each passed in isolation can compose into a tree
   * neither worktree held. Running it N-wide in parallel worktrees would
   * also buy nothing but host contention, where a timeout reverts a clean
   * commit.
   *
   * Always hands off to plan so pending.json reconciles against the new trunk
   * state, regardless of success, bail, or validation-fail.
   *
   * Declared above `plan` (rather than in the plan/build reading order)
   * so `plan.gates` can reference `build` directly as `pendingGate`'s
   * `targetFence` — `build.writablePaths` is a static array literal here, not
   * declaration-driven, so no `get gates()` deferral is needed (contrast the
   * getter-backed pattern in `docs/CHAIN-AUTHORING.md`'s `pendingGate` section
   * for a chain where the fence resolves lazily).
   */
  const build: Phase = {
    name: "build",
    description: "Ship one (or N disjoint) pending entries to the trunk.",
    promptPath: "prompts/build.md",
    concurrency: "fanout",
    writablePaths: [
      "src/**",
      "prisma/**",
      "tests/**",
      "package.json",
      "tsconfig.json",
      "eslint.config.mjs",
      ".gitignore",
      // NOTE: build does not touch .flume/plan/pending.json. The harness writes
      // a separate commit post-merge that removes shipped entries. This avoids
      // cherry-pick conflicts when N fanout worktrees each touch the same file.
    ],
    gates: [tscGate, eslintGate, declaredFilesMatchSpan, vitestOnTrunk],
    promptArgs(ctx: TickContext) {
      if (!ctx.assignedEntry) {
        throw new Error("build phase requires an assignedEntry in TickContext");
      }
      // `per` is this chain's declared extension field — narrow it through the
      // same schema the parse gate validated it with.
      const per = entryExtension.per.schema.parse(ctx.assignedEntry.per);
      return {
        ENTRY_JSON: JSON.stringify(ctx.assignedEntry, null, 2),
        TAG: ctx.assignedEntry.tag,
        PER_PATH: per.path,
        PER_SECTION: per.section,
        // The contract `judgedByEntryTests` holds this commit to, handed to
        // the agent that has to meet it — rendered from the field's own
        // declaration, the same string `renderSchemaForPrompt` puts in plan's
        // schema block. A sentence hand-written here instead would be a second
        // copy of a rule the gate reverts commits over.
        TESTS_HINT: entryExtension.tests.hint,
      };
    },
    handoff() {
      return ["plan"];
    },
  };

  /**
   * Plan phase — re-derives `.flume/plan/pending.json` and `state.md` from the
   * spec corpus + current src state, every tick from scratch.
   *
   * Singleton: pending.json and state.md are shared artifacts; two concurrent
   * planners would race. Gates the output through `pendingGate` so a
   * malformed pending.json, or an entry whose declared `files` can't survive
   * build's fence, reverts the commit instead of poisoning build.
   *
   * Hands off to build when at least one entry is `gate.kind === "open"`
   * (pickable); otherwise hibernates and waits for human signal.
   *
   * Declares `shouldRun` so the "is there anything to re-derive against"
   * question is answered from the `TickContext` the dispatcher already built,
   * before the invocation rather than after one that commits nothing.
   */
  const plan: Phase = {
    name: "plan",
    description: "Re-derive .flume/plan/pending.json + state.md from disk.",
    promptPath: "prompts/plan.md",
    concurrency: "singleton",
    writablePaths: [
      ".flume/plan/pending.json",
      ".flume/plan/state.md",
      ".flume/plan/open-questions.md",
    ],
    gates: [pendingGate({ targetFence: build, extension: entryExtension })],
    shouldRun(ctx) {
      // Build hands the baton back on every tick, so most plan wakes land on
      // a queue plan already agrees with — a full invocation that re-derives,
      // concludes nothing changed, and commits nothing. Two facts the
      // dispatcher already computed say otherwise, and both arrive on the
      // TickContext: a standing prior-attempt record (build bailed, or its
      // commit was declined) that only a re-derive reconciles, and a queue
      // with nothing build can pick. Read from the context, never from
      // process.env or a readdir of the engine's prior-attempts directory.
      const hasStandingAttempt = (ctx.priorAttempts?.size ?? 0) > 0;
      const pickable = ctx.pickable ?? [];
      return hasStandingAttempt || pickable.length === 0;
    },
    promptArgs() {
      return { PENDING_SCHEMA: renderSchemaForPrompt(entryExtension) };
    },
    handoff(result) {
      const hasPickable = result.pendingAfter.some((e) => e.gate.kind === "open");
      return hasPickable ? ["build"] : [];
    },
  };

  // ---------- chain ----------

  const cascadeChain: Chain = {
    phases: [plan, build],
    entryExtension,
    humanOnly: [], // both phases are machine-woken; the spec corpus a human edits is not a phase
  };

  return { chain: cascadeChain };
};

export default factory;

/* --------------------------------------------------------------------------
 * Plugging this into a host repo's `.flume/chain.ts`
 *
 * The flume CLI loads `<repo>/.flume/chain.ts` and calls its default export:
 * a factory `(api) => ({ chain })`, which is what `export default factory`
 * above hands it. To use this file as a starting point in a consumer repo:
 *
 *   1. Copy this file to `<your-repo>/.flume/chain.ts`.
 *
 *   2. Replace the `../src/index.ts` import path with `"flume"` — the
 *      package's single public entry point. The engine values this chain
 *      composes with arrive on the factory's `api` parameter, so the only
 *      engine import is `import type`:
 *
 *          import type {
 *            Chain,
 *            ChainFactory,
 *            EntryExtension,
 *            Gate,
 *            Phase,
 *            TickContext,
 *          } from "flume";
 *
 *   3. Adapt the phases to your project:
 *      - Trim phases you don't need (e.g. drop `build` for a single-phase
 *        chain, or add one of your own).
 *      - Update `writablePaths` to match your repo layout.
 *      - Swap in your own custom gates; drop the built-ins you don't use —
 *        they are destructured off `api` at the top of the factory.
 *      - Point `promptPath` at prompts that live next to chain.ts (e.g.
 *        `.flume/prompts/build.md`).
 *
 *   4. To customize the provider seam (`claudeCode` + decorators), return an
 *      `agent` from the factory alongside the chain — `{ chain, agent }`, not
 *      a module export; a named export cannot receive the API. Same for a
 *      `forkResolver`. See `flume/.flume/chain.ts` in this repo for the
 *      pattern.
 *
 * Run `pnpm exec flume status` to confirm the harness loaded your chain.
 * -------------------------------------------------------------------------- */
