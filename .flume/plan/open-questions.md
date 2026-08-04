# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## CLI-FLUMEDIR-CROSS-REPO-ROOT-REFUSAL's path-shape heuristic can misfire on a deliberate relocation

**Status: PARKED**

`d9662a3` refuses an already-absolute `FLUME_DIR` when `impliedRepoRoot()` (`src/cli.ts`) walks the path up to a `.flume` segment and that segment's parent differs from `repoRoot`. The mechanism infers "this value was inherited from a different repo's flume process" purely from the path containing a directory literally named `.flume`.

`spec/cli.md:149` explicitly sanctions out-of-tree relocation ("A relocated state root is expected to live outside the working tree"), with no constraint on what the relocated directory is named. `.flume` is the tool's own universal default name, used in every doc and example — a plausible, arguably natural choice for a human relocating state deliberately (e.g. `FLUME_DIR=/mnt/state/.flume`). For that invocation: `impliedRepoRoot("/mnt/state/.flume")` returns `/mnt/state`, which is never `repoRoot`, so `resolveStateDirs` throws `CrossRepoFlumeDirError` — refusing a legitimate, human-typed relocation as if it were inherited cross-repo contamination. The shipped tests only cover a no-`.flume`-ancestor relocation (`/var/dock/state`) — the `.flume`-named-elsewhere case is untested and, by the mechanism's own logic, misclassified.

The underlying tension: the path string alone cannot distinguish "inherited via env from a different repo's resolution" (the real 2026-08-03 bug) from "typed fresh, this invocation, for this repo, and happens to be named `.flume`" — both produce an identical absolute value with a `.flume` ancestor pointing elsewhere.

Options:
1. Leave as-is, and document the constraint: a relocated `FLUME_DIR` must not be named (or nested under) a literal `.flume` segment whose parent isn't the intended repo — i.e., tell users to avoid the collision.
2. Track provenance explicitly instead of inferring it from shape: have `resolveStateDirs`'s canonicalization write-back also stamp a private env var (e.g. `FLUME_DIR_RESOLVED_FOR=<repoRoot>`) alongside `FLUME_DIR`/`FLUME_CONFIG_DIR`/`FLUME_JOB`; refuse only when that var is present and disagrees with the freshly-resolved `repoRoot`. A user-typed value for this invocation never carries the sentinel, so it can never misfire — only genuine inheritance across the loop→tick (or nested-process) boundary sets it. This changes the shipped mechanism and needs its own spec update to the canonicalization write-back section (`spec/cli.md:121-134`).

No recommendation — option 2 is technically cleaner (exact provenance instead of a path-shape guess) but reopens a very recently-ruled decision and adds a fourth write-back var; option 1 is cheaper but pushes a foot-gun onto users. This is downstream of the shipped ruling's own scope, not an implementation slip, so it's parked rather than proposed unilaterally.

## Phase.shipped's harness half has no phase that can write it

**Status: PARKED**

`spec/pending.md` *Ship detection trusts the agent's own account* (ruling 82c0a12,
superseding the on-disk-declaration ruling 541174a before it) states the target
cleanly: the engine sheds `statesPark`, its regex, and `channel-only` entirely, and
gains one optional hook — `Phase.shipped?: (ctx: ShipContext) => boolean`, sibling of
`shouldRun`/`handoff`. Undeclared means shipped on commit-landed + gates-green;
declared and returning `false` means the entry stays pending.

The ruling is explicit that this "ships with `.flume/chain.ts` in the same commit" —
this repo's own chain must declare `shipped`, "or the original bug returns" — and
that `.flume/prompts/build.md` "moves in the same commit too," calling the
harness-surface-in-a-build-commit exception deliberate. That pairing isn't available
to either autonomous phase:

- Build's own `writablePaths` (`buildFence` in `.flume/chain.ts`) excludes harness
  surface by name — the comment there states "`.flume/{chain.ts,prompts/**}`,
  `.claude/**` are outside every phase lane." Plan's `writablePaths` is narrower
  still (only `.flume/plan/*` and `inbox.md`).
- `.claude/rules/spec-plan-build.md`'s layer table doesn't list `.flume/chain.ts` or
  `.flume/prompts/*.md` under any phase; per CLAUDE.md, "Harness commits use
  `chore(flume):`" — interactive-only.
- Landing the two halves as separate commits doesn't dodge this either. With
  `Phase.shipped` undeclared, *every* landed+green commit classifies shipped —
  including a park-only one. Any tick that runs between an engine-only commit and a
  later interactive chain.ts commit reintroduces the exact bug this whole thread has
  been fixing, from the permissive side this time.

This also folds in the still-open `build.md` line-26 fix (it names the retired
channel-path mechanism this same ruling replaces) — same commit, same reason, per the
2026-08-04 inbox finding that filed it.

Supersedes and closes the prior open question here (`statesPark`'s free-text scan
misclassifying a partial park) — that question was about hardening the regex; this
ruling deletes the regex and `statesPark` outright, so hardening it is moot.

Options:
1. One interactive `chore(flume):` commit landing all of it at once — `src/`
   (`Phase.shipped`, `ShipContext`, remove `statesPark`/`channel-only`) +
   `.flume/chain.ts` (declare the predicate) + `.flume/prompts/build.md` (the
   park-declaration instructions the predicate reads) — a human doing in one motion
   what the ruling already calls a deliberate exception to the phase-lane split.
   Zero regression window because there is only one commit.
2. Split into a build-phase pending entry for the `src/` mechanism (ships first,
   `Phase.shipped` undeclared) followed by a same-session interactive `chain.ts` +
   `build.md` commit. Carries the regression window described above for however long
   the two are apart.
3. Widen `buildFence.writablePaths` to include `.flume/chain.ts`/`.flume/prompts/**`
   (itself only doable via an interactive chain.ts edit) so a future build tick could
   carry a paired harness+engine change autonomously — a bigger, standing loosening
   of the phase-lane boundary than this one ruling calls for.

Weak lean to option 1 for the zero-regression-window property, but this is a genuine
process question about how a harness-surface change and its engine counterpart cross
the phase boundary together — the kind of thing `collaboration.md`'s
architectural-missteps caveat says to flag rather than silently route.

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

## Should a provider supply its own stream transcript extractor?

**Status: PARKED**

`AGENT-STREAMJSON-VOCAB-DEDUP` (pending.json) hoists the duplicated
`assistant`/`result`/`is_error`/`subtype` literals out of `src/Agent.ts` and
`src/Dispatcher.ts` into one shared, exported check — but both readers still hardcode
Claude Code's NDJSON shape as the only vocabulary the engine understands, even though
`spec/chain.md` *The agent seam* states an `Agent` is `{ name, invoke }`, opaque to
the engine, generic over providers.

Options:
1. Leave the shared-but-hardcoded reader as-is while Claude Code is the only shipped
   provider — the prior posture sweep's own judgment, and the
   `.claude/rules/engine-boundary.md` second-implementation test isn't answerable
   with a sample size of one.
2. Have the chain's `Agent` supply its own transcript-extraction function (part of
   the `Agent` value or a decorator), and the dispatcher calls that instead of
   assuming stream-json shape — generalizes the mechanism per engine-boundary.md, but
   is new capability surface with no second implementation asking for it yet.

Recommend option 1 until a second provider exists; filing now only so the class has a
name for the next sweep pass that finds it.
