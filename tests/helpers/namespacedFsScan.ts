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
 * fs call may read it, so may the fold's own terminator ({@link
 * ALPHABET_FOLD}), anything else is an escape ({@link
 * EscapedNamespacedPath}). It follows an *expression*, never a binding
 * graph — a fold bound to a name or returned to a caller is spent wherever
 * that name is, which is the fold's own module to say and the composition
 * verdict above to judge.
 *
 * **And an answer that never crosses that expression.** `node:fs`'s callback
 * forms hand their answer to a function the call site passed, so the walk
 * above reaches nothing and returns nothing — which reads exactly like a
 * clean call. Such a call is reported unfollowed instead ({@link
 * UnfollowedAnswer}): the refusal that bounds the walk's reach, rather than a
 * verdict passed over an answer nothing read (`.claude/rules/engineering.md`,
 * *Loud or nothing*).
 *
 * **Which head takes it.** The last thing the contract says is whether the
 * symbol's plain spelling can be handed a namespaced path at all. Node's JS
 * `realpath` and `realpathSync` cannot take one through node 22 — the sync
 * form throws the root probe's error and the callback form hands that same
 * error to its callback — and only a `.native` head (libuv) resolves one, so
 * a composed path at the bare name is a call that cannot run where the
 * composition exists for ({@link JsFormCall}) — the one shape whose fold is
 * correct and whose callee is wrong.
 *
 * **And which contract a name carries is the specifier's to say.** One name
 * reaches two implementations: `node:fs`'s `realpath` is that JS walk,
 * `node:fs/promises`'s is the native binding under the same spelling. So a
 * contract is looked up by the specifier a name was imported from ({@link
 * contractFor}), never by the name alone — a refusal flat over the name would
 * red a promises call that resolves, and that has no `.native` head a site
 * could be asked for instead.
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
 * Node's promise face of `fs`, by specifier. Its `realpath` is the native
 * binding — no root split, prefix stripped — while `node:fs`'s `realpath` is
 * the same JS walk as `realpathSync` and fails the same way on a namespaced
 * drive path (`.claude/rules/platform-facts.md`, *`realpathSync` keeps the
 * `\\?\` prefix only where nothing resolved*). One name, two contracts, told
 * apart by nothing the call site spells — which is why {@link contractFor}
 * takes the specifier.
 */
const PROMISES_MODULE = /^(?:node:)?fs\/promises$/;

/**
 * The probe's own source, judged as nobody's caller. Its `statSync` *is* the
 * call every scanned path is composed for, and the contract it declares is
 * that the caller already folded (`src/fsProbe.ts`) — so demanding a fold
 * there is the scan asking the delegate to redo what it delegates. Its
 * imports are still read, so an fs symbol it imports and never calls is
 * still reported.
 */
const PROBE_SOURCE = new RegExp(`(?:^|/)${PROBE_STEM}\\.ts$`);

/**
 * Where a path-answering fs call's answer arrives, and so whether this scan
 * can follow it — {@link PathContract.answer}.
 */
type AnswerRoute = "none" | "expression" | "callback";

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
   * Where a path built from the one the call was handed comes back out, so a
   * namespaced argument leaves the call again.
   *
   * - `"none"` — nothing of the path comes back. Content (`readFile`), stats
   *   (`stat`), a boolean or nothing at all carry no path, and the fold is
   *   spent at the call.
   * - `"expression"` — the call evaluates to the path, so the answer rides
   *   out through the expression it is written into, which is what {@link
   *   readerPastFs} follows.
   * - `"callback"` — the path arrives at a function the call site passed in,
   *   and nothing of it crosses the call expression at all. That walk cannot
   *   reach it, so the call is reported unfollowed rather than judged clean
   *   ({@link UnfollowedAnswer}).
   */
  answer: AnswerRoute;
  /**
   * `true` when the symbol's JS implementation refuses a path in win32's
   * namespaced alphabet, so only its `.native` head reaches disk with one
   * (`.claude/rules/platform-facts.md`, *`realpathSync` keeps the `\\?\`
   * prefix only where nothing resolved*). The composition and the callee are
   * one property here: a fold this symbol's bare spelling is handed is not a
   * safer path, it is a failure — thrown by the sync form, handed to the
   * callback by the async one. Read against the specifier, never the bare
   * name ({@link contractFor}).
   */
  nativeOnly: boolean;
}

/** Argument 0, composed by the caller — every fs call not named below. */
const CALLER_FOLDS_FIRST: PathContract = {
  positions: () => [0],
  calleeFolds: false,
  answer: "none",
  nativeOnly: false,
};

/**
 * One path-answering name as `node:fs` binds its two spellings: the async one
 * is the callback form, whose answer arrives at a function the call site
 * passed and never crosses the call expression, and the sync one answers
 * through that expression itself.
 *
 * The route is declared per spelling here rather than read off the Sync
 * suffix where it is used: node's naming is not a fact this scan gets to
 * infer from a name. `node:fs/promises` binds the async spelling to a promise
 * the expression does carry, which is {@link contractFor}'s to say.
 */
function answeringPair(
  callbackForm: string,
  syncForm: string,
  nativeOnly: boolean,
): [string, PathContract][] {
  const shared = { positions: () => [0], calleeFolds: false, nativeOnly };
  return [
    [callbackForm, { ...shared, answer: "callback" }],
    [syncForm, { ...shared, answer: "expression" }],
  ];
}

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
 * again — out through the return value at the sync spelling, into a callback
 * at the async one ({@link answeringPair}).
 *
 * `realpath` and `realpathSync` sit last because they answer a path *and*
 * are the spellings whose bare form refuses the argument: node's JS walk
 * splits a root off the path it was handed, so only a `.native` head takes a
 * namespaced one through node 22 (`.claude/rules/platform-facts.md`,
 * *`realpathSync` keeps the `\\?\` prefix only where nothing resolved*).
 * That is `node:fs`'s contract for both names; `node:fs/promises` binds
 * `realpath` to the native binding instead, which is {@link contractFor}'s to
 * read off the specifier.
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
    {
      positions: () => [0, 1],
      calleeFolds: false,
      answer: "none",
      nativeOnly: false,
    },
  ]),
  ...answeringPair("readlink", "readlinkSync", false),
  ...answeringPair("mkdtemp", "mkdtempSync", false),
  ...answeringPair("mkdir", "mkdirSync", false),
  ...answeringPair("realpath", "realpathSync", true),
  [
    "isDirectoryOrAbsent",
    {
      positions: (arity) =>
        Array.from({ length: Math.max(arity - 1, 0) }, (_, i) => i + 1),
      calleeFolds: true,
      answer: "none",
      nativeOnly: false,
    },
  ],
]);

/**
 * The contract `fn` carries, given the specifier it was imported from.
 *
 * Every contract is the symbol's own, except where the promise face of `fs`
 * reaches a different implementation under the same name ({@link
 * PROMISES_MODULE}). Two fields are that one fact: there is no JS form to
 * refuse and no `.native` head a site could be asked for ({@link
 * PathContract.nativeOnly}), and the answer comes back through the call
 * expression rather than at a callback ({@link PathContract.answer}). Both
 * are re-keyed here and nowhere else, so a reader of a contract never has to
 * remember which spelling it came from.
 */
function contractFor(specifier: string, fn: string): PathContract {
  const contract = PATH_CONTRACTS.get(fn) ?? CALLER_FOLDS_FIRST;
  if (!PROMISES_MODULE.test(specifier)) return contract;
  return {
    ...contract,
    answer: contract.answer === "callback" ? "expression" : contract.answer,
    nativeOnly: false,
  };
}

/**
 * The one symbol whose job *is* win32's namespaced alphabet: `plainPath`
 * (`src/paths.ts`) reads a path in it and answers outside it, which is where
 * a fold riding out on an fs answer is finally spent. It is no fs call, so
 * without this the scan would red the one site that ends the alphabet
 * correctly and leave only the two shapes that hide it — binding the answer
 * to a name, or not folding back at all.
 *
 * Read by name, exactly as `isComposed` reads the composers: this scan
 * resolves no imports, and a module spelling its own `plainPath` is the same
 * looseness the composition verdict already carries.
 */
const ALPHABET_FOLD = "plainPath";

/**
 * How many hops a path may be followed before the scan gives up — bindings
 * resolved inward from a call site, fs answers followed outward from one.
 */
const MAX_HOPS = 8;

/**
 * The imported fs symbol `callee` is a call of, if it is a call of one at all.
 *
 * A member callee keeps its dots ({@link enclosingCall}), which is what stops
 * `JSON.parse` being read as an imported `parse`. But a dotted callee whose
 * *head* is an imported fs symbol is that symbol extended rather than a
 * stranger that merely shares a name: `realpathSync.native` is libuv's
 * spelling of `realpathSync`, reaches the same disk on the same argument, and
 * answers on the same contract. Reading it as its head is what keeps such a
 * call judged — a scan that skipped it would leave the site unread and then
 * report the symbol as imported-and-never-called.
 */
function fsCallee(
  callee: string,
  fsSymbols: readonly string[],
): string | undefined {
  const head = callee.split(".")[0]!;
  return fsSymbols.includes(head) ? head : undefined;
}

/**
 * How one fs symbol's call sites are spelled: the bare name, or that name
 * extended by member access ({@link fsCallee}). The lookbehind keeps a
 * *receiver* of the same name from matching — `api.realpathSync(…)` is not
 * this module's import. A name opening a parenthesis is a candidate here and
 * a call site once {@link declaresParameters} has read what the parenthesis
 * opens.
 */
function callSites(fn: string): RegExp {
  return new RegExp(
    `(?<![.\\w$])${fn}(?:\\s*\\.\\s*[A-Za-z_$][\\w$]*)*\\s*\\(`,
    "g",
  );
}

/** One parameter of a signature: `k: string`, `k?: string`, `...rest: T[]`. */
const PARAMETER = /^\s*(?:\.\.\.)?[A-Za-z_$][\w$]*\s*\??\s*:/;

/**
 * Whether a parenthesis opens a *parameter* list rather than an argument one:
 * `readFileSync(k: string): string` inside a type literal is a signature the
 * module describes, not a call it makes. No path reaches disk there, so
 * counting it inflates the vacuity subject both verdicts ride
 * (`.claude/rules/engineering.md`, *A green verdict is proven non-vacuous*)
 * and reds a correct module the first time one is written.
 *
 * Read off the argument text alone, which is all this scan has: under
 * `strict` every parameter of a signature carries its own annotation, so a
 * list whose every entry is `name: T` is a declaration. No call expression
 * spells that — a top-level `:` in an argument list is a ternary's, and a
 * ternary's `?` sits between the name and the colon.
 *
 * An empty list is nobody's declaration to tell apart, and stays a call site:
 * both directions are loud there anyway, since an fs call with no path
 * argument is judged bare, and a module whose only spelling of an import is
 * `name()` in a type position reports that import uncalled.
 */
function declaresParameters(args: readonly string[]): boolean {
  return args.length > 0 && args.every((arg) => PARAMETER.test(arg));
}

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
 * `JSON.parse` is never read as an imported `parse`; whether such a callee is
 * an fs symbol's own extension is {@link fsCallee}'s to say.
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
 * stops, as does {@link ALPHABET_FOLD}, whose answer is no longer in it. An
 * answer written into a binding, a `return`, or a statement of its own leaves
 * the expression this reader follows, and is the module's own to spend (the
 * header's *Where the answer goes*).
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
    if (outer.callee === ALPHABET_FOLD) return undefined;
    const fn = fsCallee(outer.callee, fsSymbols);
    if (fn === undefined) return outer.callee;
    // What this walk asks of a call it passes through is whether the alphabet
    // rides on out of it, and only `"expression"` does: a call that spends the
    // path answers `"none"`, and a callback form puts its answer where no
    // expression reaches.
    //
    // Read by name rather than by specifier, so the promise face of `fs` —
    // which {@link contractFor} re-keys to `"expression"` — stops the walk at
    // a call whose answer does ride out. That divergence is the conservative
    // direction, and the shape it declines to chase is already red at the
    // outer call's own path argument, which reads as no composition.
    const contract = PATH_CONTRACTS.get(fn) ?? CALLER_FOLDS_FIRST;
    if (contract.answer !== "expression") return undefined;
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

/**
 * One namespaced answer this scan's outward walk cannot reach: the call
 * handed it to a callback, so it crosses no expression ({@link
 * PathContract.answer}). Where that answer goes is unread — which is what
 * this says, rather than letting an empty escape verdict read as a clean
 * call (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
export interface UnfollowedAnswer {
  /** The fs symbol that answered with a path, as the module binds it. */
  fn: string;
  /** 1-indexed line of the call that answered, for the failure message. */
  line: number;
}

/**
 * One namespaced path handed to the JS spelling of a symbol only `.native`
 * can take it at.
 */
export interface JsFormCall {
  /** The fs symbol called, as the module binds it. */
  fn: string;
  /** The callee the site spelled, whitespace out — the form that refuses. */
  callee: string;
  /** 1-indexed line of the call, for the failure message. */
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
  /**
   * The path-answering calls whose answer went to a callback instead, which
   * the outward walk cannot follow. Reported rather than judged, and kept out
   * of {@link FsCallScan.answered} for the same reason: the escape verdict
   * has nothing to say about a call here, so a vacuity count claiming it
   * would say that verdict had judged one more call than it did.
   */
  unfollowed: UnfollowedAnswer[];
  /**
   * How many composed paths reached a symbol whose JS spelling refuses one
   * ({@link PathContract.nativeOnly}) — the vacuity count for {@link
   * FsCallScan.jsForm}, empty both for a module that spells every such call
   * `.native` and for one that makes none.
   */
  nativeOnly: number;
  /** Those of them spelled at a head that is not `.native`. */
  jsForm: JsFormCall[];
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
 * a namespaced argument ({@link PathContract.answer}), the answer is
 * followed outward through the expression it was written into, and a callee
 * that is no fs call reading it is reported. `answered` is that verdict's
 * vacuity count, for the same reason `judged` is the composition verdict's.
 *
 * `unfollowed` is where that walk stops short: a call whose answer arrives at
 * a callback crosses no expression, so the walk reaches nothing and would
 * return exactly what a clean call returns. Those calls are reported instead,
 * and counted in neither `answered` nor `escaped`.
 *
 * A member call whose receiver is something else (`api.readFile(…)`) is not a
 * call site of the imported symbol and is skipped; a callee the symbol itself
 * heads (`realpathSync.native(…)`) is one, and is judged on that symbol's
 * contract ({@link fsCallee}).
 *
 * `jsForm` is the third verdict, and the only one a *composed* path can fail:
 * where the contract says the symbol's JS implementation refuses the
 * namespaced alphabet ({@link PathContract.nativeOnly}), the head the site
 * spelled decides, and anything but `.native` is reported. `nativeOnly` is its
 * vacuity count.
 */
export function scanFsCalls(module: string, source: string): FsCallScan {
  const masked = maskNonCode(source);
  const imports = fsImports(source);
  const symbols = [...imports.values()].flat();
  /** Each imported fs symbol paired with the specifier its contract is read from. */
  const bindings = [...imports].flatMap(([specifier, names]) =>
    names.map((fn) => ({ specifier, fn })),
  );
  const isProbe = PROBE_SOURCE.test(module);
  const bare: BareFsCall[] = [];
  const escaped: EscapedNamespacedPath[] = [];
  const unfollowed: UnfollowedAnswer[] = [];
  const jsForm: JsFormCall[] = [];
  const uncalled: string[] = [];
  let judged = 0;
  let delegated = 0;
  let answered = 0;
  let nativeOnly = 0;
  const lineOf = (index: number): number => source.slice(0, index).split("\n").length;

  for (const { specifier, fn } of bindings) {
    const calls = [...masked.matchAll(callSites(fn))]
      .map((match) => ({
        index: match.index!,
        // The callee as written, whitespace out: the bare name, or the name
        // extended by member access ({@link fsCallee}). Which head was
        // spelled is what a `nativeOnly` contract turns on.
        callee: match[0].slice(0, -1).replace(/\s+/g, ""),
        args: splitArguments(masked, match.index! + match[0].length - 1),
      }))
      .filter((site) => !declaresParameters(site.args));
    if (calls.length === 0) {
      uncalled.push(fn);
      continue;
    }
    if (isProbe) continue;
    const contract = contractFor(specifier, fn);
    for (const { index, callee, args } of calls) {
      let namespacedAnswer = false;
      let namespacedArgument = false;
      for (const position of contract.positions(args.length)) {
        const argument = args[position];
        if (argument === undefined) continue;
        if (contract.calleeFolds) {
          delegated++;
          continue;
        }
        judged++;
        if (isComposed(masked, argument)) {
          namespacedAnswer ||= contract.answer !== "none";
          namespacedArgument = true;
          continue;
        }
        bare.push({
          fn,
          position,
          argument: argument.trim(),
          line: lineOf(index),
        });
      }
      if (namespacedArgument && contract.nativeOnly) {
        // A path the site composed correctly, at a callee that throws on it:
        // only the `.native` head resolves one. An uncomposed argument is
        // already reported above, and is not this alphabet's problem.
        nativeOnly++;
        if (callee !== `${fn}.native`) {
          jsForm.push({ fn, callee, line: lineOf(index) });
        }
      }
      if (!namespacedAnswer) continue;
      if (contract.answer === "callback") {
        // The answer went where the walk below cannot reach, so the scan says
        // so instead of returning nothing and reading as a clean call.
        unfollowed.push({ fn, line: lineOf(index) });
        continue;
      }
      answered++;
      const reader = readerPastFs(masked, symbols, index);
      if (reader !== undefined) {
        escaped.push({ fn, reader, line: lineOf(index) });
      }
    }
  }
  return {
    module,
    symbols,
    judged,
    delegated,
    bare,
    answered,
    escaped,
    unfollowed,
    nativeOnly,
    jsForm,
    uncalled,
  };
}

/** A `BareFsCall` as one line of a failure message, named by its module. */
export function describeBareCall(scan: FsCallScan, call: BareFsCall): string {
  return `${scan.module}:${call.line} — ${call.fn}() path argument ${call.position}, \`${call.argument}\`, is not composed for win32's path limit`;
}


/** A `JsFormCall` as one line of a failure message, named by its module. */
export function describeJsForm(scan: FsCallScan, call: JsFormCall): string {
  return (
    `${scan.module}:${call.line} — ${call.callee}() is handed a path in ` +
    `win32's namespaced alphabet, which node's JS implementation refuses ` +
    `through node 22; only ${call.fn}.native resolves one`
  );
}

/** An `UnfollowedAnswer` as one line of a failure message. */
export function describeUnfollowed(
  scan: FsCallScan,
  call: UnfollowedAnswer,
): string {
  return (
    `${scan.module}:${call.line} — ${call.fn}() answers a path in win32's ` +
    `namespaced alphabet into a callback, which this scan follows no further ` +
    `than the call expression; where that answer is spent is unread`
  );
}

/** An `EscapedNamespacedPath` as one line of a failure message. */
export function describeEscape(
  scan: FsCallScan,
  escape: EscapedNamespacedPath,
): string {
  return `${scan.module}:${escape.line} — ${escape.fn}() answers a path in win32's namespaced alphabet and ${escape.reader}(), which is no fs call, reads it`;
}
