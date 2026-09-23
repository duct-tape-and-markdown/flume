/**
 * `tests/helpers/hostDeclarations.ts`'s cover, and the suite's two standing
 * pins on how a case may skip a host.
 *
 * `spec/cli.md`, *win32 is a supported host*, makes the Windows lane a plan
 * input rather than a merge gate, which only works while a red title means
 * something: a case whose subject is POSIX error semantics declares its host
 * "and skips on win32 with the reason stated, never silently", and everything
 * else that reds is a defect in the engine or in the fixture. The two pins
 * below are that sentence at the rung above prose — one holding the suite's
 * denial primitive structural wherever the code path allows it, one holding
 * every declared skip to a stated reason.
 *
 * The reasons are a ledger rather than a comment per site for the same reason
 * the citation scan's exclusions are: a skip is the one place the lane's
 * coverage is narrowed by hand, and a narrowing nobody wrote a reason for is
 * indistinguishable from residue. The ledger is also the only surface that
 * answers "what does the Windows lane not run?" in one read.
 *
 * The detector is proven on fixtures of this file's own writing — sources
 * built to be caught and to be passed over — so a green verdict over the
 * suite is a detector firing rather than a scan that stopped matching
 * (`.claude/rules/engineering.md`, *A green verdict is proven non-vacuous*).
 */

import { describe, expect, it } from "vitest";

import {
  formatSite,
  hostDeclarationLedger,
  scanHostDeclarations,
  suiteSources,
  type HostScan,
} from "./helpers/hostDeclarations.ts";
import { expectNoFindings } from "./helpers/repoProgram.ts";

const suite = scanHostDeclarations(suiteSources());

/** A fixture module, parsed by the one scan the suite is judged by. */
const over = (text: string): HostScan =>
  scanHostDeclarations([{ module: "tests/fixture.test.ts", text }]);

it("no case in tests/ denies with a permission bit outside the declared-host list", () => {
  // Vacuity: the suite really does hold permission-bit denials, and the walk
  // reached more than one file of them. A `chmod` spelling that stopped
  // matching would otherwise report a clean suite over zero subjects.
  expect(suite.denials.scanned.length).toBeGreaterThan(0);
  expect(new Set(suite.denials.scanned.map((s) => s.module)).size).toBeGreaterThan(1);

  expectNoFindings(suite.denials.findings.map(formatSite));

  // And every one of them is inside a case the ledger names a reason for —
  // `declared` being non-null is the finding's own predicate, so the reason
  // is what this adds.
  expectNoFindings(
    suite.denials.scanned
      .filter((site) => site.declared?.reason == null)
      .map(formatSite),
  );
});

it("every declared-host case carries the reason it cannot run on the other host", () => {
  // Vacuity: both hosts are declared somewhere in the suite, in quantity.
  // A guard spelling that stopped matching would leave this green over an
  // empty set, and a scan that saw only one host would leave half the ledger
  // unjudged.
  const hosts = suite.declarations.scanned.map((site) => site.host);
  expect(hosts.filter((h) => h === "posix").length).toBeGreaterThan(20);
  expect(hosts.filter((h) => h === "win32").length).toBeGreaterThan(5);

  expectNoFindings(suite.declarations.findings.map(formatSite));

  // The other direction: a ledger row whose case was renamed or deleted is a
  // reason for a skip that no longer happens, and reds here rather than
  // sitting in the file unread.
  const declared = new Set(suite.declarations.scanned.map((site) => site.key));
  expectNoFindings(
    [...hostDeclarationLedger().keys()].filter((key) => !declared.has(key)),
  );
});

describe("the host-declaration scan — the detector, over sources written to be caught", () => {
  it("reads a bare chmod that takes a permission away as an undeclared denial", () => {
    const scan = over(
      `it("denies", async () => { await chmod(dir, 0o444); });\n`,
    );
    expect(scan.denials.scanned.map((s) => s.mode)).toEqual(["0o444"]);
    expect(scan.denials.findings).toHaveLength(1);
    expect(scan.declarations.scanned).toEqual([]);
  });

  it("passes over a chmod that grants, and over a mode option that grants", () => {
    const scan = over(
      `it("grants", async () => {\n` +
        `  await chmod(bin, 0o755);\n` +
        `  await writeFile(p, "x", { mode: 0o644 });\n` +
        `});\n`,
    );
    expect(scan.denials.scanned).toEqual([]);
  });

  it("reads a denying mode option handed to a writer, not only a chmod call", () => {
    const scan = over(
      `it("denies", async () => { await writeFile(p, "x", { mode: 0o000 }); });\n`,
    );
    expect(scan.denials.scanned.map((s) => s.mode)).toEqual(["0o000"]);
  });

  it("attributes a denial to the innermost host-declared case around it", () => {
    const scan = over(
      `describe.runIf(process.platform !== "win32")("outer", () => {\n` +
        `  it("inner", async () => { await chmod(dir, 0o444); });\n` +
        `});\n`,
    );
    expect(scan.denials.findings).toEqual([]);
    expect(scan.denials.scanned[0]?.declared?.title).toBe("outer");
    expect(scan.denials.scanned[0]?.declared?.host).toBe("posix");
  });

  it("reads both guard modifiers, and both directions of the platform comparison", () => {
    const scan = over(
      `it.runIf(process.platform !== "win32")("a", () => {});\n` +
        `it.runIf(process.platform === "win32")("b", () => {});\n` +
        `it.skipIf(process.platform === "win32")("c", () => {});\n` +
        `it.skipIf(process.platform !== "win32")("d", () => {});\n`,
    );
    expect(
      Object.fromEntries(scan.declarations.scanned.map((s) => [s.title, s.host])),
    ).toEqual({ a: "posix", b: "win32", c: "posix", d: "win32" });
  });

  it("follows a host bound to a local const, and a registrar pre-guarded by one", () => {
    const scan = over(
      `const onPosix = process.platform !== "win32";\n` +
        `const posixOnly = it.runIf(onPosix);\n` +
        `it.runIf(onPosix)("bound", () => {});\n` +
        `posixOnly("aliased", () => {});\n`,
    );
    expect(
      Object.fromEntries(scan.declarations.scanned.map((s) => [s.title, s.host])),
    ).toEqual({ bound: "posix", aliased: "posix" });
  });

  it("passes over a runIf that names no platform, which declares no host", () => {
    const scan = over(`it.runIf(hasDocker)("needs docker", () => {});\n`);
    expect(scan.declarations.scanned).toEqual([]);
  });

  it("refuses a platform comparison the ledger has no host vocabulary for", () => {
    expect(() =>
      over(`it.runIf(process.platform === "darwin")("mac only", () => {});\n`),
    ).toThrow(/darwin/);
  });

  it("names a declared case the ledger has no reason for as a finding", () => {
    const scan = over(
      `it.runIf(process.platform !== "win32")("unledgered", () => {});\n`,
    );
    expect(scan.declarations.findings.map((s) => s.title)).toEqual([
      "unledgered",
    ]);
  });
});
