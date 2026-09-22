/**
 * The anchor half of the citation carve-out `.claude/rules/engineering.md`
 * *Narration is the ladder's bottom rung* names: the `#fragment` a markdown
 * link carries into a page resolves against that page's own headings, the way
 * a `per` cite already does. A page name is answered by the working tree, and
 * a fragment is answered one step further in — by what the named page opens a
 * heading on — so neither reading asks what the link *says*. The token, never
 * its meaning.
 *
 * Without the arm a fragment resolves against nothing: the page-name half
 * reds when a page is renamed away, and stays green while every heading the
 * links into it named is rewritten out. A reader following one lands at the
 * top of the page with no signal that the section they were sent to is gone.
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
 * renderer would not.
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
