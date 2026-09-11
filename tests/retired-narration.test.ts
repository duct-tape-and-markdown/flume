import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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

const RETIRED = [
  {
    // The fallback leg specifically, not every mention of the env var: the
    // canonicalization write-back is real, and documented as the
    // child-process channel.
    what: "a `?? …` fallback beside `process.env.FLUME_DIR`",
    pattern: /process\.env\.FLUME_DIR\s*\?\?/,
    instead: "api.paths.flumeDir",
    unfixed: {} as Record<string, string>,
  },
  {
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
    what: "a gate reading a hardcoded plan/pending.json",
    pattern: RECOMPOSED_QUEUE_PATH,
    instead: "GateContext.pendingPath",
    unfixed: {
      [join("src", "Gate.ts")]:
        "`flumeDir`'s own doc uses the queue path as its worked example of a " +
        "state-relative read — src/ is outside the fence of the entry that " +
        "promoted this pin",
    } as Record<string, string>,
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
    ]) {
      expect(
        corpus.filter((f) => f.text.includes(needle)).map((f) => f.path),
        `no scanned file mentions ${needle} — the corpus is off target`,
      ).not.toEqual([]);
    }
  });

  for (const { what, pattern, instead, unfixed } of RETIRED) {
    it(`teaches ${instead}, never ${what}`, () => {
      expect(
        corpus
          .filter((f) => pattern.test(f.text))
          .map((f) => f.path)
          .sort(),
        `use ${instead} instead — or, for a site this entry's fence could ` +
          "not reach, name it in the shape's `unfixed` inventory with why it " +
          "survives",
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
   * Field names declared by `interface <name>` in `text` — the span from its
   * opening brace to the first `}` at column 0, with block and line comments
   * stripped so only declarations are read. Deliberately not `<name>`-aware
   * beyond the word boundary, and deliberately the same reader for both
   * sides: the doc's fenced `ts` block and the engine's own source are the
   * same grammar, so one parser keeps the comparison honest.
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
    return [...body.matchAll(/^\s*(\w+)\??\s*:/gm)].map((m) => m[1]!);
  }

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
