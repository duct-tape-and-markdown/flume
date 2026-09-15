/**
 * How the package resolves an entry's `per` cite (`spec/harness.md`, *The
 * cite resolver*): the cited path lands inside the consumer's declared
 * `specLocus` and is present in the commit under judgement, and the cited
 * section is found in that file, exactly once — by heading text, or by
 * whatever key a consumer's declared resolver reads instead.
 *
 * **One resolution, two readers.** The `per` gate refuses a queue whose cite
 * does not resolve, and the build prompt renders the cited section as data.
 * Both go through here, so what plan is held to is exactly what build is
 * handed; a second grammar beside this one is a cite the gate passes and the
 * prompt cannot render (`.claude/rules/engineering.md`, *A seam gate reads
 * what the real writer wrote*).
 *
 * **The reader is injected, never imported.** A gate binds the engine's
 * at-ref reader to the commit it is judging; a tick reading its own tree
 * binds a disk read; a test binds a map. Whether that reader answers now or
 * later is all that separates the two entry points below; the resolution is
 * the same either way, and nothing here decides which commit a cite is read
 * at — that is the caller's fact to supply, not this module's to infer
 * (`.claude/rules/engine-boundary.md`, *Told, not inferred*).
 *
 * **Memoizing is the caller's.** A queue cites a handful of files many times
 * over, and one read per distinct path is a reader the caller wraps once —
 * not a cache this module would have to invalidate against a moving ref.
 *
 * A cite that does not resolve comes back as a verdict rather than a throw:
 * the caller is a gate reporting every unresolved cite in one message, and
 * dying on the first would hand a queue back one fix at a time. A caller that
 * cannot proceed over the verdict refuses at its own site
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * This module is the resolution alone. Which cites are read, at which commit,
 * and what a failed one does to a tick belong to the gate that drives it.
 */

import type { z } from "zod";

import { matchesAny } from "../src/paths.js";

import { PerSchema } from "./entryExtension.js";

/**
 * A cite, as the entry extension declares it — `{ path, section }`. Inferred
 * from that schema rather than restated beside it, so the shape a plan tick
 * is validated against is the shape this resolves
 * (`.claude/rules/engineering.md`, *Derived state is computed, never restated
 * beside its source*).
 */
export type Cite = z.infer<typeof PerSchema>;

/**
 * Reads a path's bytes as of the commit under judgement — `null` when the
 * path is absent from it.
 *
 * The engine's `readFileAtRef` is this, bound to a repo root and a sha: an
 * absent path is `null` and an unresolvable ref throws, so the two are never
 * confused, and a throw travels out through {@link resolveCite} rather than
 * becoming an unresolved-cite verdict that blames the cite.
 */
export type AtRefReader = (path: string) => Promise<string | null> | string | null;

/**
 * A consumer's own way of finding a section in a cited file — the second
 * declared value with behavior, beside the runner.
 *
 * A consumer whose spec is typed (a temper `contract-spec` kind, for example)
 * keys a section rather than matching heading text, and returns the section's
 * text; `undefined` means the file holds no such section. The whole cite is
 * passed, not the section alone, because which key a path is read by is the
 * resolver's business and the path is how it tells.
 */
export type SectionResolver = (cite: Cite, text: string) => string | undefined;

/**
 * What a cite is resolved against: the declared locus, and the declared
 * resolver when the consumer has one. A parsed declaration satisfies this
 * structurally, so the gate hands the declaration straight in rather than
 * picking two fields out of it.
 */
export interface CiteLocus {
  /** Where a cite may point, as path globs in the engine's glob dialect. */
  readonly specLocus: readonly string[];
  /** The consumer's section resolver; absent means heading text. */
  readonly resolver?: SectionResolver | undefined;
}

/**
 * One verdict shape, whether the section was found by heading or by a
 * declared resolver — a gate reads `ok` and a prompt reads `text`, and
 * neither learns which resolver ran.
 *
 * The refusal's `message` names the path when the path is at fault and the
 * section when the section is, because that is the part the plan tick that
 * wrote the cite has to change.
 */
export type CiteVerdict =
  | {
      readonly ok: true;
      readonly cite: Cite;
      /** The cited section's text, its heading line included. */
      readonly text: string;
    }
  | {
      readonly ok: false;
      readonly cite: Cite;
      /** Why it did not resolve, naming the part at fault. */
      readonly message: string;
    };

/** A fenced code block's delimiter: three or more backticks or tildes, indented no further than a paragraph would be, and whatever follows the run on that line. */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * A markdown ATX heading: its `#` run and its text, trailing whitespace off,
 * indented no further than a paragraph would be — the same up-to-three the
 * fence above allows, because CommonMark grants both the same leeway and a
 * fourth space turns either into an indented code block.
 */
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*$/;

/**
 * The fence state one line on: the open fence's run while the scan is inside a
 * fenced code block, `undefined` while it is not.
 *
 * A block closes on a run of the same character at least as long as the one
 * that opened it and carrying no info string; every other line inside is
 * content, `#`-prefixed ones included. A backtick fence whose info string
 * carries a backtick opens nothing (CommonMark), which is how a line that is
 * only an inline code span stays out of the state machine.
 */
function fenceAfter(open: string | undefined, line: string): string | undefined {
  const match = FENCE.exec(line);
  if (!match) return open;
  const run = match[1]!;
  const info = match[2]!;
  if (open === undefined) {
    return run.startsWith("`") && info.includes("`") ? undefined : run;
  }
  const closes =
    run[0] === open[0] && run.length >= open.length && info.trim() === "";
  return closes ? undefined : open;
}

/**
 * A real heading the page carries: where it is, how deep it is, and the text
 * a cite is matched against.
 */
interface Heading {
  /** Its line's index, zero-based, as the page splits. */
  readonly line: number;
  /** Its `#` run's length. */
  readonly depth: number;
  /** Its heading text, exactly as the cite must name it. */
  readonly text: string;
}

/**
 * Every real heading in the page, in order.
 *
 * **Only a real heading counts.** A `#`-prefixed line inside a fenced code
 * block — a shell comment, a diff hunk, a markdown sample — is text the page
 * is showing, not structure it has. Reading one as a heading truncates the
 * cited section at it, resolves the sample itself as a section of its own,
 * and makes a page that heads its cite once look like a page that heads it
 * twice, all silently. The scan carries fence state for that reason and
 * nothing else — the grammar above is unchanged outside a fence.
 */
function headings(lines: readonly string[]): Heading[] {
  const found: Heading[] = [];
  let fence: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const next = fenceAfter(fence, line);
    // A line that opens, closes, or sits inside a block is never structure.
    const fenced = fence !== undefined || next !== undefined;
    fence = next;
    if (fenced) continue;
    const match = HEADING.exec(line);
    if (!match) continue;
    found.push({ line: i, depth: match[1]!.length, text: match[2]! });
  }
  return found;
}

/**
 * The package's own resolver: every section whose heading text is exactly
 * `cite.section` — any `#` depth, any CommonMark-legal indent, no trailing
 * decoration — each running to the next heading of the same or shallower
 * depth, heading line included.
 *
 * Exact text, never a nearest match: a heading that drifted is a cite that
 * has to be rewritten, and standing in the closest section for it hands build
 * prose the entry was not derived from.
 *
 * **Every match, not the first.** A page may head one text twice — two
 * siblings, or one nested inside another section — and a cite naming that
 * text names no one of them. Returning them all is what lets {@link
 * sectionIn} refuse rather than resolve whichever came first
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
function headingSections(
  cite: Cite,
  lines: readonly string[],
): { readonly line: number; readonly text: string }[] {
  const all = headings(lines);
  return all.flatMap((heading, i) => {
    if (heading.text !== cite.section) return [];
    const bound = all.slice(i + 1).find((next) => next.depth <= heading.depth);
    const end = bound?.line ?? lines.length;
    return [
      {
        line: heading.line,
        text: lines.slice(heading.line, end).join("\n").trimEnd(),
      },
    ];
  });
}

/** A refusal naming what is at fault, in the one shape every caller reads. */
const refuse = (cite: Cite, message: string): CiteVerdict => ({
  ok: false,
  cite,
  message,
});

/**
 * Whether `cite.path` is somewhere a cite may point at all: the refusal when
 * it is not, `undefined` when it is.
 *
 * Asked before any read, by both entry points below — a path outside the
 * locus is wrong at every commit and in every tree, so no reader is driven to
 * learn it.
 */
function outsideLocus(cite: Cite, locus: CiteLocus): CiteVerdict | undefined {
  if (matchesAny(cite.path, [...locus.specLocus])) return undefined;
  return refuse(
    cite,
    `${cite.path} is outside the declared spec locus (${locus.specLocus.join(", ")})`,
  );
}

/**
 * The cited section in the bytes a reader answered with — `null` being the
 * path the reader did not find — or the refusal naming the part at fault.
 *
 * The grammar lives here and nowhere else: both entry points below differ in
 * the read hop alone, so a cite the gate resolved is a cite the prompt
 * renders identically (`.claude/rules/engineering.md`, *The fix lands at the
 * mechanism*).
 *
 * **A cite that names two sections names none.** The heading path refuses a
 * section text the page heads more than once rather than handing back
 * whichever came first: the first is a section the entry may never have been
 * derived against, and the second is uncitable while it stands. The refusal
 * names both lines, because the fix is the page's heading or the cite's text
 * and the plan tick needs to see which (*Loud or nothing*).
 *
 * A declared resolver keys its own sections, so what a repeated key means
 * there is the consumer's to decide — it answers with one section or with
 * `undefined`, and this reads the answer it was given rather than auditing
 * how it was reached (`.claude/rules/engine-boundary.md`, *Told, not
 * inferred*).
 */
function sectionIn(
  cite: Cite,
  locus: CiteLocus,
  text: string | null,
): CiteVerdict {
  if (text === null) {
    return refuse(cite, `${cite.path} is not in the commit`);
  }
  if (locus.resolver !== undefined) {
    const keyed = locus.resolver(cite, text);
    return keyed === undefined
      ? refuse(
          cite,
          `the declared resolver keys no section "${cite.section}" in ${cite.path}`,
        )
      : { ok: true, cite, text: keyed };
  }
  const sections = headingSections(cite, text.split("\n"));
  const only = sections[0];
  if (only === undefined) {
    return refuse(cite, `no heading "${cite.section}" in ${cite.path}`);
  }
  if (sections.length > 1) {
    const lines = sections.map((section) => section.line + 1).join(", ");
    return refuse(
      cite,
      `${sections.length} headings "${cite.section}" in ${cite.path} ` +
        `(lines ${lines}) — the cite names no one section`,
    );
  }
  return { ok: true, cite, text: only.text };
}

/**
 * Resolve `cite` against `locus`, reading the cited file through `read`.
 *
 * Three questions in the order a plan tick can act on them: whether the path
 * is somewhere a cite may point at all, whether it is in the commit, and
 * whether the section is in it.
 */
export async function resolveCite(
  cite: Cite,
  locus: CiteLocus,
  read: AtRefReader,
): Promise<CiteVerdict> {
  return (
    outsideLocus(cite, locus) ?? sectionIn(cite, locus, await read(cite.path))
  );
}

/**
 * The same resolution over a reader that answers from bytes already at hand —
 * what a tick reading its own working tree binds.
 *
 * It exists for the reader's shape, not for a second grammar: a phase's
 * `promptArgs` is a synchronous surface, so a caller there has no way to
 * unwrap {@link resolveCite}'s promise, and the alternative to this
 * three-line entry point is a second section reader beside the one the gate
 * drives — which is precisely the drift this module exists to prevent.
 */
export function resolveCiteSync(
  cite: Cite,
  locus: CiteLocus,
  read: (path: string) => string | null,
): CiteVerdict {
  return outsideLocus(cite, locus) ?? sectionIn(cite, locus, read(cite.path));
}
