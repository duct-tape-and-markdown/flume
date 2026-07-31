# Flume — v0.10 Release Target (minor: the sighted-render line)

## 1. Purpose & scope

One ruling (operator, 2026-07-31): **a tick never runs on a prompt it
could not fully render.** Prompt rendering either produces the digest the
chain declared, or it fails loudly before the agent is invoked. No
substituted marker, no empty string standing in for output that never
came, no fallback to a shell that cannot parse the language the command
is written in.

Why: `evaluateInlineExec` substitutes
`<exec-failed cmd="...">stderr</exec-failed>` for a failed span and sends
the prompt anyway — behavior `docs/CHAIN-AUTHORING.md` states outright
and `tests/Prompt.test.ts` pins as correct. The measured cost, in this
repo and in two downstream bays: Windows plan ticks oriented on blinded
digests for the life of a loop, invisibly, because a prompt missing its
`<last-plan>` and `<spec-delta>` blocks still reads as well-formed. The
one defence that worked was a prose convention telling the agent not to
trust `<spec-delta>` — narration holding a property no mechanism held
(`.claude/rules/engineering.md`, "Narration is the ladder's bottom
rung"). This line moves it up the ladder.

The transport defect underneath it is settled by measurement rather than
by argument (spike, 2026-07-31, win32 + MSYS2 `sh.exe`):

- `execFile("sh", ["-c", cmd])` fails for **any non-ASCII byte anywhere
  in `cmd`** — bare, single-quoted, and double-quoted spans fail
  identically, and `é` fails as readily as `—`. Quoting is not implicated;
  the earlier single-quote diagnosis was wrong.
- The corruption is **not** byte encoding alone: under `LC_ALL=C.UTF-8`
  the bytes arrive intact (the error renders the character correctly) and
  the command still fails. The damage happens inside MSYS2's re-parsing
  of the Windows command line, which Node cannot influence from the spawn
  side.
- `windowsVerbatimArguments` and `shell: true` both exit **0 with empty
  stdout** — the silent-wrong-answer mode, worse than the marker case
  because nothing marks it at all.
- Passing the command via **stdin** or via a **temp script file** both
  return the exact expected output, non-ASCII intact.

Under `.claude/rules/engine-boundary.md` this is engine business: an
implementation cannot choose its own prompt-render transport, and the
engine reports the fact (a span did not resolve) that the chain would
otherwise have to infer from prompt text.

Blast radius: `src/Prompt.ts`, `src/builtinGates.ts`, `src/Dispatcher.ts`
(one no-commit classification), `tests/`, `docs/CHAIN-AUTHORING.md`,
CHANGELOG. Explicitly **not** in scope: a per-span tolerance knob (§5).

## 2. Inline-exec reaches `sh` through stdin, never argv

`evaluateInlineExec` spawns `sh` with **no command arguments** and writes
the command text to the child's stdin as UTF-8, closing it. The argv path
(`["-c", cmd]`) is removed; pre-1.0 clean-slate posture applies — edit in
place, no compatibility branch.

Declared consequence, stated because it is a real semantic change rather
than a discovery for a later bay: **`sh` consumes stdin**, so a span whose
command reads stdin sees EOF instead of inherited input. No span in this
repo's prompts, or in either shipped example chain, reads stdin. A chain
needing stdin inside a span is out of scope for this line.

The existing output cap (4 MiB) is preserved. `spawn` has no `maxBuffer`,
so the implementation buffers and enforces the cap itself, failing loudly
on overrun rather than truncating silently.

**Acceptance:** a span whose command contains U+2014 renders its real
output on win32. The reduced repro — `echo "(no prior plan: commit —
bootstrap tick)"` against the ASCII-hyphen twin — ships as the test, per
`.claude/rules/engineering.md`, "A fix ships the test that would have
caught it." A non-ASCII test that passes on POSIX regardless is not
sufficient evidence; the assertion must be one the pre-fix tree fails.

## 3. An unresolved inline-exec span fails the tick

A span that cannot be resolved — non-zero exit, spawn failure, `sh` not
found, cap overrun — **aborts the render**. The agent is not invoked. The
error names every failing span's command text and its stderr.

`<exec-failed>` is deleted: the marker, the doc paragraph that promises
"the prompt still sends" (`docs/CHAIN-AUTHORING.md`), and the tests that
pin it (`tests/Prompt.test.ts`). Replacements assert the refusal.

A tick that aborts at render classifies as a §6 no-commit outcome
distinguishable from a voluntary bail, so a chain's `handoff` can tell
"could not see" from "chose not to act". Reuse the existing
`NoCommitMode` union rather than adding a parallel channel.

**Acceptance:** a chain whose prompt names a failing command produces no
agent invocation and a non-zero tick, with the failing command in the
message. An empty-but-successful command (`git diff` with no changes) is
**not** a failure — exit status decides, never output length.

## 4. The cmd.exe fallback leaves the inline-exec path

`execGate`'s win32 ENOENT → `shell: true` retry exists for
package-manager `.cmd` shims, where the arguments are chain-authored
flags and cmd.exe is the correct interpreter. It is **wrong** for `sh -c`,
where the payload is shell script in a language cmd.exe does not speak,
and where the observed result is exit 0 with empty output.

`Prompt.ts` stops sharing `execGate`. The helper stays for gate binaries,
unchanged; sharing it across two use cases with opposite interpreter needs
is the defect (`.claude/rules/engineering.md`, "The fix lands at the
mechanism"). A missing `sh` is a §3 render failure, not a fallback.

**Acceptance:** no inline-exec path can reach cmd.exe. `execGate`'s
existing shim behavior for `pnpm`/`npm` is unchanged and still covered.

## 5. Non-goals

- **A per-span tolerance knob** (`!?`cmd``, or a chain-declared optional
  list). Every span in this repo's prompts and both example chains is a
  digest whose failure means a blind tick; none wants tolerance. This
  ships only if a real tolerance case appears — additive when it does,
  and speculative before then (`.claude/rules/collaboration.md`,
  "Complexity is a signal").
- **Temp-script transport.** Verified working, not chosen: it buys stdin
  passthrough that nothing needs, at the cost of temp-file lifecycle and
  cleanup-on-crash.
- **Locale or argv-encoding fixes.** Measured non-viable (§1).

## 6. Docs, CHANGELOG, and the operator leg

`docs/CHAIN-AUTHORING.md`'s inline-exec section is rewritten: stdin
transport, the stdin-consumption consequence, and render-fails-loud
replacing the `<exec-failed>` paragraph. CHANGELOG carries the removal
under `### Breaking` per v0.1 §9 — a chain relying on a tolerated failing
span will now fail its tick.

**Operator leg, not a phase entry.** `.flume/PROTOCOL.md`'s "Inline-exec
commands are ASCII-only" section is interim narration whose retiring
trigger is this line; it is deleted by a `chore(flume):` commit once §2
ships. Build's `writablePaths` do not reach `.flume/PROTOCOL.md`, so
**plan must not file an entry for it** — an entry build cannot ship
strands and reappears as an open question. Precedent:
PROMPTS-BUILD-FENCE-INSTRUCTION. This paragraph is the delivery note.
