import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Baton } from "../src/Baton.ts";

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "flume-baton-"));
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe("Baton — wake/sleep/awake roundtrip", () => {
  it("wake creates the flag, awake() lists it, sleep removes it", () => {
    const baton = new Baton(repoRoot);

    expect(baton.awake()).toEqual([]);
    expect(baton.isAwake("plan")).toBe(false);
    expect(baton.hibernating()).toBe(true);

    baton.wake("plan");
    expect(baton.isAwake("plan")).toBe(true);
    expect(baton.awake()).toEqual(["plan"]);
    expect(baton.hibernating()).toBe(false);
    expect(existsSync(join(repoRoot, ".flume", "awake", "plan"))).toBe(true);

    baton.sleep("plan");
    expect(baton.isAwake("plan")).toBe(false);
    expect(baton.awake()).toEqual([]);
    expect(baton.hibernating()).toBe(true);
    expect(existsSync(join(repoRoot, ".flume", "awake", "plan"))).toBe(false);
  });

  it("awake() returns sorted names when multiple phases are awake", () => {
    const baton = new Baton(repoRoot);
    baton.wake("plan");
    baton.wake("build");
    baton.wake("audit");

    expect(baton.awake()).toEqual(["audit", "build", "plan"]);
  });
});

describe("Baton — idempotency", () => {
  it("double wake is a no-op (still one flag, still listed once)", () => {
    const baton = new Baton(repoRoot);
    baton.wake("plan");
    baton.wake("plan");

    expect(baton.awake()).toEqual(["plan"]);
    expect(baton.isAwake("plan")).toBe(true);
  });

  it("sleep on a phase that isn't awake is a no-op (no throw)", () => {
    const baton = new Baton(repoRoot);
    expect(() => baton.sleep("never-woken")).not.toThrow();
    expect(baton.awake()).toEqual([]);
  });

  it("double sleep is a no-op", () => {
    const baton = new Baton(repoRoot);
    baton.wake("plan");
    baton.sleep("plan");
    expect(() => baton.sleep("plan")).not.toThrow();
    expect(baton.isAwake("plan")).toBe(false);
  });
});

describe("Baton — missing directory", () => {
  it("constructor creates `.flume/awake` when neither exists", () => {
    const fresh = mkdtempSync(join(tmpdir(), "flume-baton-fresh-"));
    try {
      expect(existsSync(join(fresh, ".flume"))).toBe(false);

      const baton = new Baton(fresh);

      expect(existsSync(join(fresh, ".flume", "awake"))).toBe(true);
      expect(baton.awake()).toEqual([]);
      expect(baton.hibernating()).toBe(true);

      baton.wake("plan");
      expect(baton.isAwake("plan")).toBe(true);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  it("constructor is idempotent when `.flume/awake` already exists", () => {
    new Baton(repoRoot);
    const second = new Baton(repoRoot);
    expect(second.awake()).toEqual([]);
  });
});
