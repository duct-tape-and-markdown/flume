/**
 * `tests/helpers/denial.ts`'s own cover: the two shapes the suite's refusal
 * fixtures are built on, pinned as behaviour rather than asserted once per
 * call site.
 *
 * Every one of those sites reads the same way — deny, then assert the code
 * under test took its non-ENOENT arm — and every one of them is judged
 * against a mode that denies nothing on win32 unless the primitive really
 * refuses on both hosts (`.claude/rules/platform-facts.md`, *chmod denies
 * nothing on win32*). So the refusal is pinned here, on the raw `node:fs`
 * calls the engine's probes are built from, with no platform guard: a host
 * where structural denial stopped denying reds this file first, and the
 * dozen loud-or-nothing cases downstream stop reading as green over nothing.
 */

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DENIAL_NOTE, denyDirectory, denyFile } from "./helpers/denial.ts";
import { mkTempDir } from "./helpers/subprocess.ts";

const roots: string[] = [];

const scratch = async (): Promise<string> => {
  const dir = await mkTempDir("flume-denial-");
  roots.push(dir);
  return dir;
};

afterEach(async () => {
  // Nothing to un-deny first: a plain file and a directory are ordinary
  // entries, which is half the point of the primitive.
  await Promise.all(roots.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

/** The errno a call raised, or `undefined` when it did not raise at all. */
const errno = (call: () => unknown): string | undefined => {
  try {
    call();
  } catch (err) {
    return (err as NodeJS.ErrnoException).code ?? "";
  }
  return undefined;
};

describe("denyDirectory — a plain file where a directory is read", () => {
  it("a structurally denied directory fails a readdir with a non-ENOENT error", async () => {
    const root = await scratch();
    const dir = join(root, "friction");
    mkdirSync(dir);
    writeFileSync(join(dir, "a.md"), "note\n");
    // Non-vacuity: the dir really is readable and really holds the note, so
    // the refusal below is the denial talking and not a mistyped path
    // (`.claude/rules/engineering.md`, *A green verdict is proven
    // non-vacuous*).
    expect(readdirSync(dir)).toEqual(["a.md"]);

    denyDirectory(dir);

    const code = errno(() => readdirSync(dir, { withFileTypes: true }));
    expect(code).toBeDefined();
    expect(code).not.toBe("ENOENT");
  });

  it("a structurally denied directory fails a mkdir and a read of a child, neither as ENOENT", async () => {
    const root = await scratch();
    const dir = join(root, "awake");
    mkdirSync(dir);
    writeFileSync(join(dir, "plan"), "");
    expect(readdirSync(dir)).toEqual(["plan"]);

    denyDirectory(dir);

    // The two other ways the engine reaches a directory it was handed: the
    // Baton constructor mkdirs its own dir before listing it, and a probe
    // that skips the listing reads a child by name.
    for (const code of [
      errno(() => mkdirSync(dir, { recursive: true })),
      errno(() => readFileSync(join(dir, "plan"), "utf8")),
    ]) {
      expect(code).toBeDefined();
      expect(code).not.toBe("ENOENT");
    }
  });

  it("a structurally denied directory is still present to a stat, so an existence gate above the read does not take its absent arm", async () => {
    const root = await scratch();
    const dir = join(root, "jobs");
    mkdirSync(dir);

    denyDirectory(dir);

    // `existsLoud` (`src/fsProbe.ts`) is this call. It must answer "there",
    // or every gate that probes before reading skips the read the case is
    // about.
    expect(statSync(dir, { throwIfNoEntry: false })).toBeDefined();
    expect(readFileSync(dir, "utf8")).toBe(DENIAL_NOTE);
  });

  it("denying a parent instead of the read path reads as plain absence to an existence probe, which is why the primitive targets the read path", async () => {
    const root = await scratch();
    const jobDir = join(root, "job");
    mkdirSync(join(jobDir, "plan"), { recursive: true });
    const read = join(jobDir, "plan", "pending.json");
    writeFileSync(read, "[]");
    expect(statSync(read, { throwIfNoEntry: false })).toBeDefined();

    // The tempting seal: one denial covering every read beneath it.
    denyDirectory(join(jobDir, "plan"));

    // And the gate above the refusal now answers "absent" rather than
    // refusing — `throwIfNoEntry` suppresses ENOTDIR alongside ENOENT, so the
    // case would assert its loud-or-nothing verdict over the silent arm.
    // The refusal is reached only when the read path itself is denied.
    expect(statSync(read, { throwIfNoEntry: false })).toBeUndefined();
  });

  it("a structurally denied directory refuses a path whose parent is absent rather than creating one", async () => {
    const root = await scratch();

    const code = errno(() => denyDirectory(join(root, "typo", "friction")));
    expect(code).toBe("ENOENT");
    expect(readdirSync(root)).toEqual([]);
  });
});

describe("denyFile — a directory where a file is read or written", () => {
  it("a structurally denied file fails a write with a non-ENOENT error", async () => {
    const root = await scratch();
    const path = join(root, "pending.json");
    writeFileSync(path, "[]");
    // Non-vacuity: the path is writable first, so the refusal is the denial.
    expect(errno(() => writeFileSync(path, "[]"))).toBeUndefined();

    denyFile(path);

    const code = errno(() => writeFileSync(path, "[]"));
    expect(code).toBeDefined();
    expect(code).not.toBe("ENOENT");
  });

  it("a structurally denied file fails a read with a non-ENOENT error while a stat still reports it present", async () => {
    const root = await scratch();
    const path = join(root, "loop.pid");
    writeFileSync(path, String(process.pid), "utf8");
    expect(readFileSync(path, "utf8")).toBe(String(process.pid));

    denyFile(path);

    const code = errno(() => readFileSync(path, "utf8"));
    expect(code).toBeDefined();
    expect(code).not.toBe("ENOENT");
    // The split a probe-then-read gate has to survive: present to the stat,
    // refused on the read.
    expect(statSync(path, { throwIfNoEntry: false })).toBeDefined();
  });

  it("a structurally denied file refuses a path whose parent is absent rather than creating one", async () => {
    const root = await scratch();

    const code = errno(() => denyFile(join(root, "typo", "pending.json")));
    expect(code).toBe("ENOENT");
    expect(readdirSync(root)).toEqual([]);
  });
});
