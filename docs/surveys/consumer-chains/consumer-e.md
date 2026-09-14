# consumer-e — chain survey

Read 2026-09-14. Every claim verified on disk at that read; `path:line` is
relative to the consumer repository root. Read-only: nothing modified.

**consumer-e is archived and does not run.** Its last commit is
`interim/centercode: strip to the minimal runtime — brief, chain, phase
prompts`; its `awake/` marker dates to June and its state root has not been
written since July. It is included in the survey for three reasons, all of
which are about the *engine* rather than about this consumer:

1. It is the **only path-linked consumer on the machine** — `"@dtmd/flume":
   "file:../flume"` — so it is the one chain that would break first under a
   local engine edit, and the one whose staleness is invisible to any registry
   version check.
2. It is a **0.3-era chain preserved intact**, which makes it a usable baseline
   for what has changed in the chain surface across a dozen minors.
3. Its breakage profile is **categorically different** from the other four:
   where they break on a renamed string or a reworded sentence, consumer-e
   breaks on the chain module's *contract*.

This file is therefore shorter than the others and skips detail that would
only describe a dead bay.

## 1. Identity and engine version

| | |
| --- | --- |
| Label | `consumer-e` |
| Primary stack | TypeScript / Node — the product is a small CLI (`src/`, `bin/`, `tests/`) |
| Package manager | pnpm |
| Engine dependency | **`"@dtmd/flume": "file:../flume"`** — a **path link to the local flume checkout**, not a registry install. Unique in the survey. |
| Resolved version | **`0.3.1`** in `node_modules`. The link points at a checkout now on 0.15.0, so the installed tree is **twelve minors stale** and the link has not been re-resolved since. A path link that is never reinstalled is a pin with no version recorded anywhere — nothing in the repo states `0.3.1`, and no lockfile check would surface it. |
| State root | `.flume/`, **default root**. No `flume job`. |
| Liveness | **Archived.** `awake/` dated June; last write July. |

## 2. Chain shape

Chain module: `.flume/chain.ts`, **133 lines** — an order of magnitude smaller
than any other consumer (consumer-c 619, consumer-d 988, consumer-a 940,
consumer-b 1097). Two prompts (`prompts/build.md` 38 lines, `prompts/plan.md`
65 lines). No helper scripts.

**The module default-exports a `Chain` object, not a `ChainFactory`**
(`:132-133`):

```
const chain: Chain = { phases: [plan, build], humanOnly: [] };
export default chain;
```

and it **statically imports engine runtime values** (`:16-23`): `parsePending`
and `renderSchemaForPrompt` alongside the types. Both are the pre-0.10 shape.
Every other consumer takes its runtime values from the injected `FlumeApi`
parameter and returns `{ chain }` from a factory; consumer-c and consumer-d
each carry a comment citing MIGRATING-0.10 §2 for exactly this migration.

### Phases

| | `plan` | `build` |
| --- | --- | --- |
| Concurrency | `singleton` (`:82`) | `fanout` (`:102`) |
| Prompt | `prompts/plan.md` | `prompts/build.md` |
| Agent | **not declared** — no per-phase model pin anywhere in the chain | not declared |
| `writablePaths` | 3 literals (`:83-87`) — **the inbox is not among them**; this chain predates the inbox convention | 8 globs (`:103-114`), with a comment excluding `SPEC.md` and `.flume/**` |
| `entryChannelPaths` / `scopeWritesToEntry` / `shouldRun` / `shipped` / `setupWorktree` / `teardownWorktree` | **none declared** | **none declared** |
| `promptArgs` | `:89` — 1 token, **`renderSchemaForPrompt()` called with no argument** | `:116` — 4 tokens |
| `handoff` | `:92` — `pendingAfter.some(open)` → `["build"]` or `[]` | `:127` — unconditional `["plan"]` |

### Gates

| Gate | `when` | Builtin / chain-authored | What it judges |
| --- | --- | --- | --- |
| `pending.json parses` | `afterCommit` | **chain-authored** (`:28`) | Reads `.flume/plan/pending.json` off `ctx.cwd` and runs `parsePending(raw)` — **a hand-rolled `pendingGate`**. consumer-c's chain carries a comment (`:486-490`) recording that *"the builtin replaces the hand-rolled pending-parse gate"*; consumer-e is the pre-replacement version still standing. |
| `tsc --noEmit` | **`afterMerge`** | **chain-authored** (`:57`) | Invokes `node node_modules/typescript/bin/tsc` directly rather than through a package manager, *"so the gate is deterministic regardless of pnpm's build-approval state"* (`:52-53`) |

Two gates. No `shellGate`, no `tscGate`, no `vitestGate` — every builtin gate
this chain would use today postdates it.

### Chain-level declarations

`{ phases, humanOnly: [] }` (`:132`) and nothing else. **No `entryExtension`** —
which means `per` is not a declared field, yet `build.promptArgs` reads
`ctx.assignedEntry.per.path` and `.per.section` directly (`:123-124`).

## 3. Engine facts the chain re-derives

Five, and the list is short mostly because the chain does so little:

| # | Site | What it re-derives | Covered by 0.15.0? |
| --- | --- | --- | --- |
| 1 | `.flume/chain.ts:34` | Hardcodes `` `${ctx.cwd}/.flume/plan/pending.json` `` | **Covered twice over** — `ctx.pendingPath` (which consumer-b's equivalent gate uses, and consumer-b's comment at `:222-223` names the hardcode as the defect it fixed) and `FlumeApi.paths`. |
| 2 | `.flume/chain.ts:38` | `parsePending(raw)` in a chain-authored gate | **Covered** — `pendingGate`, which additionally pre-checks entry `files` against the target fence. |
| 3 | `.flume/chain.ts:93` | `result.pendingAfter.some(e => e.gate.kind === "open")` | **Covered** — `TickResult.pickableAfter`. The known live-lock; **four of five consumers carry this form**, consumer-a alone having migrated. |
| 4 | `prompts/plan.md:4` | `cat .flume/plan/pending.json` raw into the prompt | **Covered** — `TickContext.pending`. |
| 5 | `prompts/plan.md:20,24,28` | `git ls-files src bin tests`, a live `tsc --noEmit`, and `git log -n 10 --oneline` in render spans | **Uncovered** — chain-owned reads. |

**Inline-exec spans: 9** (7 in `plan.md`, 2 in `build.md`). **None reads an
engine-owned artifact.** Notably, **none computes a git window off a cursor** —
consumer-e predates the `git log --grep='^plan:'` idiom consumer-c and
consumer-d share, and instead injects `SPEC.md` whole (`plan.md:16`). The
cursor idiom was invented after this chain was frozen.

**Agent-output re-parsing:** none. **Gate-message text matching:** none.
**Reading a file at a sha by hand:** none.

> **§3 verdict: 5 re-derivations, 4 of them already covered by a 0.15.0 surface
> (#1–#4). This is the highest covered-fraction in the survey, for an
> uninteresting reason: the chain is old enough that the engine has since
> absorbed nearly everything it does by hand.**

## 4. What 0.15.0 breaks

The named checks are almost all clean — and that is misleading, because the
chain fails before any of them matters.

| Check | Result |
| --- | --- |
| **Chain module contract** | **BREAKING, and total.** The module default-exports a `Chain` object (`:132-133`) where the engine expects a `ChainFactory`, and statically imports `parsePending` / `renderSchemaForPrompt` as values (`:16-23`) where the engine now injects them. The chain will not load. Everything below is downstream of this. |
| **`renderSchemaForPrompt()` arity** | **BREAKING.** Called with no argument at `:90`. |
| **`ctx.assignedEntry.per` without an `entryExtension`** | **BREAKING at typecheck.** `:123-124` read `.per.path` / `.per.section` directly. The chain declares no `entryExtension`, so `per` is not a known field at all; where it is known on other consumers it arrives typed `unknown` and must be narrowed through the declaring schema — both consumer-c (`:566-567`) and consumer-d (`:886-888`) carry the comment recording that migration. |
| `voluntary-bail` string | **No hits** — in `chain.ts` or either prompt. This chain predates the no-commit taxonomy entirely; it reads no `noCommit`, no `nothingPickable`, no prior-attempt record. |
| Direct `writablePathsGate(...)` call | **No hits.** |
| `ctx.priorAttempts` keyed by a raw tag | **No hits.** |
| `JobStatus.awake` as `string[]` | **No hits.** |
| `.flume/rendered-prompts/` / `.flume/merging/` ignored | **Absent.** `.gitignore:13-16` carries `.flume/awake/`, `.flume/worktrees/`, `.flume/sessions/`, `.flume/prior-attempts/`, under a comment explaining that the harness itself (chain, prompts, plan) **is** tracked and only runtime state is ignored. Neither new directory is named. Moot while the chain does not load. |
| Typecheck against 0.15.0 | **Not run.** Unlike the other four, running it here needs no scratch install — the path link already points at the local checkout — but the survey is read-only and a reinstall would mutate the consumer's `node_modules`. The three breakages above were established by reading the source against flume's `src/index.ts` and `src/PendingSchema.ts`. |

> **§4 verdict: 3 breakages, all structural, all at load or typecheck time, all
> loud. Zero string-level breakages — the surfaces 0.15.0 renamed are surfaces
> this chain never adopted. Typecheck NOT run.**

The useful generalization: **the named §4 checks measure how much of the
engine a consumer has adopted, not how healthy it is.** consumer-e scores
perfectly on them and does not load; consumer-b scores perfectly on them and is
genuinely fine. A migration checklist built only from renamed identifiers will
call both of them clean.

## 5. What this chain does that flume's own chain does not

**Has, that flume's lacks:** essentially nothing. The one deliberate choice
worth carrying forward is invoking `tsc` through `node node_modules/…` rather
than a package-manager shim, *"so the gate is deterministic regardless of
pnpm's build-approval state"* (`:52-53`) — a reasoning consumer-c independently
reached (`consumer-c/.flume/chain.ts:314`) and which is a platform fact rather
than a preference.

**Flume's own chain has, that this lacks:** nearly everything — plan slicing,
records as one file each (consumer-e has **no inbox at all**), a
`tests[]`/`pins[]` judge, a `per`-cite gate, a clean-tree gate, a records gate,
a posture sweep, an `entryExtension`, per-phase model pins, a friction channel,
`shouldRun`, `shipped`, `setupWorktree`, any `supervisorPolicy`, and every
builtin gate.

**Same notion of "done" as flume's:** no `shipped` predicate.

**Same spec locus in spirit:** a single human-curated `SPEC.md` at the repo
root — not a `spec/` corpus — which neither phase may write (`:112-113`).

## 6. Harness copies

| Artifact | Present? | Verbatim / adapted / original |
| --- | --- | --- |
| `PROTOCOL.md` | **No** | — |
| Plan-slice prompts | No — one `plan.md` (65 lines) | Original |
| A plan discipline file | **No** | — |
| `.claude/rules/*` | **Directory absent entirely** | — |
| `inbox.md` | **No — the chain predates the inbox convention** | — |
| `open-questions.md` | Yes, in `plan.writablePaths` (`:86`) | Adapted |
| `state.md` with cursor lines | Yes (`:85`) — but **no `Plan continues:` marker and no `handoff` read of it**. The self-wake idiom three of five consumers carry postdates this chain. | Adapted |

**Nothing here is copied from flume's harness prose**, because at 0.3 there
was not yet a harness prose layer to copy. consumer-e's value to the survey is
as the **zero point**: it shows which of the blocks that now appear verbatim
across consumers are genuinely shared conventions and which are simply *later*
than this chain. The `Plan continues:` marker, the `git log --grep='^plan:'`
cursor, the inbox, the `entryExtension`, the `per` cite, `PROTOCOL.md` — all
absent here, all present in two or more of the others. Every one of them was
invented after 0.3 and spread by copying, not by the engine offering it.

## 7. Operator signal

Little, and what there is comes from the code rather than from any register —
there is no live `open-questions.md` content and no commit narrative past the
strip-down.

- **A package manager's build-approval state can make a gate
  non-deterministic** (`:52-53`), worked around by calling the compiler's
  binary directly. Independently rediscovered by consumer-c. Shape: *a gate
  invoked through a package-manager shim inherits that tool's configuration
  state, which is not the gate's subject.*
- **`afterMerge` chosen so a failure reverts only the offending entry**
  (`:54-55`) — an early, correct reading of merge-stage semantics, predating
  consumer-d's much more elaborate two-tier schedule.
- **The archive commit itself is the signal**: *"strip to the minimal runtime —
  brief, chain, phase prompts."* This bay was reduced to its skeleton and left.
  Shape, for the chain package: *a consumer that stops has no mechanism to
  record that it stopped, or against which engine version it was last known
  good.* The path link makes this sharper — `file:../flume` names no version,
  so the fact that this chain last worked against 0.3.1 exists **only in an
  uncommitted `node_modules` directory**. Nothing in the repository records it,
  and the next `pnpm install` would erase the last evidence.
