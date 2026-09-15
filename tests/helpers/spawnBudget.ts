/**
 * Either lane's spawn scan: which of its cases and hooks start a process,
 * which of those declare the shared budget (`SPAWN_BUDGET_MS`,
 * `tests/helpers/subprocess.ts`), and which of them await a wall-clock timer
 * between the spawn and the assertion downstream of it.
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
 * Nothing here holds a second copy of a lane's vocabulary — the spawn
 * wrappers are read out of the harness module, the budget names out of its
 * exported numbers, each lane's vitest mode out of `package.json`, and which
 * files a lane contains out of `vitest.config.ts`, so a wrapper, a rename, or
 * a widened include arms the scan without a second edit
 * (`.claude/rules/engineering.md`, *Derived state is computed, never restated
 * beside its source*). The three lists held here are `NODE_COMMANDS`,
 * `SHELL_ENTRIES` and `TIMERS`, none of which has a source to be read off;
 * each is declared at its site below rather than left looking derived.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { configDefaults } from "vitest/config";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TESTS_DIR = join(REPO_ROOT, "tests");
const HARNESS = join(TESTS_DIR, "helpers", "subprocess.ts");

/** The specifier a suite imports the spawn wrappers and the budget through. */
const HARNESS_MODULE = /(^|\/)helpers\/subprocess\.ts$/;

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
 * The same startup spelled as a command *name*, folded to one name the
 * propagation carries exactly like `EXEC_PATH`: a case that hands `"node"`
 * to a gate, or shells out to `npm`, pays the runtime startup the lane's
 * budget exists for just as a case holding `process.execPath` does.
 */
const NODE_COMMAND = "<node command>";

/**
 * Which command names are that startup. This list is the one copy — no
 * surface in this repo enumerates the node launchers, so unlike the lane's
 * globs, the spawn wrappers and the budget's number there is nothing to read
 * it off (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*: declared here rather than looking derived).
 *
 * Launchers only. A name that merely *runs under* node once a launcher has
 * started it — `tsc`, `vitest`, a bin on PATH — is already covered by the
 * launcher that spawns it, and listing it would flag prose. `git` is
 * deliberately absent: raw plumbing is measured fast and is not a lane
 * trigger (spec/worktrees.md, "The default test lane must stay fast").
 *
 * Over-approximating on the same trade the propagation below takes: a name
 * asserted on rather than handed to a runner, or handed to a mocked one,
 * reads as a startup here and costs the case one declared ceiling it never
 * pays. A missed one costs the flake, which is the cost this scan exists to
 * prevent.
 */
const NODE_COMMANDS: ReadonlySet<string> = new Set([
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
 * `sh` is no node launcher, so `NODE_COMMANDS` cannot reach this; and the
 * propagation never follows an import, so the spawn inside the engine module
 * is invisible from a lane file. The entry the spans go through is the name
 * the scan can see, declared here for the same reason `NODE_COMMANDS` is: no
 * surface enumerates it.
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
  NODE_COMMAND,
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
 * - **A helper module's internals.** The propagation below is seeded per lane
 *   file and never follows an import, so `waitFor` (tests/helpers/waitFor.ts)
 *   reads as what it is — an event-based wait that happens to be built on
 *   `setTimeout` — rather than as the sleep it replaced. The bound that buys
 *   that: a sleep hidden behind a new helper module is invisible here, and
 *   the call site is where this scan looks.
 */
const TIMERS: readonly string[] = ["setTimeout", "setInterval"];

export interface SpawnSite {
  /** Repo-relative, forward-slashed. */
  readonly file: string;
  readonly line: number;
  /** The case's title, or a `<file>:<line>` stand-in for a hook. */
  readonly title: string;
  readonly kind: "case" | "hook";
  /**
   * The harness constant this site declares as its budget, or `null` when it
   * declares none — or declares a number of its own, which is the same defect
   * wearing a value.
   */
  readonly budget: string | null;
  /**
   * The name this site awaits that reaches a wall-clock timer — the local
   * wrapper's name where there is one, `setTimeout` where the sleep is
   * inline — or `null` when it awaits none.
   */
  readonly awaitedTimer: string | null;
}

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.ESNext,
    true,
  );
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

/** That selection reduced to the walk below. */
export interface LaneRule {
  /** The directory the walk descends, absolute. */
  readonly root: string;
  /** The suffix a file carries to be in the lane, e.g. `.test.ts`. */
  readonly suffix: string;
  /** The suffixes that take it back out, e.g. `.integration.test.ts`. */
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

/**
 * Every file the lane runs, off disk rather than from a list: a suite added
 * without its budget is exactly the case this scan exists to catch, and a
 * hand-kept list is what would not carry it. Which files count is `rule`'s to
 * say — this walk holds no copy of the lane's root or its suffixes.
 */
export function laneFiles(rule: LaneRule, dir: string = rule.root): string[] {
  const out: string[] = [];
  for (const dirent of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, dirent.name);
    if (dirent.isDirectory()) out.push(...laneFiles(rule, path));
    else if (
      dirent.name.endsWith(rule.suffix) &&
      !rule.excluded.some((dropped) => dirent.name.endsWith(dropped))
    )
      out.push(path);
  }
  return out;
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
    if (ts.isStringLiteralLike(n) && NODE_COMMANDS.has(n.text))
      names.add(NODE_COMMAND);
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

/**
 * The harness module's spawn wrappers: every export of it that reaches a
 * process startup, by the same propagation the suites are scanned with.
 */
export function harnessSpawnExports(): string[] {
  const src = parse(HARNESS);
  const exported = exportedNames(src);
  return [...reachingNames(src, PROCESS_STARTS)].filter((n) => exported.has(n));
}

/**
 * The harness module's exported numeric constants, by name — the budgets a
 * site is allowed to name, and the only place the lane's number lives.
 */
export function harnessBudgets(): Map<string, number> {
  const out = new Map<string, number>();
  const src = parse(HARNESS);
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

/** The names `src` imports from the harness module. */
function harnessImports(src: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const st of src.statements) {
    if (!ts.isImportDeclaration(st)) continue;
    if (!ts.isStringLiteralLike(st.moduleSpecifier)) continue;
    if (!HARNESS_MODULE.test(st.moduleSpecifier.text)) continue;
    const bindings = st.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings))
      for (const el of bindings.elements) names.add(el.name.text);
  }
  return names;
}

/**
 * The budget a registrar call declares, or `null`. Read positionally-agnostically
 * — a case carries `(title, fn, timeout)` and a hook `(fn, timeout)`, and both
 * spell it as an options-object `timeout` too — so the scan never encodes
 * vitest's argument order.
 *
 * A literal at the callsite is not a declared budget: it is the number
 * restated per case, which is what left six different timeouts on this lane's
 * spawning cases before the budget had a home.
 */
function declaredBudget(
  call: ts.CallExpression,
  budgets: ReadonlySet<string>,
): string | null {
  let declared: string | null = null;
  const consider = (expr: ts.Expression): void => {
    if (ts.isNumericLiteral(expr)) declared = null;
    else if (ts.isIdentifier(expr) && budgets.has(expr.text))
      declared = expr.text;
  };
  for (const arg of call.arguments) {
    if (ts.isNumericLiteral(arg) || ts.isIdentifier(arg)) consider(arg);
    else if (ts.isObjectLiteralExpression(arg))
      for (const prop of arg.properties)
        if (
          ts.isPropertyAssignment(prop) &&
          prop.name.getText() === "timeout" &&
          ts.isExpression(prop.initializer)
        )
          consider(prop.initializer);
  }
  return declared;
}

/**
 * Every case and hook under `dir` in `lane` that starts a node process, with
 * the budget it declares and the timer it awaits.
 *
 * `dir` defaults to the root the declared lane names and is a parameter for
 * one reason: the scan's own test drives it over a fixture whose cases are
 * written to be caught, so a green verdict here is proven to be a detector
 * firing rather than an empty set (`.claude/rules/engineering.md`, *A green
 * verdict is proven non-vacuous*). The lane's suffixes apply either way.
 */
export async function scanLaneSpawnSites(
  lane: Lane,
  dir?: string,
): Promise<SpawnSite[]> {
  const rule = await laneRule(lane);
  const wrappers = harnessSpawnExports();
  const budgets = new Set(harnessBudgets().keys());
  const sites: SpawnSite[] = [];

  for (const path of laneFiles(rule, dir)) {
    const src = parse(path);
    const file = relative(REPO_ROOT, path).split(sep).join("/");
    const imported = harnessImports(src);
    const spawns = reachingNames(src, [
      ...PROCESS_STARTS,
      ...wrappers.filter((n) => imported.has(n)),
    ]);
    const timers = reachingNames(src, TIMERS);
    const named = new Set([...budgets].filter((n) => imported.has(n)));

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
          const refs = new Set(
            node.arguments
              .filter((a) => !ts.isStringLiteralLike(a))
              .flatMap((a) => [...referenced(a)]),
          );
          if ([...spawns].some((n) => refs.has(n))) {
            const line =
              src.getLineAndCharacterOfPosition(node.getStart()).line + 1;
            const first = node.arguments[0];
            const awaited = new Set(
              node.arguments
                .filter((a) => !ts.isStringLiteralLike(a))
                .flatMap((a) => [...awaitedNames(a)]),
            );
            sites.push({
              file,
              line,
              title:
                first && ts.isStringLiteralLike(first)
                  ? first.text
                  : `${root} at ${file}:${line}`,
              kind,
              budget: declaredBudget(node, named),
              awaitedTimer: [...timers].find((n) => awaited.has(n)) ?? null,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(src);
  }

  return sites;
}
