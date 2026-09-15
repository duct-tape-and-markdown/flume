/**
 * The suite's host declarations, and the permission-bit denials that may only
 * sit inside one.
 *
 * `spec/cli.md`, *win32 is a supported host*, splits the lane's reds in two: a
 * case whose subject is platform-neutral is a defect in the engine or in the
 * fixture, and a case whose subject is POSIX error semantics "declares its
 * host and skips on win32 with the reason stated, never silently". This scan
 * is what makes the second half decidable — every `runIf`/`skipIf` on
 * `process.platform` in the suite, and every `chmod` that takes a permission
 * away, read off the source rather than off a lane run.
 *
 * A source scan, because both properties are what a case *declares*. A skip is
 * invisible at runtime on the host it does not skip on, so the lane that would
 * observe it is the one lane that never runs it; and a permission bit denies
 * nothing on win32 (`.claude/rules/platform-facts.md`, *`chmod` denies nothing
 * on win32*), so the case it stands in reports green over a refusal the host
 * never made. Neither is visible to a run of this suite on this host.
 *
 * The reasons live in `tests/helpers/host-declarations.json` and not here.
 * **It is data, not a module, on the `EXTERNAL_VOCABULARY` idiom
 * (`tests/commentCitations.test.ts`) and for the same reason**: `tests/` is a
 * judged tree, and a ledger spelled as source would be scanned by its own
 * scan. A `.json` no module imports is in no program.
 *
 * Not *.test.ts, so neither vitest lane collects it as a suite of its own;
 * `tests/hostDeclarations.test.ts` is its cover, and runs in the default lane.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";

import {
  REPO_ROOT,
  filesUnder,
  relPath,
  type Scan,
  type ScanSite,
} from "./repoProgram.ts";

/** The suite's root — every `.ts` under it is in the scan's domain. */
const TESTS_DIR = join(REPO_ROOT, "tests");

/** The two hosts this repo's CI runs, and the alphabet the ledger keys them by. */
export type Host = "posix" | "win32";

/** The other one — what a `skipIf` selects, and what a `!` flips to. */
const other = (host: Host): Host => (host === "win32" ? "posix" : "win32");

/**
 * The only platform literal the ledger has vocabulary for. A comparison
 * against any other name is refused rather than folded into one of the two
 * hosts: `=== "darwin"` selects neither, and reading it as one would file a
 * case under a host it does not run on (`.claude/rules/engineering.md`, *Loud
 * or nothing*).
 */
const WIN32 = "win32";

/** Vitest's registrars — the calls that can carry a host guard. */
const REGISTRAR = /^(it|test|describe|suite)$/;

/** The guarding modifiers, and which way each reads its condition. */
const GUARD = new Map<string, (host: Host) => Host>([
  ["runIf", (host) => host],
  ["skipIf", other],
]);

/**
 * The calls that take a POSIX permission away. Every spelling `node:fs` offers,
 * because which one a fixture reaches for is a detail of whether it holds a
 * path or a descriptor.
 */
const CHMOD = /^(chmod|chmodSync|lchmod|lchmodSync|fchmod|fchmodSync)$/;

/** Owner read and owner write — the bits whose absence is a denial. */
const OWNER_READ = 0o400;
const OWNER_WRITE = 0o200;

/** One host-declared case, as the ledger keys it. */
export interface HostSite extends ScanSite {
  /** The registrar's own title — a `describe` block's or a case's. */
  readonly title: string;
  /** The host it runs on; it skips on the other. */
  readonly host: Host;
  /** `<module>::<title>` — the ledger's key for this site. */
  readonly key: string;
  /** The ledger's reason, or `null` when the ledger does not name it. */
  readonly reason: string | null;
}

/** One place a fixture denies with a permission bit. */
export interface DenialSite extends ScanSite {
  /** The mode it sets, as the source spells it. */
  readonly mode: string;
  /**
   * The innermost host-declared case it sits inside, or `null` when it sits in
   * a case every host runs — which is the finding.
   */
  readonly declared: HostSite | null;
}

/**
 * Two verdicts over two judged sets, so each is a `Scan` of its own
 * (`tests/helpers/repoProgram.ts`): every host-declared case, whose findings
 * are the ones the ledger names no reason for; and every permission-bit
 * denial, whose findings are the ones standing outside a host-declared case.
 */
export interface HostScan {
  readonly declarations: Scan<HostSite>;
  readonly denials: Scan<DenialSite>;
}

/** A module the scan reads, as its text rather than as a path. */
export interface ScannedSource {
  /** Repo-relative, posix-separated — what a finding cites. */
  readonly module: string;
  readonly text: string;
}

/**
 * The ledger: `<module>::<title>` to the reason that case cannot run on the
 * other host. Read off disk on every call so a scan over a fixture and a scan
 * over the suite read the same one.
 */
export const hostDeclarationLedger = (): ReadonlyMap<string, string> =>
  new Map(
    Object.entries(
      JSON.parse(
        readFileSync(
          new URL("./host-declarations.json", import.meta.url),
          "utf8",
        ),
      ) as Record<string, string>,
    ),
  );

/** Every `.ts` under `tests/`, as the scan reads them. `dir` narrows the walk. */
export const suiteSources = (dir?: string): ScannedSource[] =>
  filesUnder({ root: TESTS_DIR, suffix: ".ts" }, dir).map((path) => ({
    module: relPath(REPO_ROOT, path),
    text: readFileSync(path, "utf8"),
  }));

/** `process.platform`, however the file spells the access. */
const isProcessPlatform = (node: ts.Node): boolean =>
  ts.isPropertyAccessExpression(node) &&
  node.name.text === "platform" &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === "process";

/**
 * The host a boolean expression selects, or `null` when it names no platform
 * at all — an ordinary `runIf` on a capability probe is not a host
 * declaration and is no business of this scan.
 */
function hostOf(
  expr: ts.Expression,
  consts: ReadonlyMap<string, Host>,
  module: string,
): Host | null {
  if (ts.isParenthesizedExpression(expr))
    return hostOf(expr.expression, consts, module);
  if (ts.isIdentifier(expr)) return consts.get(expr.text) ?? null;
  if (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.ExclamationToken
  ) {
    const inner = hostOf(expr.operand, consts, module);
    return inner === null ? null : other(inner);
  }
  if (!ts.isBinaryExpression(expr)) return null;
  const equals = expr.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken;
  const differs =
    expr.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken;
  if (!equals && !differs) return null;
  const literal = isProcessPlatform(expr.left)
    ? expr.right
    : isProcessPlatform(expr.right)
      ? expr.left
      : null;
  if (!literal || !ts.isStringLiteralLike(literal)) return null;
  if (literal.text !== WIN32)
    throw new Error(
      `${module}: a host guard compares process.platform against '${literal.text}'; ` +
        `the declared-host ledger spells a case's host as posix or win32 and ` +
        `would file this one under a host it does not run on`,
    );
  return equals ? "win32" : "posix";
}

/** The identifier at the head of a callee — `it` for `it.runIf(c)(…)`. */
function calleeRoot(expr: ts.Expression): string | null {
  let node: ts.Node = expr;
  while (ts.isPropertyAccessExpression(node) || ts.isCallExpression(node))
    node = node.expression;
  return ts.isIdentifier(node) ? node.text : null;
}

/** The host a registrar's own `.runIf`/`.skipIf` chain selects, if any. */
function guardedHost(
  expr: ts.Expression,
  consts: ReadonlyMap<string, Host>,
  module: string,
): Host | null {
  let node: ts.Node = expr;
  while (ts.isPropertyAccessExpression(node) || ts.isCallExpression(node)) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression)
    ) {
      const reading = GUARD.get(node.expression.name.text);
      const condition = node.arguments[0];
      if (reading && condition) {
        const host = hostOf(condition, consts, module);
        if (host) return reading(host);
      }
    }
    node = node.expression;
  }
  return null;
}

/** What a local name stands for, when the file bound one. */
interface Bindings {
  /** `const onPosix = process.platform !== "win32"` — a boolean. */
  readonly hosts: Map<string, Host>;
  /** `const posixOnly = it.runIf(...)` — a pre-guarded registrar. */
  readonly registrars: Map<string, Host>;
}

/**
 * Every local name the file binds to a host, at any depth. Two passes, because
 * a guarded registrar's condition may itself be a bound boolean: the booleans
 * resolve first and the registrars read them.
 *
 * Keyed by name with the last binding winning, which is the one
 * over-approximation here: a name rebound in a sibling `describe` to a
 * different host would file its cases under one of the two. No file in this
 * suite rebinds one, and a scan that saw one would still report both sites.
 */
function bindingsOf(src: ts.SourceFile, module: string): Bindings {
  const hosts = new Map<string, Host>();
  const registrars = new Map<string, Host>();
  const declarations: ts.VariableDeclaration[] = [];
  const collect = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    )
      declarations.push(node);
    ts.forEachChild(node, collect);
  };
  collect(src);

  for (const decl of declarations) {
    const host = hostOf(decl.initializer!, hosts, module);
    if (host) hosts.set((decl.name as ts.Identifier).text, host);
  }
  for (const decl of declarations) {
    const init = decl.initializer!;
    if (!ts.isCallExpression(init)) continue;
    const root = calleeRoot(init.expression);
    if (!root || !REGISTRAR.test(root)) continue;
    const host = guardedHost(init, hosts, module);
    if (host) registrars.set((decl.name as ts.Identifier).text, host);
  }
  return { hosts, registrars };
}

/** The mode a `chmod` call sets, or a `mode:` option a call is handed. */
function deniedMode(call: ts.CallExpression): ts.NumericLiteral | null {
  const denies = (literal: ts.NumericLiteral): boolean => {
    const mode = Number(literal.text);
    return (mode & OWNER_READ) === 0 || (mode & OWNER_WRITE) === 0;
  };
  const root = calleeRoot(call.expression);
  const name = ts.isPropertyAccessExpression(call.expression)
    ? call.expression.name.text
    : root;
  for (const arg of call.arguments) {
    if (name && CHMOD.test(name) && ts.isNumericLiteral(arg) && denies(arg))
      return arg;
    // The same bit handed to a writer as an option — `{ mode: 0o000 }` denies
    // exactly as `chmod` does, and a scan that read only the call name would
    // let the option shape walk past it.
    if (!ts.isObjectLiteralExpression(arg)) continue;
    for (const prop of arg.properties)
      if (
        ts.isPropertyAssignment(prop) &&
        prop.name.getText() === "mode" &&
        ts.isNumericLiteral(prop.initializer) &&
        denies(prop.initializer)
      )
        return prop.initializer;
  }
  return null;
}

/**
 * Every host-declared case in the given sources, and every permission-bit
 * denial, each denial carrying the innermost host-declared case it sits in.
 *
 * Takes its sources rather than reading disk, so the scan's own cover drives
 * the one detector the suite is judged by over a fixture written to be caught
 * (`.claude/rules/engineering.md`, *A green verdict is proven non-vacuous*).
 */
export function scanHostDeclarations(
  sources: Iterable<ScannedSource>,
): HostScan {
  const ledger = hostDeclarationLedger();
  const declarations: HostSite[] = [];
  const denials: DenialSite[] = [];

  for (const { module, text } of sources) {
    const src = ts.createSourceFile(
      module,
      text,
      ts.ScriptTarget.ESNext,
      true,
    );
    const bindings = bindingsOf(src, module);
    const lineOf = (node: ts.Node): number =>
      src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1;

    const visit = (node: ts.Node, enclosing: HostSite | null): void => {
      let inner = enclosing;
      if (ts.isCallExpression(node)) {
        const root = calleeRoot(node.expression);
        const title = node.arguments[0];
        if (root && title && ts.isStringLiteralLike(title)) {
          const host = REGISTRAR.test(root)
            ? guardedHost(node.expression, bindings.hosts, module)
            : (bindings.registrars.get(root) ?? null);
          if (host) {
            const line = lineOf(node);
            const key = `${module}::${title.text}`;
            const site: HostSite = {
              module,
              line,
              title: title.text,
              host,
              key,
              reason: ledger.get(key) ?? null,
            };
            declarations.push(site);
            inner = site;
          }
        }
        const mode = deniedMode(node);
        if (mode)
          denials.push({
            module,
            line: lineOf(mode),
            mode: mode.getText(src),
            declared: inner,
          });
      }
      ts.forEachChild(node, (child) => visit(child, inner));
    };
    visit(src, null);
  }

  return {
    declarations: {
      scanned: declarations,
      findings: declarations.filter((site) => site.reason === null),
    },
    denials: {
      scanned: denials,
      findings: denials.filter((site) => site.declared === null),
    },
  };
}

/** How a finding cites a site — the alphabet both pins report in. */
export const formatSite = (site: ScanSite & { title?: string }): string =>
  `${site.module}:${site.line}${site.title === undefined ? "" : ` ${site.title}`}`;
