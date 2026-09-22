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

import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { DEFAULT_SHELL } from "../harness/declaration.ts";
import {
  DeclarationSchema,
  parseDeclaration,
  type Declaration,
} from "../harness/index.ts";
import type {
  CiTitleReader,
  Handoff,
  RunnerFactory,
  SectionResolver,
} from "../harness/index.ts";
import type { Chain } from "../src/Phase.ts";
import { leadNamesOf, sectionOf } from "./helpers/docSections.ts";
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

/**
 * A worktree base, declared as a value for the runner's reason: where a
 * checkout is planted is machine-local, so a committed declaration computes
 * it from the roots the engine resolved rather than spelling one host's path.
 * The schema checks that it is a function; whether it answers an absolute
 * directory is the engine's own refusal, at the same load.
 */
const stubWorktreesBase: NonNullable<Chain["worktreesBase"]> = (paths) =>
  `${paths.repoRoot}/../flume-worktrees`;

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
  shell: "bash",
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
    killGraceMs: 15_000,
    quarantineScope: "none",
    partitionIgnore: ["pnpm-lock.yaml"],
  },
  setup: { directories: ["."], restore: "cp ../.env .env", serialize: true },
  slices: {
    enabled: ["plan-inbox", "plan-derive", "plan-sweep"],
    sweep: {
      domain: ["src/**", "harness/**"],
      posturePages: [".claude/rules/engineering.md"],
    },
  },
  slots: { autonomy: "ship without asking", domain: "an AI-derivation harness" },
  capabilities: ["network", "docker"],
  friction: "friction",
  worktreesBase: stubWorktreesBase,
  ci: [
    { name: "windows", workflow: "ci.yml", job: "test (windows-latest)" },
    { name: "linux", workflow: "ci.yml", job: "test (ubuntu-latest)" },
  ],
});

/**
 * The schema's own split between the fields a declaration must name and the
 * fields it may omit: a key is optional exactly when the schema's entry for
 * it accepts `undefined` — which covers the `.optional()` ones and the
 * defaulted `scopeWritesToEntry` alike.
 *
 * Read off the schema rather than listed by hand at each case below. Two
 * hand-kept lists are a partition nothing checks: a field added to the
 * schema and typed into neither list is exercised as neither required nor
 * optional, and both cases stay green over it (`.claude/rules/engineering.md`,
 * *A green verdict is proven non-vacuous*).
 */
const partitionByOptionality = (): {
  required: string[];
  optional: string[];
} => {
  const required: string[] = [];
  const optional: string[] = [];
  for (const [field, schema] of Object.entries(DeclarationSchema.shape)) {
    const bucket = (schema as z.ZodTypeAny).safeParse(undefined).success
      ? optional
      : required;
    bucket.push(field);
  }
  return { required, optional };
};

const { required: requiredFields, optional: optionalFields } =
  partitionByOptionality();

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
    expect(Object.keys(declared)).toHaveLength(18);

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
    expect(parsed.shell).toBe("bash");
    expect(parsed.agents?.build?.model).toBe("claude-opus-5");
    expect(parsed.agents?.build?.inheritUserMcp).toBe(true);
    expect(parsed.supervisor?.maxParallel).toBe(4);
    expect(parsed.setup?.directories).toEqual(["."]);
    // The restore's concurrency claim rides with it: a consumer whose shared
    // cache cannot be warmed twice at once has a field to say so in.
    expect(parsed.setup?.serialize).toBe(true);
    expect(parsed.slices.enabled).toContain("plan-sweep");
    expect(parsed.slices.sweep?.domain).toEqual(["src/**", "harness/**"]);
    expect(parsed.slots?.autonomy).toBe("ship without asking");
    expect(parsed.capabilities).toEqual(["network", "docker"]);
    expect(parsed.friction).toBe("friction");
    // And the base: the engine evaluates it once per chain load, so what
    // survives the parse is the function, never a path this schema ran.
    expect(parsed.worktreesBase).toBe(stubWorktreesBase);
    expect(parsed.ci?.[0]).toEqual({
      name: "windows",
      workflow: "ci.yml",
      job: "test (windows-latest)",
    });
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
    expect(parsed.supervisor?.killGraceMs).toBe(15_000);
    expect(parsed.supervisor?.partitionIgnore).toEqual(["pnpm-lock.yaml"]);
  });

  it("a capabilities list a load-time probe returned empty parses", () => {
    // The other list-valued fields refuse empty; this one admits it, because
    // a declaration is a module and this list is routinely a probe's return.
    // A probe that found nothing asserting nothing is the environment
    // reporting, not a declaration with a hole in it.
    const parsed = parseDeclaration({ ...fullDeclaration(), capabilities: [] });

    expect(parsed.capabilities).toEqual([]);
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

  it("the required and optional field cases together name every field the declaration schema declares", () => {
    // The vacuity guard the two cases below inherit: whatever the schema
    // declares lands in exactly one of the lists they loop over, so a field
    // added there is exercised as required or as optional rather than by
    // neither case.
    expect(requiredFields.length).toBeGreaterThan(0);
    expect(optionalFields.length).toBeGreaterThan(0);
    expect([...requiredFields, ...optionalFields].sort()).toEqual(
      Object.keys(DeclarationSchema.shape).sort(),
    );
  });

  it("a missing required declaration field is refused, naming the field", () => {
    // Every field a tick cannot run without, each proven required on its own
    // — a single missing-field case would pass over a field that quietly
    // became optional.
    expect(requiredFields).toEqual(["specLocus", "fence", "runner", "slices"]);

    for (const field of requiredFields) {
      const declared = fullDeclaration();
      delete declared[field];

      const message = refusalFor(declared);

      expect(message).toContain(field);
      expect(message).toContain("invalid harness declaration");
    }
  });

  it("an optional declaration field left out parses, and scopeWritesToEntry defaults off", () => {
    const declared = fullDeclaration();
    expect(optionalFields.length).toBeGreaterThan(0);
    for (const field of optionalFields) {
      delete declared[field];
    }

    const parsed = parseDeclaration(declared);

    expect(parsed.channelPaths).toBeUndefined();
    // Absent, the package resolves a cite's section by heading text.
    expect(parsed.resolver).toBeUndefined();
    expect(parsed.scopeWritesToEntry).toBe(false);
    // Resolved on the parse's output: a command gate cannot be spawned
    // without some shell, so the schema folds the default here rather than
    // leaving each command site a fallback of its own — the case below.
    expect(parsed.shell).toBe(DEFAULT_SHELL);
  });

  it("a declaration naming no shell parses to the package's default shell", () => {
    const declared = fullDeclaration();
    // Non-vacuity: the fixture names a shell of its own, and it is not the
    // default — so what the parse reads below is the schema's fold and not
    // the fixture's value surviving the delete.
    expect(declared.shell).toBe("bash");
    expect(declared.shell).not.toBe(DEFAULT_SHELL);
    delete declared.shell;

    const parsed = parseDeclaration(declared);

    expect(parsed.shell).toBe(DEFAULT_SHELL);
  });

  it("a declaration omitting its handoff parses, and handoff reads undefined", () => {
    // The field the two hand-kept lists left between them: declared per
    // phase and replacing outright, so a consumer wanting the package's
    // ladder everywhere omits it — and gets the ladder, not a refusal.
    expect(optionalFields).toContain("handoff");

    const declared = fullDeclaration();
    delete declared["handoff"];

    const parsed = parseDeclaration(declared);

    expect(parsed.handoff).toBeUndefined();
    // Omitting it displaces nothing else the declaration named.
    expect(parsed.runner).toBe(stubRunnerFactory);
  });

  it("a resolver that is not a function is refused, naming the resolver field", () => {
    const declared = fullDeclaration();
    declared["resolver"] = "byKey";

    const message = refusalFor(declared);

    expect(message).toContain("resolver");
    expect(message).toContain("The cite resolver");
  });

  it("a worktreesBase declared as a path string is refused, naming the field", () => {
    const declared = fullDeclaration();
    // The near-miss a consumer writes: the base itself, which a committed
    // declaration cannot hold — placement is machine-local, and the roots it
    // is computed from exist only at the engine's load.
    declared["worktreesBase"] = "/srv/flume-worktrees";

    const message = refusalFor(declared);

    expect(message).toContain("worktreesBase");
    expect(message).toContain("Placement");
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

  it("a declaration carrying a ci lane with its workflow, job and lane name parses", () => {
    const declared = fullDeclaration();
    // Vacuity guard on "with its workflow, job and lane name": the three
    // components are read off the lane's own schema — every field of it that
    // a lane cannot leave out — so a required component the schema gains and
    // this case never names fails here rather than passing over two of
    // three.
    const lane = { name: "windows", workflow: "ci.yml", job: "test (windows)" };
    const required = Object.entries(
      DeclarationSchema.shape.ci.unwrap().element.shape,
    )
      .filter(([, field]) => !field.safeParse(undefined).success)
      .map(([component]) => component);
    expect(Object.keys(lane).sort()).toEqual(required.sort());
    declared["ci"] = [lane];

    const parsed = parseDeclaration(declared);

    expect(parsed.ci).toEqual([lane]);
    // The lane rides beside the rest of the declaration rather than
    // displacing it.
    expect(parsed.slices.enabled).toContain("plan-inbox");
  });

  it("a ci lane declares its title reader as a pattern or as a function", () => {
    // Both shapes, because both are what the package promises a consumer:
    // the grammar a runner emits is as readily a regex literal as a function
    // over the log, and a schema admitting one would make the other a
    // wrapper every consumer writes.
    const pattern: CiTitleReader = /^FAIL (.+)$/m;
    const fn: CiTitleReader = (log) => log.split("\n").filter((line) => line !== "");

    for (const titles of [pattern, fn]) {
      const declared = fullDeclaration();
      declared["ci"] = [{ name: "windows", workflow: "ci.yml", job: "test", titles }];
      expect(parseDeclaration(declared).ci?.[0]?.titles).toBe(titles);
    }

    // Declared nothing, and the field is absent rather than defaulted: a
    // lane with no reader wakes once per failing run, which is a stated
    // position the package does not fill in for a consumer.
    const silent = fullDeclaration();
    silent["ci"] = [{ name: "windows", workflow: "ci.yml", job: "test" }];
    expect(parseDeclaration(silent).ci?.[0]?.titles).toBeUndefined();

    // And a value that is neither refuses by name: a string naming a grammar
    // is a grammar the package would have to parse, which is the whole
    // reason the reader is the consumer's.
    const wrong = fullDeclaration();
    wrong["ci"] = [
      { name: "windows", workflow: "ci.yml", job: "test", titles: "^FAIL (.+)$" },
    ];
    const message = refusalFor(wrong);
    expect(message).toContain("ci.0.titles");
    expect(message).toContain("pattern");
  });

  it("a declaration whose ci lane omits its job refuses the load naming the field", () => {
    const declared = fullDeclaration();
    declared["ci"] = [{ name: "windows", workflow: "ci.yml" }];

    const message = refusalFor(declared);

    // The lane's own index and component, so a consumer with several lanes
    // is told which one named no job.
    expect(message).toContain("ci.0.job");
    expect(message).toContain("required field is missing");
  });

  it("a ci lane naming a component the slice does not read is refused at its own path", () => {
    const declared = fullDeclaration();
    declared["ci"] = [
      { name: "windows", workflow: "ci.yml", job: "test", branch: "main" },
    ];

    const message = refusalFor(declared);

    expect(message).toContain("ci.0.branch");
    expect(message).toContain("valid fields are: name, workflow, job");
  });

  it("two ci lanes sharing a lane name are refused, rather than filing findings under one key", () => {
    const declared = fullDeclaration();
    declared["ci"] = [
      { name: "windows", workflow: "ci.yml", job: "test (windows)" },
      { name: "windows", workflow: "nightly.yml", job: "test (windows)" },
    ];

    const message = refusalFor(declared);

    expect(message).toContain("ci.1.name");
    expect(message).toContain("keyed by lane name");
  });

  it("a declared ci list with no lanes is refused, rather than sourcing nothing", () => {
    const declared = fullDeclaration();
    declared["ci"] = [];

    expect(refusalFor(declared)).toContain("ci:");
  });

  it("a gate declared at a point the engine does not run is refused", () => {
    const declared = fullDeclaration();
    declared["gates"] = {
      build: [{ kind: "shell", command: "pnpm lint", when: "afterAgent" }],
    };

    expect(refusalFor(declared)).toContain("gates.build.0.when");
  });

  /**
   * The declaration list one page keeps by hand, cut from that page and proven
   * to be the list rather than an empty span. Both pages that keep one are the
   * surface a consumer arrives on before the hover text — one enumerating what
   * a declaration names, the other what the middle border hands a consumer —
   * so each is pinned for what it says against the interface it describes
   * (`.claude/rules/engineering.md`, *Narration is the ladder's bottom rung*,
   * the `docs/` carve-out).
   *
   * The span is cut rather than the page read whole: `docs/CHAIN-AUTHORING.md`
   * documents the engine-level `Chain` fields under the same names for two
   * thousand lines, so a whole-page read would report every field named
   * wherever it happened to fall and pass over a declaration list that names
   * none of them.
   */
  const declarationListOf = async (
    page: string,
    heading: string,
    anchor: string,
  ): Promise<string> => {
    const text = await readFile(new URL(`../${page}`, import.meta.url), "utf8");
    const section = sectionOf(text, heading);

    // The cut landed on the list, not on an empty span or a same-named
    // heading elsewhere: without this a renamed heading reports no missing
    // fields over no text at all (`.claude/rules/engineering.md`, *A green
    // verdict is proven non-vacuous*).
    expect({ page, anchored: section.includes(anchor) }).toEqual({
      page,
      anchored: true,
    });

    return section;
  };

  /** Every field the schema declares, read off the schema rather than listed here. */
  const declaredFields = (): string[] => {
    const fields = Object.keys(DeclarationSchema.shape);
    expect(fields.length).toBeGreaterThan(0);
    return fields;
  };

  const fieldsMissingFrom = async (
    page: string,
    heading: string,
    anchor: string,
  ): Promise<{ page: string; missing: string[] }> => {
    const section = await declarationListOf(page, heading, anchor);

    return {
      page,
      missing: declaredFields().filter((field) => !section.includes(`\`${field}\``)),
    };
  };

  /** Where `docs/LAYERS.md` keeps its walk of the declaration's fields. */
  const LAYERS_LIST = [
    "docs/LAYERS.md",
    "## Border 2 — harness to consumer",
    "Through the declaration's fields",
  ] as const;

  it("docs/CHAIN-AUTHORING.md names every field DeclarationSchema declares", async () => {
    expect(
      await fieldsMissingFrom(
        "docs/CHAIN-AUTHORING.md",
        '### "Declaration" names two different things',
        "The harness declaration's four required fields",
      ),
    ).toEqual({ page: "docs/CHAIN-AUTHORING.md", missing: [] });
  });

  it("docs/LAYERS.md names every field DeclarationSchema declares", async () => {
    expect(await fieldsMissingFrom(...LAYERS_LIST)).toEqual({
      page: "docs/LAYERS.md",
      missing: [],
    });
  });

  /**
   * The other direction over the same list, which the subset read above cannot
   * make: a field the schema never gained, or one a cut retired, stays named
   * as a typed place a consumer can declare and reads as current.
   *
   * Only this page's list, and only the members its bullets lead with. The
   * `docs/CHAIN-AUTHORING.md` list is running prose that names the engine's
   * `Chain` fields beside the declaration's, so "every name here is a field"
   * is not a claim it makes; the walk on this page is one bullet per member,
   * where it is.
   */
  it("docs/LAYERS.md names no declaration field DeclarationSchema does not declare", async () => {
    const named = leadNamesOf(await declarationListOf(...LAYERS_LIST));
    expect(named.length).toBeGreaterThan(0);

    const fields = declaredFields();
    expect({
      page: "docs/LAYERS.md",
      undeclared: named.filter((name) => !fields.includes(name)),
    }).toEqual({ page: "docs/LAYERS.md", undeclared: [] });
  });
});
