/**
 * The citations `.claude/rules/engineering.md` *Narration is the ladder's
 * bottom rung* resolves one step past a page name — the `#fragment` a
 * markdown link carries into a page, the `§ N` a `docs/` page states, and the
 * section half of a `` (`<page>.md`, *Section*) `` pair a page writes — each
 * answered by the structure of the page it lands in, the way a `per` cite
 * already is. A page name is answered by the working tree; these are answered
 * by what that page opens a section on, so no reading asks what the citation
 * *says*. The token, never its meaning.
 *
 * One job, three spellings of it: what a page's own structure answers.
 * Without the arms a citation past the page name resolves against nothing —
 * the page-name half reds when a page is renamed away, and stays green while
 * every section the citations into it named is rewritten out. A reader
 * following one lands at the top of the page, or at a number that has since
 * moved, with no signal that the section they were sent to is gone.
 *
 * The section-cite grammar is not this module's: one reader draws a cite
 * wherever a shipped text states it (`sectionCitesIn`,
 * `tests/helpers/commentCitations.ts`), and what lives here is the walk that
 * feeds it a page's paragraphs — beside the backticked identifiers the same
 * walk already hands out.
 *
 * The slug is GitHub's, because GitHub is where these links are followed: the
 * heading's rendered text, lowercased, stripped of everything that is not a
 * letter, digit, mark, `-` or `_`, with each remaining space turned into a
 * `-`, and a repeat heading taking the `-1`, `-2` suffix its predecessors
 * earned. Inline markup renders before that — a backticked span, an emphasis
 * pair and a link's own text all reach the slug as their text — which is why
 * a heading such as `` ## `flume-harness init` `` anchors on the bare words.
 *
 * Headings come off the shared reader (`headingLines`,
 * `tests/helpers/docSections.ts`): one rule for what a heading is, so the
 * fenced `# ` lines a page's shell samples carry never mint an anchor the
 * renderer would not, nor a section number a cross-reference could name.
 *
 * `markdownLinks` is the suite's one link reader, and the destination it hands
 * back is what the packaging scan already wanted — the two callers differ in
 * which half of a link they read, never in how a link is found.
 *
 * Not *.test.ts, so neither vitest lane collects it as a suite of its own.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  fencedSpans,
  isDeclarationSubject,
  resolveSectionCites,
  sectionCitesIn,
  type SectionCitation,
} from "./commentCitations.ts";
import { headingLines, proseLines, type ProseLine } from "./docSections.ts";
import { filesUnder, relPath, type Scan } from "./repoProgram.ts";

/** One markdown link, split at the `#` the destination may carry. */
export interface MarkdownLink {
  /** Everything before the `#`, verbatim; empty where the link is a bare anchor. */
  readonly destination: string;
  /** Everything after the `#`, without it; empty where the link carries none. */
  readonly fragment: string;
  /** The 1-based line the link opens on. */
  readonly line: number;
}

/** An inline link — `[text](target)` — read to the first space or `)`. */
const INLINE = /\[[^\]]*\]\(\s*([^)\s]+)/g;

/** A reference definition — `[label]: target` — at the head of its own line. */
const DEFINITION = /^\[[^\]]+\]:\s*(\S+)/gm;

/**
 * Every link a markdown body states, in page order, destination and fragment
 * apart. A destination naming nothing on the tree (a URL, an off-tree path) is
 * left in rather than filtered: the caller resolves, and a target naming no
 * page simply matches none.
 */
export function markdownLinks(body: string): MarkdownLink[] {
  const found: { readonly index: number; readonly target: string }[] = [];
  for (const pattern of [INLINE, DEFINITION])
    for (const match of body.matchAll(pattern))
      found.push({ index: match.index, target: match[1] ?? "" });

  return found
    .sort((a, b) => a.index - b.index)
    .map(({ index, target }) => {
      const at = target.indexOf("#");
      return {
        destination: at === -1 ? target : target.slice(0, at),
        fragment: at === -1 ? "" : target.slice(at + 1),
        line: body.slice(0, index).split("\n").length,
      };
    });
}

/** A link, rendered to the text a reader sees. */
const LINK_TEXT = /\[([^\]]*)\]\([^)]*\)/g;

/** What survives into a slug: letters, digits, marks, `-`, `_`, and space. */
const SLUGGABLE = /[^\p{L}\p{N}\p{M}\s_-]/gu;

/**
 * The anchor one heading's text earns, before any repeat suffix. Markup is
 * rendered first and punctuation dropped after, so the rendered text is what
 * gets slugged rather than the source spelling — a link's destination reaches
 * the slug as nothing, where dropping its punctuation alone would have left
 * the URL's letters in the anchor.
 */
export function anchorSlug(text: string): string {
  return text
    .replace(LINK_TEXT, "$1")
    .trim()
    .toLowerCase()
    .replace(SLUGGABLE, "")
    .replace(/\s/g, "-");
}

/**
 * Every anchor a page offers, in page order — one per heading, with a repeat
 * of an earlier anchor taking the numbered suffix the renderer gives it.
 */
export function headingSlugs(page: string): string[] {
  const taken = new Map<string, number>();
  const anchors: string[] = [];

  for (const heading of headingLines(page)) {
    const slug = anchorSlug(heading.replace(/^#{1,6}\s+/, ""));
    const seen = taken.get(slug) ?? 0;
    taken.set(slug, seen + 1);
    anchors.push(seen === 0 ? slug : `${slug}-${seen}`);
  }

  return anchors;
}

/** The pages a scan reads links out of, as repo-relative posix paths. */
export interface PageDomain {
  /** Directories, each walked to any depth for the `*.md` pages it holds. */
  readonly trees: readonly string[];
  /** Pages named one at a time, for a tree the walk should not descend. */
  readonly files?: readonly string[];
}

/** Where a scan reads from. */
export interface AnchorScanRequest {
  /** The repo root every path is resolved against. */
  readonly root: string;
  /** The pages whose links are judged. */
  readonly domain: PageDomain;
}

/** One link carrying a fragment into a page, at the line it sits on. */
export interface AnchorSite {
  /** The page holding the link, repo-relative and posix-separated. */
  readonly page: string;
  /** The 1-based line the link opens on. */
  readonly line: number;
  /** The page the fragment is resolved against, repo-relative and posix-separated. */
  readonly target: string;
  /** The fragment, without its `#`. */
  readonly fragment: string;
}

/** What one scan of a domain found. */
export interface AnchorScan {
  /** Every page read, repo-relative and posix-separated. */
  readonly pages: readonly string[];
  /** Every fragment-carrying link into a page, judged or not. */
  readonly scanned: readonly AnchorSite[];
  /** Those whose fragment names a heading the target page opens. */
  readonly resolved: readonly AnchorSite[];
  /** Those whose fragment names none — the arm's verdict. */
  readonly findings: readonly AnchorSite[];
}

/** `page:line target#fragment`, the form a failure message cites a link in. */
export const formatAnchor = (site: AnchorSite): string =>
  `${site.page}:${site.line} ${site.target}#${site.fragment}`;

/**
 * Every `*.md` page a domain resolves to, absolute and in a stable order.
 *
 * Both halves refuse rather than shrink: a tree holding no page and a named
 * page the tree no longer has are each an error here, because a domain that
 * quietly collapsed would report the verdict green for having read nothing
 * (`.claude/rules/engineering.md`, *A green verdict is proven non-vacuous*).
 */
export function pagesUnder(root: string, domain: PageDomain): string[] {
  const found: string[] = [];

  for (const tree of domain.trees) {
    const dir = join(root, ...tree.split("/"));
    if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory())
      throw new Error(`no page under ${tree}: the scan would judge that tree as holding none`);
    const pages = filesUnder({ root: dir, suffix: ".md" });
    if (pages.length === 0)
      throw new Error(`no page under ${tree}: the scan would judge that tree as holding none`);
    found.push(...pages);
  }

  for (const file of domain.files ?? []) {
    const path = join(root, ...file.split("/"));
    if (!statSync(path, { throwIfNoEntry: false })?.isFile())
      throw new Error(`no page at ${file}: the scan would judge a page it cannot read`);
    found.push(path);
  }

  return found;
}

/**
 * Every fragment the domain's pages carry into a page, resolved against that
 * page's own anchors.
 *
 * A link is this arm's business when its destination names a `*.md` page — a
 * URL, a directory, an image are each some other reader's subject — or names
 * nothing at all, the bare `#anchor` a page points at itself with, which
 * resolves against the page holding it. A destination naming a page that is
 * not on disk resolves nothing rather than being skipped, since a fragment
 * into a missing page is the same dead citation one step earlier
 * (`.claude/rules/engineering.md`, *Loud or nothing*). The target is read
 * wherever it lives: the domain bounds which pages are *judged*, never which
 * pages answer.
 */
export function scanPageAnchors(request: AnchorScanRequest): AnchorScan {
  const root = resolve(request.root);
  const pages: string[] = [];
  const scanned: AnchorSite[] = [];

  for (const path of pagesUnder(root, request.domain)) {
    const page = relPath(root, path);
    pages.push(page);
    for (const link of markdownLinks(readFileSync(path, "utf8"))) {
      if (link.fragment === "") continue;
      if (link.destination !== "" && !link.destination.endsWith(".md")) continue;
      const target =
        link.destination === ""
          ? path
          : resolve(dirname(path), ...link.destination.split("/"));
      scanned.push({
        page,
        line: link.line,
        target: relPath(root, target),
        fragment: link.fragment,
      });
    }
  }

  const anchored = (site: AnchorSite): boolean => {
    const path = join(root, ...site.target.split("/"));
    return existsSync(path) && headingSlugs(readFileSync(path, "utf8")).includes(site.fragment);
  };

  return {
    pages,
    scanned,
    resolved: scanned.filter(anchored),
    findings: scanned.filter((site) => !anchored(site)),
  };
}

/**
 * A heading that opens a numbered section, capturing its number: `## 1.
 * Declaring a Phase`, `### 1.4 A chain-authored gate`, `## 0. Before anything
 * else`. The trailing `.` is optional because both spellings are on the tree,
 * and the number runs to whitespace or the line's end, so a heading numbered
 * `1.4` opens that section rather than section `1`.
 */
const NUMBERED_HEADING = /^#{1,6}\s+(\d+(?:\.\d+)*)\.?(?:\s|$)/;

/**
 * A bolded lead that opens one, on the same number rule: `**2.1 A chain
 * finding its own state root.**`. A migration note numbers its subsections
 * this way where a heading would crowd the page's table of contents, and a
 * `§ 2.1` naming one is a reference a reader follows exactly as far — the
 * same reading the section half of a `` (`<page>.md`, *Section*) `` pair
 * takes, which resolves against a page's headings and its bolded leads alike.
 */
const NUMBERED_LEAD = /^\*\*(\d+(?:\.\d+)*)\.?(?:\s|$)/gm;

/**
 * Every section number a page opens — a numbered heading or a numbered
 * bolded lead, each spelling in page order behind the one before it. What a
 * reference is resolved against is membership, so the two runs are not
 * interleaved; a caller wanting page order would be reading this for
 * something it does not answer. Headings come off the shared reader, so a
 * fenced `# 0.14 — two readings` line in a shell sample opens no section
 * here either.
 */
export function sectionNumbers(page: string): string[] {
  return [
    ...headingLines(page).flatMap((heading) => NUMBERED_HEADING.exec(heading)?.[1] ?? []),
    ...[...page.matchAll(NUMBERED_LEAD)].map((lead) => lead[1]!),
  ];
}

/**
 * A `§` or `§§` and the run of section numbers it introduces — one `§ 2.6`, a
 * range `§§ 1–5`, a list `§§ 5, 8, and 9`. The run ends at the first thing
 * that is not another number of the same series, so `§ 2.2, § 2.3` reads as
 * two references rather than one two-long run.
 */
const SECTION_REF =
  /§§?\s*\d+(?:\.\d+)*(?:\s*(?:[-–—]|,\s*|,?\s*(?:and|or|through)\s+)\s*\d+(?:\.\d+)*)*/g;

/** One number inside such a run. */
const REF_NUMBER = /\d+(?:\.\d+)*/g;

/** One `§ N` cross-reference, at the line it sits on. */
export interface SectionSite {
  /** The page stating the reference, repo-relative and posix-separated. */
  readonly page: string;
  /** The 1-based line the reference sits on. */
  readonly line: number;
  /** The section number, dotted and without its `§` — 1, 2.6, 5.4. */
  readonly number: string;
}

/**
 * Every `§ N` a body states, one site per number named, in page order.
 *
 * Read through fenced blocks as well as around them, unlike the heading
 * reader above: a fenced `# ` line is sample text that merely *looks* like a
 * heading, while a `§ 3` in a fenced grep cheat-sheet is a cross-reference a
 * reader follows like any other — and on a migration note the cheat-sheet is
 * where most of them are.
 */
export function sectionRefs(body: string): { readonly line: number; readonly number: string }[] {
  return [...body.matchAll(SECTION_REF)].flatMap((ref) =>
    [...ref[0].matchAll(REF_NUMBER)].map((number) => ({
      line: body.slice(0, ref.index).split("\n").length,
      number: number[0],
    })),
  );
}

/** What one scan of a domain's `§ N` references found. */
export interface SectionScan {
  /** Every page read, repo-relative and posix-separated. */
  readonly pages: readonly string[];
  /** Those numbering a section of their own — the pages whose references are judged. */
  readonly numbered: readonly string[];
  /** References on a page that numbers none: prose, and left unjudged. */
  readonly prose: readonly SectionSite[];
  /** The judged references — every one on a numbered page. */
  readonly scanned: readonly SectionSite[];
  /** Those naming a section the page opens. */
  readonly resolved: readonly SectionSite[];
  /** Those naming none — the arm's verdict. */
  readonly findings: readonly SectionSite[];
}

/** `page:line § number`, the form a failure message cites a reference in. */
export const formatSectionRef = (site: SectionSite): string =>
  `${site.page}:${site.line} § ${site.number}`;

/**
 * Every `§ N` the domain's pages carry, resolved against the numbering of the
 * page that states it.
 *
 * The page's *own* numbering is what answers, whoever the author had in mind:
 * `§ 4` is a number, and the only numbering in front of the reader is the one
 * they are reading. A page numbering no section of its own has no such
 * answer, so its references are prose and go unjudged — judging them would
 * red every `§` a page quotes out of one that numbers its sections, on no
 * evidence at all.
 */
export function scanSectionRefs(request: AnchorScanRequest): SectionScan {
  const root = resolve(request.root);
  const pages: string[] = [];
  const numbered: string[] = [];
  const prose: SectionSite[] = [];
  const scanned: SectionSite[] = [];
  const resolved: SectionSite[] = [];
  const findings: SectionSite[] = [];

  for (const path of pagesUnder(root, request.domain)) {
    const page = relPath(root, path);
    pages.push(page);

    const body = readFileSync(path, "utf8");
    const sections = sectionNumbers(body);
    const sites = sectionRefs(body).map((ref) => ({ page, ...ref }));

    if (sections.length === 0) {
      prose.push(...sites);
      continue;
    }

    numbered.push(page);
    scanned.push(...sites);
    for (const site of sites) (sections.includes(site.number) ? resolved : findings).push(site);
  }

  return { pages, numbered, prose, scanned, resolved, findings };
}

/**
 * One backticked span a page states, at the line its opening fence sits on.
 *
 * `.claude/rules/engineering.md` *Narration is the ladder's bottom rung*
 * reaches a page the way it reaches a comment: a page that states what a
 * shipped interface does may be pinned against that interface, and a
 * backticked identifier on one is a token the program can answer rather than
 * a sentence. The token, never its meaning — what the page *claims* about a
 * name stays with its authors, while that the name still exists is
 * mechanical.
 */
export interface PageSpan {
  /** The page stating it, repo-relative and posix-separated. */
  readonly page: string;
  /** The 1-based line the opening fence sits on. */
  readonly line: number;
  /** The span without its fences, a line break folded to the one space markdown renders. */
  readonly text: string;
}

/**
 * A span a line break split, read both ways that break can be read: `text` as
 * markdown joins it, `closed` as the author spelled it before the wrap.
 */
export interface WrappedSpan extends PageSpan {
  /** The span with the break itself removed — the spelling the wrap broke. */
  readonly closed: string;
}

/** What one read of a domain's pages found, before anything resolves it. */
export interface IdentifierRead {
  /** Every page read, repo-relative and posix-separated. */
  readonly pages: readonly string[];
  /** Every span one paragraph opened and closed, subject or not. */
  readonly backticked: readonly PageSpan[];
  /**
   * The spans a line break split, and among them the ones whose closed
   * spelling is a subject. The space markdown puts at the break is not a
   * character any subject spelling admits, so the citation the wrap meant to
   * carry falls out of the judged set whatever it named — reported so it
   * cannot do that quietly (`.claude/rules/engineering.md`, *Loud or
   * nothing*).
   */
  readonly wraps: {
    readonly scanned: readonly WrappedSpan[];
    readonly findings: readonly WrappedSpan[];
  };
  /** The judged set: the spans whose spelling names a declaration. */
  readonly scanned: readonly PageSpan[];
}

/**
 * The pages whose backticked identifiers are judged: the three
 * `.claude/rules/engineering.md` *Narration is the ladder's bottom rung*
 * names by role — the authoring page, the CLI page, the README. Each states
 * what a shipped interface does, which is what earns them the arm; a
 * migration guide or a survey names retired surface on purpose and is out by
 * construction.
 *
 * Here rather than in the pin that reads it, because the list is the rule's
 * own scope and two readers resolve against it: the verdict, and the
 * exclusion list's non-vaciousness over every judged set.
 */
export const INTERFACE_PAGES: PageDomain = {
  trees: [],
  files: ["docs/CHAIN-AUTHORING.md", "docs/CLI.md", "README.md"],
};

/** Where a page's identifiers are judged, and what answers them. */
export interface IdentifierScanRequest extends AnchorScanRequest {
  /**
   * Every name the package's shipped surface holds — `packageSurface`
   * (`tests/helpers/exportGraph.ts`). A page states what a shipped interface
   * does, so what that interface hands out is what its names resolve
   * against.
   */
  readonly surface: ReadonlySet<string>;
}

/** What one scan of a domain's backticked identifiers found. */
export interface IdentifierScan extends IdentifierRead {
  /** The judged spans whose every dotted segment the surface holds. */
  readonly resolved: readonly PageSpan[];
  /** Those naming a segment it does not — the arm's verdict. */
  readonly findings: readonly PageSpan[];
}

/** `page:line text`, the form a failure message cites a span in. */
export const formatSpan = (site: PageSpan): string =>
  `${site.page}:${site.line} ${site.text}`;

/**
 * A wrapped span read across its break. A space is what markdown renders and
 * what breaks whatever the span was spelling; nothing at all is the spelling
 * the author had before the wrap. No furniture comes off — a page line
 * carries none, which is the whole difference from the same fold over a
 * comment.
 */
const joinWrapped = (raw: string, at: string): string =>
  raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .join(at);

/**
 * Every paragraph a page renders: runs of consecutive, non-blank, unfenced
 * lines, in page order, each line keeping the line of the page it sits on.
 *
 * The paragraph is markdown's own pairing unit, which is why both readers
 * below take it rather than the page whole: a blank line closes a backtick
 * run and closes a parenthetical alike, so page-wide pairing would let one
 * stray fence swallow every span behind it and one unclosed paren pair a page
 * name with an emphasis eight paragraphs down.
 *
 * Fenced blocks are out on the shared read of what a fence covers
 * (`proseLines`, `tests/helpers/docSections.ts`): a sample's identifiers are
 * code the page is showing rather than a name its prose cites, and a cite
 * inside one is a page quoting text rather than making a claim of its own.
 */
function pageParagraphs(body: string): ProseLine[][] {
  const paragraphs: ProseLine[][] = [];
  let run: ProseLine[] = [];
  const close = (): void => {
    if (run.length > 0) paragraphs.push(run);
    run = [];
  };

  for (const line of proseLines(body)) {
    const previous = run[run.length - 1];
    if (line.text.trim() === "" || (previous && line.line !== previous.line + 1)) {
      close();
      if (line.text.trim() === "") continue;
    }
    run.push(line);
  }
  close();

  return paragraphs;
}

/**
 * Every backticked span the domain's pages state, judged set and wraps apart.
 *
 * Spans are paired over one paragraph at a time (`pageParagraphs` above, whose
 * header states why) by the shared pairing reader (`fencedSpans`,
 * `tests/helpers/commentCitations.ts`).
 *
 * Which spans are judged is `isDeclarationSubject`'s — the one subject rule
 * the comment scan is held to, narrowed to the alphabet a surface can answer.
 *
 * Read without a surface, so a caller that wants the judged set alone — the
 * exclusion list's own non-vacuity, say — pays for no declaration emit.
 */
export function pageIdentifiers(request: AnchorScanRequest): IdentifierRead {
  const root = resolve(request.root);
  const pages: string[] = [];
  const backticked: PageSpan[] = [];
  const wrapped: WrappedSpan[] = [];

  for (const path of pagesUnder(root, request.domain)) {
    const page = relPath(root, path);
    pages.push(page);

    for (const paragraph of pageParagraphs(readFileSync(path, "utf8"))) {
      const joined = paragraph.map((entry) => entry.text).join("\n");
      const first = paragraph[0]?.line ?? 0;
      const lineAt = (offset: number): number =>
        first + (joined.slice(0, offset).match(/\n/g)?.length ?? 0);

      for (const span of fencedSpans(joined)) {
        const site = { page, line: lineAt(span.start), text: span.raw };
        if (span.raw.includes("\n")) {
          wrapped.push({
            ...site,
            text: joinWrapped(span.raw, " "),
            closed: joinWrapped(span.raw, ""),
          });
        } else {
          backticked.push(site);
        }
      }
    }
  }

  return {
    pages,
    backticked,
    wraps: {
      scanned: wrapped,
      // The wrap is read by the same rule as the judged set, with the break
      // closed: what the author spelled before markdown put a space in it.
      findings: wrapped.filter((site) => isDeclarationSubject(site.closed)),
    },
    scanned: backticked.filter((site) => isDeclarationSubject(site.text)),
  };
}

/**
 * Every backticked identifier the domain's pages state, resolved against the
 * package's shipped surface.
 *
 * A citation resolves when **every** one of its dotted segments is a name the
 * surface holds — `Chain.worktreesBase` needs both halves, because a page
 * naming a member of a type the package retired is as dead as one naming the
 * type. What a segment *means* is never read: the scan proves the name exists
 * and stops there.
 */
export function scanPageIdentifiers(
  request: IdentifierScanRequest,
): IdentifierScan {
  const read = pageIdentifiers(request);
  const answered = (site: PageSpan): boolean =>
    site.text.split(".").every((segment) => request.surface.has(segment));

  return {
    ...read,
    resolved: read.scanned.filter(answered),
    findings: read.scanned.filter((site) => !answered(site)),
  };
}

/**
 * What one scan of a domain's section cites found.
 *
 * `pages` is what a vacuity pin reads beside the judged total: a walk that
 * reached no page reports the same clean verdict as a tree whose cites all
 * resolve (`.claude/rules/engineering.md`, *A green verdict is proven
 * non-vacuous*).
 */
export interface PageSectionScan extends Scan<SectionCitation> {
  /** Every page read, repo-relative and posix-separated. */
  readonly pages: readonly string[];
  /** The cites whose named page still titles the section they name. */
  readonly resolved: readonly SectionCitation[];
}

/**
 * Every `` (`<page>.md`, *Section*) `` cite the domain's pages state, resolved
 * against the titles of the page each names.
 *
 * The fourth place the one section-cite arm reaches, after a doc comment, a
 * comment in the widened page domain, and a shipped help literal
 * (`scanRenderedSections`, `tests/helpers/commentCitations.ts`). A page that
 * states what a shipped interface does is the surface a consumer reads before
 * the hover text, so a cite it makes into a section that has been rewritten
 * out sends that reader nowhere, exactly as a comment's would
 * (`.claude/rules/engineering.md`, *Narration is the ladder's bottom rung*).
 *
 * The cited page is repo-relative, as it is in every other reader of this
 * grammar — the page half is a path the working tree answers, never one the
 * citing page's own directory does. The target is read wherever it lives: the
 * domain bounds which pages are *judged*, never which pages answer.
 */
export function scanPageSections(request: AnchorScanRequest): PageSectionScan {
  const root = resolve(request.root);
  const pages: string[] = [];
  const cites: SectionCitation[] = [];

  for (const path of pagesUnder(root, request.domain)) {
    const page = relPath(root, path);
    pages.push(page);
    for (const paragraph of pageParagraphs(readFileSync(path, "utf8")))
      cites.push(...sectionCitesIn(page, paragraph));
  }

  const scan = resolveSectionCites(root, cites);
  const dangling = new Set<SectionCitation>(scan.findings);

  return {
    ...scan,
    pages,
    resolved: scan.scanned.filter((site) => !dangling.has(site)),
  };
}
