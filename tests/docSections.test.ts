/**
 * The suite's one markdown section cutter (`tests/helpers/docSections.ts`),
 * pinned on its own rather than only through the doc pins that call it.
 *
 * Those pins each read one span of one page, and a page that grows a fenced
 * sample or a deeper subheading inside a pinned section would move them
 * together with nothing saying which cut was meant. The two rules the copies
 * this cutter replaced disagreed on — what closes a section, and whether a
 * fenced `# ` line is a heading — are stated here, over pages written for
 * the purpose.
 */

import { describe, expect, it } from "vitest";

import { bulletOf, sectionOf, sectionTitles } from "./helpers/docSections.ts";

const PAGE = [
  "# Title",
  "",
  "## First",
  "",
  "opening prose",
  "",
  "### Under first",
  "",
  "a subsection's line",
  "",
  "## Second",
  "",
  "closing prose",
  "",
].join("\n");

describe("sectionOf", () => {
  it("a section runs from its heading to the line before the next heading that closes it", () => {
    const first = sectionOf(PAGE, "## First");
    expect(first).toContain("opening prose");
    expect(first.split("\n")[0]).toBe("## First");
    expect(first).not.toContain("## Second");
    expect(first).not.toContain("closing prose");
  });

  it("a section carries its own deeper subsections", () => {
    expect(sectionOf(PAGE, "## First")).toContain("a subsection's line");
  });

  it("a subsection is closed by the next heading above its own level", () => {
    const under = sectionOf(PAGE, "### Under first");
    expect(under).toContain("a subsection's line");
    expect(under).not.toContain("closing prose");
  });

  it("a fenced line that looks like a heading does not close a section", () => {
    const page = [
      "## Jobs",
      "",
      "```bash",
      "# tune: edit .flume/chain.ts",
      "flume loop --max 20",
      "```",
      "",
      "prose after the block",
      "",
      "## Status",
    ].join("\n");

    const jobs = sectionOf(page, "## Jobs");
    expect(jobs).toContain("# tune: edit");
    expect(jobs).toContain("prose after the block");
    expect(jobs).not.toContain("## Status");
  });

  it("a heading no line matches cuts nothing", () => {
    expect(sectionOf(PAGE, "## Third")).toBe("");
    expect(sectionOf(PAGE, /^## Third$/m)).toBe("");
  });

  it("a string heading is the whole heading line and a pattern is matched against it", () => {
    // The page holds the string as a prefix of a real heading and inside a
    // line of prose, so a cutter matching on either would return a span here.
    const page = ["## First run", "", "body", "", "## `## First` is not a heading"].join("\n");
    expect(sectionOf(page, "## First")).toBe("");
    expect(sectionOf(page, /^## First\b/)).toContain("body");
  });

  it("a pattern carrying the global flag matches the same heading on every call", () => {
    const heading = /^## First$/gm;
    expect(sectionOf(PAGE, heading)).toContain("opening prose");
    expect(sectionOf(PAGE, heading)).toContain("opening prose");
  });
});

describe("sectionTitles", () => {
  const TITLED = [
    "# Title",
    "",
    "## Loud or nothing",
    "",
    "- **Prefer the condition to the era.** a bullet whose lead the page",
    "  bolds, wrapped the way a lead wraps.",
    "- a bullet with no bolded lead at all",
    "- **When:** a lead the page ends with a colon",
    "",
    "```",
    "# A fenced heading",
    "- **A fenced lead.** a sample",
    "```",
    "",
    "prose carrying a **bolded run** that leads no bullet",
    "",
  ].join("\n");

  it("a page's titles are its headings and its bolded bullet leads", () => {
    expect(sectionTitles(TITLED)).toEqual([
      "Title",
      "Loud or nothing",
      "Prefer the condition to the era",
      "When",
    ]);
  });

  it("a title stops before the sentence punctuation its own emphasis covers", () => {
    // Vacuity guard: the page bolds both leads with their punctuation inside
    // the `**`, so the titles below are the read dropping it rather than a
    // page that never wrote it.
    expect(TITLED).toContain("**Prefer the condition to the era.**");
    expect(TITLED).toContain("**When:**");

    const titles = sectionTitles(TITLED);
    expect(titles).toContain("Prefer the condition to the era");
    expect(titles).toContain("When");
  });

  it("neither a fenced heading nor a fenced bullet lead is a title", () => {
    // Vacuity guard: the fence carries both shapes, and the same page's
    // unfenced ones are titles, so the absences below are the fence rule.
    expect(TITLED).toContain("# A fenced heading");
    expect(TITLED).toContain("**A fenced lead.**");
    expect(sectionTitles(TITLED).length).toBeGreaterThan(0);

    expect(sectionTitles(TITLED)).not.toContain("A fenced heading");
    expect(sectionTitles(TITLED)).not.toContain("A fenced lead");
  });

  it("a bolded run that leads no bullet is prose, not a title", () => {
    expect(TITLED).toContain("**bolded run**");
    expect(sectionTitles(TITLED)).not.toContain("bolded run");
  });

  // A banner states a page's reading conventions as bolded leads inside a
  // blockquote rather than as bullets or headings — `docs/CLI.md`'s
  // exit-code convention is one — so a comment cites one of those the way it
  // cites a bullet's lead. Its own page, because the arm turns on the quote
  // marker the bullet cases never carry: the lead's `>`, and the `>` on the
  // line the phrase wraps onto.
  const QUOTED = [
    "# Title",
    "",
    "> **Reading the exit",
    "> codes.** the lead a banner bolds, broken across two quoted lines the",
    "> way a banner breaks a phrase.",
    ">",
    "> prose carrying a **bolded run** part-way through a quoted sentence",
    "",
  ].join("\n");

  it("a bolded lead opening a blockquote line is a title", () => {
    // Vacuity guard: the page states its lead inside the quote and nowhere
    // else, wraps the phrase across the quote's own marker, and bolds a
    // second run mid-sentence in the same quote — so the equality below is
    // the quote arm reading a lead and folding the marker out of it, not a
    // bullet the fixture smuggled in and not a page that never wrapped.
    expect(QUOTED).toContain("> **Reading the exit\n> codes.**");
    expect(QUOTED).toContain("a **bolded run** part-way through");

    expect(sectionTitles(QUOTED)).toEqual(["Title", "Reading the exit codes"]);
  });
});

describe("bulletOf", () => {
  // A list that is *not* the last thing in its section — the shape every doc
  // pin that cuts one bullet meets on a real page: the walk, then a paragraph
  // and a bolded claim about the same names. `docs/CHAIN-AUTHORING.md`'s
  // `<prior-attempt>` walk is one, and its last bullet is the one with no next
  // lead to stop at.
  const LISTED = [
    "## Modes",
    "",
    "- `first` — the opening mode. Carries `alpha`.",
    "- `last` — the closing mode. Carries `omega`, wrapped",
    "  across two source lines.",
    "",
    "Prose below the walk, naming `alpha` and `omega` both.",
    "",
    "**A bolded claim the section spends on `omega`.**",
    "",
  ].join("\n");

  it("a bullet mid-list stops at the next lead opening the same way", () => {
    expect(bulletOf(LISTED, "- `first` — ")).toBe(
      "- `first` — the opening mode. Carries `alpha`.",
    );
  });

  it("the last bullet of a non-terminal list stops at the blank line that closes it", () => {
    // Vacuity guard on the subject: the section really does carry the prose a
    // cut that ran to the section's end would swallow, and that prose names
    // the field this bullet's own claim is about — so the equality below is
    // the list-close rule rather than a fixture with nothing past its list
    // (`.claude/rules/engineering.md`, *A green verdict is proven
    // non-vacuous*).
    expect(LISTED).toContain("Prose below the walk");
    expect(LISTED).toContain("**A bolded claim the section spends on `omega`.**");

    // The whole cut as an equality: the page's own wrapping folded out, and
    // nothing below the list carried in under the bullet's name.
    expect(bulletOf(LISTED, "- `last` — ")).toBe(
      "- `last` — the closing mode. Carries `omega`, wrapped across two source lines.",
    );
  });

  it("a bullet closing a section that ends with its list runs to the section's end", () => {
    const terminal = ["## Modes", "", "- `only` — the whole list."].join("\n");
    expect(bulletOf(terminal, "- `only` — ")).toBe("- `only` — the whole list.");
  });

  it("an absent lead throws rather than cutting an empty span", () => {
    expect(() => bulletOf(LISTED, "- `renamed` — ")).toThrow(/no bullet led by/);
    expect(() => bulletOf(LISTED, "`first` — ")).toThrow(/not a bullet lead/);
  });
});
