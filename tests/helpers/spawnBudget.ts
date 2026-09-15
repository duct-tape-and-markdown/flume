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
 * wrappers are read out of the harness module and the budget names out of its
 * exported numbers, so a wrapper or a rename arms the scan without a second
 * edit (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*).
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

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
 * Every default-lane suite file, off disk rather than from a list: a suite
 * added without its budget is exactly the case this scan exists to catch, and
 * a hand-kept list is what would not carry it. The lane is `vitest.config.ts`'s
 * — everything under `tests/` but the integration suffix.
 */
export function defaultLaneFiles(dir: string = TESTS_DIR): string[] {
  const out: string[] = [];
  for (const dirent of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, dirent.name);
    if (dirent.isDirectory()) out.push(...defaultLaneFiles(path));
    else if (
      dirent.name.endsWith(".test.ts") &&
      !dirent.name.endsWith(".integration.test.ts")
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

/** Every name referenced under `node`, with `process.execPath` folded in. */
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
  return [...spawnNames(src, [EXEC_PATH])].filter((n) => exported.has(n));
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
 * `dir` defaults to this repo's suite and is a parameter for one reason: the
 * scan's own test drives it over a fixture whose cases are written to be
 * caught, so a green verdict here is proven to be a detector firing rather
 * than an empty set (`.claude/rules/engineering.md`, *A green verdict is
 * proven non-vacuous*).
 */
export function scanDefaultLaneSpawnSites(dir: string = TESTS_DIR): SpawnSite[] {
  const wrappers = harnessSpawnExports();
  const budgets = new Set(harnessBudgets().keys());
  const sites: SpawnSite[] = [];

  for (const path of defaultLaneFiles(dir)) {
    const src = parse(path);
    const file = relative(REPO_ROOT, path).split(sep).join("/");
    const imported = harnessImports(src);
    const spawns = spawnNames(src, [
      EXEC_PATH,
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
