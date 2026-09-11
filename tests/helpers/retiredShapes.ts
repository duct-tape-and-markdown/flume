/**
 * The retired chain-authoring shapes, their needles, and the inventories of
 * the sites each one still allows.
 *
 * Narration pin (RETIRED-ROOTS-AND-MODEL-NARRATION, per
 * .claude/rules/engineering.md "Narration is the ladder's bottom rung"):
 * `FlumeApi.paths` and `ClaudeCodeOptions.model` replaced two shapes the
 * engine used to make every chain author assemble by hand — a
 * `process.env.FLUME_DIR ?? CHAIN_DIR` fallback for artifact placement, and
 * `--model` pushed into `extraArgs`. Both replacements are typed, so the only
 * place the retired shapes can still be taught is prose, where nothing
 * mechanical was watching. This is that watch: the retirement promoted off
 * the page onto a rung that fails.
 *
 * Scope is what a chain author reads to learn the shapes — published prose,
 * the engine's own doc comments, and the chains that teach by being read as
 * worked examples: the dogfood chain and `examples/`. Excluded, each for a
 * reason that is about the file's job rather than convenience:
 *   - `tests/` — a test legitimately drives the retired argv through
 *     `extraArgs` to pin that the passthrough still works
 *     (tests/Agent.test.ts).
 *   - `docs/MIGRATING-*.md` — a migration guide's job is to show the shape
 *     you are leaving alongside the one you are moving to.
 */
import { join } from "node:path";

import { CHAIN_PATH } from "./scanCorpus.ts";

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
export const RECOMPOSED_QUEUE_PATH =
  /ctx\.(?!pendingPath\b)\w+[^\n]{0,40}?(?:plan\/pending\.json|["']plan["']\s*,\s*["']pending\.json["'])/;

/**
 * The retired single-file findings queue. `.flume/PROTOCOL.md` ("Records:
 * one file each") replaced it with a directory whose entries are one file
 * per finding, so parallel ticks never collide on one file's text. The
 * needle is the `.md` suffix alone: `inbox/` — the shape that replaced it —
 * is the subject every surviving mention should be about.
 */
export const RETIRED_INBOX_FILE = /inbox\.md/;

/**
 * The retired artifact-root fallback: a `??` leg immediately beside
 * `process.env.FLUME_DIR`. The fallback leg specifically, not every mention
 * of the env var — the canonicalization write-back is real, and documented as
 * the child-process channel, so prose that names the var and denies the
 * fallback in one sentence stays unflagged on the whitespace bound alone.
 */
export const RETIRED_ROOT_FALLBACK = /process\.env\.FLUME_DIR\s*\?\?/;

/**
 * `--model` assembled into a chain's `extraArgs`. Keyed on the `extraArgs:`
 * head rather than the flag, because the engine's own argv assembly — the
 * shape that replaced this one — names the same flag in the same array
 * literal (`src/Agent.ts`), and must stay unflagged.
 */
export const RETIRED_MODEL_ARG = /extraArgs\s*:\s*\[\s*['"]--model['"]/;

export const RETIRED = [
  {
    behavior:
      "teaches api.paths.flumeDir, never a `?? …` fallback beside " +
      "`process.env.FLUME_DIR`",
    what: "a `?? …` fallback beside `process.env.FLUME_DIR`",
    pattern: RETIRED_ROOT_FALLBACK,
    instead: "api.paths.flumeDir",
    unfixed: {} as Record<string, string>,
  },
  {
    behavior:
      "teaches ClaudeCodeOptions.model, never `--model` assembled into " +
      "`extraArgs`",
    what: "`--model` assembled into `extraArgs`",
    pattern: RETIRED_MODEL_ARG,
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

// The `?? …` pattern above catches the fallback leg only. The rest of the
// retirement — prose pointing a chain at the env var for artifact placement
// with no fallback beside it — reads in the same verbs as the two sentences
// that legitimately survive ("reads no `process.env.FLUME_DIR`", "is still
// set"), so no regex separates violation from denial. Inventory instead:
// every remaining mention is named, and a new one fails until it is.
export const ALLOWED_ENV_MENTIONS: Record<string, string> = {
  [join("src", "flumeApi.ts")]:
    "FlumePaths' doc denies the env as a chain read path",
  [join("docs", "CHAIN-AUTHORING.md")]:
    "names the env as the child-process channel, not a read path",
};

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
export const DEFAULT_EXPORT = /default[-\s]export(?:s|ed|ing)?\b/i;
/** The type/object — `chain.ts`, `{ chain }`, and "a chain" are not it. */
export const CHAIN_TYPE = /\bChain\b/;
/** The shape that replaced it, named or written. */
export const FACTORY = /factory|=>/i;
export const CHAIN_DEFAULT_CODE = /export\s+default\s+\w*[Cc]hain\w*/;
export const AGENT_MODULE_EXPORT = /\bexports?\s+(?:an?\s+|the\s+)?[`'"]agent[`'"]/i;

/**
 * `text` as narration chunks: comment markers stripped, whitespace
 * collapsed, split at sentence terminators that carry a following space.
 * Prose wraps across lines and comment markers, so a needle reading raw
 * text misses every wrapped mention; and the trailing space is what keeps
 * `0.10` and `chain.ts` inside one chunk rather than splitting a claim into
 * fragments the needles then read separately.
 */
export function narrationChunks(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*(?:\*\/?|\/\*+|\/\/|#+)\s?/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .split(/(?<=[.;:!?])\s+/);
}

/** Every chunk of `text` that teaches one of the two retired shapes. */
export function pre010Sites(text: string): string[] {
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
export const UNFIXED_SITES: Record<string, string> = {
  [CHAIN_PATH]:
    "dogfood chain header: `the default export is the Chain` — outside " +
    "the fence of the entry that promoted this pin",
};
