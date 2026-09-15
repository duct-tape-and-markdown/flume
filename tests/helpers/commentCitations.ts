/**
 * The mechanical form of the carve-out `.claude/rules/engineering.md`
 * *Narration is the ladder's bottom rung* names: a backticked identifier in a
 * `src/` or `harness/` comment is a reference, not a sentence, so a pin may
 * resolve it against the declarations those trees hold — **the token, never
 * its meaning**. What a comment claims stays with its authors; that the name
 * it cites still exists is mechanical, and a deleted symbol may not leave its
 * citations standing.
 *
 * A comment cites the repo in two alphabets, so the scan reads both: a name
 * resolves against the declarations, and a repo-relative path against the
 * working tree. One mechanism either way — the citation names something the
 * repo holds, or it names nothing and the tree renamed out from under it.
 *
 * Both the comments and the identifier half of the verdict go through the
 * TypeScript program. The comments are read off real trivia ranges rather
 * than matched out of the file text, so a `//` inside a string literal is
 * never mistaken for a comment and a comment holding a `/` is never swallowed
 * by one. The tokens they are judged against are what the checker resolves —
 * a namespace import's property access, an inherited member, a lib global —
 * so nothing resolves on a substring match.
 *
 * Spans are paired the way markdown pairs them — across a run of consecutive
 * comment lines, by equal-length backtick runs — so a citation an author
 * wrapped is read as the one span it is rather than lost along with every
 * span behind it. A wrapped span is reported apart from the judged set,
 * because the space markdown puts at the break is not a character any subject
 * spelling admits: it names nothing the scan can resolve, whatever the author
 * meant by it.
 *
 * Not *.test.ts, so neither vitest lane collects it as a suite of its own.
 */

import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";

import ts from "typescript";

/** The program a scan is drawn from, and the trees whose comments it judges. */
export interface CitationScanRequest {
  /** Absolute path to the repo root — the directory holding the config. */
  readonly root: string;
  /**
   * The tsconfig describing the program. It is the widest config the repo
   * has: resolution reads the checker, and a tree left out of the program
   * resolves nothing.
   */
  readonly programConfig: string;
  /**
   * The trees whose comments are judged, as repo-relative posix prefixes.
   * They are also the trees whose declarations resolve a citation — the
   * carve-out scopes both sides to the same code.
   */
  readonly trees: readonly string[];
}

/** One backticked subject in one comment. */
export interface CitationSite {
  /** Module path, relative to `root` and in posix form. */
  readonly module: string;
  /** 1-based line the citation's opening backtick sits on. */
  readonly line: number;
  /** The backticked text, verbatim and without its fences. */
  readonly text: string;
}

export interface CitationScan {
  /** The modules read, relative to `root` — the scan's domain. */
  readonly modules: readonly string[];
  /** Every backticked span one comment line opened and closed, subject or not. */
  readonly backticked: readonly CitationSite[];
  /**
   * Every backticked span a comment line left open — the wrap, reported as
   * markdown joins it. Judged by nothing: the space markdown puts at the
   * break is not a character any subject spelling admits, so the citation the
   * span meant to carry falls out of the scan whatever it named. Reported so
   * the wrap cannot do that quietly.
   */
  readonly wrapped: readonly CitationSite[];
  /** The subset judged: the spans shaped like an identifier reference. */
  readonly scanned: readonly CitationSite[];
  /** Judged citations whose every token names something the trees hold. */
  readonly resolved: readonly CitationSite[];
  /** Judged citations naming something no token in those trees does. */
  readonly dangling: readonly CitationSite[];
}

/** Repo-relative, posix-separated — the alphabet every reported path uses. */
const relPath = (root: string, path: string): string =>
  relative(root, path).split(/[\\/]/).join("/");

const parseConfig = (path: string): ts.ParsedCommandLine => {
  const host: ts.ParseConfigFileHost = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(
        `${path}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`,
      );
    },
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(path, {}, host);
  if (!parsed) {
    throw new Error(`no tsconfig at ${path}`);
  }
  return parsed;
};

/**
 * A reserved word is a token of the language, not a name anything declares,
 * so it is not a citation — `this.opts.configDir` cites `opts` and
 * `configDir`. Read off the compiler's own keyword range rather than listed
 * here, so a word the language gains is not a citation this scan invents.
 */
const KEYWORDS: ReadonlySet<string> = new Set(
  Array.from(
    { length: ts.SyntaxKind.LastKeyword - ts.SyntaxKind.FirstKeyword + 1 },
    (_unused, i) => ts.tokenToString(ts.SyntaxKind.FirstKeyword + i),
  ).filter((word): word is string => word !== undefined),
);

/** One segment of a dotted citation: an identifier, no `_`, no digits first. */
const SEGMENT = /^[A-Za-z][A-Za-z0-9]*$/;

/** A camel hump — the shape `parsedCommandLine` has and `parsed` does not. */
const INTERNAL_CAPITAL = /[a-z0-9][A-Z]/;

/** A leading capital — the shape `Dispatcher` has and `dispatcher` does not. */
const LEADING_CAPITAL = /^[A-Z]/;

/** Capitals and digits alone — the shape `JSON`, `README` and `EX_OK` have. */
const ALL_CAPS = /^[A-Z][A-Z0-9]*$/;

/**
 * One segment of a path citation. The charset is what a filename spells with,
 * so every placeholder spelling a comment reaches for when it means *a* file
 * rather than *this* file — `<name>`, `*`, `**`, `[<ns>/]`, `{{DIR}}` — falls
 * out of the subject rule on its own, never on a list of placeholder forms.
 * `.` and `..` are refused with them: a citation the working tree can answer
 * names its file from the repo root, and `./Gate.js` is a module specifier
 * read from wherever the importer sits.
 */
const PATH_SEGMENT = /^(?!\.\.?$)[A-Za-z0-9._-]+$/;

/**
 * A named file rather than a directory or a git ref: `engineering.md`,
 * `cli.ts`, `MIGRATING-0.10.md`. The extension is the whole discriminator —
 * `refs/heads/main` and `flume/<slug>` are paths in git's alphabet, not the
 * working tree's, and `src/` names a directory every checkout has.
 */
const NAMED_EXTENSION = /[A-Za-z0-9_-]\.[A-Za-z0-9]+$/;

/**
 * Whether a span is spelled as a repo-relative path to a file.
 *
 * A slash is the claim, the same way a dot carries a member access: prose
 * that wanted a sentence would not have punctuated it this way. A span
 * without one is left to the identifier spellings above, which reach a
 * root-level file (`tsconfig.build.json`) by their own dot.
 */
const isPathSubject = (text: string): boolean => {
  const segments = text.split("/");
  return (
    segments.every((segment) => PATH_SEGMENT.test(segment)) &&
    NAMED_EXTENSION.test(segments[segments.length - 1] ?? "")
  );
};

/**
 * Whether a backticked span is judged at all.
 *
 * Prose backticks plenty that is not a symbol — a flag, an English word under
 * emphasis, a sentence fragment — so the subject rule admits only spans whose
 * *spelling* says name without reading the surrounding sentence. Four such
 * spellings, each a shape prose does not reach for:
 *
 * - **A dot between identifier segments.** `Phase.handoff`, `fs.rm`,
 *   `chain.ts` — a member access, a qualified name, a filename. Prose that
 *   wanted a sentence would not have punctuated it this way, so the dot
 *   carries the claim with no capital needed anywhere in the span.
 * - **A camel hump**, the classic `scanCommentCitations`.
 * - **A leading capital** on a word that is not capitals alone: `Dispatcher`,
 *   `Runner`. A type name reads as prose only at the start of a sentence,
 *   which a backtick is not.
 * - **A slash between path segments**, ending in a named extension:
 *   `spec/loop.md`, `src/Dispatcher.ts`. The repo holds names in two
 *   alphabets and a comment cites in both; `isPathSubject` carries this one.
 *
 * Two spellings stay out of scope by construction, never by exception: a
 * single lowercase word, which is how prose emphasises an ordinary noun, and
 * a word in capitals alone, which is how it names an acronym or a constant it
 * did not spell out — `EX_OK` fails `SEGMENT` besides, but `JSON` would not.
 */
const isSubject = (text: string): boolean => {
  if (text.includes("/")) return isPathSubject(text);
  const segments = text.split(".");
  if (!segments.every((segment) => SEGMENT.test(segment))) return false;
  if (segments.length > 1) return true;
  return LEADING_CAPITAL.test(text)
    ? !ALL_CAPS.test(text)
    : INTERNAL_CAPITAL.test(text);
};

/**
 * Every comment in a file, once.
 *
 * A comment is trivia of the token that follows it, so walking to the leaves
 * — punctuation and `EndOfFileToken` included — reaches all of them: the
 * leading ranges catch a comment that owns its line, the trailing ranges the
 * one sitting after code on a line already started, and the dedup by start
 * offset drops the second sighting of either.
 */
const commentRanges = (sf: ts.SourceFile): readonly ts.CommentRange[] => {
  const text = sf.getFullText();
  const seen = new Set<number>();
  const found: ts.CommentRange[] = [];
  const walk = (node: ts.Node): void => {
    const children = node.getChildren(sf);
    if (children.length > 0) {
      for (const child of children) walk(child);
      return;
    }
    const pos = node.getFullStart();
    for (const range of [
      ...(ts.getLeadingCommentRanges(text, pos) ?? []),
      ...(ts.getTrailingCommentRanges(text, pos) ?? []),
    ]) {
      if (seen.has(range.pos)) continue;
      seen.add(range.pos);
      found.push(range);
    }
  };
  walk(sf);
  return found;
};

/** The comment text carried by one line, and the 1-based line carrying it. */
interface CommentLine {
  readonly line: number;
  readonly text: string;
}

/**
 * A file's comment text, one entry per line that carries any, in line order.
 * A line holding two comments carries both, concatenated in the order the
 * file spells them.
 */
const commentLines = (sf: ts.SourceFile): readonly CommentLine[] => {
  const full = sf.getFullText();
  const byLine = new Map<number, string>();
  for (const range of [...commentRanges(sf)].sort((a, b) => a.pos - b.pos)) {
    const first = sf.getLineAndCharacterOfPosition(range.pos).line;
    full
      .slice(range.pos, range.end)
      .split(/\r?\n/)
      .forEach((piece, offset) => {
        const line = first + offset + 1;
        byLine.set(line, (byLine.get(line) ?? "") + piece);
      });
  }
  return [...byLine]
    .sort(([a], [b]) => a - b)
    .map(([line, text]) => ({ line, text }));
};

/**
 * The comment furniture a continuation line opens with — a block comment's
 * `*` margin, the `//` of the next line comment in a run. Markdown never
 * renders it, so a span the wrap carried across the break does not hold it
 * either.
 */
const CONTINUATION_MARGIN = /^\s*(?:\/\/+|\*+)\s*/;

/**
 * A wrapped span as markdown reads it: the line break and the next line's
 * margin collapse into the single space that breaks whatever the span was
 * spelling.
 */
const joinWrapped = (raw: string): string =>
  raw
    .split(/\r?\n/)
    .map((line, index) =>
      index === 0 ? line : line.replace(CONTINUATION_MARGIN, ""),
    )
    .map((line) => line.trim())
    .join(" ");

/**
 * Every backticked span in a file's comments, split by whether the line that
 * opened it also closed it.
 *
 * Pairing runs over a *run* of consecutive comment lines rather than over one
 * line at a time, because markdown does. A line that ends mid-span is closed
 * by the next line's backtick, and every span behind it takes its parity from
 * that pairing — read line by line, the wrapped span is lost *and* the rest
 * of the comment pairs one backtick out of step, so the citations after it go
 * unjudged too. Equal-length runs delimit a span, so a fenced block inside a
 * doc comment is one span rather than three stray backticks.
 */
const commentSpans = (
  sf: ts.SourceFile,
  module: string,
): { readonly closed: CitationSite[]; readonly wrapped: CitationSite[] } => {
  const closed: CitationSite[] = [];
  const wrapped: CitationSite[] = [];

  const read = (run: readonly CommentLine[]): void => {
    if (run.length === 0) return;
    const joined = run.map((entry) => entry.text).join("\n");
    const first = run[0]?.line ?? 0;
    const marks = [...joined.matchAll(/`+/g)].map((m) => ({
      start: m.index,
      length: m[0].length,
    }));
    let index = 0;
    while (index < marks.length) {
      const open = marks[index];
      if (!open) break;
      const closeAt = marks.findIndex(
        (mark, at) => at > index && mark.length === open.length,
      );
      // A run nothing of its own length closes opens no span at all.
      if (closeAt < 0) {
        index += 1;
        continue;
      }
      const close = marks[closeAt];
      if (!close) break;
      const raw = joined.slice(open.start + open.length, close.start);
      const before = joined.slice(0, open.start);
      const site = {
        module,
        line: first + (before.match(/\n/g)?.length ?? 0),
        text: raw.includes("\n") ? joinWrapped(raw) : raw,
      };
      (raw.includes("\n") ? wrapped : closed).push(site);
      index = closeAt + 1;
    }
  };

  let run: CommentLine[] = [];
  for (const entry of commentLines(sf)) {
    const previous = run[run.length - 1];
    if (previous && entry.line !== previous.line + 1) {
      read(run);
      run = [];
    }
    run.push(entry);
  }
  read(run);

  return { closed, wrapped };
};

/**
 * Scan a program's comments for citations naming nothing the judged trees
 * hold.
 *
 * A citation resolves when **every** one of its dotted segments is a token
 * those trees hold: a name the checker resolves to a symbol anywhere in them
 * (a declaration, an imported binding, a member, a lib global in scope), a
 * string literal they carry (a discriminant like `"blockedBy"` is declared by
 * the literal, not by a `const`), or — for the whole subject at once — a
 * module of theirs by basename, or a file the working tree holds at that
 * repo-relative path. What a segment *means* is never read: the scan proves
 * the name exists and stops there.
 */
export const scanCommentCitations = (
  request: CitationScanRequest,
): CitationScan => {
  const root = resolve(request.root);
  const parsed = parseConfig(resolve(root, request.programConfig));
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
  });
  const checker = program.getTypeChecker();

  const inTrees = (path: string): boolean => {
    const rel = relPath(root, path);
    return request.trees.some((tree) => rel.startsWith(tree));
  };
  const sources = program
    .getSourceFiles()
    .filter((sf) => !sf.isDeclarationFile && inTrees(resolve(sf.fileName)))
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
  if (sources.length === 0) {
    throw new Error(
      `no source of ${request.programConfig} sits under ${request.trees.join(", ")}: the scan would judge nothing`,
    );
  }

  // --- what those trees hold ---------------------------------------------
  const tokens = new Set<string>();
  const modules = new Set<string>();
  for (const sf of sources) {
    const module = relPath(root, resolve(sf.fileName));
    modules.add(module);
    // Both spellings a comment cites a module by — `planState.ts` and
    // `PendingSchema` are the same file named two ways, and each stops
    // resolving the moment the file is renamed away.
    const basename = module.slice(module.lastIndexOf("/") + 1);
    tokens.add(basename);
    tokens.add(basename.replace(/\.[^.]+$/, ""));
    // Scope at the file, which is globals plus its own top level — the arm
    // that holds a lib global or an import a comment cites and no statement
    // in the tree happens to use.
    for (const sym of checker.getSymbolsInScope(sf, ts.SymbolFlags.All)) {
      tokens.add(sym.getName());
    }
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        const sym = checker.getSymbolAtLocation(node);
        if (sym) tokens.add(sym.getName());
      } else if (ts.isStringLiteralLike(node)) {
        tokens.add(node.text);
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf, visit);
  }

  // --- what their comments cite ------------------------------------------
  const backticked: CitationSite[] = [];
  const wrapped: CitationSite[] = [];
  for (const sf of sources) {
    const spans = commentSpans(sf, relPath(root, resolve(sf.fileName)));
    backticked.push(...spans.closed);
    wrapped.push(...spans.wrapped);
  }

  // The working tree is the other thing the repo holds a citation's name in.
  // A file is looked up whole — `resolve` folds the posix separators the
  // citation is written with into the host's, and the result never leaves
  // this predicate, so nothing downstream sees a path in two alphabets.
  const onDisk = (text: string): boolean => existsSync(resolve(root, text));

  const resolves = (text: string): boolean =>
    tokens.has(text) ||
    onDisk(text) ||
    text
      .split(".")
      .every((segment) => KEYWORDS.has(segment) || tokens.has(segment));

  const scanned = backticked.filter((site) => isSubject(site.text));
  return {
    modules: [...modules],
    backticked,
    wrapped,
    scanned,
    resolved: scanned.filter((site) => resolves(site.text)),
    dangling: scanned.filter((site) => !resolves(site.text)),
  };
};

/** `module:line text`, the form a failure message cites a finding in. */
export const formatCitation = (site: CitationSite): string =>
  `${site.module}:${site.line} ${site.text}`;
