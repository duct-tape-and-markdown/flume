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
// the engine's own doc comments, and the dogfood chain, which teaches by
// being read as a worked example. Excluded, each for a reason that is about
// the file's job rather than convenience:
//   - `tests/` — a test legitimately drives the retired argv through
//     `extraArgs` to pin that the passthrough still works
//     (tests/Agent.test.ts).
//   - `docs/MIGRATING-*.md` — a migration guide's job is to show the shape
//     you are leaving alongside the one you are moving to.
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The dogfood chain — the surface both retired shapes lived on longest. */
const CHAIN_PATH = join(".flume", "chain.ts");

const RETIRED = [
  {
    // The fallback leg specifically, not every mention of the env var: the
    // canonicalization write-back is real, and documented as the
    // child-process channel.
    what: "a `?? …` fallback beside `process.env.FLUME_DIR`",
    pattern: /process\.env\.FLUME_DIR\s*\?\?/,
    instead: "api.paths.flumeDir",
  },
  {
    what: "`--model` assembled into `extraArgs`",
    pattern: /extraArgs\s*:\s*\[\s*['"]--model['"]/,
    instead: "ClaudeCodeOptions.model",
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
  return [...docs, ...src, "README.md", CHAIN_PATH];
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
  it("scans a populated corpus that discusses both subjects", () => {
    expect(corpus.length).toBeGreaterThan(0);
    expect(corpus.map((f) => f.path)).toContain(CHAIN_PATH);
    for (const needle of ["process.env.FLUME_DIR", "--model"]) {
      expect(
        corpus.filter((f) => f.text.includes(needle)).map((f) => f.path),
        `no scanned file mentions ${needle} — the corpus is off target`,
      ).not.toEqual([]);
    }
  });

  for (const { what, pattern, instead } of RETIRED) {
    it(`teaches ${instead}, never ${what}`, () => {
      expect(
        corpus.filter((f) => pattern.test(f.text)).map((f) => f.path),
        `use ${instead} instead`,
      ).toEqual([]);
    });
  }

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
  const ALLOWED_ORPHANS: Record<string, string> = {
    [`${CHAIN_PATH}: Mandatory-on-every-entry surfaces ride the channel instead of per-entry`]:
      "documents `channelPaths`, two blocks below it; `.flume/chain.ts` is " +
      "outside build's fence, so it is filed in open-questions.md instead",
  };

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
