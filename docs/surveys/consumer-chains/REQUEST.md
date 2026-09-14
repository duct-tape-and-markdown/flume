# Consumer chain survey — request

Written by the flume maintainer's session on 2026-09-14, against flume 0.15.0
(`@dtmd/flume`, tag `v0.15.0`). You are a session with read access to one or
more repositories that run flume. Answer this request for **each** consumer
repository you can reach, one response file per consumer, in the shape under
*Response shape*. Read-only: modify nothing in any consumer repository.

## Why

Flume's engine ships as a package; the harness a project runs it with (chain
config, prompts, plan discipline, records, judges) does not. Every consumer
re-authors that harness, and every breaking engine change is one hand
migration per consumer. The next layer is a consumable chain package with
typed environment config. This survey is its input: what the consumers
actually declare, what they re-derive, and what 0.15.0 breaks for them.

The survey is read on the maintainer's side and folded into the chain
package's config surface. It is also the first pass of the 0.15.0 migration
for each consumer, so be exact about what breaks.

## Confidentiality

The flume repository is public. Do not put proprietary content in a
response: no source excerpts beyond an identifier or a one-line signature,
no product names or domain vocabulary that identifies the employer, no
prompt text. Cite paths and line numbers, describe shapes, count things.
Where a consumer's name would identify it, use a neutral label (`consumer-a`)
and keep the mapping outside the response.

## What to establish, per consumer

Every claim is verified on disk in that repository at the time you read it,
and cited `path:line`. A claim you could not verify says so.

### 1. Identity and engine version

- Repository label, primary stack (language, test runner, package manager).
- The flume version it targets: the `@dtmd/flume` dependency in its manifest,
  and the lockfile's resolved version if they differ. If flume is vendored or
  path-linked rather than installed, say how.
- Where its state root and chain live (`.flume/chain.ts` or elsewhere), and
  whether it uses `flume job` (multiple state roots) or the default root.

### 2. Chain shape

Read the chain module and report, as a table where it fits:

- Each phase: name, concurrency (singleton or fanout), the prompt file it
  renders, its `writablePaths` count and the top-level directories they
  cover, whether it declares `entryChannelPaths`, `scopeWritesToEntry`,
  `shouldRun`, `shipped`, `promptArgs`, `setupWorktree`, `teardownWorktree`.
- Each gate: name, `when` (`afterCommit` / `afterMerge`), whether it is a
  builtin (`tscGate`, `pendingGate`, `writablePathsGate`, `shellGate`,
  `chainLoadGate`, ...) or chain-authored, and for chain-authored gates one
  line on what it judges.
- Chain-level declarations: `pendingPath`, `seedDir`, `friction`,
  `humanOnly`, `entryExtension` (list its extension fields), supervisor
  policy overrides, agent assignment per phase (model, extra args).
- The `handoff` function's shape: which `TickResult` fields it reads and
  what it wakes on.
- Approximate size: lines in the chain module, number of prompt files,
  number of helper scripts under the state root.

### 3. Engine facts the chain re-derives

This is the core of the survey. An engine fact is anything the dispatcher
computed and could have reported. Look for each of these and cite every
instance:

- Helper scripts under the state root (`.flume/*.mjs`, `*.ts`, `*.sh`) and
  what each reads. For each: does it read an engine-owned artifact directly
  (`prior-attempts/*.json`, `tick-verdicts.jsonl`, `tick-verdict.json`,
  `awake/`, `merging/`, `rendered-prompts/`, the loop lock)? Does it resolve
  the state root itself (`git rev-parse --git-common-dir`, an env read with a
  fallback, a hardcoded `.flume`) rather than take `FLUME_DIR`?
- Inline-exec spans in prompts (`` !`...` ``): list each command. Which of
  them read engine-owned artifacts, and which compute a git window off a
  cursor the chain owns?
- Chain code that re-parses agent output, matches on a gate's message text,
  copies a filename or slug rule the engine owns, or infers what a tick did
  from the shape of its commit (touched paths, prefix, sole-file commits).
- Any place the chain re-runs a pickability or quarantine decision instead
  of reading `TickContext.pickable` / `TickResult.pickableAfter` /
  `TickResult.quarantinedTags`.
- Any place the chain reads a file at a sha by hand (`git show <sha>:<path>`)
  instead of `api.git.readFileAtRef`.

For each instance, say whether flume 0.15.0 already exports the fact (name
the surface) or whether it is genuinely absent from the engine.

### 4. What 0.15.0 breaks

Check each and cite the hits or state "no hits":

- The string `voluntary-bail` anywhere in the chain, prompts, or scripts
  (renamed `clean-exit`; the record's `constraint` field is now
  `finalMessage`).
- A direct call to `writablePathsGate(...)` passing an object with
  `entryPaths` / `channelPaths` (the second parameter is now a resolved
  `string[]`).
- A lookup on `ctx.priorAttempts` keyed by a raw tag or phase name that is
  not already slug-shaped (lowercase, digits, hyphens).
- Any consumer of `JobStatus.awake` treating it as `string[]` only.
- Prompts or docs that name `.flume/rendered-prompts/` or `.flume/merging/`
  in an ignore file: are they present? (They are seeded at loop start on
  0.15.0, but a hand-maintained repo ignore may lack them.)
- Whether the chain's `.flume/chain.ts` imports anything from the package
  that `@dtmd/flume@0.15.0` no longer exports. Run the consumer's typecheck
  against 0.15.0 if you can do so without modifying the repository (a
  scratch copy is fine); otherwise say the check was not run.

### 5. What this chain does that flume's own chain does not

Flume's own chain (`.flume/chain.ts` in the flume repository) has: three
plan slices (inbox, derive, sweep) plus build; records as one file each
under `inbox/` and `plan/notes/`; a `tests[]` / `pins[]` judge that runs
named tests against the merged tree and the base; a `per` cite gate into
`spec/` and `.claude/rules/`; a clean-tree gate; a records gate. List what
the consumer has that flume's does not, and what flume's has that the
consumer lacks or replaced. Custom judges, extra gates, different record
conventions, a different spec locus, a different notion of "done".

### 6. Harness copies

Which of these exist in the consumer, and are they verbatim copies of
flume's, adapted, or original: `PROTOCOL.md`, plan-slice prompts, a plan
discipline file, `.claude/rules/engineering.md` / `engine-boundary.md` /
`spec-plan-build.md`, an `open-questions.md`, a `state.md` with cursor lines.
Verbatim copying is the detector for a missing surface, so a block that
appears unchanged across consumers matters more than one that differs.

### 7. Operator signal

From the consumer's own `open-questions.md`, notes, commit bodies, or
comments in the chain: what the operator has flagged about flume itself.
Quote the shape of the complaint, not the text. Include anything the
consumer worked around with a script.

## Response shape

One file per consumer, `docs/surveys/consumer-chains/<label>.md`, with the
seven headings above in order, numbered as here. Tables for §2 and §3.
Every finding cited `path:line`. Under §3 and §4, close with a one-line
verdict each: how many re-derivations, how many of them the engine already
covers; how many 0.15.0 breakages, and whether the typecheck was run.

Plus one `docs/surveys/consumer-chains/INDEX.md`: a table with one row per
consumer and columns *engine version*, *phases*, *gates*, *re-derivations
(covered / uncovered)*, *0.15.0 breakages*, *harness copies (verbatim /
adapted / original)*. Then at most ten lines: the blocks that appear in more
than one consumer, since those are the chain package's first config fields.

Commit the response files on a local branch `survey/consumer-chains` in the
flume checkout you read this from. **Do not push that branch to the public
remote.** Hand the files to the maintainer through a private channel.

Temper (`~/repos/temper`) is already surveyed on the maintainer's side; skip
it unless it is the only consumer you can reach.
