/**
 * The markdown section cutter — one home for the read every doc pin in this
 * suite makes: a heading line through the line before the next heading that
 * closes it (`.claude/rules/engineering.md`, *A module is one job*). Eight
 * copies across five test files preceded it, each new pin copying whichever
 * was nearest, and they disagreed on both rules below — what closes a
 * section, and whether a fenced `# ` line is a heading at all.
 *
 * Not *.test.ts, so neither vitest lane collects it as a suite of its own.
 */

/** A heading line, capturing the level it opens. */
const HEADING = /^(#{1,6}) /;

/** A line that opens or closes a fenced block. */
const FENCE = /^\s*(?:```|~~~)/;

/**
 * One section of a markdown page: the heading line `heading` names through
 * the line before the next heading at the same or a higher level — its own
 * deeper subsections included, since a claim demoted into one is still
 * inside the section a reader is in.
 *
 * Fenced blocks are not read for headings. A page that quotes shell (`# tune:
 * edit ...`, a commented sample) carries lines that look like a level-1
 * heading and close nothing, and a cut that honoured them would end a section
 * at its own first example.
 *
 * A heading no line matches yields the empty string rather than throwing:
 * the cut is a pure read, and each call site anchors the span it got — an
 * empty span reds on that anchor, where the message a reader needs already
 * is.
 */
export function sectionOf(page: string, heading: string | RegExp): string {
  const lines = page.split(/\r?\n/);
  const matches = headingMatcher(heading);
  let start = -1;
  let depth = 0;
  let end = lines.length;
  let fenced = false;

  for (const [i, line] of lines.entries()) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const level = HEADING.exec(line)?.[1]?.length;
    if (level === undefined) continue;
    if (start === -1) {
      if (matches(line.trimEnd())) {
        start = i;
        depth = level;
      }
      continue;
    }
    if (level <= depth) {
      end = i;
      break;
    }
  }

  return start === -1 ? "" : lines.slice(start, end).join("\n");
}

/**
 * A string heading is the heading line exactly; a pattern is matched against
 * one line at a time, so the global and sticky flags are dropped — a match
 * position carried between calls would make one pattern match or miss by
 * call order.
 */
function headingMatcher(heading: string | RegExp): (line: string) => boolean {
  if (typeof heading === "string") return (line) => line === heading;
  const pattern = new RegExp(heading.source, heading.flags.replace(/[gy]/g, ""));
  return (line) => pattern.test(line);
}

/**
 * A backticked bare name — how a page names one member of a set. A spelling
 * that carries anything else (`ctx.flumeDir`, `vitestRunner()`) is the page
 * talking about something the member is reached through, not a naming of it.
 */
const MENTION = /`([A-Za-z][A-Za-z0-9]*)`/g;

/** A bullet opening, through whatever emphasis the page leads its name with. */
const BULLET_LEAD = /(?:^|\n)[-*] (?:\*\*)?$/;

/**
 * One block of a section — a heading, a paragraph, a fenced sample, or a run
 * of bullets with no blank line through it — read for the members it names.
 */
interface SetNaming {
  /** The members leading one of the block's bullets, in page order. */
  readonly leads: readonly string[];
  /** Every member the block names, lead or not, in page order. */
  readonly mentions: readonly string[];
}

/**
 * Every block of a section, in page order, read for one set's members. A
 * name outside `members` is some other set's business and is dropped, so the
 * declaration the caller resolved is what decides which tokens are namings.
 */
function setNamingsOf(section: string, members: readonly string[]): SetNaming[] {
  return section.split(/\n[ \t]*\n/).map((block) => {
    const leads: string[] = [];
    const mentions: string[] = [];
    for (const mention of block.matchAll(MENTION)) {
      const name = mention[1]!;
      if (!members.includes(name)) continue;
      mentions.push(name);
      if (BULLET_LEAD.test(block.slice(0, mention.index))) leads.push(name);
    }
    return { leads, mentions };
  });
}

/**
 * The members a section walks: every one leading a bullet of its own, in page
 * order. A caller compares this against the declaration it resolved, so a
 * member the interface gained and the page skipped, or a bullet the interface
 * no longer declares, reds on one equality.
 *
 * One home for a read three walks over `docs/CHAIN-AUTHORING.md` spelled three
 * ways (`.claude/rules/engineering.md`, *A module is one job*), which is why
 * the bullet lead is matched through the page's emphasis rather than against
 * one section's house style: a walk that bolds its names and one that does not
 * make the same claim.
 */
export function walkOf(section: string, members: readonly string[]): string[] {
  return setNamingsOf(section, members).flatMap((block) => [...block.leads]);
}

/**
 * Every place the section names the set a second time: the members named by a
 * block the walk does not reach, one entry per such block, for the caller to
 * assert empty.
 *
 * The walk is the section's one home for the set, and a listing beside it is
 * the copy that strands when the interface gains a member (*Derived state is
 * computed, never restated beside its source*) — invisible to `walkOf`, which
 * sees bullet leads alone. Two members is the bar: a block naming one is prose
 * referring to a member, which is what running text is for, while a block
 * naming two is the section listing the set. Cross-reference *inside* the walk
 * is left alone — a bullet's body explaining itself against a sibling is the
 * walk doing its job.
 */
export function restatementsOf(
  section: string,
  members: readonly string[],
): string[][] {
  return setNamingsOf(section, members)
    .filter((block) => block.leads.length === 0)
    .map((block) => [...new Set(block.mentions)])
    .filter((named) => named.length > 1);
}
