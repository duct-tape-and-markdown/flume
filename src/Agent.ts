/**
 * Agent — the seam between the dispatcher and an LLM CLI.
 *
 * v0 ships one implementation: `claudeCode()`. The interface exists so a
 * future provider (codex, gemini, etc.) can slot in without touching the
 * dispatcher. We deliberately do not abstract over streaming, structured
 * outputs, or session continuity; those are non-goals.
 */

import { spawn } from "node:child_process";

export interface AgentInvocation {
  /** Working directory for the agent process. */
  cwd: string;
  /** Fully-rendered prompt (substitution + inline-exec already applied). */
  prompt: string;
  /** Optional abort signal for cancellation. */
  signal?: AbortSignal;
  /** Stream callback for stdout chunks. The harness logs these. */
  onStdout?: (chunk: string) => void;
  /** Stream callback for stderr chunks. */
  onStderr?: (chunk: string) => void;
}

export interface AgentResult {
  /** Final exit code from the agent process. */
  exitCode: number;
  /** Full captured stdout. */
  stdout: string;
  /** Full captured stderr. */
  stderr: string;
}

export interface Agent {
  /** Stable identifier; appears in logs. */
  name: string;
  /** One invocation, no in-process iteration. */
  invoke(opts: AgentInvocation): Promise<AgentResult>;
}

// ---------- claudeCode provider ----------

export interface ClaudeCodeOptions {
  /** Path to the `claude` binary. Default: resolves from PATH. */
  binary?: string;
  /**
   * Pass `--dangerously-skip-permissions`. v0 default is `true` because every
   * Flume tick runs in a worktree the harness controls. Disable if running
   * against a directory you don't trust the agent in.
   */
  dangerouslySkipPermissions?: boolean;
  /** Extra flags appended to the `claude` argv. */
  extraArgs?: string[];
}

/**
 * Spawn `claude -p` with the rendered prompt on stdin. Captures stdout +
 * stderr, returns the exit code. Streaming callbacks fire on each chunk so
 * the dispatcher can surface progress.
 */
export function claudeCode(opts: ClaudeCodeOptions = {}): Agent {
  const binary = opts.binary ?? "claude";
  const skipPerms = opts.dangerouslySkipPermissions ?? true;
  const extra = opts.extraArgs ?? [];

  return {
    name: "claude-code",
    invoke({ cwd, prompt, signal, onStdout, onStderr }) {
      return new Promise((resolve, reject) => {
        const args = [
          "-p",
          ...(skipPerms ? ["--dangerously-skip-permissions"] : []),
          ...extra,
        ];

        const proc = spawn(binary, args, {
          cwd,
          stdio: ["pipe", "pipe", "pipe"],
          signal,
        });

        let stdout = "";
        let stderr = "";

        proc.stdout.setEncoding("utf8");
        proc.stderr.setEncoding("utf8");

        proc.stdout.on("data", (chunk: string) => {
          stdout += chunk;
          onStdout?.(chunk);
        });

        proc.stderr.on("data", (chunk: string) => {
          stderr += chunk;
          onStderr?.(chunk);
        });

        proc.on("error", (err) => reject(err));
        proc.on("close", (exitCode) =>
          resolve({ exitCode: exitCode ?? -1, stdout, stderr }),
        );

        proc.stdin.write(prompt);
        proc.stdin.end();
      });
    },
  };
}
