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

import { sectionOf } from "./helpers/docSections.ts";

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
