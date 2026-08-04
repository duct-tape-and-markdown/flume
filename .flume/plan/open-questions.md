# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## spec/pending.md's "Ship detection requires a declared-files diff" now describes removed behavior

**Status: NEEDS AMENDMENT**

`f658e7d` (SHIP-CLASSIFICATION-DROPS-PATH-PREDICATE) deleted the declared-files diff predicate from `runFanout`'s ship classification per an operator ruling, and the code/tests now correctly ship on commit-landed+gates-green unless the agent's own termination states a park. But `spec/pending.md:295-321`, section "Ship detection requires a declared-files diff", still states the *old* mechanism as current truth: "the dispatcher diffs the cherry-picked commit against the entry's declared `files.{new,edit,retire}`" — that diff no longer exists anywhere in `src/Dispatcher.ts`. Unlike the sibling ruling that same window (CLAUDECODE-SKIPPERMS-RATIONALE-REWRITE), whose commit explicitly left a pointer to the stale `spec/chain.md` Drift note for a human to close, this one didn't note the spec is now wrong — plan/build can't touch `spec/**` (`spec-plan-build.md`), so it's surfacing here instead.

Options:
1. Rewrite the section to describe the current mechanism (commit-landed + gates-green + no stated park), keeping the heading or renaming it to match.
2. Add a `> **Drift:**` note (the pattern already used at `spec/chain.md:156/237/430`, `spec/cli.md:87/136`, etc.) pointing at the ruling and the new mechanism, deferring the full rewrite.

Recommend option 1 — the section is short and the old mechanism is gone outright, not partially drifted, so a Drift note undersells how stale it is.

## spec/cli.md's Drift note on job-verb state-dir resolution is now stale

**Status: NEEDS AMENDMENT**

`spec/cli.md:136-143` carries a `> **Drift:**` note: "the guarantee does not reach the chain loads on the `job new` and `job status` paths. `main()` ... routes those verbs to `runJobVerb` and returns before `resolveStateDirs` ever runs...". `e814195` (CLI-STATEROOT-RESOLVE-BEFORE-DISPATCH) fixed exactly this — `resolveStateDirs` now runs ahead of the job-verb dispatch and `runJobVerb` no longer re-derives `configDir` from raw env — but the commit didn't reference or close the note (contrast with `8d28a6f`, which explicitly says "The spec/chain.md Drift note citing the same gap is left for a human to close"). The note now describes a gap that no longer exists.

Recommend: delete the Drift note (lines 136-143); the surrounding prose already states the current (now-true) guarantee.

## CLI-FLUMEDIR-CROSS-REPO-ROOT-REFUSAL's path-shape heuristic can misfire on a deliberate relocation

**Status: PARKED**

`d9662a3` refuses an already-absolute `FLUME_DIR` when `impliedRepoRoot()` (`src/cli.ts`) walks the path up to a `.flume` segment and that segment's parent differs from `repoRoot`. The mechanism infers "this value was inherited from a different repo's flume process" purely from the path containing a directory literally named `.flume`.

`spec/cli.md:149` explicitly sanctions out-of-tree relocation ("A relocated state root is expected to live outside the working tree"), with no constraint on what the relocated directory is named. `.flume` is the tool's own universal default name, used in every doc and example — a plausible, arguably natural choice for a human relocating state deliberately (e.g. `FLUME_DIR=/mnt/state/.flume`). For that invocation: `impliedRepoRoot("/mnt/state/.flume")` returns `/mnt/state`, which is never `repoRoot`, so `resolveStateDirs` throws `CrossRepoFlumeDirError` — refusing a legitimate, human-typed relocation as if it were inherited cross-repo contamination. The shipped tests only cover a no-`.flume`-ancestor relocation (`/var/dock/state`) — the `.flume`-named-elsewhere case is untested and, by the mechanism's own logic, misclassified.

The underlying tension: the path string alone cannot distinguish "inherited via env from a different repo's resolution" (the real 2026-08-03 bug) from "typed fresh, this invocation, for this repo, and happens to be named `.flume`" — both produce an identical absolute value with a `.flume` ancestor pointing elsewhere.

Options:
1. Leave as-is, and document the constraint: a relocated `FLUME_DIR` must not be named (or nested under) a literal `.flume` segment whose parent isn't the intended repo — i.e., tell users to avoid the collision.
2. Track provenance explicitly instead of inferring it from shape: have `resolveStateDirs`'s canonicalization write-back also stamp a private env var (e.g. `FLUME_DIR_RESOLVED_FOR=<repoRoot>`) alongside `FLUME_DIR`/`FLUME_CONFIG_DIR`/`FLUME_JOB`; refuse only when that var is present and disagrees with the freshly-resolved `repoRoot`. A user-typed value for this invocation never carries the sentinel, so it can never misfire — only genuine inheritance across the loop→tick (or nested-process) boundary sets it. This changes the shipped mechanism and needs its own spec update to the canonicalization write-back section (`spec/cli.md:121-134`).

No recommendation — option 2 is technically cleaner (exact provenance instead of a path-shape guess) but reopens a very recently-ruled decision and adds a fourth write-back var; option 1 is cheaper but pushes a foot-gun onto users. This is downstream of the shipped ruling's own scope, not an implementation slip, so it's parked rather than proposed unilaterally.

## `statesPark`'s free-text scan may misclassify a partial park as a full one (unverified, flagging for visibility)

**Status: PARKED**

`f658e7d`'s `statesPark()` (`src/Dispatcher.ts`) matches `/\bpark(?:ed|ing)?\b/i` anywhere in the agent's final message to decide whether a landed, gate-green commit still counts as shipped. `.claude/rules/collaboration.md`'s "Inform before parking" instructs agents broadly to write *any* deferred judgment call to `open-questions.md` using park/parked language — not only the whole-entry-channel-only case `.flume/prompts/build.md` documents. A message like "Shipped the acceptance criteria; parked a follow-up idea about X in open-questions.md" would match the regex and classify a genuine ship as `channel-only`, reintroducing the non-draining-loop failure this same fix was meant to close — from the opposite direction (false negative instead of the old false positive on glob paths).

No test exercises a "ships real work and also mentions parking something unrelated" message — only a full-park case (`STATED-PARK` test, final message *is* the park statement) and a no-mention case are pinned. Confidence here is lower than the other three questions above: this is a plausible reproduction reasoned from the regex and the prompt/rule vocabulary, not one observed on disk.

Options if real: anchor the check tighter (e.g. only the message's own park-statement convention per `build.md`, not a bare substring anywhere) or leave as ruled and accept the risk as the tradeoff already made 2026-08-03. Parking rather than filing a pending entry because a fix here means re-litigating the just-shipped ruling's chosen detection shape, same as the question above.

## `docs/MIGRATING-0.11.md`'s dead `spec/RELEASE-v0.11` cites: live guidance or historical record?

**Status: PARKED**

The inbox's flatten-orphan-cites finding flagged `docs/MIGRATING-0.11.md` and `docs/PRD-dock-collapse.md` as needing an explicit call rather than a blanket sweep, since `docs/` legitimately holds historical material (CLAUDE.md) but a migration guide "reads as live reference." Read both this tick to do that research before parking, per `collaboration.md`'s *Inform before parking*:

- `docs/PRD-dock-collapse.md` opens "Status: **draft for review** (uncommitted). On acceptance, the normative content ingests into `spec/RELEASE-v0.5.md`; this document is the design record." — unambiguously self-declared historical. No entry filed; accepted as-is.
- `docs/MIGRATING-0.11.md` reads as live directive prose ("every chain must move to the factory shape... not optional") with three dead links to `../spec/RELEASE-v0.11.md` (§1 twice, §6 once). Whether it's still live (a chain somewhere may still be pre-0.11) or has become historical (the 0.11 migration is long complete) is a product/timeline call this session can't settle from the repo alone — the research didn't yield a clear answer, so this is parked rather than guessed.

Options:
1. Treat as historical — leave as-is (or reframe to past tense); no cite repair needed.
2. Treat as live — repoint its three cites to whichever topic file/section now owns each ruling (the branch-topology retraction, the factory-shape requirement), the same repair `FLATTEN-ORPHANED-RELEASE-CITES-REPOINT` does for tests/CHANGELOG.md.

No recommendation — turns on whether any chain in the wild is still migrating to 0.11, which is outside this repo's visibility.

## posture-sweep.md's "module" has no defined home for a domain test file whose subject lives outside the domain

**Status: PARKED**

Auditing `f6a9c12`'s sweep-rotation closure this tick found `tests/chain.test.ts` (subject: `.flume/chain.ts`) and `tests/build-changelog.test.ts` (subject: `scripts/build-changelog.mjs`) were touched inside the just-closed rotation's window (`9925212`..`e46b0d0`) but never entered any covered set. Every other touched `tests/*.test.ts` file in that window pairs 1:1 with a covered `src/` or `examples/` module and rides along as that module's "immediate import," so no tick has ever needed to list a `tests/` file standalone. These two have no `src/`/`examples/`/`bin/` pairing — their subjects sit in `.flume/` and `scripts/`, neither in the sweep domain — so the pairing convention never reaches them, and they went unswept for a full rotation despite `posture-sweep.md` stating the domain includes all of `tests/` unconditionally.

Corrected this tick: reverted `Posture swept through` to `9925212` (the last rotation this audit can actually verify closed correctly) and carried the covered set forward unchanged, so the next sweep tick's frontier recomputation surfaces these two again. But `posture-sweep.md` itself doesn't say what a "frontier module" means for a domain file with no in-domain import to co-read — is the test file its own standalone neighborhood, or does covering it require also reading the out-of-domain file it tests?

Options:
1. Treat each such `tests/` file as its own standalone neighborhood — no imports to co-read, matches the "touched module → frontier" rule literally. No rule change needed.
2. Amend `posture-sweep.md` to say the neighborhood follows the *tested* subject regardless of domain, so `scripts/build-changelog.mjs` and `.flume/chain.ts` get read as context even though neither is otherwise in-domain.

Recommend option 1 — the existing "immediate imports" language already permits reading whatever the sweeping agent judges relevant; the gap was that nobody flagged these two as frontier entries at all, not that the reading method needs a rule change.
