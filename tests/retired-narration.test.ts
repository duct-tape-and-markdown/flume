/**
 * Narration and agreement pins over the published prose: the retired
 * chain-authoring shapes, the chain-authoring doc's restatements of the
 * engine's types, the docs' claims about a state root's layout, the comment
 * cites in `src/` and `examples/`, and the spec-lint refusals over `spec/`.
 *
 * The scanners each pin drives live under `tests/helpers/`, never here. This
 * file is the one red-on-base copies over the pre-fix tree, so a grammar
 * declared in it would ride forward inside that copy and its fix could never
 * go red — the defect the last describe in this file pins against
 * (`tests/helpers/suiteShape.ts`). What stays here is the corpus wiring, the
 * assertions, and the drivers an `it` builds for one of them.
 */
import { readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RUNTIME_IGNORES } from "../src/job.ts";
import { worktreesBase } from "../src/paths.ts";
import {
  CHAIN_PATH,
  REPO_ROOT,
  docsPages,
  exampleChainPaths,
  readDoc,
  scannedPaths,
  specPages,
} from "./helpers/scanCorpus.ts";
import {
  ALLOWED_ENV_MENTIONS,
  DEFAULT_EXPORT,
  RETIRED,
  RETIRED_INBOX_FILE,
  RETIRED_MODEL_ARG,
  RETIRED_ROOT_FALLBACK,
  RECOMPOSED_QUEUE_PATH,
  UNFIXED_SITES,
  pre010Sites,
} from "./helpers/retiredShapes.ts";
import {
  ALLOWED_ORPHANS,
  OPENER,
  OPENER_ANYWHERE,
  SECTION_1,
  arrowRuns,
  cascadeMentions,
  cwdDoc,
  declaredModes,
  declaredPhaseNames,
  declineBullets,
  declineSection,
  docModes,
  docPendingGateOptions,
  docPhaseFields,
  docTableFields,
  docTickContextFields,
  interfaceFields,
  normalizeTs,
  orphanedBlocks,
  predicateReads,
  priorAttemptSection,
  quotedDeclaration,
  singletonConsultRoots,
  variantNames,
} from "./helpers/docAgreement.ts";
import {
  BASE_DOCS,
  DOC_CLAIM_FLUME_DIR as FLUME_DIR,
  FLUME_API_PATH as API_PATH,
  JOB_SEED_DOC as DOC,
  STATE_SCANNED_DOCS as SCANNED_DOCS,
  baseDisagreements,
  childrenClaim,
  claimChunks,
  claimedPaths,
  flumeDirWhole as whole,
  formulaClaims,
  namesSrcSpells,
  seedChunk,
  stateRegion,
  stateRootName,
  templateSegments,
} from "./helpers/docClaims.ts";
import {
  CITE_SHAPES,
  RELEASE_CITE_RE,
  TITLE_CITE_SHAPES,
  citeScannedFiles,
  declaresSymbol,
  declaringBody,
  moduleCites,
  proseOf,
  resolveCite,
  resolveTitleCite,
  titleCites,
} from "./helpers/citeScanners.ts";
import type { TitleCite } from "./helpers/citeScanners.ts";
import {
  SPEC_ABSENT_SYMBOLS,
  SPEC_SRC_PATH_ALLOWLIST,
  indexExports,
  lineLocatorsIn,
  publicSurfaceTypes,
  specSymbolCites,
  srcDeclaringBodies,
  srcPathsIn,
  testFilenamesIn,
  testPathsIn,
  unresolvedSpecCite,
} from "./helpers/specLocators.ts";
import {
  SUITE_PATH,
  declaredGrammar,
  helperImports,
  suiteSource,
} from "./helpers/suiteShape.ts";

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

  // Sensitivity pin (engineering.md, "A green verdict is proven
  // non-vacuous"): every chain declares `ClaudeCodeOptions.model` now, so the
  // model refusal compares [] to [] and a needle that stopped matching would
  // report the same empty inventory. Drive both directions — the spellings a
  // chain author writes, and the engine's own argv assembly, which names the
  // same flag in the same array literal and must stay unflagged.
  it("the model needle flags `--model` assembled into `extraArgs` and not the engine's own argv assembly", () => {
    for (const taught of [
      'agent: claudeCode({ extraArgs: ["--model", "opus"] }),',
      "const buildAgent = claudeCode({ extraArgs: ['--model', MODEL] });",
      'extraArgs: [\n      "--model",\n      "sonnet",\n    ],',
    ]) {
      expect(RETIRED_MODEL_ARG.test(taught), `needle missed: ${taught}`).toBe(
        true,
      );
    }
    const agent = corpus.find((f) => f.path === join("src", "Agent.ts"));
    expect(agent, "src/Agent.ts left the scanned corpus").toBeDefined();
    // The near miss, read off disk rather than paraphrased: the flag opening
    // an argv array literal, and `extraArgs` in the same file — everything
    // the needle keys on except the `extraArgs:` head.
    expect(agent!.text).toContain('["--model"');
    expect(agent!.text).toContain("extraArgs");
    expect(
      RETIRED_MODEL_ARG.test(agent!.text),
      "needle over-fires on the engine's own `--model` assembly",
    ).toBe(false);
  });

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

  // Sensitivity pin (engineering.md, "A green verdict is proven
  // non-vacuous"): the fallback refusal compares [] to [] as well. Its
  // negative control is the inventory above, read off disk rather than
  // paraphrased — both allowed files name the env var, and neither may trip
  // the needle.
  it("the FLUME_DIR-fallback needle flags a `?? …` beside `process.env.FLUME_DIR` and not the mentions the inventory allows", () => {
    for (const taught of [
      "const flumeDir = process.env.FLUME_DIR ?? CHAIN_DIR;",
      'join(process.env.FLUME_DIR ?? CHAIN_DIR, "plan", "state.md")',
      "const root =\n  process.env.FLUME_DIR ??\n  dirname(fileURLToPath(import.meta.url));",
    ]) {
      expect(
        RETIRED_ROOT_FALLBACK.test(taught),
        `needle missed: ${taught}`,
      ).toBe(true);
    }
    expect(Object.keys(ALLOWED_ENV_MENTIONS)).not.toEqual([]);
    for (const [path, why] of Object.entries(ALLOWED_ENV_MENTIONS)) {
      const file = corpus.find((f) => f.path === path);
      expect(file, `${path} left the scanned corpus`).toBeDefined();
      expect(file!.text).toContain("process.env.FLUME_DIR");
      expect(
        RETIRED_ROOT_FALLBACK.test(file!.text),
        `needle over-fires on ${path}: ${why}`,
      ).toBe(false);
    }
    // The tightest of the two, sharpened: `FlumePaths`' doc names the env var
    // and a `??` leg on one line and only the whitespace bound keeps the
    // needle quiet. A denial that stopped saying both is a control lost.
    expect(
      corpus.find((f) => f.path === join("src", "flumeApi.ts"))!.text,
      "FlumePaths' doc no longer denies the fallback on the line that names " +
        "the env var — the needle's closest negative control is gone",
    ).toMatch(/process\.env\.FLUME_DIR[^\n]*\?\?/);
  });

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
  const doc = readDoc("docs", "CHAIN-AUTHORING.md");

  it("the chain-authoring doc's GateResult block names every field src/Gate.ts declares", () => {
    const declared = interfaceFields(readDoc("src", "Gate.ts"), "GateResult");
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
    const declared = interfaceFields(readDoc("src", "Gate.ts"), "Gate");
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
      readDoc("src", "builtinGates.ts"),
      "PendingGateOptions",
    );
    expect(
      declared,
      "src/builtinGates.ts: PendingGateOptions did not parse",
    ).toContain("targetFence");
    expect(declared.length).toBeGreaterThan(2);
    expect(
      docPendingGateOptions(doc).slice().sort(),
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
  const doc = readDoc("docs", "CHAIN-AUTHORING.md");

  it("the chain-authoring doc's Phase field table names every field src/Phase.ts declares", () => {
    const declared = interfaceFields(readDoc("src", "Phase.ts"), "Phase");
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
      docPhaseFields(doc),
      "docs/CHAIN-AUTHORING.md §1: the field table did not parse — the " +
        "heading was reworded, or the table moved",
    ).toContain("name");
    expect(
      docPhaseFields(doc).slice().sort(),
      "docs/CHAIN-AUTHORING.md §1 tabulates Phase: every field src/Phase.ts " +
        "declares gets a row, and nothing it does not declare does",
    ).toEqual(declared.slice().sort());
  });

  // Sensitivity pin: the comparison above is only worth its green if the
  // table reader is keyed on rows and on the first column. Drive both
  // failures the reader is shaped to avoid.
  it("the Phase table reader counts one field per row, from the first column only", () => {
    const fields = docPhaseFields(doc);
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
  const promptSrc = readDoc("src", "Prompt.ts");
  const doc = readDoc("docs", "CHAIN-AUTHORING.md");

  it("the chain-authoring doc's `<prior-attempt>` section names every PriorAttempt mode src/Prompt.ts declares", () => {
    const declared = declaredModes(promptSrc);
    // Vacuity (engineering.md, "A green verdict is proven non-vacuous"): a
    // reader that lost the union, or one that found interfaces but no `mode`
    // literal, would compare two empty sets forever.
    expect(
      variantNames(promptSrc).length,
      "src/Prompt.ts: the PriorAttempt union did not parse",
    ).toBeGreaterThan(4);
    expect(declared, "src/Prompt.ts: no `mode` literal parsed").toContain(
      "gate-revert",
    );
    expect(
      declared.length,
      "src/Prompt.ts: a PriorAttempt variant declared no `mode` literal",
    ).toBe(variantNames(promptSrc).length);
    expect(
      docModes(doc),
      "docs/CHAIN-AUTHORING.md: the `<prior-attempt>` section's mode bullets " +
        "did not parse — the heading was reworded, or the list moved",
    ).toContain("gate-revert");
    expect(
      docModes(doc).slice().sort(),
      "docs/CHAIN-AUTHORING.md's `<prior-attempt>` section enumerates the " +
        "PriorAttempt union: every mode src/Prompt.ts declares gets a bullet, " +
        "and nothing it does not declare does",
    ).toEqual(declared.slice().sort());
  });

  it("the `<prior-attempt>` section teaches the anchor every record carries and the record-side flake marker", () => {
    const body = priorAttemptSection(doc);
    // Vacuity: hold the doc against what the union actually declares, so a
    // renamed engine field fails here rather than leaving the doc teaching a
    // field no record has.
    for (const name of variantNames(promptSrc)) {
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
  const phaseSrc = readDoc("src", "Phase.ts");
  const dispatcherSrc = readDoc("src", "Dispatcher.ts");
  const doc = readDoc("docs", "CHAIN-AUTHORING.md");

  it("the TickContext.cwd doc comment names the repo root a singleton shouldRun sees", () => {
    const block = cwdDoc(phaseSrc);
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
      singletonConsultRoots(dispatcherSrc),
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
    const bullets = declineBullets(doc);
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
    // The gloss on `cwd` alone — the `Role` cell of its own row in the §1
    // `TickContext` table. Scoped to that one cell because the `pickable`
    // and `pending` rows gloss themselves as "for a singleton phase", which
    // would satisfy a match over the whole table while `cwd` still read as
    // unconditionally a worktree.
    const gloss = (
      /^\|\s*`cwd`\s*\|([^|]*)\|/m.exec(doc)?.[1] ?? ""
    ).replace(/\s+/g, " ");
    expect(
      gloss,
      "docs/CHAIN-AUTHORING.md: the `TickContext` table's `cwd` row was " +
        "reworded — it is the first place a reader learns what `cwd` is",
    ).not.toBe("");
    expect(
      gloss,
      "the gloss must not teach `cwd` as unconditionally a worktree path",
    ).toMatch(/singleton/i);
  });
});

// Agreement pin (TICKCONTEXT-DOC-TABULATES-FIELDS, per
// .claude/rules/engineering.md "Derived state is computed, never restated
// beside its source"): §1 of docs/CHAIN-AUTHORING.md is where a chain author
// learns what arrives on a `TickContext`, and it taught the interface by
// restating it — first as a summary naming three of the fields
// `src/Phase.ts` declares, then as one naming all six. A field absent from
// the page is a fact no chain knows it receives: `pickable` and
// `priorAttempts` exist precisely so a hook stops re-deriving pickability
// and scanning the engine's prior-attempts directory.
//
// Free prose can only be held in one direction — every declared field is
// named *somewhere* in it — because a paragraph backticks siblings
// (`shouldRun`, `{{FLUME_DIR}}`) legitimately, so a name the interface no
// longer declares cannot be told from one it never declared. A field
// retired from `src/Phase.ts` left its clause standing and nothing failed.
// The restating side is therefore a table, one row per field, read by the
// same row/first-column reader the `Phase` table above is held to and
// compared set-equal both ways.
describe("the chain-authoring doc teaches every TickContext field", () => {
  const doc = readDoc("docs", "CHAIN-AUTHORING.md");
  const exampleSrc = readDoc("examples", "cascade-chain.ts");

  it("the chain-authoring doc's TickContext field table names every field src/Phase.ts declares and no others", () => {
    const declared = interfaceFields(readDoc("src", "Phase.ts"), "TickContext");
    // Vacuity (engineering.md, "A green verdict is proven non-vacuous"): a
    // reader that found nothing on either side would compare two empty sets
    // forever, and one that stopped at the first wrapped member would agree
    // with a table missing everything after it.
    expect(declared, "src/Phase.ts: TickContext did not parse").toContain(
      "cwd",
    );
    expect(
      declared,
      "src/Phase.ts: TickContext declares `priorAttempts` last — the reader " +
        "stopped short of it",
    ).toContain("priorAttempts");
    expect(declared.length).toBeGreaterThan(3);
    expect(
      docTickContextFields(doc),
      "docs/CHAIN-AUTHORING.md §1: the `TickContext` field table did not " +
        "parse — its header was reworded, or the table moved",
    ).toContain("cwd");
    expect(
      docTickContextFields(doc).slice().sort(),
      "docs/CHAIN-AUTHORING.md §1 tabulates TickContext: every field " +
        "src/Phase.ts declares gets a row, and nothing it does not declare " +
        "does",
    ).toEqual(declared.slice().sort());
  });

  // Sensitivity pin: the comparison above is only worth its green in both
  // directions if the table reader is keyed on rows and on the first column,
  // and if it cannot stray into the `Phase` table sharing the section. Drive
  // each failure the reader is shaped to avoid.
  it("the TickContext table reader counts one field per row, from the first column only", () => {
    const fields = docTickContextFields(doc);
    expect(fields.length, "the table yielded no rows").toBeGreaterThan(3);
    // One name per row, no duplicates — the `cwd` row's prose cites
    // `flumeDir`, which has its own row and must not be counted twice.
    expect(new Set(fields).size).toBe(fields.length);
    const citing = doc.split("\n").filter((l) => /^\|\s*`cwd`\s*\|/.test(l));
    expect(citing, "the cwd row left the table").toHaveLength(1);
    expect(
      citing[0],
      "the second-column cross-reference this reader must ignore is gone — " +
        "the sensitivity check is vacuous",
    ).toContain("`flumeDir`");
    // The two §1 tables are told apart by their second-column heading alone.
    // A reader that matched the other one would report `Phase`'s fields here
    // and still compare two populated sets.
    expect(
      fields,
      "the reader reached the `Phase` table's rows",
    ).not.toContain("promptPath");
    expect(
      docTableFields(doc, SECTION_1, /^\| Field\s*\| Role/),
      "the `Phase` table reader reached the `TickContext` table's rows",
    ).not.toContain("priorAttempts");
  });

  it("the chain-authoring decline section names every TickContext field the quoted predicate reads", () => {
    const reads = predicateReads(exampleSrc);
    const declared = interfaceFields(readDoc("src", "Phase.ts"), "TickContext");
    // Vacuity: a predicate reader that found nothing, or that picked up a
    // name the interface does not declare, would hold the prose to nothing.
    expect(
      reads,
      "examples/cascade-chain.ts: the plan phase's `shouldRun` body did not " +
        "parse — the declaration was rewrapped or renamed",
    ).toContain("pickable");
    expect(reads.length).toBeGreaterThan(1);
    for (const field of reads) {
      expect(
        declared,
        `examples/cascade-chain.ts reads ctx.${field}, which src/Phase.ts ` +
          `does not declare`,
      ).toContain(field);
    }
    const section = declineSection(doc);
    expect(
      section,
      "docs/CHAIN-AUTHORING.md: the `shouldRun` section did not parse — the " +
        "heading was reworded, or the section moved",
    ).toContain("concurrency");
    for (const field of reads) {
      expect(
        section,
        `docs/CHAIN-AUTHORING.md: the decline section never names ` +
          `\`${field}\`, so the worked predicate reads a fact the prose that ` +
          `explains it leaves unnamed`,
      ).toMatch(new RegExp("`(?:ctx\\.)?" + field + "`"));
    }
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
  const doc = readDoc("docs", "CHAIN-AUTHORING.md");

  it("the chain-authoring doc's quoted plan phase agrees with examples/cascade-chain.ts", () => {
    const { id, quoted, example } = quotedDeclaration(doc, readDoc("examples", "cascade-chain.ts"));
    // Vacuity (engineering.md, "A green verdict is proven non-vacuous"): two
    // spans that failed to parse agree forever — and a claim naming no
    // identifier would resolve neither side.
    expect(
      id,
      "docs/CHAIN-AUTHORING.md: no block claims to quote a declaration from " +
        "examples/cascade-chain.ts — the sentence was reworded",
    ).not.toBe("");
    expect(
      example,
      `examples/cascade-chain.ts: \`${id}\` did not parse`,
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
    const { example } = quotedDeclaration(doc, readDoc("examples", "cascade-chain.ts"));
    expect(example, "the example's quoted declaration did not parse").toContain(
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
  it("README's cascade description names the phases cascade-chain.ts declares", () => {
    const declared = declaredPhaseNames();
    // Vacuity (engineering.md, "A green verdict is proven non-vacuous"): a
    // chain that shipped no phases, or a README that stopped naming them,
    // agrees with anything. Cascade's plan is a ladder, so the list is longer
    // than the one-planner shape and the order is load-bearing.
    expect(
      declared,
      "examples/cascade-chain.ts: the chain shipped no phases",
    ).not.toHaveLength(0);
    expect(declared.length).toBeGreaterThan(2);

    const listings = cascadeMentions(readDoc("README.md")).flatMap(arrowRuns);
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
// Scope is the TypeScript half of the scanned corpus: the same files, minus the
// markdown ones, where a doc block is a source shape rather than a fenced
// example.
describe("no doc block is orphaned", () => {
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

  // Sensitivity pin (engineering.md, "A green verdict is proven
  // non-vacuous"): no source in the scanned set carries an orphan, so the
  // refusal below compares [] to [] — a scanner that stopped recognising an
  // opener, or stopped scanning forward across the blank lines between two
  // blocks, reports the same empty result. Drive it against the real file
  // with one block pushed in front of an attached one: the injected block
  // comes back, and the attached block it now precedes does not.
  it("the orphan scan flags an injected doc block followed by another and leaves an attached block unflagged", () => {
    const dispatcher = sources.find(
      (f) => f.path === join("src", "Dispatcher.ts"),
    );
    expect(dispatcher, "src/Dispatcher.ts left the scanned set").toBeDefined();
    expect(
      dispatcher!.orphans,
      "src/Dispatcher.ts already carries an orphan — the control is not clean",
    ).toEqual([]);

    const lines = dispatcher!.text.split("\n");
    // The first block past the module header: a real block on its real
    // symbol, so the injection is judged against the file's own shape rather
    // than against a fixture written by the same hand as the expectation.
    const attached = lines.findIndex((l, i) => i > 0 && OPENER.test(l.trim()));
    expect(
      attached,
      "src/Dispatcher.ts has no doc block past its module header",
    ).toBeGreaterThan(0);

    const injected = [
      ...lines.slice(0, attached),
      "/**",
      " * Injected orphan: prose whose next non-blank line opens another block.",
      " */",
      "",
      ...lines.slice(attached),
    ].join("\n");

    expect(
      orphanedBlocks(dispatcher!.path, injected).map((o) => o.id),
      "the scan must report the injected block and nothing else — the " +
        "attached block it now precedes still documents its own symbol",
    ).toEqual([
      `${dispatcher!.path}: Injected orphan: prose whose next non-blank ` +
        "line opens another block.",
    ]);
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
  const spelled = namesSrcSpells();

  it("the harness-managed state scan covers both README.md and docs/CHAIN-AUTHORING.md", () => {
    // Vacuity (engineering.md, "A green verdict is proven non-vacuous"): a
    // marker that stopped matching, or a region that collapsed to the header
    // line, would leave the refusal below judging an empty claim set in a doc
    // that still teaches the layout.
    for (const doc of SCANNED_DOCS) {
      const region = stateRegion(readDoc(doc));
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
      const claimed = claimChunks(stateRegion(readDoc(doc))!)
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
      const region = stateRegion(readDoc(doc))!;
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
      const region = stateRegion(readDoc(doc))!;
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

// Ownership pin (FLUMEDIR-DOC-NAMES-WORKTREES, per .claude/rules/engineering.md
// "Derived state is computed, never restated beside its source"): the
// `flumeDir` doc comment listed the state root's children, and `worktrees`
// was on that list. It is not a child the root owns — `worktreesBase`
// (src/paths.ts) resolves `FLUME_WORKTREES_DIR` ahead of the root, so the
// list was a second, stale copy of a fact one resolver already holds, sitting
// on the interface a chain author reads to learn where to put things. This is
// the refusal that keeps it off: the list names only children the root
// actually roots, and the comment points at the resolver for the one it does
// not.
describe("`FlumePaths.flumeDir`'s doc comment lists only children it roots", () => {
  // Vacuity (engineering.md, "A green verdict is proven non-vacuous"): the
  // claim below is an absence over a paragraph a reader regex produced. A
  // reworded comment that the block finder misses, or an opening paragraph
  // that names nothing, reports the same clean absence as a correct one.
  it("scans a children claim that names at least one state-root child", () => {
    const claim = childrenClaim(readDoc(API_PATH));
    expect(
      claim,
      `${API_PATH}: \`flumeDir\`'s opening paragraph read empty — restore ` +
        "the list, or this pin is blind",
    ).not.toBe("");
    expect(
      [...claim.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!),
      `${API_PATH}: \`flumeDir\`'s opening paragraph names no child in ` +
        "backticks — the scan has nothing to hold",
    ).not.toHaveLength(0);
  });

  it("the FlumePaths.flumeDir doc comment does not name worktrees as a state-root child", () => {
    expect(
      childrenClaim(readDoc(API_PATH)),
      `${API_PATH}: \`flumeDir\` is taught as rooting worktrees, which ` +
        "`FLUME_WORKTREES_DIR` makes false — worktreesBase (src/paths.ts) " +
        "resolves the override ahead of the state root",
    ).not.toMatch(/worktree/i);
  });

  it("the comment points at worktreesBase for the child it does not root", () => {
    expect(
      whole(readDoc(API_PATH)),
      `${API_PATH}: \`flumeDir\` drops worktrees from its list without ` +
        "sending the reader to the resolver that owns the base",
    ).toMatch(/worktreesBase/);
  });

  // Sensitivity pin (engineering.md, "A green verdict is proven
  // non-vacuous"): the claim reports compliance by finding nothing, which is
  // also what a reader that read the wrong paragraph reports. Drive it
  // against a comment with the child put back.
  it("a reintroduced worktrees child in the list is flagged", () => {
    const text = readDoc(API_PATH);
    const restated = text.replace(
      "baton (`awake/`), pending, rendered prompts, prior",
      "baton (`awake/`), pending, worktrees, rendered prompts, prior",
    );
    expect(restated, "the reintroduction edit was a no-op").not.toEqual(text);
    expect(
      childrenClaim(restated),
      "a restated worktrees child went unflagged",
    ).toMatch(/worktree/i);
  });
});

// ---------- dead release cites ----------
//
// Why the shape is dead, what `docs/` partition exempts a page, and the
// grammar itself: tests/helpers/citeScanners.ts.

describe("dead release cites are gone from src/, examples/, and current docs", () => {
  const files = citeScannedFiles().map((path) => ({
    path,
    prose: proseOf(path, readFileSync(join(REPO_ROOT, path), "utf8")),
  }));

  // Vacuity pin (engineering.md, "A green verdict is proven non-vacuous"): a
  // mis-built file list scans nothing — or scans only files that never
  // carried a cite — and the refusal below passes over an empty set. Name the
  // heaviest carriers the cut had to reach in each tree, name one file only
  // the recursive descent reaches, and require the engine's largest module to
  // have yielded its doc prose rather than an empty read.
  it("scans a populated set of src/ and examples/ files, the cut's heaviest carriers included", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const name of [
      join("src", "Dispatcher.ts"),
      join("src", "cli.ts"),
      join("src", "job.ts"),
      join("src", "Prompt.ts"),
      join("src", "PendingSchema.ts"),
      join("examples", "cascade-chain.ts"),
      join("examples", "backlog-groomer-chain.ts"),
      join("examples", "minimal-chain.ts"),
      join("examples", "prompts", "build.md"),
      join("docs", "CHAIN-AUTHORING.md"),
      join("docs", "CLI.md"),
    ]) {
      expect(files.map((f) => f.path)).toContain(name);
    }
    // The dated half is out, and stays out by its own declaration rather than
    // by a name listed here — a page that dropped its marker rejoins the scan.
    for (const p of docsPages().filter((p) => p.dated)) {
      expect(files.map((f) => f.path), `${p.path} is scanned despite declaring itself dated`).not.toContain(p.path);
    }
    const dispatcher = files.find((f) => f.path === join("src", "Dispatcher.ts"))!;
    expect(
      dispatcher.prose.length,
      "no prose read — wrong path, or proseOf is off target",
    ).toBeGreaterThan(10_000);
    // The live pointers the needle must not flag, read off the module that
    // carries the most of them: a cut that deleted those too would pass an
    // emptier refusal.
    for (const live of ["spec/loop.md", ".claude/rules/platform-facts.md"]) {
      expect(dispatcher.prose, `${live} pointer left the module`).toContain(live);
    }
    expect(
      files.filter((f) => f.prose.trim().length > 0).map((f) => f.path),
      "no scanned file yielded prose — proseOf is off target",
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

  const CUT_HINT =
    "a `RELEASE-v0.N §M` / `v0.N §M` cite points at a spec file the corpus " +
    "reform deleted — name the live `spec/*.md` section instead, or drop the " +
    "pointer and let git carry the provenance";

  it("no file under src/ or examples/ carries a release-numbered spec cite", () => {
    expect(
      files
        .filter((f) => !f.path.startsWith(`docs${sep}`))
        .filter((f) => RELEASE_CITE_RE.test(f.prose))
        .map((f) => f.path),
      CUT_HINT,
    ).toEqual([]);
  });

  it("no current-reference docs page carries a release-numbered spec cite", () => {
    const pages = files.filter((f) => f.path.startsWith(`docs${sep}`));
    // Vacuity pin (engineering.md, "A green verdict is proven non-vacuous"):
    // every page could have declared itself a dated record, and this refusal
    // would pass over nothing. Name the two the cut had to reach.
    for (const name of ["CHAIN-AUTHORING.md", "CLI.md"]) {
      expect(
        pages.map((f) => f.path),
        `${name} left the scanned half of docs/`,
      ).toContain(join("docs", name));
    }
    expect(pages.filter((f) => RELEASE_CITE_RE.test(f.prose)).map((f) => f.path), CUT_HINT).toEqual([]);
  });

  it("every docs page is either scanned for release cites or declared a dated record", () => {
    const pages = docsPages();
    expect(pages.length, "docs/ holds no pages — the partition is vacuous").toBeGreaterThan(0);
    expect(
      pages.filter((p) => !p.current && !p.dated).map((p) => p.path),
      "a docs page declares neither status. Under its H1 put `> **Current " +
        "reference.** …` — and then it is scanned, so its spec cites must " +
        "name live sections — or `> **Dated record.** …`, naming the moment " +
        "it describes, which exempts the cites that moment owned",
    ).toEqual([]);
    expect(
      pages.filter((p) => p.current && p.dated).map((p) => p.path),
      "a docs page declares both statuses — it is one or the other",
    ).toEqual([]);
    // The dated half earns itself: if no exempted page carried a cite, the
    // exemption is buying nothing and the partition is ceremony.
    expect(
      pages
        .filter((p) => p.dated && RELEASE_CITE_RE.test(proseOf(p.path, p.text)))
        .map((p) => p.path),
      "no dated record carries a release cite — nothing needs the exemption",
    ).not.toEqual([]);
  });
});

// ---------- module-path cites ----------
//
// Why a cite rots, why resolution is *declares* and not *references*, and the
// three shapes the corpus writes: tests/helpers/citeScanners.ts.

describe("module-path cites in src/ and examples/ resolve against the tree", () => {
  const cites = moduleCites();

  // Vacuity pin (engineering.md, "A green verdict is proven non-vacuous"): a
  // grammar that matches nothing, or only one of the two shapes, leaves the
  // refusal below passing over an empty set. Both shapes are load-bearing —
  // the corpus writes overwhelmingly in the parenthesized one, and the colon
  // shape is the one a `path:symbol` extraction strands most quietly.
  it("the comment module-path scan reads a populated set of cites in both the colon and the parenthesized shape", () => {
    expect(cites.length, "no cite matched — the grammar is off target").toBeGreaterThan(20);
    expect(cites.filter((c) => c.shape === "parenthesized").length).toBeGreaterThan(20);
    expect(cites.filter((c) => c.shape === "colon").length).toBeGreaterThan(0);
    // Named carriers: the engine's heaviest cross-referencing modules, and
    // the worked chain — a file list that lost any of them would refuse over
    // a thinner corpus than the one this scan exists to hold.
    for (const from of [join("src", "Phase.ts"), join("src", "paths.ts"), join("src", "job.ts"), join("examples", "cascade-chain.ts")]) {
      expect(cites.map((c) => c.from), `${from} yielded no cite`).toContain(from);
    }
  });

  // Sensitivity pin: the grammar reports an empty list whether it is watching
  // or dead, and `declaresSymbol` reports true whether it is reading a
  // declaration or an import. Drive both over hand-authored input — a
  // refusal's own input is the one case the real writer cannot produce
  // (engineering.md, "A seam gate reads what the real writer wrote").
  it("the cite grammar reads every shape the corpus writes, and no clause-ending path", () => {
    const found = (prose: string) =>
      CITE_SHAPES.flatMap(({ re, pathAt, symbolAt }) =>
        [...prose.matchAll(re)].map((m) => `${m[pathAt]}:${m[symbolAt]}`),
      );
    expect(found("the same helper `quarantineKey` (`src/Dispatcher.ts`) builds")).toContain("src/Dispatcher.ts:quarantineKey");
    expect(found("told via FLUME_TIP_CLAIM_HELD (set by `defaultTickRunner`, src/loopSupervisor.ts) —")).toContain("src/loopSupervisor.ts:defaultTickRunner");
    expect(found("reads the second as the first (`src/flumeApi.ts`, `git.readFileAtRef`)")).toContain("src/flumeApi.ts:git.readFileAtRef");
    expect(found("the phase name for a singleton one (`src/priorAttempts.ts:priorAttemptRef`)")).toContain("src/priorAttempts.ts:priorAttemptRef");
    // Not cites: a path ending a clause, and a `path:NN` line pointer that
    // names no symbol at all.
    expect(found("`writeRevertNote` stays in `src/Dispatcher.ts`: it is the gate-revert note")).not.toContain("src/Dispatcher.ts:it");
    expect(found("`superviseLoop` (`src/loopSupervisor.ts:170`, both occurrences)")).not.toContain("src/loopSupervisor.ts:170");
  });

  it("`declaresSymbol` reads a declaration and refuses an import of the same name", () => {
    const declaring = declaringBody(
      [
        `import { superviseLoop } from "./loopSupervisor.js";`,
        `import {`,
        `  harvestFriction,`,
        `} from "./friction.js";`,
        `export function priorAttemptRef(phase: string): string {`,
        `  return phase;`,
        `}`,
        `interface Opts {`,
        `  maxParallel?: number;`,
        `}`,
      ].join("\n"),
    );
    expect(declaresSymbol(declaring, "priorAttemptRef")).toBe(true);
    expect(declaresSymbol(declaring, "maxParallel")).toBe(true);
    expect(declaresSymbol(declaring, "superviseLoop"), "an import counts as a declaration — the scan is toothless").toBe(false);
    expect(declaresSymbol(declaring, "harvestFriction"), "a multi-line import's binding counts as a declaration").toBe(false);
  });

  // The dotted half of the grammar, named because it is the rule a reader
  // would otherwise have to guess: `Chain.supervisorPolicy.maxParallel`
  // resolves as `maxParallel`, in the module the cite names.
  it("a cite whose symbol is dotted resolves against its last segment in the named file", () => {
    const dotted = cites.filter((c) => c.symbol.includes("."));
    expect(dotted.length, "no dotted cite in the corpus — the rule is pinning nothing").toBeGreaterThan(0);
    expect(dotted.map((c) => resolveCite(c)).filter((p) => p !== null)).toEqual([]);
    // The rule is the last segment, not the whole dotted string: a module
    // declaring the leaf need not declare the path in front of it.
    const chained = dotted.find((c) => c.symbol.split(".").length > 2);
    expect(chained, "no multi-segment cite — the last-segment rule is untested").toBeDefined();
    expect(declaresSymbol(declaringBody(readFileSync(join(REPO_ROOT, chained!.path), "utf8")), chained!.symbol)).toBe(false);
  });

  it("every module-path cite in a `src/` or `examples/` comment names a file that declares the symbol", () => {
    expect(
      cites.map((c) => resolveCite(c)).filter((p) => p !== null),
      "a doc comment points at a module that no longer declares the symbol — repoint it at the declaring module",
    ).toEqual([]);
  });
});

// ---------- quoted test-title cites ----------
//
// Why the symbol grammar cannot see one, and why resolution is by title:
// tests/helpers/citeScanners.ts.

describe("quoted test-title cites in src/ and examples/ resolve against the suite", () => {
  const cites = titleCites();

  // Vacuity pin (engineering.md, "A green verdict is proven non-vacuous"):
  // this needle exists because the shape it reads was selected at zero by the
  // symbol grammar, so an empty selection here is the exact failure it was
  // added to end. Both orders are load-bearing — the corpus writes mostly
  // path-first, and the title-first order is what a reader writes when the
  // claim, not the file, is the sentence's subject.
  it("the quoted-title cite scan reads a populated set of cites across both orders the corpus writes", () => {
    expect(cites.length, "no test-title cite matched — the grammar is off target").toBeGreaterThanOrEqual(5);
    expect(cites.filter((c) => c.order === "path-first").length).toBeGreaterThan(0);
    expect(cites.filter((c) => c.order === "title-first").length).toBeGreaterThan(0);
    // Named carriers: the modules that state a default here and pin it in a
    // suite over there, which is the whole reason this cite shape exists. A
    // file list that lost one would refuse over a thinner corpus.
    for (const from of [
      join("src", "paths.ts"),
      join("src", "Prompt.ts"),
      join("src", "Dispatcher.ts"),
      join("src", "loopSupervisor.ts"),
    ]) {
      expect(cites.map((c) => c.from), `${from} yielded no test-title cite`).toContain(from);
    }
  });

  // Sensitivity pin: the grammar reports an empty list whether it is watching
  // or dead, and `resolveTitleCite` reports null whether it read the title or
  // read nothing at all. Drive both over hand-authored input — a refusal's
  // own input is the one case the real writer cannot produce
  // (engineering.md, "A seam gate reads what the real writer wrote").
  it("the quoted-title needle flags a cite whose named file does not carry the title and leaves the resolving ones unflagged", () => {
    const found = (prose: string) =>
      TITLE_CITE_SHAPES.flatMap(({ re, pathAt, titleAt }) =>
        [...prose.matchAll(re)].map((m) => `${m[pathAt]}|${m[titleAt]}`),
      );
    expect(
      found(`byte shape pinned by tests/Prompt.test.ts's "byte-identical to the pre-§2 collapsed rendering" case`),
    ).toContain("tests/Prompt.test.ts|byte-identical to the pre-§2 collapsed rendering");
    expect(
      found(`pinned against the real writer by tests/Dispatcher.test.ts, "revert note to the friction channel (§5)": a gate-revert`),
    ).toContain("tests/Dispatcher.test.ts|revert note to the friction channel (§5)");
    expect(
      found(`at most one record per tag, pinned by "records exactly one mergeOutcomes entry for that tag" (tests/Dispatcher.test.ts).`),
    ).toContain("tests/Dispatcher.test.ts|records exactly one mergeOutcomes entry for that tag");
    // Not a cite: a path ending a clause, with an unrelated quoted phrase
    // further along the same sentence.
    expect(found('the seam lives in `tests/Gate.test.ts`: the omit case calls it "the unset environment"')).toEqual([]);

    const stale: TitleCite = {
      from: join("src", "loopSupervisor.ts"),
      path: join("tests", "Dispatcher.test.ts"),
      title: "a chain declaring neither knob gets the supervisor-policy defaults, byte-identical",
      order: "path-first",
    };
    expect(
      resolveTitleCite(stale),
      "an extraction-stranded cite resolves — the scan is toothless",
    ).toMatch(/carries no such title/);
    expect(resolveTitleCite({ ...stale, path: join("tests", "loopSupervisor.test.ts") })).toBeNull();
    expect(resolveTitleCite({ ...stale, path: join("tests", "no-such-file.test.ts") })).toMatch(/does not exist/);
  });

  it("every quoted test-title cite in a `src/` or `examples/` comment names a file that carries the title", () => {
    expect(
      cites.map((c) => resolveTitleCite(c)).filter((p) => p !== null),
      "a doc comment quotes a test title the named suite no longer carries — repoint it at the suite that runs it",
    ).toEqual([]);
  });
});

// Spec-lint pin (per .claude/rules/spec-writing.md, "A claim names behavior,
// never location"): a `src/` path, a `path:NN` locator and a `tests/` cite are
// each layout, and layout rots on the next extraction while still reading as
// authoritative. The needles, the allowlist, and the reason each surviving
// path is a claim's subject rather than a route: tests/helpers/specLocators.ts.
describe("spec/ names public surface, never a path locator", () => {
  const pages = specPages();

  // Vacuity pin (engineering.md, "A green verdict is proven non-vacuous"): a
  // page list built off a filtered or hand-kept subset would leave both
  // refusals below passing over the pages they never read. Name the heaviest
  // carriers, and require a page that carries nothing — coverage is the
  // directory, not the set of hits.
  it("the spec locator scan reads every page of spec/", () => {
    expect(pages.length, "spec/ read empty — the scan is off target").toBeGreaterThan(0);
    for (const page of pages) {
      expect(page.text.length, `${page.path} read empty`).toBeGreaterThan(0);
    }
    for (const carrier of ["chain.md", "pending.md", "cli.md"]) {
      expect(
        pages.map((p) => p.path),
        `spec/${carrier} left the scanned set`,
      ).toContain(join("spec", carrier));
    }
    expect(
      pages.filter((p) => srcPathsIn(p.text).length === 0).map((p) => p.path),
      "every scanned page carries a path — the scan may be reading only carriers",
    ).not.toEqual([]);
  });

  it("every `src/` file path in a spec page is one the locator allowlist declares", () => {
    const sites = pages.flatMap((p) =>
      srcPathsIn(p.text).map((path) => ({ page: p.path, path })),
    );
    const found = [...new Set(sites.map((s) => s.path))].sort();
    expect(found.length, "no spec page names a `src/` path — prune the allowlist").toBeGreaterThan(0);
    expect(
      found,
      "a spec sentence names a `src/` file path: state the behavior or the " +
        "public name instead, or — where the module itself is the claim's " +
        "subject — declare it in the allowlist with that reason. Sites: " +
        sites.map((s) => `${s.page} → ${s.path}`).join(", "),
    ).toEqual(Object.keys(SPEC_SRC_PATH_ALLOWLIST).sort());
  });

  it("no spec page carries a `path:NN` line locator", () => {
    const sites = pages.flatMap((p) =>
      lineLocatorsIn(p.text).map((hit) => `${p.path} → ${hit}`),
    );
    expect(
      sites,
      "a line number is layout at its most perishable — cite the heading or " +
        "the public name the line declares",
    ).toEqual([]);
  });

  // Empty by design (engineering.md, "A green verdict is proven
  // non-vacuous"): this selection is legitimately zero — the corpus cites no
  // test file today — so the zero is asserted here and proved real by the
  // sensitivity pin below, never inherited from a needle nobody drove.
  it("no spec page cites a path under tests/", () => {
    const sites = pages.flatMap((p) =>
      testPathsIn(p.text).map((hit) => `${p.path} → ${hit}`),
    );
    expect(
      sites,
      "tests pin the spec; the spec does not cite them — state the behavior " +
        "the test pins, or the public name it drives",
    ).toEqual([]);
    expect(
      pages.flatMap((p) => testPathsIn(p.text)).length,
      "the tests/ refusal is empty by design, not by a dead needle",
    ).toBe(0);
  });

  // Empty by design, the rootless spelling of the same refusal: a sentence
  // that drops the root still hands the reader one file to open. Zero
  // asserted here, proved real by the sensitivity pin below.
  it("no spec page cites a bare test filename", () => {
    const sites = pages.flatMap((p) =>
      testFilenamesIn(p.text).map((hit) => `${p.path} → ${hit}`),
    );
    expect(
      sites,
      "a test filename with the root dropped is still a locator — state the " +
        "behavior the suite pins, or the public name it drives",
    ).toEqual([]);
    expect(
      pages.flatMap((p) => testFilenamesIn(p.text)).length,
      "the rootless refusal is empty by design, not by a dead needle",
    ).toBe(0);
  });

  // Sensitivity pin (engineering.md, "A green verdict is proven
  // non-vacuous"): the line-locator refusal passes over an empty set by
  // design, and the allowlist refusal reports its inventory whether the
  // needle is watching or dead. Drive both over a real page with a locator
  // injected — the corpus cannot produce the violation itself — and over the
  // spellings the corpus does write, which must stay unflagged.
  it("the locator grammar flags an injected `src/` path and an injected line locator", () => {
    const clean = pages.find(
      (p) => srcPathsIn(p.text).length === 0 && lineLocatorsIn(p.text).length === 0,
    );
    expect(clean, "no spec page is free of both shapes — nothing to inject into").toBeDefined();
    const injectedPath = `${clean!.text}\nThe baton lives in \`src/Baton.ts\`.\n`;
    expect(srcPathsIn(injectedPath)).toContain("src/Baton.ts");
    const injectedLine = `${clean!.text}\nSee \`src/Baton.ts:42\` for the claim.\n`;
    expect(lineLocatorsIn(injectedLine)).toContain("src/Baton.ts:42");
    expect(
      lineLocatorsIn(`${clean!.text}\nSee \`spec/chain.md:120\`.\n`),
      "a line locator aimed at a sibling page is the same defect",
    ).toContain("spec/chain.md:120");

    for (const denied of [
      "a section that no longer matches `src/` is a defect in one of them",
      "the harness keeps `src/` and `.flume/` apart",
    ]) {
      expect(srcPathsIn(denied), `path needle over-fires on: ${denied}`).toEqual([]);
    }
    for (const denied of [
      "receives the same runtime-ignore merge a job dir does (`spec/jobs.md`, *Runtime ignores*).",
      "`enableGlobalVirtualStore` (`pnpm-workspace.yaml`, https://pnpm.io:443/git-worktrees) is documented",
      "the exec-local doctrine lives in `spec/cli.md`; this page does not restate it",
    ]) {
      expect(lineLocatorsIn(denied), `line needle over-fires on: ${denied}`).toEqual([]);
    }
  });

  // Sensitivity pin (engineering.md, "A green verdict is proven
  // non-vacuous"): the refusal above passes over zero sites, so nothing in it
  // distinguishes a clean corpus from a needle that stopped matching. Drive
  // the injection through a real page, and drive the sibling-root cites the
  // corpus actually writes through the same needle — the refusal is `tests/`
  // alone, and a needle that swallowed `bin/` or `examples/` would be
  // enforcing a ban the page never states.
  it("the test-cite needle flags an injected tests/ path and leaves the bin/, scripts/ and examples/ cites the corpus writes", () => {
    const clean = pages.find((p) => testPathsIn(p.text).length === 0);
    expect(clean, "every spec page cites a test path — nothing to inject into").toBeDefined();
    for (const injected of [
      "tests/Dispatcher.test.ts",
      "tests/fixtures/chain.ts",
      "@dtmd/flume/tests/Dispatcher.test.ts",
    ]) {
      expect(
        testPathsIn(`${clean!.text}\nPinned by \`${injected}\`.\n`),
        `test needle went blind on: ${injected}`,
      ).toContain(injected.replace("@dtmd/flume/", ""));
    }

    // The spellings the corpus writes today, each left unflagged on purpose:
    // three sibling-root cites whose module is the claim's subject, the
    // lane's filename convention, and `tests/` named as a tree.
    for (const denied of [
      "`bin.flume` points at `bin/flume.js`, a Node script with a `#!/usr/bin/env node` shebang",
      "The POSIX `bin/flume` shell script stays in the package for direct callers",
      "`CHAIN_FIXTURE` in `scripts/smoke-install.mjs` (Windows lane)",
      "exported for tooling that holds its own shipped-tags set (`examples/backlog-groomer-chain.ts`)",
      "Marked by the `*.integration.test.ts` filename convention",
      "a chain declares `tests/**` writable and the fence holds it",
    ]) {
      expect(testPathsIn(denied), `test needle over-fires on: ${denied}`).toEqual([]);
      expect(testFilenamesIn(denied), `filename needle over-fires on: ${denied}`).toEqual([]);
    }
  });

  // The rootless half of the same refusal, driven the same way: the corpus
  // cites no test file at all, so the violation has to be injected. The first
  // spelling below is the one spec/worktrees.md carried until it was
  // rewritten to name the suite's behavior instead.
  it("the test-cite needle flags a bare `Dispatcher.test.ts` filename carrying no root", () => {
    const clean = pages.find((p) => testFilenamesIn(p.text).length === 0);
    expect(clean, "every spec page cites a test filename — nothing to inject into").toBeDefined();
    expect(
      testFilenamesIn(
        `${clean!.text}\nnaming it here would move most of \`Dispatcher.test.ts\` for a cost it does not pay\n`,
      ),
      "the needle went blind on a bare test filename",
    ).toEqual(["Dispatcher.test.ts"]);
    for (const injected of [
      "the worktrees lane runs `examples.integration.test.ts` on its own",
      "pinned by loopSupervisor.test.ts",
      "the report the judge reads comes from vitestJudge.test.mts",
    ]) {
      expect(
        testFilenamesIn(`${clean!.text}\n${injected}\n`).length,
        `filename needle went blind on: ${injected}`,
      ).toBe(1);
    }
  });

  // The glob is the ruled exception: `*.integration.test.ts` is the marker a
  // consumer types to put a suite in the slow lane, so the string is the
  // claim's own subject. Non-vacuity first (engineering.md, "A green verdict
  // is proven non-vacuous") — the corpus must still be writing it, or this
  // pin guards a spelling nobody uses.
  it("the test-cite needle leaves the `*.integration.test.ts` lane convention unflagged", () => {
    const carriers = pages.filter((p) => p.text.includes("*.integration.test.ts"));
    expect(
      carriers.map((p) => p.path),
      "no spec page writes the lane glob — the exception guards nothing",
    ).not.toEqual([]);
    for (const page of carriers) {
      expect(
        [...testPathsIn(page.text), ...testFilenamesIn(page.text)],
        `${page.path} → the lane glob read as a file cite`,
      ).toEqual([]);
    }
    for (const glob of [
      "excluded by `*.integration.test.ts` from the default `vitest run`",
      "the slow lane is `tests/*.integration.test.ts`",
      "`*.test.ts` is the default lane's glob",
    ]) {
      expect(testFilenamesIn(glob), `filename needle read a glob as a file: ${glob}`).toEqual([]);
    }
  });
});

// The other half of that pin: the path half sends every sentence that wanted
// a path to a public name instead, which only stays true while the name does.
// The dotted-cite grammar, the prefix set read off spec-writing.md and
// src/index.ts, and the declared absences: tests/helpers/specLocators.ts.
describe("spec/ names members the engine still declares", () => {
  const pages = specPages();
  const prefixes = new Set([...publicSurfaceTypes(), ...indexExports()]);
  const cites = specSymbolCites(pages, prefixes);
  const bodies = srcDeclaringBodies();
  const unresolved = unresolvedSpecCite(bodies);

  // Vacuity pin (engineering.md, "A green verdict is proven non-vacuous"):
  // the refusal below reads an empty set whether the corpus is clean or the
  // page list, the prefix set and the `src/` bodies are each off target. All
  // four inputs are asserted populated, and the prefix set against both
  // surfaces the bullet names — a parser that silently matched neither would
  // leave every cite out of subject and the refusal green over nothing.
  it("the spec symbol scan reads every page of spec/", () => {
    expect(pages.length, "spec/ read empty — the scan is off target").toBeGreaterThan(0);
    for (const carrier of ["chain.md", "loop.md", "pending.md", "worktrees.md"]) {
      expect(pages.map((p) => p.path), `spec/${carrier} left the scanned set`).toContain(join("spec", carrier));
    }
    expect(publicSurfaceTypes(), "the Public surface bullet yielded no type").toEqual(
      expect.arrayContaining(["Chain", "Phase", "TickContext", "TickResult", "PendingEntry"]),
    );
    expect(indexExports().length, "src/index.ts yielded no export").toBeGreaterThan(20);
    expect(indexExports()).toEqual(expect.arrayContaining(["Dispatcher", "DispatcherOptions", "TickOutcome"]));
    expect(bodies.length, "src/ read empty — nothing to resolve against").toBeGreaterThan(10);
    expect(cites.length, "no dotted cite is in subject — the prefix set is off target").toBeGreaterThan(30);
    // Coverage is the directory, not the set of carriers: every page must be
    // read, including the ones holding no in-subject cite at all.
    for (const page of pages) {
      expect(page.text.length, `${page.path} read empty`).toBeGreaterThan(0);
    }
  });

  it("every dotted spec cite whose prefix is a public type resolves on its last segment to a declaration in src/", () => {
    const stale = cites.filter(unresolved);
    expect(
      [...new Set(stale.map((c) => c.symbol))].sort(),
      "a spec sentence names a member `src/` no longer declares: repoint it " +
        "at the current public name, or — where the absence is the claim's " +
        "subject — declare it below with that reason. Sites: " +
        stale.map((c) => `${c.page} → ${c.symbol}`).join(", "),
    ).toEqual(Object.keys(SPEC_ABSENT_SYMBOLS).sort());
  });

  // Sensitivity pin (engineering.md, "A green verdict is proven
  // non-vacuous"): the refusal above reports the same inventory whether the
  // resolver is watching or dead, and the absence list would swallow a real
  // staleness if the resolver stopped reading `src/`. Drive both directions
  // over a real page with a stale member injected — the corpus cannot produce
  // the violation itself (engineering.md, "A seam gate reads what the real
  // writer wrote") — and confirm the declared absences are the only survivors
  // rather than an artifact of a resolver that resolves nothing.
  it("the symbol needle flags an injected stale member cite and leaves the not-exist sentences the allowlist declares", () => {
    const carrier = pages.find((p) => specSymbolCites([p], prefixes).length > 0);
    expect(carrier, "no spec page carries an in-subject cite — nothing to inject into").toBeDefined();
    const injected = {
      path: carrier!.path,
      text: `${carrier!.text}\n\`TickResult.thereIsNoSuchField\` is reported per tick.\n`,
    };
    const found = specSymbolCites([injected], prefixes);
    expect(found.map((c) => c.symbol), "the needle missed an injected member cite").toContain(
      "TickResult.thereIsNoSuchField",
    );
    expect(found.filter(unresolved).map((c) => c.symbol)).toContain("TickResult.thereIsNoSuchField");

    // The resolver is not blanket-refusing: the carrier's own cites, minus
    // whatever absence it declares, all resolve.
    const live = specSymbolCites([carrier!], prefixes).filter((c) => !(c.symbol in SPEC_ABSENT_SYMBOLS));
    expect(live.length, `${carrier!.path} carries no live cite — the carrier proves nothing`).toBeGreaterThan(0);
    expect(live.filter(unresolved), "the resolver refuses a member src/ declares").toEqual([]);

    // Each declared absence is genuinely unresolvable — an entry that started
    // resolving is a section whose subject has shipped, and the equality above
    // will not catch it while the entry sits in the list.
    for (const symbol of Object.keys(SPEC_ABSENT_SYMBOLS)) {
      expect(
        unresolved({ page: "spec", symbol }),
        `${symbol} now resolves — the engine grew it; retire the spec section's absence claim`,
      ).toBe(true);
      expect(cites.map((c) => c.symbol), `${symbol} is declared absent but no page cites it`).toContain(symbol);
    }

    // Out of subject, structurally: ordinary dotted prose whose prefix names
    // no public type, and a filename wearing a type's name.
    const outOfSubject = specSymbolCites(
      [{ path: "spec/x.md", text: "`process.env.FLUME_DIR`, `core.longpaths`, `cmd.exe`, `Dispatcher.test.ts`" }],
      prefixes,
    );
    expect(outOfSubject, "the symbol needle over-fires on non-symbol prose").toEqual([]);
  });
});

// Extraction pin (TEST-SCANNERS-OUT-OF-SUITE-FILE, per
// .claude/rules/engineering.md "A fix ships the test that would have caught
// it"): red-on-base lays the merged bytes of every file holding a named test
// over the pre-fix tree, and for this suite that file is this one. A scanner
// declared here therefore rides forward inside that copy: the fixed grammar
// runs on both sides, the `tests[]` line passes on the base, and the entry
// reverts for pinning nothing. Two entries reverted that way before the
// scanners moved to `tests/helpers/`, where what the copied suite imports is
// the base's own version.
describe("the retired-narration suite's scanners live in tests/helpers/", () => {
  const source = suiteSource();
  const imports = helperImports(source);
  const imported = imports.flatMap((m) => m.names).sort();

  it("the retired-narration suite's scanners are imported from `tests/helpers/`, not declared in the suite file", () => {
    // Vacuity (engineering.md, "A green verdict is proven non-vacuous"): the
    // refusal below is an absence, and an absence over a file that read empty
    // — or over a suite importing no scanner at all — reports the same clean
    // verdict. Name the set that was found, and name the two grammars whose
    // fixes reverted on this defect, so the pin cannot pass over none.
    expect(source.length, `${SUITE_PATH} read empty`).toBeGreaterThan(10_000);
    expect(
      imports.map((m) => m.module).sort(),
      `${SUITE_PATH} imports nothing from tests/helpers/`,
    ).not.toEqual([]);
    expect(
      imported.length,
      `scanners imported: ${imported.join(", ")}`,
    ).toBeGreaterThan(40);
    for (const scanner of ["orphanedBlocks", "testPathsIn"]) {
      expect(
        imported,
        `${scanner} is not imported — the grammar whose fix this entry ` +
          "unblocked is back inside the suite file",
      ).toContain(scanner);
    }

    expect(
      declaredGrammar(source),
      `${SUITE_PATH} declares a scanner of its own: move it under ` +
        "tests/helpers/, or red-on-base carries its next fix forward inside " +
        "this file and the fix pins nothing",
    ).toEqual([]);
  });

  // Sensitivity pin (engineering.md, "A green verdict is proven
  // non-vacuous"): the refusal above compares [] to [] now that the move has
  // landed, so a reader that stopped recognising a declaration reports the
  // same empty result. Drive it over the real writers — a helper module,
  // whose grammar it must name, and this suite's own wiring and drivers,
  // which it must leave alone.
  it("the extraction scan names a helper's grammar and leaves the suite's wiring and its `it`-local drivers unflagged", () => {
    const helper = readDoc("tests", "helpers", "docAgreement.ts");
    expect(
      declaredGrammar(helper),
      "tests/helpers/docAgreement.ts declares no grammar the scan can see — " +
        "the reader is dead, and the refusal above proves nothing",
    ).toEqual(expect.arrayContaining(["interfaceFields", "orphanedBlocks"]));

    // The wiring the scan must not read as grammar: a describe-scoped `const`
    // whose initializer merely contains an arrow. Read off this file rather
    // than paraphrased — if the line moves, the control moves with it.
    expect(
      source,
      "the suite no longer builds its corpus with a mapped callback — the " +
        "false-positive control is gone",
    ).toContain("  const corpus = scannedPaths().map((path) => ({");
    // …and a driver an `it` builds for one assertion, which is the test's own
    // and is meant to ride forward with the file.
    expect(source, "the suite declares no `it`-local driver").toMatch(
      /^ {4}const found = \(prose: string\) =>/m,
    );
    expect(declaredGrammar(source)).toEqual([]);
  });
});
