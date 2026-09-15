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
 * Not *.test.ts, so neither vitest lane collects it as a suite of its own.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import ts from "typescript";

import {
  eachToken,
  relPath,
  repoProgram,
  sourcesOf,
  type ProgramScanRequest,
  type Scan,
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
 * The comment furniture a continuation line opens with — a block comment's
 * `*` margin, the `//` of the next line comment in a run. Markdown never
 * renders it, so a span the wrap carried across the break does not hold it
 * either.
 */
const CONTINUATION_MARGIN = /^\s*(?:\/\/+|\*+)\s*/;

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

/**
 * Every citation in a file's comments: the backticked spans, split by whether
 * the line that opened one also closed it, and the unbackticked `*.md` page
 * names the text between them carries.
 *
 * Pairing runs over a *run* of consecutive comment lines rather than over one
 * line at a time, because markdown does. A line that ends mid-span is closed
 * by the next line's backtick, and every span behind it takes its parity from
 * that pairing — read line by line, the wrapped span is lost *and* the rest
 * of the comment pairs one backtick out of step, so the citations after it go
 * unjudged too. Equal-length runs delimit a span, so a fenced block inside a
 * doc comment is one span rather than three stray backticks.
 *
 * The page names are read off the same pairing, from the text no span covers,
 * so a fenced citation is collected once and by the arm its author chose. One
 * a line break split is reported as the wrap it is, through the set the
 * fenced wrap already goes to, and its tail is left out of the collected
 * names — the same report for both fencings rather than a second rule for the
 * one the author left bare.
 */
const commentSpans = (
  sf: ts.SourceFile,
  module: string,
): {
  readonly closed: CitationSite[];
  readonly bare: CitationSite[];
  readonly wrapped: WrappedCitation[];
} => {
  const closed: CitationSite[] = [];
  const bare: CitationSite[] = [];
  const wrapped: WrappedCitation[] = [];

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
    const marks = [...joined.matchAll(/`+/g)].map((m) => ({
      start: m.index,
      length: m[0].length,
    }));
    /** Every span the pairing below closed, fences included. */
    const fenced: Array<{ start: number; end: number }> = [];
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
      fenced.push({ start: open.start, end: close.start + close.length });
      const raw = joined.slice(open.start + open.length, close.start);
      const site = {
        module,
        line: lineAt(open.start),
        text: raw,
      };
      if (raw.includes("\n")) {
        runWrapped.push({
          at: open.start,
          site: {
            ...site,
            text: joinWrapped(raw, " "),
            closed: joinWrapped(raw, ""),
          },
        });
      } else {
        closed.push(site);
      }
      index = closeAt + 1;
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

  return { closed, bare, wrapped };
};

/**
 * Scan a program's comments for citations naming nothing the judged trees
 * hold.
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
    eachToken(sf, (token) => {
      if (ts.isIdentifier(token)) {
        const sym = checker.getSymbolAtLocation(token);
        if (sym) tokens.add(sym.getName());
      } else {
        tokens.add(token.text);
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
  for (const sf of sources) {
    const spans = commentSpans(sf, relPath(root, resolve(sf.fileName)));
    backticked.push(...spans.closed);
    bare.push(...spans.bare);
    wrapped.push(...spans.wrapped);
    scanned.push(
      ...[
        ...spans.closed.filter((site) => isSubject(site.text)),
        ...spans.bare.filter((site) => isPathSubject(site.text)),
      ].sort((a, b) => a.line - b.line),
    );
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
    scanned,
    resolved: scanned.filter((site) => resolves(site.text)),
    findings: scanned.filter((site) => !resolves(site.text)),
  };
};

/** `module:line text`, the form a failure message cites a finding in. */
export const formatCitation = (site: CitationSite): string =>
  `${site.module}:${site.line} ${site.text}`;
