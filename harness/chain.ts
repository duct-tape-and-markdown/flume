/**
 * The package's chain factory (`spec/harness.md`, *The phases*) — one
 * declaration in, a complete `Chain` out: the fanout build phase, the plan
 * slices a consumer enabled declared behind it, and for each of them the
 * package's prompt, gates, judge, windows, handoff and agent.
 *
 * **The assembly point, and nothing else.** Every part it wires already has
 * a home and its own tests — the gate set in `gates.ts`, the consumer's
 * declared gates in `declaredGates.ts`, the judge's gate in `judgeGate.ts`,
 * the wake set in `handoff.ts`, the windows in `windows.ts`, the args in
 * `prompts.ts`, the fields in `entryExtension.ts`, the ruling in `judge.ts`,
 * the plan artifacts' paths and the fence that is their list in `layout.ts`.
 * What is decided here is only what a `Phase` object needs that none of them
 * can answer alone: which of those fences each phase carries, which prompt
 * it addresses, which commit is a park, and the order the gates sit in.
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
 * **Nothing here re-derives a fact the engine reported.** The roots and the
 * state root's repo-relative offset come off `FlumeApi.paths`, the engine
 * values the gates run through arrive as `api` members rather than as
 * imports. What a tick reads per-tick — the
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
import type { FlumeApi } from "../src/flumeApi.js";
import type { Gate } from "../src/Gate.js";
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
import { constructGate } from "./declaredGates.js";
import { runnableShell, shellArgs } from "./declaredShell.js";
import { entryExtension } from "./entryExtension.js";
import { MAX_OUTPUT_BYTES } from "./exec.js";
import { harnessGates, type GateEngine } from "./gates.js";
import { defaultRefusesEntry, resolveHandoff } from "./handoff.js";
import { SESSIONS_REL } from "./ignores.js";
import { namedLinesGate } from "./judgeGate.js";
import { noteGlobs, parkedNotePath, planArtifacts } from "./layout.js";
import {
  BUILD_PROMPT_DATA_KEYS,
  PLAN_SLICE_PROMPT_DATA_KEYS,
  SHARED_PROMPT_DATA_KEYS,
  buildPromptArgs,
  planSlicePromptArgs,
  promptPath,
  sharedPromptArgs,
} from "./prompts.js";
import type { PlanSliceWindow } from "./sliceWindow.js";
import { planSliceWindows } from "./windows.js";

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
      isAncestor: api.git.isAncestor,
      statusRecords: api.git.statusRecords,
    },
  };

  const windows = planSliceWindows({
    declaration,
    repoRoot: api.paths.repoRoot,
  });

  /** The notes a build tick may write, as fence globs — one per kind. */
  const notes = noteGlobs(stateRoot);

  const agentFor = agentFactory(api, declaration);
  const setup = worktreeSetup(declaration, provision);

  /** One phase's shared prompt args, per tick, at the root the tick reports. */
  const shared = (ctx: TickContext): Record<string, string> =>
    sharedPromptArgs({ declaration, extension, stateRoot: ctx.flumeDir });

  /**
   * The package's discipline gates, then the consumer's, then whatever the
   * package judges for this phase — `harnessGates` places its four first,
   * and `own` trails the declared list (`spec/harness.md`, *What a consumer
   * declares*).
   *
   * Trailing is the point: the dispatcher runs a `when`'s gates in list
   * order and stops at the first refusal, and the package's judge is the
   * expensive one — it runs the consumer's suite, twice for a red line. A
   * consumer's seconds-long typecheck declared at the same `when` reports
   * its refusal before that minutes-long run rather than behind it. The four
   * stay ahead of both: they are claims about the commit itself, and each
   * costs a handful of at-ref reads.
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
        ...(declaration.gates?.[name] ?? []).map((gate) =>
          constructGate(api, gate, declaration.shell),
        ),
        ...own,
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
    // The artifacts this slice owns, whatever a consumer declared — taken
    // whole from the layout that states where each sits (`layout.ts`) rather
    // than assembled here, so an artifact added there joins this fence with
    // it. Per slice, because the plan state is one file per writer and the
    // fence is what holds a slice to its own (`planArtifacts`).
    //
    // Every path in it is in git's alphabet, which is the one the fence and a
    // commit's touched paths are compared in, and which the root arrives in
    // from `repoRelativeStateRoot`.
    const writablePaths = unique([
      ...planArtifacts(stateRoot, name),
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
      promptArgs: (ctx) => ({
        ...shared(ctx),
        ...planSlicePromptArgs(name, ctx.flumeDir),
        ...window.args(ctx),
      }),
      // Every value this phase substitutes is content it did not author, so
      // the engine neutralizes the inline-exec spans in all of them before
      // its own scan reads them as commands (`spec/prompt.md`, *The render
      // pipeline*). Both halves are read off the producers that build the
      // map above, never spelled again here.
      promptDataKeys: [
        ...SHARED_PROMPT_DATA_KEYS,
        ...PLAN_SLICE_PROMPT_DATA_KEYS,
        ...window.dataKeys,
      ],
      shouldRun: (ctx) =>
        window.live({
          flumeDir: ctx.flumeDir,
          // The dispatcher's own verdict when it handed one. Absent only on
          // a hand-built context, where "nothing pickable" is the reading
          // that runs the slice rather than the one that skips it.
          pickable: (ctx.pickable ?? []).length > 0,
          pending: ctx.pending,
          priorAttempts: ctx.priorAttempts,
          // The engine's carve-out runs every slice here over an unparseable
          // queue, because each declares the ledger writable — so this is the
          // fact that tells the one slice which can repair it from the two
          // which would rewrite it away (`spec/pending.md`, *Queue reads are
          // strict*).
          ...(ctx.queueParseFailure
            ? { queueParseFailure: ctx.queueParseFailure }
            : {}),
        }),
      handoff: handoffFor(name),
      ...(setup ? { setupWorktree: setup } : {}),
    };
  };

  /**
   * Whether this commit is a park: the entry's own note, written under the
   * parked directory (`spec/harness.md`, *Records as one file each* —
   * location is kind).
   *
   * The package's vocabulary, not the engine's — the engine reports that a
   * commit landed and which paths it touched, and what that *means* is the
   * chain's (`.claude/rules/engine-boundary.md`, *Told, not inferred*). What
   * it reads is **where** the tick wrote, and nothing about the shape of the
   * path list around it: a refusal that could not help leaving a half-edited
   * file behind is still a refusal, and a commit carrying an observation note
   * beside its work is a tick that shipped and had something to say. Told,
   * either way, rather than inferred from how much the commit touched.
   */
  const isPark = (entry: PendingEntry, touched: readonly string[]): boolean =>
    touched.includes(parkedNotePath(stateRoot, entry.tag));

  const buildWritablePaths = unique([...declaration.fence.build, ...notes]);

  const build: Phase = {
    name: BUILD_PHASE,
    description: DESCRIPTIONS[BUILD_PHASE],
    promptPath: promptPath(BUILD_PHASE),
    concurrency: "fanout",
    agent: agentFor(BUILD_PHASE),
    // The consumer's fence plus the package's own channel. The notes are the
    // package's, not the consumer's work, so a declaration that had to list
    // them would be the verbatim copy every consumer carries.
    writablePaths: buildWritablePaths,
    // The same globs again as a channel, on a scoped tick only: there the
    // write allowance narrows to the entry's declared files, which never name
    // a note, so without them the park the prompt promises would revert. Both
    // kinds, because a tick that could write an observation but not a park
    // would have the refusal reverted by the fence meant to carry it. On an
    // unscoped tick the fence above already admits them, and the engine
    // refuses a channel declared where nothing consults it
    // (`spec/pending.md`, *The entry-scoped write guard is opt-in, and off by
    // default*).
    ...(declaration.scopeWritesToEntry
      ? {
          scopeWritesToEntry: true,
          entryChannelPaths: unique([
            ...(declaration.channelPaths ?? []),
            ...notes,
          ]),
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
    // Build first, the enabled plan slices behind it in `PLAN_SLICES` order
    // — the sweep last of them, since that list already places insurance
    // behind product (`declaration.ts`). Declared order is what the
    // supervisor spends a short budget on, and the package leaves the budget
    // at the engine's default of one, so for a consumer that declares no
    // `supervisorPolicy` this line *is* the schedule: the product ships and
    // the slices fill whatever room is left. Order here, not a knob — a
    // consumer that wants more ticks at once raises its own budget
    // (`spec/harness.md`, *The phases*).
    phases: [build, ...windows.map(planPhase)],
    entryExtension: extension,
    // No phase the package ships consumes something a human authors between
    // runs: every slice's window is a fact of disk a sibling's handoff can
    // produce, so nothing here is handoff-unwakeable.
    humanOnly: [],
    // The package's per-entry refusal (`handoff.ts`), unconditional because
    // it is the floor: whatever handoff a phase runs, declared or default,
    // runs above it (`spec/harness.md`, *The default `handoff`*).
    refusesEntry: defaultRefusesEntry,
    // Whole, and unread: which strings an environment asserts is the
    // consumer's fact, and the engine's only use of one is matching it
    // against a `requiresCapability` entry's gate. Declared-but-empty
    // reaches the engine as declared — a load-time probe that found nothing
    // asserting none is a fact, not an omission.
    ...(declaration.capabilities ? { capabilities: declaration.capabilities } : {}),
    // The channel the engine guarantees the lifecycle of, handed over
    // unchanged: the engine refuses a path that escapes the state root at
    // this same load, and the package's own use of the value — the inbox
    // slice's friction leg (`inboxWindow.ts`) — reads the directory the
    // engine was told about rather than a second spelling of it. Absent
    // stays absent: an undeclared channel is the whole lifecycle off, never
    // a default this factory picks.
    ...(declaration.friction !== undefined
      ? { friction: declaration.friction }
      : {}),
    // The declared base as the function it was declared as, not a path this
    // factory evaluated: the engine runs it once per load against the roots
    // it resolved, and an operator's `FLUME_WORKTREES_DIR` outranks whatever
    // it answers. Absent stays absent — the engine's own
    // `<flumeDir>/worktrees` is an undeclared base's reading, never a
    // placement this factory picked for a consumer that named none.
    ...(declaration.worktreesBase !== undefined
      ? { worktreesBase: declaration.worktreesBase }
      : {}),
    ...(policy ? { supervisorPolicy: policy } : {}),
  };
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
 *
 * Every declared agent field is handed to the engine's own option of the
 * same name and nothing else: the MCP inheritance the declaration spells is
 * the engine's knob, defaulted by the engine when no consumer states one.
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
          ...(declared?.inheritUserMcp !== undefined
            ? { inheritUserMcp: declared.inheritUserMcp }
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
 *
 * Which is also why `setup.serialize` is honoured *here* rather than at
 * either caller: the queue is this reduction's own, so a wave's worktree
 * hooks and the base checkout the runner provisions take their turns in one
 * line. A second queue built beside this one would let the base checkout
 * warm the cache under a worktree that was promised exclusivity.
 */
function provisioning(
  api: FlumeApi,
  declaration: Declaration,
): (root: string) => Promise<void> {
  const setup = declaration.setup;
  if (setup === undefined) return (root) => api.setupWorktree(root);
  const install = installing(api, declaration, setup.restore);
  const walk = async (root: string): Promise<void> => {
    for (const directory of setup.directories) {
      await install(resolve(root, directory));
    }
  };
  // The restore alone, and one worktree's whole walk at a time: the claim a
  // consumer makes is about the command it wrote, and it makes it per
  // checkout, so a tree's directories are restored contiguously rather than
  // interleaved with another tree's. A declaration naming no restore is
  // provisioned by the engine's installer, which a wave has always run
  // concurrently and which this knob does not reach (`declaration.ts`).
  if (setup.restore === undefined || setup.serialize !== true) return walk;
  const turn = oneAtATime();
  return (root) => turn(() => walk(root));
}

/**
 * A queue of one: each job starts when the job before it has settled, in the
 * order the calls arrived.
 *
 * Settled, not fulfilled. A restore that throws is that entry's provisioning
 * failure and parks it alone (`spec/worktrees.md`, *`setupWorktree` and
 * `teardownWorktree` — the chain's provisioning hooks*), so the rejection
 * reaches the caller who queued it and the queue itself keeps its own tail
 * resolved — a wave whose first restore failed still hands the next worktree
 * its turn rather than rejecting every one behind it.
 */
function oneAtATime(): (job: () => Promise<void>) => Promise<void> {
  let tail: Promise<void> = Promise.resolve();
  return (job) => {
    const turn = tail.then(job);
    tail = turn.then(
      () => {},
      () => {},
    );
    return turn;
  };
}

/**
 * How one declared directory is installed: the engine's own lockfile-aware
 * install, or the consumer's `restore` under the shell the declaration
 * named.
 *
 * A restore is a command line the consumer wrote, so it takes the shell and
 * the invocation form every other such line takes — a gate's command, a
 * gate's script — rather than a spawn of its own beside them
 * (`declaredShell.ts`). The shell is resolved once here, at chain load: a
 * host that will not run it strands every worktree this hook provisions, and
 * a wave of entries each parking on its own setup is that refusal arriving
 * once per entry, hours late (`.claude/rules/engineering.md`, *Loud or
 * nothing*).
 */
function installing(
  api: FlumeApi,
  declaration: Declaration,
  restore: string | undefined,
): (cwd: string) => Promise<void> {
  if (restore === undefined) return (cwd) => api.setupWorktree(cwd);
  const shell = runnableShell(api, declaration.shell, `\`setup.restore\` "${restore}"`);
  return async (cwd) => {
    // The cap is this site's to state: a consumer's restore command is
    // arbitrary, its output is read by nothing here, and node's inherited
    // 1 MiB reports an overrun where an exit status would sit — a verbose
    // install arriving as a restore that never ran
    // (`.claude/rules/platform-facts.md`, *Node caps a captured child
    // stream at 1 MiB, and reports the overrun as a spawn failure*). One
    // number with the rest of the package's captures.
    await execFileWithShimRetry(shell, shellArgs(restore), {
      cwd,
      maxBuffer: MAX_OUTPUT_BYTES,
    });
  };
}

/**
 * The hook every provisioned worktree runs, or none when the consumer
 * declared no setup — a tree a consumer said nothing about gets no hook, and
 * the engine skips the step rather than installing on its own authority.
 *
 * A throw here parks that one entry rather than the wave
 * (`spec/worktrees.md`, *Every `.git/worktrees` mutation is serialized; the
 * agent fanout is not*).
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
 * The engine reports the offset already forward-slashed
 * (`api.paths.stateRootRel`), which is the alphabet every path this factory
 * composes from it needs — the queue, the plan state, the questions glob, the
 * record globs, build's note are each one a fence glob matches and a commit's
 * touched path is compared against. Read straight, so no path the factory
 * builds can be in a dialect its sibling is not.
 */
function repoRelativeStateRoot(api: FlumeApi): string {
  const rel = api.paths.stateRootRel;
  if (rel === undefined) {
    throw new Error(
      `the harness package's state root ${api.paths.flumeDir} resolves ` +
        `outside the repository at ${api.paths.repoRoot}, so its queue, its ` +
        `records and build's park note are paths no commit can hold ` +
        `(spec/harness.md, Committed-path discipline)`,
    );
  }
  return rel;
}

/** The globs, in declared order, each appearing once. */
function unique(globs: readonly string[]): string[] {
  return [...new Set(globs)];
}
