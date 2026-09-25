/**
 * `withSessionCapture` (`src/sessionCapture.ts`): where the tee writes, what
 * it names the file, and how a failed capture is raised.
 *
 * No child process here — the decorator wraps any `Agent` (`src/Agent.ts`)
 * and reads nothing out of the bytes it writes, so a hand-written agent is
 * the whole producer its cases need.
 */

import { describe, expect, it, vi } from "vitest";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { withSessionCapture } from "../src/sessionCapture.ts";
import type { Agent } from "../src/Agent.ts";

import { mkTempDir } from "./helpers/fixtureRoot.ts";

describe("withSessionCapture", () => {
  it("tees stdout chunks to the configured capture file and still forwards to outer onStdout", async () => {
    const dir = await mkTempDir("flume-capture-");
    try {
      const fake: Agent = {
        name: "fake",
        async invoke(inv) {
          inv.onStdout?.("hello ");
          inv.onStdout?.("world\n");
          inv.onStdout?.("second line\n");
          return {
            exitCode: 0,
            stdout: "hello world\nsecond line\n",
            stderr: "",
          };
        },
      };

      let outerSaw = "";
      const wrapped = withSessionCapture(fake, {
        dir,
        filename: () => "session.txt",
      });
      const result = await wrapped.invoke({
        cwd: "/tmp",
        prompt: "",
        onStdout: (chunk) => {
          outerSaw += chunk;
        },
      });

      expect(result.exitCode).toBe(0);
      expect(wrapped.name).toBe("fake+capture");
      expect(outerSaw).toBe("hello world\nsecond line\n");

      const captured = await readFile(join(dir, "session.txt"), "utf8");
      expect(captured).toBe("hello world\nsecond line\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("creates the capture directory if it does not exist", async () => {
    const root = await mkTempDir("flume-capture-root-");
    const dir = join(root, "nested", "deeper");
    try {
      const fake: Agent = {
        name: "fake",
        async invoke(inv) {
          inv.onStdout?.("bytes");
          return { exitCode: 0, stdout: "bytes", stderr: "" };
        },
      };
      const wrapped = withSessionCapture(fake, {
        dir,
        filename: () => "out.txt",
      });
      await wrapped.invoke({ cwd: "/tmp", prompt: "" });

      const captured = await readFile(join(dir, "out.txt"), "utf8");
      expect(captured).toBe("bytes");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports a failed capture write as the invocation's error rather than an uncaught exception", async () => {
    const dir = await mkTempDir("flume-capture-fail-");
    try {
      // A directory where the capture file goes: the stream's open refuses
      // with EISDIR on every host, where a permission bit would deny nothing
      // on win32 (`.claude/rules/platform-facts.md`, *chmod denies nothing on
      // win32*).
      await mkdir(join(dir, "session.txt"));

      let settled = false;
      const fake: Agent = {
        name: "fake",
        async invoke(inv) {
          inv.onStdout?.("hello ");
          inv.onStdout?.("world\n");
          settled = true;
          return { exitCode: 0, stdout: "hello world\n", stderr: "" };
        },
      };

      let outerSaw = "";
      const wrapped = withSessionCapture(fake, {
        dir,
        filename: () => "session.txt",
      });
      const error = await wrapped
        .invoke({
          cwd: "/tmp",
          prompt: "",
          onStdout: (chunk) => {
            outerSaw += chunk;
          },
        })
        .then(
          () => undefined,
          (err: unknown) => err,
        );

      // The wrapped agent ran to completion and the caller still saw its
      // stdout — the capture failure is what the rejection is about.
      expect(settled).toBe(true);
      expect(outerSaw).toBe("hello world\n");
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("session capture failed");
      expect((error as Error).message).toContain("session.txt");
      expect(((error as Error).cause as NodeJS.ErrnoException).code).toBe(
        "EISDIR",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps a wrapped agent's own rejection and rides the capture failure on it as cause", async () => {
    const dir = await mkTempDir("flume-capture-both-");
    try {
      await mkdir(join(dir, "session.txt"));

      const agentFailure = new Error("agent blew up");
      const fake: Agent = {
        name: "fake",
        async invoke(inv) {
          inv.onStdout?.("partial");
          throw agentFailure;
        },
      };

      const wrapped = withSessionCapture(fake, {
        dir,
        filename: () => "session.txt",
      });
      const error = await wrapped.invoke({ cwd: "/tmp", prompt: "" }).then(
        () => undefined,
        (err: unknown) => err,
      );

      expect(error).toBe(agentFailure);
      expect(((error as Error).cause as NodeJS.ErrnoException).code).toBe(
        "EISDIR",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not collide when two invocations with distinct cwds default the filename under a frozen clock", async () => {
    const dir = await mkTempDir("flume-capture-fanout-");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    try {
      const fake = (payload: string): Agent => ({
        name: "fake",
        async invoke(inv) {
          inv.onStdout?.(payload);
          return { exitCode: 0, stdout: payload, stderr: "" };
        },
      });

      const wrapped = withSessionCapture(fake("payload"), { dir });

      const [resultA, resultB] = await Promise.all([
        wrapped.invoke({ cwd: join("/tmp", "worktree-a"), prompt: "" }),
        wrapped.invoke({ cwd: join("/tmp", "worktree-b"), prompt: "" }),
      ]);

      expect(resultA.exitCode).toBe(0);
      expect(resultB.exitCode).toBe(0);

      const files = await readdir(dir);
      expect(files).toHaveLength(2);

      const contents = await Promise.all(
        files.map((f) => readFile(join(dir, f), "utf8")),
      );
      expect(contents).toEqual(["payload", "payload"]);
    } finally {
      vi.useRealTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
