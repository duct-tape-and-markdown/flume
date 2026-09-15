/**
 * The package's chain factory (`spec/harness.md`, *The phases*) — one
 * declaration in, a complete `Chain` out: the three plan slices a consumer
 * enabled, the fanout build phase, and for each of them the package's
 * prompt, gates, judge, windows, handoff and agent.
 *
 * **The assembly point, and nothing else.** Every part it wires already has
 * a home and its own tests — the gate set in `gates.ts`, the ladder in
 * `handoff.ts`, the windows in `windows.ts`, the args in `prompts.ts`, the
 * fields in `entryExtension.ts`, the ruling in `judge.ts`. What is decided
 * here is only what a `Phase` object needs that none of them can answer
 * alone: which fence each phase carries, which prompt it addresses, and the
 * order the gates sit in.
 *
 * **The declaration is parsed here, not by the consumer.** The whole of
 * adoption is one declaration module and the hop that applies this factory
 * to it, so a `parseDeclaration` call in every consumer's `chain.ts` would
 * be the verbatim copy that names a missing surface
 * (`.claude/rules/engine-boundary.md`, *Surface, not prescription*). Taking
 * the value unparsed makes the schema's refusal a fact of chain load rather
 * than of a consumer's discipline (`spec/harness.md`, *What a consumer
 * declares*).
 *
 * **Nothing here re-derives a fact the engine reported.** The roots come off
 * `FlumeApi.paths`, the state root's repo-relative offset off the engine's
 * own `computeStateRootRel`, the engine values the gates run through arrive
 * as `api` members rather than as imports. What a tick reads per-tick — the
 * queue, the pickable set, the prior attempts, the assigned entry — is read
 * off the `TickContext` the dispatcher hands the hook
 * (`.claude/rules/engine-boundary.md`, *Told, not inferred*).
 *
 * **A consumer enables or disables slices; it does not re-author them.**
 * There is no seam here for a consumer's own phase, prompt or description:
 * what it wants to change it declares (the fence, the gates, the agent, the
 * handoff, the slots), and a prompt or judge it wants belongs in `harness/`
 * where every consumer gets it.
 */

import { resolve } from "node:path";

import type { Agent } from "../src/Agent.js";
import { computeStateRootRel } from "../src/Dispatcher.js";
import type { FlumeApi } from "../src/flumeApi.js";
import type { Gate, GateContext, GatePhase, GateResult } from "../src/Gate.js";
import { gitPath, resolvePendingPath } from "../src/paths.js";
import type { EntryExtension, PendingEntry } from "../src/PendingSchema.js";
import type { Chain, Phase, TickContext } from "../src/Phase.js";
import { execFileWithShimRetry } from "../src/spawnShim.js";

import {
  BUILD_PHASE,
  parseDeclaration,
  type Declaration,
  type HarnessPhase,
  type PlanSlice,
} from "./declaration.js";
import { NamedLinesSchema, entryExtension } from "./entryExtension.js";
import { harnessGates, type GateEngine } from "./gates.js";
import { resolveHandoff } from "./handoff.js";
import { SESSIONS_REL } from "./ignores.js";
import { judgeNamedLines, type JudgeVerdict } from "./judge.js";
import { planStatePath } from "./planState.js";
import {
  BUILD_PROMPT_DATA_KEYS,
  SHARED_PROMPT_DATA_KEYS,
  buildPromptArgs,
  promptPath,
  questionsPath,
  sharedPromptArgs,
} from "./prompts.js";
import { notePath, notesDir, recordDirs } from "./records.js";
import type { Runner } from "./runner.js";
import { planSliceWindows, type PlanSliceWindow } from "./windows.js";

/**
 * One line per phase, as `flume status` and the dispatcher's log print it.
 * Keyed exhaustively by {@link HarnessPhase}, so a phase the package adds
 * without a description is a typecheck failure rather than a blank line.
 */
const DESCRIPTIONS: Record<HarnessPhase, string> = {
  "plan-inbox":
    "Drain the records and the build refusals still standing: route each to an entry, a question, or accepted debt.",
  "plan-derive":
    "Derive the contract changes past the derive cursor into pending entries.",
  "plan-sweep":
    "Sweep one neighborhood of the posture rotation against the declared posture pages.",
  build: "Ship one (or N disjoint) pending entries to the trunk.",
};

/**
 * One gate a consumer declared, as the declaration's own union — read off
 * the schema's inferred type rather than respelled here, so a kind the
 * declaration adds is a typecheck failure at {@link constructGate} instead
 * of a shape that falls through its switch
 * (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*).
 */
type GateDeclaration = NonNullable<
  NonNullable<Declaration["gates"]>[typeof BUILD_PHASE]
>[number];

/** What {@link harnessChain} needs to build a consumer's chain. */
export interface HarnessChainOptions {
  /**
   * The engine surface the chain factory was handed. Every engine value the
   * chain composes with comes from here rather than from an import, for the
   * reason a `chain.ts` takes it: a second physical engine in one process
   * stays unreachable (`src/flumeApi.ts`).
   */
  readonly api: FlumeApi;
  /**
   * The consumer's declaration module, unparsed. Validated here through the
   * package's strict schema; an unknown field or a missing required one
   * refuses the load naming the field.
   */
  readonly declaration: unknown;
  /**
   * The consumer's own entry-extension fields, merged beside the package's
   * six. A consumer may add fields; a key naming one of the package's is
   * refused (`entryExtension.ts`).
   */
  readonly entryFields?: EntryExtension | undefined;
}

/**
 * The chain a consumer's declaration describes.
 *
 * Refuses a state root outside the repository: every mechanic this factory
 * wires addresses a path some commit holds (`spec/harness.md`,
 * *Committed-path discipline*), and a relocated root has none. Refused once,
 * at load, rather than silently yielding a chain whose every tick skips its
 * own gates (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
export function harnessChain(options: HarnessChainOptions): Chain {
  const { api } = options;
  const declaration = parseDeclaration(options.declaration);
  const stateRoot = repoRelativeStateRoot(api);

  /**
   * Provisioning one checkout, reduced from the declared `setup` — the same
   * reduction the build worktree's hook runs, and the one the runner factory
   * is handed below rather than a second one built for it
   * (`spec/harness.md`, *The runner interface*).
   */
  const provision = provisioning(api, declaration);

  /**
   * The consumer's runner, built here and once: the declaration carries a
   * factory precisely so the value it returns can take the worktree base off
   * the API this factory was handed and provision a base checkout the way
   * this consumer provisions a build worktree, rather than off a second
   * engine surface and a second install rule resolved beside their
   * declaration (`spec/harness.md`, *The runner interface*).
   */
  const runner = declaration.runner({ api, provision });

  /**
   * The entry extension, composed ahead of every prompt that renders it and
   * behind the runner that informs it: the running lane's exclusions ride
   * the `tests[]` and `pins[]` hints, so plan names its lines already knowing
   * which globs the judge will not reach (`spec/harness.md`, *The runner
   * interface*). Told once, at authorship — nothing downstream refuses an
   * entry over where its `files` predicted the work would land.
   */
  const extension = entryExtension(options.entryFields, runner.lanes);

  /**
   * The engine values the package's gates run through, taken off `api` —
   * the shape `gates.ts` names rather than the functions it declined to
   * import.
   */
  const engine: GateEngine = {
    pendingGate: api.pendingGate,
    git: {
      readFileAtRef: api.git.readFileAtRef,
      statusRecords: api.git.statusRecords,
    },
  };

  const windows = planSliceWindows({
    declaration,
    repoRoot: api.paths.repoRoot,
  });

  /** The one note a build tick may write, as a fence glob. */
  const noteGlob = `${notesDir(stateRoot)}/*.md`;

  /**
   * The artifacts the package's plan slices own, whatever a consumer
   * declared — composed from the modules that own each path rather than
   * spelled here, so a layout rename moves the fence with it.
   *
   * The record queues ride it because a slice drains a record by deleting
   * its file; the records gate is what refuses a slice that writes one
   * instead.
   *
   * The queue alone is re-converted: `resolvePendingPath` composes with
   * `node:path`, so it re-dialects the root this factory already normalized.
   * Every other path here is slash-joined by the module that owns it and
   * arrives in git's alphabet from {@link repoRelativeStateRoot}.
   */
  const planArtifacts = [
    gitPath(resolvePendingPath(stateRoot)),
    planStatePath(stateRoot),
    questionsPath(stateRoot),
    ...recordDirs(stateRoot).map((dir) => `${dir}/*.md`),
  ];

  const agentFor = agentFactory(api, declaration);
  const setup = worktreeSetup(declaration, provision);

  /** One phase's shared prompt args, per tick, at the root the tick reports. */
  const shared = (ctx: TickContext): Record<string, string> =>
    sharedPromptArgs({ declaration, extension, stateRoot: ctx.flumeDir });

  /**
   * The package's own gates, then the consumer's — `harnessGates` places its
   * four first, and anything the package adds for a phase leads the declared
   * list so nothing a consumer declares can precede it.
   */
  const gatesFor = (
    phase: Pick<Phase, "writablePaths">,
    name: HarnessPhase,
    own: readonly Gate[] = [],
  ): Gate[] =>
    harnessGates({
      phase,
      declaration,
      engine,
      ...(options.entryFields ? { entryFields: options.entryFields } : {}),
      declared: [
        ...own,
        ...(declaration.gates?.[name] ?? []).map((gate) =>
          constructGate(api, gate),
        ),
      ],
    });

  const handoffFor = (name: HarnessPhase): Phase["handoff"] =>
    resolveHandoff({
      phase: name,
      declared: declaration.handoff,
      slices: windows,
    });

  const planPhase = (window: PlanSliceWindow): Phase => {
    const name: PlanSlice = window.name;
    const writablePaths = unique([
      ...planArtifacts,
      ...(declaration.fence[name] ?? []),
    ]);
    return {
      name,
      description: DESCRIPTIONS[name],
      promptPath: promptPath(name),
      concurrency: "singleton",
      agent: agentFor(name),
      writablePaths,
      gates: gatesFor({ writablePaths }, name),
      // The window is one derivation with two readers: the predicate that
      // decides whether this slice runs, and the material its prompt
      // renders (`windows.ts`). Both come off the same value here, so a
      // slice cannot be woken over a window its prompt then shows as empty.
      promptArgs: (ctx) => ({ ...shared(ctx), ...window.args(ctx) }),
      // Every value this phase substitutes is content it did not author, so
      // the engine neutralizes the inline-exec spans in all of them before
      // its own scan reads them as commands (`spec/prompt.md`, *The render
      // pipeline*). Both halves are read off the producers that build the
      // map above, never spelled again here.
      promptDataKeys: [...SHARED_PROMPT_DATA_KEYS, ...window.dataKeys],
      shouldRun: (ctx) =>
        window.live({
          flumeDir: ctx.flumeDir,
          // The dispatcher's own verdict when it handed one. Absent only on
          // a hand-built context, where "nothing pickable" is the reading
          // that runs the slice rather than the one that skips it.
          pickable: (ctx.pickable ?? []).length > 0,
          pending: ctx.pending,
          priorAttempts: ctx.priorAttempts,
        }),
      handoff: handoffFor(name),
      ...(setup ? { setupWorktree: setup } : {}),
    };
  };

  /**
   * Whether this commit is a park: the entry's own note and nothing else.
   *
   * The package's vocabulary, not the engine's — the engine reports that a
   * commit landed and which paths it touched, and what that *means* is the
   * chain's (`.claude/rules/engine-boundary.md`, *Told, not inferred*). The
   * shape is the build prompt's other half: a tick that cannot ship its
   * entry as written commits the note alone, and this reads exactly that
   * back. A tests-only commit is a ship; only the note is a park.
   */
  const isPark = (entry: PendingEntry, touched: readonly string[]): boolean =>
    touched.length === 1 && touched[0] === notePath(stateRoot, entry.tag);

  const buildWritablePaths = unique([...declaration.fence.build, noteGlob]);

  const build: Phase = {
    name: BUILD_PHASE,
    description: DESCRIPTIONS[BUILD_PHASE],
    promptPath: promptPath(BUILD_PHASE),
    concurrency: "fanout",
    agent: agentFor(BUILD_PHASE),
    // The consumer's fence plus the package's own channel. The note is the
    // package's, not the consumer's work, so a declaration that had to list
    // it would be the verbatim copy every consumer carries.
    writablePaths: buildWritablePaths,
    // Same glob again as a channel, on a scoped tick only: there the write
    // allowance narrows to the entry's declared files, which never name a
    // note, so without it the park the prompt promises would revert. On an
    // unscoped tick the fence above already admits the note, and the engine
    // refuses a channel declared where nothing consults it
    // (`spec/pending.md`, *The entry-scoped write guard is opt-in*).
    ...(declaration.scopeWritesToEntry
      ? {
          scopeWritesToEntry: true,
          entryChannelPaths: unique([...(declaration.channelPaths ?? []), noteGlob]),
        }
      : {}),
    gates: gatesFor({ writablePaths: buildWritablePaths }, BUILD_PHASE, [
      namedLinesGate(runner, isPark),
    ]),
    promptArgs: (ctx) => ({
      ...shared(ctx),
      ...buildPromptArgs({ declaration, ctx }),
    }),
    // As above, and build is where it bites hardest: an entry's own prose
    // and the spec section its `per` cites are both routinely the text that
    // *documents* the span grammar.
    promptDataKeys: [...SHARED_PROMPT_DATA_KEYS, ...BUILD_PROMPT_DATA_KEYS],
    shipped: ({ entry, touchedPaths }) => !isPark(entry, touchedPaths),
    handoff: handoffFor(BUILD_PHASE),
    ...(setup ? { setupWorktree: setup } : {}),
  };

  const policy = supervisorPolicy(declaration.supervisor);
  return {
    phases: [...windows.map(planPhase), build],
    entryExtension: extension,
    // No phase the package ships consumes something a human authors between
    // runs: every slice's window is a fact of disk a sibling's handoff can
    // produce, so nothing here is handoff-unwakeable.
    humanOnly: [],
    ...(policy ? { supervisorPolicy: policy } : {}),
  };
}

// ------------------------------------------------------------- the judge

/**
 * The judge as a gate on the merged tree (`spec/harness.md`, *The judges*):
 * the consumer's suite is green, every `tests[]` line has a passing test
 * that fails at the base, and every `pins[]` line has one here.
 *
 * `afterMerge`, not `afterCommit`: under fanout, N parallel suites contend
 * for the host and revert clean commits on timing alone, while an
 * `afterMerge` revert is per-entry. The base half needs a base sha, which
 * is a fact of the gated span either way.
 *
 * A park is not judged. Its named lines belong to work the park did not
 * attempt, and judging them would revert the note — throwing away the one
 * channel the tick had for saying why it could not ship. Spelled as a skip
 * rather than an unexplained green (`.claude/rules/engineering.md`, *A green
 * verdict is proven non-vacuous*).
 */
function namedLinesGate(
  runner: Runner,
  isPark: (entry: PendingEntry, touched: readonly string[]) => boolean,
): Gate {
  return {
    name: "named lines",
    when: "afterMerge",
    async run(ctx: GateContext): Promise<GateResult> {
      const entry = ctx.entry;
      if (entry === undefined) {
        return {
          ok: true,
          message: "no entry on this span",
          skipped: "the judge rules on one entry's named lines",
        };
      }
      if (isPark(entry, ctx.touchedPaths)) {
        return {
          ok: true,
          message: `${entry.tag}: parked — the note alone`,
          skipped: "a park attempts none of the entry's named lines",
        };
      }
      const verdict = await judgeNamedLines(runner, {
        tests: NamedLinesSchema.parse(entry.tests),
        pins: NamedLinesSchema.parse(entry.pins),
        baseSha: ctx.baseSha,
        cwd: ctx.repoRoot,
      });
      if (verdict.outcome === "proven") {
        return { ok: true, message: verdict.message };
      }
      if (verdict.outcome === "empty") {
        // The entry named no behavior, and the suite is green over it. The
        // empty case is asserted rather than inherited: what it costs is
        // the chain's policy, and this package's is "nothing" — plan not
        // naming a line is plan's defect to fix, not this commit's.
        return {
          ok: true,
          message: verdict.message,
          skipped: "the entry named no line to judge",
        };
      }
      return {
        ok: false,
        message: verdict.message,
        details: details(verdict),
        ...(verdict.failingFiles.length > 0
          ? { failingFiles: [...verdict.failingFiles] }
          : {}),
      };
    },
  };
}

/**
 * Every fact the judge ruled from, one line each — the line verdicts the
 * agent has to act on, then the failures the suite reported.
 *
 * Composed from the verdict's own fields rather than parsed back out of its
 * message: the judge reports facts precisely so a caller does not have to
 * pattern-match its prose (`.claude/rules/engineering.md`, *A fact the
 * engine holds is reported, never rediscovered*).
 */
function details(verdict: JudgeVerdict): string {
  const lines = verdict.lines.map(
    (line) =>
      `${line.lane}[] ${line.state}: ${JSON.stringify(line.line)}` +
      (line.files.length > 0 ? ` (${line.files.join(", ")})` : ""),
  );
  const failures = verdict.failures.map(
    (failure) =>
      `FAIL ${failure.file}${failure.name ? ` × ${failure.name}` : ""}: ${failure.message}`,
  );
  return [...lines, ...failures].join("\n");
}

// ------------------------------------------------- the consumer's gates

/**
 * The gates a consumer may hang on a phase by name — the engine's own
 * builtins that need nothing but a gate point, keyed by each one's own
 * `name` rather than by a second spelling of it.
 *
 * `chain-load` is spread rather than called: it is a plain `Gate`, so the
 * only thing a declaration can move on it is where it runs.
 */
function registry(api: FlumeApi): Record<string, (when: GatePhase) => Gate> {
  const entries: readonly [Gate, (when: GatePhase) => Gate][] = [
    [api.tscGate, (when) => api.tscGate({ when })],
    [api.vitestGate, (when) => api.vitestGate({ when })],
    [api.eslintGate, (when) => api.eslintGate({ when })],
    [api.chainLoadGate, (when) => ({ ...api.chainLoadGate, when })],
  ];
  return Object.fromEntries(entries.map(([gate, make]) => [gate.name, make]));
}

/**
 * One declared gate as the `Gate` the phase runs.
 *
 * A registry name the package does not ship is refused at load naming the
 * set it could have been — the other half of the declaration schema's
 * ruling that a name is any non-empty string until the factory reads it
 * (`declaration.ts`). A shell command and a committed script are one
 * mechanism with two names: both run through `sh -c` in the gate's own tree,
 * which resolves a relative path against that tree and honours a script's
 * own shebang.
 */
function constructGate(api: FlumeApi, declared: GateDeclaration): Gate {
  switch (declared.kind) {
    case "registry": {
      const table = registry(api);
      const make = table[declared.name];
      if (make === undefined) {
        throw new Error(
          `gate "${declared.name}" is not one the harness package's registry ` +
            `ships — declare one of ${Object.keys(table)
              .map((name) => `\`${name}\``)
              .join(", ")}, or a \`shell\`/\`script\` gate ` +
            `(spec/harness.md, What a consumer declares)`,
        );
      }
      return make(declared.when);
    }
    case "shell":
      return shellCommand(api, declared.command, declared.when);
    case "script":
      return shellCommand(api, declared.path, declared.when);
  }
}

/** A command line as a gate, named by the line itself. */
function shellCommand(api: FlumeApi, command: string, when: GatePhase): Gate {
  return api.shellGate({ name: command, when, cmd: "sh", args: ["-c", command] });
}

// ------------------------------------------------- agents and provisioning

/**
 * The package's agent for one phase: `claude -p` streaming structured
 * events, its raw stream teed under the state root and a condensed
 * one-line-per-tool-call summary on the dispatcher's stdout.
 *
 * The model is not one of the package's opinions — undeclared, the flag is
 * omitted and the binary's own default applies, which is the difference
 * between a consumer choosing a tier and inheriting one it has to discover
 * to turn off (`.claude/rules/engine-boundary.md`, *Surface, not
 * prescription*). What the package does choose is the shape: a transcript
 * per tick, because a loop nobody can read back is a loop nobody can cost.
 */
function agentFactory(
  api: FlumeApi,
  declaration: Declaration,
): (phase: HarnessPhase) => Agent {
  const dir = resolve(api.paths.flumeDir, SESSIONS_REL);
  return (phase) => {
    const declared = declaration.agents?.[phase];
    return api.withTerminalRenderer(
      api.withSessionCapture(
        api.claudeCode({
          outputFormat: "stream-json",
          ...(declared?.model !== undefined ? { model: declared.model } : {}),
          ...(declared?.extraArgs !== undefined
            ? { extraArgs: [...declared.extraArgs] }
            : {}),
        }),
        { dir },
      ),
    );
  };
}

/**
 * The declared `setup`, reduced to provisioning one checkout at its root.
 *
 * `directories` says where, `restore` says how: undeclared, each directory
 * gets the engine's own lockfile-aware install; declared, the command runs
 * in each directory instead — which is what a consumer whose stack has no
 * lockfile the engine reads (cargo, dotnet, a script) declares. With no
 * setup declared at all the root itself gets the engine's installer, which
 * is what a base checkout needs to run a suite and what a build worktree of
 * such a consumer inherits from its own tree.
 *
 * One reduction, two callers: the worktree hook below and the runner factory
 * above. A second one built beside either would be a chain restating what
 * this one already decides (`.claude/rules/engineering.md`, *Derived state
 * is computed, never restated beside its source*).
 */
function provisioning(
  api: FlumeApi,
  declaration: Declaration,
): (root: string) => Promise<void> {
  const setup = declaration.setup;
  if (setup === undefined) return (root) => api.setupWorktree(root);
  return async (root) => {
    for (const directory of setup.directories) {
      const cwd = resolve(root, directory);
      if (setup.restore === undefined) {
        await api.setupWorktree(cwd);
        continue;
      }
      await execFileWithShimRetry("sh", ["-c", setup.restore], { cwd });
    }
  };
}

/**
 * The hook every provisioned worktree runs, or none when the consumer
 * declared no setup — a tree a consumer said nothing about gets no hook, and
 * the engine skips the step rather than installing on its own authority.
 *
 * A throw here parks that one entry rather than the wave
 * (`spec/worktrees.md`, *Provisioning failure is isolated to the entry that
 * hit it*).
 */
function worktreeSetup(
  declaration: Declaration,
  provision: (root: string) => Promise<void>,
): Phase["setupWorktree"] | undefined {
  if (declaration.setup === undefined) return undefined;
  return async ({ worktreePath }) => {
    await provision(worktreePath);
  };
}

// ------------------------------------------------------------- the small

/**
 * The declared supervisor policy as the engine's own block, whole.
 *
 * Copied key by key rather than knob by knob: the declaration's shape is
 * tied to the engine's by type (`declaration.ts`), so a knob the engine adds
 * rides through here without this function being touched. Keys holding
 * nothing are dropped, because the engine reads an omitted field as "use my
 * default" and a present `undefined` as a value.
 */
function supervisorPolicy(
  declared: Declaration["supervisor"],
): Chain["supervisorPolicy"] {
  if (declared === undefined) return undefined;
  return Object.fromEntries(
    Object.entries(declared).filter(([, value]) => value !== undefined),
  ) as NonNullable<Chain["supervisorPolicy"]>;
}

/**
 * The state root as the repository addresses it — a **git path**, forward-
 * slashed — or a refusal naming both roots.
 *
 * The engine reports the offset in the host's own dialect (`relative`, so a
 * nested root under win32 arrives backslash-separated). Converted once, here,
 * through the engine's own rule (`gitPath`, `src/paths.ts`): every path this
 * factory composes from this value — the queue, the plan state, the questions
 * file, the record globs, build's note — is one a fence glob matches and a
 * commit's touched path is compared against, and all of those are git's
 * alphabet. One conversion rather than one per composition, so no path the
 * factory builds can be in a dialect its sibling is not.
 */
function repoRelativeStateRoot(api: FlumeApi): string {
  const rel = computeStateRootRel(api.paths.repoRoot, api.paths.flumeDir);
  if (rel === undefined) {
    throw new Error(
      `the harness package's state root ${api.paths.flumeDir} resolves ` +
        `outside the repository at ${api.paths.repoRoot}, so its queue, its ` +
        `records and build's park note are paths no commit can hold ` +
        `(spec/harness.md, Committed-path discipline)`,
    );
  }
  return gitPath(rel);
}

/** The globs, in declared order, each appearing once. */
function unique(globs: readonly string[]): string[] {
  return [...new Set(globs)];
}
