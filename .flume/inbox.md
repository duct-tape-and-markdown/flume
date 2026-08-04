# Inbox — findings queue

Transient queue of findings awaiting triage by the plan phase. Append-only by external reviewers; drained-only by plan.

## Who writes here

- Humans dropping observations to be routed.
- Future review skills (e.g. multidim-review, security-review) when added.

**Plan does not write here.** Plan-tick self-audit findings go directly to `.flume/plan/pending.json` (file as entry), to `.flume/plan/open-questions.md` (parked for human input), or live only in the `plan:` commit message body (narrative + dispositions).

## Who reads here

The plan phase reads inbox.md every tick and drains each entry into one of three outcomes:

1. **File as a pending entry** in `.flume/plan/pending.json` (with a `per` cite to the relevant spec section).
2. **Park** in `.flume/plan/open-questions.md` if it needs human input before any code can land.
3. **Accept as debt** — note the disposition + one-line reason in the `plan:` commit message body.

After routing, the inbox entry is **removed**. The queue is meant to drain; it is not a log. Narrative history lives in git.

## Format

Each entry is a markdown subsection:

```
## YYYY-MM-DD — <short label> (<source>)

<finding body — observations, file:line cites, severity if known>
```

`<source>` is the writer (e.g. `human`, `multidim-review`). One subsection per finding cluster; group related items under one `##` to keep routing atomic.

---

<!-- entries below this line; newest first -->

## 2026-08-04 — repoint cites of the renamed ship-detection section (operator)

`spec/pending.md`'s section **"Ship detection requires a declared-files diff"** is
now **"Ship detection trusts the agent's own account"**. The old heading named the
mechanism the 2026-08-03 ruling deleted, so a section describing the replacement
could not keep it.

Cites to repoint — all cite the heading as a quoted string:

- `src/Dispatcher.ts` — the `MergeOutcome` doc comment (`channel-only` arm), the
  ship-classification site in `runFanout`, and `statesPark`'s own doc comment.
- `tests/Dispatcher.test.ts` — the describe title covering the stated-park case.

Mechanical: swap the quoted heading, change nothing else. The ruling date already
beside each cite stays.

Per candidate: `.claude/rules/engineering.md` *Narration is the ladder's bottom rung*
— a cite is narration, and one naming a heading that no longer exists cannot resolve.
Test: no file under `src/` or `tests/` quotes "Ship detection requires a
declared-files diff".

## 2026-08-04 — `build.md` describes the retired channel-path ship mechanism (operator)

`.flume/prompts/build.md` line 26 tells the agent that a committed park is safe
because "the channel allows the path, and ship-detection keeps a channel-only commit
from clearing the entry". Ship detection no longer reads channel paths — it reads the
agent's own termination for a stated park (`spec/pending.md`, *Ship detection trusts
the agent's own account*).

The instruction still produces the right behavior, for the wrong stated reason, which
makes it the weakest kind of prose: an agent reasoning from it about an unlisted case
reasons from a mechanism that is gone.

Harness surface, so this is an interactive `chore(flume):` rather than a build entry —
filing it here so it is not lost, not so a build tick picks it up. Note it interacts
with the parked `statesPark` question: if that question's fix changes how a park is
stated, this paragraph is what tells the agent to state it, and the two should land
together.

## 2026-08-04 — the integration suite has never run on Windows (operator)

Two facts that only matter together:

- **`test:integration` is unrunnable on win32.** `package.json` defines it as
  `VITEST_LANE=integration vitest run` — a POSIX env-var prefix. cmd.exe and
  PowerShell both reject it (`'VITEST_LANE' is not recognized...`), so a
  Windows contributor gets a lifecycle failure, not a test run. Reproduced on
  this machine.
- **CI's windows lane does not invoke it.** That job runs `pnpm install`,
  `pnpm tsc --noEmit`, `pnpm test`, `pnpm build`, `pnpm run smoke:install`.
  `test:integration` runs only in the ubuntu `ci` job.

So the integration lane has executed on Linux only, ever. That lane is where
worktree provisioning, the job verbs, and the loop's process boundary are
covered — the most platform-sensitive surface in the repo, and the subject of
most of `.claude/rules/platform-facts.md`. A repo that maintains a dedicated
win32 lane because win32 breaks differently is not running its
platform-sensitive tests there.

Prefer a config-based lane over an env var: a second vitest config
(`vitest run -c vitest.integration.config.ts`) selects the lane through an
argument every shell passes identically, and adds no dependency. A
`cross-env` dev-dep would also work and is worse — it buys a shell fix with a
supply-chain entry.

Whether the windows CI lane should then *run* the integration suite is a
separate call with a real cost (that job is already the slow one). Route it,
do not assume it: making the script portable is the defect fix; extending the
lane is a policy choice about CI minutes.

Per candidate: `spec/cli.md` — the win32 portability section that motivates
the dedicated lane. Test: the integration lane is invoked identically on both
platforms; a Windows developer running the documented command gets a test
run.
