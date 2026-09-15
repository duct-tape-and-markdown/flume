/**
 * The harness package's cite resolver (`spec/harness.md`, *The cite
 * resolver*): what resolves a `per`, what refuses one, and that a consumer's
 * declared resolver changes which section is found without changing the
 * verdict a gate reads.
 *
 * The refusal cases hand-author their input, which is the sanctioned shape —
 * no real writer produces the cite a refusal exists to catch — and the cite
 * itself is parsed through the entry extension's own `per` schema, so a case
 * here cannot exercise a shape a plan tick could not have written.
 *
 * The acceptance case is the seam (`.claude/rules/engineering.md`, *A seam
 * gate reads what the real writer wrote*): this repository's own cite, read
 * at a real commit through the engine's real at-ref reader, resolved by the
 * real resolver. A stubbed reader proves the resolution; only this proves the
 * two agree about what "absent" and "present" mean.
 */

import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import {
  resolveCite,
  type AtRefReader,
  type Cite,
  type CiteLocus,
  type SectionResolver,
} from "../harness/index.ts";
import { PerSchema } from "../harness/entryExtension.ts";
import { readFileAtRef } from "../src/git.ts";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The locus this repository's own declaration states. */
const LOCUS: CiteLocus = { specLocus: ["spec/**", ".claude/rules/**"] };

/** A cite, through the schema a plan tick's queue is validated against. */
const cite = (path: string, section: string): Cite =>
  PerSchema.parse({ path, section });

/** A reader that serves one file's bytes and reports every other path absent. */
const serving = (path: string, text: string): AtRefReader => (asked) =>
  asked === path ? text : null;

const MARKDOWN = [
  "# A spec page",
  "",
  "## The cite resolver",
  "",
  "`per` is `{ path, section }`.",
  "",
  "### A subsection under it",
  "",
  "Still the cited section.",
  "",
  "## The next section",
  "",
  "Not the cited section.",
  "",
].join("\n");

/**
 * The same page with the shapes a fence-blind scan misreads: a shell comment
 * inside a backtick block and a markdown sample inside a tilde block, neither
 * of them structure and both of them `#`-prefixed. The prose line that opens
 * with a backtick run carrying an info string is the other half — no fence
 * opens there, so the headings below it stay readable.
 */
const FENCED_MARKDOWN = [
  "# A spec page",
  "",
  "## The cite resolver",
  "",
  "```sh",
  "# a shell comment",
  "flume tick",
  "```",
  "",
  "Still the cited section, after the fence.",
  "",
  "~~~md",
  "## a markdown sample",
  "~~~",
  "",
  "``` opens a block, and `per` is `{ path, section }` — inline, not fenced.",
  "",
  "### A subsection under it",
  "",
  "## The next section",
  "",
  "Not the cited section.",
  "",
].join("\n");

/**
 * The same page with the indents CommonMark grants a heading: one space, then
 * three, then the fourth that revokes it. The indented headings are structure
 * — they resolve, and they bound what precedes them — while the four-space
 * line below is an indented code block the section that holds it carries as
 * content.
 */
const INDENTED_MARKDOWN = [
  "# A spec page",
  "",
  "## The section above it",
  "",
  "Above the indented heading.",
  "",
  " ## The cite resolver",
  "",
  "`per` is `{ path, section }`.",
  "",
  "   ### A subsection under it",
  "",
  "Still the cited section.",
  "",
  "## The next section",
  "",
  "    ## An indented code block",
  "",
  "Not the cited section.",
  "",
].join("\n");

/**
 * A spec with no headings at all — the shape a declared resolver exists for.
 * The package's heading resolver finds nothing here, so a section found in it
 * was found by the declared resolver and by nothing else.
 */
const TYPED_SPEC = JSON.stringify({
  sections: { "cite-resolver": "the section, keyed rather than headed" },
});

const byKey: SectionResolver = (target, text) =>
  (JSON.parse(text) as { sections: Record<string, string> }).sections[
    target.section
  ];

it("a per cite whose path matches no specLocus glob is refused, naming the path", async () => {
  const outside = cite("src/Dispatcher.ts", "The cite resolver");
  let reads = 0;
  const read: AtRefReader = (path) => {
    reads += 1;
    return serving("src/Dispatcher.ts", MARKDOWN)(path);
  };

  const verdict = await resolveCite(outside, LOCUS, read);

  expect(verdict.ok).toBe(false);
  expect(verdict.ok === false && verdict.message).toContain("src/Dispatcher.ts");
  expect(verdict.ok === false && verdict.message).toContain("spec/**");
  // A path outside the locus is wrong at every commit, so it is refused
  // before a commit is read at all.
  expect(reads).toBe(0);

  // Vacuity guard on the locus: the same section in a path the locus does
  // admit resolves, so the refusal above is the path's and not the file's.
  const inside = cite("spec/harness.md", "The cite resolver");
  const admitted = await resolveCite(
    inside,
    LOCUS,
    serving("spec/harness.md", MARKDOWN),
  );
  expect(admitted.ok).toBe(true);
});

it("a per cite whose path is absent from the gated commit is refused, naming the path", async () => {
  const gone = cite("spec/retired.md", "The cite resolver");

  const verdict = await resolveCite(
    gone,
    LOCUS,
    serving("spec/harness.md", MARKDOWN),
  );

  expect(verdict.ok).toBe(false);
  expect(verdict.ok === false && verdict.message).toContain("spec/retired.md");
  expect(verdict.ok === false && verdict.message).toContain("not in the commit");
});

it("a per cite whose section is no heading at the gated commit is refused, naming the section", async () => {
  const drifted = cite("spec/harness.md", "The cite resolvers");

  const verdict = await resolveCite(
    drifted,
    LOCUS,
    serving("spec/harness.md", MARKDOWN),
  );

  expect(verdict.ok).toBe(false);
  expect(verdict.ok === false && verdict.message).toContain(
    "The cite resolvers",
  );
  expect(verdict.ok === false && verdict.message).toContain("spec/harness.md");

  // Vacuity guard: the file the refusal was read from does hold a heading,
  // one character away — the refusal is exact-match, never an empty file
  // refusing everything.
  const exact = await resolveCite(
    cite("spec/harness.md", "The cite resolver"),
    LOCUS,
    serving("spec/harness.md", MARKDOWN),
  );
  expect(exact.ok).toBe(true);
});

it("a declared resolver keys a section without changing the verdict shape", async () => {
  const keyed = cite("spec/contract.json", "cite-resolver");
  const read = serving("spec/contract.json", TYPED_SPEC);
  const declared: CiteLocus = { ...LOCUS, resolver: byKey };

  const resolved = await resolveCite(keyed, declared, read);
  const byHeading = await resolveCite(
    cite("spec/harness.md", "The cite resolver"),
    LOCUS,
    serving("spec/harness.md", MARKDOWN),
  );

  // The declared resolver found it, and nothing else could have: the typed
  // spec carries no heading, so the package's own resolver refuses it.
  expect(await resolveCite(keyed, LOCUS, read)).toMatchObject({ ok: false });
  expect(resolved.ok).toBe(true);
  expect(resolved.ok === true && resolved.text).toBe(
    "the section, keyed rather than headed",
  );

  // One verdict shape either way — a gate reading `ok` and a prompt reading
  // `text` learn nothing about which resolver ran.
  expect(Object.keys(resolved).sort()).toEqual(Object.keys(byHeading).sort());
  expect(resolved.cite).toEqual(keyed);

  // And the same on the refusal arm.
  const missed = await resolveCite(
    cite("spec/contract.json", "no-such-key"),
    declared,
    read,
  );
  const missedHeading = await resolveCite(
    cite("spec/harness.md", "No such heading"),
    LOCUS,
    serving("spec/harness.md", MARKDOWN),
  );
  expect(missed.ok).toBe(false);
  expect(Object.keys(missed).sort()).toEqual(Object.keys(missedHeading).sort());
  expect(missed.ok === false && missed.message).toContain("no-such-key");
});

it("the resolved section is the cited heading's own, bounded at the next heading of its depth", async () => {
  const verdict = await resolveCite(
    cite("spec/harness.md", "The cite resolver"),
    LOCUS,
    serving("spec/harness.md", MARKDOWN),
  );

  expect(verdict.ok).toBe(true);
  const text = verdict.ok === true ? verdict.text : "";
  expect(text.startsWith("## The cite resolver")).toBe(true);
  // A deeper heading is inside the section; one of the same depth ends it.
  expect(text).toContain("### A subsection under it");
  expect(text).not.toContain("## The next section");
  expect(text).not.toContain("# A spec page");
});

it("a heading-shaped line inside a fenced block does not bound the cited section", async () => {
  const verdict = await resolveCite(
    cite("spec/harness.md", "The cite resolver"),
    LOCUS,
    serving("spec/harness.md", FENCED_MARKDOWN),
  );

  expect(verdict.ok).toBe(true);
  const text = verdict.ok === true ? verdict.text : "";
  expect(text.startsWith("## The cite resolver")).toBe(true);
  // The whole cited section, fences and all — not truncated at the `#` line
  // inside the ```sh block, nor at the `##` line inside the ~~~ one.
  expect(text).toContain("# a shell comment");
  expect(text).toContain("Still the cited section, after the fence.");
  expect(text).toContain("## a markdown sample");
  expect(text).toContain("### A subsection under it");
  // And a fence that never opened does not swallow the rest of the page: the
  // real heading below the inline-span line still bounds the section.
  expect(text).not.toContain("## The next section");
  expect(text).not.toContain("Not the cited section.");
});

it("a heading-shaped line inside a fenced block resolves no section of its own", async () => {
  const read = serving("spec/harness.md", FENCED_MARKDOWN);

  for (const section of ["a shell comment", "a markdown sample"]) {
    const verdict = await resolveCite(cite("spec/harness.md", section), LOCUS, read);

    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.message).toContain(section);
    expect(verdict.ok === false && verdict.message).toContain("no heading");
  }

  // Vacuity guard: the same page's real headings do resolve through the same
  // reader, so the refusals above are the fence's doing and not an unreadable
  // fixture refusing everything.
  for (const section of ["The cite resolver", "The next section"]) {
    const found = await resolveCite(cite("spec/harness.md", section), LOCUS, read);
    expect(found.ok).toBe(true);
  }
});

it("a heading indented up to three spaces resolves as the cited section", async () => {
  const verdict = await resolveCite(
    cite("spec/harness.md", "The cite resolver"),
    LOCUS,
    serving("spec/harness.md", INDENTED_MARKDOWN),
  );

  expect(verdict.ok).toBe(true);
  const text = verdict.ok === true ? verdict.text : "";
  // The heading line as the page wrote it, indent and all.
  expect(text.startsWith(" ## The cite resolver")).toBe(true);
  // A three-space-indented deeper heading is still inside the section.
  expect(text).toContain("   ### A subsection under it");
  expect(text).toContain("Still the cited section.");
  // And the section stops where the page's own next heading of its depth is.
  expect(text).not.toContain("## The next section");
  expect(text).not.toContain("Above the indented heading.");
});

it("a heading indented up to three spaces bounds the section above it", async () => {
  const verdict = await resolveCite(
    cite("spec/harness.md", "The section above it"),
    LOCUS,
    serving("spec/harness.md", INDENTED_MARKDOWN),
  );

  expect(verdict.ok).toBe(true);
  const text = verdict.ok === true ? verdict.text : "";
  expect(text.startsWith("## The section above it")).toBe(true);
  expect(text).toContain("Above the indented heading.");
  // The indented heading ends it — its heading line and its body are the
  // cited section's, not this one's.
  expect(text).not.toContain("The cite resolver");
  expect(text).not.toContain("`per` is `{ path, section }`.");
});

it("a four-space-indented hash line resolves no section", async () => {
  const read = serving("spec/harness.md", INDENTED_MARKDOWN);

  const verdict = await resolveCite(
    cite("spec/harness.md", "An indented code block"),
    LOCUS,
    read,
  );

  expect(verdict.ok).toBe(false);
  expect(verdict.ok === false && verdict.message).toContain(
    "An indented code block",
  );
  expect(verdict.ok === false && verdict.message).toContain("no heading");

  // Vacuity guard: the page is readable through the same reader, and the
  // section that holds the four-space line carries it as content rather than
  // ending at it.
  const holder = await resolveCite(
    cite("spec/harness.md", "The next section"),
    LOCUS,
    read,
  );
  expect(holder.ok).toBe(true);
  expect(holder.ok === true && holder.text).toContain(
    "    ## An indented code block",
  );
  expect(holder.ok === true && holder.text).toContain("Not the cited section.");
});

it("the package resolves this repository's own cite at a real commit through the engine's at-ref reader", async () => {
  const atHead: AtRefReader = (path) => readFileAtRef(REPO_ROOT, "HEAD", path);

  const verdict = await resolveCite(
    cite("spec/harness.md", "The cite resolver"),
    LOCUS,
    atHead,
  );

  expect(verdict.ok).toBe(true);
  const text = verdict.ok === true ? verdict.text : "";
  expect(text.startsWith("## The cite resolver")).toBe(true);
  expect(text).toContain("`per` is `{ path, section }`");
  // Bounded at the next section of the same depth, in the real file.
  expect(text).not.toContain("## Adoption and upgrade");

  // The other half of the reader's contract, driven through the same reader:
  // a path the commit does not carry comes back as a refusal naming it, not
  // as a throw and not as an empty section.
  const absent = await resolveCite(
    cite("spec/never-written.md", "The cite resolver"),
    LOCUS,
    atHead,
  );
  expect(absent.ok).toBe(false);
  expect(absent.ok === false && absent.message).toContain(
    "spec/never-written.md",
  );
});
