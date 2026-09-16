/**
 * Which of the spawns this repo ships or runs capture a child's streams, and
 * which of those name the cap they capture under.
 *
 * `execFile`, `exec`, their sync forms, and a piped `spawnSync` keep at most
 * `maxBuffer` bytes per stream — 1 MiB unless the call says otherwise — and
 * report an overrun where an exit status would sit rather than as a
 * truncation anything downstream can see (`.claude/rules/platform-facts.md`,
 * *Node caps a captured child stream at 1 MiB, and reports the overrun as a
 * spawn failure*). A site that inherits the default has chosen 1 MiB
 * silently, and the failure it buys arrives as a child that never ran.
 *
 * A source scan rather than a runtime probe, because the cap is what a site
 * *declares*: the overrun is reachable only from an input large enough to
 * hit it, which is exactly the input no suite has on hand, so a cap
 * observable only once a child has already been killed is no defence at all.
 *
 * **Names, not scopes.** Like the lane's spawn scan (`spawnBudget.ts`) this
 * reads files through `createSourceFile` and carries one global set of
 * capturing names, so a wrapper discovered in one module is judged at its
 * call sites in every other without an import graph. The trade is stated
 * once here: a name that merely collides with a capturing one costs its
 * caller a declared cap it never needed, and that is the direction this scan
 * takes on every judgement below — a missed site costs the silent kill.
 *
 * Three things the scan will not read, each refused or excluded out loud
 * rather than passed over: a `node:child_process` import in a shape with no
 * named bindings (thrown on — the module's spawns would be invisible), an
 * async `spawn`, which has no `maxBuffer` and streams instead of buffering
 * (never a subject), and a `spawnSync` whose `stdio` is spelled as literals
 * that pipe nothing (a subject that captures nothing).
 *
 * Not *.test.ts, so neither vitest lane collects it as a suite of its own.
 */

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";

import {
  REPO_ROOT,
  filesUnder,
  relPath,
  type Scan,
  type ScanSite,
} from "./repoProgram.ts";

/**
 * The trees this repo ships or runs from, outside `tests/`. No surface
 * enumerates them — the manifest names the emitted build, not the sources —
 * so the list is declared here rather than left looking derived
 * (`.claude/rules/engineering.md`, *Derived state is computed, never restated
 * beside its source*). `tests/` is absent because a suite's spawns
 * are judged for their lane budget instead (`spawnBudget.ts`), and because a
 * fixture's deliberately-capless spawn is this scan's own subject below.
 */
const SHIPPED_TREES: readonly string[] = [
  "bin",
  "examples",
  "harness",
  "scripts",
  "src",
];

/**
 * The chain this repo runs every tick — a consumer of the package, and the
 * one whose spawns land on this machine on every loop. Named file by file
 * rather than swept as a tree: the walk below recurses, and `.flume/` also
 * holds the worktree checkouts a tick runs in (`spec/worktrees.md`), whole
 * copies of this repo that a tree would descend into and judge again.
 *
 * Neither file spawns today, so the verdict over them is empty — which is
 * the point of naming them: a capturing spawn added to this repo's own chain
 * reds where it is written rather than inheriting 1 MiB unseen.
 */
const CHAIN_FILES: readonly string[] = [
  ".flume/chain.ts",
  ".flume/declaration.ts",
];

/**
 * What the scan reads: trees walked whole, and files named one by one for a
 * directory whose other contents are not source of this repo's. Both refuse
 * when they resolve to nothing, so a renamed file or an emptied tree reds
 * rather than shrinking the domain silently.
 *
 * `files` is omitted by a caller whose domain is trees alone — a fixture's,
 * below. The repo's own domain is `REPO_DOMAIN`, which names both.
 */
export interface SpawnCapDomain {
  readonly trees: readonly string[];
  readonly files?: readonly string[];
}

/** Everything this repo ships or runs, outside `tests/`. */
const REPO_DOMAIN: SpawnCapDomain = {
  trees: SHIPPED_TREES,
  files: CHAIN_FILES,
};

/** The extensions a module in those trees is written in. */
const SOURCE_SUFFIXES: readonly string[] = [
  ".ts",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
];

/** Emitted types declare no calls, so nothing in them is a spawn. */
const EXCLUDED_SUFFIXES: readonly string[] = [".d.ts"];

/** The specifiers a capturing API is imported through. */
const CHILD_PROCESS = new Set(["node:child_process", "child_process"]);

/**
 * How a capturing API decides whether it buffers. `execFile`, `exec` and
 * their sync forms always do — `stdio` is not theirs to read — while
 * `spawnSync` buffers whatever it pipes, which is every stream by default.
 * Async `spawn` is deliberately absent: it has no `maxBuffer` at all, hands
 * the streams to its caller, and a cap on it is enforced by hand where one
 * is wanted (`src/Prompt.ts`).
 */
const CAPTURING_APIS: ReadonlyMap<string, Family> = new Map([
  ["exec", "always"],
  ["execFile", "always"],
  ["execSync", "always"],
  ["execFileSync", "always"],
  ["spawnSync", "stdio"],
]);

/** Whether a capturing name always buffers, or buffers what `stdio` pipes. */
type Family = "always" | "stdio";

/** The option a site declares its cap under. */
const CAP_KEY = "maxBuffer";

/** The option a `spawnSync` switches its capture with. */
const STDIO_KEY = "stdio";

/** The `stdio` spellings that buffer — anything else pipes no stream. */
const PIPING_STDIO = new Set(["pipe", "overlapped"]);

/** One capturing call the scan judged. */
export interface SpawnCapSite extends ScanSite {
  /** The callee as the source spells it, e.g. `execFileWithShimRetry`. */
  readonly callee: string;
}

/**
 * The judged calls, and the ones that named no cap — over the modules the
 * domain resolved to.
 *
 * `modules` is reported rather than left in the scan's head: a module holding
 * no capturing call appears nowhere in `scanned`, so without it the domain a
 * run actually read is a fact only the scan knows, and a caller wanting it
 * would rebuild the walk (`.claude/rules/engineering.md`, *A fact the engine
 * holds is reported, never rediscovered*).
 */
export interface SpawnCapScan extends Scan<SpawnCapSite> {
  /** Every module read, repo-relative and posix-separated, in path order. */
  readonly modules: readonly string[];
}

/** A site as a failure message cites it. */
export const formatSpawnCapSite = (site: SpawnCapSite): string =>
  `${site.module}:${site.line} ${site.callee}`;

/** Every module of the domain, absolute, in a stable order. */
function spawnCapModules(root: string, domain: SpawnCapDomain): string[] {
  const found = new Set<string>();
  for (const tree of domain.trees) {
    const dir = join(root, ...tree.split("/"));
    const before = found.size;
    for (const suffix of SOURCE_SUFFIXES)
      for (const path of filesUnder({
        root: dir,
        suffix,
        excluded: EXCLUDED_SUFFIXES,
      }))
        found.add(path);
    if (found.size === before)
      throw new Error(
        `no source module under ${tree}/: the spawn-cap scan would judge ` +
          "that tree's spawns as none",
      );
  }
  for (const file of domain.files ?? []) {
    const path = join(root, ...file.split("/"));
    if (!statSync(path, { throwIfNoEntry: false })?.isFile())
      throw new Error(
        `no source module at ${file}: the spawn-cap scan would judge that ` +
          "file's spawns as none",
      );
    found.add(path);
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

function parse(path: string): ts.SourceFile {
  const js = /\.(?:m|c)?js$/.test(path);
  return ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.ESNext,
    true,
    js ? ts.ScriptKind.JS : ts.ScriptKind.TS,
  );
}

/** Every node under `node`, itself included. */
function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

/**
 * The local names a module binds to a capturing API, with the family each
 * one carries.
 *
 * A `node:child_process` import the scan cannot read its bindings off — a
 * default or namespace import, or a bare side-effect import — is refused
 * rather than skipped: every spawn that module makes would otherwise be
 * invisible and the module would report clean (`.claude/rules/engineering.md`,
 * *Loud or nothing*).
 */
function importedApis(src: ts.SourceFile, module: string): Map<string, Family> {
  const bound = new Map<string, Family>();
  for (const st of src.statements) {
    if (!ts.isImportDeclaration(st)) continue;
    if (!ts.isStringLiteralLike(st.moduleSpecifier)) continue;
    if (!CHILD_PROCESS.has(st.moduleSpecifier.text)) continue;
    const bindings = st.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings))
      throw new Error(
        `${module} imports ${st.moduleSpecifier.text} without named ` +
          "bindings; the spawn-cap scan reads a module's capturing calls off " +
          "the names it imports and would judge this module's spawns as none",
      );
    for (const el of bindings.elements) {
      const family = CAPTURING_APIS.get((el.propertyName ?? el.name).text);
      if (family) bound.set(el.name.text, family);
    }
  }
  return bound;
}

/**
 * Whether an identifier stands for a value, rather than for a name the
 * surrounding syntax spells: a member being accessed, a key being assigned, a
 * binding's source property, an import's remote name. A member access is the
 * one that matters here — `RE.exec(line)` writes a capturing API's name
 * without ever naming the API, and reading it as one hands the scan a new
 * capturing name per regular expression in the tree.
 */
function isValueReference(id: ts.Identifier): boolean {
  const parent = id.parent;
  if (!parent) return true;
  if (ts.isPropertyAccessExpression(parent) && parent.name === id) return false;
  if (ts.isQualifiedName(parent) && parent.right === id) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === id) return false;
  if (ts.isBindingElement(parent) && parent.propertyName === id) return false;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return false;
  if (ts.isPropertySignature(parent) && parent.name === id) return false;
  if (ts.isMethodDeclaration(parent) && parent.name === id) return false;
  if (ts.isParameter(parent) && parent.name === id) return false;
  return true;
}

/** The identifier at the head of a callee — the receiver, for a method. */
function calleeRoot(expr: ts.Expression): string | null {
  let node: ts.Node = expr;
  while (ts.isPropertyAccessExpression(node) || ts.isCallExpression(node))
    node = node.expression;
  return ts.isIdentifier(node) ? node.text : null;
}

/** The nearest enclosing function of `node`, or `null` at file scope. */
function enclosingFunction(node: ts.Node): ts.Node | null {
  for (let n = node.parent; n; n = n.parent)
    if (
      ts.isFunctionDeclaration(n) ||
      ts.isFunctionExpression(n) ||
      ts.isArrowFunction(n) ||
      ts.isMethodDeclaration(n)
    )
      return n;
  return null;
}

/**
 * The name a function is called by: its own where it declares one, else the
 * variable or property it is assigned to. A function with neither cannot be
 * judged at its call sites, so a forwarding call inside one is a finding at
 * the forwarder itself rather than a propagation that reaches nothing.
 */
function functionName(fn: ts.Node): string | null {
  if (
    (ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) &&
    fn.name
  )
    return fn.name.text;
  if (ts.isMethodDeclaration(fn) && ts.isIdentifier(fn.name))
    return fn.name.text;
  const parent = fn.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name))
    return parent.name.text;
  if (parent && ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name))
    return parent.name.text;
  return null;
}

/** Every parameter name a function binds, destructured ones included. */
function parameterNames(fn: ts.Node): Set<string> {
  const names = new Set<string>();
  const params = (fn as ts.SignatureDeclaration).parameters ?? [];
  for (const param of params)
    walk(param.name, (n) => {
      if (ts.isIdentifier(n)) names.add(n.text);
    });
  return names;
}

/**
 * The variable initializers in scope at a call: the enclosing function's own,
 * plus the module's top-level ones. Scoped rather than file-wide because the
 * cap reading below resolves through them, and a same-named variable in a
 * sibling function must not answer for this call's options bag.
 */
function localInitializers(
  src: ts.SourceFile,
  fn: ts.Node | null,
): Map<string, ts.Expression> {
  const locals = new Map<string, ts.Expression>();
  const collect = (root: ts.Node): void =>
    walk(root, (n) => {
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.initializer
      )
        locals.set(n.name.text, n.initializer);
    });
  for (const st of src.statements) if (ts.isVariableStatement(st)) collect(st);
  if (fn) collect(fn);
  return locals;
}

/** Whether any node under `root` declares a `maxBuffer` property. */
function declaresCap(root: ts.Node): boolean {
  let found = false;
  walk(root, (n) => {
    if (
      (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) &&
      ts.isIdentifier(n.name) &&
      n.name.text === CAP_KEY
    )
      found = true;
  });
  return found;
}

/**
 * Whether the call names its cap — in an argument, or in the initializer of
 * an identifier an argument reaches. The second arm is what reads a call
 * handed an options object built a few lines above it, and it follows the
 * chain to a fixed point so a spread of such an object reads the same.
 */
function namesCap(
  call: ts.CallExpression,
  locals: ReadonlyMap<string, ts.Expression>,
): boolean {
  const pending: ts.Node[] = [...call.arguments];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    if (declaresCap(node)) return true;
    walk(node, (n) => {
      if (!ts.isIdentifier(n) || seen.has(n.text)) return;
      seen.add(n.text);
      const init = locals.get(n.text);
      if (init) pending.push(init);
    });
  }
  return false;
}

/**
 * The names that reach a parameter of `fn` — the parameters themselves, plus
 * every local whose initializer references one, to a fixed point. These are
 * the values the *caller* supplied, and so the values whose cap is the
 * caller's to state.
 */
function paramReaching(fn: ts.Node): Set<string> {
  const reaching = parameterNames(fn);
  const locals: [string, ts.Expression][] = [];
  walk(fn, (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer)
      locals.push([n.name.text, n.initializer]);
  });
  for (;;) {
    let grew = false;
    for (const [name, init] of locals) {
      if (reaching.has(name)) continue;
      let hit = false;
      walk(init, (n) => {
        if (ts.isIdentifier(n) && isValueReference(n) && reaching.has(n.text))
          hit = true;
      });
      if (hit) {
        reaching.add(name);
        grew = true;
      }
    }
    if (!grew) break;
  }
  return reaching;
}

/**
 * Whether the call hands a caller-supplied options bag straight through — its
 * last argument is such a value by name, or one of its arguments spreads one.
 * Such a call declares no cap because it cannot: the size is the *caller's*
 * decision, so the function holding it is judged at its own call sites
 * instead.
 *
 * The options bag alone, never any argument that happens to reach a
 * parameter: a command or an argv built from one is routine at a site whose
 * cap is entirely its own to state, and reading those as forwarding would
 * excuse every capless spawn in a function that takes an argument.
 */
function forwardsOptions(
  call: ts.CallExpression,
  reaching: ReadonlySet<string>,
): boolean {
  const last = call.arguments[call.arguments.length - 1];
  if (last && ts.isIdentifier(last) && reaching.has(last.text)) return true;
  return call.arguments.some(
    (arg) =>
      ts.isObjectLiteralExpression(arg) &&
      arg.properties.some(
        (prop) =>
          ts.isSpreadAssignment(prop) &&
          ts.isIdentifier(prop.expression) &&
          reaching.has(prop.expression.text),
      ),
  );
}

/**
 * Whether a `stdio`-switched call pipes nothing, read off literals alone: a
 * string spelling, or an array of them, naming no piped stream. Anything
 * else — an identifier, a conditional, an absent `stdio`, which is node's
 * piping default — is a capture the site declares its cap for.
 */
function pipesNothing(call: ts.CallExpression): boolean {
  for (const arg of call.arguments) {
    if (!ts.isObjectLiteralExpression(arg)) continue;
    for (const prop of arg.properties) {
      if (
        !ts.isPropertyAssignment(prop) ||
        !ts.isIdentifier(prop.name) ||
        prop.name.text !== STDIO_KEY
      )
        continue;
      const value = prop.initializer;
      if (ts.isStringLiteralLike(value)) return !PIPING_STDIO.has(value.text);
      if (ts.isArrayLiteralExpression(value))
        return value.elements.every(
          (el) => ts.isStringLiteralLike(el) && !PIPING_STDIO.has(el.text),
        );
      return false;
    }
  }
  return false;
}

/**
 * The names a module binds to a capturing API by passing one around as a
 * value — an `execFile` handed to `promisify`, and nothing else. A capturing
 * name in *callee* position is a spawn, not an alias, so the call's own
 * result never becomes one.
 */
function aliases(
  src: ts.SourceFile,
  capturing: ReadonlyMap<string, Family>,
): Map<string, Family> {
  const found = new Map<string, Family>();
  walk(src, (n) => {
    if (!ts.isVariableDeclaration(n) || !ts.isIdentifier(n.name)) return;
    const bound = n.name.text;
    const init = n.initializer;
    if (!init) return;
    walk(init, (ref) => {
      if (!ts.isIdentifier(ref) || !isValueReference(ref)) return;
      const family = capturing.get(ref.text);
      if (!family) return;
      const parent = ref.parent;
      if (parent && ts.isCallExpression(parent) && parent.expression === ref)
        return;
      found.set(bound, family);
    });
  });
  return found;
}

/** One parsed module, with the path a finding cites it by. */
interface Module {
  readonly module: string;
  readonly src: ts.SourceFile;
}

/** Everything one capturing call needs to be judged by. */
interface Call {
  readonly module: string;
  readonly src: ts.SourceFile;
  readonly call: ts.CallExpression;
  readonly callee: string;
  readonly family: Family;
}

/** Every call in a module whose callee is a capturing name. */
function capturingCalls(
  mod: Module,
  capturing: ReadonlyMap<string, Family>,
): Call[] {
  const calls: Call[] = [];
  walk(mod.src, (n) => {
    if (!ts.isCallExpression(n)) return;
    const callee = calleeRoot(n.expression);
    if (!callee) return;
    const family = capturing.get(callee);
    if (!family) return;
    calls.push({ module: mod.module, src: mod.src, call: n, callee, family });
  });
  return calls;
}

/** The site a call reports as. */
function siteOf(call: Call): SpawnCapSite {
  const { line } = call.src.getLineAndCharacterOfPosition(
    call.call.getStart(call.src),
  );
  return { module: call.module, line: line + 1, callee: call.callee };
}

/** What a capturing call turns out to be. */
type Verdict = "capped" | "forwarding" | "uncaptured" | "capless";

function judge(call: Call): { verdict: Verdict; forwarder: string | null } {
  if (call.family === "stdio" && pipesNothing(call.call))
    return { verdict: "uncaptured", forwarder: null };
  const fn = enclosingFunction(call.call);
  if (namesCap(call.call, localInitializers(call.src, fn)))
    return { verdict: "capped", forwarder: null };
  if (fn && forwardsOptions(call.call, paramReaching(fn))) {
    const name = functionName(fn);
    if (name) return { verdict: "forwarding", forwarder: name };
  }
  return { verdict: "capless", forwarder: null };
}

/**
 * Every capturing call in the given domain, and the ones that name no cap.
 *
 * Two passes over one global name set. The first grows it to a fixed point:
 * the APIs each module imports, the aliases it binds them to, and every
 * function that hands a caller's options bag through to one — a wrapper whose
 * callers own the cap, so the wrapper's name is judged where it is called.
 * The second judges every call the settled set reaches.
 */
export function scanSpawnCaps(
  root: string = REPO_ROOT,
  domain: SpawnCapDomain = REPO_DOMAIN,
): SpawnCapScan {
  const modules: Module[] = spawnCapModules(root, domain).map((path) => ({
    module: relPath(root, path),
    src: parse(path),
  }));

  const capturing = new Map<string, Family>();
  for (const mod of modules)
    for (const [name, family] of importedApis(mod.src, mod.module))
      capturing.set(name, family);

  for (;;) {
    const before = capturing.size;
    for (const mod of modules) {
      for (const [name, family] of aliases(mod.src, capturing))
        if (!capturing.has(name)) capturing.set(name, family);
      for (const call of capturingCalls(mod, capturing)) {
        const { verdict, forwarder } = judge(call);
        if (verdict === "forwarding" && forwarder && !capturing.has(forwarder))
          capturing.set(forwarder, call.family);
      }
    }
    if (capturing.size === before) break;
  }

  const scanned: SpawnCapSite[] = [];
  const findings: SpawnCapSite[] = [];
  for (const mod of modules)
    for (const call of capturingCalls(mod, capturing)) {
      const { verdict } = judge(call);
      if (verdict === "uncaptured" || verdict === "forwarding") continue;
      const site = siteOf(call);
      scanned.push(site);
      if (verdict === "capless") findings.push(site);
    }
  return { modules: modules.map((mod) => mod.module), scanned, findings };
}
