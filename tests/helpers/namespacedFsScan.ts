/**
 * namespacedFsScan — the source scan that reads a module's fs calls and says
 * which of them reach disk on a path that was not composed through
 * `namespacedJoin` (`.claude/rules/platform-facts.md`, *Windows MAX_PATH
 * (~260 chars) breaks fs calls with no long component*).
 *
 * **Why a source scan at all.** `toNamespacedPath` is identity on posix, so a
 * round-trip over a deep path passes on a posix host whether the call site
 * wraps or not. Nothing a behavior test can observe carries this property
 * where the suite actually runs; the shape of the call site is what carries
 * it, and this is the one reader of that shape.
 *
 * **One spelling.** The per-module pin (`tests/Baton.test.ts`) and the
 * tree-wide one (`tests/harnessPaths.test.ts`) both judge through here, so a
 * module joining the scan cannot be admitted by a looser copy of the rule
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 *
 * The subjects are a module's *own* fs imports, never a list restated by a
 * caller: a new fs import joins the scan by being written.
 *
 * The rule is the shared idiom, not merely a namespaced result: a path
 * already spelled `toNamespacedPath(join(…))` by hand reds here, because the
 * fact's own instruction is to reach for `namespacedJoin` rather than
 * re-pair the two steps at a call site.
 */

/**
 * The modules whose named exports reach disk. `fsProbe` is one of them: it
 * stats the path it is handed and declares the join its caller's
 * (`src/fsProbe.ts`), so a call on a bare join there is the same defect as a
 * `node:fs` one.
 */
const FS_MODULE = /^(?:node:)?fs(?:\/promises)?$|(?:^|\/)fsProbe\.js$/;

/**
 * The fs calls whose *second* argument is a path as well — node:fs's copy,
 * move and link family, where destination and source are both on disk.
 * Every other fs call takes its only path first, and a second argument that
 * is content (`writeFile`'s body) or options (`mkdir`'s `{ recursive }`) is
 * not a path and is not scanned.
 */
const SECOND_PATH_ARG = new Set([
  "copyFile",
  "copyFileSync",
  "cp",
  "cpSync",
  "rename",
  "renameSync",
  "link",
  "linkSync",
  "symlink",
  "symlinkSync",
]);

/** How many bindings deep a path expression may be resolved before giving up. */
const MAX_HOPS = 8;

/** One fs call site whose path argument was not composed through `namespacedJoin`. */
export interface BareFsCall {
  /** The imported fs symbol called, as the module binds it locally. */
  fn: string;
  /** Which argument is the path that did not compose — 0 or 1. */
  position: number;
  /** That argument's text, string bodies blanked — for the failure message. */
  argument: string;
  /** 1-indexed line of the call, for the failure message. */
  line: number;
}

/**
 * `source` with every comment blanked out character for character — spaces,
 * newlines kept — so offsets, and therefore line numbers, are identical to
 * the original. String bodies survive: an import's specifier lives in one.
 *
 * Comments go because a doc comment naming a call (`readFileSync(…)` in
 * prose) is not a call site, and a scan that counted it would go red over a
 * sentence.
 */
function stripComments(source: string): string {
  return mask(source, false);
}

/**
 * The same, plus every string and template body blanked — the form call
 * sites are read from. A path spelled inside a string is not an expression
 * this scan can resolve, and a `,` or `(` there would mis-split an argument
 * list.
 */
function maskNonCode(source: string): string {
  return mask(source, true);
}

function mask(source: string, strings: boolean): string {
  const out = source.split("");
  let i = 0;
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < out.length; k++) {
      if (out[k] !== "\n") out[k] = " ";
    }
  };
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "//") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    const ch = source[i]!;
    if (ch === '"' || ch === "'" || ch === "`") {
      let k = i + 1;
      while (k < source.length) {
        if (source[k] === "\\") {
          k += 2;
          continue;
        }
        if (source[k] === ch) break;
        k++;
      }
      if (strings) blank(i + 1, Math.min(k, source.length));
      i = Math.min(k + 1, source.length);
      continue;
    }
    i++;
  }
  return out.join("");
}

/** The named imports `clause` binds locally — `as`-aliases resolved, type-only dropped. */
function localNames(clause: string): string[] {
  return clause
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0 && !/^type\s/.test(name))
    .map((name) => name.split(/\s+as\s+/).pop()!.trim());
}

/**
 * The fs-call symbols `source` imports, keyed by the module specifier they
 * came from. A module that imports no fs at all yields an empty map, which
 * is a real answer and not a vacuous one — the tree-wide scan's vacuity pin
 * is over modules that do.
 *
 * Refuses a namespace import (`import * as fs from "node:fs"`): its call
 * sites are member expressions this scan does not read, so admitting one
 * would leave a module's fs calls silently unjudged (*Loud or nothing*).
 */
export function fsImports(source: string): Map<string, string[]> {
  const code = stripComments(source);
  const found = new Map<string, string[]>();
  for (const m of code.matchAll(
    /import\s+(type\s+)?(\{[^}]*\}|\*\s+as\s+[A-Za-z_$][\w$]*)\s+from\s+["']([^"']*)["']/g,
  )) {
    const specifier = m[3] ?? "";
    if (!FS_MODULE.test(specifier)) continue;
    if (m[1]) continue; // `import type` — a type is never a call site.
    const clause = m[2] ?? "";
    if (!clause.startsWith("{")) {
      throw new Error(
        `namespacedFsScan: namespace import from "${specifier}" — its call ` +
          `sites are member expressions this scan does not read. Import the ` +
          `fs symbols by name so the scan can judge them.`,
      );
    }
    const names = localNames(clause.slice(1, -1));
    found.set(specifier, [...(found.get(specifier) ?? []), ...names]);
  }
  return found;
}

/** Every fs-call symbol `source` imports, flattened. */
export function fsSymbols(source: string): string[] {
  return [...fsImports(source).values()].flat();
}

/** Strip an arrow function's head, leaving its body expression. */
function arrowBody(expression: string): string {
  const head = /^(?:async\s+)?(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*(?::\s*[^=]+?)?\s*=>\s*/.exec(
    expression,
  );
  return head ? expression.slice(head[0].length) : expression;
}

/**
 * Whether `expression` reaches `namespacedJoin`, following module-local
 * bindings.
 *
 * A path argument is routinely a name rather than the composition itself —
 * `const path = onDisk(stateRoot)` over a `const onDisk = (root) =>
 * namespacedJoin(…)` — and demanding the literal wrap at the call site would
 * be the test dictating how the module spells itself. So the head token is
 * resolved through `const`/`let` bindings of that name, up to {@link
 * MAX_HOPS}. *Every* binding of the name must compose: a module that binds
 * one `path` safely and another barely is red, not half-green.
 *
 * A binding whose value is a block-bodied function is not followed — the
 * scan reads expressions, not control flow — so such a call site wraps at
 * the call instead.
 */
function composesThroughNamespacedJoin(
  masked: string,
  expression: string,
  seen: Set<string> = new Set(),
): boolean {
  const text = arrowBody(expression.trim());
  if (text.startsWith("namespacedJoin(")) return true;
  if (seen.size >= MAX_HOPS) return false;

  const head = /^([A-Za-z_$][\w$]*)\s*(\(|$)/.exec(text);
  const name = head?.[1];
  if (name === undefined || seen.has(name)) return false;

  const bindings = [
    ...masked.matchAll(
      new RegExp(`\\b(?:const|let)\\s+${name}\\b\\s*(?::[^=;\\n]*)?=\\s*`, "g"),
    ),
  ];
  if (bindings.length === 0) return false;

  const next = new Set([...seen, name]);
  return bindings.every((b) =>
    composesThroughNamespacedJoin(masked, masked.slice(b.index! + b[0].length), next),
  );
}

/** The source text of `fn(`'s arguments at `open`, top-level commas only. */
function splitArguments(masked: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < masked.length; i++) {
    const ch = masked[i]!;
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (ch === ")" && depth === 0) {
        args.push(masked.slice(start, i));
        return args;
      }
      depth--;
    } else if (ch === "," && depth === 0) {
      args.push(masked.slice(start, i));
      start = i + 1;
    }
  }
  return args;
}

/** What one module's scan found. */
export interface FsCallScan {
  /** The fs symbols the module imports, in import order. */
  symbols: string[];
  /** How many path arguments were judged — the scan's own vacuity count. */
  judged: number;
  /** The judged arguments that were not composed through `namespacedJoin`. */
  bare: BareFsCall[];
  /** Imported fs symbols the module never calls — an import the scan cannot judge. */
  uncalled: string[];
}

/**
 * Every fs call in `source`, with the path arguments that were not composed
 * through `namespacedJoin`. An empty `bare` over a non-zero `judged` means
 * the module holds the idiom throughout; `judged` is zero exactly when the
 * module imports no fs, which is why callers pin it rather than reading the
 * empty list as a verdict (`.claude/rules/engineering.md`, *A green verdict
 * is proven non-vacuous*).
 *
 * Member calls (`api.readFile(…)`) are not call sites of the imported symbol
 * and are skipped.
 */
export function scanFsCalls(source: string): FsCallScan {
  const masked = maskNonCode(source);
  const symbols = fsSymbols(source);
  const bare: BareFsCall[] = [];
  const uncalled: string[] = [];
  let judged = 0;

  for (const fn of symbols) {
    const calls = [...masked.matchAll(new RegExp(`(?<![.\\w$])${fn}\\s*\\(`, "g"))];
    if (calls.length === 0) {
      uncalled.push(fn);
      continue;
    }
    for (const call of calls) {
      const open = call.index! + call[0].length - 1;
      const args = splitArguments(masked, open);
      for (const position of SECOND_PATH_ARG.has(fn) ? [0, 1] : [0]) {
        const argument = args[position];
        if (argument === undefined) continue;
        judged++;
        if (composesThroughNamespacedJoin(masked, argument)) continue;
        bare.push({
          fn,
          position,
          argument: argument.trim(),
          line: source.slice(0, call.index!).split("\n").length,
        });
      }
    }
  }
  return { symbols, judged, bare, uncalled };
}

/** A `BareFsCall` as one line of a failure message. */
export function describeBareCall(call: BareFsCall, where: string): string {
  return `${where}:${call.line} — ${call.fn}() path argument ${call.position}, \`${call.argument}\`, is not built through namespacedJoin`;
}
