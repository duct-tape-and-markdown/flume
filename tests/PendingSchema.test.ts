import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  AsyncEntryExtensionValidatorError,
  composePendingList,
  declaredPaths,
  isPickableNow,
  parsePending,
  parsePendingLoose,
  renderSchemaForPrompt,
  touchedPaths,
  type EntryExtension,
  type PendingEntry,
} from "../src/PendingSchema.ts";
import type { StandardSchemaV1 } from "../src/standardSchema.ts";

const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));

/** Every `.ts` file under `src/`, recursively. */
function listSrcFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return listSrcFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

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

/** Engine-core entry (v0.8 §2): tag, gate, dependsOnForks, files — nothing else. */
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

function roundTrip(entry: unknown): PendingEntry {
  const result = parsePending(JSON.stringify([entry]));
  expect(result.ok, JSON.stringify(result.errors)).toBe(true);
  expect(result.entries).toHaveLength(1);
  return result.entries[0]!;
}

describe("parsePending — round-trip per gate.kind", () => {
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

describe("parsePending — rejects malformed entries", () => {
  it("rejects invalid JSON with a structural error", () => {
    const result = parsePending("{not json");
    expect(result.ok).toBe(false);
    expect(result.entries).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.index).toBe(-1);
    expect(result.errors[0]!.message).toMatch(/invalid JSON/);
  });

  it("rejects a tag containing whitespace (v0.8 §3: mechanical safety only)", () => {
    const result = parsePending(
      JSON.stringify([
        { ...baseEntry, gate: { kind: "open" }, tag: "DAL REWIRE" },
      ]),
    );
    expect(result.ok).toBe(false);
    const tagErr = result.errors.find((e) => e.path === "tag");
    expect(tagErr).toBeDefined();
    expect(tagErr!.index).toBe(0);
  });

  it("rejects a tag containing a path separator", () => {
    const result = parsePending(
      JSON.stringify([
        { ...baseEntry, gate: { kind: "open" }, tag: "DAL/REWIRE" },
      ]),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path === "tag")).toBe(true);
  });

  it("rejects a tag past the derived length bound", () => {
    const result = parsePending(
      JSON.stringify([
        { ...baseEntry, gate: { kind: "open" }, tag: "A".repeat(217) },
      ]),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path === "tag")).toBe(true);
  });

  it("rejects an unknown gate.kind", () => {
    const result = parsePending(
      JSON.stringify([{ ...baseEntry, gate: { kind: "wat" } }]),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path.startsWith("gate"))).toBe(true);
  });

  it("rejects gate=blockedBy missing `tags`", () => {
    const result = parsePending(
      JSON.stringify([{ ...baseEntry, gate: { kind: "blockedBy" } }]),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path.startsWith("gate"))).toBe(true);
  });

  it("rejects gate=blockedBy with an empty `tags` array (not a silently-open gate)", () => {
    const result = parsePending(
      JSON.stringify([
        { ...baseEntry, gate: { kind: "blockedBy", tags: [] } },
      ]),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path.startsWith("gate"))).toBe(true);
  });

  it("rejects gate=requiresCapability missing `capability`", () => {
    const result = parsePending(
      JSON.stringify([{ ...baseEntry, gate: { kind: "requiresCapability" } }]),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path.startsWith("gate"))).toBe(true);
  });

  it("rejects the retired gate=requiresDockerHost variant (v0.8 §4)", () => {
    const result = parsePending(
      JSON.stringify([{ ...baseEntry, gate: { kind: "requiresDockerHost" } }]),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path.startsWith("gate"))).toBe(true);
  });

  it("rejects a field that is neither core nor declared (bare core)", () => {
    // Silent stripping would destroy plan-authored fields on the
    // dispatcher's pending.json rewrite — unknown fields fail loudly.
    const result = parsePending(
      JSON.stringify([
        { ...baseEntry, gate: { kind: "open" }, summary: "undeclared" },
      ]),
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]!.message).toMatch(/summary/);
  });

  it("rejects a non-array root", () => {
    const result = parsePending(JSON.stringify({ not: "an array" }));
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe("chain-declared extension (v0.8 §2)", () => {
  const extended = {
    ...baseEntry,
    gate: { kind: "open" },
    summary: "do the thing",
    per: { path: "spec/pending.md", section: "5. Tests" },
  };

  it("accepts declared fields and round-trips their values", () => {
    const result = parsePending(JSON.stringify([extended]), testExtension);
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    const entry = result.entries[0]!;
    expect(entry.summary).toBe("do the thing");
    expect(entry.per).toEqual({
      path: "spec/pending.md",
      section: "5. Tests",
    });
  });

  it("enforces the declared field's own constraints (extension cap)", () => {
    const result = parsePending(
      JSON.stringify([{ ...extended, summary: "x".repeat(201) }]),
      testExtension,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path === "summary")).toBe(true);
  });

  it("rejects a field the extension did not declare", () => {
    const result = parsePending(
      JSON.stringify([{ ...extended, schemaDelta: "none" }]),
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
    const result = parsePending(JSON.stringify([{ ...baseEntry, gate: { kind: "open" } }]), ext);
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(result.entries[0]!.tests).toEqual([]);
  });

  it("throws on an extension that shadows a core field — chain-config defect", () => {
    const shadowing = {
      files: { schema: z.string(), hint: `"..."` },
    } satisfies EntryExtension;
    expect(() => composePendingList(shadowing)).toThrow(/shadows/);
  });
});

describe("tag grammar reduces to mechanical safety (v0.8 §3)", () => {
  it("DAL-REWIRE(usp_Filter_Get) validates against the bare core", () => {
    const result = parsePending(
      JSON.stringify([
        {
          ...baseEntry,
          gate: { kind: "open" },
          tag: "DAL-REWIRE(usp_Filter_Get)",
        },
      ]),
    );
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(result.entries[0]!.tag).toBe("DAL-REWIRE(usp_Filter_Get)");
  });

  it("accepts a lowercase tag under the bare core (grammar beyond mechanical safety is a chain's choice, not the engine's)", () => {
    const result = parsePending(
      JSON.stringify([
        { ...baseEntry, gate: { kind: "open" }, tag: "roster-triage-mig" },
      ]),
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

    const lowercase = parsePending(
      JSON.stringify([
        { ...baseEntry, gate: { kind: "open" }, tag: "roster-triage-mig" },
      ]),
      allCapsRefinement,
    );
    expect(lowercase.ok).toBe(false);
    expect(lowercase.errors.some((e) => e.path === "tag")).toBe(true);

    const valid = parsePending(
      JSON.stringify([
        { ...baseEntry, gate: { kind: "open" }, tag: "ROSTER-TRIAGE-MIG" },
      ]),
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
    const result = parsePending(
      JSON.stringify([
        { ...baseEntry, gate: { kind: "open" }, tag: "ROSTER TRIAGE" },
      ]),
      startsWithLetter,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path === "tag")).toBe(true);
  });
});

describe("tag uniqueness within the queue (v0.8 §3)", () => {
  it("rejects two entries sharing a tag, naming both offending indices (bare core)", () => {
    const result = parsePending(
      JSON.stringify([
        { ...baseEntry, tag: "DUP-TAG", gate: { kind: "open" } },
        { ...baseEntry, tag: "DUP-TAG", gate: { kind: "open" } },
      ]),
    );
    expect(result.ok).toBe(false);
    const tagErrors = result.errors.filter((e) => e.path === "tag");
    expect(tagErrors.map((e) => e.index).sort()).toEqual([0, 1]);
    expect(tagErrors[0]!.message).toMatch(/DUP-TAG/);
  });

  it("rejects a duplicate tag through the extension-composed path", () => {
    const result = parsePending(
      JSON.stringify([
        {
          ...baseEntry,
          tag: "DUP-TAG",
          gate: { kind: "open" },
          summary: "first",
          per: { path: "spec/pending.md", section: "5. Tests" },
        },
        {
          ...baseEntry,
          tag: "DUP-TAG",
          gate: { kind: "open" },
          summary: "second",
          per: { path: "spec/pending.md", section: "5. Tests" },
        },
      ]),
      testExtension,
    );
    expect(result.ok).toBe(false);
    const tagErrors = result.errors.filter((e) => e.path === "tag");
    expect(tagErrors.map((e) => e.index).sort()).toEqual([0, 1]);
  });

  it("a queue with distinct tags parses clean (bare core)", () => {
    const result = parsePending(
      JSON.stringify([
        { ...baseEntry, tag: "TAG-ONE", gate: { kind: "open" } },
        { ...baseEntry, tag: "TAG-TWO", gate: { kind: "open" } },
      ]),
    );
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(result.entries).toHaveLength(2);
  });

  it("a queue with distinct tags parses clean through the extension-composed path", () => {
    const result = parsePending(
      JSON.stringify([
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
      ]),
      testExtension,
    );
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(result.entries).toHaveLength(2);
  });
});

describe("entryExtension validators are adapted, not merged (v0.11 §11 — ENTRYEXTENSION-STANDARD-SCHEMA)", () => {
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

    const result = parsePending(
      JSON.stringify([
        {
          ...baseEntry,
          gate: { kind: "open" },
          summary: "do the thing",
          per: { path: "spec/pending.md", section: "5. Tests" },
        },
      ]),
      ext,
    );
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    // Vacuity pin (engineering.md "A green verdict is proven non-vacuous"):
    // prove the foreign validators were actually invoked, not skipped past.
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
    const result = parsePending(
      JSON.stringify([{ ...baseEntry, gate: { kind: "open" }, summary: "" }]),
      ext,
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.index).toBe(0);
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
    const result = parsePending(
      JSON.stringify([
        { ...baseEntry, gate: { kind: "open" }, per: { path: "", section: "ok" } },
      ]),
      ext,
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.index).toBe(0);
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

    const lowercase = parsePending(
      JSON.stringify([
        { ...baseEntry, gate: { kind: "open" }, tag: "roster-triage-mig" },
      ]),
      allCaps,
    );
    expect(lowercase.ok).toBe(false);
    expect(lowercase.errors.some((e) => e.path === "tag")).toBe(true);

    const valid = parsePending(
      JSON.stringify([
        { ...baseEntry, gate: { kind: "open" }, tag: "ROSTER-TRIAGE-MIG" },
      ]),
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
    const stillRejected = parsePending(
      JSON.stringify([
        { ...baseEntry, gate: { kind: "open" }, tag: "ROSTER TRIAGE" },
      ]),
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
    const result = parsePending(
      JSON.stringify([
        { ...baseEntry, gate: { kind: "open" }, summary: "x", extra: "nope" },
      ]),
      ext,
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]!.message).toMatch(/extra/);
  });

  it("rejects a duplicate tag through the hand-written-extension-composed path", () => {
    const ext = {
      summary: {
        schema: handStandardSchema<string>((value) => ({ value: value as string })),
        hint: `"..."`,
      },
    } satisfies EntryExtension;
    const result = parsePending(
      JSON.stringify([
        { ...baseEntry, tag: "DUP-HAND", gate: { kind: "open" }, summary: "a" },
        { ...baseEntry, tag: "DUP-HAND", gate: { kind: "open" }, summary: "b" },
      ]),
      ext,
    );
    expect(result.ok).toBe(false);
    const tagErrors = result.errors.filter((e) => e.path === "tag");
    expect(tagErrors.map((e) => e.index).sort()).toEqual([0, 1]);
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
    const result = parsePending(
      JSON.stringify([{ ...baseEntry, gate: { kind: "open" } }]),
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
    const raw = JSON.stringify([
      { ...baseEntry, gate: { kind: "open" }, summary: "x" },
    ]);
    expect(() => parsePending(raw, ext)).toThrow(AsyncEntryExtensionValidatorError);
    expect(() => parsePending(raw, ext)).toThrow(/summary/);
  });
});

describe("parsePendingLoose — chain-less informational reads", () => {
  it("passes undeclared fields through unvalidated", () => {
    const result = parsePendingLoose(
      JSON.stringify([
        {
          ...baseEntry,
          gate: { kind: "open" },
          summary: "kept as-is",
          anything: { nested: true },
        },
      ]),
    );
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(result.entries[0]!.summary).toBe("kept as-is");
    expect(result.entries[0]!.anything).toEqual({ nested: true });
  });

  it("still rejects a malformed core", () => {
    const result = parsePendingLoose(
      JSON.stringify([{ ...baseEntry, gate: { kind: "wat" } }]),
    );
    expect(result.ok).toBe(false);
  });

  it("has exactly one production call site — job.ts's read-only job-listing (PendingSchema.ts:324-329)", () => {
    const callSites = listSrcFiles(SRC_DIR)
      .filter((file) => !file.endsWith("/PendingSchema.ts")) // the declaration, not a call
      .flatMap((file) => {
        const src = readFileSync(file, "utf8");
        const count = (src.match(/\bparsePendingLoose\(/g) ?? []).length;
        return count > 0 ? [{ file, count }] : [];
      });

    expect(callSites).toHaveLength(1);
    expect(callSites[0]!.file).toMatch(/\/job\.ts$/);
    expect(callSites[0]!.count).toBe(1);
  });

  it("its one call site never rewrites pending.json — readPendingLoose (job.ts, shared by jobStatus and flume status) is read-only", () => {
    const jobSrc = readFileSync(`${SRC_DIR}/job.ts`, "utf8");
    const probeBody = extractFunctionBody(jobSrc, "readPendingLoose");
    const jobStatusBody = extractFunctionBody(jobSrc, "jobStatus");
    const noMutation =
      /\b(writeFileSync|writeFile|appendFileSync|appendFile|rmSync|rm|unlinkSync|unlink)\s*\(/;

    expect(probeBody).toContain("parsePendingLoose(");
    expect(jobStatusBody).toContain("readPendingLoose(");
    // No write/delete call anywhere in either function that reads pending.json.
    expect(probeBody).not.toMatch(noMutation);
    expect(jobStatusBody).not.toMatch(noMutation);
  });
});

describe("parsePending/parsePendingLoose — shared error mapping", () => {
  it("constructs the invalid-JSON message exactly once in module source", () => {
    const src = readFileSync(`${SRC_DIR}/PendingSchema.ts`, "utf8");
    const occurrences = (src.match(/invalid JSON: /g) ?? []).length;
    expect(occurrences).toBe(1);
  });
});

describe("dependsOnForks — foundations governor", () => {
  const noForks = new Set<string>();

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
    expect(isPickableNow(entry, noForks, () => false)).toBe(false);
  });

  it("an open entry whose forks all resolve IS pickable", () => {
    const entry = roundTrip({
      ...baseEntry,
      gate: { kind: "open" },
      dependsOnForks: ["coldstart-2", "unread-count-model"],
    });
    expect(isPickableNow(entry, noForks, () => true)).toBe(true);
  });

  it("blocks if ANY declared fork is unresolved", () => {
    const entry = roundTrip({
      ...baseEntry,
      gate: { kind: "open" },
      dependsOnForks: ["resolved-one", "open-one"],
    });
    const resolved = (slug: string) => slug === "resolved-one";
    expect(isPickableNow(entry, noForks, resolved)).toBe(false);
  });

  it("the default predicate (no resolver) preserves v0.2 pickability", () => {
    const open = roundTrip({
      ...baseEntry,
      gate: { kind: "open" },
      dependsOnForks: ["anything"],
    });
    // No third argument → every fork treated as resolved → gate decides.
    expect(isPickableNow(open, noForks)).toBe(true);

    const parked = roundTrip({
      ...baseEntry,
      gate: { kind: "parked", reason: "x" },
    });
    expect(isPickableNow(parked, noForks)).toBe(false);
  });

  it("an unresolved fork blocks even a blockedBy-satisfied entry", () => {
    const entry = roundTrip({
      ...baseEntry,
      gate: { kind: "blockedBy", tags: ["UPSTREAM"] },
      dependsOnForks: ["open-one"],
    });
    // Upstream shipped (gate would pass) but the fork is open → not pickable.
    expect(isPickableNow(entry, new Set(["UPSTREAM"]), () => false)).toBe(
      false,
    );
  });
});

describe("gate=blockedBy — pickability against a tag list (spec/pending.md § The entry core)", () => {
  const noForks = new Set<string>();

  it("is pickable once the single named blocker has shipped", () => {
    const entry = roundTrip({
      ...baseEntry,
      gate: { kind: "blockedBy", tags: ["UPSTREAM"] },
    });
    expect(isPickableNow(entry, new Set(["UPSTREAM"]))).toBe(true);
    expect(isPickableNow(entry, noForks)).toBe(false);
  });

  it("a multi-parent entry is not pickable until EVERY named blocker has shipped", () => {
    const entry = roundTrip({
      ...baseEntry,
      gate: { kind: "blockedBy", tags: ["UPSTREAM-A", "UPSTREAM-B"] },
    });
    expect(isPickableNow(entry, new Set(["UPSTREAM-A"]))).toBe(false);
    expect(isPickableNow(entry, new Set(["UPSTREAM-A", "UPSTREAM-B"]))).toBe(
      true,
    );
  });
});

describe("gate=requiresCapability — pickability (v0.8 §4)", () => {
  const noForks = new Set<string>();

  it("is pickable when the capability is asserted", () => {
    const entry = roundTrip({
      ...baseEntry,
      gate: { kind: "requiresCapability", capability: "docker-host" },
    });
    expect(
      isPickableNow(entry, noForks, () => true, new Set(["docker-host"])),
    ).toBe(true);
  });

  it("is skipped when the capability is not asserted", () => {
    const entry = roundTrip({
      ...baseEntry,
      gate: { kind: "requiresCapability", capability: "docker-host" },
    });
    expect(isPickableNow(entry, noForks, () => true, new Set())).toBe(false);
  });

  it("defaults to non-pickable when no capabilities set is supplied", () => {
    const entry = roundTrip({
      ...baseEntry,
      gate: { kind: "requiresCapability", capability: "docker-host" },
    });
    expect(isPickableNow(entry, noForks)).toBe(false);
  });
});

describe("renderSchemaForPrompt", () => {
  it("bare core matches the documented prompt shape", () => {
    expect(renderSchemaForPrompt()).toMatchInlineSnapshot(`
      "Each pending entry MUST conform to this shape (fields not listed here are rejected):

      {
        "tag": "<letters/digits/._()- only, no whitespace, ≤216 chars>",   // unique; appears in commit msg; mechanical safety is the floor, a chain-declared refinement (if any) narrows further
        "gate": { "kind": "open" }                                  // ready to ship
              | { "kind": "blockedBy", "tags": ["OTHER-TAG", ...] }   // upstream blocks; non-empty, name every parent
              | { "kind": "parked",    "reason": "workshop on ..." }  // human action needed
              | { "kind": "deferred",  "reason": "no consumer yet" }  // carried indefinitely
              | { "kind": "requiresCapability", "capability": "some-env-fact" },  // env gate; pickable iff the chain asserts this capability
        "dependsOnForks": [ "open-question-slug", ... ],      // optional; forks this rests on — not built until each is RESOLVED. Omit if none.
        "files": {                                            // EVERY path the work legitimately touches — tests and incidentals (lockfile, barrel export) included. Enforced on fanout: the build tick may write ONLY these paths ∪ the phase's channel paths; an under-declared entry is a plan defect.
          "new":  [ { "path": "...", "description": "..." } ],
          "edit": [ { "path": "...", "description": "..." } ],
          "retire": [ "path", ... ]
        }
      }

      Output is a JSON array of these entries, ordered by execution priority (top = next).
      Empty array is valid (means nothing pending)."
    `);
  });

  it("the retire hint advertises a path only, never a non-path alternative (engineering.md § A seam gate reads what the real writer wrote)", () => {
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
    expect(declaredPaths(entry)).toEqual(["src/deprecated.ts"]);
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
    const result = parsePending(
      JSON.stringify([
        { ...baseEntry, gate: { kind: "open" }, schemaDelta: "none" },
      ]),
      testExtension,
    );
    expect(result.ok).toBe(false);
  });

  /**
   * Agreement gate (engineering.md § "A seam gate reads what the real
   * writer wrote"): the checks above only confirm field *names* line up.
   * A hint's stated numeric bound (e.g. "≤200 chars") is free text on the
   * same declaration record as `schema` — nothing ties the two together,
   * so the hint can claim a bound the schema doesn't actually enforce (or
   * vice versa). These tests extract the bound from the real
   * `renderSchemaForPrompt` output and drive it through the real
   * `parsePending`, so a hint/schema mismatch fails here instead of
   * shipping silently.
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

    const ok = parsePending(
      JSON.stringify([{ ...baseEntry, tag: atBound, gate: { kind: "open" } }]),
    );
    expect(ok.ok, JSON.stringify(ok.errors)).toBe(true);

    const bad = parsePending(
      JSON.stringify([
        { ...baseEntry, tag: overBound, gate: { kind: "open" } },
      ]),
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
    const result = parsePending(
      JSON.stringify([{ ...baseEntry, tag: sample, gate: { kind: "open" } }]),
    );
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
  });

  it("tag: whitespace, excluded by the rendered charset, is rejected by the real parser", () => {
    const rendered = renderSchemaForPrompt();
    expect(rendered).toContain("no whitespace");
    const extras = extractTagCharsetExtras(rendered);
    const result = parsePending(
      JSON.stringify([
        { ...baseEntry, tag: `a ${extras}`, gate: { kind: "open" } },
      ]),
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

      const ok = parsePending(
        JSON.stringify([{ ...validEntry, [name]: "x".repeat(max) }]),
        testExtension,
      );
      expect(ok.ok, JSON.stringify(ok.errors)).toBe(true);

      const bad = parsePending(
        JSON.stringify([{ ...validEntry, [name]: "x".repeat(max + 1) }]),
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
    const result = parsePending(
      JSON.stringify([
        {
          tag: "ZERO-FILES",
          gate: { kind: "open" },
          files: {},
        },
      ]),
    );
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    const entry = result.entries[0]!;
    expect(entry.files).toEqual({ new: [], edit: [], retire: [] });
    expect(isPickableNow(entry, new Set())).toBe(true);
  });

  it("parses clean when only files.new declares a path", () => {
    const result = parsePending(
      JSON.stringify([
        {
          tag: "ONLY-NEW",
          gate: { kind: "open" },
          files: {
            new: [{ path: "src/only-new.ts", description: "new file" }],
            edit: [],
            retire: [],
          },
        },
      ]),
    );
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
  });

  it("parses clean when only files.edit declares a path", () => {
    const result = parsePending(
      JSON.stringify([
        {
          tag: "ONLY-EDIT",
          gate: { kind: "open" },
          files: {
            new: [],
            edit: [{ path: "src/only-edit.ts", description: "edit file" }],
            retire: [],
          },
        },
      ]),
    );
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
  });

  it("parses clean when only files.retire declares a path", () => {
    const result = parsePending(
      JSON.stringify([
        {
          tag: "ONLY-RETIRE",
          gate: { kind: "open" },
          files: { new: [], edit: [], retire: ["src/only-retire.ts"] },
        },
      ]),
    );
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
  });
});

describe("parsePending — observedFiles survives the round-trip", () => {
  it("preserves the dispatcher-written footprint so a re-parse cannot strip it", () => {
    const entry = roundTrip({
      ...baseEntry,
      gate: { kind: "open" },
      observedFiles: ["src/other.ts", "tests/other.test.ts"],
    });
    expect(entry.observedFiles).toEqual(["src/other.ts", "tests/other.test.ts"]);
  });
});

describe("declaredPaths vs touchedPaths (engineering.md § The fix lands at the mechanism)", () => {
  it("declaredPaths answers files.new+edit+retire only; touchedPaths additionally folds in observedFiles", () => {
    const entry = roundTrip({
      ...baseEntry,
      gate: { kind: "open" },
      observedFiles: ["src/other.ts"],
    });
    expect(declaredPaths(entry)).toEqual([
      "src/foo.ts",
      "src/bar.ts",
      "src/baz.ts",
    ]);
    expect(touchedPaths(entry)).toEqual([
      "src/foo.ts",
      "src/bar.ts",
      "src/baz.ts",
      "src/other.ts",
    ]);
  });
});
