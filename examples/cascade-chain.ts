/**
 * Cascade chain — the canonical spec → plan → build pipeline, expressed as
 * Flume Phases. The spec corpus is a human maintenance surface, so the chain
 * itself is the machine phases that derive from it:
 *
 *   - plan-inbox: routes the findings under `.flume/inbox/` (singleton).
 *   - plan-derive: re-derives the pending queue + state.md from the spec corpus
 *     + src (singleton).
 *   - build: ships pending entries to the trunk (fanout).
 *
 * This file is the load-bearing example: it demonstrates the shape a chain
 * takes when derivation splits across a ladder of singleton planners and a
 * fanout shipper — the plan slices share one dispatcher and one prompt, and
 * the handoff passes the baton down their declared order. Read it alongside
 * the JSDoc on `Phase`, `Gate`, and the pending-schema exports.
 *
 * Imports come from `../src/index.ts` — the same public surface a consumer
 * sees as `import type { ... } from "flume"`. Path is relative because this
 * file lives inside the flume repo; in a host repo, swap `../src/index.ts`
 * for `flume`. Type-only, all of it: every engine *value* arrives on the
 * factory's `api`, so nothing here resolves a second engine. See the
 * trailing block.
 */

import { readdirSync } from "node:fs";
import { resolve } from "node:path";

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

/**
 * Does the reporter's absolute file path name the repo-relative path the
 * entry declared?
 *
 * `gitPath` is the engine's own host-path-to-git-path rule rather than a
 * chain-local respelling of it: an entry declares its files the way a commit
 * names them, and turning what a reporter printed into that form is a fact
 * the engine hands out (`.claude/rules/engineering.md`, *A fact the engine
 * holds is reported, never rediscovered*). Taken as a parameter, the way
 * every other engine value this file composes with arrives — the rule rides
 * `FlumeApi`, so reaching it never costs a runtime import of the engine.
 */
function isDeclaredFile(
  gitPath: FlumeApi["gitPath"],
  reported: string,
  declared: string,
): boolean {
  const norm = gitPath(reported);
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
 * caller supplies — and the engine's path rule alongside it, for matching
 * the reporter's absolute filenames against the entry's declaration.
 */
export function judgedByEntryTests(
  suite: Gate,
  gitPath: FlumeApi["gitPath"],
): Gate {
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
              isDeclaredFile(gitPath, f.name, t.path) &&
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

  // ---------- the state root, as the repository addresses it ----------

  /**
   * The offset every path this chain commits is rooted at — forward-slashed,
   * the alphabet a fence glob is matched in — reported by the engine at
   * chain load (`api.paths.stateRootRel`) rather than spelled `.flume/`
   * here. A relocated `FLUME_DIR` moves the state root, and
   * a literal fence would then guard a directory the dispatcher no longer
   * writes: every plan commit reverts, and the artifacts the slice actually
   * wrote land outside the glob.
   *
   * Absent means the root resolves outside the repository, where the plan
   * artifacts this chain commits are paths no commit can hold. Refused at
   * load, rather than shipping a fence that matches nothing
   * (`.claude/rules/engineering.md`, *Loud or nothing*).
   */
  const stateRoot = ((): string => {
    const rel = api.paths.stateRootRel;
    if (rel === undefined) {
      throw new Error(
        `the cascade chain's state root ${api.paths.flumeDir} resolves outside ` +
          `the repository at ${api.paths.repoRoot}, so the plan artifacts its ` +
          `slices commit are paths no commit can hold`,
      );
    }
    return rel;
  })();

  // ---------- project-specific gates ----------

  /**
   * The test suite, at `afterMerge` — the merged trunk is the only tree
   * anything validates as a whole, and this is the gate that says it is
   * still correct — judged twice: the suite is green, and every behavior the
   * entry's `tests[]` names has a passing test (`judgedByEntryTests` above).
   *
   * Why `shellGate` and not `vitestGate({ when: "afterMerge" })`: placement
   * alone the builtin now takes, but the second claim needs the suite's
   * `--reporter=json` output, and overriding `args` to ask for it would
   * restate the builtin's whole command anyway. A chain that only wants the
   * suite relocated says `vitestGate({ when: "afterMerge" })` and stops
   * there.
   */
  const vitestOnTrunk: Gate = judgedByEntryTests(
    shellGate({
      name: "vitest",
      when: "afterMerge",
      cmd: "pnpm",
      args: ["vitest", "run", "--reporter=json"],
      failHint: "Tests failed — entry reverted from the trunk",
    }),
    api.gitPath,
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
   * Hands the baton back to the plan ladder rather than to a phase named
   * outright, so the queue reconciles against the new trunk state — see
   * `nextPhase` below, the one place the order lives.
   *
   * Declared above the plan slices (rather than in the plan/build reading
   * order) so their `gates` can reference `build` directly as `pendingGate`'s
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
      // NOTE: build does not touch .flume/plan/pending/. The harness writes
      // a separate commit post-merge that `git rm`s the shipped entries' files.
      // One file per entry is what lets N fanout worktrees merge at all.
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
    handoff(result) {
      // A refusal only plan can resolve wakes the re-derive whatever is
      // pickable: a clean exit with no commit, or a commit that landed and a
      // `shipped` predicate declined — otherwise the ladder hands build the
      // same entry into the same wall. The engine reports which
      // (`TickResult.noCommit`, `entries[].mergeOutcome`); what it means is
      // this chain's reading. A cherry-pick conflict is neither: the next
      // wave retries it from the new base.
      const refused =
        result.noCommit === "clean-exit" ||
        (result.entries ?? []).some(
          (e) => e.noCommit === "clean-exit" || e.mergeOutcome === "not-shipped",
        );
      if (refused) return [DERIVE];
      return nextPhase(result.flumeDir, result.pickableAfter.length > 0);
    },
  };

  // ---------- plan slices ----------

  /**
   * Plan is two singleton slices sharing one prompt, not one phase doing
   * every plan job. Each slice owns one job and computes its own liveness
   * before the invocation — the verdict `shouldRun` exists for
   * (spec/loop.md, *Declining a tick before the invocation*), one level
   * down: "which plan job is there to do" is answered here, never by paying
   * an agent invocation to have the model answer it.
   *
   * Liveness is a fact of disk, reached two ways. Where the engine already
   * reports the fact, the slice reads it off the `TickContext` — `pickable`
   * is the dispatcher's own selection verdict and `priorAttempts` its
   * persisted records, and a chain recomputing either is naming a field that
   * should exist (`.claude/rules/engine-boundary.md`, *Surface, not
   * prescription*). Where no engine field reports it — `<flumeDir>/inbox/`
   * is this chain's own directory, not the engine's — the slice reads the
   * artifact itself, in one cheap synchronous listing.
   *
   * Ladder order is dependency order: the inbox first, because a finding an
   * operator filed can invalidate anything derived below it; the re-derive
   * next, so the queue build picks from is current before build picks from
   * it. `nextPhase` is the only place that order lives — both slices'
   * `handoff` and build's route through it, so the chain has one ladder
   * rather than three copies of one.
   */
  const INBOX = "plan-inbox";
  const DERIVE = "plan-derive";

  /** One plan job: the phase it becomes, the prompt material it carries, and when it is live. */
  interface PlanSlice {
    name: string;
    description: string;
    /** This slice's own task text, rendered into the shared prompt as `{{SLICE_JOB}}`. */
    job: string;
    /**
     * This slice's window is non-empty. Pure over its inputs and
     * synchronous, per `shouldRun`'s contract — two facts in, and no I/O
     * beyond a single directory listing.
     */
    live: (inputs: { flumeDir: string; pickable: boolean }) => boolean;
  }

  /**
   * Does `<flumeDir>/inbox/` hold a finding? A missing directory is the
   * drained state; any other failure answers live, because an unreadable
   * queue is a reason to run the tick and never a reason to skip it
   * (`.claude/rules/engineering.md`, *Loud or nothing*).
   */
  function inboxPending(flumeDir: string): boolean {
    try {
      return readdirSync(resolve(flumeDir, "inbox")).some((f) => f.endsWith(".md"));
    } catch (e) {
      return (e as NodeJS.ErrnoException).code !== "ENOENT";
    }
  }

  const SLICES: PlanSlice[] = [
    {
      name: INBOX,
      description: "Route every finding in .flume/inbox/ to an entry, a question, or accepted debt.",
      job: "Drain `.flume/inbox/`. Route each finding to a pending entry, an open question, or an accepted-debt line in the commit body — then delete the file it arrived in.",
      live: ({ flumeDir }) => inboxPending(flumeDir),
    },
    {
      name: DERIVE,
      description: "Re-derive .flume/plan/pending/ + state.md from disk.",
      job: "Re-derive the plan artifacts from current disk reality. Reconcile every entry against the spec section its `per` names, file what the spec states and the code does not, and rewrite state.md from scratch.",
      live: ({ pickable }) => !pickable,
    },
  ];

  /**
   * The phase to wake after a plan slice or a build wave: the first live
   * slice down the ladder, else build while anything is pickable, else
   * nobody — hibernation. `exclude` is the slice that just ran and committed
   * nothing: no progress, so no self-rewake, and an unroutable finding costs
   * one tick instead of a loop. A slice that committed and is still live (a
   * window wider than one tick's budget) does re-wake itself.
   */
  function nextPhase(flumeDir: string, pickable: boolean, exclude?: string): string[] {
    const live = SLICES.find((s) => s.name !== exclude && s.live({ flumeDir, pickable }));
    if (live) return [live.name];
    return pickable ? [build.name] : [];
  }

  /**
   * One `Phase` per slice. Both write the same artifacts, so both carry the
   * same fence and the same `pendingGate`; what a slice varies is the job it
   * is woken for, the material its prompt renders, and when it is live.
   *
   * Singleton: the queue and state.md are shared artifacts, and two
   * concurrent planners would race — which is also why the slices are a
   * ladder rather than a fanout.
   */
  const slicePhase = (slice: PlanSlice): Phase => ({
    name: slice.name,
    description: slice.description,
    promptPath: "prompts/plan.md",
    concurrency: "singleton",
    writablePaths: [
      // Rooted at the offset the engine reported, so a run under a relocated
      // `FLUME_DIR` fences the directory that run actually writes.
      // One entry per file, so the fence is the glob and not the directory
      // (`spec/pending.md`, *The ledger is a directory — one entry per file*).
      `${stateRoot}/plan/pending/*.json`,
      `${stateRoot}/plan/state.md`,
      `${stateRoot}/plan/open-questions.md`,
      // The inbox is drained by deletion, so the fence has to reach it.
      `${stateRoot}/inbox/**`,
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
      // The standing record is a reason to be woken, never a reason for a
      // slice to re-wake itself, so it is read here and not in `handoff`.
      const hasStandingAttempt = (ctx.priorAttempts?.size ?? 0) > 0;
      const pickable = (ctx.pickable ?? []).length > 0;
      return (
        (slice.name === DERIVE && hasStandingAttempt) ||
        slice.live({ flumeDir: ctx.flumeDir, pickable })
      );
    },
    promptArgs() {
      return {
        PENDING_SCHEMA: renderSchemaForPrompt(entryExtension),
        SLICE_JOB: slice.job,
      };
    },
    handoff(result) {
      return nextPhase(
        result.flumeDir,
        result.pickableAfter.length > 0,
        result.committed ? undefined : slice.name,
      );
    },
  });

  const planSlices: Phase[] = SLICES.map(slicePhase);

  // ---------- chain ----------

  const cascadeChain: Chain = {
    // Build first, the plan slices behind it in ladder order. This list is
    // the budget's priority, not the dependency ladder: the supervisor starts
    // one child per awake phase in declared order until
    // `supervisorPolicy.maxTicks` are running, and a bare `flume tick` takes
    // the first awake phase down it (spec/loop.md, *Which phases run*). At
    // the engine's default budget of one that order is the whole schedule, so
    // the product ships and the planners fill whatever room is left; a chain
    // that copies this list and declares no ladder inherits that economics
    // rather than the inverse. Which phase a tick hands the baton to is
    // `nextPhase`'s answer alone, and this line does not move it.
    phases: [build, ...planSlices],
    entryExtension,
    humanOnly: [], // every phase above is machine-woken; the spec corpus a human edits is not a phase
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
