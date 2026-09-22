/**
 * The two citations `.claude/rules/engineering.md` *Narration is the ladder's
 * bottom rung* resolves one step past a page name — the `#fragment` a
 * markdown link carries into a page, and the `§ N` a `docs/` page states —
 * each answered by the structure of the page it lands in, the way a `per`
 * cite already is. A page name is answered by the working tree; these are
 * answered by what that page opens a section on, so neither reading asks what
 * the citation *says*. The token, never its meaning.
 *
 * One job, two spellings of it: what a page's own headings answer. Without
 * the arms a citation past the page name resolves against nothing — the
 * page-name half reds when a page is renamed away, and stays green while
 * every section the citations into it named is rewritten out. A reader
 * following one lands at the top of the page, or at a number that has since
 * moved, with no signal that the section they were sent to is gone.
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

import { headingLines } from "./docSections.ts";
import { filesUnder, relPath } from "./repoProgram.ts";

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
