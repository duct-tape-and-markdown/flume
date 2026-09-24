/**
 * Either lane's spawn scan: which of its cases and hooks start a process,
 * which of the files holding them declare the shared budget
 * (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`), which registrars under
 * such a declaration override it with a ceiling of their own, and which of the
 * spawning sites await a wall-clock timer between the spawn and the assertion
 * downstream of it.
 *
 * A source scan rather than a runtime probe, because both properties are what
 * a site *declares*: a budget observable only once a case has already run long
 * is no defence against the flake it exists to prevent, and a fixed sleep that
 * is long enough on the host that wrote it reports nothing until the lane is
 * under contention (spec/worktrees.md, "The default test lane must stay fast").
 *
 * The lane is a parameter, not a constant: the same cost drivers name both
 * lanes, and the sleep the scan reports is one the integration lane is the
 * likelier home for. Which mode selects which lane is read off the scripts
 * that run them.
 *
 * Nothing here holds a second copy of a lane's vocabulary — the spawn wrappers
 * are read out of the helper modules that hold them, the budget names out of
 * the exported numbers of the one module that holds those, each lane's vitest
 * mode out of `package.json`, and which files a lane contains out of
 * `vitest.config.ts`, so a wrapper, a rename, or
 * a widened include arms the scan without a second edit
 * (`.claude/rules/engineering.md`, *Derived state is computed, never restated
 * beside its source*). The three lists held here are `SPAWN_COMMANDS`,
 * `SHELL_ENTRIES` and `TIMERS`, none of which has a source to be read off;
 * each is declared at its site below rather than left looking derived.
 */

import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

import ts from "typescript";
import { configDefaults } from "vitest/config";

import {
  REPO_ROOT,
  filesUnder,
  parseScopeless,
  relPath,
  type FileWalk,
  type Scan,
  type ScanSite,
} from "./repoProgram.ts";

const TESTS_DIR = join(REPO_ROOT, "tests");

/**
 * The module the lane's budget lives in — keyed by the job, not by whatever
 * else a helper file has accumulated. The scan reads its exported numbers for
 * the ones a site is allowed to name, so a budget named from anywhere else is
 * not the lane's. Its spawning exports are read the way every helper's are
 * ({@link helperSpawnExports}); what is particular to this module is the
 * number.
 */
const SPAWN_WRAPPERS = join(TESTS_DIR, "helpers", "subprocess.ts");

/** The file name a suite spells that import as. */
const SPAWN_WRAPPERS_NAME = basename(SPAWN_WRAPPERS);

/** Vitest's registrars — the calls that can carry a per-site timeout. */
const CASE = /^(it|test)$/;
const HOOK = /^(beforeAll|beforeEach|afterAll|afterEach)$/;

/**
 * The node binary, as a name the propagation below can carry: a suite that
 * spawns an entry point directly pays the same Node startup as one going
 * through a wrapper, so the scan tracks the two as one.
 */
const EXEC_PATH = "process.execPath";

/**
 * A startup spelled as a command *name*, folded to one name the propagation
 * carries exactly like `EXEC_PATH`: a case that hands `"node"` to a gate,
 * shells out to `npm`, or runs `git` plumbing on a temp fixture pays a
 * process startup the lane's budget exists for just as a case holding
 * `process.execPath` does.
 */
const SPAWN_COMMAND = "<spawn command>";

/**
 * Which command names are that startup. This list is the one copy — no
 * surface in this repo enumerates them, so unlike the lane's globs, the
 * spawn wrappers and the budget's number there is nothing to read it off
 * (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*: declared here rather than looking derived).
 *
 * The node launchers, and `git`. A name that merely *runs under* node once a
 * launcher has started it — `tsc`, `vitest`, a bin on PATH — is already
 * covered by the launcher that spawns it, and listing it would flag prose.
 * `git` is not a lane trigger — raw plumbing on temp fixtures stays in the
 * default lane — but it is a spawn all the same, and the file that runs it
 * declares the budget the same way (spec/worktrees.md, "The default test lane
 * must stay fast"): a git-only file inheriting the runner's 5s default has
 * already crossed it on a slow host, taking its teardown hook down with it.
 *
 * Over-approximating on the same trade the propagation below takes: a name
 * asserted on rather than handed to a runner, or handed to a mocked one,
 * reads as a startup here and costs the file one declared ceiling it never
 * pays. A missed one costs the flake, which is the cost this scan exists to
 * prevent.
 */
const SPAWN_COMMANDS: ReadonlySet<string> = new Set([
  "git",
  "node",
  "npm",
  "npx",
  "pnpm",
  "pnpx",
  "tsx",
  "yarn",
]);

/**
 * The engine entries that start a process of their own, as names the
 * propagation carries alongside the two node spellings. `renderPrompt`
 * (`src/Prompt.ts`) runs every inline-exec span in the template it renders
 * through a fresh `sh`, so a case whose subject is a shipped template's spans
 * pays one process startup per span — several per case, and a whole suite of
 * them per file.
 *
 * `sh` is no command name a case spells, so `SPAWN_COMMANDS` cannot reach
 * this; and the propagation follows a helper import under `tests/` and no
 * other, so the spawn inside the engine module is invisible from a lane file.
 * The entry the spans go through is the name the scan can see, declared here
 * for the same reason `SPAWN_COMMANDS` is: no surface enumerates it. Reading
 * `src/` the way a helper is read is a wider scan than this one — it would
 * have to know node's own spawn surface, which is the vocabulary these lists
 * stand in for.
 *
 * Over-approximating on the propagation's standing trade — a render over a
 * template with no spans starts nothing and still costs its case one declared
 * ceiling, while a missed one costs the flake this scan exists to prevent
 * (a span-rendering case timed out on vitest's 5s default under the
 * afterMerge gate's full-suite contention, reverting an innocent entry).
 */
const SHELL_ENTRIES: readonly string[] = ["renderPrompt"];

/** Every spelling of a process startup, as the propagation's seed. */
const PROCESS_STARTS: readonly string[] = [
  EXEC_PATH,
  SPAWN_COMMAND,
  ...SHELL_ENTRIES,
];

/**
 * The wall-clock timers, as the second propagation's seed. A case that starts
 * a process and then awaits one of these is sleeping a guess at how long the
 * startup takes — calibrated on a host running one file, and short under the
 * contention both lanes run their files with (spec/worktrees.md, "The default
 * test lane must stay fast": a load-sensitive timing assertion belongs in
 * neither lane until it is event-based).
 *
 * Deliberately absent, and the absences are the vocabulary's edges:
 *
 * - **Fake-timer advancement** (`vi.advanceTimersByTimeAsync`). Virtual time
 *   costs no wall clock and is load-insensitive by construction — it is what
 *   a timing claim is rewritten into, not the defect.
 * - **A helper module's internals.** The timer propagation is seeded per lane
 *   file from this list alone and follows no import — unlike the spawn seed,
 *   which reads a helper's reach — so `waitFor` (tests/helpers/waitFor.ts)
 *   reads as what it is — an event-based wait that happens to be built on
 *   `setTimeout` — rather than as the sleep it replaced. The bound that buys
 *   that: a sleep hidden behind a new helper module is invisible here, and
 *   the call site is where this scan looks.
 */
const TIMERS: readonly string[] = ["setTimeout", "setInterval"];

export interface SpawnSite extends ScanSite {
  /** The case's title, or a `<module>:<line>` stand-in for a hook. */
  readonly title: string;
  readonly kind: "case" | "hook";
  /**
   * The name this site awaits that reaches a wall-clock timer — the local
   * wrapper's name where there is one, `setTimeout` where the sleep is
   * inline — or `null` when it awaits none.
   */
  readonly awaitedTimer: string | null;
  /**
   * The ceiling this registrar carries of its own, as the source spells it —
   * or `null` when it carries none, and when the one it carries *names* a
   * harness budget.
   *
   * Those two are one answer because they are one outcome: a site that names
   * the budget and a site that inherits it from the file-scope declaration
   * both run under the lane's single number. A literal is the other outcome
   * whichever side of that declaration it sits on — vitest resolves the
   * registrar's own argument last, so a per-case number silently overrides
   * the file's budget in either direction, and 250 of them across eight
   * files is the lane's one number restated per case.
   */
  readonly ownCeiling: string | null;
}

/**
 * The script that runs each lane, per `spec/worktrees.md`: the afterMerge gate
 * invokes the default lane as `pnpm test`, and the integration lane runs at
 * the host via `pnpm test:integration`. The binding from a lane's name to its
 * script is the one copy here; the mode each selects is read off the script
 * itself.
 */
const LANE_SCRIPTS = {
  default: "test",
  integration: "test:integration",
} as const;

/** The lanes this repo's suite is split into. */
export type Lane = keyof typeof LANE_SCRIPTS;

/** Both of them, in a form a scan can iterate. */
export const LANES: readonly Lane[] = Object.keys(LANE_SCRIPTS) as Lane[];

/**
 * The mode vitest runs in when a run passes no `--mode` — which is how the
 * afterMerge gate invokes it. No surface declares this; it is vitest's own
 * default, declared here rather than left looking derived.
 */
const VITEST_DEFAULT_MODE = "test";

/** `--mode <name>` as a package script spells it. */
const MODE_FLAG = /(?:^|\s)--mode[\s=]+(\S+)/;

/**
 * The vitest mode a lane's script selects, off `package.json` rather than
 * spelled here: the scan then judges the lane the script actually runs, so a
 * renamed mode reds instead of quietly scanning the other lane
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*).
 */
export function laneMode(lane: Lane): string {
  const name = LANE_SCRIPTS[lane];
  const { scripts = {} } = JSON.parse(
    readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  const script = scripts[name];
  if (typeof script !== "string")
    throw new Error(
      `package.json declares no \`${name}\` script; the spawn scan reads the ` +
        `${lane} lane's vitest mode from it`,
    );
  if (!/(?:^|\s)vitest(?:\s|$)/.test(script))
    throw new Error(
      `package.json's \`${name}\` script does not run vitest ('${script}'); ` +
        `the spawn scan would read a mode no lane is selected by`,
    );
  return MODE_FLAG.exec(script)?.[1] ?? VITEST_DEFAULT_MODE;
}

/** One lane's file selection, as `vitest.config.ts` hands it over. */
export interface LaneGlobs {
  /** Which lane asked, so a refusal below names it. */
  readonly lane: Lane;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
}

/**
 * That selection reduced to the shared directory walk. The reducer always
 * produces the exclusions — empty where the lane declares none — so the rule
 * states them where the walk leaves them optional, and the lane pin reads the
 * list the lane itself declared rather than a default.
 */
export interface LaneRule extends FileWalk {
  readonly excluded: readonly string[];
}

// `<root>/**/*<suffix>` — the include shape the walk implements.
const INCLUDE_SHAPE = /^([^*?{}[\]]+)\/\*\*\/\*([^*?{}[\]/]+)$/;

// `**/*<suffix>` — the lane-authored exclude shape it implements.
const EXCLUDE_SHAPE = /^\*\*\/\*([^*?{}[\]/]+)$/;

/**
 * A lane's globs, off `vitest.config.ts` itself: the config function is called
 * with the mode that lane's own script selects, so what comes back is the
 * selection the lane actually runs rather than a reading of its source.
 */
export async function declaredLaneGlobs(lane: Lane): Promise<LaneGlobs> {
  const mode = laneMode(lane);
  const exported: unknown = (
    (await import("../../vitest.config.ts")) as { default?: unknown }
  ).default;
  if (typeof exported !== "function")
    throw new Error(
      `vitest.config.ts exports no config function; the ${lane} lane's ` +
        "file selection cannot be read",
    );
  const config = (await (
    exported as (env: { command: "serve"; mode: string }) => unknown
  )({ command: "serve", mode })) as {
    test?: { include?: unknown; exclude?: unknown };
  };
  return {
    lane,
    include: stringList(config.test?.include, "include", lane, mode),
    exclude: stringList(config.test?.exclude, "exclude", lane, mode),
  };
}

function stringList(
  value: unknown,
  field: string,
  lane: Lane,
  mode: string,
): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string"))
    throw new Error(
      `vitest.config.ts declares no string \`test.${field}\` for mode ` +
        `'${mode}'; the spawn scan reads the ${lane} lane from it`,
    );
  return value as string[];
}

/**
 * The declared globs reduced to the rule the walk runs — refusing on any glob
 * it cannot implement, rather than reading a narrower set than the lane runs
 * and reporting the shortfall as a clean lane (`.claude/rules/engineering.md`,
 * *Loud or nothing*).
 *
 * The runner's own default excludes drop out by identity against
 * `configDefaults.exclude`, read from vitest rather than listed here: they
 * prune directories no suite lives in, and what survives the subtraction is
 * the lane's own vocabulary, which reduces or refuses.
 */
export function reduceLaneGlobs(globs: LaneGlobs): LaneRule {
  if (globs.include.length !== 1)
    throw new Error(
      `vitest.config.ts declares ${globs.include.length} include globs for ` +
        `the ${globs.lane} lane; the spawn scan walks one root`,
    );
  const [include = ""] = globs.include;
  const shape = INCLUDE_SHAPE.exec(include);
  if (!shape)
    throw new Error(
      `${globs.lane}-lane include glob '${include}' is not ` +
        `'<root>/**/*<suffix>'; the spawn scan walks a root for a suffix and ` +
        `would read a narrower set than the lane runs`,
    );
  const [, root = "", suffix = ""] = shape;
  const runnerDefaults = new Set<string>(configDefaults.exclude);
  const excluded = globs.exclude
    .filter((glob) => !runnerDefaults.has(glob))
    .map((glob) => {
      const dropped = EXCLUDE_SHAPE.exec(glob)?.[1];
      if (dropped === undefined)
        throw new Error(
          `${globs.lane}-lane exclude glob '${glob}' is not '**/*<suffix>'; ` +
            `the spawn scan drops files by suffix and would judge sites the ` +
            `lane never runs`,
        );
      return dropped;
    });
  return { root: join(REPO_ROOT, ...root.split("/")), suffix, excluded };
}

/** The rule one of this repo's lanes reduces to. */
export async function laneRule(lane: Lane): Promise<LaneRule> {
  return reduceLaneGlobs(await declaredLaneGlobs(lane));
}

/** The identifier at the head of a callee — `it` for `it.each(table)(…)`. */
function calleeRoot(expr: ts.Expression): string | null {
  let node: ts.Node = expr;
  while (ts.isPropertyAccessExpression(node) || ts.isCallExpression(node))
    node = node.expression;
  return ts.isIdentifier(node) ? node.text : null;
}

/** Every name referenced under `node`, with both node spellings folded in. */
function referenced(node: ts.Node): Set<string> {
  const names = new Set<string>();
  const walk = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) names.add(n.text);
    if (
      ts.isPropertyAccessExpression(n) &&
      n.name.text === "execPath" &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "process"
    )
      names.add(EXEC_PATH);
    if (ts.isStringLiteralLike(n) && SPAWN_COMMANDS.has(n.text))
      names.add(SPAWN_COMMAND);
    ts.forEachChild(n, walk);
  };
  walk(node);
  return names;
}

/**
 * Every name referenced under an `await` in `node` — the names this site's
 * body *waits on*, as opposed to the ones it merely mentions.
 *
 * The distinction is the whole point for timers: a case that arms a kill
 * timer beside a spawn and clears it is not sleeping, while a case that
 * awaits one is. Identifiers only — a timer named inside a string literal is
 * chain source the case writes out, not a call site.
 *
 * Over-approximating within the await, on the same trade the propagation
 * takes: a timer racing an event inside one awaited expression reads as a
 * sleep here, because it is one on the branch where the event loses.
 */
function awaitedNames(node: ts.Node): Set<string> {
  const names = new Set<string>();
  const collect = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) names.add(n.text);
    ts.forEachChild(n, collect);
  };
  const walk = (n: ts.Node): void => {
    if (ts.isAwaitExpression(n)) collect(n.expression);
    else ts.forEachChild(n, walk);
  };
  walk(node);
  return names;
}

/**
 * Every named *function* in the file, at any depth — a suite's spawn wrapper
 * is as often declared inside its `describe` as beside it.
 *
 * Keyed by name, valued by **every** declaration of that name rather than the
 * last one walked: a file that declares `boot` in one `describe` and an
 * unrelated `boot` in a sibling is ordinary, and keeping one node per name
 * would let the innocent declaration decide reach for the whole file — an
 * under-approximation, which is the one direction this scan must not take
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * Functions only: a `const gate = tscGate({ cmd: process.execPath })` is a
 * value one case built, not a wrapper its siblings call, and treating it as
 * one would hand a budget to every unrelated case that reuses the name.
 */
function namedFunctions(src: ts.SourceFile): Map<string, ts.Node[]> {
  const fns = new Map<string, ts.Node[]>();
  const declare = (name: string, node: ts.Node): void => {
    const nodes = fns.get(name);
    if (nodes) nodes.push(node);
    else fns.set(name, [node]);
  };
  const walk = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name) declare(n.name.text, n);
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      (ts.isArrowFunction(n.initializer) ||
        ts.isFunctionExpression(n.initializer))
    )
      declare(n.name.text, n.initializer);
    ts.forEachChild(n, walk);
  };
  walk(src);
  return fns;
}

/**
 * The names in `src` that reach `seed` — a node spawn, or a wall-clock
 * timer: the seed itself, plus every function whose body reaches it, to a
 * fixed point. Over-approximating by design — a name that merely looks like
 * a spawn wrapper costs one declared budget, while a missed one costs the
 * flake.
 *
 * A name reaches when **any** of its declarations does, on that same trade:
 * the scan has no scopes, so a name shared by a wrapper and an unrelated
 * helper is judged by the wrapper, and the helper's callers pay a ceiling
 * they never needed.
 */
function reachingNames(
  src: ts.SourceFile,
  seed: readonly string[],
): Set<string> {
  const fns = namedFunctions(src);
  const reaching = new Set<string>(seed);
  for (;;) {
    let grew = false;
    for (const [name, nodes] of fns) {
      if (reaching.has(name)) continue;
      const refs = new Set(nodes.flatMap((node) => [...referenced(node)]));
      if ([...reaching].some((n) => refs.has(n))) {
        reaching.add(name);
        grew = true;
      }
    }
    if (!grew) break;
  }
  return reaching;
}

/** The names a module exports. */
function exportedNames(src: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const st of src.statements) {
    const exported = ts.canHaveModifiers(st)
      ? ts
          .getModifiers(st)
          ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      : false;
    if (!exported) continue;
    if (ts.isFunctionDeclaration(st) && st.name) names.add(st.name.text);
    if (ts.isVariableStatement(st))
      for (const decl of st.declarationList.declarations)
        if (ts.isIdentifier(decl.name)) names.add(decl.name.text);
  }
  return names;
}

/** One walk of `tests/`: the modules a scan reads do not move under it. */
let helperIndex: Map<string, string> | null = null;

/**
 * Every helper module the suites import, keyed by the file name they spell it
 * as. Off disk rather than from a list, so a helper written tomorrow is in
 * scope without a second edit here.
 *
 * Keyed by name rather than by resolved path because the importer's own
 * directory does not always resolve the specifier: a fixture written under
 * `SpawnScanRequest.dir` spells `../helpers/subprocess.ts` the way a lane file
 * does while sitting nowhere near the tree that specifier points into. The
 * name is what both spellings agree on.
 *
 * Two helpers sharing a name would make that key ambiguous, so the scan
 * refuses instead of picking one: the quiet outcome is a lane file seeded from
 * the wrong module's exports, which under-approximates
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
function helperModules(): Map<string, string> {
  if (helperIndex) return helperIndex;
  const index = new Map<string, string>();
  for (const path of filesUnder({ root: TESTS_DIR, suffix: ".ts" })) {
    const name = basename(path);
    const held = index.get(name);
    if (held)
      throw new Error(
        `two modules under tests/ are named '${name}' (${relPath(REPO_ROOT, held)}, ` +
          `${relPath(REPO_ROOT, path)}); the spawn scan keys a helper import by ` +
          `its file name and would seed a suite from the wrong module's exports`,
      );
    index.set(name, path);
  }
  helperIndex = index;
  return index;
}

/**
 * The names `src` imports from each helper module, keyed by that module's file
 * name. A relative specifier only — a package import names no file of this
 * tree — and only the named bindings, which is every spelling a suite reaches
 * a helper's export through.
 */
function helperImports(src: ts.SourceFile): Map<string, Set<string>> {
  const helpers = helperModules();
  const out = new Map<string, Set<string>>();
  for (const st of src.statements) {
    if (!ts.isImportDeclaration(st)) continue;
    if (!ts.isStringLiteralLike(st.moduleSpecifier)) continue;
    const specifier = st.moduleSpecifier.text;
    if (!specifier.startsWith(".")) continue;
    const name = specifier.slice(specifier.lastIndexOf("/") + 1);
    if (!helpers.has(name)) continue;
    const bindings = st.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const names = out.get(name) ?? new Set<string>();
    for (const el of bindings.elements) names.add(el.name.text);
    out.set(name, names);
  }
  return out;
}

/** One answer per helper, for the same reason {@link helperIndex} is kept. */
const spawnExportCache = new Map<string, readonly string[]>();

/**
 * The exports of one helper module that reach a process startup — its own
 * spellings of a startup, plus every spawning export it imports from a helper
 * of its own, to whatever depth the helpers are layered.
 *
 * The depth is the point. A lane file that starts no process of its own and
 * calls `makeFixture` (`tests/helpers/dispatcherFixture.ts`, which seeds a temp
 * repository through `exec("git", …)`) pays every one of those startups, and
 * while the seed stopped at the one wrapper module, that file read as spawning
 * nothing and kept vitest's 5s default.
 *
 * A cycle between helpers is a refusal rather than a truncated answer, on the
 * scan's standing direction: the truncation would be an under-approximation,
 * which is the one this scan must not take (`.claude/rules/engineering.md`,
 * *Loud or nothing*). `visiting` is the chain a refusal names, and a caller
 * starting a fresh read omits it.
 */
export function helperSpawnExports(
  name: string,
  visiting: readonly string[] = [],
): readonly string[] {
  const memo = spawnExportCache.get(name);
  if (memo) return memo;
  if (visiting.includes(name))
    throw new Error(
      `helper import cycle ${[...visiting, name].join(" -> ")}; the spawn ` +
        `scan reads a helper's reach once and would under-approximate it`,
    );
  const path = helperModules().get(name);
  if (!path)
    throw new Error(
      `tests/ holds no module named '${name}'; the spawn scan reads its ` +
        `spawning exports`,
    );
  const src = parseScopeless(path);
  const exported = exportedNames(src);
  const reaching = reachingNames(src, [
    ...PROCESS_STARTS,
    ...importedSpawnNames(src, [...visiting, name]),
  ]);
  const names = [...reaching].filter((n) => exported.has(n));
  spawnExportCache.set(name, names);
  return names;
}

/**
 * The names `src` imports that start a process — every helper export it takes
 * that reaches a startup, which is the seed its own propagation runs from.
 */
function importedSpawnNames(
  src: ts.SourceFile,
  visiting: readonly string[],
): string[] {
  const out: string[] = [];
  for (const [name, imported] of helperImports(src))
    for (const exp of helperSpawnExports(name, visiting))
      if (imported.has(exp)) out.push(exp);
  return out;
}

/**
 * The spawn wrappers: every export of the module holding them that reaches a
 * process startup, by the same propagation the suites are scanned with.
 */
export function harnessSpawnExports(): string[] {
  return [...helperSpawnExports(SPAWN_WRAPPERS_NAME)];
}

/**
 * That same module's exported numeric constants, by name — the budgets a
 * site is allowed to name, and the only place the lane's number lives.
 */
export function harnessBudgets(): Map<string, number> {
  const out = new Map<string, number>();
  const src = parseScopeless(SPAWN_WRAPPERS);
  const exported = exportedNames(src);
  const walk = (n: ts.Node): void => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      exported.has(n.name.text) &&
      n.initializer &&
      ts.isNumericLiteral(n.initializer)
    )
      out.set(n.name.text, Number(n.initializer.text.replace(/_/g, "")));
    ts.forEachChild(n, walk);
  };
  walk(src);
  return out;
}

/** The options-object key a registrar spells its own timeout under. */
const SITE_TIMEOUT_KEY = "timeout";

/**
 * The ceiling a registrar call carries of its own, or `null`. Read
 * position-agnostically — a case carries `(title, fn, timeout)`, a hook
 * carries `(fn, timeout)`, and both spell it as an options-object `timeout`
 * too — so the scan never encodes vitest's argument order.
 *
 * A **numeric literal** is the ceiling, in the text the source spells (`20_000`
 * separators and all), because that is the number restated per case. An
 * identifier naming a harness budget is not: it is the lane's one number, named
 * where it lives.
 *
 * The two positions read differently, and the asymmetry is the point. A bare
 * positional identifier is almost always the *body* — `it("…", runsTheCase)` —
 * so only a literal is read as a ceiling there; under the `timeout` key the
 * argument's meaning is spelled by the key, so anything that is not a harness
 * budget is a ceiling, a locally-named constant included. Guessing the other
 * way in the positional slot would report every case that passes its body by
 * name as carrying a ceiling.
 */
function ownCeiling(
  call: ts.CallExpression,
  budgets: ReadonlySet<string>,
): string | null {
  for (const arg of call.arguments) {
    if (ts.isNumericLiteral(arg)) return arg.getText();
    if (!ts.isObjectLiteralExpression(arg)) continue;
    for (const prop of arg.properties) {
      if (
        !ts.isPropertyAssignment(prop) ||
        prop.name.getText() !== SITE_TIMEOUT_KEY
      )
        continue;
      const value = prop.initializer;
      return ts.isIdentifier(value) && budgets.has(value.text)
        ? null
        : value.getText();
    }
  }
  return null;
}

/**
 * The two arms a file-scope declaration carries, and the registrars each one
 * reaches. Vitest resolves a case's ceiling from `testTimeout` and a hook's
 * from `hookTimeout`, and a spawning file needs both: the windows-lane red
 * this scan's widening came from was a git case crossing the case default and
 * its teardown then failing EBUSY on the fixture repository the timed-out
 * case still held — one slow spawn reddening two sites, only one of which a
 * case arm would have covered.
 */
const BUDGET_ARMS = ["testTimeout", "hookTimeout"] as const;

/** One of them. */
export type BudgetArm = (typeof BUDGET_ARMS)[number];

/** The call a file declares its budget through, as the file spells it. */
const CONFIG_OBJECT = "vi";
const CONFIG_CALL = "setConfig";

/**
 * The file-scope budget declaration: the harness constant each arm of a
 * top-level `vi.setConfig({ testTimeout, hookTimeout })` names, with the line
 * the call sits on.
 *
 * Top-level, because that is the whole claim. Vitest resolves a site's
 * timeout when the registrar *runs*, so a declaration below a file's hooks
 * never reaches them and one nested inside a `describe` reaches only what
 * that block registers after it — a per-site declaration wearing a
 * file-scope spelling. The line is reported so the caller can refuse a
 * declaration the file's own sites sit above.
 *
 * As at a registrar, a numeric literal is not a declaration: it is the lane's
 * number restated per file, which is the defect one file up.
 *
 * The first top-level call is the declaration. A file spelling its budget
 * across two calls reads as declaring whatever the first one carries and reds
 * on the rest, which is this scan's standing direction — a file over-reported
 * costs one edit, a file missed costs the flake.
 */
function declaredFileBudget(
  src: ts.SourceFile,
  budgets: ReadonlySet<string>,
): {
  readonly arms: Record<BudgetArm, string | null>;
  readonly line: number;
} | null {
  for (const st of src.statements) {
    if (!ts.isExpressionStatement(st)) continue;
    const call = st.expression;
    if (!ts.isCallExpression(call)) continue;
    const callee = call.expression;
    if (
      !ts.isPropertyAccessExpression(callee) ||
      callee.name.text !== CONFIG_CALL ||
      !ts.isIdentifier(callee.expression) ||
      callee.expression.text !== CONFIG_OBJECT
    )
      continue;
    const arms: Record<BudgetArm, string | null> = {
      testTimeout: null,
      hookTimeout: null,
    };
    for (const arg of call.arguments) {
      if (!ts.isObjectLiteralExpression(arg)) continue;
      for (const prop of arg.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        const arm = BUDGET_ARMS.find((name) => prop.name.getText() === name);
        if (!arm) continue;
        const named =
          ts.isIdentifier(prop.initializer) && budgets.has(prop.initializer.text);
        arms[arm] = named ? prop.initializer.getText() : null;
      }
    }
    return {
      arms,
      line: src.getLineAndCharacterOfPosition(call.getStart()).line + 1,
    };
  }
  return null;
}

/**
 * One lane file that starts a process, which is the unit the budget verdict
 * is read over: the ceiling is declared once for a file, so a file that
 * spawns anywhere is a file that declares, whatever its individual cases say.
 */
export interface SpawnFile extends ScanSite {
  /** The line of this file's first spawning site — what a finding cites. */
  readonly line: number;
  /** Every spawning case and hook in it, in source order. */
  readonly sites: readonly SpawnSite[];
  /**
   * The harness constant each arm of the file-scope declaration names, or
   * `null` where the arm is absent, restates a number, or the declaration
   * itself is missing.
   */
  readonly arms: Record<BudgetArm, string | null>;
  /**
   * The line the file-scope declaration sits on, or `null` when the file
   * carries none. A declaration below the file's first spawning site leaves
   * that site on the runner's default, so the line is part of the verdict
   * rather than a decoration on it.
   */
  readonly declaredAt: number | null;
}

/**
 * Why a spawning file fails the budget verdict, in the words its report
 * carries — or `null` when it declares the budget the lane's way.
 */
export function budgetDefect(file: SpawnFile): string | null {
  if (file.declaredAt === null)
    return `declares no file-scope \`${CONFIG_OBJECT}.${CONFIG_CALL}\` budget`;
  const missing = BUDGET_ARMS.filter((arm) => file.arms[arm] === null);
  if (missing.length > 0)
    return `names no harness budget for ${missing.join(", ")}`;
  if (file.declaredAt > file.line)
    return `declares the budget at line ${file.declaredAt}, below the spawning site at line ${file.line}`;
  return null;
}

/** Which lane's files the scan walks, and which subtree of them. */
export interface SpawnScanRequest {
  readonly lane: Lane;
  /**
   * The subtree descended, the lane's own root by default. A parameter for
   * one reason: the scan's own test drives it over a fixture whose cases are
   * written to be caught, so a green verdict here is proven to be a detector
   * firing rather than an empty set (`.claude/rules/engineering.md`, *A green
   * verdict is proven non-vacuous*). The lane's suffixes apply either way.
   */
  readonly dir?: string;
}

/**
 * Three judged sets, so three scans rather than extra finding lists
 * (`.claude/rules/engineering.md`, *A green verdict is proven non-vacuous*:
 * a vacuity pin reads the `scanned` of whichever verdict it guards).
 *
 * `sites` judges every case and hook of the lane that starts a process, for
 * the wall-clock timer some await between the spawn and the assertion.
 * `files` judges the lane files those sites sit in, for the budget — which is
 * declared once per file, so the file is the unit a missing declaration is
 * reported at. `registrars` judges every case and hook a *declaring* file
 * holds, spawning or not, for the ceiling some carry of their own.
 *
 * The last set is wider than the first on purpose. A file-scope `vi.setConfig`
 * reaches every registrar the file holds, and vitest resolves a registrar's
 * own timeout argument last, so a number on a case that spawns nothing
 * overrides the declaration exactly as one on a case that spawns does — and
 * the file verdict cannot see either, because a file naming the budget
 * correctly is green there however many of its registrars then restate it.
 * Declaring is the opt-in: a file that never declared a budget is under no
 * rule here, and the number it restates is its own business.
 */
export interface SpawnScan {
  readonly sites: Scan<SpawnSite>;
  readonly files: Scan<SpawnFile>;
  readonly registrars: Scan<SpawnSite>;
}

/**
 * One registrar as the walk below reads it, before either verdict selects it:
 * the site, and whether its body reaches a process startup. The flag lives
 * here rather than on {@link SpawnSite} because it is the selector, not a
 * property of a site — every site the spawn verdicts see has it set, and the
 * ceiling verdict does not read it at all.
 */
interface Registrar {
  readonly site: SpawnSite;
  readonly spawns: boolean;
}

/**
 * Every case and hook the request's lane holds that starts a process, folded
 * to the files that hold them with the budget each file declares — and, for
 * each file that declares one, every registrar it holds whether it spawns or
 * not (see {@link SpawnScan}).
 */
export async function scanSpawns(request: SpawnScanRequest): Promise<SpawnScan> {
  const rule = await laneRule(request.lane);
  const budgets = new Set(harnessBudgets().keys());
  const sites: SpawnSite[] = [];
  const files: SpawnFile[] = [];
  const registrars: SpawnSite[] = [];

  for (const path of filesUnder(rule, request.dir)) {
    const src = parseScopeless(path);
    const module = relPath(REPO_ROOT, path);
    const imports = helperImports(src);
    const spawns = reachingNames(src, [
      ...PROCESS_STARTS,
      ...importedSpawnNames(src, []),
    ]);
    const timers = reachingNames(src, TIMERS);
    // The budget's names are the wrapper module's alone: it is where the
    // lane's one number lives, so a same-named constant taken from elsewhere
    // is not the budget a file may name.
    const named = new Set(
      [...budgets].filter((n) => imports.get(SPAWN_WRAPPERS_NAME)?.has(n)),
    );

    const own: Registrar[] = [];
    const visit = (node: ts.Node): void => {
      // The registrar call is the outer one: `it.each(table)(title, fn)` is a
      // call whose callee is itself a call, and only the outer half carries a
      // body and a timeout.
      if (
        ts.isCallExpression(node) &&
        !(
          ts.isCallExpression(node.parent) && node.parent.expression === node
        )
      ) {
        const root = calleeRoot(node.expression);
        const kind =
          root && CASE.test(root)
            ? ("case" as const)
            : root && HOOK.test(root)
              ? ("hook" as const)
              : null;
        if (kind) {
          // Everything but the title: a case's body, a hook's body, and a
          // bare function identifier standing in for either.
          const body = node.arguments.filter((a) => !ts.isStringLiteralLike(a));
          const refs = new Set(body.flatMap((a) => [...referenced(a)]));
          const line =
            src.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          const first = node.arguments[0];
          const awaited = new Set(body.flatMap((a) => [...awaitedNames(a)]));
          own.push({
            spawns: [...spawns].some((n) => refs.has(n)),
            site: {
              module,
              line,
              title:
                first && ts.isStringLiteralLike(first)
                  ? first.text
                  : `${root} at ${module}:${line}`,
              kind,
              awaitedTimer: [...timers].find((n) => awaited.has(n)) ?? null,
              ownCeiling: ownCeiling(node, named),
            },
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(src);
    const declared = declaredFileBudget(src, named);

    const spawning = own.filter((r) => r.spawns).map((r) => r.site);
    sites.push(...spawning);
    const first = spawning[0];
    if (first)
      files.push({
        module,
        line: first.line,
        sites: spawning,
        arms: declared?.arms ?? { testTimeout: null, hookTimeout: null },
        declaredAt: declared?.line ?? null,
      });

    // The ceiling verdict's subject is the *declaration*, not the spawn: a
    // file-scope `vi.setConfig` reaches every registrar under it, so every
    // registrar under it can override it.
    if (declared) registrars.push(...own.map((r) => r.site));
  }

  return {
    sites: {
      scanned: sites,
      findings: sites.filter((site) => site.awaitedTimer !== null),
    },
    files: {
      scanned: files,
      findings: files.filter((file) => budgetDefect(file) !== null),
    },
    registrars: {
      scanned: registrars,
      findings: registrars.filter((site) => site.ownCeiling !== null),
    },
  };
}
