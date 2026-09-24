/**
 * The mechanical form of the carve-out `.claude/rules/engineering.md`
 * *Narration is the ladder's bottom rung* names: a backticked identifier in a
 * `src/`, `harness/` or `tests/` comment is a reference, not a sentence, so a
 * pin may resolve it against the declarations those trees hold — **the token,
 * never its meaning**. What a comment claims stays with its authors; that the name
 * it cites still exists is mechanical, and a deleted symbol may not leave its
 * citations standing.
 *
 * A comment cites the repo in two alphabets, so the scan reads both: a name
 * resolves against the declarations, and a repo-relative path against the
 * working tree. One mechanism either way — the citation names something the
 * repo holds, or it names nothing and the tree renamed out from under it.
 *
 * A comment that writes the two together — `` `name` (`src/file.ts`) `` — has
 * said more than either alone: it named the file the declaration sits in, and
 * where a declaration lives is the token's fact rather than its meaning. So
 * that pair is resolved against what the named file declares and against
 * nothing else, and a split that moves the job out from under the citation
 * reds it. The repo-wide token set would answer it from wherever the symbol
 * went, which is the reading the pair exists to refuse.
 *
 * The pair is the whole parenthetical and nothing else: the open paren is all
 * that sits between the two spans, and the path closes it. A path a sentence
 * merely follows a name with, and a parenthetical carrying a path plus an
 * aside, are context, and drawing a home out of either would red a comment
 * that claimed none. Nor is a home a page: a tight-closed pair whose path is a
 * `*.md` name draws none either, because no declaration lives in a page, so a
 * home like that would red every name cited at it. Both spans keep the arms
 * they have.
 *
 * TSDoc's link tag is a third alphabet, and the only one whose *syntax* is the
 * claim: an author writing one has said "this names a declaration", so no
 * subject rule is read over it and every tag is judged. What it is judged
 * against is the citing module alone — a link tag is a declaration reference
 * the language resolves where the comment sits, so a name the module neither
 * declares, imports, nor has as a global is a reference nothing follows, even
 * where a sibling tree three directories away declares it. The repo-wide token
 * set would answer every one of those, which is why the tag gets its own
 * verdict rather than riding the backticked one.
 *
 * A `*.md` page name is a citation backticked or not, because a filename is
 * never a sentence: the extension is the whole claim, so no surrounding prose
 * has to be read to know the token names a file. The unfenced ones are
 * collected from the comment text the backticked spans leave over, and both
 * fencings run the same filename detection the path arm ends on — one rule,
 * so a placeholder spelling is refused on the same charset whichever way the
 * author fenced the name and whether or not a directory precedes it. A name a
 * comment line breaks is reported as the wrap it is rather than judged as the
 * tail the break left behind — unfenced through the same set the fenced wrap
 * is reported into, because a tail is a page name the author never wrote and a
 * root-level page answers it whenever the break falls at a directory boundary.
 *
 * Because the working tree is all a page name needs, that arm reaches further
 * than the rest: `scanPageCitations` below reads it over its own domain —
 * every tree the sweep domain names and the chain this repo runs — through
 * the shared scopeless parse (`parseScopeless`, `repoProgram.ts`), where no
 * tsconfig covers `bin/` or `scripts/` and no checker is wanted. Same reader,
 * same fencings, same subject rule, same resolution; what that scan drops is
 * every citation a declaration answers.
 *
 * A page name is resolved on disk and nowhere else, whichever fence carried
 * it. Every other citation shape reads the judged trees first, and a page
 * name is the one citation those trees routinely hold as *data* — a fixture
 * path, a prompt's own prose, a message a suite asserts on. Answered by such
 * a literal, a comment naming a page the repo has since renamed away keeps
 * resolving, which is the reading the carve-out exists to refuse.
 *
 * A page name a comment writes a section behind — `` (`<page>.md`,
 * *Section*) `` — has said the same thing one step further in, and the named
 * page answers that too: a section is a heading the page opens or a bullet
 * lead it bolds, and whether the page still carries one is a read of the
 * working tree, never of what the citing sentence meant. So the section half
 * is its own judged set, resolved against that page's own titles the way a
 * `per` cite already is. The match is exact once backticks and the
 * renderer's wrapping are folded out, with no prefix arm: a heading that grew
 * a clause is a rewrite the citing comment has to follow, and an abbreviation
 * that kept resolving would be the arm answering a citation nobody checked.
 *
 * That half is read off the run as markdown renders it rather than off the
 * backtick pairing, because it is a phrase and not a token: a comment line
 * breaks it wherever the wrapping falls, and the renderer puts back the one
 * space its own words already sit behind. A wrapped *token* is reported as a
 * wrap for the opposite reason — the break puts a space where the spelling
 * admits none.
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
 * meant by it. Which of those wraps broke a *citation* is read by closing the
 * break and applying the same subject rule the judged set is held to — the
 * one rule, in either alphabet, rather than a shape the wrap gets its own
 * spelling for.
 *
 * A test's title is the same carve-out reaching a second place a citation
 * sits, and it carries the page-name arm alone. A title is a string literal,
 * and a literal is itself a resolution arm, so an identifier written in one
 * would resolve against itself and the verdict would be a tautology; a page
 * name is answered by the working tree, which no title can write into. So the
 * title arm judges `*.md` names and nothing else, and resolves them on disk
 * and nowhere else. Backticks come off first: a title has no fenced arm to
 * route them through, so a backtick around a page name there is decoration
 * the way a paren is.
 *
 * A shipped help literal is the third place, and the section arm is all that
 * reaches it: `scanRenderedSections` below reads the cites a `--help` page
 * states, rendered by the program that prints it rather than copied, and
 * resolves each against the page it names. A literal is a resolution arm, so
 * the identifier alphabet is left alone there for the reason a title leaves it
 * alone; a page's own headings are answered by the working tree, which no
 * literal can write into.
 *
 * Not *.test.ts, so neither vitest lane collects it as a suite of its own.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import ts from "typescript";

import { sectionTitles } from "./docSections.ts";
import {
  eachToken,
  modulesUnder,
  parseScopeless,
  relPath,
  repoProgram,
  sourcesOf,
  type ProgramScanRequest,
  type Scan,
  type ScanDomain,
  type ScanSite,
} from "./repoProgram.ts";

/** The program a scan is drawn from, and the trees whose comments it judges. */
export interface CitationScanRequest extends ProgramScanRequest {
  /**
   * The trees whose comments are judged, as repo-relative posix prefixes.
   * They are also the trees whose declarations resolve a citation — the
   * carve-out scopes both sides to the same code.
   */
  readonly trees: readonly string[];
}

/** One backticked subject in one comment, at the line its opening fence sits on. */
export interface CitationSite extends ScanSite {
  /** The backticked text, verbatim and without its fences. */
  readonly text: string;
}

/**
 * A citation a comment line left open — a backticked span the line never
 * closed, or an unfenced page name its break split — read both ways that
 * break can be read: `text` as markdown joins it, `closed` as the author
 * spelled it before the wrap.
 */
export interface WrappedCitation extends CitationSite {
  /**
   * The span with the break itself removed — the spelling the wrap broke.
   * Only the break goes: a span carrying a space of its own still carries it,
   * so prose closes to prose and stays out of the subject rule.
   */
  readonly closed: string;
}

/**
 * A citation whose author named the file the token lives in:
 * `` `name` (`src/file.ts`) ``. The pair is the claim, so the file is what
 * answers it.
 */
export interface PairedCitation extends CitationSite {
  /** The repo-relative path the pair named — where the token must be declared. */
  readonly home: string;
}

/**
 * A section cite: the italicized half of a `` (`<page>.md`, *Section*) ``
 * pair, and the page it is resolved against.
 */
export interface SectionCitation extends CitationSite {
  /** The page whose own titles answer it, repo-relative and posix-separated. */
  readonly page: string;
}

/**
 * Two verdicts over two judged sets. `scanned` is the citations shaped like a
 * reference — the backticked spans and the page names — and `findings` is the
 * subset naming nothing the trees hold. `wraps` carries the second, over a
 * different judged set: the citations a comment line broke.
 */
export interface CitationScan extends Scan<CitationSite> {
  /** The modules read, relative to the request's root — the scan's domain. */
  readonly modules: readonly string[];
  /** Every backticked span one comment line opened and closed, subject or not. */
  readonly backticked: readonly CitationSite[];
  /**
   * Every unbackticked `*.md` token those comments carry, outside the
   * backticked spans and outside the wraps below — the page names the
   * carve-out reads without a fence.
   */
  readonly bare: readonly CitationSite[];
  /** Judged citations whose every token names something the trees hold. */
  readonly resolved: readonly CitationSite[];
  /**
   * The judged citations whose author paired them with a home — the subset of
   * `scanned` resolved against one file's declarations rather than against
   * every token the trees hold. What a vacuity pin over that arm reads.
   */
  readonly pairs: readonly PairedCitation[];
  /**
   * The citations a comment line left open — a backticked span the line never
   * closed, or an unfenced page name the break split at a directory boundary
   * — reported as markdown joins them, and among them the ones whose `closed`
   * spelling is a subject.
   *
   * The scanned half is judged by nothing else: the space markdown puts at the
   * break is not a character any subject spelling admits, so the citation the
   * wrap meant to carry falls out of the scan whatever it named. It is
   * reported so the wrap cannot do that quietly. The findings half is the
   * name the scan would have judged had the author not wrapped it — a defect
   * at the comment rather than a resolution arm the scan is missing, which no
   * renaming of what it cites can ever red.
   */
  readonly wraps: Scan<WrappedCitation>;
  /**
   * Every `describe`/`it`/`test` title those modules carry, `text` being the
   * title verbatim — what a vacuity pin over the verdict below reads, since a
   * title collector that stopped matching would report a clean tree over zero
   * titles.
   */
  readonly titled: readonly CitationSite[];
  /**
   * The third verdict, over a third judged set: the `*.md` page names those
   * titles carry, and among them the ones the working tree cannot answer.
   *
   * Judged by the page-name arm alone and resolved on disk alone — a title is
   * a string literal, so every other arm would answer the citation out of the
   * citation itself.
   */
  readonly titles: Scan<CitationSite>;
  /**
   * The fourth verdict, over a fourth judged set: the section halves those
   * comments cite, and among them the ones their page no longer titles.
   */
  readonly sections: Scan<SectionCitation>;
  /**
   * The fifth verdict, over a fifth judged set: the TSDoc link tags those
   * comments carry, and among them the ones naming a declaration their own
   * module cannot reach.
   *
   * Judged against one module's scope rather than against the three trees,
   * for the reason the header states: a link tag resolves where the comment
   * sits, so the repo-wide token set would answer a reference no reader can
   * follow.
   */
  readonly links: Scan<CitationSite>;
}

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

/** A camel hump — the shape `programConfig` has and `program` does not. */
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
 * A named file rather than a directory or a git ref:
 * `.claude/rules/engineering.md`, `cli.ts`, `docs/MIGRATING-0.10.md`. The
 * extension is the whole discriminator — `refs/heads/main` and `flume/<slug>`
 * are paths in git's alphabet, not the working tree's, and `src/` names a
 * directory every checkout has.
 */
const NAMED_EXTENSION = /[A-Za-z0-9_-]\.[A-Za-z0-9]+$/;

/**
 * Whether one token names a file: the filename charset, ending in a named
 * extension. The one filename detection the scan performs — the path arm runs
 * it on the segment behind the last slash, the backticked arm on a span
 * carrying no slash at all — so `.claude/rules/engine-boundary.md` is judged by
 * the charset a filename spells with whether or not its author wrote the
 * directory.
 */
const isNamedFile = (token: string): boolean =>
  PATH_SEGMENT.test(token) && NAMED_EXTENSION.test(token);

/**
 * A leading dot, which on a slashless span is two spellings at once: a
 * root-level dotfile (`.env.example`) and a member access whose receiver the
 * prose elided (`.element.shape`, `.message`). The spelling does not tell
 * them apart, so the filename arm refuses the shape rather than guess, and a
 * root-level dotfile stays out of scope by construction the way a single
 * lowercase word does. Under a directory there is no ambiguity and the slash
 * carries the claim, so `.flume/loop.pid` is judged.
 */
const ELIDED_RECEIVER = /^\./;

/**
 * Whether a span is spelled as a repo-relative path to a file.
 *
 * A slash is the claim, the same way a dot carries a member access: prose
 * that wanted a sentence would not have punctuated it this way. A span
 * without one is one segment, which is the filename the arm ends on — the
 * same detection, so `spec/loop.md` and a root-level `tsconfig.build.json`
 * are read by one rule rather than by two arms that must be kept agreeing.
 */
const isPathSubject = (text: string): boolean => {
  const segments = text.split("/");
  const file = segments.pop() ?? "";
  return (
    segments.every((segment) => PATH_SEGMENT.test(segment)) && isNamedFile(file)
  );
};

/**
 * An unbackticked `*.md` token, read as prose delimits one: the run of
 * non-whitespace characters ending at the extension. Nothing is trimmed from
 * the right — the `.md` ends the token by construction, so a possessive, a
 * comma or a closing paren behind it was never part of it — and the lookahead
 * keeps `.mdx` and `.md-draft` from being read as a page name truncated.
 */
const BARE_PAGE = /\S*\.md(?![A-Za-z0-9_-])/g;

/**
 * Whether a citation is a page name: the path arm's subject rule narrowed to
 * the extension the carve-out reads without a fence. One predicate for both
 * fencings, so the resolution a page name gets does not turn on whether its
 * author backticked it.
 */
const isPageName = (text: string): boolean =>
  text.endsWith(".md") && isPathSubject(text);

/**
 * The brackets prose opens with and a filename never starts with. Stripped
 * from the left edge alone: everything else the non-whitespace run carried
 * stays, so a placeholder spelling is refused on `PATH_SEGMENT` rather than
 * trimmed down to a tail that resolves.
 */
const OPENING_PUNCTUATION = /^[([{"'*]+/;

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
 * - **A named extension**, with or without a directory ahead of it:
 *   `spec/loop.md`, `src/Dispatcher.ts`, `.claude/rules/engine-boundary.md`,
 *   `pnpm-lock.yaml`. The repo holds names in two alphabets and a comment
 *   cites in both; `isNamedFile` carries the detection for either, so a page
 *   name whose spelling the identifier charset refuses — a hyphen, an
 *   underscore — is judged by the arm that can answer it instead of falling
 *   out of the scan for want of a slash.
 *
 * Two spellings stay out of scope by construction, never by exception: a
 * single lowercase word, which is how prose emphasises an ordinary noun, and
 * a word in capitals alone, which is how it names an acronym or a constant it
 * did not spell out — `EX_OK` fails `SEGMENT` besides, but `JSON` would not.
 * The capitals half of that is what a span standing alone in prose is held
 * to; a span the author gave a home is `isIdentifierSubject`'s, which reads
 * it as the name it named.
 */
const isSubject = (text: string): boolean => {
  if (text.includes("/")) return isPathSubject(text);
  if (!ELIDED_RECEIVER.test(text) && isNamedFile(text)) return true;
  const segments = text.split(".");
  if (!segments.every((segment) => SEGMENT.test(segment))) return false;
  if (segments.length > 1) return true;
  return LEADING_CAPITAL.test(text)
    ? !ALL_CAPS.test(text)
    : INTERNAL_CAPITAL.test(text);
};

/**
 * Whether a backticked span names **one declaration**: the subject rule
 * above, narrowed to a span carrying neither a slash nor a dot.
 *
 * Narrowed here rather than re-spelled at the reader that wants it: the
 * spellings that say *name* are one rule, and a second copy would drift the
 * moment either moved. What the narrowing is for is a reader whose
 * resolution is a package's shipped surface rather than a tree of modules —
 * a surface holds names, not files, and it is handed no citing module whose
 * own imports would say which of the two a span is.
 *
 * The dot is what that reader cannot read. In a comment the two spellings
 * need no telling apart, because one tree answers both: `chain.ts` resolves
 * as a module of the judged trees and `Chain.pendingDir` as a member of
 * them, and `isSubject` admits either by the same arm. Against a surface
 * they are one spelling with two meanings and no evidence to pick by — the
 * file arm would drop every member citation, and the member arm would red
 * every filename on its extension. So a dotted span is left unjudged, which
 * is the class this predicate does not yet resolve rather than one it
 * decides wrongly.
 *
 * Not `isIdentifierSubject`, which widens the same rule the other way: a
 * span the author paired with a home may be spelled in capitals throughout,
 * because the pair has already claimed a declaration. A span standing alone
 * on a page has claimed nothing, so the capitals fence stands.
 */
export const isDeclarationSubject = (text: string): boolean =>
  !text.includes("/") && !text.includes(".") && isSubject(text);

/**
 * One segment of a citation spelled in capitals: `JSON`, `EX_OK`,
 * `SPAWN_OUTPUT_CAP_BYTES`. The underscore `SEGMENT` refuses is the
 * separator this spelling joins its words with, so the two charsets are
 * written apart rather than one widened into the other — a name the
 * identifier charset admits is still read by the rule that admits it.
 */
const SCREAMING_SEGMENT = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

/**
 * Whether a span is the identifier half of a pair: a name spelled in the
 * identifier charset, admitted by the same subject rule every other citation
 * is held to — **or spelled in capitals throughout**, which that rule refuses
 * on its own and a pair does not. The capitals fence is for a span standing
 * alone in prose, where `JSON` is how a sentence names a format; a pair has
 * already claimed a declaration at a home, and where a declaration lives is
 * the token's fact rather than its meaning. So the name reds when a split
 * moves the job out from under it, which is the whole point of writing the
 * home down. Every other fence the subject rule sets stands: a single
 * lowercase word is prose in a pair as it is anywhere.
 *
 * A slash routes a span to the path arm, so a span carrying one is a path
 * however its segments read.
 */
const isIdentifierSubject = (text: string): boolean => {
  if (text.includes("/")) return false;
  const segments = text.split(".");
  return (
    segments.every(
      (segment) => SEGMENT.test(segment) || SCREAMING_SEGMENT.test(segment),
    ) &&
    (isSubject(text) || segments.every((s) => SCREAMING_SEGMENT.test(s)))
  );
};

/**
 * The gap a pair spells between its two spans, and the character that closes
 * it: `` `name` (`src/file.ts`) ``. Nothing else is read as a pair — a path a
 * sentence merely follows a name with is context, and drawing a home out of
 * it would red a comment that claimed nothing.
 */
const PAIR_OPEN = "(";
const PAIR_CLOSE = ")";

/** The call heads a test title sits behind, in this suite's runner. */
const TITLE_CALLEES: ReadonlySet<string> = new Set(["describe", "it", "test"]);

/**
 * The head identifier a call is made through, past whatever the runner's
 * vocabulary hangs off it: `it.each(rows)(title)` and `describe.each\`t\`(title)`
 * are both titled calls, and the head is what says so.
 */
const calleeHead = (expression: ts.Expression): string | undefined => {
  let node: ts.Expression = expression;
  for (;;) {
    if (ts.isTaggedTemplateExpression(node)) {
      node = node.tag;
      continue;
    }
    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node) ||
      ts.isCallExpression(node) ||
      ts.isParenthesizedExpression(node)
    ) {
      node = node.expression;
      continue;
    }
    return ts.isIdentifier(node) ? node.text : undefined;
  }
};

/**
 * Every test title in a file, read off the parse and in source order: the
 * first argument of a titled call, when that argument is a literal the author
 * wrote whole. A title assembled at runtime — a concatenation, a template
 * with a substitution — is not one spelling anything can be resolved against,
 * and is left out rather than judged on the half the source happens to hold.
 */
const titleSites = (sf: ts.SourceFile, module: string): CitationSite[] => {
  const found: CitationSite[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const head = calleeHead(node.expression);
      const title = node.arguments[0];
      if (
        head !== undefined &&
        TITLE_CALLEES.has(head) &&
        title &&
        ts.isStringLiteralLike(title)
      ) {
        found.push({
          module,
          line: sf.getLineAndCharacterOfPosition(title.getStart(sf)).line + 1,
          text: title.text,
        });
      }
    }
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(sf, walk);
  return found;
};

/**
 * The backtick a title puts around a name. A title reaches no fenced arm —
 * the carve-out gives it the page-name arm alone — so a backtick there is
 * decoration the way a paren is. Blanked rather than deleted, so two names a
 * single backtick separates never join into one token.
 */
const TITLE_FENCE = /`/g;

/**
 * The `*.md` page names one title carries, read by the arm that reads them
 * unfenced in a comment — the same regex, the same left-edge trim, the same
 * subject rule — so a page name is judged the same wherever an author wrote
 * it. The line is the title's own: a name inside a literal has no line of its
 * own to cite.
 */
const titlePages = (site: CitationSite): CitationSite[] =>
  [...site.text.replace(TITLE_FENCE, " ").matchAll(BARE_PAGE)].map((match) => ({
    module: site.module,
    line: site.line,
    text: match[0].replace(OPENING_PUNCTUATION, ""),
  }));

/**
 * Every comment in a file, once.
 *
 * A comment is trivia of the token that follows it, so walking to the leaves
 * — punctuation and the end-of-file token included — reaches all of them:
 * the
 * leading ranges catch a comment that owns its line, the trailing ranges
 * the one sitting after code on a line already started, and the dedup by start
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
 * The comment furniture a line opens with — a block comment's `/**` opening or
 * `*` margin, the `//` of a line comment. Markdown never renders any of it, so
 * neither a span a wrap carried across the break nor the rendered run below
 * holds it.
 */
const CONTINUATION_MARGIN = /^\s*(?:\/\/+|\/?\*+)\s*/;

/**
 * The furniture a block comment closes with, stripped from a line's right
 * edge for the reason the margin is stripped from its left: markdown renders
 * neither, and the `/` that ends a comment is not the `/` that ends a
 * directory.
 */
const BLOCK_TERMINATOR = /\*+\/\s*$/;

/**
 * The half of a wrap a line ends with: a token broken at a directory
 * boundary. Read from the line's text with both furnitures off, so an empty
 * `//` line is no directory and a block comment's last line is no wrap.
 */
const WRAP_HEAD = /\S+\/$/;

/**
 * The half of a wrap the next line opens with, anchored: only a page name the
 * break actually carried across continues the token above it. Same lookahead
 * as `BARE_PAGE` — `.mdx` is a page name of its own, not this one truncated.
 */
const WRAP_TAIL = /^\S*\.md(?![A-Za-z0-9_-])/;

/**
 * One run of lines as a reader sees it: every line's comment furniture off,
 * every break folded to the one space the wrapping stands for. A run of
 * shipped help lines carries no furniture, so there the strip is a no-op and
 * the fold is the whole rendering.
 *
 * The backticked arms read `joined` instead, where a break is still a break,
 * because a wrap splits a *token* into something no subject spelling admits.
 * A section cite's italicized half is a phrase, and a phrase's break renders
 * as the space its own words already sit behind — so it is read here, where
 * the wrap has already closed the way a reader sees it close.
 */
interface RenderedRun {
  /** The run's text, margins off and breaks folded. */
  readonly text: string;
  /** The 1-based source line the character at an offset came from. */
  lineAt(offset: number): number;
}

/** Render one run of comment lines, keeping each piece's source line. */
const renderRun = (run: readonly CommentLine[]): RenderedRun => {
  const pieces = run.map((entry) =>
    entry.text.replace(CONTINUATION_MARGIN, "").replace(BLOCK_TERMINATOR, "").trim(),
  );
  /** Where each piece ends in the joined text, the joining space included. */
  const ends: number[] = [];
  let at = 0;
  for (const piece of pieces) {
    at += piece.length + 1;
    ends.push(at);
  }

  return {
    text: pieces.join(" "),
    lineAt: (offset) => {
      const index = ends.findIndex((end) => offset < end);
      return (index === -1 ? run[run.length - 1] : run[index])?.line ?? 0;
    },
  };
};

/**
 * A section cite: a page and the section of it a comment names, written as
 * `` (`<page>.md`, *Section*) `` or `` (`<page>.md`, "Section") ``. Both
 * emphases spell the one citation, so the two resolve identically. The page
 * half is read backticked or bare, the way every other page name is — the
 * fence is the author's, never the rule's.
 *
 * The parenthetical closes on the emphasized half, so a sentence that merely
 * follows a page with an aside draws no cite and a comment that claimed no
 * section is never held to one.
 */
const SECTION_CITE = /\(`?([^\s`(),]+\.md)`?,\s+(?:\*([^*]+)\*|"([^"]+)")\)/g;

/**
 * The section cites one rendered run states, at the line each sits on.
 *
 * Read off the rendering rather than off the backtick pairing, because the
 * emphasized half is a phrase and not a token: a line breaks it wherever the
 * wrapping falls and the renderer puts back the one space its own words
 * already sit behind. Read in the unrendered alphabet it would be a different
 * string on every rewrap.
 *
 * One reader, two callers — the comment runs below and the rendered surfaces
 * `scanRenderedSections` reads — because a cite is the same claim wherever a
 * shipped text states it (`.claude/rules/engineering.md`, *A module is one
 * job*).
 */
const sectionCites = (
  module: string,
  rendered: RenderedRun,
): SectionCitation[] => {
  const found: SectionCitation[] = [];
  for (const match of rendered.text.matchAll(SECTION_CITE)) {
    const page = match[1] ?? "";
    if (!isPageName(page)) continue;
    // Whichever emphasis closed the parenthetical carries the section on
    // to the same reader: one cite, spelled two ways.
    found.push({
      module,
      line: rendered.lineAt(match.index),
      text: match[2] ?? match[3] ?? "",
      page,
    });
  }
  return found;
};

/**
 * A TSDoc link tag and the declaration it references: the three spellings the
 * syntax has, and the target that opens the tag's body.
 *
 * The target ends where TSDoc ends it — at whitespace, at the `|` a link text
 * sits behind, or at the closing brace — so a tag carrying a label is judged
 * on the reference and never on the prose beside it. An empty target is
 * captured as the empty string rather than passed over, so a tag naming
 * nothing reds where a reader would find nothing
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * Read off the run as markdown renders it, for the reason a section cite is:
 * the tag is the author's whichever line the wrapping broke it on, and the
 * compiler that resolves it reads the same closed spelling.
 */
const LINK_CITE = /\{@link(?:code|plain)?\s+([^\s|}]*)/g;

/**
 * A wrapped span read across its break. The line break and the next line's
 * margin collapse into `at`: a space is what markdown renders and what breaks
 * whatever the span was spelling; nothing at all is the spelling the author
 * had before the wrap.
 */
const joinWrapped = (raw: string, at: string): string =>
  raw
    .split(/\r?\n/)
    .map((line, index) =>
      index === 0 ? line : line.replace(CONTINUATION_MARGIN, ""),
    )
    .map((line) => line.trim())
    .join(at);

/** One backticked span a run of lines spells, at its extent in that run. */
export interface FencedSpan {
  /** Where the opening fence sits in the joined run. */
  readonly start: number;
  /** Where the closing fence ends in it. */
  readonly end: number;
  /** The text between the fences, verbatim — a line break still a break. */
  readonly raw: string;
}

/**
 * Every backticked span one run of lines closes, in run order.
 *
 * Pairing runs over a *run* of lines rather than over one line at a time,
 * because markdown does. A line that ends mid-span is closed by the next
 * line's backtick, and every span behind it takes its parity from that
 * pairing — read line by line, the wrapped span is lost *and* the rest of
 * the run pairs one backtick out of step, so the spans after it go unjudged
 * too. Equal-length runs delimit a span, so a fenced block is one span
 * rather than three stray backticks, and a run nothing of its own length
 * closes opens no span at all.
 *
 * The text is handed back verbatim, break included: what the furniture
 * around a break is — a comment's margin, a page's nothing — belongs to the
 * caller that knows which it is reading.
 */
export const fencedSpans = (joined: string): FencedSpan[] => {
  const marks = [...joined.matchAll(/`+/g)].map((m) => ({
    start: m.index,
    length: m[0].length,
  }));
  const found: FencedSpan[] = [];

  let index = 0;
  while (index < marks.length) {
    const open = marks[index];
    if (!open) break;
    const closeAt = marks.findIndex(
      (mark, at) => at > index && mark.length === open.length,
    );
    if (closeAt < 0) {
      index += 1;
      continue;
    }
    const close = marks[closeAt];
    if (!close) break;
    found.push({
      start: open.start,
      end: close.start + close.length,
      raw: joined.slice(open.start + open.length, close.start),
    });
    index = closeAt + 1;
  }

  return found;
};

/**
 * Every citation in a file's comments: the backticked spans, split by whether
 * the line that opened one also closed it, and the unbackticked `*.md` page
 * names the text between them carries.
 *
 * The run of consecutive comment lines is the unit the spans are paired over,
 * on the rule `fencedSpans` above carries.
 *
 * The page names are read off the same pairing, from the text no span covers,
 * so a fenced citation is collected once and by the arm its author chose. One
 * a line break split is reported as the wrap it is, through the set the
 * fenced wrap already goes to, and its tail is left out of the collected
 * names — the same report for both fencings rather than a second rule for the
 * one the author left bare.
 *
 * The link tags come off the rendered run rather than the pairing, because
 * the tag's own braces delimit it and a backtick around one is the author's
 * emphasis rather than a fence the scan owes a reading to.
 */
const commentSpans = (
  sf: ts.SourceFile,
  module: string,
): {
  readonly closed: CitationSite[];
  readonly bare: CitationSite[];
  readonly wrapped: WrappedCitation[];
  readonly paired: Array<{ site: CitationSite; home: string }>;
  readonly sections: SectionCitation[];
  readonly links: CitationSite[];
} => {
  const closed: CitationSite[] = [];
  const bare: CitationSite[] = [];
  const wrapped: WrappedCitation[] = [];
  const paired: Array<{ site: CitationSite; home: string }> = [];
  const sections: SectionCitation[] = [];
  const links: CitationSite[] = [];

  const read = (run: readonly CommentLine[]): void => {
    if (run.length === 0) return;
    const joined = run.map((entry) => entry.text).join("\n");
    const first = run[0]?.line ?? 0;
    const lineAt = (offset: number): number =>
      first + (joined.slice(0, offset).match(/\n/g)?.length ?? 0);
    // Where each line of the run starts in `joined` — the one place the two
    // wrap arms and the page-name arm share an alphabet for a position.
    let cursor = 0;
    const starts = run.map((entry) => {
      const start = cursor;
      cursor += entry.text.length + 1;
      return start;
    });
    /** The run's wraps, both fencings, ordered by where the break sits. */
    const runWrapped: Array<{ at: number; site: WrappedCitation }> = [];
    /** Every span the shared pairing closed, fences included. */
    const fenced = fencedSpans(joined);
    /** The unwrapped ones with their extents — what the pair arm reads. */
    const onOneLine: Array<{ start: number; end: number; site: CitationSite }> =
      [];
    for (const span of fenced) {
      const site = { module, line: lineAt(span.start), text: span.raw };
      if (span.raw.includes("\n")) {
        runWrapped.push({
          at: span.start,
          site: {
            ...site,
            text: joinWrapped(span.raw, " "),
            closed: joinWrapped(span.raw, ""),
          },
        });
      } else {
        closed.push(site);
        onOneLine.push({ start: span.start, end: span.end, site });
      }
    }

    // The pair: an identifier span the author parenthesised a path behind.
    // Read off the two spans' own extents rather than out of the prose — the
    // gap is the one open paren, the path closes it, and anything else the
    // sentence put between them is a path standing on its own.
    for (let at = 0; at + 1 < onOneLine.length; at += 1) {
      const name = onOneLine[at];
      const home = onOneLine[at + 1];
      if (!name || !home) continue;
      if (!isIdentifierSubject(name.site.text)) continue;
      if (!home.site.text.includes("/") || !isPathSubject(home.site.text))
        continue;
      // A page is not a home: no declaration lives in one, so a pair drawn
      // here would resolve a name against a file that declares nothing and
      // red every time. The two spans fall back to the arms they already
      // have — the name against the trees at large, the page against the
      // working tree.
      if (isPageName(home.site.text)) continue;
      const gap = joinWrapped(joined.slice(name.end, home.start), " ").trim();
      if (gap !== PAIR_OPEN) continue;
      if (joined.slice(home.end, home.end + 1) !== PAIR_CLOSE) continue;
      paired.push({ site: name.site, home: home.site.text });
    }

    /** Every unfenced page name a line break split, both halves covered. */
    const split: Array<{ start: number; end: number }> = [];
    for (let above = 0; above + 1 < run.length; above += 1) {
      const head = run[above]?.text ?? "";
      const next = run[above + 1]?.text ?? "";
      const headMargin = (CONTINUATION_MARGIN.exec(head)?.[0] ?? "").length;
      const opened = WRAP_HEAD.exec(
        head.slice(headMargin).replace(BLOCK_TERMINATOR, "").trimEnd(),
      );
      if (!opened) continue;
      const nextMargin = (CONTINUATION_MARGIN.exec(next)?.[0] ?? "").length;
      const tail = WRAP_TAIL.exec(next.slice(nextMargin))?.[0];
      if (tail === undefined) continue;
      const start = (starts[above] ?? 0) + headMargin + opened.index;
      const end = (starts[above + 1] ?? 0) + nextMargin + tail.length;
      // A wrap with either half inside a fenced span is the backticked arm's,
      // reported there already and by this same rule.
      if (fenced.some((span) => span.start < end && start < span.end)) continue;
      const directory = opened[0].replace(OPENING_PUNCTUATION, "");
      runWrapped.push({
        at: start,
        site: {
          module,
          line: lineAt(start),
          text: `${directory} ${tail}`,
          closed: `${directory}${tail}`,
        },
      });
      split.push({ start, end });
    }

    for (const entry of runWrapped.sort((a, b) => a.at - b.at)) {
      wrapped.push(entry.site);
    }

    for (const match of joined.matchAll(BARE_PAGE)) {
      const start = match.index;
      const end = start + match[0].length;
      // A page name inside a span was already collected as that span; taking
      // it again here would judge one citation twice, by two rules.
      if (fenced.some((span) => span.start < end && start < span.end)) continue;
      // The tail of a wrap is not a citation of its own: it is a page name
      // the author never wrote, which a root-level page answers whenever the
      // break fell at a directory boundary. Reported above as the wrap.
      if (split.some((span) => span.start < end && start < span.end)) continue;
      const text = match[0].replace(OPENING_PUNCTUATION, "");
      bare.push({ module, line: lineAt(start), text });
    }

    // The section cites, read off the run as markdown renders it rather than
    // off the span extents above, through the one reader every surface's
    // cites go through.
    const rendered = renderRun(run);
    sections.push(...sectionCites(module, rendered));

    // The link tags, off that same rendering: the tag is one reference
    // whichever line the wrapping broke it on, and the compiler that
    // resolves it reads the closed spelling too.
    for (const match of rendered.text.matchAll(LINK_CITE)) {
      links.push({
        module,
        line: rendered.lineAt(match.index),
        text: match[1] ?? "",
      });
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

  return { closed, bare, wrapped, paired, sections, links };
};

/**
 * Whether the working tree holds a file at a citation's repo-relative path —
 * the one arm a page name is answered by, at either tier below.
 *
 * The path is looked up whole: `resolve` folds the posix separators the
 * citation is written with into the host's, and the result never leaves this
 * predicate, so nothing downstream sees a path in two alphabets.
 */
const holdsFile = (root: string, text: string): boolean =>
  existsSync(resolve(root, text));

/**
 * A section title as markdown renders it: fences off, wrapping folded to one
 * space. The cite and the page's own title are both read this way, so a
 * backtick one side spells and the other does not, and a break either side
 * happens to fall on, cannot separate a title from itself.
 *
 * Nothing else is normalized. The match is exact from here, with no prefix
 * arm: an abbreviated cite names a title the page does not carry, and a page
 * whose heading grew a clause is a rewrite the citing comment has to follow
 * rather than a match it keeps by accident.
 */
const renderTitle = (text: string): string =>
  text.replace(/`/g, "").replace(/\s+/g, " ").trim();

/**
 * Whether a page titles the section a cite names, over one scan's reads.
 *
 * A page the working tree does not hold titles nothing, so a cite into one
 * reds here as it already reds at the page half — a section cite into a
 * missing page is the same dead citation one step earlier
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * The page's titles come off the shared reader (`sectionTitles`,
 * `tests/helpers/docSections.ts`): one rule for what a page's structure
 * offers, so a fenced `# ` line mints no title here that the renderer would
 * not show a reader.
 */
const sectionReader = (root: string): ((site: SectionCitation) => boolean) => {
  const read = new Map<string, ReadonlySet<string>>();
  const titlesOf = (page: string): ReadonlySet<string> => {
    const held = read.get(page);
    if (held) return held;
    const path = resolve(root, page);
    const found = new Set(
      existsSync(path)
        ? sectionTitles(readFileSync(path, "utf8")).map(renderTitle)
        : [],
    );
    read.set(page, found);
    return found;
  };

  return (site) => titlesOf(site.page).has(renderTitle(site.text));
};

/**
 * Scan a program's comments for citations naming nothing the judged trees
 * hold, and its test titles for page names the working tree cannot answer.
 *
 * A citation resolves when **every** one of its dotted segments is a token
 * those trees hold: a name the checker resolves to a symbol anywhere in them
 * (a declaration, an imported binding, a member, a lib global in scope), a
 * string literal they carry (a discriminant is declared by its literal, not
 * by a `const`; a fixture's source text is held the same way), or — for the
 * whole subject at once — a module of theirs by basename, or a file the
 * working tree holds at that repo-relative path. What a segment *means* is
 * never read: the scan proves the name exists and stops there.
 *
 * A `*.md` page name is the exception, and takes the working tree alone —
 * the arm a title's page name already goes through, for the reason the
 * header states.
 *
 * A TSDoc link tag is the other exception, and takes one module's reach
 * alone: the same segment rule, over the names the *citing* module holds
 * rather than over the three trees'. A tag is judged on its syntax, so the
 * subject rule is not read over it at all.
 *
 * A literal is therefore a resolution arm, which is why nothing that exists
 * *in order to be excused* may sit in a judged tree as one: a list spelling
 * the names it excuses would resolve every one of them.
 */
export const scanCommentCitations = (
  request: CitationScanRequest,
): CitationScan => {
  const repo = repoProgram(request);
  const { root, checker } = repo;
  const sources = sourcesOf(repo, request.trees);

  // --- what those trees hold ---------------------------------------------
  const tokens = new Set<string>();
  const modules = new Set<string>();
  // Where each name is *declared*, which is the fact a pair cites and the
  // token set cannot answer: a scope holds every global, so `WeakMap` is in
  // scope in every module and declared in none of them.
  const homes = new Map<string, Set<string>>();
  /**
   * The names each module can reach on its own — globals, its imports, its
   * own declarations, and every member the checker resolves inside it. What
   * a link tag is judged against, because that is the scope the language
   * resolves one in; the repo-wide set beside it would answer a reference
   * whose own module declares nothing of the sort.
   *
   * A string literal is *not* in it, though one is a resolution arm for
   * every other citation: a link tag names a declaration, and a fixture's
   * source text declares nothing.
   */
  const reach = new Map<string, Set<string>>();
  const holds = (name: string, module: string): void => {
    const held = homes.get(name) ?? new Set<string>();
    held.add(module);
    homes.set(name, held);
  };
  const declares = (sym: ts.Symbol): void => {
    for (const declaration of sym.getDeclarations() ?? []) {
      holds(sym.getName(), relPath(root, resolve(declaration.getSourceFile().fileName)));
    }
  };
  for (const sf of sources) {
    const module = relPath(root, resolve(sf.fileName));
    modules.add(module);
    const reachable = new Set<string>();
    reach.set(module, reachable);
    // Both spellings a comment cites a module by — `planState.ts` and
    // `PendingSchema` are the same file named two ways, and each stops
    // resolving the moment the file is renamed away.
    const basename = module.slice(module.lastIndexOf("/") + 1);
    tokens.add(basename);
    tokens.add(basename.replace(/\.[^.]+$/, ""));
    holds(basename, module);
    holds(basename.replace(/\.[^.]+$/, ""), module);
    // Scope at the file, which is globals plus its own top level — the arm
    // that holds a lib global or an import a comment cites and no statement
    // in the tree happens to use.
    for (const sym of checker.getSymbolsInScope(sf, ts.SymbolFlags.All)) {
      tokens.add(sym.getName());
      reachable.add(sym.getName());
      declares(sym);
    }
    eachToken(sf, (token) => {
      if (ts.isIdentifier(token)) {
        const sym = checker.getSymbolAtLocation(token);
        if (sym) {
          tokens.add(sym.getName());
          reachable.add(sym.getName());
          declares(sym);
        }
      } else {
        tokens.add(token.text);
        // A discriminant is declared by the literal spelling it, so the file
        // spelling it is where that name lives.
        holds(token.text, module);
      }
    });
  }

  // --- what their comments cite ------------------------------------------
  // Each file's judged citations are ordered by line, whichever arm admitted
  // them, so a finding reads in the order an author would scroll to it.
  const backticked: CitationSite[] = [];
  const bare: CitationSite[] = [];
  const wrapped: WrappedCitation[] = [];
  const scanned: CitationSite[] = [];
  const titled: CitationSite[] = [];
  const sections: SectionCitation[] = [];
  const links: CitationSite[] = [];
  /** The home each paired citation named, keyed by the very site judged. */
  const pairedHome = new Map<CitationSite, string>();
  for (const sf of sources) {
    titled.push(...titleSites(sf, relPath(root, resolve(sf.fileName))));
    const spans = commentSpans(sf, relPath(root, resolve(sf.fileName)));
    backticked.push(...spans.closed);
    bare.push(...spans.bare);
    wrapped.push(...spans.wrapped);
    sections.push(...spans.sections);
    links.push(...spans.links);
    for (const pair of spans.paired) pairedHome.set(pair.site, pair.home);
    scanned.push(
      ...[
        // A span the pair arm admitted is judged whatever the standalone
        // subject rule makes of its spelling: the pair is the wider arm, and
        // reading the narrower one over the same span would draw a home and
        // then judge nothing at it.
        ...spans.closed.filter(
          (site) => isSubject(site.text) || pairedHome.has(site),
        ),
        ...spans.bare.filter((site) => isPageName(site.text)),
      ].sort((a, b) => a.line - b.line),
    );
  }

  // The working tree is the other thing the repo holds a citation's name in.
  const onDisk = (text: string): boolean => holdsFile(root, text);

  // The page-name arm short-circuits the token set rather than sitting behind
  // it, for the reason the header states: a literal answering a page name is
  // how a renamed page leaves its citations standing.
  const resolves = (text: string): boolean =>
    isPageName(text)
      ? onDisk(text)
      : tokens.has(text) ||
        onDisk(text) ||
        text
          .split(".")
          .every((segment) => KEYWORDS.has(segment) || tokens.has(segment));

  // A pair names the home, so the home is what answers it: every segment is
  // resolved against the declarations that one file holds, and the repo-wide
  // token set is not consulted at all. Answered by that set, a citation whose
  // symbol a split moved out of the file it names would keep resolving from
  // wherever the symbol went, which is the reading the pair exists to refuse.
  const resolvesAtHome = (text: string, home: string): boolean =>
    text
      .split(".")
      .every(
        (segment) => KEYWORDS.has(segment) || homes.get(segment)?.has(home),
      );

  const answered = (site: CitationSite): boolean => {
    const home = pairedHome.get(site);
    return home === undefined
      ? resolves(site.text)
      : resolvesAtHome(site.text, home);
  };

  // The page names the titles carry, judged by the page-name arm alone. The
  // token set is not consulted: a title is a string literal, so a name written
  // in one is a token of the tree by having been written, and every verdict
  // read through `tokens` would answer the citation out of the citation.
  const titlePageNames = titled
    .flatMap(titlePages)
    .filter((site) => isPageName(site.text));

  // The section arm is answered by the working tree the way the page-name arm
  // is, one step further in — by what the named page titles — so it reads the
  // declarations not at all.
  const titles = sectionReader(root);

  // A link tag resolves where it sits: every dotted segment is a name the
  // citing module reaches, read the way the repo-wide arm reads a segment —
  // the token, never its meaning. A module the scan never read reaches
  // nothing, so a tag in one reds rather than passing for want of a scope.
  const followed = (site: CitationSite): boolean => {
    const reachable = reach.get(site.module);
    return (
      reachable !== undefined &&
      site.text.split(".").every((segment) => reachable.has(segment))
    );
  };

  return {
    modules: [...modules],
    backticked,
    bare,
    wraps: {
      scanned: wrapped,
      // The wrap is read by the same rule as the judged set, with the break
      // closed: what the author spelled before markdown put a space in it.
      findings: wrapped.filter((site) => isSubject(site.closed)),
    },
    titled,
    titles: {
      scanned: titlePageNames,
      findings: titlePageNames.filter((site) => !onDisk(site.text)),
    },
    sections: {
      scanned: sections,
      findings: sections.filter((site) => !titles(site)),
    },
    links: {
      scanned: links,
      findings: links.filter((site) => !followed(site)),
    },
    pairs: scanned
      .filter((site) => pairedHome.has(site))
      .map((site) => ({ ...site, home: pairedHome.get(site) ?? "" })),
    scanned,
    resolved: scanned.filter(answered),
    findings: scanned.filter((site) => !answered(site)),
  };
};

/** `module:line text`, the form a failure message cites a finding in. */
export const formatCitation = (site: CitationSite): string =>
  `${site.module}:${site.line} ${site.text}`;

/**
 * What the page-name arm reads, and the root it reads against. Its own domain
 * rather than the program scan's `trees`: the carve-out scopes the identifier
 * and path arms to the code a declaration can answer, and scopes a page name
 * to every tree the sweep domain names, because a filename is answered by the
 * working tree and needs no program at all.
 */
export interface PageCitationScanRequest {
  /** Absolute path to the scanned root. */
  readonly root: string;
  /** The trees and named files whose comments carry the judged page names. */
  readonly domain: ScanDomain;
}

/**
 * The page names one domain's comments carry, and the ones the working tree
 * cannot answer.
 *
 * `backticked` and `bare` are the two fencings, reported rather than left in
 * the scan's head: a vacuity pin that read only the judged total could not
 * tell a collector that stopped reading one fencing from a domain that never
 * used it.
 */
export interface PageCitationScan extends Scan<CitationSite> {
  /** Every module read, repo-relative and posix-separated, in path order. */
  readonly modules: readonly string[];
  /** The judged names their author fenced. */
  readonly backticked: readonly CitationSite[];
  /** The judged names their author left bare. */
  readonly bare: readonly CitationSite[];
  /** The judged names the working tree holds. */
  readonly resolved: readonly CitationSite[];
  /**
   * The citations a comment line broke, and among them the ones whose closed
   * spelling is a page name. The break puts a space in the token, so the name
   * falls out of the judged set whatever it cited — reported here so it
   * cannot do that quietly (`.claude/rules/engineering.md`, *Loud or
   * nothing*).
   */
  readonly wraps: Scan<WrappedCitation>;
  /**
   * The section halves these comments cite, and among them the ones their
   * page no longer titles. The same arm the program-backed scan runs, for the
   * same reason the page name reaches here: a page's own headings answer it,
   * and no declaration is consulted either way.
   */
  readonly sections: Scan<SectionCitation>;
}

/**
 * Scan a domain's comments for `*.md` page names the working tree cannot
 * answer.
 *
 * The same comment reader, the same fencings, the same subject rule and the
 * same on-disk resolution the program-backed scan runs — one mechanism, so a
 * page name is judged identically wherever its author wrote it and a
 * placeholder spelling is refused on the same charset. What this arm drops is
 * every citation a declaration answers: a domain reaching trees the program
 * does not resolve has no token set to judge an identifier against, and
 * judging one against a partial set would red a name the repo holds.
 *
 * Test titles are the program scan's alone. A title is a suite's shape, and
 * the trees this arm adds hold no suite — an arm collected here would be a
 * verdict over zero titles wearing a green (`.claude/rules/engineering.md`,
 * *A green verdict is proven non-vacuous*).
 */
export const scanPageCitations = (
  request: PageCitationScanRequest,
): PageCitationScan => {
  const root = resolve(request.root);
  const modules: string[] = [];
  const backticked: CitationSite[] = [];
  const bare: CitationSite[] = [];
  const wrapped: WrappedCitation[] = [];
  const scanned: CitationSite[] = [];
  const sections: SectionCitation[] = [];

  for (const path of modulesUnder(root, request.domain)) {
    const module = relPath(root, path);
    modules.push(module);
    const spans = commentSpans(parseScopeless(path), module);
    const fenced = spans.closed.filter((site) => isPageName(site.text));
    const unfenced = spans.bare.filter((site) => isPageName(site.text));
    backticked.push(...fenced);
    bare.push(...unfenced);
    wrapped.push(...spans.wrapped);
    sections.push(...spans.sections);
    scanned.push(...[...fenced, ...unfenced].sort((a, b) => a.line - b.line));
  }

  const answered = (site: CitationSite): boolean => holdsFile(root, site.text);
  const titles = sectionReader(root);

  return {
    modules,
    backticked,
    bare,
    wraps: {
      scanned: wrapped,
      findings: wrapped.filter((site) => isPageName(site.closed)),
    },
    sections: {
      scanned: sections,
      findings: sections.filter((site) => !titles(site)),
    },
    scanned,
    resolved: scanned.filter(answered),
    findings: scanned.filter((site) => !answered(site)),
  };
};

/**
 * One rendered surface a citation sits in, and the name a finding cites it by.
 *
 * A surface rather than a module: the text is what the program hands a
 * reader — a `--help` page, not a file — so the name is the command that
 * prints it and the line is the line of the printed page.
 */
export interface RenderedSurface {
  /** How a finding names the surface, e.g. `flume loop --help`. */
  readonly name: string;
  /** The text the program renders, verbatim and whole. */
  readonly text: string;
}

/** The surfaces a rendered-section scan reads, and the root it resolves against. */
export interface RenderedSectionScanRequest {
  /** Absolute path to the scanned root. */
  readonly root: string;
  /** The rendered texts whose section cites are judged. */
  readonly surfaces: readonly RenderedSurface[];
}

/**
 * The section cites a set of rendered surfaces state, and the ones their page
 * no longer titles.
 *
 * The same arm the two comment scans run, reaching the third place a citation
 * sits: a literal the package ships to a reader. A doc comment is the hover
 * text a chain author reads and a `--help` page is what the operator reads
 * first, so a cite in one is as load-bearing as a cite in the other
 * (`.claude/rules/engineering.md`, *Narration is the ladder's bottom rung*).
 *
 * The section arm alone reaches here, for the reason a test title carries the
 * page-name arm alone: a literal is itself a resolution arm, so an identifier
 * written in one would resolve against itself. A section is answered by the
 * named page's own headings, which no literal can write into.
 *
 * The surfaces are the caller's to render, from the program that prints them
 * rather than from a copy of their text — a cite read off a hand copy pins the
 * copy (`.claude/rules/engineering.md`, *A seam gate reads what the real
 * writer wrote*).
 */
export const scanRenderedSections = (
  request: RenderedSectionScanRequest,
): Scan<SectionCitation> => {
  const root = resolve(request.root);
  const scanned = request.surfaces.flatMap((surface) =>
    sectionCites(
      surface.name,
      renderRun(
        surface.text
          .split(/\r?\n/)
          .map((text, index) => ({ line: index + 1, text })),
      ),
    ),
  );
  const titles = sectionReader(root);
  return { scanned, findings: scanned.filter((site) => !titles(site)) };
};
