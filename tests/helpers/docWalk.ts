/**
 * Arming a doc walk — one home for the sequence every `docs/CHAIN-AUTHORING.md`
 * walk runs before it judges anything: resolve the set a declaration declares,
 * prove the resolution is the real one, and cut the section claimed to walk it,
 * anchored on a phrase that proves the cut landed.
 *
 * Three describes in `tests/examples.test.ts` spelled that sequence three ways
 * at ~90 lines each (`.claude/rules/engineering.md`, *A module is one job*),
 * and a fourth walk would have copied whichever was nearest, as eight
 * `sectionOf` copies did before `docSections.ts`. The cut itself stays there:
 * this module arms a walk and reads the page through `sectionOf`
 * (`tests/helpers/docSections.ts`), which is still the suite's one cutter.
 *
 * The program is the cheap tier — one module, no lib, no resolution, no
 * `@types`. Every subject is one interface in one module, and a checker over
 * that module alone answers in a tenth of the time the repo program takes to
 * start, which is what keeps these cases in the fast lane (spec/worktrees.md,
 * *The default test lane must stay fast*). The tier stays here rather than in
 * `tests/helpers/repoProgram.ts` on that module's own condition: a tier moves
 * there at its **second** consumer, and folding three copies into this one
 * leaves it with one.
 *
 * Not *.test.ts, so neither vitest lane collects it as a suite of its own.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { expect } from "vitest";

import { sectionOf } from "./docSections.ts";
import { REPO_ROOT } from "./repoProgram.ts";

/** What a walk is armed from: where the set is declared, and where it is walked. */
export interface DocWalkRequest {
  /** Repo-relative module holding the declaration — `src/Gate.ts`. */
  readonly module: string;
  /** The interface that module declares. */
  readonly interface: string;
  /**
   * A property of that interface whose own type declares the set, for a walk
   * whose subject is one field's shape rather than the interface's members.
   * Omitted, the interface's own properties are the set.
   */
  readonly through?: string;
  /**
   * One member the set must carry — the vacuity anchor
   * (`.claude/rules/engineering.md`, *A green verdict is proven non-vacuous*).
   * A resolution that fell through to an empty property list would walk zero
   * members and pass, and every listing filtered against it would be empty
   * too. One anchor rather than a second copy of the list beside the
   * declaration (*Derived state is computed, never restated beside its
   * source*) — the anchor plus the count is what proves the set is the real
   * one.
   */
  readonly member: string;
  /** Repo-relative page the walk lives on. */
  readonly page: string;
  /** The heading line opening the section, matched by `sectionOf`. */
  readonly heading: string | RegExp;
  /**
   * A phrase the section carries, asserted before anything is read off the
   * cut: a heading match that captured the wrong span would otherwise report
   * every member missing, or an empty walk against an empty span.
   */
  readonly anchor: string;
}

/** The two sides a walk's cases compare. */
export interface DocWalk {
  /** Every member the declaration declares, in declaration order. */
  readonly members: string[];
  /** The anchored section, for `walkOf`/`restatementsOf` to read. */
  readonly section: string;
}

/**
 * The declared set and the section that claims to walk it, each proven to be
 * the thing the caller named before either is compared against the other.
 */
export function docWalk(request: DocWalkRequest): DocWalk {
  return {
    members: declaredMembers(request),
    section: anchoredSection(request),
  };
}

/**
 * The set, off the declaration through a checker rather than off a list kept
 * beside it (*Derived state is computed, never restated beside its source*): a
 * member the type gained and the page skipped reds, which a hand-kept list
 * could only do if someone remembered to extend it. A declaration that moved
 * out of its module resolves to nothing here rather than quietly to something
 * else, and the vacuity assertions are what red on that.
 */
function declaredMembers(request: DocWalkRequest): string[] {
  const module = join(REPO_ROOT, request.module);
  const program = ts.createProgram({
    rootNames: [module],
    options: { noLib: true, noResolve: true, types: [] },
  });
  const source = program.getSourceFile(module);
  expect(source, `${request.module} is in the program`).toBeDefined();

  let declared: ts.Identifier | undefined;
  ts.forEachChild(source!, (node) => {
    if (
      ts.isInterfaceDeclaration(node) &&
      node.name.text === request.interface
    ) {
      declared = node.name;
    }
  });
  expect(
    declared,
    `${request.module} declares an interface \`${request.interface}\``,
  ).toBeDefined();

  const checker = program.getTypeChecker();
  let declaring = checker.getDeclaredTypeOfSymbol(
    checker.getSymbolAtLocation(declared!)!,
  );
  if (request.through !== undefined) {
    const field = declaring.getProperty(request.through);
    expect(
      field,
      `\`${request.interface}\` declares \`${request.through}\``,
    ).toBeDefined();
    declaring = checker.getNonNullableType(
      checker.getTypeOfSymbolAtLocation(field!, field!.valueDeclaration!),
    );
  }

  const members = declaring.getProperties().map((member) => member.name);
  expect(members.length).toBeGreaterThan(1);
  expect(members).toContain(request.member);
  return members;
}

/** The section under judgment, anchored before anything is read off it. */
function anchoredSection(request: DocWalkRequest): string {
  const section = sectionOf(
    readFileSync(join(REPO_ROOT, request.page), "utf8"),
    request.heading,
  );
  expect(section).toContain(request.anchor);
  return section;
}
