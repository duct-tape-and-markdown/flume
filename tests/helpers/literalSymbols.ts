/**
 * The second place a citation sits in code, read the way the comment scan
 * reads the first: a **string literal** that names one of the tree's own
 * functions.
 *
 * `.claude/rules/engineering.md` *Narration is the ladder's bottom rung* puts
 * prose at the bottom of the ladder, and a refusal string is prose the
 * program hands a reader at the worst moment. A message spelling an engine
 * function's name has made a citation no arm resolves: the comment scan reads
 * trivia and passes over literals, the page scan reads pages, and a rename
 * leaves the name standing inside the quotes reading as current. That is the
 * hole this scan closes, and it closes it on the one resolver a message's
 * reader can act on — **the surface the package hands out**. A consumer who
 * reads `Chain.worktreesBase` in a refusal can go find it; one who reads the
 * name of a module-private helper has been told which file to open in a
 * repository they do not have.
 *
 * So the verdict is the surface, not the tree's declarations: a literal may
 * name a function the `exports` map reaches, and naming any other function is
 * the finding. Resolution follows from that either way — a surface name a
 * rename moves reds here, which is the arm the quotes were missing.
 *
 * **The subject rule is a declaration, not a spelling.** A camel span in a
 * literal is a JSON key, a CLI flag, a module basename and a field name far
 * more often than it is a function; over this repo's `src/` the spans
 * outnumber the ones naming a function four to one. So a span is judged when
 * the judged trees declare a **function** under that name — anywhere, at any
 * depth, however the declaration spells the value — and a span naming nothing
 * they declare is a word this scan has no business reading. A class carries
 * no arm: the span rule reads a camel hump behind a lowercase head, which a
 * class name does not have, and a single capitalized word in prose is English
 * before it is a symbol (the reading `commentCitations.ts` already takes).
 *
 * **A module specifier is not narration.** `"./setupWorktree.js"` is a path
 * the compiler resolves and the program already reds when it names nothing,
 * and its basename is the name of the function the module exports as often as
 * not. Judging one would file a finding against an import.
 *
 * Read off the parse rather than the file text, so a literal is what the
 * parser produced: a `//` inside quotes is not a comment, and a comment
 * holding quotes is not a literal.
 *
 * Not *.test.ts, so neither vitest lane collects it as a suite of its own.
 */

import ts from "typescript";

import {
  relPath,
  repoProgram,
  sourcesOf,
  type ProgramScanRequest,
  type Scan,
  type ScanSite,
} from "./repoProgram.ts";

/** The program a scan is drawn from, the trees it judges, and the resolver. */
export interface LiteralSymbolRequest extends ProgramScanRequest {
  /**
   * The trees whose literals are judged, as repo-relative posix prefixes.
   * They are also the trees whose declarations arm the subject rule — a
   * literal is read against the code it ships beside.
   */
  readonly trees: readonly string[];
  /**
   * Every name the package's shipped surface holds — `packageSurface`
   * (`tests/helpers/exportGraph.ts`), the same set the interface pages are
   * judged against. The `exports` map's entry list is not it: a message names
   * a member (`worktreesBase`) as readily as an export.
   */
  readonly surface: ReadonlySet<string>;
}

/** One camel span in one literal, at the line the literal's piece opens on. */
export interface LiteralSymbolSite extends ScanSite {
  /** The span, verbatim — what a rename has to carry with it. */
  readonly text: string;
}

/**
 * Two sets and a verdict. `spans` is every camel span the literals carry —
 * what a vacuity pin over the extractor reads, since a reader that stopped
 * matching reports the same clean verdict over zero spans. `scanned` is the
 * subset the subject rule admits, and `findings` is the subset of *that*
 * naming a function the surface cannot reach.
 */
export interface LiteralSymbolScan extends Scan<LiteralSymbolSite> {
  /** The modules read, relative to the request's root — the scan's domain. */
  readonly modules: readonly string[];
  /** Every camel span in a judged literal, subject or not. */
  readonly spans: readonly LiteralSymbolSite[];
  /** The function names those trees declare — what the subject rule reads. */
  readonly functions: ReadonlySet<string>;
  /** Judged spans naming a function the surface holds. */
  readonly resolved: readonly LiteralSymbolSite[];
}

/** `module:line span`, the form a failure message cites a finding in. */
export const formatLiteralSymbol = (site: LiteralSymbolSite): string =>
  `${site.module}:${site.line} ${site.text}`;

/**
 * How an engine symbol reads when a string names one: a camel hump behind a
 * lowercase head. A flat lowercase word is English before it is a name, and a
 * leading capital is a sentence's first word as often as a type.
 *
 * Shared rather than spelled per scan: a second reader keying off a narrower
 * hump would judge a different subject under the same sentence.
 */
export const camelSpans = (text: string): string[] => [
  ...new Set(text.match(/\b[a-z][A-Za-z0-9_]*[A-Z][A-Za-z0-9_]*\b/g) ?? []),
];

/**
 * A literal the compiler resolves as a path rather than reads as prose — an
 * import or export specifier, an `import()` type's argument, a dynamic
 * `import()` call, an import-equals reference.
 */
const isModuleSpecifier = (node: ts.StringLiteralLike): boolean => {
  const parent = node.parent;
  if (
    (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) &&
    parent.moduleSpecifier === node
  ) {
    return true;
  }
  if (ts.isExternalModuleReference(parent) && parent.expression === node) {
    return true;
  }
  if (
    ts.isLiteralTypeNode(parent) &&
    ts.isImportTypeNode(parent.parent) &&
    parent.parent.argument === parent
  ) {
    return true;
  }
  return (
    ts.isCallExpression(parent) &&
    parent.expression.kind === ts.SyntaxKind.ImportKeyword
  );
};

/**
 * Whether a declaration names a function: the declared form, and the two
 * forms an initializer takes. `const run = () => {}` is the same job as
 * `function run() {}` to every reader of a message naming it, so the subject
 * rule reads the value rather than the keyword.
 */
const functionName = (node: ts.Node): string | undefined => {
  if (ts.isFunctionDeclaration(node)) return node.name?.text;
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer !== undefined &&
    (ts.isArrowFunction(node.initializer) ||
      ts.isFunctionExpression(node.initializer))
  ) {
    return node.name.text;
  }
  return undefined;
};

/** Every function name the given sources declare, at any depth. */
const declaredFunctions = (
  sources: readonly ts.SourceFile[],
): ReadonlySet<string> => {
  const names = new Set<string>();
  const walk = (node: ts.Node): void => {
    const name = functionName(node);
    if (name !== undefined) names.add(name);
    ts.forEachChild(node, walk);
  };
  for (const source of sources) ts.forEachChild(source, walk);
  return names;
};

/**
 * The text pieces one literal carries, each with the node its own line is
 * read from. A template's head and spans are separate pieces, so a message
 * assembled from interpolations is read whole rather than to its first `${`.
 *
 * The cooked text, not the raw: a reader is handed the escapes resolved, and
 * a name spelled across an escape is a name the message never showed.
 */
const literalPieces = (
  node: ts.StringLiteralLike | ts.TemplateExpression,
): readonly { readonly text: string; readonly at: ts.Node }[] => {
  if (ts.isTemplateExpression(node)) {
    return [
      { text: node.head.text, at: node.head },
      ...node.templateSpans.map((span) => ({
        text: span.literal.text,
        at: span.literal,
      })),
    ];
  }
  return [{ text: node.text, at: node }];
};

/**
 * Scan a tree's string literals for the function names they spell.
 *
 * The line a site reports is the one its literal piece opens on: a piece's
 * cooked text has had its escapes resolved, so an offset into it is not an
 * offset into the file, and a line counted from one would be a coordinate
 * pointing at the wrong place rather than a coarse one pointing at the right
 * literal.
 */
export const scanLiteralSymbols = (
  request: LiteralSymbolRequest,
): LiteralSymbolScan => {
  const repo = repoProgram(request);
  const sources = sourcesOf(repo, request.trees);
  const functions = declaredFunctions(sources);

  const spans: LiteralSymbolSite[] = [];
  for (const source of sources) {
    const module = relPath(repo.root, source.fileName);
    const walk = (node: ts.Node): void => {
      const literal =
        (ts.isStringLiteralLike(node) && !isModuleSpecifier(node)) ||
        ts.isTemplateExpression(node)
          ? (node as ts.StringLiteralLike | ts.TemplateExpression)
          : undefined;
      if (literal !== undefined) {
        for (const piece of literalPieces(literal)) {
          const line =
            source.getLineAndCharacterOfPosition(piece.at.getStart(source))
              .line + 1;
          for (const text of camelSpans(piece.text)) {
            spans.push({ module, line, text });
          }
        }
      }
      ts.forEachChild(node, walk);
    };
    ts.forEachChild(source, walk);
  }

  const scanned = spans.filter((site) => functions.has(site.text));
  return {
    modules: sources.map((source) => relPath(repo.root, source.fileName)),
    spans,
    functions,
    scanned,
    resolved: scanned.filter((site) => request.surface.has(site.text)),
    findings: scanned.filter((site) => !request.surface.has(site.text)),
  };
};
