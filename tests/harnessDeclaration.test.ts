/**
 * The harness package's declaration schema (`spec/harness.md`, *What a
 * consumer declares*), driven through the real parser.
 *
 * The acceptance case names every field the schema declares, and proves it
 * does by reading the field set off the schema itself rather than off a list
 * this file keeps — a "names every field" claim checked against the tester's
 * memory would stay green through a field the schema gained and the case
 * never exercised (`.claude/rules/engineering.md`, *A green verdict is
 * proven non-vacuous*).
 *
 * The refusal cases hand-author their input, which is the sanctioned shape:
 * no real writer produces the malformed declaration a refusal exists to
 * catch.
 */

import { describe, expect, it } from "vitest";

import {
  DeclarationSchema,
  parseDeclaration,
  type Declaration,
} from "../harness/index.ts";
import type {
  Handoff,
  RunnerFactory,
  SectionResolver,
} from "../harness/index.ts";
import { stubRunner } from "./helpers/stubRunner.ts";

/**
 * The runner as it is declared: a factory over the engine's API. The schema
 * checks that it is a function and nothing more, so a stub that ignores the
 * API is exactly as valid as the shipped vitest one — which is the point of
 * declaring a factory rather than naming a tool.
 */
const stubRunnerFactory: RunnerFactory = () => stubRunner;

/**
 * A section resolver, declared as a value for the same reason the runner is:
 * a consumer whose spec is typed keys a section rather than matching heading
 * text, and the schema checks that it is a function, not which spec it reads.
 */
const stubResolver: SectionResolver = (cite) => cite.section;

/**
 * A handoff, the third declared value with behavior: the phases to wake,
 * named from a tick's result. Declared per phase, so this one replaces the
 * package's default for `build` and leaves the plan slices on it.
 */
const stubHandoff: Handoff = () => ["plan-inbox"];

/** The fields `spec/harness.md` names, every one of them populated. */
const fullDeclaration = (): Record<string, unknown> => ({
  specLocus: ["spec/**", ".claude/rules/**"],
  fence: {
    build: ["src/**", "tests/**"],
    "plan-inbox": [".flume/inbox/**"],
    "plan-derive": [".flume/plan/**"],
    "plan-sweep": [".flume/plan/**"],
  },
  channelPaths: [".flume/plan/notes/*.md"],
  scopeWritesToEntry: true,
  runner: stubRunnerFactory,
  resolver: stubResolver,
  handoff: { build: stubHandoff },
  gates: {
    build: [
      { kind: "registry", name: "tsc", when: "afterCommit" },
      { kind: "shell", command: "pnpm lint", when: "afterMerge" },
    ],
    "plan-derive": [
      { kind: "script", path: "scripts/check-plan.mjs", when: "afterCommit" },
    ],
  },
  agents: {
    build: {
      model: "claude-opus-5",
      extraArgs: ["--verbose"],
      inheritUserMcp: true,
    },
    "plan-sweep": { model: "claude-sonnet-5" },
  },
  supervisor: {
    maxParallel: 4,
    tickTimeoutMs: 1_800_000,
    abortThreshold: 3,
    quarantineScope: "none",
    partitionIgnore: ["pnpm-lock.yaml"],
  },
  setup: { directories: ["."], restore: "cp ../.env .env" },
  slices: {
    enabled: ["plan-inbox", "plan-derive", "plan-sweep"],
    sweep: {
      domain: ["src/**", "harness/**"],
      posturePages: [".claude/rules/engineering.md"],
    },
  },
  slots: { autonomy: "ship without asking", domain: "an AI-derivation harness" },
});

/** The message a refused declaration carries, or a failure if it parsed. */
const refusalFor = (declaration: unknown): string => {
  try {
    parseDeclaration(declaration);
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error("expected the declaration to be refused, but it parsed");
};

describe("the harness declaration schema", () => {
  it("the declaration schema parses a declaration naming every field", () => {
    const declared = fullDeclaration();

    // Vacuity guard: "every field" is read off the schema, so a field added
    // there and left out here fails rather than passing unexercised.
    expect(Object.keys(declared).sort()).toEqual(
      Object.keys(DeclarationSchema.shape).sort(),
    );
    expect(Object.keys(declared)).toHaveLength(13);

    const parsed: Declaration = parseDeclaration(declared);

    expect(parsed.specLocus).toEqual(["spec/**", ".claude/rules/**"]);
    expect(parsed.fence.build).toEqual(["src/**", "tests/**"]);
    expect(parsed.fence["plan-inbox"]).toEqual([".flume/inbox/**"]);
    expect(parsed.channelPaths).toEqual([".flume/plan/notes/*.md"]);
    expect(parsed.scopeWritesToEntry).toBe(true);
    // The runner factory survives as the value it was declared as, not a
    // copy: the chain factory calls it with its own API.
    expect(parsed.runner).toBe(stubRunnerFactory);
    // Same for the resolver: the cite resolver calls it.
    expect(parsed.resolver).toBe(stubResolver);
    // And the handoff: the phase it is installed on calls it.
    expect(parsed.handoff?.build).toBe(stubHandoff);
    expect(parsed.gates?.build?.[0]).toEqual({
      kind: "registry",
      name: "tsc",
      when: "afterCommit",
    });
    expect(parsed.agents?.build?.model).toBe("claude-opus-5");
    expect(parsed.agents?.build?.inheritUserMcp).toBe(true);
    expect(parsed.supervisor?.maxParallel).toBe(4);
    expect(parsed.setup?.directories).toEqual(["."]);
    expect(parsed.slices.enabled).toContain("plan-sweep");
    expect(parsed.slices.sweep?.domain).toEqual(["src/**", "harness/**"]);
    expect(parsed.slots?.autonomy).toBe("ship without asking");
  });

  it("a declaration naming quarantineScope on supervisor parses", () => {
    const declared = fullDeclaration();
    const supervisor = declared["supervisor"] as Record<string, unknown>;

    // Vacuity guard on "the policy whole": the declared knobs are read off
    // the schema, so a knob the engine adds and this case never names fails
    // here rather than passing over four of five.
    expect(Object.keys(supervisor).sort()).toEqual(
      Object.keys(DeclarationSchema.shape.supervisor.unwrap().shape).sort(),
    );

    const parsed = parseDeclaration(declared);

    expect(parsed.supervisor?.quarantineScope).toBe("none");
    // The other knobs survive the widening rather than being displaced by it.
    expect(parsed.supervisor?.maxParallel).toBe(4);
    expect(parsed.supervisor?.partitionIgnore).toEqual(["pnpm-lock.yaml"]);
  });

  it("a quarantineScope value outside the engine's two is refused", () => {
    const declared = fullDeclaration();
    declared["supervisor"] = {
      ...(declared["supervisor"] as Record<string, unknown>),
      quarantineScope: "entry",
    };

    const message = refusalFor(declared);

    expect(message).toContain("supervisor.quarantineScope");
    // Both engine values are named, so a typo reads as a wrong value rather
    // than an unknown knob.
    expect(message).toContain('"run"');
    expect(message).toContain('"none"');
  });

  it("the declaration's supervisor refuses a knob the engine's policy does not name", () => {
    const declared = fullDeclaration();
    declared["supervisor"] = {
      ...(declared["supervisor"] as Record<string, unknown>),
      retryCount: 2,
    };

    const message = refusalFor(declared);

    expect(message).toContain("supervisor.retryCount");
    expect(message).toContain("unknown field");
    for (const knob of Object.keys(
      DeclarationSchema.shape.supervisor.unwrap().shape,
    )) {
      expect(message).toContain(knob);
    }
  });

  it("an unknown declaration field is refused, naming the field and the valid set", () => {
    const message = refusalFor({ ...fullDeclaration(), speclocus: ["spec/**"] });

    expect(message).toContain("speclocus");
    // The valid set is the whole declared surface, not a sample of it.
    for (const field of Object.keys(DeclarationSchema.shape)) {
      expect(message).toContain(field);
    }
  });

  it("an unknown field nested inside a declared one is refused at its own path, against its own valid set", () => {
    const declared = fullDeclaration();
    declared["slots"] = { autonomy: "ship without asking", tone: "terse" };

    const message = refusalFor(declared);

    expect(message).toContain("slots.tone");
    expect(message).toContain("valid fields are: autonomy, domain");
  });

  it("a missing required declaration field is refused, naming the field", () => {
    // Every field a tick cannot run without, each proven required on its own
    // — a single missing-field case would pass over a field that quietly
    // became optional.
    for (const field of ["specLocus", "fence", "runner", "slices"]) {
      const declared = fullDeclaration();
      delete declared[field];

      const message = refusalFor(declared);

      expect(message).toContain(field);
      expect(message).toContain("invalid harness declaration");
    }
  });

  it("an optional declaration field left out parses, and scopeWritesToEntry defaults off", () => {
    const declared = fullDeclaration();
    for (const field of [
      "channelPaths",
      "scopeWritesToEntry",
      "resolver",
      "gates",
      "agents",
      "supervisor",
      "setup",
      "slots",
    ]) {
      delete declared[field];
    }

    const parsed = parseDeclaration(declared);

    expect(parsed.channelPaths).toBeUndefined();
    // Absent, the package resolves a cite's section by heading text.
    expect(parsed.resolver).toBeUndefined();
    expect(parsed.scopeWritesToEntry).toBe(false);
  });

  it("a resolver that is not a function is refused, naming the resolver field", () => {
    const declared = fullDeclaration();
    declared["resolver"] = "byKey";

    const message = refusalFor(declared);

    expect(message).toContain("resolver");
    expect(message).toContain("The cite resolver");
  });

  it("a declaration whose runner is a Runner value rather than a factory is refused at load naming the field", () => {
    const declared = fullDeclaration();
    // A runner answering all three operations — the near-miss a consumer
    // writes, and the shape the field held before a base checkout's
    // installer and worktree base became the engine's to hand out.
    declared["runner"] = stubRunner;

    const message = refusalFor(declared);

    expect(message).toContain("runner");
    // What was wanted, and what a built value is not.
    expect(message).toContain("factory");
    expect(message).toContain("runAtBase");
  });

  it("the sweep slice declared without its domain is refused, rather than sweeping nothing", () => {
    const declared = fullDeclaration();
    declared["slices"] = { enabled: ["plan-derive", "plan-sweep"] };

    const message = refusalFor(declared);

    expect(message).toContain("slices.sweep");
    // The refinement's own reason survives the missing-field wording, so the
    // refusal says which declaration made the field required.
    expect(message).toContain("plan-sweep");
  });

  it("a gate declared at a point the engine does not run is refused", () => {
    const declared = fullDeclaration();
    declared["gates"] = {
      build: [{ kind: "shell", command: "pnpm lint", when: "afterAgent" }],
    };

    expect(refusalFor(declared)).toContain("gates.build.0.when");
  });
});
