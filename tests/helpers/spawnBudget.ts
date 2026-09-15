/**
 * The default lane's spawn-budget scan: which of its cases and hooks start a
 * node process, and which of those declare the shared budget
 * (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
 *
 * A source scan rather than a runtime probe, because the property is what a
 * site *declares*: a budget observable only once a case has already run long
 * is no defence against the flake it exists to prevent (spec/worktrees.md,
 * "The default test lane must stay fast").
 *
 * Nothing here holds a second copy of the lane's vocabulary — the spawn
 * wrappers are read out of the harness module, the budget names out of its
 * exported numbers, and which files the lane even contains out of
 * `vitest.config.ts`, so a wrapper, a rename, or a widened include arms the
 * scan without a second edit (`.claude/rules/engineering.md`, *Derived state
 * is computed, never restated beside its source*). The one list held here is
 * `NODE_COMMANDS`, which has no source to be read off; it is declared at its
 * site below rather than left looking derived.
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

/** Both spellings of a node startup, as the propagation's seed. */
const NODE_STARTS: readonly string[] = [EXEC_PATH, NODE_COMMAND];

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
 * The mode a config function is called with when no `--mode` is passed, which
 * is how the afterMerge gate invokes `vitest run` — so this is the lane the
 * scan judges.
 */
const DEFAULT_LANE_MODE = "test";

/** One lane's file selection, as `vitest.config.ts` hands it over. */
export interface LaneGlobs {
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
 * The default lane's globs, off `vitest.config.ts` itself: the config
 * function is called the way the runner calls it, so what comes back is the
 * selection the lane actually runs rather than a reading of its source.
 */
export async function declaredLaneGlobs(): Promise<LaneGlobs> {
  const exported: unknown = (
    (await import("../../vitest.config.ts")) as { default?: unknown }
  ).default;
  if (typeof exported !== "function")
    throw new Error(
      "vitest.config.ts exports no config function; the default lane's " +
        "file selection cannot be read",
    );
  const config = (await (
    exported as (env: { command: "serve"; mode: string }) => unknown
  )({ command: "serve", mode: DEFAULT_LANE_MODE })) as {
    test?: { include?: unknown; exclude?: unknown };
  };
  return {
    include: stringList(config.test?.include, "include"),
    exclude: stringList(config.test?.exclude, "exclude"),
  };
}

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string"))
    throw new Error(
      `vitest.config.ts declares no string \`test.${field}\` for mode ` +
        `'${DEFAULT_LANE_MODE}'; the spawn-budget scan reads the lane from it`,
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
        `the default lane; the spawn-budget scan walks one root`,
    );
  const [include = ""] = globs.include;
  const shape = INCLUDE_SHAPE.exec(include);
  if (!shape)
    throw new Error(
      `default-lane include glob '${include}' is not '<root>/**/*<suffix>'; ` +
        `the spawn-budget scan walks a root for a suffix and would read a ` +
        `narrower set than the lane runs`,
    );
  const [, root = "", suffix = ""] = shape;
  const runnerDefaults = new Set<string>(configDefaults.exclude);
  const excluded = globs.exclude
    .filter((glob) => !runnerDefaults.has(glob))
    .map((glob) => {
      const dropped = EXCLUDE_SHAPE.exec(glob)?.[1];
      if (dropped === undefined)
        throw new Error(
          `default-lane exclude glob '${glob}' is not '**/*<suffix>'; the ` +
            `spawn-budget scan drops files by suffix and would judge sites ` +
            `the lane never runs`,
        );
      return dropped;
    });
  return { root: join(REPO_ROOT, ...root.split("/")), suffix, excluded };
}

/** The rule this repo's default lane reduces to. */
export async function defaultLaneRule(): Promise<LaneRule> {
  return reduceLaneGlobs(await declaredLaneGlobs());
}

/**
 * Every file the lane runs, off disk rather than from a list: a suite added
 * without its budget is exactly the case this scan exists to catch, and a
 * hand-kept list is what would not carry it. Which files count is `rule`'s to
 * say — this walk holds no copy of the lane's root or its suffixes.
 */
export function defaultLaneFiles(
  rule: LaneRule,
  dir: string = rule.root,
): string[] {
  const out: string[] = [];
  for (const dirent of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, dirent.name);
    if (dirent.isDirectory()) out.push(...defaultLaneFiles(rule, path));
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
 * Every named *function* in the file, at any depth — a suite's spawn wrapper
 * is as often declared inside its `describe` as beside it.
 *
 * Functions only: a `const gate = tscGate({ cmd: process.execPath })` is a
 * value one case built, not a wrapper its siblings call, and treating it as
 * one would hand a budget to every unrelated case that reuses the name.
 */
function namedFunctions(src: ts.SourceFile): Map<string, ts.Node> {
  const fns = new Map<string, ts.Node>();
  const walk = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name) fns.set(n.name.text, n);
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      (ts.isArrowFunction(n.initializer) ||
        ts.isFunctionExpression(n.initializer))
    )
      fns.set(n.name.text, n.initializer);
    ts.forEachChild(n, walk);
  };
  walk(src);
  return fns;
}

/**
 * The names in `src` that reach a node spawn: `seed`, plus every function
 * whose body reaches one, to a fixed point. Over-approximating by
 * design — a name that merely looks like a spawn wrapper costs one declared
 * budget, while a missed one costs the flake.
 */
function spawnNames(src: ts.SourceFile, seed: readonly string[]): Set<string> {
  const fns = namedFunctions(src);
  const reaching = new Set<string>(seed);
  for (;;) {
    let grew = false;
    for (const [name, node] of fns) {
      if (reaching.has(name)) continue;
      const refs = referenced(node);
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
 * The harness module's spawn wrappers: every export of it that reaches
 * `process.execPath`, by the same propagation the suites are scanned with.
 */
export function harnessSpawnExports(): string[] {
  const src = parse(HARNESS);
  const exported = exportedNames(src);
  return [...spawnNames(src, NODE_STARTS)].filter((n) => exported.has(n));
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
 * Every default-lane case and hook under `dir` that starts a node process,
 * with the budget it declares.
 *
 * `dir` defaults to the root the declared lane names and is a parameter for
 * one reason: the scan's own test drives it over a fixture whose cases are
 * written to be caught, so a green verdict here is proven to be a detector
 * firing rather than an empty set (`.claude/rules/engineering.md`, *A green
 * verdict is proven non-vacuous*). The lane's suffixes apply either way.
 */
export async function scanDefaultLaneSpawnSites(
  dir?: string,
): Promise<SpawnSite[]> {
  const rule = await defaultLaneRule();
  const wrappers = harnessSpawnExports();
  const budgets = new Set(harnessBudgets().keys());
  const sites: SpawnSite[] = [];

  for (const path of defaultLaneFiles(rule, dir)) {
    const src = parse(path);
    const file = relative(REPO_ROOT, path).split(sep).join("/");
    const imported = harnessImports(src);
    const spawns = spawnNames(src, [
      ...NODE_STARTS,
      ...wrappers.filter((n) => imported.has(n)),
    ]);
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
            sites.push({
              file,
              line,
              title:
                first && ts.isStringLiteralLike(first)
                  ? first.text
                  : `${root} at ${file}:${line}`,
              kind,
              budget: declaredBudget(node, named),
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
