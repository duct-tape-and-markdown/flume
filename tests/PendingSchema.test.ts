import { describe, expect, it } from "vitest";

import {
  isPickableNow,
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
      gate: { kind: "blockedBy", tag: "UPSTREAM" },
      dependsOnForks: ["open-one"],
    });
    // Upstream shipped (gate would pass) but the fork is open → not pickable.
    expect(isPickableNow(entry, new Set(["UPSTREAM"]), () => false)).toBe(
      false,
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
              | { "kind": "requiresCapability", "capability": "some-env-fact" },  // env gate; pickable iff the chain asserts this capability
        "dependsOnForks": [ "open-question-slug", ... ],      // optional; forks this rests on — not built until each is RESOLVED. Omit if none.
        "files": {                                            // EVERY path the work legitimately touches — tests and incidentals (lockfile, barrel export) included. Enforced on fanout: the build tick may write ONLY these paths ∪ the phase's channel paths; an under-declared entry is a plan defect.
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
