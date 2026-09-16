/**
 * namespacedFsScan — the source scan that reads a module's fs calls and says
 * which of them reach disk on a path that was not composed for win32's
 * total-path limit (`.claude/rules/platform-facts.md`, *Windows MAX_PATH
 * (~260 chars) breaks fs calls with no long component*).
 *
 * **Why a source scan at all.** `toNamespacedPath` is identity on posix, so a
 * round-trip over a deep path passes on a posix host whether the call site
 * wraps or not. Nothing a behavior test can observe carries this property
 * where the suite actually runs; the shape of the call site is what carries
 * it, and this is the one reader of that shape.
 *
 * **One spelling.** The per-module pin (`tests/Baton.test.ts`) and the
 * tree-wide one (`tests/namespacedFsPaths.test.ts`) both judge through here,
 * so a module joining the scan cannot be admitted by a looser copy of the
 * rule (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 *
 * The subjects are a module's *own* fs imports, never a list restated by a
 * caller: a new fs import joins the scan by being written.
 *
 * **What counts as composed.** `namespacedJoin` (`src/paths.ts`) is the
 * shared idiom, and a path built from segments reaches for it: a site
 * spelling `toNamespacedPath(join(…))` by hand reds here, because re-pairing
 * the two steps at a call site is what the shared idiom exists to stop. A
 * path that arrives whole — a caller's dir, a resolved manifest, a value a
 * layout accessor already returned — has no segments to join, and
 * `toNamespacedPath` over it is the whole fold; `toNamespacedPath(<anything
 * but a join>)` therefore passes, and is the form most of `src/` already
 * carries.
 *
 * **Whose fold it is.** Which arguments of a call are paths, and who
 * composed them, is the called symbol's own contract, not "argument 0, the
 * caller's" everywhere: `statLoud` and `existsLoud` (`src/fsProbe.ts`) stat
 * the path they are handed and say so, while `isDirectoryOrAbsent` names its
 * subject first and namespaces each step of the variadic descent after it.
 * The scan reads that contract per symbol ({@link PATH_CONTRACTS}), so a
 * subject label is never mistaken for a path and a descent's paths are never
 * charged to the caller.
 *
 * **Where the answer goes.** The same contract says whether a call answers
 * with a path built from the one it was handed — `realpath`, `readlink`,
 * `mkdtemp`, recursive `mkdir`. A fold spent at one of those rides back out
 * through its answer, still in win32's `\\?\` alphabet, and a consumer that
 * parses a path reads that alphabet as something else entirely
 * (`pathToFileURL` reads `\\?\C:\…` as a UNC host). So the scan follows
 * the answer outward through the call expression it is written into: another
 * fs call may read it, anything else is an escape ({@link
 * EscapedNamespacedPath}). It follows an *expression*, never a binding
 * graph — a fold bound to a name or returned to a caller is spent wherever
 * that name is, which is the fold's own module to say and the composition
 * verdict above to judge.
 */

/**
 * The engine's loud existence probe, by module stem. Both uses below are the
 * one fact: a module importing from it reaches disk (so those calls are
 * scanned), and the probe's own module is where the path a caller composed
 * is finally spent (so its calls are not scanned again).
 */
const PROBE_STEM = "fsProbe";

/**
 * The modules whose named exports reach disk. The probe is one of them: it
 * stats the path it is handed and declares the join its caller's
 * (`src/fsProbe.ts`), so a call on a bare join there is the same defect as a
 * `node:fs` one.
 */
const FS_MODULE = new RegExp(
  `^(?:node:)?fs(?:/promises)?$|(?:^|/)${PROBE_STEM}\\.js$`,
);

/**
 * The probe's own source, judged as nobody's caller. Its `statSync` *is* the
 * call every scanned path is composed for, and the contract it declares is
 * that the caller already folded (`src/fsProbe.ts`) — so demanding a fold
 * there is the scan asking the delegate to redo what it delegates. Its
 * imports are still read, so an fs symbol it imports and never calls is
 * still reported.
 */
const PROBE_SOURCE = new RegExp(`(?:^|/)${PROBE_STEM}\\.ts$`);

/** Which arguments of one fs call carry a path, and who composed them. */
interface PathContract {
  /** The argument positions holding a path, given the call's arity. */
  positions: (arity: number) => number[];
  /**
   * `true` when the callee folds each path it is handed, so the call site
   * owes nothing: the argument is read as a path and not judged.
   */
  calleeFolds: boolean;
  /**
   * `true` when the call answers with a path built from the one it was
   * handed, so a namespaced argument comes back out through the answer.
   * Content (`readFile`), stats (`stat`), a boolean or nothing at all carry
   * no path, and the fold is spent at the call.
   */
  answersPath: boolean;
}

/** Argument 0, composed by the caller — every fs call not named below. */
const CALLER_FOLDS_FIRST: PathContract = {
  positions: () => [0],
  calleeFolds: false,
  answersPath: false,
};

/**
 * The calls whose path arguments are not "the first one, the caller's".
 *
 * `node:fs`'s copy, move and link family takes a destination as well as a
 * source, both on disk. Every other `node:fs` call takes its only path
 * first, and a second argument that is content (`writeFile`'s body) or
 * options (`mkdir`'s `{ recursive }`) is not a path and is not scanned.
 *
 * `isDirectoryOrAbsent` (`src/fsProbe.ts`) is the variadic one: argument 0
 * is the noun phrase its refusal names, and every argument after it is a
 * step of a descent the probe namespaces itself, because it owns the whole
 * walk rather than a path a caller composed.
 *
 * The middle family is node's path-answering one: each builds its answer
 * from the path it was given (`mkdir`'s under `{ recursive }`, which is why
 * it is here rather than in the default), so a namespaced argument leaves
 * again through the return value.
 */
const PATH_CONTRACTS = new Map<string, PathContract>([
  ...[
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
  ].map<[string, PathContract]>((fn) => [
    fn,
    { positions: () => [0, 1], calleeFolds: false, answersPath: false },
  ]),
  ...[
    "realpath",
    "realpathSync",
    "readlink",
    "readlinkSync",
    "mkdtemp",
    "mkdtempSync",
    "mkdir",
    "mkdirSync",
  ].map<[string, PathContract]>((fn) => [
    fn,
    { positions: () => [0], calleeFolds: false, answersPath: true },
  ]),
  [
    "isDirectoryOrAbsent",
    {
      positions: (arity) =>
        Array.from({ length: Math.max(arity - 1, 0) }, (_, i) => i + 1),
      calleeFolds: true,
      answersPath: false,
    },
  ],
]);

/**
 * How many hops a path may be followed before the scan gives up — bindings
 * resolved inward from a call site, fs answers followed outward from one.
 */
const MAX_HOPS = 8;

/** One fs call site whose path argument was not composed. */
export interface BareFsCall {
  /** The imported fs symbol called, as the module binds it locally. */
  fn: string;
  /** Which argument is the path that did not compose. */
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
 * Whether `expression` is a composed path, following module-local bindings.
 *
 * `namespacedJoin(…)` composes; `toNamespacedPath(…)` composes over anything
 * that is not itself a `join`, which is the header's rule at the rung the
 * scan can hold it.
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
function isComposed(
  masked: string,
  expression: string,
  seen: Set<string> = new Set(),
): boolean {
  const text = arrowBody(expression.trim());
  if (text.startsWith("namespacedJoin(")) return true;
  if (text.startsWith("toNamespacedPath(")) {
    const inner = splitArguments(text, text.indexOf("("))[0] ?? "";
    return !/^\s*join\s*\(/.test(inner);
  }
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
    isComposed(masked, masked.slice(b.index! + b[0].length), next),
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

/** Heads that open a parenthesis without being a call. */
const NOT_A_CALLEE = new Set(["if", "while", "for", "switch", "catch", "return"]);

/**
 * The call whose argument list encloses `index`, if any: its callee as the
 * source spells it, and where that callee starts.
 *
 * Read right-to-left over the masked source — a closing bracket opens a depth
 * its opener closes, and the first opener still open at depth zero is the one
 * `index` sits inside. Only a `(` with a callee before it is a call: a
 * grouping paren, `if (`, an array or object literal, and a statement
 * boundary all answer `undefined`, which is this reader saying the value was
 * written somewhere it does not follow. A member callee keeps its dots, so
 * `JSON.parse` is never read as an imported `parse`.
 */
function enclosingCall(
  masked: string,
  index: number,
): { callee: string; start: number } | undefined {
  let depth = 0;
  for (let i = index - 1; i >= 0; i--) {
    const ch = masked[i]!;
    if (ch === ")" || ch === "]" || ch === "}") {
      depth++;
      continue;
    }
    if (ch === ";" && depth === 0) return undefined;
    if (ch === "(" || ch === "[" || ch === "{") {
      if (depth > 0) {
        depth--;
        continue;
      }
      if (ch !== "(") return undefined;
      const head = /([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*$/.exec(
        masked.slice(0, i),
      );
      const callee = head?.[1]?.replace(/\s+/g, "");
      if (callee === undefined || NOT_A_CALLEE.has(callee)) return undefined;
      return { callee, start: i - head![1]!.length };
    }
  }
  return undefined;
}

/**
 * The callee that reads the namespaced answer of the fs call starting at
 * `start` while being no fs call itself — the escape, if there is one.
 *
 * A path-answering fs call hands the alphabet along in its own answer, so the
 * walk follows it outward; any other fs call spends the path and the walk
 * stops. An answer written into a binding, a `return`, or a statement of its
 * own leaves the expression this reader follows, and is the module's own to
 * spend (the header's *Where the answer goes*).
 */
function readerPastFs(
  masked: string,
  fsSymbols: readonly string[],
  start: number,
): string | undefined {
  let at = start;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const outer = enclosingCall(masked, at);
    if (outer === undefined) return undefined;
    if (!fsSymbols.includes(outer.callee)) return outer.callee;
    const contract = PATH_CONTRACTS.get(outer.callee) ?? CALLER_FOLDS_FIRST;
    if (!contract.answersPath) return undefined;
    at = outer.start;
  }
  return undefined;
}

/** One namespaced answer read by a callee that does not speak that alphabet. */
export interface EscapedNamespacedPath {
  /** The fs symbol that answered with a path, as the module binds it. */
  fn: string;
  /** The callee that read the answer, as the source spells it. */
  reader: string;
  /** 1-indexed line of the fs call that answered, for the failure message. */
  line: number;
}

/** What one module's scan found. */
export interface FsCallScan {
  /** The module scanned, from the repo root — the failure message's subject. */
  module: string;
  /** The fs symbols the module imports, in import order. */
  symbols: string[];
  /** How many path arguments this module owed a fold on — its vacuity count. */
  judged: number;
  /**
   * How many path arguments were read at a call whose callee folds them
   * ({@link PATH_CONTRACTS}) — read, never charged to this module.
   */
  delegated: number;
  /** The judged arguments that were not composed. */
  bare: BareFsCall[];
  /**
   * How many calls answered with a path built from a namespaced argument —
   * the vacuity count for {@link FsCallScan.escaped}, which is empty both
   * for a module that spends every answer at an fs call and for one that
   * never made such a call at all.
   */
  answered: number;
  /** The answers of those calls that a non-fs callee read. */
  escaped: EscapedNamespacedPath[];
  /** Imported fs symbols the module never calls — an import the scan cannot judge. */
  uncalled: string[];
}

/**
 * Every fs call in `module`'s `source`, with the path arguments its own call
 * sites owed a fold on and did not compose. An empty `bare` over a non-zero
 * `judged` means the module holds the idiom throughout; `judged` is zero
 * when the module imports no fs, and when every path it passes is one a
 * callee folds, which is why callers pin it rather than reading the empty
 * list as a verdict (`.claude/rules/engineering.md`, *A green verdict is
 * proven non-vacuous*).
 *
 * `escaped` is the other half: where a call answered with a path built from
 * a namespaced argument ({@link PathContract.answersPath}), the answer is
 * followed outward through the expression it was written into, and a callee
 * that is no fs call reading it is reported. `answered` is that verdict's
 * vacuity count, for the same reason `judged` is the composition verdict's.
 *
 * Member calls (`api.readFile(…)`) are not call sites of the imported symbol
 * and are skipped.
 */
export function scanFsCalls(module: string, source: string): FsCallScan {
  const masked = maskNonCode(source);
  const symbols = fsSymbols(source);
  const isProbe = PROBE_SOURCE.test(module);
  const bare: BareFsCall[] = [];
  const escaped: EscapedNamespacedPath[] = [];
  const uncalled: string[] = [];
  let judged = 0;
  let delegated = 0;
  let answered = 0;
  const lineOf = (index: number): number => source.slice(0, index).split("\n").length;

  for (const fn of symbols) {
    const calls = [...masked.matchAll(new RegExp(`(?<![.\\w$])${fn}\\s*\\(`, "g"))];
    if (calls.length === 0) {
      uncalled.push(fn);
      continue;
    }
    if (isProbe) continue;
    const contract = PATH_CONTRACTS.get(fn) ?? CALLER_FOLDS_FIRST;
    for (const call of calls) {
      const open = call.index! + call[0].length - 1;
      const args = splitArguments(masked, open);
      let namespacedAnswer = false;
      for (const position of contract.positions(args.length)) {
        const argument = args[position];
        if (argument === undefined) continue;
        if (contract.calleeFolds) {
          delegated++;
          continue;
        }
        judged++;
        if (isComposed(masked, argument)) {
          namespacedAnswer ||= contract.answersPath;
          continue;
        }
        bare.push({
          fn,
          position,
          argument: argument.trim(),
          line: lineOf(call.index!),
        });
      }
      if (!namespacedAnswer) continue;
      answered++;
      const reader = readerPastFs(masked, symbols, call.index!);
      if (reader !== undefined) {
        escaped.push({ fn, reader, line: lineOf(call.index!) });
      }
    }
  }
  return { module, symbols, judged, delegated, bare, answered, escaped, uncalled };
}

/** A `BareFsCall` as one line of a failure message, named by its module. */
export function describeBareCall(scan: FsCallScan, call: BareFsCall): string {
  return `${scan.module}:${call.line} — ${call.fn}() path argument ${call.position}, \`${call.argument}\`, is not composed for win32's path limit`;
}


/** An `EscapedNamespacedPath` as one line of a failure message. */
export function describeEscape(
  scan: FsCallScan,
  escape: EscapedNamespacedPath,
): string {
  return `${scan.module}:${escape.line} — ${escape.fn}() answers a path in win32's namespaced alphabet and ${escape.reader}(), which is no fs call, reads it`;
}
