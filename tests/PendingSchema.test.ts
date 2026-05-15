import { describe, expect, it } from "vitest";

import {
  parsePending,
  renderSchemaForPrompt,
  type PendingEntry,
} from "../src/PendingSchema.ts";

const baseEntry = {
  tag: "EXAMPLE-TAG",
  summary: "do the thing",
  per: { path: "spec/RELEASE-v0.1.md", section: "5. Tests" },
  files: {
    new: [{ path: "src/foo.ts", description: "the foo" }],
    edit: [{ path: "src/bar.ts", description: "tweak bar" }],
    retire: ["src/baz.ts"],
  },
  schemaDelta: "none",
  tests: [{ path: "tests/foo.test.ts", asserts: "foo holds" }],
  acceptance: "pnpm test green",
};

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
      gate: { kind: "blockedBy", tag: "UPSTREAM-TAG" },
    });
    expect(parsed.gate).toEqual({ kind: "blockedBy", tag: "UPSTREAM-TAG" });
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

  it("parses gate=requiresDockerHost", () => {
    const parsed = roundTrip({
      ...baseEntry,
      gate: { kind: "requiresDockerHost" },
    });
    expect(parsed.gate).toEqual({ kind: "requiresDockerHost" });
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

  it("rejects a tag that violates TAG_PATTERN", () => {
    const result = parsePending(
      JSON.stringify([
        { ...baseEntry, gate: { kind: "open" }, tag: "lowercase-bad" },
      ]),
    );
    expect(result.ok).toBe(false);
    const tagErr = result.errors.find((e) => e.path === "tag");
    expect(tagErr).toBeDefined();
    expect(tagErr!.index).toBe(0);
  });

  it("rejects an entry missing required `acceptance`", () => {
    const { acceptance: _drop, ...withoutAcceptance } = baseEntry;
    const result = parsePending(
      JSON.stringify([{ ...withoutAcceptance, gate: { kind: "open" } }]),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path === "acceptance")).toBe(true);
  });

  it("rejects an unknown gate.kind", () => {
    const result = parsePending(
      JSON.stringify([{ ...baseEntry, gate: { kind: "wat" } }]),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path.startsWith("gate"))).toBe(true);
  });

  it("rejects gate=blockedBy missing `tag`", () => {
    const result = parsePending(
      JSON.stringify([{ ...baseEntry, gate: { kind: "blockedBy" } }]),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path.startsWith("gate"))).toBe(true);
  });

  it("rejects a summary over 200 chars", () => {
    const result = parsePending(
      JSON.stringify([
        {
          ...baseEntry,
          gate: { kind: "open" },
          summary: "x".repeat(201),
        },
      ]),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path === "summary")).toBe(true);
  });

  it("rejects a non-array root", () => {
    const result = parsePending(JSON.stringify({ not: "an array" }));
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe("renderSchemaForPrompt", () => {
  it("matches the documented prompt shape", () => {
    expect(renderSchemaForPrompt()).toMatchInlineSnapshot(`
      "Each pending entry MUST conform to this shape:

      {
        "tag": "ALL-CAPS-WITH-DASHES" | "TAG-NAME(slice)",   // unique; appears in commit msg
        "summary": "one-line what (≤200 chars)",
        "per": {
          "path": "specs/.../foo.md",                         // the spec or rule that justifies this work
          "section": "Section heading text"                   // exact section, no leading '## '
        },
        "gate": { "kind": "open" }                                  // ready to ship
              | { "kind": "blockedBy", "tag": "OTHER-TAG" }           // upstream blocks
              | { "kind": "parked",    "reason": "workshop on ..." }  // human action needed
              | { "kind": "deferred",  "reason": "no consumer yet" }  // carried indefinitely
              | { "kind": "requiresDockerHost" },                     // env gate (v1)
        "files": {
          "new":  [ { "path": "...", "description": "..." } ],
          "edit": [ { "path": "...", "description": "..." } ],
          "retire": [ "path or symbol", ... ]
        },
        "schemaDelta": "none" | "human-readable prisma diff summary",
        "tests": [ { "path": "...", "asserts": "behavior" } ],
        "acceptance": "what turns green when this is done",
        "notes": "≤500 chars; optional context not in the spec"
      }

      Output is a JSON array of these entries, ordered by execution priority (top = next).
      Empty array is valid (means nothing pending)."
    `);
  });
});
