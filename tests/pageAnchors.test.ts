/**
 * The anchor arm of the citation pin (`tests/helpers/pageAnchors.ts`): a
 * markdown link's `#fragment` resolves against the headings of the page it
 * names, and a heading rewritten out from under a link reds rather than
 * silently landing a reader at the top of the page.
 *
 * The repo verdict at the foot is the arm; the cases above it are the arm's
 * own detection, proven on a fixture written to be caught. A scan whose
 * matcher stopped matching reports a clean tree and a dead link the same way,
 * so the reader and the slugger are pinned on inputs where the answer is
 * known before the tree is judged.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterAll, beforeAll, expect, it } from "vitest";

import { mkTempDir } from "./helpers/fixtureRoot.ts";
import {
  anchorSlug,
  type AnchorScan,
  headingSlugs,
  markdownLinks,
  pagesUnder,
  scanPageAnchors,
  type PageDomain,
} from "./helpers/pageAnchors.ts";
import { REPO_ROOT, filesUnder, relPath } from "./helpers/repoProgram.ts";

/**
 * The pages whose links are judged: every tree the sweep domain names that
 * holds markdown (`.claude/rules/posture-sweep.md`, *The pages are the
 * authority as they read this tick*), plus the consumer-facing roots and the
 * chain's own protocol page.
 *
 * `spec/` and `.claude/` are out, and deliberately: their prose is held by
 * its authors (`.claude/rules/engineering.md`, *Narration is the ladder's
 * bottom rung*). They still *answer* — a link out of a judged page into a
 * spec section resolves against that section's headings — because the domain
 * bounds which pages are read for links, never which pages hold the headings.
 */
const ANCHOR_DOMAIN: PageDomain = {
  trees: ["docs", "examples", "harness"],
  files: ["README.md", "CHANGELOG.md", ".flume/PROTOCOL.md"],
};

/**
 * Every tree the sweep domain names, whether or not it holds markdown today
 * (`.claude/rules/posture-sweep.md`, *The pages are the authority as they
 * read this tick*). The pages they hold are asserted covered by what the
 * domain above reads, so a page added under a tree that carries none today
 * reds here rather than going unread — the domain is a declaration, and this
 * is what keeps it from being a hand-kept list.
 */
const SWEEP_TREES: readonly string[] = [
  "bin",
  "docs",
  "examples",
  "harness",
  "scripts",
  "src",
  "tests",
];

/** A fixture tree: two pages, one live anchor into each, one dead. */
const FIXTURE: Record<string, string> = {
  "docs/guide.md": [
    "# Guide",
    "",
    "See [the unit](target.md#the-checkout-is-the-unit) and",
    "[the section that went](target.md#a-job-is-a-state-root).",
    "",
    "Also [a heading of its own](#guide), [off tree](https://example.test/x#frag),",
    "and [a sibling page](target.md) with no fragment at all.",
    "",
    "[ref]: target.md#runtime-ignores",
    "",
  ].join("\n"),
  "docs/target.md": [
    "# The runtime ignore set",
    "",
    "## Runtime ignores",
    "",
    "```",
    "# a-job-is-a-state-root",
    "```",
    "",
    "## The checkout is the unit",
    "",
  ].join("\n"),
};

let fixtureRoot = "";
let repoScan: AnchorScan;

beforeAll(async () => {
  repoScan = scanPageAnchors({ root: REPO_ROOT, domain: ANCHOR_DOMAIN });
  fixtureRoot = await mkTempDir("flume-anchors-");
  for (const [rel, body] of Object.entries(FIXTURE)) {
    const path = join(fixtureRoot, ...rel.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
});

afterAll(async () => {
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
});

it("one reader hands back a markdown link's destination and its fragment", () => {
  expect(
    markdownLinks(
      "see [`docs/MIGRATING-9.9.md`](docs/MIGRATING-9.9.md#section-3) and\n" +
        "[home](https://example.test/x), while `docs/MIGRATING-9.7.md` is only named.\n\n" +
        "[ref]: docs/MIGRATING-9.8.md#other\n",
    ),
  ).toEqual([
    { destination: "docs/MIGRATING-9.9.md", fragment: "section-3", line: 1 },
    { destination: "https://example.test/x", fragment: "", line: 2 },
    { destination: "docs/MIGRATING-9.8.md", fragment: "other", line: 4 },
  ]);

  // A bare anchor names no page: the destination is empty, the fragment is not.
  expect(markdownLinks("[up](#the-stamp)")).toEqual([
    { destination: "", fragment: "the-stamp", line: 1 },
  ]);
});

it("a heading anchors on its rendered text, and a repeat takes a numbered suffix", () => {
  expect(
    [
      "## `flume-harness init`",
      "### 7. Capability gating (`requiresCapability`)",
      "## **Loud** or nothing — really",
      "## A [linked](https://example.test/x) heading",
    ].map((heading) => anchorSlug(heading.replace(/^#+ /, ""))),
  ).toEqual([
    "flume-harness-init",
    "7-capability-gating-requirescapability",
    "loud-or-nothing--really",
    "a-linked-heading",
  ]);

  // Fenced `# ` lines mint no anchor, and a repeat heading is numbered from
  // the second occurrence on — both read off the shared heading walk.
  expect(
    headingSlugs(["# Notes", "", "```", "# Notes", "```", "", "# Notes", "", "# Notes"].join("\n")),
  ).toEqual(["notes", "notes-1", "notes-2"]);
});

it("a link into a page whose heading has gone reds the arm", () => {
  const scan = scanPageAnchors({ root: fixtureRoot, domain: { trees: ["docs"] } });

  // Non-vacuity: the fixture's live anchors are judged, not skipped past.
  expect(scan.pages).toEqual(["docs/guide.md", "docs/target.md"]);
  expect(scan.resolved.map((site) => site.fragment)).toEqual([
    "the-checkout-is-the-unit",
    "guide",
    "runtime-ignores",
  ]);

  // A fenced `# ` line in the target is not an anchor, so the link naming one
  // is the finding — reported at the line a reader has to edit.
  expect(scan.findings).toEqual([
    {
      page: "docs/guide.md",
      line: 4,
      target: "docs/target.md",
      fragment: "a-job-is-a-state-root",
    },
  ]);
});

it("an anchor domain that resolves to no page refuses rather than reporting green", async () => {
  const empty = join(fixtureRoot, "hollow");
  await mkdir(empty, { recursive: true });

  expect(() => pagesUnder(fixtureRoot, { trees: ["hollow"] })).toThrow(/no page under hollow/);
  expect(() => pagesUnder(fixtureRoot, { trees: ["absent"] })).toThrow(/no page under absent/);
  expect(() => pagesUnder(fixtureRoot, { trees: ["docs"], files: ["docs/gone.md"] })).toThrow(
    /no page at docs\/gone\.md/,
  );
});

it("the anchor domain reads every markdown page the sweep domain holds", () => {
  const held = SWEEP_TREES.flatMap((tree) =>
    filesUnder({ root: join(REPO_ROOT, tree), suffix: ".md" }),
  ).map((path) => relPath(REPO_ROOT, path));

  // Non-vacuity: a walk that found no page would report full coverage.
  expect(held.length).toBeGreaterThan(0);

  const read = new Set(repoScan.pages);
  expect(held.filter((page) => !read.has(page))).toEqual([]);
});

it("every markdown link's #fragment resolves against the cited page's own headings", () => {
  // Non-vacuity: green over a tree whose links went unread is the failure
  // this arm exists to make impossible.
  expect(repoScan.pages.length).toBeGreaterThan(0);
  expect(repoScan.scanned.length).toBeGreaterThan(0);

  expect(repoScan.findings).toEqual([]);
});
