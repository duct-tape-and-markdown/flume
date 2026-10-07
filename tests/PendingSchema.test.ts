import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  AsyncEntryExtensionValidatorError,
  CORE_ENTRY_FIELDS,
  composePendingEntry,
  declaredPaths,
  DEFAULT_MAX_ENTRY_DEPTH,
  descendantsOf,
  entryFileName,
  isGoal,
  isPickableNow,
  parsePendingQueue,
  parsePendingQueueLoose,
  renderSchemaForPrompt,
  subtreeOf,
  TAG_MAX_LENGTH,
  touchedPaths,
  type EntryExtension,
  type ParseError,
  type ParseResult,
  type PendingEntry,
  type QueueFile,
} from "../src/PendingSchema.ts";
import type { StandardSchemaV1 } from "../src/standardSchema.ts";
import { expectNoChainVocabulary } from "./helpers/chainVocabulary.ts";
import { camelSpans } from "./helpers/literalSymbols.ts";
import { filesUnder } from "./helpers/repoProgram.ts";

const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));

/** Every `.ts` file under `src/`, recursively — the shared corpus walk. */
const SRC_FILES = { root: SRC_DIR, suffix: ".ts" } as const;

/**
 * The source span of the function named `fnName` in `src`, found by
 * balancing braces from its opening `{` — not a fixed-line regex, so
 * reformatting the function body can't silently widen or shrink the span.
 */
function extractFunctionBody(src: string, fnName: string): string {
  const start = src.indexOf(`function ${fnName}(`);
  if (start === -1) {
    throw new Error(`function ${fnName} not found`);
  }
  const openBrace = src.indexOf("{", start);
  let depth = 0;
  for (let i = openBrace; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces scanning function ${fnName}`);
}

/** Engine-core entry: tag, gate, dependsOnForks, files — nothing else. */
const baseEntry = {
  tag: "EXAMPLE-TAG",
  files: {
    new: [{ path: "src/foo.ts", description: "the foo" }],
    edit: [{ path: "src/bar.ts", description: "tweak bar" }],
    retire: ["src/baz.ts"],
  },
};

/** A representative chain-declared extension (the derivation-chain shape). */
const testExtension = {
  summary: {
    schema: z.string().min(1).max(200),
    hint: `"one-line what (≤200 chars)"`,
  },
  per: {
    schema: z.strictObject({
      path: z.string().min(1),
      section: z.string().min(1),
    }),
    hint: `{ "path": "...", "section": "..." }`,
  },
  notes: {
    schema: z.string().max(500).optional(),
    hint: `"≤500 chars"`,
  },
} satisfies EntryExtension;

/**
 * The queue directory as a fixture spells it: one file per entry, named
 * `<tag>.json` the way a producer writes it (`spec/pending.md`, *The ledger
 * is a directory — one entry per file*).
 *
 * An entry carrying no string `tag` gets a name no tag can claim, so the
 * agreement check refuses it exactly as a mis-named file on disk would rather
 * than the helper choosing a name that papers over the fixture.
 */
function queueOf(entries: readonly unknown[]): QueueFile[] {
  return entries.map((entry, index) => {
    const tag = (entry as { tag?: unknown } | null)?.tag;
    return {
      file:
        typeof tag === "string" ? entryFileName(tag) : `unnamed-${index}.json`,
      raw: JSON.stringify(entry),
    };
  });
}

/** {@link queueOf} driven through the real strict queue parse. */
function parseQueue(
  entries: readonly unknown[],
  extension?: EntryExtension,
): ParseResult {
  return parsePendingQueue(queueOf(entries), extension);
}

/** {@link queueOf} driven through the real chain-less queue parse. */
function parseQueueLoose(entries: readonly unknown[]): ParseResult {
  return parsePendingQueueLoose(queueOf(entries));
}

function roundTrip(entry: unknown): PendingEntry {
  const result = parseQueue([entry]);
  expect(result.ok, JSON.stringify(result.errors)).toBe(true);
  expect(result.entries).toHaveLength(1);
  return result.entries[0]!;
}

describe("parsePendingQueue — round-trip per gate.kind", () => {
  it("parses gate=open", () => {
    const parsed = roundTrip({ ...baseEntry, gate: { kind: "open" } });
    expect(parsed.gate).toEqual({ kind: "open" });
  });

  it("parses gate=blockedBy", () => {
    const parsed = roundTrip({
      ...baseEntry,
      gate: { kind: "blockedBy", tags: ["UPSTREAM-TAG"] },
    });
    expect(parsed.gate).toEqual({ kind: "blockedBy", tags: ["UPSTREAM-TAG"] });
  });

  it("parses gate=blockedBy with multiple parent tags", () => {
    const parsed = roundTrip({
      ...baseEntry,
      gate: { kind: "blockedBy", tags: ["UPSTREAM-A", "UPSTREAM-B"] },
    });
    expect(parsed.gate).toEqual({
      kind: "blockedBy",
      tags: ["UPSTREAM-A", "UPSTREAM-B"],
    });
  });

  it("parses gate=parked", () => {
    const parsed = roundTrip({
      ...baseEntry,
      gate: { kind: "parked", reason: "needs design call" },
    });
    expect(parsed.gate).toEqual({
      kind: "parked",
      reason: "needs design call",
    });
  });

  it("parses gate=deferred", () => {
    const parsed = roundTrip({
      ...baseEntry,
      gate: { kind: "deferred", reason: "no consumer yet" },
    });
    expect(parsed.gate).toEqual({
      kind: "deferred",
      reason: "no consumer yet",
    });
  });

  it("parses gate=requiresCapability", () => {
    const parsed = roundTrip({
      ...baseEntry,
      gate: { kind: "requiresCapability", capability: "docker-host" },
    });
    expect(parsed.gate).toEqual({
      kind: "requiresCapability",
      capability: "docker-host",
    });
  });
});

describe("parsePendingQueue — rejects malformed entries", () => {
  it("a parse failure names the entry file it read", () => {
    const result = parsePendingQueue([
      { file: "GOOD-TAG.json", raw: JSON.stringify({ ...baseEntry, tag: "GOOD-TAG", gate: { kind: "open" } }) },
      { file: "BROKEN-TAG.json", raw: "{not json" },
    ]);
    expect(result.ok).toBe(false);
    expect(result.entries).toEqual([]);
    expect(result.errors).toHaveLength(1);
    // The file, not an index into a page every writer shared: the producer
    // repairing the queue is told which file to open.
    expect(result.errors[0]!.file).toBe("BROKEN-TAG.json");
    expect(result.errors[0]!.message).toMatch(/invalid JSON/);
  });

  it("rejects a tag containing whitespace (mechanical safety only)", () => {
    const result = parseQueue(
      [
        { ...baseEntry, gate: { kind: "open" }, tag: "DAL REWIRE" },
      ],
    );
    expect(result.ok).toBe(false);
    const tagErr = result.errors.find((e) => e.path === "tag");
    expect(tagErr).toBeDefined();
    expect(tagErr!.file).toBe("DAL REWIRE.json");
  });

  it("rejects a tag containing a path separator", () => {
    const result = parseQueue(
      [
        { ...baseEntry, gate: { kind: "open" }, tag: "DAL/REWIRE" },
      ],
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path === "tag")).toBe(true);
  });

  it("rejects a tag past the derived length bound", () => {
    const result = parseQueue(
      [
        { ...baseEntry, gate: { kind: "open" }, tag: "A".repeat(217) },
      ],
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path === "tag")).toBe(true);
  });

  it("rejects an unknown gate.kind", () => {
    const result = parseQueue(
      [{ ...baseEntry, gate: { kind: "wat" } }],
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path.startsWith("gate"))).toBe(true);
  });

  it("rejects gate=blockedBy missing `tags`", () => {
    const result = parseQueue(
      [{ ...baseEntry, gate: { kind: "blockedBy" } }],
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path.startsWith("gate"))).toBe(true);
  });

  it("rejects gate=blockedBy with an empty `tags` array (not a silently-open gate)", () => {
    const result = parseQueue(
      [
        { ...baseEntry, gate: { kind: "blockedBy", tags: [] } },
      ],
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path.startsWith("gate"))).toBe(true);
  });

  it("rejects gate=requiresCapability missing `capability`", () => {
    const result = parseQueue(
      [{ ...baseEntry, gate: { kind: "requiresCapability" } }],
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path.startsWith("gate"))).toBe(true);
  });

  it("rejects the retired gate=requiresDockerHost variant", () => {
    const result = parseQueue(
      [{ ...baseEntry, gate: { kind: "requiresDockerHost" } }],
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path.startsWith("gate"))).toBe(true);
  });

  it("rejects a field that is neither core nor declared (bare core)", () => {
    // Silent stripping would destroy plan-authored fields on the
    // dispatcher's rewrite of the entry's own file — unknown fields fail loudly.
    const result = parseQueue(
      [
        { ...baseEntry, gate: { kind: "open" }, summary: "undeclared" },
      ],
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]!.message).toMatch(/summary/);
  });

  it("rejects an entry file holding an array rather than one entry", () => {
    const result = parsePendingQueue([
      {
        file: "SOME-TAG.json",
        raw: JSON.stringify([{ ...baseEntry, tag: "SOME-TAG", gate: { kind: "open" } }]),
      },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]!.file).toBe("SOME-TAG.json");
  });
});

describe("chain-declared extension", () => {
  const extended = {
    ...baseEntry,
    gate: { kind: "open" },
    summary: "do the thing",
    per: { path: "spec/pending.md", section: "5. Tests" },
  };

  it("accepts declared fields and round-trips their values", () => {
    const result = parseQueue([extended], testExtension);
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    const entry = result.entries[0]!;
    expect(entry.summary).toBe("do the thing");
    expect(entry.per).toEqual({
      path: "spec/pending.md",
      section: "5. Tests",
    });
  });

  it("enforces the declared field's own constraints (extension cap)", () => {
    const result = parseQueue(
      [{ ...extended, summary: "x".repeat(201) }],
      testExtension,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path === "summary")).toBe(true);
  });

  it("rejects a field the extension did not declare", () => {
    const result = parseQueue(
      [{ ...extended, schemaDelta: "none" }],
      testExtension,
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]!.message).toMatch(/schemaDelta/);
  });

  it("applies extension defaults at parse time", () => {
    const ext = {
      tests: {
        schema: z.array(z.string()).default([]),
        hint: `[ "..." ]`,
      },
    } satisfies EntryExtension;
    const result = parseQueue([{ ...baseEntry, gate: { kind: "open" } }], ext);
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(result.entries[0]!.tests).toEqual([]);
  });

  /**
   * Shadow refusal, judged over the engine's own vocabulary rather than one
   * hand-picked name: `CORE_ENTRY_FIELDS` is what `composePendingEntry`
   * checks against, so every name it holds — and every name a later core
   * field adds to it — is covered here without the test being edited.
   */
  it("an extension shadowing any exported core entry field name other than tag throws", () => {
    const shadowable = CORE_ENTRY_FIELDS.filter((name) => name !== "tag");
    expect(
      shadowable.length,
      "no shadowable core field names exported — nothing to judge",
    ).toBeGreaterThan(0);
    for (const name of shadowable) {
      const shadowing: EntryExtension = {
        [name]: { schema: z.string(), hint: `"..."` },
      };
      expect(() => composePendingEntry(shadowing)).toThrow(
        new RegExp(`"${name}".*shadows`),
      );
    }
    // `tag` is the one declared exception: refined, never replaced.
    expect(() =>
      composePendingEntry({ tag: { schema: z.string(), hint: `"..."` } }),
    ).not.toThrow();
  });
});

describe("tag grammar reduces to mechanical safety", () => {
  it("DAL-REWIRE(usp_Filter_Get) validates against the bare core", () => {
    const result = parseQueue(
      [
        {
          ...baseEntry,
          gate: { kind: "open" },
          tag: "DAL-REWIRE(usp_Filter_Get)",
        },
      ],
    );
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(result.entries[0]!.tag).toBe("DAL-REWIRE(usp_Filter_Get)");
  });

  it("accepts a lowercase tag under the bare core (grammar beyond mechanical safety is a chain's choice, not the engine's)", () => {
    const result = parseQueue(
      [
        { ...baseEntry, gate: { kind: "open" }, tag: "roster-triage-mig" },
      ],
    );
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
  });

  it("a chain-declared `tag` refinement composes as an intersection (rejects lowercase, accepts ALL-CAPS)", () => {
    const allCapsRefinement = {
      tag: {
        schema: z.string().regex(/^[A-Z][A-Z0-9]*(?:[-.][A-Za-z0-9]+)*(?:\([a-z0-9]+\))?$/),
        hint: `"ALL-CAPS-WITH-DASHES" | "TAG-NAME(slice)"`,
      },
    } satisfies EntryExtension;

    const lowercase = parseQueue(
      [
        { ...baseEntry, gate: { kind: "open" }, tag: "roster-triage-mig" },
      ],
      allCapsRefinement,
    );
    expect(lowercase.ok).toBe(false);
    expect(lowercase.errors.some((e) => e.path === "tag")).toBe(true);

    const valid = parseQueue(
      [
        { ...baseEntry, gate: { kind: "open" }, tag: "ROSTER-TRIAGE-MIG" },
      ],
      allCapsRefinement,
    );
    expect(valid.ok, JSON.stringify(valid.errors)).toBe(true);
  });

  it("a permissive refinement still can't widen past the engine's mechanical floor", () => {
    // A refinement that only checks the first character says nothing about
    // whitespace — the core pattern still refuses it, because composition is
    // an intersection: both must pass.
    const startsWithLetter = {
      tag: { schema: z.string().regex(/^[A-Z]/), hint: `"..."` },
    } satisfies EntryExtension;
    const result = parseQueue(
      [
        { ...baseEntry, gate: { kind: "open" }, tag: "ROSTER TRIAGE" },
      ],
      startsWithLetter,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path === "tag")).toBe(true);
  });
});

describe("tag identity is the filesystem's", () => {
  it("an entry file whose tag disagrees with its filename is refused naming both", () => {
    const result = parsePendingQueue([
      {
        file: "FILENAME-TAG.json",
        raw: JSON.stringify({ ...baseEntry, tag: "BODY-TAG", gate: { kind: "open" } }),
      },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    const err = result.errors[0]!;
    expect(err.file).toBe("FILENAME-TAG.json");
    expect(err.path).toBe("tag");
    // Both sides, so the producer knows which one to change.
    expect(err.message).toMatch(/BODY-TAG/);
    expect(err.message).toMatch(/BODY-TAG\.json/);
  });

  it("refuses the disagreement through the extension-composed path too", () => {
    const result = parsePendingQueue(
      [
        {
          file: "FILENAME-TAG.json",
          raw: JSON.stringify({
            ...baseEntry,
            tag: "BODY-TAG",
            gate: { kind: "open" },
            summary: "first",
            per: { path: "spec/pending.md", section: "5. Tests" },
          }),
        },
      ],
      testExtension,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path === "tag")).toBe(true);
  });

  it("the chain-less parse holds the same agreement", () => {
    const result = parsePendingQueueLoose([
      {
        file: "FILENAME-TAG.json",
        raw: JSON.stringify({ ...baseEntry, tag: "BODY-TAG", gate: { kind: "open" } }),
      },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path === "tag")).toBe(true);
  });

  it("two entries can no longer share a tag — one tag is one file", () => {
    // The check the composed list schema used to carry is the directory's
    // now: `entryFileName` is total, so two entries claiming one tag name
    // one file and there is no second entry to refuse.
    expect(entryFileName("DUP-TAG")).toBe("DUP-TAG.json");
    const result = parseQueue([
      { ...baseEntry, tag: "TAG-ONE", gate: { kind: "open" } },
      { ...baseEntry, tag: "TAG-TWO", gate: { kind: "open" } },
    ]);
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(result.entries).toHaveLength(2);
    expect(new Set(result.entries.map((e) => entryFileName(e.tag))).size).toBe(2);
  });

  it("a queue with distinct tags parses clean through the extension-composed path", () => {
    const result = parseQueue(
      [
        {
          ...baseEntry,
          tag: "TAG-ONE",
          gate: { kind: "open" },
          summary: "first",
          per: { path: "spec/pending.md", section: "5. Tests" },
        },
        {
          ...baseEntry,
          tag: "TAG-TWO",
          gate: { kind: "open" },
          summary: "second",
          per: { path: "spec/pending.md", section: "5. Tests" },
        },
      ],
      testExtension,
    );
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(result.entries).toHaveLength(2);
  });
});

describe("entryExtension validators are adapted, not merged (ENTRYEXTENSION-STANDARD-SCHEMA)", () => {
  /**
   * No zod anywhere in this describe block: a hand-rolled object
   * implementing the Standard Schema protocol directly, so these tests
   * prove library-independence (any `~standard` implementer works), not
   * merely version-independence (any zod copy works).
   */
  function handStandardSchema<Output>(
    validate: (
      value: unknown,
    ) => StandardSchemaV1.Result<Output> | Promise<StandardSchemaV1.Result<Output>>,
  ): StandardSchemaV1<unknown, Output> {
    return { "~standard": { version: 1, vendor: "hand-test", validate } };
  }

  it("accepts a conforming entry and actually invokes the foreign validators (vacuity pin)", () => {
    const summaryCalls: unknown[] = [];
    const perCalls: unknown[] = [];
    const ext = {
      summary: {
        schema: handStandardSchema<string>((value) => {
          summaryCalls.push(value);
          if (typeof value !== "string" || value.length < 1) {
            return { issues: [{ message: "summary must be non-empty" }] };
          }
          return { value };
        }),
        hint: `"..."`,
      },
      per: {
        schema: handStandardSchema<{ path: string; section: string }>(
          (value) => {
            perCalls.push(value);
            const v = value as { path?: unknown; section?: unknown };
            const issues: StandardSchemaV1.Issue[] = [];
            if (typeof v?.path !== "string" || v.path.length < 1) {
              issues.push({ message: "path must be non-empty", path: ["path"] });
            }
            if (typeof v?.section !== "string" || v.section.length < 1) {
              issues.push({
                message: "section must be non-empty",
                path: ["section"],
              });
            }
            if (issues.length) return { issues };
            return { value: v as { path: string; section: string } };
          },
        ),
        hint: `{...}`,
      },
    } satisfies EntryExtension;

    const result = parseQueue(
      [
        {
          ...baseEntry,
          gate: { kind: "open" },
          summary: "do the thing",
          per: { path: "spec/pending.md", section: "5. Tests" },
        },
      ],
      ext,
    );
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    // Vacuity pin (.claude/rules/engineering.md "A green verdict is proven
    // non-vacuous"): prove the foreign validators were actually invoked, not
    // skipped past.
    expect(summaryCalls.length).toBeGreaterThan(0);
    expect(perCalls.length).toBeGreaterThan(0);
    expect(result.entries[0]!.summary).toBe("do the thing");
    expect(result.entries[0]!.per).toEqual({
      path: "spec/pending.md",
      section: "5. Tests",
    });
  });

  it("a field violation rejects carrying the foreign validator's own message at the entry-indexed path", () => {
    const ext = {
      summary: {
        schema: handStandardSchema<string>((value) => {
          if (typeof value !== "string" || value.length < 1) {
            return {
              issues: [
                { message: "summary must be a non-empty string (hand-written)" },
              ],
            };
          }
          return { value };
        }),
        hint: `"..."`,
      },
    } satisfies EntryExtension;
    const result = parseQueue(
      [{ ...baseEntry, gate: { kind: "open" }, summary: "" }],
      ext,
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.file).toBe(entryFileName("EXAMPLE-TAG"));
    expect(result.errors[0]!.path).toBe("summary");
    expect(result.errors[0]!.message).toBe(
      "summary must be a non-empty string (hand-written)",
    );
  });

  it("a nested violation rejects at the composed path ([0].per.path, not [0].per)", () => {
    const ext = {
      per: {
        schema: handStandardSchema<{ path: string; section: string }>(
          (value) => {
            const v = value as { path?: unknown; section?: unknown };
            if (typeof v?.path !== "string" || v.path.length < 1) {
              return {
                issues: [
                  {
                    message: "path must be non-empty (hand-written)",
                    path: ["path"],
                  },
                ],
              };
            }
            return { value: v as { path: string; section: string } };
          },
        ),
        hint: `{...}`,
      },
    } satisfies EntryExtension;
    const result = parseQueue(
      [
        { ...baseEntry, gate: { kind: "open" }, per: { path: "", section: "ok" } },
      ],
      ext,
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.file).toBe(entryFileName("EXAMPLE-TAG"));
    expect(result.errors[0]!.path).toBe("per.path");
    expect(result.errors[0]!.message).toBe(
      "path must be non-empty (hand-written)",
    );
  });

  it("a chain tag refinement narrows and cannot widen the core floor", () => {
    const allCaps = {
      tag: {
        schema: handStandardSchema<string>((value) => {
          if (typeof value !== "string" || !/^[A-Z][A-Z0-9-]*$/.test(value)) {
            return {
              issues: [{ message: "tag must be ALL-CAPS (hand-written)" }],
            };
          }
          return { value };
        }),
        hint: `"..."`,
      },
    } satisfies EntryExtension;

    const lowercase = parseQueue(
      [
        { ...baseEntry, gate: { kind: "open" }, tag: "roster-triage-mig" },
      ],
      allCaps,
    );
    expect(lowercase.ok).toBe(false);
    expect(lowercase.errors.some((e) => e.path === "tag")).toBe(true);

    const valid = parseQueue(
      [
        { ...baseEntry, gate: { kind: "open" }, tag: "ROSTER-TRIAGE-MIG" },
      ],
      allCaps,
    );
    expect(valid.ok, JSON.stringify(valid.errors)).toBe(true);

    // A refinement that accepts everything still can't widen past the
    // engine's mechanical floor — the core pattern forbids whitespace
    // regardless of what the chain's own validator says.
    const permitsAnything = {
      tag: {
        schema: handStandardSchema<string>((value) => ({ value: value as string })),
        hint: `"..."`,
      },
    } satisfies EntryExtension;
    const stillRejected = parseQueue(
      [
        { ...baseEntry, gate: { kind: "open" }, tag: "ROSTER TRIAGE" },
      ],
      permitsAnything,
    );
    expect(stillRejected.ok).toBe(false);
    expect(stillRejected.errors.some((e) => e.path === "tag")).toBe(true);
  });

  it("rejects a field the hand-written extension did not declare", () => {
    const ext = {
      summary: {
        schema: handStandardSchema<string>((value) => ({ value: value as string })),
        hint: `"..."`,
      },
    } satisfies EntryExtension;
    const result = parseQueue(
      [
        { ...baseEntry, gate: { kind: "open" }, summary: "x", extra: "nope" },
      ],
      ext,
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]!.message).toMatch(/extra/);
  });

  it("holds the filename agreement through the hand-written-extension-composed path", () => {
    const ext = {
      summary: {
        schema: handStandardSchema<string>((value) => ({ value: value as string })),
        hint: `"..."`,
      },
    } satisfies EntryExtension;
    const result = parsePendingQueue(
      [
        {
          file: "FILENAME-TAG.json",
          raw: JSON.stringify({
            ...baseEntry,
            tag: "BODY-TAG",
            gate: { kind: "open" },
            summary: "a",
          }),
        },
      ],
      ext,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path === "tag")).toBe(true);
  });

  it("a declared validator that supplies a value for an absent key materializes it in the parsed entry", () => {
    // The drafting error this section caught: a verdict-only adapter passes
    // every other case in this describe block while silently dropping this
    // one — `tests` is entirely absent from the raw entry, and only the
    // validator (not the raw JSON) knows the default is `[]`.
    const ext = {
      tests: {
        schema: handStandardSchema<Array<{ path: string; asserts: string }>>(
          (value) => {
            if (value === undefined) return { value: [] };
            if (!Array.isArray(value)) {
              return { issues: [{ message: "tests must be an array" }] };
            }
            return { value: value as Array<{ path: string; asserts: string }> };
          },
        ),
        hint: `[ { "path": "...", "asserts": "..." } ]`,
      },
    } satisfies EntryExtension;
    const result = parseQueue(
      [{ ...baseEntry, gate: { kind: "open" } }],
      ext,
    );
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(result.entries[0]!.tests).toEqual([]);
  });

  it("an async validator's declaration is refused naming the field, rather than accepting the entry vacuously", () => {
    const ext = {
      summary: {
        schema: handStandardSchema<string>(async (value) => ({
          value: value as string,
        })),
        hint: `"..."`,
      },
    } satisfies EntryExtension;
    const entries = [{ ...baseEntry, gate: { kind: "open" }, summary: "x" }];
    expect(() => parseQueue(entries, ext)).toThrow(AsyncEntryExtensionValidatorError);
    expect(() => parseQueue(entries, ext)).toThrow(/summary/);
  });
});

/** Those spans `src/` declares, whatever kind of declaration holds the name. */
const declaredInSrc = (spans: readonly string[]): string[] => {
  const sources = filesUnder(SRC_FILES).map((file) => readFileSync(file, "utf8"));
  return spans.filter((span) =>
    sources.some((src) =>
      new RegExp(`\\b(?:function|const|let|class|interface|type|enum)\\s+${span}\\b`).test(src),
    ),
  );
};

/**
 * The arm that reaches every refusal resolves a literal's function names
 * against the package's surface (`tests/engineMessages.test.ts`), which
 * leaves an export like `parsePendingQueue` nameable in a message. This one
 * holds the stricter rule on its own terms: what its reader acts on is the
 * field and the fix, and any other name the engine declares is a second
 * subject in a message about a chain's own extension. The doc comment above
 * the class keeps the parser's name, where the citation pin resolves it.
 */
it("the async-validator refusal names the field and the fix, naming no engine function", () => {
  const { message } = new AsyncEntryExtensionValidatorError("reviewers");

  expect(message).toContain(`"reviewers"`);
  expect(message).toContain("Declare a synchronous Standard Schema validator");

  // The detector bites: run it over the spelling this refusal used to carry.
  const stale = `${message} parsePendingQueue is synchronous.`;
  expect(declaredInSrc(camelSpans(stale))).toEqual(["parsePendingQueue"]);

  expect(camelSpans(message).length).toBeGreaterThan(0);
  expect(declaredInSrc(camelSpans(message))).toEqual([]);
});

/** The module declaring `parsePendingQueueLoose` — the call-site scan drops it. */
const LOOSE_DECLARATION = "PendingSchema.ts";

/** Every `src/` module mentioning `parsePendingQueueLoose(`, with its count. */
const looseMentions = (): { file: string; count: number }[] =>
  filesUnder(SRC_FILES).flatMap((file) => {
    const count = (readFileSync(file, "utf8").match(/\bparsePendingQueueLoose\(/g) ?? []).length;
    return count > 0 ? [{ file, count }] : [];
  });

/**
 * Those mentions minus the declaring module. `basename`, not a `"/"`-spelled
 * suffix: `filesUnder` hands back host-native paths, so on win32 a `/`-suffix
 * test matches nothing and the declaration counts itself as a call site
 * (`spec/cli.md`, *win32 is a supported host*).
 */
const looseCallSites = (): { file: string; count: number }[] =>
  looseMentions().filter((site) => basename(site.file) !== LOOSE_DECLARATION);

describe("parsePendingQueueLoose — chain-less informational reads", () => {
  it("passes undeclared fields through unvalidated", () => {
    const result = parseQueueLoose(
      [
        {
          ...baseEntry,
          gate: { kind: "open" },
          summary: "kept as-is",
          anything: { nested: true },
        },
      ],
    );
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(result.entries[0]!.summary).toBe("kept as-is");
    expect(result.entries[0]!.anything).toEqual({ nested: true });
  });

  it("still rejects a malformed core", () => {
    const result = parseQueueLoose(
      [{ ...baseEntry, gate: { kind: "wat" } }],
    );
    expect(result.ok).toBe(false);
  });

  it("has exactly one production call site — pendingLedger.ts's chain-less read", () => {
    const callSites = looseCallSites();

    expect(callSites).toHaveLength(1);
    expect(basename(callSites[0]!.file)).toBe("pendingLedger.ts");
    expect(callSites[0]!.count).toBe(1);
  });

  it("the parsePendingQueueLoose call-site scan excludes its own declaration from a set that really contained it", () => {
    const leaves = (sites: { file: string }[]): string[] =>
      sites.map((site) => basename(site.file));

    expect(leaves(looseMentions())).toContain(LOOSE_DECLARATION);
    expect(leaves(looseCallSites())).not.toContain(LOOSE_DECLARATION);
  });

  it("its one call site never rewrites the queue — readPendingLoose (pendingLedger.ts, what flume status counts through) is read-only", () => {
    const ledgerSrc = readFileSync(`${SRC_DIR}/pendingLedger.ts`, "utf8");
    const probeBody = extractFunctionBody(ledgerSrc, "readPendingLoose");
    const noMutation =
      /\b(writeFileSync|writeFile|appendFileSync|appendFile|rmSync|rm|unlinkSync|unlink)\s*\(/;

    expect(probeBody).toContain("parsePendingQueueLoose(");
    // No write/delete call anywhere in the function that reads the queue.
    expect(probeBody).not.toMatch(noMutation);
  });
});

describe("parsePendingQueue/parsePendingQueueLoose — shared error mapping", () => {
  it("constructs the invalid-JSON message exactly once in module source", () => {
    const src = readFileSync(`${SRC_DIR}/PendingSchema.ts`, "utf8");
    const occurrences = (src.match(/invalid JSON: /g) ?? []).length;
    expect(occurrences).toBe(1);
  });
});

describe("dependsOnForks — foundations governor", () => {
  /**
   * The gate read's queue argument where the case is about forks alone: a
   * listing holding nothing settles every `blockedBy` tag and offers no
   * ancestor, so the fork governor is the only thing left to decide.
   */
  const noQueue: PendingEntry[] = [];

  it("defaults to an empty array when omitted", () => {
    const parsed = roundTrip({ ...baseEntry, gate: { kind: "open" } });
    expect(parsed.dependsOnForks).toEqual([]);
  });

  it("round-trips declared fork slugs", () => {
    const parsed = roundTrip({
      ...baseEntry,
      gate: { kind: "open" },
      dependsOnForks: ["coldstart-2", "unread-count-model"],
    });
    expect(parsed.dependsOnForks).toEqual([
      "coldstart-2",
      "unread-count-model",
    ]);
  });

  it("an open entry with an unresolved fork is NOT pickable", () => {
    const entry = roundTrip({
      ...baseEntry,
      gate: { kind: "open" },
      dependsOnForks: ["coldstart-2"],
    });
    expect(isPickableNow(entry, noQueue, () => false)).toBe(false);
  });

  it("an open entry whose forks all resolve IS pickable", () => {
    const entry = roundTrip({
      ...baseEntry,
      gate: { kind: "open" },
      dependsOnForks: ["coldstart-2", "unread-count-model"],
    });
    expect(isPickableNow(entry, noQueue, () => true)).toBe(true);
  });

  it("blocks if ANY declared fork is unresolved", () => {
    const entry = roundTrip({
      ...baseEntry,
      gate: { kind: "open" },
      dependsOnForks: ["resolved-one", "open-one"],
    });
    const resolved = (slug: string) => slug === "resolved-one";
    expect(isPickableNow(entry, noQueue, resolved)).toBe(false);
  });

  it("the default predicate (no resolver) leaves pickability to the gate alone", () => {
    const open = roundTrip({
      ...baseEntry,
      gate: { kind: "open" },
      dependsOnForks: ["anything"],
    });
    // No third argument → every fork treated as resolved → gate decides.
    expect(isPickableNow(open, noQueue)).toBe(true);

    const parked = roundTrip({
      ...baseEntry,
      gate: { kind: "parked", reason: "x" },
    });
    expect(isPickableNow(parked, noQueue)).toBe(false);
  });

  it("an unresolved fork blocks even a blockedBy-satisfied entry", () => {
    const entry = roundTrip({
      ...baseEntry,
      gate: { kind: "blockedBy", tags: ["UPSTREAM"] },
      dependsOnForks: ["open-one"],
    });
    // Upstream has left the queue (gate would pass) but the fork is open →
    // not pickable.
    expect(isPickableNow(entry, noQueue, () => false)).toBe(false);
  });
});

describe("kind and parent — the queue's forest (spec/pending.md § The entry core)", () => {
  it("an entry declaring no kind parses as work", () => {
    const parsed = roundTrip({ ...baseEntry, gate: { kind: "open" } });
    expect(parsed.kind).toBe("work");
    // And nothing stood in for a parent: a root is the absence of one, never a
    // placeholder a reader would have to recognize.
    expect(parsed.parent).toBeUndefined();
  });

  it("round-trips each kind the core names, and a parent beside it", () => {
    // Each kind under an owner the forest admits above it (`spec/pending.md`,
    // *The queue is a forest*): a step's is its work entry, and the other
    // two are a group's.
    const owners = { work: "group", step: "work", group: "group" } as const;
    for (const kind of ["work", "step", "group"] as const) {
      const result = parseQueue([
        {
          ...baseEntry,
          gate: { kind: "open" },
          kind,
          parent: "OWNING-TAG",
        },
        {
          ...baseEntry,
          tag: "OWNING-TAG",
          gate: { kind: "open" },
          kind: owners[kind],
        },
      ]);
      expect(result.ok, JSON.stringify(result.errors)).toBe(true);
      const parsed = result.entries.find((e) => e.tag === baseEntry.tag)!;
      expect(parsed.kind).toBe(kind);
      expect(parsed.parent).toBe("OWNING-TAG");
    }
  });

  it("an entry declaring a kind the core does not name is refused", () => {
    // The dispatch unit is the one kind selection offers, so a kind the core
    // cannot place is a queue that must not be dispatched over at all
    // (`.claude/rules/engineering.md`, *Loud or nothing*) — never read as the
    // default.
    for (const kind of ["epic", "WORK", "", null, 3]) {
      const result = parseQueue([
        { ...baseEntry, gate: { kind: "open" }, kind },
      ]);
      expect(result.ok, `kind ${JSON.stringify(kind)} parsed`).toBe(false);
      expect(result.errors.map((e) => e.path)).toContain("kind");
    }
  });

  it("a parent that is not a tag the grammar admits is refused", () => {
    // A parent names an entry, and an entry's name is its tag: a value no tag
    // could be names nothing any queue holds, so it is refused at the one
    // place the grammar lives rather than at whatever later read follows the
    // pointer.
    for (const parent of [
      "has whitespace",
      "has/separator",
      "",
      "A".repeat(TAG_MAX_LENGTH + 1),
      7,
    ]) {
      const result = parseQueue([
        { ...baseEntry, gate: { kind: "open" }, parent },
      ]);
      expect(result.ok, `parent ${JSON.stringify(parent)} parsed`).toBe(false);
      expect(result.errors.map((e) => e.path)).toContain("parent");
    }
  });

  it("an entry carrying a priority is refused as an undeclared field", () => {
    // The rank left the core, and the core is strict: a producer still filing
    // one is told so at the parse rather than having it silently carried — or
    // silently stripped, which the dispatcher's own rewrite would then destroy
    // on disk.
    const result = parseQueue([
      { ...baseEntry, gate: { kind: "open" }, priority: 10 },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.message).join("\n")).toContain(
      "priority",
    );
  });
});

/**
 * One candidate entry of `kind`, optionally under `parent`, with a gate
 * beside it — unparsed, since every forest rule is judged on the way in.
 *
 * `kind` is a bare string rather than the enum: a case deriving the kinds
 * from a real surface rather than listing them holds strings, and the value
 * is the parse's to judge anyway.
 */
function forestEntry(
  tag: string,
  kind: string,
  parent?: string,
  gate: unknown = { kind: "open" },
): Record<string, unknown> {
  return {
    tag,
    gate,
    kind,
    ...(parent === undefined ? {} : { parent }),
    files: { new: [], edit: [], retire: [] },
  };
}

/**
 * The one refusal a queue carrying one forest defect produces, read off the
 * real strict parse. Asserting the count is the vacuity pin for every case
 * taking it: a queue refused for some *other* reason — a malformed entry, a
 * second defect the fixture did not mean — would never reach the field
 * assertions as the sole error.
 */
function soleForestError(
  queue: readonly unknown[],
  maxEntryDepth?: number,
): ParseError {
  const result = parsePendingQueue(queueOf(queue), undefined, maxEntryDepth);
  expect(result.ok, "the queue parsed").toBe(false);
  // All-or-nothing over the directory: a refused queue hands back nothing.
  expect(result.entries).toEqual([]);
  expect(
    result.errors.map((e) => `[${e.file}] ${e.path}: ${e.message}`),
  ).toHaveLength(1);
  return result.errors[0]!;
}

/**
 * The queue-wide half of the forest (`spec/pending.md`, *The queue is a
 * forest*). Every rule here reads a second entry or a chain of them, so none
 * of them can live on the per-entry schema above — and each refusal is driven
 * through the real queue parse rather than the check, so what is pinned is
 * what a tick's own read does with a queue on disk.
 */
describe("the queue's forest — the rules a whole listing keeps (spec/pending.md § The queue is a forest)", () => {
  it("a forest keeping every rule the section states parses", () => {
    // Every rule at once, in the shape the section names: a goal parenting an
    // epic, the epic a work entry, that entry's two steps with the second
    // blocked on the first — and a root work entry beside the whole tree,
    // which is what a producer writes before it groups anything.
    const queue = [
      forestEntry("GOAL", "group"),
      forestEntry("EPIC", "group", "GOAL"),
      forestEntry("WORK", "work", "EPIC"),
      forestEntry("STEP-FIRST", "step", "WORK"),
      forestEntry("STEP-SECOND", "step", "WORK", {
        kind: "blockedBy",
        tags: ["STEP-FIRST"],
      }),
      forestEntry("ROOT-WORK", "work"),
    ];
    const result = parseQueue(queue);
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    // Non-vacuity: the whole listing came back, so the verdict is over this
    // forest and not over a queue the parse read as shorter.
    expect(result.entries.map((e) => e.tag)).toEqual(
      queue.map((e) => e.tag as string),
    );
    // And it sits exactly at the default cap — goal, epic, work, step — so
    // the case is a forest the default admits rather than one it never
    // measured.
    expect(DEFAULT_MAX_ENTRY_DEPTH).toBe(4);
    // The chain-less read judges the same rules: the forest is core shape, so
    // nothing about it waits on a declared extension.
    expect(parseQueueLoose(queue).ok).toBe(true);
  });

  it("a parent naming no entry in the queue is refused", () => {
    const error = soleForestError([forestEntry("ORPHAN", "work", "NO-SUCH-GOAL")]);
    expect(error.file).toBe(entryFileName("ORPHAN"));
    expect(error.path).toBe("parent");
    expect(error.message).toContain("NO-SUCH-GOAL");

    // The same queue with the entry it names present parses, so what was
    // refused is the dangling pointer and not the field.
    expect(
      parseQueue([
        forestEntry("ORPHAN", "work", "NO-SUCH-GOAL"),
        forestEntry("NO-SUCH-GOAL", "group"),
      ]).ok,
    ).toBe(true);
    // And the chain-less read refuses it too — core shape, one verdict.
    expect(parseQueueLoose([forestEntry("ORPHAN", "work", "NO-SUCH-GOAL")]).ok).toBe(
      false,
    );
  });

  it("a work entry whose parent is a work entry is refused", () => {
    // Everything above a work entry organizes: a work entry under another is
    // a session inside a session, which is the one thing finer structure must
    // never mean.
    const error = soleForestError([
      forestEntry("OUTER-WORK", "work"),
      forestEntry("INNER-WORK", "work", "OUTER-WORK"),
    ]);
    expect(error.file).toBe(entryFileName("INNER-WORK"));
    expect(error.path).toBe("parent");
    expect(error.message).toContain("work");

    // Non-vacuity: the same two entries with the owner declared a group
    // parse, so the refusal is the owner's kind and not the pair.
    expect(
      parseQueue([
        forestEntry("OUTER-WORK", "group"),
        forestEntry("INNER-WORK", "work", "OUTER-WORK"),
      ]).ok,
    ).toBe(true);
  });

  it("a group whose parent is a work entry is refused", () => {
    const error = soleForestError([
      forestEntry("THE-WORK", "work"),
      forestEntry("THE-GROUP", "group", "THE-WORK"),
    ]);
    expect(error.file).toBe(entryFileName("THE-GROUP"));
    expect(error.path).toBe("parent");

    expect(
      parseQueue([
        forestEntry("THE-WORK", "group"),
        forestEntry("THE-GROUP", "group", "THE-WORK"),
      ]).ok,
    ).toBe(true);
  });

  it("a step whose parent is a group is refused", () => {
    // A step is part of a work entry's own session, so a step hanging off a
    // group is a step no session would ever take.
    const error = soleForestError([
      forestEntry("THE-GROUP", "group"),
      forestEntry("THE-STEP", "step", "THE-GROUP"),
    ]);
    expect(error.file).toBe(entryFileName("THE-STEP"));
    expect(error.path).toBe("parent");

    // A step's parent is its work entry or another of its steps: both parse.
    expect(
      parseQueue([
        forestEntry("THE-WORK", "work"),
        forestEntry("THE-STEP", "step", "THE-WORK"),
        forestEntry("THE-SUBSTEP", "step", "THE-STEP"),
      ]).ok,
    ).toBe(true);
  });

  it("a step blockedBy a step of another work entry is refused", () => {
    const error = soleForestError([
      forestEntry("WORK-A", "work"),
      forestEntry("STEP-A", "step", "WORK-A"),
      forestEntry("WORK-B", "work"),
      forestEntry("STEP-B", "step", "WORK-B", {
        kind: "blockedBy",
        tags: ["STEP-A"],
      }),
    ]);
    expect(error.file).toBe(entryFileName("STEP-B"));
    expect(error.path).toBe("gate.tags.0");
    expect(error.message).toContain("WORK-A");

    // Non-vacuity: the same blocker named from inside its own work entry
    // parses, so what was refused is the reach across entries — a dependency
    // that far out is declared on the work entry.
    expect(
      parseQueue([
        forestEntry("WORK-A", "work"),
        forestEntry("STEP-A", "step", "WORK-A"),
        forestEntry("STEP-B", "step", "WORK-A", {
          kind: "blockedBy",
          tags: ["STEP-A"],
        }),
      ]).ok,
    ).toBe(true);
  });

  it("a step blockedBy its own work entry is refused", () => {
    // "Only steps" is the rule, and the work entry above the step is the
    // nearest thing that is not one.
    const error = soleForestError([
      forestEntry("OWNING-WORK", "work"),
      forestEntry("THE-STEP", "step", "OWNING-WORK", {
        kind: "blockedBy",
        tags: ["OWNING-WORK"],
      }),
    ]);
    expect(error.file).toBe(entryFileName("THE-STEP"));
    expect(error.path).toBe("gate.tags.0");
  });

  it("a work entry whose blockedBy names its own parent group is refused at the queue read", () => {
    // The group leaves the queue with its last descendant, and the waiter is
    // one: each end waits on the other, and nothing downstream can see it —
    // the blocker's own gate is open, so the cycle search leads nowhere back.
    const error = soleForestError([
      forestEntry("THE-GROUP", "group"),
      forestEntry("THE-WORK", "work", "THE-GROUP", {
        kind: "blockedBy",
        tags: ["THE-GROUP"],
      }),
    ]);
    expect(error.file).toBe(entryFileName("THE-WORK"));
    expect(error.path).toBe("gate.tags.0");
    expect(error.message).toContain("THE-GROUP");

    // Non-vacuity: the same entry under one group and waiting on another
    // parses, so what was refused is the containment and not a work entry
    // waiting on a group.
    expect(
      parseQueue([
        forestEntry("THE-GROUP", "group"),
        forestEntry("OTHER-GROUP", "group"),
        forestEntry("THE-WORK", "work", "THE-GROUP", {
          kind: "blockedBy",
          tags: ["OTHER-GROUP"],
        }),
      ]).ok,
    ).toBe(true);
  });

  it("a work entry whose blockedBy names a group two levels above it is refused at the queue read", () => {
    // Containment is the whole chain above, not the declared parent: a goal
    // two levels up leaves the queue with its last descendant just the same.
    const twoAbove = (...tags: string[]): Record<string, unknown>[] => [
      forestEntry("THE-GOAL", "group"),
      forestEntry("THE-EPIC", "group", "THE-GOAL"),
      forestEntry("ELSEWHERE", "work"),
      forestEntry("THE-WORK", "work", "THE-EPIC", {
        kind: "blockedBy",
        tags,
      }),
    ];
    const error = soleForestError(twoAbove("ELSEWHERE", "THE-GOAL"));
    expect(error.file).toBe(entryFileName("THE-WORK"));
    // The index the author wrote, so the refusal names the edge it declared
    // rather than the gate that carries it.
    expect(error.path).toBe("gate.tags.1");
    expect(error.message).toContain("THE-GOAL");

    // Non-vacuity: the same four entries with the ancestor edge dropped
    // parse, so what was refused is that one edge and not the chain.
    expect(parseQueue(twoAbove("ELSEWHERE")).ok).toBe(true);
  });

  it("a work entry whose blockedBy names one of its own steps is refused at the queue read", () => {
    // A step ships in its work entry's own session, so the entry would be
    // waiting on something only its own run can land.
    const error = soleForestError([
      forestEntry("OWNING-WORK", "work", undefined, {
        kind: "blockedBy",
        tags: ["THE-STEP"],
      }),
      forestEntry("THE-STEP", "step", "OWNING-WORK"),
    ]);
    expect(error.file).toBe(entryFileName("OWNING-WORK"));
    expect(error.path).toBe("gate.tags.0");
    expect(error.message).toContain("THE-STEP");

    // The read is of the subtree, not of the children: a step below a step is
    // still one of the entry's own steps.
    const deeper = soleForestError([
      forestEntry("OWNING-WORK", "work", undefined, {
        kind: "blockedBy",
        tags: ["THE-SUBSTEP"],
      }),
      forestEntry("THE-STEP", "step", "OWNING-WORK"),
      forestEntry("THE-SUBSTEP", "step", "THE-STEP"),
    ]);
    expect(deeper.file).toBe(entryFileName("OWNING-WORK"));
    expect(deeper.path).toBe("gate.tags.0");

    // Non-vacuity: the same entry waiting on a step of a *different* work
    // entry parses — a step out there ships in a session of its own.
    expect(
      parseQueue([
        forestEntry("OWNING-WORK", "work", undefined, {
          kind: "blockedBy",
          tags: ["OTHER-STEP"],
        }),
        forestEntry("THE-STEP", "step", "OWNING-WORK"),
        forestEntry("OTHER-WORK", "work"),
        forestEntry("OTHER-STEP", "step", "OTHER-WORK"),
      ]).ok,
    ).toBe(true);
  });

  it("a work entry blockedBy a group that is no ancestor of it is admitted", () => {
    // Containment is the rule, not kind: a group elsewhere in the forest
    // leaves the queue with *its* last descendant, which this entry is not,
    // so the edge really can resolve.
    const result = parseQueue([
      forestEntry("MY-GROUP", "group"),
      forestEntry("OTHER-GROUP", "group"),
      forestEntry("UNDER-OTHER", "work", "OTHER-GROUP"),
      forestEntry("THE-WORK", "work", "MY-GROUP", {
        kind: "blockedBy",
        tags: ["OTHER-GROUP"],
      }),
    ]);
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(result.entries).toHaveLength(4);
    // Non-vacuity on the gate itself: what parsed is the blockedBy naming the
    // group, not a gate the read rewrote.
    expect(result.entries.find((e) => e.tag === "THE-WORK")!.gate).toEqual({
      kind: "blockedBy",
      tags: ["OTHER-GROUP"],
    });
  });

  it("a parent chain deeper than maxEntryDepth is refused", () => {
    const fiveDeep = [
      forestEntry("GEN-1", "group"),
      forestEntry("GEN-2", "group", "GEN-1"),
      forestEntry("GEN-3", "group", "GEN-2"),
      forestEntry("GEN-4", "work", "GEN-3"),
      forestEntry("GEN-5", "step", "GEN-4"),
    ];
    const error = soleForestError(fiveDeep);
    expect(error.file).toBe(entryFileName("GEN-5"));
    expect(error.path).toBe("parent");
    expect(error.message).toContain(String(DEFAULT_MAX_ENTRY_DEPTH));

    // Non-vacuity: the four-deep prefix of the same chain parses, so what the
    // default refused is the fifth generation and not the shape of a chain.
    expect(parseQueue(fiveDeep.slice(0, 4)).ok).toBe(true);
  });

  it("a parent chain that closes on itself is refused", () => {
    // A cycle has no root, so it is a chain of parents no cap can bound —
    // and a walk up it is the one shape that would not terminate.
    const result = parseQueue([
      forestEntry("CYCLE-A", "group", "CYCLE-B"),
      forestEntry("CYCLE-B", "group", "CYCLE-A"),
    ]);
    expect(result.ok).toBe(false);
    // Both members are refused, each in its own file: a reader opening either
    // one is told the chain above it closes.
    expect(result.errors.map((e) => e.file).sort()).toEqual([
      entryFileName("CYCLE-A"),
      entryFileName("CYCLE-B"),
    ]);
  });

  /** One root work entry waiting on `tags`. */
  function waitingOn(tag: string, ...tags: string[]): Record<string, unknown> {
    return forestEntry(tag, "work", undefined, { kind: "blockedBy", tags });
  }

  it("a queue whose blockedBy edges form a cycle is refused naming the entries in it", () => {
    // Nothing downstream can see this: both entries parse, both are reported
    // queued, and the only symptom is that neither ever ships.
    const cycle = [waitingOn("WAITS-ON-B", "WAITS-ON-A"), waitingOn("WAITS-ON-A", "WAITS-ON-B")];
    const result = parseQueue(cycle);
    expect(result.ok).toBe(false);
    // All-or-nothing over the directory, as for every other forest defect.
    expect(result.entries).toEqual([]);
    // Each member refused in its own file, at the tag it declared: a reader
    // opening either one is told the blockers above it close.
    expect(result.errors.map((e) => e.file).sort()).toEqual([
      entryFileName("WAITS-ON-A"),
      entryFileName("WAITS-ON-B"),
    ]);
    for (const error of result.errors) {
      expect(error.path).toBe("gate.tags.0");
      expect(error.message).toContain("WAITS-ON-A");
      expect(error.message).toContain("WAITS-ON-B");
    }

    // Non-vacuity: the same pair with one edge dropped parses, so what was
    // refused is the closed loop and not a queue of two blocked entries.
    const open = parseQueue([forestEntry("WAITS-ON-B", "work"), cycle[1]!]);
    expect(open.ok, JSON.stringify(open.errors)).toBe(true);
    expect(open.entries).toHaveLength(2);
    // And the chain-less read refuses it too — core shape, one verdict.
    expect(parseQueueLoose(cycle).ok).toBe(false);
  });

  it("a queue whose blockedBy cycle runs through three entries names all three", () => {
    // A cycle is a reachability question, not a chain's last link: the hop
    // back can be any distance out, and the refusal names the whole path so a
    // reader can cut it without re-walking the queue.
    const result = parseQueue([
      waitingOn("RING-A", "RING-B"),
      waitingOn("RING-B", "RING-C"),
      waitingOn("RING-C", "RING-A"),
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.file).sort()).toEqual([
      entryFileName("RING-A"),
      entryFileName("RING-B"),
      entryFileName("RING-C"),
    ]);
    for (const error of result.errors) {
      for (const tag of ["RING-A", "RING-B", "RING-C"]) {
        expect(error.message, error.message).toContain(tag);
      }
    }
    // The path reads in the order the edges lead, from the refused entry out
    // and back to it.
    const fromA = result.errors.find((e) => e.file === entryFileName("RING-A"))!;
    expect(fromA.message).toContain(
      "RING-A blocked by RING-B blocked by RING-C blocked by RING-A",
    );

    // Non-vacuity: the same three entries with the closing edge dropped are a
    // spine the read admits.
    const spine = parseQueue([
      forestEntry("RING-A", "work"),
      waitingOn("RING-B", "RING-A"),
      waitingOn("RING-C", "RING-B"),
    ]);
    expect(spine.ok, JSON.stringify(spine.errors)).toBe(true);
    expect(spine.entries).toHaveLength(3);
  });

  it("a blockedBy naming a tag no entry in the queue carries is admitted", () => {
    // A blocker the queue does not hold has already shipped by the membership
    // read selection takes, so it closes no cycle and gates nothing: the
    // cycle search skips it rather than reading it as a dangling pointer the
    // way `parent` is read.
    const result = parseQueue([
      waitingOn("WAITS-ON-SHIPPED", "LEFT-THE-QUEUE"),
      // Beside it, an entry whose two blockers are one present and one gone:
      // the resolved half is a real edge and still closes nothing.
      forestEntry("WAITS-ON-BOTH", "work", undefined, {
        kind: "blockedBy",
        tags: ["WAITS-ON-SHIPPED", "ALSO-GONE"],
      }),
    ]);
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(result.entries.map((e) => e.tag)).toEqual([
      "WAITS-ON-SHIPPED",
      "WAITS-ON-BOTH",
    ]);
    // Non-vacuity on the gate itself: what parsed is a blockedBy gate naming
    // the absent tag, not a gate the read rewrote.
    const [first] = result.entries;
    expect(first!.gate).toEqual({
      kind: "blockedBy",
      tags: ["LEFT-THE-QUEUE"],
    });
  });
});

/**
 * The forest's one descent and the predicate that picks its roots out
 * (`subtreeOf` and `isGoal`, `src/PendingSchema.ts`) — the facts a consumer
 * would otherwise rebuild to render the queue
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
 * never rediscovered*).
 *
 * Every fixture here goes through the real queue parse, so what the walk
 * reads is a forest a producer could have filed: a `parent` the grammar
 * refuses or a chain deeper than the cap never reaches a live caller's
 * listing at all.
 */
const parsedForest = (entries: readonly Record<string, unknown>[]): PendingEntry[] => {
  const result = parseQueue(entries);
  expect(result.ok, JSON.stringify(result.errors)).toBe(true);
  expect(result.entries).toHaveLength(entries.length);
  return result.entries;
};

it("the engine's subtree walk answers each entry below a tag with its depth", () => {
  const forest = parsedForest([
    forestEntry("THE-GOAL", "group"),
    forestEntry("THE-EPIC", "group", "THE-GOAL"),
    forestEntry("THE-WORK", "work", "THE-EPIC"),
    forestEntry("THE-STEP", "step", "THE-WORK"),
    forestEntry("OUTSIDE-THE-GOAL", "work"),
  ]);

  const below = subtreeOf(forest, "THE-GOAL");

  // Non-vacuity: three levels stand under the goal and a fourth entry stands
  // outside it, so the depths below are each over a populated subtree and the
  // omission is a real sibling's.
  expect(below).toHaveLength(3);
  expect(below.map(({ entry, depth }) => `${entry.tag}@${depth}`)).toEqual([
    "THE-EPIC@1",
    "THE-WORK@2",
    "THE-STEP@3",
  ]);
  // And the flattening keeps the same subtree, since it is one call of the
  // same walk rather than a second descent.
  expect(descendantsOf(forest, "THE-GOAL").map((entry) => entry.tag)).toEqual(
    below.map(({ entry }) => entry.tag),
  );
});

it("the engine's subtree walk orders siblings by the comparator its caller supplied", () => {
  // Three sibling subtrees, filed in an order that is neither of the two the
  // comparators below ask for — so each answer is the comparator's doing and
  // not the order the entry files happened to arrive in.
  const forest = parsedForest([
    forestEntry("THE-GOAL", "group"),
    forestEntry("B-EPIC", "group", "THE-GOAL"),
    forestEntry("B-WORK", "work", "B-EPIC"),
    forestEntry("C-EPIC", "group", "THE-GOAL"),
    forestEntry("C-WORK", "work", "C-EPIC"),
    forestEntry("A-EPIC", "group", "THE-GOAL"),
    forestEntry("A-WORK", "work", "A-EPIC"),
  ]);

  const tags = (
    order?: (a: PendingEntry, b: PendingEntry) => number,
  ): string[] => subtreeOf(forest, "THE-GOAL", order).map(({ entry }) => entry.tag);

  const ascending = (a: PendingEntry, b: PendingEntry): number =>
    a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0;

  // Non-vacuity: six entries stand under the goal, so each sequence below is
  // a reordering of a populated subtree.
  expect(tags()).toHaveLength(6);
  expect(tags()).toEqual([
    "B-EPIC",
    "B-WORK",
    "C-EPIC",
    "C-WORK",
    "A-EPIC",
    "A-WORK",
  ]);
  expect(tags(ascending)).toEqual([
    "A-EPIC",
    "A-WORK",
    "B-EPIC",
    "B-WORK",
    "C-EPIC",
    "C-WORK",
  ]);
  expect(tags((a, b) => ascending(b, a))).toEqual([
    "C-EPIC",
    "C-WORK",
    "B-EPIC",
    "B-WORK",
    "A-EPIC",
    "A-WORK",
  ]);
});

it("the engine's subtree walk comes back empty for a tag no entry carries", () => {
  const forest = parsedForest([
    forestEntry("THE-GOAL", "group"),
    forestEntry("THE-WORK", "work", "THE-GOAL"),
  ]);

  // Non-vacuity: the same listing answers a tag it does hold, so the empty
  // answers below are the unheld tag's and not an empty listing's.
  expect(subtreeOf(forest, "THE-GOAL")).toHaveLength(1);
  expect(subtreeOf(forest, "NO-SUCH-TAG")).toEqual([]);
  expect(descendantsOf(forest, "NO-SUCH-TAG")).toEqual([]);
});

it("the engine answers whether an entry is a goal off its kind and parent", () => {
  // Both fields varied independently: a `group` at the root and under one, a
  // root that is not a `group`, and the two kinds below. So the single `true`
  // is the conjunction and not the kind alone or the root alone.
  const forest = parsedForest([
    forestEntry("ROOT-GROUP", "group"),
    forestEntry("GROUP-UNDER-IT", "group", "ROOT-GROUP"),
    forestEntry("ROOT-WORK", "work"),
    forestEntry("WORK-UNDER-IT", "work", "GROUP-UNDER-IT"),
    forestEntry("A-STEP-OF-IT", "step", "WORK-UNDER-IT"),
  ]);

  expect(Object.fromEntries(forest.map((e) => [e.tag, isGoal(e)]))).toEqual({
    "ROOT-GROUP": true,
    "GROUP-UNDER-IT": false,
    "ROOT-WORK": false,
    "WORK-UNDER-IT": false,
    "A-STEP-OF-IT": false,
  });
});

describe("gate=blockedBy — pickability against the queue the entry sits in (spec/pending.md § Pickability)", () => {
  /**
   * The waiter plus whichever of `queued` blockers the queue still holds —
   * through the real queue parse, so the listing the gate read is handed is
   * one a producer could have written.
   */
  function queueHolding(
    gateTags: readonly string[],
    queued: readonly string[],
  ): PendingEntry[] {
    const result = parseQueue([
      { ...baseEntry, tag: "WAITER", gate: { kind: "blockedBy", tags: gateTags } },
      ...queued.map((tag) => ({ ...baseEntry, tag, gate: { kind: "open" } })),
    ]);
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(result.entries).toHaveLength(queued.length + 1);
    return result.entries;
  }

  /** The waiter out of a listing {@link queueHolding} composed. */
  const waiter = (queue: readonly PendingEntry[]): PendingEntry =>
    queue.find((e) => e.tag === "WAITER")!;

  it("is pickable once the single named blocker has left the queue", () => {
    const standing = queueHolding(["UPSTREAM"], ["UPSTREAM"]);
    expect(isPickableNow(waiter(standing), standing)).toBe(false);

    const settled = queueHolding(["UPSTREAM"], []);
    expect(isPickableNow(waiter(settled), settled)).toBe(true);
  });

  it("a multi-parent entry is not pickable until EVERY named blocker has shipped", () => {
    const oneLeft = queueHolding(
      ["UPSTREAM-A", "UPSTREAM-B"],
      ["UPSTREAM-B"],
    );
    expect(isPickableNow(waiter(oneLeft), oneLeft)).toBe(false);

    const both = queueHolding(["UPSTREAM-A", "UPSTREAM-B"], []);
    expect(isPickableNow(waiter(both), both)).toBe(true);
  });
});

/**
 * `spec/pending.md`, *Pickability* — **an entry inherits its ancestors'
 * gates**: a `blockedBy` declared once on a goal holds its whole subtree, so
 * the gate read answers over every entry the child's `parent` chain names and
 * not its own gate alone.
 *
 * Every listing here goes through the real queue parse, so the forest the
 * climb walks is one the producer-side read would admit — a fixture hand-
 * building `parent` links could gate a child under an ancestor pairing the
 * queue refuses outright. Each case's child carries `gate: { kind: "open" }`
 * and declares no fork, which is the direction pin the claim needs: nothing
 * about the child itself can account for the verdict.
 */
describe("isPickableNow — an entry inherits its ancestors' gates (spec/pending.md § Pickability)", () => {
  /**
   * A forest of `specs`, through the real parse, with the entry named by
   * `child` handed back beside the listing it sits in.
   */
  function forest(
    specs: readonly Record<string, unknown>[],
    child: string,
  ): { entry: PendingEntry; queue: PendingEntry[] } {
    const result = parseQueue(specs);
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(result.entries).toHaveLength(specs.length);
    const entry = result.entries.find((e) => e.tag === child);
    expect(entry, `no entry named ${child} in the parsed listing`).toBeDefined();
    // Non-vacuity on the subject: what the cases below judge is a child whose
    // own gate is open and whose own forks are none, in a listing that really
    // holds a parent for it.
    expect(entry!.gate).toEqual({ kind: "open" });
    expect(entry!.dependsOnForks).toEqual([]);
    expect(entry!.parent).toBeDefined();
    return { entry: entry!, queue: result.entries };
  }

  /** A `group` entry carrying `gate`, with no files of its own. */
  const group = (tag: string, gate: unknown, parent?: string): Record<string, unknown> => ({
    tag,
    kind: "group",
    gate,
    files: {},
    ...(parent === undefined ? {} : { parent }),
  });

  /** An open `work` entry under `parent` — the subject of every case here. */
  const workUnder = (tag: string, parent: string): Record<string, unknown> => ({
    ...baseEntry,
    tag,
    parent,
    gate: { kind: "open" },
  });

  it("a work entry under an open group stays pickable", () => {
    const { entry, queue } = forest(
      [group("GOAL", { kind: "open" }), workUnder("WORK-UNDER-GOAL", "GOAL")],
      "WORK-UNDER-GOAL",
    );
    expect(isPickableNow(entry, queue)).toBe(true);
  });

  it("a work entry under a parked group is not pickable", () => {
    const { entry, queue } = forest(
      [
        group("GOAL", { kind: "parked", reason: "decision on the shape" }),
        workUnder("WORK-UNDER-GOAL", "GOAL"),
      ],
      "WORK-UNDER-GOAL",
    );
    expect(isPickableNow(entry, queue)).toBe(false);
  });

  it("a work entry under a group whose blockedBy has not settled is not pickable", () => {
    const standing = forest(
      [
        group("GOAL", { kind: "blockedBy", tags: ["UPSTREAM"] }),
        workUnder("WORK-UNDER-GOAL", "GOAL"),
        { ...baseEntry, tag: "UPSTREAM", gate: { kind: "open" } },
      ],
      "WORK-UNDER-GOAL",
    );
    expect(isPickableNow(standing.entry, standing.queue)).toBe(false);

    // Direction: the same forest with the blocker gone from the queue — the
    // settled verdict — picks the child, so the refusal above is the standing
    // blocker and not the `parent` link.
    const settled = forest(
      [
        group("GOAL", { kind: "blockedBy", tags: ["UPSTREAM"] }),
        workUnder("WORK-UNDER-GOAL", "GOAL"),
      ],
      "WORK-UNDER-GOAL",
    );
    expect(isPickableNow(settled.entry, settled.queue)).toBe(true);
  });

  it("a work entry under a group gated on an unasserted capability is not pickable", () => {
    const { entry, queue } = forest(
      [
        group("GOAL", { kind: "requiresCapability", capability: "docker-host" }),
        workUnder("WORK-UNDER-GOAL", "GOAL"),
      ],
      "WORK-UNDER-GOAL",
    );
    expect(isPickableNow(entry, queue, () => true, new Set())).toBe(false);
    // Direction: the chain asserting it clears the inherited gate too.
    expect(
      isPickableNow(entry, queue, () => true, new Set(["docker-host"])),
    ).toBe(true);
  });

  it("a work entry two groups below a parked root is not pickable", () => {
    const { entry, queue } = forest(
      [
        group("GOAL", { kind: "parked", reason: "decision on the shape" }),
        group("EPIC", { kind: "open" }, "GOAL"),
        workUnder("WORK-UNDER-EPIC", "EPIC"),
      ],
      "WORK-UNDER-EPIC",
    );
    // The nearest ancestor is open, so a climb that stopped at the parent
    // would read this pickable.
    expect(queue.find((e) => e.tag === "EPIC")!.gate).toEqual({ kind: "open" });
    expect(isPickableNow(entry, queue)).toBe(false);
  });

  it("an entry whose parent the listing does not hold answers over its own gate", () => {
    // The tooling caller's reading: a producer asking whether the entry it is
    // about to write would be buildable hands the queue it would join, which
    // need not hold the group yet (`docs/CHAIN-AUTHORING.md`). The entry comes
    // from a listing that does hold the group — a one-entry queue naming an
    // absent parent is refused outright, so the climb's missing-ancestor arm
    // is reachable only by narrowing the listing, never by a malformed one.
    const { entry, queue } = forest(
      [
        group("GOAL", { kind: "parked", reason: "decision on the shape" }),
        workUnder("WORK-UNDER-GOAL", "GOAL"),
      ],
      "WORK-UNDER-GOAL",
    );
    expect(isPickableNow(entry, queue)).toBe(false);
    expect(isPickableNow(entry, [])).toBe(true);
  });
});

describe("gate=requiresCapability — pickability", () => {
  /** As in the fork describe above: a listing that decides nothing. */
  const noQueue: PendingEntry[] = [];

  it("is pickable when the capability is asserted", () => {
    const entry = roundTrip({
      ...baseEntry,
      gate: { kind: "requiresCapability", capability: "docker-host" },
    });
    expect(
      isPickableNow(entry, noQueue, () => true, new Set(["docker-host"])),
    ).toBe(true);
  });

  it("is skipped when the capability is not asserted", () => {
    const entry = roundTrip({
      ...baseEntry,
      gate: { kind: "requiresCapability", capability: "docker-host" },
    });
    expect(isPickableNow(entry, noQueue, () => true, new Set())).toBe(false);
  });

  it("defaults to non-pickable when no capabilities set is supplied", () => {
    const entry = roundTrip({
      ...baseEntry,
      gate: { kind: "requiresCapability", capability: "docker-host" },
    });
    expect(isPickableNow(entry, noQueue)).toBe(false);
  });
});

describe("renderSchemaForPrompt", () => {
  it("bare core matches the documented prompt shape", () => {
    expect(renderSchemaForPrompt()).toMatchInlineSnapshot(`
      "Each pending entry MUST conform to this shape (fields not listed here are rejected):

      {
        "tag": "<letters/digits/._()- only, no whitespace, ≤216 chars>",   // unique; appears in commit msg; mechanical safety is the floor, a chain-declared refinement (if any) narrows further
        "gate": { "kind": "open" }                                  // ready to ship
              | { "kind": "blockedBy", "tags": ["OTHER-TAG", ...] }   // upstream blocks; non-empty, name every parent. Over its own containment: a work entry's blockedBy names no ancestor or step of its own, since a group leaves the queue with its last descendant and a step ships in its work entry's session, so each would wait on the other. Over the queue: a step's blockedBy names only steps of the same work entry; a dependency reaching outside it is declared on the work entry.
              | { "kind": "parked",    "reason": "decision on ..." }  // human action needed
              | { "kind": "deferred",  "reason": "no consumer yet" }  // carried indefinitely
              | { "kind": "requiresCapability", "capability": "some-env-fact" },  // env gate; pickable iff the chain asserts this capability
        "dependsOnForks": [ "fork-slug", ... ],               // optional; foundational forks this rests on — not picked until the chain resolves every one. Omit if none.
        "kind": "work" | "step" | "group",                    // optional, default "work"; "work" is the dispatch unit and the only kind selection picks, "step" is part of a work entry and ships in its session, "group" organizes and leaves the queue with its last descendant. Omit for work.
        "parent": "OTHER-TAG",                                // optional; the entry this one is part of, by tag — one parent, so the queue is a forest. Omit for a root. Judged over the whole queue: a parent names an entry in it; a work entry's parent is a group; a step entry's parent is its work entry or another of its steps; a group entry's parent is a group; a chain of parents is at most 4 deep, counted from a root — a listing breaking any of these is refused whole.
        "files": {                                            // EVERY path the work legitimately touches — tests and incidentals included. Enforced on fanout: a scoped tick may write ONLY these paths ∪ the phase's channel paths; an under-declared entry trips the write guard.
          "new":  [ { "path": "...", "description": "..." } ],
          "edit": [ { "path": "...", "description": "..." } ],
          "retire": [ "path", ... ]
        },
        "observedFiles": [ "path", ... ]                      // engine-maintained, never authored here: the dispatcher records the real footprint of an attempt that did not ship, so a retry partitions away from whatever it collided with. Carry it through unchanged when an entry already has one; omit it otherwise.
      }

      One entry per file, named "<tag>.json" directly under the queue directory — the filename and the "tag" field must agree. The queue's order is computed at every selection, never carried by a position or a filename. An empty directory is valid (means nothing pending)."
    `);
  });

  // The core hints are injected verbatim into every downstream chain's plan
  // prompt, so vocabulary from *this* repo's chain — a phase name, a plan-lane
  // artifact, a noun from our stack — ships as if the engine owned it
  // (.claude/rules/engine-boundary.md § Capability vs convention). That class
  // is the shared list in tests/helpers/chainVocabulary.ts, asserted over the
  // whole rendering below and over the shipped doc comments by the same
  // checker; only vocabulary specific to one hint is spelled here. Each pin
  // asserts its subject line is present before asserting the absence — an
  // absence over a vanished subject is a vacuous green.
  const hintLineFor = (rendered: string, field: string): string => {
    const line = rendered
      .split("\n")
      .find((candidate) => candidate.includes(`"${field}":`));
    expect(line, `no rendered hint line for "${field}"`).toBeDefined();
    return line as string;
  };

  it("the rendered pending schema names no term in the shared chain-vocabulary list", () => {
    const rendered = renderSchemaForPrompt();
    expect(rendered).toContain(`"kind": "parked"`);
    expect(hintLineFor(rendered, "dependsOnForks")).toBeTruthy();
    expect(hintLineFor(rendered, "files")).toBeTruthy();
    expectNoChainVocabulary(rendered, "the rendered core schema");
  });

  it("the rendered `files` hint names no language-specific incidental", () => {
    const line = hintLineFor(renderSchemaForPrompt(), "files");
    expect(line).toContain("EVERY path");
    expect(line).not.toMatch(
      /\b(lockfile|barrel|node_modules|package\.json|tsconfig|pnpm|npm)\b/i,
    );
  });

  // open-questions rides the shared list, asserted over the whole rendering
  // above; RESOLVED is this hint's own vocabulary and stays here.
  it("the rendered `dependsOnForks` hint names no fork-resolution marker", () => {
    const line = hintLineFor(renderSchemaForPrompt(), "dependsOnForks");
    expect(line).toContain("optional");
    expect(line).not.toMatch(/\bRESOLVED\b/);
  });

  // The entry's own `kind` shares its spelling with the gate's discriminant, so
  // this hint is found by the value it renders rather than by the field name —
  // `hintLineFor` would hand back the gate's first arm. Scoped to the one hint
  // line, never the whole render.
  it("the rendered schema's kind hint names every kind the core accepts and which one is picked", () => {
    const line = renderSchemaForPrompt()
      .split("\n")
      .find((candidate) => candidate.includes(`"kind": "work"`));
    expect(line, `no rendered hint line for the entry's own "kind"`).toBeDefined();
    for (const kind of ["work", "step", "group"]) {
      expect(line).toContain(`"${kind}"`);
    }
    expect(line).toContain("default");
    expect(line).toContain("the only kind selection picks");
  });

  it("the retire hint advertises a path only, never a non-path alternative (.claude/rules/engineering.md § A seam gate reads what the real writer wrote)", () => {
    const rendered = renderSchemaForPrompt();
    const retireLine = rendered
      .split("\n")
      .find((line) => line.includes(`"retire":`));
    expect(retireLine).toBeDefined();
    expect(retireLine).not.toMatch(/symbol/);
  });

  it("fence compatibility: a retired entry the hint's own contract allows survives the same path-fence its new/edit siblings do", () => {
    // declaredPaths() is what the build-fence pre-check (pendingGate) reads
    // to decide whether an entry's declared files clear the target fence —
    // driving the real writer's output through it here is the agreement
    // check for the hint fixed above: since retire elements are folded into
    // declaredPaths() unchanged (no path-or-symbol branch), a retire value
    // the hint permits reaches the fence exactly as any new/edit path does.
    const entry = roundTrip({
      ...baseEntry,
      gate: { kind: "open" },
      files: {
        new: [],
        edit: [],
        retire: ["src/deprecated.ts"],
      },
    });
    expect(declaredPaths([entry], entry)).toEqual(["src/deprecated.ts"]);
  });

  it("renders every declared extension field with its hint, after the core", () => {
    const rendered = renderSchemaForPrompt(testExtension);
    expect(rendered).toContain(`"summary": "one-line what (≤200 chars)"`);
    expect(rendered).toContain(`"per": { "path": "...", "section": "..." }`);
    expect(rendered).toContain(`"notes": "≤500 chars"`);
  });

  it("preserves the list separator when a hint ends in a trailing line comment", () => {
    const withCommentedHint = {
      summary: {
        schema: z.string(),
        hint: `"one-line what" // freeform`,
      },
      notes: {
        schema: z.string().optional(),
        hint: `"≤500 chars"`,
      },
    } satisfies EntryExtension;
    const rendered = renderSchemaForPrompt(withCommentedHint);
    expect(rendered).toContain(
      `  "summary": "one-line what",  // freeform\n  "notes": "≤500 chars"`,
    );
  });

  it("the list separator lands before the last core field's trailing line comment when an extension follows", () => {
    // The core block's last line ends in a `// ` comment too, so the
    // core-to-extension junction is the same case as the one above — a ","
    // appended past "//" is read as comment text, leaving the first
    // extension field undelimited. Both sides read off the real render:
    // the last core line and the first extension line are located in the
    // output rather than restated here.
    const rendered = renderSchemaForPrompt(testExtension);
    const lines = rendered.split("\n");
    const firstExtensionName = Object.keys(testExtension)[0] as string;
    const firstExtensionIndex = lines.findIndex((line) =>
      line.startsWith(`  "${firstExtensionName}":`),
    );
    expect(
      firstExtensionIndex,
      "rendered schema carried no extension field — nothing to judge the junction on",
    ).toBeGreaterThan(0);
    const lastCoreLine = lines[firstExtensionIndex - 1] as string;
    expect(lastCoreLine, "the last core line carries no trailing comment").toContain(
      " // ",
    );
    const code = lastCoreLine.slice(0, lastCoreLine.indexOf(" // ")).trimEnd();
    expect(
      code.endsWith(","),
      `the last core field is undelimited from the extension that follows: ${lastCoreLine}`,
    ).toBe(true);
    expect(lastCoreLine.trimEnd().endsWith(",")).toBe(false);
  });

  it("does not split a hint on '//' occurring inside its own text (e.g. a URL)", () => {
    const withUrlHint = {
      webhook: {
        schema: z.string(),
        hint: `"https://example.com/hooks/notify"`,
      },
      notes: {
        schema: z.string().optional(),
        hint: `"≤500 chars"`,
      },
    } satisfies EntryExtension;
    const rendered = renderSchemaForPrompt(withUrlHint);
    expect(rendered).toContain(
      `  "webhook": "https://example.com/hooks/notify",\n  "notes": "≤500 chars"`,
    );
    expect(rendered).not.toContain("https:,");
  });

  it("still splits at a genuine trailing comment when the hint also contains a URL", () => {
    const withUrlAndComment = {
      webhook: {
        schema: z.string(),
        hint: `"https://example.com/hooks/notify"  // called on submit`,
      },
      notes: {
        schema: z.string().optional(),
        hint: `"≤500 chars"`,
      },
    } satisfies EntryExtension;
    const rendered = renderSchemaForPrompt(withUrlAndComment);
    expect(rendered).toContain(
      `  "webhook": "https://example.com/hooks/notify",  // called on submit\n  "notes": "≤500 chars"`,
    );
  });

  it("no drift: exactly the fields the composed validator accepts are rendered", () => {
    // The rendered schema and the validator come from the same declaration —
    // every declared field name appears in the render, and a field absent
    // from the declaration is both unrendered and rejected.
    const rendered = renderSchemaForPrompt(testExtension);
    for (const name of Object.keys(testExtension)) {
      expect(rendered).toContain(`"${name}":`);
    }
    expect(rendered).not.toContain(`"schemaDelta":`);
    const result = parseQueue(
      [
        { ...baseEntry, gate: { kind: "open" }, schemaDelta: "none" },
      ],
      testExtension,
    );
    expect(result.ok).toBe(false);
  });

  /**
   * Core-field agreement gate (.claude/rules/engineering.md § "A seam gate
   * reads what the real writer wrote"). The check above judges *extension*
   * names, and reads them off the same declaration record both surfaces are
   * built from — the core fields have no such record, so nothing tied the
   * render's header claim ("fields not listed here are rejected") to the field
   * set the composed validator actually accepts. A hand-written list of core
   * names here would be the tester re-authoring the writer's vocabulary, so
   * both sides are read from the real thing: the names come off the engine's
   * `CORE_ENTRY_FIELDS` — the same list `composePendingEntry` composes and
   * refuses shadows against — the render comes off the real
   * `renderSchemaForPrompt`, and the acceptance direction runs through the real
   * `parsePendingQueue`.
   */
  function renderedTopLevelFieldNames(rendered: string): string[] {
    return rendered.split("\n").flatMap((line) => {
      const match = /^ {2}"([^"]+)":/.exec(line);
      return match ? [match[1] as string] : [];
    });
  }

  it("every engine-core field the composed validator accepts is named in the rendered schema", () => {
    const coreFields = CORE_ENTRY_FIELDS;
    expect(
      coreFields.length,
      "engine exposed no core field names — nothing to judge",
    ).toBeGreaterThan(0);
    const rendered = renderSchemaForPrompt();
    for (const name of coreFields) {
      expect(
        rendered,
        `core field "${name}" is accepted by the composed validator but unnamed in the rendered schema, which tells its reader unlisted fields are rejected`,
      ).toContain(`"${name}":`);
    }
  });

  it("parsePendingQueue accepts an entry carrying every field the rendered schema names", () => {
    const renderedNames = renderedTopLevelFieldNames(renderSchemaForPrompt());
    expect(
      renderedNames.length,
      "rendered schema named no top-level fields — nothing to judge",
    ).toBeGreaterThan(0);
    const fullEntry = {
      tag: "EVERY-RENDERED-FIELD",
      gate: { kind: "open" },
      dependsOnForks: ["some-fork"],
      kind: "step",
      parent: "EVERY-RENDERED-PARENT",
      files: {
        new: [{ path: "src/new.ts", description: "the new" }],
        edit: [{ path: "src/edit.ts", description: "the edit" }],
        retire: ["src/retire.ts"],
      },
      observedFiles: ["src/observed.ts"],
    };
    for (const name of renderedNames) {
      expect(
        Object.keys(fullEntry),
        `rendered field "${name}" carries no value in the entry this gate parses`,
      ).toContain(name);
    }
    const result = parseQueue([
      fullEntry,
      // The entry the rendered `parent` names: a parent names an entry in the
      // queue and a step's parent is its work entry (`spec/pending.md`, *The
      // queue is a forest*), so the rendered field's value is only a value
      // beside the entry it points at.
      {
        tag: "EVERY-RENDERED-PARENT",
        gate: { kind: "open" },
        files: { new: [], edit: [], retire: [] },
      },
    ]);
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
  });

  /**
   * Agreement gate (.claude/rules/engineering.md § "A seam gate reads what the
   * real writer wrote"): the checks above only confirm field *names* line up. A
   * hint's stated numeric bound (e.g. "≤200 chars") is free text on the same
   * declaration record as `schema` — nothing ties the two together, so the hint
   * can claim a bound the schema doesn't actually enforce (or vice versa).
   * These tests extract the bound from the real `renderSchemaForPrompt` output
   * and drive it through the real `parsePendingQueue`, so a hint/schema mismatch
   * fails here instead of shipping silently.
   */
  function extractCharBound(rendered: string, fieldName: string): number {
    const match = new RegExp(`"${fieldName}":[\\s\\S]*?≤(\\d+) chars`).exec(
      rendered,
    );
    if (!match) {
      throw new Error(
        `rendered schema states no "≤N chars" bound for "${fieldName}" — cannot derive the agreement check`,
      );
    }
    return Number(match[1]);
  }

  it("tag: a tag at the rendered length bound parses; one char past it does not", () => {
    const max = extractCharBound(renderSchemaForPrompt(), "tag");
    const atBound = "A".repeat(max);
    const overBound = "A".repeat(max + 1);

    const ok = parseQueue(
      [{ ...baseEntry, tag: atBound, gate: { kind: "open" } }],
    );
    expect(ok.ok, JSON.stringify(ok.errors)).toBe(true);

    const bad = parseQueue(
      [
        { ...baseEntry, tag: overBound, gate: { kind: "open" } },
      ],
    );
    expect(bad.ok).toBe(false);
  });

  function extractTagCharsetExtras(rendered: string): string {
    const match = /"<letters\/digits\/([^\s]*?) only, no whitespace/.exec(
      rendered,
    );
    const extras = match?.[1];
    if (extras === undefined) {
      throw new Error(
        'rendered schema does not state the tag charset in the expected `<letters/digits/...only, no whitespace` shape — cannot derive the agreement check',
      );
    }
    return extras;
  }

  it("tag: every character the rendered charset admits is accepted by the real parser", () => {
    const extras = extractTagCharsetExtras(renderSchemaForPrompt());
    const sample = `aZ9${extras}`;
    const result = parseQueue(
      [{ ...baseEntry, tag: sample, gate: { kind: "open" } }],
    );
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
  });

  it("tag: whitespace, excluded by the rendered charset, is rejected by the real parser", () => {
    const rendered = renderSchemaForPrompt();
    expect(rendered).toContain("no whitespace");
    const extras = extractTagCharsetExtras(rendered);
    const result = parseQueue(
      [
        { ...baseEntry, tag: `a ${extras}`, gate: { kind: "open" } },
      ],
    );
    expect(result.ok).toBe(false);
  });

  it.each(["summary", "notes"] as const)(
    "extension field %s: a value at its rendered cap parses; one char past it does not",
    (name) => {
      const rendered = renderSchemaForPrompt(testExtension);
      const max = extractCharBound(rendered, name);
      const validEntry = {
        ...baseEntry,
        gate: { kind: "open" },
        summary: "a valid summary",
        per: { path: "src/foo.ts", section: "some section" },
        notes: "valid notes",
      };

      const ok = parseQueue(
        [{ ...validEntry, [name]: "x".repeat(max) }],
        testExtension,
      );
      expect(ok.ok, JSON.stringify(ok.errors)).toBe(true);

      const bad = parseQueue(
        [{ ...validEntry, [name]: "x".repeat(max + 1) }],
        testExtension,
      );
      expect(bad.ok).toBe(false);
    },
  );

  it("states the in-force tag constraint — core alone", () => {
    const rendered = renderSchemaForPrompt();
    expect(rendered).toContain(`"tag": "<letters/digits/._()- only`);
    expect(rendered).not.toContain("AND");
  });

  it("states the in-force tag constraint — core plus the chain's refinement", () => {
    const withTagRefinement = {
      tag: {
        schema: z.string().regex(/^[A-Z]/),
        hint: `"ALL-CAPS-WITH-DASHES"`,
      },
    } satisfies EntryExtension;
    const rendered = renderSchemaForPrompt(withTagRefinement);
    expect(rendered).toContain(
      `"tag": "<letters/digits/._()- only, no whitespace, ≤216 chars>" AND "ALL-CAPS-WITH-DASHES"`,
    );
    // Not rendered a second time as a generic extension field line. Only the
    // core "tag" line matches — gate.blockedBy's example is "tags" now.
    expect(rendered.match(/"tag":/g)).toHaveLength(1);
  });
});

describe("files — an all-empty declaration is not a floor (spec/pending.md § `files` is a prediction the scheduler consumes)", () => {
  it("parses an entry with files: {} (all-empty new/edit/retire) and it is pickable", () => {
    const result = parseQueue(
      [
        {
          tag: "ZERO-FILES",
          gate: { kind: "open" },
          files: {},
        },
      ],
    );
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    const entry = result.entries[0]!;
    expect(entry.files).toEqual({ new: [], edit: [], retire: [] });
    expect(isPickableNow(entry, result.entries)).toBe(true);
  });

  it("parses clean when only files.new declares a path", () => {
    const result = parseQueue(
      [
        {
          tag: "ONLY-NEW",
          gate: { kind: "open" },
          files: {
            new: [{ path: "src/only-new.ts", description: "new file" }],
            edit: [],
            retire: [],
          },
        },
      ],
    );
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
  });

  it("parses clean when only files.edit declares a path", () => {
    const result = parseQueue(
      [
        {
          tag: "ONLY-EDIT",
          gate: { kind: "open" },
          files: {
            new: [],
            edit: [{ path: "src/only-edit.ts", description: "edit file" }],
            retire: [],
          },
        },
      ],
    );
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
  });

  it("parses clean when only files.retire declares a path", () => {
    const result = parseQueue(
      [
        {
          tag: "ONLY-RETIRE",
          gate: { kind: "open" },
          files: { new: [], edit: [], retire: ["src/only-retire.ts"] },
        },
      ],
    );
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
  });
});

describe("parsePendingQueue — observedFiles survives the round-trip", () => {
  it("preserves the dispatcher-written footprint so a re-parse cannot strip it", () => {
    const entry = roundTrip({
      ...baseEntry,
      gate: { kind: "open" },
      observedFiles: ["src/other.ts", "tests/other.test.ts"],
    });
    expect(entry.observedFiles).toEqual(["src/other.ts", "tests/other.test.ts"]);
  });
});

describe("declaredPaths vs touchedPaths (.claude/rules/engineering.md § The fix lands at the mechanism)", () => {
  it("declaredPaths answers files.new+edit+retire only; touchedPaths additionally folds in observedFiles", () => {
    const entry = roundTrip({
      ...baseEntry,
      gate: { kind: "open" },
      observedFiles: ["src/other.ts"],
    });
    expect(declaredPaths([entry], entry)).toEqual([
      "src/foo.ts",
      "src/bar.ts",
      "src/baz.ts",
    ]);
    expect(touchedPaths([entry], entry)).toEqual([
      "src/foo.ts",
      "src/bar.ts",
      "src/baz.ts",
      "src/other.ts",
    ]);
  });
});

// ---------- a work entry's footprint is its steps' too ----------

/** A step entry as a producer writes it: one edited file, one parent. */
function stepOf(tag: string, parent: string, path: string): unknown {
  return {
    tag,
    kind: "step",
    parent,
    gate: { kind: "open" },
    files: {
      new: [],
      edit: [{ path, description: "the step's file" }],
      retire: [],
    },
  };
}

/**
 * A `work` entry with two steps, one of which has a step of its own, driven
 * through the real strict queue read — so the `parent` links the footprint
 * walk follows are the ones the forest rules admit, not a fixture's own
 * spelling (`spec/pending.md`, *The queue is a forest*).
 */
function forest(): PendingEntry[] {
  const result = parseQueue([
    { ...baseEntry, tag: "WORK", gate: { kind: "open" } },
    stepOf("WORK.1", "WORK", "src/step-one.ts"),
    stepOf("WORK.2", "WORK", "src/step-two.ts"),
    stepOf("WORK.2.1", "WORK.2", "src/step-two-a.ts"),
  ]);
  expect(result.ok, JSON.stringify(result.errors)).toBe(true);
  return result.entries;
}

const entryIn = (queue: readonly PendingEntry[], tag: string): PendingEntry => {
  const found = queue.find((e) => e.tag === tag);
  expect(found, `no entry ${tag} in the fixture queue`).toBeDefined();
  return found!;
};

describe("declaredPaths over a forest (spec/pending.md § The queue is a forest)", () => {
  it("a work entry's declared paths include its steps' files", () => {
    const queue = forest();
    const work = entryIn(queue, "WORK");

    // Non-vacuity: the fixture's work entry really carries steps, and none of
    // their paths is one it declared itself — so the union below is the fold
    // and not the entry's own `files` read twice.
    expect(queue.filter((e) => e.kind === "step")).toHaveLength(3);
    expect(work.files.edit.map((f) => f.path)).not.toContain("src/step-one.ts");

    expect([...declaredPaths(queue, work)].sort()).toEqual([
      "src/bar.ts",
      "src/baz.ts",
      "src/foo.ts",
      "src/step-one.ts",
      "src/step-two-a.ts",
      "src/step-two.ts",
    ]);
  });

  it("a step's own declared paths are its files alone", () => {
    const queue = forest();

    // The fold is downward only. The work entry above this step declares
    // three files and a sibling step declares another, and the read below
    // sees none of them.
    expect(declaredPaths(queue, entryIn(queue, "WORK"))).toHaveLength(6);

    expect(declaredPaths(queue, entryIn(queue, "WORK.1"))).toEqual([
      "src/step-one.ts",
    ]);
  });

  it("a step carrying steps of its own folds them, and one path two of them declare is one member", () => {
    const result = parseQueue([
      { ...baseEntry, tag: "WORK", gate: { kind: "open" } },
      stepOf("WORK.1", "WORK", "src/shared.ts"),
      stepOf("WORK.1.1", "WORK.1", "src/shared.ts"),
    ]);
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    const queue = result.entries;

    expect(declaredPaths(queue, entryIn(queue, "WORK.1"))).toEqual([
      "src/shared.ts",
    ]);
    expect([...declaredPaths(queue, entryIn(queue, "WORK"))].sort()).toEqual([
      "src/bar.ts",
      "src/baz.ts",
      "src/foo.ts",
      "src/shared.ts",
    ]);
  });

  it("touchedPaths folds every step's observedFiles beside its declarations", () => {
    const result = parseQueue([
      { ...baseEntry, tag: "WORK", gate: { kind: "open" } },
      {
        ...(stepOf("WORK.1", "WORK", "src/step-one.ts") as object),
        observedFiles: ["src/stray.ts"],
      },
    ]);
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    const queue = result.entries;
    const work = entryIn(queue, "WORK");

    expect(entryIn(queue, "WORK.1").observedFiles).toEqual(["src/stray.ts"]);
    expect(declaredPaths(queue, work)).not.toContain("src/stray.ts");
    expect(touchedPaths(queue, work)).toContain("src/stray.ts");
  });
});

/**
 * The rendered schema against the read that enforces it
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*). The forest's rules sit on no per-entry validator — they read a
 * second entry or a chain of them — so a block stating only "one parent, so
 * the queue is a forest" left a producer refused a whole queue over pairings,
 * a depth and a blocker scope it was never shown.
 *
 * Both sides are the real thing: every sentence is read out of
 * `renderSchemaForPrompt`'s own text and every verdict off `parsePendingQueue`
 * over a queue built to break exactly that sentence, so a rule one side gains
 * alone reds.
 */
describe("the rendered schema states the forest the queue read enforces", () => {
  /**
   * The cap this file's renders and parses share — not the default, so what a
   * case reads back is the value it passed and never a constant either side
   * happens to hold.
   */
  const DECLARED_CAP = 3;

  /** One rendered line, found by the field it hints. */
  function renderedLine(rendered: string, lead: string): string {
    const line = rendered.split("\n").find((c) => c.startsWith(lead));
    expect(line, `no rendered line starting "${lead}"`).toBeDefined();
    return line as string;
  }

  /**
   * The rendered `parent` hint, which is where the queue-wide rules sit.
   *
   * Read as the one line rather than as a substring of the whole block: the
   * render also quotes the kind enum and every other hint, and a phrase
   * asserted over all of it turns on whatever those happen to say
   * (`.claude/rules/posture-sweep.md`, *Standing lenses*).
   */
  const parentHint = (cap: number = DECLARED_CAP): string =>
    renderedLine(renderSchemaForPrompt(undefined, cap), '  "parent":');

  /**
   * Every kind the rendered block offers, read off its own enum rather than
   * listed here: the engine exports no kind roster, and a kind that reached
   * the core without reaching the pairings is exactly the drift these cases
   * are for.
   */
  function renderedKinds(): string[] {
    const line = renderedLine(renderSchemaForPrompt(), '  "kind": ');
    const offered = line.slice(line.indexOf(":") + 1, line.indexOf(" //"));
    const kinds = [...offered.matchAll(/"([a-z]+)"/g)].map((m) => m[1] as string);
    expect(
      kinds.length,
      "the rendered kind hint offered no kind — nothing to pair",
    ).toBeGreaterThan(1);
    return [...new Set(kinds)];
  }

  /**
   * What the rendered hint says may parent a `kind` entry — the clause up to
   * the separator between rules, never the whole hint, so a phrase naming one
   * kind cannot answer for another.
   */
  function statedParentPhrase(hint: string, kind: string): string {
    const lead = `a ${kind} entry's parent is `;
    const at = hint.indexOf(lead);
    expect(
      at,
      `the rendered parent hint states no rule for a ${kind} entry`,
    ).toBeGreaterThan(-1);
    const rest = hint.slice(at + lead.length);
    const end = rest.indexOf(";");
    return end === -1 ? rest : rest.slice(0, end);
  }

  /** A chain of `depth` entries, each the parent of the next. */
  const chainOfParents = (depth: number): Record<string, unknown>[] =>
    Array.from({ length: depth }, (_unused, index) =>
      forestEntry(
        `GEN-${index + 1}`,
        "group",
        index === 0 ? undefined : `GEN-${index}`,
      ),
    );

  /** Whether the real read admits a `child` entry under a `parent` one. */
  const pairParses = (child: string, parent: string): boolean =>
    parsePendingQueue(
      queueOf([
        forestEntry("THE-PARENT", parent),
        forestEntry("THE-CHILD", child, "THE-PARENT"),
      ]),
      undefined,
      DECLARED_CAP,
    ).ok;

  /** A step blocked on a step belonging to a different work entry. */
  const blockerAcrossEntries = (): Record<string, unknown>[] => [
    forestEntry("WORK-A", "work"),
    forestEntry("STEP-A", "step", "WORK-A"),
    forestEntry("WORK-B", "work"),
    forestEntry("STEP-B", "step", "WORK-B", {
      kind: "blockedBy",
      tags: ["STEP-A"],
    }),
  ];

  it("the rendered schema names the parent kind each kind admits", () => {
    const hint = parentHint();
    const kinds = renderedKinds();
    let admitted = 0;
    let refused = 0;

    for (const child of kinds) {
      const phrase = statedParentPhrase(hint, child);
      for (const parent of kinds) {
        const parses = pairParses(child, parent);
        // One compare, both directions: a pairing the read admits and the
        // hint omits leaves a producer guessing, and one the hint names and
        // the read refuses sends it to write a queue that cannot be read.
        expect({
          child,
          parent,
          named: phrase.includes(parent),
        }).toEqual({ child, parent, named: parses });
        if (parses) admitted += 1;
        else refused += 1;
      }
    }

    // Non-vacuity in both directions: a hint naming every kind, or none,
    // would agree with a read that did the same and pin nothing.
    expect({ admitted: admitted > 0, refused: refused > 0 }).toEqual({
      admitted: true,
      refused: true,
    });
  });

  it("the rendered schema names the depth cap the chain declared", () => {
    const statedCap = (hint: string): number => {
      const match = /at most (\d+) deep/.exec(hint);
      expect(match, "the rendered parent hint states no depth cap").not.toBeNull();
      return Number((match as RegExpExecArray)[1]);
    };

    // The declared cap, and the engine's default where a chain declared none
    // — the same default every undeclared queue read takes, so a render and a
    // parse that were both handed nothing still state one bound.
    expect(statedCap(parentHint())).toBe(DECLARED_CAP);
    expect(statedCap(renderedLine(renderSchemaForPrompt(), '  "parent":'))).toBe(
      DEFAULT_MAX_ENTRY_DEPTH,
    );
    // The two differ, so the first assert read the argument and not a
    // constant the renderer holds.
    expect(DECLARED_CAP).not.toBe(DEFAULT_MAX_ENTRY_DEPTH);

    // And the real read bounds a chain exactly where the render said: the
    // stated number is the one a producer is judged by.
    const cap = statedCap(parentHint());
    expect(
      parsePendingQueue(queueOf(chainOfParents(cap)), undefined, DECLARED_CAP).ok,
      `a chain of ${cap} was refused by the cap the render states`,
    ).toBe(true);
    expect(
      parsePendingQueue(queueOf(chainOfParents(cap + 1)), undefined, DECLARED_CAP)
        .ok,
    ).toBe(false);
  });

  it("the rendered schema states that a step's blockedBy names only steps of its own work entry", () => {
    const arm = renderedLine(
      renderSchemaForPrompt(),
      '        | { "kind": "blockedBy"',
    );
    const stated = /Over the queue: (.*)\.$/.exec(arm);
    expect(stated, "the rendered blockedBy arm states no scope for a step").not.toBeNull();
    const halves = (stated as RegExpExecArray)[1]!.split("; ");
    // Both halves: the scope, and where a dependency wider than it is
    // declared instead. A producer told only the first is told a rule with
    // nowhere to put the dependency it has.
    expect(halves).toHaveLength(2);

    // The refusal the real read states over a step reaching outside its own
    // work entry, in the words the block showed the producer.
    const error = soleForestError(blockerAcrossEntries(), DECLARED_CAP);
    expect(error.path).toBe("gate.tags.0");
    for (const half of halves) {
      expect(error.message).toContain(half);
    }
  });

  it("the rendered schema states that a work entry's blockedBy names no ancestor or step of its own", () => {
    const arm = renderedLine(
      renderSchemaForPrompt(),
      '        | { "kind": "blockedBy"',
    );
    const stated = /Over its own containment: (.*?)\. Over the queue:/.exec(arm);
    expect(
      stated,
      "the rendered blockedBy arm states no containment scope for a work entry",
    ).not.toBeNull();
    const halves = (stated as RegExpExecArray)[1]!.split(", since ");
    // Both halves: the scope, and why no entry can wait across it. A producer
    // told only the first reads a rule whose two ends it cannot tell apart —
    // an ancestor above and a step below are one rule for one reason.
    expect(halves).toHaveLength(2);

    // Each end of the containment, refused by the real read at the same cap
    // and in the words the block showed the producer.
    const violations = [
      // An ancestor: the group the waiter sits under.
      [
        forestEntry("THE-GROUP", "group"),
        forestEntry("THE-WORK", "work", "THE-GROUP", {
          kind: "blockedBy",
          tags: ["THE-GROUP"],
        }),
      ],
      // A step: the entry's own, shipped by its own session.
      [
        forestEntry("THE-WORK", "work", undefined, {
          kind: "blockedBy",
          tags: ["THE-STEP"],
        }),
        forestEntry("THE-STEP", "step", "THE-WORK"),
      ],
    ];
    // Non-vacuity: both ends of the stated rule are driven, so a render that
    // states the pair cannot be pinned by a read that refuses one.
    expect(violations).toHaveLength(2);

    for (const violation of violations) {
      const error = soleForestError(violation, DECLARED_CAP);
      expect(error.path).toBe("gate.tags.0");
      for (const half of halves) {
        expect(error.message).toContain(half);
      }
    }
  });

  it("every forest rule the rendered schema states is one a real queue read refuses", () => {
    const hint = parentHint();
    const kinds = renderedKinds();

    /** Each pairing the hint states, broken by a parent kind it declines. */
    const pairings = kinds.map((child) => {
      const phrase = statedParentPhrase(hint, child);
      const declined = kinds.find((parent) => !phrase.includes(parent));
      expect(
        declined,
        `the rendered rule for a ${child} entry declines no parent kind`,
      ).toBeDefined();
      return {
        stated: `a ${child} entry's parent is ${phrase}`,
        violation: [
          forestEntry("THE-PARENT", declined as string),
          forestEntry("THE-CHILD", child, "THE-PARENT"),
        ],
      };
    });

    const rules = [
      {
        stated: "a parent names an entry in it",
        violation: [forestEntry("THE-ORPHAN", "work", "NO-SUCH-ENTRY")],
      },
      ...pairings,
      {
        stated: `at most ${DECLARED_CAP} deep`,
        violation: chainOfParents(DECLARED_CAP + 1),
      },
      {
        stated: "names only steps of the same work entry",
        violation: blockerAcrossEntries(),
      },
    ];

    // Non-vacuity: one rule per kind plus the three the whole listing keeps,
    // so the loop runs over the block's rules and not over an empty table.
    expect(rules.length).toBe(kinds.length + 3);

    for (const rule of rules) {
      // Stated on the one line that carries the queue-wide rules, except the
      // blocker scope, which rides the gate arm it bounds.
      expect(renderSchemaForPrompt(undefined, DECLARED_CAP)).toContain(
        rule.stated,
      );
      // Refused, once, by the real read at the same cap: a sentence the block
      // states and the read lets through is a rule only the prompt believes.
      soleForestError(rule.violation, DECLARED_CAP);
    }
  });

  it("the rendered schema still states that a kind-less entry is work and a parent-less one a root", () => {
    // The two defaults the forest rules sit beside: the pairings bound a
    // *declared* parent, so an entry declaring neither field is a root work
    // entry — what a producer writes before it groups anything.
    expect(renderedLine(renderSchemaForPrompt(), '  "kind": ')).toContain(
      'default "work"',
    );
    expect(parentHint()).toContain("Omit for a root");

    const result = parsePendingQueue(
      queueOf([
        {
          tag: "NEITHER-FIELD",
          gate: { kind: "open" },
          files: { new: [], edit: [], retire: [] },
        },
      ]),
      undefined,
      DECLARED_CAP,
    );
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(result.entries.map((e) => [e.kind, e.parent])).toEqual([
      ["work", undefined],
    ]);
  });
});
