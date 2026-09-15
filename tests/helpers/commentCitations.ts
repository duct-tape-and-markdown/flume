/**
 * The mechanical form of the carve-out `.claude/rules/engineering.md`
 * *Narration is the ladder's bottom rung* names: a backticked identifier in a
 * `src/` or `harness/` comment is a reference, not a sentence, so a pin may
 * resolve it against the declarations those trees hold — **the token, never
 * its meaning**. What a comment claims stays with its authors; that the name
 * it cites still exists is mechanical, and a deleted symbol may not leave its
 * citations standing.
 *
 * Both halves go through the TypeScript program. The comments are read off
 * real trivia ranges rather than matched out of the file text, so a `//`
 * inside a string literal is never mistaken for a comment and a comment
 * holding a `/` is never swallowed by one. The tokens they are judged against
 * are what the checker resolves — a namespace import's property access, an
 * inherited member, a lib global — so nothing resolves on a substring match.
 *
 * Not *.test.ts, so neither vitest lane collects it as a suite of its own.
 */

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
  /** Every backticked span in those modules' comments, subject or not. */
  readonly backticked: readonly CitationSite[];
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
 * Whether a backticked span is judged at all.
 *
 * Prose backticks plenty that is not a symbol — a flag, an English word under
 * emphasis, a sentence fragment — so the subject rule admits only spans whose
 * *spelling* says identifier without reading the surrounding sentence. Three
 * such spellings, each a shape prose does not reach for:
 *
 * - **A dot between identifier segments.** `Phase.handoff`, `fs.rm`,
 *   `chain.ts` — a member access, a qualified name, a filename. Prose that
 *   wanted a sentence would not have punctuated it this way, so the dot
 *   carries the claim with no capital needed anywhere in the span.
 * - **A camel hump**, the classic `scanCommentCitations`.
 * - **A leading capital** on a word that is not capitals alone: `Dispatcher`,
 *   `Runner`. A type name reads as prose only at the start of a sentence,
 *   which a backtick is not.
 *
 * Two spellings stay out of scope by construction, never by exception: a
 * single lowercase word, which is how prose emphasises an ordinary noun, and
 * a word in capitals alone, which is how it names an acronym or a constant it
 * did not spell out — `EX_OK` fails `SEGMENT` besides, but `JSON` would not.
 */
const isSubject = (text: string): boolean => {
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

/**
 * Scan a program's comments for citations naming nothing the judged trees
 * hold.
 *
 * A citation resolves when **every** one of its dotted segments is a token
 * those trees hold: a name the checker resolves to a symbol anywhere in them
 * (a declaration, an imported binding, a member, a lib global in scope), a
 * string literal they carry (a discriminant like `"blockedBy"` is declared by
 * the literal, not by a `const`), or — for the whole subject at once — a
 * module of theirs by basename. What a segment *means* is never read: the
 * scan proves the name exists and stops there.
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
  for (const sf of sources) {
    const module = relPath(root, resolve(sf.fileName));
    const text = sf.getFullText();
    for (const range of commentRanges(sf)) {
      const body = text.slice(range.pos, range.end);
      for (const match of body.matchAll(/`([^`\n]+)`/g)) {
        const at = range.pos + (match.index ?? 0);
        backticked.push({
          module,
          line: sf.getLineAndCharacterOfPosition(at).line + 1,
          text: match[1] ?? "",
        });
      }
    }
  }

  const resolves = (text: string): boolean =>
    tokens.has(text) ||
    text
      .split(".")
      .every((segment) => KEYWORDS.has(segment) || tokens.has(segment));

  const scanned = backticked.filter((site) => isSubject(site.text));
  return {
    modules: [...modules],
    backticked,
    scanned,
    resolved: scanned.filter((site) => resolves(site.text)),
    dangling: scanned.filter((site) => !resolves(site.text)),
  };
};

/** `module:line text`, the form a failure message cites a finding in. */
export const formatCitation = (site: CitationSite): string =>
  `${site.module}:${site.line} ${site.text}`;
