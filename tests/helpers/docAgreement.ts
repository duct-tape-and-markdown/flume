/**
 * Doc-to-type readers: the parsers that read a restating surface — a doc's
 * fenced block, a markdown field table, a bullet list, a quoted declaration,
 * a README arrow run — and the engine-side readers each is compared against.
 *
 * Every reader takes the text it reads as an argument rather than closing
 * over a describe-scoped read, so the suite owns which file goes in and this
 * module owns only the grammar (`scanCorpus.ts`, module header).
 */
import { join } from "node:path";

import cascadeFactory from "../../examples/cascade-chain.ts";
import { buildFlumeApi } from "../../src/flumeApi.ts";
import { REPO_ROOT } from "./scanCorpus.ts";

/**
 * Field names declared by `interface <name>` in `text` — the span from its
 * opening brace to the first `}` at column 0, with block and line comments
 * stripped so only declarations are read. Deliberately not `<name>`-aware
 * beyond the word boundary, and deliberately the same reader for every
 * caller: a doc's fenced `ts` block and the engine's own source are the same
 * grammar, so one parser keeps the comparison honest.
 *
 * Both callable spellings count as the same field: a member declared as a
 * property (`run: (ctx) => …`, how `src/Gate.ts` writes it) and the same
 * member written as method shorthand (`run(ctx): …`, how the doc writes it)
 * name one field, and a reader that saw only the first would call the doc's
 * block short by a name it does declare.
 *
 * Only lines at the body's shallowest indentation are members. A member
 * whose type wraps across lines indents its continuation deeper — the
 * `ctx: WorktreeSetupContext,` parameter line of `Phase.setupWorktree` is
 * the live case — and a reader that took every match would report `ctx` as
 * a field the interface declares.
 */
export function interfaceFields(text: string, name: string): string[] {
  const open = new RegExp(`interface\\s+${name}\\s*\\{`).exec(text);
  if (!open) return [];
  const start = open.index + open[0].length;
  const end = text.indexOf("\n}", start);
  const body = text
    .slice(start, end === -1 ? undefined : end)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const matches = [...body.matchAll(/^([ \t]*)(\w+)\??\s*[:(]/gm)];
  if (matches.length === 0) return [];
  const member = Math.min(...matches.map((m) => m[1]!.length));
  return matches.filter((m) => m[1]!.length === member).map((m) => m[2]!);
}

/**
 * Field names a markdown table teaches: under `heading`, the first table
 * whose header row matches `header`, read one row at a time, taking the
 * backticked name in the **first** column only.
 *
 * Second-column prose names sibling fields freely — the `entryChannelPaths`
 * row cites `scopeWritesToEntry`, the `cwd` row cites `flumeDir` — so a
 * reader that took every backticked span in a row would count fields the
 * table never gives a row.
 *
 * Keyed on the heading rather than a line number, so a pin follows its
 * section when the doc moves, and one reader for every field table in the
 * page, so a second table cannot drift into a second grammar.
 */
/**
 * The §1 heading both field tables live under — `Phase`'s and
 * `TickContext`'s. One constant, so a reworded heading fails both pins at
 * once rather than silently emptying one of them.
 */
export const SECTION_1 = /^## 1\. Declaring a Phase$/m;

export function docTableFields(doc: string, heading: RegExp, header: RegExp): string[] {
  const section = doc.split(heading)[1] ?? "";
  const rows = section.split("\n");
  const start = rows.findIndex((l) => header.test(l));
  if (start === -1) return [];
  const fields: string[] = [];
  for (const row of rows.slice(start + 2)) {
    if (!row.startsWith("|")) break;
    const name = /^\|\s*`([^`]+)`\s*\|/.exec(row);
    if (name) fields.push(name[1]!);
  }
  return fields;
}

// ---------- orphaned doc blocks ----------

export const OPENER = /^\/\*\*/;
export const CLOSER = /\*\/$/;
/** Same opener, counted across a whole file for the vacuity pin. */
export const OPENER_ANYWHERE = /^\s*\/\*\*/gm;

/**
 * A doc block that opens a file documents the module, so the block after it
 * is its first symbol's, not evidence of an orphan. Spelled as a carve-out
 * rather than inherited: every other block is judged.
 */
const MODULE_HEADER_LINE = 1;

/**
 * Orphans this fence cannot reach, each with why it survives — the same
 * inventory shape `retiredShapes.ts`'s env-mention list uses. An entry
 * leaves when the
 * block moves onto its symbol; a new orphan fails until it is named here.
 */
export const ALLOWED_ORPHANS: Record<string, string> = {};

export type Orphan = { path: string; open: number; id: string };

/**
 * Every doc block in `text` whose close is followed — across blank lines
 * only — by another doc block's open. Identified by its first content line
 * rather than its line number, so the inventory above survives line drift.
 */
export function orphanedBlocks(path: string, text: string): Orphan[] {
  const lines = text.split("\n").map((l) => l.trim());
  const orphans: Orphan[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!OPENER.test(lines[i]!)) continue;
    const open = i;
    // A single-line block closes on its own opener; otherwise scan forward.
    while (i < lines.length && !CLOSER.test(lines[i]!)) i++;
    let next = i + 1;
    while (next < lines.length && lines[next] === "") next++;
    if (next >= lines.length || !OPENER.test(lines[next]!)) continue;
    if (open + 1 === MODULE_HEADER_LINE) continue;
    const first = lines
      .slice(open + 1, i + 1)
      .map((l) => l.replace(/^\*\s?/, "").replace(CLOSER, "").trim())
      .find((l) => l !== "");
    orphans.push({ path, open: open + 1, id: `${path}: ${first ?? ""}` });
  }
  return orphans;
}

// ---------- the chain-authoring doc's restating surfaces ----------

/**
 * The option names the doc's built-ins list teaches, off the one line that
 * writes the signature as destructuring — not the call sites further down,
 * which legitimately pass a subset.
 */
export function docPendingGateOptions(doc: string): string[] {
  const m = /^- `pendingGate\(\{([^}]*)\}\)`/m.exec(doc);
  if (!m) return [];
  return m[1]!
    .split(",")
    .map((s) => s.trim().replace(/\?$/, ""))
    .filter((s) => s !== "");
}
/** The §1 field table headed `Role` — the one that tabulates `Phase`. */
export const docPhaseFields = (doc: string): string[] =>
  docTableFields(doc, SECTION_1, /^\| Field\s*\| Role/);
/**
 * The interface names `export type PriorAttempt` unions together, in
 * declaration order. Read off the union rather than a list kept here: a
 * seventh variant must arrive as a test failure, not as a doc gap nobody
 * is watching.
 */
export function variantNames(promptSrc: string): string[] {
  const union = /export type PriorAttempt =([\s\S]*?);/.exec(promptSrc)?.[1];
  if (!union) return [];
  return [...union.matchAll(/\|\s*(\w+)/g)].map((m) => m[1]!);
}

/**
 * The `mode` discriminant each variant declares, read out of that
 * interface's own body — sliced brace-to-`\n}` the same way
 * `interfaceFields` slices one, so a later interface's discriminant can
 * never stand in for a variant that dropped its own.
 */
export function declaredModes(promptSrc: string): string[] {
  const modes: string[] = [];
  for (const name of variantNames(promptSrc)) {
    const open = new RegExp(`interface\\s+${name}\\s*\\{`).exec(promptSrc);
    if (!open) continue;
    const start = open.index + open[0].length;
    const end = promptSrc.indexOf("\n}", start);
    const body = promptSrc.slice(start, end === -1 ? undefined : end);
    const mode = /^\s*mode:\s*"([a-z-]+)"/m.exec(body);
    if (mode) modes.push(mode[1]!);
  }
  return modes;
}

/** The `<prior-attempt>` section: its heading through the next `## `. */
export function priorAttemptSection(doc: string): string {
  return (
    /^### The `<prior-attempt>` block$([\s\S]*?)^## /m.exec(doc)?.[1] ?? ""
  );
}

/**
 * The modes the section's bullet list teaches: one per bullet that opens
 * with a backticked kebab-case token. Prose and the bolded paragraphs name
 * `headSha`, `suspectFlake` and the gate phases freely — none of those
 * opens a bullet in that spelling, so the reader counts variants only.
 */
export function docModes(doc: string): string[] {
  return [...priorAttemptSection(doc).matchAll(/^- `([a-z][a-z-]*)` — /gm)].map((m) => m[1]!);
}
/**
 * The doc block immediately above `cwd: string;` inside `TickContext`:
 * the nearest one, matched so that no block terminator may fall between
 * it and the field, so a preceding member's comment cannot stand in.
 */
export function cwdDoc(phaseSrc: string): string {
  const body =
    /export interface TickContext \{([\s\S]*?)\n\}/.exec(phaseSrc)?.[1] ?? "";
  return (
    /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*cwd: string;/.exec(body)?.[1] ?? ""
  );
}

/**
 * The `cwd` the dispatcher's **singleton** consult passes. It builds its
 * context inline (`phase.shouldRun({ cwd: …, ...ctxFacts })`) where the
 * fanout consult passes an already-named `ctx`, so the object-literal form
 * identifies the singleton site on its own. Returns every match, so a
 * second inline consult appearing later cannot hide behind the first.
 */
export function singletonConsultRoots(dispatcherSrc: string): string[] {
  return [...dispatcherSrc.matchAll(/phase\.shouldRun\(\{\s*cwd:\s*(\w+)/g)].map(
    (m) => m[1]!,
  );
}

/**
 * The bullet list under the `shouldRun` section heading, one entry each,
 * with the markdown wrapping collapsed — a phrase this pin looks for may
 * straddle a line break, and where the author happened to wrap is not
 * what is being held.
 */
export function declineBullets(doc: string): string[] {
  const section =
    /^### `shouldRun`: decline a tick before the invocation$([\s\S]*?)^## /m.exec(
      doc,
    )?.[1] ?? "";
  return section
    .split(/\n(?=- )/)
    .filter((b) => b.startsWith("- "))
    .map((b) => b.replace(/\s+/g, " ").trim());
}
/**
 * The §1 field table headed `What it carries` — the one that tabulates
 * `TickContext`, distinguished from `Phase`'s by its second-column
 * heading alone, so both live under one section without either reader
 * reaching the other's rows.
 */
export const docTickContextFields = (text: string): string[] =>
  docTableFields(text, SECTION_1, /^\| Field\s*\| What it carries/);

/**
 * The bullet-free prose of the `shouldRun` section — the span from its
 * heading to the next `##`, wrapping collapsed. This is where the decline
 * story names the facts its worked predicate reads.
 */
export function declineSection(doc: string): string {
  return (
    /^### `shouldRun`: decline a tick before the invocation$([\s\S]*?)^## /m
      .exec(doc)?.[1] ?? ""
  ).replace(/\s+/g, " ");
}

/**
 * The `shouldRun` body `examples/cascade-chain.ts` ships on its plan phase
 * — the declaration §1 quotes whole, held against that quote byte-for-byte
 * by `quotedDeclaration`'s pin. Read off the example rather than off the
 * quote, so the fields the pin demands come from the real writer.
 */
export function predicateReads(exampleSrc: string): string[] {
  const body =
    / {4}shouldRun\(ctx\) \{([\s\S]*?)\n {4}\},/.exec(exampleSrc)?.[1] ?? "";
  return [...new Set([...body.matchAll(/ctx\.(\w+)/g)].map((m) => m[1]!))];
}
/**
 * The fenced `ts` block the doc introduces as a declaration from the
 * example chain, and the identifier it names as the thing being quoted.
 * Keyed on the sentence that makes the claim rather than a line number, so
 * the pin follows the prose when the section moves — and fails loudly if
 * the claim itself is reworded, which is the point at which a human should
 * re-decide what the block is quoting. The identifier is read out of the
 * claim rather than baked in here, so the page decides what it is quoting
 * and this only holds it to it.
 */
export const DOC_QUOTE =
  /The `([A-Za-z_$][\w$]*)` declaration from `examples\/cascade-chain\.ts`[\s\S]*?```ts\n([\s\S]*?)```/;

/**
 * The `const <id> … ;` declaration as a chain module writes it: the
 * declaration line through the first line closing it at the same
 * indentation, so the span survives the example's factory nesting.
 */
export function declarationSource(text: string, id: string): string {
  if (id === "") return "";
  const lines = text.split("\n");
  const opens = new RegExp(`^\\s*const ${id}\\b.*[({[]$`);
  const start = lines.findIndex((l) => opens.test(l));
  if (start === -1) return "";
  const indent = /^\s*/.exec(lines[start]!)![0];
  const closes = new Set([`${indent}};`, `${indent}});`, `${indent}];`]);
  const end = lines.findIndex((l, i) => i > start && closes.has(l));
  if (end === -1) return "";
  return lines.slice(start, end + 1).join("\n");
}

/** The declaration the doc's claim points at, read off the example. */
export function quotedDeclaration(
  doc: string,
  exampleSrc: string,
): { id: string; quoted: string; example: string } {
  const m = DOC_QUOTE.exec(doc);
  const id = m?.[1] ?? "";
  return {
    id,
    quoted: m?.[2] ?? "",
    example: declarationSource(exampleSrc, id),
  };
}

/**
 * Formatting-insensitive form of a TypeScript span: trailing line comments
 * dropped, every line trimmed, whitespace around structural punctuation
 * removed, and trailing commas before a closer dropped. What survives is
 * the declaration — the doc's dedent, the example's factory indentation,
 * and prettier's choice of where to wrap all normalize away, so only a
 * difference in what is declared can fail the comparison.
 *
 * The comment strip is the spaced `// …` form deliberately: a path literal
 * (`"specs/_aligned/**"`) carries no space before its slashes, so it is not
 * mistaken for a comment.
 */
export function normalizeTs(span: string): string {
  return span
    .split("\n")
    .map((line) => line.replace(/\s+\/\/.*$/, "").trim())
    .filter((line) => line !== "")
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/\s*([{}[\](),;])\s*/g, "$1")
    .replace(/,([}\])])/g, "$1");
}
/**
 * The phase names cascade ships, in chain order — off the chain its factory
 * returns, not re-parsed from its source. A source reader would have to
 * re-implement whatever shape the module builds its phase list with (a
 * literal, a `map` over a slice ladder, a spread), and would read `[]` —
 * agreeing with anything — the first time that shape changed. The module
 * is the writer; this asks it (engineering.md, *A seam gate reads what the
 * real writer wrote*).
 */
export function declaredPhaseNames(): string[] {
  const { chain } = cascadeFactory(
    buildFlumeApi({
      repoRoot: REPO_ROOT,
      configDir: join(REPO_ROOT, "examples"),
      flumeDir: join(REPO_ROOT, ".flume"),
    }),
  );
  return chain.phases.map((p) => p.name);
}

/**
 * The prose units of `readme` that mention `cascade-chain.ts`: paragraphs
 * split on blank lines, then again at list-item boundaries, so the Pointers
 * bullet is judged as itself rather than as its whole list.
 */
export function cascadeMentions(readme: string): string[] {
  return readme
    .split(/\n\s*\n/)
    .flatMap((para) => para.split(/\n(?=- )/))
    .filter((unit) => unit.includes("cascade-chain.ts"));
}

/** Every arrow-joined run of phase-shaped words in a prose unit. */
export function arrowRuns(unit: string): string[][] {
  const runs = unit.match(/[a-z][a-z-]*(?:\s*→\s*[a-z][a-z-]*)+/g) ?? [];
  return runs.map((run) => run.split("→").map((word) => word.trim()));
}
