import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RUNTIME_IGNORES } from "../src/job.ts";
import { worktreesBase } from "../src/paths.ts";

// Narration pin (RETIRED-ROOTS-AND-MODEL-NARRATION, per
// .claude/rules/engineering.md "Narration is the ladder's bottom rung"):
// `FlumeApi.paths` and `ClaudeCodeOptions.model` replaced two shapes the
// engine used to make every chain author assemble by hand — a
// `process.env.FLUME_DIR ?? CHAIN_DIR` fallback for artifact placement, and
// `--model` pushed into `extraArgs`. Both replacements are typed, so the only
// place the retired shapes can still be taught is prose, where nothing
// mechanical was watching. This is that watch: the retirement promoted off
// the page onto a rung that fails.
//
// Scope is what a chain author reads to learn the shapes — published prose,
// the engine's own doc comments, and the chains that teach by being read as
// worked examples: the dogfood chain and `examples/`. Excluded, each for a
// reason that is about the file's job rather than convenience:
//   - `tests/` — a test legitimately drives the retired argv through
//     `extraArgs` to pin that the passthrough still works
//     (tests/Agent.test.ts).
//   - `docs/MIGRATING-*.md` — a migration guide's job is to show the shape
//     you are leaving alongside the one you are moving to.
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The dogfood chain — the surface both retired shapes lived on longest. */
const CHAIN_PATH = join(".flume", "chain.ts");

/**
 * The reference chains. `engine-boundary.md` ("Opinion ships by name, opted
 * into") makes `examples/` where this repo's recommended shapes live, so a
 * chain author reads them as the worked answer — the same job the dogfood
 * chain does, on a surface a consumer copies wholesale.
 */
function exampleChainPaths(): string[] {
  return readdirSync(join(REPO_ROOT, "examples"))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join("examples", name))
    .sort();
}

/**
 * The queue path a gate composes for itself: a `ctx.*` root followed on the
 * same line by the literal segments, in either spelling — `join(ctx.flumeDir,
 * "plan", "pending.json")` or a `${ctx.cwd}/.flume/plan/pending.json`
 * template. Keyed on `ctx.` because the retired shape is specifically a
 * *gate* rebuilding the path: prose naming `<flumeDir>/plan/pending.json` as
 * the default, a prompt writing `{{FLUME_DIR}}/plan/pending.json`, and
 * `DEFAULT_PENDING_REL`'s own definition are all the fact itself, not a copy
 * of it. `ctx.pendingPath` is excluded as the root for the same reason: it
 * *is* the answer, so a line that names it beside the default layout is
 * documenting the resolved value rather than re-deriving one.
 */
const RECOMPOSED_QUEUE_PATH =
  /ctx\.(?!pendingPath\b)\w+[^\n]{0,40}?(?:plan\/pending\.json|["']plan["']\s*,\s*["']pending\.json["'])/;

/**
 * The retired single-file findings queue. `.flume/PROTOCOL.md` ("Records:
 * one file each") replaced it with a directory whose entries are one file
 * per finding, so parallel ticks never collide on one file's text. The
 * needle is the `.md` suffix alone: `inbox/` — the shape that replaced it —
 * is the subject every surviving mention should be about.
 */
const RETIRED_INBOX_FILE = /inbox\.md/;

const RETIRED = [
  {
    behavior:
      "teaches api.paths.flumeDir, never a `?? …` fallback beside " +
      "`process.env.FLUME_DIR`",
    // The fallback leg specifically, not every mention of the env var: the
    // canonicalization write-back is real, and documented as the
    // child-process channel.
    what: "a `?? …` fallback beside `process.env.FLUME_DIR`",
    pattern: /process\.env\.FLUME_DIR\s*\?\?/,
    instead: "api.paths.flumeDir",
    unfixed: {} as Record<string, string>,
  },
  {
    behavior:
      "teaches ClaudeCodeOptions.model, never `--model` assembled into " +
      "`extraArgs`",
    what: "`--model` assembled into `extraArgs`",
    pattern: /extraArgs\s*:\s*\[\s*['"]--model['"]/,
    instead: "ClaudeCodeOptions.model",
    unfixed: {} as Record<string, string>,
  },
  {
    // Pin (CHAIN-AUTHORING-GATE-SURFACE, same section): `GateContext`
    // carries `pendingPath` — the resolved `Chain.pendingPath`, absolute,
    // one value per tick. A gate that joins the path together instead is
    // holding a copy of a fact the engine already resolved, and reads the
    // wrong file the moment a chain relocates the queue.
    behavior:
      "the retired queue-path shape has no surviving unfixed site — a gate " +
      "reads `GateContext.pendingPath`",
    what: "a gate reading a hardcoded plan/pending.json",
    pattern: RECOMPOSED_QUEUE_PATH,
    instead: "GateContext.pendingPath",
    unfixed: {} as Record<string, string>,
  },
  {
    // Pin (RETIRED-NARRATION-INBOX-AND-QUEUE-PATH, same section): the
    // findings queue is a directory of one-file records, not a single
    // `inbox.md` every writer appends to. The old name survived in two
    // state-layout listings after the directory landed, where it still read
    // as the current shape.
    behavior:
      "no scanned surface names the retired single-file .flume/inbox.md queue",
    what: "the single-file `.flume/inbox.md` queue",
    pattern: RETIRED_INBOX_FILE,
    instead: "the `.flume/inbox/` directory of one-file records",
    unfixed: {} as Record<string, string>,
  },
] as const;

/** Every file whose prose teaches a chain author how to write a chain. */
function scannedPaths(): string[] {
  const docs = readdirSync(join(REPO_ROOT, "docs"))
    .filter((name) => name.endsWith(".md") && !name.startsWith("MIGRATING-"))
    .map((name) => join("docs", name));
  const src = readdirSync(join(REPO_ROOT, "src"))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join("src", name));
  return [...docs, ...src, ...exampleChainPaths(), "README.md", CHAIN_PATH];
}

describe("retired chain-authoring shapes stay retired", () => {
  const corpus = scannedPaths().map((path) => ({
    path,
    text: readFileSync(join(REPO_ROOT, path), "utf8"),
  }));

  // Vacuity pins (engineering.md, "A green verdict is proven non-vacuous"):
  // a mis-built file list would scan nothing, or scan files that discuss
  // neither subject, and every refusal below would pass over an empty set.
  // The chain pin is named separately: it contributes neither needle below,
  // so nothing else here would notice it dropping out of the file list.
  it("scans a populated corpus that discusses every subject", () => {
    expect(corpus.length).toBeGreaterThan(0);
    expect(corpus.map((f) => f.path)).toContain(CHAIN_PATH);
    for (const needle of [
      "process.env.FLUME_DIR",
      "--model",
      "pending.json",
      "inbox",
    ]) {
      expect(
        corpus.filter((f) => f.text.includes(needle)).map((f) => f.path),
        `no scanned file mentions ${needle} — the corpus is off target`,
      ).not.toEqual([]);
    }
  });

  for (const { behavior, what, pattern, instead, unfixed } of RETIRED) {
    it(behavior, () => {
      expect(
        corpus
          .filter((f) => pattern.test(f.text))
          .map((f) => f.path)
          .sort(),
        `${what} is retired: use ${instead} instead — or, for a site this ` +
          "entry's fence could not reach, name it in the shape's `unfixed` " +
          "inventory with why it survives",
      ).toEqual(Object.keys(unfixed).sort());
    });
  }

  // Sensitivity pin (engineering.md, "A green verdict is proven
  // non-vacuous"): the queue-path needle reports its inventory whether it is
  // watching or dead. Drive both directions — each spelling as an author
  // would write it, and the prose that tells a gate *not* to, which must stay
  // unflagged while still being a sentence about `ctx.flumeDir` and the
  // queue.
  it("the queue-path needle flags a re-composed path and not the prose denying it", () => {
    for (const taught of [
      'const p = join(ctx.flumeDir, "plan", "pending.json");',
      "const raw = await readFile(`${ctx.cwd}/.flume/plan/pending.json`, 'utf8');",
      "A gate that reads pending validates ctx.flumeDir + '/plan/pending.json'.",
    ]) {
      expect(
        RECOMPOSED_QUEUE_PATH.test(taught),
        `needle missed: ${taught}`,
      ).toBe(true);
    }
    for (const denied of [
      "A gate that reads pending reads `ctx.pendingPath` directly; " +
        "re-composing that path out of `ctx.flumeDir` and literal segments " +
        "hardcodes a layout the chain can move.",
      "`ctx.pendingPath` — absolute, default `<flumeDir>/plan/pending.json`.",
    ]) {
      expect(
        RECOMPOSED_QUEUE_PATH.test(denied),
        `needle over-fires on: ${denied}`,
      ).toBe(false);
    }
  });

  // Sensitivity pin (engineering.md, "A green verdict is proven
  // non-vacuous"): the inbox refusal passes over an empty set by design now
  // that every site is fixed, so nothing else here would notice the needle
  // going dead. Drive both directions — the retired spelling as the two
  // state-layout listings wrote it, and the directory that replaced it,
  // which must stay unflagged while still being prose about the inbox.
  it("the inbox needle flags the retired single file and not the directory that replaced it", () => {
    for (const taught of [
      "- `.flume/inbox.md` — transient findings queue drained by plan.",
      "`awake/`, `worktrees/`, `sessions/`, and `inbox.md` are harness-managed",
    ]) {
      expect(RETIRED_INBOX_FILE.test(taught), `needle missed: ${taught}`).toBe(
        true,
      );
    }
    for (const current of [
      "- `.flume/inbox/` — transient findings queue, one file per finding.",
      "a finding under `inbox/`, a build note under `plan/notes/`, both " +
        "relative to the state root.",
    ]) {
      expect(
        RETIRED_INBOX_FILE.test(current),
        `needle over-fires on: ${current}`,
      ).toBe(false);
    }
  });

  // The `?? …` pattern above catches the fallback leg only. The rest of the
  // retirement — prose pointing a chain at the env var for artifact placement
  // with no fallback beside it — reads in the same verbs as the two sentences
  // that legitimately survive ("reads no `process.env.FLUME_DIR`", "is still
  // set"), so no regex separates violation from denial. Inventory instead:
  // every remaining mention is named, and a new one fails until it is.
  const ALLOWED_ENV_MENTIONS: Record<string, string> = {
    [join("src", "flumeApi.ts")]:
      "FlumePaths' doc denies the env as a chain read path",
    [join("docs", "CHAIN-AUTHORING.md")]:
      "names the env as the child-process channel, not a read path",
  };

  it("names every surviving `process.env.FLUME_DIR` mention", () => {
    const mentions = corpus
      .filter((f) => f.text.includes("process.env.FLUME_DIR"))
      .map((f) => f.path);
    expect(
      mentions.slice().sort(),
      "a chain-authoring file mentions `process.env.FLUME_DIR`: point it at " +
        "`api.paths.flumeDir`, or add it here with the reason it survives",
    ).toEqual(Object.keys(ALLOWED_ENV_MENTIONS).sort());
  });

  // Pin (PRE-0.10-CHAIN-SHAPE-TAUGHT, same section): §6 replaced the chain
  // module shape — a default-exported `Chain` object, with `agent` as a named
  // module export — with a default-exported factory whose return carries
  // both. The loader refuses the old shape outright, so the only place it can
  // still be taught is prose: a doc comment, a host-repo walkthrough, or the
  // loader's own missing-chain error, which told an author to write exactly
  // what the next check rejected.
  //
  // The hazard: this shape is named as often to deny it as to teach it, in
  // the same verbs ("refuses a default export that is not a function"). The
  // split is the replacement — prose that binds `Chain` to chain.ts's default
  // export and never names the factory (nor writes its `=>` signature) is
  // teaching the retired shape; prose that names both is pointing at the
  // current one. That is why the needles read chunks, not files: the two
  // claims routinely sit in neighbouring sentences of one doc block.
  const DEFAULT_EXPORT = /default[-\s]export(?:s|ed|ing)?\b/i;
  /** The type/object — `chain.ts`, `{ chain }`, and "a chain" are not it. */
  const CHAIN_TYPE = /\bChain\b/;
  /** The shape that replaced it, named or written. */
  const FACTORY = /factory|=>/i;
  const CHAIN_DEFAULT_CODE = /export\s+default\s+\w*[Cc]hain\w*/;
  const AGENT_MODULE_EXPORT = /\bexports?\s+(?:an?\s+|the\s+)?[`'"]agent[`'"]/i;

  /**
   * `text` as narration chunks: comment markers stripped, whitespace
   * collapsed, split at sentence terminators that carry a following space.
   * Prose wraps across lines and comment markers, so a needle reading raw
   * text misses every wrapped mention; and the trailing space is what keeps
   * `0.10` and `chain.ts` inside one chunk rather than splitting a claim into
   * fragments the needles then read separately.
   */
  function narrationChunks(text: string): string[] {
    return text
      .split("\n")
      .map((line) => line.replace(/^\s*(?:\*\/?|\/\*+|\/\/|#+)\s?/, ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .split(/(?<=[.;:!?])\s+/);
  }

  /** Every chunk of `text` that teaches one of the two retired shapes. */
  function pre010Sites(text: string): string[] {
    return narrationChunks(text).filter(
      (chunk) =>
        (DEFAULT_EXPORT.test(chunk) &&
          CHAIN_TYPE.test(chunk) &&
          !FACTORY.test(chunk)) ||
        CHAIN_DEFAULT_CODE.test(chunk) ||
        AGENT_MODULE_EXPORT.test(chunk),
    );
  }

  /**
   * Sites this entry's fence could not reach, each with what it still says —
   * the same inventory shape the env-mention pin above uses, but these are
   * unfixed violations rather than surviving denials. An entry leaves when
   * the prose moves to the factory; a new site fails until it is named.
   */
  const UNFIXED_SITES: Record<string, string> = {
    [CHAIN_PATH]:
      "dogfood chain header: `the default export is the Chain` — outside " +
      "the fence of the entry that promoted this pin",
  };

  it("no chain-authoring surface teaches the pre-0.10 module shape — a default-exported `Chain` object, or `agent` as a module export", () => {
    const sites = corpus.flatMap((f) =>
      pre010Sites(f.text).map((chunk) => ({ path: f.path, chunk })),
    );
    expect(
      [...new Set(sites.map((s) => s.path))].sort(),
      "teach the factory instead — `(api) => ({ chain })`, with `agent` on " +
        "its return — or name the site here with what it still says. Sites: " +
        sites.map((s) => `${s.path}: ${s.chunk.slice(0, 90)}`).join(" | "),
    ).toEqual(Object.keys(UNFIXED_SITES).sort());
  });

  // Sensitivity pin (engineering.md, "A green verdict is proven
  // non-vacuous"): the pin above reports "no sites" whether the needles are
  // watching or dead. Drive both directions — each retired shape as an
  // author would write it, and the corpus's own denial of that shape, which
  // must stay unflagged while still being prose about the default export.
  it("flags each retired shape and none of the corpus's denials of it", () => {
    for (const taught of [
      "That file must default-export a `Chain` and may export `agent`.",
      "create .flume/chain.ts that default-exports a Chain.",
      "The CLI expects a default export of `Chain`.",
      "   4. Change the named export to a default export: export default cascadeChain;",
      "Optionally export an `agent` alongside the chain.",
    ]) {
      expect(pre010Sites(taught), `needles missed: ${taught}`).not.toEqual([]);
    }
    for (const denier of [join("docs", "CHAIN-AUTHORING.md"), "src"]) {
      const file = corpus.find((f) =>
        denier === "src" ? f.path === join("src", "Dispatcher.ts") : f.path === denier,
      );
      expect(file, `${denier} left the scanned set`).toBeDefined();
      expect(
        DEFAULT_EXPORT.test(file!.text),
        `${file!.path} no longer discusses the default export — the negative ` +
          "control is vacuous",
      ).toBe(true);
      expect(pre010Sites(file!.text), `${file!.path} denies the shape`).toEqual(
        [],
      );
    }
  });

  it("the scanned corpus covers `examples/`'s chain modules, the surface engine-boundary.md names as opinion's home", () => {
    const examples = exampleChainPaths();
    expect(examples.length, "examples/ holds no chain module").toBeGreaterThan(
      0,
    );
    const scanned = corpus.map((f) => f.path);
    for (const path of examples) expect(scanned).toContain(path);
    // Non-vacuity: a directory listing proves nothing about what was read.
    // Every example is a chain module, so every one carries the default
    // export these pins judge.
    for (const path of examples) {
      const text = corpus.find((f) => f.path === path)!.text;
      expect(text, `${path} is not a chain module`).toMatch(/export default/);
    }
  });
});

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
function interfaceFields(text: string, name: string): string[] {
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

// Agreement pin (CHAIN-AUTHORING-GATE-SURFACE, per .claude/rules/engineering.md
// "A fact the engine holds is reported, never rediscovered"):
// docs/CHAIN-AUTHORING.md is where a chain author learns the gate surface, and
// it learns it from a restatement — a fenced `GateResult` block and a
// one-line `pendingGate({...})` signature, both hand-copied from types the
// compiler never compares them against. A copy reads as authoritative while
// being stale: an omitted field is a capability no chain knows it has, an
// invented option is a call that silently does nothing. The rung that holds
// it is a field-set comparison against the declaring source.
describe("the chain-authoring doc's gate surface agrees with the engine types", () => {
  const read = (...parts: string[]): string =>
    readFileSync(join(REPO_ROOT, ...parts), "utf8");
  const doc = read("docs", "CHAIN-AUTHORING.md");

  /**
   * The option names the doc's built-ins list teaches, off the one line that
   * writes the signature as destructuring — not the call sites further down,
   * which legitimately pass a subset.
   */
  function docPendingGateOptions(): string[] {
    const m = /^- `pendingGate\(\{([^}]*)\}\)`/m.exec(doc);
    if (!m) return [];
    return m[1]!
      .split(",")
      .map((s) => s.trim().replace(/\?$/, ""))
      .filter((s) => s !== "");
  }

  it("the chain-authoring doc's GateResult block names every field src/Gate.ts declares", () => {
    const declared = interfaceFields(read("src", "Gate.ts"), "GateResult");
    // Vacuity (engineering.md, "A green verdict is proven non-vacuous"): a
    // parser that found nothing would compare two empty sets forever.
    expect(declared, "src/Gate.ts: GateResult did not parse").toContain("ok");
    expect(declared.length).toBeGreaterThan(3);
    expect(
      interfaceFields(doc, "GateResult").slice().sort(),
      "docs/CHAIN-AUTHORING.md restates GateResult: every field src/Gate.ts " +
        "declares belongs in that block, and nothing else does",
    ).toEqual(declared.slice().sort());
  });

  it("the chain-authoring doc's Gate block names every field src/Gate.ts declares", () => {
    const declared = interfaceFields(read("src", "Gate.ts"), "Gate");
    // Vacuity (engineering.md, "A green verdict is proven non-vacuous"): a
    // parser that found nothing would compare two empty sets forever, and one
    // that skipped the optional field would agree with a doc that omits it.
    expect(declared, "src/Gate.ts: Gate did not parse").toContain("run");
    expect(
      declared,
      "src/Gate.ts: Gate declares `command?` — the reader dropped it",
    ).toContain("command");
    expect(
      interfaceFields(doc, "Gate").slice().sort(),
      "docs/CHAIN-AUTHORING.md restates Gate: every field src/Gate.ts " +
        "declares belongs in that block, and nothing else does",
    ).toEqual(declared.slice().sort());
  });

  it("the chain-authoring doc's pendingGate signature names every PendingGateOptions field and no others", () => {
    const declared = interfaceFields(
      read("src", "builtinGates.ts"),
      "PendingGateOptions",
    );
    expect(
      declared,
      "src/builtinGates.ts: PendingGateOptions did not parse",
    ).toContain("targetFence");
    expect(declared.length).toBeGreaterThan(2);
    expect(
      docPendingGateOptions().slice().sort(),
      "docs/CHAIN-AUTHORING.md's built-ins list writes pendingGate's " +
        "signature: it names the options PendingGateOptions declares, and no " +
        "option it does not",
    ).toEqual(declared.slice().sort());
  });
});

// Agreement pin (CHAIN-AUTHORING-PHASE-TABLE-AGREEMENT, per
// .claude/rules/engineering.md "A seam gate reads what the real writer
// wrote"): §1 of docs/CHAIN-AUTHORING.md is where a chain author learns what
// a `Phase` can declare, and it learned it from a hand-kept table that named
// twelve of the fifteen fields `src/Phase.ts` declares. A field absent from
// the table is a capability no chain knows it has — `scopeWritesToEntry` and
// `shipped` were unlearnable from the doc, and `entryChannelPaths` was taught
// downstream with no row, so the one spelling the doc gave a reader was the
// one the loader refuses. The rung that holds it is the same field-set
// comparison the gate-surface pins above make, with the markdown table as the
// restating side.
describe("the chain-authoring doc's Phase surface agrees with the engine type", () => {
  const read = (...parts: string[]): string =>
    readFileSync(join(REPO_ROOT, ...parts), "utf8");
  const doc = read("docs", "CHAIN-AUTHORING.md");

  /**
   * Field names the §1 table teaches: the first markdown table under the
   * section heading, read one row at a time, taking the backticked name in
   * the **first** column only. Second-column prose names sibling fields
   * freely — the `entryChannelPaths` row cites `scopeWritesToEntry` — so a
   * reader that took every backticked span in a row would count fields the
   * table never gives a row.
   *
   * Keyed on the heading rather than a line number, so the pin follows the
   * section when the doc moves.
   */
  function docPhaseFields(): string[] {
    const section = doc.split(/^## 1\. Declaring a Phase$/m)[1] ?? "";
    const rows = section.split("\n");
    const start = rows.findIndex((l) => /^\| Field\s*\| Role/.test(l));
    if (start === -1) return [];
    const fields: string[] = [];
    for (const row of rows.slice(start + 2)) {
      if (!row.startsWith("|")) break;
      const name = /^\|\s*`([^`]+)`\s*\|/.exec(row);
      if (name) fields.push(name[1]!);
    }
    return fields;
  }

  it("the chain-authoring doc's Phase field table names every field src/Phase.ts declares", () => {
    const declared = interfaceFields(read("src", "Phase.ts"), "Phase");
    // Vacuity (engineering.md, "A green verdict is proven non-vacuous"): a
    // parser that found nothing on either side would compare two empty sets
    // forever, and one that stopped at the first wrapped member would agree
    // with a table missing everything after it.
    expect(declared, "src/Phase.ts: Phase did not parse").toContain("name");
    expect(
      declared,
      "src/Phase.ts: Phase declares `teardownWorktree` last — the reader " +
        "stopped short of it",
    ).toContain("teardownWorktree");
    expect(declared.length).toBeGreaterThan(10);
    expect(
      docPhaseFields(),
      "docs/CHAIN-AUTHORING.md §1: the field table did not parse — the " +
        "heading was reworded, or the table moved",
    ).toContain("name");
    expect(
      docPhaseFields().slice().sort(),
      "docs/CHAIN-AUTHORING.md §1 tabulates Phase: every field src/Phase.ts " +
        "declares gets a row, and nothing it does not declare does",
    ).toEqual(declared.slice().sort());
  });

  // Sensitivity pin: the comparison above is only worth its green if the
  // table reader is keyed on rows and on the first column. Drive both
  // failures the reader is shaped to avoid.
  it("the Phase table reader counts one field per row, from the first column only", () => {
    const fields = docPhaseFields();
    expect(fields.length, "the table yielded no rows").toBeGreaterThan(10);
    // One name per row, no duplicates — the `entryChannelPaths` row's prose
    // cites `scopeWritesToEntry`, which has its own row and must not be
    // counted twice.
    expect(new Set(fields).size).toBe(fields.length);
    const citing = doc
      .split("\n")
      .filter((l) => /^\|\s*`entryChannelPaths`/.test(l));
    expect(citing, "the entryChannelPaths row left the table").toHaveLength(1);
    expect(
      citing[0],
      "the second-column cross-reference this reader must ignore is gone — " +
        "the sensitivity check is vacuous",
    ).toContain("`scopeWritesToEntry`");
  });
});

// Agreement pin (PRIOR-ATTEMPT-BLOCK-DOC-ALL-MODES, per
// .claude/rules/engineering.md "A seam gate reads what the real writer
// wrote"): §5 of docs/CHAIN-AUTHORING.md is where a chain author learns what
// a `<prior-attempt>` block can say, and it taught one of the six variants
// `src/Prompt.ts` declares — the `gate-revert` leg — as if it were the block.
// A variant absent from the page is a signal no chain knows it receives:
// `not-shipped` exists precisely so a chain stops rebuilding "was the last
// attempt a park" from the verdict log, and a doc that never names it leaves
// the rebuild in place. The rung that holds it is the same field-set
// comparison the surface pins above make, with the section's mode bullets as
// the restating side and the union's own `mode` literals as the declaring one.
describe("the chain-authoring doc's `<prior-attempt>` section agrees with the engine union", () => {
  const read = (...parts: string[]): string =>
    readFileSync(join(REPO_ROOT, ...parts), "utf8");
  const promptSrc = read("src", "Prompt.ts");
  const doc = read("docs", "CHAIN-AUTHORING.md");

  /**
   * The interface names `export type PriorAttempt` unions together, in
   * declaration order. Read off the union rather than a list kept here: a
   * seventh variant must arrive as a test failure, not as a doc gap nobody
   * is watching.
   */
  function variantNames(): string[] {
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
  function declaredModes(): string[] {
    const modes: string[] = [];
    for (const name of variantNames()) {
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
  function section(): string {
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
  function docModes(): string[] {
    return [...section().matchAll(/^- `([a-z][a-z-]*)` — /gm)].map((m) => m[1]!);
  }

  it("the chain-authoring doc's `<prior-attempt>` section names every PriorAttempt mode src/Prompt.ts declares", () => {
    const declared = declaredModes();
    // Vacuity (engineering.md, "A green verdict is proven non-vacuous"): a
    // reader that lost the union, or one that found interfaces but no `mode`
    // literal, would compare two empty sets forever.
    expect(
      variantNames().length,
      "src/Prompt.ts: the PriorAttempt union did not parse",
    ).toBeGreaterThan(4);
    expect(declared, "src/Prompt.ts: no `mode` literal parsed").toContain(
      "gate-revert",
    );
    expect(
      declared.length,
      "src/Prompt.ts: a PriorAttempt variant declared no `mode` literal",
    ).toBe(variantNames().length);
    expect(
      docModes(),
      "docs/CHAIN-AUTHORING.md: the `<prior-attempt>` section's mode bullets " +
        "did not parse — the heading was reworded, or the list moved",
    ).toContain("gate-revert");
    expect(
      docModes().slice().sort(),
      "docs/CHAIN-AUTHORING.md's `<prior-attempt>` section enumerates the " +
        "PriorAttempt union: every mode src/Prompt.ts declares gets a bullet, " +
        "and nothing it does not declare does",
    ).toEqual(declared.slice().sort());
  });

  it("the `<prior-attempt>` section teaches the anchor every record carries and the record-side flake marker", () => {
    const body = section();
    // Vacuity: hold the doc against what the union actually declares, so a
    // renamed engine field fails here rather than leaving the doc teaching a
    // field no record has.
    for (const name of variantNames()) {
      expect(
        interfaceFields(promptSrc, name),
        `src/Prompt.ts: ${name} lost its anchor fields`,
      ).toEqual(expect.arrayContaining(["headSha", "at"]));
    }
    expect(
      interfaceFields(promptSrc, "GateRevertAttempt"),
      "src/Prompt.ts: GateRevertAttempt no longer declares `suspectFlake`",
    ).toContain("suspectFlake");
    for (const field of ["headSha", "at", "suspectFlake"]) {
      expect(
        body,
        `docs/CHAIN-AUTHORING.md: the \`<prior-attempt>\` section never names ` +
          `\`${field}\`, so a chain author cannot learn it from the page`,
      ).toContain(`\`${field}\``);
    }
  });
});

// Prose pin (SHOULDRUN-SINGLETON-CWD-PROSE, per .claude/rules/engineering.md
// "Narration is the ladder's bottom rung"): `runSingleton` consults
// `shouldRun` before it provisions anything, so the context it hands the
// predicate carries the repo root — there is no worktree yet. Both prose
// surfaces a chain author learns the hook from said only "the same
// `TickContext` `promptArgs` sees", which tells a singleton predicate
// reading `ctx.cwd` that it has a worktree it does not have. Nothing
// mechanical watched the claim; this is that watch. The side the prose is
// held to is the singleton callsite's own `cwd` argument.
describe("the shouldRun cwd split is taught where a chain author reads it", () => {
  const read = (...parts: string[]): string =>
    readFileSync(join(REPO_ROOT, ...parts), "utf8");
  const phaseSrc = read("src", "Phase.ts");
  const dispatcherSrc = read("src", "Dispatcher.ts");
  const doc = read("docs", "CHAIN-AUTHORING.md");

  /**
   * The doc block immediately above `cwd: string;` inside `TickContext`:
   * the nearest one, matched so that no block terminator may fall between
   * it and the field, so a preceding member's comment cannot stand in.
   */
  function cwdDoc(): string {
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
  function singletonConsultRoots(): string[] {
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
  function declineBullets(): string[] {
    const section =
      /^### `shouldRun`: decline a tick before the invocation$([\s\S]*?)^## /m.exec(
        doc,
      )?.[1] ?? "";
    return section
      .split(/\n(?=- )/)
      .filter((b) => b.startsWith("- "))
      .map((b) => b.replace(/\s+/g, " ").trim());
  }

  it("the TickContext.cwd doc comment names the repo root a singleton shouldRun sees", () => {
    const block = cwdDoc();
    // Vacuity (engineering.md, "A green verdict is proven non-vacuous"): an
    // interface or field reader that found nothing would pass every content
    // assertion below against the empty string.
    expect(
      block,
      "src/Phase.ts: TickContext.cwd's own doc block did not parse — the " +
        "interface was renamed, or the field lost its comment",
    ).not.toBe("");
    // The engine side of the claim: the singleton consult really does pass
    // the repo root. If it ever stops doing so, this fails here rather than
    // leaving the comment quietly wrong.
    expect(
      singletonConsultRoots(),
      "src/Dispatcher.ts: the singleton shouldRun consult no longer builds " +
        "its context inline — re-read what root it passes before trusting " +
        "the doc comment",
    ).toEqual(["repoRoot"]);
    expect(block, "the comment must name the consult that diverges").toMatch(
      /singleton/i,
    );
    expect(block, "…and the hook it diverges on").toMatch(/shouldRun/);
    expect(
      block,
      "…and the root that consult's `cwd` actually carries",
    ).toMatch(/repo root/i);
  });

  it("the chain-authoring decline section separates what a singleton decline saves from a fanout one", () => {
    const bullets = declineBullets();
    // Vacuity: the section heading still parses and still carries its list.
    expect(
      bullets.length,
      "docs/CHAIN-AUTHORING.md: the `shouldRun` section's bullet list did " +
        "not parse — the heading was reworded, or the section moved",
    ).toBeGreaterThan(3);
    const split = bullets.filter(
      (b) => /\bsingleton\b/i.test(b) && /\bfanout\b/i.test(b),
    );
    expect(
      split,
      "docs/CHAIN-AUTHORING.md: exactly one bullet in the decline section " +
        "contrasts a singleton decline with a fanout one — the split has " +
        "one home, and a reader who misses it resolves paths off a `cwd` " +
        "that is not a worktree",
    ).toHaveLength(1);
    const bullet = split[0]!;
    expect(
      bullet,
      "the singleton side names the root its `ctx.cwd` carries",
    ).toMatch(/repo root/i);
    expect(
      bullet,
      "…and that the consult precedes provisioning, which is what it saves",
    ).toMatch(/provision/i);
    expect(
      bullet,
      "the fanout side names the worktree its `ctx.cwd` carries",
    ).toMatch(/worktree/i);
    expect(
      bullet,
      "…and that a fanout decline saves the invocation, not that worktree",
    ).toMatch(/agent invocation/i);
  });

  it("the sentence introducing `TickContext.cwd` sends a reader to the singleton exception", () => {
    // The gloss on `cwd` alone — the parenthetical right after it. Scoped
    // that tightly because the same sentence glosses `pending` as "for
    // singleton phases", which would satisfy a match over the whole
    // sentence while `cwd` still read as unconditionally a worktree.
    const gloss = (
      /`TickContext` carries `cwd` \(([^)]*)\)/.exec(doc)?.[1] ?? ""
    ).replace(/\s+/g, " ");
    expect(
      gloss,
      "docs/CHAIN-AUTHORING.md: the `TickContext` summary's gloss on `cwd` " +
        "was reworded — it is the first place a reader learns what `cwd` is",
    ).not.toBe("");
    expect(
      gloss,
      "the gloss must not teach `cwd` as unconditionally a worktree path",
    ).toMatch(/singleton/i);
  });
});

// Agreement pin (CHAIN-AUTHORING-DOC-AGREEMENT, per
// .claude/rules/engineering.md "A seam gate reads what the real writer
// wrote"): docs/CHAIN-AUTHORING.md introduces a fenced block as "the `plan`
// phase from `examples/cascade-chain.ts`" and then hand-copies it. The copy
// is what a chain author reads as the worked shape, and nothing compared it
// to the file it names — so it drifted to a `gates` entry and a
// `promptArgs` call the example does not write. The rung that holds a quote
// is the quoted file itself: the real declaration, read off disk, compared
// against the block that claims to be it.
describe("the chain-authoring doc quotes the example chain it names", () => {
  const read = (...parts: string[]): string =>
    readFileSync(join(REPO_ROOT, ...parts), "utf8");
  const doc = read("docs", "CHAIN-AUTHORING.md");

  /**
   * The fenced `ts` block the doc introduces as the example's `plan` phase.
   * Keyed on the sentence that makes the claim rather than a line number, so
   * the pin follows the prose when the section moves — and fails loudly if
   * the claim itself is reworded, which is the point at which a human should
   * re-decide what the block is quoting.
   */
  const DOC_QUOTE =
    /The `plan` phase from `examples\/cascade-chain\.ts`:\s*```ts\n([\s\S]*?)```/;

  /**
   * The `const plan: Phase = { … };` declaration as a chain module writes it:
   * the declaration line through the first line closing it at the same
   * indentation, so the span survives the example's factory nesting.
   */
  function planPhaseSource(text: string): string {
    const lines = text.split("\n");
    const start = lines.findIndex((l) => /^\s*const plan: Phase = \{$/.test(l));
    if (start === -1) return "";
    const indent = /^\s*/.exec(lines[start]!)![0];
    const end = lines.findIndex((l, i) => i > start && l === `${indent}};`);
    if (end === -1) return "";
    return lines.slice(start, end + 1).join("\n");
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
  function normalizeTs(span: string): string {
    return span
      .split("\n")
      .map((line) => line.replace(/\s+\/\/.*$/, "").trim())
      .filter((line) => line !== "")
      .join(" ")
      .replace(/\s+/g, " ")
      .replace(/\s*([{}[\](),;])\s*/g, "$1")
      .replace(/,([}\])])/g, "$1");
  }

  it("the chain-authoring doc's quoted plan phase agrees with examples/cascade-chain.ts", () => {
    const example = planPhaseSource(read("examples", "cascade-chain.ts"));
    const quoted = DOC_QUOTE.exec(doc)?.[1] ?? "";
    // Vacuity (engineering.md, "A green verdict is proven non-vacuous"): two
    // spans that failed to parse agree forever.
    expect(
      example,
      "examples/cascade-chain.ts: the plan phase did not parse",
    ).toMatch(/gates:/);
    expect(
      quoted,
      "docs/CHAIN-AUTHORING.md: the quoted plan phase did not parse — the " +
        "sentence introducing the block was reworded, or the fence moved",
    ).toMatch(/gates:/);
    expect(
      normalizeTs(quoted),
      "docs/CHAIN-AUTHORING.md quotes examples/cascade-chain.ts's plan " +
        "phase: the block must be that declaration, not a paraphrase of it",
    ).toBe(normalizeTs(example));
  });

  // Sensitivity pin: the comparison above is only worth its green if the
  // normalizer erases formatting and nothing else. Drive both directions off
  // the real declaration — re-wrapped agrees, re-declared does not.
  it("the quote comparison ignores wrapping and catches a changed declaration", () => {
    const example = planPhaseSource(read("examples", "cascade-chain.ts"));
    expect(example, "the example's plan phase did not parse").toContain(
      "gates: [pendingGate({ targetFence: build, extension: entryExtension })],",
    );

    const rewrapped = example
      .replace(
        "gates: [pendingGate({ targetFence: build, extension: entryExtension })],",
        "gates: [\n  pendingGate({\n    targetFence: build,\n    extension: entryExtension,\n  }),\n],",
      )
      .replace(/^ {4}/gm, "");
    expect(rewrapped, "the rewrap was a no-op").not.toBe(example);
    expect(normalizeTs(rewrapped)).toBe(normalizeTs(example));

    // The drift this entry found: the doc named a different gate and dropped
    // the extension argument.
    const drifted = example
      .replace(
        "gates: [pendingGate({ targetFence: build, extension: entryExtension })],",
        "gates: [pendingParseGate],",
      )
      .replace(
        "renderSchemaForPrompt(entryExtension)",
        "renderSchemaForPrompt()",
      );
    expect(drifted, "the drift was a no-op").not.toBe(example);
    expect(normalizeTs(drifted)).not.toBe(normalizeTs(example));
  });
});

// Agreement pin (README-CASCADE-PIPELINE-CURRENT, per
// .claude/rules/engineering.md "A seam gate reads what the real writer
// wrote"): README names cascade's phases twice — in the getting-started
// pointer and again under Pointers — and both listings were hand-written
// beside the example rather than read off it. So when the example dropped
// phases, the front door kept teaching the retired pipeline as current. The
// writer here is the chain module: its `phases` array, resolved to the names
// the phase declarations spell, is what README's arrow lists are compared
// against.
describe("the README cascade pointer", () => {
  const read = (...parts: string[]): string =>
    readFileSync(join(REPO_ROOT, ...parts), "utf8");

  /**
   * The phase names a chain module declares, in chain order: the identifiers
   * listed in `phases: […]` resolved through each `const <id>: Phase = {`
   * declaration to the `name` literal it spells. Read off the identifiers
   * rather than off every `name:` in the file, so a `Phase` the module
   * declares but leaves out of the chain cannot count as shipped.
   */
  function declaredPhaseNames(text: string): string[] {
    const listed = /phases:\s*\[([^\]]*)\]/.exec(text)?.[1] ?? "";
    return listed
      .split(",")
      .map((part) => part.trim())
      .filter((id) => /^[A-Za-z_$][\w$]*$/.test(id))
      .map((id) => {
        const decl = new RegExp(
          `const ${id}: Phase = \\{[\\s\\S]*?name:\\s*"([^"]+)"`,
        ).exec(text);
        return decl?.[1] ?? "";
      })
      .filter((name) => name !== "");
  }

  /**
   * The prose units of `readme` that mention `cascade-chain.ts`: paragraphs
   * split on blank lines, then again at list-item boundaries, so the Pointers
   * bullet is judged as itself rather than as its whole list.
   */
  function cascadeMentions(readme: string): string[] {
    return readme
      .split(/\n\s*\n/)
      .flatMap((para) => para.split(/\n(?=- )/))
      .filter((unit) => unit.includes("cascade-chain.ts"));
  }

  /** Every arrow-joined run of phase-shaped words in a prose unit. */
  function arrowRuns(unit: string): string[][] {
    const runs = unit.match(/[a-z][a-z-]*(?:\s*→\s*[a-z][a-z-]*)+/g) ?? [];
    return runs.map((run) => run.split("→").map((word) => word.trim()));
  }

  it("README's cascade description names the phases cascade-chain.ts declares", () => {
    const declared = declaredPhaseNames(read("examples", "cascade-chain.ts"));
    // Vacuity (engineering.md, "A green verdict is proven non-vacuous"): a
    // chain that failed to parse, or a README that stopped naming phases,
    // agrees with anything.
    expect(
      declared,
      "examples/cascade-chain.ts: the chain's `phases` array did not resolve " +
        "to phase names — the declarations or the array were reshaped",
    ).not.toHaveLength(0);

    const listings = cascadeMentions(read("README.md")).flatMap(arrowRuns);
    expect(
      listings,
      "README.md names cascade's phases at two sites — the getting-started " +
        "pointer and the Pointers list; a site that stopped listing them is " +
        "a change a human should re-decide, not a pin that quietly passes",
    ).toHaveLength(2);

    for (const listing of listings) {
      expect(
        listing,
        "README.md must describe the phases examples/cascade-chain.ts " +
          "declares, not a pipeline it used to ship",
      ).toEqual(declared);
    }
  });
});

// Orphan pin (LOADCHAINMODULE-DOC-ORPHANED, per
// .claude/rules/engineering.md "Narration is the ladder's bottom rung"): a
// doc block whose next non-blank line opens another doc block documents no
// symbol. It still reads as current narration about whatever follows it —
// which is a different symbol's doc — so its subject can be renamed,
// rewritten, or moved with nothing pointing at the staleness. Prose with no
// owner; the rung that can hold it is a source-shape check.
//
// Scope is the TypeScript half of the corpus above: the same files, minus the
// markdown ones, where a doc block is a source shape rather than a fenced
// example.
describe("no doc block is orphaned", () => {
  const OPENER = /^\/\*\*/;
  const CLOSER = /\*\/$/;
  /** Same opener, counted across a whole file for the vacuity pin. */
  const OPENER_ANYWHERE = /^\s*\/\*\*/gm;

  /**
   * A doc block that opens a file documents the module, so the block after it
   * is its first symbol's, not evidence of an orphan. Spelled as a carve-out
   * rather than inherited: every other block is judged.
   */
  const MODULE_HEADER_LINE = 1;

  /**
   * Orphans this fence cannot reach, each with why it survives — the same
   * inventory shape the env-mention pin above uses. An entry leaves when the
   * block moves onto its symbol; a new orphan fails until it is named here.
   */
  const ALLOWED_ORPHANS: Record<string, string> = {};

  type Orphan = { path: string; open: number; id: string };

  /**
   * Every doc block in `text` whose close is followed — across blank lines
   * only — by another doc block's open. Identified by its first content line
   * rather than its line number, so the inventory above survives line drift.
   */
  function orphanedBlocks(path: string, text: string): Orphan[] {
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

  const sources = scannedPaths()
    .filter((path) => path.endsWith(".ts"))
    .map((path) => {
      const text = readFileSync(join(REPO_ROOT, path), "utf8");
      return { path, text, orphans: orphanedBlocks(path, text) };
    });

  // Vacuity pin (engineering.md, "A green verdict is proven non-vacuous"): a
  // scanner that matched no opener, or a file list that resolved to nothing,
  // reports zero orphans over zero blocks and passes forever. Dispatcher.ts is
  // named because it is the file this pin was written against — and it must
  // still hold the block the pin exists to keep attached.
  it("scans a populated set of doc blocks", () => {
    expect(sources.length).toBeGreaterThan(0);
    const dispatcher = sources.find(
      (f) => f.path === join("src", "Dispatcher.ts"),
    );
    expect(dispatcher, "src/Dispatcher.ts left the scanned set").toBeDefined();
    expect(
      (dispatcher!.text.match(OPENER_ANYWHERE) ?? []).length,
    ).toBeGreaterThan(10);
  });

  it("closes every doc block onto a symbol, never onto another block", () => {
    const found = sources.flatMap((f) => f.orphans);
    expect(
      found.map((o) => o.id).sort(),
      "a doc block is followed by another doc block, so it documents no " +
        "symbol: move it onto the symbol it describes, delete it, or — if " +
        "the file is outside this phase's fence — name it in ALLOWED_ORPHANS. " +
        `Sites: ${found.map((o) => `${o.path}:${o.open}`).join(", ")}`,
    ).toEqual(Object.keys(ALLOWED_ORPHANS).sort());
  });
});

// ---------- shared doc-claim readers ----------
//
// Both pins below hold a prose list against the `src/` value that writes it,
// and both read a doc the same way: find the paragraph that opens the claim,
// take the bullet list under it when one follows, and read the backticked
// tokens each chunk names. One set of readers, so the two pins cannot drift
// into two markdown dialects.

const readDoc = (...parts: string[]): string =>
  readFileSync(join(REPO_ROOT, ...parts), "utf8");

/**
 * The claim region for `marker`: the marker's own paragraph, plus a bullet
 * list beneath it when one follows. It ends at the first line that opens a
 * new block at column 0 — which is what keeps README's *chain*-placed list,
 * three lines further down, out of a scan about what the harness places.
 */
function regionLines(text: string, marker: RegExp): string[] | null {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => marker.test(l));
  if (start === -1) return null;
  const region: string[] = [];
  let i = start;
  while (i < lines.length && lines[i]!.trim() !== "") region.push(lines[i++]!);
  let j = i;
  while (j < lines.length && lines[j]!.trim() === "") j++;
  if (j < lines.length && /^-\s/.test(lines[j]!)) {
    region.push("");
    for (; j < lines.length; j++) {
      const l = lines[j]!;
      if (/^-\s/.test(l) || /^\s+\S/.test(l) || l.trim() === "") {
        region.push(l);
        continue;
      }
      break;
    }
  }
  return region;
}

/**
 * The region as claim chunks — the marker paragraph, then one chunk per
 * bullet with its continuation lines. Prose wraps, so a chunk is the unit a
 * claim is actually written in.
 */
function claimChunks(lines: string[]): string[] {
  const out: string[][] = [];
  let cur: string[] | null = null;
  for (const line of lines) {
    if (/^-\s/.test(line)) {
      if (cur) out.push(cur);
      cur = [line];
    } else if (line.trim() === "") {
      if (cur) out.push(cur);
      cur = null;
    } else if (cur) cur.push(line);
    else cur = [line];
  }
  if (cur) out.push(cur);
  return out.map((chunk) => chunk.join(" "));
}

/**
 * The paths a chunk claims: every backticked token ahead of the chunk's
 * first em dash. The dash is where a chunk stops naming and starts
 * explaining, and the explanation legitimately names things that are not on
 * the list — a CLI invocation, a `Chain` field, the file a list is merged
 * into, the chain-placed directory a list exists to disown.
 */
function claimedPaths(chunk: string): string[] {
  const named = chunk.split("—")[0]!;
  return [...named.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
}

// Agreement pin (DOC-HARNESS-STATE-OWNERSHIP, per .claude/rules/engineering.md
// "A seam gate reads what the real writer wrote"): the docs tell a chain
// author which paths under a state root are the harness's, and they told it
// from memory — `sessions/` was taught as harness-managed state when only a
// chain spells that name, and README's state list ran engine paths and this
// chain's plan artifacts together in one undifferentiated list. Either error
// reads as the engine's contract: an author trusts the runtime to place a
// directory nothing in `src/` places, or treats a chain artifact as a path
// the engine will keep putting there. The writer of that contract is `src/`
// itself — `STATE_ROOT_NAMES`, the accessors that join its values onto
// `flumeDir`, `DEFAULT_PENDING_REL`, and the literals the dispatcher joins on
// directly. This pin reads that writer and holds the docs' claim to it.
describe("the docs' harness-managed state list agrees with what src/ spells", () => {
  const read = readDoc;

  /** The docs that teach a state root's layout, and must agree about it. */
  const SCANNED_DOCS = ["README.md", join("docs", "CHAIN-AUTHORING.md")];

  /**
   * The line that opens a harness-managed-state claim, in either doc's
   * register: README's list header, the chain doc's inline bold run-in.
   */
  const MARKER = /^\s*(?:\*\*)?Harness-managed state\b/;

  /** The claim region for this pin's marker. */
  const stateRegion = (text: string): string[] | null =>
    regionLines(text, MARKER);

  /**
   * A doc's path token as a state-root-relative name: the `.flume/` prefix
   * and any trailing separator dropped, and a trailing `<placeholder>`
   * segment — `<phase>`, `<entry-slug>`, `<timestamp>.jsonl` — dropped with
   * it, since what the runtime owns is the directory, not the names it generates
   * inside it.
   */
  function stateRootName(claim: string): string {
    const parts = claim
      .replace(/^\.flume\//, "")
      .split("/")
      .filter((s) => s !== "");
    while (parts.length > 0 && /^<.+>/.test(parts[parts.length - 1]!)) {
      parts.pop();
    }
    return parts.join("/");
  }

  /** `const NAME = "literal";` declarations in one module. */
  function stringConsts(text: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const m of text.matchAll(/\bconst\s+(\w+)\s*=\s*"([^"]+)"\s*;/g)) {
      out.set(m[1]!, m[2]!);
    }
    return out;
  }

  /** `STATE_ROOT_NAMES`'s key → name map, read off its declaration. */
  function stateRootNamesMap(): Map<string, string> {
    const block =
      /export const STATE_ROOT_NAMES = \{([\s\S]*?)\n\} as const;/.exec(
        read("src", "paths.ts"),
      );
    const out = new Map<string, string>();
    if (!block) return out;
    for (const m of block[1]!.matchAll(/(\w+)\s*:\s*"([^"]+)"/g)) {
      out.set(m[1]!, m[2]!);
    }
    return out;
  }

  /**
   * The writer side: every name `src/` itself places directly under a state
   * root. Read off the real writers rather than a list kept here — each
   * `join(flumeDir, …)` with an argument this reader can resolve (a literal,
   * a `STATE_ROOT_NAMES` member, a module-local string const), plus the
   * default queue path, which is joined onto a state root by
   * `resolvePendingPath` rather than spelled at a `flumeDir` call site.
   *
   * An argument that does not resolve is skipped on purpose: `chain.friction`
   * is a chain-supplied name, which is exactly the category this pin exists
   * to keep out of a harness-managed list.
   */
  function namesSrcSpells(): string[] {
    const roots = stateRootNamesMap();
    const names = new Set<string>();
    for (const file of readdirSync(join(REPO_ROOT, "src")).filter((n) =>
      n.endsWith(".ts"),
    )) {
      const text = read("src", file);
      const consts = stringConsts(text);
      for (const m of text.matchAll(
        /join\(\s*(?:this\.)?flumeDir\s*,\s*([^),]+?)\s*\)/g,
      )) {
        const arg = m[1]!;
        const literal = /^"([^"]+)"$/.exec(arg);
        const member = /^STATE_ROOT_NAMES\.(\w+)$/.exec(arg);
        const resolved = literal
          ? literal[1]!
          : member
            ? roots.get(member[1]!)
            : consts.get(arg);
        if (resolved) names.add(resolved);
      }
    }
    const pending = /export const DEFAULT_PENDING_REL = join\(([^)]*)\);/.exec(
      read("src", "paths.ts"),
    );
    if (pending) {
      names.add(
        [...pending[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!).join("/"),
      );
    }
    return [...names];
  }

  const spelled = namesSrcSpells();

  it("the harness-managed state scan covers both README.md and docs/CHAIN-AUTHORING.md", () => {
    // Vacuity (engineering.md, "A green verdict is proven non-vacuous"): a
    // marker that stopped matching, or a region that collapsed to the header
    // line, would leave the refusal below judging an empty claim set in a doc
    // that still teaches the layout.
    for (const doc of SCANNED_DOCS) {
      const region = stateRegion(read(doc));
      expect(
        region,
        `${doc} states no harness-managed state claim the scan can find — ` +
          "restore the `Harness-managed state` marker, or this pin is blind",
      ).not.toBeNull();
      const claims = claimChunks(region!).flatMap(claimedPaths);
      expect(
        claims,
        `${doc}: the claim region names no path`,
      ).not.toEqual([]);
    }
  });

  it("the docs' harness-managed state list names every path src/ spells", () => {
    // Vacuity: a writer-side reader that resolved nothing would accept every
    // claim. Name the shapes it must have resolved — a `STATE_ROOT_NAMES`
    // member behind an accessor, a module-local const the dispatcher joins,
    // and the queue default that no `flumeDir` call site spells.
    expect(spelled, "src/: STATE_ROOT_NAMES did not resolve").toEqual(
      expect.arrayContaining([
        "awake",
        "prior-attempts",
        "loop.pid",
        "worktrees",
      ]),
    );
    expect(spelled, "src/: DEFAULT_PENDING_REL did not resolve").toContain(
      "plan/pending.json",
    );

    for (const doc of SCANNED_DOCS) {
      const claimed = claimChunks(stateRegion(read(doc))!)
        .flatMap(claimedPaths)
        .map(stateRootName);
      expect(
        claimed.filter((name) => !spelled.includes(name)),
        `${doc} teaches a path as harness-managed that nothing in src/ ` +
          `places under a state root — src/ spells: ${[...spelled].sort().join(", ")}`,
      ).toEqual([]);
      // The other direction. A subset check passes a list that names three
      // of nine, and a chain author reads a short list as a complete one —
      // taking a path the runtime will keep placing for one of their own to
      // put there. Agreement is equality or it is not agreement.
      expect(
        [...spelled].filter((name) => !claimed.includes(name)).sort(),
        `${doc} omits a path src/ places under a state root — the list ` +
          "reads as complete, so every name src/ spells belongs on it",
      ).toEqual([]);
    }
  });

  // Sensitivity pin (engineering.md, "A green verdict is proven
  // non-vacuous"): the refusal above reports "no violations" whether it is
  // watching or dead. Drive it with the claim the docs actually carried —
  // `sessions/`, a directory only `.flume/chain.ts` spells — injected into
  // each doc's real region in that doc's own register.
  it("flags a chain-placed directory taught as harness-managed", () => {
    expect(
      spelled,
      "`sessions` resolved as a name src/ spells — the injection below is " +
        "no longer a violation, so this control proves nothing",
    ).not.toContain("sessions");

    const injections: Record<string, (region: string[]) => string[]> = {
      "README.md": (region) => [
        ...region,
        "- `.flume/sessions/<timestamp>.jsonl` — captured agent NDJSON.",
      ],
      [join("docs", "CHAIN-AUTHORING.md")]: (region) => [
        region[0]!.replace("`awake/`", "`awake/`, `sessions/`"),
        ...region.slice(1),
      ],
    };

    for (const [doc, inject] of Object.entries(injections)) {
      const region = stateRegion(read(doc))!;
      const clean = claimChunks(region)
        .flatMap(claimedPaths)
        .map(stateRootName);
      const dirty = claimChunks(inject(region))
        .flatMap(claimedPaths)
        .map(stateRootName);
      expect(dirty, `${doc}: the injection was a no-op`).not.toEqual(clean);
      expect(
        dirty.filter((name) => !spelled.includes(name)),
        `${doc}: a \`sessions/\` claim in the harness-managed region went ` +
          "unflagged — the region parser or the em-dash cut has gone blind",
      ).toEqual(["sessions"]);
    }
  });

  // Sensitivity pin for the equality direction: the omission refusal reports
  // "nothing missing" whether it is watching or dead, and it is the half that
  // went unwatched — the chain doc named five of the nine for a full release
  // line. Drive it with `stop` removed from each doc's real region, in that
  // doc's own register.
  it("flags a path src/ spells that the docs' harness-managed list omits", () => {
    const removals: Record<string, (region: string[]) => string[]> = {
      "README.md": (region) =>
        region.filter((l) => !l.includes("`.flume/stop`")),
      [join("docs", "CHAIN-AUTHORING.md")]: (region) =>
        region.map((l) => l.replace(/`stop`,?\s*/, "")),
    };

    for (const [doc, remove] of Object.entries(removals)) {
      const region = stateRegion(read(doc))!;
      const thinned = claimChunks(remove(region))
        .flatMap(claimedPaths)
        .map(stateRootName);
      expect(
        thinned,
        `${doc}: the removal was a no-op — the register this control edits ` +
          "has moved, so it proves nothing",
      ).not.toContain("stop");
      expect(
        [...spelled].filter((name) => !thinned.includes(name)),
        `${doc}: a dropped \`stop\` went unflagged — the omission refusal ` +
          "has gone blind",
      ).toEqual(["stop"]);
    }
  });
});

// Agreement pin (CHAIN-AUTHORING-RUNTIME-NAME-AGREEMENT, per
// .claude/rules/engineering.md "A seam gate reads what the real writer
// wrote"): §5a's "what the runtime still owns" bullet hand-lists the ignore
// entries `flume job new` merges into a fresh job dir. The writer is
// `RUNTIME_IGNORES` (`src/job.ts`), which derives most of its own entries
// from `STATE_ROOT_NAMES` precisely so a renamed state root cannot leave the
// seed pointing at the old name — and the doc's copy is where that chain of
// derivation stopped. A chain author reads the bullet to learn which lines
// they need not put in `seedDir`, so a name the doc has and the runtime does
// not is an ignore line nobody writes.
describe("docs/CHAIN-AUTHORING.md's job-seed ignore list agrees with RUNTIME_IGNORES", () => {
  const DOC = join("docs", "CHAIN-AUTHORING.md");
  const MARKER = /^\s*(?:\*\*)?What the runtime still owns\b/;

  /**
   * The bullet that names the merged entries — the one bullet in the region
   * that is about ignoring anything; its siblings pin `core.longpaths` and
   * baseline-commit the seed. Selected by what it says rather than by
   * position, so reordering the list does not silently point this pin at
   * `core.longpaths`.
   */
  function seedChunk(text: string): string {
    const region = regionLines(text, MARKER);
    expect(
      region,
      `${DOC} states no "What the runtime still owns" claim the scan can ` +
        "find — restore the marker, or this pin is blind",
    ).not.toBeNull();
    const bullets = claimChunks(region!).filter(
      (c) => /^-\s/.test(c) && /ignore/i.test(c),
    );
    expect(
      bullets,
      `${DOC}: the runtime-owned region holds no ignore-list bullet`,
    ).toHaveLength(1);
    return bullets[0]!;
  }

  it("the chain-authoring doc's job-seed gitignore list names every entry RUNTIME_IGNORES carries and no others", () => {
    // Vacuity (engineering.md, "A green verdict is proven non-vacuous"): an
    // empty writer would make every doc list agree with it.
    expect(
      RUNTIME_IGNORES.length,
      "src/job.ts: RUNTIME_IGNORES is empty — nothing to hold the doc to",
    ).toBeGreaterThan(0);

    const claimed = claimedPaths(seedChunk(readDoc(DOC)));
    expect(
      [...claimed].sort(),
      `${DOC}'s job-seed list disagrees with RUNTIME_IGNORES (src/job.ts) — ` +
        `the runtime merges: ${[...RUNTIME_IGNORES].sort().join(", ")}`,
    ).toEqual([...RUNTIME_IGNORES].sort());
  });

  // Sensitivity pin (engineering.md, "A green verdict is proven
  // non-vacuous"): the equality above reads a prose list through an em-dash
  // cut, and a cut that lands in the wrong place reports agreement over a
  // set it never saw. Drive it both ways against the doc's real bullet.
  it("flags a job-seed ignore list that drifts from RUNTIME_IGNORES", () => {
    const chunk = seedChunk(readDoc(DOC));
    const clean = claimedPaths(chunk);

    // An entry the runtime does not merge, taught as one it does.
    const extra = chunk.replace("`awake/`", "`awake/`, `sessions/`");
    expect(extra, "the injection was a no-op").not.toEqual(chunk);
    expect(
      claimedPaths(extra).filter((e) => !RUNTIME_IGNORES.includes(e as never)),
      `${DOC}: an invented \`sessions/\` entry went unflagged`,
    ).toEqual(["sessions/"]);

    // An entry the runtime does merge, dropped from the doc.
    const missing = chunk.replace("`node_modules/`, ", "");
    expect(missing, "the removal was a no-op").not.toEqual(chunk);
    const thinned = claimedPaths(missing);
    expect(thinned, `${DOC}: the removal changed nothing`).not.toEqual(clean);
    expect(
      RUNTIME_IGNORES.filter((e) => !thinned.includes(e)),
      `${DOC}: a dropped \`node_modules/\` entry went unflagged`,
    ).toEqual(["node_modules/"]);
  });
});

// Agreement pin (WORKTREE-BASE-DOCS-PINNED, per .claude/rules/engineering.md
// "A seam gate reads what the real writer wrote"): `worktreesBase`
// (`src/paths.ts`) is deliberately the only resolution of the fanout worktree
// base in `src/` — two resolutions agreed only by luck once swept nothing and
// then failed every `git branch -D` against worktrees still standing at the
// real base. README and docs/CHAIN-AUTHORING.md are where an operator and a
// chain author learn that base, and each spells the formula by hand: a third
// and a fourth copy of the one resolution, held by nothing.
//
// A copy reads as authoritative while being stale, and both halves fail
// quietly. An operator who relocates worktrees from a doc naming the wrong
// env var exports a variable the runtime never reads and gets the default
// base with no error; a hook author who reads the wrong default segment
// hardcodes a path the dispatcher never creates. The side both are held to is
// the resolver itself — the env var name and the default segment are read off
// the docs' own words and driven through `worktreesBase`.
//
// `tests/paths.test.ts` pins the resolver's own branches. This pin never
// re-asserts them: it asserts only that what the docs say is what that
// resolver does.
describe("the docs' worktree-base claims agree with worktreesBase", () => {
  /** The two published surfaces that teach where a worktree lands. */
  const BASE_DOCS = ["README.md", join("docs", "CHAIN-AUTHORING.md")];

  /**
   * A state root to resolve against. Never touched on disk — `worktreesBase`
   * is pure — and absolute, so an override probe below is comparable to it
   * without a second `resolve` on this side.
   */
  const FLUME_DIR = resolve("doc-claim-state-root");

  /**
   * The resolution as a doc states it: one backticked
   * `<ENV> ?? join(flumeDir, "<segment>")` token. Both docs write the formula
   * in a single quoted expression, which is why this pin needs no markdown
   * region reader — the claim is the token.
   */
  const FORMULA =
    /^([A-Z][A-Z0-9_]*)\s*\?\?\s*join\(\s*flumeDir\s*,\s*"([^"]+)"\s*\)$/;

  /**
   * A per-entry worktree path template — the state root (spelled
   * `<flumeDir>`, or concretely as this repo's own `.flume`), the segments
   * the doc puts under it, and the entry placeholder that makes the token a
   * claim about *this* base rather than a sibling under the same root. The
   * placeholder anchor is what keeps README's state list — `.flume/awake/…`,
   * `.flume/loop.pid` and the rest — out of a scan about worktrees.
   */
  const TEMPLATE =
    /^(?:<flumeDir>|<repoRoot>\/\.flume|\.flume)\/(.+?)\/<entry[\w-]*>\/?$/;

  const backticked = (text: string): string[] =>
    [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!);

  /** Every `<ENV> ?? join(flumeDir, …)` formula the doc spells. */
  function formulaClaims(text: string): { env: string; segments: string }[] {
    return backticked(text).flatMap((tok) => {
      const m = FORMULA.exec(tok);
      return m ? [{ env: m[1]!, segments: m[2]! }] : [];
    });
  }

  /** Every per-entry template's segment path, e.g. `"worktrees"`. */
  function templateSegments(text: string): string[] {
    return backticked(text).flatMap((tok) => {
      const m = TEMPLATE.exec(tok);
      return m ? [m[1]!] : [];
    });
  }

  /** A doc's claimed base path, built from its own segments. */
  const claimedBase = (segments: string): string =>
    join(FLUME_DIR, ...segments.split("/"));

  /**
   * Every base a doc claims — the formula's default and each per-entry
   * template's — that is not the path the resolver actually builds.
   */
  function baseDisagreements(text: string): string[] {
    const real = worktreesBase(FLUME_DIR);
    return [
      ...formulaClaims(text).map((f) => f.segments),
      ...templateSegments(text),
    ].filter((segments) => claimedBase(segments) !== real);
  }

  const savedOverride = process.env.FLUME_WORKTREES_DIR;

  beforeEach(() => {
    delete process.env.FLUME_WORKTREES_DIR;
  });

  afterEach(() => {
    if (savedOverride === undefined) delete process.env.FLUME_WORKTREES_DIR;
    else process.env.FLUME_WORKTREES_DIR = savedOverride;
  });

  // Vacuity (engineering.md, "A green verdict is proven non-vacuous"): both
  // agreement tests below pass over a doc they found no claim in, and the
  // readers are regexes over prose — a rephrased token silently empties one.
  // This is the populated-corpus assertion that keeps that quiet.
  it("scans one formula and at least one per-entry template in each doc", () => {
    for (const doc of BASE_DOCS) {
      const text = readDoc(doc);
      expect(
        formulaClaims(text),
        `${doc} spells no \`<ENV> ?? join(flumeDir, "…")\` formula the scan ` +
          "can find — restore the token, or this pin is blind",
      ).toHaveLength(1);
      expect(
        templateSegments(text).length,
        `${doc} spells no \`<flumeDir>/…/<entry-slug>\` template the scan ` +
          "can find — restore the placeholder, or this pin is blind",
      ).toBeGreaterThan(0);
    }
  });

  it("every base the docs spell is the path worktreesBase builds by default", () => {
    for (const doc of BASE_DOCS) {
      expect(
        baseDisagreements(readDoc(doc)),
        `${doc} teaches a worktree base worktreesBase (src/paths.ts) does ` +
          `not build — the resolver's default is ${worktreesBase(FLUME_DIR)}`,
      ).toEqual([]);
    }
  });

  it("the env var the docs name is the one worktreesBase reads", () => {
    const override = resolve("doc-claim-override-base");
    for (const doc of BASE_DOCS) {
      const [formula] = formulaClaims(readDoc(doc));
      expect(formula, `${doc}: no formula to read an env var off`).toBeDefined();

      process.env[formula!.env] = override;
      expect(
        worktreesBase(FLUME_DIR),
        `${doc} teaches \`${formula!.env}\` as the worktree-base override, ` +
          "but worktreesBase (src/paths.ts) ignored it",
      ).toBe(override);
      delete process.env[formula!.env];
    }
  });

  // Sensitivity pin (engineering.md, "A green verdict is proven
  // non-vacuous"): the two agreement tests report agreement by finding
  // nothing wrong, which is also what a reader that read nothing reports.
  // Drive each one against a doc edited away from the resolver.
  it("a doc edited away from the resolver is flagged, both halves", () => {
    const text = readDoc("README.md");

    // The formula's default segment, drifted.
    const drifted = text.replace(
      'join(flumeDir, "worktrees")',
      'join(flumeDir, "wt")',
    );
    expect(drifted, "the formula edit was a no-op").not.toEqual(text);
    expect(
      baseDisagreements(drifted),
      "a drifted default segment went unflagged",
    ).toEqual(["wt"]);

    // A per-entry template, drifted away from the formula beside it.
    const retemplated = text.replace(
      "`.flume/worktrees/<entry-slug>/`",
      "`.flume/wt/<entry-slug>/`",
    );
    expect(retemplated, "the template edit was a no-op").not.toEqual(text);
    expect(
      baseDisagreements(retemplated),
      "a drifted per-entry template went unflagged",
    ).toEqual(["wt"]);

    // The env var, drifted to a name the runtime never reads.
    const renamed = text.replace(
      'FLUME_WORKTREES_DIR ?? join(flumeDir, "worktrees")',
      'FLUME_WORKTREE_DIR ?? join(flumeDir, "worktrees")',
    );
    expect(renamed, "the env-var edit was a no-op").not.toEqual(text);
    const [formula] = formulaClaims(renamed);
    expect(formula!.env).toBe("FLUME_WORKTREE_DIR");
    process.env[formula!.env] = resolve("ignored-base");
    expect(
      worktreesBase(FLUME_DIR),
      "an env var the resolver never reads was taught as the override",
    ).toBe(join(FLUME_DIR, "worktrees"));
    delete process.env[formula!.env];
  });
});

// ---------- dead release cites ----------

/**
 * The release-spec corpus (`spec/RELEASE-v*.md`) is gone: one topic file per
 * subject replaced it, and no file carries a `§` numbering a reader can
 * follow. Every `RELEASE-v0.N §M` / `v0.N §M` cite left in `src/` therefore
 * points at a file that does not exist — narration outliving its referent
 * (engineering.md, "Narration is the ladder's bottom rung"). Git carries the
 * provenance those cites were standing in for.
 *
 * `src/Dispatcher.ts` stays out of the loop's scanned set below only because
 * it is pinned on its own, immediately after — its cut has landed. The
 * follow-on RELEASE-CITES-PINNED widens this pin to the whole of `src/` and
 * `examples/`; that entry is the named actor that deletes both the exclusion
 * and the standalone case.
 */
const CITE_EXCLUDED = "Dispatcher.ts";

/**
 * The cite grammar: a `RELEASE-v` prefix on its own, or a version token and a
 * `§` close enough together to be one citation rather than two unrelated
 * mentions. Both orders occur — `v0.8 §4` and `(§6, v0.6.2)` — so both are
 * spelled. Neither alternative crosses a newline, which after `unwrapProse`
 * below survives only where the source left prose.
 */
const RELEASE_CITE_RE =
  /RELEASE-v\d+\.\d+(?:\.\d+)?|v\d+\.\d+(?:\.\d+)?[^§\n]{0,24}§|§[^§v\n]{0,24}v\d+\.\d+(?:\.\d+)?/;

/**
 * Comment prose as one reader-visible run: strip each comment line's `*` /
 * `//` marker and join, so a cite wrapped across two lines still reads as one
 * phrase. Code lines become newlines, which the needle above refuses to
 * cross — two unrelated mentions on either side of a statement never compose
 * into a false hit.
 */
function unwrapProse(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      /^\s*(?:\*|\/\/)/.test(line) ? line.replace(/^\s*(?:\*|\/\/)\s?/, "") : "\n",
    )
    .join(" ");
}

/** Modules under `src/`, sorted, minus the one still-excluded file. */
function citeScannedModules(): string[] {
  return readdirSync(join(REPO_ROOT, "src"))
    .filter((name) => name.endsWith(".ts") && name !== CITE_EXCLUDED)
    .map((name) => join("src", name))
    .sort();
}

describe("dead release cites are gone from the engine's prose", () => {
  const modules = citeScannedModules().map((path) => ({
    path,
    prose: unwrapProse(readFileSync(join(REPO_ROOT, path), "utf8")),
  }));

  // Vacuity pin (engineering.md, "A green verdict is proven non-vacuous"): a
  // mis-built file list scans nothing — or scans only files that never
  // carried a cite — and the refusal below passes over an empty set. Name the
  // heaviest carriers the cut had to reach, and require the scan to have
  // found prose at all.
  it("scans a populated set of src/ modules, the cut's heaviest carriers included", () => {
    expect(modules.length).toBeGreaterThan(0);
    for (const name of ["cli.ts", "job.ts", "Prompt.ts", "PendingSchema.ts"]) {
      expect(modules.map((m) => m.path)).toContain(join("src", name));
    }
    expect(
      modules.filter((m) => m.prose.trim().length > 0).map((m) => m.path),
      "no scanned module yielded prose — unwrapProse is off target",
    ).not.toEqual([]);
  });

  // Sensitivity pin: the refusal reports an empty list whether it is watching
  // or dead. Drive both orders of the grammar, and drive the live pointers
  // that must stay unflagged — a needle that also caught `spec/`,
  // `.claude/rules/`, `docs/` or a quoted test title would delete the
  // engine's working references along with the dead ones.
  it("the release-cite needle flags both orders of the grammar and no live pointer", () => {
    for (const cited of [
      "the fence (RELEASE-v0.7 §2, §5)",
      "pickability (v0.8 §4)",
      "branch grammar retired v0.11 §2/§3",
      "the friction dir (§6, v0.6.2)",
      "supervisor policy (v0.7 §16, opened v0.8 §8)",
    ]) {
      expect(RELEASE_CITE_RE.test(cited), `${cited} went unflagged`).toBe(true);
    }
    for (const live of [
      'spec/pending.md "The pending queue"',
      '`.claude/rules/engineering.md`, "Loud or nothing"',
      'tests/Dispatcher.test.ts, "revert note to the friction channel (§5)": a gate-revert on the longest tag',
      "`docs/MIGRATING-0.10.md` § 5",
      "the v0.6.1 dogfood symptom: three build waves",
    ]) {
      expect(RELEASE_CITE_RE.test(live), `${live} was flagged`).toBe(false);
    }
  });

  // Scanned on its own because `citeScannedModules` still excludes it (see
  // `CITE_EXCLUDED` above). Same needle, same grammar — one module rather
  // than a set, so the cut is pinned a rung up instead of resting on the
  // exclusion's prose.
  it("src/Dispatcher.ts carries no release-numbered spec cite", () => {
    const prose = unwrapProse(
      readFileSync(join(REPO_ROOT, "src", CITE_EXCLUDED), "utf8"),
    );
    // Vacuity pin (engineering.md, "A green verdict is proven non-vacuous"):
    // a mis-resolved path reads as empty prose and the refusal below passes
    // over nothing. Require the engine's largest module's own doc prose, and
    // require it to still carry the live pointers the needle must not flag —
    // a cut that also deleted those would pass an emptier refusal.
    expect(prose.length, "no prose read — wrong path, or unwrapProse is off target").toBeGreaterThan(10_000);
    for (const live of ["spec/loop.md", ".claude/rules/platform-facts.md"]) {
      expect(prose, `${live} pointer left the module`).toContain(live);
    }
    expect(
      RELEASE_CITE_RE.exec(prose)?.[0],
      "a `RELEASE-v0.N §M` / `v0.N §M` cite points at a spec file the corpus " +
        "reform deleted — state the fact, or let git carry the provenance",
    ).toBeUndefined();
  });

  it("no src/ module outside Dispatcher.ts carries a release-numbered spec cite", () => {
    expect(
      modules.filter((m) => RELEASE_CITE_RE.test(m.prose)).map((m) => m.path),
      "a `RELEASE-v0.N §M` / `v0.N §M` cite points at a spec file the corpus " +
        "reform deleted — state the fact, or let git carry the provenance",
    ).toEqual([]);
  });
});
