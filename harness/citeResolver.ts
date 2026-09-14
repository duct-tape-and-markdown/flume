/**
 * How the package resolves an entry's `per` cite (`spec/harness.md`, *The
 * cite resolver*): the cited path lands inside the consumer's declared
 * `specLocus` and is present in the commit under judgement, and the cited
 * section is found in that file — by heading text, or by whatever key a
 * consumer's declared resolver reads instead.
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
 * binds a disk read; a test binds a map. The resolution is the same either
 * way, and nothing here decides which commit a cite is read at — that is the
 * caller's fact to supply, not this module's to infer
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

/**
 * The package's own resolver: the body of the markdown section whose heading
 * text is exactly `cite.section` — any `#` depth, no trailing decoration — up
 * to the next heading of the same or shallower depth, heading line included.
 * `undefined` when no such heading exists.
 *
 * Exact text, never a nearest match: a heading that drifted is a cite that
 * has to be rewritten, and standing in the closest section for it hands build
 * prose the entry was not derived from.
 */
function headingSection(cite: Cite, text: string): string | undefined {
  const lines = text.split("\n");
  let depth = 0;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const match = /^(#{1,6})\s+(.*?)\s*$/.exec(lines[i]!);
    if (!match) continue;
    if (start === -1) {
      if (match[2] === cite.section) {
        depth = match[1]!.length;
        start = i;
      }
    } else if (match[1]!.length <= depth) {
      return lines.slice(start, i).join("\n").trimEnd();
    }
  }
  return start === -1 ? undefined : lines.slice(start).join("\n").trimEnd();
}

/** A refusal naming what is at fault, in the one shape every caller reads. */
const refuse = (cite: Cite, message: string): CiteVerdict => ({
  ok: false,
  cite,
  message,
});

/**
 * Resolve `cite` against `locus`, reading the cited file through `read`.
 *
 * Three questions in the order a plan tick can act on them: whether the path
 * is somewhere a cite may point at all, whether it is in the commit, and
 * whether the section is in it. A path outside the locus is wrong wherever it
 * is read, so it is answered before any read happens.
 */
export async function resolveCite(
  cite: Cite,
  locus: CiteLocus,
  read: AtRefReader,
): Promise<CiteVerdict> {
  if (!matchesAny(cite.path, [...locus.specLocus])) {
    return refuse(
      cite,
      `${cite.path} is outside the declared spec locus (${locus.specLocus.join(", ")})`,
    );
  }
  const text = await read(cite.path);
  if (text === null) {
    return refuse(cite, `${cite.path} is not in the commit`);
  }
  const section = (locus.resolver ?? headingSection)(cite, text);
  if (section === undefined) {
    return refuse(
      cite,
      locus.resolver === undefined
        ? `no heading "${cite.section}" in ${cite.path}`
        : `the declared resolver keys no section "${cite.section}" in ${cite.path}`,
    );
  }
  return { ok: true, cite, text: section };
}
